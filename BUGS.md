# BUGS.md — known issues, not yet fixed

Everything below was found while working through parser/compiler/VM
correctness, expression semantics, and the bunnymark stress test. None of
this is fixed yet — this file exists to track it for later, per request.
Ordered roughly by severity.

---

## 1. MAIN silently truncates and permanently dies on a large single-tick spawn loop

**Severity: high.** Found while building `bench/bunnymark.mjs`.

`vm.js`'s `runMain()` (and `runProcess()`, same mechanism) has a
per-tick instruction budget:

```js
let budget = 100000;
while (!this.frameYield && !this.mainFinished && !this.halted) {
  if (--budget <= 0) {
    console.error('MAIN: no FRAME in loop');
    this.mainFinished = true;
    break;
  }
  ...
}
```

This exists as a safety net against a genuinely infinite loop that never
hits `FRAME` (a real bug class, worth guarding against). But it doesn't
distinguish "stuck forever" from "doing a lot of real work before its
first `FRAME`" — and once it fires, **`mainFinished = true` is
permanent**. `tick()` checks `if (!this.mainFinished) { this.runMain(); }`
every frame, so once this fires, MAIN never runs again for the rest of
the program's life — not just that tick.

### Repro

```div
PROGRAM t;
PROCESS bunny(x, y, vx, vy);
BEGIN
  LOOP FRAME; END
END
BEGIN
  FOR i = 0 TO 4999
    bunny((i * 37) % 800, (i * 53) % 600, 2 + (i % 5), 1 + (i % 4));
  END
  LOOP FRAME; END
END
```

Requesting 5,000 bunnies in one `FOR` loop — with this exact per-spawn
instruction cost (a handful of arithmetic ops per argument plus the
spawn call itself, roughly 30 instructions/iteration including the loop
overhead) — silently produces **3,225 live processes**, not 5,000, and
**every larger count tested (5,000 / 10,000 / 20,000 / 50,000) also
produces exactly 3,225** — the loop always dies at the same iteration
count once the same fixed per-spawn instruction cost is involved. Confirmed via
`vm.processManager.getAll().length` after the spawn tick; `console.error`
prints `MAIN: no FRAME in loop` with zero other indication anything went
wrong. The trailing `LOOP FRAME; END` in the example above — which is
what would otherwise keep MAIN "alive" for later game-state logic —
never runs either.

### Why this matters for real programs

Any DIV program with a spawn loop, particle burst, wave-based enemy
spawner, or similar pattern that does enough real per-iteration work to
cross ~100,000 instructions in a single tick will hit this. The exact
threshold is **program-dependent** (fewer/cheaper spawn arguments raise
it, more/heavier ones lower it), which makes it hard to predict without
hitting it. Nothing in the language or compiler warns that this ceiling
exists.

### Possible directions (not evaluated in depth — pick one for `TODO.md`)

- Raise the budget substantially (trades off catching genuinely runaway
  loops later / less precisely).
- Make the guard resumable instead of terminal: instead of
  `mainFinished = true`, save `ip` and resume MAIN's execution from where
  it left off on the *next* tick, spending a fresh budget each time —
  turns "one big spawn loop" into an implicit multi-tick batch
  automatically, without the author having to hand-write batching (which
  is the workaround `bench/bunnymark.mjs` uses today).
- At minimum: make the failure loud in a way a game author would actually
  see (not just a `console.error` easy to miss in a browser console),
  and document the ceiling.

---

## 2. `functionTable` (and MAIN) don't publish a `.locals` map like `processTable` does

**Severity: low — tooling/debuggability, not correctness.**

`processTable` entries carry `{ addr, params, privates, locals }`, where
`.locals` maps every local variable name to its slot index — used by
`compiler/disasm.js` to show `LOAD_LOCAL 8 ; vy` instead of a bare `8`.
`functionTable` entries only ever get `{ addr, params }`; MAIN has no
table entry with local names at all. So `disasm.mjs`'s output shows bare
slot numbers for any `LOAD_LOCAL`/`STORE_LOCAL` inside a `FUNCTION` body
or inside `MAIN` itself, while the same instructions inside a `PROCESS`
body show the resolved name.

Fix would mirror `compileProcess`'s existing `.locals` publishing in
`compileFunction`, and give MAIN's own compile pass a small synthetic
table entry the same shape.

---

## 3. `frame(n)` for `n > 100` is clamped to "run every tick," not a real speedup

**Severity: low — documented limitation, not silently wrong.**

`frame(n)` throttling (added this session) correctly slows a process down
for `n < 100` via a per-process credit accumulator. For `n > 100`
("run faster than every tick"), the credit is clamped to 100/tick because
this scheduler calls each process at most once per external `tick()` —
there's no way to represent "run twice in one tick" without executing a
process's bytecode more than once per `vm.tick()` call, which nothing
currently supports. `frame(200)` behaves identically to `frame(100)`. The
code comment explains this; there's no user-facing documentation of it
anywhere else.

---

## 4. `SWITCH`/`CASE` only supports one value per case

**Severity: low — feature gap, not a bug in what exists.**

`CASE 1, 2, 3` (multiple values sharing one body) isn't supported — each
`CASE` takes exactly one expression. Common in other switch-like
constructs; not implemented here. `parseSwitch()`/`compileSwitch()` would
need the case-value list to become an array compiled as a chain of `EQ`/
`OR` checks against the subject instead of a single `EQ`.

---

## 5. `collision(TYPE x)` is O(k) over every live process of that type, no spatial partitioning

**Severity: low at current scale — noted after the bunnymark, not measured directly.**

`ProcessManager.collision()` does an O(1) lookup by type (a `Map<type,
Set<id>>`), then an O(k) linear scan with an AABB test over every process
of that specific type. Fine at hundreds of same-type processes; a
game with thousands of enemies of the same type all checking collision
against each other every frame would start feeling this — the bunnymark
above didn't exercise `collision()` at all (bunnies don't check collision
against each other), so this is a reasoned prediction from reading the
code, not a directly measured number. Would need a grid or quadtree to
fix properly; meaningful architectural work, not a quick patch.

---

## 6. `Process` recomputes `hashCode(name)` on every single spawn

**Severity: negligible — noted for completeness, not worth chasing.**

`Process`'s constructor computes `hashCode(name)` fresh every time a
process is created, even though the compiler already computes the exact
same hash once, at compile time, for every `TYPE x` operator reference.
The two hashes have to stay consistent (they do, both delegate to the
same `utils/hash.js`) but there's no reason the runtime one needs
recomputing — it could be threaded through `SPAWN_PROCESS`'s params from
`processTable` instead. Spawning happens far less often than
per-instruction VM dispatch, so the actual cost of this is minor; flagged
only because it's a small, obviously-fixable redundancy if anyone's ever
touching this code for another reason anyway.

---

## 7. Native geometric functions (`scroll`, `region`, `xput`, `xadvance`) and signal trees not exhaustively tested

**Severity: unknown — this is a coverage gap, not a confirmed bug.**

The parser/compiler/VM correctness passes this session (loops,
expressions, forward references, `SWITCH`, error locations) were
exhaustive. The scroll/region/path natives (`vm/runtime.js`'s
`__get_path`/`__set_path` machinery, `start_scroll`/`stop_scroll`,
`define_region`) and the signal-tree operations
(`S_KILL_TREE`/`S_WAKEUP_TREE`/`S_SLEEP_TREE`/`S_FREEZE_TREE`) only have
the test coverage that existed before this session
(`tests/browser-tests.js`'s `testPathNativesScrollState` and
`testSignalKillTreeAndWakeupByType`) — nothing here got the same
systematic matrix-testing treatment. Could well be fine; hasn't been
checked with the same rigor as everything else.
