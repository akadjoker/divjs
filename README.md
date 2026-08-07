# DivJS

DivJS is a browser-first game scripting runtime inspired by DIV Games Studio and BennuGD.
It includes a full language pipeline (tokenizer -> parser -> compiler -> VM), a process model,
Canvas 2D rendering, collision, pathfinding, and utility natives for gameplay scripting.

## Current Capabilities

- Language pipeline: tokenizer, parser, AST, compiler, bytecode VM
- Process-based game model with TYPE lookup and signaling
- Canvas 2D renderer with draw commands and process rendering
- Input: keyboard + mouse
- Collision system: box/circle, explicit collision boxes, penetration metadata
- Pathfinding: grid A* + timer-based path following
- Asset support:
  - Graphics (`load_graphic`, `load_tile`)
  - DIV/Bennu assets (`load_map`, `load_fpg`, `load_fnt`)
  - BDF bitmap fonts (`load_bdf_font`, `load_bdf_font_text`)
- Gameplay math helpers:
  - Trig/conversion (`sin`, `cos`, `atan2`, `torad`, `todeg`, `normalize_angle`)
  - Interpolation and shaping (`lerp`, `lerp_angle`, `smoothstep`, `hermite`, `ping_pong`)
  - Geometry helpers (`distance`, `distance_rect`, `fget_angle`, `fget_distance`, `get_distx`, `get_disty`)

## Project Structure

```text
compiler/      Bytecode opcodes, compiler, disassembler
parser/        Language parser
vm/            VM, process manager, runtime natives, DIV/BDF loaders
graph/         Graphics asset registry
demos/         Browser demos
examples/      Minimal runnable examples
tests/         Browser-oriented test suite + pipeline tests
```

## Quick Start

Run the pipeline tests:

```bash
npm run test:pipeline
```

Open examples in a browser:

```bash
open examples/index.html
open examples/browser-smoke.html
open tests/test.html
```

## Fast Demo Bootstrap API

Use `runDivDemo` to start a script with minimal setup:

```js
import { runDivDemo } from './divjs.js';

runDivDemo({
  canvas: 'gameCanvas',
  source: `program demo; begin loop frame; end end`
});
```

This handles:

- compile + VM load
- runtime native registration
- input listeners
- game loop + render

## Demo Pages

```bash
open demos/div-assets.html
open demos/div-fpg-fnt-game.html
open demos/pathfind.html
open demos/platformer.html
open demos/shmup.html
open demos/breakout.html
open demos/bunnymark.html
```

## Notes on Async Asset Loading

Some loaders return an ID immediately and complete in the background:

- `load_map(url)` -> graph id
- `load_fpg(url)` -> library/file id
- `load_fnt(url)` -> font id
- `load_bdf_font(url)` -> font id

During loading, scripts can keep running; draw calls will start using assets once ready.

## Status

DivJS is feature-rich for prototyping and arcade-style gameplay.
The codebase is actively evolving, with new runtime natives and demos added frequently.

 