// Test pipeline: lexer → parser → compiler
import { Lexer } from './compiler/tokenizer.js';
import { Parser } from './parser/parser.js';
import { Compiler } from './compiler/compiler.js';
import { readFileSync } from 'fs';

const source = readFileSync('./examples/platformer.div', 'utf-8');

const lexer = new Lexer(source);
const tokens = lexer.tokenize();
console.log('✓ TOKENS:', tokens.length);

const parser = new Parser(tokens);
const ast = parser.parse();
console.log('✓ AST:', ast.name, ast.processes.length, 'processes');

const compiler = new Compiler();
const bytecode = compiler.compile(ast);
console.log('✓ BYTECODE:', bytecode.instructions.length, 'instructions');
console.log('✓ PROCESS TABLE:', bytecode.processTable.size, 'processes');

console.log('\n✅ Pipeline OK!');
