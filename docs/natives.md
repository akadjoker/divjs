# Native functions

Every function a DivJS program can call that is provided by the runtime
(`CanvasEngineRuntime.registerNatives()` in `vm/runtime.js`). The list is
checked against the registered natives by the test
`T5 every registered native is documented` (`tests/runtime-tests.js`): a
native added or removed without updating this file fails the test suite.

Conventions used below:

- **Angles** are DIV angles, in thousandths of a degree (`90000` = 90°). As in DIV, `0` points right and angles grow counter-clockwise: `90000` points up, `-90000` down. `angle`, `advance`, `get_distx`/`get_disty`, `fget_angle`, control points and collision shapes all follow this. `sin`, `cos` and `atan2` are plain maths (they know nothing about screen y).
- **TYPE** is a process type, written `TYPE name` in the program.
- **file / graph**: `file` is a library code returned by `load_fpg` (the first
  one loaded is `0`); graphics loaded one by one (`load_map`,
  `load_graphic`, `load_tile`, `new_graphic`) get codes from `1000` up and
  belong to file `0`, as in DIV.
- **Paths** given to `load_fpg`, `load_map`, `load_fnt`, `load_graphic`,
  `load_tile` and `load_bdf_font` name a project file first (the
  playground's Files tab, a packed game's files, `runDivDemo({ files })`),
  matched by the whole path or the file name alone, in any case and with
  `/` or `\`; otherwise they are URLs relative to the page.
- **Colours** passed as strings are CSS colours (`'#ff8'`, `'red'`); colours
  passed as three numbers are 0-255 RGB.
- Functions that only act on "the current process" use the process running
  the call; called from MAIN they act on MAIN.
- `—` in the Returns column means the function always returns `0`.

## Input

| Name | Arguments | Returns | Description |
|------|-----------|---------|-------------|
| `key` | `key` | 1/0 | 1 while the key is held. Takes the `_a`…`_z`, `_0`…`_9`, `_left`, `_space`, `_enter`, `_esc`, `_shift`, `_control`, `_alt`… constants (or the same names as strings). Letters, digits and space are tested by physical key, like DIV's scan codes. |
| `key_down` | `key` | 1/0 | Same as `key()`. |
| `key_pressed` | `key` | 1/0 | 1 only in the frame after the key went down (edge); `key()` stays 1 while held. Not a DIV function. |
| `mouse_x` | — | number | Cursor x in screen coordinates. Same as `mouse.x`. |
| `mouse_y` | — | number | Cursor y in screen coordinates. Same as `mouse.y`. |
| `mouse_button` | `button` | 1/0 | 1 while mouse button `button` (0 left, 1 middle, 2 right) is held during this frame; a click shorter than a frame still reads 1 for one frame. `mouse.left`, `mouse.middle`, `mouse.right` are the same buttons. |
| `__get_mouse_field` | `field` | value | Compiler-internal: reads `mouse.<field>` (graph, file, size…). |
| `__set_mouse_field` | `field, value` | value | Compiler-internal: writes `mouse.<field>`. |

## Program, screen and timing

| Name | Arguments | Returns | Description |
|------|-----------|---------|-------------|
| `set_mode` | `width, height` or `mode` | — | Resizes the screen. A single `m320x200` / `m640x480` constant is also accepted. |
| `set_title` | `title` | — | Accepted for compatibility; does nothing. |
| `screen_color` | `color` | — | Colour the screen is cleared to every frame. |
| `put_screen` | `file, graph` | — | Sets the background graphic, drawn 1:1 with its control point 0 at the screen centre. `graph` 0 removes it. |
| `get_pixel` | `x, y` | number | Colour of the background (put_screen plus xput) at x, y as `0xRRGGBB`; 0 where nothing is drawn. Process sprites are not seen. |
| `set_fps` | `fps` | — | Frame rate cap; 0 = uncapped. |
| `get_fps` | — | number | Measured frames per second. |
| `get_time` | — | number | Seconds since the program started. |
| `get_delta` | — | number | Seconds the current frame advances. |
| `get_process_count` | `active_only` | number | Number of processes (without the mouse); with `active_only` 1, only running ones. |
| `set_debug` | `[on]` | 1/0 | Turns the collision/pivot overlay on (1) or off (0); without argument toggles it. Returns the new state. |
| `exit` | `[message, code]` | `code` | Logs `message` and stops the program. |
| `log` | `values…` | — | Writes the values to the log (`[log] …`). |
| `print` | `values…` | — | Writes the values to the log (`[print] …`). |

## Maths

| Name | Arguments | Returns | Description |
|------|-----------|---------|-------------|
| `abs` | `value` | number | Absolute value. |
| `sign` | `value` | -1/0/1 | Sign of the value. |
| `sqrt` | `value` | number | Square root (negative input gives 0). |
| `pow` | `base, exp` | number | `base` raised to `exp`. |
| `floor` | `value` | number | Rounds down. |
| `ceil` | `value` | number | Rounds up. |
| `round` | `value` | number | Rounds to nearest. |
| `int` | `value` | number | Truncates toward zero. |
| `sin` | `angle` | number | Sine of a DIV angle. |
| `cos` | `angle` | number | Cosine of a DIV angle. |
| `tan` | `angle` | number | Tangent of a DIV angle. |
| `asin` | `value` | angle | Arc sine, as a DIV angle. |
| `acos` | `value` | angle | Arc cosine, as a DIV angle. |
| `atan` | `value` | angle | Arc tangent, as a DIV angle. |
| `atan2` | `y, x` | angle | Angle of the vector (x, y), as a DIV angle. |
| `torad` | `angle` | number | DIV angle to radians. |
| `todeg` | `radians` | angle | Radians to a DIV angle. |
| `normalize_angle` | `angle` | angle | Angle wrapped into 0…359999. |
| `lerp_angle` | `from, to, t` | angle | Interpolates between two angles along the shorter way round. |
| `fget_angle` | `x1, y1, x2, y2` | angle | Angle from point 1 to point 2 (DIV convention: 0 right, 90000 up). |
| `fget_distance` | `x1, y1, x2, y2` | number | Distance between two points. |
| `distance` | `x1, y1, x2, y2` | number | Distance between two points. |
| `distance_rect` | `px, py, rx, ry, rw, rh` | number | Distance from a point to a rectangle (0 inside). |
| `get_distx` | `angle, distance` | number | Horizontal component of a distance at an angle. |
| `get_disty` | `angle, distance` | number | Vertical component of a distance at an angle (negative when the angle points up). |
| `clamp` | `value, min, max` | number | Value limited to [min, max]. |
| `min` | `a, b, ...` | number | The smallest of its arguments. A program's own `FUNCTION min` takes precedence. |
| `max` | `a, b, ...` | number | The largest of its arguments. A program's own `FUNCTION max` takes precedence. |
| `wrap` | `value, min, max` | number | Value wrapped into [min, max). |
| `ping_pong` | `t, length` | number | Bounces `t` between 0 and `length`. |
| `lerp` | `a, b, t` | number | Linear interpolation. |
| `hermite` | `a, b, t` | number | Smooth (ease in/out) interpolation, `t` clamped to 0…1. |
| `smoothstep` | `min, max, value` | number | 0…1 smooth step of `value` between min and max. |
| `rand` | `min, max` or `max` | number | Random integer in [min, max] (or [0, max]). |
| `random` | `min, max` or `max` | number | Same as `rand()`. |
| `rand_seed` | `[seed]` | 1/0 | Makes `rand()` repeatable from `seed` (returns 1); without argument goes back to unseeded (returns 0). |

## Process movement and regions

| Name | Arguments | Returns | Description |
|------|-----------|---------|-------------|
| `advance` | `distance[, angle]` | — | Moves the current process `distance` pixels along its own `angle` (or the given one). |
| `xadvance` | `distance, angle` | — | Moves the current process `distance` pixels along `angle`. |
| `define_region` | `n, x, y, width, height` | `n` | Defines screen region `n` (1-31). An omitted size means the screen's. |
| `out_region` | `id, region` | 1/0 | 1 when the graphic of process `id` is completely outside `region` (0 = the screen). A missing process gives 0. |
| `out_of_region` | `[region]` | 1/0 | 1 when the current process's box touches or passes the edge of `region`. |
| `exit_region` | `[region]` | 1/0 | Same as `out_of_region()`. |
| `out_of_screen` | — | 1/0 | `out_of_region(0)`. |
| `exit_screen` | — | 1/0 | Same as `out_of_screen()`. |
| `start_scroll` | `n, file, graph, back_graph, region, flags` | `n` | Starts scroll window `n`; flags 1/2 wrap the foreground horizontally/vertically. Driven by `scroll[n].x0/y0/camera/…`. |
| `stop_scroll` | `n` | — | Stops scroll window `n`. |

## Processes and signals

| Name | Arguments | Returns | Description |
|------|-----------|---------|-------------|
| `signal` | `id or TYPE, signal` | 1/0 | Sends `s_kill`, `s_sleep`, `s_freeze`, `s_wakeup` (or their `_tree` forms) to a process or to every process of a type. |
| `let_me_alone` | — | number | Kills every process except the current one. |
| `__get_path` | `root, segments…` | value | Compiler-internal: reads `scroll[n].field`, `region…`, `father.field`, `son.field`, `bigbro.field`, `smallbro.field`. |
| `__set_path` | `root, segments…, value` | value | Compiler-internal: writes the same paths. |
| `__offset_local` | `slot` | reference | Compiler-internal: `OFFSET <local variable>` - a live reference to that slot of the running process or FUNCTION call. |
| `__get_process_field` | `id, field` | value | Compiler-internal: reads `other.field` where `other` holds a process id. |
| `__set_process_field` | `id, field, value` | value | Compiler-internal: writes `other.field`. |

## Collision

| Name | Arguments | Returns | Description |
|------|-----------|---------|-------------|
| `collision` | `TYPE` | id/0 | Id of a process of that type touching the current one (`TYPE mouse` tests the cursor's hotspot). |
| `collision_circle` | `TYPE` | id/0 | Like `collision()`, testing both as circles. |
| `collision_obb` | `TYPE` | id/0 | Like `collision()`, testing rotated boxes. |
| `collision_point` | `x, y, TYPE` | id/0 | Id of a process of that type covering the point. |
| `place_meeting` | `x, y, TYPE` | id/0 | Id of a process of that type the current one would touch if it were at x, y (it does not move). |
| `place_free` | `x, y, TYPE` | 1/0 | 1 when `place_meeting()` finds nothing. |
| `set_collision_shape` | `'box'` / `'circle'` / `1` | 1/0 | Collision shape of the current process; returns 1 for circle. |
| `get_collision_shape` | — | 1/0 | 1 when the current process collides as a circle. |
| `set_collision_radius` | `radius` | number | Explicit circle radius (0 = from the graphic). |
| `get_collision_radius` | — | number | Current explicit radius. |
| `set_collision_scale` | `scale` | number | Multiplier applied to the collision shape. |
| `get_collision_scale` | — | number | Current multiplier. |
| `clear_collision_boxes` | — | — | Removes the current process's custom collision boxes. |
| `add_collision_box` | `x, y, width, height[, code]` | number | Adds a box (graphic-local coordinates) and returns how many there are. |
| `add_collision_circle` | `x, y, radius[, code]` | number | Adds a circle and returns how many shapes there are. |
| `penetration_x` | — | number | X of the separation vector of the last collision found. |
| `penetration_y` | — | number | Y of the separation vector of the last collision found. |
| `collider_cbox` | — | code/-1 | Code of the current process's box in the last collision (-1 none). |
| `collided_cbox` | — | code/-1 | Code of the other process's box in the last collision (-1 none). |

## Graphics, points and drawing

| Name | Arguments | Returns | Description |
|------|-----------|---------|-------------|
| `load_fpg` | `path` | file | Loads an FPG library; returns its file code (first one 0). |
| `load_map` | `path` | graph | Loads a DIV MAP; returns its code (1000 up, file 0). |
| `load_graphic` | `path` | graph | Loads an image (PNG, …); returns its code (file 0). |
| `load_tile` | `path, sx, sy, sw, sh` | graph | Loads the given rectangle of an image as a graphic. |
| `new_graphic` | `width, height` | graph | Creates an empty (transparent) graphic to draw on with `gfx_*`. |
| `free_graphic` | `graph` | — | Forgets a graphic made by `new_graphic`/`load_*`. |
| `set_point` | `file, graph, point, x, y` | 1 | Defines control point `point` of a graphic (point 0 is the pivot). |
| `get_point` | `file, graph, point, OFFSET x, OFFSET y` or `file, graph, point, axis` | 0 / number | Control point as defined in the graphic: stores x and y in the two OFFSET variables (DIV form), or returns one coordinate (`axis` 0 = x, 1 = y). |
| `get_point_x` | `file, graph, point` | number | `get_point(…, 0)`. |
| `get_point_y` | `file, graph, point` | number | `get_point(…, 1)`. |
| `get_real_point` | `point, OFFSET x, OFFSET y` | — | DIV form: stores where control point `point` of the current process's graphic is now (position, angle, size, mirror) into the two GLOBAL variables. |
| `get_real_point_x` | `point` or `file, graph, point` | number | X of that current position. |
| `get_real_point_y` | `point` or `file, graph, point` | number | Y of that current position. |
| `xput` | `file, graph, x, y, angle, size, flags, region` | 1 | Draws a graphic permanently onto the background (seen by `get_pixel`). |
| `gfx_fill` | `graph, r, g, b` | — | Fills a `new_graphic` with a colour. |
| `gfx_fill_rgba` | `graph, r, g, b, alpha` | — | Replaces a `new_graphic`'s pixels with a colour of opacity 0-100 (0 clears it). |
| `gfx_pixel` | `graph, x, y, r, g, b` | — | Sets one pixel. |
| `gfx_line` | `graph, x1, y1, x2, y2, r, g, b` | — | Draws a line. |
| `gfx_rect` | `graph, x, y, w, h, r, g, b` | — | Draws a filled rectangle. |
| `gfx_rect_outline` | `graph, x, y, w, h, r, g, b` | — | Draws a rectangle outline. |
| `gfx_circle` | `graph, cx, cy, radius, r, g, b` | — | Draws a filled circle. |
| `gfx_circle_outline` | `graph, cx, cy, radius, r, g, b` | — | Draws a circle outline. |
| `gfx_text` | `graph, x, y, text, r, g, b, size` | — | Draws text with the browser's monospace font. |
| `circle` | `x, y, radius` | — | Draws a filled circle on screen for this frame, in the `set_color` colour. |
| `draw_rect` | `x, y, width, height[, color]` | — | Draws a filled rectangle on screen for this frame. |
| `text` | `x, y, text` | — | Draws text with the system font for this frame. |
| `set_color` | `color` | — | Colour of later `write`, `text`, `circle`, `draw_rect`. |
| `clear` | — | — | Drops this frame's `circle`/`text`/`draw_rect` drawings (`write` texts stay). |
| `fade_off` | `[speed]` | — | Fades the screen to black (speed 1-64, default 8 = 8 frames). |
| `fade_on` | `[speed]` | — | Fades back in. |
| `fade` | `r, g, b, speed` | — | Fades to the given intensity (0-100 per channel, 100 = normal). |
| `is_fading` | — | 1/0 | 1 while a fade is in progress. |

## Text and fonts

| Name | Arguments | Returns | Description |
|------|-----------|---------|-------------|
| `write` | `font, x, y, align, text` | id | Shows a text until `delete_text`. `font` 0 is the 6x8 system font. `align` is DIV's centring code: 0 up-left, 1 up, 2 up-right, 3 left, 4 centre, 5 right, 6 down-left, 7 down, 8 down-right. Returns 0 once too many texts are on screen. |
| `write_int` | `font, x, y, align, value` | id | Like `write` for a number; with `OFFSET global` it keeps showing the variable's current value. |
| `delete_text` | `id` | — | Removes a `write`/`write_int` text; 0 (`all_text`) removes all of them. |
| `load_fnt` | `path` | font | Loads a DIV FNT font. |
| `load_bdf_font` | `path` | font | Loads a BDF bitmap font. |
| `load_bdf_font_text` | `bdf_source` | font | Loads a BDF font from its text. |

## Path finding

| Name | Arguments | Returns | Description |
|------|-----------|---------|-------------|
| `path_find` | `x1, y1, x2, y2[, TYPE, cell, diagonal, max_nodes, clearance]` | path/0 | A* over a grid of `cell`-pixel squares (default 16) avoiding processes of `TYPE`; returns a path id, 0 if none. `clearance` (pixels, default 0) keeps the path that far from the obstacles - use half the size of the process that follows it, or its body will brush the walls. Diagonal steps never cut an obstacle's corner. |
| `path_length` | `path` | number | Number of points in the path. |
| `path_get_x` | `path, index` | number | X of a point. |
| `path_get_y` | `path, index` | number | Y of a point. |
| `path_clear` | `path` | 1/0 | Forgets a path. |
| `path_assign` | `path[, start_index]` | 1/0 | Makes the current process follow the path. |
| `path_step` | `[speed, arrive_radius]` | 0/1/2 | Moves the current process along its path at `speed` pixels per second: 1 moving, 2 arrived, 0 no path. It never overshoots a point. `arrive_radius` makes it turn that many pixels early, cutting corners by up to that much: use 0 with a path planned with `clearance`, or add the radius to the clearance. |
| `path_stop` | — | 1/0 | Stops following. |
| `path_index` | — | number | Index of the point being walked to. |

## Physics

Rigid-body physics on Planck.js (a JavaScript port of Box2D). A process
gets a body by calling `phys_box`, `phys_circle` or `phys_edge`; from then
on, every frame and before the processes run, the world takes one fixed
step of 1/fps and writes the body's position and angle into the process's
`x`, `y` and `angle`. Setting `x`, `y` or `angle` in the script moves the
body there. When the process dies its body is removed.

Units are the program's: pixels (divided by `resolution`, as for drawing),
pixels per second, and DIV angles (counter-clockwise, `90000` up). Body
types are the constants `phys_static` (never moves), `phys_dynamic` (moved
by forces and collisions, the default) and `phys_kinematic` (moved only by
its velocity). The natives act on the calling process's body; the ones
shown with `[, id]` act on process `id`'s body instead when it is given.

| Function | Arguments | Returns | Description |
|---|---|---|---|
| `phys_gravity` | `gx, gy` | 1 | World gravity in px/s² (default `0, 600`: down). |
| `phys_scale` | `pixels_per_metre` | 1/0 | Pixels in a metre (default 32; Box2D suits objects of 0.1-10 m). Only before the first body. |
| `phys_iterations` | `velocity, position` | 1 | Solver iterations per step (default `8, 3`): more makes joints and stacks stiffer, at a CPU cost. |
| `phys_substeps` | `n` | 1 | Steps per frame (default 1, up to 16), each of 1/(fps·n): steadier fast bodies and long chains. |
| `phys_box` | `width, height[, type]` | 1 | Gives the process a body with a box centred on its `x, y`, rotated by its `angle` (a second call adds another box). |
| `phys_circle` | `radius[, type]` | 1 | Gives the process a body with a circle centred on its `x, y`. |
| `phys_add_box` | `ox, oy, width, height` | 1 | Adds a box at an offset from the body's centre (compound shapes). |
| `phys_add_circle` | `ox, oy, radius` | 1 | Adds a circle at an offset from the body's centre. |
| `phys_edge` | `x1, y1, x2, y2` | 1/0 | Adds a line segment, relative to the process's `x, y`, to a static body: chains of edges make terrain. |
| `phys_material` | `density, friction, restitution` | 1 | Density (mass per area), friction (0 ice, 1 rubber) and bounce (0 none, 1 elastic) for the body's shapes. Defaults `1, 0.5, 0.1`. Called before the body exists, it applies to the shapes made next. |
| `phys_type` | `type[, id]` | 1/0 | Changes the body's type (`phys_static`, `phys_dynamic`, `phys_kinematic`). |
| `phys_velocity` | `vx, vy[, id]` | 1/0 | Sets the body's velocity in px/s. |
| `phys_vx` | `[id]` | number | The body's horizontal velocity in px/s. |
| `phys_vy` | `[id]` | number | The body's vertical velocity in px/s. |
| `phys_impulse` | `ix, iy[, id]` | 1/0 | A kick at the centre: changes the velocity by `impulse / phys_mass()` px/s. |
| `phys_force` | `fx, fy[, id]` | 1/0 | A force at the centre for this step (call it every frame for a steady push). |
| `phys_spin` | `angular_speed[, id]` | 1/0 | Angular velocity in DIV angle units per second (`90000` = a quarter turn a second, counter-clockwise). |
| `phys_fixed_rotation` | `on[, id]` | 1/0 | 1 stops the body from rotating (characters that must stay upright). |
| `phys_bullet` | `on[, id]` | 1/0 | 1 enables continuous collision for fast bodies so they do not pass through thin ones. |
| `phys_sensor` | `on[, id]` | 1/0 | 1 makes the body's shapes detect contacts without pushing anything. |
| `phys_mass` | `[id]` | number | The body's mass (density × area in m²). |
| `phys_contact` | `TYPE name` or `0`, `[id]` | id | The id of a process of that type (any type with 0) whose body touches this one now, or 0. |
| `phys_impact` | `[id]` | number | How hard the body was hit in the last step, as the velocity change in px/s it caused: compare against a threshold to break things. |
| `phys_pin` | `id, x, y` | joint | Pins this body to process `id`'s body (0: to the world) at the point `x, y`, around which both can turn. |
| `phys_weld` | `id` | joint | Glues this body to process `id`'s body (0: to the world) as they are now. |
| `phys_rope` | `id[, length]` | joint | A rod: keeps the distance between this body's centre and process `id`'s body's centre fixed - as it is now, or `length` pixels. |
| `phys_slack` | `id[, max_length]` | joint | A rope that can go slack: the centres never get further apart than `max_length` pixels (default: their distance now). |
| `phys_limits` | `joint, lower, upper` | 1/0 | The process that made a `phys_pin` joint only turns between two DIV angles relative to the other body (counter-clockwise; the world for a pin made with id 0). |
| `phys_motor` | `joint, speed, max_torque` | 1/0 | The process that made a `phys_pin` joint turns at `speed` (DIV angle units per second, counter-clockwise) relative to the other body, with at most `max_torque` (0 switches the motor off): wheels, fans, doors. |
| `phys_spring` | `joint, frequency, damping` | 1/0 | Turns a `phys_rope` rod into a spring: frequency in Hz (0 = rigid again), damping 0-1. |
| `phys_unjoin` | `joint` | 1/0 | Removes a joint made by `phys_pin` or `phys_rope`. |
| `phys_at` | `x, y` | id | The process whose body covers the point, or 0 (picking things with the mouse). |
| `phys_raycast` | `x1, y1, x2, y2[, OFFSET hx, OFFSET hy]` | id | The first body the line from (x1, y1) to (x2, y2) hits (not the caller's), or 0; stores the hit point in `hx, hy`. |
| `phys_awake` | `[id]` | 1/0 | 1 while the world simulates the body; 0 once it has come to rest and fallen asleep (until something touches it), and always 0 for static bodies. |
| `phys_remove` | `[id]` | 1/0 | Removes the calling process's body (the process stays). |
| `phys_clear` | — | 1 | Removes every body and joint (a new level). |
| `phys_bodies` | — | number | How many bodies the world has. |

## Online play

Two players, each in their own browser, peer to peer (WebRTC): no game
server. To connect, the players exchange two codes by any means (chat,
e-mail...): `net_host()` opens a panel with an invitation code for the
host to send; the guest calls `net_join()`, pastes it, and sends back the
answer code the panel makes; the host pastes that and the game connects.
Instead of the invitation code the host can send a link (in the playground,
and in an exported game served from a web site): it opens the same game,
and the guest's `net_join()` then uses the invitation without asking.
The codes carry the browsers' network addresses; a public STUN server
(`stun.l.google.com`, changeable with `runDivDemo({ netIceServers })`)
only tells each browser its public address. No game data goes through it.
Two tabs of the same browser can play with `net_host_local` /
`net_join_local`, without codes.

Two ways to play:

- **Messages**: `net_send(type, value)` and `net_receive()`, for turn-based
  games or programs that sync their own state.
- **Lockstep**: after `net_start()`, both sides run the same simulation.
  Every frame each side sends its keys and mouse; a frame only runs once
  both players' input for it has arrived, and it is applied `delay`
  frames after it was read, which hides the network's latency. Gameplay
  reads `net_key(player, key)` for both players (`key()` is still the
  local keyboard, for menus). The host picks a random seed that both
  sides use, and the frame time is fixed at 1/fps.

Lockstep only stays in step when both simulations are made of the same
things: start both sides in the same state (the usual pattern is to wait
for `net_running()` and only then create the game's processes), drive
gameplay only with `net_key`/`net_mouse_*`, `rand` and frame counts (not
`key()`, `mouse.x`, `get_time()` or `get_fps()`). A tab in the
background gets no animation frames from the browser; during lockstep the
game then keeps stepping on a timer of its own (from a small worker), so
the other player is not left waiting - how often a background tab may run
is up to the browser, so the game can slow down while one player is
away. Every 60 frames the two sides compare a hash of their processes
(id, type, position, angle, graphic, size) and numeric globals; if they
differ, `net_status()` becomes 4 and the log says so.

| Function | Arguments | Returns | Description |
|---|---|---|---|
| `net_host` | — | 1 | Hosts a game (player 0): opens the panel with the invitation code and waits for the answer. |
| `net_join` | — | 1 | Joins a game (player 1): opens the panel to paste the invitation and shows the answer code. |
| `net_host_local` | `[room]` | 1 | Hosts in another tab of this browser, on a named room (default `"divjs"`). |
| `net_join_local` | `[room]` | 1 | Joins the tab hosting `room`. |
| `net_status` | — | 0-4 | 0 idle, 1 connecting, 2 connected, 3 closed (the other player left, the connection failed or was cancelled), 4 desync (still connected; the games went out of step). |
| `net_me` | — | 0/1 | This side's player number: 0 host, 1 guest. |
| `net_players` | — | 1/2 | 2 while connected, otherwise 1. |
| `net_close` | — | 1 | Closes the connection (the other side sees status 3). |
| `net_send` | `type, value` | 1/0 | Sends a message: `type` a number, `value` a number or a string. 0 when not connected. |
| `net_receive` | — | 1/0 | Takes the next message received, in order, for `net_msg_*` to read: 1, or 0 when there is none. |
| `net_msg_type` | — | number | The type of the message taken by `net_receive`. |
| `net_msg_value` | — | value | Its value. |
| `net_msg_from` | — | 0/1 | The player who sent it. |
| `net_start` | `[delay]` | 1/0 | Host: starts lockstep on both sides, with `delay` frames of input delay (default 3, 1-15; about 50 ms at 60 fps). The guest's call does nothing and returns 1, so both sides can run the same code. 0 when not connected or already started. |
| `net_running` | — | 1/0 | 1 once lockstep has started on this side (from the frame after the host's `net_start`). |
| `net_frame` | — | number | Lockstep frames run so far (the same number on both sides for the same frame). |
| `net_key` | `player, key` | 1/0 | 1 while `player` (0 or 1) holds the key in this lockstep frame. |
| `net_key_pressed` | `player, key` | 1/0 | 1 in the frame `player`'s key went down (a tap shorter than a frame still counts). |
| `net_mouse_x` | `player` | number | `player`'s cursor x in this lockstep frame. |
| `net_mouse_y` | `player` | number | `player`'s cursor y. |
| `net_mouse_button` | `player, button` | 1/0 | 1 while `player` holds mouse button `button` (0 left, 1 middle, 2 right). |

Limits: two players. Behind some routers (symmetric NAT, common on mobile
networks and some offices) two browsers cannot reach each other through
STUN alone and need a TURN relay server, which is given with
`netIceServers`; the connection then fails with status 3. Lockstep between
two different browser engines (for example Chrome and Firefox) has not
been tested: their maths functions may round differently.

## Sound and music

Sounds are loaded from files (`load_wav`) or made by the engine from a
recipe (`sfx`, `sfx_tone`: no file needed), and `sound` / `play_sound`
play one on a new channel. Music is a small step sequencer: a song has a
tempo and tracks; a track is an instrument and a line of notes, one step
per sixteenth note, and shorter tracks repeat under the longest one.

Browsers only let a page make sound once the player has clicked or pressed
a key on it: until then `sound` / `play_sound` are skipped (they still
return a channel) and a song waits, then starts on its own. Sound never
changes the game's state, so it is safe in online lockstep games.

Note lines (`song_track`): tokens separated by spaces (or `|` to mark
bars). A note is its name, an optional `#` or `b` and the octave (`C4`,
`F#3`, `Bb2`; `A4` is 440 Hz); `-` holds the previous note one more step;
`.` is a step of silence. Drum tracks (`inst_drums`) use `k` (kick), `s`
(snare) and `h` (hi-hat), alone or together (`kh`).

Constants: waveforms `wave_square`, `wave_triangle`, `wave_saw`,
`wave_sine`, `wave_noise`; effects `sfx_coin`, `sfx_laser`,
`sfx_explosion`, `sfx_powerup`, `sfx_hit`, `sfx_jump`, `sfx_blip`,
`sfx_random`; instruments `inst_square`, `inst_triangle`, `inst_saw`,
`inst_sine`, `inst_drums`, `inst_pluck` (short, plucked), `inst_pad`
(soft, slow), `inst_bass` (triangle an octave down).

| Function | Arguments | Returns | Description |
|---|---|---|---|
| `load_wav` | `path` | sound | Loads a sound file the browser can decode (WAV, OGG, MP3), from the project files or a URL. The frame waits for it, like graphics. |
| `load_pcm` | `path` | sound | DIV's name, same as `load_wav`. DIV's own `.pcm` format is **not** read yet (we have no sample file or description of it): convert such sounds to WAV. |
| `sfx` | `effect[, seed]` | sound | A ready-made effect (`sfx_coin`...); `seed` gives a variation. The same arguments give the same sound (no new sound per call). |
| `sfx_tone` | `wave, freq, freq_end, ms[, volume]` | sound | A tone of `ms` milliseconds sliding from `freq` to `freq_end` Hz; `volume` 0-100 (default 50). |
| `sound` | `sound[, volume, frequency]` | channel | Plays a sound, DIV style: `volume` and `frequency` 256 = as recorded (frequency 512 is an octave up and twice as fast). |
| `play_sound` | `sound[, volume, pitch, pan]` | channel | Plays a sound: `volume` 0-100 (default 100), `pitch` 100 = normal (200 an octave up), `pan` -100 left to 100 right. |
| `change_sound` | `channel, volume, frequency` | 1/0 | Changes a playing channel, with `sound`'s 256 scale. |
| `stop_sound` | `[channel]` | 1/0 | Stops a channel; 0 or nothing stops every sound. |
| `is_playing_sound` | `channel` | 1/0 | 1 while the channel is playing. |
| `sound_volume` | `volume` | 1 | Volume of all sounds, 0-100 (default 100). |
| `music_volume` | `volume` | 1 | Volume of the music, 0-100 (default 60). |
| `song_new` | `bpm` | song | A new, empty song at `bpm` beats a minute (4 steps a beat). |
| `song_track` | `song, instrument, notes[, volume]` | number | Adds a track (see note lines above); `volume` 0-100 (default 60). Returns the song's number of tracks, 0 if the line is empty. |
| `song_play` | `song[, loop]` | 1/0 | Plays the song (stopping the one playing), looping unless `loop` is 0. |
| `song_stop` | — | 1 | Stops the music. |
| `song_playing` | — | song | The song playing (or waiting for the player's first click), 0 for none. |
 
 
