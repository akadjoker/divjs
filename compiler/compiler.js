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

    // Pre-register every function and process name — with a placeholder
    // address, patched once its body is actually compiled below — before
    // compiling any bodies. Without this, compileCall() below decides
    // CALL vs SPAWN_PROCESS vs CALL_NATIVE by checking whether the callee
    // is *already* in functionTable/processTable at the moment that call
    // site is compiled. Since functions and processes are each compiled
    // in a single top-to-bottom pass, a call to one declared later in the
    // same list (or a call to a process from an earlier function) would
    // find nothing registered yet and silently fall through to
    // CALL_NATIVE instead of CALL/SPAWN_PROCESS — breaking mutual
    // recursion between two functions outright (there is no declaration
    // order that resolves both directions) and any forward reference
    // within the same category. A prior pass over globals/main already
    // worked correctly only because main is always compiled *after* every
    // function and process, never interleaved with them.
    //
    // This same pre-pass is also the natural place to reject duplicate
    // names: without it, "PROCESS p" declared twice (or a PROCESS and a
    // FUNCTION sharing a name — compileCall() checks processTable before
    // functionTable, so the process would silently win) just let the
    // later Map.set() overwrite the earlier one, with no error and no
    // indication which body actually runs. A copy-pasted process with an
    // un-updated name is exactly the kind of mistake this used to hide.
    for (const func of program.functions) {
      if (this.functionTable.has(func.name)) {
        throw new Error(`Duplicate FUNCTION name: "${func.name}" is declared more than once.`);
      }
      if (this.processTable.has(func.name)) {
        throw new Error(`"${func.name}" is declared as both a FUNCTION and a PROCESS; pick one name for each.`);
      }
      this.functionTable.set(func.name, { addr: -1, params: func.params });
    }
    for (const proc of program.processes) {
      if (this.processTable.has(proc.name)) {
        throw new Error(`Duplicate PROCESS name: "${proc.name}" is declared more than once.`);
      }
      if (this.functionTable.has(proc.name)) {
        throw new Error(`"${proc.name}" is declared as both a PROCESS and a FUNCTION; pick one name for each.`);
      }
      this.processTable.set(proc.name, { addr: -1, params: proc.params, privates: proc.privates, locals: {} });
    }

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
    // localMap is left over from whichever function or process was
    // compiled last (each of them starts with its own fresh Map, but
    // nothing ever resets it afterwards). Without this reset, any name
    // used as a param/private/var in that last process or function
    // silently shadows a same-named GLOBAL for the rest of main:
    // compileIdentifier() checks localMap before globalMap, finds the
    // stale entry, and emits LOAD_LOCAL/STORE_LOCAL against an index in
    // *main's own* locals array that main never wrote to — reading back
    // 0 (or corrupting whatever unrelated value main had stored there)
    // instead of the actual global. This isn't a rare-name edge case:
    // "x", "y", "id", "speed" are exactly the names likely to be both a
    // GLOBAL and a process param in a real program.
    this.localMap = new Map();
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
    if (this.globalMap.has(stmt.name)) {
      throw new Error(`Duplicate GLOBAL name: "${stmt.name}" is declared more than once.`);
    }
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

      case 'switch':
        this.compileSwitch(stmt);
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

  // Compile switch. Unlike C, there's no fallthrough: each case is really
  // just a chain of "if subject == value" tests, and a case that matches
  // jumps straight past every remaining case (and DEFAULT) to the end —
  // BREAK is never needed to keep cases from running into each other.
  // The subject is evaluated once into a hidden local (matching the
  // pattern used for FOR's step in compileFor) so a subject expression
  // with side effects — a function call, say — doesn't re-run once per
  // case comparison.
  compileSwitch(stmt) {
    this.switchDepth = (this.switchDepth || 0) + 1;
    const subjectVarName = `__switch_subject_${this.switchDepth}`;
    const subjectIdx = this.nextLocalSlot++;
    this.localMap.set(subjectVarName, subjectIdx);

    this.compileExpression(stmt.subject);
    this.emit(OpCodes.STORE_LOCAL, subjectIdx);

    const endJumps = [];
    let nextCaseJump = null;

    for (const switchCase of stmt.cases) {
      if (nextCaseJump !== null) {
        this.instructions[nextCaseJump].operands[0] = this.instructions.length;
      }

      this.emit(OpCodes.LOAD_LOCAL, subjectIdx);
      this.compileExpression(switchCase.value);
      this.emit(OpCodes.EQ);
      this.emit(OpCodes.JUMP_IF_FALSE, 0); // Placeholder, patched to next case/DEFAULT/end
      nextCaseJump = this.instructions.length - 1;

      this.compileBlock(switchCase.body);

      this.emit(OpCodes.JUMP, 0); // Placeholder, patched to end
      endJumps.push(this.instructions.length - 1);
    }

    // The last failed comparison's JUMP_IF_FALSE lands here, whether
    // that's the start of DEFAULT or (with no DEFAULT) the very end.
    this.instructions[nextCaseJump].operands[0] = this.instructions.length;

    if (stmt.defaultBody) {
      this.compileBlock(stmt.defaultBody);
    }

    const switchEnd = this.instructions.length;
    for (const jumpIdx of endJumps) {
      this.instructions[jumpIdx].operands[0] = switchEnd;
    }
  }

  // Compile for
  compileFor(stmt) {
    const varIdx = this.nextLocalSlot++;
    this.localMap.set(stmt.varName, varIdx);

    // The step is evaluated once and cached in a hidden local, both so an
    // expression with side effects (e.g. a function call) doesn't re-run
    // every iteration, and so the exit test below can read its sign
    // consistently across every iteration of the loop.
    this.forDepth = (this.forDepth || 0) + 1;
    const stepVarName = `__for_step_${this.forDepth}`;
    const stepIdx = this.nextLocalSlot++;
    this.localMap.set(stepVarName, stepIdx);

    this.compileExpression(stmt.start);
    this.emit(OpCodes.STORE_LOCAL, varIdx);

    this.compileExpression(stmt.step);
    this.emit(OpCodes.STORE_LOCAL, stepIdx);

    const loopStart = this.instructions.length;

    // A positive-step FOR must stop once i > end; a negative-step FOR
    // (STEP -1, counting down) must stop once i < end. The previous code
    // always used the "i > end" test regardless of step, so a descending
    // FOR exited on its very first check (e.g. "FOR i = 5 TO 0 STEP -1"
    // ran zero iterations instead of six). The step can be a runtime
    // expression, so the direction can't be decided at compile time —
    // continue while:
    //   (step >= 0 AND i <= end) OR (step < 0 AND i >= end)
    const iRef = { type: 'identifier', name: stmt.varName };
    const stepRef = { type: 'identifier', name: stepVarName };
    const zero = { type: 'number', value: 0 };
    const continueExpr = {
      type: 'binary',
      operator: '||',
      left: {
        type: 'binary', operator: '&&',
        left: { type: 'binary', operator: '>=', left: stepRef, right: zero },
        right: { type: 'binary', operator: '<=', left: iRef, right: stmt.end }
      },
      right: {
        type: 'binary', operator: '&&',
        left: { type: 'binary', operator: '<', left: stepRef, right: zero },
        right: { type: 'binary', operator: '>=', left: iRef, right: stmt.end }
      }
    };

    this.compileExpression(continueExpr);
    this.emit(OpCodes.JUMP_IF_FALSE, 0); // Placeholder
    const jumpToEnd = this.instructions.length - 1;

    const loopCtx = this.beginLoopContext();
    this.compileBlock(stmt.body);

    const continueTarget = this.instructions.length;

    this.emit(OpCodes.LOAD_LOCAL, varIdx);
    this.emit(OpCodes.LOAD_LOCAL, stepIdx);
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
        // compileAssignment() stores directly (STORE_LOCAL / STORE_GLOBAL /
        // path-set) and intentionally leaves nothing on the stack — correct
        // for assignment used as a statement, but this branch only fires
        // when 'assign' shows up as a sub-expression instead, e.g.
        // "a = b = c" or "IF (a = f()) ...". There the missing push would
        // silently pop whatever the enclosing expression left on the stack
        // (or the pop() underflow default), corrupting state without any
        // error. Reject it at compile time instead.
        throw new Error(
          `Assignment cannot be used as a sub-expression (found "${expr.target?.name || '?'} = ..." nested inside another expression). ` +
          `Write it as its own statement instead, e.g. "${expr.target?.name || 'x'} = value;" on its own line.`
        );

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
    if (expr.operator === '&&') {
      this.compileExpression(expr.left);
      this.emit(OpCodes.JUMP_IF_FALSE, 0);
      const leftFalseJump = this.instructions.length - 1;

      this.compileExpression(expr.right);
      this.emit(OpCodes.JUMP_IF_FALSE, 0);
      const rightFalseJump = this.instructions.length - 1;

      this.emit(OpCodes.LOAD_CONST, this.addConstant(1));
      this.emit(OpCodes.JUMP, 0);
      const jumpToEnd = this.instructions.length - 1;

      const falseLabel = this.instructions.length;
      this.instructions[leftFalseJump].operands[0] = falseLabel;
      this.instructions[rightFalseJump].operands[0] = falseLabel;
      this.emit(OpCodes.LOAD_CONST, this.addConstant(0));

      this.instructions[jumpToEnd].operands[0] = this.instructions.length;
      return;
    }

    if (expr.operator === '||') {
      this.compileExpression(expr.left);
      this.emit(OpCodes.JUMP_IF_TRUE, 0);
      const leftTrueJump = this.instructions.length - 1;

      this.compileExpression(expr.right);
      this.emit(OpCodes.JUMP_IF_TRUE, 0);
      const rightTrueJump = this.instructions.length - 1;

      this.emit(OpCodes.LOAD_CONST, this.addConstant(0));
      this.emit(OpCodes.JUMP, 0);
      const jumpToEnd = this.instructions.length - 1;

      const trueLabel = this.instructions.length;
      this.instructions[leftTrueJump].operands[0] = trueLabel;
      this.instructions[rightTrueJump].operands[0] = trueLabel;
      this.emit(OpCodes.LOAD_CONST, this.addConstant(1));

      this.instructions[jumpToEnd].operands[0] = this.instructions.length;
      return;
    }

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
