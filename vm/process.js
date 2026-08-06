/**
 * DivLang Process Manager
 * Gerencia processos concorrentes
 */

export class Process {
  constructor(name, params = {}) {
    this.name = name;
    this.params = params;
    this.privates = {};
    this.type = 0; // SOLID = 0, SENSOR = 1, etc.
    this.graph = null;
    
    // Position
    this.x = params.x || 0;
    this.y = params.y || 0;
    this.width = params.width || 32;
    this.height = params.height || 32;
    
    // State
    this.active = true;
    this.suspended = false;
    
    // VM state
    this.vm = null;
    this.ip = 0;
    this.stack = [];
    this.locals = [];
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
}

export class ProcessManager {
  constructor(vm) {
    this.vm = vm;
    this.processes = [];
    this.processMap = new Map();
    this.nextId = 0;
  }
  
  // Create process
  create(name, params = {}) {
    const process = new Process(name, params);
    process.id = this.nextId++;
    
    this.processes.push(process);
    this.processMap.set(process.id, process);
    
    return process;
  }
  
  // Get process by ID
  get(id) {
    return this.processMap.get(id);
  }
  
  // Remove process
  remove(id) {
    const index = this.processes.findIndex(p => p.id === id);
    if (index !== -1) {
      this.processes.splice(index, 1);
      this.processMap.delete(id);
    }
  }
  
  // Get all processes
  getAll() {
    return this.processes;
  }
  
  // Get processes by type
  getByType(type) {
    return this.processes.filter(p => p.type === type);
  }
  
  // Get active processes
  getActive() {
    return this.processes.filter(p => p.active);
  }
  
  // Update all processes
  update(dt) {
    for (const process of this.processes) {
      if (process.active && !process.suspended) {
        // TODO: execute process VM
      }
    }
  }
  
  // Collision detection
  checkCollisions() {
    const active = this.getActive();
    const collisions = [];
    
    for (let i = 0; i < active.length; i++) {
      for (let j = i + 1; j < active.length; j++) {
        const a = active[i];
        const b = active[j];
        
        if (a.collidesWith(b)) {
          collisions.push({ a, b });
        }
      }
    }
    
    return collisions;
  }
}

// Process types
export const ProcessType = {
  NONE: 0,
  SOLID: 1,
  SENSOR: 2,
  PLATFORM: 3,
  ONEWAY: 4,
  SHOT: 5,
  DANGER: 6
};
