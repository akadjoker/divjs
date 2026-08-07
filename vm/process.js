/**
 * DivLang Process Manager
 * Cada processo tem seu próprio contexto (ip, stack, locals)
 */

import { hashCode } from '../utils/hash.js';

const DIV_ANGLE_TO_RAD = Math.PI / 180000;

function toRadians(divAngle) {
  return (Number(divAngle) || 0) * DIV_ANGLE_TO_RAD;
}

function getCenter(process, x = process.x, y = process.y) {
  const w = Number(process.width) || 0;
  const h = Number(process.height) || 0;
  return {
    cx: (Number(x) || 0) + w * 0.5,
    cy: (Number(y) || 0) + h * 0.5,
    w,
    h
  };
}

function getCorners(process, x = process.x, y = process.y) {
  const { cx, cy, w, h } = getCenter(process, x, y);
  const hw = w * 0.5;
  const hh = h * 0.5;
  const a = toRadians(process.angle);
  const c = Math.cos(a);
  const s = Math.sin(a);

  const rot = (lx, ly) => ({
    x: cx + lx * c - ly * s,
    y: cy + lx * s + ly * c
  });

  return [
    rot(-hw, -hh),
    rot(hw, -hh),
    rot(hw, hh),
    rot(-hw, hh)
  ];
}

function getAABBFromCorners(corners) {
  let minX = corners[0].x;
  let maxX = corners[0].x;
  let minY = corners[0].y;
  let maxY = corners[0].y;
  for (let i = 1; i < corners.length; i++) {
    const p = corners[i];
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, maxX, minY, maxY };
}

function aabbOverlap(a, b) {
  return !(a.maxX < b.minX || a.minX > b.maxX || a.maxY < b.minY || a.minY > b.maxY);
}

function dot(ax, ay, bx, by) {
  return ax * bx + ay * by;
}

function normalize(x, y) {
  const len = Math.hypot(x, y);
  if (len <= 1e-9) return { x: 1, y: 0 };
  return { x: x / len, y: y / len };
}

function projectCorners(corners, axisX, axisY) {
  let min = dot(corners[0].x, corners[0].y, axisX, axisY);
  let max = min;
  for (let i = 1; i < corners.length; i++) {
    const p = dot(corners[i].x, corners[i].y, axisX, axisY);
    if (p < min) min = p;
    if (p > max) max = p;
  }
  return { min, max };
}

function overlapAmount(pa, pb) {
  return Math.min(pa.max, pb.max) - Math.max(pa.min, pb.min);
}

function satBoxBox(cornersA, cornersB, centerDeltaX, centerDeltaY) {
  const edges = [
    { x: cornersA[1].x - cornersA[0].x, y: cornersA[1].y - cornersA[0].y },
    { x: cornersA[3].x - cornersA[0].x, y: cornersA[3].y - cornersA[0].y },
    { x: cornersB[1].x - cornersB[0].x, y: cornersB[1].y - cornersB[0].y },
    { x: cornersB[3].x - cornersB[0].x, y: cornersB[3].y - cornersB[0].y }
  ];

  let bestOverlap = Number.POSITIVE_INFINITY;
  let bestAxis = { x: 1, y: 0 };

  for (const e of edges) {
    const axis = normalize(-e.y, e.x);
    const pa = projectCorners(cornersA, axis.x, axis.y);
    const pb = projectCorners(cornersB, axis.x, axis.y);
    const ov = overlapAmount(pa, pb);
    if (ov <= 0) {
      return { hit: false, mtvX: 0, mtvY: 0 };
    }
    if (ov < bestOverlap) {
      bestOverlap = ov;
      bestAxis = axis;
    }
  }

  // Push A away from B
  const dir = dot(centerDeltaX, centerDeltaY, bestAxis.x, bestAxis.y) < 0 ? -1 : 1;
  return {
    hit: true,
    mtvX: bestAxis.x * bestOverlap * dir,
    mtvY: bestAxis.y * bestOverlap * dir
  };
}

function circleCircle(a, b, ax = a.x, ay = a.y, bx = b.x, by = b.y) {
  const ac = getCenter(a, ax, ay);
  const bc = getCenter(b, bx, by);
  const ar = getCircleRadius(a, ac.w, ac.h);
  const br = getCircleRadius(b, bc.w, bc.h);
  const dx = ac.cx - bc.cx;
  const dy = ac.cy - bc.cy;
  const dist = Math.hypot(dx, dy);
  const sum = ar + br;
  if (dist > sum) {
    return { hit: false, mtvX: 0, mtvY: 0 };
  }
  const n = dist <= 1e-9 ? { x: 1, y: 0 } : { x: dx / dist, y: dy / dist };
  const pen = sum - dist;
  return { hit: true, mtvX: n.x * pen, mtvY: n.y * pen };
}

function getCircleRadius(process, width, height) {
  const explicit = Number(process.collisionRadius);
  if (Number.isFinite(explicit) && explicit > 0) {
    return explicit;
  }

  const scaleRaw = Number(process.collisionScale);
  const scale = Number.isFinite(scaleRaw) && scaleRaw > 0 ? scaleRaw : 1;
  const fallback = Math.max(1, Math.min(Number(width) || 0, Number(height) || 0) * 0.5 * scale);
  return fallback;
}

function boxCircle(box, circle, boxX = box.x, boxY = box.y, cx = circle.x, cy = circle.y) {
  const corners = getCorners(box, boxX, boxY);
  const center = getCenter(box, boxX, boxY);
  const cc = getCenter(circle, cx, cy);
  const r = getCircleRadius(circle, cc.w, cc.h);

  const angle = toRadians(box.angle);
  const c = Math.cos(-angle);
  const s = Math.sin(-angle);
  const lx = (cc.cx - center.cx) * c - (cc.cy - center.cy) * s;
  const ly = (cc.cx - center.cx) * s + (cc.cy - center.cy) * c;

  const hw = center.w * 0.5;
  const hh = center.h * 0.5;
  const qx = Math.max(-hw, Math.min(hw, lx));
  const qy = Math.max(-hh, Math.min(hh, ly));
  const dx = lx - qx;
  const dy = ly - qy;
  const d2 = dx * dx + dy * dy;
  if (d2 > r * r) {
    return { hit: false, mtvX: 0, mtvY: 0 };
  }

  const dist = Math.sqrt(d2);
  let nx = 1;
  let ny = 0;
  let pen = r;
  if (dist > 1e-9) {
    nx = dx / dist;
    ny = dy / dist;
    pen = r - dist;
  }

  const wx = nx * Math.cos(angle) - ny * Math.sin(angle);
  const wy = nx * Math.sin(angle) + ny * Math.cos(angle);
  const dir = dot(center.cx - cc.cx, center.cy - cc.cy, wx, wy) < 0 ? -1 : 1;
  return { hit: true, mtvX: wx * pen * dir, mtvY: wy * pen * dir };
}

function localToWorld(process, px, py, lx, ly) {
  const { cx, cy, w, h } = getCenter(process, px, py);
  const dx = Number(lx) - w * 0.5;
  const dy = Number(ly) - h * 0.5;
  const a = toRadians(process.angle);
  const c = Math.cos(a);
  const s = Math.sin(a);
  return {
    x: cx + dx * c - dy * s,
    y: cy + dx * s + dy * c
  };
}

function cboxToShape(process, cbox, px = process.x, py = process.y) {
  const shape = cbox?.shape === 'circle' ? 'circle' : 'box';
  const code = Number(cbox?.code);
  if (shape === 'circle') {
    const center = localToWorld(process, px, py, Number(cbox.x) || 0, Number(cbox.y) || 0);
    const radius = Math.max(1, Number(cbox.radius) || 1);
    return {
      shape,
      code: Number.isInteger(code) ? code : -1,
      cx: center.x,
      cy: center.y,
      r: radius,
      aabb: {
        minX: center.x - radius,
        maxX: center.x + radius,
        minY: center.y - radius,
        maxY: center.y + radius
      }
    };
  }

  const x = Number(cbox?.x) || 0;
  const y = Number(cbox?.y) || 0;
  const w = Math.max(1, Number(cbox?.width) || 1);
  const h = Math.max(1, Number(cbox?.height) || 1);
  const corners = [
    localToWorld(process, px, py, x, y),
    localToWorld(process, px, py, x + w, y),
    localToWorld(process, px, py, x + w, y + h),
    localToWorld(process, px, py, x, y + h)
  ];
  return {
    shape,
    code: Number.isInteger(code) ? code : -1,
    corners,
    aabb: getAABBFromCorners(corners)
  };
}

function getDefaultShapes(process, px = process.x, py = process.y, preferCircle = false) {
  if (preferCircle || process.collisionShape === 'circle') {
    const center = getCenter(process, px, py);
    const r = getCircleRadius(process, center.w, center.h);
    return [{
      shape: 'circle',
      code: -1,
      cx: center.cx,
      cy: center.cy,
      r,
      aabb: { minX: center.cx - r, maxX: center.cx + r, minY: center.cy - r, maxY: center.cy + r }
    }];
  }
  const corners = getCorners(process, px, py);
  return [{
    shape: 'box',
    code: -1,
    corners,
    aabb: getAABBFromCorners(corners)
  }];
}

function getProcessShapes(process, px = process.x, py = process.y, preferCircle = false) {
  if (Array.isArray(process.cboxes) && process.cboxes.length > 0) {
    return process.cboxes.map((c) => cboxToShape(process, c, px, py));
  }
  return getDefaultShapes(process, px, py, preferCircle);
}

function circleCircleShapes(a, b) {
  const dx = a.cx - b.cx;
  const dy = a.cy - b.cy;
  const dist = Math.hypot(dx, dy);
  const sum = a.r + b.r;
  if (dist > sum) return { hit: false, mtvX: 0, mtvY: 0 };
  const n = dist <= 1e-9 ? { x: 1, y: 0 } : { x: dx / dist, y: dy / dist };
  const pen = sum - dist;
  return { hit: true, mtvX: n.x * pen, mtvY: n.y * pen };
}

function boxCircleShapes(boxShape, circleShape) {
  const centerX = (boxShape.corners[0].x + boxShape.corners[2].x) * 0.5;
  const centerY = (boxShape.corners[0].y + boxShape.corners[2].y) * 0.5;

  // Build local basis from box edge vectors.
  const ex = normalize(boxShape.corners[1].x - boxShape.corners[0].x, boxShape.corners[1].y - boxShape.corners[0].y);
  const ey = normalize(boxShape.corners[3].x - boxShape.corners[0].x, boxShape.corners[3].y - boxShape.corners[0].y);
  const hw = Math.hypot(boxShape.corners[1].x - boxShape.corners[0].x, boxShape.corners[1].y - boxShape.corners[0].y) * 0.5;
  const hh = Math.hypot(boxShape.corners[3].x - boxShape.corners[0].x, boxShape.corners[3].y - boxShape.corners[0].y) * 0.5;

  const relX = circleShape.cx - centerX;
  const relY = circleShape.cy - centerY;
  const lx = dot(relX, relY, ex.x, ex.y);
  const ly = dot(relX, relY, ey.x, ey.y);
  const qx = Math.max(-hw, Math.min(hw, lx));
  const qy = Math.max(-hh, Math.min(hh, ly));
  const dx = lx - qx;
  const dy = ly - qy;
  const d2 = dx * dx + dy * dy;
  if (d2 > circleShape.r * circleShape.r) {
    return { hit: false, mtvX: 0, mtvY: 0 };
  }
  const dist = Math.sqrt(d2);
  const nx = dist <= 1e-9 ? 1 : dx / dist;
  const ny = dist <= 1e-9 ? 0 : dy / dist;
  const pen = dist <= 1e-9 ? circleShape.r : (circleShape.r - dist);
  const wx = ex.x * nx + ey.x * ny;
  const wy = ex.y * nx + ey.y * ny;
  return { hit: true, mtvX: wx * pen, mtvY: wy * pen };
}

function collideShapePair(shapeA, shapeB) {
  if (!aabbOverlap(shapeA.aabb, shapeB.aabb)) {
    return { hit: false, mtvX: 0, mtvY: 0 };
  }

  if (shapeA.shape === 'box' && shapeB.shape === 'box') {
    const ca = {
      cx: (shapeA.corners[0].x + shapeA.corners[2].x) * 0.5,
      cy: (shapeA.corners[0].y + shapeA.corners[2].y) * 0.5
    };
    const cb = {
      cx: (shapeB.corners[0].x + shapeB.corners[2].x) * 0.5,
      cy: (shapeB.corners[0].y + shapeB.corners[2].y) * 0.5
    };
    return satBoxBox(shapeA.corners, shapeB.corners, ca.cx - cb.cx, ca.cy - cb.cy);
  }

  if (shapeA.shape === 'circle' && shapeB.shape === 'circle') {
    return circleCircleShapes(shapeA, shapeB);
  }

  if (shapeA.shape === 'box' && shapeB.shape === 'circle') {
    return boxCircleShapes(shapeA, shapeB);
  }

  const inv = boxCircleShapes(shapeB, shapeA);
  return inv.hit ? { hit: true, mtvX: -inv.mtvX, mtvY: -inv.mtvY } : inv;
}

function collideProcesses(a, b, ax = a.x, ay = a.y, bx = b.x, by = b.y, options = {}) {
  const shapesA = getProcessShapes(a, ax, ay, !!options.preferCircle);
  const shapesB = getProcessShapes(b, bx, by, !!options.preferCircle);

  for (const sa of shapesA) {
    for (const sb of shapesB) {
      const hit = collideShapePair(sa, sb);
      if (hit.hit) {
        return {
          hit: true,
          mtvX: hit.mtvX,
          mtvY: hit.mtvY,
          cboxCodeA: sa.code,
          cboxCodeB: sb.code
        };
      }
    }
  }
  return { hit: false, mtvX: 0, mtvY: 0, cboxCodeA: -1, cboxCodeB: -1 };
}

function processAABB(process, x = process.x, y = process.y) {
  if ((Number(process.angle) || 0) === 0) {
    const px = Number(x) || 0;
    const py = Number(y) || 0;
    const w = Number(process.width) || 0;
    const h = Number(process.height) || 0;
    return { minX: px, maxX: px + w, minY: py, maxY: py + h };
  }
  return getAABBFromCorners(getCorners(process, x, y));
}

function collidesBoxBox(a, b, ax = a.x, ay = a.y, bx = b.x, by = b.y) {
  const aabbA = processAABB(a, ax, ay);
  const aabbB = processAABB(b, bx, by);
  if (!aabbOverlap(aabbA, aabbB)) {
    return { hit: false, mtvX: 0, mtvY: 0 };
  }

  const angleA = Number(a.angle) || 0;
  const angleB = Number(b.angle) || 0;
  if (angleA === 0 && angleB === 0) {
    const left = aabbB.minX - aabbA.maxX;
    const right = aabbB.maxX - aabbA.minX;
    const top = aabbB.minY - aabbA.maxY;
    const bottom = aabbB.maxY - aabbA.minY;
    const px = Math.abs(left) < Math.abs(right) ? left : right;
    const py = Math.abs(top) < Math.abs(bottom) ? top : bottom;
    if (Math.abs(px) < Math.abs(py)) return { hit: true, mtvX: px, mtvY: 0 };
    return { hit: true, mtvX: 0, mtvY: py };
  }

  const ca = getCenter(a, ax, ay);
  const cb = getCenter(b, bx, by);
  return satBoxBox(getCorners(a, ax, ay), getCorners(b, bx, by), ca.cx - cb.cx, ca.cy - cb.cy);
}

export const Signal = {
  S_KILL: 0,
  S_WAKEUP: 1,
  S_SLEEP: 2,
  S_FREEZE: 3,
  S_KILL_TREE: 100,
  S_WAKEUP_TREE: 101,
  S_SLEEP_TREE: 102,
  S_FREEZE_TREE: 103
};

export class Process {
  constructor(name, params = {}) {
    this.name = name;
    this.id = params.id || 0;
    this.type = hashCode(name); // Tipo = hash do nome

    // Position (locals especiais - slots fixos)
    this.x = params.x || 0;
    this.y = params.y || 0;
    this.width = params.width || 32;
    this.height = params.height || 32;
    this.ctype = params.ctype ?? params.c_type ?? 0;
    this.region = params.region ?? 0;
    this.angle = params.angle ?? 0;
    // Color tint (0-255, matching the conventional 8-bit RGB range) and
    // opacity (0-100, matching the 0-100 scale scroll[i].alpha already
    // uses elsewhere in this runtime — kept consistent with that rather
    // than introducing a second, incompatible 0-255 alpha convention).
    // Storage only: nothing in the renderer applies these to a draw call
    // automatically yet, same as every other canonical field — a
    // process's own LOOP body is responsible for calling set_color()
    // itself, same as today. red/green/blue default to 255 (full/no
    // tint) so a process that never touches them draws unaffected.
    this.red = params.red ?? 255;
    this.green = params.green ?? 255;
    this.blue = params.blue ?? 255;
    this.alpha = params.alpha ?? 100;
    // Free-form number a game author sets/reads purely for their own
    // gameplay logic (IF (other.tag == 5) ...) — distinct from `type`
    // just below, which is the hash of the process's *declared name*
    // and is already spoken for by collision()/signal(), not
    // reassignable or meant for general-purpose categorization.
    this.tag = params.tag ?? 0;
    // Draw order: lower priority draws first (behind), higher draws last
    // (in front). Default 0 = creation order (same as before this existed).
    this.priority = params.priority ?? 0;
    this.parentId = params.parentId ?? 0;
    // Optional explicit radius/scale used by circle collisions.
    this.collisionRadius = Number(params.collisionRadius ?? params.collision_radius ?? 0) || 0;
    this.collisionScale = Number(params.collisionScale ?? params.collision_scale ?? 1) || 1;
    this.collisionShape = params.collisionShape === 'circle' ? 'circle' : 'box';
    this.cboxes = [];

    // Private variables
    this.privates = params;

    // State
    this.active = true;
    this.suspended = false;
    this.finished = false;
    this.dead = false; // Marked for removal
    this.frameValue = 100;
    // Accumulator for frame(n) throttling — see the scheduler comment in
    // vm.js's tick() for how this is spent. Starts at 100 so a freshly
    // spawned process always gets to run on the very first tick it's
    // scheduled for, before any frame(n) call it makes has had a chance
    // to take effect.
    this.frameCredit = 100;
    // How many consecutive ticks in a row this process has run entirely
    // out of instruction budget without ever reaching FRAME or finishing
    // — see runProcess()'s budget handling in vm.js for what this is
    // used for. Reset to 0 the moment the process successfully yields or
    // finishes normally.
    this.budgetExhaustedStreak = 0;

    // VM context (coroutine)
    this.ip = 0;           // Instruction pointer
    this.stack = [];       // Stack proprio
    this.locals = [];      // Locais proprios

    // Sincronizar com locals (slots fixos: 0=x, 1=y, 2=width, 3=height,
    // 4=ctype, 5=id, 6=region, 7=angle, 8=red, 9=green, 10=blue,
    // 11=alpha, 12=tag, 13=priority)
    this.locals[0] = this.x;
    this.locals[1] = this.y;
    this.locals[2] = this.width;
    this.locals[3] = this.height;
    this.locals[4] = this.ctype;
    this.locals[5] = this.id;
    this.locals[6] = this.region;
    this.locals[7] = this.angle;
    this.locals[8] = this.red;
    this.locals[9] = this.green;
    this.locals[10] = this.blue;
    this.locals[11] = this.alpha;
    this.locals[12] = this.tag;
    this.locals[13] = this.priority;
  }

  // Get bounds (for collision)
  getBounds() {
    return {
      x: this.x,
      y: this.y,
      width: this.width,
      height: this.height
    };
  }

  // Check collision with another process
  collidesWith(other) {
    return collideProcesses(this, other).hit;
  }

  // Circle vs circle: uses width/2 as radius for each process
  collidesCircle(other) {
    return collideProcesses(this, other, this.x, this.y, other.x, other.y, { preferCircle: true }).hit;
  }

  // OBB vs OBB using SAT (4 axes from the two boxes).
  // Falls back to AABB when both angles are 0.
  collidesOBB(other) {
    return collideProcesses(this, other).hit;
  }

  // Get property
  get(name) {
    return this.privates[name];
  }

  // Set property
  set(name, value) {
    this.privates[name] = value;
  }

  // Kill process
  kill() {
    this.dead = true;
    this.active = false;
  }

  // Sincronizar locals com estado do processo (chamar no fim do frame)
  sync() {
    this.x = this.locals[0] ?? this.x;
    this.y = this.locals[1] ?? this.y;
    this.width = this.locals[2] ?? this.width;
    this.height = this.locals[3] ?? this.height;
    this.ctype = this.locals[4] ?? this.ctype;
    this.locals[5] = this.id;
    this.region = this.locals[6] ?? this.region;
    this.angle = this.locals[7] ?? this.angle;
    this.red = this.locals[8] ?? this.red;
    this.green = this.locals[9] ?? this.green;
    this.blue = this.locals[10] ?? this.blue;
    this.alpha = this.locals[11] ?? this.alpha;
    this.tag = this.locals[12] ?? this.tag;
    this.priority = this.locals[13] ?? this.priority;
  }
}

export class ProcessManager {
  constructor() {
    this.processes = [];           // Array de todos os processos
    this.byType = new Map();       // Map<type, Set<processId>>
    this.byName = new Map();       // Map<name, Set<processId>>
    this.nextId = 1;               // IDs comecam em 1 (0 = null)
    this._drawList = [];           // Cached sorted draw order
    this._drawDirty = true;        // Rebuild draw list before next render
    this.lastPenetrationX = 0;
    this.lastPenetrationY = 0;
    this.lastColliderCBox = -1;
    this.lastCollidedCBox = -1;
  }

  _setPenetration(mtv) {
    this.lastPenetrationX = Math.round(Number(mtv?.mtvX) || 0);
    this.lastPenetrationY = Math.round(Number(mtv?.mtvY) || 0);
    this.lastColliderCBox = Number.isInteger(mtv?.cboxCodeA) ? mtv.cboxCodeA : -1;
    this.lastCollidedCBox = Number.isInteger(mtv?.cboxCodeB) ? mtv.cboxCodeB : -1;
  }

  // Create process
  create(name, params = {}) {
    const process = new Process(name, params);
    process.id = this.nextId++;
    process.locals[5] = process.id;
    process.locals[6] = process.region;
    process.locals[7] = process.angle;

    this.processes.push(process);
    this._drawDirty = true;

    // Index por tipo
    if (!this.byType.has(process.type)) {
      this.byType.set(process.type, new Set());
    }
    this.byType.get(process.type).add(process.id);

    // Index por nome
    if (!this.byName.has(name)) {
      this.byName.set(name, new Set());
    }
    this.byName.get(name).add(process.id);

    return process;
  }

  // Get process by ID
  get(id) {
    if (id === 0) return null; // 0 = null
    return this.processes.find(p => p.id === id);
  }

  // Get all processes
  getAll() {
    return this.processes;
  }

  // Returns processes sorted by priority for rendering.
  // Rebuilds only when the list changed or a priority was written.
  getDrawList() {
    if (this._drawDirty) {
      this._drawList = this.processes.slice();
      this._drawList.sort((a, b) => a.priority - b.priority);
      this._drawDirty = false;
    }
    return this._drawList;
  }

  // Called by the VM when priority slot (13) is written.
  markPriorityDirty() {
    this._drawDirty = true;
  }

  // Get processes by type (O(1) lookup)
  getByType(typeCode) {
    const ids = this.byType.get(typeCode);
    if (!ids) return [];

    return Array.from(ids).map(id => this.get(id));
  }

  // Get processes by name
  getByName(name) {
    const ids = this.byName.get(name);
    if (!ids) return [];

    return Array.from(ids).map(id => this.get(id));
  }

  // Get active processes
  getActive() {
    return this.processes.filter(p => p.active);
  }

  // Remove process (mark as dead, sweep later)
  remove(id) {
    const process = this.get(id);
    if (process) {
      process.kill();
    }
  }

  // Sweep dead processes (call after frame)
  sweep() {
    // Sincronizar antes de remover
    for (const process of this.processes) {
      if (process.active) {
        process.sync();
      }
    }

    // Remove dead processes
    for (let i = this.processes.length - 1; i >= 0; i--) {
      const process = this.processes[i];
      if (process.dead || process.finished) {
        // Remove from indexes
        this.byType.get(process.type)?.delete(process.id);
        this.byName.get(process.name)?.delete(process.id);

        // Remove from array
        this.processes.splice(i, 1);
        this._drawDirty = true;
      }
    }
  }

  // TYPE operator (O(1))
  getTypeCode(name) {
    return hashCode(name);
  }

  // collision(type) - Returns ID of colliding process or 0
  collision(currentProcess, typeCode) {
    const processIds = this.byType.get(typeCode);
    if (!processIds) return 0;
    for (const id of processIds) {
      if (id === currentProcess.id) continue;
      const other = this.get(id);
      if (!other || !other.active) continue;
      const hit = collideProcesses(currentProcess, other);
      if (hit.hit) {
        this._setPenetration(hit);
        return id;
      }
    }
    this._setPenetration(null);
    return 0;
  }

  collisionCircle(currentProcess, typeCode) {
    const processIds = this.byType.get(typeCode);
    if (!processIds) return 0;
    for (const id of processIds) {
      if (id === currentProcess.id) continue;
      const other = this.get(id);
      if (!other || !other.active) continue;
      const hit = collideProcesses(currentProcess, other, currentProcess.x, currentProcess.y, other.x, other.y, { preferCircle: true });
      if (hit.hit) {
        this._setPenetration(hit);
        return id;
      }
    }
    this._setPenetration(null);
    return 0;
  }

  collisionOBB(currentProcess, typeCode) {
    const processIds = this.byType.get(typeCode);
    if (!processIds) return 0;
    for (const id of processIds) {
      if (id === currentProcess.id) continue;
      const other = this.get(id);
      if (!other || !other.active) continue;
      const hit = collideProcesses(currentProcess, other);
      if (hit.hit) {
        this._setPenetration(hit);
        return id;
      }
    }
    this._setPenetration(null);
    return 0;
  }

  // Returns ID of first process of typeCode whose AABB contains point (px, py)
  collisionPoint(px, py, typeCode) {
    const processIds = this.byType.get(typeCode);
    if (!processIds) return 0;
    for (const id of processIds) {
      const p = this.get(id);
      if (p && p.active &&
          px >= p.x && px <= p.x + p.width &&
          py >= p.y && py <= p.y + p.height) return id;
    }
    return 0;
  }

  // Returns ID of first process of typeCode that would collide with
  // currentProcess if it were placed at (tx, ty). Position is not changed.
  placeMeeting(currentProcess, tx, ty, typeCode) {
    const processIds = this.byType.get(typeCode);
    if (!processIds) return 0;
    const px = Number(tx) || 0;
    const py = Number(ty) || 0;
    for (const id of processIds) {
      if (id === currentProcess.id) continue;
      const other = this.get(id);
      if (!other || !other.active) continue;
      const hit = collideProcesses(currentProcess, other, px, py, other.x, other.y);
      if (hit.hit) {
        this._setPenetration(hit);
        return id;
      }
    }
    this._setPenetration(null);
    return 0;
  }

  // Returns 1 if currentProcess placed at (tx, ty) does NOT hit typeCode.
  placeFree(currentProcess, tx, ty, typeCode) {
    return this.placeMeeting(currentProcess, tx, ty, typeCode) === 0 ? 1 : 0;
  }

  getChildrenOf(parentId) {
    return this.processes.filter((p) => p.parentId === parentId);
  }

  getDescendantsOf(rootId) {
    const out = [];
    const queue = [rootId];

    while (queue.length > 0) {
      const currentId = queue.shift();
      const children = this.getChildrenOf(currentId);
      for (const child of children) {
        out.push(child);
        queue.push(child.id);
      }
    }

    return out;
  }

  applySignal(process, signalCode) {
    if (!process || process.dead || process.finished) {
      return false;
    }

    switch (signalCode) {
      case Signal.S_KILL:
        process.kill();
        return true;
      case Signal.S_WAKEUP:
        process.suspended = false;
        process.active = true;
        return true;
      case Signal.S_SLEEP:
      case Signal.S_FREEZE:
        process.suspended = true;
        return true;
      default:
        return false;
    }
  }

  signalById(targetId, signalCode) {
    const target = this.get(Number(targetId) || 0);
    if (!target) {
      return 0;
    }

    if (signalCode === Signal.S_KILL_TREE || signalCode === Signal.S_WAKEUP_TREE || signalCode === Signal.S_SLEEP_TREE || signalCode === Signal.S_FREEZE_TREE) {
      const baseSignal = signalCode - 100;
      let changed = 0;
      if (this.applySignal(target, baseSignal)) {
        changed += 1;
      }

      const descendants = this.getDescendantsOf(target.id);
      for (const process of descendants) {
        if (this.applySignal(process, baseSignal)) {
          changed += 1;
        }
      }

      return changed;
    }

    return this.applySignal(target, signalCode) ? 1 : 0;
  }

  signalByType(typeCode, signalCode) {
    const list = this.getByType(Number(typeCode) || 0);
    if (list.length === 0) {
      return 0;
    }

    let changed = 0;
    for (const process of list) {
      changed += this.signalById(process.id, signalCode);
    }
    return changed;
  }

  letMeAlone(currentProcess) {
    if (!currentProcess) {
      return 0;
    }

    let removed = 0;
    for (const process of this.processes) {
      if (process.id === currentProcess.id) {
        continue;
      }
      if (!process.dead && !process.finished) {
        process.kill();
        removed += 1;
      }
    }

    return removed;
  }

  // Update all processes (not used with scheduler)
  update(dt) {
    for (const process of this.processes) {
      if (process.active && !process.suspended) {
        // TODO: execute process VM
      }
    }
  }

  // Get process count
  count() {
    return this.processes.length;
  }

  // Clear all processes
  clear() {
    this.processes = [];
    this.byType.clear();
    this.byName.clear();
    this.nextId = 1;
  }
}
