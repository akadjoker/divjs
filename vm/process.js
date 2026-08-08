/**
 * DivLang Process Manager
 */

import { hashCode } from '../utils/hash.js';

const DIV_ANGLE_TO_RAD = Math.PI / 180000;

function toRadians(divAngle) {
  return (Number(divAngle) || 0) * DIV_ANGLE_TO_RAD;
}

// Resolves a process's current graphic pivot (control point 0) in
// graphic-local pixels. Installed by the runtime, which is the only side
// that can map a process to its loaded Graph - see setPivotResolver.
let pivotResolver = null;

export function setPivotResolver(fn) {
  pivotResolver = typeof fn === 'function' ? fn : null;
}

// process.x/y is where the graphic's PIVOT (control point 0) sits in
// world space - the same convention real DIV uses, and the same point
// drawGraphSprite() draws from. The pivot defaults to the graphic's
// geometric center, but an FPG can put it anywhere: tutor4's 8x8 sprites
// declare cpoint 0 at (0,0), i.e. their top-left corner. So the box's
// center is x/y shifted by however far the pivot is from the middle of
// the graphic - without that, the collision box sat half a sprite away
// from the sprite actually drawn on screen.
function getCenter(process, x = process.x, y = process.y) {
  const w = Number(process.width) || 0;
  const h = Number(process.height) || 0;
  // x/y are in the process's own RESOLUTION units; divide to get real
  // screen-space coordinates (see Process.getResolution).
  const res = typeof process.getResolution === 'function' ? process.getResolution() : 1;
  let cx = (Number(x) || 0) / res;
  let cy = (Number(y) || 0) / res;

  const pivot = pivotResolver ? pivotResolver(process) : null;
  if (pivot) {
    cx += w * 0.5 - (Number(pivot.x) || 0);
    cy += h * 0.5 - (Number(pivot.y) || 0);
  }

  return { cx, cy, w, h };
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

// Touching edges are NOT a collision  the boxes must genuinely overlap.
// This matters for the very common grid-aligned case: 8x8 sprites placed
// on an 8-pixel grid put a process's box exactly against its neighbour's
// (e.g. spans 4..12 and 12..20). With a non-strict test those adjacent
// cells always register as colliding, which made tutor4's worm collide
// with the segment directly behind it on its very first move and die on
// the spot, every time.
function aabbOverlap(a, b) {
  return !(a.maxX <= b.minX || a.minX >= b.maxX || a.maxY <= b.minY || a.minY >= b.maxY);
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
  if (dist >= sum) {
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
  if (d2 >= r * r) {
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

export function getProcessShapes(process, px = process.x, py = process.y, preferCircle = false) {
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
  if (dist >= sum) return { hit: false, mtvX: 0, mtvY: 0 };
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
  if (d2 >= circleShape.r * circleShape.r) {
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
  // Fast path for the overwhelmingly common case in any real scene: two
  // plain boxes, neither with explicit collision boxes nor a circle
  // shape. getProcessShapes' default box shape allocates a closure and
  // 4 corner-point objects per side (getCorners) plus an AABB and a
  // shape-wrapper object, on every single pairwise test - collidesBoxBox
  // does the same job (including the angle!=0 SAT fallback) with just 2
  // AABB objects for the axis-aligned case, which is itself the common
  // one (most sprites never rotate). See ProcessManager.collision() etc.
  // for how often this runs: once per (caller, candidate-of-that-type)
  // pair, every time a script calls collision()/collision_circle()/...
  const preferCircleFlag = !!options.preferCircle;
  if (
    !preferCircleFlag &&
    a.collisionShape !== 'circle' && b.collisionShape !== 'circle' &&
    !(Array.isArray(a.cboxes) && a.cboxes.length > 0) &&
    !(Array.isArray(b.cboxes) && b.cboxes.length > 0)
  ) {
    const hit = collidesBoxBox(a, b, ax, ay, bx, by);
    return { hit: hit.hit, mtvX: hit.mtvX, mtvY: hit.mtvY, cboxCodeA: -1, cboxCodeB: -1 };
  }

  const shapesA = getProcessShapes(a, ax, ay, preferCircleFlag);
  const shapesB = getProcessShapes(b, bx, by, preferCircleFlag);

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
    // (x, y) is the process's center (see getCenter) - same as the box's
    // own axis-aligned bounds when angle is 0, so halve out from there.
    // getCenter also applies RESOLUTION, which this path needs too.
    const { cx, cy } = getCenter(process, x, y);
    const hw = (Number(process.width) || 0) * 0.5;
    const hh = (Number(process.height) || 0) * 0.5;
    return { minX: cx - hw, maxX: cx + hw, minY: cy - hh, maxY: cy + hh };
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
    // uses elsewhere in this runtime - kept consistent with that rather
    // than introducing a second, incompatible 0-255 alpha convention).
    // Storage only: nothing in the renderer applies these to a draw call
    // automatically yet, same as every other canonical field - a
    // process's own LOOP body is responsible for calling set_color()
    // itself, same as today. red/green/blue default to 255 (full/no
    // tint) so a process that never touches them draws unaffected.
    this.red = params.red ?? 255;
    this.green = params.green ?? 255;
    this.blue = params.blue ?? 255;
    this.alpha = params.alpha ?? 100;
    // Free-form number a game author sets/reads purely for their own
    // gameplay logic (IF (other.tag == 5) ...) - distinct from `type`
    // just below, which is the hash of the process's *declared name*
    // and is already spoken for by collision()/signal(), not
    // reassignable or meant for general-purpose categorization.
    this.tag = params.tag ?? 0;
    // Draw order: lower priority draws first (behind), higher draws last
    // (in front). Default 0 = creation order (same as before this existed).
    this.priority = params.priority ?? 0;
    // DIV's Z - draw depth, independent of priority (which orders
    // execution). Higher Z paints first, so it ends up behind.
    this.z = params.z ?? 0;
    // Canonical graphic fields (DIV keeps these as process fields too).
    this.graph = params.graph ?? 0;
    this.file = params.file ?? 0;
    this.size = params.size ?? 100; // 100 = full scale
    this.flags = params.flags ?? 0;
    // DIV's RESOLUTION: x/y are divided by this when drawing/colliding,
    // so a script can work in sub-pixel units (resolution=100 -> two
    // decimals). 0 means "unset", treated as 1 (no division).
    this.resolution = params.resolution ?? 0;
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
    // Skipped-frame counter for FRAME(n), mirroring DIV's _Frame
    // (i.c:917): when it is >= 100 the scheduler skips the process for
    // this frame and pays 100 off the debt, otherwise the process runs.
    // FRAME(n) adds n-100, so FRAME(100) never accrues debt (runs every
    // frame), FRAME(200) accrues 100 each time (runs every other frame),
    // and FRAME(150) averages one run every 1.5 frames.
    this.frameDebt = 0;
    // How many consecutive ticks in a row this process has run entirely
    // out of instruction budget without ever reaching FRAME or finishing
    // - see runProcess()'s budget handling in vm.js for what this is
    // used for. Reset to 0 the moment the process successfully yields or
    // finishes normally.
    this.budgetExhaustedStreak = 0;
    // Set once this process first reaches FRAME. Used by SPAWN_PROCESS
    // (vm.js) to tell a real process apart from one DIV lets act as a
    // plain function call: a process that runs to completion without
    // ever reaching FRAME never registered as a scheduled process, so its
    // RETURN value is what the spawn expression evaluates to instead of
    // a process id. (isCollidable() used to also gate on this - removed:
    // SPAWN_PROCESS already runs a freshly spawned process synchronously
    // up to its own FRAME before any other same-tick process could query
    // collision() against it, and the "several processes stacked at the
    // constructor's default 0,0" case this guarded against is already
    // covered by isCollidable()'s GRAPH check below, since GRAPH stays 0
    // until the process explicitly assigns one.)
    this.hasCompletedFrame = false;

    // VM context (coroutine)
    this.ip = 0;           // Instruction pointer
    this.stack = [];       // Stack proprio
    this.locals = [];      // Locais proprios

    // Sincronizar com locals (slots fixos: 0=x, 1=y, 2=width, 3=height,
    // 4=ctype, 5=id, 6=region, 7=angle, 8=red, 9=green, 10=blue,
    // 11=alpha, 12=tag, 13=priority, 14=resolution, 15=z,
    // 16=graph, 17=file, 18=size, 19=flags)
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
    this.locals[14] = this.resolution;
    this.locals[15] = this.z;
    this.locals[16] = this.graph;
    this.locals[17] = this.file;
    this.locals[18] = this.size;
    this.locals[19] = this.flags;
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
    this.resolution = this.locals[14] ?? this.resolution;
    this.z = this.locals[15] ?? this.z;
    this.graph = this.locals[16] ?? this.graph;
    this.file = this.locals[17] ?? this.file;
    this.size = this.locals[18] ?? this.size;
    this.flags = this.locals[19] ?? this.flags;
  }

  // Divisor applied to x/y for drawing and collision (DIV's RESOLUTION).
  // 0/unset/invalid all mean 1 - no scaling - so processes that never
  // touch the field behave exactly as before.
  getResolution() {
    const r = Number(this.resolution) || 0;
    return r > 0 ? r : 1;
  }
}

export class ProcessManager {
  constructor() {
    this.processes = [];           // Array de todos os processos
    this.byId = new Map();         // Map<processId, process> - O(1) get()
    this.byType = new Map();       // Map<type, Set<processId>>
    this.byName = new Map();       // Map<name, Set<processId>>
    this.nextId = 1;               // IDs comecam em 1 (0 = null)
    this._drawList = [];           // Cached sorted draw order
    this._drawDirty = true;        // Rebuild draw list before next render
    this.lastPenetrationX = 0;
    this.lastPenetrationY = 0;
    this.lastColliderCBox = -1;
    this.lastCollidedCBox = -1;
    // Whether any process has ever had a non-zero PRIORITY. When nothing
    // uses it - the common case, and what the bunnymark exercises - the
    // execution order is identical to creation order, so tick() can skip
    // sorting the whole process list every frame.
    this.usesPriority = false;
  }

  notePriorityUse() {
    this.usesPriority = true;
  }

  // In DIV a process with no graphic (GRAPH = 0) has nothing to collide
  // with - collision boxes come from the assigned graphic. Scripts use
  // that deliberately: tutor4's worm_segment sets graph=0 for every
  // segment past the current tail length, and those invisible segments
  // must not be hittable even though they still trail behind the worm.
  // The graph id lives in a dynamically-allocated local slot that only
  // the runtime can resolve, so it installs this predicate (see
  // registerNatives in runtime.js); without it, everything collides as
  // before.
  isCollidable(process) {
    if (!process || !process.active || process.dead || process.finished) {
      return false;
    }
    if (typeof this.graphIdOf !== 'function') {
      return true;
    }
    return this.graphIdOf(process) > 0;
  }

  // Remembers which two processes last reported a collision, so the
  // debug overlay can highlight exactly that pair (see
  // drawProcessDebugOverlay in runtime.js). Cleared each frame by the
  // renderer, so what's highlighted is always this frame's collision.
  _recordCollisionPair(colliderId, collidedId) {
    this.lastCollisionA = colliderId;
    this.lastCollisionB = collidedId;
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

    if (process.priority) {
      this.usesPriority = true;
    }

    this.processes.push(process);
    this.byId.set(process.id, process);
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

  // Get process by ID - O(1) via byId, kept in sync in create()/sweep().
  get(id) {
    if (id === 0) return null; // 0 = null
    return this.byId.get(id) || null;
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
      // DIV paints by Z, not by PRIORITY (i.c:1441 picks the greatest
      // _Z each pass and paints it), so the highest Z is drawn first and
      // ends up furthest back. PRIORITY is execution order only.
      this._drawList.sort((a, b) => (b.z || 0) - (a.z || 0));
      this._drawDirty = false;
    }
    return this._drawList;
  }

  // Called by the VM when the z slot (15) is written.
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
        this.byId.delete(process.id);
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
      if (!this.isCollidable(other)) continue;
      const hit = collideProcesses(currentProcess, other);
      if (hit.hit) {
        this._setPenetration(hit);
        this._recordCollisionPair(currentProcess.id, id);
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
      if (!this.isCollidable(other)) continue;
      const hit = collideProcesses(currentProcess, other, currentProcess.x, currentProcess.y, other.x, other.y, { preferCircle: true });
      if (hit.hit) {
        this._setPenetration(hit);
        this._recordCollisionPair(currentProcess.id, id);
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
      if (!this.isCollidable(other)) continue;
      const hit = collideProcesses(currentProcess, other);
      if (hit.hit) {
        this._setPenetration(hit);
        this._recordCollisionPair(currentProcess.id, id);
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
      if (!p || !p.active) continue;
      // p.x/p.y is the process's center (see getCenter in this file).
      const hw = (Number(p.width) || 0) * 0.5;
      const hh = (Number(p.height) || 0) * 0.5;
      if (px >= p.x - hw && px <= p.x + hw &&
        py >= p.y - hh && py <= p.y + hh) return id;
    }
    return 0;
  }

  // Returns ID of the first process of typeCode whose AABB overlaps the
  // given rectangle - used by path_find's grid-blocking test (_nodeBlocked
  // in runtime.js) instead of a single point sample at the cell's center.
  // A center-only test lets a path clip a wall's corner or squeeze
  // through whenever the grid's cell size doesn't line up exactly with
  // the wall's own size/position (the common case - a wall dragged to an
  // arbitrary pixel position on a coarser pathfinding grid), which reads
  // as "the bot cuts through walls" even though A* itself is working
  // correctly off of what the blocked-check told it.
  rectOverlapsType(minX, maxX, minY, maxY, typeCode) {
    const processIds = this.byType.get(typeCode);
    if (!processIds) return 0;
    for (const id of processIds) {
      const p = this.get(id);
      if (!p || !p.active) continue;
      const aabb = processAABB(p);
      if (aabb.maxX <= minX || aabb.minX >= maxX || aabb.maxY <= minY || aabb.minY >= maxY) {
        continue;
      }
      return id;
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
      if (!this.isCollidable(other)) continue;
      const hit = collideProcesses(currentProcess, other, px, py, other.x, other.y);
      if (hit.hit) {
        this._setPenetration(hit);
        this._recordCollisionPair(currentProcess.id, id);
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
      // MAIN is the script itself - killing it would stop the program,
      // which is not what let_me_alone() means. The mouse is an
      // engine-owned process with no compiled body of its own (real DIV's
      // mouse is a separate struct, never a killable process) - killing
      // it here would permanently remove the cursor for the rest of the
      // run, which let_me_alone() was never meant to affect either.
      if (process.isMain || process.isMouse) {
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
    this.byId.clear();
    this.byType.clear();
    this.byName.clear();
    this.nextId = 1;
  }
}
