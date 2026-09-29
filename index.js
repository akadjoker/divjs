/**
 * DivJS - the public entry point of the library.
 *
 * `npm run build` bundles this file and everything it imports (the physics
 * library included) into dist/divjs.js, one ES module with no imports of
 * its own: what sites, the playground and packed games load.
 *
 *   import { runDivDemo } from './dist/divjs.js';
 *   runDivDemo({ canvas: 'game', source: 'program p; begin loop frame; end end' });
 */

import { Lexer, KEYWORD_NAMES, TokenType } from './compiler/tokenizer.js';
import { Parser } from './parser/parser.js';
import { Compiler, BUILTIN_CONSTANTS, PROCESS_FIELD_NAMES } from './compiler/compiler.js';

export const VERSION = '1.0.0';

// Running programs
export { runDivDemo, bootDivDemo, createNetPanel } from './divjs.js';
export { VM } from './vm/vm.js';
export { CanvasEngineRuntime, CType } from './vm/runtime.js';

// The language: tokenizer, parser, compiler, errors, bytecode
export { Lexer, KEYWORD_NAMES, TokenType, Parser, Compiler, BUILTIN_CONSTANTS, PROCESS_FIELD_NAMES };
export { DivError } from './compiler/errors.js';
export { disassemble } from './compiler/disasm.js';
export { OpCodes, OpCodeNames } from './compiler/bytecode.js';

// DIV files
export {
  parseDivFpgBuffer, parseDivMapBuffer, parseDivFntBuffer,
  loadDivFpgFromUrl, loadDivMapFromUrl, loadDivFntFromUrl, renderDivFontText
} from './vm/div_formats.js';

// Online play and sound, for tools and tests
export { encodeCode, decodeCode, hashState } from './vm/net.js';
export { synthesize, sfxRecipe, noteFrequency, parseNotes } from './vm/audio.js';

// Single-file games
export { buildPackedHtml, findAssetReferences, programResolution, collectEngineModules } from './tools/packer.js';

// Source text -> bytecode, the steps runDivDemo takes. Throws DivError.
export function compile(source)
{
  const tokens = new Lexer(String(source)).tokenize();
  const ast = new Parser(tokens).parse();
  return new Compiler().compile(ast);
}

// The engine as the packer's module list, from the text of dist/divjs.js
// (which has no imports of its own): packed games embed it as it is.
export function bundleEngineModules(bundleText)
{
  return [{ path: 'divjs.js', source: String(bundleText) }];
}
