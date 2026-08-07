/**
 * DivLang Runtime
 * Native functions para a VM
 */

import { Graphics } from '../graph/graphics.js';
import { parseBennuBdfFont } from './bennu_bdf.js';
import { loadDivFpgFromUrl, loadDivFntFromUrl, loadDivMapFromUrl } from './div_formats.js';

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

// Engine runtime adapter for browser canvas hosts.
export class CanvasEngineRuntime {
  constructor(options) {
    this.vm = options.vm;
    this.ctx = options.ctx;
    this.width = options.width || this.ctx.canvas.width;
    this.height = options.height || this.ctx.canvas.height;
    this.clearColor = options.clearColor || '#0b1117';
    this.logFn = options.logFn || ((line) => console.log(line));

    this.keys = {};
    this.drawCommands = [];
    this.currentColor = '#2dd4bf';
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
    this.state = {
      scroll: [],
      region: {},
      graphs: {}
    };

    this.bitmapFonts = new Map();
    this.nextBitmapFontId = 1;
    this.graphLibraries = new Map();
    this.nextGraphLibraryId = 1;
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
      m.x = Math.round((e.clientX - r.left) * (canvas.width  / r.width));
      m.y = Math.round((e.clientY - r.top)  * (canvas.height / r.height));
    };
    canvas.addEventListener('mousemove',  e => { toCanvas(e); });
    canvas.addEventListener('mousedown',  e => { toCanvas(e); m.buttons[e.button] = true; });
    canvas.addEventListener('mouseup',    e => { toCanvas(e); m.buttons[e.button] = false; });
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

  setKeyState(key, isDown) {
    this.keys[key] = !!isDown;
  }

  clearKeyState() {
    for (const key of Object.keys(this.keys)) {
      this.keys[key] = false;
    }
  }

  beginFrame(dt) {
    this.vm.dt = dt;
    this.totalTime += dt;
    this.fpsAccumTime += dt;
    this.fpsAccumFrames += 1;

    if (this.fpsAccumTime >= 0.25) {
      this.fpsValue = this.fpsAccumFrames / this.fpsAccumTime;
      this.fpsAccumTime = 0;
      this.fpsAccumFrames = 0;
    }

    // Advance fade each frame
    const f = this._fade;
    if (f.active) {
      const step = f.speed / 100;
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
        if (pressedKey === 'Meta' || pressedKey === 'Control' || pressedKey === 'Alt' || pressedKey === 'Shift') {
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

  setModeNative(width, height) {
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

  setFpsNative() {
    return 0;
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
    // implícitos) em processTable.locals para cada processo compilado — ver
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
    // Previously tried to auto-detect argument order — xadvance(distance,
    // angle) vs xadvance(angle, distance) — by guessing that whichever
    // argument has magnitude > 180000 "must be" the distance, since a
    // DIV angle "shouldn't" exceed 180000 (180.000°). That assumption is
    // wrong: toRadiansFromDivAngle() never wraps or clamps its input, and
    // this engine's own shipped demo (index.html: "angle_step = angle_step
    // + 3000;", unbounded, cycling naturally through trig's own
    // periodicity) confirms angles routinely span the full 0-360000
    // convention, not just 0-180000. Any legitimate angle between 180001
    // and 360000 (180°-360° — the entire back half of a full turn) would
    // silently get misclassified as "must be the distance", producing a
    // wildly wrong movement in both magnitude and direction. There's no
    // magnitude threshold that can fix this: on-screen distances
    // routinely reach into the hundreds or low thousands (screen width/
    // height, a scrolled level's extent), which overlaps the legitimate
    // angle range too broadly for guessing to ever be reliable. Fixed
    // argument order — matching advanceNative(distance, angle) exactly —
    // instead of guessing.
    return this.moveCurrentProcess(distance, angle);
  }

  xputNative() {
    const [fileId, graphId, x, y, angle, size, flags, region] = arguments;
    this.ensureGraph(fileId, graphId);
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
    return 1;
  }

  setPointNative(fileId, graphId, pointIndex, x, y) {
    const graph = this.ensureGraph(fileId, graphId);
    graph.setPoint(pointIndex, x, y);
    return 1;
  }

  getPointNative(fileId, graphId, pointIndex, axis) {
    const graph = this.ensureGraph(fileId, graphId);
    const point = graph.getPoint(pointIndex);
    return {
      x: point.x,
      y: point.y
    };
  }

  isMirrorX(flags) {
    const f = Number(flags) || 0;
    return f === 1 || f === 3 || f === 5 || f === 7;
  }

  isMirrorY(flags) {
    const f = Number(flags) || 0;
    return f === 2 || f === 3 || f === 6 || f === 7;
  }

  computeRealPoint(fileId, graphId, pointIndex, x, y, angle, size, flags) {
    const graph = this.ensureGraph(fileId, graphId);
    const pivot = graph.getPoint(0);
    const point = graph.getPoint(pointIndex);

    const scale = (Number(size) || 100) / 100;
    let dx = (point.x - pivot.x) * scale;
    let dy = (point.y - pivot.y) * scale;

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

    return this.computeRealPoint(fileId, graphId, pointIndex, x, y, angle, size, flags);
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

    const x = Number(process.locals?.[0] ?? process.x ?? 0) || 0;
    const y = Number(process.locals?.[1] ?? process.y ?? 0) || 0;
    const width = Number(process.locals?.[2] ?? process.width ?? 0) || 0;
    const height = Number(process.locals?.[3] ?? process.height ?? 0) || 0;

    return { x, y, width, height };
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

  writeNative(font, x, y, align, text) {
    this.drawCommands.push({
      type: 'text',
      x: Number(x),
      y: Number(y),
      text: String(text),
      color: this.currentColor,
      ctype: this.getCurrentCType(),
      fontId: Number(font) || 0,
      align: Number(align) || 0
    });
    return 0;
  }

  writeIntNative(font, x, y, align, value) {
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
    return this.vm.processManager.collision(this.vm.currentProcess, Number(typeCode));
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

    const canonicalSlots = {
      x: 0,
      y: 1,
      width: 2,
      height: 3,
      ctype: 4,
      id: 5,
      region: 6,
      angle: 7,
      red: 8,
      green: 9,
      blue: 10,
      alpha: 11,
      tag: 12,
      priority: 13
    };

    if (Object.prototype.hasOwnProperty.call(canonicalSlots, lower)) {
      const slot = canonicalSlots[lower];
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

    const canonicalSlots = {
      x: 0,
      y: 1,
      width: 2,
      height: 3,
      ctype: 4,
      id: 5,
      region: 6,
      angle: 7,
      red: 8,
      green: 9,
      blue: 10,
      alpha: 11,
      tag: 12,
      priority: 13
    };

    if (Object.prototype.hasOwnProperty.call(canonicalSlots, lower)) {
      const slot = canonicalSlots[lower];
      process.locals[slot] = value;
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

  ensureScrollEntry(index) {
    if (!this.state.scroll[index]) {
      this.state.scroll[index] = {
        camera: 0,
        alpha: 100,
        active: 0,
        region: 0,
        flags: 0
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
    const cx = gx * cellSize + Math.floor(cellSize * 0.5);
    const cy = gy * cellSize + Math.floor(cellSize * 0.5);
    const hit = this.vm?.processManager?.collisionPoint(cx, cy, obstacleTypeCode) || 0;
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

    const open = [{ key: startKey, x: sx, y: sy, g: 0, f: heuristic(sx, sy, ex, ey) }];
    const openMap = new Map([[startKey, open[0]]]);
    const closed = new Set();
    const cameFrom = new Map();
    const gScore = new Map([[startKey, 0]]);

    let visited = 0;

    while (open.length > 0 && visited < maxVisited) {
      let bestIndex = 0;
      for (let i = 1; i < open.length; i++) {
        if (open[i].f < open[bestIndex].f) bestIndex = i;
      }

      const current = open.splice(bestIndex, 1)[0];
      openMap.delete(current.key);
      if (closed.has(current.key)) continue;
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

        const existing = openMap.get(nKey);
        if (existing) {
          existing.g = tentativeG;
          existing.f = f;
        } else {
          const node = { key: nKey, x: nx, y: ny, g: tentativeG, f };
          open.push(node);
          openMap.set(nKey, node);
        }
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
      const cx = (Number(process.x) || 0) + (Number(process.width) || 0) * 0.5;
      const cy = (Number(process.y) || 0) + (Number(process.height) || 0) * 0.5;
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

    loadDivMapFromUrl(url)
      .then((map) => {
        Graphics.setCanvas(graphId, map.canvas);
        this.ensureGraph(0, graphId, map.width, map.height);
      })
      .catch((error) => {
        this.logFn(`[warn] load_map failed (${url}): ${error?.message || String(error)}`);
      });

    return graphId;
  }

  loadFpgNative(src) {
    if (!src) {
      return 0;
    }

    const libraryId = this.reserveGraphLibrary();
    const entry = this.graphLibraries.get(libraryId);
    const url = String(src);

    loadDivFpgFromUrl(url)
      .then((fpg) => {
        for (const map of fpg.maps) {
          const assetId = Graphics.addCanvas(map.canvas);
          entry.graphs.set(Number(map.code) || 0, assetId);
          this.ensureGraph(libraryId, map.code, map.width, map.height);
        }
        entry.loaded = true;
      })
      .catch((error) => {
        entry.error = error?.message || String(error);
        this.logFn(`[warn] load_fpg failed (${url}): ${entry.error}`);
      });

    return libraryId;
  }

  loadFntNative(src) {
    if (!src) {
      return 0;
    }

    const id = this.reserveBitmapFont();
    const entry = this.bitmapFonts.get(id);
    const url = String(src);

    loadDivFntFromUrl(url)
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

    fetch(url)
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

    return id;
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
    this.vm.registerNative('key_down', this.keyDownNative.bind(this));
    this.vm.registerNative('key_pressed', this.keyPressedNative.bind(this));
    this.vm.registerNative('key', this.keyNative.bind(this));
    this.vm.registerNative('get_time', () => this.totalTime);
    this.vm.registerNative('get_delta', () => this.vm.dt);
    this.vm.registerNative('set_title', this.setTitleNative.bind(this));
    this.vm.registerNative('set_mode', this.setModeNative.bind(this));
    this.vm.registerNative('screen_color', this.screenColorNative.bind(this));
    this.vm.registerNative('set_fps', this.setFpsNative.bind(this));
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
    this.vm.registerNative('get_point_x', (fileId, graphId, pointIndex) => this.getPointNative(fileId, graphId, pointIndex).x);
    this.vm.registerNative('get_point_y', (fileId, graphId, pointIndex) => this.getPointNative(fileId, graphId, pointIndex).y);
    this.vm.registerNative('get_real_point', this.getRealPointNative.bind(this));
    this.vm.registerNative('get_real_point_x', this.getRealPointXNative.bind(this));
    this.vm.registerNative('get_real_point_y', this.getRealPointYNative.bind(this));
    this.vm.registerNative('define_region', this.defineRegionNative.bind(this));
    this.vm.registerNative('start_scroll', this.startScrollNative.bind(this));
    this.vm.registerNative('stop_scroll', this.stopScrollNative.bind(this));
    this.vm.registerNative('out_of_region', this.outOfRegionNative.bind(this));
    this.vm.registerNative('exit_region', this.outOfRegionNative.bind(this));
    this.vm.registerNative('out_of_screen', this.outOfScreenNative.bind(this));
    this.vm.registerNative('exit_screen', this.outOfScreenNative.bind(this));
    this.vm.registerNative('write', this.writeNative.bind(this));
    this.vm.registerNative('write_int', this.writeIntNative.bind(this));
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
    this.vm.registerNative('load_bdf_font', this.loadBdfFontNative.bind(this));
    this.vm.registerNative('load_bdf_font_text', this.loadBdfFontTextNative.bind(this));
    this.vm.registerNative('__get_path', this.getPathNative.bind(this));
    this.vm.registerNative('__set_path', this.setPathNative.bind(this));
    this.vm.registerNative('path_find', this.pathFindNative.bind(this));
    this.vm.registerNative('path_length', this.pathLengthNative.bind(this));
    this.vm.registerNative('path_get_x', this.pathGetXNative.bind(this));
    this.vm.registerNative('path_get_y', this.pathGetYNative.bind(this));
    this.vm.registerNative('path_clear', this.pathClearNative.bind(this));
    this.vm.registerNative('path_assign', this.pathAssignNative.bind(this));
    this.vm.registerNative('path_step', this.pathStepNative.bind(this));
    this.vm.registerNative('path_stop', this.pathStopNative.bind(this));
    this.vm.registerNative('path_index', this.pathIndexNative.bind(this));
    this.vm.registerNative('fade_off', (speed = 1) => { this._fadeStart(0, 0, 0, speed ?? 1, 1); return 0; });
    this.vm.registerNative('fade_on',  (speed = 1) => { this._fadeStart(0, 0, 0, speed ?? 1, 0); return 0; });
    this.vm.registerNative('fade',     (r, g, b, speed, target) => { this._fadeStart(r ?? 0, g ?? 0, b ?? 0, speed ?? 1, target ?? 1); return 0; });
    this.vm.registerNative('is_fading', () => this._fade.active ? 1 : 0);
    this.vm.registerNative('new_graphic',        this.newGraphicNative.bind(this));
    this.vm.registerNative('gfx_fill',           this.gfxFillNative.bind(this));
    this.vm.registerNative('gfx_fill_rgba',      this.gfxFillRGBANative.bind(this));
    this.vm.registerNative('gfx_pixel',          this.gfxPixelNative.bind(this));
    this.vm.registerNative('gfx_line',           this.gfxLineNative.bind(this));
    this.vm.registerNative('gfx_rect',           this.gfxRectNative.bind(this));
    this.vm.registerNative('gfx_rect_outline',   this.gfxRectOutlineNative.bind(this));
    this.vm.registerNative('gfx_circle',         this.gfxCircleNative.bind(this));
    this.vm.registerNative('gfx_circle_outline', this.gfxCircleOutlineNative.bind(this));
    this.vm.registerNative('gfx_text',           this.gfxTextNative.bind(this));
    this.vm.registerNative('free_graphic',       (id) => { Graphics.remove(Number(id)); return 0; });
    this.vm.registerNative('mouse_x',      () => this._mouse.x);
    this.vm.registerNative('mouse_y',      () => this._mouse.y);
    this.vm.registerNative('mouse_button', (b) => this._mouse.buttons[Number(b) || 0] ? 1 : 0);
  }

  // target: 1 = fade to opaque (fade out), 0 = fade to transparent (fade in)
  _fadeStart(r, g, b, speed, target) {
    const f = this._fade;
    f.r = Math.max(0, Math.min(255, Math.round(r)));
    f.g = Math.max(0, Math.min(255, Math.round(g)));
    f.b = Math.max(0, Math.min(255, Math.round(b)));
    f.speed = Math.max(0.1, Math.min(100, speed));
    f.target = target ? 1 : 0;
    f.active = f.alpha !== f.target;
  }

  // ── Procedural graphics API ──────────────────────────────────────────────

  _gfxCtx(id) {
    const g = Graphics.get(Number(id));
    return g && g.ctx2d ? g.ctx2d : null;
  }

  _cssRGB(r, g, b) { return `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`; }
  _cssRGBA(r, g, b, a) { return `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${Math.max(0,Math.min(1, a/100))})`; }

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

  getScrollCamera(index) {
    const entry = this.ensureScrollEntry(index);
    const region = this.getRegionRect(entry.region);
    const camProcess = this.vm.processManager.get(Number(entry.camera) || 0);
    if (!camProcess) {
      return { x: 0, y: 0 };
    }

    return {
      x: camProcess.x - region.width * 0.5,
      y: camProcess.y - region.height * 0.5
    };
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

  getProcessGraphInfo(process) {
    const graphId = this.getProcessLocalNumber(process, 'graph', Number(process.graph ?? 0) || 0);
    const fileId = this.getProcessLocalNumber(process, 'file', Number(process.file ?? 0) || 0);
    const angle = this.getProcessLocalNumber(process, 'angle', Number(process.angle ?? 0) || 0);
    const size = this.getProcessLocalNumber(process, 'size', 100);
    const flags = this.getProcessLocalNumber(process, 'flags', Number(process.flags ?? 0) || 0);
    return { fileId, graphId, angle, size, flags };
  }

  getGraphAsset(fileId, graphId) {
    const fid = Number(fileId) || 0;
    const gid = Number(graphId) || 0;

    if (fid > 0) {
      const lib = this.graphLibraries.get(fid);
      const mapped = lib?.graphs?.get(gid);
      if (mapped) {
        return Graphics.get(mapped) || null;
      }
    }

    // Fallback: graphId directly references a graphic id.
    return Graphics.get(gid) || null;
  }

  drawGraphSprite(fileId, graphId, x, y, angle, size, flags, baseWidth, baseHeight) {
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
    const scale = (Number(size) || 100) / 100;
    const drawW = Math.max(1, (Number(baseWidth) || graphW) * scale);
    const drawH = Math.max(1, (Number(baseHeight) || graphH) * scale);
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

  drawGraphPlaceholder(px, py, angle, size, color) {
    const radians = (Number(angle) / 1000) * (Math.PI / 180);
    const scale = (Number(size) || 100) / 100;
    const w = 18 * scale;
    const h = 10 * scale;

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

  drawProcessAt(process, offsetX, offsetY) {
    const px = process.x - offsetX;
    const py = process.y - offsetY;
    const centerX = px + process.width * 0.5;
    const centerY = py + process.height * 0.5;
    const graph = this.getProcessGraphInfo(process);

    const alpha = (process.alpha ?? 100) / 100;
    if (alpha <= 0) return; // invisible — skip entirely

    const r = process.red   ?? 255;
    const g = process.green ?? 255;
    const b = process.blue  ?? 255;
    const hasTint = r !== 255 || g !== 255 || b !== 255;

    this.ctx.save();
    if (alpha < 1) this.ctx.globalAlpha = alpha;

    if (graph.graphId > 0) {
      const drewSprite = this.drawGraphSprite(
        graph.fileId, graph.graphId,
        centerX, centerY,
        graph.angle, graph.size, graph.flags,
        process.width, process.height
      );

      if (drewSprite && hasTint) {
        this.ctx.globalCompositeOperation = 'multiply';
        this.ctx.fillStyle = `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
        const hw = process.width * 0.5 * ((graph.size || 100) / 100);
        const hh = process.height * 0.5 * ((graph.size || 100) / 100);
        this.ctx.fillRect(centerX - hw, centerY - hh, hw * 2, hh * 2);
        this.ctx.globalCompositeOperation = 'source-over';
      }

      if (!drewSprite) {
        this.drawGraphPlaceholder(centerX, centerY, graph.angle, graph.size, `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`);
      }
    } else {
      // No graphic assigned — draw a colored placeholder box so the process is always visible
      this.drawGraphPlaceholder(centerX, centerY, graph.angle, graph.size, `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`);
    }

    this.ctx.restore();

    if (this.debugDrawProcessBounds) {
      this.ctx.save();
      this.ctx.strokeStyle = this.debugProcessBoundsColor;
      this.ctx.lineWidth = 1;
      this.ctx.strokeRect(px, py, process.width, process.height);
      this.ctx.restore();
    }
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
    this.ctx.font = '14px JetBrains Mono, Consolas, monospace';
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
        cmd.flags,
        graph.width,
        graph.height
      );

      if (!drewSprite) {
        this.drawGraphPlaceholder(px, py, cmd.angle, cmd.size, cmd.color);
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
          const drewBitmap = cmd.fontId > 0
            ? this.drawBitmapText(cmd.fontId, pos.x, pos.y, cmd.align || 0, cmd.text)
            : false;
          if (!drewBitmap) {
            this.ctx.fillText(cmd.text, pos.x, pos.y);
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
    this.drawCommands.length = 0;
  }

  render() {
    this.ctx.fillStyle = this.clearColor;
    this.ctx.fillRect(0, 0, this.width, this.height);
    this.drawProcessesFallback();
    this.drawCommandsToCanvas();
    this.drawDebugStats();
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
