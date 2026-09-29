#!/usr/bin/env node
// Usage: node bench/sortmark.mjs [counts...]
//
// Measures the cost of sorting processes by a depth/priority field at render
// time, comparing three strategies at each process count:
//   none       - baseline, no sort (current behaviour)
//   naive      - slice().sort() every tick (O(n log n) unconditionally)
//   dirty-flag - full sort only when the dirty flag is set; we set it on
//                every tick here (worst-case for dirty-flag: something changes
//                every frame) so this matches naive in sort frequency but
//                shows the flag-check overhead in isolation
//   every-Nth  - sort every 10 ticks (simulates static or slowly-changing
//                depth - a more realistic game scenario)
//
// The sort itself runs at the JS level after vm.tick(), exactly where
// drawProcessesFallback() would run it. Each variant uses the same spawned
// process list from the same VM run; only the post-tick sort strategy changes.

import { Lexer } from '../compiler/tokenizer.js';
import { Parser } from '../parser/parser.js';
import { Compiler } from '../compiler/compiler.js';
import { VM } from '../vm/vm.js';

// Reuse the same bunny source as bunnymark.mjs
function buildSource(count, batch) {
  return `PROGRAM sortmark;

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
const TICKS = 300;

function spawnVM(count) {
  const bytecode = new Compiler().compile(
    new Parser(new Lexer(buildSource(count, SPAWN_BATCH)).tokenize()).parse()
  );
  const vm = new VM();
  vm.debug = false;
  vm.load(bytecode);
  vm.dt = 1 / 60;

  const spawnTicks = Math.ceil(count / SPAWN_BATCH) + 2;
  for (let t = 0; t < spawnTicks; t++) vm.tick();
  return vm;
}

// comparator mirrors what a priority-slot sort would do
function byPriority(a, b) { return (a.locals[8] ?? 0) - (b.locals[8] ?? 0); }

function measureStrategy(vm, strategy) {
  let drawList = vm.processManager.getAll().slice(); // copy of refs
  let dirty = true;

  const start = process.hrtime.bigint();
  for (let t = 0; t < TICKS; t++) {
    vm.tick();

    switch (strategy) {
      case 'naive':
        drawList = vm.processManager.getAll().slice();
        drawList.sort(byPriority);
        break;
      case 'dirty-flag':
        // worst-case: mark dirty every tick (simulates depth changing each frame)
        dirty = true;
        if (dirty) {
          drawList = vm.processManager.getAll().slice();
          drawList.sort(byPriority);
          dirty = false;
        }
        break;
      case 'every-10':
        if (t % 10 === 0) {
          drawList = vm.processManager.getAll().slice();
          drawList.sort(byPriority);
        }
        break;
      // 'none': no sort
    }
  }
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  return ms / TICKS;
}

const args = process.argv.slice(2).map(Number).filter(n => Number.isFinite(n) && n > 0);
const counts = args.length > 0 ? args : [500, 1000, 2000, 5000, 10000, 20000];

const strategies = ['none', 'naive', 'dirty-flag', 'every-10'];
const COL = 10;

console.log(`sortmark: ${TICKS} ticks/strategy, no rendering - sort cost vs baseline\n`);
console.log(
  'processes'.padStart(COL) +
  strategies.map(s => s.padStart(13)).join('') +
  '  naive overhead'
);
console.log('-'.repeat(COL + strategies.length * 13 + 18));

for (const count of counts) {
  // Spawn one VM per strategy to avoid cross-contamination of state
  const results = {};
  for (const s of strategies) {
    const vm = spawnVM(count);
    results[s] = measureStrategy(vm, s);
  }

  const overhead = ((results['naive'] - results['none']) / results['none'] * 100).toFixed(1);
  const live = spawnVM(count).processManager.getAll().length; // just for display

  process.stdout.write(
    String(live).padStart(COL) +
    strategies.map(s => (results[s].toFixed(3) + 'ms').padStart(13)).join('') +
    `  +${overhead}%\n`
  );
}

console.log('\nColumns are ms/tick. "naive overhead" = (naive - none) / none.');
