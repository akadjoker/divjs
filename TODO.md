# TODO.md - follow-up work

Companion to `BUGS.md`. Roughly ordered by priority; "priority" here
means impact-if-hit × how likely a real program is to hit it, not effort.

---

## High priority

### ~~Fix MAIN's single-tick spawn budget being a silent, permanent kill switch~~ - DONE (a4bd61b)
See `BUGS.md` #1. Fixed: a single budget exhaustion now resumes on the
next tick instead of dying permanently; a genuine infinite loop still
gets caught after 5 consecutive exhaustions with zero progress. Two
regression tests added.

### Decide what "how many processes can this realistically run" should be, and document it
The bunnymark (`bench/bunnymark.mjs`) found scaling is roughly linear
(healthy - no hidden quadratic blowup in the core scheduler) up to at
least 20,000 live processes, with the 60fps logic-only budget (16.67ms/
tick) getting tight somewhere in the 15,000–20,000 range on the hardware
this was run on - that number moved between runs (14.5ms to 29.6ms at
20,000 processes across two separate invocations), so treat it as "same
order of magnitude, not a precise cutoff." This doesn't include any
rendering cost at all (the benchmark deliberately measures VM/scheduler
throughput in isolation), so the practical number for a real game with
drawing is meaningfully lower. Worth turning into an actual documented
guideline once someone benchmarks with `CanvasEngineRuntime.render()` in
the loop too, on real hardware, with real sprites.

---

## Medium priority

### ~~Publish `.locals` for `FUNCTION` bodies and `MAIN`, matching what `PROCESS` already gets~~ - DONE
See `BUGS.md` #2. `functionTable` entries carry `.locals` and the
compiled program carries `mainLocals`; `compiler/disasm.js` uses both. Small, mechanical, mirrors `compileProcess`'s existing
pattern. Mainly benefits `compiler/disasm.js` output and any future
debugger - variable names instead of bare slot numbers everywhere, not
just inside process bodies.

### ~~`SWITCH` with multiple values per `CASE`~~ - DONE
See `BUGS.md` #4. `CASE 1, 2, 3` now works, with short-circuit evaluation
verified. One regression test with four sub-cases (match at each list
position, fall-through, short-circuit) added.

### ~~Systematically test scroll/region/path natives and signal trees~~ - DONE
See `BUGS.md` #7. 16/16 on scroll/region/path/signal-tree matrix tests -
no bugs found there. Found and fixed one real bug along the way,
unrelated to what the matrix was targeting: `xadvance`'s argument-order
auto-detection was structurally broken for angles above 180°.

---

## Low priority / nice to have

### Thread the compile-time process-type hash through `SPAWN_PROCESS` instead of recomputing at runtime
See `BUGS.md` #6. Negligible perf impact on its own; only worth doing if
touching `vm/process.js`'s `Process` constructor or `SPAWN_PROCESS` for
some other reason anyway.

### Spatial partitioning for `collision(TYPE x)` if/when it's actually measured as a bottleneck
See `BUGS.md` #5. Don't build this speculatively - benchmark
collision-heavy scenarios first (the bunnymark here didn't exercise
collision at all), and only reach for a grid/quadtree if the numbers
actually show it's needed. Real architectural work, not a quick patch.

### Document `frame(n > 100)`'s clamped-to-100 behavior somewhere a language user would see it
See `BUGS.md` #3. Currently only explained in a code comment inside
`vm.js`. Wherever DIV language documentation for this project ends up
living, this is exactly the kind of thing that needs to be written down
explicitly rather than discovered by reading source.

---

## Language ergonomics

### Multi-variable declarations: `VAR x, y, z;` instead of one keyword per name
`VAR`, `GLOBAL`, and `PRIVATE` all currently require a separate
statement - and a repeated keyword - per variable:

```div
VAR x = 0;
VAR y = 0;
VAR z = 0;
```

instead of the more natural

```div
VAR x = 0, y = 0, z = 0;
```

Confirmed in `parser/parser.js`: `parseVar()`, `parseGlobal()`, and
`parsePrivate()` each read exactly one `readIdentifierLike()` name,
optionally `= expr`, then unconditionally `expect(SEMICOLON)` - there's
no comma-handling at all in any of the three, so `VAR x, y;` is a syntax
error today (`,` where `;` is expected).

Fix shape: each of the three parse methods becomes a loop reading
`name [= expr]` separated by `COMMA`, terminated by the existing
`SEMICOLON` expectation - very close to the pattern `parseFunction()`/
`parseProcess()` already use for comma-separated parameter lists. The
compiler side needs no change at all: `compileVar`/`compileGlobal`/
`compilePrivate` already take one declaration at a time; the parser
would just emit one `ast.Var`/`ast.Global`/`ast.Private` node per name
in the list (so `VAR x, y = 5;` becomes two ordinary `Var` statements
under the hood - `x` defaulting to `0` same as it does today, `y`
initialized to `5`), rather than needing a new multi-name AST shape.

Worth deciding up front: does `VAR x, y = 5;` mean "both default to
`0`, then `y` is reassigned" or "`x` defaults to `0`, `y` is initialized
to `5`"? The second reading (each name gets its own optional initializer,
scanned left to right) is what most C-family languages with this syntax
do, and matches what a DIV author coming from that background would
expect - worth being explicit about it in whatever tests get written for
this, since it's an easy thing to get subtly backwards.

### ~~`GLOBAL` block form~~ - DONE
A bare `GLOBAL` keyword followed by several name declarations (with
`;` still terminating each, unlike the whitespace-only version originally
sketched below) now works:

```div
GLOBAL
  score;
  lives;
  high_score = 100;
```

Turned out not to need "significant whitespace" at all - `;` already
terminates every declaration in this language, so `parseGlobal()` just
keeps reading `name [= expr];` declarations as long as the next token is
identifier-like, stopping naturally at the next `PROCESS`/`FUNCTION`/
`GLOBAL`/`BEGIN` (already excluded by `isIdentifierLike()`, so no new
"end of block" detection was needed). A single declaration is the same
loop running once, so the original one-`GLOBAL`-per-name form is
unaffected.

**Found and fixed a real, pre-existing bug along the way, unrelated to
this feature itself:** `compileGlobal()`'s no-explicit-value branch
emitted `LOAD_CONST 0` with the literal number `0` as the operand - but
`LOAD_CONST`'s operand is a constant *pool index*, not a value; every
other call site in the compiler correctly goes through
`addConstant(value)` first. This one bypassed it, assuming index `0`
would always hold the value `0` - never guaranteed, and actively wrong
once `addConstant()` started deduplicating (`99c8d13`): index `0` is
whatever value happens to be the first one compiled anywhere in the
*entire* program, not necessarily `0`. Confirmed this predates and is
unrelated to today's `GLOBAL`-block work - reproduces with the original
one-`GLOBAL`-per-line syntax too (`GLOBAL score; GLOBAL other = 100;`
used to make `score` read back as `100` instead of `0`). Fixed with a
one-line change (`addConstant(0)` instead of the bare literal `0`); the
only other `LOAD_CONST` site in the whole compiler with this pattern.

### ~~Arrays and structs~~ - DONE, this section was stale
Both exist now (confirmed directly against `compiler/compiler.js` and
`parser/parser.js`, not just against this file's own claims - this
section previously said "neither exists at all," which a code review
caught as flatly contradicted by the compiler):

- **Arrays**: `GLOBAL foo[10];` and `PRIVATE foo[10];` (inside a
  process) both work - fixed-size, compile-time-checked (an
  out-of-bounds *literal* index, e.g. `foo[10]` on a size-10 array, is a
  compile error via `checkConstantArrayIndex`; a variable index out of
  range is checked at runtime instead, since its value isn't known until
  the VM runs). Indexed access compiles to `LOAD_LOCAL_IDX`/
  `STORE_LOCAL_IDX` (and the `_GLOBAL_` equivalents) with a
  runtime-computed offset, not a fixed slot. `VAR foo[10];` is **not**
  supported yet - only `GLOBAL`/`PRIVATE` accept the `[size]` form; a
  plain `VAR` stays a single scalar slot.
- **Structs**: `STRUCT name[count] field; field2; ... END` declares a
  fixed-size global array of records (see `demos/breakout.html`'s
  `STRUCT bricks[40] active; col; END`, accessed as `bricks[i].active`).
  Supports nested structs, per-field default values, and an optional
  trailing initializer list (`= val, val, N DUP(val), ...;`). This is a
  top-level declaration shape, not a "type you instantiate with a
  constructor call" - there's no `VAR p = point(1, 2);` syntax.

Still open, if useful later: `VAR`-scoped (non-global, non-private)
arrays, and dynamically-sized/growable arrays (today every array's size
is a compile-time constant baked into the instance layout).

### ~~Canonical `red`/`green`/`blue`/`alpha`/`tag` process fields~~ - DONE (`lang-features` branch)
Five new fixed slots (8-12), following the exact pattern already used
for `ctype`/`region`/`angle`. Went with four separate numeric fields
rather than one packed value (`red`/`green`/`blue` at 0-255, the
conventional 8-bit RGB range; `alpha` at 0-100, matching the scale
`scroll[i].alpha` already uses elsewhere in this runtime - kept
consistent rather than introducing a second, incompatible alpha
convention). `red`/`green`/`blue` default to `255` (a process that never
touches them is visually unaffected); `alpha` defaults to `100`
(matching `scroll.alpha`'s own default); `tag` defaults to `0`.

**Storage only**, as flagged as a separate decision below when this was
scoped - nothing in the renderer applies these to a draw call
automatically yet. A process's own `LOOP` body still calls `set_color()`
itself, same as before these fields existed; whether/how the renderer
should pick them up automatically during `drawProcessAt()` remains a
follow-up, not done here.

Confirmed a process param sharing a canonical field's name (e.g.
`PROCESS p(tag, x, y)`) shadows the fixed slot the same way a param
named `id` already did before this - not a new special case, same
existing behavior extended to five more names.

### ~~Cross-process field access: `father.x`, `son.x`~~ - DONE
`father.x`, `son.x` (and `bigbro`/`smallbro`) read and write another
process's fields through `__get_path`/`__set_path`'s relative roots
(runtime.js `resolveRelativeProcessRoot`); any variable holding a process
id works too (`id2.x`). `son`/`bigbro`/`smallbro` are O(1) links kept on
the Process at spawn (see docs/review-2026-09.md, P3.13).

---

## Rendering / engine features

### Process depth (z-order) for rendering, without a per-frame sort becoming the bottleneck
There is currently **no depth/priority concept at all**: confirmed in
`vm/runtime.js`'s `drawProcessesFallback()` - it iterates
`this.vm.processManager.getAll()` and draws in whatever order that
returns processes, which is creation order (processes are appended to a
plain array in `ProcessManager.create()` and never reordered). A process
spawned later always draws on top of one spawned earlier, with no way
for a DIV author to control it. Real games need this - a UI overlay
process, a background layer, a "this enemy is behind that wall" case -
and DIV/Fenix conventionally expose it as a per-process depth/priority
value you can read and write like `x`/`y`.

The concern about **not making this a sort bottleneck** is worth taking
seriously given what the bunnymark found: scaling is roughly linear
today, and a naive `processes.slice().sort((a, b) => a.depth - b.depth)`
called fresh every single frame is `O(n log n)` - at the process counts
the bunnymark tested (tens of thousands), that's a real, avoidable cost
added to *every* frame even when depths rarely change. Options, roughly
best-to-worst for this:

- **Maintain a sorted structure incrementally** instead of re-sorting
  from scratch: keep the draw list sorted, and when a process's depth
  changes, remove-and-reinsert just that one process (binary search for
  the insertion point) rather than re-sorting everything. Depth changes
  are typically rare relative to how often a frame renders, so this
  turns an `O(n log n)` per-frame cost into an `O(log n)` cost only when
  something's depth actually changes, plus `O(n)` to iterate the
  already-sorted list for drawing.
- **Bucket by depth** if depth values are small-integer "layers" (a
  common convention - background/game/UI, or a handful of named layers)
  rather than a continuous value: an array-of-arrays indexed by layer,
  append on spawn, and draw layer 0's array, then layer 1's, etc. `O(1)`
  insertion, `O(n)` draw, no sort ever, at the cost of losing fine-
  grained ordering *within* a layer (processes in the same layer still
  draw in spawn order).
- **Only re-sort when something actually changed**: keep a dirty flag,
  set it whenever a process's depth field is written (would need
  `STORE_LOCAL` to the depth slot to flag it, or a native setter instead
  of direct field access - the fixed-slot writes are direct-to-array
  today, so this needs either a native or a VM-level hook on that
  specific slot), full re-sort only on the frame after a change. Simpler
  than incremental reinsertion, worse worst-case (if depth changes every
  frame for even one process, this degrades to sorting every frame
  anyway).

Implementation shape, whichever ordering strategy is picked: this is
naturally a 9th canonical fixed slot, following the exact pattern already
established for `ctype`/`region`/`angle` - add it to the fixed-slot table
in `compiler/compiler.js`, `vm/vm.js`'s `SPAWN_PROCESS`, and
`vm/process.js`'s `Process` constructor/`sync()`, then have
`drawProcessesFallback()` consult it instead of raw creation order.

### Tilemap support
Nothing today: `load_tile` loads a single tile graphic by id (one image,
treated as one drawable unit, same machinery as `load_graphic`), not a
grid of tiles referencing a shared tileset with per-cell indices - there's
no map-data structure, no "draw this grid of tile indices from this
tileset" native, and no collision-against-the-map concept (`collision()`
only ever checks process-vs-process by TYPE). A real tilemap feature
needs: a map-data format (even just a 2D array of tile indices passed in
somehow), a native that draws the visible portion of it each frame
(ideally only the tiles inside the camera/viewport, not the whole map
every frame - ties into the scroll/camera system that already exists),
and probably a native or two for "what tile is at this world position"
so a process can check tile-based collision (walking into a wall tile)
without that being process-based `collision()`.

### A real collider - shaped collision, not just AABB rectangles
`collidesWith()` (`vm/process.js`) is a plain axis-aligned bounding-box
overlap test - confirmed while reviewing `collision()` earlier this
session. No circles, no polygons, no rotated rectangles (an `angle`
field exists per-process but collision never consults it). Fine for a
lot of games; not fine for anything wanting a circular hitbox (natural
for a lot of enemies/bullets) or precise polygon collision.

Two real directions here, genuinely different in scope and worth
deciding between deliberately rather than drifting into by accident:

- **Build a real shaped-collider system in this codebase.** Define
  shapes per process (circle with radius, polygon with a point list -
  probably as additional canonical fields or a small shape-descriptor
  object attached to the process), implement the actual intersection
  tests (circle-circle is trivial; circle-polygon and polygon-polygon
  need real geometry, SAT - separating axis theorem - being the standard
  approach for convex polygons). This stays entirely within the existing
  architecture and dependency-free, but is real, nontrivial geometry code
  to write and get right, and doesn't give physics (restitution,
  friction, joints, gravity as a first-class concept beyond "add to y
  each frame by hand") - just better collision *detection*, not
  collision *response*.
- **Integrate an existing 2D physics engine** - Box2D itself (via a WASM
  port) or **Planck.js** (a pure-JS/TypeScript port of Box2D, no WASM
  toolchain needed, easier to embed) as a native binding: DIV processes
  would own a physics body, natives would step the physics world once
  per tick and sync body position back onto the process's `x`/`y`
  (mirroring how `sync()` already moves data between VM locals and the
  `Process` object), and expose things like `set_velocity`,
  `apply_force`, joints, and real collision *response* (things bounce,
  push each other, stack) - not just detection. Substantially more
  capability for substantially more integration work: a new dependency,
  a body-to-process lifecycle to manage (create the physics body on
  spawn, destroy it on kill/sweep), and a real design decision about how
  much of Planck's API surface to expose as DIV natives versus keep
  simple.

  Planck.js specifically is worth a look before Box2D-via-WASM: it's
  pure JS (fits this project's zero-build-step, hand-written-parser
  ethos much better than a WASM toolchain would), and physics stepping
  cost is a separate, measurable question from what the bunnymark
  measured (that was pure movement + bounce logic, no actual physics
  simulation) - worth its own benchmark before committing to it at any
  process count.

  Given the project's current scope (VM/compiler correctness, a
  hand-rolled canvas renderer) is already substantial on its own, this
  is the bigger of the two directions and probably the one to defer
  until the collision-detection-only route has been tried and found
  wanting for a specific game that actually needs physics response.

### Other DIV/Fenix-family features this engine doesn't have yet
Surveyed the full native surface
(`registerNative()` calls in `vm/runtime.js`) to ground this rather than
guessing. Gaps, roughly in order of "how often a real 2D game needs it":

- **No audio at all.** No `play_sound`, no music/fx natives, nothing -
  confirmed absent from the native list. Any DIV-family game needs at
  minimum a "play this sound once" and "play/loop this music" pair.
- **No sprite-sheet animation helper.** `load_graphic`/`load_tile` load
  one static image by id; a process wanting to *animate* has to
  reassign its own `graph` field by hand every N frames, tracking the
  frame index itself in a PRIVATE. A native like "cycle through frames
  A to B of this sheet at rate R" (common in DIV/Fenix as `graph =
  graph + 1` inside a `frame(N)`-throttled loop, which now actually
  works correctly per this session's `frame(n)` fix) would remove a lot
  of repeated boilerplate every game would otherwise hand-roll
  identically.
- **No particle system.** Common in this genre for explosions, trails,
  weather; nothing here today beyond spawning individual processes by
  hand for each particle (which the bunnymark shows scales fine
  performance-wise, just no dedicated ergonomic API for it).
- **Keyboard-only input.** `key`/`key_down`/`key_pressed` exist; no
  mouse/pointer position or button natives, no gamepad. A lot of DIV-
  family games are keyboard/joystick-first so this may be lower priority
  than it looks, but mouse input specifically is a common enough want
  (menus, point-and-click, aiming) to flag.
- **No save/load or state serialization.** No way to snapshot a running
  game's process tree and restore it later. Notably, `BUGS.md` already
  flags that generators/coroutines (if the transpiler-to-JS-generators
  approach from early in this project's exploration had been taken
  instead of the bytecode VM that was actually built) would have made
  this *harder*, not easier - the bytecode VM's explicit
  `ip`/`stack`/`locals` per process is actually reasonably serializable
  as-is, which is a real point in its favor if this ever gets built.
- **No tween/easing helpers beyond raw trig.** `sin`/`cos`/`pow` etc.
  exist as math primitives; no `ease_in_out(t)`-style helpers or a
  "smoothly move this process from A to B over N frames" native, which
  most small 2D games end up hand-rolling identically many times over.

### Consider building the renderer on an existing engine (PixiJS) instead of hand-rolled canvas 2D
Worth a deliberate decision, not a default. `CanvasEngineRuntime`
(`vm/runtime.js`) draws directly via the 2D canvas context today -
`fillRect`, `arc`, `drawImage`, one draw call per process per frame, no
batching, no GPU acceleration beyond whatever the browser's own 2D
canvas backend already does internally.

**Case for PixiJS:** WebGL-backed, sprite batching (many sprites drawn
in fewer GPU calls than one-draw-call-per-sprite), a mature scene-graph,
built-in support for exactly the kind of animation/particle/tween gaps
listed above. Given the bunnymark explicitly did *not* measure render
cost (it isolated VM/scheduler throughput on purpose), and canvas 2D
`drawImage` cost per sprite is a completely different, separately-
measurable question from what was benchmarked - if a real game needs
thousands of *visible, drawn* sprites (not just thousands of ticking
processes with nothing on screen, which is what the bunnymark tested),
render cost is very plausibly the actual bottleneck long before VM
throughput is, and PixiJS is specifically built to push that ceiling far
higher than hand-rolled canvas 2D calls can.

**Case against, or at least for waiting:** it's a new dependency and a
full rewrite of the drawing half of `CanvasEngineRuntime` (the VM/
compiler/process side is entirely unaffected - this is purely a renderer
swap, DIV programs wouldn't need to change at all, natives like
`circle`/`draw_rect`/`xput` would just be reimplemented against Pixi's
API underneath). Also: this hasn't actually been measured as a problem
yet - the honest thing is to benchmark real render cost (a bunnymark
variant that actually draws each bunny via `CanvasEngineRuntime.render()`,
sweeping process count, measuring `render()` time specifically the way
`bench/bunnymark.mjs` already isolates `tick()` time) *before* deciding
whether hand-rolled canvas 2D is actually the bottleneck worth solving
this way, rather than assuming it and rewriting preemptively.

---

## Process notes (how this list was built, for whoever picks it up next)

Everything in `BUGS.md` above the natives/signal-trees item (#7) was
found through direct, deliberate investigation this session - either an
exhaustive test matrix (loops, expressions, forward references) or by
building and running a real tool against the compiler (`disasm.mjs`
surfaced the constant-pool and FOR-loop optimization opportunities;
`bench/bunnymark.mjs` surfaced the MAIN spawn-budget bug). That pattern -
build something real, run it, read what it actually says - found more
than guessing at what might be wrong ever did. Worth repeating for #7
rather than trying to reason about scroll/region correctness from reading
the code alone.

The "Language ergonomics" and "Rendering / engine features" sections
above are different in kind from everything before them: not bugs, not
things confirmed broken by testing, but a feature/roadmap wishlist -
grounded in what the current grammar and native surface actually do (verified
directly against the parser and runtime source, not guessed at) rather
than invented from nothing, but genuinely open design questions rather
than a spec ready to implement. Worth a real discussion about priority
and scope before picking any one of them up, especially the collider/
physics and PixiJS questions, both of which are significant enough
architectural decisions to want deliberate buy-in first.

