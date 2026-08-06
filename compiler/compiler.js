import { OpCodes } from './bytecode.js';

export class Compiler {
  constructor() {
    this.constants = [];
    this.instructions = [];
    this.stringMap = new Map();
    this.localMap = new Map();
    this.globalMap = new Map();
    this.processTable = new Map();
    this.functionTable = new Map();
  }

  // Compile program
  compile(program) {
    this.constants = [];
    this.instructions = [];
    this.stringMap = new Map();
    this.localMap = new Map();
    this.globalMap = new Map();
    this.processTable = new Map();
    this.functionTable = new Map();
    
    // Compile globals first
    for (const stmt of program.statements) {
      if (stmt.type === 'global') {
        this.compileGlobal(stmt);
      }
    }
    
    // Compile processes
    for (const stmt of program.statements) {
      if (stmt.type === 'process') {
        this.compileProcess(stmt);
      }
    }
    
    return {
      constants: this.constants,
      instructions: this.instructions,
      processTable: this.processTable,
      functionTable: this.functionTable
    };
  }

  // Compile global
  compileGlobal(stmt) {
    const idx = this.globalMap.size;
    this.globalMap.set(stmt.name, idx);
    
    if (stmt.value) {
      this.compileExpression(stmt.value);
      this.emit(OpCodes.STORE_GLOBAL, idx);
    } else {
      this.emit(OpCodes.LOAD_CONST, 0);
      this.emit(OpCodes.STORE_GLOBAL, idx);
    }
  }

  // Compile process
  compileProcess(stmt) {
    const startAddr = this.instructions.length;
    
    // Store process in table
    this.processTable.set(stmt.name, {
      addr: startAddr,
      params: stmt.params
    });
    
    // Reset locals for this process
    this.localMap = new Map();
    
    // Add params as locals
    for (let i = 0; i < stmt.params.length; i++) {
      this.localMap.set(stmt.params[i], i);
    }
    
    // Compile body
    this.compileBlock(stmt.body);
    
    // Emit RETURN if not present
    if (this.instructions.length === 0 || 
        this.instructions[this.instructions.length - 1].opcode !== OpCodes.RETURN) {
      this.emit(OpCodes.RETURN);
    }
    
    return startAddr;
  }

  // Compile block
  compileBlock(block) {
    for (const stmt of block.statements) {
      this.compileStatement(stmt);
    }
  }

  // Compile statement
  compileStatement(stmt) {
    switch (stmt.type) {
      case 'block':
        this.compileBlock(stmt);
        break;
      
      case 'if':
        this.compileIf(stmt);
        break;
      
      case 'for':
        this.compileFor(stmt);
        break;
      
      case 'while':
        this.compileWhile(stmt);
        break;
      
      case 'repeat':
        this.compileRepeat(stmt);
        break;
      
      case 'loop':
        this.compileLoop(stmt);
        break;
      
      case 'frame':
        this.emit(OpCodes.FRAME);
        break;
      
      case 'private':
        this.compilePrivate(stmt);
        break;
      
      case 'var':
        this.compileVar(stmt);
        break;
      
      case 'return':
        if (stmt.value) {
          this.compileExpression(stmt.value);
        }
        this.emit(OpCodes.RETURN);
        break;
      
      case 'break':
        this.emit(OpCodes.BREAK);
        break;
      
      case 'continue':
        this.emit(OpCodes.CONTINUE);
        break;
      
      case 'expression':
        this.compileExpression(stmt.expression);
        this.emit(OpCodes.POP);
        break;
      
      case 'assign':
        this.compileAssignment(stmt);
        break;
      
      default:
        throw new Error(`Unknown statement type: ${stmt.type}`);
    }
  }

  // Compile if
  compileIf(stmt) {
    this.compileExpression(stmt.condition);
    this.emit(OpCodes.JUMP_IF_FALSE, 0); // Placeholder
    const jumpToElse = this.instructions.length - 1;
    
    this.compileBlock(stmt.thenBranch);
    
    if (stmt.elseBranch) {
      this.emit(OpCodes.JUMP, 0); // Placeholder
      const jumpToEnd = this.instructions.length - 1;
      
      this.instructions[jumpToElse].operands[0] = this.instructions.length;
      
      this.compileBlock(stmt.elseBranch);
      
      this.instructions[jumpToEnd].operands[0] = this.instructions.length;
    } else {
      this.instructions[jumpToElse].operands[0] = this.instructions.length;
    }
  }

  // Compile for
  compileFor(stmt) {
    const varIdx = this.localMap.size;
    this.localMap.set(stmt.varName, varIdx);
    
    this.compileExpression(stmt.start);
    this.emit(OpCodes.STORE_LOCAL, varIdx);
    
    const loopStart = this.instructions.length;
    
    this.emit(OpCodes.LOAD_LOCAL, varIdx);
    this.compileExpression(stmt.end);
    this.emit(OpCodes.GT);
    this.emit(OpCodes.JUMP_IF_TRUE, 0); // Placeholder
    const jumpToEnd = this.instructions.length - 1;
    
    this.compileBlock(stmt.body);
    
    this.emit(OpCodes.LOAD_LOCAL, varIdx);
    this.compileExpression(stmt.step);
    this.emit(OpCodes.ADD);
    this.emit(OpCodes.STORE_LOCAL, varIdx);
    
    this.emit(OpCodes.LOOP, loopStart);
    
    this.instructions[jumpToEnd].operands[0] = this.instructions.length;
  }

  // Compile while
  compileWhile(stmt) {
    const loopStart = this.instructions.length;
    
    this.compileExpression(stmt.condition);
    this.emit(OpCodes.JUMP_IF_FALSE, 0); // Placeholder
    const jumpToEnd = this.instructions.length - 1;
    
    this.compileBlock(stmt.body);
    
    this.emit(OpCodes.LOOP, loopStart);
    
    this.instructions[jumpToEnd].operands[0] = this.instructions.length;
  }

  // Compile repeat
  compileRepeat(stmt) {
    const loopStart = this.instructions.length;
    
    this.compileBlock(stmt.body);
    
    this.compileExpression(stmt.condition);
    this.emit(OpCodes.JUMP_IF_FALSE, loopStart);
  }

  // Compile loop
  compileLoop(stmt) {
    const loopStart = this.instructions.length;
    
    this.compileBlock(stmt.body);
    
    this.emit(OpCodes.LOOP, loopStart);
  }

  // Compile private
  compilePrivate(stmt) {
    const idx = this.localMap.size;
    this.localMap.set(stmt.name, idx);
    
    if (stmt.value) {
      this.compileExpression(stmt.value);
    } else {
      this.emit(OpCodes.LOAD_CONST, 0);
    }
    
    this.emit(OpCodes.STORE_LOCAL, idx);
  }

  // Compile var
  compileVar(stmt) {
    const idx = this.localMap.size;
    this.localMap.set(stmt.name, idx);
    
    this.compileExpression(stmt.value);
    this.emit(OpCodes.STORE_LOCAL, idx);
  }

  // Compile assignment
  compileAssignment(stmt) {
    if (stmt.target.type === 'identifier') {
      const name = stmt.target.name;
      
      // Check if local
      if (this.localMap.has(name)) {
        this.compileExpression(stmt.value);
        this.emit(OpCodes.STORE_LOCAL, this.localMap.get(name));
      }
      // Check if global
      else if (this.globalMap.has(name)) {
        this.compileExpression(stmt.value);
        this.emit(OpCodes.STORE_GLOBAL, this.globalMap.get(name));
      }
      else {
        throw new Error(`Unknown variable: ${name}`);
      }
    }
  }

  // Compile expression
  compileExpression(expr) {
    switch (expr.type) {
      case 'number':
        this.emit(OpCodes.LOAD_CONST, this.addConstant(expr.value));
        break;
      
      case 'string':
        this.emit(OpCodes.LOAD_CONST, this.addConstant(expr.value));
        break;
      
      case 'identifier':
        this.compileIdentifier(expr);
        break;
      
      case 'binary':
        this.compileBinary(expr);
        break;
      
      case 'unary':
        this.compileUnary(expr);
        break;
      
      case 'call':
        this.compileCall(expr);
        break;
      
      case 'assign':
        this.compileAssignment(expr);
        break;
      
      default:
        throw new Error(`Unknown expression type: ${expr.type}`);
    }
  }

  // Compile identifier
  compileIdentifier(expr) {
    const name = expr.name;
    
    // Check if local
    if (this.localMap.has(name)) {
      this.emit(OpCodes.LOAD_LOCAL, this.localMap.get(name));
    }
    // Check if global
    else if (this.globalMap.has(name)) {
      this.emit(OpCodes.LOAD_GLOBAL, this.globalMap.get(name));
    }
    else {
      throw new Error(`Unknown variable: ${name}`);
    }
  }

  // Compile binary
  compileBinary(expr) {
    this.compileExpression(expr.left);
    this.compileExpression(expr.right);
    
    switch (expr.operator) {
      case '+':
        this.emit(OpCodes.ADD);
        break;
      case '-':
        this.emit(OpCodes.SUB);
        break;
      case '*':
        this.emit(OpCodes.MUL);
        break;
      case '/':
        this.emit(OpCodes.DIV);
        break;
      case '%':
        this.emit(OpCodes.MOD);
        break;
      case '==':
        this.emit(OpCodes.EQ);
        break;
      case '!=':
        this.emit(OpCodes.NEQ);
        break;
      case '<':
        this.emit(OpCodes.LT);
        break;
      case '<=':
        this.emit(OpCodes.LTE);
        break;
      case '>':
        this.emit(OpCodes.GT);
        break;
      case '>=':
        this.emit(OpCodes.GTE);
        break;
      case '&&':
        this.emit(OpCodes.AND);
        break;
      case '||':
        this.emit(OpCodes.OR);
        break;
      default:
        throw new Error(`Unknown binary operator: ${expr.operator}`);
    }
  }

  // Compile unary
  compileUnary(expr) {
    this.compileExpression(expr.operand);
    
    switch (expr.operator) {
      case '-':
        this.emit(OpCodes.NEG);
        break;
      case '!':
        this.emit(OpCodes.NOT);
        break;
      default:
        throw new Error(`Unknown unary operator: ${expr.operator}`);
    }
  }

  // Compile call
  compileCall(expr) {
    // Check if process call
    if (expr.callee.type === 'identifier' && this.processTable.has(expr.callee.name)) {
      // Compile args
      for (const arg of expr.args) {
        this.compileExpression(arg);
      }
      
      // Emit SPAWN_PROCESS
      this.emit(OpCodes.SPAWN_PROCESS, expr.callee.name, expr.args.length);
    }
    // Check if native
    else if (expr.callee.type === 'identifier') {
      // Compile args
      for (const arg of expr.args) {
        this.compileExpression(arg);
      }
      
      this.emit(OpCodes.CALL_NATIVE, expr.callee.name, expr.args.length);
    }
  }

  // Add constant
  addConstant(value) {
    this.constants.push(value);
    return this.constants.length - 1;
  }

  // Emit instruction
  emit(opcode, ...operands) {
    this.instructions.push({ opcode, operands });
  }
}
