import { OpCodes } from './bytecode.js';
import { hashCode } from '../utils/hash.js';

export class Compiler {
  constructor() {
    this.constants = [];
    this.instructions = [];
    this.stringMap = new Map();
    this.localMap = new Map();
    this.globalMap = new Map();
    this.processTable = new Map();
    this.functionTable = new Map();
    this.loopStack = [];
    this.nextLocalSlot = 0;
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
    this.loopStack = [];
    this.nextLocalSlot = 0;

    // Compile globals first
    for (const global of program.globals) {
      this.compileGlobal(global);
    }

    // Skip declarations at runtime and jump to main entry.
    this.emit(OpCodes.JUMP, 0);
    const jumpToMain = this.instructions.length - 1;

    // Compile functions
    for (const func of program.functions) {
      this.compileFunction(func);
    }

    // Compile processes
    for (const process of program.processes) {
      this.compileProcess(process);
    }

    // Compile main block
    const mainAddr = this.instructions.length;
    this.instructions[jumpToMain].operands[0] = mainAddr;
    this.compileBlock({ statements: program.mainBlock });

    // Main without an explicit loop should still stop cleanly.
    this.emit(OpCodes.HALT);

    return {
      constants: this.constants,
      instructions: this.instructions,
      processTable: this.processTable,
      functionTable: this.functionTable,
      mainAddr
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

  // Compile function
  compileFunction(stmt) {
    const startAddr = this.instructions.length;

    // Store function in table
    this.functionTable.set(stmt.name, {
      addr: startAddr,
      params: stmt.params
    });

    // Reset locals for this function
    const savedLocals = new Map(this.localMap);
    this.localMap = new Map();

    // Add params as locals
    for (let i = 0; i < stmt.params.length; i++) {
      this.localMap.set(stmt.params[i], i);
    }
    this.nextLocalSlot = stmt.params.length;

    // Compile body
    this.compileBlock(stmt.body);

    // Emit RETURN if not present
    if (this.instructions.length === 0 ||
        this.instructions[this.instructions.length - 1].opcode !== OpCodes.RETURN) {
      this.emit(OpCodes.RETURN);
    }

    // Restore locals
    this.localMap = savedLocals;

    return startAddr;
  }

  // Compile process
  compileProcess(stmt) {
    const startAddr = this.instructions.length;

    // Store process in table (locals map is finalized at the end).
    this.processTable.set(stmt.name, {
      addr: startAddr,
      params: stmt.params,
      privates: stmt.privates,
      locals: {}
    });

    // Reset locals for this process
    // Slots fixos: 0=x, 1=y, 2=width, 3=height, 4=ctype, 5=id, 6=region, 7=angle
    this.localMap = new Map();
    this.localMap.set('x', 0);
    this.localMap.set('y', 1);
    this.localMap.set('width', 2);
    this.localMap.set('height', 3);
    this.localMap.set('ctype', 4);
    this.localMap.set('c_type', 4);
    this.localMap.set('id', 5);
    this.localMap.set('region', 6);
    this.localMap.set('angle', 7);

    // Add params as locals (start at slot 8)
    this.nextLocalSlot = 8;
    for (const param of stmt.params) {
      // Keep canonical process fields in fixed slots.
      if (!this.localMap.has(param)) {
        this.localMap.set(param, this.nextLocalSlot++);
      }
    }

    // Add privates as locals
    for (const priv of stmt.privates) {
      if (!this.localMap.has(priv.name)) {
        this.localMap.set(priv.name, this.nextLocalSlot++);
      }
    }

    // Initialize private locals once when process starts.
    for (const priv of stmt.privates) {
      if (priv.value) {
        this.compileExpression(priv.value);
      } else {
        this.emit(OpCodes.LOAD_CONST, this.addConstant(0));
      }
      this.emit(OpCodes.STORE_LOCAL, this.localMap.get(priv.name));
    }

    // Compile body
    this.compileBlock(stmt.body);

    // Emit RETURN if not present
    if (this.instructions.length === 0 ||
        this.instructions[this.instructions.length - 1].opcode !== OpCodes.RETURN) {
      this.emit(OpCodes.RETURN);
    }

    this.processTable.set(stmt.name, {
      addr: startAddr,
      params: stmt.params,
      privates: stmt.privates,
      locals: Object.fromEntries(this.localMap.entries())
    });

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
        if (stmt.value) {
          this.compileExpression(stmt.value);
          this.emit(OpCodes.FRAME, 1);
        } else {
          this.emit(OpCodes.FRAME, 0);
        }
        break;

      case 'private':
        // Privates ja foram adicionados aos locals no compileProcess
        if (stmt.value) {
          this.compileExpression(stmt.value);
          this.emit(OpCodes.STORE_LOCAL, this.localMap.get(stmt.name));
        }
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
        this.compileBreak();
        break;

      case 'continue':
        this.compileContinue();
        break;

      case 'expression':
        // Assignments don't leave a value on stack in this VM.
        if (stmt.expression.type === 'assign') {
          this.compileAssignment(stmt.expression);
        } else {
          this.compileExpression(stmt.expression);
          this.emit(OpCodes.POP);
        }
        break;

      case 'assign':
        this.compileAssignment(stmt);
        break;

      default:
        throw new Error(`Unknown statement type: ${stmt.type}`);
    }
  }

  beginLoopContext() {
    const ctx = {
      breakJumps: [],
      continueJumps: []
    };
    this.loopStack.push(ctx);
    return ctx;
  }

  endLoopContext() {
    this.loopStack.pop();
  }

  currentLoopContext() {
    return this.loopStack.length > 0 ? this.loopStack[this.loopStack.length - 1] : null;
  }

  patchLoopJumps(ctx, continueTarget, breakTarget) {
    for (const jumpIdx of ctx.continueJumps) {
      this.instructions[jumpIdx].operands[0] = continueTarget;
    }

    for (const jumpIdx of ctx.breakJumps) {
      this.instructions[jumpIdx].operands[0] = breakTarget;
    }
  }

  compileBreak() {
    const loopCtx = this.currentLoopContext();
    if (!loopCtx) {
      throw new Error('BREAK used outside loop');
    }

    this.emit(OpCodes.JUMP, 0);
    loopCtx.breakJumps.push(this.instructions.length - 1);
  }

  compileContinue() {
    const loopCtx = this.currentLoopContext();
    if (!loopCtx) {
      throw new Error('CONTINUE used outside loop');
    }

    this.emit(OpCodes.JUMP, 0);
    loopCtx.continueJumps.push(this.instructions.length - 1);
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
    const varIdx = this.nextLocalSlot++;
    this.localMap.set(stmt.varName, varIdx);

    this.compileExpression(stmt.start);
    this.emit(OpCodes.STORE_LOCAL, varIdx);

    const loopStart = this.instructions.length;

    this.emit(OpCodes.LOAD_LOCAL, varIdx);
    this.compileExpression(stmt.end);
    this.emit(OpCodes.GT);
    this.emit(OpCodes.JUMP_IF_TRUE, 0); // Placeholder
    const jumpToEnd = this.instructions.length - 1;

    const loopCtx = this.beginLoopContext();
    this.compileBlock(stmt.body);

    const continueTarget = this.instructions.length;

    this.emit(OpCodes.LOAD_LOCAL, varIdx);
    this.compileExpression(stmt.step);
    this.emit(OpCodes.ADD);
    this.emit(OpCodes.STORE_LOCAL, varIdx);

    this.emit(OpCodes.LOOP, loopStart);

    const loopEnd = this.instructions.length;
    this.instructions[jumpToEnd].operands[0] = loopEnd;
    this.patchLoopJumps(loopCtx, continueTarget, loopEnd);
    this.endLoopContext();
  }

  // Compile while
  compileWhile(stmt) {
    const loopStart = this.instructions.length;

    this.compileExpression(stmt.condition);
    this.emit(OpCodes.JUMP_IF_FALSE, 0); // Placeholder
    const jumpToEnd = this.instructions.length - 1;

    const loopCtx = this.beginLoopContext();
    this.compileBlock(stmt.body);

    this.emit(OpCodes.LOOP, loopStart);

    const loopEnd = this.instructions.length;
    this.instructions[jumpToEnd].operands[0] = loopEnd;
    this.patchLoopJumps(loopCtx, loopStart, loopEnd);
    this.endLoopContext();
  }

  // Compile repeat
  compileRepeat(stmt) {
    const loopStart = this.instructions.length;

    const loopCtx = this.beginLoopContext();
    this.compileBlock(stmt.body);

    const continueTarget = this.instructions.length;

    this.compileExpression(stmt.condition);
    this.emit(OpCodes.JUMP_IF_FALSE, loopStart);

    const loopEnd = this.instructions.length;
    this.patchLoopJumps(loopCtx, continueTarget, loopEnd);
    this.endLoopContext();
  }

  // Compile loop
  compileLoop(stmt) {
    const loopStart = this.instructions.length;

    const loopCtx = this.beginLoopContext();
    this.compileBlock(stmt.body);

    this.emit(OpCodes.LOOP, loopStart);

    const loopEnd = this.instructions.length;
    this.patchLoopJumps(loopCtx, loopStart, loopEnd);
    this.endLoopContext();
  }

  // Compile var
  compileVar(stmt) {
    let idx = this.localMap.get(stmt.name);
    if (idx === undefined) {
      idx = this.nextLocalSlot;
      this.nextLocalSlot += 1;
      this.localMap.set(stmt.name, idx);
    }

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
        const idx = this.nextLocalSlot;
        this.nextLocalSlot += 1;
        this.localMap.set(name, idx);
        this.compileExpression(stmt.value);
        this.emit(OpCodes.STORE_LOCAL, idx);
      }
      return;
    }

    if (stmt.target.type === 'member_access' || stmt.target.type === 'index_access') {
      this.compilePathSet(stmt.target, stmt.value);
      return;
    }

    throw new Error(`Invalid assignment target: ${stmt.target.type}`);
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

      case 'type_operator':
        this.emit(OpCodes.LOAD_CONST, this.addConstant(hashCode(expr.processName)));
        break;

      case 'member_access':
      case 'index_access':
        this.compilePathGet(expr);
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

    // Builtin constants available without GLOBAL declarations.
    const builtinConstants = {
      _left: 'left',
      _right: 'right',
      _up: 'up',
      _down: 'down',
      _space: 'space',
      _fire: 'z',
      _enter: 'enter',
      _esc: 'escape',
      _1: '1',
      _2: '2',
      _3: '3',
      _4: '4',
      _5: '5',
      _6: '6',
      _7: '7',
      _8: '8',
      _9: '9',
      _0: '0',
      _q: 'q',
      _a: 'a',
      _o: 'o',
      _p: 'p',
      c_screen: 0,
      c_scroll: 1,
      c_m7: 2,
      s_kill: 0,
      s_wakeup: 1,
      s_sleep: 2,
      s_freeze: 3,
      s_kill_tree: 100,
      s_wakeup_tree: 101,
      s_sleep_tree: 102,
      s_freeze_tree: 103
    };

    // Check if local
    if (this.localMap.has(name)) {
      this.emit(OpCodes.LOAD_LOCAL, this.localMap.get(name));
    }
    // Check if global
    else if (this.globalMap.has(name)) {
      this.emit(OpCodes.LOAD_GLOBAL, this.globalMap.get(name));
    }
    // Check builtin constants
    else if (Object.prototype.hasOwnProperty.call(builtinConstants, name)) {
      this.emit(OpCodes.LOAD_CONST, this.addConstant(builtinConstants[name]));
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
    // Compile args
    for (const arg of expr.args) {
      this.compileExpression(arg);
    }

    // Check if process call
    if (expr.callee.type === 'identifier' && this.processTable.has(expr.callee.name)) {
      this.emit(OpCodes.SPAWN_PROCESS, expr.callee.name, expr.args.length);
    }
    // Check if function call
    else if (expr.callee.type === 'identifier' && this.functionTable.has(expr.callee.name)) {
      this.emit(OpCodes.CALL, expr.callee.name, expr.args.length);
    }
    // Check if native
    else if (expr.callee.type === 'identifier') {
      this.emit(OpCodes.CALL_NATIVE, expr.callee.name, expr.args.length);
    }
  }

  collectPath(expr) {
    const segments = [];
    let current = expr;

    while (current.type === 'member_access' || current.type === 'index_access') {
      if (current.type === 'member_access') {
        segments.unshift({ kind: 'prop', value: current.property });
        current = current.object;
        continue;
      }

      segments.unshift({ kind: 'index', value: current.index });
      current = current.object;
    }

    if (current.type !== 'identifier') {
      throw new Error('Unsupported access target');
    }

    return {
      root: current.name,
      segments
    };
  }

  compilePathGet(expr) {
    const path = this.collectPath(expr);
    this.emit(OpCodes.LOAD_CONST, this.addConstant(path.root));

    for (const segment of path.segments) {
      if (segment.kind === 'prop') {
        this.emit(OpCodes.LOAD_CONST, this.addConstant(segment.value));
      } else {
        this.compileExpression(segment.value);
      }
    }

    this.emit(OpCodes.CALL_NATIVE, '__get_path', 1 + path.segments.length);
  }

  compilePathSet(targetExpr, valueExpr) {
    const path = this.collectPath(targetExpr);
    this.emit(OpCodes.LOAD_CONST, this.addConstant(path.root));

    for (const segment of path.segments) {
      if (segment.kind === 'prop') {
        this.emit(OpCodes.LOAD_CONST, this.addConstant(segment.value));
      } else {
        this.compileExpression(segment.value);
      }
    }

    this.compileExpression(valueExpr);
    this.emit(OpCodes.CALL_NATIVE, '__set_path', 2 + path.segments.length);
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
