// AST node types

export class Program {
  constructor(name, globals, structs, processes, functions, mainBlock, mainPrivates = [], locals = [], consts = []) {
    this.type = 'program';
    this.name = name;
    this.globals = globals;
    this.structs = structs;
    this.processes = processes;
    this.functions = functions;
    this.mainBlock = mainBlock;
    // PRIVATE declared at top level, i.e. MAIN's own privates - MAIN is a
    // process in DIV and may declare them like any other.
    this.mainPrivates = mainPrivates;
    // LOCAL section: fields every process gets its own copy of.
    this.locals = locals;
    // CONST section: name=expr pairs resolved to plain numbers at
    // compile time (see Compiler.compileConsts) - no runtime storage,
    // must come before GLOBAL in source order per the DIV manual.
    this.consts = consts;
  }
}

export class Global {
  constructor(name, value, size) {
    this.type = 'global';
    this.name = name;
    this.value = value;
    if (size !== undefined) this.size = size; // present only for array declarations
  }
}

export class Function {
  constructor(name, params, body) {
    this.type = 'function';
    this.name = name;
    this.params = params;
    this.body = body;
  }
}

export class Process {
  constructor(name, params, privates, body) {
    this.type = 'process';
    this.name = name;
    this.params = params;
    this.privates = privates;
    this.body = body;
  }
}

export class Private {
  constructor(name, value, size) {
    this.type = 'private';
    this.name = name;
    this.value = value;
    if (size !== undefined) this.size = size;
  }
}

export class Block {
  constructor(statements) {
    this.type = 'block';
    this.statements = statements;
  }
}

export class If {
  constructor(condition, thenBranch, elseBranch) {
    this.type = 'if';
    this.condition = condition;
    this.thenBranch = thenBranch;
    this.elseBranch = elseBranch;
  }
}

// A SWITCH has no fallthrough between cases by design: each CASE body
// runs and then control jumps straight to the end of the SWITCH, so BREAK
// is never needed to keep cases separate (unlike C's switch). BREAK still
// works normally *inside* a case body, but - like inside an IF - it
// refers to whatever loop the SWITCH itself is nested in, if any; SWITCH
// doesn't open its own loop context.
export class Switch {
  constructor(subject, cases, defaultBody) {
    this.type = 'switch';
    this.subject = subject;
    this.cases = cases; // Array<{ values: Expr[], body: Block }> - a CASE can list several comma-separated values sharing one body
    this.defaultBody = defaultBody; // Block | null
  }
}

export class For {
  constructor(varName, start, end, step, body) {
    this.type = 'for';
    this.varName = varName;
    this.start = start;
    this.end = end;
    this.step = step;
    this.body = body;
  }
}

// C-style FOR (init; condition; step) - kept distinct from For, whose
// counted DIV form has different semantics.
export class CFor {
  constructor(init, condition, step, body) {
    this.type = 'cfor';
    this.init = init;
    this.condition = condition;
    this.step = step;
    this.body = body;
  }
}

export class While {
  constructor(condition, body) {
    this.type = 'while';
    this.condition = condition;
    this.body = body;
  }
}

export class Repeat {
  constructor(body, condition) {
    this.type = 'repeat';
    this.body = body;
    this.condition = condition;
  }
}

export class Loop {
  constructor(body) {
    this.type = 'loop';
    this.body = body;
  }
}

export class Var {
  constructor(name, value) {
    this.type = 'var';
    this.name = name;
    this.value = value;
  }
}

export class Return {
  constructor(value) {
    this.type = 'return';
    this.value = value;
  }
}

export class Break {
  constructor() {
    this.type = 'break';
  }
}

export class Continue {
  constructor() {
    this.type = 'continue';
  }
}

export class Frame {
  constructor(value = null) {
    this.type = 'frame';
    this.value = value;
  }
}

export class ExpressionStatement {
  constructor(expression) {
    this.type = 'expression';
    this.expression = expression;
  }
}

export class Assign {
  constructor(target, value) {
    this.type = 'assign';
    this.target = target;
    this.value = value;
  }
}

export class Binary {
  constructor(left, operator, right) {
    this.type = 'binary';
    this.left = left;
    this.operator = operator;
    this.right = right;
  }
}

export class Unary {
  constructor(operator, operand) {
    this.type = 'unary';
    this.operator = operator;
    this.operand = operand;
  }
}

export class Call {
  constructor(callee, args) {
    this.type = 'call';
    this.callee = callee;
    this.args = args;
  }
}

export class Number {
  constructor(value) {
    this.type = 'number';
    this.value = value;
  }
}

export class String {
  constructor(value) {
    this.type = 'string';
    this.value = value;
  }
}

export class Identifier {
  constructor(name) {
    this.type = 'identifier';
    this.name = name;
  }
}

export class MemberAccess {
  constructor(object, property) {
    this.type = 'member_access';
    this.object = object;
    this.property = property;
  }
}

export class IndexAccess {
  constructor(object, index) {
    this.type = 'index_access';
    this.object = object;
    this.index = index;
  }
}

export class TypeOperator {
  constructor(processName) {
    this.type = 'type_operator';
    this.processName = processName;
  }
}

// OFFSET <global> - a live reference to a GLOBAL, used with WRITE/WRITE_INT
// so the on-screen text auto-refreshes as the global changes instead of
// needing to be redrawn every frame by hand.
export class OffsetOperator {
  constructor(name) {
    this.type = 'offset_operator';
    this.name = name;
  }
}

// fields: [{name, defaultValue|null, size|null, nested:StructDecl|null}]
// initializers: flat array of value expressions | null
export class StructDecl {
  constructor(name, count, fields, initializers = null) {
    this.type = 'struct_decl';
    this.name = name;
    this.count = count;
    this.fields = fields;
    this.initializers = initializers;
  }
}
