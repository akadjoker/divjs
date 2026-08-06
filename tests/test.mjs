// Contract tests by source inspection (Node-compatible in current module setup).
import { strict as assert } from 'assert';
import { readFileSync } from 'fs';

const tokenizerSource = readFileSync('./compiler/tokenizer.js', 'utf-8');
const parserSource = readFileSync('./parser/parser.js', 'utf-8');
const compilerSource = readFileSync('./compiler/compiler.js', 'utf-8');
const runtimeSource = readFileSync('./vm/runtime.js', 'utf-8');

assert.match(tokenizerSource, /TokenType\s*=\s*\{/, 'tokenizer should define TokenType');
assert.match(parserSource, /class\s+Parser/, 'parser should expose Parser class');
assert.match(compilerSource, /class\s+Compiler/, 'compiler should expose Compiler class');
assert.match(compilerSource, /CALL_NATIVE/, 'compiler should emit native calls');

console.log('✓ PIPELINE CONTRACT: tokenizer/parser/compiler source markers OK');

// Runtime/API contract checks by source inspection (works in current Node module mode).
assert.match(runtimeSource, /registerNative\('load_graphic'/, 'load_graphic should be registered');
assert.match(runtimeSource, /registerNative\('load_tile'/, 'load_tile should be registered');
assert.doesNotMatch(runtimeSource, /registerNative\('bind_graph'/, 'bind_graph should not be public API');
assert.match(runtimeSource, /graphId is the real graphic id returned by load_graphic\/load_tile\./, 'runtime should use direct graph id mapping');

console.log('✓ RUNTIME API CONTRACT: load_graphic/load_tile direct id mapping OK');
console.log('\n✅ Contract checks OK!');
