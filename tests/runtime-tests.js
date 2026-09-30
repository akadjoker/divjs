// Runtime regression tests. Run from tests/test.html through
// runAllTests() in browser-tests.js.

import { Lexer } from '../compiler/tokenizer.js';
import { Parser } from '../parser/parser.js';
import { Compiler } from '../compiler/compiler.js';
import { VM } from '../vm/vm.js';
import { CanvasEngineRuntime } from '../vm/runtime.js';
import { parseDivMapBuffer, parseDivFpgBuffer, parseDivFntBuffer } from '../vm/div_formats.js';

function compileSource(source)
{
  const lexer = new Lexer(source);
  const tokens = lexer.tokenize();
  const parser = new Parser(tokens);
  const ast = parser.parse();
  const compiler = new Compiler();
  return compiler.compile(ast);
}

function assert(condition, message)
{
  if (!condition)
  {
    throw new Error(message);
  }
}

function getUserProcesses(vm)
{
  return vm.processManager.getAll().filter((p) => !p.isMain && !p.isMouse);
}

function createRuntime(vm, width = 320, height = 200, clearColor = '#000000')
{
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const logs = [];
  const runtime = new CanvasEngineRuntime({
    vm,
    ctx,
    width,
    height,
    clearColor,
    logFn: (line) => logs.push(line)
  });
  runtime.registerNatives();
  runtime.testLogs = logs;
  return runtime;
}

// Compiles and loads a program, returning { vm, runtime, frame() } where
// frame() runs one tick, waits for any loads it started and renders.
function startProgram(source, width = 320, height = 200, clearColor = '#000000')
{
  const vm = new VM();
  vm.load(compileSource(source));
  const runtime = createRuntime(vm, width, height, clearColor);
  const frame = async (count = 1) =>
  {
    for (let i = 0; i < count; i++)
    {
      runtime.beginFrame(1 / 60);
      vm.tick();
      const pending = runtime.pendingLoads.splice(0, runtime.pendingLoads.length);
      if (pending.length > 0)
      {
        await Promise.allSettled(pending);
      }
      runtime.render();
    }
  };
  return { vm, runtime, frame };
}

function pixelAt(runtime, x, y)
{
  return [...runtime.ctx.getImageData(x, y, 1, 1).data];
}

// Bounding box of the pixels that differ from the background colour.
function inkBounds(runtime, background = [0, 0, 0])
{
  const { width, height } = runtime.ctx.canvas;
  const data = runtime.ctx.getImageData(0, 0, width, height).data;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let y = 0; y < height; y++)
  {
    for (let x = 0; x < width; x++)
    {
      const i = (y * width + x) * 4;
      if (data[i] !== background[0] || data[i + 1] !== background[1] || data[i + 2] !== background[2])
      {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }
  return { minX, minY, maxX, maxY };
}

function toDataUrl(bytes, mime = 'application/octet-stream')
{
  let binary = '';
  for (let i = 0; i < bytes.length; i++)
  {
    binary += String.fromCharCode(bytes[i]);
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

// palette: array of [r6, g6, b6] for the first entries (6-bit values).
function paletteBytes(palette)
{
  const out = new Uint8Array(768);
  palette.forEach(([r, g, b], i) =>
  {
    out[i * 3] = r;
    out[i * 3 + 1] = g;
    out[i * 3 + 2] = b;
  });
  return out;
}

// A minimal 8bpp FPG: header, palette, 576-byte gamma table, then one
// 64-byte header plus pixels per map.
function makeFpg(maps, palette = [[0, 0, 0], [63, 63, 63]])
{
  const parts = [];
  parts.push(new Uint8Array([0x66, 0x70, 0x67, 0x1a, 0x0d, 0x0a, 0x00, 0x00]));
  parts.push(paletteBytes(palette));
  parts.push(new Uint8Array(576));
  for (const map of maps)
  {
    const head = new Uint8Array(64);
    const view = new DataView(head.buffer);
    view.setInt32(0, map.code, true);
    view.setInt32(4, 64 + map.width * map.height, true);
    view.setInt32(52, map.width, true);
    view.setInt32(56, map.height, true);
    view.setInt32(60, 0, true);
    parts.push(head);
    parts.push(new Uint8Array(map.width * map.height).fill(map.index ?? 1));
  }
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const p of parts)
  {
    out.set(p, pos);
    pos += p.length;
  }
  return out;
}

// A minimal 8bpp MAP, with or without the gamma table after the palette.
function makeMap(width, height, cpoints, withGamma)
{
  const header = new Uint8Array(48);
  header.set([0x6d, 0x61, 0x70, 0x1a, 0x0d, 0x0a, 0x00, 0x00]);
  const hv = new DataView(header.buffer);
  hv.setUint16(8, width, true);
  hv.setUint16(10, height, true);
  hv.setInt32(12, 1000, true);
  const cp = new Uint8Array(2 + cpoints.length * 4);
  const cv = new DataView(cp.buffer);
  cv.setUint16(0, cpoints.length, true);
  cpoints.forEach(([x, y], i) =>
  {
    cv.setInt16(2 + i * 4, x, true);
    cv.setInt16(4 + i * 4, y, true);
  });
  const pixels = new Uint8Array(width * height).fill(1);
  const parts = [header, paletteBytes([[0, 0, 0], [63, 0, 0]])];
  if (withGamma)
  {
    parts.push(new Uint8Array(576).fill(7));
  }
  parts.push(cp, pixels);
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const p of parts)
  {
    out.set(p, pos);
    pos += p.length;
  }
  return out.buffer;
}

async function testNewGraphicIsDrawnAtItsRealSize()
{
  const source = `PROGRAM t;
GLOBAL g;
PROCESS p();
BEGIN
  graph = g; x = 160; y = 100;
  LOOP FRAME; END
END
BEGIN
  g = new_graphic(100, 50);
  gfx_fill(g, 0, 255, 0);
  p();
  LOOP FRAME; END
END`;
  const { vm, runtime, frame } = startProgram(source);
  await frame(2);
  const bounds = inkBounds(runtime);
  const w = bounds.maxX - bounds.minX + 1;
  const h = bounds.maxY - bounds.minY + 1;
  assert(w === 100 && h === 50, `new_graphic(100,50) devia desenhar 100x50, desenhou ${w}x${h}`);
  const proc = getUserProcesses(vm)[0];
  assert(proc.width === 100 && proc.height === 50, `width/height do processo deviam seguir o grafico (100x50), obtido ${proc.width}x${proc.height}`);
}

async function testLoadGraphicIsDrawnAtItsRealSize()
{
  const img = document.createElement('canvas');
  img.width = 60;
  img.height = 20;
  const ictx = img.getContext('2d');
  ictx.fillStyle = '#00ff00';
  ictx.fillRect(0, 0, 60, 20);
  const url = img.toDataURL('image/png');

  const source = `PROGRAM t;
GLOBAL g;
PROCESS p();
BEGIN
  graph = g; x = 160; y = 100;
  LOOP FRAME; END
END
BEGIN
  g = load_graphic("${url}");
  p();
  LOOP FRAME; END
END`;
  const { runtime, frame } = startProgram(source);
  await frame(1);
  // The image decodes asynchronously.
  for (let i = 0; i < 50 && !runtime.graphics.get(1000)?.loaded; i++)
  {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  await frame(2);
  const bounds = inkBounds(runtime);
  const w = bounds.maxX - bounds.minX + 1;
  const h = bounds.maxY - bounds.minY + 1;
  assert(w === 60 && h === 20, `load_graphic de 60x20 devia desenhar 60x20, desenhou ${w}x${h}`);
}

async function testLooseGraphicCodesDoNotCollideWithFpgCodes()
{
  const fpgUrl = toDataUrl(makeFpg([
    { code: 1, width: 4, height: 4 },
    { code: 2, width: 6, height: 6 }
  ]));
  const source = `PROGRAM t;
GLOBAL lib; g;
BEGIN
  lib = load_fpg("${fpgUrl}");
  g = new_graphic(9, 9);
  LOOP FRAME; END
END`;
  const { vm, runtime, frame } = startProgram(source);
  await frame(2);
  const g = vm.globals.get(1);
  assert(vm.globals.get(0) === 0, `primeira FPG devia ser o ficheiro 0, obtido ${vm.globals.get(0)}`);
  assert(g >= 1000, `new_graphic devia devolver um codigo >= 1000 (manual DIV: load_map comeca em 1000), obtido ${g}`);
  const asset = runtime.getGraphAsset(0, g);
  assert(asset && asset.image.width === 9, `ficheiro 0 / codigo ${g} devia ser o new_graphic de 9x9`);
  const fpgGraph = runtime.getGraphAsset(0, 2);
  assert(fpgGraph && fpgGraph.image.width === 6, 'ficheiro 0 / codigo 2 devia ser o grafico da FPG');
  assert(runtime.getGraphAsset(0, 3) === null, 'codigo inexistente na FPG nao devia devolver outro grafico');
  assert(runtime.getGraphAsset(5, g) === null, 'um grafico solto so pertence ao ficheiro 0');
}

async function testKeyReturnsOneOrZero()
{
  const source = `PROGRAM t;
GLOBAL r1; r2;
BEGIN
  LOOP
    r1 = key(_a) == 1;
    r2 = key(_b) == 0;
    FRAME;
  END
END`;
  const { vm, runtime, frame } = startProgram(source);
  runtime.setKeyState('a', true, 'KeyA');
  await frame(1);
  assert(runtime.keyNative('a') === 1, `key() devia devolver 1, obtido ${runtime.keyNative('a')}`);
  assert(runtime.keyNative('b') === 0, `key() devia devolver 0, obtido ${runtime.keyNative('b')}`);
  assert(runtime.keyDownNative('a') === 1 && runtime.keyPressedNative('a') === 1, 'key_down/key_pressed deviam devolver 1 no frame do toque');
  assert(vm.globals.get(0) === 1, `key(_a) == 1 devia ser verdadeiro, obtido ${vm.globals.get(0)}`);
  assert(vm.globals.get(1) === 1, `key(_b) == 0 devia ser verdadeiro, obtido ${vm.globals.get(1)}`);
}

async function testShiftBetweenPressAndReleaseDoesNotStickAKey()
{
  const vm = new VM();
  const runtime = createRuntime(vm);
  // What a browser sends: the release reports the shifted character.
  runtime.setKeyState('a', true, 'KeyA');
  runtime.setKeyState('Shift', true, 'ShiftLeft');
  runtime.setKeyState('A', false, 'KeyA');
  runtime.setKeyState('Shift', false, 'ShiftLeft');
  assert(runtime.keyNative('a') === 0, 'a tecla A ficou presa depois de soltar com Shift');

  runtime.setKeyState('1', true, 'Digit1');
  runtime.setKeyState('Shift', true, 'ShiftLeft');
  runtime.setKeyState('!', false, 'Digit1');
  assert(runtime.keyNative('1') === 0, 'a tecla 1 ficou presa depois de soltar com Shift');

  // Shift held first: the letter is still the physical key A.
  runtime.setKeyState('A', true, 'KeyA');
  assert(runtime.keyNative('a') === 1, 'Shift+A devia contar como key(_a)');
  assert(runtime.keyNative('shift') === 1 && runtime.keyNative('Shift') === 1, 'key(_shift) devia estar premida');
  runtime.setKeyState('a', false, 'KeyA');
  runtime.setKeyState('Shift', false, 'ShiftLeft');
  assert(runtime.keyNative('a') === 0 && runtime.keyNative('Shift') === 0, 'teclas deviam ficar soltas');

  // Hosts without a code (virtual keys) and the old aliases still work.
  runtime.setKeyState('ArrowLeft', true);
  assert(runtime.keyNative('left') === 1 && runtime.keyNative('ArrowLeft') === 1, 'alias left/ArrowLeft devia funcionar');
  runtime.setKeyState(' ', true, 'Space');
  assert(runtime.keyNative('space') === 1 && runtime.keyNative(' ') === 1, 'alias space devia funcionar');
}

async function testKeyLookupDoesNotScanEveryKnownKey()
{
  const vm = new VM();
  const runtime = createRuntime(vm);
  for (let i = 0; i < 5000; i++)
  {
    runtime.setKeyState(`k${i}`, false);
  }
  runtime.setKeyState('ArrowRight', true, 'ArrowRight');
  const started = performance.now();
  let hits = 0;
  for (let i = 0; i < 20000; i++)
  {
    hits += runtime.keyNative('right');
  }
  const elapsed = performance.now() - started;
  assert(hits === 20000, `key('right') devia ser 1 em todas as chamadas, somou ${hits}`);
  assert(elapsed < 100, `20000 chamadas a key() com 5000 teclas conhecidas demoraram ${elapsed.toFixed(1)} ms`);
}

async function testGetRealPointWritesIntoOffsetVariables()
{
  const source = `PROGRAM t;
GLOBAL g; px; py; r;
PROCESS p();
BEGIN
  graph = g; x = 100; y = 50;
  r = get_real_point(1, OFFSET px, OFFSET py) + 1;
  LOOP FRAME; END
END
BEGIN
  g = new_graphic(20, 10);
  set_point(0, g, 1, 20, 10);
  p();
  LOOP FRAME; END
END`;
  const { vm, frame } = startProgram(source);
  await frame(1);
  const px = vm.globals.get(1);
  const py = vm.globals.get(2);
  const r = vm.globals.get(3);
  assert(px === 110 && py === 55, `get_real_point devia escrever 110,55 nas variaveis, escreveu ${px},${py}`);
  assert(r === 1, `get_real_point devia devolver um numero (r = 0 + 1), obtido ${JSON.stringify(r)}`);
}

async function testOffsetOfLocalVariables()
{
  // OFFSET of a PRIVATE, a process field, a FUNCTION's own variable and a
  // PRIVATE shown by write_int. It only accepted GLOBALs, so DIV code such
  // as get_real_point(0, OFFSET my_x, OFFSET my_y) did not compile.
  const source = `PROGRAM t;
GLOBAL g; gx; gy; fx; seen_x;
FUNCTION fpoint(gr)
PRIVATE qx; qy;
BEGIN
  get_real_point(1, OFFSET qx, OFFSET qy);
  RETURN qx;
END
PROCESS p();
PRIVATE px; py; counter;
BEGIN
  graph = g; x = 100; y = 50;
  get_real_point(1, OFFSET px, OFFSET py);
  gx = px; gy = py;
  fx = fpoint(g);
  get_real_point(1, OFFSET x, OFFSET y);
  seen_x = x;
  write_int(0, 0, 0, 0, OFFSET counter);
  LOOP counter = counter + 1; FRAME; END
END
BEGIN
  g = new_graphic(20, 10);
  set_point(0, g, 1, 20, 10);
  p();
  LOOP FRAME; END
END`;
  const { vm, runtime, frame } = startProgram(source);
  await frame(3);
  const g = (i) => vm.globals.get(i);
  assert(g(1) === 110 && g(2) === 55, `OFFSET de PRIVATE: esperado 110,55; obtido ${g(1)},${g(2)}`);
  assert(g(3) === 110, `OFFSET de PRIVATE de FUNCTION: esperado 110, obtido ${g(3)}`);
  assert(g(4) === 110, `OFFSET x: o processo devia ver x=110 logo a seguir, obtido ${g(4)}`);
  const p = vm.processManager.getAll().find((proc) => proc.name === 'p');
  assert(p.x === 110 && p.y === 55, `OFFSET x/y devia atualizar o processo, obtido ${p.x},${p.y}`);
  const text = runtime.drawCommands.find((cmd) => cmd.type === 'text' && runtime.isOffsetRef(cmd.text));
  assert(!!text, 'write_int com OFFSET de PRIVATE devia criar um texto vivo');
  const before = runtime.resolveOffsetRef(text.text);
  await frame(2);
  const after = runtime.resolveOffsetRef(text.text);
  assert(after === before + 2, `write_int OFFSET counter devia acompanhar o valor: ${before} -> ${after}`);
  runtime.dispose();
}

async function testGetPointWritesIntoOffsetVariables()
{
  // get_point(file, graph, point, OFFSET x, OFFSET y) - the DIV form -
  // stores the point's original position in the graphic; the engine's
  // (file, graph, point, axis) form keeps returning one coordinate.
  const source = `PROGRAM t;
GLOBAL g; ax; ay; r; sx;
PROCESS p();
PRIVATE px; py;
BEGIN
  get_point(0, g, 1, OFFSET px, OFFSET py);
  ax = px; ay = py;
  LOOP FRAME; END
END
BEGIN
  g = new_graphic(20, 10);
  set_point(0, g, 1, 7, 3);
  r = get_point(0, g, 1, OFFSET ax, OFFSET ay);
  sx = get_point(0, g, 1, 0);
  p();
  LOOP FRAME; END
END`;
  const { vm, frame } = startProgram(source);
  await frame(2);
  const g = (i) => vm.globals.get(i);
  assert(g(1) === 7 && g(2) === 3, `get_point com OFFSET devia escrever 7,3; obtido ${g(1)},${g(2)}`);
  assert(g(3) === 0, `get_point com OFFSET devia devolver 0, obtido ${g(3)}`);
  assert(g(4) === 7, `get_point(file, graph, point, 0) devia continuar a devolver x=7, obtido ${g(4)}`);
}

async function testTintColoursOnlyOpaquePixels()
{
  const source = `PROGRAM t;
GLOBAL g;
PROCESS p();
BEGIN
  graph = g; x = 50; y = 50; red = 255; green = 0; blue = 0;
  LOOP FRAME; END
END
BEGIN
  g = new_graphic(40, 40);
  gfx_rect(g, 18, 18, 4, 4, 255, 255, 255);
  p();
  LOOP FRAME; END
END`;
  const { runtime, frame } = startProgram(source, 100, 100, '#ffffff');
  await frame(2);
  const centre = pixelAt(runtime, 50, 50);
  const hole = pixelAt(runtime, 35, 35);
  assert(centre[0] === 255 && centre[1] === 0 && centre[2] === 0, `pixel opaco devia ficar vermelho, obtido ${centre}`);
  assert(hole[0] === 255 && hole[1] === 255 && hole[2] === 255, `parte transparente do sprite devia manter o fundo branco, obtido ${hole}`);
}

async function testTintFollowsChangesToAProceduralGraphic()
{
  const vm = new VM();
  const runtime = createRuntime(vm, 20, 20, '#000000');
  const g = runtime.newGraphicNative(4, 4);
  runtime.gfxFillNative(g, 255, 255, 255);
  runtime.drawGraphSprite(0, g, 10, 10, 0, 100, 100, 0, undefined, undefined, { r: 0, g: 255, b: 0 });
  assert(pixelAt(runtime, 10, 10)[1] === 255, 'primeiro desenho devia ser verde');
  runtime.gfxFillRGBANative(g, 0, 0, 0, 0);
  runtime.ctx.clearRect(0, 0, 20, 20);
  runtime.drawGraphSprite(0, g, 10, 10, 0, 100, 100, 0, undefined, undefined, { r: 0, g: 255, b: 0 });
  assert(pixelAt(runtime, 10, 10)[3] === 0, 'depois de limpar o grafico a copia tingida devia ser refeita');
}

async function testWriteUsesTheNineCentringCodes()
{
  const vm = new VM();
  const runtime = createRuntime(vm);
  // "AB" in the 6x8 system font is 12x8.
  const expected = {
    0: [160, 100], 1: [154, 100], 2: [148, 100],
    3: [160, 96], 4: [154, 96], 5: [148, 96],
    6: [160, 92], 7: [154, 92], 8: [148, 92]
  };
  for (const [code, [left, top]] of Object.entries(expected))
  {
    runtime.ctx.fillStyle = '#000';
    runtime.ctx.fillRect(0, 0, 320, 200);
    runtime.drawSystemText(160, 100, Number(code), 'AB', '#ffffff');
    const b = inkBounds(runtime);
    assert(b.minX >= left && b.maxX < left + 12 && b.minY >= top && b.maxY < top + 8,
      `codigo ${code}: texto devia ficar em [${left},${top}]-[${left + 11},${top + 7}], ficou em [${b.minX},${b.minY}]-[${b.maxX},${b.maxY}]`);
  }
}

// The system font (drawn for DivJS): Latin-1 letters get their accents
// (they used to come out as unrelated symbols), the cedilla and the
// descenders reach the last row, characters beyond Latin-1 show "?", and
// control codes are blank.
async function testSystemFontAccentsAndFallback()
{
  const { font6x8Pixel, font6x8Code } = await import('../vm/font_6x8.js');
  const glyph = (ch) =>
  {
    let bits = '';
    for (let r = 0; r < 8; r++)
    {
      for (let c = 0; c < 6; c++)
      {
        bits += font6x8Pixel(ch.codePointAt(0), c, r) ? '#' : '.';
      }
    }
    return bits;
  };
  const rowHasInk = (ch, row) => glyph(ch).slice(row * 6, row * 6 + 6).includes('#');
  for (const [plain, marked] of [['a', 'ã'], ['e', 'é'], ['o', 'ô'], ['u', 'ü'], ['A', 'Á'], ['E', 'É'], ['n', 'ñ']])
  {
    assert(glyph(marked) !== glyph(plain) && (rowHasInk(marked, 0) || rowHasInk(marked, 1)),
      `${marked} devia ter acento por cima de ${plain}`);
  }
  assert(rowHasInk('ç', 7) && rowHasInk('Ç', 7) && !rowHasInk('c', 7), 'o cedilha fica na ultima linha');
  for (const ch of 'gjpqy')
  {
    assert(rowHasInk(ch, 7), `${ch} desce ate a ultima linha`);
  }
  for (const ch of 'AZaz09!?')
  {
    assert(glyph(ch).includes('#') && !rowHasInk(ch, 7), `${ch} desenha-se sem descer a ultima linha`);
  }
  assert(glyph(' ') === '.'.repeat(48) && glyph('\u0007') === '.'.repeat(48), 'espaco e codigos de controlo em branco');
  assert(font6x8Code(8364) === 63 && glyph('€') === glyph('?'), 'fora do Latin-1 aparece ?');
  assert(font6x8Code('é'.codePointAt(0)) === 233, 'as letras Latin-1 usam o seu proprio codigo');
  // Every printable ASCII character is drawn, and each one differently.
  const seen = new Map();
  for (let code = 33; code < 127; code++)
  {
    const g = glyph(String.fromCharCode(code));
    assert(g.includes('#'), `o caracter ${String.fromCharCode(code)} devia ter desenho`);
    assert(!seen.has(g), `${String.fromCharCode(code)} tem o mesmo desenho que ${seen.get(g)}`);
    seen.set(g, String.fromCharCode(code));
  }
}

async function testBitmapFontWriteUsesTheNineCentringCodes()
{
  const vm = new VM();
  const runtime = createRuntime(vm);
  const bdf = `STARTFONT 2.1
FONTBOUNDINGBOX 8 8 0 0
STARTCHAR A
ENCODING 65
DWIDTH 8 0
BBX 8 8 0 0
BITMAP
FF
FF
FF
FF
FF
FF
FF
FF
ENDCHAR
ENDFONT`;
  const font = runtime.loadBdfFontTextNative(bdf);
  runtime.setColorNative('#ffffff');
  runtime.writeNative(font, 160, 100, 4, 'AA');
  runtime.drawCommandsToCanvas();
  const b = inkBounds(runtime);
  assert(b.minX === 152 && b.maxX === 167 && b.minY === 96 && b.maxY === 103,
    `codigo 4 com fonte bitmap devia centrar 16x8 em 160,100, ficou em [${b.minX},${b.minY}]-[${b.maxX},${b.maxY}]`);
}

async function testXputStaysOnScreen()
{
  const source = `PROGRAM t;
GLOBAL g; gp;
BEGIN
  g = new_graphic(32, 32);
  gfx_fill(g, 0, 255, 0);
  xput(0, g, 100, 100, 0, 100, 0, 0);
  LOOP gp = get_pixel(100, 100); FRAME; END
END`;
  const { vm, runtime, frame } = startProgram(source);
  await frame(1);
  const first = pixelAt(runtime, 100, 100);
  await frame(3);
  const later = pixelAt(runtime, 100, 100);
  assert(first[1] === 255, `xput devia aparecer no primeiro frame, obtido ${first}`);
  assert(later[1] === 255, `xput devia continuar no ecra nos frames seguintes, obtido ${later}`);
  assert(vm.globals.get(1) !== 0, 'get_pixel devia ver o xput');
  const count = runtime.drawCommands.filter((c) => c.type === 'xput').length;
  assert(count === 0, `xput nao devia acumular comandos por frame, ${count} encontrados`);
}

async function testBdfTextIsNotDrawnPixelByPixel()
{
  const vm = new VM();
  const runtime = createRuntime(vm);
  const bdf = `STARTFONT 2.1
FONTBOUNDINGBOX 8 8 0 0
STARTCHAR A
ENCODING 65
DWIDTH 8 0
BBX 8 8 0 0
BITMAP
AA
55
AA
55
AA
55
AA
55
ENDCHAR
ENDFONT`;
  const font = runtime.loadBdfFontTextNative(bdf);
  runtime.writeNative(font, 10, 10, 0, 'AAAA');
  runtime.drawCommandsToCanvas();
  const before = pixelAt(runtime, 10, 10);
  let fills = 0;
  const original = runtime.ctx.fillRect.bind(runtime.ctx);
  runtime.ctx.fillRect = (...args) =>
  {
    fills += 1;
    return original(...args);
  };
  runtime.drawCommandsToCanvas();
  runtime.ctx.fillRect = original;
  assert(fills === 0, `texto BDF devia usar glifos em cache, fez ${fills} fillRect no ecra`);
  const after = pixelAt(runtime, 10, 10);
  assert(before[3] > 0 && after[3] > 0, 'glifo BDF devia continuar a ser desenhado');
}

async function testColliderCboxCodeZeroIsKept()
{
  const vm = new VM();
  const runtime = createRuntime(vm);
  vm.processManager.lastColliderCBox = 0;
  vm.processManager.lastCollidedCBox = 0;
  assert(runtime.getColliderCBoxNative() === 0, `collider_cbox devia devolver 0, obtido ${runtime.getColliderCBoxNative()}`);
  assert(runtime.getCollidedCBoxNative() === 0, `collided_cbox devia devolver 0, obtido ${runtime.getCollidedCBoxNative()}`);
  vm.processManager.lastColliderCBox = -1;
  assert(runtime.getColliderCBoxNative() === -1, 'sem cbox devia devolver -1');
}

async function testOutRegionOfAMissingProcessIsNotAboutTheCaller()
{
  const source = `PROGRAM t;
GLOBAL g; r;
PROCESS p();
BEGIN
  graph = g; x = -500; y = -500;
  LOOP r = out_region(99999, 0); FRAME; END
END
BEGIN
  g = new_graphic(10, 10);
  p();
  LOOP FRAME; END
END`;
  const { vm, frame } = startProgram(source);
  await frame(2);
  assert(vm.globals.get(1) === 0, `out_region(id inexistente) nao devia responder sobre o processo que chama, obtido ${vm.globals.get(1)}`);
}

async function testDefineRegionKeepsAnExplicitZeroSize()
{
  const vm = new VM();
  const runtime = createRuntime(vm);
  runtime.defineRegionNative(1, 10, 20, 0, 0);
  const rect = runtime.getRegionRect(1);
  assert(rect.width === 0 && rect.height === 0, `define_region com largura 0 devia ficar 0x0, ficou ${rect.width}x${rect.height}`);
}

async function testDeleteAllTextsKeepsTextDrawings()
{
  const vm = new VM();
  const runtime = createRuntime(vm);
  runtime.writeNative(0, 0, 0, 0, 'persistente');
  runtime.textNative(0, 20, 'deste frame');
  runtime.deleteTextNative(0);
  const kinds = runtime.drawCommands.map((c) => (c.persistent ? 'write' : c.type));
  assert(!kinds.includes('write'), 'delete_text(0) devia apagar os textos do write');
  assert(kinds.includes('text'), 'delete_text(0) nao devia apagar os text() deste frame');
}

async function testClearKeepsWriteTexts()
{
  const vm = new VM();
  const runtime = createRuntime(vm);
  runtime.writeNative(0, 0, 0, 0, 'persistente');
  runtime.circleNative(10, 10, 5);
  runtime.clearNative();
  const kinds = runtime.drawCommands.map((c) => (c.persistent ? 'write' : c.type));
  assert(kinds.includes('write'), 'clear() nao devia apagar os textos do write (ficam ate delete_text)');
  assert(!kinds.includes('circle'), 'clear() devia apagar os desenhos deste frame');
}

async function testSixBitPaletteMapsToFullRange()
{
  const fpg = parseDivFpgBuffer(makeFpg([{ code: 1, width: 1, height: 1 }], [[0, 0, 0], [63, 32, 1]]).buffer);
  const c = fpg.palette[1];
  assert(c.r === 255 && c.g === 130 && c.b === 4, `paleta 6 bits devia dar 255,130,4, deu ${c.r},${c.g},${c.b}`);
}

async function testMapWithGammaBlockLoads()
{
  for (const withGamma of [false, true])
  {
    const map = parseDivMapBuffer(makeMap(3, 2, [[1, 1], [2, 0]], withGamma));
    assert(map.width === 3 && map.height === 2, `MAP (gamma=${withGamma}) devia ter 3x2`);
    assert(map.cpoints.length === 2 && map.cpoints[1].x === 2, `MAP (gamma=${withGamma}) devia ler 2 pontos de controlo, leu ${map.cpoints.length}`);
    assert(map.raw.every((v) => v === 1), `MAP (gamma=${withGamma}) devia ler os pixels certos`);
  }
}

async function testTypoAliasesAreGone()
{
  const vm = new VM();
  createRuntime(vm);
  assert(!vm.natives.has('srt') && !vm.natives.has('set_colro'), 'aliases com erro de escrita (srt, set_colro) nao deviam existir');
  assert(vm.natives.has('sqrt') && vm.natives.has('set_color'), 'sqrt e set_color deviam existir');
}

async function testEveryNativeIsDocumented()
{
  const vm = new VM();
  createRuntime(vm);
  const response = await fetch(new URL('../docs/natives.md', import.meta.url));
  assert(response.ok, 'docs/natives.md devia existir');
  const doc = await response.text();
  const documented = new Set([...doc.matchAll(/^\|\s*`([a-z_0-9]+)`/gm)].map((m) => m[1]));
  const missing = [...vm.natives.keys()].filter((name) => !documented.has(name));
  const stale = [...documented].filter((name) => !vm.natives.has(name));
  assert(missing.length === 0, `nativos sem documentacao: ${missing.join(', ')}`);
  assert(stale.length === 0, `documentados mas nao registados: ${stale.join(', ')}`);
}

async function testKeyPressedIsOnlyTrueInTheFrameOfThePress()
{
  // Decision: key_pressed() (not a DIV function) is edge-triggered - 1
  // only in the frame after the key went down - while key() stays 1 for as
  // long as the key is held.
  const source = `PROGRAM kp;
GLOBAL presses = 0; held = 0;
BEGIN
  LOOP
    IF (key_pressed(_space)) presses = presses + 1; END
    IF (key(_space)) held = held + 1; END
    FRAME;
  END
END`;
  const { vm, runtime, frame } = startProgram(source);
  runtime.setKeyState(' ', true, 'Space');
  await frame(5);
  assert(vm.globals.get(0) === 1, `key_pressed devia contar 1 toque em 5 frames com a tecla carregada, obtido ${vm.globals.get(0)}`);
  assert(vm.globals.get(1) === 5, `key devia dar 1 nos 5 frames, obtido ${vm.globals.get(1)}`);
  runtime.setKeyState(' ', false, 'Space');
  await frame(1);
  // A tap shorter than a frame (down and up between two frames) still counts once.
  runtime.setKeyState(' ', true, 'Space');
  runtime.setKeyState(' ', false, 'Space');
  await frame(2);
  assert(vm.globals.get(0) === 2, `um toque curto entre frames devia contar, presses=${vm.globals.get(0)}`);
  runtime.dispose();
}

async function testExceptionInANativeHaltsTheVm()
{
  // Decision: an exception escaping a tick leaves the interrupted process
  // half-run, so the VM halts - later ticks do nothing - and the error
  // still reaches the host.
  const source = `PROGRAM boom;
GLOBAL n = 0;
BEGIN
  LOOP
    n = n + 1;
    IF (n == 2) explode(); END
    FRAME;
  END
END`;
  const { vm, runtime } = startProgram(source);
  vm.registerNative('explode', () =>
  {
    throw new Error('explode');
  });
  runtime.beginFrame(1 / 60);
  vm.tick();
  let caught = null;
  try
  {
    runtime.beginFrame(1 / 60);
    vm.tick();
  }
  catch (err)
  {
    caught = err;
  }
  assert(caught && caught.message === 'explode', 'o erro do nativo devia chegar ao host');
  assert(vm.halted === true, 'a VM devia ficar parada depois da excecao');
  runtime.beginFrame(1 / 60);
  vm.tick();
  assert(vm.globals.get(0) === 2, `ticks depois da excecao nao deviam correr nada, n=${vm.globals.get(0)}`);
  runtime.dispose();
}

async function testFntMissingGlyphsAdvanceByTheAverageWidth()
{
  // Decision: a character the FNT has no glyph for - the space, in every
  // shipped font - advances by the font's average glyph width. A fixed
  // 8px ran words together in the 30px-wide tutor1.fnt capitals.
  for (const name of ['help.fnt', 'tutor1.fnt', 'tutor6.fnt'])
  {
    const response = await fetch(`../assets/div-support/${name}`);
    const font = parseDivFntBuffer(await response.arrayBuffer());
    assert(!font.glyphs[32], `${name}: esperava-se uma fonte sem glifo de espaco`);
    const advances = font.glyphs.filter(Boolean).map((g) => g.xadvance || g.width).filter((w) => w > 0);
    const average = Math.round(advances.reduce((a, b) => a + b, 0) / advances.length);
    assert(font.fallbackAdvance === average,
      `${name}: avanco de glifo em falta esperado ${average} (media), obtido ${font.fallbackAdvance}`);
  }
}

async function testCnumberChoosesScrollWindows()
{
  // cnumber (a sum of c_0..c_9, 0 = every window) picks the scroll
  // windows a C_SCROLL process appears in (manual 12418-12452); every
  // process used to show in every active window. all_text is 0 for
  // delete_text (manual 13414-13420).
  const source = `PROGRAM t;
GLOBAL g;
PROCESS p(n);
BEGIN
  ctype = c_scroll; graph = g; cnumber = n;
  LOOP FRAME; END
END
BEGIN
  g = new_graphic(4, 4);
  define_region(1, 0, 0, 160, 200);
  define_region(2, 160, 0, 160, 200);
  start_scroll(0, 0, 0, 0, 1, 0);
  start_scroll(1, 0, 0, 0, 2, 0);
  p(0); p(c_0); p(c_1); p(c_0 + c_1);
  write(0, 0, 0, 0, 'a');
  write(0, 0, 10, 0, 'b');
  delete_text(all_text);
  LOOP FRAME; END
END`;
  const { vm, runtime, frame } = startProgram(source);
  await frame(1);
  const draws = new Map();
  const original = runtime.drawProcessAt.bind(runtime);
  runtime.drawProcessAt = (process, ox, oy) =>
  {
    draws.set(process.id, (draws.get(process.id) || 0) + 1);
    return original(process, ox, oy);
  };
  runtime.render();
  const ps = vm.processManager.getAll().filter((proc) => proc.name === 'p').sort((a, b) => a.id - b.id);
  const counts = ps.map((proc) => draws.get(proc.id) || 0).join(',');
  assert(counts === '2,1,1,2', `desenhos por janela (cnumber 0, c_0, c_1, c_0+c_1) esperados 2,1,1,2; obtido ${counts}`);
  assert(runtime.countPersistentTexts() === 0, `delete_text(all_text) devia apagar os textos, restam ${runtime.countPersistentTexts()}`);
  runtime.dispose();
}

async function testDefaultFpsIsDivsEighteenAndSetFpsIsClamped()
{
  // DIV runs at 18 fps unless set_fps says otherwise (manual 10584), and
  // set_fps accepts 4 to 200. The default used to be "uncapped": one tick
  // per display frame, so games ran faster on high refresh-rate monitors.
  const vm = new VM();
  vm.load(compileSource('PROGRAM t; BEGIN LOOP FRAME; END END'));
  const runtime = createRuntime(vm);
  assert(runtime.targetFps === 18, `fps por omissao esperado 18, obtido ${runtime.targetFps}`);
  runtime.setFpsNative(60);
  assert(runtime.targetFps === 60, `set_fps(60) devia dar 60, obtido ${runtime.targetFps}`);
  runtime.setFpsNative(1000);
  assert(runtime.targetFps === 200, `set_fps(1000) devia limitar a 200, obtido ${runtime.targetFps}`);
  runtime.setFpsNative(0);
  assert(runtime.targetFps === 4, `set_fps(0) devia limitar a 4, obtido ${runtime.targetFps}`);
  runtime.dispose();
}

async function testStringFunctions()
{
  // There was no way to measure a string or read its characters. DIV 2's
  // string functions return the new string here (strings are values).
  const source = `PROGRAM t;
GLOBAL s = "Hello, World"; r[20];
BEGIN
  r[0] = strlen(s); r[1] = char("A"); r[2] = asc(s, 1); r[3] = chr(66);
  r[4] = substr(s, 7); r[5] = substr(s, 0, 5); r[6] = substr(s, -5, 3);
  r[7] = upper(s); r[8] = lower(s); r[9] = strstr(s, "World"); r[10] = strstr(s, "x");
  r[11] = strchr(s, " ,"); r[12] = strcmp("a", "b"); r[13] = strcmp(s, s); r[14] = strcmp("b", "a");
  r[15] = strdel(s, 2, 3); r[16] = itoa(42) + "!"; r[17] = strlen(""); r[18] = asc(s, 99); r[19] = strdel("ab", 1, 1);
  LOOP FRAME; END
END`;
  const { vm, runtime, frame } = startProgram(source);
  await frame(1);
  const got = [];
  for (let i = 1; i <= 20; i++)
  {
    got.push(vm.globals.get(i));
  }
  const expected = [12, 65, 101, 'B', 'World', 'Hello', 'Wor', 'HELLO, WORLD', 'hello, world', 7, -1,
    5, -1, 0, 1, 'llo, Wo', '42!', 0, 0, ''];
  expected.forEach((value, i) =>
  {
    assert(got[i] === value, `r[${i}] esperado ${JSON.stringify(value)}, obtido ${JSON.stringify(got[i])}`);
  });
  runtime.dispose();
}

async function testDrawZPutsPrimitivesAmongProcesses()
{
  // circle/text/draw_rect were always painted over every process, so an
  // overlay could not go behind a sprite. draw_z(z) gives the following
  // ones a depth like a process's z; without it nothing changes.
  const source = `PROGRAM t;
GLOBAL g_blue;
PROCESS sprite(x, y, z) BEGIN graph = g_blue; LOOP FRAME; END END
BEGIN
  g_blue = new_graphic(20, 20); gfx_fill(g_blue, 0, 0, 255);
  sprite(30, 30, -100);
  sprite(80, 30, 0);
  sprite(130, 30, 10);
  sprite(180, 30, 0);
  LOOP
    draw_rect(20, 20, 20, 20, '#ff0000');
    draw_z(5);
    draw_rect(70, 20, 20, 20, '#ff0000');
    draw_rect(120, 20, 20, 20, '#ff0000');
    set_color('#00ff00'); circle(180, 30, 8);
    draw_z();
    draw_rect(180, 40, 4, 4, '#ffff00');
    FRAME;
  END
END`;
  const { runtime, frame } = startProgram(source);
  await frame(2);
  const at = (x, y) => pixelAt(runtime, x, y).slice(0, 3).join(',');
  assert(at(30, 30) === '255,0,0', `sem draw_z o rect fica por cima de tudo (z=-100), obtido ${at(30, 30)}`);
  assert(at(80, 30) === '0,0,255', `draw_z(5) fica atras de um processo de z 0, obtido ${at(80, 30)}`);
  assert(at(130, 30) === '255,0,0', `draw_z(5) fica a frente de um processo de z 10, obtido ${at(130, 30)}`);
  assert(at(180, 30) === '0,0,255', `circle com draw_z(5) atras do processo, obtido ${at(180, 30)}`);
  assert(at(181, 41) === '255,255,0', `draw_z() volta a por por cima, obtido ${at(181, 41)}`);
  runtime.dispose();
}

export const runtimeTests = [
  ['draw_z puts circle/text/draw_rect among the processes', testDrawZPutsPrimitivesAmongProcesses],
  ['string functions: strlen, char, asc, chr, substr, upper, lower, strstr, strchr, strcmp, strdel, itoa', testStringFunctions],
  ['new_graphic is drawn at its real size', testNewGraphicIsDrawnAtItsRealSize],
  ['load_graphic is drawn at its real size', testLoadGraphicIsDrawnAtItsRealSize],
  ['loose graphic codes do not collide with FPG codes', testLooseGraphicCodesDoNotCollideWithFpgCodes],
  ['key() returns 1/0', testKeyReturnsOneOrZero],
  ['Shift between press and release does not stick a key', testShiftBetweenPressAndReleaseDoesNotStickAKey],
  ['key() lookup does not scan every known key', testKeyLookupDoesNotScanEveryKnownKey],
  ['get_real_point writes into OFFSET variables', testGetRealPointWritesIntoOffsetVariables],
  ['OFFSET of PRIVATE, process fields and FUNCTION variables', testOffsetOfLocalVariables],
  ['get_point writes into OFFSET variables (DIV form)', testGetPointWritesIntoOffsetVariables],
  ['tint colours only opaque pixels', testTintColoursOnlyOpaquePixels],
  ['tint follows changes to a procedural graphic', testTintFollowsChangesToAProceduralGraphic],
  ['write uses the nine centring codes (system font)', testWriteUsesTheNineCentringCodes],
  ['write uses the nine centring codes (bitmap font)', testBitmapFontWriteUsesTheNineCentringCodes],
  ['system font: accents, cedilla, descenders, fallback', testSystemFontAccentsAndFallback],
  ['xput stays on screen', testXputStaysOnScreen],
  ['BDF text is not drawn pixel by pixel', testBdfTextIsNotDrawnPixelByPixel],
  ['collider_cbox keeps code 0', testColliderCboxCodeZeroIsKept],
  ['out_region of a missing process is not about the caller', testOutRegionOfAMissingProcessIsNotAboutTheCaller],
  ['define_region keeps an explicit zero size', testDefineRegionKeepsAnExplicitZeroSize],
  ['delete_text(0) keeps text() drawings', testDeleteAllTextsKeepsTextDrawings],
  ['clear() keeps WRITE texts', testClearKeepsWriteTexts],
  ['6-bit palette maps to the full 0-255 range', testSixBitPaletteMapsToFullRange],
  ['MAP with a gamma block loads', testMapWithGammaBlockLoads],
  ['typo aliases srt/set_colro are gone', testTypoAliasesAreGone],
  ['every registered native is documented', testEveryNativeIsDocumented],
  ['key_pressed is only 1 in the frame of the press', testKeyPressedIsOnlyTrueInTheFrameOfThePress],
  ['an exception in a native halts the VM', testExceptionInANativeHaltsTheVm],
  ['FNT missing glyphs advance by the average width (decision)', testFntMissingGlyphsAdvanceByTheAverageWidth],
  ['cnumber chooses scroll windows; all_text', testCnumberChoosesScrollWindows],
  ['default fps is DIV\'s 18 and set_fps is clamped to 4..200', testDefaultFpsIsDivsEighteenAndSetFpsIsClamped]
];
