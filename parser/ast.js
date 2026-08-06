/**
 * DivLang AST Node Types
 */

// Base class for all AST nodes
export class Node {
  constructor(type) {
    this.type = type;
  }
}

// Program node
export class Program extends Node {
  constructor(name, globals, processes, functions) {
    super('program');
    this.name = name;
    this.globals = globals || [];
    this.processes = processes || [];
    this.functions = functions || [];
  }
}

// Process declaration
export class Process extends Node {
  constructor(name, params, privates, body) {
    super('process');
    this.name = name;
    this.params = params || [];
    this.privates = privates || [];
    this.body = body || [];
  }
}

// Function declaration
export class FunctionDecl extends Node {
  constructor(name, params, privates, body) {
    super('function');
    this.name = name;
    this.params = params || [];
    this.privates = privates || [];
    this.body = body || [];
  }
}

// Statements
export class Block extends Node {
  constructor(statements) {
    super('block');
    this.statements = statements || [];
  }
}

export class Assignment extends Node {
  constructor(target, value) {
    super('assignment');
    this.target = target;
    this.value = value;
  }
}

export class If extends Node {
  constructor(condition, thenBlock, elseBlock) {
    super('if');
    this.condition = condition;
    this.thenBlock = thenBlock;
    this.elseBlock = elseBlock;
  }
}

export class While extends Node {
  constructor(condition, body) {
    super('while');
    this.condition = condition;
    this.body = body;
  }
}

export class Repeat extends Node {
  constructor(body, condition) {
    super('repeat');
    this.body = body;
    this.condition = condition;
  }
}

export class Loop extends Node {
  constructor(body) {
    super('loop');
    this.body = body;
  }
}

export class For extends Node {
  constructor(variable, from, to, step, body) {
    super('for');
    this.variable = variable;
    this.from = from;
    this.to = to;
    this.step = step;
    this.body = body;
  }
}

export class Break extends Node {
  constructor() {
    super('break');
  }
}

export class Continue extends Node {
  constructor() {
    super('continue');
  }
}

export class Return extends Node {
  constructor(value) {
    super('return');
    this.value = value;
  }
}

export class Frame extends Node {
  constructor() {
    super('frame');
  }
}

export class ExpressionStatement extends Node {
  constructor(expression) {
    super('expression');
    this.expression = expression;
  }
}

// Expressions
export class BinaryOp extends Node {
  constructor(operator, left, right) {
    super('binary');
    this.operator = operator;
    this.left = left;
    this.right = right;
  }
}

export class UnaryOp extends Node {
  constructor(operator, operand) {
    super('unary');
    this.operator = operator;
    this.operand = operand;
  }
}

export class Call extends Node {
  constructor(callee, args) {
    super('call');
    this.callee = callee;
    this.args = args || [];
  }
}

export class Identifier extends Node {
  constructor(name) {
    super('identifier');
    this.name = name;
  }
}

export class Number extends Node {
  constructor(value) {
    super('number');
    this.value = value;
  }
}

export class String extends Node {
  constructor(value) {
    super('string');
    this.value = value;
  }
}

export class Boolean extends Node {
  constructor(value) {
    super('boolean');
    this.value = value;
  }
}

export class Null extends Node {
  constructor() {
    super('null');
  }
}

export class ArrayLiteral extends Node {
  constructor(elements) {
    super('array');
    this.elements = elements || [];
  }
}

export class ObjectLiteral extends Node {
  constructor(properties) {
    super('object');
    this.properties = properties || [];
  }
}

export class Access extends Node {
  constructor(object, property) {
    super('access');
    this.object = object;
    this.property = property;
  }
}

export class Type extends Node {
  constructor(name) {
    super('type');
    this.name = name;
  }
}

export class TypeOperator extends Node {
  constructor(processName) {
    super('type_operator');
    this.processName = processName;
  }
}
