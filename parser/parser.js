import { TokenType } from '../compiler/tokenizer.js';
import * as ast from '../compiler/ast.js';
import { DivError } from '../compiler/errors.js';

export class Parser {
  constructor(tokens) {
    this.tokens = tokens;
    this.pos = 0;
  }

  peek(offset = 1) {
    const idx = this.pos + offset;
    if (idx >= this.tokens.length) {
      return this.tokens[this.tokens.length - 1];
    }
    return this.tokens[idx];
  }

  isIdentifierLike(token) {
    if (!token) {
      return false;
    }

    return token.type === TokenType.IDENTIFIER ||
      token.type === TokenType.VAR ||
      token.type === TokenType.TO ||
      token.type === TokenType.STEP;
  }

  readIdentifierLike(message = 'Expected identifier') {
    const token = this.current();
    if (!this.isIdentifierLike(token)) {
      this.expect(TokenType.IDENTIFIER, message);
      return this.previous().value;
    }

    this.pos++;
    return token.value;
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

  // A DivError located at `token` (the current token by default).
  error(message, token = this.current())
  {
    return new DivError(message, { stage: 'parser', line: token.line, col: token.col });
  }

  // Expect token
  expect(type, message)
  {
    if (this.is(type))
    {
      this.pos++;
      return;
    }
    const text = message || `Expected ${type}`;
    // A missing ';' belongs right after the statement it ends. Reporting
    // it at the current token pointed at the start of the NEXT line.
    const previous = this.tokens[this.pos - 1];
    if (type === TokenType.SEMICOLON && previous && previous.endLine !== undefined)
    {
      throw new DivError(text, { stage: 'parser', line: previous.endLine, col: previous.endCol });
    }
    throw this.error(text);
  }

  // Consume a leading "COMPILER_OPTIONS ...;" directive, if present.
  // It isn't a keyword in the tokenizer - it arrives as a plain
  // IDENTIFIER - so match on the name and skip through the terminating
  // semicolon, whatever options were listed.
  skipCompilerOptions() {
    const token = this.current();
    if (!token || token.type !== TokenType.IDENTIFIER ||
      String(token.value).toUpperCase() !== 'COMPILER_OPTIONS') {
      return;
    }
    while (!this.is(TokenType.EOF) && !this.is(TokenType.SEMICOLON)) {
      this.pos++;
    }
    this.match(TokenType.SEMICOLON);
  }

  // Parse program
  parse() {
    // Optional COMPILER_OPTIONS directive before PROGRAM, e.g.
    // "COMPILER_OPTIONS _extended_conditions;" - a classic-DIV
    // compile-time switch with no runtime meaning here, so consume the
    // whole statement and move on rather than rejecting the file.
    this.skipCompilerOptions();

    // Program header: PROGRAM name;
    this.expect(TokenType.PROGRAM, 'Expected PROGRAM keyword');
    const name = this.current().value;
    this.pos++;
    this.expect(TokenType.SEMICOLON, 'Expected ; after program name');

    const globals = [];
    const structs = [];
    const processes = [];
    const functions = [];
    const mainBlock = [];
    const mainPrivates = [];
    const locals = [];

    // Parse all top-level declarations
    while (!this.is(TokenType.EOF)) {
      const declToken = this.current();
      if (this.is(TokenType.GLOBAL)) {
        globals.push(...this.parseGlobal());
      } else if (this.is(TokenType.STRUCT)) {
        const s = this.parseStructDecl();
        s.line = declToken.line; s.col = declToken.col;
        structs.push(s);
      } else if (this.is(TokenType.FUNCTION)) {
        const func = this.parseFunction();
        func.line = declToken.line;
        func.col = declToken.col;
        functions.push(func);
      } else if (this.is(TokenType.PROCESS)) {
        const process = this.parseProcess();
        process.line = declToken.line;
        process.col = declToken.col;
        processes.push(process);
      } else if (this.is(TokenType.LOCAL)) {
        // DIV's LOCAL: variables every process owns a copy of (readable
        // from outside as `processid.name`). Collected here and given
        // fixed slots in every process, just after the canonical block.
        // Stops at the next section keyword, a second LOCAL included
        // ("LOCAL a; LOCAL b;" used to fail on the second LOCAL).
        this.pos++;
        while (!this.is(TokenType.BEGIN) && !this.is(TokenType.EOF) &&
          !this.is(TokenType.PRIVATE) && !this.is(TokenType.PROCESS) &&
          !this.is(TokenType.FUNCTION) && !this.is(TokenType.GLOBAL) &&
          !this.is(TokenType.LOCAL))
        {
          // In DIV a STRUCT inside LOCAL is a per-process structure,
          // which this engine doesn't implement; parsing it as the
          // (global) top-level STRUCT would silently share it between
          // processes, so say so instead of "Expected private name".
          if (this.is(TokenType.STRUCT))
          {
            throw this.error('STRUCT inside a LOCAL section is not supported; declare the STRUCT under GLOBAL');
          }
          locals.push(...this.parsePrivate());
        }
      } else if (this.is(TokenType.PRIVATE)) {
        // MAIN's own PRIVATE section. In DIV the main script is a
        // process, so it may declare privates exactly like one - they
        // become locals of MAIN.
        this.pos++;
        while (!this.is(TokenType.BEGIN) && !this.is(TokenType.EOF)) {
          mainPrivates.push(...this.parsePrivate());
        }
      } else if (this.is(TokenType.BEGIN)) {
        // Main block
        const block = this.parseBeginEndBlock('Expected BEGIN before main block', 'Expected END after main block');
        mainBlock.push(...block.statements);
      } else {
        throw this.error(`Unexpected token ${this.current().value}`);
      }
    }

    return new ast.Program(name, globals, structs, processes, functions, mainBlock, mainPrivates, locals);
  }

  parseStructDecl() {
    this.pos++; // consume STRUCT
    const name = this.readIdentifierLike('Expected struct name');
    let count = null;
    if (this.match(TokenType.LBRACKET)) {
      count = this.parseExpression();
      this.expect(TokenType.RBRACKET, 'Expected ] after struct count');
    }
    const fields = [];
    while (!this.is(TokenType.END) && !this.is(TokenType.EOF)) {
      if (this.is(TokenType.STRUCT)) {
        // Nested struct - becomes a composite field
        const nested = this.parseStructDecl();
        fields.push({ name: nested.name, nested, defaultValue: null, size: null });
        continue;
      }
      const fname = this.readIdentifierLike('Expected field name');
      let fsize = null;
      let fdefault = null;
      if (this.match(TokenType.LBRACKET)) {
        fsize = this.parseExpression();
        this.expect(TokenType.RBRACKET, 'Expected ] after field size');
      } else if (this.match(TokenType.EQUALS)) {
        fdefault = this.parseExpression();
      }
      this.expect(TokenType.SEMICOLON, 'Expected ; after struct field');
      fields.push({ name: fname, defaultValue: fdefault, size: fsize, nested: null });
    }
    this.expect(TokenType.END, 'Expected END after struct body');

    // Optional initializer list: = val, val, N DUP(val), ... ;
    let initializers = null;
    if (this.match(TokenType.EQUALS)) {
      initializers = this.parseStructInitializers();
    }
    return new ast.StructDecl(name, count, fields, initializers);
  }

  parseStructInitializers() {
    const values = this.parseInitializerList();
    this.expect(TokenType.SEMICOLON, 'Expected ; after struct initializer list');
    return values;
  }

  // "value, value, N DUP(value), ..." up to (not including) the ';'.
  parseInitializerList() {
    const values = [];
    while (!this.is(TokenType.SEMICOLON) && !this.is(TokenType.EOF)) {
      // N DUP(expr) - N is a number literal, DUP is an identifier
      if (this.current().type === TokenType.NUMBER &&
        this.peek(1).type === TokenType.IDENTIFIER &&
        this.peek(1).value.toUpperCase() === 'DUP' &&
        this.peek(2).type === TokenType.LPAREN) {
        const dupCount = this.current().value;
        this.pos += 2; // consume N and DUP
        this.expect(TokenType.LPAREN, 'Expected ( after DUP');
        const dupVal = this.parseExpression();
        this.expect(TokenType.RPAREN, 'Expected ) after DUP value');
        for (let i = 0; i < dupCount; i++) values.push(dupVal);
      } else {
        values.push(this.parseExpression());
      }
      if (!this.is(TokenType.SEMICOLON)) {
        this.expect(TokenType.COMMA, 'Expected , or ; in initializer list');
      }
    }
    return values;
  }

  // Parse global
  // Parse global. Supports both the single-declaration form
  // ("GLOBAL score = 10;") and the classic DIV/Fenix block form - a bare
  // GLOBAL keyword, then every following line is a name (with an
  // optional initializer) until something that isn't one:
  //   GLOBAL
  //     score;
  //     lives;
  //     high_score = 0;
  // Both forms are the exact same loop: read a name [= expr];, then keep
  // going as long as the next token is still identifier-like. A single
  // declaration just means the loop runs once - isIdentifierLike()
  // already excludes GLOBAL/PROCESS/FUNCTION/BEGIN (see its definition),
  // so the loop naturally stops at the next section without any special
  // casing for where a GLOBAL block "ends".
  parseGlobal() {
    this.pos++; // consume GLOBAL

    const globals = [];
    while (this.isIdentifierLike(this.current())) {
      do {
        const declToken = this.current();
        const name = this.readIdentifierLike('Expected global name');
        let value = null;
        let size;
        let initializers = null;
        if (this.match(TokenType.LBRACKET)) {
          size = this.parseExpression();
          this.expect(TokenType.RBRACKET, 'Expected ] after array size');
          // An array may also carry an initializer list, using the same
          // "value, value, N DUP(value)" syntax STRUCT accepts -
          // e.g. tutor6's "GLOBAL board[99] = 100 dup (1);".
          if (this.match(TokenType.EQUALS)) {
            initializers = this.parseInitializerList();
          }
        } else if (this.match(TokenType.EQUALS)) {
          value = this.parseExpression();
        }
        const global = new ast.Global(name, value, size);
        global.initializers = initializers;
        global.line = declToken.line;
        global.col = declToken.col;
        globals.push(global);
      } while (this.match(TokenType.COMMA));

      this.expect(TokenType.SEMICOLON, 'Expected ; after global declaration');
    }

    if (globals.length === 0) {
      throw this.error('Expected at least one variable name after GLOBAL');
    }

    return globals;
  }

  // Parse function
  parseFunction() {
    this.pos++; // consume FUNCTION
    const name = this.readIdentifierLike('Expected function name');

    // Params
    const params = [];
    this.expect(TokenType.LPAREN, 'Expected ( after function name');

    if (!this.is(TokenType.RPAREN)) {
      do {
        const paramName = this.readIdentifierLike('Expected function param name');
        params.push(paramName);
      } while (this.match(TokenType.COMMA));
    }

    this.expect(TokenType.RPAREN, 'Expected ) after function params');
    this.match(TokenType.SEMICOLON); // optional ; for DIV/Fenix compatibility

    // FUNCTION is this engine's own construct (the DIV 2 manual only has
    // PROCESS); it takes a PRIVATE section the same way a PROCESS does,
    // holding variables local to each call.
    const privates = [];
    if (this.match(TokenType.PRIVATE))
    {
      while (!this.is(TokenType.BEGIN) && !this.is(TokenType.EOF))
      {
        privates.push(...this.parsePrivate());
      }
    }

    // Body
    const body = this.parseBeginEndBlock('Expected BEGIN before function body', 'Expected END after function body');

    return new ast.Function(name, params, body, privates);
  }

  // Parse process
  parseProcess() {
    this.pos++; // consume PROCESS
    const name = this.readIdentifierLike('Expected process name');

    // Params
    const params = [];
    this.expect(TokenType.LPAREN, 'Expected ( after process name');

    if (!this.is(TokenType.RPAREN)) {
      do {
        const paramName = this.readIdentifierLike('Expected process param name');
        params.push(paramName);
      } while (this.match(TokenType.COMMA));
    }

    this.expect(TokenType.RPAREN, 'Expected ) after process params');
    this.match(TokenType.SEMICOLON); // optional ; for DIV/Fenix compatibility

    // Parse private section (PRIVATE ... declarations ... BEGIN)
    const privates = [];
    if (this.match(TokenType.PRIVATE)) {
      while (!this.is(TokenType.BEGIN) && !this.is(TokenType.EOF)) {
        privates.push(...this.parsePrivate());
      }
    }

    // Body
    const body = this.parseBeginEndBlock('Expected BEGIN before process body', 'Expected END after process body');

    return new ast.Process(name, params, privates, body);
  }

  // Parse private
  parsePrivate() {
    const decls = [];
    do {
      const declToken = this.current();
      const name = this.readIdentifierLike('Expected private name');
      let value = null;
      let size;
      if (this.match(TokenType.LBRACKET)) {
        size = this.parseExpression();
        this.expect(TokenType.RBRACKET, 'Expected ] after array size');
      } else if (this.match(TokenType.EQUALS)) {
        value = this.parseExpression();
      }
      const decl = new ast.Private(name, value, size);
      // Located, so compile errors about the declaration can point at it.
      decl.line = declToken.line;
      decl.col = declToken.col;
      decls.push(decl);
    } while (this.match(TokenType.COMMA));

    this.expect(TokenType.SEMICOLON, 'Expected ; after PRIVATE');

    return decls;
  }

  // Parse statements up to (but not consuming) END/UNTIL/ELSE/CASE/
  // DEFAULT. Shared by parseBlock (which owns closing on END), parseIf
  // (which needs to decide between ELSE and END itself before closing),
  // and parseSwitch (each CASE/DEFAULT arm stops here without consuming
  // the next arm's own keyword). CASE and DEFAULT are reserved keywords,
  // so no ordinary block outside a SWITCH could legitimately contain one
  // as a statement - adding them to this shared set is safe everywhere.
  parseBlockStatements() {
    const statements = [];

    while (!this.is(TokenType.EOF) &&
      !this.is(TokenType.END) &&
      !this.is(TokenType.UNTIL) &&
      !this.is(TokenType.ELSE) &&
      !this.is(TokenType.CASE) &&
      !this.is(TokenType.DEFAULT)) {
      statements.push(this.parseStatement());
    }

    return statements;
  }

  // Parse block
  parseBlock() {
    const statements = this.parseBlockStatements();

    this.expect(TokenType.END, 'Expected END after block');

    return new ast.Block(statements);
  }

  // Parse BEGIN ... END block
  parseBeginEndBlock(beginMessage, endMessage) {
    this.expect(TokenType.BEGIN, beginMessage || 'Expected BEGIN');

    const statements = [];
    while (!this.is(TokenType.EOF) && !this.is(TokenType.END)) {
      statements.push(this.parseStatement());
    }

    this.expect(TokenType.END, endMessage || 'Expected END after block');

    return new ast.Block(statements);
  }

  // Parse statement
  parseStatement() {
    // Every statement kind is parsed by parseStatementInner() below; this
    // wrapper just records where the statement started and stamps it onto
    // whatever node comes back, in one place, so every statement-shaped
    // AST node carries a location without touching each individual
    // parseIf/parseFor/parseSwitch/etc. The compiler uses this to point
    // at *where* a compile-time error happened (duplicate name, BREAK
    // outside a loop, invalid assignment target, ...) instead of just
    // *what* went wrong - previously none of those errors had any
    // location at all, only parse-time syntax errors did.
    const startToken = this.current();
    const stmt = this.parseStatementInner();
    if (stmt && stmt.line === undefined) {
      stmt.line = startToken.line;
      stmt.col = startToken.col;
    }
    return stmt;
  }

  parseStatementInner() {
    // If
    if (this.match(TokenType.IF)) {
      return this.parseIf();
    }

    // Switch
    if (this.match(TokenType.SWITCH)) {
      return this.parseSwitch();
    }

    // For. Two spellings share the keyword: DIV's counted loop
    // ("FOR i = 0 TO 9") and the C-style form tutor6 uses
    // ("FOR (i=0; i<10; i++)"), told apart by the parenthesis.
    if (this.match(TokenType.FOR)) {
      if (this.is(TokenType.LPAREN)) {
        return this.parseCFor();
      }
      return this.parseFor(false);
    }

    // From (classic-DIV spelling of the same loop - e.g.
    // "FROM graph=5 TO 10; FRAME; END" - requires a ; right after the
    // TO/STEP range, before the body, unlike FOR)
    if (this.match(TokenType.FROM)) {
      return this.parseFor(true);
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
      let frameValue = null;
      if (this.match(TokenType.LPAREN)) {
        frameValue = this.parseExpression();
        this.expect(TokenType.RPAREN, 'Expected ) after FRAME value');
      }
      this.expect(TokenType.SEMICOLON, 'Expected ; after FRAME');
      return new ast.Frame(frameValue);
    }

    // Var
    if (this.is(TokenType.VAR) && this.isIdentifierLike(this.peek(1))) {
      this.pos++;
      return this.parseVar();
    }

    // Return
    if (this.match(TokenType.RETURN)) {
      let value = null;
      if (!this.is(TokenType.SEMICOLON)) {
        value = this.parseExpression();
      }
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

    // Postfix ++/-- as a statement ("apples++;"), desugared to
    // "apples = apples + 1". Only valid in statement position - DIV
    // never uses the value of an increment as part of a larger
    // expression, unlike a plain assignment (compileExpression's
    // 'assign' case supports that, for extended conditions like
    // "IF (apple_id = collision(TYPE apple))").
    if (this.is(TokenType.INCREMENT) || this.is(TokenType.DECREMENT)) {
      const assign = this.desugarIncrement(expr);
      this.expect(TokenType.SEMICOLON, 'Expected ; after ++/--');
      return new ast.ExpressionStatement(assign);
    }

    this.expect(TokenType.SEMICOLON, 'Expected ; after expression');
    return new ast.ExpressionStatement(expr);
  }

  // Parse if
  parseIf() {
    const condition = this.parseExpression();
    // The then-branch is closed by ELSE or END; parseBlock() would try to
    // consume END unconditionally and fail on "IF (c) ... ELSE ... END",
    // so read statements without a terminator and let parseIf decide.
    const thenBranch = new ast.Block(this.parseBlockStatements());

    let elseBranch = null;
    if (this.match(TokenType.ELSE)) {
      elseBranch = new ast.Block(this.parseBlockStatements());
    }

    this.expect(TokenType.END, 'Expected END after IF/ELSE');

    return new ast.If(condition, thenBranch, elseBranch);
  }

  // Parse switch. Grammar:
  //   SWITCH (expr)
  //     CASE value
  //       statements...
  //     CASE value1, value2, value3
  //       statements...
  //     DEFAULT
  //       statements...
  //   END
  // No colons (consistent with the rest of the language, which has none
  // anywhere) and no fallthrough between cases: each CASE's statements
  // run and control goes straight to END, so BREAK is never required to
  // separate cases. A CASE can list several comma-separated values
  // sharing one body (matches if the subject equals *any* of them). At
  // least one CASE is required; DEFAULT is optional and - if present -
  // must be the last arm.
  parseSwitch() {
    this.expect(TokenType.LPAREN, 'Expected ( after SWITCH');
    const subject = this.parseExpression();
    this.expect(TokenType.RPAREN, 'Expected ) after SWITCH subject');

    const cases = [];
    while (this.match(TokenType.CASE)) {
      const values = [this.parseExpression()];
      while (this.match(TokenType.COMMA)) {
        values.push(this.parseExpression());
      }
      const body = new ast.Block(this.parseBlockStatements());
      cases.push({ values, body });
    }

    if (cases.length === 0) {
      throw this.error('Expected at least one CASE in SWITCH');
    }

    let defaultBody = null;
    if (this.match(TokenType.DEFAULT)) {
      defaultBody = new ast.Block(this.parseBlockStatements());
    }

    this.expect(TokenType.END, 'Expected END after SWITCH');

    return new ast.Switch(subject, cases, defaultBody);
  }

  // FOR (init; condition; step) body END - desugared into the same shape
  // a WHILE would produce, with the step run at the end of each pass.
  parseCFor() {
    this.expect(TokenType.LPAREN, 'Expected ( after FOR');

    const init = this.is(TokenType.SEMICOLON) ? null : this.parseForClause();
    this.expect(TokenType.SEMICOLON, 'Expected ; after FOR initialiser');

    const condition = this.is(TokenType.SEMICOLON) ? null : this.parseExpression();
    this.expect(TokenType.SEMICOLON, 'Expected ; after FOR condition');

    const step = this.is(TokenType.RPAREN) ? null : this.parseForClause();
    this.expect(TokenType.RPAREN, 'Expected ) after FOR step');

    const body = this.parseBlock();
    return new ast.CFor(init, condition, step, body);
  }

  // One clause of a C-style FOR: an assignment or a bare ++/-- on a
  // variable. Shares the ++/-- desugaring used in statement position.
  parseForClause() {
    const expr = this.parseExpression();
    if (this.is(TokenType.INCREMENT) || this.is(TokenType.DECREMENT)) {
      return this.desugarIncrement(expr);
    }
    return expr;
  }

  // "target++" / "target--" (the operator is the current token) becomes
  // the compound assignment "target +=/-= 1". Only a variable, field or element can be
  // incremented: "a = b++" used to build an assignment whose target was
  // itself an assignment, failing later in the compiler with no location.
  desugarIncrement(target)
  {
    const operator = this.current();
    const isIncrement = operator.type === TokenType.INCREMENT;
    const assignable = target && (
      target.type === 'identifier' ||
      target.type === 'member_access' ||
      target.type === 'index_access'
    );
    if (!assignable)
    {
      throw this.error(`${operator.value} can only follow a variable, field or array element, as a statement of its own (e.g. "n${operator.value};")`, operator);
    }
    this.pos++;
    const assign = new ast.Assign(target, new ast.Number(1), isIncrement ? '+' : '-');
    assign.line = operator.line;
    assign.col = operator.col;
    return assign;
  }

  // Parse for/from - same loop, two DIV-family spellings. FROM
  // (requireSemicolonBeforeBody) additionally expects a ; right after the
  // TO/STEP range and before the body, e.g. "FROM x=1 TO 8; asteroid(); END".
  parseFor(requireSemicolonBeforeBody) {
    const varName = this.readIdentifierLike('Expected FOR variable name');

    this.expect(TokenType.EQUALS, 'Expected = after FOR var');

    const start = this.parseExpression();

    this.expect(TokenType.TO, 'Expected TO in FOR');

    const end = this.parseExpression();

    // FROM without STEP counts towards the final value: +1 when the
    // initial value is less than the final one, -1 otherwise (DIV 2
    // manual 7.6.8, "FROM x=9 TO 0" runs 10 times). A null step tells the
    // compiler to pick that direction. FOR ... TO keeps a fixed +1 so
    // "FOR i = 0 TO n - 1" still runs zero times when n is 0 (e.g.
    // demos/pathfind.html drawing an empty path).
    let step = requireSemicolonBeforeBody ? null : new ast.Number(1);
    if (this.match(TokenType.STEP)) {
      step = this.parseExpression();
    }

    if (requireSemicolonBeforeBody) {
      this.expect(TokenType.SEMICOLON, 'Expected ; after FROM range');
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
    const statements = [];
    while (!this.is(TokenType.EOF) && !this.is(TokenType.UNTIL)) {
      statements.push(this.parseStatement());
    }

    const body = new ast.Block(statements);

    this.expect(TokenType.UNTIL, 'Expected UNTIL after REPEAT body');

    const condition = this.parseExpression();
    this.match(TokenType.SEMICOLON); // optional ; for DIV/Fenix compatibility

    return new ast.Repeat(body, condition);
  }

  // Parse loop
  parseLoop() {
    const body = this.parseBlock();

    return new ast.Loop(body);
  }

  // Parse var
  parseVar() {
    const name = this.readIdentifierLike('Expected variable name after VAR');

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
    const startToken = this.current();
    const left = this.parseOr();

    if (this.match(TokenType.EQUALS)) {
      const right = this.parseAssignment();
      const assign = new ast.Assign(left, right);
      assign.line = startToken.line;
      assign.col = startToken.col;
      return assign;
    }

    // Compound assignment (+=, -=, *=, /=). Kept as one node with its
    // operator rather than desugared to `left = left OP right`: that
    // shared `left` twice, so "a[k()] += 1" called k() twice.
    const compoundOp = this.matchCompoundAssign();
    if (compoundOp) {
      const right = this.parseAssignment();
      const assign = new ast.Assign(left, right, compoundOp);
      assign.line = startToken.line;
      assign.col = startToken.col;
      return assign;
    }

    return left;
  }

  matchCompoundAssign() {
    if (this.match(TokenType.PLUS_ASSIGN)) return '+';
    if (this.match(TokenType.MINUS_ASSIGN)) return '-';
    if (this.match(TokenType.STAR_ASSIGN)) return '*';
    if (this.match(TokenType.SLASH_ASSIGN)) return '/';
    return null;
  }

  // Parse or
  parseOr() {
    let left = this.parseAnd();

    while (this.match(TokenType.OR)) {
      const operator = '||';
      const right = this.parseAnd();
      left = new ast.Binary(left, operator, right);
    }

    return left;
  }

  // Parse and
  parseAnd() {
    let left = this.parseEquality();

    while (this.match(TokenType.AND)) {
      const operator = '&&';
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

  // Parse unary. TYPE/OFFSET/unary nodes are built here rather than in
  // parsePrimary, so they get their location stamped here too (compiler
  // errors such as "OFFSET ... no such GLOBAL" report it).
  parseUnary()
  {
    const startToken = this.current();
    const expr = this.parseUnaryInner();
    if (expr && expr.line === undefined)
    {
      expr.line = startToken.line;
      expr.col = startToken.col;
    }
    return expr;
  }

  parseUnaryInner() {
    if (this.match(TokenType.TYPE)) {
      const token = this.current();
      if (!this.isIdentifierLike(token)) {
        this.expect(TokenType.IDENTIFIER, 'Expected process name after TYPE');
        return new ast.TypeOperator(this.previous().value);
      }
      this.pos++;
      return new ast.TypeOperator(token.value);
    }

    if (this.match(TokenType.OFFSET)) {
      const token = this.current();
      if (!this.isIdentifierLike(token)) {
        this.expect(TokenType.IDENTIFIER, 'Expected variable name after OFFSET');
        return new ast.OffsetOperator(this.previous().value);
      }
      this.pos++;
      return new ast.OffsetOperator(token.value);
    }

    if (this.match(TokenType.MINUS) || this.match(TokenType.NOT)) {
      const operator = this.previous().type === TokenType.NOT ? '!' : this.previous().value;
      const right = this.parseUnary();
      return new ast.Unary(operator, right);
    }

    return this.parsePostfix();
  }

  // Parse postfix operators (call, member, index)
  parsePostfix() {
    const startToken = this.current();
    let expr = this.parsePrimary();

    while (true) {
      if (this.match(TokenType.LPAREN)) {
        const args = this.parseArgs();
        expr = new ast.Call(expr, args);
        expr.line = startToken.line;
        expr.col = startToken.col;
        continue;
      }

      if (this.match(TokenType.DOT)) {
        const propertyToken = this.current();
        if (!this.isIdentifierLike(propertyToken)) {
          this.expect(TokenType.IDENTIFIER, 'Expected property name after .');
          expr = new ast.MemberAccess(expr, this.previous().value);
          expr.line = startToken.line;
          expr.col = startToken.col;
          continue;
        }
        this.pos++;
        expr = new ast.MemberAccess(expr, propertyToken.value);
        expr.line = startToken.line;
        expr.col = startToken.col;
        continue;
      }

      if (this.match(TokenType.LBRACKET)) {
        const indexExpr = this.parseExpression();
        this.expect(TokenType.RBRACKET, 'Expected ] after index expression');
        expr = new ast.IndexAccess(expr, indexExpr);
        expr.line = startToken.line;
        expr.col = startToken.col;
        continue;
      }

      break;
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

  // Parse primary. Wrapped the same way as parseStatement(): capture the
  // starting token's location and stamp it onto the returned node (unless
  // it already has one, e.g. a parenthesized sub-expression that already
  // got its own, more precise location from its own parsePrimary call).
  // Compiler errors like "Unknown variable" key off Identifier nodes, so
  // without this they'd have no location to report.
  parsePrimary() {
    const startToken = this.current();
    const expr = this.parsePrimaryInner();
    if (expr && expr.line === undefined) {
      expr.line = startToken.line;
      expr.col = startToken.col;
    }
    return expr;
  }

  parsePrimaryInner() {
    // Number
    if (this.match(TokenType.NUMBER)) {
      // A literal written with a decimal point ("1.0", "0.5") is a float:
      // the compiler makes "/" a float division when either side is one.
      const raw = this.previous().value;
      const literal = new ast.Number(parseFloat(raw));
      literal.isFloat = raw.includes('.');
      return literal;
    }

    // String
    if (this.match(TokenType.STRING)) {
      return new ast.String(this.previous().value);
    }

    // Identifier
    if (this.match(TokenType.IDENTIFIER) || this.match(TokenType.VAR) || this.match(TokenType.TO) || this.match(TokenType.STEP)) {
      return new ast.Identifier(this.previous().value);
    }

    // Parenthesized expression
    if (this.match(TokenType.LPAREN)) {
      const expr = this.parseExpression();
      this.expect(TokenType.RPAREN, 'Expected ) after expression');
      return expr;
    }

    throw this.error(`Unexpected token ${this.current().value}`);
  }
}
