// AST node types

export class Program {
  constructor(name, globals, processes, functions, mainBlock) {
    this.type = 'program';
    this.name = name;
    this.globals = globals;
    this.processes = processes;
    this.functions = functions;
    this.mainBlock = mainBlock;
  }
}

export class Global {
  constructor(name, value) {
    this.type = 'global';
    this.name = name;
    this.value = value;
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
  constructor(name, value) {
    this.type = 'private';
    this.name = name;
    this.value = value;
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
  constructor() {
    this.type = 'frame';
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

export class TypeOperator {
  constructor(processName) {
    this.type = 'type_operator';
    this.processName = processName;
  }
}
