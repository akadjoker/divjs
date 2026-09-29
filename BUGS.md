# BUGS.md - known issues, not yet fixed

Everything below was found while working through parser/compiler/VM
correctness, expression semantics, and the bunnymark stress test. None of
this is fixed yet - this file exists to track it for later, per request.
Ordered roughly by severity.

---

## 1. ~~MAIN silently truncates and permanently dies on a large single-tick spawn loop~~ - FIXED in a4bd61b

**Severity: high.** Found while building `bench/bunnymark.mjs`. **Fixed.**

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
first `FRAME`" - and once it fires, **`mainFinished = true` is
permanent**. `tick()` checks `if (!this.mainFinished) { this.runMain(); }`
every frame, so once this fires, MAIN never runs again for the rest of
the program's life - not just that tick.

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

Requesting 5,000 bunnies in one `FOR` loop - with this exact per-spawn
instruction cost (a handful of arithmetic ops per argument plus the
spawn call itself, roughly 30 instructions/iteration including the loop
overhead) - silently produces **3,225 live processes**, not 5,000, and
**every larger count tested (5,000 / 10,000 / 20,000 / 50,000) also
produces exactly 3,225** - the loop always dies at the same iteration
count once the same fixed per-spawn instruction cost is involved. Confirmed via
`vm.processManager.getAll().length` after the spawn tick; `console.error`
prints `MAIN: no FRAME in loop` with zero other indication anything went
wrong. The trailing `LOOP FRAME; END` in the example above - which is
what would otherwise keep MAIN "alive" for later game-state logic -
never runs either.

### Why this matters for real programs

Any DIV program with a spawn loop, particle burst, wave-based enemy
spawner, or similar pattern that does enough real per-iteration work to
cross ~100,000 instructions in a single tick will hit this. The exact
threshold is **program-dependent** (fewer/cheaper spawn arguments raise
it, more/heavier ones lower it), which makes it hard to predict without
hitting it. Nothing in the language or compiler warns that this ceiling
exists.

### Possible directions (not evaluated in depth - pick one for `TODO.md`)

- Raise the budget substantially (trades off catching genuinely runaway
  loops later / less precisely).
- Make the guard resumable instead of terminal: instead of
  `mainFinished = true`, save `ip` and resume MAIN's execution from where
  it left off on the *next* tick, spending a fresh budget each time -
  turns "one big spawn loop" into an implicit multi-tick batch
  automatically, without the author having to hand-write batching (which
  is the workaround `bench/bunnymark.mjs` uses today).
- At minimum: make the failure loud in a way a game author would actually
  see (not just a `console.error` easy to miss in a browser console),
  and document the ceiling.

### Fix applied (a4bd61b)

Went with "make the guard resumable instead of terminal," plus a streak
counter so a genuine infinite loop (one that never reaches FRAME no
matter how many extra ticks it's given) still gets caught: a single
budget exhaustion now resumes on the next tick via the exact same
mainIp/mainStack/mainLocals/mainCallStack (or per-process equivalent)
save/restore that already existed; after 5 *consecutive* exhaustions
with zero progress, it's treated as genuinely stuck and stopped for
real. The 5,000-process repro above now completes in 2 ticks instead of
plateauing at 3,225 forever. `bench/bunnymark.mjs` still uses the
batched-spawner workaround since it predates the fix and there's no
reason to change a working benchmark, but new code doesn't need it.

---

## 2. ~~`functionTable` (and MAIN) don't publish a `.locals` map like `processTable` does~~ - FIXED

**Severity: low - tooling/debuggability, not correctness.** **Fixed:**
`compileFunction` publishes `functionTable` entries' `.locals`, the
compiled program carries `mainLocals`, and `compiler/disasm.js` resolves
slot names in FUNCTION and MAIN bodies too. The description below is
kept for history.

`processTable` entries carry `{ addr, params, privates, locals }`, where
`.locals` maps every local variable name to its slot index - used by
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

## 3. ~~`frame(n)` for `n > 100` is clamped to "run every tick"~~ - FIXED

`FRAME(n)` with n > 100 now skips frames like DIV: `FRAME(200)` runs every
other frame, `FRAME(300)` every third - MAIN included (see
docs/review-2026-09.md, P3.10). The remaining limitation is n < 100 ("run
more than once per frame"), which behaves as `FRAME(100)`: the scheduler
runs each process at most once per `vm.tick()`.

---

## 4. ~~`SWITCH`/`CASE` only supports one value per case~~ - FIXED in (this commit)

**Severity: low - feature gap, not a bug in what exists. Fixed.**

`CASE 1, 2, 3` (multiple values sharing one body) now works - matches
if the subject equals any of them, short-circuiting on the first match
(later values in the same list are never evaluated once an earlier one
hits, verified with a side-effecting `mark()` call). `parseSwitch()`
parses comma-separated values into a `values` array per case;
`compileSwitch()` compiles all but the last as `EQ` + `JUMP_IF_TRUE`
straight into the body, and the last as the existing single-value
`EQ` + `JUMP_IF_FALSE`-to-next-case - so a CASE with exactly one value
(the common case) compiles to exactly what it always did.

---

## 5. `collision(TYPE x)` is O(k) over every live process of that type, no spatial partitioning

**Severity: low at current scale - noted after the bunnymark, not measured directly.**

`ProcessManager.collision()` does an O(1) lookup by type (a `Map<type,
Set<id>>`), then an O(k) linear scan with an AABB test over every process
of that specific type. Fine at hundreds of same-type processes; a
game with thousands of enemies of the same type all checking collision
against each other every frame would start feeling this - the bunnymark
above didn't exercise `collision()` at all (bunnies don't check collision
against each other), so this is a reasoned prediction from reading the
code, not a directly measured number. Would need a grid or quadtree to
fix properly; meaningful architectural work, not a quick patch.

---

## 6. `Process` recomputes `processTypeCode(name)` on every single spawn

**Severity: negligible - noted for completeness, not worth chasing.**

`Process`'s constructor computes `processTypeCode(name)` (utils/hash.js; negative values, disjoint from process ids) fresh every time a
process is created, even though the compiler already computes the exact
same hash once, at compile time, for every `TYPE x` operator reference.
The two hashes have to stay consistent (they do, both delegate to the
same `utils/hash.js`) but there's no reason the runtime one needs
recomputing - it could be threaded through `SPAWN_PROCESS`'s params from
`processTable` instead. Spawning happens far less often than
per-instruction VM dispatch, so the actual cost of this is minor; flagged
only because it's a small, obviously-fixable redundancy if anyone's ever
touching this code for another reason anyway.

---

## 7. ~~Native geometric functions and signal trees not exhaustively tested~~ - DONE, one real bug found and fixed

**Severity: was unknown, now resolved.**

Ran the same systematic matrix-testing treatment the rest of the
language got this session against `scroll`/`region`/`define_region`/
`__get_path`/`__set_path`/`advance`/`xadvance` and all four signal-tree
variants (`S_KILL_TREE`/`S_WAKEUP_TREE`/`S_SLEEP_TREE`/`S_FREEZE_TREE`),
including 3-level process hierarchies (grandparent → parent → child) and
TYPE-based tree signals affecting multiple independent trees at once.

**Results: 16/16 on scroll/region/path/signal-tree tests - no bugs
found there.** `let_me_alone`, `S_KILL` (non-tree, target only) vs.
`S_KILL_TREE` (target + all descendants), sleep/wakeup trees, and
type-based tree signals across multiple trees all behaved exactly as
expected.

**One real bug found and fixed in `xadvance`.** See the "Fix applied"
note below - `xadvanceNative`'s argument-order auto-detection heuristic
was structurally wrong (not just miscalibrated), and any angle between
180°-360° passed as the second argument would silently be misread as a
distance, producing wildly wrong movement.

### Fix applied

`xadvanceNative(arg1, arg2)` used to guess whether it was called as
`xadvance(distance, angle)` or `xadvance(angle, distance)` by checking
which argument's magnitude exceeds 180000 (assuming "an angle shouldn't
exceed 180000"). That assumption doesn't hold in this engine:
`toRadiansFromDivAngle()` never wraps or clamps its input, and the
project's own shipped demo (`index.html`) increments an angle
unboundedly frame after frame, confirming angles routinely span the
full 0-360000 convention (a complete turn), not just half of it. Any
angle between 180001-360000 passed as the second argument would be
misclassified as "must be the distance", producing movement wrong in
both magnitude and direction - e.g. `xadvance(10, 270000)` (10 units at
270°, straight up) used to move ~270000 units in nearly the wrong
direction instead. There's no magnitude threshold that fixes this: on-
screen distances routinely reach into the hundreds or low thousands too,
overlapping the legitimate angle range too broadly for guessing to ever
be reliable in general.

Fixed to a plain, fixed `(distance, angle)` argument order - matching
`advanceNative()` exactly - instead of guessing. The one existing test
(`testXAdvanceMovesByAngle`, calling `xadvance(10, 0)`) only exercised
the ambiguous small-magnitude case and still passes unchanged. Added
`testXAdvanceHandlesAnglesAboveHalfCircle`, calling `xadvance(10,
270000)` and asserting the correct straight-up movement, as a
regression test for exactly this case.
