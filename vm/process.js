/**
 * DivLang Process Manager
 * Cada processo tem seu próprio contexto (ip, stack, locals)
 */

import { hashCode } from '../utils/hash.js';

// Process types (constants)
export const ProcessType = {
  NONE: 0,
  SOLID: 1,
  SENSOR: 2,
  PLATFORM: 3,
  ONEWAY: 4,
  SHOT: 5,
  DANGER: 6
};

export class Process {
  constructor(name, params = {}) {
    this.name = name;
    this.id = params.id || 0;
    this.type = hashCode(name); // Tipo = hash do nome
    this.parentId = params.parentId || 0;
    
    // Position (locals especiais - slots fixos)
    this.x = params.x || 0;
    this.y = params.y || 0;
    this.width = params.width || 32;
    this.height = params.height || 32;
    
    // Private variables
    this.privates = params;
    
    // State
    this.active = true;
    this.suspended = false;
    this.finished = false;
    this.dead = false; // Marked for removal
    
    // VM context (coroutine)
    this.ip = 0;           // Instruction pointer
    this.stack = [];       // Stack próprio
    this.locals = [];      // Locais próprios
    
    // Sincronizar x, y com locals (slots fixos: 0=x, 1=y, 2=width, 3=height)
    this.locals[0] = this.x;
    this.locals[1] = this.y;
    this.locals[2] = this.width;
    this.locals[3] = this.height;
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
  
  // Sincronizar locals com x, y (chamar no fim do frame)
  sync() {
    this.x = this.locals[0] ?? this.x;
    this.y = this.locals[1] ?? this.y;
    this.width = this.locals[2] ?? this.width;
    this.height = this.locals[3] ?? this.height;
  }
}

export class ProcessManager {
  constructor() {
    this.processes = [];           // Array de todos os processos
    this.byType = new Map();       // Map<type, Set<processId>>
    this.byName = new Map();       // Map<name, Set<processId>>
    this.nextId = 1;               // IDs começam em 1 (0 = null)
  }
  
  // Create process
  create(name, params = {}) {
    const process = new Process(name, params);
    process.id = this.nextId++;
    
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
    // Sincronizar x, y antes de remover
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

  applySignal(process, signalCode) {
    if (!process || process.dead) {
      return 0;
    }

    switch (signalCode) {
      case 0: // suspend
        process.suspended = true;
        return 1;
      case 1: // wake up
        process.suspended = false;
        return 1;
      case 100: // kill tree / s_kill_tree
        process.kill();
        return 1;
      default:
        return 0;
    }
  }

  signalById(targetId, signalCode) {
    const target = this.get(targetId);
    if (!target) {
      return 0;
    }

    if (signalCode !== 100) {
      return this.applySignal(target, signalCode);
    }

    // Kill whole subtree rooted at target.
    let affected = 0;
    const stack = [target.id];
    while (stack.length > 0) {
      const id = stack.pop();
      const process = this.get(id);
      if (!process || process.dead) {
        continue;
      }

      affected += this.applySignal(process, signalCode);
      for (const candidate of this.processes) {
        if (candidate.parentId === id && !candidate.dead) {
          stack.push(candidate.id);
        }
      }
    }
    return affected;
  }

  signalByType(typeCode, signalCode) {
    let affected = 0;
    for (const process of this.getByType(typeCode)) {
      affected += this.applySignal(process, signalCode);
    }
    return affected;
  }

  letMeAlone(currentProcess) {
    if (!currentProcess) {
      return 0;
    }

    let removed = 0;
    for (const process of this.processes) {
      if (process.id === currentProcess.id || process.dead) {
        continue;
      }
      process.kill();
      removed += 1;
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
