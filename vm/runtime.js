/**
 * DivLang Runtime
 * Native functions para a VM
 */

import { VM } from './vm.js';
import { Graphics } from '../graph/graphics.js';
import { parseBennuBdfFont } from './bennu_bdf.js';
import { loadDivFpgFromUrl, loadDivFntFromUrl, loadDivMapFromUrl } from './div_formats.js';
import { getProcessShapes, setPivotResolver } from './process.js';
import { font6x8Pixel, FONT_6X8_WIDTH, FONT_6X8_HEIGHT } from './font_6x8.js';
import { MinHeap } from './min_heap.js';

export const CType = {
  C_SCREEN: 0,
  C_SCROLL: 1,
  C_M7: 2
};

class Graph {
  constructor(fileId, graphId, width = 32, height = 32) {
    this.fileId = Number(fileId) || 0;
    this.graphId = Number(graphId) || 0;
    this.width = Number(width) || 32;
    this.height = Number(height) || 32;
    this.points = new Map();

    // DIV convention: point 0 is the base pivot (center by default).
    this.setPoint(0, this.width * 0.5, this.height * 0.5);
  }

  setPoint(index, x, y) {
    const pointIndex = Number(index) || 0;
    this.points.set(pointIndex, {
      x: Number(x) || 0,
      y: Number(y) || 0
    });
  }

  getPoint(index) {
    const pointIndex = Number(index) || 0;
    return this.points.get(pointIndex) || this.points.get(0) || { x: 0, y: 0 };
  }
}

// Apply control points parsed from a MAP/FPG file onto a runtime Graph.
// DIV convention: cpoint 0 is the rotation/scale pivot; an "undefined"
// cpoint (stored as -1,-1 in the file) leaves the graph's default point.
function applyCpointsToGraph(graph, cpoints) {
  if (!graph || !cpoints || !cpoints.length) {
    return;
  }
  cpoints.forEach((cp, index) => {
    if (cp && !cp.undefined) {
      graph.setPoint(index, cp.x, cp.y);
    }
  });
}

// Engine runtime adapter for browser canvas hosts.
export class CanvasEngineRuntime {
  constructor(options) {
    this.vm = options.vm;
    this.ctx = options.ctx;
    this.width = options.width || this.ctx.canvas.width;
    this.height = options.height || this.ctx.canvas.height;
    this.clearColor = options.clearColor || '#0b1117';
    this.logFn = options.logFn || ((line) => console.log(line));
    this.backgroundGraph = null; // set via put_screen(); stretched to fill the screen behind all processes
    // In-flight load_fpg/load_fnt/load_map promises. A process can be
    // spawned (and reference a graphic) before that graphic's fetch()
    // has resolved - e.g. tutor0b.html's MAIN has a 30% chance of
    // spawning an "enemy" on every tick starting from tick 1, well
    // before load_fpg's network request can possibly finish. Every
    // frame re-resolves the graphic fresh (see getGraphAsset), so this
    // isn't a permanent failure, but it visibly flashes the fallback
    // placeholder on every fresh load. See divjs.js's loop(), which
    // awaits this list before rendering a tick that added to it.
    this.pendingLoads = [];
    // Bumped by set_point() so the per-process pivot memo in
    // getProcessPivot() invalidates without tracking individual graphs.
    this.pointsVersion = 0;
    this.nextTextId = 1; // ids handed out by write/write_int, for delete_text

    this.keys = {};
    this._scanCode = 0;
    this._scanCodePending = 0;
    this.drawCommands = [];
    this.currentColor = '#ffffff'; // DIV draws text white by default
    this.cameraX = 0;
    this.cameraY = 0;
    this.totalTime = 0;
    this.debugDrawProcessBounds = !!options.debugDrawProcessBounds;
    this.debugProcessBoundsColor = options.debugProcessBoundsColor || '#00ffff';
    this.debugShowStats = !!options.debugShowStats;
    this.debugStatsTextColor = options.debugStatsTextColor || '#e6fffb';
    this.debugStatsBgColor = options.debugStatsBgColor || 'rgba(6, 10, 18, 0.7)';
    this.debugStatsX = Number(options.debugStatsX) || 8;
    this.debugStatsY = Number(options.debugStatsY) || 8;
    this.fpsValue = 0;
    this.fpsAccumTime = 0;
    this.fpsAccumFrames = 0;
    this.targetFps = 0; // 0 = uncapped, set via set_fps()
    this.state = {
      scroll: [],
      region: {},
      graphs: {},
      // DIV's timer[] - a fixed 10-slot table (timer[0]..timer[9]),
      // each counting milliseconds elapsed since it was last reset by
      // assignment (see beginFrame's auto-increment and the bare
      // "timer"/"timer[n]" handling in compiler.js). Read/write already
      // routes through the generic __get_path/__set_path machinery
      // (same as scroll[]) purely because this is a plain array here.
      timer: new Array(10).fill(0)
    };

    this.bitmapFonts = new Map();
    this.nextBitmapFontId = 1;
    this.graphLibraries = new Map();
    // Library ids start at 0, matching real DIV: the first FPG loaded
    // (even without capturing its return value) becomes file 0, which
    // is exactly how the original tutor*.prg scripts assume put_screen(0, N)
    // and bare `graph=N;` (file left at its 0 default) resolve.
    this.nextGraphLibraryId = 0;
    this.paths = new Map();
    this.nextPathId = 1;
    this.pathFollowers = new Map();

    this.randomSeed = null;

    // Fade overlay: alpha 0=transparent, 1=fully opaque
    this._fade = { active: false, alpha: 0, target: 0, speed: 0, r: 0, g: 0, b: 0 };

    // Mouse state (updated by setupMouseListeners)
    this._mouse = { x: 0, y: 0, buttons: [false, false, false] };
    if (this.ctx?.canvas) this._setupMouseListeners(this.ctx.canvas);
  }

  _setupMouseListeners(canvas) {
    const m = this._mouse;
    const toCanvas = (e) => {
      const r = canvas.getBoundingClientRect();
      m.x = Math.round((e.clientX - r.left) * (canvas.width / r.width));
      m.y = Math.round((e.clientY - r.top) * (canvas.height / r.height));
    };
    canvas.addEventListener('mousemove', e => { toCanvas(e); });
    canvas.addEventListener('mousedown', e => { toCanvas(e); m.buttons[e.button] = true; });
    canvas.addEventListener('mouseup', e => { toCanvas(e); m.buttons[e.button] = false; });
    canvas.addEventListener('mouseleave', e => { m.buttons = [false, false, false]; });
  }

  nextRandom01() {
    // Deterministic sequence when seed is set via rand_seed().
    if (this.randomSeed === null) {
      return Math.random();
    }

    const a = 1664525;
    const c = 1013904223;
    const m = 0x100000000;
    this.randomSeed = (a * this.randomSeed + c) >>> 0;
    return this.randomSeed / m;
  }

  getGraphKey(fileId, graphId) {
    return `${Number(fileId) || 0}:${Number(graphId) || 0}`;
  }

  ensureGraph(fileId, graphId, width, height) {
    const key = this.getGraphKey(fileId, graphId);
    if (!this.state.graphs[key]) {
      this.state.graphs[key] = new Graph(fileId, graphId, width, height);
      return this.state.graphs[key];
    }

    const graph = this.state.graphs[key];
    if (width !== undefined) {
      graph.width = Number(width) || graph.width;
    }
    if (height !== undefined) {
      graph.height = Number(height) || graph.height;
    }
    return graph;
  }

  // DIV's standard PC-XT scan code table (DIV manual, "Key codes"),
  // keyed the same way this.keys already is - by the JS KeyboardEvent
  // "key" string set via setKeyState. Only covers the keys scripts
  // actually reference by name; scan_code just needs to be a nonzero,
  // DIV-accurate value for whichever one was last pressed.
  static SCAN_CODES = {
    Escape: 1,
    '1': 2, '2': 3, '3': 4, '4': 5, '5': 6, '6': 7, '7': 8, '8': 9, '9': 10, '0': 11,
    Backspace: 14, Tab: 15,
    q: 16, w: 17, e: 18, r: 19, t: 20, y: 21, u: 22, i: 23, o: 24, p: 25,
    Enter: 28, Control: 29,
    a: 30, s: 31, d: 32, f: 33, g: 34, h: 35, j: 36, k: 37, l: 38,
    Shift: 42,
    z: 44, x: 45, c: 46, v: 47, b: 48, n: 49, m: 50,
    Alt: 56, ' ': 57,
    F1: 59, F2: 60, F3: 61, F4: 62, F5: 63, F6: 64, F7: 65, F8: 66, F9: 67, F10: 68,
    Home: 71, ArrowUp: 72, PageUp: 73,
    ArrowLeft: 75, ArrowRight: 77,
    End: 79, ArrowDown: 80, PageDown: 81, Insert: 82, Delete: 83,
    F11: 87, F12: 88
  };

  setKeyState(key, isDown) {
    this.keys[key] = !!isDown;
    if (isDown) {
      const code = CanvasEngineRuntime.SCAN_CODES[key];
      if (code !== undefined) {
        this._scanCodePending = code;
      }
    }
  }

  clearKeyState() {
    for (const key of Object.keys(this.keys)) {
      this.keys[key] = false;
    }
  }

  // Mirrors the real cursor onto the mouse Process (see registerNatives).
  updateMouseProcess() {
    const p = this.mouseProcess;
    if (!p) {
      return;
    }
    p.x = this._mouse.x;
    p.y = this._mouse.y;
    p.locals[0] = p.x;
    p.locals[1] = p.y;

    // A cursor collides through its hotspot, not through the whole
    // graphic. tutor6's cursor is 32x32 on a 40x40 grid, so a full-size
    // box overlaps two or four board squares at once - every one of them
    // fires change_boardbox() in the same frame and an even number of
    // toggles undoes itself, which is exactly the "smiles appear then go
    // back" behaviour. The hotspot is control point 0, and cboxToShape
    // maps a cbox at the pivot's own local coordinates back onto the
    // process position exactly.
    const pivot = this.getProcessPivot(p) || { x: 0, y: 0 };
    p.cboxes = [{
      shape: 'circle',
      code: 0,
      x: Number(pivot.x) || 0,
      y: Number(pivot.y) || 0,
      radius: 1
    }];
  }

  // Reads/writes of `mouse.<field>` that aren't x/y/buttons land here.
  getMouseFieldNative(fieldName) {
    if (!this.mouseProcess) {
      return 0;
    }
    return this.getProcessFieldValue(this.mouseProcess, fieldName);
  }

  setMouseFieldNative(fieldName, value) {
    if (!this.mouseProcess) {
      return 0;
    }
    // graph/file/size/flags are canonical slots now, so the normal path
    // writes the slot and syncs the property. Writing the property alone
    // (as this used to) left locals[16] at 0, and the next sync() wiped
    // the cursor graphic straight back out.
    return this.setProcessFieldValue(this.mouseProcess, fieldName, value);
  }

  beginFrame(dt) {
    this.updateMouseProcess();
    this.vm.dt = dt;
    this.totalTime += dt;
    this.fpsAccumTime += dt;
    this.fpsAccumFrames += 1;
    // GET_ID's per-(caller,type) iteration cursor resets "until the next
    // FRAME statement is executed" (DIV manual) - approximated by
    // resetting once per real engine tick (see getIdNative).
    this._frameGeneration = (this._frameGeneration || 0) + 1;

    // DIV's timer[] counts milliseconds elapsed since each slot was last
    // reset by assignment - advance every slot every frame.
    const dtMs = dt * 1000;
    const timers = this.state.timer;
    for (let i = 0; i < timers.length; i++) {
      timers[i] += dtMs;
    }

    // scan_code is transient - DIV manual: "will be at 0 if no key has
    // been pressed in the previous frame" - so it must clear if this
    // frame didn't see a fresh keydown, not stay latched like KEY()'s
    // held-state check does.
    this._scanCode = this._scanCodePending || 0;
    this._scanCodePending = 0;

    if (this.fpsAccumTime >= 0.25) {
      this.fpsValue = this.fpsAccumFrames / this.fpsAccumTime;
      this.fpsAccumTime = 0;
      this.fpsAccumFrames = 0;
    }

    // Advance fade each frame
    const f = this._fade;
    if (f.active) {
      // DIV fades the palette DAC over the range 0..64, advancing by
      // `dacout_speed` units once per frame (f.c's fade/fade_on/fade_off,
      // stepped in i.c:1596). Dividing by 64 reproduces that timing, so
      // the default speed of 8 completes a fade in 8 frames. Dividing by
      // 100 - as this used to - made every fade 12x slower than DIV,
      // which at tutor4's set_fps(12) left the screen black for ~8s.
      const step = f.speed / 64;
      if (f.alpha < f.target) {
        f.alpha = Math.min(f.target, f.alpha + step);
      } else if (f.alpha > f.target) {
        f.alpha = Math.max(f.target, f.alpha - step);
      }
      if (f.alpha === f.target) f.active = false;
      // Snap to exact target to avoid float drift
      else if (Math.abs(f.alpha - f.target) < 1e-9) { f.alpha = f.target; f.active = false; }
    }
  }

  getMemoryStatsText() {
    const perf = globalThis.performance;
    const mem = perf && perf.memory;
    if (!mem || !Number.isFinite(mem.usedJSHeapSize)) {
      return 'RAM: n/a';
    }

    const usedMb = mem.usedJSHeapSize / (1024 * 1024);
    const limitMb = Number.isFinite(mem.jsHeapSizeLimit)
      ? mem.jsHeapSizeLimit / (1024 * 1024)
      : 0;
    return `RAM: ${usedMb.toFixed(1)}MB / ${limitMb.toFixed(0)}MB`;
  }

  // Colour key for drawProcessDebugOverlay, drawn as a small legend when
  // the shape overlay is on so the markers aren't guesswork.
  static DEBUG_LEGEND = [
    ['#ff2d95', 'collision shape'],
    ['#ffffff', 'COLLIDING now'],
    ['#ffe600', 'pivot (point 0)'],
    ['#00ff6a', 'control points'],
    ['#00ffff', 'width/height box']
  ];

  drawDebugLegend() {
    if (!this.debugDrawProcessBounds) {
      return;
    }

    const entries = CanvasEngineRuntime.DEBUG_LEGEND;
    // Same reasoning as the markers in drawProcessDebugOverlay: a fixed
    // 10px legend covers a quarter of a 320x200 DIV screen.
    const s = Math.max(0.5, Math.min(1, this.width / 800));
    const fontPx = Math.max(5, Math.round(10 * s));
    const lineHeight = Math.round(12 * s);
    const pad = Math.round(6 * s);
    const swatch = Math.round(8 * s);

    this.ctx.save();
    this.ctx.font = `${fontPx}px JetBrains Mono, Consolas, monospace`;
    this.ctx.textBaseline = 'top';

    const textWidth = Math.max(...entries.map(([, label]) => this.ctx.measureText(label).width));
    const boxW = pad * 2 + swatch + 5 + textWidth;
    const boxH = pad * 2 + entries.length * lineHeight;
    const boxX = 4;
    const boxY = this.height - boxH - 4;

    this.ctx.fillStyle = 'rgba(0,0,0,0.65)';
    this.ctx.fillRect(boxX, boxY, boxW, boxH);

    entries.forEach(([color, label], i) => {
      const y = boxY + pad + i * lineHeight;
      this.ctx.fillStyle = color;
      this.ctx.fillRect(boxX + pad, y + 1, swatch, swatch);
      this.ctx.fillStyle = '#fff';
      this.ctx.fillText(label, boxX + pad + swatch + 5, y);
    });

    this.ctx.restore();
  }

  // Toggle the collision-shape/pivot overlay at runtime. Exposed to
  // scripts as set_debug() and wired to a key in divjs.js, so it can be
  // flipped on without editing the page that hosts the demo.
  setDebugNative(enabled) {
    if (enabled === undefined) {
      this.debugDrawProcessBounds = !this.debugDrawProcessBounds;
    } else {
      this.debugDrawProcessBounds = !!(Number(enabled) || 0);
    }
    return this.debugDrawProcessBounds ? 1 : 0;
  }

  drawDebugStats() {
    if (!this.debugShowStats) {
      return;
    }

    const allProcesses = this.vm?.processManager?.getAll?.() || [];
    let active = 0;
    let sleeping = 0;
    for (const process of allProcesses) {
      if (process.active && !process.suspended && !process.dead) {
        active += 1;
      } else if (process.suspended && !process.dead) {
        sleeping += 1;
      }
    }

    const lines = [
      `FPS: ${this.fpsValue.toFixed(1)}`,
      `PROC: ${allProcesses.length} (active ${active}, sleep ${sleeping})`,
      this.getMemoryStatsText()
    ];

    this.ctx.save();
    this.ctx.font = '12px JetBrains Mono, Consolas, monospace';
    this.ctx.textBaseline = 'top';

    const lineHeight = 15;
    const padX = 8;
    const padY = 6;
    const textWidth = Math.max(...lines.map((line) => this.ctx.measureText(line).width));
    const boxW = textWidth + padX * 2;
    const boxH = lineHeight * lines.length + padY * 2;

    this.ctx.fillStyle = this.debugStatsBgColor;
    this.ctx.fillRect(this.debugStatsX, this.debugStatsY, boxW, boxH);

    this.ctx.fillStyle = this.debugStatsTextColor;
    for (let i = 0; i < lines.length; i++) {
      this.ctx.fillText(lines[i], this.debugStatsX + padX, this.debugStatsY + padY + i * lineHeight);
    }

    this.ctx.restore();
  }

  keyDownNative(key) {
    const aliases = {
      left: ['left', 'arrowleft'],
      right: ['right', 'arrowright'],
      up: ['up', 'arrowup'],
      down: ['down', 'arrowdown'],
      space: ['space', ' ', 'spacebar']
    };

    const wanted = String(key).toLowerCase();
    const candidates = aliases[wanted] || [wanted];

    for (const candidate of candidates) {
      for (const pressedKey of Object.keys(this.keys)) {
        // Modifiers are skipped so they can't satisfy a lookup for some
        // *other* key - but not when the script asked for the modifier
        // itself ("IF (key(_control))", which real DIV scripts use to
        // fire; see tutor1b). Previously this skipped unconditionally,
        // making key(_control)/_shift/_alt permanently false.
        const isModifier = pressedKey === 'Meta' || pressedKey === 'Control' ||
          pressedKey === 'Alt' || pressedKey === 'Shift';
        if (isModifier && pressedKey.toLowerCase() !== candidate) {
          continue;
        }
        if (pressedKey.toLowerCase() === candidate && this.keys[pressedKey]) {
          return true;
        }
      }
    }

    return false;
  }

  keyPressedNative(key) {
    return this.keyDownNative(key);
  }

  keyNative(key) {
    return this.keyDownNative(key);
  }

  setColorNative(color) {
    this.currentColor = String(color);
    return 0;
  }

  setTitleNative() {
    return 0;
  }

  // Classic DIV calls SET_MODE with a single resolution constant
  // (SET_MODE(M640X480)); this engine's own demos call it with explicit
  // (width, height) instead. Support both: when called with one argument
  // that matches a known mode constant (see the negative m320x200/
  // m640x480 entries in compiler.js's builtinConstants), decode it here;
  // otherwise fall back to the plain two-argument form.
  // Every SET_MODE constant the DIV manual lists ("Establishes a new
  // video mode... The allowed videomodes... are the following ones").
  // Values match compiler.js's builtinConstants (m320x200/m640x480 kept
  // at their original -1/-2 for backward compat with anything already
  // relying on those two specific numbers).
  static VIDEO_MODE_TABLE = {
    '-1': [320, 200],
    '-2': [640, 480],
    '-3': [320, 240],
    '-4': [320, 400],
    '-5': [360, 240],
    '-6': [360, 360],
    '-7': [376, 282],
    '-8': [640, 400],
    '-9': [800, 600],
    '-10': [1024, 768]
  };

  setModeNative(width, height) {
    if (height === undefined) {
      const mode = CanvasEngineRuntime.VIDEO_MODE_TABLE[Number(width)];
      if (mode) {
        [width, height] = mode;
      }
    }
    const w = Number(width) || this.width;
    const h = Number(height) || this.height;
    this.width = w;
    this.height = h;
    this.ctx.canvas.width = w;
    this.ctx.canvas.height = h;
    return 0;
  }

  screenColorNative(color) {
    this.clearColor = String(color);
    return 0;
  }

  // DIV's GET_PIXEL(x, y) - reads a pixel straight off the rendered
  // screen, which scripts use for collision against painted scenery
  // (tutor4's worm dies on "get_pixel(x,y)!=0", i.e. anything that isn't
  // the black background). Returns 0 for a fully-black/transparent
  // pixel, non-zero otherwise, approximating DIV's palette-index test
  // closely enough for that "is something there?" idiom.
  // The scenery buffer GET_PIXEL reads, mirroring DIV's `copia2`. DIV
  // keeps the background in its own buffer (exported as "background" in
  // i.c); PUT_SCREEN clears and draws into it, and every frame the
  // visible page is refreshed from it (memcpy(copia, copia2, ...)) before
  // process sprites are blitted on top. So GET_PIXEL sees scenery only -
  // never the sprites. Reading the composited canvas instead, as this
  // used to, made tutor4's worm die on its own trail: the head tests the
  // square ahead, and that square still held the previous frame's
  // rendering of the worm.
  // Builds (or returns the cached) buffer even with no PUT_SCREEN
  // background set - real DIV's copia2 exists from startup and xput/put
  // draw straight into it (see xputNative), independent of whether a
  // background graphic was ever assigned.
  ensureSceneryBuffer() {
    const bg = this.backgroundGraph;
    let graphic = null;
    if (bg) {
      graphic = this.getGraphAsset(bg.fileId, bg.graphId);
      if (!graphic || !graphic.image || graphic.loaded === false) {
        return null; // not decoded yet - rebuilt on a later call
      }
    }

    const key = bg
      ? `${bg.fileId}:${bg.graphId}:${this.width}x${this.height}`
      : `none:${this.width}x${this.height}`;
    if (this._sceneryKey === key && this._sceneryCtx) {
      return this._sceneryCtx;
    }

    const canvas = document.createElement('canvas');
    canvas.width = this.width;
    canvas.height = this.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (bg) {
      this.blitBackground(ctx, graphic, bg.fileId, bg.graphId);
    }

    this._sceneryKey = key;
    this._sceneryCtx = ctx;
    return ctx;
  }

  getPixelNative(x, y) {
    const px = Math.round(Number(x) || 0);
    const py = Math.round(Number(y) || 0);
    if (px < 0 || py < 0 || px >= this.width || py >= this.height) {
      return 0;
    }

    const ctx = this.ensureSceneryBuffer();
    if (!ctx) {
      return 0; // no PUT_SCREEN yet: DIV's copia2 starts zeroed
    }

    try {
      const data = ctx.getImageData(px, py, 1, 1).data;
      // Fully transparent is palette index 0 in an 8bpp DIV graphic (see
      // decodePixelsToImageData), which is what scripts test for with
      // "get_pixel(x,y) != 0".
      if (data[3] === 0) {
        return 0;
      }
      return (data[0] << 16) | (data[1] << 8) | data[2];
    } catch (error) {
      // getImageData throws on a tainted canvas (cross-origin image).
      return 0;
    }
  }

  // Sets (or clears, when graphId <= 0) a graphic as a static full-screen
  // background, stretched to fill the screen behind every process - same
  // as DIV's put_screen(file, graph).
  // PUT_SCREEN draws the graphic 1:1, anchored at its pivot - DIV does
  // `put_sprite(file,graf,xg,yg,0,100,...)` into the background buffer
  // (f.c:1751), where xg,yg is control point 0 and size 100 means no
  // scaling. Stretching it to fill the screen, as this used to, only
  // looked right when the background happened to match the screen size;
  // anything else was silently rescaled instead of leaving the
  // uncovered area black the way DIV does.
  blitBackground(ctx, graphic, fileId, graphId) {
    const graph = this.ensureGraph(fileId, graphId);
    const pivot = graph.getPoint(0) || { x: 0, y: 0 };
    const dx = Math.round(this.width * 0.5 - (Number(pivot.x) || 0));
    const dy = Math.round(this.height * 0.5 - (Number(pivot.y) || 0));

    if (graphic.sx !== undefined) {
      ctx.drawImage(graphic.image, graphic.sx, graphic.sy, graphic.sw, graphic.sh, dx, dy, graphic.sw, graphic.sh);
    } else {
      ctx.drawImage(graphic.image, dx, dy);
    }
  }

  putScreenNative(fileId, graphId) {
    // Drop any cached scenery buffer - ensureSceneryBuffer rebuilds it
    // from whatever background is set now (DIV's put_screen likewise
    // clears copia2 before drawing into it).
    this._sceneryKey = null;
    this._sceneryCtx = null;

    const gid = Number(graphId) || 0;
    if (gid <= 0) {
      this.backgroundGraph = null;
      return 0;
    }
    this.backgroundGraph = { fileId: Number(fileId) || 0, graphId: gid };
    return 0;
  }

  drawBackgroundGraph() {
    if (!this.backgroundGraph) {
      return;
    }
    const { fileId, graphId } = this.backgroundGraph;
    const graphic = this.getGraphAsset(fileId, graphId);
    if (!graphic || !graphic.image || graphic.loaded === false) {
      return;
    }
    this.blitBackground(this.ctx, graphic, fileId, graphId);
  }

  setFpsNative(fps) {
    const value = Number(fps) || 0;
    this.targetFps = value > 0 ? value : 0;
    return 0;
  }

  // Real DIV exposes FPS as a bare read-only global (see the `fps`
  // identifier special-case in compiler.js); get_process_count has no
  // direct DIV equivalent but covers the other half of a typical
  // hand-written stats process ("FPS: 60 | procs: 12").
  getFpsNative() {
    return Math.round(this.fpsValue) || 0;
  }

  getProcessCountNative(activeOnly) {
    // The mouse is an engine-owned process with no script body - real
    // DIV's mouse is a separate struct, never counted among processes -
    // so it must not inflate get_process_count()'s result.
    const all = (this.vm?.processManager?.getAll?.() || []).filter((p) => !p.isMouse);
    if (!activeOnly) {
      return all.length;
    }
    return all.filter((p) => p.active && !p.suspended && !p.dead).length;
  }

  toRadiansFromDivAngle(angle) {
    return ((Number(angle) || 0) / 1000) * (Math.PI / 180);
  }

  toDivAngleFromRadians(radians) {
    return ((Number(radians) || 0) * 180 / Math.PI) * 1000;
  }

  absNative(value) {
    return Math.abs(Number(value) || 0);
  }

  sinNative(angle) {
    return Math.sin(this.toRadiansFromDivAngle(angle));
  }

  cosNative(angle) {
    return Math.cos(this.toRadiansFromDivAngle(angle));
  }

  tanNative(angle) {
    return Math.tan(this.toRadiansFromDivAngle(angle));
  }

  asinNative(value) {
    return this.toDivAngleFromRadians(Math.asin(Number(value) || 0));
  }

  acosNative(value) {
    return this.toDivAngleFromRadians(Math.acos(Number(value) || 0));
  }

  atanNative(value) {
    return this.toDivAngleFromRadians(Math.atan(Number(value) || 0));
  }

  atan2Native(y, x) {
    return this.toDivAngleFromRadians(Math.atan2(Number(y) || 0, Number(x) || 0));
  }

  sqrtNative(value) {
    return Math.sqrt(Math.max(0, Number(value) || 0));
  }

  powNative(base, exp) {
    return Math.pow(Number(base) || 0, Number(exp) || 0);
  }

  floorNative(value) {
    return Math.floor(Number(value) || 0);
  }

  ceilNative(value) {
    return Math.ceil(Number(value) || 0);
  }

  roundNative(value) {
    return Math.round(Number(value) || 0);
  }

  normalizeAngleNative(angle) {
    const fullTurn = 360000;
    let a = Number(angle) || 0;
    a %= fullTurn;
    if (a < 0) {
      a += fullTurn;
    }
    return a;
  }

  signNative(value) {
    const v = Number(value) || 0;
    if (v > 0) return 1;
    if (v < 0) return -1;
    return 0;
  }

  distanceNative(x1, y1, x2, y2) {
    const dx = (Number(x2) || 0) - (Number(x1) || 0);
    const dy = (Number(y2) || 0) - (Number(y1) || 0);
    return Math.hypot(dx, dy);
  }

  distanceRectNative(px, py, rx, ry, rw, rh) {
    const x = Number(px) || 0;
    const y = Number(py) || 0;
    const rectX = Number(rx) || 0;
    const rectY = Number(ry) || 0;
    const rectW = Math.max(0, Number(rw) || 0);
    const rectH = Math.max(0, Number(rh) || 0);
    const dx = Math.max(rectX - x, 0, x - (rectX + rectW));
    const dy = Math.max(rectY - y, 0, y - (rectY + rectH));
    return Math.hypot(dx, dy);
  }

  fgetAngleNative(x1, y1, x2, y2) {
    const dx = (Number(x2) || 0) - (Number(x1) || 0);
    const dy = (Number(y2) || 0) - (Number(y1) || 0);
    return this.toDivAngleFromRadians(Math.atan2(dy, dx));
  }

  fgetDistanceNative(x1, y1, x2, y2) {
    return this.distanceNative(x1, y1, x2, y2);
  }

  // GET_ANGLE(id) / GET_DIST(id): angle/distance from the CURRENT
  // process to another process's position. DIV manual: "get_angle(id2)
  // would be equivalent to fget_angle(x, y, id2.x, id2.y)" - x,y being
  // the caller's own position.
  getAngleNative(processId) {
    const self = this.vm?.currentProcess;
    const other = this.vm?.processManager?.get(Number(processId) || 0);
    if (!self || !other) return 0;
    return this.fgetAngleNative(self.x, self.y, other.x, other.y);
  }

  getDistNative(processId) {
    const self = this.vm?.currentProcess;
    const other = this.vm?.processManager?.get(Number(processId) || 0);
    if (!self || !other) return 0;
    return this.fgetDistanceNative(self.x, self.y, other.x, other.y);
  }

  getScanCodeNative() {
    return this._scanCode || 0;
  }

  // GET_ID(type) - DIV manual: "checks to see if there are any
  // processes of the specified type. If any are found, ... returns the
  // identifier code of the first occurrence... If there are more
  // processes of the specified type, ... will return the next
  // identifier code for each successive call [without a FRAME in
  // between]... get_id(0) [is] the div_main identifier."
  //
  // A very common idiom this is missing entirely broke badly: scripts
  // use "NOT get_id(TYPE x)" as an existence check ("is there no
  // process of type x right now?"). An unregistered native silently
  // returns 0 every time, so "NOT get_id(...)" was always true - firing
  // logic that's meant to run once (a turn switch, spawning the next
  // process in a sequence) on *every single tick* instead. Confirmed
  // exactly this in pool.prg's turn-switch/spawn-next-cue check.
  //
  // The iteration cursor (successive calls without an intervening FRAME
  // advance through every match) resets whenever the calling process or
  // the queried type changes from the immediately preceding call, OR a
  // real engine tick has passed since (this._frameGeneration, bumped
  // once per beginFrame() - approximates "resets... until the next
  // FRAME statement", since every process's own FRAME happens at most
  // once per real tick). Without the generation check, the overwhelmingly
  // common "call get_id(TYPE x) once per tick from the same process" idiom
  // (an existence check, not an iteration) would advance the cursor every
  // tick and start returning 0 forever after the first call, which is
  // exactly backwards.
  getIdNative(typeCode) {
    const type = Number(typeCode) || 0;
    if (type === 0) {
      return this.vm?.mainProcess?.id || 0;
    }
    const callerId = this.vm?.currentProcess?.id ?? 'main';
    const generation = this._frameGeneration || 0;
    const cursor = this._getIdCursor;
    if (!cursor || cursor.callerId !== callerId || cursor.type !== type || cursor.generation !== generation) {
      this._getIdCursor = { callerId, type, generation, index: 0 };
    }
    const ids = this.vm?.processManager ? [...(this.vm.processManager.byType.get(type) || [])] : [];
    if (this._getIdCursor.index >= ids.length) {
      return 0;
    }
    const id = ids[this._getIdCursor.index];
    this._getIdCursor.index += 1;
    return id || 0;
  }

  hermiteNative(fromValue, toValue, t) {
    const a = Number(fromValue) || 0;
    const b = Number(toValue) || 0;
    const u = this.clampNative(Number(t) || 0, 0, 1);
    const h = u * u * (3 - 2 * u);
    return a + (b - a) * h;
  }

  getDistXNative(distance, angle) {
    const dist = Number(distance) || 0;
    const rad = this.toRadiansFromDivAngle(angle);
    return Math.cos(rad) * dist;
  }

  getDistYNative(distance, angle) {
    const dist = Number(distance) || 0;
    const rad = this.toRadiansFromDivAngle(angle);
    return Math.sin(rad) * dist;
  }

  toRadNative(angle) {
    return this.toRadiansFromDivAngle(angle);
  }

  toDegNative(radians) {
    return this.toDivAngleFromRadians(radians);
  }

  pingPongNative(t, length) {
    const l = Math.abs(Number(length) || 0);
    if (l <= 1e-9) {
      return 0;
    }

    const period = l * 2;
    let x = Number(t) || 0;
    x %= period;
    if (x < 0) {
      x += period;
    }

    return x <= l ? x : (period - x);
  }

  wrapNative(value, min, max) {
    const v = Number(value) || 0;
    let lo = Number(min) || 0;
    let hi = Number(max) || 0;

    if (lo === hi) {
      return lo;
    }
    if (lo > hi) {
      const tmp = lo;
      lo = hi;
      hi = tmp;
    }

    const range = hi - lo;
    let out = (v - lo) % range;
    if (out < 0) {
      out += range;
    }
    return lo + out;
  }

  lerpAngleNative(fromAngle, toAngle, t) {
    const from = Number(fromAngle) || 0;
    const to = Number(toAngle) || 0;
    const factor = Number(t) || 0;
    const fullTurn = 360000;
    const halfTurn = fullTurn / 2;

    let delta = (to - from) % fullTurn;
    if (delta < -halfTurn) {
      delta += fullTurn;
    } else if (delta > halfTurn) {
      delta -= fullTurn;
    }

    return from + delta * factor;
  }

  clampNative(value, min, max) {
    const v = Number(value) || 0;
    let lo = Number(min) || 0;
    let hi = Number(max) || 0;
    if (lo > hi) {
      const tmp = lo;
      lo = hi;
      hi = tmp;
    }
    return Math.max(lo, Math.min(hi, v));
  }

  lerpNative(fromValue, toValue, t) {
    const a = Number(fromValue) || 0;
    const b = Number(toValue) || 0;
    const factor = Number(t) || 0;
    return a + (b - a) * factor;
  }

  smoothStepNative(min, max, value) {
    const lo = Number(min) || 0;
    const hi = Number(max) || 0;
    const v = Number(value) || 0;
    if (Math.abs(hi - lo) <= 1e-9) {
      return 0;
    }
    const t = this.clampNative((v - lo) / (hi - lo), 0, 1);
    return t * t * (3 - 2 * t);
  }

  randSeedNative(seed) {
    if (seed === undefined || seed === null) {
      this.randomSeed = null;
      return 0;
    }

    this.randomSeed = (Number(seed) >>> 0);
    return 1;
  }

  randNative(min, max) {
    const hasMax = max !== undefined;
    const lo = hasMax ? Number(min) || 0 : 0;
    const hi = hasMax ? Number(max) || 0 : Number(min) || 0;
    const low = Math.min(lo, hi);
    const high = Math.max(lo, hi);

    // DIV-style integer random in [low, high].
    const value = low + Math.floor(this.nextRandom01() * (high - low + 1));
    return value;
  }

  randomNative(min, max) {
    return this.randNative(min, max);
  }

  getProcessLocalSlot(process, localName) {
    if (!this.vm?.processTable || !process) {
      return null;
    }

    const info = this.vm.processTable.get(process.name);
    if (!info) {
      return null;
    }

    // O compiler publica todos os slots (fixos, params, privates e locals
    // implícitos) em processTable.locals para cada processo compilado - ver
    // compileProcess() em compiler/compiler.js. Não há caminho de código em
    // que um processo válido chegue aqui sem essa entrada, por isso não
    // existe fallback: uma tabela em falta ou incompleta é um bug do
    // compiler, não algo para o runtime tentar adivinhar.
    if (info.locals && Object.prototype.hasOwnProperty.call(info.locals, localName)) {
      return info.locals[localName];
    }

    return null;
  }

  getCurrentProcessAngle() {
    const process = this.vm?.currentProcess;
    if (!process) {
      return 0;
    }

    const angleSlot = this.getProcessLocalSlot(process, 'angle');
    if (angleSlot !== null && angleSlot !== undefined) {
      return Number(process.locals[angleSlot] ?? 0) || 0;
    }

    return Number(process.angle ?? 0) || 0;
  }

  moveCurrentProcess(distance, angleDiv) {
    const process = this.vm?.currentProcess;
    if (!process) {
      return 0;
    }

    const dist = Number(distance) || 0;
    const rad = this.toRadiansFromDivAngle(angleDiv);
    const dx = Math.cos(rad) * dist;
    const dy = Math.sin(rad) * dist;

    process.locals[0] = (Number(process.locals[0]) || 0) + dx;
    process.locals[1] = (Number(process.locals[1]) || 0) + dy;
    process.x = process.locals[0];
    process.y = process.locals[1];

    return 0;
  }

  advanceNative(distance, explicitAngle) {
    const angle = explicitAngle !== undefined ? Number(explicitAngle) || 0 : this.getCurrentProcessAngle();
    return this.moveCurrentProcess(distance, angle);
  }

  xadvanceNative(distance, angle) {
    // Previously tried to auto-detect argument order - xadvance(distance,
    // angle) vs xadvance(angle, distance) - by guessing that whichever
    // argument has magnitude > 180000 "must be" the distance, since a
    // DIV angle "shouldn't" exceed 180000 (180.000°). That assumption is
    // wrong: toRadiansFromDivAngle() never wraps or clamps its input, and
    // this engine's own shipped demo (index.html: "angle_step = angle_step
    // + 3000;", unbounded, cycling naturally through trig's own
    // periodicity) confirms angles routinely span the full 0-360000
    // convention, not just 0-180000. Any legitimate angle between 180001
    // and 360000 (180°-360° - the entire back half of a full turn) would
    // silently get misclassified as "must be the distance", producing a
    // wildly wrong movement in both magnitude and direction. There's no
    // magnitude threshold that can fix this: on-screen distances
    // routinely reach into the hundreds or low thousands (screen width/
    // height, a scrolled level's extent), which overlaps the legitimate
    // angle range too broadly for guessing to ever be reliable. Fixed
    // argument order - matching advanceNative(distance, angle) exactly -
    // instead of guessing.
    return this.moveCurrentProcess(distance, angle);
  }

  xputNative() {
    const [fileId, graphId, x, y, angle, size, flags, region] = arguments;
    const graph = this.ensureGraph(fileId, graphId);
    this.drawCommands.push({
      type: 'xput',
      fileId: Number(fileId) || 0,
      graphId: Number(graphId) || 0,
      x: Number(x) || 0,
      y: Number(y) || 0,
      angle: Number(angle) || 0,
      size: Number(size) || 100,
      flags: Number(flags) || 0,
      region: Number(region) || 0,
      color: this.currentColor,
      ctype: this.getCurrentCType()
    });

    // Real DIV's xput (f.c's _xput) draws straight into copia2, the same
    // persistent buffer put_screen fills - so scenery placed with xput
    // must stay visible to get_pixel() from here on, not vanish after
    // this frame's drawCommands render like every other draw call does.
    // (Doesn't honor the `region` clip for this persistent copy - xput's
    // region argument is a rare case and clipping only the transient
    // per-frame draw is enough for that.)
    const sceneryCtx = this.ensureSceneryBuffer();
    if (sceneryCtx) {
      const prevCtx = this.ctx;
      this.ctx = sceneryCtx;
      this.drawGraphSprite(
        Number(fileId) || 0,
        Number(graphId) || 0,
        Number(x) || 0,
        Number(y) || 0,
        Number(angle) || 0,
        Number(size) || 100,
        Number(size) || 100,
        Number(flags) || 0,
        graph.width,
        graph.height
      );
      this.ctx = prevCtx;
    }

    return 1;
  }

  setPointNative(fileId, graphId, pointIndex, x, y) {
    const graph = this.ensureGraph(fileId, graphId);
    graph.setPoint(pointIndex, x, y);
    this.pointsVersion++; // invalidate cached pivots (getProcessPivot)
    return 1;
  }

  // Real DIV: GET_POINT(file, graph, point, axis) returns a scalar
  // (axis 0 = x, 1 = y), not a {x,y} object - a script calling get_point()
  // directly (rather than through the get_point_x/_y convenience natives
  // below) needs a number it can actually do arithmetic with.
  getPointNative(fileId, graphId, pointIndex, axis) {
    const graph = this.ensureGraph(fileId, graphId);
    const point = graph.getPoint(pointIndex);
    return Number(axis) === 1 ? point.y : point.x;
  }

  isMirrorX(flags) {
    const f = Number(flags) || 0;
    return f === 1 || f === 3 || f === 5 || f === 7;
  }

  isMirrorY(flags) {
    const f = Number(flags) || 0;
    return f === 2 || f === 3 || f === 6 || f === 7;
  }

  computeRealPoint(fileId, graphId, pointIndex, x, y, angle, size, flags, scaleXPct, scaleYPct) {
    const graph = this.ensureGraph(fileId, graphId);
    const pivot = graph.getPoint(0);
    const point = graph.getPoint(pointIndex);

    // Match drawProcessAt/drawGraphSprite: `size` scales both axes
    // uniformly, scale_x/scale_y stretch each axis independently on top
    // of it. scaleXPct/scaleYPct default to `size` itself so callers that
    // don't pass them (or a process that never touches scale_x/scale_y)
    // still get the plain uniform-size behavior.
    const sizePct = Number(size) || 100;
    const scaleX = (scaleXPct !== undefined ? Number(scaleXPct) || 0 : sizePct) / 100;
    const scaleY = (scaleYPct !== undefined ? Number(scaleYPct) || 0 : sizePct) / 100;
    let dx = (point.x - pivot.x) * scaleX;
    let dy = (point.y - pivot.y) * scaleY;

    if (this.isMirrorX(flags)) {
      dx = -dx;
    }
    if (this.isMirrorY(flags)) {
      dy = -dy;
    }

    const rad = this.toRadiansFromDivAngle(angle);
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    return {
      x: (Number(x) || 0) + (dx * cos - dy * sin),
      y: (Number(y) || 0) + (dx * sin + dy * cos)
    };
  }

  getCurrentGraphId() {
    const process = this.vm?.currentProcess;
    if (!process) {
      return 0;
    }

    const graphSlot = this.getProcessLocalSlot(process, 'graph');
    if (graphSlot !== null && graphSlot !== undefined) {
      return Number(process.locals[graphSlot] ?? 0) || 0;
    }

    return Number(process.graph ?? 0) || 0;
  }

  getCurrentProcessLocalValue(localName, fallbackValue) {
    const process = this.vm?.currentProcess;
    if (!process) {
      return fallbackValue;
    }

    const slot = this.getProcessLocalSlot(process, localName);
    if (slot !== null && slot !== undefined) {
      const value = Number(process.locals[slot]);
      if (Number.isFinite(value)) {
        return value;
      }
    }

    return fallbackValue;
  }

  getRealPointNative(...args) {
    // Supported signatures:
    // get_real_point(pointIndex)
    // get_real_point(fileId, graphId, pointIndex)
    const process = this.vm?.currentProcess;
    const argc = args.length;

    let fileId = 0;
    let graphId = this.getCurrentGraphId();
    let pointIndex = 0;

    if (argc >= 3) {
      fileId = Number(args[0]) || 0;
      graphId = Number(args[1]) || 0;
      pointIndex = Number(args[2]) || 0;
    } else if (argc >= 1) {
      pointIndex = Number(args[0]) || 0;
    }

    const x = Number(process?.locals?.[0] ?? 0) || 0;
    const y = Number(process?.locals?.[1] ?? 0) || 0;
    const angle = this.getCurrentProcessAngle();
    const size = this.getCurrentProcessLocalValue('size', 100);
    const flags = this.getCurrentProcessLocalValue('flags', 0);
    const scaleX = process ? this.getProcessLocalNumberAliased(process, ['scale_x', 'scalex'], 100) : 100;
    const scaleY = process ? this.getProcessLocalNumberAliased(process, ['scale_y', 'scaley'], 100) : 100;
    const scaleXPct = size * (scaleX / 100);
    const scaleYPct = size * (scaleY / 100);

    return this.computeRealPoint(fileId, graphId, pointIndex, x, y, angle, size, flags, scaleXPct, scaleYPct);
  }

  getRealPointXNative(...args) {
    return this.getRealPointNative(...args).x;
  }

  getRealPointYNative(...args) {
    return this.getRealPointNative(...args).y;
  }

  defineRegionNative(id, x, y, width, height) {
    const rid = Number(id) || 0;
    this.state.region[rid] = {
      x: Number(x) || 0,
      y: Number(y) || 0,
      width: Number(width) || this.width,
      height: Number(height) || this.height
    };
    return rid;
  }

  startScrollNative(index, fileId, graphId, backId, regionId, flags) {
    const idx = Number(index) || 0;
    const entry = this.ensureScrollEntry(idx);
    entry.active = 1;
    entry.fileId = Number(fileId) || 0;
    entry.graphId = Number(graphId) || 0;
    entry.backId = Number(backId) || 0;
    entry.region = Number(regionId) || 0;
    entry.flags = Number(flags) || 0;
    if (entry.alpha === undefined) {
      entry.alpha = 100;
    }
    return idx;
  }

  stopScrollNative(index) {
    const idx = Number(index) || 0;
    const entry = this.ensureScrollEntry(idx);
    entry.active = 0;
    return 0;
  }

  getCurrentProcessBounds() {
    const process = this.vm?.currentProcess;
    if (!process) {
      return null;
    }

    // Read through RESOLUTION (slot 14) so these are screen coordinates.
    const resRaw = Number(process.locals?.[14] ?? process.resolution ?? 0) || 0;
    const res = resRaw > 0 ? resRaw : 1;
    const cx = (Number(process.locals?.[0] ?? process.x ?? 0) || 0) / res;
    const cy = (Number(process.locals?.[1] ?? process.y ?? 0) || 0) / res;
    const width = Number(process.locals?.[2] ?? process.width ?? 0) || 0;
    const height = Number(process.locals?.[3] ?? process.height ?? 0) || 0;

    // process x/y is the center (see getCenter in process.js) - return the
    // derived top-left rect, which is what callers here (out_of_region/
    // out_of_screen) actually compare against.
    return { x: cx - width * 0.5, y: cy - height * 0.5, width, height };
  }

  outOfRegionNative(regionId = 0) {
    const bounds = this.getCurrentProcessBounds();
    if (!bounds) {
      return 0;
    }

    const region = this.getRegionRect(regionId);
    const right = region.x + region.width;
    const bottom = region.y + region.height;
    const processRight = bounds.x + bounds.width;
    const processBottom = bounds.y + bounds.height;

    const isOutside =
      bounds.x < region.x ||
      bounds.y < region.y ||
      processRight > right ||
      processBottom > bottom;

    return isOutside ? 1 : 0;
  }

  outOfScreenNative() {
    return this.outOfRegionNative(0);
  }

  // DIV's OUT_REGION(processId, regionId) - differs from out_of_region
  // above in two ways: it names the process explicitly (rather than
  // always using the current one), and it's true only once the graphic
  // is *completely* outside the region, not merely touching the edge.
  // tutor1b relies on both: "WHILE (NOT out_region(id,0))" keeps a shot
  // alive until it has fully left the screen.
  outRegionNative(processId, regionId = 0) {
    const process = this.vm?.processManager?.get(Number(processId) || 0)
      || this.vm?.currentProcess;
    if (!process) {
      return 0;
    }

    const width = Number(process.width) || 0;
    const height = Number(process.height) || 0;
    // process.x/y is the center (see getCenter in process.js), in the
    // process's own RESOLUTION units.
    const res = typeof process.getResolution === 'function' ? process.getResolution() : 1;
    const left = (Number(process.x) || 0) / res - width * 0.5;
    const top = (Number(process.y) || 0) / res - height * 0.5;
    const right = left + width;
    const bottom = top + height;

    const region = this.getRegionRect(regionId);
    const isFullyOutside =
      right < region.x ||
      bottom < region.y ||
      left > region.x + region.width ||
      top > region.y + region.height;

    return isFullyOutside ? 1 : 0;
  }

  // An OFFSET <global> argument compiles to a live-reference descriptor
  // (see compileOffsetOperator) instead of a snapshotted value - resolve
  // it against the VM's current globals every time the text is drawn, so
  // "WRITE_INT(..., OFFSET score)" keeps showing the up-to-date score
  // without the script redrawing it. Anything else passes straight
  // through as an ordinary value.
  isOffsetRef(value) {
    return !!value && typeof value === 'object' && value.__divOffsetGlobal === true;
  }

  resolveOffsetRef(value) {
    if (!this.isOffsetRef(value)) {
      return value;
    }
    const raw = this.vm?.globals?.get(value.slot);
    return raw === undefined ? 0 : raw;
  }

  writeNative(font, x, y, align, text) {
    const isOffset = this.isOffsetRef(text);
    const id = this.nextTextId++;
    this.drawCommands.push({
      type: 'text',
      id,
      // Every WRITE text persists until DELETE_TEXT removes it - that is
      // what DIV does (f.c's write/delete_text), not just the
      // OFFSET-backed ones. Marking only OFFSET texts persistent meant a
      // plain write() drawn once from MAIN showed for a single frame and
      // then vanished, e.g. tutor5's "Use mouse to move snake."
      persistent: true,
      x: Number(x),
      y: Number(y),
      // Keep the descriptor itself when it's an OFFSET, so the draw pass
      // re-resolves it; plain values are stringified once here as before.
      text: isOffset ? text : String(text),
      color: this.currentColor,
      ctype: this.getCurrentCType(),
      fontId: Number(font) || 0,
      align: Number(align) || 0
    });
    return id;
  }

  // DIV's MOVE_TEXT(id, x, y) - repositions a text created by
  // WRITE/WRITE_INT in place, same id write() itself returned. Used a
  // lot for sliding-in menus/credits (a REPEAT loop nudging x/y and
  // calling FRAME each step).
  moveTextNative(textId, x, y) {
    const id = Number(textId) || 0;
    const cmd = this.drawCommands.find((c) => c.type === 'text' && c.id === id);
    if (!cmd) return 0;
    cmd.x = Number(x) || 0;
    cmd.y = Number(y) || 0;
    return 1;
  }

  // DIV's DELETE_TEXT(id) - removes a text created by WRITE/WRITE_INT.
  // id 0 clears all of them, matching DIV's "delete_text(0)" idiom.
  deleteTextNative(textId) {
    const id = Number(textId) || 0;
    this.drawCommands = this.drawCommands.filter((cmd) => {
      if (cmd.type !== 'text') {
        return true;
      }
      return id !== 0 && cmd.id !== id;
    });
    return 0;
  }

  writeIntNative(font, x, y, align, value) {
    if (this.isOffsetRef(value)) {
      // Defer to draw time, but remember it should render as an integer.
      return this.writeNative(font, x, y, align, { ...value, asInt: true });
    }
    return this.writeNative(font, x, y, align, Math.floor(Number(value) || 0));
  }

  clearNative() {
    this.drawCommands.length = 0;
    return 0;
  }

  // Engine-internal scroll position (not exposed as script native).
  setScrollPosition(x, y) {
    this.cameraX = Number(x) || 0;
    this.cameraY = Number(y) || 0;
  }

  getCurrentCType() {
    return this.vm?.currentProcess?.ctype ?? CType.C_SCREEN;
  }

  circleNative(x, y, radius) {
    this.drawCommands.push({
      type: 'circle',
      x: Number(x),
      y: Number(y),
      r: Math.max(0, Number(radius)),
      color: this.currentColor,
      ctype: this.getCurrentCType()
    });
    return 0;
  }

  textNative(x, y, text) {
    this.drawCommands.push({
      type: 'text',
      x: Number(x),
      y: Number(y),
      text: String(text),
      color: this.currentColor,
      ctype: this.getCurrentCType()
    });
    return 0;
  }

  rectNative(x, y, width, height, color) {
    this.drawCommands.push({
      type: 'rect',
      x: Number(x),
      y: Number(y),
      width: Number(width),
      height: Number(height),
      color: color !== undefined ? String(color) : this.currentColor,
      ctype: this.getCurrentCType()
    });
    return 0;
  }

  logNative(...values) {
    this.logFn(`[log] ${values.map((v) => String(v)).join(' ')}`);
    return 0;
  }

  printNative(...values) {
    this.logFn(`[print] ${values.map((v) => String(v)).join(' ')}`);
    return 0;
  }

  collisionNative(typeCode) {
    if (!this.vm?.currentProcess) return 0;
    const code = Number(typeCode);
    if (this.mouseProcess && code === this.mouseProcess.type) {
      return this.collideWithMouse(this.vm.currentProcess);
    }
    return this.vm.processManager.collision(this.vm.currentProcess, code);
  }

  // collision(TYPE mouse) is a special case in DIV, not an ordinary
  // process-vs-process test (src/shared/run/c.c):
  //
  //   if (bloque==0) { // collision(type mouse)
  //     if (mouse->x>=clipx0 && mouse->x<=clipx1 && ...)
  //       if (*(buffer + ...)) return(id); else return(0);
  //
  // The cursor is a *point*, tested against the calling process's own
  // pixel rectangle. That rectangle is inclusive of clipx1 = x0+width-1,
  // so neighbouring sprites never share a pixel. Modelling it as two
  // overlapping boxes made adjacent board squares both claim the pixel on
  // their shared edge, so every click toggled twice and undid itself.
  collideWithMouse(process) {
    const graph = this.getProcessGraphInfo(process);
    if (graph.graphId <= 0) {
      return 0; // no graphic, nothing to hit
    }

    const res = typeof process.getResolution === 'function' ? process.getResolution() : 1;
    const pivot = this.getProcessPivot(process) || { x: 0, y: 0 };
    const left = process.x / res - (Number(pivot.x) || 0);
    const top = process.y / res - (Number(pivot.y) || 0);
    // Use the graphic's own size, not process.width/height: those only
    // get adjusted the first time the process is drawn
    // (syncProcessSizeToGraph), so a process tested before its first
    // render would be measured with the constructor's 32x32 default.
    const runtimeGraph = this.ensureGraph(graph.fileId, graph.graphId);
    const width = Number(runtimeGraph?.width) || Number(process.width) || 0;
    const height = Number(runtimeGraph?.height) || Number(process.height) || 0;

    const mx = this._mouse.x;
    const my = this._mouse.y;
    // Half-open on the far edge: pixel `left+width` belongs to the next
    // sprite, matching DIV's inclusive [x0, x0+width-1].
    if (mx < left || mx >= left + width || my < top || my >= top + height) {
      return 0;
    }
    return this.mouseProcess ? this.mouseProcess.id : 0;
  }

  collisionCircleNative(typeCode) {
    if (!this.vm?.currentProcess) return 0;
    return this.vm.processManager.collisionCircle(this.vm.currentProcess, Number(typeCode));
  }

  collisionOBBNative(typeCode) {
    if (!this.vm?.currentProcess) return 0;
    return this.vm.processManager.collisionOBB(this.vm.currentProcess, Number(typeCode));
  }

  collisionPointNative(px, py, typeCode) {
    return this.vm.processManager.collisionPoint(Number(px), Number(py), Number(typeCode));
  }

  setCollisionShapeNative(shape) {
    const p = this.vm?.currentProcess;
    if (!p) return 0;
    const s = String(shape ?? '').toLowerCase();
    p.collisionShape = (s === 'circle' || s === '1') ? 'circle' : 'box';
    return p.collisionShape === 'circle' ? 1 : 0;
  }

  getCollisionShapeNative() {
    const p = this.vm?.currentProcess;
    if (!p) return 0;
    return p.collisionShape === 'circle' ? 1 : 0;
  }

  clearCollisionBoxesNative() {
    const p = this.vm?.currentProcess;
    if (!p) return 0;
    p.cboxes = [];
    return 0;
  }

  addCollisionBoxNative(x, y, width, height, code = -1) {
    const p = this.vm?.currentProcess;
    if (!p) return 0;
    if (!Array.isArray(p.cboxes)) p.cboxes = [];
    const c = {
      shape: 'box',
      x: Number(x) || 0,
      y: Number(y) || 0,
      width: Math.max(1, Number(width) || 1),
      height: Math.max(1, Number(height) || 1),
      code: Number.isFinite(Number(code)) ? Math.trunc(Number(code)) : -1
    };
    p.cboxes.push(c);
    return p.cboxes.length;
  }

  addCollisionCircleNative(x, y, radius, code = -1) {
    const p = this.vm?.currentProcess;
    if (!p) return 0;
    if (!Array.isArray(p.cboxes)) p.cboxes = [];
    const c = {
      shape: 'circle',
      x: Number(x) || 0,
      y: Number(y) || 0,
      radius: Math.max(1, Number(radius) || 1),
      code: Number.isFinite(Number(code)) ? Math.trunc(Number(code)) : -1
    };
    p.cboxes.push(c);
    return p.cboxes.length;
  }

  getPenetrationXNative() {
    return Number(this.vm?.processManager?.lastPenetrationX) || 0;
  }

  getPenetrationYNative() {
    return Number(this.vm?.processManager?.lastPenetrationY) || 0;
  }

  getColliderCBoxNative() {
    return Number(this.vm?.processManager?.lastColliderCBox) || -1;
  }

  getCollidedCBoxNative() {
    return Number(this.vm?.processManager?.lastCollidedCBox) || -1;
  }

  setCollisionRadiusNative(radius) {
    const p = this.vm?.currentProcess;
    if (!p) return 0;
    const r = Number(radius);
    p.collisionRadius = Number.isFinite(r) && r > 0 ? r : 0;
    return p.collisionRadius;
  }

  getCollisionRadiusNative() {
    const p = this.vm?.currentProcess;
    if (!p) return 0;
    return Number(p.collisionRadius) || 0;
  }

  setCollisionScaleNative(scale) {
    const p = this.vm?.currentProcess;
    if (!p) return 1;
    const s = Number(scale);
    p.collisionScale = Number.isFinite(s) && s > 0 ? s : 1;
    return p.collisionScale;
  }

  getCollisionScaleNative() {
    const p = this.vm?.currentProcess;
    if (!p) return 1;
    return Number(p.collisionScale) || 1;
  }

  placeMeetingNative(tx, ty, typeCode) {
    if (!this.vm?.currentProcess) return 0;
    return this.vm.processManager.placeMeeting(this.vm.currentProcess, Number(tx), Number(ty), Number(typeCode));
  }

  placeFreeNative(tx, ty, typeCode) {
    if (!this.vm?.currentProcess) return 1;
    return this.vm.processManager.placeFree(this.vm.currentProcess, Number(tx), Number(ty), Number(typeCode));
  }

  signalNative(targetOrType, signalCode) {
    const target = Number(targetOrType) || 0;
    const signal = Number(signalCode) || 0;

    const byId = this.vm.processManager.get(target);
    if (byId) {
      return this.vm.processManager.signalById(target, signal);
    }

    return this.vm.processManager.signalByType(target, signal);
  }

  letMeAloneNative() {
    if (!this.vm?.currentProcess) {
      return 0;
    }

    return this.vm.processManager.letMeAlone(this.vm.currentProcess);
  }

  // Scroll/region roots are arrays, so a numeric segment indexes them.
  // DIV also lets a script drop the index entirely - "scroll.x0" means
  // scroll[0].x0, which is how tutor5 drives the first scroll - so a
  // non-numeric segment on one of those arrays implies index 0 and is
  // re-applied to the entry it selects.
  normalizeSegment(container, segment) {
    if (Array.isArray(container)) {
      if (segment === 'front') return 0;
      if (segment === 'back') return 1;
      const n = Number(segment);
      if (Number.isInteger(n)) {
        return n;
      }
    }
    return segment;
  }

  // True when `segment` names a field rather than an index, i.e. the
  // implicit-index case described above.
  isImplicitScrollField(container, segment) {
    return Array.isArray(container) && !Number.isInteger(Number(segment));
  }

  resolveRelativeProcessRoot(rootName) {
    const process = this.vm?.currentProcess;
    if (!process) return null;
    const root = String(rootName || '').toLowerCase();

    if (root === 'father') {
      return this.vm?.processManager?.get(Number(process.parentId) || 0) || null;
    }

    if (root === 'son') {
      const children = this.vm?.processManager?.getChildrenOf(process.id) || [];
      for (const child of children) {
        if (child && !child.dead) {
          return child;
        }
      }
      return null;
    }

    return null;
  }

  getProcessFieldValue(process, fieldName) {
    if (!process) return 0;
    const key = String(fieldName || '');
    const lower = key.toLowerCase();

    if (Object.prototype.hasOwnProperty.call(VM.CANONICAL_SLOT_INDICES, lower)) {
      const slot = VM.CANONICAL_SLOT_INDICES[lower];
      const value = Number(process.locals?.[slot]);
      if (Number.isFinite(value)) {
        return value;
      }
    }

    const slot = this.getProcessLocalSlot(process, key);
    if (slot !== null && slot !== undefined) {
      const value = process.locals?.[slot];
      if (value !== undefined) {
        return value;
      }
    }

    if (process[key] !== undefined) {
      return process[key];
    }

    if (process.privates && process.privates[key] !== undefined) {
      return process.privates[key];
    }

    return 0;
  }

  setProcessFieldValue(process, fieldName, value) {
    if (!process) return 0;
    const key = String(fieldName || '');
    const lower = key.toLowerCase();

    if (Object.prototype.hasOwnProperty.call(VM.CANONICAL_SLOT_INDICES, lower)) {
      const slot = VM.CANONICAL_SLOT_INDICES[lower];
      process.locals[slot] = value;
      // Mirror STORE_LOCAL's dirty-flag notification (vm.js) - without
      // this, writes that go through this path (e.g. "son.priority = ...",
      // "child.z = ..." via __set_process_field/__set_path rather than a
      // plain STORE_LOCAL) silently fail to affect the scheduler's run
      // order or the cached Z-sorted draw list.
      const processManager = this.vm?.processManager;
      if (processManager) {
        if (slot === 15) {
          processManager.markPriorityDirty();
        } else if (slot === 13 && value) {
          processManager.notePriorityUse();
        }
      }
      process.sync();
      return value;
    }

    const slot = this.getProcessLocalSlot(process, key);
    if (slot !== null && slot !== undefined) {
      process.locals[slot] = value;
      return value;
    }

    process[key] = value;
    if (process.privates) {
      process.privates[key] = value;
    }
    return value;
  }

  // DIV cross-process field access: "raquet1.y" where raquet1 holds a
  // process id returned by a spawn. Emitted by compilePathGet/PathSet
  // when the root is a declared scalar (see isProcessRefRoot) - the
  // generic __get_path/__set_path can't cover it because they key off
  // the root's *name*, while here the root's runtime *value* names the
  // process. A dead/unknown id reads as 0 and ignores writes, matching
  // how the rest of the runtime treats missing processes.
  getProcessFieldNative(processId, fieldName) {
    const process = this.vm?.processManager?.get(Number(processId) || 0);
    if (!process) {
      return 0;
    }
    return this.getProcessFieldValue(process, fieldName);
  }

  setProcessFieldNative(processId, fieldName, value) {
    const process = this.vm?.processManager?.get(Number(processId) || 0);
    if (!process) {
      return 0;
    }
    return this.setProcessFieldValue(process, fieldName, value);
  }

  ensureScrollEntry(index) {
    if (!this.state.scroll[index]) {
      this.state.scroll[index] = {
        camera: 0,
        alpha: 100,
        active: 0,
        region: 0,
        flags: 0,
        // DIV's scroll variables: x0/y0 is the foreground plane's
        // position, x1/y1 the background plane's. A script may drive them
        // directly (tutor5) or let a camera process drive x0/y0 and have
        // x1/y1 derived from `ratio` (fenix g_scroll.c: gr_scroll_draw).
        x0: 0,
        y0: 0,
        x1: 0,
        y1: 0,
        ratio: 0,
        speed: 0,
        z: 512
      };
    }
    return this.state.scroll[index];
  }

  getPathNative(...args) {
    if (args.length === 0) {
      return 0;
    }

    const [rootName, ...segments] = args;
    const root = String(rootName);

    const relativeProcess = this.resolveRelativeProcessRoot(root);
    if (relativeProcess || root.toLowerCase() === 'father' || root.toLowerCase() === 'son') {
      if (!relativeProcess) {
        return 0;
      }
      if (segments.length === 0) {
        return relativeProcess.id || 0;
      }
      const first = segments[0];
      if (typeof first !== 'string') {
        return 0;
      }
      return this.getProcessFieldValue(relativeProcess, first);
    }

    let current = this.state[root];
    if (current === undefined) {
      return 0;
    }

    for (const rawSegment of segments) {
      // "scroll.x0" with no index: select entry 0 and read the field off it.
      if (String(rootName) === 'scroll' && this.isImplicitScrollField(current, rawSegment)) {
        current = this.ensureScrollEntry(0);
      }
      const segment = this.normalizeSegment(current, rawSegment);
      if (Array.isArray(current) && Number.isInteger(segment)) {
        if (String(rootName) === 'scroll') {
          current = this.ensureScrollEntry(segment);
        } else {
          current = current[segment];
        }
      } else {
        current = current?.[segment];
      }

      if (current === undefined || current === null) {
        return 0;
      }
    }

    if (typeof current === 'number' || typeof current === 'string' || typeof current === 'boolean') {
      return current;
    }

    return current ?? 0;
  }

  setPathNative(...args) {
    if (args.length < 2) {
      return 0;
    }

    const rootName = String(args[0]);
    const value = args[args.length - 1];
    const segments = args.slice(1, -1);

    const relativeProcess = this.resolveRelativeProcessRoot(rootName);
    if (relativeProcess || rootName.toLowerCase() === 'father' || rootName.toLowerCase() === 'son') {
      if (!relativeProcess) {
        return 0;
      }
      if (segments.length !== 1 || typeof segments[0] !== 'string') {
        return 0;
      }
      return this.setProcessFieldValue(relativeProcess, segments[0], value);
    }

    if (this.state[rootName] === undefined) {
      this.state[rootName] = rootName === 'scroll' ? [] : {};
    }

    if (segments.length === 0) {
      this.state[rootName] = value;
      return value;
    }

    let current = this.state[rootName];
    // "scroll.x0 = n" with no index targets entry 0 - same shorthand the
    // read path handles (see getPathNative).
    if (rootName === 'scroll' && this.isImplicitScrollField(current, segments[0])) {
      current = this.ensureScrollEntry(0);
    }
    for (let i = 0; i < segments.length - 1; i++) {
      const segment = this.normalizeSegment(current, segments[i]);
      if (Array.isArray(current) && Number.isInteger(segment)) {
        if (rootName === 'scroll') {
          current = this.ensureScrollEntry(segment);
        } else {
          if (current[segment] === undefined || current[segment] === null) {
            current[segment] = {};
          }
          current = current[segment];
        }
      } else {
        if (current[segment] === undefined || current[segment] === null) {
          current[segment] = {};
        }
        current = current[segment];
      }
    }

    const finalSegment = this.normalizeSegment(current, segments[segments.length - 1]);
    current[finalSegment] = value;
    return value;
  }

  _gridKey(gx, gy) {
    return `${gx},${gy}`;
  }

  _octileDistance(ax, ay, bx, by) {
    const dx = Math.abs(ax - bx);
    const dy = Math.abs(ay - by);
    const minD = Math.min(dx, dy);
    const maxD = Math.max(dx, dy);
    return minD * 14 + (maxD - minD) * 10;
  }

  _manhattanDistance(ax, ay, bx, by) {
    return (Math.abs(ax - bx) + Math.abs(ay - by)) * 10;
  }

  _nodeBlocked(gx, gy, cellSize, obstacleTypeCode) {
    if (!obstacleTypeCode) return false;
    // Whole-cell rectangle, not just its center point - a single-point
    // sample let the path clip a wall's corner or squeeze through a gap
    // that's actually solid whenever the pathfinding grid's cell size
    // doesn't line up exactly with the wall's own size/position.
    const minX = gx * cellSize;
    const minY = gy * cellSize;
    const hit = this.vm?.processManager?.rectOverlapsType(
      minX, minX + cellSize, minY, minY + cellSize, obstacleTypeCode
    ) || 0;
    return hit > 0;
  }

  _buildPathPoints(cameFrom, endKey, startX, startY, endX, endY, cellSize) {
    const chain = [];
    let cursor = endKey;
    while (cursor) {
      const [gxRaw, gyRaw] = String(cursor).split(',');
      const gx = Number(gxRaw);
      const gy = Number(gyRaw);
      chain.push({
        x: gx * cellSize + Math.floor(cellSize * 0.5),
        y: gy * cellSize + Math.floor(cellSize * 0.5)
      });
      cursor = cameFrom.get(cursor);
    }
    chain.reverse();

    if (chain.length === 0) {
      return [];
    }

    chain[0].x = Math.round(startX);
    chain[0].y = Math.round(startY);
    chain[chain.length - 1].x = Math.round(endX);
    chain[chain.length - 1].y = Math.round(endY);
    return chain;
  }

  pathFindNative(startX, startY, endX, endY, obstacleTypeCode = 0, cellSize = 16, allowDiagonal = 1, maxNodes = 4096) {
    const size = Math.max(4, Math.floor(Number(cellSize) || 16));
    const allowDiag = Number(allowDiagonal) !== 0;
    const maxVisited = Math.max(64, Math.floor(Number(maxNodes) || 4096));
    const ox = Number(startX) || 0;
    const oy = Number(startY) || 0;
    const tx = Number(endX) || 0;
    const ty = Number(endY) || 0;
    const obstacleType = Math.trunc(Number(obstacleTypeCode) || 0);

    const sx = Math.floor(ox / size);
    const sy = Math.floor(oy / size);
    const ex = Math.floor(tx / size);
    const ey = Math.floor(ty / size);

    const startKey = this._gridKey(sx, sy);
    const endKey = this._gridKey(ex, ey);
    if (startKey === endKey) {
      const id = this.nextPathId++;
      this.paths.set(id, [{ x: Math.round(ox), y: Math.round(oy) }, { x: Math.round(tx), y: Math.round(ty) }]);
      return id;
    }

    const margin = 64;
    const minX = Math.min(sx, ex) - margin;
    const maxX = Math.max(sx, ex) + margin;
    const minY = Math.min(sy, ey) - margin;
    const maxY = Math.max(sy, ey) + margin;

    const neighbors = allowDiag
      ? [
        [1, 0, 10], [-1, 0, 10], [0, 1, 10], [0, -1, 10],
        [1, 1, 14], [1, -1, 14], [-1, 1, 14], [-1, -1, 14]
      ]
      : [
        [1, 0, 10], [-1, 0, 10], [0, 1, 10], [0, -1, 10]
      ];

    const heuristic = allowDiag
      ? this._octileDistance.bind(this)
      : this._manhattanDistance.bind(this);

    // Binary min-heap keyed on f-score, instead of a plain array scanned
    // linearly for its minimum every pop (O(m) per pop, O(m^2) overall
    // for a search that visits m nodes - the default maxNodes of 4096
    // could mean tens of millions of comparisons for one path_find()
    // call). No decrease-key: when a shorter path to an already-queued
    // node is found below, a fresh heap entry is pushed for it rather
    // than updating the old one in place: the stale entry is simply
    // skipped when it's eventually popped (staleness detected via
    // gScore, since its g no longer matches the best known cost for that
    // key - the closed-set check alone isn't enough once entries for the
    // same key can now coexist in the heap).
    const open = new MinHeap();
    open.push({ key: startKey, x: sx, y: sy, g: 0, priority: heuristic(sx, sy, ex, ey) });
    const closed = new Set();
    const cameFrom = new Map();
    const gScore = new Map([[startKey, 0]]);

    let visited = 0;

    while (open.size > 0 && visited < maxVisited) {
      const current = open.pop();
      if (closed.has(current.key)) continue;
      if (current.g > gScore.get(current.key)) continue; // stale entry, superseded below
      closed.add(current.key);
      visited += 1;

      if (current.key === endKey) {
        const points = this._buildPathPoints(cameFrom, current.key, ox, oy, tx, ty, size);
        if (points.length === 0) return 0;
        const id = this.nextPathId++;
        this.paths.set(id, points);
        return id;
      }

      for (const [dx, dy, stepCost] of neighbors) {
        const nx = current.x + dx;
        const ny = current.y + dy;
        if (nx < minX || nx > maxX || ny < minY || ny > maxY) continue;

        const nKey = this._gridKey(nx, ny);
        if (closed.has(nKey)) continue;

        if (nKey !== endKey && this._nodeBlocked(nx, ny, size, obstacleType)) {
          continue;
        }

        const tentativeG = current.g + stepCost;
        const bestKnown = gScore.get(nKey);
        if (bestKnown !== undefined && tentativeG >= bestKnown) {
          continue;
        }

        cameFrom.set(nKey, current.key);
        gScore.set(nKey, tentativeG);
        const f = tentativeG + heuristic(nx, ny, ex, ey);
        open.push({ key: nKey, x: nx, y: ny, g: tentativeG, priority: f });
      }
    }

    return 0;
  }

  pathLengthNative(pathId) {
    const id = Math.trunc(Number(pathId) || 0);
    const path = this.paths.get(id);
    return Array.isArray(path) ? path.length : 0;
  }

  pathGetXNative(pathId, index) {
    const id = Math.trunc(Number(pathId) || 0);
    const i = Math.trunc(Number(index) || 0);
    const path = this.paths.get(id);
    if (!Array.isArray(path) || i < 0 || i >= path.length) return 0;
    return Number(path[i].x) || 0;
  }

  pathGetYNative(pathId, index) {
    const id = Math.trunc(Number(pathId) || 0);
    const i = Math.trunc(Number(index) || 0);
    const path = this.paths.get(id);
    if (!Array.isArray(path) || i < 0 || i >= path.length) return 0;
    return Number(path[i].y) || 0;
  }

  pathClearNative(pathId) {
    const id = Math.trunc(Number(pathId) || 0);
    if (!id) return 0;
    if (!this.paths.delete(id)) return 0;
    for (const [processId, state] of this.pathFollowers.entries()) {
      if (state?.pathId === id) {
        this.pathFollowers.delete(processId);
      }
    }
    return 1;
  }

  pathAssignNative(pathId, startIndex = 1) {
    const process = this.vm?.currentProcess;
    if (!process) return 0;

    const id = Math.trunc(Number(pathId) || 0);
    const path = this.paths.get(id);
    if (!Array.isArray(path) || path.length === 0) {
      this.pathFollowers.delete(process.id);
      return 0;
    }

    const idx = Math.max(0, Math.min(path.length - 1, Math.trunc(Number(startIndex) || 0)));
    this.pathFollowers.set(process.id, { pathId: id, index: idx });
    return 1;
  }

  pathStopNative() {
    const process = this.vm?.currentProcess;
    if (!process) return 0;
    return this.pathFollowers.delete(process.id) ? 1 : 0;
  }

  pathIndexNative() {
    const process = this.vm?.currentProcess;
    if (!process) return 0;
    const state = this.pathFollowers.get(process.id);
    return Number(state?.index) || 0;
  }

  pathStepNative(speedPerSecond = 120, arriveRadius = 2) {
    const process = this.vm?.currentProcess;
    if (!process) return 0;

    const state = this.pathFollowers.get(process.id);
    if (!state) return 0;

    const path = this.paths.get(state.pathId);
    if (!Array.isArray(path) || path.length === 0) {
      this.pathFollowers.delete(process.id);
      return 0;
    }

    if (state.index >= path.length) {
      return 2;
    }

    const dt = Math.max(0, Number(this.vm?.dt) || 0);
    let remaining = Math.max(0, Number(speedPerSecond) || 0) * dt;
    if (remaining <= 0) {
      return 1;
    }

    const radius = Math.max(0, Number(arriveRadius) || 0);

    while (remaining > 0 && state.index < path.length) {
      const target = path[state.index];
      // process.x/y is already the center (see getCenter in process.js).
      const cx = Number(process.x) || 0;
      const cy = Number(process.y) || 0;
      const dx = (Number(target.x) || 0) - cx;
      const dy = (Number(target.y) || 0) - cy;
      const dist = Math.hypot(dx, dy);

      if (dist <= radius) {
        state.index += 1;
        continue;
      }

      const move = Math.min(remaining, dist);
      const nx = dist > 1e-9 ? dx / dist : 1;
      const ny = dist > 1e-9 ? dy / dist : 0;

      const nextX = (Number(process.x) || 0) + nx * move;
      const nextY = (Number(process.y) || 0) + ny * move;
      process.x = nextX;
      process.y = nextY;
      process.locals[0] = nextX;
      process.locals[1] = nextY;

      const facing = this.toDivAngleFromRadians(Math.atan2(dy, dx));
      process.angle = facing;
      process.locals[7] = facing;

      remaining -= move;
      if (move >= dist - 1e-9) {
        state.index += 1;
      } else {
        break;
      }
    }

    if (state.index >= path.length) {
      return 2;
    }

    return 1;
  }

  loadGraphicNative(src, sx, sy, sw, sh) {
    if (!src) {
      return 0;
    }

    if (sx !== undefined) {
      return Graphics.load(String(src), Number(sx) || 0, Number(sy) || 0, Number(sw) || 0, Number(sh) || 0);
    }

    return Graphics.load(String(src));
  }

  loadTileNative(src, sx, sy, sw, sh) {
    return this.loadGraphicNative(src, sx, sy, sw, sh);
  }

  reserveGraphLibrary() {
    const id = this.nextGraphLibraryId++;
    this.graphLibraries.set(id, {
      id,
      loaded: false,
      error: null,
      graphs: new Map()
    });
    return id;
  }

  loadMapNative(src) {
    if (!src) {
      return 0;
    }

    // Return a direct graph id, same shape as load_graphic/load_tile.
    const graphId = Graphics.create(1, 1);
    const url = String(src);

    const promise = loadDivMapFromUrl(url)
      .then((map) => {
        Graphics.setCanvas(graphId, map.canvas);
        const graph = this.ensureGraph(0, graphId, map.width, map.height);
        applyCpointsToGraph(graph, map.cpoints);
      })
      .catch((error) => {
        this.logFn(`[warn] load_map failed (${url}): ${error?.message || String(error)}`);
      });
    this.pendingLoads.push(promise);

    return graphId;
  }

  loadFpgNative(src) {
    if (!src) {
      return 0;
    }

    const libraryId = this.reserveGraphLibrary();
    const entry = this.graphLibraries.get(libraryId);
    const url = String(src);

    const promise = loadDivFpgFromUrl(url)
      .then((fpg) => {
        const count = fpg.maps.length;
        this.logFn(`[fpg] loaded ${url}: ${count} graph${count === 1 ? '' : 's'}`);
        for (const map of fpg.maps) {
          const code = Number(map.code) || 0;
          this.logFn(`  [fpg] graph ${code}: ${map.width}x${map.height}`);
          const assetId = Graphics.addCanvas(map.canvas);
          entry.graphs.set(code, assetId);
          const graph = this.ensureGraph(libraryId, code, map.width, map.height);
          applyCpointsToGraph(graph, map.cpoints);
        }
        entry.loaded = true;
      })
      .catch((error) => {
        entry.error = error?.message || String(error);
        this.logFn(`[warn] load_fpg failed (${url}): ${entry.error}`);
      });
    this.pendingLoads.push(promise);

    return libraryId;
  }

  loadFntNative(src) {
    if (!src) {
      return 0;
    }

    const id = this.reserveBitmapFont();
    const entry = this.bitmapFonts.get(id);
    const url = String(src);

    const promise = loadDivFntFromUrl(url)
      .then((fnt) => {
        entry.font = {
          kind: 'div_fnt',
          glyphs: fnt.glyphs,
          lineHeight: fnt.lineHeight,
          fallbackAdvance: fnt.fallbackAdvance
        };
        entry.loaded = true;
      })
      .catch((error) => {
        entry.error = error?.message || String(error);
        this.logFn(`[warn] load_fnt failed (${url}): ${entry.error}`);
      });
    this.pendingLoads.push(promise);

    return id;
  }

  reserveBitmapFont() {
    const id = this.nextBitmapFontId++;
    this.bitmapFonts.set(id, {
      id,
      loaded: false,
      error: null,
      font: null
    });
    return id;
  }

  loadBdfFontTextNative(text) {
    if (!text) {
      return 0;
    }

    const id = this.reserveBitmapFont();
    const entry = this.bitmapFonts.get(id);
    try {
      entry.font = parseBennuBdfFont(String(text));
      entry.loaded = true;
    } catch (error) {
      entry.error = error?.message || String(error);
      this.logFn(`[warn] load_bdf_font_text failed: ${entry.error}`);
    }
    return id;
  }

  loadBdfFontNative(src) {
    if (!src) {
      return 0;
    }

    const id = this.reserveBitmapFont();
    const entry = this.bitmapFonts.get(id);
    const url = String(src);

    const promise = fetch(url)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        return response.text();
      })
      .then((text) => {
        entry.font = parseBennuBdfFont(text);
        entry.loaded = true;
      })
      .catch((error) => {
        entry.error = error?.message || String(error);
        this.logFn(`[warn] load_bdf_font failed (${url}): ${entry.error}`);
      });
    this.pendingLoads.push(promise);

    return id;
  }

  // ── DIV's built-in system font (its FONT 0) ────────────────────────
  //
  // The real 6x8 table from the original runtime, so WRITE output is
  // pixel-identical to DIV. Glyphs are built into a tinted atlas once per
  // colour: drawing them as hard pixels matters because a 320x200 canvas
  // is usually scaled up, and anything antialiased turns to mush.
  systemFontAtlas(color) {
    if (!this._systemFontAtlases) {
      this._systemFontAtlases = new Map();
    }
    const key = String(color || '#ffffff');
    const cached = this._systemFontAtlases.get(key);
    if (cached) {
      return cached;
    }

    const w = FONT_6X8_WIDTH;
    const h = FONT_6X8_HEIGHT;
    const canvas = document.createElement('canvas');
    canvas.width = w * 256;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = key;
    for (let code = 0; code < 256; code++) {
      const ox = code * w;
      for (let row = 0; row < h; row++) {
        for (let col = 0; col < w; col++) {
          if (font6x8Pixel(code, col, row)) {
            ctx.fillRect(ox + col, row, 1, 1);
          }
        }
      }
    }

    this._systemFontAtlases.set(key, canvas);
    return canvas;
  }

  // Align follows renderDivFontText: 1/4 centre, 2 right-align.
  drawSystemText(x, y, align, text, color) {
    const w = FONT_6X8_WIDTH;
    const h = FONT_6X8_HEIGHT;
    const atlas = this.systemFontAtlas(color);
    const str = String(text);

    let penX = Math.round(Number(x) || 0);
    const penY = Math.round(Number(y) || 0);
    const width = str.length * w;
    if (align === 1 || align === 4) {
      penX -= Math.round(width * 0.5);
    } else if (align === 2) {
      penX -= width;
    }

    for (let i = 0; i < str.length; i++) {
      const code = str.charCodeAt(i) & 0xFF;
      this.ctx.drawImage(atlas, code * w, 0, w, h, penX, penY, w, h);
      penX += w;
    }
    return str.length;
  }

  drawBitmapText(fontId, x, y, align, text) {
    const entry = this.bitmapFonts.get(Number(fontId) || 0);
    if (!entry || !entry.loaded || !entry.font) {
      return false;
    }

    const str = String(text);
    const font = entry.font;
    const lines = str.split('\n');
    const lineWidths = lines.map((line) => {
      let w = 0;
      for (let i = 0; i < line.length; i++) {
        const glyph = font.glyphs[line.charCodeAt(i) & 0xff];
        w += glyph ? (glyph.xadvance || glyph.width || font.fallbackAdvance) : font.fallbackAdvance;
      }
      return w;
    });

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const line = lines[lineIndex];
      const lineWidth = lineWidths[lineIndex] || 0;
      let penX = Number(x) || 0;
      const penY = (Number(y) || 0) + lineIndex * font.lineHeight;

      // DIV align convention is broader; support common 0/1/2 values here.
      if (align === 1) penX -= Math.round(lineWidth * 0.5);
      else if (align === 2) penX -= lineWidth;

      for (let i = 0; i < line.length; i++) {
        const code = line.charCodeAt(i) & 0xff;
        const glyph = font.glyphs[code];
        if (!glyph) {
          penX += font.fallbackAdvance;
          continue;
        }

        const baseX = penX + (glyph.xoffset || 0);
        const baseY = penY + (glyph.yoffset || 0);

        if (glyph.canvas) {
          this.ctx.drawImage(glyph.canvas, baseX, baseY);
          penX += glyph.xadvance || glyph.width || font.fallbackAdvance;
          continue;
        }

        if (!glyph.bitmap) {
          penX += font.fallbackAdvance;
          continue;
        }

        for (let gy = 0; gy < glyph.height; gy++) {
          for (let gx = 0; gx < glyph.width; gx++) {
            if (!glyph.bitmap[gy * glyph.width + gx]) {
              continue;
            }
            this.ctx.fillRect(baseX + gx, baseY + gy, 1, 1);
          }
        }

        penX += glyph.xadvance || glyph.width || font.fallbackAdvance;
      }
    }

    return true;
  }

  registerNatives() {
    // Let ProcessManager.isCollidable() resolve a process's current GRAPH
    // (a dynamically-allocated local slot only this side can look up), so
    // a process with no graphic isn't hittable - see the comment on
    // isCollidable in process.js.
    if (this.vm?.processManager) {
      this.vm.processManager.graphIdOf = (process) => this.getProcessGraphRef(process).graphId;

      // DIV exposes the mouse as a process: it has GRAPH/FILE/SIZE/... and
      // takes part in collisions, which is how tutor6 detects the cursor
      // over a board square with "collision(TYPE mouse)". Backing it with
      // a real Process makes the renderer and the collision code treat it
      // like any other, for free. It has no compiled body, so it is never
      // scheduled - updateMouseProcess() moves it each frame instead.
      this.mouseProcess = this.vm.processManager.create('mouse', {});
      this.mouseProcess.isMouse = true;
      this.mouseProcess.hasCompletedFrame = true;
      this.mouseProcess.graph = 0;
      this.mouseProcess.file = 0;
    }

    // Let collision use the same anchor the renderer does: control point
    // 0 of the process's current graphic (the geometric center unless the
    // FPG says otherwise). See getCenter in process.js.
    setPivotResolver((process) => this.getProcessPivot(process));

    this.vm.registerNative('key_down', this.keyDownNative.bind(this));
    this.vm.registerNative('key_pressed', this.keyPressedNative.bind(this));
    this.vm.registerNative('key', this.keyNative.bind(this));
    this.vm.registerNative('get_time', () => this.totalTime);
    this.vm.registerNative('get_delta', () => this.vm.dt);
    this.vm.registerNative('set_title', this.setTitleNative.bind(this));
    this.vm.registerNative('set_mode', this.setModeNative.bind(this));
    this.vm.registerNative('screen_color', this.screenColorNative.bind(this));
    this.vm.registerNative('put_screen', this.putScreenNative.bind(this));
    this.vm.registerNative('get_pixel', this.getPixelNative.bind(this));
    this.vm.registerNative('set_debug', this.setDebugNative.bind(this));
    this.vm.registerNative('__get_mouse_field', this.getMouseFieldNative.bind(this));
    this.vm.registerNative('__set_mouse_field', this.setMouseFieldNative.bind(this));
    // DIV's EXIT(message, code) ends the program. There is no process to
    // return to in a browser, so log the message and halt the VM.
    this.vm.registerNative('exit', (message, code) => {
      if (message !== undefined && message !== null && String(message).length > 0) {
        this.logFn(`[exit] ${String(message)}`);
      }
      if (this.vm) {
        this.vm.halted = true;
        this.vm.mainFinished = true;
      }
      return Number(code) || 0;
    });
    this.vm.registerNative('set_fps', this.setFpsNative.bind(this));
    this.vm.registerNative('get_fps', this.getFpsNative.bind(this));
    this.vm.registerNative('get_process_count', this.getProcessCountNative.bind(this));
    this.vm.registerNative('abs', this.absNative.bind(this));
    this.vm.registerNative('sin', this.sinNative.bind(this));
    this.vm.registerNative('cos', this.cosNative.bind(this));
    this.vm.registerNative('tan', this.tanNative.bind(this));
    this.vm.registerNative('asin', this.asinNative.bind(this));
    this.vm.registerNative('acos', this.acosNative.bind(this));
    this.vm.registerNative('atan', this.atanNative.bind(this));
    this.vm.registerNative('atan2', this.atan2Native.bind(this));
    this.vm.registerNative('sqrt', this.sqrtNative.bind(this));
    this.vm.registerNative('srt', this.sqrtNative.bind(this));
    this.vm.registerNative('pow', this.powNative.bind(this));
    this.vm.registerNative('floor', this.floorNative.bind(this));
    this.vm.registerNative('ceil', this.ceilNative.bind(this));
    this.vm.registerNative('round', this.roundNative.bind(this));
    // Truncation toward zero, matching a cast to DIV's 32-bit int - handy
    // for making a fractional intermediate behave like DIV arithmetic.
    this.vm.registerNative('int', (value) => Math.trunc(Number(value) || 0));
    this.vm.registerNative('ping_pong', this.pingPongNative.bind(this));
    this.vm.registerNative('wrap', this.wrapNative.bind(this));
    this.vm.registerNative('lerp_angle', this.lerpAngleNative.bind(this));
    this.vm.registerNative('clamp', this.clampNative.bind(this));
    this.vm.registerNative('lerp', this.lerpNative.bind(this));
    this.vm.registerNative('smoothstep', this.smoothStepNative.bind(this));
    this.vm.registerNative('normalize_angle', this.normalizeAngleNative.bind(this));
    this.vm.registerNative('sign', this.signNative.bind(this));
    this.vm.registerNative('distance', this.distanceNative.bind(this));
    this.vm.registerNative('distance_rect', this.distanceRectNative.bind(this));
    this.vm.registerNative('fget_angle', this.fgetAngleNative.bind(this));
    this.vm.registerNative('fget_distance', this.fgetDistanceNative.bind(this));
    // DIV's actual native name (f.c's fname[] table) - alias to the
    // same implementation already registered as fget_distance above.
    this.vm.registerNative('fget_dist', this.fgetDistanceNative.bind(this));
    this.vm.registerNative('get_angle', this.getAngleNative.bind(this));
    this.vm.registerNative('get_dist', this.getDistNative.bind(this));
    this.vm.registerNative('get_scan_code', this.getScanCodeNative.bind(this));
    this.vm.registerNative('get_id', this.getIdNative.bind(this));
    this.vm.registerNative('hermite', this.hermiteNative.bind(this));
    this.vm.registerNative('get_distx', this.getDistXNative.bind(this));
    this.vm.registerNative('get_disty', this.getDistYNative.bind(this));
    this.vm.registerNative('torad', this.toRadNative.bind(this));
    this.vm.registerNative('todeg', this.toDegNative.bind(this));
    this.vm.registerNative('rand_seed', this.randSeedNative.bind(this));
    this.vm.registerNative('rand', this.randNative.bind(this));
    this.vm.registerNative('random', this.randomNative.bind(this));
    this.vm.registerNative('advance', this.advanceNative.bind(this));
    this.vm.registerNative('xadvance', this.xadvanceNative.bind(this));
    this.vm.registerNative('xput', this.xputNative.bind(this));
    this.vm.registerNative('set_point', this.setPointNative.bind(this));
    this.vm.registerNative('get_point', this.getPointNative.bind(this));
    this.vm.registerNative('get_point_x', (fileId, graphId, pointIndex) => this.getPointNative(fileId, graphId, pointIndex, 0));
    this.vm.registerNative('get_point_y', (fileId, graphId, pointIndex) => this.getPointNative(fileId, graphId, pointIndex, 1));
    this.vm.registerNative('get_real_point', this.getRealPointNative.bind(this));
    this.vm.registerNative('get_real_point_x', this.getRealPointXNative.bind(this));
    this.vm.registerNative('get_real_point_y', this.getRealPointYNative.bind(this));
    this.vm.registerNative('define_region', this.defineRegionNative.bind(this));
    this.vm.registerNative('start_scroll', this.startScrollNative.bind(this));
    this.vm.registerNative('stop_scroll', this.stopScrollNative.bind(this));
    this.vm.registerNative('out_of_region', this.outOfRegionNative.bind(this));
    this.vm.registerNative('exit_region', this.outOfRegionNative.bind(this));
    this.vm.registerNative('out_region', this.outRegionNative.bind(this));
    this.vm.registerNative('out_of_screen', this.outOfScreenNative.bind(this));
    this.vm.registerNative('exit_screen', this.outOfScreenNative.bind(this));
    this.vm.registerNative('write', this.writeNative.bind(this));
    this.vm.registerNative('write_int', this.writeIntNative.bind(this));
    this.vm.registerNative('delete_text', this.deleteTextNative.bind(this));
    this.vm.registerNative('set_color', this.setColorNative.bind(this));
    this.vm.registerNative('set_colro', this.setColorNative.bind(this));
    this.vm.registerNative('clear', this.clearNative.bind(this));
    this.vm.registerNative('circle', this.circleNative.bind(this));
    this.vm.registerNative('text', this.textNative.bind(this));
    this.vm.registerNative('draw_rect', this.rectNative.bind(this));
    this.vm.registerNative('log', this.logNative.bind(this));
    this.vm.registerNative('print', this.printNative.bind(this));
    this.vm.registerNative('collision', this.collisionNative.bind(this));
    this.vm.registerNative('collision_circle', this.collisionCircleNative.bind(this));
    this.vm.registerNative('collision_obb', this.collisionOBBNative.bind(this));
    this.vm.registerNative('collision_point', this.collisionPointNative.bind(this));
    this.vm.registerNative('set_collision_shape', this.setCollisionShapeNative.bind(this));
    this.vm.registerNative('get_collision_shape', this.getCollisionShapeNative.bind(this));
    this.vm.registerNative('clear_collision_boxes', this.clearCollisionBoxesNative.bind(this));
    this.vm.registerNative('add_collision_box', this.addCollisionBoxNative.bind(this));
    this.vm.registerNative('add_collision_circle', this.addCollisionCircleNative.bind(this));
    this.vm.registerNative('set_collision_radius', this.setCollisionRadiusNative.bind(this));
    this.vm.registerNative('get_collision_radius', this.getCollisionRadiusNative.bind(this));
    this.vm.registerNative('set_collision_scale', this.setCollisionScaleNative.bind(this));
    this.vm.registerNative('get_collision_scale', this.getCollisionScaleNative.bind(this));
    this.vm.registerNative('penetration_x', this.getPenetrationXNative.bind(this));
    this.vm.registerNative('penetration_y', this.getPenetrationYNative.bind(this));
    this.vm.registerNative('collider_cbox', this.getColliderCBoxNative.bind(this));
    this.vm.registerNative('collided_cbox', this.getCollidedCBoxNative.bind(this));
    this.vm.registerNative('place_meeting', this.placeMeetingNative.bind(this));
    this.vm.registerNative('place_free', this.placeFreeNative.bind(this));
    this.vm.registerNative('signal', this.signalNative.bind(this));
    this.vm.registerNative('let_me_alone', this.letMeAloneNative.bind(this));
    this.vm.registerNative('load_graphic', this.loadGraphicNative.bind(this));
    this.vm.registerNative('load_tile', this.loadTileNative.bind(this));
    this.vm.registerNative('load_map', this.loadMapNative.bind(this));
    this.vm.registerNative('load_fpg', this.loadFpgNative.bind(this));
    this.vm.registerNative('load_fnt', this.loadFntNative.bind(this));
    this.vm.registerNative('move_text', this.moveTextNative.bind(this));
    // Dummy no-ops: real DIV natives with no implementation here yet.
    // Registered so calling them is silent (returns 0) instead of
    // spamming "Native function not found" - covers the actual usage
    // seen porting coins.prg/pool.prg. sound is entirely unimplemented
    // (no audio subsystem at all yet); load_pal/unload_fpg are no-ops
    // because there's no separate palette/library-unload state to
    // apply them to; map_get_pixel needs a palette-index pixel read on
    // an arbitrary loaded graphic (see the pending get_pixel palette-
    // index item) - real DIV games' collision-by-color-map logic (e.g.
    // coins.prg's check_position) silently does nothing until that
    // lands, same as it did unregistered.
    this.vm.registerNative('load_pcm', () => 0);
    this.vm.registerNative('sound', () => 0);
    this.vm.registerNative('change_sound', () => 0);
    this.vm.registerNative('stop_sound', () => 0);
    this.vm.registerNative('load_pal', () => 0);
    this.vm.registerNative('unload_fpg', () => 0);
    this.vm.registerNative('unload_pcm', () => 0);
    this.vm.registerNative('unload_map', () => 0);
    this.vm.registerNative('map_get_pixel', () => 0);
    this.vm.registerNative('load_bdf_font', this.loadBdfFontNative.bind(this));
    this.vm.registerNative('load_bdf_font_text', this.loadBdfFontTextNative.bind(this));
    this.vm.registerNative('__get_path', this.getPathNative.bind(this));
    this.vm.registerNative('__set_path', this.setPathNative.bind(this));
    this.vm.registerNative('__get_process_field', this.getProcessFieldNative.bind(this));
    this.vm.registerNative('__set_process_field', this.setProcessFieldNative.bind(this));
    this.vm.registerNative('path_find', this.pathFindNative.bind(this));
    this.vm.registerNative('path_length', this.pathLengthNative.bind(this));
    this.vm.registerNative('path_get_x', this.pathGetXNative.bind(this));
    this.vm.registerNative('path_get_y', this.pathGetYNative.bind(this));
    this.vm.registerNative('path_clear', this.pathClearNative.bind(this));
    this.vm.registerNative('path_assign', this.pathAssignNative.bind(this));
    this.vm.registerNative('path_step', this.pathStepNative.bind(this));
    this.vm.registerNative('path_stop', this.pathStopNative.bind(this));
    this.vm.registerNative('path_index', this.pathIndexNative.bind(this));
    // DIV's default fade speed is 8 (f.c's fade_on/fade_off).
    this.vm.registerNative('fade_off', (speed) => { this._fadeStart(0, 0, 0, Number(speed) || 8, 1); return 0; });
    this.vm.registerNative('fade_on', (speed) => { this._fadeStart(0, 0, 0, Number(speed) || 8, 0); return 0; });
    // FADE(r,g,b,speed): r/g/b are 0-100 intensity percentages, where 100
    // is the normal palette and 0 is black - DIV computes
    // dacout = 64 - r*64/100, i.e. the darkening is the inverse of the
    // requested intensity. Our overlay is a single alpha, so the three
    // channels are averaged.
    this.vm.registerNative('fade', (r, g, b, speed) => {
      const avg = ((Number(r) || 0) + (Number(g) || 0) + (Number(b) || 0)) / 3;
      const intensity = Math.max(0, Math.min(100, avg));
      this._fadeStart(0, 0, 0, Number(speed) || 8, 1 - intensity / 100);
      return 0;
    });
    this.vm.registerNative('is_fading', () => this._fade.active ? 1 : 0);
    this.vm.registerNative('new_graphic', this.newGraphicNative.bind(this));
    this.vm.registerNative('gfx_fill', this.gfxFillNative.bind(this));
    this.vm.registerNative('gfx_fill_rgba', this.gfxFillRGBANative.bind(this));
    this.vm.registerNative('gfx_pixel', this.gfxPixelNative.bind(this));
    this.vm.registerNative('gfx_line', this.gfxLineNative.bind(this));
    this.vm.registerNative('gfx_rect', this.gfxRectNative.bind(this));
    this.vm.registerNative('gfx_rect_outline', this.gfxRectOutlineNative.bind(this));
    this.vm.registerNative('gfx_circle', this.gfxCircleNative.bind(this));
    this.vm.registerNative('gfx_circle_outline', this.gfxCircleOutlineNative.bind(this));
    this.vm.registerNative('gfx_text', this.gfxTextNative.bind(this));
    this.vm.registerNative('free_graphic', (id) => { Graphics.remove(Number(id)); return 0; });
    this.vm.registerNative('mouse_x', () => this._mouse.x);
    this.vm.registerNative('mouse_y', () => this._mouse.y);
    this.vm.registerNative('mouse_button', (b) => this._mouse.buttons[Number(b) || 0] ? 1 : 0);
  }

  // target: 1 = fade to opaque (fade out), 0 = fade to transparent (fade in)
  _fadeStart(r, g, b, speed, target) {
    const f = this._fade;
    f.r = Math.max(0, Math.min(255, Math.round(r)));
    f.g = Math.max(0, Math.min(255, Math.round(g)));
    f.b = Math.max(0, Math.min(255, Math.round(b)));
    f.speed = Math.max(0.1, Math.min(64, speed));
    // Fractional targets so FADE(r,g,b,speed) can stop part-way, not just
    // fully on/off.
    f.target = Math.max(0, Math.min(1, Number(target) || 0));
    f.active = f.alpha !== f.target;
  }

  // ── Procedural graphics API ──────────────────────────────────────────────

  _gfxCtx(id) {
    const g = Graphics.get(Number(id));
    return g && g.ctx2d ? g.ctx2d : null;
  }

  _cssRGB(r, g, b) { return `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`; }
  _cssRGBA(r, g, b, a) { return `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${Math.max(0, Math.min(1, a / 100))})`; }

  newGraphicNative(w, h) { return Graphics.create(Number(w) || 1, Number(h) || 1); }

  gfxFillNative(id, r, g, b) {
    const c = this._gfxCtx(id); if (!c) return 0;
    c.fillStyle = this._cssRGB(r, g, b);
    c.fillRect(0, 0, c.canvas.width, c.canvas.height); return 0;
  }

  gfxFillRGBANative(id, r, g, b, a) {
    const c = this._gfxCtx(id); if (!c) return 0;
    c.clearRect(0, 0, c.canvas.width, c.canvas.height);
    if ((a ?? 100) > 0) { c.fillStyle = this._cssRGBA(r, g, b, a ?? 100); c.fillRect(0, 0, c.canvas.width, c.canvas.height); }
    return 0;
  }

  gfxPixelNative(id, x, y, r, g, b) {
    const c = this._gfxCtx(id); if (!c) return 0;
    c.fillStyle = this._cssRGB(r, g, b); c.fillRect(x, y, 1, 1); return 0;
  }

  gfxLineNative(id, x1, y1, x2, y2, r, g, b) {
    const c = this._gfxCtx(id); if (!c) return 0;
    c.strokeStyle = this._cssRGB(r, g, b); c.lineWidth = 1;
    c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke(); return 0;
  }

  gfxRectNative(id, x, y, w, h, r, g, b) {
    const c = this._gfxCtx(id); if (!c) return 0;
    c.fillStyle = this._cssRGB(r, g, b); c.fillRect(x, y, w, h); return 0;
  }

  gfxRectOutlineNative(id, x, y, w, h, r, g, b) {
    const c = this._gfxCtx(id); if (!c) return 0;
    c.strokeStyle = this._cssRGB(r, g, b); c.lineWidth = 1;
    c.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1); return 0;
  }

  gfxCircleNative(id, cx, cy, radius, r, g, b) {
    const c = this._gfxCtx(id); if (!c) return 0;
    c.fillStyle = this._cssRGB(r, g, b);
    c.beginPath(); c.arc(cx, cy, Math.abs(radius), 0, Math.PI * 2); c.fill(); return 0;
  }

  gfxCircleOutlineNative(id, cx, cy, radius, r, g, b) {
    const c = this._gfxCtx(id); if (!c) return 0;
    c.strokeStyle = this._cssRGB(r, g, b); c.lineWidth = 1;
    c.beginPath(); c.arc(cx, cy, Math.abs(radius), 0, Math.PI * 2); c.stroke(); return 0;
  }

  gfxTextNative(id, x, y, text, r, g, b, size) {
    const c = this._gfxCtx(id); if (!c) return 0;
    c.fillStyle = this._cssRGB(r, g, b);
    c.font = `${Math.round(size || 12)}px monospace`;
    c.textBaseline = 'top';
    c.fillText(String(text), x, y); return 0;
  }

  transformPoint(x, y, ctype) {
    if (ctype === CType.C_SCROLL) {
      return {
        x: x - this.cameraX,
        y: y - this.cameraY
      };
    }

    return { x, y };
  }

  getRegionRect(regionId) {
    const rect = this.state.region[Number(regionId) || 0];
    if (rect) {
      return rect;
    }
    return { x: 0, y: 0, width: this.width, height: this.height };
  }

  // Advances a scroll's own variables for this frame, mirroring
  // gr_scroll_draw in fenix's g_scroll.c: a camera process pulls x0/y0
  // toward centring itself in the region (limited by `speed`, 0 meaning
  // "snap"), non-wrapping planes are clamped to the graphic, and x1/y1
  // are derived from `ratio` when one is set. With no camera the script
  // owns x0/y0 directly, which is how tutor5 scrolls.
  updateScrollEntry(index) {
    const entry = this.ensureScrollEntry(index);
    const region = this.getRegionRect(entry.region);
    const camProcess = this.vm.processManager.get(Number(entry.camera) || 0);

    if (camProcess) {
      const res = typeof camProcess.getResolution === 'function' ? camProcess.getResolution() : 1;
      const cx = (Number(camProcess.x) || 0) / res - region.width * 0.5;
      const cy = (Number(camProcess.y) || 0) / res - region.height * 0.5;
      const speed = Number(entry.speed) || Number.MAX_SAFE_INTEGER;

      if (entry.x0 < cx) entry.x0 = Math.min(entry.x0 + speed, cx);
      else if (entry.x0 > cx) entry.x0 = Math.max(entry.x0 - speed, cx);
      if (entry.y0 < cy) entry.y0 = Math.min(entry.y0 + speed, cy);
      else if (entry.y0 > cy) entry.y0 = Math.max(entry.y0 - speed, cy);
    }

    // Flags 1/2 are the foreground plane's horizontal/vertical wrap bits;
    // without them the plane is clamped so it never shows past its edge.
    const flags = Number(entry.flags) || 0;
    const graphic = this.getGraphAsset(entry.fileId, entry.graphId);
    if (graphic && graphic.image) {
      const gw = Number(graphic.sw) || graphic.image.width || 0;
      const gh = Number(graphic.sh) || graphic.image.height || 0;
      if (!(flags & 1) && gw > 0) {
        entry.x0 = Math.max(0, Math.min(entry.x0, gw - region.width));
      }
      if (!(flags & 2) && gh > 0) {
        entry.y0 = Math.max(0, Math.min(entry.y0, gh - region.height));
      }
    }

    const ratio = Number(entry.ratio) || 0;
    if (ratio) {
      entry.x1 = entry.x0 * 100 / ratio;
      entry.y1 = entry.y0 * 100 / ratio;
    }

    return entry;
  }

  getScrollCamera(index) {
    const entry = this.ensureScrollEntry(index);
    return { x: Number(entry.x0) || 0, y: Number(entry.y0) || 0 };
  }

  // Tiles one plane across the region, offset by (-ox,-oy). Wrapping is
  // what makes a scroll endless; a plane whose wrap bit is off has
  // already been clamped in updateScrollEntry, so tiling it is harmless.
  drawScrollPlane(graphic, region, ox, oy) {
    if (!graphic || !graphic.image || graphic.loaded === false) {
      return;
    }
    const gw = Number(graphic.sw) || graphic.image.width || 0;
    const gh = Number(graphic.sh) || graphic.image.height || 0;
    if (gw <= 0 || gh <= 0) {
      return;
    }

    // Start at the first tile edge at or before the region's origin.
    let startX = -(((ox % gw) + gw) % gw);
    let startY = -(((oy % gh) + gh) % gh);

    for (let y = startY; y < region.height; y += gh) {
      for (let x = startX; x < region.width; x += gw) {
        const dx = region.x + x;
        const dy = region.y + y;
        if (graphic.sx !== undefined) {
          this.ctx.drawImage(graphic.image, graphic.sx, graphic.sy, gw, gh, dx, dy, gw, gh);
        } else {
          this.ctx.drawImage(graphic.image, dx, dy);
        }
      }
    }
  }

  // Draws every active scroll: background plane first (x1/y1), then the
  // foreground (x0/y0), each clipped to the scroll's region.
  drawScrolls() {
    for (let index = 0; index < this.state.scroll.length; index++) {
      const entry = this.state.scroll[index];
      if (!entry || !entry.active) {
        continue;
      }

      this.updateScrollEntry(index);
      const region = this.getRegionRect(entry.region);
      const back = this.getGraphAsset(entry.fileId, entry.backId);
      const front = this.getGraphAsset(entry.fileId, entry.graphId);

      this.withRegionClip(region, () => {
        this.drawScrollPlane(back, region, Number(entry.x1) || 0, Number(entry.y1) || 0);
        this.drawScrollPlane(front, region, Number(entry.x0) || 0, Number(entry.y0) || 0);
      });
    }
  }

  withRegionClip(region, drawFn) {
    this.ctx.save();
    this.ctx.beginPath();
    this.ctx.rect(region.x, region.y, region.width, region.height);
    this.ctx.clip();
    drawFn();
    this.ctx.restore();
  }

  getProcessLocalNumber(process, localName, fallbackValue = 0) {
    const slot = this.getProcessLocalSlot(process, localName);
    if (slot !== null && slot !== undefined) {
      const value = Number(process.locals?.[slot]);
      if (Number.isFinite(value)) {
        return value;
      }
    }
    return fallbackValue;
  }

  // Like getProcessLocalNumber, but tries each name in order and uses the
  // first one the process actually declared a local for - lets a field
  // have more than one accepted spelling (e.g. scale_x / scalex) without
  // silently summing both if a script happens to touch both names.
  getProcessLocalNumberAliased(process, names, fallbackValue = 0) {
    for (const name of names) {
      const slot = this.getProcessLocalSlot(process, name);
      if (slot !== null && slot !== undefined) {
        const value = Number(process.locals?.[slot]);
        if (Number.isFinite(value)) {
          return value;
        }
      }
    }
    return fallbackValue;
  }

  // Just the graphic identity, without the angle/size/flags/scale work
  // getProcessGraphInfo does. The collision path needs only this, and it
  // runs per candidate pair - the full version costs 9 slot lookups plus
  // an object allocation, which is far too much for a hot loop.
  getProcessGraphRef(process) {
    const graphId = this.getProcessLocalNumber(process, 'graph', Number(process.graph ?? 0) || 0);
    const fileId = this.getProcessLocalNumber(process, 'file', Number(process.file ?? 0) || 0);
    return { fileId, graphId };
  }

  // Pivot (control point 0) for a process's current graphic, memoized on
  // the process. A graphic's pivot only moves when set_point() edits it,
  // so a global version counter is enough to invalidate every cache at
  // once. Without this, every getCenter() in a collision loop re-resolved
  // the graph and re-read the point.
  getProcessPivot(process) {
    const { fileId, graphId } = this.getProcessGraphRef(process);
    if (graphId <= 0) {
      return null;
    }

    const key = `${fileId}:${graphId}`;
    if (process.__pivotKey === key && process.__pivotVersion === this.pointsVersion) {
      return process.__pivot;
    }

    const pivot = this.ensureGraph(fileId, graphId).getPoint(0);
    process.__pivotKey = key;
    process.__pivotVersion = this.pointsVersion;
    process.__pivot = pivot;
    return pivot;
  }

  getProcessGraphInfo(process) {
    const graphId = this.getProcessLocalNumber(process, 'graph', Number(process.graph ?? 0) || 0);
    const fileId = this.getProcessLocalNumber(process, 'file', Number(process.file ?? 0) || 0);
    const angle = this.getProcessLocalNumber(process, 'angle', Number(process.angle ?? 0) || 0);
    const size = this.getProcessLocalNumber(process, 'size', 100);
    const flags = this.getProcessLocalNumber(process, 'flags', Number(process.flags ?? 0) || 0);
    // scale_x/scale_y are independent per-axis multipliers on top of `size`
    // (both default to 100 = no extra stretch), for non-uniform scaling.
    // Accept both the underscored and bare spelling of each.
    const scaleX = this.getProcessLocalNumberAliased(process, ['scale_x', 'scalex'], 100);
    const scaleY = this.getProcessLocalNumberAliased(process, ['scale_y', 'scaley'], 100);
    return { fileId, graphId, angle, size, flags, scaleX, scaleY };
  }

  getGraphAsset(fileId, graphId) {
    const fid = Number(fileId) || 0;
    const gid = Number(graphId) || 0;

    // Library ids start at 0 (see reserveGraphLibrary), so file 0 can be a
    // real FPG library - try it first regardless of fid's value.
    const lib = this.graphLibraries.get(fid);
    const mapped = lib?.graphs?.get(gid);
    if (mapped !== undefined) {
      return Graphics.get(mapped) || null;
    }

    // Fallback: no library there (or no such code in it) - graphId
    // references a raw graphic asset id directly, as returned by
    // load_map/new_graphic/load_graphic (which have no library).
    return Graphics.get(gid) || null;
  }

  drawGraphSprite(fileId, graphId, x, y, angle, scaleXPct, scaleYPct, flags, baseWidth, baseHeight) {
    const graph = this.ensureGraph(fileId, graphId, baseWidth, baseHeight);
    const graphic = this.getGraphAsset(fileId, graphId);
    if (!graphic || !graphic.image || graphic.loaded === false) {
      return false;
    }

    const srcW = graphic.sx !== undefined ? Number(graphic.sw) || 0 : Number(graphic.image.naturalWidth || graphic.image.width) || 0;
    const srcH = graphic.sx !== undefined ? Number(graphic.sh) || 0 : Number(graphic.image.naturalHeight || graphic.image.height) || 0;
    if (srcW <= 0 || srcH <= 0) {
      return false;
    }

    const graphW = Number(graph.width) || srcW;
    const graphH = Number(graph.height) || srcH;
    const sxp = Number(scaleXPct);
    const syp = Number(scaleYPct);
    const scaleX = (Number.isFinite(sxp) ? sxp : 100) / 100;
    const scaleY = (Number.isFinite(syp) ? syp : 100) / 100;
    const drawW = Math.max(1, (Number(baseWidth) || graphW) * scaleX);
    const drawH = Math.max(1, (Number(baseHeight) || graphH) * scaleY);
    const pivot = graph.getPoint(0);
    const pivotX = (Number(pivot.x) || 0) * (drawW / graphW);
    const pivotY = (Number(pivot.y) || 0) * (drawH / graphH);

    this.ctx.save();
    this.ctx.translate(x, y);
    this.ctx.rotate(this.toRadiansFromDivAngle(angle));
    this.ctx.scale(this.isMirrorX(flags) ? -1 : 1, this.isMirrorY(flags) ? -1 : 1);

    if (graphic.sx !== undefined) {
      this.ctx.drawImage(
        graphic.image,
        Number(graphic.sx) || 0,
        Number(graphic.sy) || 0,
        srcW,
        srcH,
        -pivotX,
        -pivotY,
        drawW,
        drawH
      );
    } else {
      this.ctx.drawImage(graphic.image, -pivotX, -pivotY, drawW, drawH);
    }

    this.ctx.restore();
    return true;
  }

  drawGraphPlaceholder(px, py, angle, scaleXPct, scaleYPct, color) {
    const radians = (Number(angle) / 1000) * (Math.PI / 180);
    const sx = Number(scaleXPct);
    const sy = Number(scaleYPct ?? scaleXPct);
    const scaleX = (Number.isFinite(sx) ? sx : 100) / 100;
    const scaleY = (Number.isFinite(sy) ? sy : 100) / 100;
    const w = 18 * scaleX;
    const h = 10 * scaleY;

    this.ctx.save();
    this.ctx.fillStyle = color;
    this.ctx.translate(px, py);
    this.ctx.rotate(radians);
    this.ctx.beginPath();
    this.ctx.moveTo(w, 0);
    this.ctx.lineTo(-w * 0.6, -h);
    this.ctx.lineTo(-w * 0.2, 0);
    this.ctx.lineTo(-w * 0.6, h);
    this.ctx.closePath();
    this.ctx.fill();
    this.ctx.restore();
  }

  // Real DIV auto-sizes a process to its assigned graphic's native
  // dimensions the moment GRAPH/FILE is set; WIDTH/HEIGHT stay writable
  // afterward and override it. We can't cheaply detect "the script wrote
  // to width/height" directly, so we use the constructor's 32x32 generic
  // placeholder as a one-shot sentinel: sync happens only while both are
  // still exactly that untouched default, and locks out forever the
  // instant either one changes (by this sync or by the script itself).
  syncProcessSizeToGraph(process, graph) {
    if (graph.graphId <= 0 || process.width !== 32 || process.height !== 32) {
      return;
    }
    const runtimeGraph = this.ensureGraph(graph.fileId, graph.graphId);
    if (!runtimeGraph || (runtimeGraph.width === 32 && runtimeGraph.height === 32)) {
      return; // graphic not loaded yet (still the Graph class's own default)
    }
    process.width = runtimeGraph.width;
    process.height = runtimeGraph.height;
    const widthSlot = this.getProcessLocalSlot(process, 'width');
    const heightSlot = this.getProcessLocalSlot(process, 'height');
    if (widthSlot !== null && widthSlot !== undefined) process.locals[widthSlot] = process.width;
    if (heightSlot !== null && heightSlot !== undefined) process.locals[heightSlot] = process.height;
  }

  drawProcessAt(process, offsetX, offsetY) {
    const graph = this.getProcessGraphInfo(process);
    this.syncProcessSizeToGraph(process, graph);

    // process.x/y is the process's pivot/center in world space (real DIV
    // convention - matches getCenter() in process.js), not a top-left
    // corner. px/py below is only the derived top-left, kept for the
    // debug-bounds rect draw further down.
    // x/y are in the process's RESOLUTION units - divide before using
    // them as screen coordinates (DIV's RESOLUTION field; see
    // Process.getResolution). Unset/0 means 1, so nothing changes for
    // processes that never touch it.
    const res = typeof process.getResolution === 'function' ? process.getResolution() : 1;
    const centerX = process.x / res - offsetX;
    const centerY = process.y / res - offsetY;
    // Top-left of the graphic as actually drawn: x/y locate control
    // point 0, so step back by the pivot rather than by half the size
    // (identical when the pivot is the default center). Used only for
    // the debug bounds rect below, which otherwise sat half a sprite
    // away from the sprite whenever the FPG moved the pivot.
    const dbgPivot = graph.graphId > 0
      ? this.ensureGraph(graph.fileId, graph.graphId).getPoint(0)
      : null;
    const px = centerX - (dbgPivot ? Number(dbgPivot.x) || 0 : process.width * 0.5);
    const py = centerY - (dbgPivot ? Number(dbgPivot.y) || 0 : process.height * 0.5);

    const alpha = (process.alpha ?? 100) / 100;
    if (alpha <= 0) return; // invisible - skip entirely

    const r = process.red ?? 255;
    const g = process.green ?? 255;
    const b = process.blue ?? 255;
    const hasTint = r !== 255 || g !== 255 || b !== 255;

    this.ctx.save();
    if (alpha < 1) this.ctx.globalAlpha = alpha;

    // `size` scales both axes uniformly; scale_x/scale_y stretch each axis
    // independently on top of it (both default to 100 = no extra stretch).
    // SIZE 0 means "scaled to nothing", i.e. invisible - a real value, not
    // an unset field, so it must not fall back to 100. getProcessGraphInfo
    // already substitutes 100 when the field was never written, which is
    // the only case a default belongs in. tutor5's tail tapers to size 0
    // and kept a full-size tip while this used `|| 100`.
    const sizePct = Number.isFinite(graph.size) ? graph.size : 100;
    const scaleXPct = sizePct * ((graph.scaleX ?? 100) / 100);
    const scaleYPct = sizePct * ((graph.scaleY ?? 100) / 100);

    // GRAPH = 0 means "no graphic - draw nothing" in DIV, and scripts
    // rely on that as a real visibility switch, not as an error: tutor4's
    // worm_segment sets graph=0 for every segment past the current tail
    // length precisely so those segments disappear. Drawing a
    // placeholder here (as this used to) turned each of them into a
    // large arrow covering the screen. The placeholder is still useful
    // when debugging a process whose graphic genuinely failed to
    // resolve, so keep it behind the debug flag rather than deleting it.
    if (graph.graphId > 0) {
      const drewSprite = this.drawGraphSprite(
        graph.fileId, graph.graphId,
        centerX, centerY,
        graph.angle, scaleXPct, scaleYPct, graph.flags,
        process.width, process.height
      );

      if (drewSprite && hasTint) {
        this.ctx.globalCompositeOperation = 'multiply';
        this.ctx.fillStyle = `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
        const hw = process.width * 0.5 * (scaleXPct / 100);
        const hh = process.height * 0.5 * (scaleYPct / 100);
        this.ctx.fillRect(centerX - hw, centerY - hh, hw * 2, hh * 2);
        this.ctx.globalCompositeOperation = 'source-over';
      }

      if (!drewSprite && this.debugDrawProcessBounds) {
        this.drawGraphPlaceholder(centerX, centerY, graph.angle, scaleXPct, scaleYPct, `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`);
      }
    }

    this.ctx.restore();

    // Only draw debug shapes for processes that can actually be hit.
    // A process with GRAPH = 0 has no collision box (see isCollidable in
    // process.js), and scripts create plenty of them: tutor4 keeps ~120
    // spare worm segments parked at their default 0,0 until the tail
    // grows into them. Drawing those piled the whole overlay into the
    // top-left corner and made it look like every box sat at 0,0.
    if (this.debugDrawProcessBounds && graph.graphId > 0) {
      this.ctx.save();
      this.ctx.strokeStyle = this.debugProcessBoundsColor;
      this.ctx.lineWidth = 1;
      this.ctx.strokeRect(px, py, process.width, process.height);
      this.ctx.restore();
      this.drawProcessDebugOverlay(process, graph, centerX, centerY, offsetX, offsetY, scaleXPct, scaleYPct);
    }
  }

  // Debug-mode visualization: the collision shape(s) actually used by
  // collision()/place_meeting/etc (not just the plain width/height box
  // above - a process can have circle or custom cboxes instead), the
  // graphic's pivot (control point 0 - where rotation/scale/position
  // anchor, see g_blit.c's F_NCPOINTS check), and every other control
  // point defined on the graphic.
  drawProcessDebugOverlay(process, graph, centerX, centerY, offsetX, offsetY, scaleXPct, scaleYPct) {
    this.ctx.save();

    // Marker sizes are in screen pixels, but a DIV screen is typically
    // 320x200 with 8x8 sprites - fixed pixel sizes that look fine on a
    // 800x600 canvas swamp the sprite entirely at native resolution.
    // Scale the markers to the screen so they stay readable at both.
    const s = Math.max(0.35, Math.min(1, this.width / 800));
    const lineW = s;
    const pivotR = 1.6 * s;
    const pointR = 1.2 * s;
    const crossR = 3 * s;

    // Collision shape(s), in the same world space as process.x/y (see
    // getCenter() in process.js - process.x/y is already the center).
    // The two processes that actually reported a collision this frame
    // are drawn thicker and in white, so "what did I just hit?" is
    // answerable by looking rather than by guessing.
    const pm = this.vm?.processManager;
    const isCulprit = pm && (pm.lastCollisionA === process.id || pm.lastCollisionB === process.id);
    const shapes = getProcessShapes(process, process.x - offsetX, process.y - offsetY, false);
    this.ctx.strokeStyle = isCulprit ? '#ffffff' : '#ff2d95';
    this.ctx.lineWidth = isCulprit ? lineW * 2 : lineW;
    for (const shape of shapes) {
      this.ctx.beginPath();
      if (shape.shape === 'circle') {
        this.ctx.arc(shape.cx, shape.cy, shape.r, 0, Math.PI * 2);
      } else {
        const c = shape.corners;
        this.ctx.moveTo(c[0].x, c[0].y);
        for (let i = 1; i < c.length; i++) this.ctx.lineTo(c[i].x, c[i].y);
        this.ctx.closePath();
      }
      this.ctx.stroke();
    }

    // Label the culprit with its process name/id, since the two shapes
    // in a collision are usually on top of each other.
    if (isCulprit) {
      this.ctx.fillStyle = '#ffffff';
      this.ctx.font = `${Math.max(4, Math.round(7 * s))}px JetBrains Mono, Consolas, monospace`;
      this.ctx.textBaseline = 'bottom';
      this.ctx.fillText(`${process.name}#${process.id}`, centerX + 4 * s, centerY - 4 * s);
    }

    // Control points, transformed into world space exactly like
    // get_real_point does (angle/scale/mirror-aware).
    if (graph.graphId > 0) {
      const runtimeGraph = this.ensureGraph(graph.fileId, graph.graphId);
      for (const [index, point] of runtimeGraph.points) {
        const world = this.computeRealPoint(
          graph.fileId, graph.graphId, index,
          centerX, centerY, graph.angle, graph.size, graph.flags,
          scaleXPct, scaleYPct
        );
        const isPivot = index === 0;
        this.ctx.fillStyle = isPivot ? '#ffe600' : '#00ff6a';
        this.ctx.beginPath();
        this.ctx.arc(world.x, world.y, isPivot ? pivotR : pointR, 0, Math.PI * 2);
        this.ctx.fill();
        if (isPivot) {
          // Cross through the pivot so it reads distinctly from plain points.
          this.ctx.strokeStyle = '#ffe600';
          this.ctx.lineWidth = lineW;
          this.ctx.beginPath();
          this.ctx.moveTo(world.x - crossR, world.y);
          this.ctx.lineTo(world.x + crossR, world.y);
          this.ctx.moveTo(world.x, world.y - crossR);
          this.ctx.lineTo(world.x, world.y + crossR);
          this.ctx.stroke();
        }
      }
    }

    this.ctx.restore();
  }

  drawProcessesFallback() {
    const processes = this.vm.processManager.getDrawList();
    const activeScrollEntries = this.state.scroll
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) => entry && entry.active);

    for (const process of processes) {
      const ctype = process.ctype ?? CType.C_SCREEN;

      if (ctype === CType.C_SCROLL && activeScrollEntries.length > 0) {
        for (const { entry, index } of activeScrollEntries) {
          const region = this.getRegionRect(entry.region);
          const cam = this.getScrollCamera(index);
          this.withRegionClip(region, () => {
            this.drawProcessAt(process, cam.x - region.x, cam.y - region.y);
          });
        }
        continue;
      }

      this.drawProcessAt(process, 0, 0);
    }
  }

  drawCommandsToCanvas() {
    this.ctx.save();
    // DIV's built-in font (font 0) is an 8x8 bitmap at every resolution,
    // so a fixed 8px keeps WRITE output the same size as text baked into
    // a 320x200 background. The old 14px overflowed those layouts.
    this.ctx.font = '8px JetBrains Mono, Consolas, monospace';
    this.ctx.textBaseline = 'top';

    const drawXput = (cmd, px, py) => {
      const graph = this.ensureGraph(cmd.fileId, cmd.graphId);
      const drewSprite = this.drawGraphSprite(
        cmd.fileId,
        cmd.graphId,
        px,
        py,
        cmd.angle,
        cmd.size,
        cmd.size,
        cmd.flags,
        graph.width,
        graph.height
      );

      if (!drewSprite) {
        this.drawGraphPlaceholder(px, py, cmd.angle, cmd.size, cmd.size, cmd.color);
      }
    };

    for (const cmd of this.drawCommands) {
      this.ctx.fillStyle = cmd.color;
      this.ctx.strokeStyle = cmd.color;

      const drawOne = (offsetX, offsetY) => {
        const pos = {
          x: cmd.x - offsetX,
          y: cmd.y - offsetY
        };

        if (cmd.type === 'circle') {
          this.ctx.beginPath();
          this.ctx.arc(pos.x, pos.y, cmd.r, 0, Math.PI * 2);
          this.ctx.fill();
          return;
        }

        if (cmd.type === 'text') {
          // Re-resolve an OFFSET reference now, at draw time, so it shows
          // the global's current value rather than the one it had when
          // write/write_int was called.
          let text = cmd.text;
          if (this.isOffsetRef(text)) {
            const value = this.resolveOffsetRef(text);
            text = text.asInt ? String(Math.floor(Number(value) || 0)) : String(value);
          }
          const drewBitmap = cmd.fontId > 0
            ? this.drawBitmapText(cmd.fontId, pos.x, pos.y, cmd.align || 0, text)
            : false;
          if (!drewBitmap) {
            this.drawSystemText(pos.x, pos.y, cmd.align || 0, text, cmd.color);
          }
          return;
        }

        if (cmd.type === 'rect') {
          this.ctx.fillRect(pos.x, pos.y, cmd.width, cmd.height);
        }

        if (cmd.type === 'xput') {
          drawXput(cmd, pos.x, pos.y);
        }
      };

      const drawWithCommandRegion = (offsetX, offsetY) => {
        if (cmd.region && cmd.region > 0) {
          const regionRect = this.getRegionRect(cmd.region);
          this.withRegionClip(regionRect, () => drawOne(offsetX, offsetY));
          return;
        }
        drawOne(offsetX, offsetY);
      };

      if ((cmd.ctype ?? CType.C_SCREEN) === CType.C_SCROLL) {
        const activeScrollEntries = this.state.scroll
          .map((entry, index) => ({ entry, index }))
          .filter(({ entry }) => entry && entry.active);

        if (activeScrollEntries.length === 0) {
          drawWithCommandRegion(this.cameraX, this.cameraY);
          continue;
        }

        for (const { entry, index } of activeScrollEntries) {
          const region = this.getRegionRect(entry.region);
          const cam = this.getScrollCamera(index);
          this.withRegionClip(region, () => drawWithCommandRegion(cam.x - region.x, cam.y - region.y));
        }
        continue;
      }

      drawWithCommandRegion(0, 0);
    }

    this.ctx.restore();
    // Plain draw commands are per-frame (a script redraws them each
    // tick). OFFSET-backed texts are the exception: real DIV's WRITE
    // registers them once and they persist until DELETE_TEXT, which is
    // exactly why a script can call WRITE_INT(..., OFFSET score) a
    // single time in MAIN and have the score stay on screen - so keep
    // those, and drop everything else.
    this.drawCommands = this.drawCommands.filter((cmd) => cmd.persistent);
  }

  render() {
    this.ctx.fillStyle = this.clearColor;
    this.ctx.fillRect(0, 0, this.width, this.height);
    this.drawBackgroundGraph();
    this.drawScrolls();
    this.drawProcessesFallback();
    this.drawCommandsToCanvas();
    this.drawDebugStats();
    this.drawDebugLegend();
    // Reset after drawing so the highlight always reflects the collision
    // reported during the tick that produced this frame, not an old one.
    if (this.vm?.processManager) {
      this.vm.processManager.lastCollisionA = 0;
      this.vm.processManager.lastCollisionB = 0;
    }
    // Fade overlay drawn last, on top of everything
    if (this._fade.alpha > 0) {
      const f = this._fade;
      this.ctx.save();
      this.ctx.globalAlpha = f.alpha;
      this.ctx.fillStyle = `rgb(${f.r},${f.g},${f.b})`;
      this.ctx.fillRect(0, 0, this.width, this.height);
      this.ctx.restore();
    }
  }
}
