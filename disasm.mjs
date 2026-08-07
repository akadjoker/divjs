#!/usr/bin/env node
// Usage: node disasm.mjs [path/to/file.div]
//
// Compiles a .div source file and prints its bytecode in an organized,
// human-readable form: a constant pool table, then each PROCESS/FUNCTION/
// MAIN body as its own labeled section, with LOAD_CONST/LOAD_LOCAL/
// LOAD_GLOBAL operands annotated with the actual value or variable name
// instead of a bare index, and jump targets marked "-> addr".
//
// With no argument, disassembles the small demo program embedded in
// index.html (the same one `npm run test:pipeline` compiles), so there's
// always something to run this against without hunting for a sample file.

import fs from 'fs';
import { Lexer } from './compiler/tokenizer.js';
import { Parser } from './parser/parser.js';
import { Compiler } from './compiler/compiler.js';
import { disassemble } from './compiler/disasm.js';

function loadSource(path) {
  if (path) {
    return fs.readFileSync(path, 'utf8');
  }
  const html = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8');
  const match = html.match(/= `([\s\S]*?)`;/);
  if (!match) {
    throw new Error('Could not find the inline DIV source in index.html; pass a .div file path instead.');
  }
  return match[1];
}

const path = process.argv[2];
const source = loadSource(path);

try {
  const tokens = new Lexer(source).tokenize();
  const ast = new Parser(tokens).parse();
  const bytecode = new Compiler().compile(ast);
  console.log(disassemble(bytecode));
} catch (error) {
  console.error(`Compile error: ${error.message}`);
  process.exitCode = 1;
}
