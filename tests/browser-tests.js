import { Lexer } from '../compiler/tokenizer.js';
import { Parser } from '../parser/parser.js';
import { Compiler } from '../compiler/compiler.js';
import { OpCodes } from '../compiler/bytecode.js';
import { VM } from '../vm/vm.js';
import { CanvasEngineRuntime, CType } from '../vm/runtime.js';
import { disassemble } from '../compiler/disasm.js';
import { runDivDemo } from '../divjs.js';
import { DivError } from '../compiler/errors.js';
import { compilerTests } from './compiler-tests.js';
import { vmTests } from './vm-tests.js';
import { runtimeTests } from './runtime-tests.js';
import { encodeCode, decodeCode, hashState, NET_CONNECTED, NET_DESYNC } from '../vm/net.js';
import { synthesize, sfxRecipe, noteFrequency, parseNotes, SAMPLE_RATE } from '../vm/audio.js';

const tinyPngDataUrl =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7WvYQAAAAASUVORK5CYII=';

function compileSource(source) {
  const lexer = new Lexer(source);
  const tokens = lexer.tokenize();
  const parser = new Parser(tokens);
  const ast = parser.parse();
  const compiler = new Compiler();
  return compiler.compile(ast);
}

function parseSource(source) {
  const lexer = new Lexer(source);
  const tokens = lexer.tokenize();
  const parser = new Parser(tokens);
  const ast = parser.parse();
  return { tokens, ast };
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

// MAIN (id 1) and the engine-owned mouse process are always present in
// processManager - MAIN is created in the VM constructor itself, and the
// mouse is created by registerNatives(). Most of these tests only care
// about the process(es) the script under test actually spawned, so filter
// those two out rather than assuming index 0 / a raw count is the script's
// own process, the way earlier tests (written before MAIN/mouse became
// real processes) did.
function getUserProcesses(vm) {
  return vm.processManager.getAll().filter((p) => !p.isMain && !p.isMouse);
}

function approx(a, b, eps = 1e-6) {
  return Math.abs(a - b) <= eps;
}

function createRuntime(vm) {
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 200;
  const ctx = canvas.getContext('2d');

  const runtime = new CanvasEngineRuntime({
    vm,
    ctx,
    width: canvas.width,
    height: canvas.height,
    clearColor: '#000'
  });
  runtime.registerNatives();
  return runtime;
}

async function testCompileAndTickProcess() {
  const source = `program t;

process p(x, y);
begin
  x = x + 10;
  frame;
end

begin
  p(5, 7);
  frame;
end`;

  const bytecode = compileSource(source);
  assert(bytecode.instructions.length > 0, 'bytecode vazio');

  const vm = new VM();
  vm.load(bytecode);
  const runtime = createRuntime(vm);
  runtime.beginFrame(1 / 60);
  vm.tick();

  const procs = getUserProcesses(vm);
  assert(procs.length === 1, 'esperava 1 processo');
  const p = procs[0];
  assert(approx(p.x, 15), `x esperado 15, obtido ${p.x}`);
  assert(approx(p.y, 7), `y esperado 7, obtido ${p.y}`);
}

async function testLexerKeywordsOperatorsAndDelimiters() {
  const source = `program lexer_test;
global speed = 10;
begin
  if (speed >= 10 && speed != 11) speed = speed + 1; end
end`;

  const lexer = new Lexer(source);
  const tokens = lexer.tokenize();

  const types = new Set(tokens.map((t) => t.type));
  assert(types.has('PROGRAM'), 'lexer: faltou token PROGRAM');
  assert(types.has('GLOBAL'), 'lexer: faltou token GLOBAL');
  assert(types.has('IF'), 'lexer: faltou token IF');
  assert(types.has('GTE'), 'lexer: faltou token >=' );
  assert(types.has('AND'), 'lexer: faltou token &&');
  assert(types.has('NEQ'), 'lexer: faltou token !=');
  assert(types.has('SEMICOLON'), 'lexer: faltou token ;');
  assert(tokens[tokens.length - 1].type === 'EOF', 'lexer: ultimo token devia ser EOF');
}

async function testParserBuildsProgramAndProcessAst() {
  const source = `program parser_test;

global speed = 230;

process player(x, y);
private
  angle_step = 0;
begin
  frame(100);
end

begin
  player(10, 20);
  frame;
end`;

  const { ast } = parseSource(source);
  assert(ast.type === 'program', `parser: ast.type esperado program, obtido ${ast.type}`);
  assert(ast.name === 'parser_test', `parser: nome esperado parser_test, obtido ${ast.name}`);
  assert(ast.globals.length === 1, `parser: globals esperado 1, obtido ${ast.globals.length}`);
  assert(ast.processes.length === 1, `parser: processes esperado 1, obtido ${ast.processes.length}`);
  assert(ast.mainBlock.length === 2, `parser: mainBlock esperado 2 statements, obtido ${ast.mainBlock.length}`);

  const proc = ast.processes[0];
  assert(proc.params.length === 2, `parser: params esperado 2, obtido ${proc.params.length}`);
  assert(proc.privates.length === 1, `parser: privates esperado 1, obtido ${proc.privates.length}`);
}

async function testParserSupportsFrameValueAndPathSyntax() {
  const source = `program parser_paths;

process p();
private
  graph = 0;
begin
  graph = load_tile('a.png', 0, 0, 8, 8);
  scroll[0].camera = id;
  frame(42);
end

begin
  p();
  frame;
end`;

  const { ast } = parseSource(source);
  const proc = ast.processes[0];
  const procLoopStmt = proc.body.statements;
  const frameWithValue = procLoopStmt.find((s) => s.type === 'frame');
  assert(!!frameWithValue, 'parser: frame(42) nao encontrado');
  assert(!!frameWithValue.value, 'parser: frame(42) devia conter value');

  const assignPath = procLoopStmt.find(
    (s) => s.type === 'expression' &&
      s.expression?.type === 'assign' &&
      (s.expression.target?.type === 'member_access' || s.expression.target?.type === 'index_access')
  );
  assert(!!assignPath, 'parser: atribuicao com path nao encontrada');
}

async function testFrameValuePropagation() {
  const source = `program frame_test;

process p();
begin
  frame(42);
end

begin
  p();
  frame;
end`;

  const bytecode = compileSource(source);
  const vm = new VM();
  vm.load(bytecode);
  const runtime = createRuntime(vm);
  runtime.beginFrame(1 / 60);
  vm.tick();

  const p = getUserProcesses(vm)[0];
  assert(!!p, 'processo nao criado');
  assert(p.frameValue === 42, `frameValue esperado 42, obtido ${p.frameValue}`);
}

async function testFrameDefaultValue() {
  const source = `program frame_default;

process p();
begin
  frame;
end

begin
  p();
  frame;
end`;

  const bytecode = compileSource(source);
  const vm = new VM();
  vm.load(bytecode);
  const runtime = createRuntime(vm);
  runtime.beginFrame(1 / 60);
  vm.tick();

  const p = getUserProcesses(vm)[0];
  assert(!!p, 'processo nao criado');
  assert(p.frameValue === 100, `frame default esperado 100, obtido ${p.frameValue}`);
}

async function testBreakContinueLoweredAndBehavior() {
  const source = `program break_continue;

process p(x, y);
begin
  while (1)
    x = x + 1;
    if (x < 3) continue; end
    y = y + 1;
    if (x == 5) break; end
  end

  for i = 0 to 5 step 1
    if ((i % 2) == 0) continue; end
    y = y + i;
  end

  frame;
end

begin
  p(0, 0);
  frame;
end`;

  const bytecode = compileSource(source);

  // BREAK/CONTINUE must be lowered by compiler into jumps.
  const hasBreakOrContinueOpcodes = bytecode.instructions.some(
    (ins) => ins.opcode === OpCodes.BREAK || ins.opcode === OpCodes.CONTINUE
  );
  assert(!hasBreakOrContinueOpcodes, 'compiler devia resolver BREAK/CONTINUE para JUMP');

  const vm = new VM();
  vm.load(bytecode);
  const runtime = createRuntime(vm);
  runtime.beginFrame(1 / 60);
  vm.tick();

  const p = getUserProcesses(vm)[0];
  assert(!!p, 'processo nao criado');
  assert(p.x === 5, `x esperado 5 apos while break/continue, obtido ${p.x}`);
  assert(p.y === 12, `y esperado 12 (3 + 1 + 3 + 5), obtido ${p.y}`);
}

async function testBreakOutsideLoopCompileError() {
  const source = `program break_outside;

process p();
begin
  break;
  frame;
end

begin
  p();
  frame;
end`;

  let threw = false;
  try {
    compileSource(source);
  } catch (err) {
    threw = /BREAK used outside loop/i.test(String(err?.message || err));
  }

  assert(threw, 'compiler devia falhar quando BREAK aparece fora de loop');
}

async function testOutOfRegionAndScreen() {
  const vm = new VM();
  const runtime = createRuntime(vm);

  const process = {
    id: 1,
    name: 'mock',
    locals: [],
    x: 10,
    y: 10,
    width: 20,
    height: 20,
    angle: 0
  };
  process.locals[0] = 10;
  process.locals[1] = 10;
  process.locals[2] = 20;
  process.locals[3] = 20;

  vm.currentProcess = process;

  runtime.defineRegionNative(1, 0, 0, 100, 100);
  assert(runtime.outOfRegionNative(1) === 0, 'processo devia estar dentro da region');

  process.locals[0] = -1;
  assert(runtime.outOfRegionNative(1) === 1, 'processo devia estar fora da region');

  process.locals[0] = 10;
  process.locals[1] = 10;
  assert(runtime.outOfScreenNative() === 0, 'processo devia estar dentro do screen');

  process.locals[0] = 400;
  assert(runtime.outOfScreenNative() === 1, 'processo devia estar fora do screen');
}

async function testLoadGraphicAndTileDirectIds() {
  const vm = new VM();
  const runtime = createRuntime(vm);

  const g1 = runtime.loadGraphicNative(tinyPngDataUrl);
  const g2 = runtime.loadTileNative(tinyPngDataUrl, 0, 0, 1, 1);

  assert(Number.isInteger(g1) && g1 > 0, 'load_graphic devia devolver id valido');
  assert(Number.isInteger(g2) && g2 > 0, 'load_tile devia devolver id valido');

  const a1 = runtime.getGraphAsset(0, g1);
  const a2 = runtime.getGraphAsset(0, g2);

  assert(!!a1 && a1.id === g1, 'graphId devia mapear direto para asset id (load_graphic)');
  assert(!!a2 && a2.id === g2, 'graphId devia mapear direto para asset id (load_tile)');
}

async function testLoadAndDrawBdfBitmapFont() {
  const vm = new VM();
  const runtime = createRuntime(vm);

  const bdf = `STARTFONT 2.1
FONTBOUNDINGBOX 8 8 0 0
DWIDTH 8 0
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

  const fontId = runtime.loadBdfFontTextNative(bdf);
  assert(Number.isInteger(fontId) && fontId > 0, `load_bdf_font_text devia devolver id valido, obtido ${fontId}`);

  runtime.setColorNative('#ffffff');
  runtime.writeNative(fontId, 10, 10, 0, 'A');
  runtime.drawCommandsToCanvas();

  const pixel = runtime.ctx.getImageData(10, 10, 1, 1).data;
  assert(pixel[3] > 0, `texto bitmap BDF devia desenhar no canvas, alpha obtido ${pixel[3]}`);
}

async function testXAdvanceMovesByAngle() {
  const vm = new VM();
  const runtime = createRuntime(vm);

  const process = {
    id: 1,
    name: 'mock',
    locals: [],
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    angle: 0
  };
  process.locals[0] = 0;
  process.locals[1] = 0;
  process.locals[7] = 0;

  vm.currentProcess = process;

  runtime.xadvanceNative(10, 0);
  assert(approx(process.locals[0], 10), `x esperado 10 apos xadvance, obtido ${process.locals[0]}`);
  assert(approx(process.locals[1], 0), `y esperado 0 apos xadvance, obtido ${process.locals[1]}`);
}

async function testXAdvanceHandlesAnglesAboveHalfCircle() {
  // xadvanceNative() used to try auto-detecting argument order -
  // xadvance(distance, angle) vs xadvance(angle, distance) - by guessing
  // that whichever argument has magnitude > 180000 "must be" the
  // distance, since a DIV angle "shouldn't" exceed 180000 (180.000°).
  // That assumption is wrong: toRadiansFromDivAngle() never wraps or
  // clamps its input, and this project's own shipped demo increments an
  // angle unboundedly frame after frame, confirming angles routinely
  // span the full 0-360000 convention (a full turn), not just half of
  // it. Any legitimate angle between 180001 and 360000 (180°-360° - the
  // entire back half of a circle) used to get silently misclassified as
  // "must be the distance", producing a movement wildly wrong in both
  // magnitude and direction. Fixed to a plain fixed (distance, angle)
  // order, matching advanceNative() exactly, instead of guessing.
  const vm = new VM();
  const runtime = createRuntime(vm);

  const process = {
    id: 1,
    name: 'mock',
    locals: [],
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    angle: 0
  };
  process.locals[0] = 0;
  process.locals[1] = 0;
  process.locals[7] = 0;

  vm.currentProcess = process;

  // 270000 (270°) points straight down in DIV (manual 8.7) - under the
  // old heuristic, 270000 > 180000 would have been misclassified as the
  // distance, with 10 misread as the angle.
  runtime.xadvanceNative(10, 270000);
  assert(approx(process.locals[0], 0, 0.01), `x esperado ~0 apos xadvance(10, 270000), obtido ${process.locals[0]}`);
  assert(approx(process.locals[1], 10, 0.01), `y esperado 10 apos xadvance(10, 270000), obtido ${process.locals[1]}`);
}

async function testMathHelpersPingPongWrapAndLerpAngle() {
  const vm = new VM();
  const runtime = createRuntime(vm);

  const pp = runtime.pingPongNative(13, 10);
  assert(approx(pp, 7), `ping_pong(13,10) esperado 7, obtido ${pp}`);

  const ppNeg = runtime.pingPongNative(-3, 10);
  assert(approx(ppNeg, 3), `ping_pong(-3,10) esperado 3, obtido ${ppNeg}`);

  const w1 = runtime.wrapNative(365, 0, 360);
  assert(approx(w1, 5), `wrap(365,0,360) esperado 5, obtido ${w1}`);

  const w2 = runtime.wrapNative(-10, 0, 360);
  assert(approx(w2, 350), `wrap(-10,0,360) esperado 350, obtido ${w2}`);

  // Shortest turn from 350deg to 10deg should go through 0deg (+20deg arc),
  // so halfway is 0deg in DIV units (0 or 360000 equivalent).
  const a = runtime.lerpAngleNative(350000, 10000, 0.5);
  const normalized = runtime.wrapNative(a, 0, 360000);
  assert(approx(normalized, 0), `lerp_angle shortest path esperado ~0, obtido ${normalized}`);

  const c1 = runtime.clampNative(12, 0, 10);
  assert(approx(c1, 10), `clamp(12,0,10) esperado 10, obtido ${c1}`);

  const c2 = runtime.clampNative(-3, 0, 10);
  assert(approx(c2, 0), `clamp(-3,0,10) esperado 0, obtido ${c2}`);

  const l = runtime.lerpNative(10, 20, 0.25);
  assert(approx(l, 12.5), `lerp(10,20,0.25) esperado 12.5, obtido ${l}`);

  const sMid = runtime.smoothStepNative(0, 10, 5);
  assert(approx(sMid, 0.5), `smoothstep(0,10,5) esperado 0.5, obtido ${sMid}`);

  const sLow = runtime.smoothStepNative(0, 10, -2);
  assert(approx(sLow, 0), `smoothstep abaixo do min esperado 0, obtido ${sLow}`);

  const sHigh = runtime.smoothStepNative(0, 10, 20);
  assert(approx(sHigh, 1), `smoothstep acima do max esperado 1, obtido ${sHigh}`);
}

async function testMathGeometryHelperPack() {
  const vm = new VM();
  const runtime = createRuntime(vm);

  const n1 = runtime.normalizeAngleNative(370000);
  assert(approx(n1, 10000), `normalize_angle(370000) esperado 10000, obtido ${n1}`);

  const n2 = runtime.normalizeAngleNative(-1000);
  assert(approx(n2, 359000), `normalize_angle(-1000) esperado 359000, obtido ${n2}`);

  assert(runtime.signNative(-3) === -1, `sign(-3) esperado -1, obtido ${runtime.signNative(-3)}`);
  assert(runtime.signNative(0) === 0, `sign(0) esperado 0, obtido ${runtime.signNative(0)}`);
  assert(runtime.signNative(2) === 1, `sign(2) esperado 1, obtido ${runtime.signNative(2)}`);

  const d = runtime.distanceNative(0, 0, 3, 4);
  assert(approx(d, 5), `distance(0,0,3,4) esperado 5, obtido ${d}`);

  const drOutside = runtime.distanceRectNative(0, 0, 10, 10, 10, 10);
  assert(approx(drOutside, Math.hypot(10, 10)), `distance_rect fora esperado ${Math.hypot(10, 10)}, obtido ${drOutside}`);

  const drInside = runtime.distanceRectNative(15, 15, 10, 10, 10, 10);
  assert(approx(drInside, 0), `distance_rect dentro esperado 0, obtido ${drInside}`);

  // DIV angles: 90000 is up (manual 8.7), and screen y grows downwards.
  const fa = runtime.fgetAngleNative(0, 0, 0, -10);
  assert(approx(fa, 90000), `fget_angle para cima esperado 90000, obtido ${fa}`);
  const faDown = runtime.fgetAngleNative(0, 0, 0, 10);
  assert(approx(faDown, -90000), `fget_angle para baixo esperado -90000, obtido ${faDown}`);

  const fd = runtime.fgetDistanceNative(0, 0, 6, 8);
  assert(approx(fd, 10), `fget_distance esperado 10, obtido ${fd}`);

  const h = runtime.hermiteNative(0, 10, 0.5);
  assert(approx(h, 5), `hermite(0,10,0.5) esperado 5, obtido ${h}`);

  // Manual argument order is (angle, distance); 90000 points up.
  const gx = runtime.getDistXNative(0, 10);
  const gy = runtime.getDistYNative(90000, 10);
  assert(approx(gx, 10), `get_distx(0,10) esperado 10, obtido ${gx}`);
  assert(approx(gy, -10), `get_disty(90000,10) esperado -10, obtido ${gy}`);

  const rad = runtime.toRadNative(180000);
  assert(approx(rad, Math.PI), `torad(180000) esperado PI, obtido ${rad}`);

  const deg = runtime.toDegNative(Math.PI / 2);
  assert(approx(deg, 90000), `todeg(PI/2) esperado 90000, obtido ${deg}`);
}

async function testKeywordLogicalOperatorsCompileAndRun() {
  const source = `program logical_keywords;

process p(x, y);
begin
  if (1 and not 0) x = x + 1; end
  if (0 or 1) y = y + 2; end
  frame;
end

begin
  p(0, 0);
  frame;
end`;

  const bytecode = compileSource(source);
  const vm = new VM();
  vm.load(bytecode);
  const runtime = createRuntime(vm);
  runtime.beginFrame(1 / 60);
  vm.tick();

  const p = getUserProcesses(vm)[0];
  assert(!!p, 'processo nao criado');
  assert(p.x === 1, `x esperado 1 com and/not, obtido ${p.x}`);
  assert(p.y === 2, `y esperado 2 com or, obtido ${p.y}`);
}

async function testLogicalShortCircuitSkipsSideEffects() {
  const source = `program logical_short_circuit;

global hits = 0;

function bump();
begin
  hits = hits + 1;
  return 1;
end

process p();
begin
  if (0 and bump())
  end
  if (1 or bump())
  end
  frame;
end

begin
  p();
  frame;
end`;

  const bytecode = compileSource(source);
  const vm = new VM();
  vm.load(bytecode);
  const runtime = createRuntime(vm);
  runtime.beginFrame(1 / 60);
  vm.tick();

  const hits = vm.globals.get(0);
  assert(hits === 0, `short-circuit devia evitar bump(); hits esperado 0, obtido ${hits}`);
}

async function testLoadGlobalPreservesFalsyValues() {
  const vm = new VM();
  vm.load({
    constants: [false],
    instructions: [
      { opcode: OpCodes.LOAD_CONST, operands: [0] },
      { opcode: OpCodes.STORE_GLOBAL, operands: [0] },
      { opcode: OpCodes.LOAD_GLOBAL, operands: [0] },
      { opcode: OpCodes.HALT, operands: [] }
    ],
    processTable: new Map(),
    functionTable: new Map(),
    mainAddr: 0
  });

  vm.tick();
  assert(vm.mainStack.length > 0, 'stack principal devia ter valor carregado');
  assert(vm.mainStack[vm.mainStack.length - 1] === false, `LOAD_GLOBAL devia preservar false, obtido ${vm.mainStack[vm.mainStack.length - 1]}`);
}

async function testMutualRecursionAndForwardCallsResolveCorrectly() {
  // compileCall() decides CALL vs SPAWN_PROCESS vs CALL_NATIVE at compile
  // time by checking whether the callee name is *already* registered in
  // functionTable/processTable at the moment that call site is compiled.
  // Functions and processes were each compiled in a single top-to-bottom
  // pass with no pre-registration step, so a call to one declared later in
  // the same list silently fell through to CALL_NATIVE instead of
  // CALL/SPAWN_PROCESS - there is no declaration order that resolves both
  // directions of mutual recursion between two functions, so it was
  // unconditionally broken; any function calling a process (or vice
  // versa) declared later in the source hit the same failure.
  const mutualSource = `program mutual_recursion;

function isEven(n);
begin
  if (n == 0)
    return 1;
  end
  return isOdd(n - 1);
end

function isOdd(n);
begin
  if (n == 0)
    return 0;
  end
  return isEven(n - 1);
end

begin
  print(isEven(10));
  print(isOdd(10));
  frame;
end`;

  const mutualBytecode = compileSource(mutualSource);
  const mutualVm = new VM();
  mutualVm.load(mutualBytecode);
  const mutualSeen = [];
  mutualVm.registerNative('print', (v) => { mutualSeen.push(v); return 0; });
  mutualVm.tick();
  assert(JSON.stringify(mutualSeen) === JSON.stringify([1, 0]),
    `recursao mutua isEven(10)/isOdd(10) esperava [1,0], obtido ${JSON.stringify(mutualSeen)}`);

  // A function calling a process declared after it in the source is the
  // same failure mode across categories, not just within one.
  const crossCategorySource = `program forward_cross_category;

function spawner();
begin
  var id = helper(1, 2);
  return id;
end

process helper(x, y);
begin
  frame;
end

begin
  print(spawner());
  frame;
end`;

  const crossBytecode = compileSource(crossCategorySource);
  const crossVm = new VM();
  crossVm.load(crossBytecode);
  const crossSeen = [];
  crossVm.registerNative('print', (v) => { crossSeen.push(v); return 0; });
  crossVm.tick();
  assert(crossSeen.length === 1 && crossSeen[0] > 0,
    `funcao a chamar processo declarado depois devia devolver um id de processo > 0, obtido ${JSON.stringify(crossSeen)}`);
}

async function testMissingFunctionCallDoesNotLeakCallStack() {
  const vm = new VM();
  vm.load({
    constants: [],
    instructions: [
      { opcode: OpCodes.CALL, operands: ['missing_fn', 0] },
      { opcode: OpCodes.HALT, operands: [] }
    ],
    processTable: new Map(),
    functionTable: new Map(),
    mainAddr: 0
  });

  vm.tick();
  assert(vm.mainCallStack.length === 0, `CALL de funcao inexistente nao devia sujar callStack, size=${vm.mainCallStack.length}`);
  assert(vm.mainStack[vm.mainStack.length - 1] === 0, 'CALL de funcao inexistente devia empurrar 0');
}

async function testMissingSpawnProcessFailsGracefully() {
  const vm = new VM();
  vm.load({
    constants: [],
    instructions: [
      { opcode: OpCodes.SPAWN_PROCESS, operands: ['missing_process', 0] },
      { opcode: OpCodes.HALT, operands: [] }
    ],
    processTable: new Map(),
    functionTable: new Map(),
    mainAddr: 0
  });

  vm.tick();
  // 0: the program only SPAWNs (nothing, the process doesn't exist) and
  // then HALTs, and MAIN's own Process ends with it (P3.8) - so the
  // assertion is that the SPAWN added nothing that outlives MAIN.
  assert(vm.processManager.count() === 0, `SPAWN de processo inexistente nao devia criar processo, count=${vm.processManager.count()}`);
  assert(vm.mainStack[vm.mainStack.length - 1] === 0, 'SPAWN de processo inexistente devia empurrar 0');
}

async function testVoidNativeDoesNotUnderflowStack() {
  const source = `program void_native;

process p();
begin
  void_native();
  frame;
end

begin
  p();
  frame;
end`;

  const bytecode = compileSource(source);
  const vm = new VM();
  vm.load(bytecode);
  const runtime = createRuntime(vm);
  vm.registerNative('void_native', () => {});

  const warnings = [];
  const oldWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    runtime.beginFrame(1 / 60);
    vm.tick();
  } finally {
    console.warn = oldWarn;
  }

  const stackUnderflows = warnings.filter((w) => /Stack underflow/i.test(w));
  assert(stackUnderflows.length === 0, `nao devia haver underflow com native void, obtido ${stackUnderflows.length}`);
}

async function testNestedFunctionReturnsDoNotLeakStack() {
  const source = `program nested_return;

function one();
begin
  return 1;
end

function wrap();
begin
  return one();
end

process p(x, y);
begin
  x = wrap();
  y = wrap();
  frame;
end

begin
  p(0, 0);
  frame;
end`;

  const bytecode = compileSource(source);
  const vm = new VM();
  vm.load(bytecode);
  const runtime = createRuntime(vm);
  runtime.beginFrame(1 / 60);
  vm.tick();

  const p = getUserProcesses(vm)[0];
  assert(!!p, 'processo nao criado');
  assert(p.x === 1 && p.y === 1, `retornos aninhados esperados x=1,y=1; obtido x=${p.x}, y=${p.y}`);
  assert(p.stack.length === 0, `stack do processo devia ficar vazia, size=${p.stack.length}`);
}

async function testImplicitProcessLocalsGraphAndSize() {
  const source = `program graph_size_slots;

process p(x, y);
private
  vy = 0;
begin
  graph = 7;
  size = 200;
  frame;
end

begin
  p(10, 20);
  frame;
end`;

  const bytecode = compileSource(source);
  const vm = new VM();
  vm.load(bytecode);
  const runtime = createRuntime(vm);
  runtime.beginFrame(1 / 60);
  vm.tick();

  const p = getUserProcesses(vm)[0];
  assert(!!p, 'processo nao criado');

  const slotVy = runtime.getProcessLocalSlot(p, 'vy');
  const slotGraph = runtime.getProcessLocalSlot(p, 'graph');
  const slotSize = runtime.getProcessLocalSlot(p, 'size');

  assert(slotVy !== null, 'slot vy nao encontrado');
  assert(slotGraph !== null, 'slot graph nao encontrado');
  assert(slotSize !== null, 'slot size nao encontrado');
  assert(p.locals[slotGraph] === 7, `graph esperado 7, obtido ${p.locals[slotGraph]}`);
  assert(p.locals[slotSize] === 200, `size esperado 200, obtido ${p.locals[slotSize]}`);

  vm.currentProcess = p;
  assert(runtime.getCurrentGraphId() === 7, `getCurrentGraphId esperado 7, obtido ${runtime.getCurrentGraphId()}`);
}

async function testForLocalDoesNotCollideWithImplicitLocals() {
  const source = `program for_slot_collision;

process p(x, y);
begin
  for i = 0 to 3
  end
  graph = 111;
  size = 222;
  frame;
end

begin
  p(0, 0);
  frame;
end`;

  const bytecode = compileSource(source);
  const procMeta = bytecode.processTable.get('p');
  assert(!!procMeta, 'process meta p nao encontrado');
  assert(!!procMeta.locals, 'locals metadata do process p nao encontrado');

  const slotI = procMeta.locals.i;
  const slotGraph = procMeta.locals.graph;
  const slotSize = procMeta.locals.size;

  assert(Number.isInteger(slotI), 'slot i invalido');
  assert(Number.isInteger(slotGraph), 'slot graph invalido');
  assert(Number.isInteger(slotSize), 'slot size invalido');
  assert(slotI !== slotGraph, `slot i e graph colidiram: ${slotI}`);
  assert(slotI !== slotSize, `slot i e size colidiram: ${slotI}`);
  assert(slotGraph !== slotSize, `slot graph e size colidiram: ${slotGraph}`);

  const vm = new VM();
  vm.load(bytecode);
  const runtime = createRuntime(vm);
  runtime.beginFrame(1 / 60);
  vm.tick();

  const p = getUserProcesses(vm)[0];
  assert(!!p, 'processo nao criado');
  assert(p.locals[slotI] === 4, `i esperado 4 apos for, obtido ${p.locals[slotI]}`);
  assert(p.locals[slotGraph] === 111, `graph esperado 111, obtido ${p.locals[slotGraph]}`);
  assert(p.locals[slotSize] === 222, `size esperado 222, obtido ${p.locals[slotSize]}`);
}

async function testCanonicalColorAndTagFields() {
  // Five new canonical fixed slots, following the exact pattern already
  // established for ctype/region/angle: red/green/blue (0-255, the
  // conventional 8-bit RGB range), alpha (0-100, matching the scale
  // scroll[i].alpha already uses elsewhere in this runtime, kept
  // consistent rather than introducing a second incompatible alpha
  // convention), and tag (a free-form number for a game author's own
  // gameplay logic - distinct from `type`/process.type, which is
  // already the hash of the process's declared name, used by
  // collision()/signal(), and not meant for reassignment). Storage
  // only: nothing in the renderer applies these to a draw call
  // automatically - a process's own LOOP body still calls set_color()
  // itself, same as before these fields existed.
  const source = `program canonical_color_fields;

process p(x, y);
begin
  print(red);
  print(green);
  print(blue);
  print(alpha);
  print(tag);

  red = 10;
  green = 20;
  blue = 30;
  alpha = 50;
  tag = 99;

  print(red);
  print(green);
  print(blue);
  print(alpha);
  print(tag);

  frame;
end

begin
  p(1, 2);
  frame;
end`;

  const bytecode = compileSource(source);
  const vm = new VM();
  vm.load(bytecode);
  const seen = [];
  vm.registerNative('print', (v) => { seen.push(v); return 0; });
  vm.tick();

  assert(JSON.stringify(seen) === JSON.stringify([255, 255, 255, 100, 0, 10, 20, 30, 50, 99]),
    `esperava defaults [255,255,255,100,0] seguidos de valores escritos [10,20,30,50,99], obtido ${JSON.stringify(seen)}`);

  const process = getUserProcesses(vm)[0];
  assert(process.red === 10 && process.green === 20 && process.blue === 30 &&
    process.alpha === 50 && process.tag === 99,
    `campos deviam estar sincronizados no objeto Process, obtido red=${process.red} green=${process.green} blue=${process.blue} alpha=${process.alpha} tag=${process.tag}`);

  // A process param named "tag" (or red/green/blue/alpha) collides with
  // the fixed slot name the same way a param named "id" already does -
  // confirm the param wins (matches existing canonical-field-name-as-
  // param behavior, not a new special case).
  const paramSource = `program canonical_field_as_param;

process p(tag, x, y);
begin
  print(tag);
  frame;
end

begin
  p(777, 1, 2);
  frame;
end`;

  const paramBytecode = compileSource(paramSource);
  const paramVm = new VM();
  paramVm.load(paramBytecode);
  const paramSeen = [];
  paramVm.registerNative('print', (v) => { paramSeen.push(v); return 0; });
  paramVm.tick();
  assert(paramSeen[0] === 777,
    `parametro chamado "tag" devia sombrear o slot fixo, obtido ${JSON.stringify(paramSeen)}`);
}

async function testIfElseBothBranchesParseAndRun() {
  // parseBlock() used to consume END unconditionally even when it had
  // stopped on ELSE, so "IF (c) then... ELSE else... END" threw "Expected
  // END after block" at the ELSE token. IF without ELSE never hit this
  // (the next token really is END there), which is why it went unnoticed.
  const thenSource = `program if_else;

process p();
begin
  if (1)
    print(1);
  else
    print(2);
  end
  frame;
end

begin
  p();
  frame;
end`;

  const elseSource = thenSource.replace('if (1)', 'if (0)');

  for (const [source, expected] of [[thenSource, 1], [elseSource, 2]]) {
    const bytecode = compileSource(source);
    const vm = new VM();
    vm.load(bytecode);
    const seen = [];
    vm.registerNative('print', (v) => { seen.push(v); return 0; });
    vm.tick();
    assert(seen.length === 1 && seen[0] === expected,
      `IF/ELSE esperava imprimir ${expected}, obtido ${JSON.stringify(seen)}`);
  }

  // Chained ELSE IF and an IF nested inside an IF both close correctly.
  const chainedSource = `program if_else_chain;

process p();
begin
  if (0)
    print(1);
  else
    if (1)
      print(2);
    else
      print(3);
    end
  end
  frame;
end

begin
  p();
  frame;
end`;

  const chainedBytecode = compileSource(chainedSource);
  const chainedVm = new VM();
  chainedVm.load(chainedBytecode);
  const chainedSeen = [];
  chainedVm.registerNative('print', (v) => { chainedSeen.push(v); return 0; });
  chainedVm.tick();
  assert(chainedSeen.length === 1 && chainedSeen[0] === 2,
    `ELSE IF encadeado esperava imprimir 2, obtido ${JSON.stringify(chainedSeen)}`);
}

async function testForNegativeStepCountsDown() {
  // compileFor() always tested "i > end" to decide when to stop, regardless
  // of the step's sign. A descending FOR (STEP -1) hit that exit test on
  // its very first check and ran zero iterations instead of counting down.
  const source = `program for_negative_step;

process p();
begin
  for i = 5 to 0 step -1
    print(i);
  end
  frame;
end

begin
  p();
  frame;
end`;

  const bytecode = compileSource(source);
  const vm = new VM();
  vm.load(bytecode);
  const seen = [];
  vm.registerNative('print', (v) => { seen.push(v); return 0; });
  vm.tick();
  assert(JSON.stringify(seen) === JSON.stringify([5, 4, 3, 2, 1, 0]),
    `FOR descendente esperava [5,4,3,2,1,0], obtido ${JSON.stringify(seen)}`);
}

async function testChainedAssignmentCompilesAndEvaluatesToTheAssignedValue() {
  // compileExpression's 'assign' case (compiler.js) deliberately supports
  // assignment as a sub-expression - that is what makes classic DIV's
  // "extended conditions" idiom work, e.g.
  // "IF (apple_id = collision(TYPE apple))": assign, then test the
  // assigned value, in one expression. "x = y = 5" exercises the exact
  // same mechanism (the outer assignment's value is the inner
  // assignment's own compiled-as-expression result) and is valid DIV
  // syntax as a consequence, not a special case to reject - this used to
  // be asserted as a compile error, before that support existed.
  const source = `program chained_assign;

begin
  var x = 0;
  var y = 0;
  x = y = 5;
  print(x);
  print(y);
  frame;
end`;

  const bytecode = compileSource(source);
  const vm = new VM();
  vm.load(bytecode);
  const seen = [];
  vm.registerNative('print', (v) => { seen.push(v); return 0; });
  vm.tick();
  assert(seen.length === 2 && seen[0] === 5 && seen[1] === 5,
    `atribuicao encadeada (x = y = 5) devia dar x=5, y=5, obtido ${JSON.stringify(seen)}`);
}

async function testMainDoesNotInheritLastProcessLocalScope() {
  // compile() reset localMap to a fresh Map at the start of every function
  // and every process, but never reset it again before compiling the main
  // block. That left main compiling against whatever localMap the *last*
  // function or process (if any) had populated: any name used there as a
  // param/private/var would make compileIdentifier() resolve that same
  // name inside main via LOAD_LOCAL/STORE_LOCAL - reading/writing an index
  // in main's own locals array that main never touched - instead of
  // LOAD_GLOBAL/STORE_GLOBAL against the actual global of the same name.
  // Not a rare-name edge case: "x", "y", "id", "speed", "score" are
  // exactly the names likely to be both a GLOBAL and a process param.
  const processSource = `program main_scope_process;

global score = 100;

process p(score);
begin
  print(score);
  frame;
end

begin
  p(5);
  print(score);
  frame;
end`;

  const processBytecode = compileSource(processSource);
  const processVm = new VM();
  processVm.load(processBytecode);
  const processSeen = [];
  processVm.registerNative('print', (v) => { processSeen.push(v); return 0; });
  processVm.tick();
  // SPAWN_PROCESS runs a freshly spawned process's own body immediately,
  // up to its first FRAME, in the same tick as the spawn call (vm.js) -
  // so p's print(score) (its own param) runs *during* "p(5);", before
  // main's own next statement. p's value is seen first, main's second.
  assert(processSeen[0] === 5,
    `processo p devia ler o seu proprio parametro score (5), obtido ${JSON.stringify(processSeen)}`);
  assert(processSeen[1] === 100,
    `main devia ler o GLOBAL score (100) mesmo apos PROCESS p(score) ter sido compilado, obtido ${JSON.stringify(processSeen)}`);

  // Same failure mode when the last declared entity is a FUNCTION instead
  // of a PROCESS (a program with no processes at all).
  const functionSource = `program main_scope_function;

global speed = 42;

function f(speed);
begin
  return speed * 2;
end

begin
  print(f(9));
  print(speed);
  frame;
end`;

  const functionBytecode = compileSource(functionSource);
  const functionVm = new VM();
  functionVm.load(functionBytecode);
  const functionSeen = [];
  functionVm.registerNative('print', (v) => { functionSeen.push(v); return 0; });
  functionVm.tick();
  assert(JSON.stringify(functionSeen) === JSON.stringify([18, 42]),
    `esperava [18,42] (f(9) usa o parametro local, print(speed) le o GLOBAL), obtido ${JSON.stringify(functionSeen)}`);
}

async function testStringEscapeSequences() {
  // readString() only special-cased "\" followed by the *same* quote
  // character used to delimit the string (so a string could contain its
  // own delimiter), treating every other backslash as a plain literal
  // character. "line1\nline2" produced the four literal characters
  // '\', 'n' between "line1" and "line2" instead of an actual newline -
  // any script trying to embed a newline or tab in a string (e.g. for a
  // multi-line text() call) got silently wrong data with no error.
  const cases = [
    ['"a\\nb"', 'a\nb'],
    ['"a\\tb"', 'a\tb'],
    ['"a\\\\b"', 'a\\b'],
    ['"said \\"hi\\""', 'said "hi"'],
    ['"a\\qb"', 'a\\qb'], // unknown escape keeps the backslash literal
    ['"plain"', 'plain']
  ];

  for (const [literal, expected] of cases) {
    const source = `program string_escapes;\n\nbegin\n  print(${literal});\n  frame;\nend`;
    const bytecode = compileSource(source);
    const vm = new VM();
    vm.load(bytecode);
    const seen = [];
    vm.registerNative('print', (v) => { seen.push(v); return 0; });
    vm.tick();
    assert(seen[0] === expected,
      `string literal ${literal} esperava ${JSON.stringify(expected)}, obtido ${JSON.stringify(seen[0])}`);
  }
}

async function testDuplicateDeclarationsAreCompileErrors() {
  // A second "PROCESS p" (or FUNCTION, or GLOBAL) with the same name used
  // to silently overwrite the Map entry from the first - no error, no
  // indication which body actually runs. A copy-pasted process with an
  // un-updated name, or a FUNCTION and a PROCESS accidentally sharing a
  // name (compileCall() checks processTable before functionTable, so the
  // process would silently win and the function become unreachable), both
  // need to be compile errors instead.
  const cases = [
    ['duplicate PROCESS', `program dup_process;\n\nprocess p(x, y);\nbegin\n  frame;\nend\n\nprocess p(x, y);\nbegin\n  frame;\nend\n\nbegin\n  frame;\nend`],
    ['duplicate FUNCTION', `program dup_function;\n\nfunction f();\nbegin\n  return 1;\nend\n\nfunction f();\nbegin\n  return 2;\nend\n\nbegin\n  frame;\nend`],
    ['duplicate GLOBAL', `program dup_global;\n\nglobal x = 1;\nglobal x = 2;\n\nbegin\n  frame;\nend`],
    ['FUNCTION and PROCESS sharing a name', `program cross_category;\n\nfunction p();\nbegin\n  return 1;\nend\n\nprocess p(x, y);\nbegin\n  frame;\nend\n\nbegin\n  frame;\nend`]
  ];

  for (const [label, source] of cases) {
    let threw = false;
    try {
      compileSource(source);
    } catch (error) {
      threw = true;
    }
    assert(threw, `${label} devia falhar a compilar, nao compilou`);
  }
}

async function testGlobalBlockFormDeclaresMultipleNames() {
  // A bare GLOBAL keyword followed by several name declarations (the
  // classic DIV/Fenix block style) now works, in addition to the
  // original one-GLOBAL-per-name form:
  //   global
  //     score;
  //     lives;
  //     high_score = 100;
  // parseGlobal() reads one declaration and keeps going as long as the
  // next token is still identifier-like - isIdentifierLike() already
  // excludes GLOBAL/PROCESS/FUNCTION/BEGIN, so the block naturally ends
  // at the next section with no special-case "end of block" detection
  // needed. A single declaration is just this same loop running once,
  // so the original form is unaffected.
  const source = `program global_block;

global
  score;
  lives;
  high_score = 100;

begin
  print(score);
  print(lives);
  print(high_score);
  frame;
end`;

  const bytecode = compileSource(source);
  const vm = new VM();
  vm.load(bytecode);
  const seen = [];
  vm.registerNative('print', (v) => { seen.push(v); return 0; });
  vm.tick();
  assert(JSON.stringify(seen) === JSON.stringify([0, 0, 100]),
    `esperava [0,0,100] (score/lives sem valor devem ser 0, nao o valor de outro global), obtido ${JSON.stringify(seen)}`);

  // A GLOBAL block must still end correctly at the next PROCESS/
  // FUNCTION/BEGIN, and duplicate names across separate GLOBAL blocks
  // (or within the same one) must still be rejected.
  const stopsAtProcessSource = `program global_block_boundary;

global
  a = 1;
  b = 2;

process p();
begin
  frame;
end

begin
  print(a);
  print(b);
  frame;
end`;

  const stopsAtProcessBytecode = compileSource(stopsAtProcessSource);
  const stopsAtProcessVm = new VM();
  stopsAtProcessVm.load(stopsAtProcessBytecode);
  const stopsAtProcessSeen = [];
  stopsAtProcessVm.registerNative('print', (v) => { stopsAtProcessSeen.push(v); return 0; });
  stopsAtProcessVm.tick();
  assert(JSON.stringify(stopsAtProcessSeen) === JSON.stringify([1, 2]),
    `bloco GLOBAL antes de um PROCESS devia terminar corretamente, obtido ${JSON.stringify(stopsAtProcessSeen)}`);

  let threwOnDuplicate = false;
  try {
    compileSource(`program global_block_duplicate;

global
  a = 1;
  a = 2;

begin
  frame;
end`);
  } catch (error) {
    threwOnDuplicate = true;
  }
  assert(threwOnDuplicate, 'nome duplicado dentro do mesmo bloco GLOBAL devia falhar a compilar');
}

async function testGlobalWithoutInitialValueDefaultsToZeroNotAnotherGlobalsConstant() {
  // compileGlobal()'s no-explicit-value branch used to emit
  // "LOAD_CONST 0" with the literal number 0 as the operand - but
  // LOAD_CONST's operand is a constant *pool index*, not a value; every
  // other call site in the compiler correctly goes through
  // addConstant(value) first. This one bypassed it and just assumed
  // index 0 would always hold the value 0, which was never guaranteed
  // and became actively wrong once addConstant() started deduplicating
  // (99c8d13-era) - constant pool index 0 is whatever value happens to
  // be the first one compiled anywhere in the whole program, not
  // necessarily 0. Confirmed this predates and is unrelated to today's
  // GLOBAL-block work: reproduces with the original one-GLOBAL-per-line
  // syntax too. "global score; global other = 100;" (score declared
  // with no value, before another global that has one) used to make
  // score read back as 100 instead of 0.
  const source = `program global_default_value;

global score;
global other = 100;

begin
  print(score);
  print(other);
  frame;
end`;

  const bytecode = compileSource(source);
  const vm = new VM();
  vm.load(bytecode);
  const seen = [];
  vm.registerNative('print', (v) => { seen.push(v); return 0; });
  vm.tick();
  assert(JSON.stringify(seen) === JSON.stringify([0, 100]),
    `esperava [0,100], obtido ${JSON.stringify(seen)} (0 e o valor exato que o bug antigo teria trocado por 100)`);
}

async function testFrameValueThrottlesExecutionFrequency() {
  // frame(n) stored the value on the process (this.currentProcess.
  // frameValue = ...) but nothing ever read it back afterwards - the
  // syntax existed and compiled, but had zero runtime effect. Every
  // process ran on every single tick no matter what it passed to frame(),
  // silently. Verify the fix actually throttles: frame(default/100) still
  // runs every tick (no behavior change for the overwhelmingly common
  // case that never calls frame(n) with an argument), while frame(50)
  // measurably runs less often than every tick over a run long enough to
  // smooth out the first-tick startup credit.
  const alwaysSource = `program frame_default;

process p();
begin
  loop
    print(1);
    frame;
  end
end

begin
  p();
  frame;
end`;

  const alwaysBytecode = compileSource(alwaysSource);
  const alwaysVm = new VM();
  alwaysVm.load(alwaysBytecode);
  let alwaysCount = 0;
  alwaysVm.registerNative('print', () => { alwaysCount += 1; return 0; });
  for (let i = 0; i < 10; i += 1) {
    alwaysVm.tick();
  }
  assert(alwaysCount === 10,
    `frame() por omissao devia correr em todos os 10 ticks, correu em ${alwaysCount}`);

  // FRAME(n) for n < 100 asks to run *more* than once per real frame -
  // this scheduler only ever runs a process once per tick (see tick()'s
  // loop in vm.js), so that request is clamped at "run every tick"
  // rather than granting extra runs it has no way to honor; frameDebt is
  // clamped at 0 for exactly this reason (vm.js's FRAME handler). Only
  // n > 100 (asking to run *less* often) is representable as skipped
  // frames.
  const fastSource = `program frame_fast;

process p();
begin
  loop
    print(1);
    frame(50);
  end
end

begin
  p();
  frame;
end`;

  const fastBytecode = compileSource(fastSource);
  const fastVm = new VM();
  fastVm.load(fastBytecode);
  let fastCount = 0;
  fastVm.registerNative('print', () => { fastCount += 1; return 0; });
  for (let i = 0; i < 10; i += 1) {
    fastVm.tick();
  }
  assert(fastCount === 10,
    `frame(50) (< 100, sem forma de correr mais que 1x/tick) devia correr em todos os 10 ticks, correu em ${fastCount}`);

  // FRAME(200) accrues 100 of debt each run, so it runs, then skips one,
  // then runs again - every other tick.
  const throttledSource = `program frame_throttled;

process p();
begin
  loop
    print(1);
    frame(200);
  end
end

begin
  p();
  frame;
end`;

  const throttledBytecode = compileSource(throttledSource);
  const throttledVm = new VM();
  throttledVm.load(throttledBytecode);
  let throttledCount = 0;
  throttledVm.registerNative('print', () => { throttledCount += 1; return 0; });
  for (let i = 0; i < 40; i += 1) {
    throttledVm.tick();
  }
  // Steady-state is exactly every other tick; over 40 ticks (plus one
  // extra run from the initial full-credit seed) that's 20 or 21, well
  // short of 40 and well above a token handful - a generous band that's
  // still tight enough to catch "frame(n) still does nothing" (which
  // would give 40) or "frame(n) stops the process" (which would give 0).
  assert(throttledCount >= 15 && throttledCount <= 25,
    `frame(200) ao longo de 40 ticks esperava entre 15 e 25 execucoes, obtido ${throttledCount}`);
}

async function testSwitchCaseHasNoFallthrough() {
  // SWITCH is designed with no C-style fallthrough: each CASE runs its
  // own statements and control jumps straight to the end of the SWITCH,
  // so BREAK is never required to keep cases separate. Verify a matching
  // case runs only its own body (not the ones after it), a non-matching
  // subject with no DEFAULT runs nothing, and DEFAULT only runs when no
  // CASE matched.
  const noFallthroughSource = `program switch_no_fallthrough;

begin
  var x = 1;
  switch (x)
    case 1
      print(1);
    case 2
      print(2);
    case 3
      print(3);
  end
  frame;
end`;

  const noFallthroughBytecode = compileSource(noFallthroughSource);
  const noFallthroughVm = new VM();
  noFallthroughVm.load(noFallthroughBytecode);
  const noFallthroughSeen = [];
  noFallthroughVm.registerNative('print', (v) => { noFallthroughSeen.push(v); return 0; });
  noFallthroughVm.tick();
  assert(JSON.stringify(noFallthroughSeen) === JSON.stringify([1]),
    `case 1 devia correr sozinho sem cair para os seguintes, obtido ${JSON.stringify(noFallthroughSeen)}`);

  const noMatchSource = `program switch_no_match;

begin
  var x = 99;
  switch (x)
    case 1
      print(1);
    case 2
      print(2);
  end
  print(999);
  frame;
end`;

  const noMatchBytecode = compileSource(noMatchSource);
  const noMatchVm = new VM();
  noMatchVm.load(noMatchBytecode);
  const noMatchSeen = [];
  noMatchVm.registerNative('print', (v) => { noMatchSeen.push(v); return 0; });
  noMatchVm.tick();
  assert(JSON.stringify(noMatchSeen) === JSON.stringify([999]),
    `sem CASE correspondente e sem DEFAULT nada dentro do switch devia correr, obtido ${JSON.stringify(noMatchSeen)}`);

  const defaultSource = `program switch_default;

begin
  var x = 99;
  switch (x)
    case 1
      print(1);
    default
      print(777);
  end
  frame;
end`;

  const defaultBytecode = compileSource(defaultSource);
  const defaultVm = new VM();
  defaultVm.load(defaultBytecode);
  const defaultSeen = [];
  defaultVm.registerNative('print', (v) => { defaultSeen.push(v); return 0; });
  defaultVm.tick();
  assert(JSON.stringify(defaultSeen) === JSON.stringify([777]),
    `DEFAULT devia correr quando nenhum CASE bate, obtido ${JSON.stringify(defaultSeen)}`);
}

async function testSwitchSubjectEvaluatedOnceAndBreakPassesThroughToLoop() {
  // Two things worth locking down together: the subject expression is
  // evaluated exactly once (stored in a hidden local) even though it's
  // compared against every CASE value, and BREAK/CONTINUE inside a CASE
  // body are transparent to SWITCH - they refer to whatever loop the
  // SWITCH itself is nested in, since SWITCH doesn't open its own loop
  // context (matching how IF already behaves).
  const subjectSource = `program switch_subject_once;

function mark(tag);
begin
  print(tag);
  return tag;
end

begin
  switch (mark(1))
    case 1
      print(100);
    case 2
      print(200);
  end
  frame;
end`;

  const subjectBytecode = compileSource(subjectSource);
  const subjectVm = new VM();
  subjectVm.load(subjectBytecode);
  const subjectSeen = [];
  subjectVm.registerNative('print', (v) => { subjectSeen.push(v); return 0; });
  subjectVm.tick();
  assert(JSON.stringify(subjectSeen) === JSON.stringify([1, 100]),
    `mark(1) so devia imprimir uma vez (subject avaliado 1x), obtido ${JSON.stringify(subjectSeen)}`);

  const breakSource = `program switch_break_passthrough;

begin
  for i = 0 to 5
    switch (i)
      case 2
        break;
      default
        print(i);
    end
  end
  print(999);
  frame;
end`;

  const breakBytecode = compileSource(breakSource);
  const breakVm = new VM();
  breakVm.load(breakBytecode);
  const breakSeen = [];
  breakVm.registerNative('print', (v) => { breakSeen.push(v); return 0; });
  breakVm.tick();
  assert(JSON.stringify(breakSeen) === JSON.stringify([0, 1, 999]),
    `BREAK dentro de um CASE devia quebrar o FOR envolvente (nao so o switch), obtido ${JSON.stringify(breakSeen)}`);
}

async function testSwitchCaseWithMultipleValues() {
  // A CASE can list several comma-separated values sharing one body
  // ("CASE 1, 2, 3"), matching if the subject equals *any* of them.
  // Verify a match at each position in the list (first/middle/last),
  // falling through to the next CASE when none match, and that testing
  // stops as soon as one value matches - a later value in the same list
  // must not be evaluated at all once an earlier one already hit.
  const positions = [
    [1, 100], // matches the first value in the list
    [2, 100], // matches a middle value
    [3, 100], // matches the last value
    [4, 400]  // matches nothing in the first CASE, falls through
  ];

  for (const [subjectValue, expected] of positions) {
    const source = `program switch_multi_value;

begin
  var x = ${subjectValue};
  switch (x)
    case 1, 2, 3
      print(100);
    case 4
      print(400);
  end
  frame;
end`;

    const bytecode = compileSource(source);
    const vm = new VM();
    vm.load(bytecode);
    const seen = [];
    vm.registerNative('print', (v) => { seen.push(v); return 0; });
    vm.tick();
    assert(JSON.stringify(seen) === JSON.stringify([expected]),
      `x=${subjectValue}: esperava imprimir ${expected}, obtido ${JSON.stringify(seen)}`);
  }

  // Short-circuit: once an earlier value in the list matches, later
  // values in the *same* CASE must never be evaluated.
  const shortCircuitSource = `program switch_multi_value_short_circuit;

function mark(tag);
begin
  print(tag);
  return tag;
end

begin
  switch (2)
    case mark(1), mark(2), mark(3)
      print(100);
  end
  frame;
end`;

  const shortCircuitBytecode = compileSource(shortCircuitSource);
  const shortCircuitVm = new VM();
  shortCircuitVm.load(shortCircuitBytecode);
  const shortCircuitSeen = [];
  shortCircuitVm.registerNative('print', (v) => { shortCircuitSeen.push(v); return 0; });
  shortCircuitVm.tick();
  assert(JSON.stringify(shortCircuitSeen) === JSON.stringify([1, 2, 100]),
    `mark(3) nao devia ser chamado (o subject ja bateu em mark(2)), obtido ${JSON.stringify(shortCircuitSeen)}`);
}

async function testSwitchWithZeroCasesIsCompileError() {
  // A SWITCH with no CASE at all is almost certainly a mistake (an empty
  // shell that can never do anything, DEFAULT included - DEFAULT without
  // at least one CASE to fall back from isn't a meaningful construct
  // either), so the parser rejects it rather than silently compiling to
  // a no-op.
  const source = `program switch_empty;

begin
  switch (1)
  end
  frame;
end`;

  let threw = false;
  try {
    compileSource(source);
  } catch (error) {
    threw = true;
  }
  assert(threw, 'SWITCH sem nenhum CASE devia falhar a compilar, nao compilou');
}

async function testCompileErrorsIncludeSourceLocation() {
  // None of the compiler's own errors (as opposed to the parser's syntax
  // errors, which always had this) carried a source location before -
  // "BREAK used outside loop" or "Unknown variable: x" gave no indication
  // of *where*, forcing a manual search through the whole file. The
  // parser now stamps every statement and expression node with .line/
  // .col (parseStatement/parsePrimary/parsePostfix/parseAssignment), and
  // the compiler appends "at L:C" via a shared locSuffix() helper. Spot-
  // check a representative handful rather than all fourteen call sites:
  // one per AST shape the parser stamps (statement, expression, and the
  // three different top-level declaration kinds).
  const cases = [
    {
      label: 'BREAK outside loop (statement location)',
      // line 4: "  break;"
      source: `program loc_break;\n\nbegin\n  break;\n  frame;\nend`,
      expectedLine: 4
    },
    {
      label: 'unknown variable (expression location)',
      // line 4: "  print(does_not_exist);"
      source: `program loc_unknown_var;\n\nbegin\n  print(does_not_exist);\n  frame;\nend`,
      expectedLine: 4
    },
    {
      label: 'duplicate PROCESS (declaration location)',
      // line 8: the second "process p(x, y);"
      source: `program loc_dup_process;\n\nprocess p(x, y);\nbegin\n  frame;\nend\n\nprocess p(x, y);\nbegin\n  frame;\nend\n\nbegin\n  frame;\nend`,
      expectedLine: 8
    }
  ];

  for (const { label, source, expectedLine } of cases) {
    let message = null;
    try {
      compileSource(source);
    } catch (error) {
      message = error.message;
    }
    assert(message !== null, `${label}: devia ter falhado a compilar`);
    assert(new RegExp(`at ${expectedLine}:\\d+$`).test(message),
      `${label}: mensagem devia terminar em "at ${expectedLine}:N", obtido ${JSON.stringify(message)}`);
  }
}

async function testConstantPoolIsDeduplicated() {
  // addConstant() used to push every literal unconditionally, even a
  // value identical to one already in the pool - a repeated 0, a
  // repeated color string, whatever. Measured 38% waste on the repo's
  // own shipped demo (index.html) before the fix. Verify a handful of
  // repeated literals collapse to a single slot each, reused by every
  // LOAD_CONST that needs that value.
  const source = `program dedup;

begin
  var a = 0;
  var b = 0;
  var c = 0;
  print(0);
  print(0);
  print("x");
  print("x");
  print("x");
  frame;
end`;

  const bytecode = compileSource(source);
  assert(bytecode.constants.length === 2,
    `esperava 2 constantes unicas (0 e "x"), obtido ${bytecode.constants.length}: ${JSON.stringify(bytecode.constants)}`);
}

async function testForWithConstantStepUsesShortExitTest() {
  // compileFor()'s general exit test - needed when the step is a genuine
  // runtime expression - compiles "(step >= 0 AND i <= end) OR (step < 0
  // AND i >= end)" into roughly 30 instructions, re-evaluated on every
  // single iteration. When the step is a literal ("STEP 2", "STEP -1", or
  // the implicit default of 1), its sign is already known at compile
  // time, so the exit test collapses to one LTE or GTE comparison
  // instead. This covers "STEP -N" too, which the parser represents as
  // Unary('-', Number(N)) rather than a bare Number literal (the lexer
  // never reads a sign into a NUMBER token) - getConstantNumericValue()
  // has to see through that one level of unary minus, not just match
  // expr.type === 'number' directly.
  const ascendingSource = `program for_const_step;

process p();
begin
  for i = 0 to 6 step 3
    print(i);
  end
  frame;
end

begin
  p();
  frame;
end`;

  const descendingSource = `program for_const_step_negative;

process p();
begin
  for i = 6 to 0 step -3
    print(i);
  end
  frame;
end

begin
  p();
  frame;
end`;

  for (const [source, expected] of [[ascendingSource, [0, 3, 6]], [descendingSource, [6, 3, 0]]]) {
    const bytecode = compileSource(source);
    // The short form's exit test is exactly 4 instructions (LOAD_LOCAL,
    // <end>, LTE/GTE, JUMP_IF_FALSE); the general AND/OR form is roughly
    // 30. Rather than pin an exact instruction count (brittle against
    // unrelated future codegen changes), assert there's no JUMP_IF_TRUE
    // in the whole program - the short form never emits one, while the
    // general AND/OR short-circuit codegen always does (twice, for the
    // two "..OR.." branches). A regression back to the general form for
    // a constant step would make this JUMP_IF_TRUE count go from 0 to 4.
    const jumpIfTrueCount = bytecode.instructions.filter((i) => i.opcode === OpCodes.JUMP_IF_TRUE).length;
    assert(jumpIfTrueCount === 0,
      `FOR com step constante nao devia emitir JUMP_IF_TRUE (esse opcode so aparece na forma AND/OR generica), obtido ${jumpIfTrueCount}`);

    const vm = new VM();
    vm.load(bytecode);
    const seen = [];
    vm.registerNative('print', (v) => { seen.push(v); return 0; });
    vm.tick();
    assert(JSON.stringify(seen) === JSON.stringify(expected),
      `esperava ${JSON.stringify(expected)}, obtido ${JSON.stringify(seen)}`);
  }
}

async function testDisassemblerProducesReadableLabeledOutput() {
  // compiler/bytecode.js's own disassemble() lives on the Bytecode/
  // Instruction classes, which nothing in the real compile path ever
  // instantiates - Compiler.emit()/addConstant() push onto plain arrays
  // on `this` and compile() returns a plain object, never a Bytecode
  // instance. That disassemble() is unreachable. compiler/disasm.js
  // works on the bytecode object actually returned by compile().
  const source = `program disasm_check;

global score = 0;

process enemy(x, y);
begin
  loop
    score = score + 1;
    frame;
  end
end

begin
  enemy(0, 0);
  frame;
end`;

  const bytecode = compileSource(source);
  const text = disassemble(bytecode);

  assert(text.includes('== PROCESS enemy'), 'devia ter uma seccao rotulada para o processo enemy');
  assert(text.includes('== MAIN main'), 'devia ter uma seccao rotulada para o main');
  assert(text.includes('; score'), 'STORE_GLOBAL/LOAD_GLOBAL de "score" deviam estar anotados com o nome, nao so o indice');
  assert(text.includes('-> '), 'instrucoes de salto deviam mostrar o endereco de destino anotado');
}

async function testDisassemblerResolvesFunctionAndMainLocalNames() {
  // functionTable entries used to only ever get { addr, params } -
  // unlike processTable, which always carried a .locals map - so
  // LOAD_LOCAL/STORE_LOCAL inside a FUNCTION body printed a bare slot
  // number in disasm.js's output even though the same instructions
  // inside a PROCESS body correctly resolved to a variable name. MAIN's
  // own top-level VAR declarations had no name metadata published
  // anywhere at all. compileFunction() now publishes .locals the same
  // way compileProcess() always has, and compile()'s returned bytecode
  // object gained a top-level `mainLocals` field for the same reason.
  const source = `program disasm_locals_check;

function add(a, b);
begin
  var total = a + b;
  return total;
end

begin
  var result = add(3, 4);
  print(result);
  frame;
end`;

  const bytecode = compileSource(source);
  const text = disassemble(bytecode);

  assert(text.includes('== FUNCTION add'), 'devia ter uma seccao rotulada para a funcao add');
  assert(text.includes('; a') && text.includes('; b'),
    'os parametros a/b da FUNCTION deviam estar anotados com o nome, nao so o indice');
  assert(text.includes('; total'),
    'a VAR "total" dentro da FUNCTION devia estar anotada com o nome, nao so o indice');
  assert(text.includes('; result'),
    'a VAR "result" dentro do MAIN devia estar anotada com o nome, nao so o indice');
}

async function testMainSurvivesLargeSpawnLoopAcrossMultipleTicks() {
  // runMain()'s per-tick instruction budget (100,000, guarding against a
  // genuine infinite loop that never reaches FRAME) used to set
  // mainFinished = true the moment it was exceeded - permanently, since
  // tick() only calls runMain() at all while !mainFinished. A MAIN-level
  // FOR loop spawning enough processes to cross that budget in one tick
  // (a plausible pattern: a wave spawner, a particle burst) would
  // silently spawn only a fraction of what was requested and then never
  // run MAIN again for the rest of the program - no error surfaced
  // anywhere a game author would see, just fewer processes than asked
  // for and a dead MAIN. Confirmed directly: requesting 5,000 processes
  // in one FOR loop used to always produce exactly 3,225 live ones,
  // regardless of how much larger the requested count was (5,000/
  // 10,000/20,000/50,000 all produced that same 3,225 - the loop always
  // died at the same iteration count for the same per-spawn instruction
  // cost). Fixed by letting a *single* budget exhaustion resume on the
  // next tick instead of stopping permanently, while still killing
  // MAIN after several (5) *consecutive* exhaustions with zero progress
  // - preserving the original safety net for a genuine infinite loop.
  const source = `program large_spawn;

process bunny(x, y);
begin
  loop
    frame;
  end
end

begin
  for i = 0 to 4999
    bunny(i, i);
  end
  loop
    frame;
  end
end`;

  const bytecode = compileSource(source);
  const vm = new VM();
  vm.load(bytecode);

  // The fix needs at least 2 ticks to finish 5,000 spawns (3,225 fit in
  // the first tick's budget, the rest resume on the second) - give it a
  // handful more as headroom without masking a real regression back to
  // the old permanent-stop behavior, which would plateau at 3,225
  // forever no matter how many ticks it's given.
  for (let i = 0; i < 6; i += 1) {
    vm.tick();
  }

  // 5001, not 5000: getAll() also counts MAIN itself (a real Process).
  const liveCount = vm.processManager.getAll().length;
  assert(liveCount === 5001,
    `esperava 5001 processos vivos (5000 bunnies + MAIN) apos varios ticks, obtido ${liveCount} ` +
    `(3226 e o valor exato que o bug antigo produzia, truncado para sempre)`);
  assert(vm.mainFinished === false,
    'MAIN devia continuar vivo (para chegar ao seu proprio LOOP FRAME final), nao mainFinished=true');
}

async function testGenuineInfiniteLoopInMainIsStillCaught() {
  // The other half of the fix above: a MAIN-level loop that truly never
  // reaches FRAME no matter how many extra ticks it's given (not just
  // "needs one or two more ticks to finish real work") must still be
  // caught and stopped - otherwise every tick would burn a full 100,000-
  // instruction budget forever, which is strictly worse than the old
  // behavior for this specific case.
  const source = `program genuine_infinite_loop;

begin
  var x = 0;
  while (1)
    x = x + 1;
  end
  loop
    frame;
  end
end`;

  const bytecode = compileSource(source);
  const vm = new VM();
  vm.load(bytecode);

  let stoppedWithinBudget = false;
  for (let i = 0; i < 10; i += 1) {
    vm.tick();
    if (vm.mainFinished) {
      stoppedWithinBudget = true;
      break;
    }
  }

  assert(stoppedWithinBudget, 'um loop genuinamente infinito no MAIN devia acabar por parar (mainFinished=true), nao continuar para sempre');
}

async function testCollisionExcludesSelf() {
  // ProcessManager.collision() looked up every process of the requested
  // TYPE and tested collidesWith() without ever excluding the calling
  // process itself. A process's own bounding box always overlaps itself,
  // so collision(TYPE X) called from inside a process of type X returned
  // that process's own id on every single frame - breaking any same-type
  // collision check (enemy-vs-enemy, bullet-vs-bullet) before it could
  // ever see a real hit.
  const soloSource = `program collision_self;

process enemy(x, y);
begin
  width = 20;
  height = 20;
  graph = 1;
  if (collision(TYPE enemy))
    print(999);
  end
  frame;
end

begin
  enemy(10, 10);
  frame;
end`;

  const soloBytecode = compileSource(soloSource);
  const soloVm = new VM();
  soloVm.load(soloBytecode);
  const soloRuntime = createRuntime(soloVm);
  const soloSeen = [];
  soloVm.registerNative('print', (v) => { soloSeen.push(v); return 0; });
  soloRuntime.beginFrame(1 / 60);
  soloVm.tick();
  assert(soloSeen.length === 0,
    `processo sozinho nao devia colidir consigo proprio, obtido ${JSON.stringify(soloSeen)}`);

  // A real collision between two distinct instances of the same TYPE must
  // still be detected - the fix must exclude only the caller, not the type.
  const pairSource = `program collision_pair;

process enemy(x, y);
begin
  width = 20;
  height = 20;
  graph = 1;
  loop
    if (collision(TYPE enemy))
      print(1);
    end
    frame;
  end
end

begin
  enemy(10, 10);
  enemy(15, 15);
  frame;
end`;

  const pairBytecode = compileSource(pairSource);
  const pairVm = new VM();
  pairVm.load(pairBytecode);
  const pairRuntime = createRuntime(pairVm);
  const pairSeen = [];
  pairVm.registerNative('print', (v) => { pairSeen.push(v); return 0; });
  pairRuntime.beginFrame(1 / 60);
  pairVm.tick();
  // The first tick alone isn't enough: SPAWN_PROCESS runs each spawned
  // process immediately, in spawn order, up to its own FRAME - so when
  // enemy(10,10) runs its first collision() check, enemy(15,15) hasn't
  // been spawned by MAIN yet, and only the second enemy sees a partner
  // already in place (1 print). Both enemies are regular scheduled
  // processes by the second tick, each looping back to its own
  // collision() check with the other now positioned too.
  pairSeen.length = 0;
  pairRuntime.beginFrame(1 / 60);
  pairVm.tick();
  assert(pairSeen.length === 2,
    `duas instancias sobrepostas do mesmo TYPE deviam colidir, obtido ${JSON.stringify(pairSeen)}`);
}

async function testSpawnSetsParentId() {
  const source = `program spawn_parent;

process child();
begin
  frame;
end

process parent();
begin
  child();
  frame;
end

begin
  parent();
  frame;
end`;

  const bytecode = compileSource(source);
  const vm = new VM();
  vm.load(bytecode);
  const runtime = createRuntime(vm);
  runtime.beginFrame(1 / 60);
  vm.tick();

  const parent = vm.processManager.getByName('parent')[0];
  const child = vm.processManager.getByName('child')[0];
  assert(!!parent, 'parent nao criado');
  assert(!!child, 'child nao criado');
  assert(child.parentId === parent.id, `parentId esperado ${parent.id}, obtido ${child.parentId}`);
}

async function testSignalKillTreeAndWakeupByType() {
  const vm = new VM();
  const runtime = createRuntime(vm);

  const p = vm.processManager.create('enemy', { x: 0, y: 0, width: 10, height: 10 });
  const c1 = vm.processManager.create('enemy_child', { parentId: p.id });
  const c2 = vm.processManager.create('enemy_child2', { parentId: c1.id });

  const killed = vm.processManager.signalById(p.id, 100);
  assert(killed === 3, `signal kill tree esperado 3, obtido ${killed}`);
  assert(p.dead && c1.dead && c2.dead, 'kill tree devia marcar toda a arvore como dead');

  const e1 = vm.processManager.create('enemy', { x: 0, y: 0 });
  const e2 = vm.processManager.create('enemy', { x: 50, y: 50 });
  e1.suspended = true;
  e2.suspended = true;

  const enemyType = vm.processManager.getTypeCode('enemy');
  const woke = runtime.signalNative(enemyType, 1);
  assert(woke >= 2, `signal by TYPE wakeup esperado >=2, obtido ${woke}`);
  assert(e1.suspended === false && e2.suspended === false, 'wakeup por TYPE devia acordar enemies');
}

async function testSignalKillByIdUsesDivSemantics() {
  const vm = new VM();
  const runtime = createRuntime(vm);

  const victim = vm.processManager.create('victim', { x: 10, y: 20 });
  const changed = runtime.signalNative(victim.id, 0);

  assert(changed === 1, `signal(id, s_kill) esperado 1, obtido ${changed}`);
  assert(victim.dead === true, 'signal(id, s_kill) devia matar processo');
  assert(victim.suspended === false, 'processo morto nao devia ficar apenas suspended');
}

async function testCTypeScrollAssignmentPersistsAfterFrame() {
  const source = `program ctype_sync;

process p();
begin
  ctype = c_scroll;
  frame;
end

begin
  p();
  frame;
end`;

  const bytecode = compileSource(source);
  const vm = new VM();
  vm.load(bytecode);
  const runtime = createRuntime(vm);

  runtime.beginFrame(1 / 60);
  vm.tick();

  const p = getUserProcesses(vm)[0];
  assert(!!p, 'processo nao criado');
  assert(p.ctype === CType.C_SCROLL, `ctype esperado ${CType.C_SCROLL}, obtido ${p.ctype}`);

  vm.currentProcess = p;
  assert(runtime.getCurrentCType() === CType.C_SCROLL, `getCurrentCType esperado ${CType.C_SCROLL}, obtido ${runtime.getCurrentCType()}`);
}

async function testCollisionByType() {
  const vm = new VM();
  const runtime = createRuntime(vm);

  const player = vm.processManager.create('player', { x: 10, y: 10, width: 20, height: 20, graph: 1 });
  const enemy = vm.processManager.create('enemy', { x: 20, y: 20, width: 20, height: 20, graph: 1 });
  vm.currentProcess = player;

  const enemyType = vm.processManager.getTypeCode('enemy');
  const collidingId = runtime.collisionNative(enemyType);
  assert(collidingId === enemy.id, `collision TYPE esperado id ${enemy.id}, obtido ${collidingId}`);
}

async function testCircleCollisionUsesExplicitRadius() {
  const vm = new VM();
  const runtime = createRuntime(vm);

  // width/height are tiny, so default radius would be too small to collide
  // (b's own fallback circle radius is width*0.5=4 - preferCircle applies
  // to both sides, see collideProcesses). a's explicit radius of 30 needs
  // the gap between centers to be under 30+4=34 to register.
  const a = vm.processManager.create('a', { x: 10, y: 10, width: 8, height: 8, graph: 1 });
  const b = vm.processManager.create('b', { x: 35, y: 10, width: 8, height: 8, graph: 1 });

  vm.currentProcess = a;
  runtime.setCollisionRadiusNative(30);

  const bType = vm.processManager.getTypeCode('b');
  const hit = runtime.collisionCircleNative(bType);
  assert(hit === b.id, `collision_circle com raio explicito esperado id ${b.id}, obtido ${hit}`);
}

async function testExplicitCollisionBoxesOverrideLargeImplicitBounds() {
  const vm = new VM();
  const runtime = createRuntime(vm);

  // Two huge sprites overlapping if implicit width/height is used.
  const a = vm.processManager.create('a', { x: 100, y: 100, width: 200, height: 200, graph: 1 });
  const b = vm.processManager.create('b', { x: 220, y: 120, width: 200, height: 200, graph: 1 });

  vm.currentProcess = a;
  runtime.clearCollisionBoxesNative();
  runtime.addCollisionBoxNative(0, 0, 20, 20, 11);

  vm.currentProcess = b;
  runtime.clearCollisionBoxesNative();
  runtime.addCollisionBoxNative(180, 180, 20, 20, 22);

  vm.currentProcess = a;
  const typeB = vm.processManager.getTypeCode('b');
  const hit = runtime.collisionNative(typeB);
  assert(hit === 0, `cboxes explicitas pequenas nao deviam colidir, obtido id ${hit}`);
}

async function testCBoxBoxCollisionPenetrationSignAndCodes() {
  const vm = new VM();
  const runtime = createRuntime(vm);

  const a = vm.processManager.create('a', { x: 100, y: 100, width: 32, height: 32, angle: 0, graph: 1 });
  const b = vm.processManager.create('b', { x: 124, y: 104, width: 32, height: 32, angle: 0, graph: 1 });

  vm.currentProcess = a;
  runtime.clearCollisionBoxesNative();
  runtime.addCollisionBoxNative(0, 0, 32, 32, 101);

  vm.currentProcess = b;
  runtime.clearCollisionBoxesNative();
  runtime.addCollisionBoxNative(0, 0, 32, 32, 202);

  vm.currentProcess = a;
  const typeB = vm.processManager.getTypeCode('b');
  const hit = runtime.collisionNative(typeB);

  assert(hit === b.id, `box-box: esperado id ${b.id}, obtido ${hit}`);
  assert(runtime.getColliderCBoxNative() === 101, `box-box collider_cbox esperado 101, obtido ${runtime.getColliderCBoxNative()}`);
  assert(runtime.getCollidedCBoxNative() === 202, `box-box collided_cbox esperado 202, obtido ${runtime.getCollidedCBoxNative()}`);
  assert(runtime.getPenetrationXNative() < 0, `box-box: com A a esquerda de B, penetration_x devia ser negativo, obtido ${runtime.getPenetrationXNative()}`);
}

async function testCBoxCircleCircleCollisionAndCodes() {
  const vm = new VM();
  const runtime = createRuntime(vm);

  const a = vm.processManager.create('a', { x: 100, y: 100, width: 40, height: 40, angle: 0, graph: 1 });
  const b = vm.processManager.create('b', { x: 130, y: 100, width: 40, height: 40, angle: 0, graph: 1 });

  vm.currentProcess = a;
  runtime.clearCollisionBoxesNative();
  runtime.addCollisionCircleNative(20, 20, 18, 301);

  vm.currentProcess = b;
  runtime.clearCollisionBoxesNative();
  runtime.addCollisionCircleNative(20, 20, 18, 302);

  vm.currentProcess = a;
  const typeB = vm.processManager.getTypeCode('b');
  const hit = runtime.collisionNative(typeB);

  assert(hit === b.id, `circle-circle: esperado id ${b.id}, obtido ${hit}`);
  assert(runtime.getColliderCBoxNative() === 301, `circle-circle collider_cbox esperado 301, obtido ${runtime.getColliderCBoxNative()}`);
  assert(runtime.getCollidedCBoxNative() === 302, `circle-circle collided_cbox esperado 302, obtido ${runtime.getCollidedCBoxNative()}`);
  assert(runtime.getPenetrationXNative() < 0, `circle-circle: com A a esquerda de B, penetration_x devia ser negativo, obtido ${runtime.getPenetrationXNative()}`);
}

async function testCBoxBoxCircleCollisionAndCodes() {
  const vm = new VM();
  const runtime = createRuntime(vm);

  const a = vm.processManager.create('a', { x: 100, y: 100, width: 40, height: 40, angle: 0, graph: 1 });
  const b = vm.processManager.create('b', { x: 110, y: 104, width: 40, height: 40, angle: 0, graph: 1 });

  vm.currentProcess = a;
  runtime.clearCollisionBoxesNative();
  // Local box (0,0)-(24,24) on a 40x40 process spans world [80,104]x[80,104]
  // (localToWorld centers on the process, so a corner at local (24,24) on a
  // 40-wide box lands at process.x + 24 - 20 = process.x + 4).
  runtime.addCollisionBoxNative(0, 0, 24, 24, 401);

  vm.currentProcess = b;
  runtime.clearCollisionBoxesNative();
  // Local circle center (12,12) r=12 on a 40x40 process is world
  // (process.x + 12 - 20, process.y + 12 - 20) = (process.x - 8, process.y - 8),
  // i.e. (102, 96) here - well inside a's box above.
  runtime.addCollisionCircleNative(12, 12, 12, 402);

  vm.currentProcess = a;
  const typeB = vm.processManager.getTypeCode('b');
  const hit = runtime.collisionNative(typeB);

  assert(hit === b.id, `box-circle: esperado id ${b.id}, obtido ${hit}`);
  assert(runtime.getColliderCBoxNative() === 401, `box-circle collider_cbox esperado 401, obtido ${runtime.getColliderCBoxNative()}`);
  assert(runtime.getCollidedCBoxNative() === 402, `box-circle collided_cbox esperado 402, obtido ${runtime.getCollidedCBoxNative()}`);
}

async function testCBoxPenetrationYAxisSign() {
  const vm = new VM();
  const runtime = createRuntime(vm);

  const a = vm.processManager.create('a', { x: 100, y: 100, width: 32, height: 32, angle: 0, graph: 1 });
  const b = vm.processManager.create('b', { x: 104, y: 124, width: 32, height: 32, angle: 0, graph: 1 });

  vm.currentProcess = a;
  runtime.clearCollisionBoxesNative();
  runtime.addCollisionBoxNative(0, 0, 32, 32, 501);

  vm.currentProcess = b;
  runtime.clearCollisionBoxesNative();
  runtime.addCollisionBoxNative(0, 0, 32, 32, 502);

  vm.currentProcess = a;
  const typeB = vm.processManager.getTypeCode('b');
  const hit = runtime.collisionNative(typeB);

  assert(hit === b.id, `box-box Y: esperado id ${b.id}, obtido ${hit}`);
  assert(runtime.getPenetrationYNative() < 0, `box-box Y: com A acima de B, penetration_y devia ser negativo, obtido ${runtime.getPenetrationYNative()}`);
}

async function testCrossProcessFixedSlotsAreLiveWithinSameFrame() {
  // vm.js's runProcess() used to sync only x/y from locals back onto the
  // Process object right after each process yields, while width, height,
  // ctype, region, and angle were left to ProcessManager.sweep() - which
  // runs once, after every process in the tick has already executed. That
  // made x/y "live" within the same frame (visible to any process that
  // runs later in the same tick) but left the other five canonical fields
  // a full frame stale for the same readers: a process that grows its own
  // hitbox mid-frame wouldn't have that reflected in a collision() check
  // made against it later in that same tick - only on the next one.
  //
  // Reproduce it end-to-end: "grower" (spawned first, so it runs first
  // each tick) sets its own width/height to 200 starting on frame 1;
  // "watcher" (spawned second, so it runs right after in the same tick)
  // is a small fixed process positioned inside where grower's *new*
  // bounds would land, but outside its *old* 10x10 bounds. If width/height
  // are live, watcher sees the collision on frame 1. If they lag a frame
  // (the bug), watcher only sees it starting on frame 2.
  const source = `program cross_process_live_slots;

process grower(x, y);
begin
  width = 10;
  height = 10;
  graph = 1;
  loop
    width = 200;
    height = 200;
    frame;
  end
end

process watcher(x, y);
begin
  width = 5;
  height = 5;
  graph = 1;
  loop
    if (collision(TYPE grower))
      print(1);
    else
      print(0);
    end
    frame;
  end
end

begin
  grower(0, 0);
  watcher(50, 50);
  frame;
end`;

  const bytecode = compileSource(source);
  const vm = new VM();
  vm.load(bytecode);
  const runtime = createRuntime(vm);
  const seen = [];
  vm.registerNative('print', (v) => { seen.push(v); return 0; });

  runtime.beginFrame(1 / 60);
  vm.tick();

  assert(seen[0] === 1,
    `width/height deviam estar atualizados no mesmo frame em que grower os muda; watcher devia ver colisao ja no frame 1, obtido seen=${JSON.stringify(seen)}`);
}

async function testLetMeAloneKillsOthers() {
  const vm = new VM();
  const runtime = createRuntime(vm);

  const hero = vm.processManager.create('hero', { x: 0, y: 0 });
  const a = vm.processManager.create('npc', { x: 1, y: 1 });
  const b = vm.processManager.create('npc', { x: 2, y: 2 });
  vm.currentProcess = hero;

  const removed = runtime.letMeAloneNative();
  assert(removed === 2, `let_me_alone esperado 2, obtido ${removed}`);
  assert(!hero.dead, 'processo atual nao devia morrer');
  assert(a.dead && b.dead, 'outros processos deviam morrer');
}

async function testPriorityFieldSortsDrawList() {
  // Z is canonical slot 15 and is what actually governs draw order in
  // DIV - i.c:1441 picks the greatest _Z each pass, so the highest Z
  // paints first and ends up furthest back (see the comment on
  // getDrawList in process.js). PRIORITY (slot 13) only affects
  // *execution* order, not paint order - despite this test's name, it
  // exercises the same dirty-flag/getDrawList machinery via Z, which is
  // the field that's actually supposed to sort the list.
  const source = `program t;
process actor(zval);
begin
  z = zval;
  loop frame; end
end
begin
  actor(10);
  actor(5);
  actor(1);
  loop frame; end
end`;
  const vm = new VM();
  vm.load(compileSource(source));
  vm.tick();
  const dl = vm.processManager.getDrawList();
  // 4, not 3: getDrawList() includes MAIN (a real Process itself, default
  // priority/z 0) alongside the 3 spawned actors.
  assert(dl.length === 4, `esperava 4 processos, obtido ${dl.length}`);
  for (let i = 1; i < dl.length; i++) {
    assert(dl[i].z <= dl[i - 1].z,
      `draw list fora de ordem: [${dl.map(p => p.z).join(',')}]`);
  }

  // Default priority is 0
  const src2 = `program t;
process p();
begin
  print(priority);
  loop frame; end
end
begin p(); loop frame; end end`;
  const vm2 = new VM();
  vm2.load(compileSource(src2));
  const seen = [];
  vm2.registerNative('print', v => { seen.push(v); return 0; });
  vm2.tick();
  assert(seen[0] === 0, `priority default devia ser 0, obtido ${seen[0]}`);

  // Dirty flag: cleared after getDrawList, set again after a new spawn
  assert(!vm.processManager._drawDirty, 'dirty devia estar false depois de getDrawList');
}

async function testGlobalArrayReadWrite() {
  // GLOBAL arr[n] allocates n consecutive slots; arr[i] uses LOAD/STORE_GLOBAL_IDX.
  // Unwritten slots default to 0.
  const source = `program t;
global scores[5];
begin
  scores[0] = 10;
  scores[1] = 20;
  scores[4] = 99;
  print(scores[0]);
  print(scores[1]);
  print(scores[2]);
  print(scores[4]);
  loop frame; end
end`;
  const vm = new VM();
  vm.load(compileSource(source));
  const seen = [];
  vm.registerNative('print', v => { seen.push(v); return 0; });
  vm.tick();
  assert(JSON.stringify(seen) === '[10,20,0,99]',
    `esperava [10,20,0,99], obtido ${JSON.stringify(seen)}`);

  // Variable index: fill with i*i and read back
  const src2 = `program t;
global sq[5];
begin
  for i = 0 to 4
    sq[i] = i * i;
  end
  for i = 0 to 4
    print(sq[i]);
  end
  loop frame; end
end`;
  const vm2 = new VM();
  vm2.load(compileSource(src2));
  const seen2 = [];
  vm2.registerNative('print', v => { seen2.push(v); return 0; });
  vm2.tick();
  assert(JSON.stringify(seen2) === '[0,1,4,9,16]',
    `esperava [0,1,4,9,16], obtido ${JSON.stringify(seen2)}`);

  // Multiple arrays don't overlap
  const src3 = `program t;
global a[3], b[3];
begin
  a[0] = 1; a[2] = 3;
  b[0] = 4; b[2] = 6;
  print(a[0]); print(a[1]); print(a[2]);
  print(b[0]); print(b[1]); print(b[2]);
  loop frame; end
end`;
  const vm3 = new VM();
  vm3.load(compileSource(src3));
  const seen3 = [];
  vm3.registerNative('print', v => { seen3.push(v); return 0; });
  vm3.tick();
  assert(JSON.stringify(seen3) === '[1,0,3,4,0,6]',
    `arrays sobrepostos: ${JSON.stringify(seen3)}`);
}

async function testPrivateArrayInProcess() {
  const source = `program t;
process p();
private hist[4];
begin
  hist[0] = 10;
  hist[1] = 20;
  hist[2] = 30;
  hist[3] = 40;
  print(hist[0] + hist[3]);
  loop frame; end
end
begin p(); loop frame; end end`;
  const vm = new VM();
  vm.load(compileSource(source));
  const seen = [];
  vm.registerNative('print', v => { seen.push(v); return 0; });
  vm.tick();
  assert(seen[0] === 50, `esperava 50, obtido ${seen[0]}`);
}

async function testGlobalInlineCommaForm() {
  // GLOBAL a, b, c = 5; - all on one line, comma-separated, single ;
  // Each name gets its own optional initializer left-to-right.
  const source = `program t;
global a, b, c = 5;
begin
  print(a);
  print(b);
  print(c);
  frame;
end`;
  const vm = new VM();
  vm.load(compileSource(source));
  const seen = [];
  vm.registerNative('print', (v) => { seen.push(v); return 0; });
  vm.tick();
  assert(JSON.stringify(seen) === JSON.stringify([0, 0, 5]),
    `esperava [0,0,5], obtido ${JSON.stringify(seen)}`);

  // mixed: some with initializers, some without. Names avoid x/y/z on
  // purpose - those are MAIN's own canonical process fields (slots 0, 1,
  // 15; MAIN is a real Process too), which correctly take priority over
  // a same-named GLOBAL inside MAIN's body, same as inside any PROCESS.
  const src2 = `program t;
global p1 = 1, p2, p3 = 3;
begin
  print(p1);
  print(p2);
  print(p3);
  frame;
end`;
  const vm2 = new VM();
  vm2.load(compileSource(src2));
  const seen2 = [];
  vm2.registerNative('print', (v) => { seen2.push(v); return 0; });
  vm2.tick();
  assert(JSON.stringify(seen2) === JSON.stringify([1, 0, 3]),
    `esperava [1,0,3], obtido ${JSON.stringify(seen2)}`);
}

async function testPrivateCommaForm() {
  // PRIVATE vx, vy = 3; - comma-separated inside a PROCESS
  const source = `program t;
process p();
private vx, vy = 3;
begin
  print(vx);
  print(vy);
  frame;
end
begin
  p();
  frame;
end`;
  const vm = new VM();
  vm.load(compileSource(source));
  const seen = [];
  vm.registerNative('print', (v) => { seen.push(v); return 0; });
  vm.tick();
  assert(JSON.stringify(seen) === JSON.stringify([0, 3]),
    `esperava [0,3], obtido ${JSON.stringify(seen)}`);
}

async function testStructSingleInstance() {
  const vm = new VM();
  vm.load(compileSource(`program t;
struct player
  x = 100;
  y = 200;
  hp = 3;
end
begin
  print(player.x); print(player.hp);
  player.x = 50;
  print(player.x);
  loop frame; end
end`));
  const seen = [];
  vm.registerNative('print', v => { seen.push(v); return 0; });
  vm.tick();
  assert(JSON.stringify(seen) === '[100,3,50]', `esperava [100,3,50], obtido ${JSON.stringify(seen)}`);
}

async function testStructArrayOfStructs() {
  const vm = new VM();
  vm.load(compileSource(`program t;
struct enemy[3]
  x; y; hp = 5;
end
begin
  enemy[0].x = 10; enemy[1].x = 20; enemy[2].hp = 99;
  print(enemy[0].x); print(enemy[1].x); print(enemy[2].x);
  print(enemy[0].hp); print(enemy[2].hp);
  loop frame; end
end`));
  const seen = [];
  vm.registerNative('print', v => { seen.push(v); return 0; });
  vm.tick();
  assert(JSON.stringify(seen) === '[10,20,0,5,99]', `esperava [10,20,0,5,99], obtido ${JSON.stringify(seen)}`);
}

async function testStructArrayField() {
  const vm = new VM();
  vm.load(compileSource(`program t;
struct anim[2]
  count; frames[4];
end
begin
  anim[0].count = 2; anim[0].frames[0] = 100; anim[0].frames[1] = 101;
  anim[1].frames[0] = 200;
  print(anim[0].count); print(anim[0].frames[1]); print(anim[1].frames[0]);
  loop frame; end
end`));
  const seen = [];
  vm.registerNative('print', v => { seen.push(v); return 0; });
  vm.tick();
  assert(JSON.stringify(seen) === '[2,101,200]', `esperava [2,101,200], obtido ${JSON.stringify(seen)}`);
}

async function testStructInitializerList() {
  // = val, val, N DUP(val); after END initializes slots in order
  const vm = new VM();
  vm.load(compileSource(`program t;
struct scores[3]
  val; bonus;
end =
  10, 1,
  20, 2,
  30, 3;
begin
  print(scores[0].val); print(scores[0].bonus);
  print(scores[2].val); print(scores[2].bonus);
  loop frame; end
end`));
  const seen = [];
  vm.registerNative('print', v => { seen.push(v); return 0; });
  vm.tick();
  assert(JSON.stringify(seen) === '[10,1,30,3]', `esperava [10,1,30,3], obtido ${JSON.stringify(seen)}`);

  // N DUP(val) expansion
  const vm2 = new VM();
  vm2.load(compileSource(`program t;
struct data[3]
  a; b;
end =
  1, 2,
  3, 2 DUP(0);
begin
  print(data[0].a); print(data[1].a); print(data[1].b); print(data[2].a);
  loop frame; end
end`));
  const seen2 = [];
  vm2.registerNative('print', v => { seen2.push(v); return 0; });
  vm2.tick();
  assert(JSON.stringify(seen2) === '[1,3,0,0]', `DUP: esperava [1,3,0,0], obtido ${JSON.stringify(seen2)}`);
}

async function testStructNested() {
  const vm = new VM();
  vm.load(compileSource(`program t;
struct traj[2]
  x; y;
  struct pts[3]
    px; py;
  end
end
begin
  traj[0].x = 100;
  traj[0].pts[0].px = 10;
  traj[0].pts[1].py = 20;
  traj[1].pts[2].px = 99;
  print(traj[0].x); print(traj[0].pts[0].px);
  print(traj[0].pts[1].py); print(traj[1].pts[2].px);
  loop frame; end
end`));
  const seen = [];
  vm.registerNative('print', v => { seen.push(v); return 0; });
  vm.tick();
  assert(JSON.stringify(seen) === '[100,10,20,99]', `esperava [100,10,20,99], obtido ${JSON.stringify(seen)}`);
}

async function testPriorityDirtyFlagIgnoresUnrelatedFunctionLocals() {
  // The VM notifies ProcessManager.markPriorityDirty() whenever
  // STORE_LOCAL writes to slot 13 - the canonical `priority` field inside
  // a PROCESS body. But a FUNCTION's own locals are a completely
  // separate, freshly-allocated slot sequence starting at 0 - nothing
  // stops a FUNCTION with 14 params/VARs from putting its own 14th local
  // at slot 13 too, purely by coincidence. Without the currentProcess/
  // callStack guard, calling such a function marked the draw list dirty
  // on every call, for every process, even though no process's priority
  // actually changed - silently undermining the whole point of caching
  // the sorted draw list (confirmed reproducible: a FUNCTION with 14
  // params does put its 14th local at slot 13). The guard requires being
  // directly in a process's own top-level body (currentProcess set,
  // callStack empty) - so a priority write from inside a FUNCTION the
  // process itself calls doesn't trigger this path either, but that's
  // not a real capability lost: `priority` inside a FUNCTION was never a
  // reference to any process's canonical field to begin with (FUNCTION
  // locals don't get the canonical slot table PROCESS bodies do) - it's
  // just an ordinary, unrelated local variable there, with or without
  // this fix.
  const source = `program priority_false_positive;

function f(a,b,c,d,e,g,h,i,j,k,l,m,n,o);
begin
  o = 1;
  return o;
end

process p(x, y);
begin
  loop frame; end
end

begin
  p(1, 1);
  print(f(1,2,3,4,5,6,7,8,9,10,11,12,13,14));
  frame;
end`;

  const bytecode = compileSource(source);
  const vm = new VM();
  vm.load(bytecode);
  vm.registerNative('print', () => 0);

  vm.tick();
  vm.processManager.getDrawList(); // settle the initial spawn-triggered dirty flag

  let sortCalls = 0;
  const originalSort = Array.prototype.sort;
  Array.prototype.sort = function (...args) { sortCalls += 1; return originalSort.apply(this, args); };
  try {
    vm.tick(); // calls f() again - used to spuriously mark the draw list dirty
    vm.processManager.getDrawList();
  } finally {
    Array.prototype.sort = originalSort;
  }

  assert(sortCalls === 0,
    `FUNCTION escrevendo no seu proprio slot 13 nao devia disparar um resort da draw list, obtido ${sortCalls} chamada(s) a sort()`);
}

async function testArrayAndStructBoundsChecking() {
  // LOAD/STORE_LOCAL_IDX and LOAD/STORE_GLOBAL_IDX computed `base + index`
  // directly with no validation at all. An out-of-bounds index silently
  // read or wrote whatever unrelated global/local/struct-instance
  // happened to sit at that computed offset - confirmed for GLOBAL
  // arrays, PRIVATE arrays, and STRUCT arrays (including array-valued
  // fields within a struct) alike, since they all route through the same
  // four opcodes. A constant out-of-bounds index (the common case - an
  // off-by-one literal, or a loop bound of `size` instead of `size-1`)
  // is now a compile error; a variable index whose value isn't known
  // until runtime is bounds-checked in the VM instead, rejecting the
  // read/write rather than touching unrelated storage.

  // Constant index out of bounds: compile-time rejection. DIV declares
  // arrays by their LAST INDEX, not their length (see compileGlobal in
  // compiler.js) - "a[3]" is 4 elements, valid indices 0..3 - so a[3] is
  // the last legal slot, not out of bounds; a[4] is the first one that
  // actually is.
  let threwOnConstantOOB = false;
  try {
    compileSource(`program array_const_oob;

global a[3], b[3];

begin
  a[4] = 999;
  frame;
end`);
  } catch (error) {
    threwOnConstantOOB = true;
  }
  assert(threwOnConstantOOB, 'indice constante fora dos limites (a[4] com ultimo indice valido 3) devia falhar a compilar');

  let threwOnNegativeConstant = false;
  try {
    compileSource(`program array_negative_const;

global guard = 777;
global arr[3];

begin
  arr[-1] = 42;
  frame;
end`);
  } catch (error) {
    threwOnNegativeConstant = true;
  }
  assert(threwOnNegativeConstant, 'indice constante negativo devia falhar a compilar');

  // Variable index out of bounds: runtime guard, neighboring GLOBAL array
  // untouched instead of silently corrupted.
  const runtimeSource = `program array_runtime_oob;

global a[3], b[3];

begin
  b[0] = 111; b[1] = 222; b[2] = 333;
  var i = 4;
  a[i] = 999;
  print(b[0]);
  print(b[1]);
  print(b[2]);
  frame;
end`;

  const runtimeBytecode = compileSource(runtimeSource);
  const runtimeVm = new VM();
  runtimeVm.load(runtimeBytecode);
  const runtimeSeen = [];
  runtimeVm.registerNative('print', (v) => { runtimeSeen.push(v); return 0; });
  runtimeVm.tick();
  assert(JSON.stringify(runtimeSeen) === JSON.stringify([111, 222, 333]),
    `array vizinho "b" devia ficar intacto apos escrita fora dos limites em "a", obtido ${JSON.stringify(runtimeSeen)}`);

  // Valid, in-bounds usage must still work exactly as before.
  const validSource = `program array_valid_usage;

global arr[5];

begin
  for i = 0 to 4
    arr[i] = i * i;
  end
  for i = 0 to 4
    print(arr[i]);
  end
  frame;
end`;

  const validBytecode = compileSource(validSource);
  const validVm = new VM();
  validVm.load(validBytecode);
  const validSeen = [];
  validVm.registerNative('print', (v) => { validSeen.push(v); return 0; });
  validVm.tick();
  assert(JSON.stringify(validSeen) === JSON.stringify([0, 1, 4, 9, 16]),
    `uso valido dentro dos limites nao devia ser afetado, obtido ${JSON.stringify(validSeen)}`);

  // Same corruption class, confirmed for STRUCT arrays: an out-of-bounds
  // index on one struct silently landed inside the next STRUCT declared
  // right after it (structs share the same underlying global-slot
  // counter as plain GLOBALs and each other). Checked here via the
  // combined offset against the struct's total reserved footprint
  // (count * instanceSize) rather than per-term, which - same caveat as
  // the flat-array case - doesn't catch every pathological combination
  // of a too-large index on one term offset by a negative one on
  // another, but does catch the practical case: a single index running
  // past the end of the struct's own block.
  const structSource = `program struct_bounds_oob;

struct enemyA[2]
  x; y;
end

struct enemyB[2]
  hp; mana;
end

begin
  enemyB[0].hp = 111; enemyB[0].mana = 222;
  var i = 3;
  enemyA[i].x = 999;
  print(enemyB[0].hp);
  print(enemyB[0].mana);
  frame;
end`;

  const structBytecode = compileSource(structSource);
  const structVm = new VM();
  structVm.load(structBytecode);
  const structSeen = [];
  structVm.registerNative('print', (v) => { structSeen.push(v); return 0; });
  structVm.tick();
  assert(JSON.stringify(structSeen) === JSON.stringify([111, 222]),
    `enemyB devia ficar intacto apos escrita fora dos limites em enemyA, obtido ${JSON.stringify(structSeen)}`);
}

async function testPathNativesScrollState() {
  const vm = new VM();
  const runtime = createRuntime(vm);

  const setResult = runtime.setPathNative('scroll', 0, 'camera', 123);
  assert(setResult === 123, `set_path retorno esperado 123, obtido ${setResult}`);

  const camera = runtime.getPathNative('scroll', 0, 'camera');
  assert(camera === 123, `get_path camera esperado 123, obtido ${camera}`);

  runtime.setPathNative('scroll', 0, 'active', 1);
  const active = runtime.getPathNative('scroll', 0, 'active');
  assert(active === 1, `get_path active esperado 1, obtido ${active}`);
}

// path_find's clearance keeps a follower's whole body off the walls (the
// pathfinding demo's 16 px bot brushed them: the path was planned for its
// centre), and diagonal steps never cut a wall's corner.
async function testPathFindClearanceAndCorners()
{
  const vm = new VM();
  const runtime = createRuntime(vm);
  const walls = [
    { x: 120, y: 60, width: 24, height: 120 },     // centred boxes, as in DIV
    { x: 60, y: 150, width: 100, height: 20 }
  ];
  for (const w of walls)
  {
    vm.processManager.create('wall', { ...w, angle: 0 });
  }
  const wallType = vm.processManager.getTypeCode('wall');
  const boxes = walls.map((w) => [w.x - w.width / 2, w.y - w.height / 2, w.x + w.width / 2, w.y + w.height / 2]);
  // Does a 16x16 body centred anywhere on the path touch a wall?
  const bodyHits = (pathId) =>
  {
    let hits = 0;
    const n = runtime.pathLengthNative(pathId);
    for (let i = 0; i + 1 < n; i++)
    {
      const ax = runtime.pathGetXNative(pathId, i);
      const ay = runtime.pathGetYNative(pathId, i);
      const bx = runtime.pathGetXNative(pathId, i + 1);
      const by = runtime.pathGetYNative(pathId, i + 1);
      for (let t = 0; t <= 1; t += 0.1)
      {
        const cx = ax + (bx - ax) * t;
        const cy = ay + (by - ay) * t;
        for (const [x0, y0, x1, y1] of boxes)
        {
          if (cx + 8 > x0 && cx - 8 < x1 && cy + 8 > y0 && cy - 8 < y1)
          {
            hits++;
          }
        }
      }
    }
    return hits;
  };
  const pointPath = runtime.pathFindNative(40, 40, 200, 110, wallType, 8, 1, 8192);
  const bodyPath = runtime.pathFindNative(40, 40, 200, 110, wallType, 8, 1, 8192, 8);
  assert(pointPath > 0 && bodyPath > 0, `os dois caminhos deviam existir: ${pointPath}, ${bodyPath}`);
  assert(bodyHits(pointPath) > 0, 'sem clearance, um corpo de 16 px devia raspar as paredes (confirma que o teste mede algo)');
  assert(bodyHits(bodyPath) === 0, `com clearance 8, um corpo de 16 px nao devia tocar em nenhuma parede (${bodyHits(bodyPath)} toques)`);

  // Two walls touching only at a corner: the diagonal between them is shut.
  const vm2 = new VM();
  const rt2 = createRuntime(vm2);
  vm2.processManager.create('wall', { x: 24, y: 8, width: 16, height: 16, angle: 0 });   // cell (1,0)
  vm2.processManager.create('wall', { x: 8, y: 24, width: 16, height: 16, angle: 0 });   // cell (0,1)
  const t2 = vm2.processManager.getTypeCode('wall');
  // (0,0) -> (1,1) straight through the corner would be a 2-point path;
  // the only legal ways go around the walls.
  const corner = rt2.pathFindNative(8, 8, 24, 24, t2, 16, 1, 8192);
  assert(corner > 0 && rt2.pathLengthNative(corner) > 2,
    `o caminho devia contornar as paredes e nao passar pelo canto entre elas (${corner ? rt2.pathLengthNative(corner) : 0} pontos)`);
}

async function testPathFindAvoidsObstacleType() {
  const vm = new VM();
  const runtime = createRuntime(vm);

  // Vertical wall blocking direct route from left to right at y=8.
  vm.processManager.create('wall', { x: 32, y: 0, width: 16, height: 64, angle: 0 });
  const wallType = vm.processManager.getTypeCode('wall');

  const pathId = runtime.pathFindNative(8, 8, 88, 8, wallType, 16, 0, 8192);
  assert(pathId > 0, `path_find devia devolver id valido, obtido ${pathId}`);

  const len = runtime.pathLengthNative(pathId);
  assert(len >= 2, `path_length esperado >=2, obtido ${len}`);

  const x0 = runtime.pathGetXNative(pathId, 0);
  const y0 = runtime.pathGetYNative(pathId, 0);
  const xN = runtime.pathGetXNative(pathId, len - 1);
  const yN = runtime.pathGetYNative(pathId, len - 1);
  assert(x0 === 8 && y0 === 8, `primeiro ponto esperado (8,8), obtido (${x0},${y0})`);
  assert(xN === 88 && yN === 8, `ultimo ponto esperado (88,8), obtido (${xN},${yN})`);

  let detoured = false;
  for (let i = 0; i < len; i++) {
    const py = runtime.pathGetYNative(pathId, i);
    if (py !== 8) {
      detoured = true;
      break;
    }
  }
  assert(detoured, 'path_find devia desviar do obstaculo (esperava pelo menos um ponto com y != 8)');

  const cleared = runtime.pathClearNative(pathId);
  assert(cleared === 1, `path_clear esperado 1, obtido ${cleared}`);
  assert(runtime.pathLengthNative(pathId) === 0, 'path_clear devia remover path');
}

async function testPathAssignAndStepUsesDeltaTime() {
  const vm = new VM();
  const runtime = createRuntime(vm);

  const bot = vm.processManager.create('bot', { x: 0, y: 0, width: 16, height: 16, angle: 0 });
  vm.currentProcess = bot;

  const pathId = runtime.pathFindNative(8, 8, 104, 8, 0, 16, 0, 4096);
  assert(pathId > 0, `path_find esperado id valido, obtido ${pathId}`);
  assert(runtime.pathAssignNative(pathId, 1) === 1, 'path_assign devia devolver 1');

  vm.dt = 0.1;
  const moving = runtime.pathStepNative(100, 1);
  assert(moving === 1, `path_step inicial devia indicar em movimento (1), obtido ${moving}`);
  assert(bot.x > 0, `bot devia mover no eixo X com dt, obtido x=${bot.x}`);

  let state = moving;
  for (let i = 0; i < 60 && state !== 2; i++) {
    state = runtime.pathStepNative(100, 1);
  }

  assert(state === 2, `path_step devia eventualmente terminar com 2, obtido ${state}`);
  // process x/y is the process's center (DIV convention, see getCenter in
  // process.js), so the bot ends exactly on the last path point's center.
  assert(Math.abs(bot.x - 104) <= 1.5, `bot devia terminar perto de x=104 (centro do ultimo ponto), obtido x=${bot.x}`);
}

async function testRelativeProcessFieldAccessFatherAndSon() {
  const vm = new VM();
  const runtime = createRuntime(vm);

  const parent = vm.processManager.create('parent', { x: 10, y: 20 });
  const child = vm.processManager.create('child', { x: 3, y: 4, parentId: parent.id });

  vm.currentProcess = child;
  const fatherX = runtime.getPathNative('father', 'x');
  assert(fatherX === 10, `father.x esperado 10, obtido ${fatherX}`);

  runtime.setPathNative('father', 'x', 42);
  assert(parent.x === 42, `set father.x esperado parent.x=42, obtido ${parent.x}`);

  vm.currentProcess = parent;
  const sonX = runtime.getPathNative('son', 'x');
  assert(sonX === 3, `son.x esperado 3, obtido ${sonX}`);

  runtime.setPathNative('son', 'y', 77);
  assert(child.y === 77, `set son.y esperado child.y=77, obtido ${child.y}`);
}

// ── Regression tests for docs/review-2026-09.md, priority 1 ─────────────────

function readGlobal(vm, bytecode, name)
{
  return vm.globals.get(bytecode.globals[name]);
}

function runHeadless(source, ticks = 3)
{
  const bytecode = compileSource(source);
  const vm = new VM();
  vm.load(bytecode);
  const runtime = createRuntime(vm);
  const log = [];
  vm.registerNative('mark', (...args) =>
  {
    log.push(args.join(','));
    return 0;
  });
  for (let i = 0; i < ticks; i++)
  {
    runtime.beginFrame(1 / 60);
    vm.tick();
  }
  return { bytecode, vm, log };
}

async function testReturnInsideIfDoesNotFallThroughIntoNextBody()
{
  // P1.1: the implicit RETURN was skipped whenever the last emitted
  // instruction was a RETURN - even one nested in an IF - so the other
  // path ran straight into the next FUNCTION/PROCESS/MAIN.
  const { bytecode, vm, log } = runHeadless(`program fallthrough;
global r1 = -1; r2 = -1; runs = 0;

function f(a);
begin
  if (a > 0) return 1; end
end

function g(b);
begin
  mark('g ran');
  return 42;
end

function h(a);
begin
  if (a) r2 = 1; else return 2; end
end

process p();
begin
  if (runs > 100) return; end
end

process q();
begin
  mark('q ran');
end

begin
  runs = runs + 1;
  r1 = f(0);
  h(1);
  p();
end`);

  assert(readGlobal(vm, bytecode, 'r1') === 0, `f(0) devia devolver 0, obtido ${readGlobal(vm, bytecode, 'r1')}`);
  assert(readGlobal(vm, bytecode, 'r2') === 1, `h(1) devia pôr r2=1, obtido ${readGlobal(vm, bytecode, 'r2')}`);
  assert(readGlobal(vm, bytecode, 'runs') === 1, `corpo do MAIN devia correr 1 vez, correu ${readGlobal(vm, bytecode, 'runs')}`);
  assert(log.length === 0, `nenhum corpo alheio devia correr, log=${JSON.stringify(log)}`);
}

async function testValuelessReturnDoesNotConsumeCallerOperand()
{
  // P1.2: a FUNCTION without a return value left nothing on the stack and
  // RETURN popped the caller's pending operand instead.
  const { bytecode, vm, log } = runHeadless(`program void_return;
global r1; r2; r3;

function empty();
begin
end

function bare(n);
begin
  n = n + 1;
  return;
end

begin
  r1 = 10 - empty();
  r2 = 7 * (3 + bare(5));
  r3 = 100 + 7 * bare(3);
  mark(1, empty(), 3);
end`);

  assert(readGlobal(vm, bytecode, 'r1') === 10, `10 - empty() esperado 10, obtido ${readGlobal(vm, bytecode, 'r1')}`);
  assert(readGlobal(vm, bytecode, 'r2') === 21, `7 * (3 + bare(5)) esperado 21, obtido ${readGlobal(vm, bytecode, 'r2')}`);
  assert(readGlobal(vm, bytecode, 'r3') === 100, `100 + 7 * bare(3) esperado 100, obtido ${readGlobal(vm, bytecode, 'r3')}`);
  assert(log[0] === '1,0,3', `argumentos do nativo esperados "1,0,3", obtido "${log[0]}"`);
  assert(vm.mainStack.length === 0, `stack do MAIN devia ficar vazia, size=${vm.mainStack.length}`);
}

async function testFrameInsideFunctionKeepsProcessFields()
{
  // P1.3: a process that yielded inside a FUNCTION had the function's
  // frame stored as its own locals, so its x/y became the function's
  // arguments and sync() wrote the id into the function's slot 5.
  const { bytecode, vm } = runHeadless(`program frame_in_function;
global result;

function waitf(a0, a1, a2, a3, a4, a5);
begin
  frame;
  frame;
  return a5;
end

process p();
begin
  x = 50;
  y = 60;
  result = waitf(1000, 2000, 3, 4, 5, 777);
  loop frame; end
end

begin
  p();
  loop frame; end
end`, 2);

  const p = getUserProcesses(vm)[0];
  assert(!!p, 'processo nao criado');
  assert(p.x === 50 && p.y === 60, `durante a funcao esperado x=50,y=60; obtido x=${p.x}, y=${p.y}`);

  for (let i = 0; i < 3; i++)
  {
    vm.tick();
  }
  assert(readGlobal(vm, bytecode, 'result') === 777, `waitf devia devolver 777, obtido ${readGlobal(vm, bytecode, 'result')}`);
  assert(p.x === 50 && p.y === 60, `depois da funcao esperado x=50,y=60; obtido x=${p.x}, y=${p.y}`);
  assert(p.locals[5] === p.id, `slot id do processo devia ser ${p.id}, obtido ${p.locals[5]}`);
}

async function testPathAssignmentStatementsDoNotLeakStack()
{
  // P1.4: statement-level assignments compiled to a native call
  // (__set_path / __set_process_field / __set_mouse_field) left the
  // native's result on the stack, growing it every frame.
  const { vm } = runHeadless(`program path_leak;

process kid();
begin
  loop frame; end
end

process p();
begin
  kid();
  loop
    son.x = son.x + 1;
    son.y += 1;
    scroll.x0 = 5;
    region.x = 1;
    mouse.x = 5;
    if ((son.x = 3) > 0) end
    frame;
  end
end

begin
  p();
  loop frame; end
end`, 20);

  const p = getUserProcesses(vm).find((proc) => proc.name === 'p');
  assert(!!p, 'processo p nao criado');
  assert(p.stack.length === 0, `stack do processo devia ficar vazia apos 20 ticks, size=${p.stack.length}`);
}

// ── Regression tests for docs/review-2026-09.md, priority 2 ─────────────────

function nextAnimationFrames(count)
{
  return new Promise((resolve) =>
  {
    let left = count;
    const step = () =>
    {
      left -= 1;
      if (left <= 0)
      {
        resolve();
        return;
      }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

function makeTestCanvas(width = 320, height = 200)
{
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  document.body.appendChild(canvas);
  return canvas;
}

// set_fps(60): one tick per display frame on the 60 Hz test browser, so
// "frames per animation frame" measures loop duplication (DIV's default
// 18 fps would tick only every third display frame).
const LOOPING_PROGRAM = `program lifecycle;
global n;
begin
  set_fps(60, 0);
  loop
    n = n + 1;
    frame;
  end
end`;

async function testWriteInsideLoopIsCappedAndWarns()
{
  // P2.7: every WRITE persists, so write() inside a LOOP added a text per
  // frame without limit and the frame rate collapsed.
  const bytecode = compileSource(`program write_loop;
begin
  loop
    write(0, 10, 10, 0, 'hello');
    frame;
  end
end`);
  const vm = new VM();
  vm.load(bytecode);
  const canvas = document.createElement('canvas');
  const logs = [];
  const runtime = new CanvasEngineRuntime({
    vm,
    ctx: canvas.getContext('2d'),
    width: 320,
    height: 200,
    maxTexts: 50,
    logFn: (line) => logs.push(line)
  });
  runtime.registerNatives();
  for (let i = 0; i < 200; i++)
  {
    runtime.beginFrame(1 / 60);
    vm.tick();
    runtime.render();
  }
  const texts = runtime.countPersistentTexts();
  assert(texts === 50, `textos persistentes deviam parar em 50, obtido ${texts}`);
  const warnings = logs.filter((line) => line.includes('texts already on screen'));
  assert(warnings.length === 1, `devia avisar exatamente 1 vez, avisou ${warnings.length}`);
  assert(runtime.writeNative(0, 0, 0, 0, 'x') === 0, 'write() acima do limite devia devolver 0');
  runtime.dispose();
}

// DIV angles grow counter-clockwise with 90000 pointing up (manual 8.7 and
// the ANGLE local's description): a graphic drawn facing right is shown
// facing up at angle 90000, advance() moves it up, get_disty is negative
// for it, and get_distx/get_disty take (angle, distance). The engine used
// to rotate clockwise, so tutor1b's ship turned right on the left key and
// a ship drawn facing right flew sideways/backwards.
async function testAnglesFollowDivConvention()
{
  const bytecode = compileSource(`program angles;
global dx; dy; fa; mx; my; rx; ry;
process arrow();
begin
  x = 100; y = 100; angle = 90000;
  graph = new_graphic(21, 5);
  gfx_fill_rgba(graph, 0, 0, 0, 0);
  gfx_rect(graph, 16, 0, 5, 5, 255, 255, 255);   // the tip, on the right
  loop frame; end
end
process mover();
begin
  x = 200; y = 100; angle = 90000;
  advance(10);
  mx = x; my = y;
  loop frame; end
end
begin
  dx = get_distx(90000, 10);
  dy = get_disty(90000, 10);
  fa = fget_angle(0, 0, 0, -10);
  arrow();
  mover();
  loop frame; end
end`);
  const vm = new VM();
  vm.load(bytecode);
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 200;
  const runtime = new CanvasEngineRuntime({ vm, ctx: canvas.getContext('2d'), width: 320, height: 200, clearColor: '#000' });
  runtime.registerNatives();
  for (let i = 0; i < 3; i++)
  {
    runtime.beginFrame(1 / 60);
    vm.tick();
    runtime.render();
  }
  const read = (name) => Number(vm.globals.get(bytecode.globals[name]));
  assert(approx(read('dx'), 0, 1e-9), `get_distx(90000, 10) esperado 0, obtido ${read('dx')}`);
  assert(approx(read('dy'), -10, 1e-9), `get_disty(90000, 10) esperado -10, obtido ${read('dy')}`);
  assert(approx(read('fa'), 90000, 1e-6), `fget_angle para cima esperado 90000, obtido ${read('fa')}`);
  assert(approx(read('mx'), 200, 1e-9) && approx(read('my'), 90, 1e-9),
    `advance(10) a 90000 devia subir para (200,90), obtido (${read('mx')},${read('my')})`);

  const lit = (px, py) => runtime.ctx.getImageData(px, py, 1, 1).data[0] > 128;
  assert(lit(100, 92), 'a ponta desenhada a direita devia aparecer acima do centro com angle=90000');
  assert(!lit(100, 108), 'com angle=90000 a ponta nao devia aparecer abaixo do centro');
  assert(!lit(108, 100), 'com angle=90000 a ponta nao devia continuar a direita do centro');
  runtime.dispose();
}

async function testCompileErrorsAreStructuredWithLineAndColumn()
{
  // P2.9: compile errors were plain Errors with the location only inside
  // the message text, in two different formats, and some had none at all.
  const cases = [
    { label: 'lexer: unexpected character', stage: 'lexer', line: 3, col: 9, source: 'program t;\nbegin\n  x = 1 @ 2;\nend' },
    { label: 'lexer: unterminated string', stage: 'lexer', line: 3, col: 7, source: 'program t;\nbegin\n  say("abc);\nend' },
    // A missing ';' is reported right after "a = 1", not at the next line.
    { label: 'parser: missing ;', stage: 'parser', line: 4, col: 8, source: 'program t;\nglobal a;\nbegin\n  a = 1\n  a = 2;\nend' },
    { label: 'parser: ++ on an assignment', stage: 'parser', line: 4, col: 8, source: 'program t;\nglobal a; b;\nbegin\n  a = b++;\nend' },
    { label: 'compiler: unknown variable', stage: 'compiler', line: 3, col: 7, source: 'program t;\nbegin\n  a = zz;\nend' },
    { label: 'compiler: unknown struct field', stage: 'compiler', line: 4, col: 3, source: 'program t;\nstruct s[1] a; end\nbegin\n  s[0].zz = 1;\nend' },
    { label: 'compiler: struct array field without index', stage: 'compiler', line: 4, col: 3, source: 'program t;\nstruct s[1] a[3]; end\nbegin\n  s[0].a = 1;\nend' },
    { label: 'compiler: OFFSET of a non-global', stage: 'compiler', line: 3, col: 17, source: 'program t;\nbegin\n  write(0,0,0,0,OFFSET nope);\nend' }
  ];

  for (const { label, stage, line, col, source } of cases)
  {
    let error = null;
    try
    {
      compileSource(source);
    }
    catch (err)
    {
      error = err;
    }
    assert(error !== null, `${label}: devia ter falhado a compilar`);
    assert(error instanceof DivError, `${label}: devia ser DivError, obtido ${error.name}`);
    assert(error.stage === stage, `${label}: stage esperado ${stage}, obtido ${error.stage}`);
    assert(error.line === line && error.col === col,
      `${label}: posicao esperada ${line}:${col}, obtido ${error.line}:${error.col} (${error.message})`);
    assert(error.message === `${error.reason} at ${line}:${col}`,
      `${label}: mensagem devia ser "<motivo> at L:C", obtido ${JSON.stringify(error.message)}`);
  }
}

async function testRunDivDemoRestartDoesNotDoubleTheLoop()
{
  // P2.1: start() while running (or stop(); start()) left the previous
  // RAF loop alive next to the new one, ticking the VM twice per frame.
  const canvas = makeTestCanvas();
  let frames = 0;
  const runner = runDivDemo({ canvas, source: LOOPING_PROGRAM, onFrame: () => { frames += 1; } });
  try
  {
    await nextAnimationFrames(3);
    runner.start();
    runner.stop();
    runner.start();
    runner.start();
    await nextAnimationFrames(2);
    frames = 0;
    await nextAnimationFrames(20);
    assert(frames <= 21, `esperado no maximo 1 frame por animation frame (<=21), obtido ${frames}`);
    assert(frames >= 15, `o programa devia continuar a correr, obtido ${frames} frames`);
  }
  finally
  {
    runner.destroy();
    canvas.remove();
  }
}

async function testRunDivDemoReleasesMouseListenersOfReplacedRuntime()
{
  // P2.2: each runtime added 4 mouse listeners to the canvas and nothing
  // ever removed them, keeping every previous VM alive.
  const canvas = makeTestCanvas();
  const runner = runDivDemo({ canvas, source: LOOPING_PROGRAM });
  try
  {
    const first = runner.getState().runtime;
    assert(first._mouseListeners.length === 5, `runtime devia registar 5 listeners, tem ${first._mouseListeners.length}`);
    runner.start();
    const second = runner.getState().runtime;
    assert(first !== second, 'start() devia criar um runtime novo');
    assert(first._mouseListeners.length === 0, `runtime substituido devia largar os listeners, tem ${first._mouseListeners.length}`);
    runner.destroy();
    assert(second._mouseListeners.length === 0, `destroy() devia largar os listeners, tem ${second._mouseListeners.length}`);
  }
  finally
  {
    runner.destroy();
    canvas.remove();
  }
}

async function testMouseMapsOntoVirtualScreen()
{
  // P2.8: with virtualWidth/virtualHeight the mouse listeners sat on the
  // offscreen canvas, which never receives events, so the mouse read 0,0.
  const canvas = makeTestCanvas(640, 400);
  canvas.style.width = '640px';
  canvas.style.height = '400px';
  const runner = runDivDemo({ canvas, source: LOOPING_PROGRAM, virtualWidth: 320, virtualHeight: 200 });
  try
  {
    const runtime = runner.getState().runtime;
    const rect = canvas.getBoundingClientRect();
    const init = { clientX: rect.left + 200, clientY: rect.top + 120, button: 0, bubbles: true };
    canvas.dispatchEvent(new MouseEvent('mousemove', init));
    canvas.dispatchEvent(new MouseEvent('mousedown', init));
    assert(runtime._mouse.x === 100 && runtime._mouse.y === 60,
      `rato devia mapear para (100,60) no ecra virtual 320x200, obtido (${runtime._mouse.x},${runtime._mouse.y})`);
    assert(runtime._mouse.buttons[0] === true, 'botao esquerdo devia estar carregado');
  }
  finally
  {
    runner.destroy();
    canvas.remove();
  }
}

// mouse.left/middle/right use mouse_button's numbering (0 left, 1 middle,
// 2 right, as the browser's MouseEvent.button): mouse.right used to read
// the middle button. A click that starts and ends between two frames is
// still seen for one frame, and the browser's context menu does not open
// over the program (the right button is game input).
async function testMouseButtonsAndShortClicks()
{
  const bytecode = compileSource(`program mouse_buttons;
global l; m; r; clicks;
begin
  loop
    l = mouse.left; m = mouse.middle; r = mouse.right;
    if (mouse.left) clicks = clicks + 1; end
    frame;
  end
end`);
  const canvas = makeTestCanvas();
  const vm = new VM();
  vm.load(bytecode);
  const runtime = new CanvasEngineRuntime({ vm, ctx: canvas.getContext('2d'), width: 320, height: 200 });
  runtime.registerNatives();
  const read = (name) => Number(vm.globals.get(bytecode.globals[name]));
  const step = () =>
  {
    runtime.beginFrame(1 / 60);
    vm.tick();
  };
  const fire = (type, button) =>
  {
    const rect = canvas.getBoundingClientRect();
    const event = new MouseEvent(type, { clientX: rect.left + 10, clientY: rect.top + 10, button, bubbles: true, cancelable: true });
    canvas.dispatchEvent(event);
    return event;
  };
  try
  {
    step();
    fire('mousedown', 2);
    step();
    assert(read('r') === 1 && read('m') === 0 && read('l') === 0,
      `botao direito: esperado r=1 m=0 l=0, obtido r=${read('r')} m=${read('m')} l=${read('l')}`);
    fire('mouseup', 2);
    fire('mousedown', 1);
    step();
    assert(read('m') === 1 && read('r') === 0, `botao do meio: esperado m=1 r=0, obtido m=${read('m')} r=${read('r')}`);
    fire('mouseup', 1);
    step();

    // A click shorter than a frame: down and up before the next tick.
    fire('mousedown', 0);
    fire('mouseup', 0);
    step();
    assert(read('clicks') === 1, `um clique curto devia contar 1 frame, contou ${read('clicks')}`);
    step();
    assert(read('clicks') === 1, `o clique curto so devia contar uma vez, contou ${read('clicks')}`);

    const menu = fire('contextmenu', 2);
    assert(menu.defaultPrevented, 'o menu de contexto do browser nao devia abrir sobre o jogo');
  }
  finally
  {
    runtime.dispose();
    canvas.remove();
  }
}

// Files that come with the program (playground uploads, a packed game's
// embedded files) are read before any URL: by whole path or by file name,
// case-insensitively and with either slash, as DOS-era DIV programs name
// them. A name that is not a project file is still fetched as a URL.
async function testProjectFilesAreLoadedBeforeUrls()
{
  const fpgBytes = new Uint8Array(await (await fetch('../assets/div-support/tutor0.fpg')).arrayBuffer());
  const pngBlob = await (await fetch('../assets/001.png')).blob();
  const bytecode = compileSource(`program files;
global f; g; missing;
begin
  f = load_fpg("c:/games/SHIP.fpg");
  g = load_graphic("./img/hero.png");
  missing = load_fpg("not-a-project-file.fpg");
  loop frame; end
end`);
  const vm = new VM();
  vm.load(bytecode);
  const logs = [];
  const runtime = new CanvasEngineRuntime({
    vm,
    ctx: document.createElement('canvas').getContext('2d'),
    width: 320,
    height: 200,
    files: { 'Ship.FPG': fpgBytes, 'IMG\\Hero.png': pngBlob },
    logFn: (line) => logs.push(line)
  });
  runtime.registerNatives();
  try
  {
    runtime.beginFrame(1 / 60);
    vm.tick();
    await Promise.allSettled(runtime.pendingLoads);
    const read = (name) => Number(vm.globals.get(bytecode.globals[name]));

    const library = runtime.graphLibraries.get(read('f'));
    assert(library && library.loaded && library.graphs.size > 0,
      `o FPG do projeto devia carregar pelo nome do ficheiro, erro: ${library?.error}`);

    const graphic = runtime.graphics.get(read('g'));
    for (let i = 0; i < 50 && !graphic.loaded; i++)
    {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert(graphic.loaded && graphic.image.naturalWidth > 0, 'o PNG do projeto devia carregar pelo caminho (IMG\\Hero.png)');
    assert(graphic.image.src.startsWith('blob:'), `o PNG devia vir do ficheiro do projeto, veio de ${graphic.image.src}`);

    const missing = runtime.graphLibraries.get(read('missing'));
    assert(missing.error && logs.some((line) => line.includes('not-a-project-file.fpg')),
      'um nome que nao e ficheiro do projeto devia ser pedido como URL (e falhar aqui)');

    assert(CanvasEngineRuntime.normalizeAssetPath('.\\GFX\\Ship.FPG') === 'gfx/ship.fpg',
      `normalizeAssetPath: obtido ${CanvasEngineRuntime.normalizeAssetPath('.\\GFX\\Ship.FPG')}`);
  }
  finally
  {
    runtime.dispose();
  }
  assert([...runtime._files.values()].every((entry) => !entry.owned), 'dispose() devia revogar os object URLs criados');
}

// Physics (vm/physics.js, Planck.js): bodies fall, land and stack on an
// edge, report contacts by TYPE and how hard they were hit, move in
// pixels and DIV angles, follow a script that moves their process, pin
// to a point, and go away with their process.
async function testPhysicsBodiesFallStackAndCollide()
{
  const bytecode = compileSource(`program phys;
global low_y; high_y; touching; impact; spun; slid; tele_x; pend_d; bodies_before; bodies_after; low_id;
process ground();
begin
  x = 160; y = 190;
  phys_edge(-160, 0, 160, 0);
  loop frame; end
end
process crate(x, y, low);
begin
  phys_box(20, 20, phys_dynamic);
  phys_material(1, 0.8, 0);
  loop
    if (low)
      low_y = y;
      if (phys_contact(type ground)) touching = 1; end
      if (phys_impact() > impact) impact = phys_impact(); end
    else
      high_y = y;
    end
    frame;
  end
end
process spinner();
begin
  x = 40; y = 40;
  phys_circle(5, phys_kinematic);
  phys_spin(90000);                 // 90 degrees a second, counter-clockwise
  loop spun = angle; frame; end
end
process slider();
begin
  x = 20; y = 60;
  phys_box(8, 8, phys_kinematic);
  phys_velocity(100, 0);            // 100 px a second to the right
  loop slid = x; frame; end
end
process teleported();
begin
  x = 280; y = 20;
  phys_box(8, 8, phys_kinematic);
  frame;
  x = 250;                          // moved by the script: the body follows
  loop tele_x = x; frame; end
end
process bob();
begin
  x = 300; y = 100;
  phys_circle(4, phys_dynamic);
  phys_pin(0, 300, 60);             // hangs 40 px below a pin at (300, 60)
  loop pend_d = fget_distance(x, y, 300, 60); frame; end
end
begin
  set_fps(60, 0);
  ground();
  low_id = crate(160, 100, 1);
  crate(162, 60, 0);
  spinner(); slider(); teleported(); bob();
  frame(6000);                      // 60 frames at 60 fps = 1 s
  bodies_before = phys_bodies();
  signal(low_id, s_kill);
  frame;
  frame;
  bodies_after = phys_bodies();
  loop frame; end
end`);
  const vm = new VM();
  vm.load(bytecode);
  const runtime = new CanvasEngineRuntime({ vm, ctx: document.createElement('canvas').getContext('2d'), width: 320, height: 200 });
  runtime.registerNatives();
  const read = (name) => Number(vm.globals.get(bytecode.globals[name]));
  let maxPend = 0;
  let minPend = 1e9;
  let lowY = 0;
  let highY = 0;
  let spun = 0;
  let slid = 0;
  try
  {
    for (let i = 0; i < 70; i++)
    {
      runtime.beginFrame(1 / 60);
      vm.tick();
      if (i > 5)
      {
        maxPend = Math.max(maxPend, read('pend_d'));
        minPend = Math.min(minPend, read('pend_d'));
      }
      if (i === 58)
      {
        // Settled, and before MAIN kills the lower crate at 1 s.
        lowY = read('low_y');
        highY = read('high_y');
        spun = read('spun');
        slid = read('slid');
      }
    }
    assert(Math.abs(lowY - 180) < 1.5, `a caixa de 20 px devia pousar no chao (y 190) com o centro em ~180, esta em ${lowY}`);
    assert(Math.abs(highY - 160) < 2, `a segunda caixa devia ficar em cima da primeira (~160), esta em ${highY}`);
    assert(read('touching') === 1, 'phys_contact(type ground) devia ver o chao');
    assert(read('impact') > 50, `phys_impact devia medir a queda (px/s), mediu ${read('impact')}`);
    // 58 steps of 1/60 s after the bodies were made (one step either way).
    assert(Math.abs(spun - 58 * 1500) <= 1500, `phys_spin(90000) em 58 passos devia rodar ~87000 (anti-horario), rodou ${spun}`);
    assert(Math.abs(slid - (20 + 58 * 100 / 60)) <= 100 / 60 + 0.01, `phys_velocity(100, 0) em 58 passos devia levar x a ~116.7, x = ${slid}`);
    assert(Math.abs(read('tele_x') - 250) < 0.5, `o corpo devia seguir o processo movido pelo script (250), esta em ${read('tele_x')}`);
    assert(Math.abs(maxPend - 40) < 1 && Math.abs(minPend - 40) < 1, `o pendulo devia manter 40 px do pino, variou ${minPend}..${maxPend}`);
    for (let i = 0; i < 5; i++)
    {
      runtime.beginFrame(1 / 60);
      vm.tick();
    }
    assert(read('bodies_before') === 7 && read('bodies_after') === 6,
      `matar um processo devia remover o seu corpo: ${read('bodies_before')} -> ${read('bodies_after')}`);
  }
  finally
  {
    runtime.dispose();
  }
  assert(runtime.physics.bodyCount === 0, 'dispose() devia remover todos os corpos');
}

// Physics, second round (from the Physics Lab's report): pins to the world
// share one anchor, a first phys_add_box makes a dynamic body, a material
// given before the body applies, another process's body can be driven by
// id, body types change, welds, rods of a given length, slack ropes, joint
// limits and motors, point and ray queries, sleeping; and min/max natives
// that a program's own FUNCTION min still overrides.
async function testPhysicsSecondRound()
{
  const bytecode = compileSource(`program phys2;
global kin_id; typed_id; hx; hy; ray_id; box_id; at_box; at_none;
       weld_d0; weld_d; mass2; rope_d; slack_y; motor_a; limit_min; limit_max;
       add_y; min3; max3; awake_end; welded_id; slack_id; awake_kin; awake_hanging;
process pendulum(x, y);
begin
  phys_circle(3);
  phys_pin(0, x, y - 20);
  loop frame; end
end
process added(x, y);
begin
  phys_add_box(0, 0, 10, 10);       // first shape through phys_add_box: dynamic
  loop add_y = y; frame; end
end
process heavy(x, y);
begin
  phys_material(2, 0.5, 0);         // before the body: applies to it
  phys_box(32, 32);                 // 1 m x 1 m at 32 px/m, density 2 -> 2 kg
  mass2 = phys_mass();
  loop frame; end
end
process kin(x, y);
begin
  phys_box(8, 8, phys_kinematic);
  loop frame; end
end
process typed(x, y);
begin
  phys_box(8, 8, phys_static);
  loop frame; end
end
process target(x, y);
begin
  phys_box(40, 40, phys_static);
  loop frame; end
end
process wbox(x, y, other);
begin
  phys_box(10, 10);
  phys_material(1, 0.5, 0);
  if (other) phys_weld(other); end
  loop frame; end
end
process rod_end(x, y, other, len);
begin
  phys_circle(3);
  phys_rope(other, len);
  loop rope_d = fget_distance(x, y, other.x, other.y); frame; end
end
process slack_end(x, y, other);
begin
  phys_circle(3);
  phys_slack(other, 50);
  loop slack_y = y; frame; end
end
process peg(x, y);
begin
  phys_circle(2, phys_static);
  loop frame; end
end
process wheel(x, y);
private j;
begin
  phys_circle(10);
  j = phys_pin(0, x, y);
  phys_motor(j, 90000, 1000);       // a quarter turn a second
  loop motor_a = angle; frame; end
end
process arm(x, y);
private j;
begin
  phys_box(40, 4);                  // pinned at its left end, falls clockwise
  j = phys_pin(0, x - 20, y);
  phys_limits(j, -20000, 60000);    // may only hang 20 degrees down (lifts up to 60)
  loop
    if (angle < limit_min) limit_min = angle; end
    if (angle > limit_max) limit_max = angle; end
    frame;
  end
end
private a; b;
begin
  set_fps(60, 0);
  x = 0; y = 0;
  from a = 1 to 10; pendulum(20 + a * 12, 60); end
  added(300, 20);
  heavy(300, 120);
  kin_id = kin(20, 180);
  typed_id = typed(100, 180);
  box_id = target(200, 150);
  a = wbox(250, 20, 0);
  welded_id = wbox(262, 20, a);
  b = peg(150, 20);
  rod_end(150, 60, b, 25);
  slack_id = slack_end(180, 20, peg(180, 10));
  wheel(60, 150);
  arm(260, 180);
  min3 = min(3, 1, 2);
  max3 = max(3, 1, 2);
  frame;
  weld_d0 = fget_distance(a.x, a.y, welded_id.x, welded_id.y);
  phys_velocity(120, 0, kin_id);    // drive another process's body
  phys_type(phys_dynamic, typed_id);
  at_box = phys_at(205, 145);
  at_none = phys_at(5, 195);
  ray_id = phys_raycast(0, 135, 320, 135, offset hx, offset hy);   // above the wheel, through the box
  frame(6000);
  weld_d = fget_distance(a.x, a.y, welded_id.x, welded_id.y);
  frame(18000);
  awake_end = phys_awake(box_id);   // static: never simulated
  awake_kin = phys_awake(kin_id);   // kinematic, still moving
  awake_hanging = phys_awake(slack_id);   // dynamic, hanging still for seconds
  loop frame; end
end`);
  const vm = new VM();
  vm.load(bytecode);
  const runtime = new CanvasEngineRuntime({ vm, ctx: document.createElement('canvas').getContext('2d'), width: 320, height: 200 });
  runtime.registerNatives();
  const read = (name) => Number(vm.globals.get(bytecode.globals[name]));
  const proc = (id) => vm.processManager.get(id);
  let kinStart = null;
  try
  {
    for (let i = 0; i < 70; i++)
    {
      runtime.beginFrame(1 / 60);
      vm.tick();
      if (i === 1)
      {
        kinStart = proc(read('kin_id')).x;
      }
    }
    const planckBodies = runtime.physics.world.getBodyCount();
    assert(planckBodies === runtime.physics.bodyCount + 1,
      `10 pinos ao mundo deviam partilhar 1 ancora: Planck tem ${planckBodies} corpos para ${runtime.physics.bodyCount} processos`);
    assert(read('add_y') > 40, `um corpo feito por phys_add_box devia ser dinamico e cair, y = ${read('add_y')}`);
    assert(Math.abs(read('mass2') - 2) < 0.01, `phys_material antes de phys_box devia dar 2 kg, deu ${read('mass2')}`);
    assert(proc(read('kin_id')).x - kinStart > 90, `phys_velocity(..., id) devia mover o outro processo ~120 px/s, moveu ${proc(read('kin_id')).x - kinStart}`);
    assert(proc(read('typed_id')).y > 181, `phys_type(phys_dynamic, id) devia deixar cair o corpo, y = ${proc(read('typed_id')).y}`);
    assert(read('at_box') === read('box_id') && read('at_none') === 0, `phys_at: ${read('at_box')} (esperado ${read('box_id')}), vazio ${read('at_none')}`);
    assert(read('ray_id') === read('box_id') && Math.abs(read('hx') - 180) < 0.5 && Math.abs(read('hy') - 135) < 0.5,
      `phys_raycast devia bater na face esquerda da caixa (180,135): id ${read('ray_id')}, (${read('hx')}, ${read('hy')})`);
    assert(Math.abs(read('weld_d') - read('weld_d0')) < 0.5, `phys_weld devia manter a distancia ${read('weld_d0')}, esta ${read('weld_d')}`);
    assert(Math.abs(read('rope_d') - 25) < 0.5, `phys_rope(id, 25) devia manter 25 px, mantem ${read('rope_d')}`);
    assert(Math.abs(read('slack_y') - 60) < 1, `phys_slack(id, 50) devia deixar cair ate 50 px abaixo do pino (y 60), y = ${read('slack_y')}`);
    assert(Math.abs(read('motor_a') - 90000 * 68 / 60) < 6000, `phys_motor a 90000/s durante ~68 passos devia rodar ~102000, rodou ${read('motor_a')}`);
    // Box2D lets a limit give a few degrees when a fall hits it; the wrong
    // sign would let the arm hang to -60000.
    assert(read('limit_min') > -26000 && read('limit_min') < -18000,
      `phys_limits(-20000, 60000) devia parar o braco que cai perto de -20000, parou em ${read('limit_min')}`);
    assert(read('min3') === 1 && read('max3') === 3, `min/max nativos: ${read('min3')} ${read('max3')}`);
    for (let i = 0; i < 260; i++)
    {
      runtime.beginFrame(1 / 60);
      vm.tick();
    }
    assert(read('awake_end') === 0, 'phys_awake de um corpo estatico devia ser 0');
    assert(read('awake_kin') === 1, 'phys_awake de um corpo em movimento devia ser 1');
    assert(read('awake_hanging') === 0, 'phys_awake de um corpo dinamico parado ha segundos devia ser 0 (a dormir)');
  }
  finally
  {
    runtime.dispose();
  }

  // A program's own FUNCTION min wins over the native.
  const own = compileSource(`program own_min;
global r;
function min(a, b);
begin
  return 42;
end
begin
  r = min(1, 2);
  loop frame; end
end`);
  const vm2 = new VM();
  vm2.load(own);
  const rt2 = new CanvasEngineRuntime({ vm: vm2, ctx: document.createElement('canvas').getContext('2d'), width: 320, height: 200 });
  rt2.registerNatives();
  rt2.beginFrame(1 / 60);
  vm2.tick();
  assert(Number(vm2.globals.get(own.globals.r)) === 42, 'a FUNCTION min do programa devia ganhar ao nativo');
  rt2.dispose();
}

async function testKeysTypedIntoEditableElementsAreNotSwallowed()
{
  // P2.3: window-level key handling called preventDefault and fed the
  // game regardless of focus, so an editor on the same page lost Space
  // and the arrow keys.
  const canvas = makeTestCanvas();
  const textarea = document.createElement('textarea');
  document.body.appendChild(textarea);
  const runner = runDivDemo({ canvas, source: LOOPING_PROGRAM });
  try
  {
    const runtime = runner.getState().runtime;

    const inEditor = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
    textarea.dispatchEvent(inEditor);
    assert(!inEditor.defaultPrevented, 'espaco escrito na textarea nao devia ser bloqueado');
    assert(!runtime.keys[' '], 'espaco escrito na textarea nao devia chegar ao jogo');

    const inGame = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
    document.body.dispatchEvent(inGame);
    assert(inGame.defaultPrevented, 'espaco fora de campos editaveis devia continuar bloqueado');
    assert(runtime.keys[' '] === true, 'espaco fora de campos editaveis devia chegar ao jogo');

    // A key released after focus moved into the editor must not stay held.
    textarea.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', bubbles: true }));
    assert(runtime.keys[' '] === false, 'keyup vindo da textarea devia soltar a tecla');
  }
  finally
  {
    runner.destroy();
    textarea.remove();
    canvas.remove();
  }
}

async function testRestartRestoresCanvasSizeAfterSetMode()
{
  // P2.4: set_mode() resized the canvas and the next program started on
  // the same canvas inherited that size.
  const canvas = makeTestCanvas(320, 200);
  const runner = runDivDemo({ canvas, source: `program a;
begin
  set_mode(160, 100);
  loop frame; end
end` });
  try
  {
    await nextAnimationFrames(3);
    assert(canvas.width === 160 && canvas.height === 100, `set_mode devia aplicar 160x100, obtido ${canvas.width}x${canvas.height}`);
    runner.start(LOOPING_PROGRAM);
    assert(canvas.width === 320 && canvas.height === 200, `reinicio devia repor 320x200, obtido ${canvas.width}x${canvas.height}`);
    const runtime = runner.getState().runtime;
    assert(runtime.width === 320 && runtime.height === 200, `runtime devia arrancar a 320x200, obtido ${runtime.width}x${runtime.height}`);
  }
  finally
  {
    runner.destroy();
    canvas.remove();
  }
}

async function testRuntimesDoNotShareGraphicsOrPivotResolver()
{
  // P2.4/P2.5: a module-global graphics registry and pivot resolver let a
  // second runtime on the page see the first one's graphics and move its
  // collision shapes.
  const vmA = new VM();
  vmA.load(compileSource(LOOPING_PROGRAM));
  const runtimeA = createRuntime(vmA);
  const vmB = new VM();
  vmB.load(compileSource(LOOPING_PROGRAM));
  const runtimeB = createRuntime(vmB);

  assert(runtimeA.graphics !== runtimeB.graphics, 'cada runtime devia ter o seu registo de graficos');
  const id = runtimeA.newGraphicNative(10, 10);
  assert(!!runtimeA.graphics.get(id), 'grafico devia existir no runtime A');
  assert(!runtimeB.graphics.get(id), 'grafico do runtime A nao devia aparecer no runtime B');

  const resolverA = vmA.processManager.pivotResolver;
  const resolverB = vmB.processManager.pivotResolver;
  assert(typeof resolverA === 'function' && typeof resolverB === 'function', 'cada ProcessManager devia ter o seu pivotResolver');
  assert(resolverA !== resolverB, 'os pivotResolver dos dois runtimes deviam ser diferentes');
  runtimeA.dispose();
  runtimeB.dispose();
}

async function testPendingLoadThatNeverSettlesDoesNotFreezeTheProgram()
{
  // P2.6: the frame waited on pending loads with no timeout, so one fetch
  // that never answered froze the program for good.
  const canvas = makeTestCanvas();
  let frames = 0;
  const logs = [];
  let injected = false;
  const runner = runDivDemo({
    canvas,
    source: LOOPING_PROGRAM,
    loadHoldTimeoutMs: 100,
    onLog: (line) => logs.push(line),
    onFrame: ({ runtime }) =>
    {
      frames += 1;
      if (!injected)
      {
        injected = true;
        runtime.pendingLoads.push(new Promise(() => {}));
      }
    }
  });
  try
  {
    await new Promise((resolve) => setTimeout(resolve, 400));
    assert(frames > 3, `o programa devia continuar depois do timeout, obtido ${frames} frames`);
    assert(logs.some((line) => line.includes('still loading')), 'devia avisar que o timeout expirou');
  }
  finally
  {
    runner.destroy();
    canvas.remove();
  }
}

// Online play (vm/net.js). Two engines running the same program, joined
// by an in-memory link that holds messages until the test delivers them
// (a network with as much latency as the test wants). Checked: in
// lockstep both simulations stay identical (positions, key_pressed-style
// edges, the shared random seed) although each side presses only its own
// keys; a side that starts lockstep later keeps the input the other side
// already sent; a frame waits for the other player's input; a state that
// drifts is reported as a desync; messages arrive in order with their
// type, value and sender; connection codes round-trip.
const NET_TEST_PROGRAM = `program nettest;
global p0x; p1y; jumps; sum; started; frames;
process player(n);
begin
  loop
    if (n == 0)
      if (net_key(0, _right)) x = x + 2; end
      if (net_key(0, _left)) x = x - 2; end
      p0x = x;
    else
      if (net_key(1, _up)) y = y - 3; end
      if (net_key_pressed(1, _space)) jumps = jumps + 1; end
      p1y = y;
    end
    frame;
  end
end
begin
  set_fps(60, 0);
  while (net_status() != 2) frame; end
  net_start(2);
  while (not net_running()) frame; end
  started = 1;
  player(0);
  player(1);
  loop
    sum = sum + rand(0, 1000);
    frames = frames + 1;
    frame;
  end
end`;

function makeNetPeer(bytecode)
{
  const vm = new VM();
  vm.load(bytecode);
  const runtime = new CanvasEngineRuntime({ vm, ctx: document.createElement('canvas').getContext('2d'), width: 320, height: 200, logFn: () => {} });
  runtime.registerNatives();
  return { vm, runtime, net: runtime.net, outbox: [] };
}

function linkNetPeers(a, b)
{
  a.net.me = 0;
  b.net.me = 1;
  a.net.connected({ send: (m) => a.outbox.push(JSON.parse(JSON.stringify(m))), close: () => {} });
  b.net.connected({ send: (m) => b.outbox.push(JSON.parse(JSON.stringify(m))), close: () => {} });
}

// Delivers everything `from` has sent so far to `to`.
function deliverNet(from, to)
{
  const batch = from.outbox.splice(0, from.outbox.length);
  for (const message of batch)
  {
    to.net.receive(message);
  }
}

// One display frame of the host loop in divjs.js; true if the game frame ran.
function netDisplayFrame(peer)
{
  if (!peer.net.beforeFrame(peer.runtime))
  {
    return false;
  }
  peer.runtime.beginFrame(1 / 60);
  peer.vm.tick();
  peer.net.afterFrame(peer.vm);
  return true;
}

// Lockstep lets one side run up to `delay` frames ahead; states are only
// comparable at the same frame, so run the side that is behind.
function levelNetPeers(a, b)
{
  for (let i = 0; i < 20 && a.net.lock.frame !== b.net.lock.frame; i++)
  {
    deliverNet(a, b);
    deliverNet(b, a);
    netDisplayFrame(a.net.lock.frame < b.net.lock.frame ? a : b);
  }
  assert(a.net.lock.frame === b.net.lock.frame, `os dois lados deviam chegar ao mesmo frame: ${a.net.lock.frame}/${b.net.lock.frame}`);
}

async function testNetLockstepKeepsBothGamesIdentical()
{
  const bytecode = compileSource(NET_TEST_PROGRAM);
  const a = makeNetPeer(bytecode);
  const b = makeNetPeer(bytecode);
  const read = (peer, name) => Number(peer.vm.globals.get(bytecode.globals[name]));
  try
  {
    // Before lockstep: messages, both ways, in order.
    linkNetPeers(a, b);
    assert(a.net.status === NET_CONNECTED && a.net.players === 2, 'o anfitriao devia ficar ligado com 2 jogadores');
    a.net.sendMessage(7, 'ola');
    a.net.sendMessage(8, 2.5);
    b.net.sendMessage(3, 42);
    deliverNet(a, b);
    deliverNet(b, a);
    assert(b.net.nextMessage() === 1 && b.net.current.type === 7 && b.net.current.value === 'ola' && b.net.current.from === 0,
      `primeira mensagem errada: ${JSON.stringify(b.net.current)}`);
    assert(b.net.nextMessage() === 1 && b.net.current.type === 8 && b.net.current.value === 2.5, `segunda mensagem errada: ${JSON.stringify(b.net.current)}`);
    assert(b.net.nextMessage() === 0 && b.net.current === null, 'sem mais mensagens, net_receive devia dar 0');
    assert(a.net.nextMessage() === 1 && a.net.current.from === 1 && a.net.current.value === 42, `a mensagem do convidado devia chegar ao anfitriao: ${JSON.stringify(a.net.current)}`);

    // The host runs first: MAIN calls net_start, the host starts lockstep
    // and runs its first frames while the guest has not run at all. Its
    // input for the first frames is already on its way.
    let aRan = 0;
    for (let i = 0; i < 8; i++)
    {
      aRan += netDisplayFrame(a) ? 1 : 0;
    }
    assert(a.net.running, 'o anfitriao devia ter comecado o lockstep');
    assert(a.net.lock.frame === 2, `com atraso 2 o anfitriao so pode correr 2 frames sem o convidado, correu ${a.net.lock.frame}`);
    deliverNet(a, b);               // start + the host's inputs, all at once

    // Then both run, each pressing its own keys, with the link delivering
    // once every display frame (one frame of latency each way).
    for (let i = 0; i < 200; i++)
    {
      a.runtime.setKeyState('ArrowRight', i >= 10 && i < 40, 'ArrowRight');
      b.runtime.setKeyState('ArrowUp', i >= 20 && i < 30, 'ArrowUp');
      b.runtime.setKeyState(' ', i % 50 === 5, 'Space');
      netDisplayFrame(a);
      netDisplayFrame(b);
      deliverNet(a, b);
      deliverNet(b, a);
    }
    levelNetPeers(a, b);
    assert(read(a, 'started') === 1 && read(b, 'started') === 1, 'os dois lados deviam ter comecado o jogo');
    const fields = ['p0x', 'p1y', 'jumps', 'sum', 'frames'];
    const va = fields.map((f) => read(a, f));
    const vb = fields.map((f) => read(b, f));
    assert(JSON.stringify(va) === JSON.stringify(vb), `os dois jogos deviam ser iguais: anfitriao ${JSON.stringify(va)} convidado ${JSON.stringify(vb)}`);
    assert(va[0] === 60, `o jogador 0 carregou 30 frames para a direita (2 px cada): x = ${va[0]}`);
    assert(va[1] === -30, `o jogador 1 carregou 10 frames para cima (3 px cada): y = ${va[1]}`);
    assert(va[2] === 4, `o jogador 1 carregou 4 vezes no espaco: ${va[2]}`);
    assert(hashState(a.vm) === hashState(b.vm), 'o hash do estado devia ser igual nos dois lados');
    assert(a.net.status === NET_CONNECTED && b.net.status === NET_CONNECTED, `nenhum lado devia ver dessincronia: ${a.net.status}/${b.net.status}`);

    // A frame waits for the other player: with the link cut, the host can
    // only run the frames its input delay already covers.
    const before = a.net.lock.frame;
    let ran = 0;
    for (let i = 0; i < 10; i++)
    {
      ran += netDisplayFrame(a) ? 1 : 0;
    }
    assert(ran <= 2, `sem input do convidado o anfitriao devia esperar, correu ${ran} frames`);
    assert(a.net.lock.frame === before + ran, 'net_frame so avanca nos frames que correram');

    // A drift: one side's state changes behind the simulation's back.
    a.vm.globals.set(bytecode.globals.sum, read(a, 'sum') + 1);
    for (let i = 0; i < 150; i++)
    {
      netDisplayFrame(a);
      netDisplayFrame(b);
      deliverNet(a, b);
      deliverNet(b, a);
    }
    assert(a.net.status === NET_DESYNC && b.net.status === NET_DESYNC, `a dessincronia devia ser detetada nos dois lados: ${a.net.status}/${b.net.status}`);
    assert(a.vm.natives.get('net_status')() === 4, 'net_status() devia dar 4 (dessincronia)');
  }
  finally
  {
    a.runtime.dispose();
    b.runtime.dispose();
  }
  assert(a.net.status === 0 && !a.net.running, 'dispose() devia fechar a sessao');
}

async function testNetInputCaptureAndCodes()
{
  const vm = new VM();
  vm.load(compileSource('program t; begin loop frame; end end'));
  const runtime = createRuntime(vm);
  try
  {
    // A tap shorter than a lockstep frame still counts as a press.
    runtime.setKeyState('a', true, 'KeyA');
    runtime.setKeyState('a', false, 'KeyA');
    runtime.setKeyState('ArrowLeft', true, 'ArrowLeft');
    let input = runtime.captureNetInput();
    assert(input.pressed.has('a') && !input.down.has('a'), `um toque curto devia contar como carregado: ${[...input.pressed]}`);
    assert(input.down.has('arrowleft') && input.pressed.has('arrowleft'), 'a seta esquerda esta em baixo e acabou de ir abaixo');
    input = runtime.captureNetInput();
    assert(input.pressed.size === 0 && input.down.has('arrowleft'), 'a segunda leitura ja nao traz toques antigos');
    // Codes: compressed, prefixed, and checked.
    const value = { t: 'offer', sdp: 'v=0\r\n' + 'a=candidate:1 1 udp 2122260223 192.168.1.20 54321 typ host\r\n'.repeat(6) };
    const code = await encodeCode(value);
    assert(code.startsWith('DIVNET1.') && /^[A-Za-z0-9._-]+$/.test(code), `codigo com caracteres inesperados: ${code.slice(0, 40)}`);
    assert(code.length < JSON.stringify(value).length, 'o codigo devia ser comprimido');
    const back = await decodeCode(`  ${code}\n`);
    assert(back.t === 'offer' && back.sdp === value.sdp, 'o codigo devia voltar ao valor original');
    let rejected = false;
    try
    {
      await decodeCode('hello');
    }
    catch
    {
      rejected = true;
    }
    assert(rejected, 'um texto que nao e um codigo devia ser rejeitado');
  }
  finally
  {
    runtime.dispose();
  }
}

// net_close() while WebRTC is still gathering addresses (up to a few
// seconds) must not bring the invitation panel back afterwards.
async function testNetCloseDuringGatheringKeepsThePanelClosed()
{
  const { NetSession } = await import('../vm/net.js');
  const shown = [];
  const ui = { showHost: () => shown.push('host'), askJoin: () => {}, close: () => {}, error: (m) => shown.push(`error ${m}`) };
  const net = new NetSession({ ui, iceServers: [], log: () => {} });
  const hosting = net.hostWebRtc();
  // Close once the offer exists, while the addresses are being gathered.
  for (let i = 0; i < 100 && !(net.pc && net.pc.localDescription); i++)
  {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert(net.pc && net.pc.localDescription, 'a oferta devia existir');
  net.close();
  await Promise.race([hosting, new Promise((resolve) => setTimeout(resolve, 6000))]);
  assert(shown.length === 0, `o painel nao devia voltar depois de net_close: ${shown.join(', ')}`);
  assert(net.status === 0, `a sessao devia ficar parada, esta em ${net.status}`);
}

// Sound (vm/audio.js): every ready-made effect makes an audible sound
// that fades out, the same recipe and seed always make the same samples,
// notes and note lines are read right.
async function testAudioSynthesisAndNotes()
{
  const rms = (a) => Math.sqrt(a.reduce((sum, v) => sum + v * v, 0) / a.length);
  for (let kind = 0; kind <= 7; kind++)
  {
    const samples = synthesize(sfxRecipe(kind, 3));
    assert(samples.length > SAMPLE_RATE * 0.02, `sfx ${kind}: demasiado curto (${samples.length} amostras)`);
    assert(rms(samples) > 0.01, `sfx ${kind}: devia ouvir-se (rms ${rms(samples).toFixed(4)})`);
    assert(Math.max(...samples.map(Math.abs)) <= 1, `sfx ${kind}: satura`);
    const tail = samples.slice(-Math.floor(samples.length / 50));
    assert(rms(tail) < 0.02, `sfx ${kind}: devia acabar em silencio (rms final ${rms(tail).toFixed(4)})`);
    const again = synthesize(sfxRecipe(kind, 3));
    assert(again.length === samples.length && again.every((v, i) => v === samples[i]), `sfx ${kind}: a mesma semente devia dar o mesmo som`);
  }
  const a = synthesize(sfxRecipe(1, 1));
  const b = synthesize(sfxRecipe(1, 2));
  assert(a.length !== b.length || a.some((v, i) => v !== b[i]), 'sementes diferentes deviam dar sons diferentes');

  assert(Math.abs(noteFrequency('A4') - 440) < 1e-9, 'A4 = 440 Hz');
  assert(Math.abs(noteFrequency('C4') - 261.6256) < 0.001, `C4 = 261.63 Hz, deu ${noteFrequency('C4')}`);
  assert(Math.abs(noteFrequency('C#4') - noteFrequency('Db4')) < 1e-9, 'C#4 = Db4');
  assert(Math.abs(noteFrequency('A3') - 220) < 1e-9, 'A3 = 220 Hz');
  assert(noteFrequency('H2') === null && noteFrequency('x') === null, 'uma nota invalida devia dar null');

  const line = parseNotes('C4 - - . E4 | G4 -');
  assert(line.steps === 7, `7 passos, deu ${line.steps}`);
  assert(line.events.length === 3 && line.events[0].length === 3 && line.events[1].length === 1 && line.events[2].length === 2,
    `notas e duracoes: ${JSON.stringify(line.events.map((e) => [e.step, e.length]))}`);
  assert(line.events[1].step === 4 && line.events[2].step === 5, 'os passos contam tambem as pausas');
  const drums = parseNotes('k . h . ks . h .', true);
  assert(drums.steps === 8 && drums.events.length === 4 && drums.events[2].drums.join('') === 'ks', `bateria: ${JSON.stringify(drums.events)}`);
}

// A tiny 16-bit mono WAV file.
function makeWav(seconds, freq)
{
  const rate = 22050;
  const n = Math.round(rate * seconds);
  const bytes = new Uint8Array(44 + n * 2);
  const view = new DataView(bytes.buffer);
  const text = (offset, value) => [...value].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  text(0, 'RIFF'); view.setUint32(4, 36 + n * 2, true); text(8, 'WAVE');
  text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  text(36, 'data'); view.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++)
  {
    view.setInt16(44 + i * 2, Math.round(Math.sin(2 * Math.PI * freq * i / rate) * 12000), true);
  }
  return bytes;
}

// The natives: sfx ids are reused, a sound plays on its own channel and
// stops, a WAV from the project files loads (the frame waits for it) and
// plays, a song schedules notes, stops, and a song that does not loop ends.
async function testAudioNativesPlayLoadAndSong()
{
  const bytecode = compileSource(`program snd;
global coin; coin2; laser; tone; wav; ch; ch_wav; playing_after; song; track_n; playing_song;
begin
  coin = sfx(sfx_coin);
  coin2 = sfx(sfx_coin);
  laser = sfx(sfx_laser, 5);
  tone = sfx_tone(wave_sine, 440, 880, 100);
  wav = load_wav("beep.wav");
  frame;
  ch = sound(coin, 256, 256);
  ch_wav = play_sound(wav, 80, 100, -50);
  song = song_new(240);
  song_track(song, inst_square, "C5 E5 G5 C6");
  track_n = song_track(song, inst_drums, "k h s h");
  song_play(song);
  playing_song = song_playing();
  loop frame; end
end`);
  const vm = new VM();
  vm.load(bytecode);
  const runtime = new CanvasEngineRuntime({ vm, ctx: document.createElement('canvas').getContext('2d'), width: 320, height: 200, logFn: () => {} });
  runtime.setFiles({ 'beep.wav': makeWav(0.25, 660) });
  runtime.registerNatives();
  const read = (name) => vm.globals.get(bytecode.globals[name]);
  const audio = runtime.audio;
  try
  {
    audio.unlock();
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert(audio.running, 'o contexto de audio devia estar a tocar (Chromium headless permite)');
    runtime.beginFrame(1 / 60);
    vm.tick();
    await Promise.allSettled(runtime.pendingLoads.splice(0));
    runtime.beginFrame(1 / 60);
    vm.tick();
    assert(read('coin') > 0 && read('coin') === read('coin2'), `a mesma receita devia dar o mesmo som: ${read('coin')} / ${read('coin2')}`);
    assert(read('laser') !== read('coin') && read('tone') > 0, 'receitas diferentes, sons diferentes');
    const wavEntry = audio.sounds.get(read('wav'));
    assert(wavEntry.ready && !wavEntry.error, `o WAV dos ficheiros do projeto devia carregar: ${wavEntry.error}`);
    assert(Math.abs(wavEntry.buffer.duration - 0.25) < 0.01, `o WAV dura 0.25 s, deu ${wavEntry.buffer.duration}`);
    assert(read('ch') > 0 && read('ch_wav') > read('ch'), `canais: ${read('ch')}, ${read('ch_wav')}`);
    assert(audio.stats.played === 2, `deviam ter tocado 2 sons, tocaram ${audio.stats.played} (saltados ${audio.stats.skipped})`);
    assert(vm.natives.get('is_playing_sound')(read('ch_wav')) === 1, 'o WAV devia estar a tocar');
    assert(read('track_n') === 2 && read('playing_song') === read('song'), `song: ${read('track_n')} faixas, a tocar ${read('playing_song')}`);

    await new Promise((resolve) => setTimeout(resolve, 450));
    assert(vm.natives.get('is_playing_sound')(read('ch_wav')) === 0, 'o WAV de 0.25 s ja devia ter acabado');
    // 240 bpm = 16 steps a second: in ~0.5 s about 8 steps of 2 notes.
    assert(audio.stats.notes >= 8, `a musica devia ter agendado notas, agendou ${audio.stats.notes}`);
    vm.natives.get('song_stop')();
    assert(vm.natives.get('song_playing')() === 0, 'song_stop devia parar a musica');
    const notes = audio.stats.notes;
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert(audio.stats.notes === notes, 'parada, a musica nao devia agendar mais notas');

    // A song that does not loop ends by itself.
    const once = audio.newSong(480);
    audio.addTrack(once, 0, 'C5 D5 E5 F5');
    audio.playSong(once, false);
    await new Promise((resolve) => setTimeout(resolve, 900));
    assert(audio.songPlaying === 0, 'uma musica sem repeticao devia acabar sozinha');
  }
  finally
  {
    runtime.dispose();
  }
  assert(audio.songPlaying === 0 && audio.master === null, 'dispose() devia parar e desligar o som');
}

export async function runAllTests() {
  const tests = [
    ['lexer: keywords/operators/delimiters', testLexerKeywordsOperatorsAndDelimiters],
    ['parser: program/process ast', testParserBuildsProgramAndProcessAst],
    ['parser: frame(value) + path syntax', testParserSupportsFrameValueAndPathSyntax],
    ['compile + tick process', testCompileAndTickProcess],
    ['frame(value) propagation', testFrameValuePropagation],
    ['frame default value', testFrameDefaultValue],
    ['break/continue lowered + runtime behavior', testBreakContinueLoweredAndBehavior],
    ['break outside loop compile error', testBreakOutsideLoopCompileError],
    ['spawn parent -> child parentId', testSpawnSetsParentId],
    ['signal tree + signal by TYPE wakeup', testSignalKillTreeAndWakeupByType],
    ['signal(id, s_kill) semantics', testSignalKillByIdUsesDivSemantics],
    ['ctype=c_scroll persists after frame', testCTypeScrollAssignmentPersistsAfterFrame],
    ['collision by TYPE', testCollisionByType],
    ['collision_circle uses explicit radius when set', testCircleCollisionUsesExplicitRadius],
    ['explicit cboxes override large implicit bounds', testExplicitCollisionBoxesOverrideLargeImplicitBounds],
    ['cbox box-box: metadata + penetration sign', testCBoxBoxCollisionPenetrationSignAndCodes],
    ['cbox circle-circle: metadata + penetration sign', testCBoxCircleCircleCollisionAndCodes],
    ['cbox box-circle: metadata codes', testCBoxBoxCircleCollisionAndCodes],
    ['cbox penetration Y sign (A above B)', testCBoxPenetrationYAxisSign],
    ['cross-process fixed slots (width/height/ctype/region/angle) are live within the same frame', testCrossProcessFixedSlotsAreLiveWithinSameFrame],
    ['let_me_alone kills others', testLetMeAloneKillsOthers],
    ['__get_path/__set_path scroll state', testPathNativesScrollState],
    ['path_find (A*) avoids TYPE obstacle and exposes points', testPathFindAvoidsObstacleType],
    ['path_find: clearance keeps a body off walls, no corner cutting', testPathFindClearanceAndCorners],
    ['path_assign/path_step follows path using delta time', testPathAssignAndStepUsesDeltaTime],
    ['relative process field access: father.x and son.x', testRelativeProcessFieldAccessFatherAndSon],
    ['out_of_region / out_of_screen', testOutOfRegionAndScreen],
    ['load_graphic / load_tile direct ids', testLoadGraphicAndTileDirectIds],
    ['load_bdf_font_text renders bitmap text', testLoadAndDrawBdfBitmapFont],
    ['xadvance movement', testXAdvanceMovesByAngle],
    ['xadvance handles angles above half circle correctly', testXAdvanceHandlesAnglesAboveHalfCircle],
    ['math helpers: ping_pong, wrap, lerp_angle, clamp, lerp, smoothstep', testMathHelpersPingPongWrapAndLerpAngle],
    ['math geometry helpers: normalize_angle/sign/distance pack', testMathGeometryHelperPack],
    ['keyword and/or/not operators', testKeywordLogicalOperatorsCompileAndRun],
    ['logical short-circuit skips side effects', testLogicalShortCircuitSkipsSideEffects],
    ['LOAD_GLOBAL preserves falsy', testLoadGlobalPreservesFalsyValues],
    ['missing CALL does not leak stack', testMissingFunctionCallDoesNotLeakCallStack],
    ['mutual recursion and cross-category forward calls resolve correctly', testMutualRecursionAndForwardCallsResolveCorrectly],
    ['missing SPAWN fails gracefully', testMissingSpawnProcessFailsGracefully],
    ['void native stack underflow guard', testVoidNativeDoesNotUnderflowStack],
    ['nested function return stack safety', testNestedFunctionReturnsDoNotLeakStack],
    ['implicit process locals graph/size slots', testImplicitProcessLocalsGraphAndSize],
    ['for local slot does not collide with implicit locals', testForLocalDoesNotCollideWithImplicitLocals],
    ['canonical red/green/blue/alpha/tag process fields', testCanonicalColorAndTagFields],
    ['priority field sorts draw list (dirty-flag, slot 13)', testPriorityFieldSortsDrawList],
    ['if/else parses and runs both branches (+ chained else if)', testIfElseBothBranchesParseAndRun],
    ['for with negative step counts down', testForNegativeStepCountsDown],
    ['chained assignment (a = b = c) compiles and evaluates to the assigned value', testChainedAssignmentCompilesAndEvaluatesToTheAssignedValue],
    ['main does not inherit the last process/function local scope', testMainDoesNotInheritLastProcessLocalScope],
    ['string escape sequences (\\n, \\t, \\\\, \\")', testStringEscapeSequences],
    ['duplicate PROCESS/FUNCTION/GLOBAL names are compile errors', testDuplicateDeclarationsAreCompileErrors],
    ['GLOBAL block form declares multiple names', testGlobalBlockFormDeclaresMultipleNames],
    ['GLOBAL array read/write with variable index', testGlobalArrayReadWrite],
    ['PRIVATE array inside process', testPrivateArrayInProcess],
    ['PRIVATE comma form (vx, vy = 3)', testPrivateCommaForm],
    ['GLOBAL without an initial value defaults to 0, not another global\'s constant', testGlobalWithoutInitialValueDefaultsToZeroNotAnotherGlobalsConstant],
    ['frame(n) throttles execution frequency', testFrameValueThrottlesExecutionFrequency],
    ['switch/case has no fallthrough', testSwitchCaseHasNoFallthrough],
    ['switch subject evaluated once; break/continue pass through to enclosing loop', testSwitchSubjectEvaluatedOnceAndBreakPassesThroughToLoop],
    ['switch CASE with multiple comma-separated values', testSwitchCaseWithMultipleValues],
    ['switch with zero cases is a compile error', testSwitchWithZeroCasesIsCompileError],
    ['compile errors include a source location', testCompileErrorsIncludeSourceLocation],
    ['constant pool deduplicates repeated literals', testConstantPoolIsDeduplicated],
    ['FOR with a constant step uses the short exit test', testForWithConstantStepUsesShortExitTest],
    ['disassembler produces readable labeled output', testDisassemblerProducesReadableLabeledOutput],
    ['disassembler resolves FUNCTION and MAIN local names', testDisassemblerResolvesFunctionAndMainLocalNames],
    ['MAIN survives a large spawn loop across multiple ticks instead of dying permanently', testMainSurvivesLargeSpawnLoopAcrossMultipleTicks],
    ['a genuine infinite loop in MAIN is still caught and stopped', testGenuineInfiniteLoopInMainIsStillCaught],
    ['collision(TYPE x) excludes the calling process itself', testCollisionExcludesSelf],
    ['RETURN inside IF does not fall through into the next body', testReturnInsideIfDoesNotFallThroughIntoNextBody],
    ['value-less RETURN does not consume the caller operand', testValuelessReturnDoesNotConsumeCallerOperand],
    ['FRAME inside a FUNCTION keeps the process fields', testFrameInsideFunctionKeepsProcessFields],
    ['path assignment statements do not leak stack', testPathAssignmentStatementsDoNotLeakStack],
    ['write inside a LOOP is capped and warns once', testWriteInsideLoopIsCappedAndWarns],
    ['angles follow DIV: counter-clockwise, 90000 up (draw, advance, get_dist, fget_angle)', testAnglesFollowDivConvention],
    ['compile errors are DivErrors with structured line/column', testCompileErrorsAreStructuredWithLineAndColumn],
    ['runDivDemo restart does not double the loop', testRunDivDemoRestartDoesNotDoubleTheLoop],
    ['runDivDemo releases mouse listeners of a replaced runtime', testRunDivDemoReleasesMouseListenersOfReplacedRuntime],
    ['mouse maps onto the virtual screen', testMouseMapsOntoVirtualScreen],
    ['mouse.left/middle/right, short clicks and no context menu', testMouseButtonsAndShortClicks],
    ['project files are loaded before URLs (by path or name, any case)', testProjectFilesAreLoadedBeforeUrls],
    ['physics: fall, stack, contact, impact, units, teleport, pin, removal', testPhysicsBodiesFallStackAndCollide],
    ['physics: anchors, add_box, pending material, ids, type, weld, rope length, slack, limits, motor, queries, sleep, min/max', testPhysicsSecondRound],
    ['net: lockstep keeps both games identical, late start, waiting, desync, messages', testNetLockstepKeepsBothGamesIdentical],
    ['net: input capture and connection codes', testNetInputCaptureAndCodes],
    ['net: net_close while gathering keeps the panel closed', testNetCloseDuringGatheringKeepsThePanelClosed],
    ['audio: effects, determinism, notes', testAudioSynthesisAndNotes],
    ['audio: natives play, load a WAV from project files, songs', testAudioNativesPlayLoadAndSong],
    ['keys typed into editable elements are not swallowed', testKeysTypedIntoEditableElementsAreNotSwallowed],
    ['restart restores the canvas size after set_mode', testRestartRestoresCanvasSizeAfterSetMode],
    ['runtimes do not share graphics or pivot resolver', testRuntimesDoNotShareGraphicsOrPivotResolver],
    ['a pending load that never settles does not freeze the program', testPendingLoadThatNeverSettlesDoesNotFreezeTheProgram]
  ];

  // ── New features added after bunnymark session ───────────────────────────
  tests.push(
    ['GLOBAL inline comma form (a, b, c = 5)', testGlobalInlineCommaForm],
    ['STRUCT single instance read/write + default values', testStructSingleInstance],
    ['STRUCT array of structs', testStructArrayOfStructs],
    ['STRUCT array field within struct', testStructArrayField],
    ['STRUCT initializer list + DUP syntax', testStructInitializerList],
    ['STRUCT nested structs', testStructNested],
    ['priority dirty-flag ignores unrelated FUNCTION locals landing on slot 13', testPriorityDirtyFlagIgnoresUnrelatedFunctionLocals],
    ['array and STRUCT bounds checking (compile-time constant + runtime variable)', testArrayAndStructBoundsChecking],
  );

  tests.push(...compilerTests);
  tests.push(...vmTests);
  tests.push(...runtimeTests);
  const results = [];
  for (const [name, fn] of tests) {
    const started = performance.now();
    try {
      await fn();
      results.push({
        name,
        ok: true,
        durationMs: performance.now() - started
      });
    } catch (error) {
      results.push({
        name,
        ok: false,
        durationMs: performance.now() - started,
        error: error?.message || String(error)
      });
    }
  }

  return results;
}
