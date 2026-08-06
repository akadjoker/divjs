import { TokenType } from '../compiler/tokenizer.js';
import * as ast from '../compiler/ast.js';

export class Parser {
  constructor(tokens) {
    this.tokens = tokens;
    this.pos = 0;
  }

  // Get current token
  current() {
    if (this.pos >= this.tokens.length) {
      return this.tokens[this.tokens.length - 1]; // EOF
    }
    return this.tokens[this.pos];
  }

  // Get previous token
  previous() {
    if (this.pos <= 0) {
      return this.tokens[0];
    }
    return this.tokens[this.pos - 1];
  }

  // Check if current token is type
  is(type) {
    return this.current().type === type;
  }

  // Consume token if matches
  match(type) {
    if (this.is(type)) {
      this.pos++;
      return true;
    }
    return false;
  }

  // Expect token
  expect(type, message) {
    if (!this.is(type)) {
      throw new Error(message || `Expected ${TokenType[type]} at ${this.current().line}:${this.current().col}`);
    }
    this.pos++;
  }

  // Parse program
  parse() {
    // Program header: PROGRAM name;
    this.expect(TokenType.PROGRAM, 'Expected PROGRAM keyword');
    const name = this.current().value;
    this.pos++;
    this.expect(TokenType.SEMICOLON, 'Expected ; after program name');

    const globals = [];
    const processes = [];
    const functions = [];
    const mainBlock = [];

    // Parse all top-level declarations
    while (!this.is(TokenType.EOF)) {
      if (this.is(TokenType.GLOBAL)) {
        globals.push(this.parseGlobal());
      } else if (this.is(TokenType.FUNCTION)) {
        functions.push(this.parseFunction());
      } else if (this.is(TokenType.PROCESS)) {
        processes.push(this.parseProcess());
      } else if (this.is(TokenType.BEGIN)) {
        // Main block
        this.pos++;
        while (!this.is(TokenType.EOF) && !this.is(TokenType.END)) {
          mainBlock.push(this.parseStatement());
        }
        this.expect(TokenType.END, 'Expected END after main block');
      } else {
        throw new Error(`Unexpected token ${this.current().value} at ${this.current().line}:${this.current().col}`);
      }
    }

    return new ast.Program(name, globals, processes, functions, mainBlock);
  }

  // Parse global
  parseGlobal() {
    this.pos++; // consume GLOBAL
    const name = this.current().value;
    this.pos++;

    let value = null;
    if (this.match(TokenType.EQUALS)) {
      value = this.parseExpression();
    }

    this.expect(TokenType.SEMICOLON, 'Expected ; after global declaration');

    return new ast.Global(name, value);
  }

  // Parse function
  parseFunction() {
    this.pos++; // consume FUNCTION
    const name = this.current().value;
    this.pos++;

    // Params
    const params = [];
    this.expect(TokenType.LPAREN, 'Expected ( after function name');

    if (!this.is(TokenType.RPAREN)) {
      do {
        const paramName = this.current().value;
        this.pos++;
        params.push(paramName);
      } while (this.match(TokenType.COMMA));
    }

    this.expect(TokenType.RPAREN, 'Expected ) after function params');
    this.expect(TokenType.SEMICOLON, 'Expected ; after function header');

    // Body
    const body = this.parseBlock();

    return new ast.Function(name, params, body);
  }

  // Parse process
  parseProcess() {
    this.pos++; // consume PROCESS
    const name = this.current().value;
    this.pos++;

    // Params
    const params = [];
    this.expect(TokenType.LPAREN, 'Expected ( after process name');

    if (!this.is(TokenType.RPAREN)) {
      do {
        const paramName = this.current().value;
        this.pos++;
        params.push(paramName);
      } while (this.match(TokenType.COMMA));
    }

    this.expect(TokenType.RPAREN, 'Expected ) after process params');
    this.expect(TokenType.SEMICOLON, 'Expected ; after process header');

    // Parse privates
    const privates = [];
    while (this.match(TokenType.PRIVATE)) {
      privates.push(this.parsePrivate());
    }

    // Body
    const body = this.parseBlock();

    return new ast.Process(name, params, privates, body);
  }

  // Parse private
  parsePrivate() {
    const name = this.current().value;
    this.pos++;

    let value = null;
    if (this.match(TokenType.EQUALS)) {
      value = this.parseExpression();
    }

    this.expect(TokenType.SEMICOLON, 'Expected ; after PRIVATE');

    return new ast.Private(name, value);
  }

  // Parse block
  parseBlock() {
    const statements = [];

    while (!this.is(TokenType.EOF) &&
           !this.is(TokenType.END) &&
           !this.is(TokenType.UNTIL) &&
           !this.is(TokenType.ELSE)) {
      statements.push(this.parseStatement());
    }

    this.expect(TokenType.END, 'Expected END after block');

    return new ast.Block(statements);
  }

  // Parse statement
  parseStatement() {
    // If
    if (this.match(TokenType.IF)) {
      return this.parseIf();
    }

    // For
    if (this.match(TokenType.FOR)) {
      return this.parseFor();
    }

    // While
    if (this.match(TokenType.WHILE)) {
      return this.parseWhile();
    }

    // Repeat
    if (this.match(TokenType.REPEAT)) {
      return this.parseRepeat();
    }

    // Loop
    if (this.match(TokenType.LOOP)) {
      return this.parseLoop();
    }

    // Frame
    if (this.match(TokenType.FRAME)) {
      this.expect(TokenType.SEMICOLON, 'Expected ; after FRAME');
      return new ast.Frame();
    }

    // Var
    if (this.match(TokenType.VAR)) {
      return this.parseVar();
    }

    // Return
    if (this.match(TokenType.RETURN)) {
      const value = this.parseExpression();
      this.expect(TokenType.SEMICOLON, 'Expected ; after RETURN');
      return new ast.Return(value);
    }

    // Break
    if (this.match(TokenType.BREAK)) {
      this.expect(TokenType.SEMICOLON, 'Expected ; after BREAK');
      return new ast.Break();
    }

    // Continue
    if (this.match(TokenType.CONTINUE)) {
      this.expect(TokenType.SEMICOLON, 'Expected ; after CONTINUE');
      return new ast.Continue();
    }

    // Expression/Assignment
    const expr = this.parseExpression();
    this.expect(TokenType.SEMICOLON, 'Expected ; after expression');
    return new ast.ExpressionStatement(expr);
  }

  // Parse if
  parseIf() {
    const condition = this.parseExpression();
    const thenBranch = this.parseBlock();

    let elseBranch = null;
    if (this.match(TokenType.ELSE)) {
      elseBranch = this.parseBlock();
    }

    return new ast.If(condition, thenBranch, elseBranch);
  }

  // Parse for
  parseFor() {
    const varName = this.current().value;
    this.pos++;

    this.expect(TokenType.EQUALS, 'Expected = after FOR var');

    const start = this.parseExpression();

    this.expect(TokenType.TO, 'Expected TO in FOR');

    const end = this.parseExpression();

    let step = new ast.Number(1);
    if (this.match(TokenType.STEP)) {
      step = this.parseExpression();
    }

    const body = this.parseBlock();

    return new ast.For(varName, start, end, step, body);
  }

  // Parse while
  parseWhile() {
    const condition = this.parseExpression();
    const body = this.parseBlock();

    return new ast.While(condition, body);
  }

  // Parse repeat
  parseRepeat() {
    const body = this.parseBlock();

    this.expect(TokenType.UNTIL, 'Expected UNTIL after REPEAT body');

    const condition = this.parseExpression();
    this.expect(TokenType.SEMICOLON, 'Expected ; after UNTIL condition');

    return new ast.Repeat(body, condition);
  }

  // Parse loop
  parseLoop() {
    const body = this.parseBlock();

    return new ast.Loop(body);
  }

  // Parse var
  parseVar() {
    const name = this.current().value;
    this.pos++;

    let value = new ast.Number(0);
    if (this.match(TokenType.EQUALS)) {
      value = this.parseExpression();
    }

    this.expect(TokenType.SEMICOLON, 'Expected ; after VAR');

    return new ast.Var(name, value);
  }

  // Parse expression
  parseExpression() {
    return this.parseAssignment();
  }

  // Parse assignment
  parseAssignment() {
    const left = this.parseOr();

    if (this.match(TokenType.EQUALS)) {
      const right = this.parseAssignment();
      return new ast.Assign(left, right);
    }

    return left;
  }

  // Parse or
  parseOr() {
    let left = this.parseAnd();

    while (this.match(TokenType.OR)) {
      const operator = this.previous().value;
      const right = this.parseAnd();
      left = new ast.Binary(left, operator, right);
    }

    return left;
  }

  // Parse and
  parseAnd() {
    let left = this.parseEquality();

    while (this.match(TokenType.AND)) {
      const operator = this.previous().value;
      const right = this.parseEquality();
      left = new ast.Binary(left, operator, right);
    }

    return left;
  }

  // Parse equality
  parseEquality() {
    let left = this.parseComparison();

    while (this.match(TokenType.EQ) || this.match(TokenType.NEQ)) {
      const operator = this.previous().value;
      const right = this.parseComparison();
      left = new ast.Binary(left, operator, right);
    }

    return left;
  }

  // Parse comparison
  parseComparison() {
    let left = this.parseTerm();

    while (this.match(TokenType.LT) || this.match(TokenType.LTE) ||
           this.match(TokenType.GT) || this.match(TokenType.GTE)) {
      const operator = this.previous().value;
      const right = this.parseTerm();
      left = new ast.Binary(left, operator, right);
    }

    return left;
  }

  // Parse term
  parseTerm() {
    let left = this.parseFactor();

    while (this.match(TokenType.PLUS) || this.match(TokenType.MINUS)) {
      const operator = this.previous().value;
      const right = this.parseFactor();
      left = new ast.Binary(left, operator, right);
    }

    return left;
  }

  // Parse factor
  parseFactor() {
    let left = this.parseUnary();

    while (this.match(TokenType.STAR) || this.match(TokenType.SLASH) || this.match(TokenType.PERCENT)) {
      const operator = this.previous().value;
      const right = this.parseUnary();
      left = new ast.Binary(left, operator, right);
    }

    return left;
  }

  // Parse unary
  parseUnary() {
    if (this.match(TokenType.MINUS) || this.match(TokenType.NOT)) {
      const operator = this.previous().value;
      const right = this.parseUnary();
      return new ast.Unary(operator, right);
    }

    return this.parseCall();
  }

  // Parse call
  parseCall() {
    let expr = this.parsePrimary();

    while (this.match(TokenType.LPAREN)) {
      const args = this.parseArgs();
      expr = new ast.Call(expr, args);
    }

    return expr;
  }

  // Parse args
  parseArgs() {
    const args = [];

    if (!this.is(TokenType.RPAREN)) {
      do {
        args.push(this.parseExpression());
      } while (this.match(TokenType.COMMA));
    }

    this.expect(TokenType.RPAREN, 'Expected ) after function args');

    return args;
  }

  // Parse primary
  parsePrimary() {
    // Number
    if (this.match(TokenType.NUMBER)) {
      return new ast.Number(parseFloat(this.previous().value));
    }

    // String
    if (this.match(TokenType.STRING)) {
      return new ast.String(this.previous().value);
    }

    // Identifier
    if (this.match(TokenType.IDENTIFIER)) {
      return new ast.Identifier(this.previous().value);
    }

    // Parenthesized expression
    if (this.match(TokenType.LPAREN)) {
      const expr = this.parseExpression();
      this.expect(TokenType.RPAREN, 'Expected ) after expression');
      return expr;
    }

    throw new Error(`Unexpected token ${this.current().value} at ${this.current().line}:${this.current().col}`);
  }
}
