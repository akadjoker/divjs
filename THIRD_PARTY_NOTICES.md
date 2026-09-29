# Third-party code and files

DivJS itself is MIT-licensed (see `LICENSE`). These parts come from elsewhere
and keep their own terms.

## CodeMirror 6 and its dependencies (MIT)

`playground/vendor/codemirror.js` is a bundle (built by `npm run build:vendor`)
of CodeMirror 6 (`codemirror`, `@codemirror/*`), Lezer (`@lezer/common`,
`@lezer/highlight`, `@lezer/lr`), `crelt`, `style-mod`, `w3c-keyname` and
`@marijn/find-cluster-break`, all by Marijn Haverbeke and others, under the MIT
licence:

```
MIT License

Copyright (C) 2018-2021 by Marijn Haverbeke <marijn@haverbeke.berlin> and others

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

The Lezer packages and the small helpers carry the same licence with copyright
years 2016-2024.

## Planck.js (MIT)

`vendor/planck.js` is Planck.js 1.5.0 (a JavaScript port of Box2D), bundled by
`npm run build:physics`; the engine's physics (`vm/physics.js`) uses it. Its
licence:

```
The MIT License
Copyright (c) Erin Catto, Ali Shakiba

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Files whose licence is not confirmed yet

These are in the repository but their origin and terms have not been checked.
They are **not** covered by DivJS's MIT licence; do not redistribute them in a
commercial product until their terms are confirmed.

| Path | What it is | Origin |
|---|---|---|
| `assets/div-support/*.fpg`, `*.fnt` | Graphics and fonts used by the DIV tutorials | DIV Games Studio tutorial files |
| `assets/*.png` (`001.png`, `003.png`, `006.png`, `wabbit_alpha.png`) | Sprites used by examples and the bunnymark demo | Not recorded |

The procedural games in `playground/programs/` do not load any of the asset
files: they generate their graphics in code. The 6x8 system font (font 0,
`vm/font_6x8.js`), which every packed or exported game embeds, was drawn for
DivJS and is covered by its MIT licence. (It replaced a copy of DIV's own
6x8 font taken from the original DIV source, which is published under the
GPL-3.0 at github.com/DIVGAMES/DIV-Games-Studio.)

Whether the tutorial files above come from that GPL-3.0 source release has
not been checked; until it is, treat them as not covered by DivJS's licence.
