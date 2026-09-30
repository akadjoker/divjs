/**
 * DivLang Virtual Machine - Reentrant
 * Cada processo tem seu próprio contexto (ip, stack, locals)
 */

import { OpCodes, OpCodeNames } from '../compiler/bytecode.js';
import { ProcessManager } from './process.js';

export class VM {
  // Fixed process slots mirrored onto the Process object as soon as they
  // are written (see STORE_LOCAL). Must stay in step with the slot table
  // in compiler.js's compileProcess and with Process.sync().
  static CANONICAL_SLOT_FIELDS = {
    0: 'x',
    1: 'y',
    2: 'width',
    3: 'height',
    4: 'ctype',
    6: 'region',
    7: 'angle',
    8: 'red',
    9: 'green',
    10: 'blue',
    11: 'alpha',
    12: 'tag',
    13: 'priority',
    14: 'resolution',
    15: 'z',
    16: 'graph',
    17: 'file',
    18: 'size',
    19: 'flags',
    20: 'cnumber'
    // slot 5 (id) is deliberately absent - it's engine-owned, and
    // Process.sync() writes it back to locals rather than reading it.
  };

  // The inverse (name -> index), plus `id` (engine-owned, read-only from
  // script but still a valid canonical slot for get/set field access).
  // Single source of truth for runtime.js's getProcessFieldValue /
  // setProcessFieldValue, which used to each carry their own hand-copied
  // literal of this table.
  static CANONICAL_SLOT_INDICES = Object.freeze({
    ...Object.fromEntries(
      Object.entries(VM.CANONICAL_SLOT_FIELDS).map(([index, name]) => [name, Number(index)])
    ),
    id: 5
  });

  // How deep SPAWN_PROCESS may nest its immediate first run (a process
  // spawning a process spawning ...) before deferring. Each level is a
  // few JS frames (execute -> runProcess -> execute), and a chain ~4000
  // deep blew the JS stack with a RangeError that left MAIN half-run.
  // Far below any engine's stack limit, far above real programs.
  static MAX_SPAWN_DEPTH = 512;

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

    // Nesting of SPAWN_PROCESS immediate runs, and the processes whose
    // first run was deferred past MAX_SPAWN_DEPTH (see SPAWN_PROCESS).
    this.spawnDepth = 0;
    this.deferredSpawns = [];
  }

  // Register native function
  registerNative(name, fn) {
    this.natives.set(name, fn);
  }

  // Load bytecode
  load(bytecode) {
    this.programName = bytecode.programName || '';
    this.constants = bytecode.constants;
    this.bytecode = bytecode.instructions;
    this.processTable = bytecode.processTable || new Map();
    this.functionTable = bytecode.functionTable || new Map();

    // Publish MAIN's slot table under the same name its Process carries,
    // so runtime lookups (getProcessLocalSlot -> getProcessGraphInfo, the
    // pivot/collision resolvers, ...) resolve MAIN's fields by name just
    // like a PROCESS body's.
    if (bytecode.mainLocals) {
      this.processTable.set('__main__', {
        addr: bytecode.mainAddr ?? 0,
        params: [],
        privates: [],
        locals: bytecode.mainLocals
      });
    }

    // A second load() replaces the program: the previous one's processes
    // point into the old bytecode and must not keep running on the new.
    if (this.mainProcess)
    {
      this.dropProgramProcesses();
    }

    // Start from bytecode bootstrap so GLOBAL initializers run once,
    // then control jumps to main entry.
    this.mainIp = 0;
    this.mainStack = [];
    this.mainCallStack = [];
    this.mainFinished = false;
    this.mainBudgetExhaustedStreak = 0;

    // In DIV the main script IS a process (id_start), painted by the same
    // loop as any other, so it can set GRAPH/X/Y/RESOLUTION and appear on
    // screen - tutor5's snake head is literally MAIN. Give it a real
    // Process so the renderer and collisions treat it like one; its
    // locals array doubles as MAIN's locals, so the canonical slots the
    // compiler now emits for MAIN land on the right fields.
    this.mainProcess = this.processManager.create('__main__', {});
    this.mainProcess.isMain = true;
    this.mainLocals = this.mainProcess.locals;
  }

  // Run VM for one frame (scheduler)
  // One frame of the whole program. An exception escaping it (a native
  // that throws, a VM error) leaves the interrupted process half-run - its
  // ip, stack and locals mid-instruction - so the VM stops for good: it is
  // marked halted, later tick() calls do nothing, and the error still
  // reaches the host (runDivDemo reports it through onError).
  tick()
  {
    if (this.halted)
    {
      return;
    }
    try
    {
      this.runTick();
    }
    catch (err)
    {
      this.halted = true;
      throw err;
    }
  }

  runTick() {
    this.running = true;

    // exit() sets this.halted=true to mean "stop the whole VM", not just
    // this tick - it must survive across tick() calls so the host loop
    // (which keeps calling tick() every animation frame) can see it and
    // stop scheduling entirely. Do NOT reset it here; that used to undo
    // exit()'s effect on the very next tick.
    if (this.halted) {
      return;
    }

    // Snapshot the process count *before* running MAIN, not after.
    // SPAWN_PROCESS now runs a freshly spawned process's own init code
    // immediately, up to its first FRAME (see its handler in execute()) -
    // matching real DIV, and needed so a process renders with its actual
    // graph/x/y instead of empty defaults the instant it's created. That
    // means any process created during this tick - whether spawned by
    // MAIN or by another process - already got its one run for this tick
    // via the spawn itself. Capturing procCount here (rather than after
    // MAIN, which would let MAIN-spawned processes match the loop bound
    // below and get run a *second* time this tick) keeps that consistent
    // for every spawn, not just process-spawns-process.
    const procs = this.processManager.processes;
    const procCount = procs.length;

    // Run MAIN script first (can spawn processes). MAIN is a process like
    // any other in DIV (the "initial process"), so the
    // signals and FRAME(n) that govern every process govern it too - they
    // used to be ignored: s_kill left MAIN running unseen after its
    // Process was swept, s_sleep/s_freeze did not stop it, and FRAME(300)
    // ran it every frame.
    const main = this.mainProcess;
    if (!this.mainFinished && main && (main.dead || main.finished))
    {
      this.mainFinished = true;
    }
    if (!this.mainFinished)
    {
      if (main && main.suspended)
      {
        // asleep or frozen: not executed until s_wakeup
      }
      else if (main && main.frameDebt >= 100)
      {
        main.frameDebt -= 100; // same FRAME(n) throttling as below
      }
      else
      {
        this.runMain();
      }
    }

    // Run in descending priority order, like real DIV: its exec_process()
    // repeatedly picks the not-yet-executed process with the greatest
    // _Priority (src/runtime/i.c). Creation order - what this used to
    // use - inverts the relationship for any "follow my father" chain,
    // because each child then copies a parent that has *already* moved
    // this tick instead of where it was. tutor4's worm is exactly that
    // shape: with creation order every segment collapses onto the head's
    // new square each frame instead of trailing one step behind it.
    // Snapshot first (see procCount above) so processes spawned during
    // this loop still wait for the next tick.
    // Sorting is only meaningful once something actually sets PRIORITY;
    // with everything at the default the order already matches creation
    // order, so skip the per-frame sort (and the array copy) entirely.
    let runOrder = procs;
    if (this.processManager.usesPriority) {
      runOrder = procs.slice(0, procCount);
      runOrder.sort((a, b) => (b.priority || 0) - (a.priority || 0));
    }
    const runCount = Math.min(procCount, runOrder.length);

    // Execute each process until FRAME or finished
    for (let pi = 0; pi < runCount; pi++) {
      // exit() may have been called by MAIN or by an earlier process this
      // same tick - stop scheduling the rest immediately.
      if (this.halted) {
        break;
      }
      const process = runOrder[pi];
      if (!process.active || process.suspended || process.finished) {
        continue;
      }
      // MAIN is driven by runMain() above, not by this loop. The mouse
      // is an engine-owned process with no compiled body at all - its ip
      // is still 0, so scheduling it would execute the program from the
      // top and run MAIN's body a second time (which spawned a duplicate
      // set of every process MAIN creates).
      if (process.isMain || process.isMouse) {
        continue;
      }

      // FRAME(n) throttling, matching DIV (i.c:917): a process carrying
      // at least a full frame of debt is skipped this frame and pays 100
      // of it off; otherwise it runs. The debt is accrued by the FRAME
      // opcode as n-100, so FRAME(100) is neutral, FRAME(200) makes the
      // process run every other frame, and FRAME(300) every third.
      // Values below 100 never accrue debt - a process cannot run more
      // than once per frame here - so they behave as FRAME(100).
      if (process.frameDebt >= 100) {
        process.frameDebt -= 100;
        continue;
      }

      this.runProcess(process);
    }

    this.runDeferredSpawns();

    // Remove dead processes (sweep)
    this.processManager.sweep();
  }

  // First runs that SPAWN_PROCESS deferred because the spawn chain was
  // too deep. They still run in the tick they were created in, each from
  // an empty JS stack; whatever they spawn is appended and run here too.
  runDeferredSpawns()
  {
    const queue = this.deferredSpawns;
    for (let i = 0; i < queue.length && !this.halted; i++)
    {
      const process = queue[i];
      if (process.dead || process.finished || process.suspended)
      {
        continue;
      }
      this.runProcess(process);
    }
    queue.length = 0;
  }

  // Removes every process of the loaded program - MAIN included - but
  // not engine-owned ones (the runtime's mouse), which outlive programs.
  dropProgramProcesses()
  {
    const pm = this.processManager;
    for (const process of pm.getAll())
    {
      if (!process.isMouse)
      {
        process.kill();
      }
    }
    pm.sweep();
    this.mainProcess = null;
    this.currentProcess = null;
    this.deferredSpawns = [];
    this.spawnDepth = 0;
  }

  // Run MAIN until FRAME or finish
  runMain() {
    // currentProcess points at MAIN's own Process so canonical writes
    // (STORE_LOCAL's mirror) and natives that read the running process
    // behave exactly as they do inside a PROCESS body.
    this.currentProcess = this.mainProcess;
    this.ip = this.mainIp;
    this.stack = this.mainStack;
    this.locals = this.mainLocals;
    this.frameYield = false;
    this.callStack = this.mainCallStack;

    // How many ticks in a row MAIN has run out of budget without reaching
    // FRAME or finishing. Once is fine - a MAIN-level loop spawning
    // thousands of processes can need more than 100,000 instructions - so
    // MAIN resumes where it left off on the next tick. Only a loop still
    // stuck after MAX_CONSECUTIVE_BUDGET_EXHAUSTIONS ticks is treated as
    // an infinite loop and stops MAIN.
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
          `or finishing - this looks like a genuine infinite loop, not just a lot of legitimate ` +
          `work. Stopping MAIN permanently.`
        );
        this.mainFinished = true;
        if (this.mainProcess)
        {
          this.mainProcess.finished = true;
        }
      } else {
        console.warn(
          `MAIN: exceeded the per-tick instruction budget (100000) without reaching FRAME - ` +
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
    // Mirror canonical fields onto the Process the same way runProcess()
    // does when a normal process yields, so the renderer sees MAIN's
    // current x/y/graph. MAIN's own locals, not the frame of a FUNCTION
    // it may have yielded inside (see ownLocalsOf).
    this.mainProcess.locals = this.ownLocalsOf(this.locals, this.callStack);
    this.mainProcess.sync();
  }

  // Run ONE process until FRAME or finished
  runProcess(process) {
    this.currentProcess = process;
    this.ip = process.ip;
    this.stack = process.stack;
    // Resume in the frame the process yielded in: a FUNCTION's locals if
    // it hit FRAME (or ran out of budget) inside a call, else its own.
    this.locals = process.frameLocals || process.locals;
    this.frameYield = false;
    this.callStack = process.callStack || [];

    // Budget de instrucoes (previne loops infinitos). See runMain()'s
    // matching handling for the full rationale: a single instance of
    // running out of budget without reaching FRAME isn't necessarily a
    // bug on its own - this process's own logic can legitimately need
    // more than 100,000 instructions in one tick (a heavy per-frame
    // batch, a local spawn loop, ...) - so it gets a few more ticks to
    // finish before being treated as a genuine infinite loop and killed.
    const MAX_CONSECUTIVE_BUDGET_EXHAUSTIONS = 5;
    let budget = 100000;
    let budgetExhausted = false;

    // Execute until FRAME or finished (or exit() halts the whole VM)
    while (!this.frameYield && !process.finished && !this.halted) {
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
          `reaching FRAME or finishing - this looks like a genuine infinite loop, not just a ` +
          `lot of legitimate work. Killing the process.`
        );
        process.kill();
      } else {
        console.warn(
          `Process ${process.name}#${process.id}: exceeded the per-tick instruction budget ` +
          `(100000) without reaching FRAME - resuming from where it left off on the next tick ` +
          `instead of killing it (attempt ${process.budgetExhaustedStreak}/${MAX_CONSECUTIVE_BUDGET_EXHAUSTIONS}).`
        );
      }
    } else {
      process.budgetExhaustedStreak = 0;
    }

    // Save state back to process
    process.ip = this.ip;
    process.stack = this.stack;
    process.callStack = this.callStack;
    // process.locals must always be the process's OWN locals - canonical
    // fields (x, y, graph, ...) are read from it by sync(), the renderer,
    // collision and father/son access. Storing the active FUNCTION frame
    // there made a process that yielded inside a call take the function's
    // arguments as its x/y, and sync() wrote the id into slot 5 of the
    // function's frame.
    process.frameLocals = this.callStack.length > 0 ? this.locals : null;
    process.locals = this.ownLocalsOf(this.locals, this.callStack);

    // Sync all canonical fields (x, y, width, height, ctype, id, region,
    // angle, red, green, blue, alpha, tag) from locals right after this
    // process yields - not just x/y. The previous code only synced x/y
    // here and left the rest for ProcessManager.sweep() to sync once,
    // after every process in the tick has already run. That made x/y
    // "live" within the same frame (visible to any process that runs
    // later in this tick) while width/height/ctype/region/angle stayed a
    // full frame stale for the same readers - e.g. a process that grows
    // its own hitbox mid-frame wouldn't have that reflected in
    // collision() checks against it until the next frame. Process.sync()
    // already implements every canonical field consistently; calling it
    // here (instead of duplicating some of them by hand) removes both
    // the duplication and the asymmetry in one line.
    process.sync();
  }

  // The locals array belonging to the process (or MAIN) itself. CALL
  // pushes [returnAddress, callerLocals] onto the call stack, so while a
  // FUNCTION is active the process's own locals sit at callStack[1].
  ownLocalsOf(activeLocals, callStack)
  {
    return callStack.length > 0 ? callStack[1] : activeLocals;
  }

  // Execute instruction
  execute(instr) {
    const { opcode, operands } = instr;

    switch (opcode) {
      // Stack operations
      case OpCodes.POP:
        this.pop();
        this.ip++;
        break;

      // Load/Store
      case OpCodes.LOAD_LOCAL:
        this.push(this.locals[operands[0]] ?? 0);
        this.ip++;
        break;

      case OpCodes.STORE_LOCAL:
        this.locals[operands[0]] = this.pop();
        // Notify the draw-list cache when priority (slot 13) changes.
        // Guarded to only fire when this write is directly in a
        // process's own top-level body - currentProcess set (excludes
        // MAIN, which has no canonical slots at all) AND callStack empty
        // (excludes any FUNCTION the process is currently calling, whose
        // *own* locals happen to be swapped into this.locals for the
        // call but have nothing to do with that process's priority).
        // Without the callStack check, a FUNCTION with 14+ params/VARs
        // writing to its own 14th local (landing on slot 13 purely by
        // coincidence, same index as PROCESS's canonical `priority`
        // slot) would mark the draw list dirty on every such call, for
        // every process, even though no process's priority actually
        // changed - silently undermining the whole point of caching the
        // sorted draw list. Confirmed reproducible: a FUNCTION with 14
        // params does put its 14th local at slot 13.
        // Draw order is keyed on Z (slot 15), not priority - see
        // getDrawList in process.js.
        if (this.currentProcess !== null && this.callStack.length === 0) {
          if (operands[0] === 15) {
            this.processManager.markPriorityDirty();
          } else if (operands[0] === 13 && this.locals[13]) {
            // Execution order now actually depends on priority; tick()
            // starts sorting from here on.
            this.processManager.notePriorityUse();
          }
        }
        // Mirror canonical slot writes onto the process object right
        // away. Process.sync() otherwise only runs when the process
        // yields at FRAME, so anything a native reads off the process
        // mid-execution (collision(), out_of_region(), get_pixel's
        // callers, ...) sees the *previous* frame's position. That made
        // "x = x + ix; UNTIL (collision(...))" test the position the
        // process just left rather than the one it moved to - in tutor4
        // the worm head therefore collided with the segment sitting on
        // its old square every single frame and could never move.
        if (this.currentProcess !== null && this.callStack.length === 0) {
          const field = VM.CANONICAL_SLOT_FIELDS[operands[0]];
          if (field !== undefined) {
            this.currentProcess[field] = this.locals[operands[0]];
            if (operands[0] === 2 || operands[0] === 3)
            {
              this.currentProcess.sizeFromScript = true; // see Process.sizeFromScript
            }
          }
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
        // out-of-bounds index is already rejected at compile time - see
        // checkConstantArrayIndex in compiler.js - this is the case that
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
      // "const b1"/"const a1", "const b2"/"const a2", ... - a separately
      // numbered pair per case, purely to dodge a SyntaxError, because
      // none of these case blocks had their own braces and so all shared
      // one lexical scope with every other case in this switch. Adding a
      // new binary opcode and reaching for the natural "const a"/"const
      // b" names (as this file already does elsewhere, e.g. NOT's `val1`)
      // would throw "Identifier 'a' has already been declared" and take
      // the whole module down at import time - not just that instruction,
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
        // Every DIV value is a 32-bit int, so `/` is integer division
        // (kernel.cpp's `ldiv` is `pila[sp-1] /= pila[sp]` over int*).
        // Dividing in floating point instead put tutor6's board half a
        // tile out on every row, because it computes y from counter/10.
        // Truncation is applied only when both sides really are integers,
        // so genuinely fractional maths (get_delta() and friends, which
        // DIV has no equivalent of) still works.
        if (b === 0) {
          this.push(0); // DIV reports error 145 and yields 0
        } else if (Number.isInteger(a) && Number.isInteger(b)) {
          this.push(Math.trunc(a / b));
        } else {
          this.push(a / b);
        }
        this.ip++;
        break;
      }

      // "/" with a float-typed side (a float literal, a variable given a
      // float value...): always a real division, since a whole value
      // such as 5.0 can't be told from 5 at run time.
      case OpCodes.FDIV:
      {
        const b = this.pop();
        const a = this.pop();
        this.push(b === 0 ? 0 : a / b);
        this.ip++;
        break;
      }

      case OpCodes.MOD: {
        const b = this.pop();
        const a = this.pop();
        // Same integer semantics as DIV above (kernel.cpp's `lmod`),
        // including yielding 0 rather than NaN on a zero divisor.
        this.push(b === 0 ? 0 : a % b);
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
      // JUMP_IF_FALSE chains since f949496 - nothing has produced an
      // OpCodes.AND/OpCodes.OR instruction since, and no test constructs
      // one by hand either (unlike OpCodes.BREAK/CONTINUE, which a
      // regression test *does* reference directly, as a sentinel the
      // compiler must never emit - see testBreakContinueLowering in
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
          if (this.currentProcess && !this.currentProcess.isMain) {
            this.currentProcess.finished = true;
            // Kept for SPAWN_PROCESS: a process that returns a value
            // without ever reaching FRAME is being used as a function.
            this.currentProcess.returnValue = returnValue;
          } else {
            this.mainFinished = true;
            // MAIN's own Process goes away with it, so it stops being
            // drawn once the main script returns.
            if (this.mainProcess) {
              this.mainProcess.finished = true;
            }
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
              if (slot === 2 || slot === 3)
              {
                newProcess.sizeFromScript = true; // PROCESS p(width, ...)
              }
            }
          }
        }

        // Real DIV runs a spawned process's own code immediately, up to
        // its first FRAME, in the same tick as the spawn - so by the time
        // the creator's frame renders, the child already has its graph/x/y
        // etc. set up. Our scheduler's tick() intentionally skips newly
        // appended processes for the rest of *this* tick (see its comment),
        // so without this, a freshly spawned process would render once
        // with default/empty locals (graph=0 -> fallback placeholder, etc.)
        // before ever running its own init code. Run it here, then restore
        // the spawning context exactly as it was - this call reassigns
        // this.ip/stack/locals/callStack/currentProcess to the child while
        // it runs, and those belong to whoever is mid-`execute()` right now.
        const savedProcess = this.currentProcess;
        const savedIp = this.ip;
        const savedStack = this.stack;
        const savedLocals = this.locals;
        const savedCallStack = this.callStack;
        // frameYield matters just as much as the rest above: runProcess()
        // sets it true when the child reaches its own FRAME, and without
        // restoring it here that leaks back into the caller's own while
        // loop (runMain's or an outer runProcess's), which reads
        // this.frameYield as its exit condition - making it think *it*
        // just hit FRAME and stop dead after this one spawn. Confirmed:
        // "actor(10); actor(5); actor(1);" in MAIN's body used to spawn
        // only the first actor and silently drop the other two for
        // exactly this reason.
        const savedFrameYield = this.frameYield;

        // Too deep a chain of spawns-inside-spawns: leave this child's
        // first run to runDeferredSpawns() (still this tick) instead of
        // recursing further. The call then evaluates to its id.
        if (this.spawnDepth >= VM.MAX_SPAWN_DEPTH)
        {
          this.deferredSpawns.push(newProcess);
          this.push(newProcess.id);
          this.ip++;
          break;
        }

        this.spawnDepth++;
        try
        {
          this.runProcess(newProcess);
        }
        finally
        {
          this.spawnDepth--;
        }

        this.currentProcess = savedProcess;
        this.ip = savedIp;
        this.stack = savedStack;
        this.locals = savedLocals;
        this.callStack = savedCallStack;
        this.frameYield = savedFrameYield;

        // A process that ran to completion without ever reaching FRAME
        // never existed as far as the scheduler is concerned - DIV lets
        // such a process act as a function, so the call evaluates to its
        // RETURN value. tutor6's completed_board() is exactly this: it
        // loops over the board and returns true/false. Anything that
        // yielded at least once is a real process, and the call
        // evaluates to its id as before.
        if (newProcess.finished && !newProcess.hasCompletedFrame) {
          this.push(newProcess.returnValue ?? 0);
        } else {
          this.push(newProcess.id);
        }

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
          // Accrue the excess over one whole frame; the scheduler spends
          // it as skipped frames (see tick()). Clamped at 0 because a
          // process cannot run more than once per frame here, so FRAME(n)
          // for n < 100 must not build up negative credit.
          this.currentProcess.frameDebt = Math.max(
            0,
            this.currentProcess.frameDebt + (this.frameValue - 100)
          );
          // Reaching FRAME means the process has run its own setup - it
          // has had the chance to assign GRAPH and move itself off the
          // default 0,0 it was constructed at. Only from here on is it
          // eligible for collision (see isCollidable in process.js).
          this.currentProcess.hasCompletedFrame = true;
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
      case OpCodes.HALT:
        // The compiler emits this as MAIN's own trailing terminator (a
        // MAIN body with no explicit LOOP still needs to stop cleanly
        // once it runs off its own end - see compileProgram in
        // compiler.js). It must only end *this* body, not the whole VM:
        // this.halted is reserved for exit() (a genuine script-level
        // "stop everything"). Conflating the two used to mean any
        // program whose MAIN falls through - not just ones calling
        // exit() - would permanently stop every process in the game the
        // moment MAIN finished, the instant tick() stopped resetting
        // this.halted every frame to make exit() actually stick.
        if (this.currentProcess === this.mainProcess) {
          this.mainFinished = true;
          // Its Process ends with it, as on RETURN: otherwise a MAIN that
          // fell off its end stayed drawn and collidable forever.
          this.mainProcess.finished = true;
        } else if (this.currentProcess) {
          this.currentProcess.finished = true;
        } else {
          this.halted = true;
        }
        this.frameYield = true;
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

  // VM truthiness: false, 0, null, undefined => false; everything else => true
  isTruthy(value) {
    return !(value === 0 || value === false || value === null || value === undefined);
  }

  // Reset VM
  reset() {
    // The processes go too: they would otherwise keep running with ips
    // into the bytecode cleared below.
    this.dropProgramProcesses();
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
