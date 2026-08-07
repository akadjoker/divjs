/**
 * DivLang Bytecode Opcodes
 */

export const OpCodes = {
  // Stack operations
  PUSH: 0x01,        // Push value onto stack
  POP: 0x02,         // Pop value from stack
  DUP: 0x03,         // Duplicate top of stack
  
  // Load/Store
  LOAD_LOCAL: 0x10,  // Load local variable
  STORE_LOCAL: 0x11, // Store local variable
  LOAD_GLOBAL: 0x12, // Load global variable
  STORE_GLOBAL: 0x13,// Store global variable
  LOAD_PARAM: 0x14,  // Load parameter
  
  // Arithmetic
  ADD: 0x20,         // Addition
  SUB: 0x21,         // Subtraction
  MUL: 0x22,         // Multiplication
  DIV: 0x23,         // Division
  MOD: 0x24,         // Modulo
  NEG: 0x25,         // Negate
  
  // Comparison
  EQ: 0x30,          // Equal
  NEQ: 0x31,         // Not equal
  LT: 0x32,          // Less than
  LTE: 0x33,         // Less than or equal
  GT: 0x34,          // Greater than
  GTE: 0x35,         // Greater than or equal
  
  // Logical. AND/OR removed: the compiler has emitted short-circuit
  // AND/OR entirely via JUMP_IF_TRUE/JUMP_IF_FALSE chains since f949496,
  // and nothing else in this codebase ever referenced these two values.
  NOT: 0x40,         // Logical not
  
  // Control flow
  JUMP: 0x50,        // Unconditional jump
  JUMP_IF_FALSE: 0x51,// Jump if false
  JUMP_IF_TRUE: 0x52, // Jump if true
  LOOP: 0x53,        // Loop back
  BREAK: 0x54,       // Break from loop
  CONTINUE: 0x55,    // Continue loop
  
  // Call
  CALL: 0x60,        // Call function
  CALL_NATIVE: 0x61, // Call native function
  RETURN: 0x62,      // Return from function
  
  // Process
  SPAWN_PROCESS: 0x70, // Spawn new process
  FRAME: 0x71,       // Frame yield
  
  // Constants
  LOAD_CONST: 0x80,  // Load constant from pool
  
  // Special
  NOP: 0x90,         // No operation
  HALT: 0xFF         // Stop execution
};

// Opcode names (for debugging)
export const OpCodeNames = {};
for (const [name, value] of Object.entries(OpCodes)) {
  OpCodeNames[value] = name;
}
