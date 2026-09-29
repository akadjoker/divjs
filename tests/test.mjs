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
const {
	programResolution, collectEngineModules, resolveModulePath, findAssetReferences, bytesToBase64, buildPackedHtml
} = await import('../tools/packer.js');

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
		// Hidden folders (.git, editor and tool folders - some hold whole
		// copies of the repository) and dependencies are not the project.
		if (name.startsWith('.') || name === 'node_modules' || name === 'dist') {
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

// DIV programs checked here: tests/programs/ (the playground and its games
// have their own checks in github.com/akadjoker/divjs-playground).

// The packer (tools/packer.js), used by the playground's Export button and
// tools/pack.mjs. Opening a packed page is checked in tests/browser.mjs.
{
	const problems = [];
	const expect = (cond, msg) => { if (!cond) problems.push(msg); };
	expect(resolveModulePath('vm/runtime.js', '../compiler/errors.js') === 'compiler/errors.js', 'resolveModulePath ../');
	expect(resolveModulePath('divjs.js', './vm/vm.js') === 'vm/vm.js', 'resolveModulePath ./');
	const refs = findAssetReferences(`load_fpg("a.fpg"); // load_map("skip.map")
		g = LOAD_GRAPHIC('img/b.png', 0, 0, 8, 8); load_fpg("a.fpg"); /* load_fnt("x.fnt") */ load_fnt(name);`);
	expect(JSON.stringify(refs) === JSON.stringify(['a.fpg', 'img/b.png']), `findAssetReferences: ${JSON.stringify(refs)}`);
	for (const n of [0, 1, 2, 3, 4, 5, 255])
	{
		const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 97 + 13) & 255);
		expect(bytesToBase64(bytes) === Buffer.from(bytes).toString('base64'), `bytesToBase64 length ${n}`);
	}
	const modules = await collectEngineModules((path) => readFileSync(join(rootDir, path), 'utf-8'));
	const paths = modules.map((m) => m.path);
	expect(paths[paths.length - 1] === 'divjs.js', 'the entry module must come last (dependencies first)');
	for (const required of ['vm/runtime.js', 'vm/vm.js', 'compiler/compiler.js', 'parser/parser.js', 'vm/div_formats.js', 'vm/physics.js', 'vendor/planck.js'])
	{
		expect(paths.includes(required), `engine module missing from the pack: ${required}`);
	}
	for (const mod of modules)
	{
		// Every relative import must have been turned into a module token,
		// and every token must name a module that comes earlier.
		expect(!/^[ \t]*import\s[\s\S]*?from\s+['"]\.\.?\//m.test(mod.source), `${mod.path}: a relative import was not rewritten`);
		for (const [, dep] of mod.source.matchAll(/__DIVJS_MODULE__\[([^\]]+)\]/g))
		{
			expect(paths.indexOf(dep) >= 0 && paths.indexOf(dep) < paths.indexOf(mod.path), `${mod.path}: ${dep} must come before it`);
		}
	}
	const html = buildPackedHtml({ modules, source: 'program p; begin set_mode(640, 480); end', files: { 'a.fpg': Uint8Array.of(1, 2, 3) }, title: '<Game>' });
	expect(html.includes('width="640" height="480"'), 'the page canvas should take the program\'s set_mode size');
	expect(html.includes('<title>&lt;Game&gt;</title>'), 'the title must be escaped');
	expect(html.includes('Copyright (c) 2026 akadjoker') && html.includes('Permission is hereby granted'), 'a packed page must carry the engine\'s MIT notice');
	expect(html.split('</script>').length === 4, 'the embedded JSON must not contain a </script> (3 scripts expected)');
	if (problems.length > 0)
	{
		console.log(`FAIL  ${'packer'.padEnd(35)} ${problems.join('; ')}`);
		fail += 1;
	}
	else
	{
		console.log(`OK    ${'packer'.padEnd(35)} ${modules.length} engine modules`);
		ok += 1;
	}
}

console.log(`\nSummary: ${ok} ok, ${fail} failed`);
if (fail > 0) {
	process.exitCode = 1;
}
