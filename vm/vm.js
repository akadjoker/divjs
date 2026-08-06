/**
 * DivLang Virtual Machine
 * Executa bytecode Div
 */

import { OpCodes, OpCodeNames } from '../compiler/bytecode.js';

export class VM {
  constructor() {
    // Stack
    this.stack = [];
    this.stackSize = 1024;
    
    // Call stack
    this.callStack = [];
    
    // Locals
    this.locals = [];
    
    // Globals
    this.globals = new Map();
    
    // Constants
    this.constants = [];
    
    // Instruction pointer
    this.ip = 0;
    
    // Running state
    this.running = false;
    this.halted = false;
    
    // Native functions
    this.natives = new Map();
    
    // Processes
    this.processes = [];
    this.activeProcess = null;
    
    // Frame system
    this.frameYield = false;
    
    // Delta time
    this.dt = 1 / 60;
  }
  
  // Register native function
  registerNative(name, fn) {
    this.natives.set(name, fn);
  }
  
  // Load bytecode
  load(bytecode) {
    this.constants = bytecode.constants;
    this.bytecode = bytecode.instructions;
  }
  
  // Run VM
  run() {
    this.running = true;
    this.halted = false;
    this.ip = 0;
    
    while (this.running && !this.halted) {
      this.step();
    }
  }
  
  // Step (execute one instruction)
  step() {
    if (this.ip >= this.bytecode.length) {
      this.halted = true;
      return;
    }
    
    const instr = this.bytecode[this.ip];
    this.execute(instr);
  }
  
  // Execute instruction
  execute(instr) {
    const { opcode, operands } = instr;
    
    switch (opcode) {
      // Stack operations
      case OpCodes.PUSH:
        this.push(operands[0]);
        this.ip++;
        break;
      
      case OpCodes.POP:
        this.pop();
        this.ip++;
        break;
      
      case OpCodes.DUP:
        const top = this.peek();
        this.push(top);
        this.ip++;
        break;
      
      // Load/Store
      case OpCodes.LOAD_LOCAL:
        this.push(this.locals[operands[0]]);
        this.ip++;
        break;
      
      case OpCodes.STORE_LOCAL:
        this.locals[operands[0]] = this.pop();
        this.ip++;
        break;
      
      case OpCodes.LOAD_GLOBAL:
        this.push(this.globals.get(operands[0]) || 0);
        this.ip++;
        break;
      
      case OpCodes.STORE_GLOBAL:
        this.globals.set(operands[0], this.pop());
        this.ip++;
        break;
      
      case OpCodes.LOAD_PARAM:
        this.push(this.params[operands[0]]);
        this.ip++;
        break;
      
      // Arithmetic
      case OpCodes.ADD:
        const b1 = this.pop();
        const a1 = this.pop();
        this.push(a1 + b1);
        this.ip++;
        break;
      
      case OpCodes.SUB:
        const b2 = this.pop();
        const a2 = this.pop();
        this.push(a2 - b2);
        this.ip++;
        break;
      
      case OpCodes.MUL:
        const b3 = this.pop();
        const a3 = this.pop();
        this.push(a3 * b3);
        this.ip++;
        break;
      
      case OpCodes.DIV:
        const b4 = this.pop();
        const a4 = this.pop();
        this.push(a4 / b4);
        this.ip++;
        break;
      
      case OpCodes.MOD:
        const b5 = this.pop();
        const a5 = this.pop();
        this.push(a5 % b5);
        this.ip++;
        break;
      
      case OpCodes.NEG:
        const val = this.pop();
        this.push(-val);
        this.ip++;
        break;
      
      // Comparison
      case OpCodes.EQ:
        const b6 = this.pop();
        const a6 = this.pop();
        this.push(a6 === b6 ? 1 : 0);
        this.ip++;
        break;
      
      case OpCodes.NEQ:
        const b7 = this.pop();
        const a7 = this.pop();
        this.push(a7 !== b7 ? 1 : 0);
        this.ip++;
        break;
      
      case OpCodes.LT:
        const b8 = this.pop();
        const a8 = this.pop();
        this.push(a8 < b8 ? 1 : 0);
        this.ip++;
        break;
      
      case OpCodes.LTE:
        const b9 = this.pop();
        const a9 = this.pop();
        this.push(a9 <= b9 ? 1 : 0);
        this.ip++;
        break;
      
      case OpCodes.GT:
        const b10 = this.pop();
        const a10 = this.pop();
        this.push(a10 > b10 ? 1 : 0);
        this.ip++;
        break;
      
      case OpCodes.GTE:
        const b11 = this.pop();
        const a11 = this.pop();
        this.push(a11 >= b11 ? 1 : 0);
        this.ip++;
        break;
      
      // Logical
      case OpCodes.NOT:
        const val1 = this.pop();
        this.push(val1 === 0 ? 1 : 0);
        this.ip++;
        break;
      
      case OpCodes.AND:
        const b12 = this.pop();
        const a12 = this.pop();
        this.push((a12 !== 0 && b12 !== 0) ? 1 : 0);
        this.ip++;
        break;
      
      case OpCodes.OR:
        const b13 = this.pop();
        const a13 = this.pop();
        this.push((a13 !== 0 || b13 !== 0) ? 1 : 0);
        this.ip++;
        break;
      
      // Control flow
      case OpCodes.JUMP:
        this.ip = operands[0];
        break;
      
      case OpCodes.JUMP_IF_FALSE:
        const cond1 = this.pop();
        if (cond1 === 0) {
          this.ip = operands[0];
        } else {
          this.ip++;
        }
        break;
      
      case OpCodes.JUMP_IF_TRUE:
        const cond2 = this.pop();
        if (cond2 !== 0) {
          this.ip = operands[0];
        } else {
          this.ip++;
        }
        break;
      
      case OpCodes.LOOP:
        this.ip = operands[0];
        break;
      
      case OpCodes.BREAK:
        // TODO: implement break
        this.ip++;
        break;
      
      case OpCodes.CONTINUE:
        // TODO: implement continue
        this.ip++;
        break;
      
      // Call
      case OpCodes.CALL:
        const name = operands[0];
        const argc = operands[1];
        const args = [];
        
        for (let i = 0; i < argc; i++) {
          args.unshift(this.pop());
        }
        
        // TODO: call function
        this.ip++;
        break;
      
      case OpCodes.CALL_NATIVE:
        const nativeName = operands[0];
        const nativeArgc = operands[1];
        const nativeArgs = [];
        
        for (let i = 0; i < nativeArgc; i++) {
          nativeArgs.unshift(this.pop());
        }
        
        const nativeFn = this.natives.get(nativeName);
        if (nativeFn) {
          const result = nativeFn(...nativeArgs);
          if (result !== undefined) {
            this.push(result);
          }
        } else {
          console.warn(`Native function not found: ${nativeName}`);
          this.push(0);
        }
        
        this.ip++;
        break;
      
      case OpCodes.RETURN:
        // TODO: implement return
        this.ip++;
        break;
      
      // Process
      case OpCodes.SPAWN_PROCESS:
        // TODO: spawn process
        this.ip++;
        break;
      
      case OpCodes.FRAME:
        this.frameYield = true;
        this.ip++;
        break;
      
      // Constants
      case OpCodes.LOAD_CONST:
        this.push(this.constants[operands[0]]);
        this.ip++;
        break;
      
      // Special
      case OpCodes.NOP:
        this.ip++;
        break;
      
      case OpCodes.HALT:
        this.halted = true;
        break;
      
      default:
        console.error(`Unknown opcode: ${opcode} (${OpCodeNames[opcode] || 'UNKNOWN'})`);
        this.halted = true;
        break;
    }
  }
  
  // Push value
  push(value) {
    if (this.stack.length >= this.stackSize) {
      throw new Error('Stack overflow');
    }
    this.stack.push(value);
  }
  
  // Pop value
  pop() {
    if (this.stack.length === 0) {
      throw new Error('Stack underflow');
    }
    return this.stack.pop();
  }
  
  // Peek top of stack
  peek() {
    if (this.stack.length === 0) {
      return 0;
    }
    return this.stack[this.stack.length - 1];
  }
  
  // Reset VM
  reset() {
    this.stack = [];
    this.callStack = [];
    this.locals = [];
    this.globals = new Map();
    this.constants = [];
    this.ip = 0;
    this.running = false;
    this.halted = false;
    this.frameYield = false;
  }
}
