/**
 * DivLang Parser
 * AST generator from tokens
 */

import { TokenType } from './lexer.js';
import * as ast from './ast.js';

export class Parser {
  constructor(tokens) {
    this.tokens = tokens;
    this.pos = 0;
  }
  
  // Current token
  current() {
    return this.tokens[this.pos];
  }
  
  // Next token
  peek() {
    return this.tokens[this.pos + 1];
  }
  
  // Advance
  advance() {
    return this.tokens[this.pos++];
  }
  
  // Check if current token is type
  is(type) {
    return this.current().type === type;
  }
  
  // Check and consume
  match(type) {
    if (this.is(type)) {
      return this.advance();
    }
    return null;
  }
  
  // Expect token type
  expect(type, message) {
    if (!this.is(type)) {
      throw new Error(`${message || 'Expected token'} at ${this.current().line}:${this.current().column}`);
    }
    return this.advance();
  }
  
  // Parse program
  parse() {
    const program = this.parseProgram();
    
    if (!this.is(TokenType.EOF)) {
      throw new Error(`Unexpected token '${this.current().value}' at ${this.current().line}:${this.current().column}`);
    }
    
    return program;
  }
  
  // Parse program
  parseProgram() {
    this.expect(TokenType.PROGRAM, 'Expected PROGRAM');
    
    const name = this.expect(TokenType.STRING, 'Expected program name');
    this.match(TokenType.SEMICOLON);
    
    // Globals
    const globals = [];
    if (this.match(TokenType.GLOBAL)) {
      globals.push(...this.parseDeclarations());
    }
    
    // Locals
    const locals = [];
    if (this.match(TokenType.LOCAL)) {
      locals.push(...this.parseDeclarations());
    }
    
    // Processes and functions
    const processes = [];
    const functions = [];
    
    while (!this.is(TokenType.EOF)) {
      if (this.is(TokenType.PROCESS)) {
        processes.push(this.parseProcess());
      } else if (this.is(TokenType.FUNCTION)) {
        functions.push(this.parseFunction());
      } else {
        throw new Error(`Unexpected token '${this.current().value}' at ${this.current().line}:${this.current().column}`);
      }
    }
    
    return new ast.Program(name.value, globals, processes, functions);
  }
  
  // Parse declarations
  parseDeclarations() {
    const declarations = [];
    
    while (!this.is(TokenType.EOF) && 
           !this.is(TokenType.PROCESS) && 
           !this.is(TokenType.FUNCTION) &&
           !this.is(TokenType.BEGIN) &&
           !this.is(TokenType.END)) {
      
      if (this.is(TokenType.IDENTIFIER)) {
        const name = this.advance();
        const init = this.match(TokenType.ASSIGN) ? this.parseExpression() : null;
        this.match(TokenType.SEMICOLON);
        declarations.push({ name: name.value, init });
      } else {
        this.advance();
      }
    }
    
    return declarations;
  }
  
  // Parse process
  parseProcess() {
    this.expect(TokenType.PROCESS, 'Expected PROCESS');
    
    const name = this.expect(TokenType.IDENTIFIER, 'Expected process name');
    const params = this.parseParams();
    this.match(TokenType.SEMICOLON);
    
    // Privates
    const privates = [];
    if (this.match(TokenType.PRIVATE)) {
      privates.push(...this.parseDeclarations());
    }
    
    // Body
    this.expect(TokenType.BEGIN, 'Expected BEGIN');
    const body = this.parseStatements();
    this.expect(TokenType.END, 'Expected END');
    
    return new ast.Process(name.value, params, privates, body);
  }
  
  // Parse function
  parseFunction() {
    this.expect(TokenType.FUNCTION, 'Expected FUNCTION');
    
    const name = this.expect(TokenType.IDENTIFIER, 'Expected function name');
    const params = this.parseParams();
    this.match(TokenType.SEMICOLON);
    
    // Privates
    const privates = [];
    if (this.match(TokenType.PRIVATE)) {
      privates.push(...this.parseDeclarations());
    }
    
    // Body
    this.expect(TokenType.BEGIN, 'Expected BEGIN');
    const body = this.parseStatements();
    this.expect(TokenType.END, 'Expected END');
    
    return new ast.FunctionDecl(name.value, params, privates, body);
  }
  
  // Parse params
  parseParams() {
    const params = [];
    
    if (this.match(TokenType.LPAREN)) {
      while (!this.is(TokenType.RPAREN) && !this.is(TokenType.EOF)) {
        const name = this.expect(TokenType.IDENTIFIER, 'Expected parameter name');
        const init = this.match(TokenType.ASSIGN) ? this.parseExpression() : null;
        
        params.push({ name: name.value, init });
        
        if (!this.match(TokenType.COMMA)) {
          break;
        }
      }
      
      this.expect(TokenType.RPAREN, 'Expected )');
    }
    
    return params;
  }
  
  // Parse statements
  parseStatements() {
    const statements = [];
    
    while (!this.is(TokenType.EOF) && !this.is(TokenType.END)) {
      statements.push(this.parseStatement());
    }
    
    return statements;
  }
  
  // Parse statement
  parseStatement() {
    // IF
    if (this.match(TokenType.IF)) {
      return this.parseIf();
    }
    
    // WHILE
    if (this.match(TokenType.WHILE)) {
      return this.parseWhile();
    }
    
    // REPEAT
    if (this.match(TokenType.REPEAT)) {
      return this.parseRepeat();
    }
    
    // LOOP
    if (this.match(TokenType.LOOP)) {
      return this.parseLoop();
    }
    
    // FOR
    if (this.match(TokenType.FOR)) {
      return this.parseFor();
    }
    
    // SWITCH
    if (this.match(TokenType.SWITCH)) {
      return this.parseSwitch();
    }
    
    // BREAK
    if (this.match(TokenType.BREAK)) {
      this.match(TokenType.SEMICOLON);
      return new ast.Break();
    }
    
    // CONTINUE
    if (this.match(TokenType.CONTINUE)) {
      this.match(TokenType.SEMICOLON);
      return new ast.Continue();
    }
    
    // RETURN
    if (this.match(TokenType.RETURN)) {
      const value = this.is(TokenType.SEMICOLON) ? null : this.parseExpression();
      this.match(TokenType.SEMICOLON);
      return new ast.Return(value);
    }
    
    // FRAME
    if (this.match(TokenType.FRAME)) {
      this.match(TokenType.SEMICOLON);
      return new ast.Frame();
    }
    
    // Assignment or expression
    const expr = this.parseExpression();
    
    if (this.match(TokenType.ASSIGN)) {
      const value = this.parseExpression();
      this.match(TokenType.SEMICOLON);
      return new ast.Assignment(expr, value);
    }
    
    this.match(TokenType.SEMICOLON);
    return new ast.ExpressionStatement(expr);
  }
  
  // Parse IF
  parseIf() {
    this.expect(TokenType.LPAREN, 'Expected (');
    const condition = this.parseExpression();
    this.expect(TokenType.RPAREN, 'Expected )');
    
    this.match(TokenType.THEN);
    
    const thenBlock = this.parseStatements();
    
    let elseBlock = null;
    if (this.match(TokenType.ELSE)) {
      elseBlock = this.parseStatements();
    }
    
    this.expect(TokenType.END, 'Expected END');
    
    return new ast.If(condition, thenBlock, elseBlock);
  }
  
  // Parse WHILE
  parseWhile() {
    this.expect(TokenType.LPAREN, 'Expected (');
    const condition = this.parseExpression();
    this.expect(TokenType.RPAREN, 'Expected )');
    
    const body = this.parseStatements();
    this.expect(TokenType.END, 'Expected END');
    
    return new ast.While(condition, body);
  }
  
  // Parse REPEAT
  parseRepeat() {
    const body = this.parseStatements();
    
    this.expect(TokenType.UNTIL, 'Expected UNTIL');
    this.expect(TokenType.LPAREN, 'Expected (');
    const condition = this.parseExpression();
    this.expect(TokenType.RPAREN, 'Expected )');
    
    this.match(TokenType.SEMICOLON);
    this.expect(TokenType.END, 'Expected END');
    
    return new ast.Repeat(body, condition);
  }
  
  // Parse LOOP
  parseLoop() {
    const body = this.parseStatements();
    this.expect(TokenType.END, 'Expected END');
    
    return new ast.Loop(body);
  }
  
  // Parse FOR
  parseFor() {
    const variable = this.expect(TokenType.IDENTIFIER, 'Expected variable');
    this.expect(TokenType.ASSIGN, 'Expected =');
    
    this.expect(TokenType.FROM, 'Expected FROM');
    const from = this.parseExpression();
    
    this.expect(TokenType.TO, 'Expected TO');
    const to = this.parseExpression();
    
    const step = this.match(TokenType.STEP) ? this.parseExpression() : null;
    
    const body = this.parseStatements();
    this.expect(TokenType.END, 'Expected END');
    
    return new ast.For(variable.value, from, to, step, body);
  }
  
  // Parse SWITCH
  parseSwitch() {
    this.expect(TokenType.LPAREN, 'Expected (');
    const condition = this.parseExpression();
    this.expect(TokenType.RPAREN, 'Expected )');
    
    const cases = [];
    let defaultCase = null;
    
    while (!this.is(TokenType.END) && !this.is(TokenType.EOF)) {
      if (this.match(TokenType.CASE)) {
        const value = this.parseExpression();
        this.expect(TokenType.COLON, 'Expected :');
        const body = this.parseStatements();
        cases.push({ value, body });
      } else if (this.match(TokenType.DEFAULT)) {
        this.expect(TokenType.COLON, 'Expected :');
        defaultCase = this.parseStatements();
      } else {
        this.advance();
      }
    }
    
    this.expect(TokenType.END, 'Expected END');
    
    return { type: 'switch', condition, cases, default: defaultCase };
  }
  
  // Parse expression
  parseExpression() {
    return this.parseOr();
  }
  
  // Parse OR
  parseOr() {
    let left = this.parseAnd();
    
    while (this.match(TokenType.OR)) {
      const operator = this.current().value;
      const right = this.parseAnd();
      left = new ast.BinaryOp(operator, left, right);
    }
    
    return left;
  }
  
  // Parse AND
  parseAnd() {
    let left = this.parseEquality();
    
    while (this.match(TokenType.AND)) {
      const operator = this.current().value;
      const right = this.parseEquality();
      left = new ast.BinaryOp(operator, left, right);
    }
    
    return left;
  }
  
  // Parse equality
  parseEquality() {
    let left = this.parseComparison();
    
    while (this.match(TokenType.EQUAL) || this.match(TokenType.NOT_EQUAL)) {
      const operator = this.current().value;
      const right = this.parseComparison();
      left = new ast.BinaryOp(operator, left, right);
    }
    
    return left;
  }
  
  // Parse comparison
  parseComparison() {
    let left = this.parseAdditive();
    
    while (
      this.match(TokenType.LESS) ||
      this.match(TokenType.LESS_EQUAL) ||
      this.match(TokenType.GREATER) ||
      this.match(TokenType.GREATER_EQUAL)
    ) {
      const operator = this.current().value;
      const right = this.parseAdditive();
      left = new ast.BinaryOp(operator, left, right);
    }
    
    return left;
  }
  
  // Parse additive
  parseAdditive() {
    let left = this.parseMultiplicative();
    
    while (this.match(TokenType.PLUS) || this.match(TokenType.MINUS)) {
      const operator = this.current().value;
      const right = this.parseMultiplicative();
      left = new ast.BinaryOp(operator, left, right);
    }
    
    return left;
  }
  
  // Parse multiplicative
  parseMultiplicative() {
    let left = this.parseUnary();
    
    while (
      this.match(TokenType.STAR) ||
      this.match(TokenType.SLASH) ||
      this.match(TokenType.MOD)
    ) {
      const operator = this.current().value;
      const right = this.parseUnary();
      left = new ast.BinaryOp(operator, left, right);
    }
    
    return left;
  }
  
  // Parse unary
  parseUnary() {
    if (this.match(TokenType.NOT) || this.match(TokenType.MINUS)) {
      const operator = this.current().value;
      const operand = this.parseUnary();
      return new ast.UnaryOp(operator, operand);
    }
    
    return this.parseCall();
  }
  
  // Parse call
  parseCall() {
    let expr = this.parsePrimary();
    
    while (true) {
      if (this.match(TokenType.LPAREN)) {
        const args = this.parseArgs();
        expr = new ast.Call(expr, args);
      } else if (this.match(TokenType.DOT)) {
        const property = this.expect(TokenType.IDENTIFIER, 'Expected property name');
        expr = new ast.Access(expr, property.value);
      } else {
        break;
      }
    }
    
    return expr;
  }
  
  // Parse primary
  parsePrimary() {
    // TRUE
    if (this.match(TokenType.TRUE)) {
      return new ast.Boolean(true);
    }
    
    // FALSE
    if (this.match(TokenType.FALSE)) {
      return new ast.Boolean(false);
    }
    
    // NIL
    if (this.match(TokenType.NIL)) {
      return new ast.Null();
    }
    
    // NUMBER
    if (this.match(TokenType.NUMBER)) {
      return new ast.Number(parseFloat(this.current().value));
    }
    
    // STRING
    if (this.match(TokenType.STRING)) {
      return new ast.String(this.current().value);
    }
    
    // IDENTIFIER
    if (this.match(TokenType.IDENTIFIER)) {
      const name = this.current().value;
      
      // TYPE operator
      if (name === 'type' && this.is(TokenType.IDENTIFIER)) {
        const processName = this.advance().value;
        return new ast.TypeOperator(processName);
      }
      
      return new ast.Identifier(name);
    }
    
    // LPAREN
    if (this.match(TokenType.LPAREN)) {
      const expr = this.parseExpression();
      this.expect(TokenType.RPAREN, 'Expected )');
      return expr;
    }
    
    // LBRACKET (array)
    if (this.match(TokenType.LBRACKET)) {
      const elements = this.parseArgs();
      this.expect(TokenType.RBRACKET, 'Expected ]');
      return new ast.ArrayLiteral(elements);
    }
    
    // LBRACE (object)
    if (this.match(TokenType.LBRACE)) {
      const properties = [];
      
      while (!this.is(TokenType.RBRACE) && !this.is(TokenType.EOF)) {
        const key = this.expect(TokenType.IDENTIFIER, 'Expected property name');
        this.expect(TokenType.COLON, 'Expected :');
        const value = this.parseExpression();
        properties.push({ key: key.value, value });
        
        if (!this.match(TokenType.COMMA)) {
          break;
        }
      }
      
      this.expect(TokenType.RBRACE, 'Expected }');
      return new ast.ObjectLiteral(properties);
    }
    
    throw new Error(`Unexpected token '${this.current().value}' at ${this.current().line}:${this.current().column}`);
  }
  
  // Parse args
  parseArgs() {
    const args = [];
    
    if (!this.is(TokenType.RPAREN) && !this.is(TokenType.RBRACKET)) {
      args.push(this.parseExpression());
      
      while (this.match(TokenType.COMMA)) {
        args.push(this.parseExpression());
      }
    }
    
    return args;
  }
}
