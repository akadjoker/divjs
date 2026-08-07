# TODO.md — follow-up work

Companion to `BUGS.md`. Roughly ordered by priority; "priority" here
means impact-if-hit × how likely a real program is to hit it, not effort.

---

## High priority

### Fix MAIN's single-tick spawn budget being a silent, permanent kill switch
See `BUGS.md` #1. This is the one item here that's a genuine correctness
bug (silent data loss — requested processes just don't get created, no
error surfaces anywhere a game author would see it) rather than a
performance ceiling or missing feature. Needs a design decision first
(raise the budget vs. make it resumable across ticks vs. both), then
implementation, then a regression test reproducing the exact scenario in
`BUGS.md` (request N processes in one MAIN-level `FOR` loop, assert
`processManager.getAll().length === N` after spawning settles).

### Decide what "how many processes can this realistically run" should be, and document it
The bunnymark (`bench/bunnymark.mjs`) found scaling is roughly linear
(healthy — no hidden quadratic blowup in the core scheduler) up to at
least 20,000 live processes, with the 60fps logic-only budget (16.67ms/
tick) getting tight somewhere in the 15,000–20,000 range on the hardware
this was run on — that number moved between runs (14.5ms to 29.6ms at
20,000 processes across two separate invocations), so treat it as "same
order of magnitude, not a precise cutoff." This doesn't include any
rendering cost at all (the benchmark deliberately measures VM/scheduler
throughput in isolation), so the practical number for a real game with
drawing is meaningfully lower. Worth turning into an actual documented
guideline once someone benchmarks with `CanvasEngineRuntime.render()` in
the loop too, on real hardware, with real sprites.

---

## Medium priority

### Publish `.locals` for `FUNCTION` bodies and `MAIN`, matching what `PROCESS` already gets
See `BUGS.md` #2. Small, mechanical, mirrors `compileProcess`'s existing
pattern. Mainly benefits `compiler/disasm.js` output and any future
debugger — variable names instead of bare slot numbers everywhere, not
just inside process bodies.

### `SWITCH` with multiple values per `CASE`
See `BUGS.md` #4. `CASE 1, 2, 3` sharing one body. Needs
`parseSwitch()`'s case-value to become a list, and `compileSwitch()` to
compile each case as a chain of `EQ`/`OR` against the subject instead of
one `EQ`. Not hard, just not done.

### Systematically test scroll/region/path natives and signal trees
See `BUGS.md` #7. Same treatment the rest of the language got this
session: build a matrix of small `.div` programs exercising
`start_scroll`/`stop_scroll`/`define_region`/`__get_path`/`__set_path`
and the four `*_TREE` signal variants against nested process hierarchies,
run them, see what falls out. Given how much turned up in exhaustive
testing of loops/expressions/forward-references earlier, this is the
most likely remaining place for a real bug to still be hiding.

---

## Low priority / nice to have

### Thread the compile-time process-type hash through `SPAWN_PROCESS` instead of recomputing at runtime
See `BUGS.md` #6. Negligible perf impact on its own; only worth doing if
touching `vm/process.js`'s `Process` constructor or `SPAWN_PROCESS` for
some other reason anyway.

### Spatial partitioning for `collision(TYPE x)` if/when it's actually measured as a bottleneck
See `BUGS.md` #5. Don't build this speculatively — benchmark
collision-heavy scenarios first (the bunnymark here didn't exercise
collision at all), and only reach for a grid/quadtree if the numbers
actually show it's needed. Real architectural work, not a quick patch.

### Document `frame(n > 100)`'s clamped-to-100 behavior somewhere a language user would see it
See `BUGS.md` #3. Currently only explained in a code comment inside
`vm.js`. Wherever DIV language documentation for this project ends up
living, this is exactly the kind of thing that needs to be written down
explicitly rather than discovered by reading source.

---

## Process notes (how this list was built, for whoever picks it up next)

Everything in `BUGS.md` above the natives/signal-trees item (#7) was
found through direct, deliberate investigation this session — either an
exhaustive test matrix (loops, expressions, forward references) or by
building and running a real tool against the compiler (`disasm.mjs`
surfaced the constant-pool and FOR-loop optimization opportunities;
`bench/bunnymark.mjs` surfaced the MAIN spawn-budget bug). That pattern —
build something real, run it, read what it actually says — found more
than guessing at what might be wrong ever did. Worth repeating for #7
rather than trying to reason about scroll/region correctness from reading
the code alone.
