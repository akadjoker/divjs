import { OpCodes } from './bytecode.js';
import { hashCode } from '../utils/hash.js';
import * as ast from './ast.js';

// Returns the numeric value of `expr` if it's a compile-time constant -
// a bare number literal ("STEP 2") or a unary minus directly wrapping one
// ("STEP -2", which the parser produces as Unary('-', Number(2)) since
// the lexer itself never reads a leading sign into a NUMBER token) - or
// null otherwise. Used by compileFor to decide whether a FOR loop's exit
// test can collapse to a single LTE/GTE instead of the general
// runtime-checked form that's needed when the step is a genuine
// expression (a variable, a function call, ...).
function getConstantNumericValue(expr) {
  if (expr.type === 'number') {
    return expr.value;
  }
  if (expr.type === 'unary' && expr.operator === '-' && expr.operand.type === 'number') {
    return -expr.operand.value;
  }
  return null;
}

// Builtin constants available without a GLOBAL/CONST declaration.
// Shared between compileIdentifier (runtime lookup) and
// Compiler.evalConstExpr (CONST-block folding), so pi/true/false/etc.
// only have one definition to keep in sync.
const BUILTIN_CONSTANTS = {
  _left: 'ArrowLeft', _right: 'ArrowRight',
  _up: 'ArrowUp',     _down: 'ArrowDown',
  _space: ' ', _enter: 'Enter', _esc: 'Escape', _backspace: 'Backspace',
  _tab: 'Tab', _shift: 'Shift', _ctrl: 'Control', _control: 'Control', _alt: 'Alt',
  _fire: 'z',
  _a: 'a', _b: 'b', _c: 'c', _d: 'd', _e: 'e', _f: 'f',
  _g: 'g', _h: 'h', _i: 'i', _j: 'j', _k: 'k', _l: 'l',
  _m: 'm', _n: 'n', _o: 'o', _p: 'p', _q: 'q', _r: 'r',
  _s: 's', _t: 't', _u: 'u', _v: 'v', _w: 'w', _x: 'x',
  _y: 'y', _z: 'z',
  _0: '0', _1: '1', _2: '2', _3: '3', _4: '4',
  _5: '5', _6: '6', _7: '7', _8: '8', _9: '9',
  true: 1, false: 0,
  c_screen: 0, c_scroll: 1, c_m7: 2,
  s_kill: 0, s_wakeup: 1, s_sleep: 2, s_freeze: 3,
  s_kill_tree: 100, s_wakeup_tree: 101, s_sleep_tree: 102, s_freeze_tree: 103,
  // Classic DIV single-argument SET_MODE resolution constants - see
  // VIDEO_MODE_TABLE in runtime.js's setModeNative for the decode.
  // Negative so they can never collide with a legitimate width value
  // passed to the (width, height) two-argument form this engine's own
  // demos already use.
  m320x200: -1, m640x480: -2, m320x240: -3, m320x400: -4, m360x240: -5,
  m360x360: -6, m376x282: -7, m640x400: -8, m800x600: -9, m1024x768: -10,
  // "This constant defines the equivalence in degree thousandths of the
  // mathematical constant pi" (DIV manual) - i.e. pi = half a turn in
  // the ANGLE field's own AXIS units (360000 = full circle), not
  // Math.PI radians. Scripts write angle math directly in this unit
  // ("direction = direction + pi/32;") with no radian conversion
  // needed, matching toRadiansFromDivAngle's 1000ths-of-a-degree
  // convention already used everywhere else (angle, cos, sin,
  // fget_angle, ...).
  pi: 180000,
  // delete_text(all_text) removes every text created by write()/
  // write_int() - deleteTextNative already treats id 0 as "delete all"
  // (see runtime.js), so this is just the named constant DIV scripts
  // use instead of a bare 0.
  all_text: 0
};

export class Compiler {
  constructor() {
    this.constants = [];
    this.constantIndex = new Map();
    this.instructions = [];
    this.stringMap = new Map();
    this.localMap = new Map();
    this.globalMap = new Map();
    this.processTable = new Map();
    this.functionTable = new Map();
    this.loopStack = [];
    this.nextLocalSlot = 0;
    this.nextGlobalSlot = 0;
    this.structMap = new Map(); // name → {base, count, instanceSize, fields: Map<fname,{offset,size}>}
  }

  // Every compile-time error below is keyed off an AST node (a statement
  // or an expression). The parser now stamps every statement and every
  // expression node with .line/.col - this just formats it consistently
  // with how the parser's own syntax errors already read ("... at L:C"),
  // and degrades gracefully to no suffix for the handful of
  // compiler-synthesized nodes (e.g. the hidden FOR-step/SWITCH-subject
  // comparison expressions built directly in compileFor/compileSwitch)
  // that were never parsed from source and so never had a location.
  locSuffix(node) {
    if (node && node.line !== undefined && node.col !== undefined) {
      return ` at ${node.line}:${node.col}`;
    }
    return '';
  }

  // Compile program
  compile(program) {
    this.constants = [];
    this.constantIndex = new Map();
    this.instructions = [];
    this.stringMap = new Map();
    this.localMap = new Map();
    this.globalMap = new Map();
    this.processTable = new Map();
    this.functionTable = new Map();
    this.loopStack = [];
    this.nextLocalSlot = 0;
    this.nextGlobalSlot = 0;
    this.structMap = new Map();
    // LOCAL section - read by resetCanonicalLocals so every process, and
    // MAIN, lays these out at the same slots.
    this.localDecls = program.locals || [];

    // Pre-register every function and process name - with a placeholder
    // address, patched once its body is actually compiled below - before
    // compiling any bodies. Without this, compileCall() below decides
    // CALL vs SPAWN_PROCESS vs CALL_NATIVE by checking whether the callee
    // is *already* in functionTable/processTable at the moment that call
    // site is compiled. Since functions and processes are each compiled
    // in a single top-to-bottom pass, a call to one declared later in the
    // same list (or a call to a process from an earlier function) would
    // find nothing registered yet and silently fall through to
    // CALL_NATIVE instead of CALL/SPAWN_PROCESS - breaking mutual
    // recursion between two functions outright (there is no declaration
    // order that resolves both directions) and any forward reference
    // within the same category. A prior pass over globals/main already
    // worked correctly only because main is always compiled *after* every
    // function and process, never interleaved with them.
    //
    // This same pre-pass is also the natural place to reject duplicate
    // names: without it, "PROCESS p" declared twice (or a PROCESS and a
    // FUNCTION sharing a name - compileCall() checks processTable before
    // functionTable, so the process would silently win) just let the
    // later Map.set() overwrite the earlier one, with no error and no
    // indication which body actually runs. A copy-pasted process with an
    // un-updated name is exactly the kind of mistake this used to hide.
    for (const func of program.functions) {
      if (this.functionTable.has(func.name)) {
        throw new Error(`Duplicate FUNCTION name: "${func.name}" is declared more than once.${this.locSuffix(func)}`);
      }
      if (this.processTable.has(func.name)) {
        throw new Error(`"${func.name}" is declared as both a FUNCTION and a PROCESS; pick one name for each.${this.locSuffix(func)}`);
      }
      this.functionTable.set(func.name, { addr: -1, params: func.params });
    }
    for (const proc of program.processes) {
      if (this.processTable.has(proc.name)) {
        throw new Error(`Duplicate PROCESS name: "${proc.name}" is declared more than once.${this.locSuffix(proc)}`);
      }
      if (this.functionTable.has(proc.name)) {
        throw new Error(`"${proc.name}" is declared as both a PROCESS and a FUNCTION; pick one name for each.${this.locSuffix(proc)}`);
      }
      this.processTable.set(proc.name, { addr: -1, params: proc.params, privates: proc.privates, locals: {} });
    }

    // CONST section, resolved before anything that might reference one
    // (a GLOBAL initializer, a PROCESS body, ...) - see compileConsts.
    this.constMap = new Map();
    this.compileConsts(program.consts || []);

    // Compile globals first
    for (const global of program.globals) {
      this.compileGlobal(global);
    }

    // Compile struct declarations (allocate slots + initialize defaults)
    for (const struct of program.structs || []) {
      this.compileStructDecl(struct);
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
    // *main's own* locals array that main never wrote to - reading back
    // 0 (or corrupting whatever unrelated value main had stored there)
    // instead of the actual global. This isn't a rare-name edge case:
    // "x", "y", "id", "speed" are exactly the names likely to be both a
    // GLOBAL and a process param in a real program.
    this.resetCanonicalLocals();
    this.declarePrivates(program.mainPrivates);
    for (const priv of program.mainPrivates || []) {
      if (priv.size !== undefined) {
        this.emitPrivateArrayInit(priv);
        continue;
      }
      if (priv.value) {
        this.compileExpression(priv.value);
        this.emit(OpCodes.STORE_LOCAL, this.localMap.get(priv.name));
      }
    }
    this.compileBlock({ statements: program.mainBlock });
    const mainLocals = Object.fromEntries(this.localMap);

    // Main without an explicit loop should still stop cleanly.
    this.emit(OpCodes.HALT);

    return {
      constants: this.constants,
      instructions: this.instructions,
      processTable: this.processTable,
      functionTable: this.functionTable,
      // Scalar globals only (arrays stored as objects, not useful for slot→name lookup)
      globals: Object.fromEntries(
        [...this.globalMap.entries()].filter(([, v]) => typeof v === 'number')
      ),
      mainAddr,
      // Same idea as functionTable/processTable entries' .locals - VAR
      // declarations made directly in the top-level BEGIN/END block, not
      // inside any PROCESS or FUNCTION, previously had no name-to-slot
      // metadata published anywhere, so disasm.js's MAIN section always
      // showed bare slot numbers even though PROCESS bodies resolved
      // names correctly.
      mainLocals
    };
  }

  // Compile global
  // CONST name=expr entries carry no runtime storage - each is folded
  // to a plain number right here, in declaration order, so later entries
  // can reference earlier ones (coins.prg: "maximum_incline=pi;
  // minimum_incline=-pi;"). Every later compileIdentifier() reference to
  // the name is replaced with the resolved literal (see its constMap
  // check).
  compileConsts(consts) {
    for (const decl of consts) {
      if (this.constMap.has(decl.name)) {
        throw new Error(`Duplicate CONST name: "${decl.name}" is declared more than once.${this.locSuffix(decl)}`);
      }
      const value = this.evalConstExpr(decl.value, decl);
      this.constMap.set(decl.name, value);
    }
  }

  // Minimal compile-time evaluator for CONST expressions: numeric
  // literals, +/-/*// and unary +/-, and identifiers that resolve to an
  // earlier CONST or one of compileIdentifier's builtin constants (pi,
  // true, false, c_scroll, ...) - covers every real DIV CONST block
  // that isn't itself just a bare literal (e.g. "maximum_incline=pi;",
  // "half=power_maximum/2;").
  evalConstExpr(expr, declNode) {
    const fail = () => {
      throw new Error(
        `CONST "${declNode.name}" must be a compile-time constant expression (literals, +-*/ and earlier CONSTs/builtins only)${this.locSuffix(declNode)}`
      );
    };
    switch (expr.type) {
      case 'number':
        return expr.value;
      case 'unary': {
        const v = this.evalConstExpr(expr.operand, declNode);
        if (expr.operator === '-') return -v;
        if (expr.operator === '+') return v;
        return fail();
      }
      case 'binary': {
        const a = this.evalConstExpr(expr.left, declNode);
        const b = this.evalConstExpr(expr.right, declNode);
        switch (expr.operator) {
          case '+': return a + b;
          case '-': return a - b;
          case '*': return a * b;
          case '/': return a / b;
          default: return fail();
        }
      }
      case 'identifier': {
        const nameLower = expr.name.toLowerCase();
        if (this.constMap.has(expr.name)) {
          return this.constMap.get(expr.name);
        }
        if (Object.prototype.hasOwnProperty.call(BUILTIN_CONSTANTS, nameLower) &&
          typeof BUILTIN_CONSTANTS[nameLower] === 'number') {
          return BUILTIN_CONSTANTS[nameLower];
        }
        return fail();
      }
      default:
        return fail();
    }
  }

  compileGlobal(stmt) {
    if (this.globalMap.has(stmt.name)) {
      throw new Error(`Duplicate GLOBAL name: "${stmt.name}" is declared more than once.${this.locSuffix(stmt)}`);
    }

    if (stmt.size !== undefined) {
      // Array: evaluate size at compile time (must be a constant number).
      let sizeVal;
      if (stmt.size === null) {
        // "name[]= a,b,c;" - size comes straight from the initializer
        // list's own length (see parseGlobal), not a declared last
        // index - there isn't one to add 1 to here.
        if (!stmt.initializers || stmt.initializers.length === 0) {
          throw new Error(`GLOBAL array "${stmt.name}[]" with no declared size needs an initializer list to infer it from${this.locSuffix(stmt)}`);
        }
        sizeVal = stmt.initializers.length;
      } else {
        const declared = getConstantNumericValue(stmt.size);
        if (declared === null || declared < 0 || !Number.isInteger(declared)) {
          throw new Error(`GLOBAL array size must be a non-negative integer literal${this.locSuffix(stmt)}`);
        }
        // DIV declares arrays by their LAST INDEX, not their length, so
        // "board[99]" holds 100 elements indexed 0..99 - which is why
        // tutor6 initialises it with "100 dup (1)" and iterates 0 TO 99.
        sizeVal = declared + 1;
      }
      const base = this.nextGlobalSlot;
      this.nextGlobalSlot += sizeVal;
      this.globalMap.set(stmt.name, { isArray: true, base, size: sizeVal });
      // Initialize every slot at startup: from the declaration's
      // initializer list where one was given, zero elsewhere. A list
      // shorter than the array leaves the remainder zeroed, and DUP has
      // already been expanded by the parser.
      const init = stmt.initializers || [];
      for (let i = 0; i < sizeVal; i++) {
        if (i < init.length) {
          this.compileExpression(init[i]);
        } else {
          this.emit(OpCodes.LOAD_CONST, this.addConstant(0));
        }
        this.emit(OpCodes.STORE_GLOBAL, base + i);
      }
      return;
    }

    const idx = this.nextGlobalSlot++;
    this.globalMap.set(stmt.name, idx);

    if (stmt.value) {
      this.compileExpression(stmt.value);
      this.emit(OpCodes.STORE_GLOBAL, idx);
    } else {
      this.emit(OpCodes.LOAD_CONST, this.addConstant(0));
      this.emit(OpCodes.STORE_GLOBAL, idx);
    }
  }

  compileStructDecl(stmt) {
    if (this.structMap.has(stmt.name)) {
      throw new Error(`Duplicate STRUCT name: "${stmt.name}"${this.locSuffix(stmt)}`);
    }

    // Build field layout: offset and size within one instance
    // Build the layout recursively (nested STRUCTs inline into parent)
    const def = this.buildStructDef(stmt);
    const base = this.nextGlobalSlot;
    this.nextGlobalSlot += def.count * def.instanceSize;
    this.structMap.set(stmt.name, { base, ...def });

    if (stmt.initializers) {
      // Flat initializer list: values map 1-to-1 to global slots
      for (let s = 0; s < stmt.initializers.length && s < def.count * def.instanceSize; s++) {
        const v = getConstantNumericValue(stmt.initializers[s]);
        if (v !== null && v !== 0) {
          this.emit(OpCodes.LOAD_CONST, this.addConstant(v));
          this.emit(OpCodes.STORE_GLOBAL, base + s);
        }
      }
    } else {
      // Emit default-value initializers for non-zero scalar fields, all instances
      this.emitStructDefaults(base, def, 0);
    }
  }

  // Recursively build {instanceSize, count, fields} from a StructDecl AST node.
  buildStructDef(stmt) {
    const fields = new Map();
    let instanceSize = 0;
    // Like GLOBAL/PRIVATE arrays, DIV's "STRUCT name[n]" gives the last
    // valid index, so it holds n+1 instances.
    const declaredCount = stmt.count ? getConstantNumericValue(stmt.count) : 0;
    if (stmt.count && (declaredCount === null || declaredCount < 0 || !Number.isInteger(declaredCount))) {
      throw new Error(`STRUCT count must be a non-negative integer literal${this.locSuffix(stmt)}`);
    }
    const count = declaredCount + 1;
    for (const f of stmt.fields) {
      if (f.nested) {
        const nestedDef = this.buildStructDef(f.nested);
        const totalSize = nestedDef.count * nestedDef.instanceSize;
        fields.set(f.name, { offset: instanceSize, size: totalSize, isNested: true, nestedDef });
        instanceSize += totalSize;
      } else {
        // Array fields follow the same last-index rule.
        const declaredFieldSize = f.size ? getConstantNumericValue(f.size) : null;
        const fsize = declaredFieldSize === null ? 1 : declaredFieldSize + 1;
        if (f.size && (declaredFieldSize === null || declaredFieldSize < 0 || !Number.isInteger(declaredFieldSize))) {
          throw new Error(`Struct field array size must be a non-negative integer literal${this.locSuffix(stmt)}`);
        }
        fields.set(f.name, { offset: instanceSize, size: fsize ?? 1, isNested: false, defaultValue: f.defaultValue });
        instanceSize += fsize ?? 1;
      }
    }
    return { instanceSize, count: count ?? 1, fields };
  }

  // Emit STORE_GLOBAL for all non-zero default values recursively.
  emitStructDefaults(base, def, baseOffset) {
    for (let i = 0; i < def.count; i++) {
      const instOffset = baseOffset + i * def.instanceSize;
      for (const [, f] of def.fields) {
        if (f.isNested) {
          this.emitStructDefaults(base, f.nestedDef, instOffset + f.offset);
        } else if (f.size === 1 && f.defaultValue) {
          this.compileExpression(f.defaultValue);
          this.emit(OpCodes.STORE_GLOBAL, base + instOffset + f.offset);
        }
      }
    }
  }

  // Compile function
  compileFunction(stmt) {
    const startAddr = this.instructions.length;

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
    const functionLocals = Object.fromEntries(this.localMap);
    this.localMap = savedLocals;

    // Publish the function's local-name -> slot mapping, mirroring what
    // compileProcess already does for processTable entries - lets
    // tooling (compiler/disasm.js) resolve LOAD_LOCAL/STORE_LOCAL inside
    // a FUNCTION body to a variable name instead of a bare slot number.
    // Captured after compiling the body (not just the initial params)
    // since VAR declarations inside the function add more names to
    // localMap as they're compiled.
    this.functionTable.set(stmt.name, {
      addr: startAddr,
      params: stmt.params,
      locals: functionLocals
    });

    return startAddr;
  }

  // The fixed process fields DIV gives every process, at the slots the VM
  // and runtime agree on (see VM.CANONICAL_SLOT_FIELDS and Process.sync).
  // MAIN gets these too: in DIV the main script *is* a process (id_start,
  // painted by the same loop as any other), so tutor5 can legitimately do
  // "graph=1; resolution=100; x=mouse.x*100;" straight from MAIN.
  resetCanonicalLocals() {
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
    this.localMap.set('red', 8);
    this.localMap.set('green', 9);
    this.localMap.set('blue', 10);
    this.localMap.set('alpha', 11);
    this.localMap.set('tag', 12);
    this.localMap.set('priority', 13);
    // RESOLUTION divides x/y when drawing, so a script can work in
    // sub-pixel units (resolution=100 -> two decimals).
    this.localMap.set('resolution', 14);
    // Z is draw depth, kept apart from PRIORITY: DIV picks what to run by
    // highest _Priority (i.c:903) and what to paint by highest _Z
    // (i.c:1441), higher Z painted first and therefore further back.
    this.localMap.set('z', 15);
    // GRAPH/FILE/SIZE/FLAGS are canonical process fields in DIV too - the
    // tutorials rely on it, e.g. "PROCESS boardbox(x,y,graph,file,number)"
    // expects those parameters to land directly on the process's own
    // fields. SIZE defaults to 100 (full scale); the rest to 0.
    this.localMap.set('graph', 16);
    this.localMap.set('file', 17);
    this.localMap.set('size', 18);
    this.localMap.set('flags', 19);
    this.nextLocalSlot = 20;

    // LOCAL declarations sit at fixed slots too, so every process - and
    // MAIN - agrees on where they live and they can be read off another
    // process by name.
    for (const decl of this.localDecls || []) {
      if (this.localMap.has(decl.name)) continue;
      this.localMap.set(decl.name, this.nextLocalSlot++);
    }
  }

  // Allocates slots for a PRIVATE section. Shared by PROCESS bodies and
  // by MAIN, which in DIV is a process and may declare privates too.
  // Emits the STORE_LOCAL for each value in a PRIVATE array's own
  // initializer list ("PRIVATE control[3]=FALSE,FALSE,FALSE;" - same
  // "value, value, N DUP(value)" syntax GLOBAL/STRUCT accept, via
  // parsePrivate). Only the given values are written; a list shorter
  // than the array leaves the remainder at their normal zero default
  // (unlike GLOBAL, a local slot already reads 0 unless written, so
  // there's no need to explicitly zero the rest here).
  emitPrivateArrayInit(priv) {
    const init = priv.initializers;
    if (!init || init.length === 0) return;
    const entry = this.localMap.get(priv.name);
    for (let i = 0; i < init.length; i++) {
      this.compileExpression(init[i]);
      this.emit(OpCodes.STORE_LOCAL, entry.base + i);
    }
  }

  declarePrivates(privates) {
    for (const priv of privates || []) {
      if (this.localMap.has(priv.name)) continue;
      if (priv.size !== undefined) {
        const declared = getConstantNumericValue(priv.size);
        if (declared === null || declared < 0 || !Number.isInteger(declared)) {
          throw new Error(`PRIVATE array size must be a non-negative integer literal${this.locSuffix(priv)}`);
        }
        // Last index, not length - same as GLOBAL above.
        const sizeVal = declared + 1;
        this.localMap.set(priv.name, { isArray: true, base: this.nextLocalSlot, size: sizeVal });
        this.nextLocalSlot += sizeVal;
      } else {
        this.localMap.set(priv.name, this.nextLocalSlot++);
      }
    }
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
    this.resetCanonicalLocals();

    // Add params as locals (after the canonical block)
    
    for (const param of stmt.params) {
      // Keep canonical process fields in fixed slots.
      if (!this.localMap.has(param)) {
        this.localMap.set(param, this.nextLocalSlot++);
      }
    }

    // Add privates as locals
    this.declarePrivates(stmt.privates);

    // Initialize private locals once when process starts.
    for (const priv of stmt.privates) {
      if (priv.size !== undefined) {
        this.emitPrivateArrayInit(priv);
        continue;
      }
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

      case 'cfor':
        this.compileCFor(stmt);
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
        this.compileBreak(stmt);
        break;

      case 'continue':
        this.compileContinue(stmt);
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
        throw new Error(`Unknown statement type: ${stmt.type}${this.locSuffix(stmt)}`);
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

  compileBreak(stmt) {
    const loopCtx = this.currentLoopContext();
    if (!loopCtx) {
      throw new Error(`BREAK used outside loop${this.locSuffix(stmt)}`);
    }

    this.emit(OpCodes.JUMP, 0);
    loopCtx.breakJumps.push(this.instructions.length - 1);
  }

  compileContinue(stmt) {
    const loopCtx = this.currentLoopContext();
    if (!loopCtx) {
      throw new Error(`CONTINUE used outside loop${this.locSuffix(stmt)}`);
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
  // jumps straight past every remaining case (and DEFAULT) to the end -
  // BREAK is never needed to keep cases from running into each other.
  // The subject is evaluated once into a hidden local (matching the
  // pattern used for FOR's step in compileFor) so a subject expression
  // with side effects - a function call, say - doesn't re-run once per
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

      // A CASE with several comma-separated values ("CASE 1, 2, 3") runs
      // its body if the subject matches *any* of them. Test every value
      // but the last with JUMP_IF_TRUE straight into the body - no need
      // to check the rest once one has already matched - and use the
      // existing single-value JUMP_IF_FALSE-to-next-case test for the
      // last one, so a CASE with exactly one value (the common case)
      // compiles to exactly what it always did: the loop below simply
      // doesn't run for it.
      const matchJumps = [];
      for (let i = 0; i < switchCase.values.length - 1; i++) {
        this.emit(OpCodes.LOAD_LOCAL, subjectIdx);
        this.compileExpression(switchCase.values[i]);
        this.emit(OpCodes.EQ);
        this.emit(OpCodes.JUMP_IF_TRUE, 0); // Placeholder, patched to this case's body
        matchJumps.push(this.instructions.length - 1);
      }

      this.emit(OpCodes.LOAD_LOCAL, subjectIdx);
      this.compileExpression(switchCase.values[switchCase.values.length - 1]);
      this.emit(OpCodes.EQ);
      this.emit(OpCodes.JUMP_IF_FALSE, 0); // Placeholder, patched to next case/DEFAULT/end
      nextCaseJump = this.instructions.length - 1;

      const bodyStart = this.instructions.length;
      for (const jumpIdx of matchJumps) {
        this.instructions[jumpIdx].operands[0] = bodyStart;
      }

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
    // Reuse the existing slot when the loop variable is a name that's
    // already declared in this scope - a canonical process field, a
    // param/private, or an implicitly-created local - instead of always
    // allocating a fresh one. Classic DIV animation loops drive a
    // canonical field directly ("FROM graph=5 TO 10; FRAME; END" cycling
    // through explosion frames), and blindly rebinding the name to a new
    // slot here silently split it in two: earlier writes (`graph=4;`)
    // had their old slot number already baked into emitted bytecode,
    // while every later *read* - including the renderer's own
    // getProcessLocalSlot('graph') lookup, which consults this map -
    // resolved to the new slot. The process then drew with graph=0 (the
    // fallback placeholder) no matter what either slot held.
    let varIdx = this.localMap.get(stmt.varName);
    if (varIdx === undefined) {
      varIdx = this.nextLocalSlot++;
      this.localMap.set(stmt.varName, varIdx);
    } else if (typeof varIdx === 'object' && varIdx.isArray) {
      throw new Error(
        `Array "${stmt.varName}" cannot be used as a FOR loop variable${this.locSuffix(stmt)}`
      );
    }

    // When the step is a literal number - "STEP 2", "STEP -1", or the
    // implicit default of 1 when STEP is omitted entirely - its sign is
    // already known at compile time, covering the overwhelming majority
    // of real FOR loops. In that case skip straight to the one
    // comparison that direction actually needs (LTE for ascending, GTE
    // for descending) instead of the general run-time-checked form
    // below, which the disassembler (compiler/disasm.js) showed compiles
    // "(step >= 0 AND i <= end) OR (step < 0 AND i >= end)" into roughly
    // 30 instructions re-executed on *every* iteration - deadweight for
    // a loop whose direction was never actually in question. The general
    // form is kept, unchanged, for the genuinely dynamic case (STEP some
    // variable or expression), where the direction really can't be
    // decided until the loop is running.
    const constantStepValue = getConstantNumericValue(stmt.step);
    const isConstantStep = constantStepValue !== null;

    let stepIdx = null;
    let stepVarName = null;
    if (!isConstantStep) {
      // The step is evaluated once and cached in a hidden local, both so
      // an expression with side effects (e.g. a function call) doesn't
      // re-run every iteration, and so the exit test below can read its
      // sign consistently across every iteration of the loop.
      this.forDepth = (this.forDepth || 0) + 1;
      const stepVarNameLocal = `__for_step_${this.forDepth}`;
      stepVarName = stepVarNameLocal;
      stepIdx = this.nextLocalSlot++;
      this.localMap.set(stepVarName, stepIdx);
    }

    this.compileExpression(stmt.start);
    this.emit(OpCodes.STORE_LOCAL, varIdx);

    if (!isConstantStep) {
      this.compileExpression(stmt.step);
      this.emit(OpCodes.STORE_LOCAL, stepIdx);
    }

    const loopStart = this.instructions.length;

    // A positive-step FOR must stop once i > end; a negative-step FOR
    // (STEP -1, counting down) must stop once i < end. Using "i > end"
    // regardless of step direction is the bug this whole comment block
    // exists to avoid: a descending FOR would exit on its very first
    // check (e.g. "FOR i = 5 TO 0 STEP -1" would run zero iterations
    // instead of six).
    if (isConstantStep) {
      this.emit(OpCodes.LOAD_LOCAL, varIdx);
      this.compileExpression(stmt.end);
      this.emit(constantStepValue >= 0 ? OpCodes.LTE : OpCodes.GTE);
      this.emit(OpCodes.JUMP_IF_FALSE, 0); // Placeholder
    } else {
      // The step can be a runtime expression, so the direction can't be
      // decided at compile time - continue while:
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
    }
    const jumpToEnd = this.instructions.length - 1;

    const loopCtx = this.beginLoopContext();
    this.compileBlock(stmt.body);

    const continueTarget = this.instructions.length;

    this.emit(OpCodes.LOAD_LOCAL, varIdx);
    if (isConstantStep) {
      this.emit(OpCodes.LOAD_CONST, this.addConstant(constantStepValue));
    } else {
      this.emit(OpCodes.LOAD_LOCAL, stepIdx);
    }
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

  // C-style FOR: init once, then test / body / step each pass. CONTINUE
  // has to land on the step rather than the condition, otherwise it would
  // skip the increment and spin forever.
  compileCFor(stmt) {
    if (stmt.init) {
      this.compileStatementValue(stmt.init);
    }

    const loopStart = this.instructions.length;
    let jumpToEnd = -1;
    if (stmt.condition) {
      this.compileExpression(stmt.condition);
      this.emit(OpCodes.JUMP_IF_FALSE, 0); // Placeholder
      jumpToEnd = this.instructions.length - 1;
    }

    const loopCtx = this.beginLoopContext();
    this.compileBlock(stmt.body);

    const continueTarget = this.instructions.length;
    if (stmt.step) {
      this.compileStatementValue(stmt.step);
    }
    this.emit(OpCodes.LOOP, loopStart);

    const loopEnd = this.instructions.length;
    if (jumpToEnd >= 0) {
      this.instructions[jumpToEnd].operands[0] = loopEnd;
    }
    this.patchLoopJumps(loopCtx, continueTarget, loopEnd);
    this.endLoopContext();
  }

  // Compiles an expression used for effect, discarding any value it
  // leaves behind (an assignment leaves none; a bare call leaves one).
  compileStatementValue(expr) {
    if (expr.type === 'assign') {
      this.compileAssignment(expr);
      return;
    }
    this.compileExpression(expr);
    this.emit(OpCodes.POP);
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
        const entry = this.localMap.get(name);
        if (typeof entry === 'object' && entry.isArray) {
          throw new Error(`Array "${name}" must be assigned with an index: ${name}[i] = v${this.locSuffix(stmt)}`);
        }
        this.compileExpression(stmt.value);
        this.emit(OpCodes.STORE_LOCAL, entry);
      }
      // Check if global
      else if (this.globalMap.has(name)) {
        const entry = this.globalMap.get(name);
        if (typeof entry === 'object' && entry.isArray) {
          throw new Error(`Array "${name}" must be assigned with an index: ${name}[i] = v${this.locSuffix(stmt)}`);
        }
        this.compileExpression(stmt.value);
        this.emit(OpCodes.STORE_GLOBAL, entry);
      }
      // Bare "timer = v" means timer[0] = v, same shorthand as the bare
      // read in compileIdentifier - only reachable when nothing already
      // declared "timer" as a real local/global (checked above), so a
      // script using the name for its own variable is unaffected.
      else if (name.toLowerCase() === 'timer') {
        this.emit(OpCodes.LOAD_CONST, this.addConstant('timer'));
        this.emit(OpCodes.LOAD_CONST, this.addConstant(0));
        this.compileExpression(stmt.value);
        this.emit(OpCodes.CALL_NATIVE, '__set_path', 3);
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
      if (this.tryCompileMouseAssign(stmt.target, stmt.value)) {
        return;
      }
      this.compilePathSet(stmt.target, stmt.value);
      return;
    }

    throw new Error(`Invalid assignment target: ${stmt.target.type}${this.locSuffix(stmt)}`);
  }

  // Assignment in expression position: perform the store, then leave the
  // assigned value on the stack for the enclosing expression to consume.
  // Done by re-reading the target after storing rather than DUP-ing the
  // value beforehand, so path targets (which route through
  // compilePathSet's own multi-argument native call) work identically to
  // plain locals/globals without duplicating that logic here.
  compileAssignmentAsExpression(expr) {
    this.compileAssignment(expr);

    if (expr.target.type === 'identifier') {
      this.compileIdentifier(expr.target);
      return;
    }
    if (expr.target.type === 'member_access' || expr.target.type === 'index_access') {
      if (!this.tryCompileMouseAccess(expr.target)) {
        this.compilePathGet(expr.target);
      }
      return;
    }

    throw new Error(`Invalid assignment target: ${expr.target.type}${this.locSuffix(expr)}`);
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

      case 'offset_operator':
        this.compileOffsetOperator(expr);
        break;

      case 'member_access':
      case 'index_access':
        if (!this.tryCompileMouseAccess(expr)) {
          this.compilePathGet(expr);
        }
        break;

      case 'assign':
        // Assignment used as a sub-expression, e.g. DIV's
        // "IF (apple_id = collision(TYPE apple))" - assign, then test the
        // assigned value (classic-DIV "extended conditions"). This must
        // leave exactly one value on the stack, unlike the statement form
        // in compileAssignment() which deliberately leaves none: getting
        // that wrong silently pops whatever the enclosing expression had
        // pushed (or the pop() underflow default) and corrupts state with
        // no error, which is why this used to be rejected outright.
        this.compileAssignmentAsExpression(expr);
        break;

      default:
        throw new Error(`Unknown expression type: ${expr.type}${this.locSuffix(expr)}`);
    }
  }

  // Compile identifier
  compileIdentifier(expr) {
    const name = expr.name;
    const nameLower = name.toLowerCase(); // constants are case-insensitive
    const builtinConstants = BUILTIN_CONSTANTS;

    // Check if local
    if (this.localMap.has(name)) {
      const entry = this.localMap.get(name);
      if (typeof entry === 'object' && entry.isArray) {
        throw new Error(`Array "${name}" must be accessed with an index: ${name}[i]${this.locSuffix(expr)}`);
      }
      this.emit(OpCodes.LOAD_LOCAL, entry);
    }
    // Check if global
    else if (this.globalMap.has(name)) {
      const entry = this.globalMap.get(name);
      if (typeof entry === 'object' && entry.isArray) {
        throw new Error(`Array "${name}" must be accessed with an index: ${name}[i]${this.locSuffix(expr)}`);
      }
      this.emit(OpCodes.LOAD_GLOBAL, entry);
    }
    // Check builtin constants
    else if (Object.prototype.hasOwnProperty.call(builtinConstants, nameLower)) {
      this.emit(OpCodes.LOAD_CONST, this.addConstant(builtinConstants[nameLower]));
    }
    // CONST block entries - resolved to a plain number back in
    // compileConsts, case-sensitive like GLOBAL/LOCAL (unlike the
    // builtins above, which the language treats case-insensitively).
    else if (this.constMap.has(name)) {
      this.emit(OpCodes.LOAD_CONST, this.addConstant(this.constMap.get(name)));
    }
    // Real DIV exposes FPS as a bare read-only global (current frame
    // rate), not a function call - rewritten into the get_fps native the
    // runtime already provides, same trick as mouse.x/mouse.left in
    // tryCompileMouseAccess. Only fires when nothing declared "fps" as a
    // real local/global, so a script using it for its own variable still
    // works normally.
    else if (nameLower === 'fps') {
      this.emit(OpCodes.CALL_NATIVE, 'get_fps', 0);
    }
    // Real DIV's "fading" is a bare read-only global too: 1 while a
    // fade_on/fade_off/fade is in progress, back to 0 once it finishes
    // (DIV manual: "the fading variable will automatically become equal
    // to true (1)... and when it is finished, it will recover its
    // original value, false (0)"). Same trick as fps - rewritten into
    // the is_fading native the runtime already provides.
    else if (nameLower === 'fading') {
      this.emit(OpCodes.CALL_NATIVE, 'is_fading', 0);
    }
    // Real DIV's "scan_code" is a bare read-only global holding the scan
    // code of the last key pressed this frame, or 0 if none was (DIV
    // manual: "will be at 0 if no key has been pressed in the previous
    // frame"). Rewritten into a native the runtime tracks per frame.
    else if (nameLower === 'scan_code') {
      this.emit(OpCodes.CALL_NATIVE, 'get_scan_code', 0);
    }
    // Bare "timer" (no index) means timer[0] - DIV manual: "if only one
    // counter is needed, it is possible to use timer simply". The
    // indexed form (timer[0], timer[9], ...) already works through the
    // generic __get_path machinery once state.timer exists as an array
    // (see ensureTimerState in runtime.js) - this just covers the
    // no-index shorthand, which never reaches compilePathGet at all.
    else if (nameLower === 'timer') {
      this.emit(OpCodes.LOAD_CONST, this.addConstant('timer'));
      this.emit(OpCodes.LOAD_CONST, this.addConstant(0));
      this.emit(OpCodes.CALL_NATIVE, '__get_path', 2);
    }
    // Bare FATHER/SON - DIV's relative-process references used as plain
    // values, e.g. "signal(son, s_kill_tree)". The "father.x" member form
    // already works through __get_path's relative-root handling; this is
    // the same idea without a field, yielding just the process id.
    else if (nameLower === 'father' || nameLower === 'son') {
      this.emit(OpCodes.LOAD_CONST, this.addConstant(nameLower));
      this.emit(OpCodes.CALL_NATIVE, '__get_path', 1);
    }
    else {
      throw new Error(`Unknown variable: ${name}${this.locSuffix(expr)}`);
    }
  }

  // OFFSET <global> - pushes a live-reference descriptor (not the current
  // value) for the runtime's write/write_int to detect and re-resolve
  // fresh on every frame it's drawn, rather than baking in a snapshot
  // taken at the point OFFSET is evaluated. See runtime.js's
  // writeNative/writeIntNative for the consuming half. Only GLOBALs are
  // supported - that's the only scope a value can meaningfully outlive
  // and keep changing across the single WRITE call site that named it
  // once (a local belongs to one specific process's lifetime, which real
  // DIV's OFFSET was never used for).
  compileOffsetOperator(expr) {
    const name = expr.name;
    if (!this.globalMap.has(name)) {
      throw new Error(
        `OFFSET "${name}" - no such GLOBAL${this.locSuffix(expr)}. ` +
        `OFFSET only works on a GLOBAL (real DIV usage: WRITE/WRITE_INT auto-refreshing as it changes).`
      );
    }
    const entry = this.globalMap.get(name);
    if (typeof entry === 'object' && entry.isArray) {
      throw new Error(`OFFSET "${name}" - arrays aren't supported, index it first: OFFSET ${name}[i] isn't valid either${this.locSuffix(expr)}`);
    }
    this.emit(OpCodes.LOAD_CONST, this.addConstant({ __divOffsetGlobal: true, slot: entry }));
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
        throw new Error(`Unknown binary operator: ${expr.operator}${this.locSuffix(expr)}`);
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
        throw new Error(`Unknown unary operator: ${expr.operator}${this.locSuffix(expr)}`);
    }
  }

  // Compile call
  compileCall(expr) {
    // A callee that isn't a plain name (e.g. some future computed-call
    // expression) has no dispatch rule below that would ever match it -
    // reject it now, before compiling any args, instead of silently
    // falling through: previously this compiled every argument expression
    // (pushing them onto the stack) and then emitted no call instruction
    // at all, leaving orphaned values on the stack with no error.
    if (expr.callee.type !== 'identifier') {
      throw new Error(`Cannot call a non-identifier expression${this.locSuffix(expr)}`);
    }

    const name = expr.callee.name;
    const argc = expr.args.length;

    // DIV's GET_POINT(file, graph, point, &x, &y) - the two trailing
    // OFFSET args are out-parameters the native writes the point's x/y
    // into directly (a different use of "&" than the OFFSET operator's
    // usual WRITE-live-reference role, and the only real DIV out-param
    // pattern this compiler needs: no other builtin uses it in the wild
    // besides GET_POINT). No true by-reference native calling
    // convention exists here, so this desugars to the equivalent pair
    // of assignments using the get_point_x/get_point_y convenience
    // natives instead of trying to pass a writable slot through
    // CALL_NATIVE's plain by-value argument stack.
    if (name.toLowerCase() === 'get_point' && argc === 5 &&
      expr.args[3].type === 'offset_operator' && expr.args[4].type === 'offset_operator') {
      const [fileArg, graphArg, pointArg, xOut, yOut] = expr.args;
      this.compileAssignment(new ast.Assign(
        new ast.Identifier(xOut.name),
        new ast.Call(new ast.Identifier('get_point_x'), [fileArg, graphArg, pointArg])
      ));
      this.compileAssignment(new ast.Assign(
        new ast.Identifier(yOut.name),
        new ast.Call(new ast.Identifier('get_point_y'), [fileArg, graphArg, pointArg])
      ));
      this.emit(OpCodes.LOAD_CONST, this.addConstant(0));
      return;
    }

    // Process/function arity is known at compile time (unlike natives,
    // which register themselves on the VM at runtime, after compilation
    // has already finished - there's no static arity table for those to
    // check against here). Neither supports default/optional params, so
    // any mismatch here is unambiguously wrong, not just unusual.
    const processInfo = this.processTable.get(name);
    if (processInfo && argc !== processInfo.params.length) {
      throw new Error(
        `PROCESS "${name}" expects ${processInfo.params.length} argument(s), got ${argc}${this.locSuffix(expr)}`
      );
    }
    const functionInfo = !processInfo ? this.functionTable.get(name) : undefined;
    if (functionInfo && argc !== functionInfo.params.length) {
      throw new Error(
        `FUNCTION "${name}" expects ${functionInfo.params.length} argument(s), got ${argc}${this.locSuffix(expr)}`
      );
    }

    // Compile args
    for (const arg of expr.args) {
      this.compileExpression(arg);
    }

    // Check if process call
    if (processInfo) {
      this.emit(OpCodes.SPAWN_PROCESS, name, argc);
    }
    // Check if function call
    else if (functionInfo) {
      this.emit(OpCodes.CALL, name, argc);
    }
    // Native - arity isn't known at compile time, see above.
    else {
      this.emit(OpCodes.CALL_NATIVE, name, argc);
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
      throw new Error(`Unsupported access target${this.locSuffix(current)}`);
    }

    return {
      root: current.name,
      segments
    };
  }

  // Matches struct access patterns and emits the index computation.
  // Works for arbitrary nesting depth. For dynamic cases the computed
  // offset is left on the stack as a side-effect before returning.
  compileStructIndex(path) {
    const st = this.structMap.get(path.root);
    if (!st) return { handled: false };

    // Walk the segment list, collecting additive terms:
    //   {kind:'const', v:N}  or  {kind:'dyn', expr, mult:M}
    const terms = [];
    let currentFields = st.fields;
    let currentInstanceSize = st.instanceSize;
    const segs = path.segments;
    let i = 0;

    while (i < segs.length) {
      const seg = segs[i];

      if (seg.kind === 'index') {
        terms.push({ kind: 'dyn', expr: seg.value, mult: currentInstanceSize });
        i++;
        // After array index, context (currentFields/instanceSize) is unchanged -
        // the next segment selects a field within one instance.
      } else { // 'prop'
        const f = currentFields.get(seg.value);
        if (!f) throw new Error(`Unknown struct field "${path.root}...${seg.value}"`);
        if (f.offset > 0) terms.push({ kind: 'const', v: f.offset });

        if (f.isNested) {
          // Descend into nested struct; next segment may be [index] into it
          currentFields = f.nestedDef.fields;
          currentInstanceSize = f.nestedDef.instanceSize;
          i++;
        } else if (f.size > 1) {
          // Array field: next must be [j]
          if (i + 1 < segs.length && segs[i + 1].kind === 'index') {
            terms.push({ kind: 'dyn', expr: segs[i + 1].value, mult: 1 });
            i += 2;
          } else {
            throw new Error(`Array field "${seg.value}" requires index [j]`);
          }
        } else {
          i++; // scalar - terminal
        }
      }
    }

    // Static-only path: all const terms, no indices
    if (terms.every(t => t.kind === 'const')) {
      const offset = terms.reduce((s, t) => s + t.v, 0);
      return { handled: true, isStatic: true, slot: st.base + offset };
    }

    // Dynamic path: emit sum of all terms
    const staticTotal = terms.filter(t => t.kind === 'const').reduce((s, t) => s + t.v, 0);
    const dynTerms    = terms.filter(t => t.kind === 'dyn');

    this.compileExpression(dynTerms[0].expr);
    if (dynTerms[0].mult !== 1) {
      this.emit(OpCodes.LOAD_CONST, this.addConstant(dynTerms[0].mult));
      this.emit(OpCodes.MUL);
    }
    for (let d = 1; d < dynTerms.length; d++) {
      this.compileExpression(dynTerms[d].expr);
      if (dynTerms[d].mult !== 1) {
        this.emit(OpCodes.LOAD_CONST, this.addConstant(dynTerms[d].mult));
        this.emit(OpCodes.MUL);
      }
      this.emit(OpCodes.ADD);
    }
    if (staticTotal > 0) {
      this.emit(OpCodes.LOAD_CONST, this.addConstant(staticTotal));
      this.emit(OpCodes.ADD);
    }

    return { handled: true, isStatic: false, base: st.base, totalSize: st.count * st.instanceSize };
  }

  // If `indexExpr` is a compile-time constant (a bare number literal or a
  // unary-minus-wrapped one - see getConstantNumericValue), reject it
  // immediately as a compile error when it falls outside [0, size). This
  // catches the single most common mistake - an off-by-one literal index,
  // or writing size instead of size-1 as a loop bound - at compile time
  // instead of letting it through to become a runtime bounds violation
  // (see the STORE_LOCAL_IDX/STORE_GLOBAL_IDX bounds check in vm.js for
  // the runtime half of this: a *variable* index out of range, which
  // can't be caught here since its value isn't known until the VM runs).
  // Without either check, LOAD/STORE_*_IDX computed `base + index`
  // directly with no validation at all - an out-of-bounds index silently
  // read or wrote whatever unrelated global/local happened to sit at
  // that computed offset (confirmed: "GLOBAL a[3], b[3]; a[3] = 999;"
  // silently corrupted b[0], since arrays are allocated in consecutive
  // slots - and a negative index corrupts backwards past the array's
  // own start the same way).
  checkConstantArrayIndex(arrayName, indexExpr, size) {
    const constIndex = getConstantNumericValue(indexExpr);
    if (constIndex !== null && (constIndex < 0 || constIndex >= size || !Number.isInteger(constIndex))) {
      throw new Error(
        `Array index out of bounds: "${arrayName}[${constIndex}]" - ` +
        `"${arrayName}" was declared with size ${size}, valid indices are 0..${size - 1}.` +
        `${this.locSuffix(indexExpr)}`
      );
    }
  }

  // DIV syntax exposes the mouse as a pseudo-struct: mouse.x, mouse.y,
  // mouse.left/right/middle. There's no real "mouse" local/global/struct -
  // this rewrites those member accesses into the mouse_x/mouse_y/mouse_button
  // native calls the runtime already provides. Returns false (and leaves the
  // expression untouched) if `mouse` was shadowed by a real declared
  // variable, so a genuine struct named "mouse" still works normally.
  tryCompileMouseAccess(expr) {
    if (expr.type !== 'member_access') {
      return false;
    }
    const obj = expr.object;
    if (!obj || obj.type !== 'identifier' || obj.name.toLowerCase() !== 'mouse') {
      return false;
    }
    if (this.localMap.has(obj.name) || this.globalMap.has(obj.name)) {
      return false;
    }

    const mouseFields = {
      x: { native: 'mouse_x', args: [] },
      y: { native: 'mouse_y', args: [] },
      left: { native: 'mouse_button', args: [0] },
      right: { native: 'mouse_button', args: [1] },
      middle: { native: 'mouse_button', args: [2] },
      button: { native: 'mouse_button', args: [0] }
    };
    const field = mouseFields[String(expr.property).toLowerCase()];
    if (field) {
      for (const value of field.args) {
        this.emit(OpCodes.LOAD_CONST, this.addConstant(value));
      }
      this.emit(OpCodes.CALL_NATIVE, field.native, field.args.length);
      return true;
    }

    // Any other field - GRAPH, FILE, SIZE, ANGLE, ... - reads off the
    // mouse Process the runtime maintains (see registerNatives), since
    // DIV's mouse is a process like any other.
    this.emit(OpCodes.LOAD_CONST, this.addConstant(String(expr.property)));
    this.emit(OpCodes.CALL_NATIVE, '__get_mouse_field', 1);
    return true;
  }

  // Write half: "mouse.graph = 999".
  tryCompileMouseAssign(targetExpr, valueExpr) {
    if (targetExpr.type !== 'member_access') {
      return false;
    }
    const obj = targetExpr.object;
    if (!obj || obj.type !== 'identifier' || obj.name.toLowerCase() !== 'mouse') {
      return false;
    }
    if (this.localMap.has(obj.name) || this.globalMap.has(obj.name)) {
      return false;
    }

    this.emit(OpCodes.LOAD_CONST, this.addConstant(String(targetExpr.property)));
    this.compileExpression(valueExpr);
    this.emit(OpCodes.CALL_NATIVE, '__set_mouse_field', 2);
    return true;
  }

  compilePathGet(expr) {
    const path = this.collectPath(expr);

    // Route to indexed opcodes for declared arrays
    if (path.segments.length === 1 && path.segments[0].kind === 'index') {
      const localEntry = this.localMap.get(path.root);
      if (localEntry && typeof localEntry === 'object' && localEntry.isArray) {
        this.checkConstantArrayIndex(path.root, path.segments[0].value, localEntry.size);
        this.compileExpression(path.segments[0].value);
        this.emit(OpCodes.LOAD_LOCAL_IDX, localEntry.base, localEntry.size);
        return;
      }
      const globalEntry = this.globalMap.get(path.root);
      if (globalEntry && typeof globalEntry === 'object' && globalEntry.isArray) {
        this.checkConstantArrayIndex(path.root, path.segments[0].value, globalEntry.size);
        this.compileExpression(path.segments[0].value);
        this.emit(OpCodes.LOAD_GLOBAL_IDX, globalEntry.base, globalEntry.size);
        return;
      }
    }

    // Struct access
    const sr = this.compileStructIndex(path);
    if (sr.handled) {
      if (sr.isStatic) {
        this.emit(OpCodes.LOAD_GLOBAL, sr.slot);
      } else {
        // Bounds-checks the combined offset (every dynamic index term -
        // the struct array index itself, plus any array-field index
        // like anim[0].frames[j] - summed and multiplied together) against
        // the struct's total reserved footprint (count * instanceSize).
        // Without this, "enemyA[2].x" on a declared-2-instance struct
        // array computed an offset that silently landed inside whatever
        // was allocated right after enemyA - confirmed: it read/wrote a
        // second, unrelated STRUCT declared immediately after it. This
        // catches "the combined index runs past the end of this struct's
        // own block" - the practical case that actually occurs from a
        // single wrong index - though a pathological combination of a
        // negative index on one term offsetting a too-large index on
        // another could in principle still land in-range; the same
        // caveat already applies to the simpler flat-array bounds check.
        this.emit(OpCodes.LOAD_GLOBAL_IDX, sr.base, sr.totalSize);
      }
      return;
    }

    // "someVar.field" where someVar is a declared scalar holding a
    // process id - DIV's cross-process field read ("raquet1.y", with
    // raquet1 = raquet(...) storing the spawned id). The generic
    // __get_path below can't express this: it passes the root as a
    // *name* string, but here the root's runtime *value* identifies the
    // process. Resolve it through a dedicated native instead.
    if (this.isProcessRefRoot(path)) {
      this.compileIdentifier({ type: 'identifier', name: path.root });
      this.emit(OpCodes.LOAD_CONST, this.addConstant(path.segments[0].value));
      this.emit(OpCodes.CALL_NATIVE, '__get_process_field', 2);
      return;
    }

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

  // True for "<declared scalar>.<field>" - a single property segment off
  // a plain local/global (not an array, not a struct, not one of the
  // runtime's own special roots like scroll/region/father/son, all of
  // which are handled earlier or by __get_path). That shape is DIV's
  // cross-process field access, where the variable holds a process id.
  isProcessRefRoot(path) {
    if (path.segments.length !== 1 || path.segments[0].kind !== 'prop') {
      return false;
    }
    const reserved = new Set(['scroll', 'region', 'father', 'son', 'mouse']);
    if (reserved.has(String(path.root).toLowerCase())) {
      return false;
    }
    const entry = this.localMap.has(path.root)
      ? this.localMap.get(path.root)
      : (this.globalMap.has(path.root) ? this.globalMap.get(path.root) : undefined);
    if (entry === undefined) {
      return false;
    }
    // Arrays/structs are objects here; only plain scalar slots qualify.
    return typeof entry !== 'object';
  }

  compilePathSet(targetExpr, valueExpr) {
    const path = this.collectPath(targetExpr);

    // Route to indexed opcodes for declared arrays
    if (path.segments.length === 1 && path.segments[0].kind === 'index') {
      const localEntry = this.localMap.get(path.root);
      if (localEntry && typeof localEntry === 'object' && localEntry.isArray) {
        this.checkConstantArrayIndex(path.root, path.segments[0].value, localEntry.size);
        this.compileExpression(path.segments[0].value);
        this.compileExpression(valueExpr);
        this.emit(OpCodes.STORE_LOCAL_IDX, localEntry.base, localEntry.size);
        return;
      }
      const globalEntry = this.globalMap.get(path.root);
      if (globalEntry && typeof globalEntry === 'object' && globalEntry.isArray) {
        this.checkConstantArrayIndex(path.root, path.segments[0].value, globalEntry.size);
        this.compileExpression(path.segments[0].value);
        this.compileExpression(valueExpr);
        this.emit(OpCodes.STORE_GLOBAL_IDX, globalEntry.base, globalEntry.size);
        return;
      }
    }

    // Struct access - index computation emitted first, then value
    const sr = this.compileStructIndex(path);
    if (sr.handled) {
      if (sr.isStatic) {
        this.compileExpression(valueExpr);
        this.emit(OpCodes.STORE_GLOBAL, sr.slot);
      } else {
        this.compileExpression(valueExpr);
        this.emit(OpCodes.STORE_GLOBAL_IDX, sr.base, sr.totalSize);
      }
      return;
    }

    // Write half of the cross-process field access described in
    // compilePathGet ("raquet1.y = 100").
    if (this.isProcessRefRoot(path)) {
      this.compileIdentifier({ type: 'identifier', name: path.root });
      this.emit(OpCodes.LOAD_CONST, this.addConstant(path.segments[0].value));
      this.compileExpression(valueExpr);
      this.emit(OpCodes.CALL_NATIVE, '__set_process_field', 3);
      return;
    }

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
  // Deduplicate constants: every literal used more than once in the
  // source (0, common colors like '#fff', repeated numeric thresholds)
  // used to get its own fresh slot in the pool - addConstant() just
  // pushed unconditionally and never checked for an existing match, even
  // though the exact caching this method needed was already sitting
  // unused in compiler/bytecode.js's dead Bytecode class. Measured 38%
  // waste on the repo's own shipped demo and up to 79% on a small
  // synthetic program with a handful of repeated 0/color literals - this
  // is pure bytecode bloat with zero behavior change once fixed. Keyed
  // by `${typeof value}:${JSON.stringify(value)}` rather than just
  // JSON.stringify(value) alone so that values which stringify to the
  // same JSON text but aren't the grammar's own literal type can never
  // collide (e.g. JSON.stringify(NaN) === JSON.stringify(null) === 'null'
  // - not reachable from valid source today since NUMBER/STRING tokens
  // can't produce either, but free to guard against regardless).
  addConstant(value) {
    if (!this.constantIndex) {
      this.constantIndex = new Map();
    }
    const key = `${typeof value}:${JSON.stringify(value)}`;
    if (this.constantIndex.has(key)) {
      return this.constantIndex.get(key);
    }
    const idx = this.constants.length;
    this.constants.push(value);
    this.constantIndex.set(key, idx);
    return idx;
  }

  // Emit instruction
  emit(opcode, ...operands) {
    this.instructions.push({ opcode, operands });
  }
}
