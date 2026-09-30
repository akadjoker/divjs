# DivJS Runtime Natives

Reference for the native functions registered by `CanvasEngineRuntime.registerNatives()` in `vm/runtime.js`. These are the built-in functions available to DIV programs running in the VM. Argument names use the identifiers as they appear in the runtime implementation.

---

## Input

### `key_down(key)` / `key_pressed(key)` / `key(key)`
- `key` — string/number key identifier.
- Returns `1` if the key is currently held, `0` otherwise.
- Aliases handled for arrow keys and space.

### `mouse_x()`
- Returns the current mouse X coordinate in canvas pixels.

### `mouse_y()`
- Returns the current mouse Y coordinate in canvas pixels.

### `mouse_button(button)`
- `button` — mouse button index (`0` = left, `1` = middle, `2` = right).
- Returns `1` if the button is pressed, `0` otherwise.

---

## Screen and Video

### `set_mode(width, height)`
- `width` — screen width in pixels, or a DIV mode constant (`-1` = 320x200, `-2` = 640x480).
- `height` — screen height in pixels.
- Resizes the canvas to the requested resolution.

### `screen_color(color)`
- `color` — CSS color string used when clearing the screen each frame.

### `put_screen(fileId, graphId)`
- `fileId` — FPG library id (default `0`).
- `graphId` — graphic id inside the library.
- Sets a full-screen background graphic.

### `get_pixel(x, y)`
- `x` — screen X coordinate.
- `y` — screen Y coordinate.
- Returns the RGB value of the scenery pixel at `(x, y)`, or `0` for transparent/black pixels.

### `set_fps(fps)`
- `fps` — target frame rate. `0` uncaps the loop.

### `get_fps()`
- Returns the current measured frame rate as an integer.

### `set_debug(enabled)`
- `enabled` — optional; toggles the process-bounds/collision debug overlay if omitted.
- Returns `1` if enabled, `0` if disabled.

### `get_process_count(activeOnly)`
- `activeOnly` — if truthy, count only active, non-suspended processes.
- Returns the number of processes (excluding the engine-owned mouse process).

### `get_time()`
- Returns total elapsed milliseconds since the runtime started.

### `get_delta()`
- Returns the current frame delta time in seconds.

### `set_title()`
- No-op placeholder for DIV compatibility; returns `0`.

---

## Drawing Primitives (Immediate Mode)

### `set_color(color)`
- `color` — CSS color string for subsequent `circle`, `text`, `write`, etc.
- Returns `0`.

### `circle(x, y, radius)`
- `x`, `y` — center coordinates.
- `radius` — circle radius.
- Draws a filled circle on the current frame.

### `text(x, y, text)`
- `x`, `y` — top-left coordinates.
- `text` — string to draw with the system font.

### `draw_rect(x, y, width, height, color)`
- `x`, `y` — top-left coordinates.
- `width`, `height` — rectangle size.
- `color` — optional CSS color; defaults to current color.

### `clear()`
- Clears all non-persistent draw commands.

### `xput(fileId, graphId, x, y, angle, size, flags, region)`
- `fileId` — FPG library id.
- `graphId` — graphic id.
- `x`, `y` — position.
- `angle` — rotation in DIV thousandths of a degree.
- `size` — uniform scale percentage (`100` = 1:1).
- `flags` — mirror/flip flags.
- `region` — optional region id to clip the draw.
- Draws a sprite immediately and also persists it into the scenery buffer so `get_pixel()` sees it.

---

## Text Output

### `write(font, x, y, align, text)`
- `font` — font id (`0` = system font, `>0` = loaded bitmap font).
- `x`, `y` — position.
- `align` — `0` left, `1` center, `2` right.
- `text` — string or `OFFSET` descriptor to display.
- Returns a persistent text id.

### `write_int(font, x, y, align, value)`
- Same as `write()`, but displays the value as an integer.
- `value` may be an `OFFSET` reference for live updates.

### `delete_text(textId)`
- `textId` — id returned by `write`/`write_int`; `0` removes all texts.

---

## Math

### `abs(value)`
- Returns absolute value of `value`.

### `sin(angle)` / `cos(angle)` / `tan(angle)`
- `angle` — DIV angle in thousandths of a degree.
- Returns the trigonometric value.

### `asin(value)` / `acos(value)` / `atan(value)`
- Returns the corresponding DIV angle in thousandths of a degree.

### `atan2(y, x)`
- Returns the DIV angle from the origin to `(x, y)`.

### `sqrt(value)` / `srt(value)`
- Returns the square root, clamped to non-negative values.

### `pow(base, exp)`
- Returns `base` raised to `exp`.

### `floor(value)` / `ceil(value)` / `round(value)` / `int(value)`
- Return integer floor, ceiling, rounded, or truncated value.

### `normalize_angle(angle)`
- Wraps a DIV angle to `[0, 360000)`.

### `sign(value)`
- Returns `-1`, `0`, or `1`.

### `clamp(value, min, max)`
- Clamps `value` between `min` and `max`.

### `lerp(fromValue, toValue, t)`
- Linear interpolation from `fromValue` to `toValue` by factor `t`.

### `lerp_angle(fromAngle, toAngle, t)`
- Shortest-path linear interpolation between two DIV angles.

### `smoothstep(min, max, value)`
- Hermite interpolation `0..1` across the range.

### `hermite(fromValue, toValue, t)`
- Smooth step interpolation between two values.

### `ping_pong(t, length)`
- Triangle-wave ping-pong of `t` within `[0, length]`.

### `wrap(value, min, max)`
- Wraps `value` to the range `[min, max]`.

### `rand_seed(seed)`
- `seed` — optional deterministic seed. Passing `null`/`undefined` restores `Math.random()`.
- Returns `1` if seeded, `0` if unseeded.

### `rand(min, max)` / `random(min, max)`
- Returns a random integer in `[min, max]` (inclusive).
- If only one argument is given, it is treated as `max` with `min = 0`.

### `distance(x1, y1, x2, y2)` / `fget_distance(x1, y1, x2, y2)`
- Returns Euclidean distance between two points.

### `distance_rect(px, py, rx, ry, rw, rh)`
- Returns distance from point `(px, py)` to rectangle `(rx, ry, rw, rh)`.

### `fget_angle(x1, y1, x2, y2)`
- Returns DIV angle from `(x1, y1)` to `(x2, y2)`.

### `get_distx(distance, angle)` / `get_disty(distance, angle)`
- Returns X/Y displacement for `distance` at DIV `angle`.

### `torad(angle)` / `todeg(radians)`
- Convert DIV angle to radians and back.

### `advance(distance, explicitAngle)`
- Moves the current process by `distance` along `explicitAngle` (or the current process angle if omitted).

### `xadvance(distance, angle)`
- Same fixed argument order as `advance(distance, angle)`.

---

## Graphics and Control Points

### `set_point(fileId, graphId, pointIndex, x, y)`
- Sets control point `pointIndex` on the runtime graph.

### `get_point(fileId, graphId, pointIndex, axis)`
- Returns `x` (axis `0`) or `y` (axis `1`) of a control point.

### `get_point_x(fileId, graphId, pointIndex)`
- Convenience for `get_point(..., 0)`.

### `get_point_y(fileId, graphId, pointIndex)`
- Convenience for `get_point(..., 1)`.

### `get_real_point(pointIndex)` / `get_real_point(fileId, graphId, pointIndex)`
- Returns the world-space `{x, y}` of a control point, applying process position, angle, size, and flags.

### `get_real_point_x(...)` / `get_real_point_y(...)`
- Return the X or Y component of the above.

### `new_graphic(width, height)`
- Creates a blank procedural canvas graphic and returns its id.

### `free_graphic(id)`
- Removes the graphic asset from the registry.

---

## Procedural Graphics API (`gfx_*`)

All functions operate on a canvas graphic created by `new_graphic()` and identified by `id`. Colors are 8-bit RGB components (`0..255`).

### `gfx_fill(id, r, g, b)`
- Fills the whole canvas with the RGB color.

### `gfx_fill_rgba(id, r, g, b, a)`
- Fills the canvas with RGBA, where `a` is `0..100` (opacity percentage).

### `gfx_pixel(id, x, y, r, g, b)`
- Draws a single pixel.

### `gfx_line(id, x1, y1, x2, y2, r, g, b)`
- Draws a 1-pixel line.

### `gfx_rect(id, x, y, width, height, r, g, b)`
- Draws a filled rectangle.

### `gfx_rect_outline(id, x, y, width, height, r, g, b)`
- Draws a rectangle outline.

### `gfx_circle(id, x, y, radius, r, g, b)`
- Draws a filled circle.

### `gfx_circle_outline(id, x, y, radius, r, g, b)`
- Draws a circle outline.

### `gfx_text(id, x, y, text, r, g, b, size)`
- Draws text on the canvas at `(x, y)` with the given pixel size and color.

---

## Regions and Scroll

### `define_region(id, x, y, width, height)`
- Defines a rectangular region by `id`.
- Returns the region id.

### `start_scroll(index, fileId, graphId, backId, regionId, flags)`
- `index` — scroll slot index.
- `fileId`, `graphId` — foreground graphic.
- `backId` — background graphic.
- `regionId` — region to clip the scroll.
- `flags` — wrap bits (`1` horizontal, `2` vertical).
- Activates a parallax scroll.

### `stop_scroll(index)`
- Deactivates the scroll at `index`.

### `out_of_region(regionId)` / `exit_region(regionId)`
- Returns `1` if the current process's bounds touch outside the region, `0` otherwise.
- Defaults to region `0` (the whole screen).

### `out_of_screen()` / `exit_screen()`
- Shorthand for `out_of_region(0)`.

### `out_region(processId, regionId)`
- Returns `1` if the named process is completely outside the region, `0` otherwise.

---

## Collision

### `collision(typeCode)`
- `typeCode` — process type identifier to test against, or `0` for the mouse.
- Returns the colliding process id, or `0`.

### `collision_circle(typeCode)`
- Circle-vs-circle collision test.

### `collision_obb(typeCode)`
- OBB (oriented bounding box) collision test.

### `collision_point(x, y, typeCode)`
- Tests whether point `(x, y)` collides with any process of `typeCode`.

### `set_collision_shape(shape)`
- `shape` — `'circle'` or `'box'` (also accepts `1` for circle).
- Sets the default collision shape for the current process.
- Returns `1` for circle, `0` for box.

### `get_collision_shape()`
- Returns the current process's default collision shape.

### `clear_collision_boxes()`
- Removes all custom collision boxes from the current process.

### `add_collision_box(x, y, width, height, code)`
- Adds an axis-aligned custom collision box with an optional `code`.
- Returns the number of boxes.

### `add_collision_circle(x, y, radius, code)`
- Adds a custom collision circle with an optional `code`.
- Returns the number of shapes.

### `set_collision_radius(radius)`
- Sets the default collision radius for the current process.

### `get_collision_radius()`
- Returns the current process's default collision radius.

### `set_collision_scale(scale)`
- Sets a uniform scale multiplier for collision boxes/circles.

### `get_collision_scale()`
- Returns the collision scale.

### `penetration_x()` / `penetration_y()`
- Returns the last reported collision penetration vector.

### `collider_cbox()` / `collided_cbox()`
- Returns the `code` of the collider/collided custom collision box from the last collision, or `-1`.

### `place_meeting(x, y, typeCode)`
- Returns `1` if the current process would collide at position `(x, y)` with `typeCode`.

### `place_free(x, y, typeCode)`
- Returns `1` if position `(x, y)` is free of `typeCode` collisions.

---

## Pathfinding

### `path_find(startX, startY, endX, endY, obstacleTypeCode, cellSize, allowDiagonal, maxNodes)`
- Plans a grid A* path avoiding processes of `obstacleTypeCode`.
- `cellSize` — grid cell size (default `16`).
- `allowDiagonal` — whether diagonal moves are allowed (default `1`).
- `maxNodes` — search limit (default `4096`).
- Returns a path id, or `0` if no path found.

### `path_length(pathId)`
- Returns the number of points in the path.

### `path_get_x(pathId, index)` / `path_get_y(pathId, index)`
- Returns the X/Y coordinate of path point `index`.

### `path_clear(pathId)`
- Deletes the path and detaches any followers.

### `path_assign(pathId, startIndex)`
- Assigns the path to the current process, starting at `startIndex`.
- Returns `1` on success, `0` on failure.

### `path_step(speedPerSecond, arriveRadius)`
- Moves the current process along its assigned path.
- `speedPerSecond` — movement speed in pixels per second.
- `arriveRadius` — distance considered "at" a waypoint.
- Returns `1` while moving, `2` when finished.

### `path_stop()`
- Detaches the current process from its path.

### `path_index()`
- Returns the current waypoint index of the process's path.

---

## Process Control

### `signal(targetOrType, signalCode)`
- If `targetOrType` matches a process id, signals that process; otherwise signals all processes of the given type.
- Returns the result of `processManager.signalById`/`signalByType`.

### `let_me_alone()`
- Kills all other processes except the current one and its descendants.
- Returns the number of killed processes.

### `exit(message, code)`
- `message` — optional string logged before halting.
- `code` — exit code returned.
- Halts the entire VM.

---

## Asset Loading

All loaders return an id immediately and complete asynchronously. The runtime waits for pending loads before rendering a new frame that depends on them.

### `load_graphic(src, sx, sy, sw, sh)` / `load_tile(src, sx, sy, sw, sh)`
- `src` — image URL or path.
- `sx`, `sy`, `sw`, `sh` — optional source rectangle for a tile.
- Returns a graphic id.

### `load_map(src)`
- Loads a DIV `.map` file.
- Returns a graphic id.

### `load_fpg(src)`
- Loads a DIV `.fpg` graphics library.
- Returns a library/file id.

### `load_fnt(src)`
- Loads a DIV `.fnt` bitmap font.
- Returns a font id.

### `load_bdf_font(src)`
- Fetches a BDF bitmap font and returns a font id.

### `load_bdf_font_text(text)`
- Loads a BDF font from an inline string.
- Returns a font id.

---

## Fade Effects

### `fade_off(speed)` / `fade_on(speed)`
- Fades the overlay to fully transparent (`fade_off`) or fully opaque (`fade_on`).
- `speed` — fade speed in DIV fade units (default `8`).

### `fade(r, g, b, speed)`
- `r`, `g`, `b` — intensity percentages `0..100` (`100` = normal).
- `speed` — fade speed.
- Averages the three channels into a single darkening overlay.

### `is_fading()`
- Returns `1` if a fade is still active, `0` otherwise.

---

## Logging and Debug

### `log(...values)` / `print(...values)`
- Emits the concatenated values through the runtime `logFn` (usually `console.log`).

---

## Internal / Compiler-Generated

These are not meant to be called directly by user scripts; they are emitted by the compiler for language features.

### `__get_path(...segments)` / `__set_path(...segments, value)`
- Resolves dotted/array paths on globals, scroll, timer, `father`, `son`, etc.

### `__get_process_field(processId, fieldName)` / `__set_process_field(processId, fieldName, value)`
- Cross-process field access used for expressions like `other.x` or `other.graph = 5`.

### `__get_mouse_field(fieldName)` / `__set_mouse_field(fieldName, value)`
- Field access for the engine-owned mouse process.
