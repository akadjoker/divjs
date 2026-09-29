# DivJS

**DIV Games Studio, back in the browser.** Write games in the DIV language -
processes, `FRAME`, `TYPE`, signals, all of it - and run them at 60 fps in
any modern browser, with physics, sound, music and online multiplayer on
top.

**[▶ Open the playground and play](https://akadjoker.github.io/divjs/)** - no install, nothing to download.

<table>
  <tr>
    <td align="center" width="50%"><a href="https://akadjoker.github.io/divjs/playground/#p=fighter"><img src="docs/media/fighter.gif" width="400" alt="Street Duel"></a><br><b>Street Duel</b><br>one-on-one fighter, specials and supers</td>
    <td align="center" width="50%"><a href="https://akadjoker.github.io/divjs/playground/#p=bomber"><img src="docs/media/bomber.gif" width="400" alt="Bomber Arena"></a><br><b>Bomber Arena</b><br>bombs, chain reactions, CPU rivals</td>
  </tr>
  <tr>
    <td align="center" width="50%"><a href="https://akadjoker.github.io/divjs/playground/#p=strike"><img src="docs/media/strike.gif" width="400" alt="Dune Strike"></a><br><b>Dune Strike</b><br>helicopter campaign in a generated desert</td>
    <td align="center" width="50%"><a href="https://akadjoker.github.io/divjs/playground/#p=bad-cat"><img src="docs/media/bad-cat.gif" width="400" alt="Bad Cat"></a><br><b>Bad Cat</b><br>knock it all off the shelves, don't get caught</td>
  </tr>
  <tr>
    <td align="center" width="50%"><a href="https://akadjoker.github.io/divjs/playground/#p=chicken-cannon"><img src="docs/media/chicken-cannon.gif" width="400" alt="Chicken Cannon"></a><br><b>Chicken Cannon</b><br>physics artillery, with chickens</td>
    <td align="center" width="50%"><a href="https://akadjoker.github.io/divjs/playground/#p=ghost-squad"><img src="docs/media/ghost-squad.gif" width="400" alt="Ghost Squad"></a><br><b>Ghost Squad</b><br>Pac-Man, but you are the ghosts</td>
  </tr>
  <tr>
    <td align="center" width="50%"><a href="https://akadjoker.github.io/divjs/playground/#p=wobbly-walker"><img src="docs/media/wobbly-walker.gif" width="400" alt="Wobbly Walker"></a><br><b>Wobbly Walker</b><br>QWOP-style ragdoll running</td>
    <td align="center" width="50%"><a href="https://akadjoker.github.io/divjs/playground/#p=net-tanks"><img src="docs/media/net-tanks.gif" width="400" alt="Net Tanks"></a><br><b>Net Tanks</b><br>two players, online, no server</td>
  </tr>
  <tr>
    <td align="center" width="50%"><a href="https://akadjoker.github.io/divjs/playground/#p=racer"><img src="docs/media/racer.gif" width="400" alt="Racer"></a><br><b>Micro racer</b><br>top-down racing on generated tracks</td>
    <td align="center" width="50%"><a href="https://akadjoker.github.io/divjs/playground/#p=vector-asteroids"><img src="docs/media/vector-asteroids.gif" width="400" alt="Vector Asteroids"></a><br><b>Vector Asteroids</b><br>every rock drawn in code</td>
  </tr>
</table>

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

## Made by AI, on purpose

Almost every game in the playground was written by AI coding agents,
working only from the language and the reference in
[docs/natives.md](docs/natives.md) - the same material you have. Each one
was then played in a real browser with real key presses, checked for
warnings and frame drops, and fixed until it held 60 fps.

That's the point of showing them: if an agent can build a Street Fighter
clone, a Bomberman with CPU players that plan their escapes, or a cat
that knocks vases off shelves from that reference, the engine and its docs
are doing their job - and you can build them too. The engine started as
my own port and has since been extended with the same agents, with tests
for every feature.

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

## The playground

**https://akadjoker.github.io/divjs/** - an editor with DIV highlighting,
completion and errors marked as you type, next to the running game.
Ctrl+Enter runs. It comes with the DIV tutorials, examples and over 30 games
to read and change.

- **Files** - drop your own `.fpg`, `.map`, `.fnt` or `.png` files in and
  load them by name.
- **Share** - copies a link that carries your code (and small files).
- **Export** - downloads the game as one `.html` file: engine, code and
  files inside, works offline, opens with a double click, and can go
  straight onto itch.io or any web host.
- **Full screen** - just the game, scaled up.

## Running it locally

The pages use ES modules, so serve the folder over HTTP:

```bash
npx serve .            # or: python3 -m http.server
# open http://localhost:3000/playground/  (port 8000 with python)
```

Tests:

```bash
npm install
npm run test:pipeline              # compiles every program, checks the list
npx playwright install chromium    # once
npm run test:browser               # engine suite, every page, the playground
```

## Embedding a game in your own page

```js
import { runDivDemo } from './divjs.js';

const game = runDivDemo({
  canvas: 'gameCanvas',
  source: `program demo; begin loop frame; end end`
});
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

To ship a game as a single file from the command line:

```bash
npm run pack -- mygame.div -o mygame.html
```

## Online play notes

The browsers find each other through a public STUN server
(`stun.l.google.com` by default, set your own with `netIceServers`), which
only tells each browser its public address - no game data goes through it.
Behind some routers (symmetric NAT, common on mobile networks) a TURN relay
is needed. Two players for now.

## Project layout

```text
compiler/      bytecode, compiler, disassembler
parser/        parser
vm/            virtual machine, processes, runtime, physics, sound, net
playground/    the online editor; programs/ holds every DIV program
tools/         packer (single-file export), GIF capture
docs/          function reference, media
tests/         engine tests, pipeline and browser checks
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

MIT - see [LICENSE](LICENSE). Third-party code (CodeMirror, Planck.js) and
the files whose terms aren't confirmed yet (the DIV tutorial assets and
some example PNGs) are listed in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
