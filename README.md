# DivJS

**DIV Games Studio, back in the browser.** Write games in the DIV language -
processes, `FRAME`, `TYPE`, signals, all of it - and run them at 60 fps in
any modern browser, with physics, sound, music and online multiplayer on
top.

It started for fun: one weekend I began porting an old DIV-style virtual
machine of mine to JavaScript, just to see if it would fly in a browser. I
didn't expect it to run this well.

[![Buy me a coffee](https://img.shields.io/badge/Buy%20me%20a%20coffee-FFDD00?style=for-the-badge&logo=buymeacoffee&logoColor=black)](https://buymeacoffee.com/akadjoker)

This repository is the engine. **[▶ The playground](https://akadjoker.github.io/divjs-playground/)** - the online
editor with over 30 games to play and change - lives in
[divjs-playground](https://github.com/akadjoker/divjs-playground).

<table>
  <tr>
    <td align="center" width="50%"><a href="https://akadjoker.github.io/divjs-playground/playground/#p=fighter"><img src="docs/media/fighter.gif" width="400" alt="Street Duel"></a><br><b>Street Duel</b><br>one-on-one fighter, specials and supers</td>
    <td align="center" width="50%"><a href="https://akadjoker.github.io/divjs-playground/playground/#p=bomber"><img src="docs/media/bomber.gif" width="400" alt="Bomber Arena"></a><br><b>Bomber Arena</b><br>bombs, chain reactions, CPU rivals</td>
  </tr>
  <tr>
    <td align="center" width="50%"><a href="https://akadjoker.github.io/divjs-playground/playground/#p=strike"><img src="docs/media/strike.gif" width="400" alt="Dune Strike"></a><br><b>Dune Strike</b><br>helicopter campaign in a generated desert</td>
    <td align="center" width="50%"><a href="https://akadjoker.github.io/divjs-playground/playground/#p=bad-cat"><img src="docs/media/bad-cat.gif" width="400" alt="Bad Cat"></a><br><b>Bad Cat</b><br>knock it all off the shelves, don't get caught</td>
  </tr>
  <tr>
    <td align="center" width="50%"><a href="https://akadjoker.github.io/divjs-playground/playground/#p=chicken-cannon"><img src="docs/media/chicken-cannon.gif" width="400" alt="Chicken Cannon"></a><br><b>Chicken Cannon</b><br>physics artillery, with chickens</td>
    <td align="center" width="50%"><a href="https://akadjoker.github.io/divjs-playground/playground/#p=ghost-squad"><img src="docs/media/ghost-squad.gif" width="400" alt="Ghost Squad"></a><br><b>Ghost Squad</b><br>Pac-Man, but you are the ghosts</td>
  </tr>
  <tr>
    <td align="center" width="50%"><a href="https://akadjoker.github.io/divjs-playground/playground/#p=wobbly-walker"><img src="docs/media/wobbly-walker.gif" width="400" alt="Wobbly Walker"></a><br><b>Wobbly Walker</b><br>QWOP-style ragdoll running</td>
    <td align="center" width="50%"><a href="https://akadjoker.github.io/divjs-playground/playground/#p=net-tanks"><img src="docs/media/net-tanks.gif" width="400" alt="Net Tanks"></a><br><b>Net Tanks</b><br>two players, online, no server</td>
  </tr>
  <tr>
    <td align="center" width="50%"><a href="https://akadjoker.github.io/divjs-playground/playground/#p=racer"><img src="docs/media/racer.gif" width="400" alt="Racer"></a><br><b>Micro racer</b><br>top-down racing on generated tracks</td>
    <td align="center" width="50%"><a href="https://akadjoker.github.io/divjs-playground/playground/#p=vector-asteroids"><img src="docs/media/vector-asteroids.gif" width="400" alt="Vector Asteroids"></a><br><b>Vector Asteroids</b><br>every rock drawn in code</td>
  </tr>
</table>

## All the programs

62 programs to play, read and change. Open a group and click a picture to run that program in the playground.

<details>
<summary><b>Start here</b> (3)</summary>

<table>
  <tr>
    <td align="center" width="33%"><a href="https://akadjoker.github.io/divjs-playground/playground/#p=start1-player"><img src="docs/media/start1-player.gif" width="260" alt="Step 1: the player"></a><br><b>Step 1: the player</b></td>
    <td align="center" width="33%"><a href="https://akadjoker.github.io/divjs-playground/playground/#p=start2-shots"><img src="docs/media/start2-shots.gif" width="260" alt="Step 2: shooting"></a><br><b>Step 2: shooting</b></td>
    <td align="center" width="33%"><a href="https://akadjoker.github.io/divjs-playground/playground/#p=start3-enemies"><img src="docs/media/start3-enemies.gif" width="260" alt="Step 3: enemies"></a><br><b>Step 3: enemies</b></td>
  </tr>
</table>

</details>

<details>
<summary><b>DIV tutorials</b> (9)</summary>

<table>
  <tr>
    <td align="center" width="33%"><a href="https://akadjoker.github.io/divjs-playground/playground/#p=tutor0a"><img src="docs/media/tutor0a.gif" width="260" alt="Tutorial 0a: ship and shots"></a><br><b>Tutorial 0a: ship and shots</b></td>
    <td align="center" width="33%"><a href="https://akadjoker.github.io/divjs-playground/playground/#p=tutor0b"><img src="docs/media/tutor0b.gif" width="260" alt="Tutorial 0b: enemies"></a><br><b>Tutorial 0b: enemies</b></td>
    <td align="center" width="33%"><a href="https://akadjoker.github.io/divjs-playground/playground/#p=tutor1a"><img src="docs/media/tutor1a.gif" width="260" alt="Tutorial 1a: asteroids"></a><br><b>Tutorial 1a: asteroids</b></td>
  </tr>
  <tr>
    <td align="center" width="33%"><a href="https://akadjoker.github.io/divjs-playground/playground/#p=tutor1b"><img src="docs/media/tutor1b.gif" width="260" alt="Tutorial 1b: asteroids with score"></a><br><b>Tutorial 1b: asteroids with score</b></td>
    <td align="center" width="33%"><a href="https://akadjoker.github.io/divjs-playground/playground/#p=tutor2"><img src="docs/media/tutor2.gif" width="260" alt="Tutorial 2: planets"></a><br><b>Tutorial 2: planets</b></td>
    <td align="center" width="33%"><a href="https://akadjoker.github.io/divjs-playground/playground/#p=tutor3"><img src="docs/media/tutor3.gif" width="260" alt="Tutorial 3: pong"></a><br><b>Tutorial 3: pong</b></td>
  </tr>
  <tr>
    <td align="center" width="33%"><a href="https://akadjoker.github.io/divjs-playground/playground/#p=tutor4"><img src="docs/media/tutor4.gif" width="260" alt="Tutorial 4: worm"></a><br><b>Tutorial 4: worm</b></td>
    <td align="center" width="33%"><a href="https://akadjoker.github.io/divjs-playground/playground/#p=tutor5"><img src="docs/media/tutor5.gif" width="260" alt="Tutorial 5: snake"></a><br><b>Tutorial 5: snake</b></td>
    <td align="center" width="33%"><a href="https://akadjoker.github.io/divjs-playground/playground/#p=tutor6"><img src="docs/media/tutor6.gif" width="260" alt="Tutorial 6: smile"></a><br><b>Tutorial 6: smile</b></td>
  </tr>
</table>

</details>

<details>
<summary><b>Examples</b> (4)</summary>

<table>
  <tr>
    <td align="center" width="33%"><a href="https://akadjoker.github.io/divjs-playground/playground/#p=platformer-basic"><img src="docs/media/platformer-basic.gif" width="260" alt="Basic platformer"></a><br><b>Basic platformer</b></td>
    <td align="center" width="33%"><a href="https://akadjoker.github.io/divjs-playground/playground/#p=frame-timing"><img src="docs/media/frame-timing.gif" width="260" alt="FRAME(n) timing"></a><br><b>FRAME(n) timing</b></td>
    <td align="center" width="33%"><a href="https://akadjoker.github.io/divjs-playground/playground/#p=scroll"><img src="docs/media/scroll.gif" width="260" alt="Scroll window"></a><br><b>Scroll window</b></td>
  </tr>
  <tr>
    <td align="center" width="33%"><a href="https://akadjoker.github.io/divjs-playground/playground/#p=sound-lab"><img src="docs/media/sound-lab.gif" width="260" alt="Sound Lab: effects and music"></a><br><b>Sound Lab: effects and music</b></td>
    <td></td>
    <td></td>
  </tr>
</table>

</details>

<details>
<summary><b>Demos</b> (6)</summary>

<table>
  <tr>
    <td align="center" width="33%"><a href="https://akadjoker.github.io/divjs-playground/playground/#p=breakout"><img src="docs/media/breakout.gif" width="260" alt="Breakout"></a><br><b>Breakout</b></td>
    <td align="center" width="33%"><a href="https://akadjoker.github.io/divjs-playground/playground/#p=platformer"><img src="docs/media/platformer.gif" width="260" alt="Platformer"></a><br><b>Platformer</b></td>
    <td align="center" width="33%"><a href="https://akadjoker.github.io/divjs-playground/playground/#p=shmup"><img src="docs/media/shmup.gif" width="260" alt="Space shooter"></a><br><b>Space shooter</b></td>
  </tr>
  <tr>
    <td align="center" width="33%"><a href="https://akadjoker.github.io/divjs-playground/playground/#p=bunnymark"><img src="docs/media/bunnymark.gif" width="260" alt="Bunnymark"></a><br><b>Bunnymark</b></td>
    <td align="center" width="33%"><a href="https://akadjoker.github.io/divjs-playground/playground/#p=pathfind"><img src="docs/media/pathfind.gif" width="260" alt="Pathfinding"></a><br><b>Pathfinding</b></td>
    <td align="center" width="33%"><a href="https://akadjoker.github.io/divjs-playground/playground/#p=fpg-fnt-game"><img src="docs/media/fpg-fnt-game.gif" width="260" alt="FPG and FNT assets"></a><br><b>FPG and FNT assets</b></td>
  </tr>
</table>

</details>

<details>
<summary><b>Procedural games</b> (28)</summary>

<table>
  <tr>
    <td align="center" width="33%"><a href="https://akadjoker.github.io/divjs-playground/playground/#p=maze"><img src="docs/media/maze.gif" width="260" alt="Maze Runner"></a><br><b>Maze Runner</b></td>
    <td align="center" width="33%"><a href="https://akadjoker.github.io/divjs-playground/playground/#p=vector-asteroids"><img src="docs/media/vector-asteroids.gif" width="260" alt="Vector Asteroids"></a><br><b>Vector Asteroids</b></td>
    <td align="center" width="33%"><a href="https://akadjoker.github.io/divjs-playground/playground/#p=invaders"><img src="docs/media/invaders.gif" width="260" alt="Procedural Invaders"></a><br><b>Procedural Invaders</b></td>
  </tr>
  <tr>
    <td align="center" width="33%"><a href="https://akadjoker.github.io/divjs-playground/playground/#p=cave-flyer"><img src="docs/media/cave-flyer.gif" width="260" alt="Cave Flyer"></a><br><b>Cave Flyer</b></td>
    <td align="center" width="33%"><a href="https://akadjoker.github.io/divjs-playground/playground/#p=dungeon"><img src="docs/media/dungeon.gif" width="260" alt="Deep Delve"></a><br><b>Deep Delve</b></td>
    <td align="center" width="33%"><a href="https://akadjoker.github.io/divjs-playground/playground/#p=rts"><img src="docs/media/rts.gif" width="260" alt="Red Ore (RTS)"></a><br><b>Red Ore (RTS)</b></td>
  </tr>
  <tr>
    <td align="center" width="33%"><a href="https://akadjoker.github.io/divjs-playground/playground/#p=artillery"><img src="docs/media/artillery.gif" width="260" alt="Artillery (Worms)"></a><br><b>Artillery (Worms)</b></td>
    <td align="center" width="33%"><a href="https://akadjoker.github.io/divjs-playground/playground/#p=tower-defense"><img src="docs/media/tower-defense.gif" width="260" alt="Keep Defense"></a><br><b>Keep Defense</b></td>
    <td align="center" width="33%"><a href="https://akadjoker.github.io/divjs-playground/playground/#p=colony"><img src="docs/media/colony.gif" width="260" alt="Isle of Settlers"></a><br><b>Isle of Settlers</b></td>
  </tr>
  <tr>
    <td align="center" width="33%"><a href="https://akadjoker.github.io/divjs-playground/playground/#p=racer"><img src="docs/media/racer.gif" width="260" alt="Pocket GP (racing)"></a><br><b>Pocket GP (racing)</b></td>
    <td align="center" width="33%"><a href="https://akadjoker.github.io/divjs-playground/playground/#p=lemmings"><img src="docs/media/lemmings.gif" width="260" alt="Burrowers (Lemmings)"></a><br><b>Burrowers (Lemmings)</b></td>
    <td align="center" width="33%"><a href="https://akadjoker.github.io/divjs-playground/playground/#p=raptor"><img src="docs/media/raptor.gif" width="260" alt="Stormwing (shoot'em up)"></a><br><b>Stormwing (shoot'em up)</b></td>
  </tr>
  <tr>
    <td align="center" width="33%"><a href="https://akadjoker.github.io/divjs-playground/playground/#p=sandbox"><img src="docs/media/sandbox.gif" width="260" alt="TerraDIV (sandbox)"></a><br><b>TerraDIV (sandbox)</b></td>
    <td align="center" width="33%"><a href="https://akadjoker.github.io/divjs-playground/playground/#p=tetris"><img src="docs/media/tetris.gif" width="260" alt="Tetris"></a><br><b>Tetris</b></td>
    <td align="center" width="33%"><a href="https://akadjoker.github.io/divjs-playground/playground/#p=aquarium"><img src="docs/media/aquarium.gif" width="260" alt="Living Aquarium (boids)"></a><br><b>Living Aquarium (boids)</b></td>
  </tr>
  <tr>
    <td align="center" width="33%"><a href="https://akadjoker.github.io/divjs-playground/playground/#p=match3"><img src="docs/media/match3.gif" width="260" alt="Sugar Swap (match-3)"></a><br><b>Sugar Swap (match-3)</b></td>
    <td align="center" width="33%"><a href="https://akadjoker.github.io/divjs-playground/playground/#p=arkanoid"><img src="docs/media/arkanoid.gif" width="260" alt="Arkanoid"></a><br><b>Arkanoid</b></td>
    <td align="center" width="33%"><a href="https://akadjoker.github.io/divjs-playground/playground/#p=bubbles"><img src="docs/media/bubbles.gif" width="260" alt="Bubble Dino (Puzzle Bobble)"></a><br><b>Bubble Dino (Puzzle Bobble)</b></td>
  </tr>
  <tr>
    <td align="center" width="33%"><a href="https://akadjoker.github.io/divjs-playground/playground/#p=karate"><img src="docs/media/karate.gif" width="260" alt="Karate-Do (International Karate)"></a><br><b>Karate-Do (International Karate)</b></td>
    <td align="center" width="33%"><a href="https://akadjoker.github.io/divjs-playground/playground/#p=fighter"><img src="docs/media/fighter.gif" width="260" alt="Street Duel (Street Fighter style)"></a><br><b>Street Duel (Street Fighter style)</b></td>
    <td align="center" width="33%"><a href="https://akadjoker.github.io/divjs-playground/playground/#p=bomber"><img src="docs/media/bomber.gif" width="260" alt="Bomber Arena (Bomberman)"></a><br><b>Bomber Arena (Bomberman)</b></td>
  </tr>
  <tr>
    <td align="center" width="33%"><a href="https://akadjoker.github.io/divjs-playground/playground/#p=brawler"><img src="docs/media/brawler.gif" width="260" alt="Neon Fists (beat 'em up)"></a><br><b>Neon Fists (beat 'em up)</b></td>
    <td align="center" width="33%"><a href="https://akadjoker.github.io/divjs-playground/playground/#p=strike"><img src="docs/media/strike.gif" width="260" alt="Dune Strike (Desert Strike)"></a><br><b>Dune Strike (Desert Strike)</b></td>
    <td align="center" width="33%"><a href="https://akadjoker.github.io/divjs-playground/playground/#p=ghost-squad"><img src="docs/media/ghost-squad.gif" width="260" alt="Ghost Squad"></a><br><b>Ghost Squad</b></td>
  </tr>
  <tr>
    <td align="center" width="33%"><a href="https://akadjoker.github.io/divjs-playground/playground/#p=sparkroll"><img src="docs/media/sparkroll.gif" width="260" alt="Sparkroll"></a><br><b>Sparkroll</b></td>
    <td align="center" width="33%"><a href="https://akadjoker.github.io/divjs-playground/playground/#p=rusty-leap"><img src="docs/media/rusty-leap.gif" width="260" alt="Rusty Leap"></a><br><b>Rusty Leap</b></td>
    <td align="center" width="33%"><a href="https://akadjoker.github.io/divjs-playground/playground/#p=sky-shield"><img src="docs/media/sky-shield.gif" width="260" alt="Sky Shield"></a><br><b>Sky Shield</b></td>
  </tr>
  <tr>
    <td align="center" width="33%"><a href="https://akadjoker.github.io/divjs-playground/playground/#p=beat-bash"><img src="docs/media/beat-bash.gif" width="260" alt="Beat Bash"></a><br><b>Beat Bash</b></td>
    <td></td>
    <td></td>
  </tr>
</table>

</details>

<details>
<summary><b>Physics</b> (8)</summary>

<table>
  <tr>
    <td align="center" width="33%"><a href="https://akadjoker.github.io/divjs-playground/playground/#p=physics-sandbox"><img src="docs/media/physics-sandbox.gif" width="260" alt="Physics sandbox"></a><br><b>Physics sandbox</b></td>
    <td align="center" width="33%"><a href="https://akadjoker.github.io/divjs-playground/playground/#p=slingshot"><img src="docs/media/slingshot.gif" width="260" alt="Slingshot (Angry Birds)"></a><br><b>Slingshot (Angry Birds)</b></td>
    <td align="center" width="33%"><a href="https://akadjoker.github.io/divjs-playground/playground/#p=physics-lab"><img src="docs/media/physics-lab.gif" width="260" alt="Physics lab"></a><br><b>Physics lab</b></td>
  </tr>
  <tr>
    <td align="center" width="33%"><a href="https://akadjoker.github.io/divjs-playground/playground/#p=hillclimb"><img src="docs/media/hillclimb.gif" width="260" alt="Hill Climb"></a><br><b>Hill Climb</b></td>
    <td align="center" width="33%"><a href="https://akadjoker.github.io/divjs-playground/playground/#p=pinball"><img src="docs/media/pinball.gif" width="260" alt="Procedural Pinball"></a><br><b>Procedural Pinball</b></td>
    <td align="center" width="33%"><a href="https://akadjoker.github.io/divjs-playground/playground/#p=bad-cat"><img src="docs/media/bad-cat.gif" width="260" alt="Bad Cat"></a><br><b>Bad Cat</b></td>
  </tr>
  <tr>
    <td align="center" width="33%"><a href="https://akadjoker.github.io/divjs-playground/playground/#p=chicken-cannon"><img src="docs/media/chicken-cannon.gif" width="260" alt="Chicken Cannon"></a><br><b>Chicken Cannon</b></td>
    <td align="center" width="33%"><a href="https://akadjoker.github.io/divjs-playground/playground/#p=wobbly-walker"><img src="docs/media/wobbly-walker.gif" width="260" alt="Wobbly Walker"></a><br><b>Wobbly Walker</b></td>
    <td></td>
  </tr>
</table>

</details>

<details>
<summary><b>Online</b> (1)</summary>

<table>
  <tr>
    <td align="center" width="33%"><a href="https://akadjoker.github.io/divjs-playground/playground/#p=net-tanks"><img src="docs/media/net-tanks.gif" width="260" alt="Net Tanks (online, 2 players)"></a><br><b>Net Tanks (online, 2 players)</b></td>
    <td></td>
    <td></td>
  </tr>
</table>

</details>

<details>
<summary><b>For small children</b> (1)</summary>

<table>
  <tr>
    <td align="center" width="33%"><a href="https://akadjoker.github.io/divjs-playground/playground/#p=balloon-pop"><img src="docs/media/balloon-pop.gif" width="260" alt="Balloon Pop"></a><br><b>Balloon Pop</b></td>
    <td></td>
    <td></td>
  </tr>
</table>

</details>

<details>
<summary><b>Pixel art games</b> (2)</summary>

<table>
  <tr>
    <td align="center" width="33%"><a href="https://akadjoker.github.io/divjs-playground/playground/#p=keyhole-hop"><img src="docs/media/keyhole-hop.gif" width="260" alt="Keyhole Hop"></a><br><b>Keyhole Hop</b></td>
    <td align="center" width="33%"><a href="https://akadjoker.github.io/divjs-playground/playground/#p=ember-keep"><img src="docs/media/ember-keep.gif" width="260" alt="Keep of Embers"></a><br><b>Keep of Embers</b></td>
    <td></td>
  </tr>
</table>

</details>

## Why this exists

DIV Games Studio was how a lot of us made our first games in the late '90s:
a small language where every enemy, bullet and explosion is a *process*
that runs its own loop and calls `FRAME` when it's done for the frame.
I'd written a DIV-style virtual machine in C++ years ago, and one weekend I
started porting it to JavaScript just to see if it would fly in a browser.
It did - and it kept growing.

DivJS is that port: a tokenizer, parser, bytecode compiler and virtual
machine with DIV's cooperative processes, rendering to a Canvas 2D. The DIV
tutorials run on it, and on top of what DIV had it adds the things you'd
want today - rigid-body physics, synthesised sound and music, and
peer-to-peer online play.

## The games are the test

The games in the playground are built only from the language and the
reference in [docs/natives.md](docs/natives.md) - the same material you
have. Each one was played in a real browser with real key presses, checked
for warnings and frame drops, and fixed until it held 60 fps.

That's the point of showing them: if a Street Fighter clone, a Bomberman
with CPU players that plan their escapes, or a cat that knocks vases off
shelves can be built from that reference, the engine and its docs are
doing their job - and you can build them too. Every engine feature has
tests.

## A taste of DIV

```div
PROGRAM hello;

PROCESS ship();
BEGIN
  graph = new_graphic(16, 16);
  gfx_fill(graph, 90, 200, 255);
  x = 160; y = 100;
  LOOP
    IF (key(_left))  x = x - 3; END
    IF (key(_right)) x = x + 3; END
    IF (key_pressed(_space)) play_sound(sfx(sfx_laser)); END
    FRAME;
  END
END

BEGIN
  set_mode(320, 200);
  set_fps(60, 0);
  ship();
  LOOP FRAME; END
END
```

Every process runs until its `FRAME`, the engine draws it, and the next
frame picks up where it left off. That's the whole trick, and it scales
from this to a 3000-line fighting game.

## What's in the box

- **The DIV language** - processes, `FRAME(n)`, `TYPE`, `signal`, `collision`,
  `LOCAL`/`PRIVATE`/`GLOBAL`, `STRUCT`s, `OFFSET` and scroll windows.
- **DIV files** - `load_fpg`, `load_map`, `load_fnt` read the original
  formats; PNGs and BDF fonts work too.
- **Physics** - Box2D (via Planck.js) behind a handful of `phys_*` calls: a
  process gets a body and the world moves it, in pixels and DIV angles.
  Joints, motors, ropes, impacts, raycasts.
- **Sound and music, no files needed** - `sfx(sfx_coin)`, `sfx(sfx_explosion, seed)`
  synthesise classic game effects; songs are written as lines of notes
  (`"E5 - G5 - A5 - . A5"`, drums as `"k . h . s . h ."`). WAV/OGG/MP3 load
  too, and DIV's `sound()` family is there.
- **Online multiplayer without a server** - two browsers connect peer to
  peer (WebRTC) by swapping an invitation link and an answer code. Games
  either send messages or run in lockstep, where only the players' keys
  travel.
- **Pathfinding, paths, maths helpers**, a debug overlay, and more - every
  function is in [docs/natives.md](docs/natives.md).

## Using the engine

The whole engine is one ES module, `dist/divjs.js` (or `dist/divjs.min.js`),
with no dependencies:

```js
import { runDivDemo } from './divjs.js';

const game = runDivDemo({
  canvas: 'gameCanvas',
  source: `program demo; begin loop frame; end end`
});
```

Get it from this repository's `dist/` folder, or install a version with npm
(pinned to a tag):

```bash
npm install github:akadjoker/divjs#v1.0.0
# node_modules/divjs/dist/divjs.js
```

`runDivDemo` compiles the program and runs it with input, sound and the
game loop wired up. It returns `{ start, stop, destroy, setSource, setFiles,
setNetInvite, getState }`; `start(source)` can be called again and again on
the same canvas (an editor's Run button). Useful options:

- `files` - `{ name: Blob | ArrayBuffer | Uint8Array | url }`, looked up by
  `load_*` before any URL.
- `virtualWidth` / `virtualHeight` - render at a fixed resolution and scale
  it onto the canvas.
- `onLog`, `onError`, `onFrame` - hooks; compile errors come as `DivError`
  with `line`, `col` and `reason`.
- `netIceServers`, `netInviteLink` - online play settings.

The module also exports the pieces underneath - `compile(source)`, `VM`,
`CanvasEngineRuntime`, `Lexer`, `Parser`, `Compiler`, the DIV file readers
and the packer - for tools and editors. Every function a DIV program can
call is in [docs/natives.md](docs/natives.md).

To ship a game as a single `.html` file (engine, code and files inside,
works offline):

```bash
npm run pack -- mygame.div -o mygame.html
```

## Online play notes

The browsers find each other through a public STUN server
(`stun.l.google.com` by default, set your own with `netIceServers`), which
only tells each browser its public address - no game data goes through it.
Behind some routers (symmetric NAT, common on mobile networks) a TURN relay
is needed. Two players for now.

## Working on the engine

```bash
npm install
npm run build                      # dist/divjs.js from the sources
npm run test:pipeline              # compiles the test programs, checks the packer
npx playwright install chromium    # once
npm run test:browser               # the engine suite, the bundle, a packed game
```

```text
compiler/      bytecode, compiler, disassembler
parser/        parser
vm/            virtual machine, processes, runtime, physics, sound, net
index.js       the public entry point; dist/ is its build
tools/         packer (single-file games)
docs/          function reference
tests/         engine tests
```

## Credits

DivJS exists because of DIV Games Studio, the 1990s game-making tool it
reimplements; DIV 2's source is published under the GPL-3.0 at
[DIVGAMES/DIV-Games-Studio](https://github.com/DIVGAMES/DIV-Games-Studio).
DivJS is an independent reimplementation and doesn't contain DIV's code.
BennuGD was a big influence too.

## Support

DivJS is free and always will be. If it made you smile or saved you some
work, you can [buy me a coffee](https://buymeacoffee.com/akadjoker) - thank you!

## License

MIT - see [LICENSE](LICENSE). Planck.js (MIT) is bundled in; it and the test
files whose terms aren't confirmed yet are listed in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
