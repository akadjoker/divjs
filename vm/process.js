/**
 * DivLang Process Manager
 * Cada processo tem seu próprio contexto (ip, stack, locals)
 */

import { hashCode } from '../utils/hash.js';

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
    this.parentId = params.parentId ?? 0;

    // Private variables
    this.privates = params;

    // State
    this.active = true;
    this.suspended = false;
    this.finished = false;
    this.dead = false; // Marked for removal
    this.frameValue = 100;

    // VM context (coroutine)
    this.ip = 0;           // Instruction pointer
    this.stack = [];       // Stack proprio
    this.locals = [];      // Locais proprios

    // Sincronizar com locals (slots fixos: 0=x, 1=y, 2=width, 3=height, 4=ctype, 5=id, 6=region, 7=angle)
    this.locals[0] = this.x;
    this.locals[1] = this.y;
    this.locals[2] = this.width;
    this.locals[3] = this.height;
    this.locals[4] = this.ctype;
    this.locals[5] = this.id;
    this.locals[6] = this.region;
    this.locals[7] = this.angle;
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
    const a = this.getBounds();
    const b = other.getBounds();

    return a.x < b.x + b.width &&
           a.x + a.width > b.x &&
           a.y < b.y + b.height &&
           a.y + a.height > b.y;
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
  }
}

export class ProcessManager {
  constructor() {
    this.processes = [];           // Array de todos os processos
    this.byType = new Map();       // Map<type, Set<processId>>
    this.byName = new Map();       // Map<name, Set<processId>>
    this.nextId = 1;               // IDs comecam em 1 (0 = null)
  }

  // Create process
  create(name, params = {}) {
    const process = new Process(name, params);
    process.id = this.nextId++;
    process.locals[5] = process.id;
    process.locals[6] = process.region;
    process.locals[7] = process.angle;

    this.processes.push(process);

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
      const other = this.get(id);
      if (other && other.active && currentProcess.collidesWith(other)) {
        return id; // Returns ID of colliding process
      }
    }

    return 0; // No collision
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
