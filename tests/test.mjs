import { readdirSync, readFileSync, statSync } from 'fs';
import { dirname, extname, join, relative } from 'path';
import { fileURLToPath } from 'url';

async function loadModule(path) {
	const mod = await import(path);
	return mod.default ?? mod;
}

const { Lexer } = await loadModule('../compiler/tokenizer.js');
const { Parser } = await loadModule('../parser/parser.js');
const { Compiler } = await loadModule('../compiler/compiler.js');

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));

function isLegacyDivFile(filePath) {
	const rel = relative(rootDir, filePath).replaceAll('\\', '/');
	// examples/*.div predates this compiler's actual grammar; demos/*.div
	// are DIV/Fenix reference source pulled from an external
	// implementation for API reference only - neither was ever meant to
	// compile against this project's tokenizer/parser. demos/*.html (the
	// interactive browser demos actually built against this engine) is
	// deliberately NOT excluded here - those should compile cleanly.
	return rel.startsWith('examples/') || (rel.startsWith('demos/') && rel.endsWith('.div'));
}

function compileSource(source) {
	const lexer = new Lexer(source);
	const tokens = lexer.tokenize();
	const parser = new Parser(tokens);
	const ast = parser.parse();
	const compiler = new Compiler();
	const bytecode = compiler.compile(ast);
	return { tokens, ast, bytecode };
}

function walkFiles(dir, out = []) {
	for (const name of readdirSync(dir)) {
		if (name === '.git' || name === 'node_modules') {
			continue;
		}
		const fullPath = join(dir, name);
		const st = statSync(fullPath);
		if (st.isDirectory()) {
			walkFiles(fullPath, out);
		} else {
			out.push(fullPath);
		}
	}
	return out;
}

function extractInlineDivSources(htmlText) {
	const sources = [];
	// Demo HTML files use "const SOURCE = ..." (uppercase); index.html and
	// examples/ use "const source = ..." (lowercase) - match both rather
	// than assuming one convention.
	const re = /const\s+SOURCE\s*=\s*`([\s\S]*?)`\s*;/gi;
	let m;
	while ((m = re.exec(htmlText)) !== null) {
		sources.push(m[1]);
	}
	return sources;
}

const files = walkFiles(rootDir);
const divFiles = files.filter((p) => extname(p).toLowerCase() === '.div' && !isLegacyDivFile(p));
const htmlFiles = files.filter((p) => extname(p).toLowerCase() === '.html');

let ok = 0;
let fail = 0;

for (const filePath of divFiles) {
	const rel = relative(rootDir, filePath);
	const source = readFileSync(filePath, 'utf-8');
	try {
		const { bytecode } = compileSource(source);
		console.log(`OK    ${rel.padEnd(35)} ${bytecode.instructions.length} instr, ${bytecode.processTable.size} procs`);
		ok += 1;
	} catch (err) {
		console.log(`FAIL  ${rel.padEnd(35)} ${err?.message || String(err)}`);
		fail += 1;
	}
}

for (const filePath of htmlFiles) {
	const rel = relative(rootDir, filePath);
	const html = readFileSync(filePath, 'utf-8');
	const inlineSources = extractInlineDivSources(html);
	if (inlineSources.length === 0) {
		continue;
	}

	for (let i = 0; i < inlineSources.length; i++) {
		const label = inlineSources.length === 1 ? rel : `${rel}#source${i + 1}`;
		try {
			const { bytecode } = compileSource(inlineSources[i]);
			console.log(`OK    ${label.padEnd(35)} ${bytecode.instructions.length} instr, ${bytecode.processTable.size} procs`);
			ok += 1;
		} catch (err) {
			console.log(`FAIL  ${label.padEnd(35)} ${err?.message || String(err)}`);
			fail += 1;
		}
	}
}

console.log(`\nSummary: ${ok} ok, ${fail} failed`);
if (fail > 0) {
	process.exitCode = 1;
}
