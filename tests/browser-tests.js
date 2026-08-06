import { Lexer } from '../compiler/tokenizer.js';
import { Parser } from '../parser/parser.js';
import { Compiler } from '../compiler/compiler.js';
import { OpCodes } from '../compiler/bytecode.js';
import { VM } from '../vm/vm.js';
import { CanvasEngineRuntime, CType } from '../vm/runtime.js';

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
    ['let_me_alone kills others', testLetMeAloneKillsOthers],
    ['__get_path/__set_path scroll state', testPathNativesScrollState],
    ['out_of_region / out_of_screen', testOutOfRegionAndScreen],
    ['load_graphic / load_tile direct ids', testLoadGraphicAndTileDirectIds],
    ['xadvance movement', testXAdvanceMovesByAngle],
    ['keyword and/or/not operators', testKeywordLogicalOperatorsCompileAndRun],
    ['void native stack underflow guard', testVoidNativeDoesNotUnderflowStack],
    ['nested function return stack safety', testNestedFunctionReturnsDoNotLeakStack],
    ['implicit process locals graph/size slots', testImplicitProcessLocalsGraphAndSize],
    ['for local slot does not collide with implicit locals', testForLocalDoesNotCollideWithImplicitLocals]
  ];

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
