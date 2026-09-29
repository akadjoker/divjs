# itch.io pages

One file per game: what goes on its itch.io page. Build the uploads with

```bash
npm run itch              # every game listed here
npm run itch -- fighter   # one game
```

which writes `dist/itch/<game>/<game>-html5.zip` (the exported game as
`index.html`) and the game's GIF next to it.

On itch.io, for each game:

1. **Kind of project:** HTML. Upload the zip and tick "This file will be
   played in the browser". (itch's own HTML5 guide says what it expects
   from the zip; check it there - it could not be read from the machine
   these files were prepared on.)
2. **Embed options:** the viewport size given in the game's file, and
   "Fullscreen button" on.
3. **Generative AI disclosure:** yes - *Code*, *Graphics* and *Sound*. The
   games were written by AI agents, and their pictures and sounds are made
   by that code.
4. Title, tagline, description, genre and tags from the game's file; the
   GIF as a screenshot or the cover's source.
5. **Pricing:** free, or "no payments / donations" - your call.
