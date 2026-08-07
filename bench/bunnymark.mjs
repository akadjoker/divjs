#!/usr/bin/env node
// Usage: node bench/bunnymark.mjs [counts...]
//   node bench/bunnymark.mjs                  -> default sweep
//   node bench/bunnymark.mjs 1000 5000 20000   -> custom counts
//
// Classic "bunnymark" stress test, adapted for a process-based VM instead
// of a renderer: spawn N processes, each with a small per-frame update
// (move + bounce off screen bounds), run for a fixed number of ticks with
// no rendering at all (this measures VM/scheduler throughput in
// isolation, not canvas draw cost — CanvasEngineRuntime.render() is a
// separate, additive cost this doesn't attempt to measure), and report
// ms/tick and ticks/sec at each process count. The goal is finding where
// this VM's per-tick cost stops being roughly linear in process count —
// that inflection point is the answer to "how far can this go".

import { Lexer } from '../compiler/tokenizer.js';
import { Parser } from '../parser/parser.js';
import { Compiler } from '../compiler/compiler.js';
import { VM } from '../vm/vm.js';

function buildSource(count, batch) {
  return `PROGRAM bunnymark;

GLOBAL screen_w = 800;
GLOBAL screen_h = 600;
GLOBAL spawned = 0;
GLOBAL target = ${count};

PROCESS bunny(x, y, vx, vy);
BEGIN
  width = 8; height = 8;
  LOOP
    x = x + vx;
    y = y + vy;
    IF (x < 0) x = 0; vx = -vx; END
    IF (x > screen_w) x = screen_w; vx = -vx; END
    IF (y < 0) y = 0; vy = -vy; END
    IF (y > screen_h) y = screen_h; vy = -vy; END
    FRAME;
  END
END

PROCESS spawner();
BEGIN
  LOOP
    IF (spawned >= target) BREAK; END
    FOR j = 0 TO ${batch - 1}
      IF (spawned >= target) BREAK; END
      bunny((spawned * 37) % 800, (spawned * 53) % 600, 2 + (spawned % 5), 1 + (spawned % 4));
      spawned = spawned + 1;
    END
    FRAME;
  END
END

BEGIN
  spawner();
  LOOP FRAME; END
END`;
}

const SPAWN_BATCH = 200;

function runOne(count, ticks) {
  const source = buildSource(count, SPAWN_BATCH);
  const compileStart = process.hrtime.bigint();
  const bytecode = new Compiler().compile(new Parser(new Lexer(source).tokenize()).parse());
  const compileMs = Number(process.hrtime.bigint() - compileStart) / 1e6;

  const vm = new VM();
  vm.debug = false;
  vm.load(bytecode);
  vm.dt = 1 / 60;

  // Spawning happens in batches of SPAWN_BATCH per tick (via the
  // "spawner" process in the generated source) instead of one giant FOR
  // loop in MAIN — see BUGS.md "MAIN silently truncates and permanently
  // stops on large spawn loops" for why: a single-tick spawn loop hits
  // the 100,000-instruction per-tick budget guard (vm.js's runMain())
  // well before 5,000 processes with this per-spawn instruction cost,
  // after which MAIN silently stops forever. Batching keeps each
  // individual tick's instruction count far under that ceiling
  // regardless of the total target count, so this measures genuine
  // steady-state throughput instead of an artifact of that limit.
  const spawnTicksNeeded = Math.ceil(count / SPAWN_BATCH) + 2;
  const spawnStart = process.hrtime.bigint();
  for (let t = 0; t < spawnTicksNeeded; t++) {
    vm.tick();
  }
  const spawnMs = Number(process.hrtime.bigint() - spawnStart) / 1e6;

  const liveCount = vm.processManager.getAll().length;

  const steadyStart = process.hrtime.bigint();
  for (let t = 0; t < ticks; t++) {
    vm.tick();
  }
  const steadyMs = Number(process.hrtime.bigint() - steadyStart) / 1e6;
  const msPerTick = steadyMs / ticks;

  return {
    count,
    liveCount,
    compileMs,
    spawnMs,
    spawnTicksNeeded,
    msPerTick,
    ticksPerSec: 1000 / msPerTick
  };
}

const args = process.argv.slice(2).map(Number).filter((n) => Number.isFinite(n) && n > 0);
const counts = args.length > 0 ? args : [100, 500, 1000, 2000, 5000, 10000, 20000, 50000];
const TICKS = 300;

console.log(`bunnymark: ${TICKS} steady-state ticks per data point, dt=1/60, no rendering\n`);
console.log(
  'processes'.padStart(10) + '  ' +
  'live'.padStart(7) + '  ' +
  'compile(ms)'.padStart(11) + '  ' +
  'spawn tick(ms)'.padStart(14) + '  ' +
  'ms/tick'.padStart(9) + '  ' +
  'ticks/sec'.padStart(10) + '  ' +
  'us/process/tick'.padStart(16)
);

const results = [];
for (const count of counts) {
  try {
    const r = runOne(count, TICKS);
    results.push(r);
    const usPerProcessPerTick = (r.msPerTick * 1000) / r.liveCount;
    const truncated = r.liveCount !== r.count ? '  <-- TRUNCATED' : '';
    console.log(
      String(r.count).padStart(10) + '  ' +
      String(r.liveCount).padStart(7) + '  ' +
      r.compileMs.toFixed(2).padStart(11) + '  ' +
      r.spawnMs.toFixed(2).padStart(14) + '  ' +
      r.msPerTick.toFixed(3).padStart(9) + '  ' +
      r.ticksPerSec.toFixed(0).padStart(10) + '  ' +
      usPerProcessPerTick.toFixed(2).padStart(16) +
      truncated
    );
  } catch (err) {
    console.log(String(count).padStart(10) + '  FAILED: ' + err.message);
  }
}

if (results.length >= 2) {
  console.log('\nScaling check (ideal is a constant us/process/tick across rows above —');
  console.log('a rising trend means per-tick cost is growing faster than linearly in N):');
  const first = results[0];
  const last = results[results.length - 1];
  const firstUs = (first.msPerTick * 1000) / first.liveCount;
  const lastUs = (last.msPerTick * 1000) / last.liveCount;
  const ratio = lastUs / firstUs;
  console.log(`  ${first.count} processes: ${firstUs.toFixed(2)} us/process/tick`);
  console.log(`  ${last.count} processes: ${lastUs.toFixed(2)} us/process/tick`);
  console.log(`  ratio: ${ratio.toFixed(2)}x ${ratio < 1.5 ? '(roughly linear, healthy)' : ratio < 3 ? '(some superlinear growth)' : '(clearly superlinear — investigate)'}`);
}

const sixtyFpsBudgetMs = 1000 / 60;
console.log(`\nFor reference, a 60fps frame budget is ${sixtyFpsBudgetMs.toFixed(2)}ms; anything at or above that`);
console.log('ms/tick above means this many processes alone would already miss 60fps, before any rendering cost.');
