// VM / process-manager regression tests. DIV semantics are taken from
// the DIV Games Studio 2 manual; the line numbers cited are from its OCR
// text (dgs2.txt).

import { Lexer } from '../compiler/tokenizer.js';
import { Parser } from '../parser/parser.js';
import { Compiler } from '../compiler/compiler.js';
import { VM } from '../vm/vm.js';
import { CanvasEngineRuntime } from '../vm/runtime.js';
import { ProcessManager, Signal, getProcessShapes } from '../vm/process.js';

function compileSource(source)
{
  const tokens = new Lexer(source).tokenize();
  const ast = new Parser(tokens).parse();
  return new Compiler().compile(ast);
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

// A real canvas in the browser suite; a do-nothing 2D context elsewhere
// (Node), so the same file can be run headless against any checkout.
function createRuntime(vm)
{
  let ctx;
  if (typeof document !== 'undefined')
  {
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 200;
    ctx = canvas.getContext('2d');
  }
  else
  {
    const canvas = {
      width: 320,
      height: 200,
      addEventListener() {},
      removeEventListener() {},
      getBoundingClientRect() { return { left: 0, top: 0, width: 320, height: 200 }; }
    };
    ctx = new Proxy({}, {
      get: (target, key) => (key === 'canvas' ? canvas : (typeof key === 'string' ? () => ({}) : undefined)),
      set: () => true
    });
  }
  const runtime = new CanvasEngineRuntime({ vm, ctx, width: 320, height: 200, clearColor: '#000', logFn: () => {} });
  runtime.registerNatives();
  return runtime;
}

// Compiles and loads `source` into a fresh VM + runtime. log(...) calls
// are collected in `logs` as space-joined strings.
function setup(source)
{
  const vm = new VM();
  const runtime = createRuntime(vm);
  const logs = [];
  vm.registerNative('log', (...values) =>
  {
    logs.push(values.join(' '));
    return 0;
  });
  const bytecode = compileSource(source);
  vm.load(bytecode);
  return { vm, runtime, logs, bytecode };
}

function globalsInOrder(vm)
{
  return [...vm.globals.keys()].sort((a, b) => a - b).map((k) => vm.globals.get(k));
}

function drawnIds(runtime)
{
  const ids = [];
  runtime.drawProcessAt = (process) => ids.push(process.id);
  runtime.drawProcessesFallback();
  return ids;
}

// A MAIN that falls off its end (HALT) ends its Process too.
async function testMainHaltEndsMainProcess()
{
  const { vm, runtime } = setup(`PROGRAM t;
BEGIN
  graph = 1; x = 100; y = 100;
  FRAME;
END`);
  const main = vm.mainProcess;
  for (let i = 0; i < 4; i++) vm.tick();
  assert(vm.mainFinished, 'MAIN devia ter terminado');
  assert(main.finished, 'o Process do MAIN devia ficar finished depois do HALT');
  assert(!vm.processManager.getAll().includes(main), 'o MAIN terminado nao devia continuar na lista de processos');
  assert(!drawnIds(runtime).includes(main.id), 'o MAIN terminado nao devia ser desenhado');
}

// Signals reach MAIN like any other process (MAIN is the initial
// process, dgs2 8872-8874).
async function testSignalsToMain()
{
  for (const sig of ['s_kill', 's_sleep', 's_freeze'])
  {
    const { vm } = setup(`PROGRAM t;
GLOBAL n = 0;
PROCESS ctl(); BEGIN signal(father, ${sig}); LOOP FRAME; END END
BEGIN
  ctl();
  LOOP n = n + 1; FRAME; END
END`);
    for (let i = 0; i < 5; i++) vm.tick();
    const n = globalsInOrder(vm)[0];
    assert(n === 1, `${sig} no MAIN: esperava n = 1 (so a volta ja em curso), obtido ${n}`);
    if (sig === 's_kill')
    {
      assert(vm.mainFinished, 's_kill devia terminar o MAIN');
    }
    else
    {
      assert(!vm.mainFinished, `${sig} nao devia terminar o MAIN`);
      vm.processManager.signalById(vm.mainProcess.id, Signal.S_WAKEUP);
      vm.tick();
      vm.tick();
      const n2 = globalsInOrder(vm)[0];
      assert(n2 === 3, `depois de s_wakeup o MAIN devia voltar a correr (n = 3), obtido ${n2}`);
    }
  }
}

// FRAME(n) throttles MAIN like it throttles processes.
async function testFrameNInMain()
{
  const { vm } = setup(`PROGRAM t;
GLOBAL n = 0; m = 0;
PROCESS p(); BEGIN LOOP m = m + 1; FRAME(300); END END
BEGIN
  p();
  LOOP n = n + 1; FRAME(300); END
END`);
  for (let i = 0; i < 9; i++) vm.tick();
  const [n, m] = globalsInOrder(vm);
  assert(m === 3, `processo com FRAME(300) devia correr 3 vezes em 9 ticks, obtido ${m}`);
  assert(n === 3, `MAIN com FRAME(300) devia correr 3 vezes em 9 ticks, obtido ${n}`);
}

// Asleep: not executed, not drawn, not collidable; frozen: not
// executed but still drawn and collidable (dgs2 8919-8930, 10683-10692).
async function testSleepVersusFreeze()
{
  const { vm, runtime } = setup(`PROGRAM t;
GLOBAL s = 0; f = 0; ns = 0; nf = 0; hit_s = 0; hit_f = 0;
PROCESS sleeper(); BEGIN graph = 1; x = 10; y = 10; LOOP ns = ns + 1; FRAME; END END
PROCESS freezer(); BEGIN graph = 1; x = 100; y = 10; LOOP nf = nf + 1; FRAME; END END
PROCESS probe(); BEGIN graph = 1;
  LOOP
    x = 10; y = 10; hit_s = collision(TYPE sleeper);
    x = 100; y = 10; hit_f = collision(TYPE freezer);
    x = 200;
    FRAME;
  END
END
BEGIN
  s = sleeper(); f = freezer();
  signal(s, s_sleep);
  signal(f, s_freeze);
  probe();
  LOOP FRAME; END
END`);
  for (let i = 0; i < 3; i++) vm.tick();
  const g = globalsInOrder(vm);
  const [s, f, ns, nf, hitS, hitF] = g;
  assert(ns === 1 && nf === 1, `adormecido e congelado nao deviam executar depois do sinal (ns=${ns}, nf=${nf})`);
  const drawn = drawnIds(runtime);
  assert(!drawn.includes(s), 'processo adormecido nao devia ser desenhado');
  assert(drawn.includes(f), 'processo congelado devia continuar desenhado');
  assert(hitS === 0, `processo adormecido nao devia ser detetado em colisoes, obtido ${hitS}`);
  assert(hitF === f, `processo congelado devia ser detetado em colisoes (esperado ${f}), obtido ${hitF}`);

  vm.processManager.signalById(s, Signal.S_WAKEUP);
  vm.tick();
  assert(globalsInOrder(vm)[2] === 2, 'depois de s_wakeup o adormecido devia voltar a executar');
  assert(drawnIds(runtime).includes(s), 'depois de s_wakeup o adormecido devia voltar a ser desenhado');
}

// A TYPE value is never a live process id, so signal(TYPE a, ...)
// cannot hit the process whose id equals the old hash (97 for 'a').
async function testSignalTypeNeverMisroutedToId()
{
  const { vm, logs } = setup(`PROGRAM t;
PROCESS filler(); BEGIN LOOP FRAME; END END
PROCESS a(); BEGIN LOOP FRAME; END END
BEGIN
  a(); a();
  FROM i = 1 TO 120; filler(); END
  log(TYPE a);
  signal(TYPE a, s_kill);
  LOOP FRAME; END
END`);
  vm.tick();
  vm.tick();
  const typeA = Number(logs[0]);
  const all = vm.processManager.getAll();
  assert(typeA === vm.processManager.getTypeCode('a'), 'TYPE a do compilador e do runtime deviam coincidir');
  assert(!vm.processManager.get(typeA), `TYPE a (${typeA}) nao pode ser o id de um processo vivo`);
  assert(all.filter((p) => p.name === 'a').length === 0, 'signal(TYPE a, s_kill) devia matar os processos a');
  assert(all.filter((p) => p.name === 'filler').length === 120, 'signal(TYPE a, s_kill) nao devia matar nenhum filler');
}

// SON is the last process created (dgs2 12860-12867), BIGBRO the
// one the father created just before, SMALLBRO the one just after
// (dgs2 12396-12411, 12841-12853); links stay right when one dies.
async function testSonBigbroSmallbro()
{
  const { vm, logs } = setup(`PROGRAM t;
GLOBAL bb = 0; sb = 0;
PROCESS kid(n); BEGIN x = n; IF (n == 1) FRAME; sb = smallbro.x; END IF (n == 3) bb = bigbro.x; END LOOP FRAME; END END
PROCESS parent();
PRIVATE a; b; c;
BEGIN
  a = kid(1); b = kid(2); c = kid(3);
  log(son == c, son.x, b.x);
  FRAME;
  signal(c, s_kill);
  log(son == b, son.x);
  FRAME;
  log(son == b, son.x);
  LOOP FRAME; END
END
BEGIN parent(); LOOP FRAME; END END`);
  vm.tick();
  vm.tick();
  vm.tick();
  assert(logs[0] === '1 3 2', `son devia ser o ultimo filho criado (x=3), obtido "${logs[0]}"`);
  assert(logs[1] === '1 2', `com o ultimo filho morto (ainda por varrer) son devia ser o anterior, obtido "${logs[1]}"`);
  assert(logs[2] === '1 2', `depois do sweep son devia continuar a ser o anterior, obtido "${logs[2]}"`);
  const [bb, sb] = globalsInOrder(vm);
  assert(bb === 2, `bigbro.x do terceiro filho devia ser 2, obtido ${bb}`);
  assert(sb === 2, `smallbro.x do primeiro filho devia ser 2, obtido ${sb}`);

  const pm = vm.processManager;
  const kids = getUserProcesses(vm).filter((p) => p.name === 'kid');
  const [k1, k2] = kids;
  assert(k1.smallbroId === k2.id && k2.bigbroId === k1.id, 'bigbro/smallbro dos irmaos vivos deviam apontar um para o outro');
  assert(k2.smallbroId === 0, 'smallbro do irmao mais novo vivo devia ficar 0 depois de o seguinte morrer');
  assert(pm.getRelative(k1, 'smallbro') === k2 && pm.getRelative(k2, 'bigbro') === k1, 'getRelative devia seguir os irmaos');
}

// Box vs circle MTV pushes A (the caller) away from B.
async function testBoxCircleMtvSign()
{
  const pm = new ProcessManager();
  const a = pm.create('A', {});
  Object.assign(a, { x: 0, y: 0, width: 20, height: 20 });
  const b = pm.create('B', {});
  Object.assign(b, { x: 15, y: 0, width: 20, height: 20 });
  b.cboxes = [{ shape: 'circle', x: 10, y: 10, radius: 10 }];
  assert(pm.collision(a, pm.getTypeCode('B')) === b.id, 'caixa A e circulo B deviam colidir');
  assert(pm.lastPenetrationX === -5 && pm.lastPenetrationY === 0,
    `caixa A vs circulo B: MTV esperado [-5,0], obtido [${pm.lastPenetrationX},${pm.lastPenetrationY}]`);

  a.cboxes = [{ shape: 'circle', x: 10, y: 10, radius: 10 }];
  b.cboxes = [];
  pm.collision(a, pm.getTypeCode('B'));
  assert(pm.lastPenetrationX === -5 && pm.lastPenetrationY === 0,
    `circulo A vs caixa B: MTV esperado [-5,0], obtido [${pm.lastPenetrationX},${pm.lastPenetrationY}]`);
}

// A box inside another gets an MTV that really separates them.
async function testContainedBoxMtv()
{
  const pm = new ProcessManager();
  const a = pm.create('A', {});
  Object.assign(a, { x: 30, y: 0, width: 4, height: 4 });
  const b = pm.create('B', {});
  Object.assign(b, { x: 0, y: 0, width: 100, height: 100 });
  pm.collision(a, pm.getTypeCode('B'));
  assert(pm.lastPenetrationX === 22 && pm.lastPenetrationY === 0,
    `MTV esperado [22,0], obtido [${pm.lastPenetrationX},${pm.lastPenetrationY}]`);
  a.x += pm.lastPenetrationX;
  a.y += pm.lastPenetrationY;
  assert(pm.collision(a, pm.getTypeCode('B')) === 0, 'depois de aplicar o MTV as caixas nao deviam colidir');
}

// The collision shape is the sprite as drawGraphSprite() paints
// it: scaled by SIZE, mirrored by FLAGS, rotated about the pivot.
async function testCollisionShapeFollowsRenderer()
{
  const pm = new ProcessManager();
  const a = pm.create('A', {});
  Object.assign(a, { x: 0, y: 0, width: 20, height: 20, size: 25 });
  const b = pm.create('B', {});
  Object.assign(b, { x: 15, y: 0, width: 20, height: 20, size: 25 });
  assert(pm.collision(a, pm.getTypeCode('B')) === 0, 'sprites a size=25 (5x5) separados 15 px nao deviam colidir');
  b.x = 4;
  assert(pm.collision(a, pm.getTypeCode('B')) === b.id, 'sprites a size=25 separados 4 px deviam colidir');

  // 20x20 graphic with control point 0 at its top-left, like tutor4's FPG.
  pm.pivotResolver = () => ({ x: 0, y: 0 });
  const r = pm.create('R', {});
  Object.assign(r, { x: 100, y: 100, width: 20, height: 20, angle: 90000 });
  const box = getProcessShapes(r)[0].aabb;
  const near = (u, v) => Math.abs(u - v) < 1e-6;
  // DIV angle 90000 turns the graphic counter-clockwise on screen: its
  // right edge now points up, so it spans x 100..120 and y 80..100.
  assert(near(box.minX, 100) && near(box.maxX, 120) && near(box.minY, 80) && near(box.maxY, 100),
    `rodado 90 graus a volta do pivot (0,0): esperado x 100..120, y 80..100, obtido ${JSON.stringify(box)}`);

  Object.assign(r, { angle: 0, flags: 1 });
  const mirrored = getProcessShapes(r)[0].aabb;
  assert(near(mirrored.minX, 80) && near(mirrored.maxX, 100) && near(mirrored.minY, 100) && near(mirrored.maxY, 120),
    `espelhado em X a volta do pivot (0,0): esperado x 80..100, y 100..120, obtido ${JSON.stringify(mirrored)}`);
}

// Collision_point uses the same shapes (RESOLUTION, pivot, SIZE,
// ANGLE) and skips processes collision() skips.
async function testCollisionPointUsesShapes()
{
  const vm = new VM();
  const runtime = createRuntime(vm);
  const pm = vm.processManager;
  const p = pm.create('pt', {});
  // GRAPH 1 is not loaded, so it is the runtime's default 32x32 graphic
  // with its pivot in the middle.
  Object.assign(p, { x: 1000, y: 1000, width: 32, height: 32, resolution: 10, graph: 1 });
  p.locals[16] = 1;
  const type = pm.getTypeCode('pt');
  assert(runtime.collisionPointNative(100, 100, type) === p.id, 'collision_point devia usar RESOLUTION (processo desenhado em 100,100)');
  assert(runtime.collisionPointNative(1000, 1000, type) === 0, 'collision_point nao devia acertar nas coordenadas sem RESOLUTION');

  Object.assign(p, { resolution: 0, x: 100, y: 100, size: 50 });
  assert(runtime.collisionPointNative(110, 100, type) === 0, 'collision_point devia usar SIZE (16x16 com size=50)');
  assert(runtime.collisionPointNative(107, 100, type) === p.id, 'collision_point devia acertar dentro do sprite escalado');

  p.sleeping = true;
  assert(runtime.collisionPointNative(100, 100, type) === 0, 'collision_point nao devia acertar num processo adormecido');
  p.sleeping = false;
  p.graph = 0;
  p.locals[16] = 0;
  assert(runtime.collisionPointNative(100, 100, type) === 0, 'collision_point nao devia acertar num processo sem GRAPH');
  assert(pm.collisionPoint(100, 100, type) === p.id, 'o teste de obstaculos do path_find continua a aceitar processos sem GRAPH');
}

// Sweep() removes the dead in one pass, keeping order and indexes.
async function testSweepSinglePass()
{
  const pm = new ProcessManager();
  const N = 40000;
  for (let i = 0; i < N; i++) pm.create(i % 2 ? 'b' : 'a', {});
  for (let i = 0; i < N / 2; i++) pm.processes[i].kill();
  const started = performance.now();
  pm.sweep();
  const ms = performance.now() - started;
  assert(pm.count() === N / 2, `esperava ${N / 2} processos vivos, obtido ${pm.count()}`);
  assert(pm.processes[0].id === N / 2 + 1, 'sweep devia manter a ordem de criacao');
  assert(!pm.get(1) && pm.get(N) === pm.processes[N / 2 - 1], 'byId devia ficar coerente');
  // Before: ~1000 ms (one splice per dead process). After: ~7 ms.
  assert(ms < 200, `sweep de ${N / 2} mortos em ${N} demorou ${ms.toFixed(1)} ms`);
}

// Tree signals by TYPE walk each subtree, not every process.
async function testTreeSignalByTypeIsLinear()
{
  const pm = new ProcessManager();
  const N = 8000;
  for (let i = 0; i < N; i++) pm.create('bullet', {});
  const started = performance.now();
  const killed = pm.signalByType(pm.getTypeCode('bullet'), Signal.S_KILL_TREE);
  const ms = performance.now() - started;
  assert(killed === N, `esperava ${N} processos mortos, obtido ${killed}`);
  // Before: ~200 ms (getChildrenOf filtered every process per target).
  assert(ms < 50, `signal(TYPE, s_kill_tree) em ${N} processos demorou ${ms.toFixed(1)} ms`);

  const pm2 = new ProcessManager();
  const top = pm2.create('top', {});
  const mid = pm2.create('mid', { parentId: top.id });
  const leaf = pm2.create('leaf', { parentId: mid.id });
  const other = pm2.create('other', {});
  assert(pm2.signalById(top.id, Signal.S_SLEEP_TREE) === 3, 's_sleep_tree devia chegar ao processo e aos descendentes');
  assert(mid.sleeping && leaf.sleeping && !other.sleeping, 's_sleep_tree so devia afetar a arvore');
}

// Reading `son` is O(1).
async function testSonReadIsConstantTime()
{
  const N = 8000;
  const { vm } = setup(`PROGRAM t;
GLOBAL spawned = 0;
PROCESS p(); PRIVATE r; BEGIN LOOP r = son; FRAME; END END
PROCESS spawner(); BEGIN WHILE (spawned < ${N}) FROM j = 1 TO 500; p(); spawned = spawned + 1; END FRAME; END LOOP FRAME; END END
BEGIN spawner(); LOOP FRAME; END END`);
  for (let i = 0; i < Math.ceil(N / 500) + 2; i++) vm.tick();
  const started = performance.now();
  for (let i = 0; i < 5; i++) vm.tick();
  const ms = (performance.now() - started) / 5;
  // Before: ~440 ms/tick (each read filtered all processes). After: ~5 ms.
  assert(ms < 100, `${N} processos a ler son: ${ms.toFixed(1)} ms/tick`);
}

// A very deep spawn chain neither overflows the JS stack nor leaves
// MAIN half-run.
async function testDeepSpawnChain()
{
  const { vm } = setup(`PROGRAM t;
GLOBAL n = 0;
PROCESS chain(k); BEGIN IF (k > 0) chain(k - 1); END LOOP FRAME; END END
BEGIN chain(4000); LOOP n = n + 1; FRAME; END END`);
  vm.tick();
  vm.tick();
  const chains = getUserProcesses(vm).filter((p) => p.name === 'chain');
  assert(chains.length === 4001, `esperava 4001 processos chain, obtido ${chains.length}`);
  assert(chains.every((p) => p.hasCompletedFrame), 'todos os chain deviam ter corrido no tick em que foram criados');
  assert(globalsInOrder(vm)[0] === 2, `o MAIN devia continuar a correr (n = 2), obtido ${globalsInOrder(vm)[0]}`);
}

// Path followers of dead processes are dropped.
async function testPathFollowersPruned()
{
  const { vm, runtime } = setup(`PROGRAM t;
GLOBAL pid = 0;
PROCESS walker(); BEGIN path_assign(pid, 0); FRAME; END
BEGIN
  LOOP walker(); FRAME; END
END`);
  vm.tick();
  runtime.paths.set(1, [{ x: 0, y: 0 }, { x: 100, y: 0 }]);
  vm.globals.set([...vm.globals.keys()][0], 1);
  for (let i = 0; i < 500; i++) vm.tick();
  const live = vm.processManager.count();
  assert(runtime.pathFollowers.size <= 2 * live + 17,
    `pathFollowers devia acompanhar os processos vivos (${live}), tem ${runtime.pathFollowers.size}`);
}

// let_me_alone() kills every process but the caller - MAIN included when
// another process calls it (dgs2 9851-9853, 10757-10759).
async function testLetMeAloneFromChildKillsMain()
{
  const { vm } = setup(`PROGRAM t;
GLOBAL n = 0;
PROCESS other(); BEGIN LOOP FRAME; END END
PROCESS boss(); BEGIN FRAME; let_me_alone(); LOOP FRAME; END END
BEGIN
  other(); boss();
  LOOP n = n + 1; FRAME; END
END`);
  for (let i = 0; i < 4; i++) vm.tick();
  const names = getUserProcesses(vm).map((p) => p.name);
  assert(names.length === 1 && names[0] === 'boss', `so o boss devia sobreviver, obtido ${JSON.stringify(names)}`);
  assert(vm.mainFinished, 'let_me_alone() chamado por outro processo devia matar o MAIN');
  assert(vm.processManager.getAll().some((p) => p.isMouse), 'o rato nao e um processo do programa e deve ficar');
}

// Pinned manual behaviour (not changed): a self-kill takes effect at the
// next FRAME (dgs2 10703-10708), and orphans escape tree signals
// (dgs2 10713-10718).
async function testSelfKillAndOrphansFollowManual()
{
  const { vm, logs } = setup(`PROGRAM t;
PROCESS kid(); BEGIN LOOP FRAME; END END
PROCESS p(); BEGIN signal(id, s_kill); log(1); FRAME; log(2); END
BEGIN p(); LOOP FRAME; END END`);
  vm.tick();
  vm.tick();
  assert(logs.join(',') === '1', `o auto-kill devia deixar correr ate ao FRAME e nao depois, obtido ${logs.join(',')}`);

  const orphan = setup(`PROGRAM t;
GLOBAL g = 0;
PROCESS leaf(); BEGIN LOOP FRAME; END END
PROCESS mid(); BEGIN leaf(); FRAME; END
PROCESS top(); BEGIN mid(); LOOP FRAME; END END
BEGIN g = top(); FRAME; FRAME; signal(g, s_kill_tree); LOOP FRAME; END END`);
  for (let i = 0; i < 5; i++) orphan.vm.tick();
  const alive = getUserProcesses(orphan.vm).map((p) => p.name);
  assert(alive.length === 1 && alive[0] === 'leaf', `o neto orfao devia escapar ao s_kill_tree, obtido ${JSON.stringify(alive)}`);
}

// vm.reset() and a second vm.load() drop the previous program's processes.
async function testResetAndReloadDropProcesses()
{
  const source = `PROGRAM t;
PROCESS p(); BEGIN LOOP FRAME; END END
BEGIN p(); p(); LOOP FRAME; END END`;
  const { vm } = setup(source);
  vm.tick();
  assert(getUserProcesses(vm).length === 2, 'esperava 2 processos antes do reset');
  vm.reset();
  assert(getUserProcesses(vm).length === 0, 'reset() devia remover os processos do programa');
  assert(!vm.processManager.getAll().some((p) => p.isMain), 'reset() devia remover o MAIN');
  assert(vm.processManager.getAll().some((p) => p.isMouse), 'reset() nao devia remover o rato do runtime');

  vm.load(compileSource(source));
  vm.tick();
  vm.load(compileSource(source));
  vm.tick();
  assert(getUserProcesses(vm).length === 2, `um segundo load() devia substituir o programa, obtido ${getUserProcesses(vm).length} processos`);
  assert(vm.processManager.getAll().filter((p) => p.isMain).length === 1, 'devia existir um so MAIN');
}

async function testCollisionUsesGraphicSizeBeforeFirstRender()
{
  // Process width/height used to follow the graphic only once the process
  // had been drawn, so on its first tick collision() measured it with the
  // constructor's 32x32 default: two 8x8 sprites 20px apart collided.
  const bytecode = compileSource(`program size_first_tick;
global hit = -1;
process a(); begin graph = 1; x = 100; y = 100; loop frame; end end
process b(); begin graph = 1; x = 120; y = 100; loop hit = collision(type a); frame; end end
begin a(); b(); loop frame; end end`);
  const vm = new VM();
  vm.load(bytecode);
  const runtime = createRuntime(vm);
  runtime.ensureGraph(0, 1, 8, 8);
  runtime.beginFrame(1 / 60);
  vm.tick();
  runtime.beginFrame(1 / 60);
  vm.tick();
  const hit = vm.globals.get(bytecode.globals.hit);
  assert(hit === 0, `sprites 8x8 a 20px nao deviam colidir antes do primeiro render, hit=${hit}`);
  runtime.dispose();
}

async function testProcessSizeFollowsGraphUnlessScriptSetsIt()
{
  // Decision: WIDTH/HEIGHT follow the current graphic - also when GRAPH
  // changes - until the program writes either of them. It used to sync
  // only once, while both were still 32x32, so a process kept the size of
  // its first graphic.
  const bytecode = compileSource(`program size_follow;
global w1; h1; w2; h2; w3; w4;
process follow();
begin
  graph = 1;
  frame;
  w1 = width; h1 = height;
  graph = 2;
  frame;
  w2 = width; h2 = height;
  loop frame; end
end
process fixed();
begin
  width = 32;
  graph = 2;
  frame;
  frame;
  w3 = width;
  loop frame; end
end
process param(width);
begin
  graph = 2;
  frame;
  frame;
  w4 = width;
  loop frame; end
end
begin follow(); fixed(); param(50); loop frame; end end`);
  const vm = new VM();
  vm.load(bytecode);
  const runtime = createRuntime(vm);
  runtime.ensureGraph(0, 1, 8, 8);
  runtime.ensureGraph(0, 2, 16, 4);
  for (let i = 0; i < 4; i++)
  {
    runtime.beginFrame(1 / 60);
    vm.tick();
    runtime.render();
  }
  const g = (name) => vm.globals.get(bytecode.globals[name]);
  assert(g('w1') === 8 && g('h1') === 8, `com graph 1 esperado 8x8, obtido ${g('w1')}x${g('h1')}`);
  assert(g('w2') === 16 && g('h2') === 4, `depois de mudar para graph 2 esperado 16x4, obtido ${g('w2')}x${g('h2')}`);
  assert(g('w3') === 32, `width escrito pelo script devia manter-se 32, obtido ${g('w3')}`);
  assert(g('w4') === 50, `width vindo de um parametro devia manter-se 50, obtido ${g('w4')}`);
  runtime.dispose();
}

export const vmTests = [
  ['vm: MAIN ending via HALT ends its Process', testMainHaltEndsMainProcess],
  ['vm: s_kill/s_sleep/s_freeze reach MAIN', testSignalsToMain],
  ['vm: FRAME(n) throttles MAIN', testFrameNInMain],
  ['vm: s_sleep hides, s_freeze stays visible and collidable', testSleepVersusFreeze],
  ['vm: signal(TYPE x) never misrouted to a process id', testSignalTypeNeverMisroutedToId],
  ['vm: son/bigbro/smallbro links', testSonBigbroSmallbro],
  ['vm: box vs circle MTV sign', testBoxCircleMtvSign],
  ['vm: contained box MTV separates', testContainedBoxMtv],
  ['vm: collision shape follows SIZE, mirror and pivot rotation', testCollisionShapeFollowsRenderer],
  ['vm: collision_point uses the collision shapes', testCollisionPointUsesShapes],
  ['vm: sweep in one pass', testSweepSinglePass],
  ['vm: tree signal by TYPE is linear', testTreeSignalByTypeIsLinear],
  ['vm: reading son is O(1)', testSonReadIsConstantTime],
  ['vm: deep spawn chain runs without stack overflow', testDeepSpawnChain],
  ['vm: path followers of dead processes are pruned', testPathFollowersPruned],
  ['vm: let_me_alone from a child kills MAIN', testLetMeAloneFromChildKillsMain],
  ['vm: self-kill and orphan tree signals follow the manual', testSelfKillAndOrphansFollowManual],
  ['vm: reset() and reload drop the previous program', testResetAndReloadDropProcesses],
  ['vm: collision uses the graphic size before the first render', testCollisionUsesGraphicSizeBeforeFirstRender],
  ['vm: process size follows GRAPH unless the script sets it (decision)', testProcessSizeFollowsGraphUnlessScriptSetsIt]
];
