/**
 * DivLang Virtual Machine - Reentrant
 * Cada processo tem seu próprio contexto (ip, stack, locals)
 */

import { OpCodes, OpCodeNames } from '../compiler/bytecode.js';
import { ProcessManager } from './process.js';

export class VM {
  constructor() {
    // Constants
    this.constants = [];

    // Bytecode (shared)
    this.bytecode = [];

    // Globals
    this.globals = new Map();

    // Native functions
    this.natives = new Map();

    // Process manager
    this.processManager = new ProcessManager();

    // Process table
    this.processTable = new Map();

    // Function table
    this.functionTable = new Map();

    // Current process being executed
    this.currentProcess = null;

    // VM state (for current process)
    this.ip = 0;
    this.stack = [];
    this.locals = [];
    this.frameYield = false;

    // Call stack (for functions)
    this.callStack = [];

    // Delta time
    this.dt = 1 / 60;

    // Running state
    this.running = false;
    this.halted = false;

    // Main context (separate from process contexts)
    this.mainIp = 0;
    this.mainStack = [];
    this.mainLocals = [];
    this.mainCallStack = [];
    this.mainFinished = false;
    this.mainBudgetExhaustedStreak = 0;

    // Debug mode
    this.debug = false;

    // Last frame return/progress value (default DIV behavior: 100)
    this.frameValue = 100;
  }

  // Register native function
  registerNative(name, fn) {
    this.natives.set(name, fn);
  }

  // Load bytecode
  load(bytecode) {
    this.constants = bytecode.constants;
    this.bytecode = bytecode.instructions;
    this.processTable = bytecode.processTable || new Map();
    this.functionTable = bytecode.functionTable || new Map();

    // Start from bytecode bootstrap so GLOBAL initializers run once,
    // then control jumps to main entry.
    this.mainIp = 0;
    this.mainStack = [];
    this.mainLocals = [];
    this.mainCallStack = [];
    this.mainFinished = false;
    this.mainBudgetExhaustedStreak = 0;
  }

  // Run VM for one frame (scheduler)
  tick() {
    this.running = true;
    this.halted = false;

    // Snapshot the process count *before* running MAIN, not after.
    // SPAWN_PROCESS now runs a freshly spawned process's own init code
    // immediately, up to its first FRAME (see its handler in execute()) —
    // matching real DIV, and needed so a process renders with its actual
    // graph/x/y instead of empty defaults the instant it's created. That
    // means any process created during this tick — whether spawned by
    // MAIN or by another process — already got its one run for this tick
    // via the spawn itself. Capturing procCount here (rather than after
    // MAIN, which would let MAIN-spawned processes match the loop bound
    // below and get run a *second* time this tick) keeps that consistent
    // for every spawn, not just process-spawns-process.
    const procs = this.processManager.processes;
    const procCount = procs.length;

    // Run MAIN script first (can spawn processes).
    if (!this.mainFinished) {
      this.runMain();
    }

    // Iterate processes by index so newly-spawned processes (appended
    // after this point) are never visited in the same tick.

    // Execute each process until FRAME or finished
    for (let pi = 0; pi < procCount; pi++) {
      const process = procs[pi];
      if (!process.active || process.suspended || process.finished) {
        continue;
      }

      // frame(n) throttling. Previously frame(n) stored the value on the
      // process (this.currentProcess.frameValue = ...) and nothing ever
      // read it back — the syntax existed but had zero effect; every
      // process always ran on every tick regardless of what it passed to
      // frame(). This spends an accumulated "credit": frameValue percent
      // is added each tick, and the process only actually executes once
      // credit reaches 100, at which point 100 is spent (any surplus
      // carries over). At the default frameValue=100 this adds exactly
      // 100 every tick, so the process runs on every tick — unchanged
      // from the old always-run behavior. frame(50) accumulates 50/tick,
      // so it only clears 100 every *other* tick: half speed. Values
      // above 100 are clamped to 100 here, since this scheduler calls
      // each process at most once per external tick — there's no way to
      // represent "runs twice as often" without executing a process's
      // bytecode twice within the same tick, so frame(n) for n > 100
      // means "run every tick" rather than a genuine speedup.
      process.frameCredit += Math.min(process.frameValue, 100);
      if (process.frameCredit < 100) {
        continue;
      }
      process.frameCredit -= 100;

      this.runProcess(process);
    }

    // Remove dead processes (sweep)
    this.processManager.sweep();
  }

  // Run MAIN until FRAME or finish
  runMain() {
    this.currentProcess = null;
    this.ip = this.mainIp;
    this.stack = this.mainStack;
    this.locals = this.mainLocals;
    this.frameYield = false;
    this.callStack = this.mainCallStack;

    // How many consecutive ticks MAIN has run entirely out of budget
    // without reaching FRAME or finishing. A single instance of this is
    // not necessarily a bug — a MAIN-level FOR loop spawning several
    // thousand processes in one logical "tick" can legitimately need
    // more than 100,000 instructions to finish, and there was previously
    // no way to express "give me a bit more time" other than the author
    // manually inserting FRAME calls mid-loop. See BUGS.md #1 for the
    // exact repro this was written against: requesting 5,000+ processes
    // in one MAIN-level spawn loop used to silently cap at ~3,225 and
    // permanently stop MAIN forever, with only a console.error as any
    // trace. A GENUINE infinite loop that never reaches FRAME no matter
    // how many extra ticks it gets is still exactly what this guard
    // exists to catch — MAIN_MAX_CONSECUTIVE_BUDGET_EXHAUSTIONS below is
    // the line between "needs a few more ticks" and "actually stuck".
    const MAX_CONSECUTIVE_BUDGET_EXHAUSTIONS = 5;

    let budget = 100000;
    let budgetExhausted = false;

    while (!this.frameYield && !this.mainFinished && !this.halted) {
      if (--budget <= 0) {
        budgetExhausted = true;
        break;
      }

      if (this.ip >= this.bytecode.length) {
        this.mainFinished = true;
        break;
      }

      const instr = this.bytecode[this.ip];
      this.execute(instr);
    }

    if (budgetExhausted) {
      this.mainBudgetExhaustedStreak = (this.mainBudgetExhaustedStreak || 0) + 1;
      if (this.mainBudgetExhaustedStreak >= MAX_CONSECUTIVE_BUDGET_EXHAUSTIONS) {
        console.error(
          `MAIN: exceeded the per-tick instruction budget (100000) on ` +
          `${MAX_CONSECUTIVE_BUDGET_EXHAUSTIONS} consecutive ticks without ever reaching FRAME ` +
          `or finishing — this looks like a genuine infinite loop, not just a lot of legitimate ` +
          `work. Stopping MAIN permanently.`
        );
        this.mainFinished = true;
      } else {
        console.warn(
          `MAIN: exceeded the per-tick instruction budget (100000) without reaching FRAME — ` +
          `resuming from where it left off on the next tick instead of stopping ` +
          `(attempt ${this.mainBudgetExhaustedStreak}/${MAX_CONSECUTIVE_BUDGET_EXHAUSTIONS}). ` +
          `If a single logical "tick" of MAIN genuinely needs more than ~100,000 instructions ` +
          `of real work (e.g. spawning a very large number of processes at once), consider ` +
          `spreading it across multiple FRAME-separated batches instead.`
        );
      }
    } else {
      this.mainBudgetExhaustedStreak = 0;
    }

    this.mainIp = this.ip;
    this.mainStack = this.stack;
    this.mainLocals = this.locals;
    this.mainCallStack = this.callStack;
  }

  // Run ONE process until FRAME or finished
  runProcess(process) {
    this.currentProcess = process;
    this.ip = process.ip;
    this.stack = process.stack;
    this.locals = process.locals;
    this.frameYield = false;
    this.callStack = process.callStack || [];

    // Budget de instrucoes (previne loops infinitos). See runMain()'s
    // matching handling for the full rationale: a single instance of
    // running out of budget without reaching FRAME isn't necessarily a
    // bug on its own — this process's own logic can legitimately need
    // more than 100,000 instructions in one tick (a heavy per-frame
    // batch, a local spawn loop, ...) — so it gets a few more ticks to
    // finish before being treated as a genuine infinite loop and killed.
    const MAX_CONSECUTIVE_BUDGET_EXHAUSTIONS = 5;
    let budget = 100000;
    let budgetExhausted = false;

    // Execute until FRAME or finished
    while (!this.frameYield && !process.finished) {
      // Check budget
      if (--budget <= 0) {
        budgetExhausted = true;
        break;
      }

      if (this.ip >= this.bytecode.length) {
        process.finished = true;
        break;
      }

      const instr = this.bytecode[this.ip];
      this.execute(instr);
    }

    if (budgetExhausted) {
      process.budgetExhaustedStreak = (process.budgetExhaustedStreak || 0) + 1;
      if (process.budgetExhaustedStreak >= MAX_CONSECUTIVE_BUDGET_EXHAUSTIONS) {
        console.error(
          `Process ${process.name}#${process.id}: exceeded the per-tick instruction budget ` +
          `(100000) on ${MAX_CONSECUTIVE_BUDGET_EXHAUSTIONS} consecutive ticks without ever ` +
          `reaching FRAME or finishing — this looks like a genuine infinite loop, not just a ` +
          `lot of legitimate work. Killing the process.`
        );
        process.kill();
      } else {
        console.warn(
          `Process ${process.name}#${process.id}: exceeded the per-tick instruction budget ` +
          `(100000) without reaching FRAME — resuming from where it left off on the next tick ` +
          `instead of killing it (attempt ${process.budgetExhaustedStreak}/${MAX_CONSECUTIVE_BUDGET_EXHAUSTIONS}).`
        );
      }
    } else {
      process.budgetExhaustedStreak = 0;
    }

    // Save state back to process
    process.ip = this.ip;
    process.stack = this.stack;
    process.locals = this.locals;
    process.callStack = this.callStack;

    // Sync all canonical fields (x, y, width, height, ctype, id, region,
    // angle, red, green, blue, alpha, tag) from locals right after this
    // process yields — not just x/y. The previous code only synced x/y
    // here and left the rest for ProcessManager.sweep() to sync once,
    // after every process in the tick has already run. That made x/y
    // "live" within the same frame (visible to any process that runs
    // later in this tick) while width/height/ctype/region/angle stayed a
    // full frame stale for the same readers — e.g. a process that grows
    // its own hitbox mid-frame wouldn't have that reflected in
    // collision() checks against it until the next frame. Process.sync()
    // already implements every canonical field consistently; calling it
    // here (instead of duplicating some of them by hand) removes both
    // the duplication and the asymmetry in one line.
    process.sync();
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

      case OpCodes.DUP: {
        const top = this.peek();
        this.push(top);
        this.ip++;
        break;
      }

      // Load/Store
      case OpCodes.LOAD_LOCAL:
        this.push(this.locals[operands[0]] ?? 0);
        this.ip++;
        break;

      case OpCodes.STORE_LOCAL:
        this.locals[operands[0]] = this.pop();
        // Notify the draw-list cache when priority (slot 13) changes.
        // Guarded to only fire when this write is directly in a
        // process's own top-level body — currentProcess set (excludes
        // MAIN, which has no canonical slots at all) AND callStack empty
        // (excludes any FUNCTION the process is currently calling, whose
        // *own* locals happen to be swapped into this.locals for the
        // call but have nothing to do with that process's priority).
        // Without the callStack check, a FUNCTION with 14+ params/VARs
        // writing to its own 14th local (landing on slot 13 purely by
        // coincidence, same index as PROCESS's canonical `priority`
        // slot) would mark the draw list dirty on every such call, for
        // every process, even though no process's priority actually
        // changed — silently undermining the whole point of caching the
        // sorted draw list. Confirmed reproducible: a FUNCTION with 14
        // params does put its 14th local at slot 13.
        if (operands[0] === 13 && this.currentProcess !== null && this.callStack.length === 0) {
          this.processManager.markPriorityDirty();
        }
        this.ip++;
        break;

      case OpCodes.LOAD_GLOBAL: {
        const gv = this.globals.get(operands[0]);
        this.push(gv === undefined ? 0 : gv);
        this.ip++;
        break;
      }

      case OpCodes.STORE_GLOBAL:
        this.globals.set(operands[0], this.pop());
        this.ip++;
        break;

      case OpCodes.LOAD_LOCAL_IDX: {
        const li = this.pop();
        // Bounds check for a runtime-computed index (a literal
        // out-of-bounds index is already rejected at compile time — see
        // checkConstantArrayIndex in compiler.js — this is the case that
        // can't be: the index's actual value isn't known until now).
        // Without this, base + li was used directly with no validation,
        // silently reading whatever unrelated global/local happened to
        // sit at that computed offset.
        if (li < 0 || li >= operands[1] || !Number.isInteger(li)) {
          console.error(`Array index out of bounds: [${li}] (valid range 0..${operands[1] - 1})`);
          this.push(0);
        } else {
          this.push(this.locals[operands[0] + li] ?? 0);
        }
        this.ip++;
        break;
      }

      case OpCodes.STORE_LOCAL_IDX: {
        const lv = this.pop();
        const li2 = this.pop();
        if (li2 < 0 || li2 >= operands[1] || !Number.isInteger(li2)) {
          console.error(`Array index out of bounds: [${li2}] (valid range 0..${operands[1] - 1})`);
        } else {
          this.locals[operands[0] + li2] = lv;
        }
        this.ip++;
        break;
      }

      case OpCodes.LOAD_GLOBAL_IDX: {
        const gi = this.pop();
        if (gi < 0 || gi >= operands[1] || !Number.isInteger(gi)) {
          console.error(`Array index out of bounds: [${gi}] (valid range 0..${operands[1] - 1})`);
          this.push(0);
        } else {
          const gv2 = this.globals.get(operands[0] + gi);
          this.push(gv2 === undefined ? 0 : gv2);
        }
        this.ip++;
        break;
      }

      case OpCodes.STORE_GLOBAL_IDX: {
        const gval = this.pop();
        const gi2 = this.pop();
        if (gi2 < 0 || gi2 >= operands[1] || !Number.isInteger(gi2)) {
          console.error(`Array index out of bounds: [${gi2}] (valid range 0..${operands[1] - 1})`);
        } else {
          this.globals.set(operands[0] + gi2, gval);
        }
        this.ip++;
        break;
      }

      // Arithmetic. Every one of these used to declare its operands as
      // "const b1"/"const a1", "const b2"/"const a2", ... — a separately
      // numbered pair per case, purely to dodge a SyntaxError, because
      // none of these case blocks had their own braces and so all shared
      // one lexical scope with every other case in this switch. Adding a
      // new binary opcode and reaching for the natural "const a"/"const
      // b" names (as this file already does elsewhere, e.g. NOT's `val1`)
      // would throw "Identifier 'a' has already been declared" and take
      // the whole module down at import time — not just that instruction,
      // every instruction. Bracing each case gives it its own scope, so
      // "a"/"b" can be reused freely and mean the same thing everywhere.
      case OpCodes.ADD: {
        const b = this.pop();
        const a = this.pop();
        this.push(a + b);
        this.ip++;
        break;
      }

      case OpCodes.SUB: {
        const b = this.pop();
        const a = this.pop();
        this.push(a - b);
        this.ip++;
        break;
      }

      case OpCodes.MUL: {
        const b = this.pop();
        const a = this.pop();
        this.push(a * b);
        this.ip++;
        break;
      }

      case OpCodes.DIV: {
        const b = this.pop();
        const a = this.pop();
        this.push(a / b);
        this.ip++;
        break;
      }

      case OpCodes.MOD: {
        const b = this.pop();
        const a = this.pop();
        this.push(a % b);
        this.ip++;
        break;
      }

      case OpCodes.NEG: {
        const val = this.pop();
        this.push(-val);
        this.ip++;
        break;
      }

      // Comparison
      case OpCodes.EQ: {
        const b = this.pop();
        const a = this.pop();
        this.push(a === b ? 1 : 0);
        this.ip++;
        break;
      }

      case OpCodes.NEQ: {
        const b = this.pop();
        const a = this.pop();
        this.push(a !== b ? 1 : 0);
        this.ip++;
        break;
      }

      case OpCodes.LT: {
        const b = this.pop();
        const a = this.pop();
        this.push(a < b ? 1 : 0);
        this.ip++;
        break;
      }

      case OpCodes.LTE: {
        const b = this.pop();
        const a = this.pop();
        this.push(a <= b ? 1 : 0);
        this.ip++;
        break;
      }

      case OpCodes.GT: {
        const b = this.pop();
        const a = this.pop();
        this.push(a > b ? 1 : 0);
        this.ip++;
        break;
      }

      case OpCodes.GTE: {
        const b = this.pop();
        const a = this.pop();
        this.push(a >= b ? 1 : 0);
        this.ip++;
        break;
      }

      // Logical. AND/OR opcodes used to live here too, but the compiler
      // has emitted short-circuit AND/OR entirely via JUMP_IF_TRUE/
      // JUMP_IF_FALSE chains since f949496 — nothing has produced an
      // OpCodes.AND/OpCodes.OR instruction since, and no test constructs
      // one by hand either (unlike OpCodes.BREAK/CONTINUE, which a
      // regression test *does* reference directly, as a sentinel the
      // compiler must never emit — see testBreakContinueLowering in
      // tests/browser-tests.js). Removed rather than left as unreachable
      // "working" cases that invite a future reader to wonder whether
      // something out there still depends on them.
      case OpCodes.NOT: {
        const val1 = this.pop();
        this.push(this.isTruthy(val1) ? 0 : 1);
        this.ip++;
        break;
      }

      // Control flow
      case OpCodes.JUMP:
        this.ip = operands[0];
        break;

      case OpCodes.JUMP_IF_FALSE: {
        const cond = this.pop();
        if (!this.isTruthy(cond)) {
          this.ip = operands[0];
        } else {
          this.ip++;
        }
        break;
      }

      case OpCodes.JUMP_IF_TRUE: {
        const cond = this.pop();
        if (this.isTruthy(cond)) {
          this.ip = operands[0];
        } else {
          this.ip++;
        }
        break;
      }

      case OpCodes.LOOP:
        this.ip = operands[0];
        break;

      case OpCodes.BREAK:
        console.error('Unresolved BREAK opcode reached VM. Compiler should lower BREAK to JUMP.');
        this.halted = true;
        break;

      case OpCodes.CONTINUE:
        console.error('Unresolved CONTINUE opcode reached VM. Compiler should lower CONTINUE to JUMP.');
        this.halted = true;
        break;

      // Call
      case OpCodes.CALL: {
        const funcName = operands[0];
        const funcArgc = operands[1];
        const funcArgs = [];

        for (let i = 0; i < funcArgc; i++) {
          funcArgs.unshift(this.pop());
        }

        const funcInfo = this.functionTable.get(funcName);
        if (!funcInfo) {
          console.error(`Function not found: ${funcName}`);
          this.push(0);
          this.ip++;
          break;
        }

        // Save return address
        this.callStack.push(this.ip + 1);

        // Jump to function
        this.ip = funcInfo.addr;

        // Save current locals and create new frame for function
        this.callStack.push(this.locals);
        this.locals = [];

        // Map args to locals
        for (let i = 0; i < funcInfo.params.length; i++) {
          this.locals[i] = funcArgs[i];
        }
        break;
      }

      case OpCodes.RETURN: {
        // Function calls push [returnAddress, previousLocals] onto callStack.
        const returningToCaller = this.callStack.length >= 2;
        const returnValue = this.stack.length > 0 ? this.pop() : 0;

        // Restore locals
        if (this.callStack.length > 0) {
          this.locals = this.callStack.pop();
        }

        // Restore return address
        if (this.callStack.length > 0) {
          this.ip = this.callStack.pop();
        } else {
          // End of process/function/main
          if (this.currentProcess) {
            this.currentProcess.finished = true;
          } else {
            this.mainFinished = true;
          }
        }

        // Push return value back if needed (for function calls)
        if (returningToCaller) {
          this.push(returnValue);
        }
        break;
      }

      case OpCodes.CALL_NATIVE: {
        const nativeName = operands[0];
        const nativeArgc = operands[1];
        const nativeArgs = [];

        for (let i = 0; i < nativeArgc; i++) {
          nativeArgs.unshift(this.pop());
        }

        const nativeFn = this.natives.get(nativeName);
        if (nativeFn) {
          const result = nativeFn(...nativeArgs);
          this.push(result === undefined ? 0 : result);
        } else {
          console.warn(`Native function not found: ${nativeName}`);
          this.push(0);
        }

        this.ip++;
        break;
      }

      case OpCodes.SPAWN_PROCESS: {
        const processName = operands[0];
        const processArgc = operands[1];
        const processArgs = [];

        for (let i = 0; i < processArgc; i++) {
          processArgs.unshift(this.pop());
        }

        // Create process with params
        const params = {};
        const processInfo = this.processTable.get(processName);
        if (processInfo) {
          // Map args to param names
          for (let i = 0; i < processInfo.params.length; i++) {
            params[processInfo.params[i]] = processArgs[i];
          }
        }

        if (this.currentProcess?.id) {
          params.parentId = this.currentProcess.id;
        }

        if (!processInfo) {
          console.error(`Process not found: ${processName}`);
          this.push(0);
          this.ip++;
          break;
        }

        const newProcess = this.processManager.create(processName, params);
        newProcess.ip = processInfo.addr;

        // Initialize param slots from compiler-local metadata.
        if (processInfo.params && processInfo.locals) {
          for (let i = 0; i < processInfo.params.length; i++) {
            const paramName = processInfo.params[i];
            const slot = processInfo.locals[paramName];
            if (slot !== undefined) {
              newProcess.locals[slot] = processArgs[i];
            }
          }
        }

        // Real DIV runs a spawned process's own code immediately, up to
        // its first FRAME, in the same tick as the spawn — so by the time
        // the creator's frame renders, the child already has its graph/x/y
        // etc. set up. Our scheduler's tick() intentionally skips newly
        // appended processes for the rest of *this* tick (see its comment),
        // so without this, a freshly spawned process would render once
        // with default/empty locals (graph=0 -> fallback placeholder, etc.)
        // before ever running its own init code. Run it here, then restore
        // the spawning context exactly as it was — this call reassigns
        // this.ip/stack/locals/callStack/currentProcess to the child while
        // it runs, and those belong to whoever is mid-`execute()` right now.
        const savedProcess = this.currentProcess;
        const savedIp = this.ip;
        const savedStack = this.stack;
        const savedLocals = this.locals;
        const savedCallStack = this.callStack;

        this.runProcess(newProcess);

        this.currentProcess = savedProcess;
        this.ip = savedIp;
        this.stack = savedStack;
        this.locals = savedLocals;
        this.callStack = savedCallStack;

        // Process calls behave like expressions; return spawned process id.
        this.push(newProcess.id);

        this.ip++;
        break;
      }

      case OpCodes.FRAME:
        if (operands[0] === 1) {
          this.frameValue = Number(this.pop()) || 0;
        } else {
          this.frameValue = 100;
        }

        if (this.currentProcess) {
          this.currentProcess.frameValue = this.frameValue;
        }
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
    if (this.debug && value === undefined) {
      console.warn('Stack underflow detected');
      value = 0;
    }
    this.stack.push(value);
  }

  // Pop value
  pop() {
    if (this.stack.length === 0) {
      if (this.debug) {
        console.warn('Stack underflow');
      }
      return 0;
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

  // VM truthiness: false, 0, null, undefined => false; everything else => true
  isTruthy(value) {
    return !(value === 0 || value === false || value === null || value === undefined);
  }

  // Reset VM
  reset() {
    this.constants = [];
    this.bytecode = [];
    this.globals = new Map();
    this.processTable = new Map();
    this.functionTable = new Map();
    this.ip = 0;
    this.stack = [];
    this.locals = [];
    this.callStack = [];
    this.mainIp = 0;
    this.mainStack = [];
    this.mainLocals = [];
    this.mainCallStack = [];
    this.mainFinished = false;
    this.mainBudgetExhaustedStreak = 0;
    this.running = false;
    this.halted = false;
    this.frameYield = false;
  }
}
