# Third-party code and files

DivJS itself is MIT-licensed (see `LICENSE`). These parts come from elsewhere
and keep their own terms.

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

## The system font

The 6x8 system font (font 0, `vm/font_6x8.js`), which every packed game
embeds, was drawn for DivJS and is covered by its MIT licence. (It replaced
a copy of DIV's own 6x8 font taken from the original DIV source, which is
published under the GPL-3.0 at github.com/DIVGAMES/DIV-Games-Studio.)

 
