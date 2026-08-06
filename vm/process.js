/**
 * DivLang Process Manager
 * Cada processo tem seu próprio contexto (ip, stack, locals)
 */

// Hash function
function hashCode(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash);
}

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
    
    // Position (locals especiais)
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
