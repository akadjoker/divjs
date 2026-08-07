import { Lexer } from '../compiler/tokenizer.js';
import { Parser } from '../parser/parser.js';
import { Compiler } from '../compiler/compiler.js';
import { OpCodes } from '../compiler/bytecode.js';
import { VM } from '../vm/vm.js';
import { CanvasEngineRuntime, CType } from '../vm/runtime.js';
import { disassemble } from '../compiler/disasm.js';

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

  const procs = vm.processManager.getAll();
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

  const p = vm.processManager.getAll()[0];
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

  const p = vm.processManager.getAll()[0];
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

  const p = vm.processManager.getAll()[0];
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
  // xadvanceNative() used to try auto-detecting argument order —
  // xadvance(distance, angle) vs xadvance(angle, distance) — by guessing
  // that whichever argument has magnitude > 180000 "must be" the
  // distance, since a DIV angle "shouldn't" exceed 180000 (180.000°).
  // That assumption is wrong: toRadiansFromDivAngle() never wraps or
  // clamps its input, and this project's own shipped demo increments an
  // angle unboundedly frame after frame, confirming angles routinely
  // span the full 0-360000 convention (a full turn), not just half of
  // it. Any legitimate angle between 180001 and 360000 (180°-360° — the
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

  // 270000 (270°) points straight up in this engine's trig convention —
  // under the old heuristic, 270000 > 180000 would have been
  // misclassified as the distance, with 10 misread as the angle.
  runtime.xadvanceNative(10, 270000);
  assert(approx(process.locals[0], 0, 0.01), `x esperado ~0 apos xadvance(10, 270000), obtido ${process.locals[0]}`);
  assert(approx(process.locals[1], -10, 0.01), `y esperado -10 apos xadvance(10, 270000), obtido ${process.locals[1]}`);
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

  const fa = runtime.fgetAngleNative(0, 0, 0, 10);
  assert(approx(fa, 90000), `fget_angle para cima esperado 90000, obtido ${fa}`);

  const fd = runtime.fgetDistanceNative(0, 0, 6, 8);
  assert(approx(fd, 10), `fget_distance esperado 10, obtido ${fd}`);

  const h = runtime.hermiteNative(0, 10, 0.5);
  assert(approx(h, 5), `hermite(0,10,0.5) esperado 5, obtido ${h}`);

  const gx = runtime.getDistXNative(10, 0);
  const gy = runtime.getDistYNative(10, 90000);
  assert(approx(gx, 10), `get_distx(10,0) esperado 10, obtido ${gx}`);
  assert(approx(gy, 10), `get_disty(10,90000) esperado 10, obtido ${gy}`);

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

  const p = vm.processManager.getAll()[0];
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
  // CALL/SPAWN_PROCESS — there is no declaration order that resolves both
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

  const p = vm.processManager.getAll()[0];
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

  const p = vm.processManager.getAll()[0];
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

  const p = vm.processManager.getAll()[0];
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
  // gameplay logic — distinct from `type`/process.type, which is
  // already the hash of the process's declared name, used by
  // collision()/signal(), and not meant for reassignment). Storage
  // only: nothing in the renderer applies these to a draw call
  // automatically — a process's own LOOP body still calls set_color()
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

  const process = vm.processManager.getAll()[0];
  assert(process.red === 10 && process.green === 20 && process.blue === 30 &&
    process.alpha === 50 && process.tag === 99,
    `campos deviam estar sincronizados no objeto Process, obtido red=${process.red} green=${process.green} blue=${process.blue} alpha=${process.alpha} tag=${process.tag}`);

  // A process param named "tag" (or red/green/blue/alpha) collides with
  // the fixed slot name the same way a param named "id" already does —
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

async function testChainedAssignmentIsCompileError() {
  // compileAssignment() stores directly and leaves nothing on the stack —
  // correct when assignment is used as a statement, but "a = b = c" parses
  // the right-hand side as a nested Assign expression too. Compiling that
  // used to silently corrupt the stack (the outer store would pop whatever
  // the rest of the expression happened to leave behind, or the pop()
  // underflow default) instead of failing loudly. It must be rejected at
  // compile time instead.
  const source = `program chained_assign;

begin
  var x = 0;
  var y = 0;
  x = y = 5;
  frame;
end`;

  let threw = false;
  try {
    compileSource(source);
  } catch (error) {
    threw = true;
  }
  assert(threw, 'atribuicao encadeada (x = y = 5) devia falhar a compilar, nao compilou');
}

async function testMainDoesNotInheritLastProcessLocalScope() {
  // compile() reset localMap to a fresh Map at the start of every function
  // and every process, but never reset it again before compiling the main
  // block. That left main compiling against whatever localMap the *last*
  // function or process (if any) had populated: any name used there as a
  // param/private/var would make compileIdentifier() resolve that same
  // name inside main via LOAD_LOCAL/STORE_LOCAL — reading/writing an index
  // in main's own locals array that main never touched — instead of
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
  // Execution order within a tick is main first, then newly spawned
  // processes, so main's print(score) is seen before p's.
  assert(processSeen[0] === 100,
    `main devia ler o GLOBAL score (100) mesmo apos PROCESS p(score) ter sido compilado, obtido ${JSON.stringify(processSeen)}`);
  assert(processSeen[1] === 5,
    `processo p devia ler o seu proprio parametro score (5), obtido ${JSON.stringify(processSeen)}`);

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
  // '\', 'n' between "line1" and "line2" instead of an actual newline —
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
  // to silently overwrite the Map entry from the first — no error, no
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
  // next token is still identifier-like — isIdentifierLike() already
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
  // "LOAD_CONST 0" with the literal number 0 as the operand — but
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
  // frameValue = ...) but nothing ever read it back afterwards — the
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

  const throttledSource = `program frame_throttled;

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
  // short of 40 and well above a token handful — a generous band that's
  // still tight enough to catch "frame(n) still does nothing" (which
  // would give 40) or "frame(n) stops the process" (which would give 0).
  assert(throttledCount >= 15 && throttledCount <= 25,
    `frame(50) ao longo de 40 ticks esperava entre 15 e 25 execucoes, obtido ${throttledCount}`);
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
  // body are transparent to SWITCH — they refer to whatever loop the
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
  // stops as soon as one value matches — a later value in the same list
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
  // shell that can never do anything, DEFAULT included — DEFAULT without
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
  // errors, which always had this) carried a source location before —
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
  // value identical to one already in the pool — a repeated 0, a
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
  // compileFor()'s general exit test — needed when the step is a genuine
  // runtime expression — compiles "(step >= 0 AND i <= end) OR (step < 0
  // AND i >= end)" into roughly 30 instructions, re-evaluated on every
  // single iteration. When the step is a literal ("STEP 2", "STEP -1", or
  // the implicit default of 1), its sign is already known at compile
  // time, so the exit test collapses to one LTE or GTE comparison
  // instead. This covers "STEP -N" too, which the parser represents as
  // Unary('-', Number(N)) rather than a bare Number literal (the lexer
  // never reads a sign into a NUMBER token) — getConstantNumericValue()
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
    // in the whole program — the short form never emits one, while the
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
  // instantiates — Compiler.emit()/addConstant() push onto plain arrays
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
  // functionTable entries used to only ever get { addr, params } —
  // unlike processTable, which always carried a .locals map — so
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
  // mainFinished = true the moment it was exceeded — permanently, since
  // tick() only calls runMain() at all while !mainFinished. A MAIN-level
  // FOR loop spawning enough processes to cross that budget in one tick
  // (a plausible pattern: a wave spawner, a particle burst) would
  // silently spawn only a fraction of what was requested and then never
  // run MAIN again for the rest of the program — no error surfaced
  // anywhere a game author would see, just fewer processes than asked
  // for and a dead MAIN. Confirmed directly: requesting 5,000 processes
  // in one FOR loop used to always produce exactly 3,225 live ones,
  // regardless of how much larger the requested count was (5,000/
  // 10,000/20,000/50,000 all produced that same 3,225 — the loop always
  // died at the same iteration count for the same per-spawn instruction
  // cost). Fixed by letting a *single* budget exhaustion resume on the
  // next tick instead of stopping permanently, while still killing
  // MAIN after several (5) *consecutive* exhaustions with zero progress
  // — preserving the original safety net for a genuine infinite loop.
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
  // the first tick's budget, the rest resume on the second) — give it a
  // handful more as headroom without masking a real regression back to
  // the old permanent-stop behavior, which would plateau at 3,225
  // forever no matter how many ticks it's given.
  for (let i = 0; i < 6; i += 1) {
    vm.tick();
  }

  const liveCount = vm.processManager.getAll().length;
  assert(liveCount === 5000,
    `esperava 5000 processos vivos apos varios ticks, obtido ${liveCount} ` +
    `(3225 e o valor exato que o bug antigo produzia, truncado para sempre)`);
  assert(vm.mainFinished === false,
    'MAIN devia continuar vivo (para chegar ao seu proprio LOOP FRAME final), nao mainFinished=true');
}

async function testGenuineInfiniteLoopInMainIsStillCaught() {
  // The other half of the fix above: a MAIN-level loop that truly never
  // reaches FRAME no matter how many extra ticks it's given (not just
  // "needs one or two more ticks to finish real work") must still be
  // caught and stopped — otherwise every tick would burn a full 100,000-
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
  // that process's own id on every single frame — breaking any same-type
  // collision check (enemy-vs-enemy, bullet-vs-bullet) before it could
  // ever see a real hit.
  const soloSource = `program collision_self;

process enemy(x, y);
begin
  width = 20;
  height = 20;
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
  // still be detected — the fix must exclude only the caller, not the type.
  const pairSource = `program collision_pair;

process enemy(x, y);
begin
  width = 20;
  height = 20;
  if (collision(TYPE enemy))
    print(1);
  end
  frame;
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

  const p = vm.processManager.getAll()[0];
  assert(!!p, 'processo nao criado');
  assert(p.ctype === CType.C_SCROLL, `ctype esperado ${CType.C_SCROLL}, obtido ${p.ctype}`);

  vm.currentProcess = p;
  assert(runtime.getCurrentCType() === CType.C_SCROLL, `getCurrentCType esperado ${CType.C_SCROLL}, obtido ${runtime.getCurrentCType()}`);
}

async function testCollisionByType() {
  const vm = new VM();
  const runtime = createRuntime(vm);

  const player = vm.processManager.create('player', { x: 10, y: 10, width: 20, height: 20 });
  const enemy = vm.processManager.create('enemy', { x: 20, y: 20, width: 20, height: 20 });
  vm.currentProcess = player;

  const enemyType = vm.processManager.getTypeCode('enemy');
  const collidingId = runtime.collisionNative(enemyType);
  assert(collidingId === enemy.id, `collision TYPE esperado id ${enemy.id}, obtido ${collidingId}`);
}

async function testCircleCollisionUsesExplicitRadius() {
  const vm = new VM();
  const runtime = createRuntime(vm);

  // width/height are tiny, so default radius would be too small to collide.
  const a = vm.processManager.create('a', { x: 10, y: 10, width: 8, height: 8 });
  const b = vm.processManager.create('b', { x: 50, y: 10, width: 8, height: 8 });

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
  const a = vm.processManager.create('a', { x: 100, y: 100, width: 200, height: 200 });
  const b = vm.processManager.create('b', { x: 220, y: 120, width: 200, height: 200 });

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

  const a = vm.processManager.create('a', { x: 100, y: 100, width: 32, height: 32, angle: 0 });
  const b = vm.processManager.create('b', { x: 124, y: 104, width: 32, height: 32, angle: 0 });

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

  const a = vm.processManager.create('a', { x: 100, y: 100, width: 40, height: 40, angle: 0 });
  const b = vm.processManager.create('b', { x: 130, y: 100, width: 40, height: 40, angle: 0 });

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

  const a = vm.processManager.create('a', { x: 100, y: 100, width: 40, height: 40, angle: 0 });
  const b = vm.processManager.create('b', { x: 126, y: 104, width: 40, height: 40, angle: 0 });

  vm.currentProcess = a;
  runtime.clearCollisionBoxesNative();
  runtime.addCollisionBoxNative(0, 0, 24, 24, 401);

  vm.currentProcess = b;
  runtime.clearCollisionBoxesNative();
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

  const a = vm.processManager.create('a', { x: 100, y: 100, width: 32, height: 32, angle: 0 });
  const b = vm.processManager.create('b', { x: 104, y: 124, width: 32, height: 32, angle: 0 });

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
  // ctype, region, and angle were left to ProcessManager.sweep() — which
  // runs once, after every process in the tick has already executed. That
  // made x/y "live" within the same frame (visible to any process that
  // runs later in the same tick) but left the other five canonical fields
  // a full frame stale for the same readers: a process that grows its own
  // hitbox mid-frame wouldn't have that reflected in a collision() check
  // made against it later in that same tick — only on the next one.
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
  // priority is canonical slot 13. Lower value draws first (behind),
  // higher value draws last (in front). getDrawList() returns a sorted
  // copy rebuilt only when the dirty flag is set.
  const source = `program t;
process actor(prio);
begin
  priority = prio;
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
  assert(dl.length === 3, `esperava 3 processos, obtido ${dl.length}`);
  for (let i = 1; i < dl.length; i++) {
    assert(dl[i].priority >= dl[i - 1].priority,
      `draw list fora de ordem: [${dl.map(p => p.priority).join(',')}]`);
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
  // GLOBAL a, b, c = 5; — all on one line, comma-separated, single ;
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

  // mixed: some with initializers, some without
  const src2 = `program t;
global x = 1, y, z = 3;
begin
  print(x);
  print(y);
  print(z);
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
  // PRIVATE vx, vy = 3; — comma-separated inside a PROCESS
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
  // STORE_LOCAL writes to slot 13 — the canonical `priority` field inside
  // a PROCESS body. But a FUNCTION's own locals are a completely
  // separate, freshly-allocated slot sequence starting at 0 — nothing
  // stops a FUNCTION with 14 params/VARs from putting its own 14th local
  // at slot 13 too, purely by coincidence. Without the currentProcess/
  // callStack guard, calling such a function marked the draw list dirty
  // on every call, for every process, even though no process's priority
  // actually changed — silently undermining the whole point of caching
  // the sorted draw list (confirmed reproducible: a FUNCTION with 14
  // params does put its 14th local at slot 13). The guard requires being
  // directly in a process's own top-level body (currentProcess set,
  // callStack empty) — so a priority write from inside a FUNCTION the
  // process itself calls doesn't trigger this path either, but that's
  // not a real capability lost: `priority` inside a FUNCTION was never a
  // reference to any process's canonical field to begin with (FUNCTION
  // locals don't get the canonical slot table PROCESS bodies do) — it's
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
    vm.tick(); // calls f() again — used to spuriously mark the draw list dirty
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
  // happened to sit at that computed offset — confirmed for GLOBAL
  // arrays, PRIVATE arrays, and STRUCT arrays (including array-valued
  // fields within a struct) alike, since they all route through the same
  // four opcodes. A constant out-of-bounds index (the common case — an
  // off-by-one literal, or a loop bound of `size` instead of `size-1`)
  // is now a compile error; a variable index whose value isn't known
  // until runtime is bounds-checked in the VM instead, rejecting the
  // read/write rather than touching unrelated storage.

  // Constant index out of bounds: compile-time rejection.
  let threwOnConstantOOB = false;
  try {
    compileSource(`program array_const_oob;

global a[3], b[3];

begin
  a[3] = 999;
  frame;
end`);
  } catch (error) {
    threwOnConstantOOB = true;
  }
  assert(threwOnConstantOOB, 'indice constante fora dos limites (a[3] com size 3) devia falhar a compilar');

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
  var i = 3;
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
  // (count * instanceSize) rather than per-term, which — same caveat as
  // the flat-array case — doesn't catch every pathological combination
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
  var i = 2;
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
  assert(Math.abs(bot.x - 96) <= 1.5, `bot devia terminar perto de x=96 (centro em 104), obtido x=${bot.x}`);
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
    ['chained assignment (a = b = c) is a compile error', testChainedAssignmentIsCompileError],
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
    ['collision(TYPE x) excludes the calling process itself', testCollisionExcludesSelf]
  ];

  // ── New features added after bunnymark session ───────────────────────────
  tests.push(
    ['spawn parent -> child parentId', testSpawnSetsParentId],
    ['signal tree + signal by TYPE wakeup', testSignalKillTreeAndWakeupByType],
    ['signal(id, s_kill) semantics', testSignalKillByIdUsesDivSemantics],
    ['ctype=c_scroll persists after frame', testCTypeScrollAssignmentPersistsAfterFrame],
    ['collision by TYPE', testCollisionByType],
    ['cross-process fixed slots (width/height/ctype/region/angle) are live within the same frame', testCrossProcessFixedSlotsAreLiveWithinSameFrame],
    ['let_me_alone kills others', testLetMeAloneKillsOthers],
    ['__get_path/__set_path scroll state', testPathNativesScrollState],
    ['priority field sorts draw list (dirty-flag, slot 13)', testPriorityFieldSortsDrawList],
    ['GLOBAL array read/write with variable index', testGlobalArrayReadWrite],
    ['PRIVATE array inside process', testPrivateArrayInProcess],
    ['GLOBAL inline comma form (a, b, c = 5)', testGlobalInlineCommaForm],
    ['PRIVATE comma form (vx, vy = 3)', testPrivateCommaForm],
    ['STRUCT single instance read/write + default values', testStructSingleInstance],
    ['STRUCT array of structs', testStructArrayOfStructs],
    ['STRUCT array field within struct', testStructArrayField],
    ['STRUCT initializer list + DUP syntax', testStructInitializerList],
    ['STRUCT nested structs', testStructNested],
    ['priority dirty-flag ignores unrelated FUNCTION locals landing on slot 13', testPriorityDirtyFlagIgnoresUnrelatedFunctionLocals],
    ['array and STRUCT bounds checking (compile-time constant + runtime variable)', testArrayAndStructBoundsChecking],
  );

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
