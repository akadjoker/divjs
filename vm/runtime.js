/**
 * DivLang Runtime
 * Native functions para a VM
 */

import { Graphics } from '../graph/graphics.js';

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
    this.textNative(x, y, text);
    return 0;
  }

  writeIntNative(font, x, y, align, value) {
    this.textNative(x, y, Math.floor(Number(value) || 0));
    return 0;
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
    let current = this.state[String(rootName)];
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
    this.vm.registerNative('place_meeting', this.placeMeetingNative.bind(this));
    this.vm.registerNative('place_free', this.placeFreeNative.bind(this));
    this.vm.registerNative('signal', this.signalNative.bind(this));
    this.vm.registerNative('let_me_alone', this.letMeAloneNative.bind(this));
    this.vm.registerNative('load_graphic', this.loadGraphicNative.bind(this));
    this.vm.registerNative('load_tile', this.loadTileNative.bind(this));
    this.vm.registerNative('__get_path', this.getPathNative.bind(this));
    this.vm.registerNative('__set_path', this.setPathNative.bind(this));
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
    // graphId is the real graphic id returned by load_graphic/load_tile.
    return Graphics.get(Number(graphId) || 0) || null;
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
          this.ctx.fillText(cmd.text, pos.x, pos.y);
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
