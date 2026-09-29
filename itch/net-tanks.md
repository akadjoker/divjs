# Net Tanks

**Tagline:** Two tanks, bouncing bullets, online with a friend - no server, no account.

**Viewport:** 640 x 480 · **Genre:** Action · **Tags:** multiplayer, online, tanks, versus, arcade, 2d, retro, local-multiplayer, ai-generated, top-down

## Description

A duel in a generated arena where bullets bounce twice. First to five
wins.

Play online with a friend without any server: one of you hosts and sends
an invitation code, the other sends back an answer code, and your two
browsers connect directly. Both computers run the game in lockstep, so
only your key presses travel. You can also play from two tabs, or two
players on one keyboard.

## Controls

- Menu: 1 host online · 2 join online · 3/4 host/join from another tab · 5 one keyboard
- Online: arrows or WASD drive, Space fires
- One keyboard: blue WASD + Space, red arrows + Enter
- Esc back to the menu

Behind some routers (common on mobile networks) two browsers can't reach
each other directly and would need a relay server, which the game doesn't
include - if the connection fails, that is the likely reason.

## How it was made

Written in the DIV language and running on [DivJS](https://github.com/akadjoker/divjs),
whose online play is built on WebRTC. The game was written with an AI agent as the engine's online demo.
