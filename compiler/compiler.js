/**
 * DivLang Compiler
 * AST → Bytecode
 */

import * as ast from '../parser/ast.js';
import { OpCodes, Bytecode } from './bytecode.js';

export class Compiler {
  constructor() {
    this.bytecode = new Bytecode();
    this.scopes = [];
    this.scopeIndex = 0;
  }
  
  // Compile program
  compile(program) {
    // Compile globals
    for (const global of program.globals) {
      this.bytecode.emit(OpCodes.LOAD_CONST, this.bytecode.addConstant(global.name));
      
      if (global.init) {
        this.compileExpression(global.init);
      } else {
        this.bytecode.emit(OpCodes.LOAD_CONST, this.bytecode.addConstant(0));
      }
      
      this.bytecode.emit(OpCodes.STORE_GLOBAL, this.scopeIndex++);
    }
    
    // Compile processes
    for (const process of program.processes) {
      this.compileProcess(process);
    }
    
    // Compile functions
    for (const func of program.functions) {
      this.compileFunction(func);
    }
    
    // Emit HALT
    this.bytecode.emit(OpCodes.HALT);
    
    return this.bytecode;
  }
  
  // Compile process
  compileProcess(process) {
    const startAddr = this.bytecode.instructionCount();
    
    // Push scope
    this.pushScope();
    
    // Compile parameters
    for (const param of process.params) {
      this.bytecode.emit(OpCodes.LOAD_CONST, this.bytecode.addConstant(param.name));
      
      if (param.init) {
        this.compileExpression(param.init);
      } else {
        this.bytecode.emit(OpCodes.LOAD_CONST, this.bytecode.addConstant(0));
      }
      
      this.bytecode.emit(OpCodes.STORE_LOCAL, this.scopeIndex++);
    }
    
    // Compile privates
    for (const priv of process.privates) {
      this.bytecode.emit(OpCodes.LOAD_CONST, this.bytecode.addConstant(priv.name));
      
      if (priv.init) {
        this.compileExpression(priv.init);
      } else {
        this.bytecode.emit(OpCodes.LOAD_CONST, this.bytecode.addConstant(0));
      }
      
      this.bytecode.emit(OpCodes.STORE_LOCAL, this.scopeIndex++);
    }
    
    // Compile body
    this.compileStatements(process.body);
    
    // Pop scope
    this.popScope();
    
    return startAddr;
  }
  
  // Compile function
  compileFunction(func) {
    const startAddr = this.bytecode.instructionCount();
    
    // Push scope
    this.pushScope();
    
    // Compile parameters
    for (const param of func.params) {
      this.bytecode.emit(OpCodes.LOAD_CONST, this.bytecode.addConstant(param.name));
      
      if (param.init) {
        this.compileExpression(param.init);
      } else {
        this.bytecode.emit(OpCodes.LOAD_CONST, this.bytecode.addConstant(0));
      }
      
      this.bytecode.emit(OpCodes.STORE_LOCAL, this.scopeIndex++);
    }
    
    // Compile privates
    for (const priv of func.privates) {
      this.bytecode.emit(OpCodes.LOAD_CONST, this.bytecode.addConstant(priv.name));
      
      if (priv.init) {
        this.compileExpression(priv.init);
      } else {
        this.bytecode.emit(OpCodes.LOAD_CONST, this.bytecode.addConstant(0));
      }
      
      this.bytecode.emit(OpCodes.STORE_LOCAL, this.scopeIndex++);
    }
    
    // Compile body
    this.compileStatements(func.body);
    
    // Pop scope
    this.popScope();
    
    return startAddr;
  }
  
  // Compile statements
  compileStatements(statements) {
    for (const stmt of statements) {
      this.compileStatement(stmt);
    }
  }
  
  // Compile statement
  compileStatement(stmt) {
    switch (stmt.type) {
      case 'block':
        this.compileStatements(stmt.statements);
        break;
      
      case 'assignment':
        this.compileAssignment(stmt);
        break;
      
      case 'if':
        this.compileIf(stmt);
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
      
      case 'for':
        this.compileFor(stmt);
        break;
      
      case 'break':
        this.bytecode.emit(OpCodes.BREAK);
        break;
      
      case 'continue':
        this.bytecode.emit(OpCodes.CONTINUE);
        break;
      
      case 'return':
        if (stmt.value) {
          this.compileExpression(stmt.value);
        }
        this.bytecode.emit(OpCodes.RETURN);
        break;
      
      case 'frame':
        this.bytecode.emit(OpCodes.FRAME);
        break;
      
      case 'expression':
        this.compileExpression(stmt.expression);
        this.bytecode.emit(OpCodes.POP);
        break;
    }
  }
  
  // Compile assignment
  compileAssignment(assignment) {
    this.compileExpression(assignment.value);
    
    if (assignment.target.type === 'identifier') {
      const index = this.resolveLocal(assignment.target.name);
      if (index !== -1) {
        this.bytecode.emit(OpCodes.STORE_LOCAL, index);
      } else {
        this.bytecode.emit(OpCodes.STORE_GLOBAL, this.scopeIndex);
      }
    }
  }
  
  // Compile IF
  compileIf(stmt) {
    this.compileExpression(stmt.condition);
    
    const jumpToElse = this.bytecode.emit(OpCodes.JUMP_IF_FALSE, 0);
    
    this.compileStatements(stmt.thenBlock);
    
    if (stmt.elseBlock) {
      const jumpToEnd = this.bytecode.emit(OpCodes.JUMP, 0);
      this.bytecode.patchJump(jumpToElse, this.bytecode.instructionCount());
      
      this.compileStatements(stmt.elseBlock);
      
      this.bytecode.patchJump(jumpToEnd, this.bytecode.instructionCount());
    } else {
      this.bytecode.patchJump(jumpToElse, this.bytecode.instructionCount());
    }
  }
  
  // Compile WHILE
  compileWhile(stmt) {
    const loopStart = this.bytecode.instructionCount();
    
    this.compileExpression(stmt.condition);
    
    const jumpToBody = this.bytecode.emit(OpCodes.JUMP_IF_TRUE, 0);
    const jumpToEnd = this.bytecode.emit(OpCodes.JUMP, 0);
    
    this.bytecode.patchJump(jumpToBody, this.bytecode.instructionCount());
    this.compileStatements(stmt.body);
    
    this.bytecode.emit(OpCodes.JUMP, loopStart);
    this.bytecode.patchJump(jumpToEnd, this.bytecode.instructionCount());
  }
  
  // Compile REPEAT
  compileRepeat(stmt) {
    const loopStart = this.bytecode.instructionCount();
    
    this.compileStatements(stmt.body);
    
    this.compileExpression(stmt.condition);
    
    const jumpToStart = this.bytecode.emit(OpCodes.JUMP_IF_FALSE, 0);
    this.bytecode.patchJump(jumpToStart, loopStart);
  }
  
  // Compile LOOP
  compileLoop(stmt) {
    const loopStart = this.bytecode.instructionCount();
    
    this.compileStatements(stmt.body);
    
    this.bytecode.emit(OpCodes.JUMP, loopStart);
  }
  
  // Compile FOR
  compileFor(stmt) {
    this.compileExpression(stmt.from);
    this.bytecode.emit(OpCodes.STORE_LOCAL, this.scopeIndex);
    
    const loopStart = this.bytecode.instructionCount();
    
    this.bytecode.emit(OpCodes.LOAD_LOCAL, this.scopeIndex);
    this.compileExpression(stmt.to);
    this.bytecode.emit(OpCodes.GT);
    
    const jumpToBody = this.bytecode.emit(OpCodes.JUMP_IF_FALSE, 0);
    const jumpToEnd = this.bytecode.emit(OpCodes.JUMP, 0);
    
    this.bytecode.patchJump(jumpToBody, this.bytecode.instructionCount());
    this.compileStatements(stmt.body);
    
    this.bytecode.emit(OpCodes.LOAD_LOCAL, this.scopeIndex);
    
    if (stmt.step) {
      this.compileExpression(stmt.step);
    } else {
      this.bytecode.emit(OpCodes.LOAD_CONST, this.bytecode.addConstant(1));
    }
    
    this.bytecode.emit(OpCodes.ADD);
    this.bytecode.emit(OpCodes.STORE_LOCAL, this.scopeIndex);
    
    this.bytecode.emit(OpCodes.JUMP, loopStart);
    this.bytecode.patchJump(jumpToEnd, this.bytecode.instructionCount());
  }
  
  // Compile expression
  compileExpression(expr) {
    switch (expr.type) {
      case 'number':
        this.bytecode.emit(OpCodes.LOAD_CONST, this.bytecode.addConstant(expr.value));
        break;
      
      case 'string':
        this.bytecode.emit(OpCodes.LOAD_CONST, this.bytecode.addConstant(expr.value));
        break;
      
      case 'boolean':
        this.bytecode.emit(OpCodes.LOAD_CONST, this.bytecode.addConstant(expr.value ? 1 : 0));
        break;
      
      case 'null':
        this.bytecode.emit(OpCodes.LOAD_CONST, this.bytecode.addConstant(null));
        break;
      
      case 'identifier':
        const index = this.resolveLocal(expr.name);
        if (index !== -1) {
          this.bytecode.emit(OpCodes.LOAD_LOCAL, index);
        } else {
          this.bytecode.emit(OpCodes.LOAD_GLOBAL, 0); // TODO: resolve global
        }
        break;
      
      case 'binary':
        this.compileExpression(expr.left);
        this.compileExpression(expr.right);
        
        switch (expr.operator) {
          case '+': this.bytecode.emit(OpCodes.ADD); break;
          case '-': this.bytecode.emit(OpCodes.SUB); break;
          case '*': this.bytecode.emit(OpCodes.MUL); break;
          case '/': this.bytecode.emit(OpCodes.DIV); break;
          case '%': this.bytecode.emit(OpCodes.MOD); break;
          case '==': this.bytecode.emit(OpCodes.EQ); break;
          case '!=': this.bytecode.emit(OpCodes.NEQ); break;
          case '<': this.bytecode.emit(OpCodes.LT); break;
          case '<=': this.bytecode.emit(OpCodes.LTE); break;
          case '>': this.bytecode.emit(OpCodes.GT); break;
          case '>=': this.bytecode.emit(OpCodes.GTE); break;
          case '&&': this.bytecode.emit(OpCodes.AND); break;
          case '||': this.bytecode.emit(OpCodes.OR); break;
        }
        break;
      
      case 'unary':
        this.compileExpression(expr.operand);
        
        switch (expr.operator) {
          case '-': this.bytecode.emit(OpCodes.NEG); break;
          case '!': this.bytecode.emit(OpCodes.NOT); break;
        }
        break;
      
      case 'call':
        for (const arg of expr.args) {
          this.compileExpression(arg);
        }
        
        if (expr.callee.type === 'identifier') {
          const name = expr.callee.name;
          
          // Native functions
          const natives = ['collision', 'key_pressed', 'key_down', 'load_graphic', 'draw', 'draw_text', 'draw_rect'];
          if (natives.includes(name)) {
            this.bytecode.emit(OpCodes.CALL_NATIVE, name, expr.args.length);
          } else {
            this.bytecode.emit(OpCodes.CALL, name, expr.args.length);
          }
        }
        break;
      
      case 'type_operator':
        this.bytecode.emit(OpCodes.LOAD_CONST, this.bytecode.addConstant('type'));
        this.bytecode.emit(OpCodes.LOAD_CONST, this.bytecode.addConstant(expr.processName));
        break;
    }
  }
  
  // Push scope
  pushScope() {
    this.scopes.push(new Map());
  }
  
  // Pop scope
  popScope() {
    this.scopes.pop();
  }
  
  // Declare local
  declareLocal(name) {
    if (this.scopes.length === 0) {
      this.pushScope();
    }
    
    const scope = this.scopes[this.scopes.length - 1];
    const index = this.scopeIndex++;
    scope.set(name, index);
    return index;
  }
  
  // Resolve local
  resolveLocal(name) {
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      if (this.scopes[i].has(name)) {
        return this.scopes[i].get(name);
      }
    }
    
    return -1; // Not found (global)
  }
}
