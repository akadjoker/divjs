/**
 * Rigid-body physics for DIV processes, on Planck.js (a JavaScript port of
 * Box2D, MIT - see THIRD_PARTY_NOTICES.md).
 *
 * A process gets a body with phys_box / phys_circle / phys_edge; from then
 * on the world moves it: every frame, before the processes run, the world
 * takes one fixed step (1 / the program's fps) and writes each body's
 * position and angle back into its process's x, y and angle. A script that
 * moves a process itself (x = ..., angle = ...) moves its body with it.
 * When the process dies, its body goes too.
 *
 * Programs work in their own units - pixels (divided by RESOLUTION, as
 * for drawing) and DIV angles (thousandths of a degree, counter-clockwise,
 * 90000 up). The world works in metres and radians: `scale` pixels make a
 * metre (32 by default; Box2D is tuned for objects of 0.1-10 m), and since
 * screen y grows downwards a DIV angle is the negated body angle.
 */

import * as planck from '../vendor/planck.js';

export const PHYS_STATIC = 0;
export const PHYS_DYNAMIC = 1;
export const PHYS_KINEMATIC = 2;

const DIV_TO_RAD = Math.PI / 180000;
const DEFAULT_SCALE = 32;
const DEFAULT_GRAVITY_Y = 600;     // px/s^2, down

function bodyTypeName(type)
{
  switch (Number(type) || 0)
  {
    case PHYS_DYNAMIC: return 'dynamic';
    case PHYS_KINEMATIC: return 'kinematic';
    default: return 'static';
  }
}

export class PhysicsWorld
{
  constructor()
  {
    this.scale = DEFAULT_SCALE;
    this.gravity = { x: 0, y: DEFAULT_GRAVITY_Y };
    this.world = null;
    // process id -> { process, body, material, last: {x, y, angle} }
    this.entries = new Map();
    this.joints = new Map();
    this.nextJointId = 1;
    // Largest normal impulse each body took in the last step (for damage).
    this.impacts = new Map();
    // phys_material called before the process had a body.
    this.pendingMaterials = new Map();
    // One static body the world pins attach to (phys_pin(0, ...)).
    this.anchor = null;
    this.substeps = 1;
    this.velocityIterations = 8;
    this.positionIterations = 3;
  }

  worldAnchor()
  {
    if (!this.anchor)
    {
      this.anchor = this.ensureWorld().createBody();
    }
    return this.anchor;
  }

  ensureWorld()
  {
    if (!this.world)
    {
      this.world = new planck.World({ gravity: planck.Vec2(this.gravity.x / this.scale, this.gravity.y / this.scale) });
      this.world.on('post-solve', (contact, impulse) =>
      {
        const strongest = Math.max(0, ...impulse.normalImpulses);
        for (const fixture of [contact.getFixtureA(), contact.getFixtureB()])
        {
          const body = fixture.getBody();
          if (strongest > (this.impacts.get(body) || 0))
          {
            this.impacts.set(body, strongest);
          }
        }
      });
    }
    return this.world;
  }

  get bodyCount()
  {
    return this.entries.size;
  }

  // ── Units ─────────────────────────────────────────────────────────────

  static resolutionOf(process)
  {
    return typeof process.getResolution === 'function' ? process.getResolution() : 1;
  }

  toWorld(process, x, y)
  {
    const res = PhysicsWorld.resolutionOf(process);
    return planck.Vec2((Number(x) || 0) / res / this.scale, (Number(y) || 0) / res / this.scale);
  }

  // ── World settings ────────────────────────────────────────────────────

  setGravity(gx, gy)
  {
    this.gravity = { x: Number(gx) || 0, y: Number(gy) || 0 };
    if (this.world)
    {
      this.world.setGravity(planck.Vec2(this.gravity.x / this.scale, this.gravity.y / this.scale));
    }
  }

  // Only before the first body: sizes already given would change meaning.
  setScale(pixelsPerMetre)
  {
    const value = Number(pixelsPerMetre);
    if (this.entries.size > 0 || !(value > 0))
    {
      return 0;
    }
    this.scale = value;
    if (this.world)
    {
      this.world.setGravity(planck.Vec2(this.gravity.x / this.scale, this.gravity.y / this.scale));
    }
    return 1;
  }

  // ── Bodies ────────────────────────────────────────────────────────────

  entryOf(process)
  {
    return process ? this.entries.get(process.id) || null : null;
  }

  // The process's body, created on first use with its current position
  // and angle; a new type replaces the old body's type.
  bodyFor(process, type)
  {
    const world = this.ensureWorld();
    let entry = this.entryOf(process);
    if (!entry)
    {
      const body = world.createBody({
        type: bodyTypeName(type === undefined ? PHYS_DYNAMIC : type),
        position: this.toWorld(process, process.x, process.y),
        angle: -(Number(process.angle) || 0) * DIV_TO_RAD
      });
      body.setUserData(process);
      entry = {
        process,
        body,
        material: this.pendingMaterials.get(process.id) || { density: 1, friction: 0.5, restitution: 0.1 },
        last: { x: process.x, y: process.y, angle: process.angle }
      };
      this.pendingMaterials.delete(process.id);
      this.entries.set(process.id, entry);
    }
    else if (type !== undefined)
    {
      entry.body.setType(bodyTypeName(type));
    }
    return entry;
  }

  addFixture(entry, shape)
  {
    const m = entry.material;
    entry.body.createFixture({ shape, density: m.density, friction: m.friction, restitution: m.restitution });
    entry.body.resetMassData();
  }

  pixels(process, value)
  {
    return (Number(value) || 0) / PhysicsWorld.resolutionOf(process) / this.scale;
  }

  addBox(process, width, height, type, offsetX = 0, offsetY = 0)
  {
    const entry = this.bodyFor(process, type);
    const hw = Math.max(1e-3, this.pixels(process, width) / 2);
    const hh = Math.max(1e-3, this.pixels(process, height) / 2);
    this.addFixture(entry, planck.Box(hw, hh, planck.Vec2(this.pixels(process, offsetX), this.pixels(process, offsetY)), 0));
    return 1;
  }

  addCircle(process, radius, type, offsetX = 0, offsetY = 0)
  {
    const entry = this.bodyFor(process, type);
    const r = Math.max(1e-3, this.pixels(process, radius));
    this.addFixture(entry, planck.Circle(planck.Vec2(this.pixels(process, offsetX), this.pixels(process, offsetY)), r));
    return 1;
  }

  // A segment in the process's own coordinates (relative to its x, y):
  // chains of these make terrain. Edges never move, so they go on a
  // static body.
  addEdge(process, x1, y1, x2, y2)
  {
    const entry = this.entryOf(process) || this.bodyFor(process, PHYS_STATIC);
    const a = planck.Vec2(this.pixels(process, x1), this.pixels(process, y1));
    const b = planck.Vec2(this.pixels(process, x2), this.pixels(process, y2));
    if (planck.Vec2.distance(a, b) < 1e-4)
    {
      return 0;
    }
    this.addFixture(entry, planck.Edge(a, b));
    return 1;
  }

  setMaterial(process, density, friction, restitution)
  {
    const material = {
      density: Math.max(0, Number(density) || 0),
      friction: Math.max(0, Number(friction) || 0),
      restitution: Math.max(0, Number(restitution) || 0)
    };
    const entry = this.entryOf(process);
    if (!entry)
    {
      // Before the body: its shapes will be made with this material.
      this.pendingMaterials.set(process.id, material);
      return 1;
    }
    entry.material = material;
    for (let f = entry.body.getFixtureList(); f; f = f.getNext())
    {
      f.setDensity(entry.material.density);
      f.setFriction(entry.material.friction);
      f.setRestitution(entry.material.restitution);
    }
    entry.body.resetMassData();
    return 1;
  }

  remove(process)
  {
    const entry = this.entryOf(process);
    if (!entry)
    {
      return 0;
    }
    this.destroyEntry(process.id, entry);
    return 1;
  }

  destroyEntry(id, entry)
  {
    for (const [jointId, joint] of this.joints)
    {
      if (joint.getBodyA() === entry.body || joint.getBodyB() === entry.body)
      {
        this.joints.delete(jointId);
      }
    }
    this.impacts.delete(entry.body);
    this.world.destroyBody(entry.body);
    this.entries.delete(id);
  }

  clear()
  {
    for (const [id, entry] of [...this.entries])
    {
      this.destroyEntry(id, entry);
    }
    this.pendingMaterials.clear();
  }

  // ── Motion ────────────────────────────────────────────────────────────

  setVelocity(process, vx, vy)
  {
    const entry = this.entryOf(process);
    if (!entry)
    {
      return 0;
    }
    entry.body.setLinearVelocity(this.toWorld(process, vx, vy));
    entry.body.setAwake(true);
    return 1;
  }

  velocity(process, axis)
  {
    const entry = this.entryOf(process);
    if (!entry)
    {
      return 0;
    }
    const v = entry.body.getLinearVelocity();
    return (axis === 'x' ? v.x : v.y) * this.scale * PhysicsWorld.resolutionOf(process);
  }

  // An impulse in pixel units: it changes the velocity (px/s) by
  // impulse / mass, mass being in kg as reported by phys_mass().
  applyImpulse(process, ix, iy)
  {
    const entry = this.entryOf(process);
    if (!entry)
    {
      return 0;
    }
    entry.body.applyLinearImpulse(this.toWorld(process, ix, iy), entry.body.getWorldCenter(), true);
    return 1;
  }

  applyForce(process, fx, fy)
  {
    const entry = this.entryOf(process);
    if (!entry)
    {
      return 0;
    }
    entry.body.applyForceToCenter(this.toWorld(process, fx, fy), true);
    return 1;
  }

  // DIV angle units per second, counter-clockwise positive.
  setSpin(process, divAnglePerSecond)
  {
    const entry = this.entryOf(process);
    if (!entry)
    {
      return 0;
    }
    entry.body.setAngularVelocity(-(Number(divAnglePerSecond) || 0) * DIV_TO_RAD);
    entry.body.setAwake(true);
    return 1;
  }

  setFlag(process, flag, value)
  {
    const entry = this.entryOf(process);
    if (!entry)
    {
      return 0;
    }
    const on = Boolean(Number(value));
    if (flag === 'fixedRotation')
    {
      entry.body.setFixedRotation(on);
    }
    else if (flag === 'bullet')
    {
      entry.body.setBullet(on);
    }
    else if (flag === 'sensor')
    {
      for (let f = entry.body.getFixtureList(); f; f = f.getNext())
      {
        f.setSensor(on);
      }
    }
    return 1;
  }

  setType(process, type)
  {
    const entry = this.entryOf(process);
    if (!entry)
    {
      return 0;
    }
    entry.body.setType(bodyTypeName(type));
    entry.body.setAwake(true);
    return 1;
  }

  // 1 while the world is simulating the body. Static bodies never move,
  // so they report 0 (Planck leaves a lone static body's flag set).
  awake(process)
  {
    const entry = this.entryOf(process);
    return entry && !entry.body.isStatic() && entry.body.isAwake() ? 1 : 0;
  }

  mass(process)
  {
    const entry = this.entryOf(process);
    return entry ? entry.body.getMass() : 0;
  }

  // ── Contacts ──────────────────────────────────────────────────────────

  // The id of a process of type `typeCode` (any type when 0) whose body is
  // touching this process's body now, or 0.
  contact(process, typeCode)
  {
    const entry = this.entryOf(process);
    if (!entry)
    {
      return 0;
    }
    const code = Number(typeCode) || 0;
    for (let edge = entry.body.getContactList(); edge; edge = edge.next)
    {
      if (!edge.contact.isTouching())
      {
        continue;
      }
      const other = edge.other.getUserData();
      if (other && !other.dead && !other.finished && (code === 0 || other.type === code))
      {
        return other.id;
      }
    }
    return 0;
  }

  // The strongest hit the body took in the last step, as the change of
  // velocity (px/s) it would give this body - comparable across masses,
  // so "impact > 300" means "hit hard" for a pebble and a boulder alike.
  impact(process)
  {
    const entry = this.entryOf(process);
    if (!entry)
    {
      return 0;
    }
    const impulse = this.impacts.get(entry.body) || 0;
    const mass = entry.body.getMass();
    return mass > 0 ? (impulse / mass) * this.scale * PhysicsWorld.resolutionOf(process) : 0;
  }

  // ── Joints ────────────────────────────────────────────────────────────

  // A pin between two processes' bodies at a point (the process's own
  // coordinates); `other` null pins to the world.
  addRevolute(process, other, anchorX, anchorY)
  {
    const a = this.entryOf(process);
    if (!a)
    {
      return 0;
    }
    const world = this.ensureWorld();
    const b = other ? this.entryOf(other) : null;
    const anchor = this.toWorld(process, anchorX, anchorY);
    const bodyB = b ? b.body : this.worldAnchor();
    const joint = world.createJoint(planck.RevoluteJoint({}, a.body, bodyB, anchor));
    return this.keepJoint(joint);
  }

  // Glues two bodies together where they are now.
  addWeld(process, other)
  {
    const a = this.entryOf(process);
    const b = other ? this.entryOf(other) : null;
    if (!a)
    {
      return 0;
    }
    const bodyB = b ? b.body : this.worldAnchor();
    return this.keepJoint(this.ensureWorld().createJoint(planck.WeldJoint({}, a.body, bodyB, a.body.getWorldCenter())));
  }

  // A rope that can go slack: the centres never get further apart than
  // maxLength pixels (the current distance when it is not given).
  addSlack(process, other, maxLength)
  {
    const a = this.entryOf(process);
    const b = other ? this.entryOf(other) : null;
    if (!a || !b)
    {
      return 0;
    }
    const length = maxLength === undefined
      ? planck.Vec2.distance(a.body.getWorldCenter(), b.body.getWorldCenter())
      : this.pixels(process, maxLength);
    const joint = planck.RopeJoint({ maxLength: Math.max(1e-3, length) }, a.body, b.body, planck.Vec2(0, 0));
    joint.m_localAnchorA = planck.Vec2(0, 0);
    joint.m_localAnchorB = planck.Vec2(0, 0);
    return this.keepJoint(this.ensureWorld().createJoint(joint));
  }

  // Revolute joints: the process that made the pin only turns between
  // `lower` and `upper` (DIV angles, counter-clockwise) relative to the
  // other body. Box2D's joint angle is angle(B) - angle(A) in y-down
  // radians, with the caller as A; a DIV angle is a negated body angle,
  // so DIV(A) - DIV(B) = angle(B) - angle(A): the same number, unsigned.
  setLimits(jointId, lower, upper)
  {
    const joint = this.joints.get(Number(jointId));
    if (!joint || typeof joint.setLimits !== 'function')
    {
      return 0;
    }
    const lo = (Number(lower) || 0) * DIV_TO_RAD;
    const hi = (Number(upper) || 0) * DIV_TO_RAD;
    joint.setLimits(Math.min(lo, hi), Math.max(lo, hi));
    joint.enableLimit(true);
    return 1;
  }

  // Revolute joints: the process that made the pin turns at `speed` (DIV
  // angle units per second, counter-clockwise) relative to the other body,
  // with at most `maxTorque` (0 turns the motor off). The motor drives
  // angle(B) - angle(A), which by the reasoning above has the DIV sign.
  setMotor(jointId, speed, maxTorque)
  {
    const joint = this.joints.get(Number(jointId));
    if (!joint || typeof joint.enableMotor !== 'function')
    {
      return 0;
    }
    const torque = Number(maxTorque) || 0;
    joint.enableMotor(torque > 0);
    joint.setMotorSpeed((Number(speed) || 0) * DIV_TO_RAD);
    joint.setMaxMotorTorque(torque);
    joint.getBodyA().setAwake(true);
    joint.getBodyB().setAwake(true);
    return 1;
  }

  // Distance joints: soften into a spring (frequency in Hz, damping 0-1;
  // frequency 0 makes it rigid again).
  setSpring(jointId, frequency, damping)
  {
    const joint = this.joints.get(Number(jointId));
    if (!joint || typeof joint.setFrequency !== 'function')
    {
      return 0;
    }
    joint.setFrequency(Math.max(0, Number(frequency) || 0));
    joint.setDampingRatio(Math.max(0, Number(damping) || 0));
    return 1;
  }

  // A rod of fixed length between the two bodies' centres: their
  // distance now, or `length` pixels.
  addDistance(process, other, length)
  {
    const a = this.entryOf(process);
    const b = other ? this.entryOf(other) : null;
    if (!a || !b)
    {
      return 0;
    }
    const joint = this.ensureWorld().createJoint(planck.DistanceJoint({}, a.body, b.body, a.body.getWorldCenter(), b.body.getWorldCenter()));
    if (joint && length !== undefined)
    {
      joint.setLength(Math.max(1e-3, this.pixels(process, length)));
    }
    return this.keepJoint(joint);
  }

  keepJoint(joint)
  {
    if (!joint)
    {
      return 0;
    }
    const id = this.nextJointId++;
    this.joints.set(id, joint);
    return id;
  }

  removeJoint(id)
  {
    const joint = this.joints.get(Number(id));
    if (!joint)
    {
      return 0;
    }
    this.world.destroyJoint(joint);
    this.joints.delete(Number(id));
    return 1;
  }

  // ── Queries ───────────────────────────────────────────────────────────

  // The id of the process whose body covers the point (x, y), or 0.
  // Coordinates in the calling process's units.
  processAt(caller, x, y)
  {
    if (!this.world)
    {
      return 0;
    }
    const point = this.toWorld(caller, x, y);
    let found = 0;
    const box = planck.AABB(planck.Vec2(point.x - 1e-3, point.y - 1e-3), planck.Vec2(point.x + 1e-3, point.y + 1e-3));
    this.world.queryAABB(box, (fixture) =>
    {
      const p = fixture.getBody().getUserData();
      if (p && !p.dead && !p.finished && fixture.testPoint(point))
      {
        found = p.id;
        return false;
      }
      return true;
    });
    return found;
  }

  // The first body a line from (x1, y1) to (x2, y2) hits: its process id
  // (0 for none) and the hit point in pixels.
  raycast(caller, x1, y1, x2, y2)
  {
    if (!this.world)
    {
      return { id: 0 };
    }
    const from = this.toWorld(caller, x1, y1);
    const to = this.toWorld(caller, x2, y2);
    if (planck.Vec2.distance(from, to) < 1e-6)
    {
      return { id: 0 };
    }
    let best = null;
    this.world.rayCast(from, to, (fixture, point, normal, fraction) =>
    {
      const p = fixture.getBody().getUserData();
      if (!p || p.dead || p.finished || p === caller)
      {
        return -1;                     // ignore this one, keep looking
      }
      best = { id: p.id, x: point.x, y: point.y };
      return fraction;                 // only look for closer hits
    });
    if (!best)
    {
      return { id: 0 };
    }
    const k = this.scale * PhysicsWorld.resolutionOf(caller);
    return { id: best.id, x: best.x * k, y: best.y * k };
  }

  setIterations(velocity, position)
  {
    this.velocityIterations = Math.max(1, Math.min(100, Math.round(Number(velocity) || 8)));
    this.positionIterations = Math.max(1, Math.min(100, Math.round(Number(position) || 3)));
    return 1;
  }

  setSubsteps(n)
  {
    this.substeps = Math.max(1, Math.min(16, Math.round(Number(n) || 1)));
    return 1;
  }

  // ── The frame ─────────────────────────────────────────────────────────

  // One fixed step, then every body's position and angle into its process.
  step(dt)
  {
    if (!this.world || this.entries.size === 0)
    {
      return;
    }
    for (const [id, entry] of [...this.entries])
    {
      const p = entry.process;
      if (p.dead || p.finished)
      {
        this.destroyEntry(id, entry);
        continue;
      }
      // Moved by the script since the last step: the body follows.
      if (p.x !== entry.last.x || p.y !== entry.last.y || p.angle !== entry.last.angle)
      {
        entry.body.setTransform(this.toWorld(p, p.x, p.y), -(Number(p.angle) || 0) * DIV_TO_RAD);
        entry.body.setAwake(true);
      }
    }
    this.impacts.clear();
    const frame = Math.min(Math.max(Number(dt) || 0, 1 / 240), 1 / 15);
    for (let i = 0; i < this.substeps; i++)
    {
      this.world.step(frame / this.substeps, this.velocityIterations, this.positionIterations);
    }
    for (const entry of this.entries.values())
    {
      const p = entry.process;
      const res = PhysicsWorld.resolutionOf(p);
      const pos = entry.body.getPosition();
      const x = pos.x * this.scale * res;
      const y = pos.y * this.scale * res;
      const angle = -entry.body.getAngle() / DIV_TO_RAD;
      p.x = x;
      p.y = y;
      p.angle = angle;
      p.locals[0] = x;
      p.locals[1] = y;
      p.locals[7] = angle;
      entry.last = { x, y, angle };
    }
  }

  // Outlines of a process's fixtures in pixels relative to the process
  // position (for the debug overlay): [{circle: [cx, cy, r]} | {points}].
  debugShapes(process)
  {
    const entry = this.entryOf(process);
    if (!entry)
    {
      return [];
    }
    const res = PhysicsWorld.resolutionOf(process);
    const k = this.scale * res;
    const body = entry.body;
    const pos = body.getPosition();
    const out = [];
    for (let f = body.getFixtureList(); f; f = f.getNext())
    {
      const shape = f.getShape();
      const type = shape.getType();
      if (type === 'circle')
      {
        const c = body.getWorldPoint(shape.getCenter());
        out.push({ circle: [(c.x - pos.x) * k, (c.y - pos.y) * k, shape.getRadius() * k] });
      }
      else if (type === 'polygon' || type === 'edge')
      {
        const vertices = type === 'edge' ? [shape.m_vertex1, shape.m_vertex2] : shape.m_vertices;
        out.push({
          points: vertices.map((v) =>
          {
            const w = body.getWorldPoint(v);
            return [(w.x - pos.x) * k, (w.y - pos.y) * k];
          }),
          closed: type === 'polygon'
        });
      }
    }
    return out;
  }
}
