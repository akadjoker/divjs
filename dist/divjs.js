// compiler/errors.js
var DivError = class extends Error {
  // stage: 'lexer' | 'parser' | 'compiler'
  // line/col: 1-based position the error refers to, or null when unknown.
  constructor(message, { stage, line = null, col = null } = {}) {
    const hasLocation = Number.isInteger(line) && Number.isInteger(col);
    super(hasLocation ? `${message} at ${line}:${col}` : message);
    this.name = "DivError";
    this.stage = stage;
    this.line = hasLocation ? line : null;
    this.col = hasLocation ? col : null;
    this.reason = message;
  }
};

// compiler/tokenizer.js
var TokenType = {
  // Literals
  NUMBER: "NUMBER",
  STRING: "STRING",
  IDENTIFIER: "IDENTIFIER",
  // Keywords
  PROGRAM: "PROGRAM",
  PROCESS: "PROCESS",
  FUNCTION: "FUNCTION",
  STRUCT: "STRUCT",
  GLOBAL: "GLOBAL",
  PRIVATE: "PRIVATE",
  VAR: "VAR",
  BEGIN: "BEGIN",
  END: "END",
  IF: "IF",
  ELSE: "ELSE",
  FOR: "FOR",
  FROM: "FROM",
  // classic-DIV spelling of FOR ... TO ...; body END
  TO: "TO",
  STEP: "STEP",
  WHILE: "WHILE",
  REPEAT: "REPEAT",
  UNTIL: "UNTIL",
  LOOP: "LOOP",
  LOCAL: "LOCAL",
  FRAME: "FRAME",
  RETURN: "RETURN",
  BREAK: "BREAK",
  CONTINUE: "CONTINUE",
  SWITCH: "SWITCH",
  CASE: "CASE",
  DEFAULT: "DEFAULT",
  NOT: "NOT",
  AND: "AND",
  OR: "OR",
  TYPE: "TYPE",
  OFFSET: "OFFSET",
  // Operators
  EQUALS: "EQUALS",
  // = (assignment)
  EQ: "EQ",
  // == (equality)
  NEQ: "NEQ",
  // != (inequality)
  LT: "LT",
  // < (less than)
  LTE: "LTE",
  // <= (less than or equal)
  GT: "GT",
  // > (greater than)
  GTE: "GTE",
  // >= (greater than or equal)
  PLUS: "PLUS",
  // +
  MINUS: "MINUS",
  // -
  STAR: "STAR",
  // *
  SLASH: "SLASH",
  // /
  PERCENT: "PERCENT",
  // %
  INCREMENT: "INCREMENT",
  // ++
  DECREMENT: "DECREMENT",
  // --
  PLUS_ASSIGN: "PLUS_ASSIGN",
  // +=
  MINUS_ASSIGN: "MINUS_ASSIGN",
  // -=
  STAR_ASSIGN: "STAR_ASSIGN",
  // *=
  SLASH_ASSIGN: "SLASH_ASSIGN",
  // /=
  // Delimiters
  LPAREN: "LPAREN",
  RPAREN: "RPAREN",
  LBRACKET: "LBRACKET",
  RBRACKET: "RBRACKET",
  DOT: "DOT",
  COMMA: "COMMA",
  SEMICOLON: "SEMICOLON",
  // Special
  EOF: "EOF"
};
var Token = class {
  constructor(type, value, line, col) {
    this.type = type;
    this.value = value;
    this.line = line;
    this.col = col;
  }
};
var KEYWORDS = {
  "PROGRAM": TokenType.PROGRAM,
  "PROCESS": TokenType.PROCESS,
  "FUNCTION": TokenType.FUNCTION,
  "STRUCT": TokenType.STRUCT,
  "GLOBAL": TokenType.GLOBAL,
  "PRIVATE": TokenType.PRIVATE,
  "VAR": TokenType.VAR,
  "BEGIN": TokenType.BEGIN,
  "END": TokenType.END,
  "IF": TokenType.IF,
  "ELSE": TokenType.ELSE,
  "FOR": TokenType.FOR,
  "FROM": TokenType.FROM,
  "TO": TokenType.TO,
  "STEP": TokenType.STEP,
  "WHILE": TokenType.WHILE,
  "REPEAT": TokenType.REPEAT,
  "UNTIL": TokenType.UNTIL,
  "LOOP": TokenType.LOOP,
  "LOCAL": TokenType.LOCAL,
  // DIV spells the modulus operator MOD as well as %
  "MOD": TokenType.PERCENT,
  "FRAME": TokenType.FRAME,
  "RETURN": TokenType.RETURN,
  "BREAK": TokenType.BREAK,
  "CONTINUE": TokenType.CONTINUE,
  "SWITCH": TokenType.SWITCH,
  "CASE": TokenType.CASE,
  "DEFAULT": TokenType.DEFAULT,
  "NOT": TokenType.NOT,
  "AND": TokenType.AND,
  "OR": TokenType.OR,
  "TYPE": TokenType.TYPE,
  "OFFSET": TokenType.OFFSET
};
var KEYWORD_NAMES = Object.freeze(Object.keys(KEYWORDS));
var KEYWORD_OPERATOR_VALUES = {
  [TokenType.PERCENT]: "%"
};
var NAME_LIKE_KEYWORDS = /* @__PURE__ */ new Set([TokenType.VAR, TokenType.TO, TokenType.STEP]);
var Lexer = class {
  constructor(source) {
    this.source = source;
    this.pos = 0;
    this.line = 1;
    this.col = 1;
    this.tokens = [];
  }
  // Get current character
  current() {
    if (this.pos >= this.source.length) {
      return null;
    }
    return this.source[this.pos];
  }
  // Peek next character
  peek() {
    if (this.pos + 1 >= this.source.length) {
      return null;
    }
    return this.source[this.pos + 1];
  }
  // Advance position
  advance() {
    const char = this.current();
    this.pos++;
    if (char === "\n") {
      this.line++;
      this.col = 1;
    } else {
      this.col++;
    }
    return char;
  }
  // Skip whitespace
  skipWhitespace() {
    while (this.current() && /\s/.test(this.current())) {
      this.advance();
    }
  }
  // True when a "--" at the current position is the decrement operator
  // rather than the start of a single-line comment. Both spellings are
  // supported (DIV proper only has // and /* */, but this engine's own
  // demos use -- for comments). Decrement is postfix-only and only valid
  // as a statement or a C-FOR step ("n--;", "FOR (...; i--)"), so it must
  // follow something assignable AND be followed by ';' or ')'. Looking
  // only at what came before misread "IF (r == 0) -- note" and
  // "x = 5 -- note" as a decrement. VAR/TO/STEP are keywords that are
  // also accepted as variable names ("step--;").
  isDecrementContext() {
    const prev = this.tokens[this.tokens.length - 1];
    if (!prev) {
      return false;
    }
    const followsValue = prev.type === TokenType.IDENTIFIER || prev.type === TokenType.VAR || prev.type === TokenType.TO || prev.type === TokenType.STEP || prev.type === TokenType.RPAREN || prev.type === TokenType.RBRACKET;
    if (!followsValue) {
      return false;
    }
    let i = this.pos + 2;
    while (i < this.source.length && (this.source[i] === " " || this.source[i] === "	")) {
      i++;
    }
    return this.source[i] === ";" || this.source[i] === ")";
  }
  // Skip comments
  skipComment() {
    if (this.current() === "/" && this.peek() === "/" || this.current() === "-" && this.peek() === "-" && !this.isDecrementContext()) {
      while (this.current() && this.current() !== "\n") this.advance();
      if (this.current() === "\n") this.advance();
      return true;
    }
    if (this.current() === "/" && this.peek() === "*") {
      const startLine = this.line;
      const startCol = this.col;
      this.advance();
      this.advance();
      while (this.current()) {
        if (this.current() === "*" && this.peek() === "/") {
          this.advance();
          this.advance();
          return true;
        }
        this.advance();
      }
      throw new DivError("Unterminated /* comment", { stage: "lexer", line: startLine, col: startCol });
    }
    return false;
  }
  // Read number. At most one decimal point: "1.2.3" used to be read as
  // the single token "1.2.3", which parseFloat quietly turned into 1.2.
  readNumber() {
    const startLine = this.line;
    const startCol = this.col;
    let num = "";
    let seenDot = false;
    while (this.current() && /[0-9.]/.test(this.current())) {
      if (this.current() === ".") {
        if (seenDot) {
          throw new DivError(`Malformed number '${num}.'`, { stage: "lexer", line: startLine, col: startCol });
        }
        seenDot = true;
      }
      num += this.advance();
    }
    return num;
  }
  // Read string
  readString() {
    const quote = this.current();
    const startLine = this.line;
    const startCol = this.col;
    this.advance();
    const escapes = {
      n: "\n",
      t: "	",
      r: "\r",
      "0": "\0",
      "\\": "\\",
      "'": "'",
      '"': '"'
    };
    let str = "";
    while (this.current()) {
      if (this.current() === "\\") {
        const next = this.peek();
        if (next !== null && Object.prototype.hasOwnProperty.call(escapes, next)) {
          this.advance();
          str += escapes[this.advance()];
          continue;
        }
        str += this.advance();
        continue;
      }
      if (this.current() === quote) {
        this.advance();
        return str;
      }
      str += this.advance();
    }
    throw new DivError("Unterminated string", { stage: "lexer", line: startLine, col: startCol });
  }
  // Read identifier or keyword
  readIdentifier() {
    let id = "";
    while (this.current() && /[a-zA-Z0-9_]/.test(this.current())) {
      id += this.advance();
    }
    return id;
  }
  // Record where the most recently pushed token ends (the position just
  // past its last character). The parser uses it to report a missing ';'
  // right after the statement instead of at the start of the next line.
  markLastTokenEnd() {
    const last = this.tokens[this.tokens.length - 1];
    if (last && last.endLine === void 0) {
      last.endLine = this.line;
      last.endCol = this.col;
    }
  }
  // Tokenize
  tokenize() {
    this.tokens = [];
    while (this.current()) {
      this.markLastTokenEnd();
      this.skipWhitespace();
      if (this.skipComment()) {
        continue;
      }
      if (!this.current()) {
        break;
      }
      const line = this.line;
      const col = this.col;
      const char = this.current();
      if (/[0-9]/.test(char)) {
        const num = this.readNumber();
        this.tokens.push(new Token(TokenType.NUMBER, num, line, col));
        continue;
      }
      if (char === '"' || char === "'") {
        const str = this.readString();
        this.tokens.push(new Token(TokenType.STRING, str, line, col));
        continue;
      }
      if (/[a-zA-Z_]/.test(char)) {
        const id = this.readIdentifier();
        const keyword = KEYWORDS[id.toUpperCase()];
        if (keyword) {
          const value = KEYWORD_OPERATOR_VALUES[keyword] ?? (NAME_LIKE_KEYWORDS.has(keyword) ? id.toLowerCase() : id);
          this.tokens.push(new Token(keyword, value, line, col));
        } else {
          this.tokens.push(new Token(TokenType.IDENTIFIER, id.toLowerCase(), line, col));
        }
        continue;
      }
      if (char === "=" && this.peek() === "=") {
        this.advance();
        this.advance();
        this.tokens.push(new Token(TokenType.EQ, "==", line, col));
        continue;
      }
      if (char === "!" && this.peek() === "=") {
        this.advance();
        this.advance();
        this.tokens.push(new Token(TokenType.NEQ, "!=", line, col));
        continue;
      }
      if (char === "<" && this.peek() === "=") {
        this.advance();
        this.advance();
        this.tokens.push(new Token(TokenType.LTE, "<=", line, col));
        continue;
      }
      if (char === ">" && this.peek() === "=") {
        this.advance();
        this.advance();
        this.tokens.push(new Token(TokenType.GTE, ">=", line, col));
        continue;
      }
      if (char === "+" && this.peek() === "+") {
        this.advance();
        this.advance();
        this.tokens.push(new Token(TokenType.INCREMENT, "++", line, col));
        continue;
      }
      if (char === "-" && this.peek() === "-") {
        this.advance();
        this.advance();
        this.tokens.push(new Token(TokenType.DECREMENT, "--", line, col));
        continue;
      }
      if (char === "+" && this.peek() === "=") {
        this.advance();
        this.advance();
        this.tokens.push(new Token(TokenType.PLUS_ASSIGN, "+=", line, col));
        continue;
      }
      if (char === "-" && this.peek() === "=") {
        this.advance();
        this.advance();
        this.tokens.push(new Token(TokenType.MINUS_ASSIGN, "-=", line, col));
        continue;
      }
      if (char === "*" && this.peek() === "=") {
        this.advance();
        this.advance();
        this.tokens.push(new Token(TokenType.STAR_ASSIGN, "*=", line, col));
        continue;
      }
      if (char === "/" && this.peek() === "=") {
        this.advance();
        this.advance();
        this.tokens.push(new Token(TokenType.SLASH_ASSIGN, "/=", line, col));
        continue;
      }
      if (char === "&" && this.peek() === "&") {
        this.advance();
        this.advance();
        this.tokens.push(new Token(TokenType.AND, "&&", line, col));
        continue;
      }
      if (char === "|" && this.peek() === "|") {
        this.advance();
        this.advance();
        this.tokens.push(new Token(TokenType.OR, "||", line, col));
        continue;
      }
      switch (char) {
        case "=":
          this.advance();
          this.tokens.push(new Token(TokenType.EQUALS, "=", line, col));
          break;
        case "<":
          this.advance();
          this.tokens.push(new Token(TokenType.LT, "<", line, col));
          break;
        case ">":
          this.advance();
          this.tokens.push(new Token(TokenType.GT, ">", line, col));
          break;
        case "+":
          this.advance();
          this.tokens.push(new Token(TokenType.PLUS, "+", line, col));
          break;
        case "-":
          this.advance();
          this.tokens.push(new Token(TokenType.MINUS, "-", line, col));
          break;
        case "*":
          this.advance();
          this.tokens.push(new Token(TokenType.STAR, "*", line, col));
          break;
        case "/":
          this.advance();
          this.tokens.push(new Token(TokenType.SLASH, "/", line, col));
          break;
        case "%":
          this.advance();
          this.tokens.push(new Token(TokenType.PERCENT, "%", line, col));
          break;
        case "(":
          this.advance();
          this.tokens.push(new Token(TokenType.LPAREN, "(", line, col));
          break;
        case ")":
          this.advance();
          this.tokens.push(new Token(TokenType.RPAREN, ")", line, col));
          break;
        case "[":
          this.advance();
          this.tokens.push(new Token(TokenType.LBRACKET, "[", line, col));
          break;
        case "]":
          this.advance();
          this.tokens.push(new Token(TokenType.RBRACKET, "]", line, col));
          break;
        case ".":
          this.advance();
          this.tokens.push(new Token(TokenType.DOT, ".", line, col));
          break;
        case ",":
          this.advance();
          this.tokens.push(new Token(TokenType.COMMA, ",", line, col));
          break;
        case ";":
          this.advance();
          this.tokens.push(new Token(TokenType.SEMICOLON, ";", line, col));
          break;
        case "!":
          this.advance();
          this.tokens.push(new Token(TokenType.NOT, "!", line, col));
          break;
        case "&":
          this.advance();
          this.tokens.push(new Token(TokenType.OFFSET, "&", line, col));
          break;
        default:
          throw new DivError(`Unexpected character '${char}'`, { stage: "lexer", line, col });
      }
    }
    this.markLastTokenEnd();
    this.tokens.push(new Token(TokenType.EOF, "", this.line, this.col));
    return this.tokens;
  }
};

// compiler/ast.js
var Program = class {
  constructor(name, globals, structs, processes, functions, mainBlock, mainPrivates = [], locals = []) {
    this.type = "program";
    this.name = name;
    this.globals = globals;
    this.structs = structs;
    this.processes = processes;
    this.functions = functions;
    this.mainBlock = mainBlock;
    this.mainPrivates = mainPrivates;
    this.locals = locals;
  }
};
var Global = class {
  constructor(name, value, size) {
    this.type = "global";
    this.name = name;
    this.value = value;
    if (size !== void 0) this.size = size;
  }
};
var Function = class {
  constructor(name, params, body, privates = []) {
    this.type = "function";
    this.name = name;
    this.params = params;
    this.body = body;
    this.privates = privates;
  }
};
var Process = class {
  constructor(name, params, privates, body) {
    this.type = "process";
    this.name = name;
    this.params = params;
    this.privates = privates;
    this.body = body;
  }
};
var Private = class {
  constructor(name, value, size) {
    this.type = "private";
    this.name = name;
    this.value = value;
    if (size !== void 0) this.size = size;
  }
};
var Block = class {
  constructor(statements) {
    this.type = "block";
    this.statements = statements;
  }
};
var If = class {
  constructor(condition, thenBranch, elseBranch) {
    this.type = "if";
    this.condition = condition;
    this.thenBranch = thenBranch;
    this.elseBranch = elseBranch;
  }
};
var Switch = class {
  constructor(subject, cases, defaultBody) {
    this.type = "switch";
    this.subject = subject;
    this.cases = cases;
    this.defaultBody = defaultBody;
  }
};
var For = class {
  constructor(varName, start, end, step, body) {
    this.type = "for";
    this.varName = varName;
    this.start = start;
    this.end = end;
    this.step = step;
    this.body = body;
  }
};
var CFor = class {
  constructor(init, condition, step, body) {
    this.type = "cfor";
    this.init = init;
    this.condition = condition;
    this.step = step;
    this.body = body;
  }
};
var While = class {
  constructor(condition, body) {
    this.type = "while";
    this.condition = condition;
    this.body = body;
  }
};
var Repeat = class {
  constructor(body, condition) {
    this.type = "repeat";
    this.body = body;
    this.condition = condition;
  }
};
var Loop = class {
  constructor(body) {
    this.type = "loop";
    this.body = body;
  }
};
var Var = class {
  constructor(name, value) {
    this.type = "var";
    this.name = name;
    this.value = value;
  }
};
var Return = class {
  constructor(value) {
    this.type = "return";
    this.value = value;
  }
};
var Break = class {
  constructor() {
    this.type = "break";
  }
};
var Continue = class {
  constructor() {
    this.type = "continue";
  }
};
var Frame = class {
  constructor(value = null) {
    this.type = "frame";
    this.value = value;
  }
};
var ExpressionStatement = class {
  constructor(expression) {
    this.type = "expression";
    this.expression = expression;
  }
};
var Assign = class {
  constructor(target, value, operator = null) {
    this.type = "assign";
    this.target = target;
    this.value = value;
    if (operator) {
      this.operator = operator;
    }
  }
};
var Binary = class {
  constructor(left, operator, right) {
    this.type = "binary";
    this.left = left;
    this.operator = operator;
    this.right = right;
  }
};
var Unary = class {
  constructor(operator, operand) {
    this.type = "unary";
    this.operator = operator;
    this.operand = operand;
  }
};
var Call = class {
  constructor(callee, args) {
    this.type = "call";
    this.callee = callee;
    this.args = args;
  }
};
var Number2 = class {
  constructor(value) {
    this.type = "number";
    this.value = value;
  }
};
var String2 = class {
  constructor(value) {
    this.type = "string";
    this.value = value;
  }
};
var Identifier = class {
  constructor(name) {
    this.type = "identifier";
    this.name = name;
  }
};
var MemberAccess = class {
  constructor(object, property) {
    this.type = "member_access";
    this.object = object;
    this.property = property;
  }
};
var IndexAccess = class {
  constructor(object, index) {
    this.type = "index_access";
    this.object = object;
    this.index = index;
  }
};
var TypeOperator = class {
  constructor(processName) {
    this.type = "type_operator";
    this.processName = processName;
  }
};
var OffsetOperator = class {
  constructor(name) {
    this.type = "offset_operator";
    this.name = name;
  }
};
var StructDecl = class {
  constructor(name, count, fields, initializers = null) {
    this.type = "struct_decl";
    this.name = name;
    this.count = count;
    this.fields = fields;
    this.initializers = initializers;
  }
};

// parser/parser.js
var Parser = class {
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
    return token.type === TokenType.IDENTIFIER || token.type === TokenType.VAR || token.type === TokenType.TO || token.type === TokenType.STEP;
  }
  readIdentifierLike(message = "Expected identifier") {
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
      return this.tokens[this.tokens.length - 1];
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
  error(message, token = this.current()) {
    return new DivError(message, { stage: "parser", line: token.line, col: token.col });
  }
  // Expect token
  expect(type, message) {
    if (this.is(type)) {
      this.pos++;
      return;
    }
    const text = message || `Expected ${type}`;
    const previous = this.tokens[this.pos - 1];
    if (type === TokenType.SEMICOLON && previous && previous.endLine !== void 0) {
      throw new DivError(text, { stage: "parser", line: previous.endLine, col: previous.endCol });
    }
    throw this.error(text);
  }
  // Consume a leading "COMPILER_OPTIONS ...;" directive, if present.
  // It isn't a keyword in the tokenizer - it arrives as a plain
  // IDENTIFIER - so match on the name and skip through the terminating
  // semicolon, whatever options were listed.
  skipCompilerOptions() {
    const token = this.current();
    if (!token || token.type !== TokenType.IDENTIFIER || String(token.value).toUpperCase() !== "COMPILER_OPTIONS") {
      return;
    }
    while (!this.is(TokenType.EOF) && !this.is(TokenType.SEMICOLON)) {
      this.pos++;
    }
    this.match(TokenType.SEMICOLON);
  }
  // Parse program
  parse() {
    this.skipCompilerOptions();
    this.expect(TokenType.PROGRAM, "Expected PROGRAM keyword");
    const name = this.current().value;
    this.pos++;
    this.expect(TokenType.SEMICOLON, "Expected ; after program name");
    const globals = [];
    const structs = [];
    const processes = [];
    const functions = [];
    const mainBlock = [];
    const mainPrivates = [];
    const locals = [];
    while (!this.is(TokenType.EOF)) {
      const declToken = this.current();
      if (this.is(TokenType.GLOBAL)) {
        globals.push(...this.parseGlobal());
      } else if (this.is(TokenType.STRUCT)) {
        const s = this.parseStructDecl();
        s.line = declToken.line;
        s.col = declToken.col;
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
        this.pos++;
        while (!this.is(TokenType.BEGIN) && !this.is(TokenType.EOF) && !this.is(TokenType.PRIVATE) && !this.is(TokenType.PROCESS) && !this.is(TokenType.FUNCTION) && !this.is(TokenType.GLOBAL) && !this.is(TokenType.LOCAL)) {
          if (this.is(TokenType.STRUCT)) {
            throw this.error("STRUCT inside a LOCAL section is not supported; declare the STRUCT under GLOBAL");
          }
          locals.push(...this.parsePrivate());
        }
      } else if (this.is(TokenType.PRIVATE)) {
        this.pos++;
        while (!this.is(TokenType.BEGIN) && !this.is(TokenType.EOF)) {
          mainPrivates.push(...this.parsePrivate());
        }
      } else if (this.is(TokenType.BEGIN)) {
        const block = this.parseBeginEndBlock("Expected BEGIN before main block", "Expected END after main block");
        mainBlock.push(...block.statements);
      } else {
        throw this.error(`Unexpected token ${this.current().value}`);
      }
    }
    return new Program(name, globals, structs, processes, functions, mainBlock, mainPrivates, locals);
  }
  parseStructDecl() {
    this.pos++;
    const name = this.readIdentifierLike("Expected struct name");
    let count = null;
    if (this.match(TokenType.LBRACKET)) {
      count = this.parseExpression();
      this.expect(TokenType.RBRACKET, "Expected ] after struct count");
    }
    const fields = [];
    while (!this.is(TokenType.END) && !this.is(TokenType.EOF)) {
      if (this.is(TokenType.STRUCT)) {
        const nested = this.parseStructDecl();
        fields.push({ name: nested.name, nested, defaultValue: null, size: null });
        continue;
      }
      const fname = this.readIdentifierLike("Expected field name");
      let fsize = null;
      let fdefault = null;
      if (this.match(TokenType.LBRACKET)) {
        fsize = this.parseExpression();
        this.expect(TokenType.RBRACKET, "Expected ] after field size");
      } else if (this.match(TokenType.EQUALS)) {
        fdefault = this.parseExpression();
      }
      this.expect(TokenType.SEMICOLON, "Expected ; after struct field");
      fields.push({ name: fname, defaultValue: fdefault, size: fsize, nested: null });
    }
    this.expect(TokenType.END, "Expected END after struct body");
    let initializers = null;
    if (this.match(TokenType.EQUALS)) {
      initializers = this.parseStructInitializers();
    }
    return new StructDecl(name, count, fields, initializers);
  }
  parseStructInitializers() {
    const values = this.parseInitializerList();
    this.expect(TokenType.SEMICOLON, "Expected ; after struct initializer list");
    return values;
  }
  // "value, value, N DUP(value), ..." up to (not including) the ';'.
  parseInitializerList() {
    const values = [];
    while (!this.is(TokenType.SEMICOLON) && !this.is(TokenType.EOF)) {
      if (this.current().type === TokenType.NUMBER && this.peek(1).type === TokenType.IDENTIFIER && this.peek(1).value.toUpperCase() === "DUP" && this.peek(2).type === TokenType.LPAREN) {
        const dupCount = this.current().value;
        this.pos += 2;
        this.expect(TokenType.LPAREN, "Expected ( after DUP");
        const dupVal = this.parseExpression();
        this.expect(TokenType.RPAREN, "Expected ) after DUP value");
        for (let i = 0; i < dupCount; i++) values.push(dupVal);
      } else {
        values.push(this.parseExpression());
      }
      if (!this.is(TokenType.SEMICOLON)) {
        this.expect(TokenType.COMMA, "Expected , or ; in initializer list");
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
    this.pos++;
    const globals = [];
    while (this.isIdentifierLike(this.current())) {
      do {
        const declToken = this.current();
        const name = this.readIdentifierLike("Expected global name");
        let value = null;
        let size;
        let initializers = null;
        if (this.match(TokenType.LBRACKET)) {
          size = this.parseExpression();
          this.expect(TokenType.RBRACKET, "Expected ] after array size");
          if (this.match(TokenType.EQUALS)) {
            initializers = this.parseInitializerList();
          }
        } else if (this.match(TokenType.EQUALS)) {
          value = this.parseExpression();
        }
        const global = new Global(name, value, size);
        global.initializers = initializers;
        global.line = declToken.line;
        global.col = declToken.col;
        globals.push(global);
      } while (this.match(TokenType.COMMA));
      this.expect(TokenType.SEMICOLON, "Expected ; after global declaration");
    }
    if (globals.length === 0) {
      throw this.error("Expected at least one variable name after GLOBAL");
    }
    return globals;
  }
  // Parse function
  parseFunction() {
    this.pos++;
    const name = this.readIdentifierLike("Expected function name");
    const params = [];
    this.expect(TokenType.LPAREN, "Expected ( after function name");
    if (!this.is(TokenType.RPAREN)) {
      do {
        const paramName = this.readIdentifierLike("Expected function param name");
        params.push(paramName);
      } while (this.match(TokenType.COMMA));
    }
    this.expect(TokenType.RPAREN, "Expected ) after function params");
    this.match(TokenType.SEMICOLON);
    const privates = [];
    if (this.match(TokenType.PRIVATE)) {
      while (!this.is(TokenType.BEGIN) && !this.is(TokenType.EOF)) {
        privates.push(...this.parsePrivate());
      }
    }
    const body = this.parseBeginEndBlock("Expected BEGIN before function body", "Expected END after function body");
    return new Function(name, params, body, privates);
  }
  // Parse process
  parseProcess() {
    this.pos++;
    const name = this.readIdentifierLike("Expected process name");
    const params = [];
    this.expect(TokenType.LPAREN, "Expected ( after process name");
    if (!this.is(TokenType.RPAREN)) {
      do {
        const paramName = this.readIdentifierLike("Expected process param name");
        params.push(paramName);
      } while (this.match(TokenType.COMMA));
    }
    this.expect(TokenType.RPAREN, "Expected ) after process params");
    this.match(TokenType.SEMICOLON);
    const privates = [];
    if (this.match(TokenType.PRIVATE)) {
      while (!this.is(TokenType.BEGIN) && !this.is(TokenType.EOF)) {
        privates.push(...this.parsePrivate());
      }
    }
    const body = this.parseBeginEndBlock("Expected BEGIN before process body", "Expected END after process body");
    return new Process(name, params, privates, body);
  }
  // Parse private
  parsePrivate() {
    const decls = [];
    do {
      const declToken = this.current();
      const name = this.readIdentifierLike("Expected private name");
      let value = null;
      let size;
      if (this.match(TokenType.LBRACKET)) {
        size = this.parseExpression();
        this.expect(TokenType.RBRACKET, "Expected ] after array size");
      } else if (this.match(TokenType.EQUALS)) {
        value = this.parseExpression();
      }
      const decl = new Private(name, value, size);
      decl.line = declToken.line;
      decl.col = declToken.col;
      decls.push(decl);
    } while (this.match(TokenType.COMMA));
    this.expect(TokenType.SEMICOLON, "Expected ; after PRIVATE");
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
    while (!this.is(TokenType.EOF) && !this.is(TokenType.END) && !this.is(TokenType.UNTIL) && !this.is(TokenType.ELSE) && !this.is(TokenType.CASE) && !this.is(TokenType.DEFAULT)) {
      statements.push(this.parseStatement());
    }
    return statements;
  }
  // Parse block
  parseBlock() {
    const statements = this.parseBlockStatements();
    this.expect(TokenType.END, "Expected END after block");
    return new Block(statements);
  }
  // Parse BEGIN ... END block
  parseBeginEndBlock(beginMessage, endMessage) {
    this.expect(TokenType.BEGIN, beginMessage || "Expected BEGIN");
    const statements = [];
    while (!this.is(TokenType.EOF) && !this.is(TokenType.END)) {
      statements.push(this.parseStatement());
    }
    this.expect(TokenType.END, endMessage || "Expected END after block");
    return new Block(statements);
  }
  // Parse statement
  parseStatement() {
    const startToken = this.current();
    const stmt = this.parseStatementInner();
    if (stmt && stmt.line === void 0) {
      stmt.line = startToken.line;
      stmt.col = startToken.col;
    }
    return stmt;
  }
  parseStatementInner() {
    if (this.match(TokenType.IF)) {
      return this.parseIf();
    }
    if (this.match(TokenType.SWITCH)) {
      return this.parseSwitch();
    }
    if (this.match(TokenType.FOR)) {
      if (this.is(TokenType.LPAREN)) {
        return this.parseCFor();
      }
      return this.parseFor(false);
    }
    if (this.match(TokenType.FROM)) {
      return this.parseFor(true);
    }
    if (this.match(TokenType.WHILE)) {
      return this.parseWhile();
    }
    if (this.match(TokenType.REPEAT)) {
      return this.parseRepeat();
    }
    if (this.match(TokenType.LOOP)) {
      return this.parseLoop();
    }
    if (this.match(TokenType.FRAME)) {
      let frameValue = null;
      if (this.match(TokenType.LPAREN)) {
        frameValue = this.parseExpression();
        this.expect(TokenType.RPAREN, "Expected ) after FRAME value");
      }
      this.expect(TokenType.SEMICOLON, "Expected ; after FRAME");
      return new Frame(frameValue);
    }
    if (this.is(TokenType.VAR) && this.isIdentifierLike(this.peek(1))) {
      this.pos++;
      return this.parseVar();
    }
    if (this.match(TokenType.RETURN)) {
      let value = null;
      if (!this.is(TokenType.SEMICOLON)) {
        value = this.parseExpression();
      }
      this.expect(TokenType.SEMICOLON, "Expected ; after RETURN");
      return new Return(value);
    }
    if (this.match(TokenType.BREAK)) {
      this.expect(TokenType.SEMICOLON, "Expected ; after BREAK");
      return new Break();
    }
    if (this.match(TokenType.CONTINUE)) {
      this.expect(TokenType.SEMICOLON, "Expected ; after CONTINUE");
      return new Continue();
    }
    const expr = this.parseExpression();
    if (this.is(TokenType.INCREMENT) || this.is(TokenType.DECREMENT)) {
      const assign = this.desugarIncrement(expr);
      this.expect(TokenType.SEMICOLON, "Expected ; after ++/--");
      return new ExpressionStatement(assign);
    }
    this.expect(TokenType.SEMICOLON, "Expected ; after expression");
    return new ExpressionStatement(expr);
  }
  // Parse if
  parseIf() {
    const condition = this.parseExpression();
    const thenBranch = new Block(this.parseBlockStatements());
    let elseBranch = null;
    if (this.match(TokenType.ELSE)) {
      elseBranch = new Block(this.parseBlockStatements());
    }
    this.expect(TokenType.END, "Expected END after IF/ELSE");
    return new If(condition, thenBranch, elseBranch);
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
    this.expect(TokenType.LPAREN, "Expected ( after SWITCH");
    const subject = this.parseExpression();
    this.expect(TokenType.RPAREN, "Expected ) after SWITCH subject");
    const cases = [];
    while (this.match(TokenType.CASE)) {
      const values = [this.parseExpression()];
      while (this.match(TokenType.COMMA)) {
        values.push(this.parseExpression());
      }
      const body = new Block(this.parseBlockStatements());
      cases.push({ values, body });
    }
    if (cases.length === 0) {
      throw this.error("Expected at least one CASE in SWITCH");
    }
    let defaultBody = null;
    if (this.match(TokenType.DEFAULT)) {
      defaultBody = new Block(this.parseBlockStatements());
    }
    this.expect(TokenType.END, "Expected END after SWITCH");
    return new Switch(subject, cases, defaultBody);
  }
  // FOR (init; condition; step) body END - desugared into the same shape
  // a WHILE would produce, with the step run at the end of each pass.
  parseCFor() {
    this.expect(TokenType.LPAREN, "Expected ( after FOR");
    const init = this.is(TokenType.SEMICOLON) ? null : this.parseForClause();
    this.expect(TokenType.SEMICOLON, "Expected ; after FOR initialiser");
    const condition = this.is(TokenType.SEMICOLON) ? null : this.parseExpression();
    this.expect(TokenType.SEMICOLON, "Expected ; after FOR condition");
    const step = this.is(TokenType.RPAREN) ? null : this.parseForClause();
    this.expect(TokenType.RPAREN, "Expected ) after FOR step");
    const body = this.parseBlock();
    return new CFor(init, condition, step, body);
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
  desugarIncrement(target) {
    const operator = this.current();
    const isIncrement = operator.type === TokenType.INCREMENT;
    const assignable = target && (target.type === "identifier" || target.type === "member_access" || target.type === "index_access");
    if (!assignable) {
      throw this.error(`${operator.value} can only follow a variable, field or array element, as a statement of its own (e.g. "n${operator.value};")`, operator);
    }
    this.pos++;
    const assign = new Assign(target, new Number2(1), isIncrement ? "+" : "-");
    assign.line = operator.line;
    assign.col = operator.col;
    return assign;
  }
  // Parse for/from - same loop, two DIV-family spellings. FROM
  // (requireSemicolonBeforeBody) additionally expects a ; right after the
  // TO/STEP range and before the body, e.g. "FROM x=1 TO 8; asteroid(); END".
  parseFor(requireSemicolonBeforeBody) {
    const varName = this.readIdentifierLike("Expected FOR variable name");
    this.expect(TokenType.EQUALS, "Expected = after FOR var");
    const start = this.parseExpression();
    this.expect(TokenType.TO, "Expected TO in FOR");
    const end = this.parseExpression();
    let step = requireSemicolonBeforeBody ? null : new Number2(1);
    if (this.match(TokenType.STEP)) {
      step = this.parseExpression();
    }
    if (requireSemicolonBeforeBody) {
      this.expect(TokenType.SEMICOLON, "Expected ; after FROM range");
    }
    const body = this.parseBlock();
    return new For(varName, start, end, step, body);
  }
  // Parse while
  parseWhile() {
    const condition = this.parseExpression();
    const body = this.parseBlock();
    return new While(condition, body);
  }
  // Parse repeat
  parseRepeat() {
    const statements = [];
    while (!this.is(TokenType.EOF) && !this.is(TokenType.UNTIL)) {
      statements.push(this.parseStatement());
    }
    const body = new Block(statements);
    this.expect(TokenType.UNTIL, "Expected UNTIL after REPEAT body");
    const condition = this.parseExpression();
    this.match(TokenType.SEMICOLON);
    return new Repeat(body, condition);
  }
  // Parse loop
  parseLoop() {
    const body = this.parseBlock();
    return new Loop(body);
  }
  // Parse var
  parseVar() {
    const name = this.readIdentifierLike("Expected variable name after VAR");
    let value = new Number2(0);
    if (this.match(TokenType.EQUALS)) {
      value = this.parseExpression();
    }
    this.expect(TokenType.SEMICOLON, "Expected ; after VAR");
    return new Var(name, value);
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
      const assign = new Assign(left, right);
      assign.line = startToken.line;
      assign.col = startToken.col;
      return assign;
    }
    const compoundOp = this.matchCompoundAssign();
    if (compoundOp) {
      const right = this.parseAssignment();
      const assign = new Assign(left, right, compoundOp);
      assign.line = startToken.line;
      assign.col = startToken.col;
      return assign;
    }
    return left;
  }
  matchCompoundAssign() {
    if (this.match(TokenType.PLUS_ASSIGN)) return "+";
    if (this.match(TokenType.MINUS_ASSIGN)) return "-";
    if (this.match(TokenType.STAR_ASSIGN)) return "*";
    if (this.match(TokenType.SLASH_ASSIGN)) return "/";
    return null;
  }
  // Parse or
  parseOr() {
    let left = this.parseAnd();
    while (this.match(TokenType.OR)) {
      const operator = "||";
      const right = this.parseAnd();
      left = new Binary(left, operator, right);
    }
    return left;
  }
  // Parse and
  parseAnd() {
    let left = this.parseEquality();
    while (this.match(TokenType.AND)) {
      const operator = "&&";
      const right = this.parseEquality();
      left = new Binary(left, operator, right);
    }
    return left;
  }
  // Parse equality
  parseEquality() {
    let left = this.parseComparison();
    while (this.match(TokenType.EQ) || this.match(TokenType.NEQ)) {
      const operator = this.previous().value;
      const right = this.parseComparison();
      left = new Binary(left, operator, right);
    }
    return left;
  }
  // Parse comparison
  parseComparison() {
    let left = this.parseTerm();
    while (this.match(TokenType.LT) || this.match(TokenType.LTE) || this.match(TokenType.GT) || this.match(TokenType.GTE)) {
      const operator = this.previous().value;
      const right = this.parseTerm();
      left = new Binary(left, operator, right);
    }
    return left;
  }
  // Parse term
  parseTerm() {
    let left = this.parseFactor();
    while (this.match(TokenType.PLUS) || this.match(TokenType.MINUS)) {
      const operator = this.previous().value;
      const right = this.parseFactor();
      left = new Binary(left, operator, right);
    }
    return left;
  }
  // Parse factor
  parseFactor() {
    let left = this.parseUnary();
    while (this.match(TokenType.STAR) || this.match(TokenType.SLASH) || this.match(TokenType.PERCENT)) {
      const operator = this.previous().value;
      const right = this.parseUnary();
      left = new Binary(left, operator, right);
    }
    return left;
  }
  // Parse unary. TYPE/OFFSET/unary nodes are built here rather than in
  // parsePrimary, so they get their location stamped here too (compiler
  // errors such as "OFFSET ... no such GLOBAL" report it).
  parseUnary() {
    const startToken = this.current();
    const expr = this.parseUnaryInner();
    if (expr && expr.line === void 0) {
      expr.line = startToken.line;
      expr.col = startToken.col;
    }
    return expr;
  }
  parseUnaryInner() {
    if (this.match(TokenType.TYPE)) {
      const token = this.current();
      if (!this.isIdentifierLike(token)) {
        this.expect(TokenType.IDENTIFIER, "Expected process name after TYPE");
        return new TypeOperator(this.previous().value);
      }
      this.pos++;
      return new TypeOperator(token.value);
    }
    if (this.match(TokenType.OFFSET)) {
      const token = this.current();
      if (!this.isIdentifierLike(token)) {
        this.expect(TokenType.IDENTIFIER, "Expected variable name after OFFSET");
        return new OffsetOperator(this.previous().value);
      }
      this.pos++;
      return new OffsetOperator(token.value);
    }
    if (this.match(TokenType.MINUS) || this.match(TokenType.NOT)) {
      const operator = this.previous().type === TokenType.NOT ? "!" : this.previous().value;
      const right = this.parseUnary();
      return new Unary(operator, right);
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
        expr = new Call(expr, args);
        expr.line = startToken.line;
        expr.col = startToken.col;
        continue;
      }
      if (this.match(TokenType.DOT)) {
        const propertyToken = this.current();
        if (!this.isIdentifierLike(propertyToken)) {
          this.expect(TokenType.IDENTIFIER, "Expected property name after .");
          expr = new MemberAccess(expr, this.previous().value);
          expr.line = startToken.line;
          expr.col = startToken.col;
          continue;
        }
        this.pos++;
        expr = new MemberAccess(expr, propertyToken.value);
        expr.line = startToken.line;
        expr.col = startToken.col;
        continue;
      }
      if (this.match(TokenType.LBRACKET)) {
        const indexExpr = this.parseExpression();
        this.expect(TokenType.RBRACKET, "Expected ] after index expression");
        expr = new IndexAccess(expr, indexExpr);
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
    this.expect(TokenType.RPAREN, "Expected ) after function args");
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
    if (expr && expr.line === void 0) {
      expr.line = startToken.line;
      expr.col = startToken.col;
    }
    return expr;
  }
  parsePrimaryInner() {
    if (this.match(TokenType.NUMBER)) {
      return new Number2(parseFloat(this.previous().value));
    }
    if (this.match(TokenType.STRING)) {
      return new String2(this.previous().value);
    }
    if (this.match(TokenType.IDENTIFIER) || this.match(TokenType.VAR) || this.match(TokenType.TO) || this.match(TokenType.STEP)) {
      return new Identifier(this.previous().value);
    }
    if (this.match(TokenType.LPAREN)) {
      const expr = this.parseExpression();
      this.expect(TokenType.RPAREN, "Expected ) after expression");
      return expr;
    }
    throw this.error(`Unexpected token ${this.current().value}`);
  }
};

// compiler/bytecode.js
var OpCodes = {
  // Stack operations. PUSH (0x01), DUP (0x03) and NOP (0x90) were never
  // emitted by the compiler and were removed; their values stay unused.
  POP: 2,
  // Pop value from stack
  // Load/Store
  LOAD_LOCAL: 16,
  // Load local variable
  STORE_LOCAL: 17,
  // Store local variable
  LOAD_GLOBAL: 18,
  // Load global variable
  STORE_GLOBAL: 19,
  // Store global variable
  // 0x14 was LOAD_PARAM: never emitted (parameters are ordinary locals)
  // and never executed by the VM.
  LOAD_LOCAL_IDX: 21,
  // index=pop(), push locals[base+index]
  STORE_LOCAL_IDX: 22,
  // value=pop(), index=pop(), locals[base+index]=value
  LOAD_GLOBAL_IDX: 23,
  // index=pop(), push globals[base+index]
  STORE_GLOBAL_IDX: 24,
  // value=pop(), index=pop(), globals[base+index]=value
  // Arithmetic
  ADD: 32,
  // Addition
  SUB: 33,
  // Subtraction
  MUL: 34,
  // Multiplication
  DIV: 35,
  // Division
  MOD: 36,
  // Modulo
  NEG: 37,
  // Negate
  // Comparison
  EQ: 48,
  // Equal
  NEQ: 49,
  // Not equal
  LT: 50,
  // Less than
  LTE: 51,
  // Less than or equal
  GT: 52,
  // Greater than
  GTE: 53,
  // Greater than or equal
  // Logical. AND/OR removed: the compiler has emitted short-circuit
  // AND/OR entirely via JUMP_IF_TRUE/JUMP_IF_FALSE chains since f949496,
  // and nothing else in this codebase ever referenced these two values.
  NOT: 64,
  // Logical not
  // Control flow
  JUMP: 80,
  // Unconditional jump
  JUMP_IF_FALSE: 81,
  // Jump if false
  JUMP_IF_TRUE: 82,
  // Jump if true
  LOOP: 83,
  // Loop back
  BREAK: 84,
  // Break from loop
  CONTINUE: 85,
  // Continue loop
  // Call
  CALL: 96,
  // Call function
  CALL_NATIVE: 97,
  // Call native function
  RETURN: 98,
  // Return from function
  // Process
  SPAWN_PROCESS: 112,
  // Spawn new process
  FRAME: 113,
  // Frame yield
  // Constants
  LOAD_CONST: 128,
  // Load constant from pool
  // Special
  HALT: 255
  // Stop execution
};
var OpCodeNames = {};
for (const [name, value] of Object.entries(OpCodes)) {
  OpCodeNames[value] = name;
}

// utils/hash.js
function hashCode(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
}
function processTypeCode(name) {
  return -(1 + hashCode(String(name)) % 2147483646);
}

// compiler/compiler.js
function getConstantNumericValue(expr) {
  if (expr.type === "number") {
    return expr.value;
  }
  if (expr.type === "unary" && expr.operator === "-" && expr.operand.type === "number") {
    return -expr.operand.value;
  }
  return null;
}
var CANONICAL_LOCAL_SLOTS = /* @__PURE__ */ new Map([
  ["x", 0],
  ["y", 1],
  ["width", 2],
  ["height", 3],
  ["ctype", 4],
  ["c_type", 4],
  ["id", 5],
  ["region", 6],
  ["angle", 7],
  ["red", 8],
  ["green", 9],
  ["blue", 10],
  ["alpha", 11],
  ["tag", 12],
  ["priority", 13],
  // RESOLUTION divides x/y when drawing, so a script can work in
  // sub-pixel units (resolution=100 -> two decimals).
  ["resolution", 14],
  // Z is draw depth, kept apart from PRIORITY: DIV picks what to run by
  // highest _Priority (i.c:903) and what to paint by highest _Z
  // (i.c:1441), higher Z painted first and therefore further back.
  ["z", 15],
  // GRAPH/FILE/SIZE/FLAGS are canonical process fields in DIV too - the
  // tutorials rely on it, e.g. "PROCESS boardbox(x,y,graph,file,number)"
  // expects those parameters to land directly on the process's own
  // fields. SIZE defaults to 100 (full scale); the rest to 0.
  ["graph", 16],
  ["file", 17],
  ["size", 18],
  ["flags", 19],
  // DIV's predefined LOCAL cnumber: which scroll/mode-7 windows show the
  // process (a sum of c_0..c_9; 0 = all of them). Manual 12418-12452.
  ["cnumber", 20]
]);
var CANONICAL_LOCAL_COUNT = 21;
var BUILTIN_CONSTANTS = Object.freeze({
  _left: "ArrowLeft",
  _right: "ArrowRight",
  _up: "ArrowUp",
  _down: "ArrowDown",
  _space: " ",
  _enter: "Enter",
  _esc: "Escape",
  _backspace: "Backspace",
  _tab: "Tab",
  _shift: "Shift",
  _ctrl: "Control",
  _control: "Control",
  _alt: "Alt",
  _fire: "z",
  _a: "a",
  _b: "b",
  _c: "c",
  _d: "d",
  _e: "e",
  _f: "f",
  _g: "g",
  _h: "h",
  _i: "i",
  _j: "j",
  _k: "k",
  _l: "l",
  _m: "m",
  _n: "n",
  _o: "o",
  _p: "p",
  _q: "q",
  _r: "r",
  _s: "s",
  _t: "t",
  _u: "u",
  _v: "v",
  _w: "w",
  _x: "x",
  _y: "y",
  _z: "z",
  _0: "0",
  _1: "1",
  _2: "2",
  _3: "3",
  _4: "4",
  _5: "5",
  _6: "6",
  _7: "7",
  _8: "8",
  _9: "9",
  true: 1,
  false: 0,
  c_screen: 0,
  c_scroll: 1,
  c_m7: 2,
  // Window bits for cnumber (manual 13260-13290): c_n = 2^n.
  c_0: 1,
  c_1: 2,
  c_2: 4,
  c_3: 8,
  c_4: 16,
  c_5: 32,
  c_6: 64,
  c_7: 128,
  c_8: 256,
  c_9: 512,
  // delete_text(all_text) removes every WRITE text (manual 13414-13420).
  all_text: 0,
  // Body types for phys_box / phys_circle (vm/physics.js).
  phys_static: 0,
  phys_dynamic: 1,
  phys_kinematic: 2,
  // Sound (vm/audio.js): waveforms for sfx_tone, ready-made effects for
  // sfx, and song_track instruments.
  wave_square: 0,
  wave_triangle: 1,
  wave_saw: 2,
  wave_sine: 3,
  wave_noise: 4,
  sfx_coin: 0,
  sfx_laser: 1,
  sfx_explosion: 2,
  sfx_powerup: 3,
  sfx_hit: 4,
  sfx_jump: 5,
  sfx_blip: 6,
  sfx_random: 7,
  inst_square: 0,
  inst_triangle: 1,
  inst_saw: 2,
  inst_sine: 3,
  inst_drums: 4,
  inst_pluck: 5,
  inst_pad: 6,
  inst_bass: 7,
  s_kill: 0,
  s_wakeup: 1,
  s_sleep: 2,
  s_freeze: 3,
  s_kill_tree: 100,
  s_wakeup_tree: 101,
  s_sleep_tree: 102,
  s_freeze_tree: 103,
  // Classic DIV single-argument SET_MODE resolution constants - see
  // VIDEO_MODE_TABLE in runtime.js's setModeNative for the decode.
  // Negative so they can never collide with a legitimate width value
  // passed to the (width, height) two-argument form this engine's own
  // demos already use.
  m320x200: -1,
  m640x480: -2
});
var PROCESS_FIELD_NAMES = Object.freeze([...CANONICAL_LOCAL_SLOTS.keys()]);
var RESERVED_PATH_ROOTS = /* @__PURE__ */ new Set(["scroll", "region", "father", "son", "bigbro", "smallbro", "mouse"]);
function hasSideEffects(expr) {
  if (!expr) {
    return false;
  }
  switch (expr.type) {
    case "call":
    case "assign":
      return true;
    case "binary":
      return hasSideEffects(expr.left) || hasSideEffects(expr.right);
    case "unary":
      return hasSideEffects(expr.operand);
    case "member_access":
      return hasSideEffects(expr.object);
    case "index_access":
      return hasSideEffects(expr.object) || hasSideEffects(expr.index);
    default:
      return false;
  }
}
var Compiler = class {
  constructor() {
    this.constants = [];
    this.constantIndex = /* @__PURE__ */ new Map();
    this.instructions = [];
    this.stringMap = /* @__PURE__ */ new Map();
    this.localMap = /* @__PURE__ */ new Map();
    this.globalMap = /* @__PURE__ */ new Map();
    this.processTable = /* @__PURE__ */ new Map();
    this.functionTable = /* @__PURE__ */ new Map();
    this.loopStack = [];
    this.nextLocalSlot = 0;
    this.nextGlobalSlot = 0;
    this.structMap = /* @__PURE__ */ new Map();
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
    if (node && node.line !== void 0 && node.col !== void 0) {
      return ` at ${node.line}:${node.col}`;
    }
    return "";
  }
  // A DivError located at `node` (when the node carries a position).
  error(message, node) {
    return new DivError(message, {
      stage: "compiler",
      line: node && Number.isInteger(node.line) ? node.line : null,
      col: node && Number.isInteger(node.col) ? node.col : null
    });
  }
  // Compile program
  compile(program) {
    this.constants = [];
    this.constantIndex = /* @__PURE__ */ new Map();
    this.instructions = [];
    this.stringMap = /* @__PURE__ */ new Map();
    this.localMap = /* @__PURE__ */ new Map();
    this.globalMap = /* @__PURE__ */ new Map();
    this.processTable = /* @__PURE__ */ new Map();
    this.functionTable = /* @__PURE__ */ new Map();
    this.loopStack = [];
    this.nextLocalSlot = 0;
    this.nextGlobalSlot = 0;
    this.structMap = /* @__PURE__ */ new Map();
    this.localDecls = program.locals || [];
    for (const func of program.functions) {
      if (this.functionTable.has(func.name)) {
        throw this.error(`Duplicate FUNCTION name: "${func.name}" is declared more than once`, func);
      }
      if (this.processTable.has(func.name)) {
        throw this.error(`"${func.name}" is declared as both a FUNCTION and a PROCESS; pick one name for each`, func);
      }
      this.functionTable.set(func.name, { addr: -1, params: func.params });
    }
    for (const proc of program.processes) {
      if (this.processTable.has(proc.name)) {
        throw this.error(`Duplicate PROCESS name: "${proc.name}" is declared more than once`, proc);
      }
      if (this.functionTable.has(proc.name)) {
        throw this.error(`"${proc.name}" is declared as both a PROCESS and a FUNCTION; pick one name for each`, proc);
      }
      this.processTable.set(proc.name, { addr: -1, params: proc.params, privates: proc.privates, locals: {} });
    }
    for (const global of program.globals) {
      this.compileGlobal(global);
    }
    for (const struct of program.structs || []) {
      this.compileStructDecl(struct);
    }
    this.emit(OpCodes.JUMP, 0);
    const jumpToMain = this.instructions.length - 1;
    for (const func of program.functions) {
      this.compileFunction(func);
    }
    for (const process of program.processes) {
      this.compileProcess(process);
    }
    const mainAddr = this.instructions.length;
    this.instructions[jumpToMain].operands[0] = mainAddr;
    this.resetCanonicalLocals();
    this.declarePrivates(program.mainPrivates);
    this.emitLocalInitializers();
    for (const priv of program.mainPrivates || []) {
      if (priv.size !== void 0) continue;
      if (priv.value) {
        this.compileExpression(priv.value);
        this.emit(OpCodes.STORE_LOCAL, this.localMap.get(priv.name));
      }
    }
    this.compileBlock({ statements: program.mainBlock });
    const mainLocals = Object.fromEntries(this.localMap);
    this.emit(OpCodes.HALT);
    return {
      constants: this.constants,
      instructions: this.instructions,
      processTable: this.processTable,
      functionTable: this.functionTable,
      // Scalar globals only (arrays stored as objects, not useful for slot→name lookup)
      globals: Object.fromEntries(
        [...this.globalMap.entries()].filter(([, v]) => typeof v === "number")
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
  compileGlobal(stmt) {
    if (this.globalMap.has(stmt.name)) {
      throw this.error(`Duplicate GLOBAL name: "${stmt.name}" is declared more than once`, stmt);
    }
    if (CANONICAL_LOCAL_SLOTS.has(stmt.name)) {
      throw this.error(`GLOBAL "${stmt.name}" has the name of a predefined process variable; every process would see its own "${stmt.name}" instead`, stmt);
    }
    if ((this.localDecls || []).some((decl) => decl.name === stmt.name)) {
      throw this.error(`GLOBAL "${stmt.name}" is also declared in the LOCAL section`, stmt);
    }
    if (stmt.size !== void 0) {
      const declared = getConstantNumericValue(stmt.size);
      if (declared === null || declared < 0 || !Number.isInteger(declared)) {
        throw this.error(`GLOBAL array size must be a non-negative integer literal`, stmt);
      }
      const sizeVal = declared + 1;
      const base = this.nextGlobalSlot;
      this.nextGlobalSlot += sizeVal;
      this.globalMap.set(stmt.name, { isArray: true, base, size: sizeVal });
      const init = stmt.initializers || [];
      if (init.length > sizeVal) {
        throw this.error(`GLOBAL "${stmt.name}[${declared}]" has ${sizeVal} cells but ${init.length} initial values`, stmt);
      }
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
      throw this.error(`Duplicate STRUCT name: "${stmt.name}"`, stmt);
    }
    const def = this.buildStructDef(stmt);
    const base = this.nextGlobalSlot;
    this.nextGlobalSlot += def.count * def.instanceSize;
    this.structMap.set(stmt.name, { base, ...def });
    if (stmt.initializers) {
      const total = def.count * def.instanceSize;
      if (stmt.initializers.length > total) {
        throw this.error(`STRUCT "${stmt.name}" has ${total} fields in all but ${stmt.initializers.length} initial values`, stmt);
      }
      for (let s = 0; s < stmt.initializers.length; s++) {
        this.compileExpression(stmt.initializers[s]);
        this.emit(OpCodes.STORE_GLOBAL, base + s);
      }
      this.emitStructDefaults(base, def, 0, stmt.initializers.length);
    } else {
      this.emitStructDefaults(base, def, 0);
    }
  }
  // Recursively build {instanceSize, count, fields} from a StructDecl AST node.
  buildStructDef(stmt) {
    const fields = /* @__PURE__ */ new Map();
    let instanceSize = 0;
    const declaredCount = stmt.count ? getConstantNumericValue(stmt.count) : 0;
    if (stmt.count && (declaredCount === null || declaredCount < 0 || !Number.isInteger(declaredCount))) {
      throw this.error(`STRUCT count must be a non-negative integer literal`, stmt);
    }
    const count = declaredCount + 1;
    for (const f of stmt.fields) {
      if (f.nested) {
        const nestedDef = this.buildStructDef(f.nested);
        const totalSize = nestedDef.count * nestedDef.instanceSize;
        fields.set(f.name, { offset: instanceSize, size: totalSize, isNested: true, nestedDef });
        instanceSize += totalSize;
      } else {
        const declaredFieldSize = f.size ? getConstantNumericValue(f.size) : null;
        const fsize = declaredFieldSize === null ? 1 : declaredFieldSize + 1;
        if (f.size && (declaredFieldSize === null || declaredFieldSize < 0 || !Number.isInteger(declaredFieldSize))) {
          throw this.error(`Struct field array size must be a non-negative integer literal`, stmt);
        }
        fields.set(f.name, { offset: instanceSize, size: fsize ?? 1, isNested: false, defaultValue: f.defaultValue });
        instanceSize += fsize ?? 1;
      }
    }
    return { instanceSize, count: count ?? 1, fields };
  }
  // Emit STORE_GLOBAL for all non-zero default values recursively.
  // Slots below firstUnsetSlot (relative to base) were already set by an
  // initializer list and are skipped.
  emitStructDefaults(base, def, baseOffset, firstUnsetSlot = 0) {
    for (let i = 0; i < def.count; i++) {
      const instOffset = baseOffset + i * def.instanceSize;
      for (const [, f] of def.fields) {
        if (f.isNested) {
          this.emitStructDefaults(base, f.nestedDef, instOffset + f.offset, firstUnsetSlot);
        } else if (f.size === 1 && f.defaultValue && instOffset + f.offset >= firstUnsetSlot) {
          this.compileExpression(f.defaultValue);
          this.emit(OpCodes.STORE_GLOBAL, base + instOffset + f.offset);
        }
      }
    }
  }
  // Compile function
  compileFunction(stmt) {
    const startAddr = this.instructions.length;
    const savedLocals = new Map(this.localMap);
    this.localMap = /* @__PURE__ */ new Map();
    for (let i = 0; i < stmt.params.length; i++) {
      this.localMap.set(stmt.params[i], i);
    }
    this.nextLocalSlot = stmt.params.length;
    this.freeTemps = [];
    this.tempCount = 0;
    this.declarePrivates(stmt.privates, stmt.params, "FUNCTION");
    this.emitPrivateInitializers(stmt.privates);
    this.compileBlock(stmt.body);
    this.emitImplicitReturn(stmt.body);
    const functionLocals = Object.fromEntries(this.localMap);
    this.localMap = savedLocals;
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
    this.localMap = new Map(CANONICAL_LOCAL_SLOTS);
    this.nextLocalSlot = CANONICAL_LOCAL_COUNT;
    for (const decl of this.localDecls || []) {
      if (this.localMap.has(decl.name)) continue;
      if (decl.size !== void 0) {
        const declared = getConstantNumericValue(decl.size);
        if (declared === null || declared < 0 || !Number.isInteger(declared)) {
          throw this.error(`LOCAL array size must be a non-negative integer literal`, decl);
        }
        this.localMap.set(decl.name, { isArray: true, base: this.nextLocalSlot, size: declared + 1 });
        this.nextLocalSlot += declared + 1;
        continue;
      }
      this.localMap.set(decl.name, this.nextLocalSlot++);
    }
    this.freeTemps = [];
    this.tempCount = 0;
  }
  // Runs the LOCAL section's initializers ("LOCAL energy = 10;") at the
  // start of a process or MAIN: in DIV every process owns these variables
  // and the declared value is where each one starts (DIV 2 manual 7.3,
  // "Declaration of a variable"). They were allocated but never
  // initialised, so every process started with 0. A parameter with the
  // same name has already been stored by SPAWN_PROCESS and wins.
  emitLocalInitializers(params = []) {
    for (const decl of this.localDecls || []) {
      if (!decl.value || decl.size !== void 0 || params.includes(decl.name)) {
        continue;
      }
      if (CANONICAL_LOCAL_SLOTS.has(decl.name)) {
        continue;
      }
      this.compileExpression(decl.value);
      this.emit(OpCodes.STORE_LOCAL, this.localMap.get(decl.name));
    }
  }
  // A hidden local for a value that must be evaluated exactly once (the
  // index of a compound-assignment target, an assignment's value used as
  // an expression). Slots are recycled within the body: a temporary only
  // lives for the statement that allocated it. The '@' keeps the name
  // out of reach of any identifier a program can spell.
  allocTemp() {
    if (this.freeTemps.length > 0) {
      return this.freeTemps.pop();
    }
    const name = `@tmp${this.tempCount++}`;
    this.localMap.set(name, this.nextLocalSlot++);
    return name;
  }
  freeTemp(name) {
    this.freeTemps.push(name);
  }
  // Allocates slots for a PRIVATE section. Shared by PROCESS bodies and
  // by MAIN, which in DIV is a process and may declare privates too.
  declarePrivates(privates, params = [], owner = "PROCESS") {
    for (const priv of privates || []) {
      if (params.includes(priv.name)) {
        throw this.error(`PRIVATE "${priv.name}" has the same name as a parameter of this ${owner}`, priv);
      }
      if (this.localMap.has(priv.name)) continue;
      if (priv.size !== void 0) {
        const declared = getConstantNumericValue(priv.size);
        if (declared === null || declared < 0 || !Number.isInteger(declared)) {
          throw this.error(`PRIVATE array size must be a non-negative integer literal`, priv);
        }
        const sizeVal = declared + 1;
        this.localMap.set(priv.name, { isArray: true, base: this.nextLocalSlot, size: sizeVal });
        this.nextLocalSlot += sizeVal;
      } else {
        this.localMap.set(priv.name, this.nextLocalSlot++);
      }
    }
  }
  // Give every scalar PRIVATE its initial value (0 when none is given)
  // at the start of the body. Arrays are left alone: unset slots read 0.
  emitPrivateInitializers(privates) {
    for (const priv of privates || []) {
      if (priv.size !== void 0) {
        continue;
      }
      if (priv.value) {
        this.compileExpression(priv.value);
      } else {
        this.emit(OpCodes.LOAD_CONST, this.addConstant(0));
      }
      this.emit(OpCodes.STORE_LOCAL, this.localMap.get(priv.name));
    }
  }
  // Compile process
  compileProcess(stmt) {
    const startAddr = this.instructions.length;
    this.processTable.set(stmt.name, {
      addr: startAddr,
      params: stmt.params,
      privates: stmt.privates,
      locals: {}
    });
    this.resetCanonicalLocals();
    for (const param of stmt.params) {
      if (!this.localMap.has(param)) {
        this.localMap.set(param, this.nextLocalSlot++);
      }
    }
    this.declarePrivates(stmt.privates, stmt.params);
    this.emitLocalInitializers(stmt.params);
    this.emitPrivateInitializers(stmt.privates);
    this.compileBlock(stmt.body);
    this.emitImplicitReturn(stmt.body);
    this.processTable.set(stmt.name, {
      addr: startAddr,
      params: stmt.params,
      privates: stmt.privates,
      locals: Object.fromEntries(this.localMap.entries())
    });
    return startAddr;
  }
  // Emit a RETURN that always leaves exactly one value on the stack.
  // The VM's RETURN pops one value as the call's result; a value-less
  // RETURN used to pop whatever operand the *caller* had pending instead
  // (`10 - f()` evaluated as `-10`), so a bare `RETURN;` returns 0.
  emitReturn(valueExpr) {
    if (valueExpr) {
      this.compileExpression(valueExpr);
    } else {
      this.emit(OpCodes.LOAD_CONST, this.addConstant(0));
    }
    this.emit(OpCodes.RETURN);
  }
  // Close a FUNCTION/PROCESS body. Only a RETURN as the body's last
  // top-level statement makes the end unreachable; checking the last
  // *emitted* opcode instead was wrong, because a RETURN nested inside
  // an IF/ELSE is also the last instruction emitted while the other
  // path still falls through - straight into the next body's code.
  emitImplicitReturn(body) {
    const statements = body && body.statements ? body.statements : [];
    const last = statements[statements.length - 1];
    if (!last || last.type !== "return") {
      this.emitReturn(null);
    }
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
      case "if":
        this.compileIf(stmt);
        break;
      case "switch":
        this.compileSwitch(stmt);
        break;
      case "for":
        this.compileFor(stmt);
        break;
      case "while":
        this.compileWhile(stmt);
        break;
      case "cfor":
        this.compileCFor(stmt);
        break;
      case "repeat":
        this.compileRepeat(stmt);
        break;
      case "loop":
        this.compileLoop(stmt);
        break;
      case "frame":
        if (stmt.value) {
          this.compileExpression(stmt.value);
          this.emit(OpCodes.FRAME, 1);
        } else {
          this.emit(OpCodes.FRAME, 0);
        }
        break;
      case "var":
        this.compileVar(stmt);
        break;
      case "return":
        this.emitReturn(stmt.value);
        break;
      case "break":
        this.compileBreak(stmt);
        break;
      case "continue":
        this.compileContinue(stmt);
        break;
      case "expression":
        if (stmt.expression.type === "assign") {
          this.compileAssignment(stmt.expression);
        } else {
          this.compileExpression(stmt.expression);
          this.emit(OpCodes.POP);
        }
        break;
      default:
        throw this.error(`Unknown statement type: ${stmt.type}`, stmt);
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
      throw this.error(`BREAK used outside loop`, stmt);
    }
    this.emit(OpCodes.JUMP, 0);
    loopCtx.breakJumps.push(this.instructions.length - 1);
  }
  compileContinue(stmt) {
    const loopCtx = this.currentLoopContext();
    if (!loopCtx) {
      throw this.error(`CONTINUE used outside loop`, stmt);
    }
    this.emit(OpCodes.JUMP, 0);
    loopCtx.continueJumps.push(this.instructions.length - 1);
  }
  // Compile if
  compileIf(stmt) {
    this.compileExpression(stmt.condition);
    this.emit(OpCodes.JUMP_IF_FALSE, 0);
    const jumpToElse = this.instructions.length - 1;
    this.compileBlock(stmt.thenBranch);
    if (stmt.elseBranch) {
      this.emit(OpCodes.JUMP, 0);
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
      const matchJumps = [];
      for (let i = 0; i < switchCase.values.length - 1; i++) {
        this.emit(OpCodes.LOAD_LOCAL, subjectIdx);
        this.compileExpression(switchCase.values[i]);
        this.emit(OpCodes.EQ);
        this.emit(OpCodes.JUMP_IF_TRUE, 0);
        matchJumps.push(this.instructions.length - 1);
      }
      this.emit(OpCodes.LOAD_LOCAL, subjectIdx);
      this.compileExpression(switchCase.values[switchCase.values.length - 1]);
      this.emit(OpCodes.EQ);
      this.emit(OpCodes.JUMP_IF_FALSE, 0);
      nextCaseJump = this.instructions.length - 1;
      const bodyStart = this.instructions.length;
      for (const jumpIdx of matchJumps) {
        this.instructions[jumpIdx].operands[0] = bodyStart;
      }
      this.compileBlock(switchCase.body);
      this.emit(OpCodes.JUMP, 0);
      endJumps.push(this.instructions.length - 1);
    }
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
    let loadOp = OpCodes.LOAD_LOCAL;
    let storeOp = OpCodes.STORE_LOCAL;
    let varIdx = this.localMap.get(stmt.varName);
    if (varIdx === void 0 && this.globalMap.has(stmt.varName)) {
      varIdx = this.globalMap.get(stmt.varName);
      loadOp = OpCodes.LOAD_GLOBAL;
      storeOp = OpCodes.STORE_GLOBAL;
    }
    if (varIdx === void 0) {
      varIdx = this.nextLocalSlot++;
      this.localMap.set(stmt.varName, varIdx);
    } else if (typeof varIdx === "object" && varIdx.isArray) {
      throw this.error(
        `Array "${stmt.varName}" cannot be used as a FOR loop variable`,
        stmt
      );
    }
    const autoDirection = stmt.step === null;
    let constantStepValue;
    if (autoDirection) {
      const startValue = getConstantNumericValue(stmt.start);
      const endValue = getConstantNumericValue(stmt.end);
      constantStepValue = startValue !== null && endValue !== null ? startValue <= endValue ? 1 : -1 : null;
    } else {
      constantStepValue = getConstantNumericValue(stmt.step);
    }
    const isConstantStep = constantStepValue !== null;
    let stepIdx = null;
    let stepVarName = null;
    if (!isConstantStep) {
      this.forDepth = (this.forDepth || 0) + 1;
      const stepVarNameLocal = `__for_step_${this.forDepth}`;
      stepVarName = stepVarNameLocal;
      stepIdx = this.nextLocalSlot++;
      this.localMap.set(stepVarName, stepIdx);
    }
    this.compileExpression(stmt.start);
    this.emit(storeOp, varIdx);
    let endRef = stmt.end;
    let endTemp = null;
    if (getConstantNumericValue(stmt.end) === null) {
      endTemp = this.allocTemp();
      this.compileExpression(stmt.end);
      this.emit(OpCodes.STORE_LOCAL, this.localMap.get(endTemp));
      endRef = { type: "identifier", name: endTemp };
    }
    if (!isConstantStep && autoDirection) {
      this.emit(loadOp, varIdx);
      this.compileExpression(endRef);
      this.emit(OpCodes.LTE);
      this.emit(OpCodes.JUMP_IF_FALSE, 0);
      const jumpToDown = this.instructions.length - 1;
      this.emit(OpCodes.LOAD_CONST, this.addConstant(1));
      this.emit(OpCodes.JUMP, 0);
      const jumpToStore = this.instructions.length - 1;
      this.instructions[jumpToDown].operands[0] = this.instructions.length;
      this.emit(OpCodes.LOAD_CONST, this.addConstant(-1));
      this.instructions[jumpToStore].operands[0] = this.instructions.length;
      this.emit(OpCodes.STORE_LOCAL, stepIdx);
    } else if (!isConstantStep) {
      this.compileExpression(stmt.step);
      this.emit(OpCodes.STORE_LOCAL, stepIdx);
    }
    const loopStart = this.instructions.length;
    if (isConstantStep) {
      this.emit(loadOp, varIdx);
      this.compileExpression(endRef);
      this.emit(constantStepValue >= 0 ? OpCodes.LTE : OpCodes.GTE);
      this.emit(OpCodes.JUMP_IF_FALSE, 0);
    } else {
      const iRef = { type: "identifier", name: stmt.varName };
      const stepRef = { type: "identifier", name: stepVarName };
      const zero = { type: "number", value: 0 };
      const continueExpr = {
        type: "binary",
        operator: "||",
        left: {
          type: "binary",
          operator: "&&",
          left: { type: "binary", operator: ">=", left: stepRef, right: zero },
          right: { type: "binary", operator: "<=", left: iRef, right: endRef }
        },
        right: {
          type: "binary",
          operator: "&&",
          left: { type: "binary", operator: "<", left: stepRef, right: zero },
          right: { type: "binary", operator: ">=", left: iRef, right: endRef }
        }
      };
      this.compileExpression(continueExpr);
      this.emit(OpCodes.JUMP_IF_FALSE, 0);
    }
    const jumpToEnd = this.instructions.length - 1;
    const loopCtx = this.beginLoopContext();
    this.compileBlock(stmt.body);
    const continueTarget = this.instructions.length;
    this.emit(loadOp, varIdx);
    if (isConstantStep) {
      this.emit(OpCodes.LOAD_CONST, this.addConstant(constantStepValue));
    } else {
      this.emit(OpCodes.LOAD_LOCAL, stepIdx);
    }
    this.emit(OpCodes.ADD);
    this.emit(storeOp, varIdx);
    this.emit(OpCodes.LOOP, loopStart);
    const loopEnd = this.instructions.length;
    this.instructions[jumpToEnd].operands[0] = loopEnd;
    this.patchLoopJumps(loopCtx, continueTarget, loopEnd);
    this.endLoopContext();
    if (endTemp !== null) {
      this.freeTemp(endTemp);
    }
  }
  // Compile while
  compileWhile(stmt) {
    const loopStart = this.instructions.length;
    this.compileExpression(stmt.condition);
    this.emit(OpCodes.JUMP_IF_FALSE, 0);
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
      this.emit(OpCodes.JUMP_IF_FALSE, 0);
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
    if (expr.type === "assign") {
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
    if (idx === void 0) {
      idx = this.nextLocalSlot;
      this.nextLocalSlot += 1;
      this.localMap.set(stmt.name, idx);
    }
    this.compileExpression(stmt.value);
    this.emit(OpCodes.STORE_LOCAL, idx);
  }
  // Compile assignment
  compileAssignment(stmt) {
    if (stmt.operator) {
      this.compileCompoundAssignment(stmt, false);
      return;
    }
    if (stmt.target.type === "identifier") {
      const name = stmt.target.name;
      if (this.localMap.has(name)) {
        const entry = this.localMap.get(name);
        if (typeof entry === "object" && entry.isArray) {
          throw this.error(`Array "${name}" must be assigned with an index: ${name}[i] = v`, stmt);
        }
        this.compileExpression(stmt.value);
        this.emit(OpCodes.STORE_LOCAL, entry);
      } else if (this.globalMap.has(name)) {
        const entry = this.globalMap.get(name);
        if (typeof entry === "object" && entry.isArray) {
          throw this.error(`Array "${name}" must be assigned with an index: ${name}[i] = v`, stmt);
        }
        this.compileExpression(stmt.value);
        this.emit(OpCodes.STORE_GLOBAL, entry);
      } else {
        const idx = this.nextLocalSlot;
        this.nextLocalSlot += 1;
        this.localMap.set(name, idx);
        this.compileExpression(stmt.value);
        this.emit(OpCodes.STORE_LOCAL, idx);
      }
      return;
    }
    if (stmt.target.type === "member_access" || stmt.target.type === "index_access") {
      if (this.tryCompileMouseAssign(stmt.target, stmt.value)) {
        return;
      }
      this.compilePathSet(stmt.target, stmt.value);
      return;
    }
    throw this.error(`Invalid assignment target: ${stmt.target.type}`, stmt);
  }
  // Evaluates, into hidden temporaries, the index expressions of an
  // assignment target that must not run twice, and returns the target
  // rewritten to read those temporaries. An index is spilled when it has
  // side effects itself, or when `force` is set (the value about to be
  // computed has side effects that could change what the index reads);
  // otherwise evaluating it twice is unobservable and it stays inline.
  // Indices are spilled in source order, outermost first, which is the
  // order compilePathSet evaluates them in.
  spillTargetIndices(target, force, temps) {
    if (target.type === "index_access") {
      const object = this.spillTargetIndices(target.object, force, temps);
      let index = target.index;
      const alreadySpilled = index.type === "identifier" && index.name.startsWith("@tmp");
      if (!alreadySpilled && getConstantNumericValue(index) === null && (force || hasSideEffects(index))) {
        const temp = this.allocTemp();
        temps.push(temp);
        this.compileExpression(index);
        this.emit(OpCodes.STORE_LOCAL, this.localMap.get(temp));
        index = { type: "identifier", name: temp, line: index.line, col: index.col };
      }
      return { ...target, object, index };
    }
    if (target.type === "member_access") {
      return { ...target, object: this.spillTargetIndices(target.object, force, temps) };
    }
    return target;
  }
  // "t op= v" (and "t++"/"t--", which the parser turns into "t += 1").
  // It used to be desugared to "t = t op v", which evaluated t's index
  // twice: "a[k()] += 1" called k() twice and read one cell but wrote
  // another. The index is now evaluated once (see spillTargetIndices).
  // With keepValue the assigned value is also left on the stack.
  compileCompoundAssignment(stmt, keepValue) {
    const temps = [];
    const target = this.spillTargetIndices(stmt.target, hasSideEffects(stmt.value), temps);
    const value = {
      type: "binary",
      operator: stmt.operator,
      left: target,
      right: stmt.value,
      line: stmt.line,
      col: stmt.col
    };
    const plain = { type: "assign", target, value, line: stmt.line, col: stmt.col };
    if (keepValue) {
      this.compileAssignmentAsExpression(plain);
    } else {
      this.compileAssignment(plain);
    }
    for (const temp of temps) {
      this.freeTemp(temp);
    }
  }
  // Assignment in expression position: perform the store, then leave the
  // assigned value on the stack for the enclosing expression to consume
  // ("assignments ... return the value they have assigned", DIV 2 manual,
  // operator priorities). A plain variable is simply re-read. A field or
  // element target used to be re-read too, which evaluated its index a
  // second time ("r = (a[k()] = 9)" read a different cell) and returned
  // whatever the runtime reads back from paths like son.x or mouse.x;
  // the value now goes through a temporary and the index is evaluated
  // once.
  compileAssignmentAsExpression(expr) {
    if (expr.operator) {
      this.compileCompoundAssignment(expr, true);
      return;
    }
    if (expr.target.type === "identifier") {
      this.compileAssignment(expr);
      this.compileIdentifier(expr.target);
      return;
    }
    if (expr.target.type === "member_access" || expr.target.type === "index_access") {
      const temps = [];
      const target = this.spillTargetIndices(expr.target, hasSideEffects(expr.value), temps);
      const valueTemp = this.allocTemp();
      temps.push(valueTemp);
      this.compileExpression(expr.value);
      this.emit(OpCodes.STORE_LOCAL, this.localMap.get(valueTemp));
      const valueRef = { type: "identifier", name: valueTemp, line: expr.line, col: expr.col };
      this.compileAssignment({ type: "assign", target, value: valueRef, line: expr.line, col: expr.col });
      this.emit(OpCodes.LOAD_LOCAL, this.localMap.get(valueTemp));
      for (const temp of temps) {
        this.freeTemp(temp);
      }
      return;
    }
    throw this.error(`Invalid assignment target: ${expr.target.type}`, expr);
  }
  // Compile expression
  compileExpression(expr) {
    switch (expr.type) {
      case "number":
        this.emit(OpCodes.LOAD_CONST, this.addConstant(expr.value));
        break;
      case "string":
        this.emit(OpCodes.LOAD_CONST, this.addConstant(expr.value));
        break;
      case "identifier":
        this.compileIdentifier(expr);
        break;
      case "binary":
        this.compileBinary(expr);
        break;
      case "unary":
        this.compileUnary(expr);
        break;
      case "call":
        this.compileCall(expr);
        break;
      case "type_operator":
        this.emit(OpCodes.LOAD_CONST, this.addConstant(processTypeCode(expr.processName)));
        break;
      case "offset_operator":
        this.compileOffsetOperator(expr);
        break;
      case "member_access":
      case "index_access":
        if (!this.tryCompileMouseAccess(expr)) {
          this.compilePathGet(expr);
        }
        break;
      case "assign":
        this.compileAssignmentAsExpression(expr);
        break;
      default:
        throw this.error(`Unknown expression type: ${expr.type}`, expr);
    }
  }
  // Compile identifier
  compileIdentifier(expr) {
    const name = expr.name;
    const nameLower = name.toLowerCase();
    if (this.localMap.has(name)) {
      const entry = this.localMap.get(name);
      if (typeof entry === "object" && entry.isArray) {
        throw this.error(`Array "${name}" must be accessed with an index: ${name}[i]`, expr);
      }
      this.emit(OpCodes.LOAD_LOCAL, entry);
    } else if (this.globalMap.has(name)) {
      const entry = this.globalMap.get(name);
      if (typeof entry === "object" && entry.isArray) {
        throw this.error(`Array "${name}" must be accessed with an index: ${name}[i]`, expr);
      }
      this.emit(OpCodes.LOAD_GLOBAL, entry);
    } else if (Object.prototype.hasOwnProperty.call(BUILTIN_CONSTANTS, nameLower)) {
      this.emit(OpCodes.LOAD_CONST, this.addConstant(BUILTIN_CONSTANTS[nameLower]));
    } else if (nameLower === "fps") {
      this.emit(OpCodes.CALL_NATIVE, "get_fps", 0);
    } else if (nameLower === "father" || nameLower === "son" || nameLower === "bigbro" || nameLower === "smallbro") {
      this.emit(OpCodes.LOAD_CONST, this.addConstant(nameLower));
      this.emit(OpCodes.CALL_NATIVE, "__get_path", 1);
    } else {
      throw this.error(`Unknown variable: ${name}`, expr);
    }
  }
  // OFFSET <variable> - pushes a live reference to the variable (not its
  // current value), which natives resolve when they need it: write_int
  // re-reads it every frame it draws, get_real_point/get_point write
  // through it. A GLOBAL is a constant descriptor. A local (PRIVATE,
  // LOCAL, a parameter, a process field, a FUNCTION's own variable) is
  // made at run time by __offset_local, which captures the locals of
  // whichever process or call is running - the manual gives OFFSET for
  // any datum; it used to be refused for everything but GLOBALs, so DIV
  // code doing get_real_point(0, OFFSET my_x, OFFSET my_y) did not
  // compile. Whole arrays aren't supported (DIV's pointer arithmetic on
  // offsets has no equivalent here).
  compileOffsetOperator(expr) {
    const name = expr.name;
    const local = this.localMap.get(name);
    if (local !== void 0) {
      if (typeof local === "object" && local.isArray) {
        throw this.error(`OFFSET "${name}" - arrays aren't supported`, expr);
      }
      this.emit(OpCodes.LOAD_CONST, this.addConstant(local));
      this.emit(OpCodes.CALL_NATIVE, "__offset_local", 1);
      return;
    }
    if (!this.globalMap.has(name)) {
      throw this.error(`OFFSET "${name}" - no such variable`, expr);
    }
    const entry = this.globalMap.get(name);
    if (typeof entry === "object" && entry.isArray) {
      throw this.error(`OFFSET "${name}" - arrays aren't supported`, expr);
    }
    this.emit(OpCodes.LOAD_CONST, this.addConstant({ __divOffsetGlobal: true, slot: entry }));
  }
  // Compile binary
  compileBinary(expr) {
    if (expr.operator === "&&") {
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
    if (expr.operator === "||") {
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
      case "+":
        this.emit(OpCodes.ADD);
        break;
      case "-":
        this.emit(OpCodes.SUB);
        break;
      case "*":
        this.emit(OpCodes.MUL);
        break;
      case "/":
        this.emit(OpCodes.DIV);
        break;
      case "%":
        this.emit(OpCodes.MOD);
        break;
      case "==":
        this.emit(OpCodes.EQ);
        break;
      case "!=":
        this.emit(OpCodes.NEQ);
        break;
      case "<":
        this.emit(OpCodes.LT);
        break;
      case "<=":
        this.emit(OpCodes.LTE);
        break;
      case ">":
        this.emit(OpCodes.GT);
        break;
      case ">=":
        this.emit(OpCodes.GTE);
        break;
      default:
        throw this.error(`Unknown binary operator: ${expr.operator}`, expr);
    }
  }
  // Compile unary
  compileUnary(expr) {
    this.compileExpression(expr.operand);
    switch (expr.operator) {
      case "-":
        this.emit(OpCodes.NEG);
        break;
      case "!":
        this.emit(OpCodes.NOT);
        break;
      default:
        throw this.error(`Unknown unary operator: ${expr.operator}`, expr);
    }
  }
  // Compile call
  compileCall(expr) {
    if (expr.callee.type !== "identifier") {
      throw this.error(`Cannot call a non-identifier expression`, expr);
    }
    const name = expr.callee.name;
    const argc = expr.args.length;
    const processInfo = this.processTable.get(name);
    if (processInfo && argc !== processInfo.params.length) {
      throw this.error(
        `PROCESS "${name}" expects ${processInfo.params.length} argument(s), got ${argc}`,
        expr
      );
    }
    const functionInfo = !processInfo ? this.functionTable.get(name) : void 0;
    if (functionInfo && argc !== functionInfo.params.length) {
      throw this.error(
        `FUNCTION "${name}" expects ${functionInfo.params.length} argument(s), got ${argc}`,
        expr
      );
    }
    for (const arg of expr.args) {
      this.compileExpression(arg);
    }
    if (processInfo) {
      this.emit(OpCodes.SPAWN_PROCESS, name, argc);
    } else if (functionInfo) {
      this.emit(OpCodes.CALL, name, argc);
    } else {
      this.emit(OpCodes.CALL_NATIVE, name, argc);
    }
  }
  collectPath(expr) {
    const segments = [];
    let current = expr;
    while (current.type === "member_access" || current.type === "index_access") {
      if (current.type === "member_access") {
        segments.unshift({ kind: "prop", value: current.property });
        current = current.object;
        continue;
      }
      segments.unshift({ kind: "index", value: current.index });
      current = current.object;
    }
    if (current.type !== "identifier") {
      throw this.error(`Unsupported access target`, current);
    }
    return {
      root: current.name,
      segments,
      node: expr
      // the whole access expression, for error locations
    };
  }
  // Matches struct access patterns and emits the index computation.
  // Works for arbitrary nesting depth. For dynamic cases the computed
  // offset is left on the stack as a side-effect before returning.
  compileStructIndex(path) {
    const st2 = this.structMap.get(path.root);
    if (!st2) return { handled: false };
    const terms = [];
    let currentFields = st2.fields;
    let currentInstanceSize = st2.instanceSize;
    const segs = path.segments;
    let i = 0;
    while (i < segs.length) {
      const seg = segs[i];
      if (seg.kind === "index") {
        terms.push({ kind: "dyn", expr: seg.value, mult: currentInstanceSize });
        i++;
      } else {
        const f = currentFields.get(seg.value);
        if (!f) throw this.error(`Unknown struct field "${path.root}...${seg.value}"`, path.node);
        if (f.offset > 0) terms.push({ kind: "const", v: f.offset });
        if (f.isNested) {
          currentFields = f.nestedDef.fields;
          currentInstanceSize = f.nestedDef.instanceSize;
          i++;
        } else if (f.size > 1) {
          if (i + 1 < segs.length && segs[i + 1].kind === "index") {
            terms.push({ kind: "dyn", expr: segs[i + 1].value, mult: 1 });
            i += 2;
          } else {
            throw this.error(`Array field "${seg.value}" requires index [j]`, path.node);
          }
          if (i < segs.length) {
            throw this.error(`Struct field "${seg.value}" is an array of plain values; nothing can follow ${seg.value}[j]`, path.node);
          }
        } else {
          if (i + 1 < segs.length) {
            throw this.error(`Struct field "${seg.value}" is not an array or a STRUCT and can't be indexed or have fields`, path.node);
          }
          i++;
        }
      }
    }
    if (terms.every((t) => t.kind === "const")) {
      const offset = terms.reduce((s, t) => s + t.v, 0);
      return { handled: true, isStatic: true, slot: st2.base + offset };
    }
    const staticTotal = terms.filter((t) => t.kind === "const").reduce((s, t) => s + t.v, 0);
    const dynTerms = terms.filter((t) => t.kind === "dyn");
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
    return { handled: true, isStatic: false, base: st2.base, totalSize: st2.count * st2.instanceSize };
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
      throw this.error(
        `Array index out of bounds: "${arrayName}[${constIndex}]" - "${arrayName}" was declared with size ${size}, valid indices are 0..${size - 1}.`,
        indexExpr
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
    if (expr.type !== "member_access") {
      return false;
    }
    const obj = expr.object;
    if (!obj || obj.type !== "identifier" || obj.name.toLowerCase() !== "mouse") {
      return false;
    }
    if (this.localMap.has(obj.name) || this.globalMap.has(obj.name)) {
      return false;
    }
    const mouseFields = {
      x: { native: "mouse_x", args: [] },
      y: { native: "mouse_y", args: [] },
      left: { native: "mouse_button", args: [0] },
      // Same numbering as mouse_button (0 left, 1 middle, 2 right).
      middle: { native: "mouse_button", args: [1] },
      right: { native: "mouse_button", args: [2] },
      button: { native: "mouse_button", args: [0] }
    };
    const field = mouseFields[String(expr.property).toLowerCase()];
    if (field) {
      for (const value of field.args) {
        this.emit(OpCodes.LOAD_CONST, this.addConstant(value));
      }
      this.emit(OpCodes.CALL_NATIVE, field.native, field.args.length);
      return true;
    }
    this.emit(OpCodes.LOAD_CONST, this.addConstant(String(expr.property)));
    this.emit(OpCodes.CALL_NATIVE, "__get_mouse_field", 1);
    return true;
  }
  // Write half: "mouse.graph = 999".
  tryCompileMouseAssign(targetExpr, valueExpr) {
    if (targetExpr.type !== "member_access") {
      return false;
    }
    const obj = targetExpr.object;
    if (!obj || obj.type !== "identifier" || obj.name.toLowerCase() !== "mouse") {
      return false;
    }
    if (this.localMap.has(obj.name) || this.globalMap.has(obj.name)) {
      return false;
    }
    this.emit(OpCodes.LOAD_CONST, this.addConstant(String(targetExpr.property)));
    this.compileExpression(valueExpr);
    this.emit(OpCodes.CALL_NATIVE, "__set_mouse_field", 2);
    this.emit(OpCodes.POP);
    return true;
  }
  compilePathGet(expr) {
    const path = this.collectPath(expr);
    if (path.segments.length === 1 && path.segments[0].kind === "index") {
      const localEntry = this.localMap.get(path.root);
      if (localEntry && typeof localEntry === "object" && localEntry.isArray) {
        this.checkConstantArrayIndex(path.root, path.segments[0].value, localEntry.size);
        this.compileExpression(path.segments[0].value);
        this.emit(OpCodes.LOAD_LOCAL_IDX, localEntry.base, localEntry.size);
        return;
      }
      const globalEntry = this.globalMap.get(path.root);
      if (globalEntry && typeof globalEntry === "object" && globalEntry.isArray) {
        this.checkConstantArrayIndex(path.root, path.segments[0].value, globalEntry.size);
        this.compileExpression(path.segments[0].value);
        this.emit(OpCodes.LOAD_GLOBAL_IDX, globalEntry.base, globalEntry.size);
        return;
      }
    }
    const sr2 = this.compileStructIndex(path);
    if (sr2.handled) {
      if (sr2.isStatic) {
        this.emit(OpCodes.LOAD_GLOBAL, sr2.slot);
      } else {
        this.emit(OpCodes.LOAD_GLOBAL_IDX, sr2.base, sr2.totalSize);
      }
      return;
    }
    if (this.isProcessRefRoot(path)) {
      this.compileIdentifier({ type: "identifier", name: path.root });
      this.emit(OpCodes.LOAD_CONST, this.addConstant(path.segments[0].value));
      this.emit(OpCodes.CALL_NATIVE, "__get_process_field", 2);
      return;
    }
    this.checkGenericPathRoot(path);
    this.emit(OpCodes.LOAD_CONST, this.addConstant(path.root));
    for (const segment of path.segments) {
      if (segment.kind === "prop") {
        this.emit(OpCodes.LOAD_CONST, this.addConstant(segment.value));
      } else {
        this.compileExpression(segment.value);
      }
    }
    this.emit(OpCodes.CALL_NATIVE, "__get_path", 1 + path.segments.length);
  }
  // True for "<declared scalar>.<field>" - a single property segment off
  // a plain local/global (not an array, not a struct, not one of the
  // runtime's own special roots like scroll/region/father/son, all of
  // which are handled earlier or by __get_path). That shape is DIV's
  // cross-process field access, where the variable holds a process id.
  isProcessRefRoot(path) {
    if (path.segments.length !== 1 || path.segments[0].kind !== "prop") {
      return false;
    }
    if (RESERVED_PATH_ROOTS.has(String(path.root).toLowerCase())) {
      return false;
    }
    const entry = this.localMap.has(path.root) ? this.localMap.get(path.root) : this.globalMap.has(path.root) ? this.globalMap.get(path.root) : void 0;
    if (entry === void 0) {
      return false;
    }
    return typeof entry !== "object";
  }
  // Only the runtime's own roots (RESERVED_PATH_ROOTS) may reach the
  // generic __get_path/__set_path natives. Anything else there is a
  // mistake - an undeclared name ("foo[3] = 5"), a second index on a
  // one-dimensional array ("a[1][0]"), a field off an array - that used
  // to compile silently and read back 0 at runtime.
  checkGenericPathRoot(path) {
    if (RESERVED_PATH_ROOTS.has(path.root)) {
      return;
    }
    const declared = this.localMap.has(path.root) || this.globalMap.has(path.root) || this.structMap.has(path.root);
    if (!declared) {
      throw this.error(`Unknown variable: ${path.root}`, path.node);
    }
    throw this.error(`"${path.root}" is not declared with this shape (not a STRUCT, and not an array with one index)`, path.node);
  }
  compilePathSet(targetExpr, valueExpr) {
    const path = this.collectPath(targetExpr);
    if (path.segments.length === 1 && path.segments[0].kind === "index") {
      const localEntry = this.localMap.get(path.root);
      if (localEntry && typeof localEntry === "object" && localEntry.isArray) {
        this.checkConstantArrayIndex(path.root, path.segments[0].value, localEntry.size);
        this.compileExpression(path.segments[0].value);
        this.compileExpression(valueExpr);
        this.emit(OpCodes.STORE_LOCAL_IDX, localEntry.base, localEntry.size);
        return;
      }
      const globalEntry = this.globalMap.get(path.root);
      if (globalEntry && typeof globalEntry === "object" && globalEntry.isArray) {
        this.checkConstantArrayIndex(path.root, path.segments[0].value, globalEntry.size);
        this.compileExpression(path.segments[0].value);
        this.compileExpression(valueExpr);
        this.emit(OpCodes.STORE_GLOBAL_IDX, globalEntry.base, globalEntry.size);
        return;
      }
    }
    const sr2 = this.compileStructIndex(path);
    if (sr2.handled) {
      if (sr2.isStatic) {
        this.compileExpression(valueExpr);
        this.emit(OpCodes.STORE_GLOBAL, sr2.slot);
      } else {
        this.compileExpression(valueExpr);
        this.emit(OpCodes.STORE_GLOBAL_IDX, sr2.base, sr2.totalSize);
      }
      return;
    }
    if (this.isProcessRefRoot(path)) {
      this.compileIdentifier({ type: "identifier", name: path.root });
      this.emit(OpCodes.LOAD_CONST, this.addConstant(path.segments[0].value));
      this.compileExpression(valueExpr);
      this.emit(OpCodes.CALL_NATIVE, "__set_process_field", 3);
      this.emit(OpCodes.POP);
      return;
    }
    this.checkGenericPathRoot(path);
    this.emit(OpCodes.LOAD_CONST, this.addConstant(path.root));
    for (const segment of path.segments) {
      if (segment.kind === "prop") {
        this.emit(OpCodes.LOAD_CONST, this.addConstant(segment.value));
      } else {
        this.compileExpression(segment.value);
      }
    }
    this.compileExpression(valueExpr);
    this.emit(OpCodes.CALL_NATIVE, "__set_path", 2 + path.segments.length);
    this.emit(OpCodes.POP);
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
      this.constantIndex = /* @__PURE__ */ new Map();
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
};

// vm/process.js
var DIV_ANGLE_TO_RAD = Math.PI / 18e4;
function toRadians(divAngle) {
  return (Number(divAngle) || 0) * DIV_ANGLE_TO_RAD;
}
function resolvePivot(process) {
  const resolver = process.manager ? process.manager.pivotResolver : null;
  return typeof resolver === "function" ? resolver(process) : null;
}
function getFrame(process, x2 = process.x, y = process.y) {
  const pivot = resolvePivot(process);
  const w = Number(process.width) || 0;
  const h = Number(process.height) || 0;
  const res = typeof process.getResolution === "function" ? process.getResolution() : 1;
  const sizeRaw = Number(process.size);
  const scale = Number.isFinite(sizeRaw) ? Math.max(0, sizeRaw) / 100 : 1;
  const flags = Number(process.flags) || 0;
  const a2 = -toRadians(process.angle);
  return {
    ox: (Number(x2) || 0) / res,
    oy: (Number(y) || 0) / res,
    w,
    h,
    pivotX: pivot ? Number(pivot.x) || 0 : w * 0.5,
    pivotY: pivot ? Number(pivot.y) || 0 : h * 0.5,
    scale,
    // Same flag values as runtime.js's isMirrorX/isMirrorY.
    mirrorX: flags === 1 || flags === 3 || flags === 5 || flags === 7,
    mirrorY: flags === 2 || flags === 3 || flags === 6 || flags === 7,
    cos: Math.cos(a2),
    sin: Math.sin(a2)
  };
}
function frameToWorld(frame, lx, ly) {
  let dx = ((Number(lx) || 0) - frame.pivotX) * frame.scale;
  let dy = ((Number(ly) || 0) - frame.pivotY) * frame.scale;
  if (frame.mirrorX) dx = -dx;
  if (frame.mirrorY) dy = -dy;
  return {
    x: frame.ox + dx * frame.cos - dy * frame.sin,
    y: frame.oy + dx * frame.sin + dy * frame.cos
  };
}
function getCenter(process, x2 = process.x, y = process.y) {
  const frame = getFrame(process, x2, y);
  const c = frameToWorld(frame, frame.w * 0.5, frame.h * 0.5);
  return { cx: c.x, cy: c.y, w: frame.w * frame.scale, h: frame.h * frame.scale };
}
function getCorners(process, x2 = process.x, y = process.y) {
  const frame = getFrame(process, x2, y);
  return [
    frameToWorld(frame, 0, 0),
    frameToWorld(frame, frame.w, 0),
    frameToWorld(frame, frame.w, frame.h),
    frameToWorld(frame, 0, frame.h)
  ];
}
function getAABBFromCorners(corners) {
  let minX = corners[0].x;
  let maxX = corners[0].x;
  let minY = corners[0].y;
  let maxY = corners[0].y;
  for (let i = 1; i < corners.length; i++) {
    const p = corners[i];
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, maxX, minY, maxY };
}
function aabbOverlap(a2, b) {
  return !(a2.maxX <= b.minX || a2.minX >= b.maxX || a2.maxY <= b.minY || a2.minY >= b.maxY);
}
function dot(ax, ay, bx, by) {
  return ax * bx + ay * by;
}
function normalize(x2, y) {
  const len = Math.hypot(x2, y);
  if (len <= 1e-9) return { x: 1, y: 0 };
  return { x: x2 / len, y: y / len };
}
function projectCorners(corners, axisX, axisY) {
  let min = dot(corners[0].x, corners[0].y, axisX, axisY);
  let max = min;
  for (let i = 1; i < corners.length; i++) {
    const p = dot(corners[i].x, corners[i].y, axisX, axisY);
    if (p < min) min = p;
    if (p > max) max = p;
  }
  return { min, max };
}
function satBoxBox(cornersA, cornersB) {
  const edges = [
    { x: cornersA[1].x - cornersA[0].x, y: cornersA[1].y - cornersA[0].y },
    { x: cornersA[3].x - cornersA[0].x, y: cornersA[3].y - cornersA[0].y },
    { x: cornersB[1].x - cornersB[0].x, y: cornersB[1].y - cornersB[0].y },
    { x: cornersB[3].x - cornersB[0].x, y: cornersB[3].y - cornersB[0].y }
  ];
  let bestOverlap = Number.POSITIVE_INFINITY;
  let bestAxis = { x: 1, y: 0 };
  let bestDir = 1;
  for (const e of edges) {
    const axis = normalize(-e.y, e.x);
    const pa = projectCorners(cornersA, axis.x, axis.y);
    const pb = projectCorners(cornersB, axis.x, axis.y);
    const pushBack = pa.max - pb.min;
    const pushForward = pb.max - pa.min;
    if (pushBack <= 0 || pushForward <= 0) {
      return { hit: false, mtvX: 0, mtvY: 0 };
    }
    const ov = Math.min(pushBack, pushForward);
    if (ov < bestOverlap) {
      bestOverlap = ov;
      bestAxis = axis;
      bestDir = pushBack < pushForward ? -1 : 1;
    }
  }
  return {
    hit: true,
    mtvX: bestAxis.x * bestOverlap * bestDir,
    mtvY: bestAxis.y * bestOverlap * bestDir
  };
}
function getCircleRadius(process, width, height) {
  const explicit = Number(process.collisionRadius);
  if (Number.isFinite(explicit) && explicit > 0) {
    return explicit;
  }
  const scaleRaw = Number(process.collisionScale);
  const scale = Number.isFinite(scaleRaw) && scaleRaw > 0 ? scaleRaw : 1;
  const fallback = Math.max(1, Math.min(Number(width) || 0, Number(height) || 0) * 0.5 * scale);
  return fallback;
}
function localToWorld(process, px, py, lx, ly) {
  return frameToWorld(getFrame(process, px, py), lx, ly);
}
function cboxToShape(process, cbox, px = process.x, py = process.y) {
  const shape = cbox?.shape === "circle" ? "circle" : "box";
  const code = Number(cbox?.code);
  if (shape === "circle") {
    const center = localToWorld(process, px, py, Number(cbox.x) || 0, Number(cbox.y) || 0);
    const sizeRaw = Number(process.size);
    const scale = Number.isFinite(sizeRaw) ? Math.max(0, sizeRaw) / 100 : 1;
    const radius = Math.max(1, Number(cbox.radius) || 1) * scale;
    return {
      shape,
      code: Number.isInteger(code) ? code : -1,
      cx: center.x,
      cy: center.y,
      r: radius,
      aabb: {
        minX: center.x - radius,
        maxX: center.x + radius,
        minY: center.y - radius,
        maxY: center.y + radius
      }
    };
  }
  const x2 = Number(cbox?.x) || 0;
  const y = Number(cbox?.y) || 0;
  const w = Math.max(1, Number(cbox?.width) || 1);
  const h = Math.max(1, Number(cbox?.height) || 1);
  const corners = [
    localToWorld(process, px, py, x2, y),
    localToWorld(process, px, py, x2 + w, y),
    localToWorld(process, px, py, x2 + w, y + h),
    localToWorld(process, px, py, x2, y + h)
  ];
  return {
    shape,
    code: Number.isInteger(code) ? code : -1,
    corners,
    aabb: getAABBFromCorners(corners)
  };
}
function getDefaultShapes(process, px = process.x, py = process.y, preferCircle = false) {
  if (preferCircle || process.collisionShape === "circle") {
    const center = getCenter(process, px, py);
    const r = getCircleRadius(process, center.w, center.h);
    return [{
      shape: "circle",
      code: -1,
      cx: center.cx,
      cy: center.cy,
      r,
      aabb: { minX: center.cx - r, maxX: center.cx + r, minY: center.cy - r, maxY: center.cy + r }
    }];
  }
  const corners = getCorners(process, px, py);
  return [{
    shape: "box",
    code: -1,
    corners,
    aabb: getAABBFromCorners(corners)
  }];
}
function getProcessShapes(process, px = process.x, py = process.y, preferCircle = false) {
  if (Array.isArray(process.cboxes) && process.cboxes.length > 0) {
    return process.cboxes.map((c) => cboxToShape(process, c, px, py));
  }
  return getDefaultShapes(process, px, py, preferCircle);
}
function circleCircleShapes(a2, b) {
  const dx = a2.cx - b.cx;
  const dy = a2.cy - b.cy;
  const dist = Math.hypot(dx, dy);
  const sum = a2.r + b.r;
  if (dist >= sum) return { hit: false, mtvX: 0, mtvY: 0 };
  const n = dist <= 1e-9 ? { x: 1, y: 0 } : { x: dx / dist, y: dy / dist };
  const pen = sum - dist;
  return { hit: true, mtvX: n.x * pen, mtvY: n.y * pen };
}
function boxCircleShapes(boxShape, circleShape) {
  const centerX = (boxShape.corners[0].x + boxShape.corners[2].x) * 0.5;
  const centerY = (boxShape.corners[0].y + boxShape.corners[2].y) * 0.5;
  const ex = normalize(boxShape.corners[1].x - boxShape.corners[0].x, boxShape.corners[1].y - boxShape.corners[0].y);
  const ey = normalize(boxShape.corners[3].x - boxShape.corners[0].x, boxShape.corners[3].y - boxShape.corners[0].y);
  const hw = Math.hypot(boxShape.corners[1].x - boxShape.corners[0].x, boxShape.corners[1].y - boxShape.corners[0].y) * 0.5;
  const hh = Math.hypot(boxShape.corners[3].x - boxShape.corners[0].x, boxShape.corners[3].y - boxShape.corners[0].y) * 0.5;
  const relX = circleShape.cx - centerX;
  const relY = circleShape.cy - centerY;
  const lx = dot(relX, relY, ex.x, ex.y);
  const ly = dot(relX, relY, ey.x, ey.y);
  const r = circleShape.r;
  let nx;
  let ny;
  let pen;
  if (Math.abs(lx) <= hw && Math.abs(ly) <= hh) {
    const exitX = hw - Math.abs(lx);
    const exitY = hh - Math.abs(ly);
    if (exitX <= exitY) {
      nx = lx >= 0 ? 1 : -1;
      ny = 0;
      pen = exitX + r;
    } else {
      nx = 0;
      ny = ly >= 0 ? 1 : -1;
      pen = exitY + r;
    }
  } else {
    const qx = Math.max(-hw, Math.min(hw, lx));
    const qy = Math.max(-hh, Math.min(hh, ly));
    const dx = lx - qx;
    const dy = ly - qy;
    const d2 = dx * dx + dy * dy;
    if (d2 >= r * r) {
      return { hit: false, mtvX: 0, mtvY: 0 };
    }
    const dist = Math.sqrt(d2);
    nx = dx / dist;
    ny = dy / dist;
    pen = r - dist;
  }
  const wx = ex.x * nx + ey.x * ny;
  const wy = ex.y * nx + ey.y * ny;
  return { hit: true, mtvX: -wx * pen, mtvY: -wy * pen };
}
function collideShapePair(shapeA, shapeB) {
  if (!aabbOverlap(shapeA.aabb, shapeB.aabb)) {
    return { hit: false, mtvX: 0, mtvY: 0 };
  }
  if (shapeA.shape === "box" && shapeB.shape === "box") {
    return satBoxBox(shapeA.corners, shapeB.corners);
  }
  if (shapeA.shape === "circle" && shapeB.shape === "circle") {
    return circleCircleShapes(shapeA, shapeB);
  }
  if (shapeA.shape === "box" && shapeB.shape === "circle") {
    return boxCircleShapes(shapeA, shapeB);
  }
  const inv = boxCircleShapes(shapeB, shapeA);
  return inv.hit ? { hit: true, mtvX: -inv.mtvX, mtvY: -inv.mtvY } : inv;
}
function collideProcesses(a2, b, ax = a2.x, ay = a2.y, bx = b.x, by = b.y, options = {}) {
  const shapesA = getProcessShapes(a2, ax, ay, !!options.preferCircle);
  const shapesB = getProcessShapes(b, bx, by, !!options.preferCircle);
  for (const sa of shapesA) {
    for (const sb of shapesB) {
      const hit = collideShapePair(sa, sb);
      if (hit.hit) {
        return {
          hit: true,
          mtvX: hit.mtvX,
          mtvY: hit.mtvY,
          cboxCodeA: sa.code,
          cboxCodeB: sb.code
        };
      }
    }
  }
  return { hit: false, mtvX: 0, mtvY: 0, cboxCodeA: -1, cboxCodeB: -1 };
}
function shapeContainsPoint(shape, x2, y) {
  if (shape.shape === "circle") {
    const dx = x2 - shape.cx;
    const dy = y - shape.cy;
    return dx * dx + dy * dy <= shape.r * shape.r;
  }
  const c = shape.corners;
  let sign = 0;
  for (let i = 0; i < c.length; i++) {
    const a2 = c[i];
    const b = c[(i + 1) % c.length];
    const cross = (b.x - a2.x) * (y - a2.y) - (b.y - a2.y) * (x2 - a2.x);
    if (Math.abs(cross) <= 1e-9) {
      continue;
    }
    const s = cross > 0 ? 1 : -1;
    if (sign === 0) {
      sign = s;
    } else if (s !== sign) {
      return false;
    }
  }
  return true;
}
var Signal = {
  S_KILL: 0,
  S_WAKEUP: 1,
  S_SLEEP: 2,
  S_FREEZE: 3,
  S_KILL_TREE: 100,
  S_WAKEUP_TREE: 101,
  S_SLEEP_TREE: 102,
  S_FREEZE_TREE: 103
};
var Process2 = class {
  constructor(name, params = {}) {
    this.name = name;
    this.id = params.id || 0;
    this.type = processTypeCode(name);
    this.x = params.x || 0;
    this.y = params.y || 0;
    this.width = params.width || 32;
    this.height = params.height || 32;
    this.sizeFromScript = false;
    this.ctype = params.ctype ?? params.c_type ?? 0;
    this.region = params.region ?? 0;
    this.angle = params.angle ?? 0;
    this.red = params.red ?? 255;
    this.green = params.green ?? 255;
    this.blue = params.blue ?? 255;
    this.alpha = params.alpha ?? 100;
    this.tag = params.tag ?? 0;
    this.priority = params.priority ?? 0;
    this.z = params.z ?? 0;
    this.graph = params.graph ?? 0;
    this.file = params.file ?? 0;
    this.size = params.size ?? 100;
    this.flags = params.flags ?? 0;
    this.cnumber = params.cnumber ?? 0;
    this.resolution = params.resolution ?? 0;
    this.parentId = params.parentId ?? 0;
    this.sonId = 0;
    this.bigbroId = 0;
    this.smallbroId = 0;
    this.collisionRadius = Number(params.collisionRadius ?? params.collision_radius ?? 0) || 0;
    this.collisionScale = Number(params.collisionScale ?? params.collision_scale ?? 1) || 1;
    this.collisionShape = params.collisionShape === "circle" ? "circle" : "box";
    this.cboxes = [];
    this.privates = params;
    this.active = true;
    this.suspended = false;
    this.sleeping = false;
    this.finished = false;
    this.dead = false;
    this.frameValue = 100;
    this.frameDebt = 0;
    this.budgetExhaustedStreak = 0;
    this.hasCompletedFrame = false;
    this.ip = 0;
    this.stack = [];
    this.locals = [];
    this.locals[0] = this.x;
    this.locals[1] = this.y;
    this.locals[2] = this.width;
    this.locals[3] = this.height;
    this.locals[4] = this.ctype;
    this.locals[5] = this.id;
    this.locals[6] = this.region;
    this.locals[7] = this.angle;
    this.locals[8] = this.red;
    this.locals[9] = this.green;
    this.locals[10] = this.blue;
    this.locals[11] = this.alpha;
    this.locals[12] = this.tag;
    this.locals[13] = this.priority;
    this.locals[14] = this.resolution;
    this.locals[15] = this.z;
    this.locals[16] = this.graph;
    this.locals[17] = this.file;
    this.locals[18] = this.size;
    this.locals[19] = this.flags;
    this.locals[20] = this.cnumber;
  }
  // Get bounds (for collision)
  getBounds() {
    return {
      x: this.x,
      y: this.y,
      width: this.width,
      height: this.height
    };
  }
  // Check collision with another process
  collidesWith(other) {
    return collideProcesses(this, other).hit;
  }
  // Circle vs circle: uses width/2 as radius for each process
  collidesCircle(other) {
    return collideProcesses(this, other, this.x, this.y, other.x, other.y, { preferCircle: true }).hit;
  }
  // OBB vs OBB using SAT (4 axes from the two boxes).
  // Falls back to AABB when both angles are 0.
  collidesOBB(other) {
    return collideProcesses(this, other).hit;
  }
  // Get property
  get(name) {
    return this.privates[name];
  }
  // Set property
  set(name, value) {
    this.privates[name] = value;
  }
  // Kill process
  kill() {
    this.dead = true;
    this.active = false;
  }
  // Sincronizar locals com estado do processo (chamar no fim do frame)
  sync() {
    this.x = this.locals[0] ?? this.x;
    this.y = this.locals[1] ?? this.y;
    this.width = this.locals[2] ?? this.width;
    this.height = this.locals[3] ?? this.height;
    this.ctype = this.locals[4] ?? this.ctype;
    this.locals[5] = this.id;
    this.region = this.locals[6] ?? this.region;
    this.angle = this.locals[7] ?? this.angle;
    this.red = this.locals[8] ?? this.red;
    this.green = this.locals[9] ?? this.green;
    this.blue = this.locals[10] ?? this.blue;
    this.alpha = this.locals[11] ?? this.alpha;
    this.tag = this.locals[12] ?? this.tag;
    this.priority = this.locals[13] ?? this.priority;
    this.resolution = this.locals[14] ?? this.resolution;
    this.z = this.locals[15] ?? this.z;
    this.graph = this.locals[16] ?? this.graph;
    this.file = this.locals[17] ?? this.file;
    this.size = this.locals[18] ?? this.size;
    this.flags = this.locals[19] ?? this.flags;
    this.cnumber = this.locals[20] ?? this.cnumber;
  }
  // Divisor applied to x/y for drawing and collision (DIV's RESOLUTION).
  // 0/unset/invalid all mean 1 - no scaling - so processes that never
  // touch the field behave exactly as before.
  getResolution() {
    const r = Number(this.resolution) || 0;
    return r > 0 ? r : 1;
  }
};
var ProcessManager = class {
  constructor() {
    this.processes = [];
    this.byId = /* @__PURE__ */ new Map();
    this.byType = /* @__PURE__ */ new Map();
    this.byName = /* @__PURE__ */ new Map();
    this.nextId = 1;
    this.pivotResolver = null;
    this._drawList = [];
    this._drawDirty = true;
    this.lastPenetrationX = 0;
    this.lastPenetrationY = 0;
    this.lastColliderCBox = -1;
    this.lastCollidedCBox = -1;
    this.usesPriority = false;
  }
  notePriorityUse() {
    this.usesPriority = true;
  }
  // In DIV a process with no graphic (GRAPH = 0) has nothing to collide
  // with - collision boxes come from the assigned graphic. Scripts use
  // that deliberately: tutor4's worm_segment sets graph=0 for every
  // segment past the current tail length, and those invisible segments
  // must not be hittable even though they still trail behind the worm.
  // The graph id lives in a dynamically-allocated local slot that only
  // the runtime can resolve, so it installs this predicate (see
  // registerNatives in runtime.js); without it, everything collides as
  // before.
  isCollidable(process) {
    if (!process || !process.active || process.dead || process.finished) {
      return false;
    }
    if (process.sleeping) {
      return false;
    }
    if (typeof this.graphIdOf !== "function") {
      return true;
    }
    return this.graphIdOf(process) > 0;
  }
  // Remembers which two processes last reported a collision, so the
  // debug overlay can highlight exactly that pair (see
  // drawProcessDebugOverlay in runtime.js). Cleared each frame by the
  // renderer, so what's highlighted is always this frame's collision.
  _recordCollisionPair(colliderId, collidedId) {
    this.lastCollisionA = colliderId;
    this.lastCollisionB = collidedId;
  }
  _setPenetration(mtv) {
    this.lastPenetrationX = Math.round(Number(mtv?.mtvX) || 0);
    this.lastPenetrationY = Math.round(Number(mtv?.mtvY) || 0);
    this.lastColliderCBox = Number.isInteger(mtv?.cboxCodeA) ? mtv.cboxCodeA : -1;
    this.lastCollidedCBox = Number.isInteger(mtv?.cboxCodeB) ? mtv.cboxCodeB : -1;
  }
  // Create process
  create(name, params = {}) {
    const process = new Process2(name, params);
    process.manager = this;
    process.id = this.nextId++;
    process.locals[5] = process.id;
    process.locals[6] = process.region;
    process.locals[7] = process.angle;
    if (process.priority) {
      this.usesPriority = true;
    }
    this.processes.push(process);
    this.byId.set(process.id, process);
    this._drawDirty = true;
    this._linkToFather(process);
    if (!this.byType.has(process.type)) {
      this.byType.set(process.type, /* @__PURE__ */ new Set());
    }
    this.byType.get(process.type).add(process.id);
    if (!this.byName.has(name)) {
      this.byName.set(name, /* @__PURE__ */ new Set());
    }
    this.byName.get(name).add(process.id);
    return process;
  }
  // Get process by ID - O(1) via byId, kept in sync in create()/sweep().
  get(id) {
    if (id === 0) return null;
    return this.byId.get(id) || null;
  }
  // Get all processes
  getAll() {
    return this.processes;
  }
  // Returns processes sorted by priority for rendering.
  // Rebuilds only when the list changed or a priority was written.
  getDrawList() {
    if (this._drawDirty) {
      this._drawList = this.processes.slice();
      this._drawList.sort((a2, b) => (b.z || 0) - (a2.z || 0));
      this._drawDirty = false;
    }
    return this._drawList;
  }
  // Called by the VM when the z slot (15) is written.
  markPriorityDirty() {
    this._drawDirty = true;
  }
  // Get processes by type (O(1) lookup)
  getByType(typeCode) {
    const ids = this.byType.get(typeCode);
    if (!ids) return [];
    return Array.from(ids).map((id) => this.get(id));
  }
  // Get processes by name
  getByName(name) {
    const ids = this.byName.get(name);
    if (!ids) return [];
    return Array.from(ids).map((id) => this.get(id));
  }
  // Get active processes
  getActive() {
    return this.processes.filter((p) => p.active);
  }
  // Remove process (mark as dead, sweep later)
  remove(id) {
    const process = this.get(id);
    if (process) {
      process.kill();
    }
  }
  // Hooks a new process into its father's family (see Process.sonId).
  _linkToFather(process) {
    const father = process.parentId ? this.byId.get(process.parentId) : null;
    if (!father) {
      return;
    }
    const elder = father.sonId ? this.byId.get(father.sonId) : null;
    if (elder) {
      process.bigbroId = elder.id;
      elder.smallbroId = process.id;
    }
    father.sonId = process.id;
  }
  // Takes a removed process out of its brothers' chain. Its own children
  // are left behind as orphans: nothing reaches them from above any more,
  // which is what DIV does with tree signals (dgs2 10713-10718). Their
  // parentId still names the dead id, so `father` reads 0, as before.
  _unlinkFromFather(process) {
    const father = this.byId.get(process.parentId);
    if (father && father.sonId === process.id) {
      father.sonId = process.bigbroId;
    }
    const bigbro = this.byId.get(process.bigbroId);
    if (bigbro) {
      bigbro.smallbroId = process.smallbroId;
    }
    const smallbro = this.byId.get(process.smallbroId);
    if (smallbro) {
      smallbro.bigbroId = process.bigbroId;
    }
  }
  // Sweep dead processes (call after frame). One pass that compacts the
  // survivors in place: splicing each dead process out separately was
  // O(n) per death, so killing half of 40k processes cost ~1.7 s.
  sweep() {
    const list = this.processes;
    let kept = 0;
    for (let i = 0; i < list.length; i++) {
      const process = list[i];
      if (process.dead || process.finished) {
        this._unlinkFromFather(process);
        this.byId.delete(process.id);
        this.byType.get(process.type)?.delete(process.id);
        this.byName.get(process.name)?.delete(process.id);
        continue;
      }
      if (process.active) {
        process.sync();
      }
      list[kept++] = process;
    }
    if (kept === list.length) {
      return;
    }
    list.length = kept;
    if (!this._drawDirty) {
      this._drawList = this._drawList.filter((p) => !p.dead && !p.finished);
    }
  }
  // TYPE operator (O(1))
  getTypeCode(name) {
    return processTypeCode(name);
  }
  // collision(type) - Returns ID of colliding process or 0
  collision(currentProcess, typeCode) {
    const processIds = this.byType.get(typeCode);
    if (!processIds) return 0;
    for (const id of processIds) {
      if (id === currentProcess.id) continue;
      const other = this.get(id);
      if (!other || !other.active) continue;
      if (!this.isCollidable(other)) continue;
      const hit = collideProcesses(currentProcess, other);
      if (hit.hit) {
        this._setPenetration(hit);
        this._recordCollisionPair(currentProcess.id, id);
        return id;
      }
    }
    this._setPenetration(null);
    return 0;
  }
  collisionCircle(currentProcess, typeCode) {
    const processIds = this.byType.get(typeCode);
    if (!processIds) return 0;
    for (const id of processIds) {
      if (id === currentProcess.id) continue;
      const other = this.get(id);
      if (!other || !other.active) continue;
      if (!this.isCollidable(other)) continue;
      const hit = collideProcesses(currentProcess, other, currentProcess.x, currentProcess.y, other.x, other.y, { preferCircle: true });
      if (hit.hit) {
        this._setPenetration(hit);
        this._recordCollisionPair(currentProcess.id, id);
        return id;
      }
    }
    this._setPenetration(null);
    return 0;
  }
  collisionOBB(currentProcess, typeCode) {
    const processIds = this.byType.get(typeCode);
    if (!processIds) return 0;
    for (const id of processIds) {
      if (id === currentProcess.id) continue;
      const other = this.get(id);
      if (!other || !other.active) continue;
      if (!this.isCollidable(other)) continue;
      const hit = collideProcesses(currentProcess, other);
      if (hit.hit) {
        this._setPenetration(hit);
        this._recordCollisionPair(currentProcess.id, id);
        return id;
      }
    }
    this._setPenetration(null);
    return 0;
  }
  // Returns the id of the first process of typeCode whose collision shape
  // contains the screen point (px, py) - the same shapes collision()
  // uses, so RESOLUTION, pivot, SIZE, ANGLE and cboxes all apply. It
  // used to test a bare width x height box around x/y. Asleep and dead
  // processes are never hit. With collidableOnly, processes that
  // collision() would skip (GRAPH 0) are skipped too; path_find's
  // obstacle test calls this without it, since its walls may be
  // graphic-less.
  collisionPoint(px, py, typeCode, options = {}) {
    const processIds = this.byType.get(typeCode);
    if (!processIds) return 0;
    const x2 = Number(px) || 0;
    const y = Number(py) || 0;
    for (const id of processIds) {
      const p = this.get(id);
      if (!p || !p.active || p.dead || p.finished || p.sleeping) continue;
      if (options.collidableOnly && !this.isCollidable(p)) continue;
      for (const shape of getProcessShapes(p)) {
        if (shapeContainsPoint(shape, x2, y)) return id;
      }
    }
    return 0;
  }
  // Returns ID of first process of typeCode that would collide with
  // currentProcess if it were placed at (tx, ty). Position is not changed.
  placeMeeting(currentProcess, tx, ty, typeCode) {
    const processIds = this.byType.get(typeCode);
    if (!processIds) return 0;
    const px = Number(tx) || 0;
    const py = Number(ty) || 0;
    for (const id of processIds) {
      if (id === currentProcess.id) continue;
      const other = this.get(id);
      if (!other || !other.active) continue;
      if (!this.isCollidable(other)) continue;
      const hit = collideProcesses(currentProcess, other, px, py, other.x, other.y);
      if (hit.hit) {
        this._setPenetration(hit);
        this._recordCollisionPair(currentProcess.id, id);
        return id;
      }
    }
    this._setPenetration(null);
    return 0;
  }
  // Returns 1 if currentProcess placed at (tx, ty) does NOT hit typeCode.
  placeFree(currentProcess, tx, ty, typeCode) {
    return this.placeMeeting(currentProcess, tx, ty, typeCode) === 0 ? 1 : 0;
  }
  // Children still in the process list (including ones killed this frame
  // and not swept yet), oldest first. Walks the son -> bigbro chain
  // instead of filtering every process.
  getChildrenOf(parentId) {
    const out = [];
    const father = this.byId.get(parentId);
    let child = father ? this.byId.get(father.sonId) : null;
    while (child) {
      out.push(child);
      child = this.byId.get(child.bigbroId);
    }
    return out.reverse();
  }
  getDescendantsOf(rootId) {
    const out = [];
    const queue = [rootId];
    for (let head = 0; head < queue.length; head++) {
      const children = this.getChildrenOf(queue[head]);
      for (const child of children) {
        out.push(child);
        queue.push(child.id);
      }
    }
    return out;
  }
  // The living process `rel` (DIV's son / bigbro / smallbro) names for
  // `process`, or null. A relative killed this frame but not swept yet is
  // passed over for the next one along the same chain, so e.g. `son`
  // after the last child died is the child created before it.
  getRelative(process, rel) {
    if (!process) {
      return null;
    }
    let target = null;
    if (rel === "son") {
      target = this.byId.get(process.sonId);
    } else if (rel === "bigbro") {
      target = this.byId.get(process.bigbroId);
    } else if (rel === "smallbro") {
      target = this.byId.get(process.smallbroId);
    }
    const next = rel === "smallbro" ? "smallbroId" : "bigbroId";
    while (target && (target.dead || target.finished)) {
      target = this.byId.get(target[next]);
    }
    return target || null;
  }
  applySignal(process, signalCode) {
    if (!process || process.dead || process.finished) {
      return false;
    }
    switch (signalCode) {
      case Signal.S_KILL:
        process.kill();
        return true;
      case Signal.S_WAKEUP:
        process.suspended = false;
        process.sleeping = false;
        process.active = true;
        return true;
      case Signal.S_SLEEP:
        process.suspended = true;
        process.sleeping = true;
        return true;
      case Signal.S_FREEZE:
        process.suspended = true;
        process.sleeping = false;
        return true;
      default:
        return false;
    }
  }
  signalById(targetId, signalCode) {
    const target = this.get(Number(targetId) || 0);
    if (!target) {
      return 0;
    }
    if (signalCode === Signal.S_KILL_TREE || signalCode === Signal.S_WAKEUP_TREE || signalCode === Signal.S_SLEEP_TREE || signalCode === Signal.S_FREEZE_TREE) {
      const baseSignal = signalCode - 100;
      let changed = 0;
      if (this.applySignal(target, baseSignal)) {
        changed += 1;
      }
      const descendants = this.getDescendantsOf(target.id);
      for (const process of descendants) {
        if (this.applySignal(process, baseSignal)) {
          changed += 1;
        }
      }
      return changed;
    }
    return this.applySignal(target, signalCode) ? 1 : 0;
  }
  signalByType(typeCode, signalCode) {
    const list = this.getByType(Number(typeCode) || 0);
    if (list.length === 0) {
      return 0;
    }
    let changed = 0;
    for (const process of list) {
      changed += this.signalById(process.id, signalCode);
    }
    return changed;
  }
  letMeAlone(currentProcess) {
    if (!currentProcess) {
      return 0;
    }
    let removed = 0;
    for (const process of this.processes) {
      if (process.id === currentProcess.id) {
        continue;
      }
      if (process.isMouse) {
        continue;
      }
      if (!process.dead && !process.finished) {
        process.kill();
        removed += 1;
      }
    }
    return removed;
  }
  // Update all processes (not used with scheduler)
  update(dt2) {
    for (const process of this.processes) {
      if (process.active && !process.suspended) {
      }
    }
  }
  // Get process count
  count() {
    return this.processes.length;
  }
  // Clear all processes
  clear() {
    this.processes = [];
    this.byId.clear();
    this.byType.clear();
    this.byName.clear();
    this.nextId = 1;
  }
};

// vm/vm.js
var VM = class _VM {
  // Fixed process slots mirrored onto the Process object as soon as they
  // are written (see STORE_LOCAL). Must stay in step with the slot table
  // in compiler.js's compileProcess and with Process.sync().
  static CANONICAL_SLOT_FIELDS = {
    0: "x",
    1: "y",
    2: "width",
    3: "height",
    4: "ctype",
    6: "region",
    7: "angle",
    8: "red",
    9: "green",
    10: "blue",
    11: "alpha",
    12: "tag",
    13: "priority",
    14: "resolution",
    15: "z",
    16: "graph",
    17: "file",
    18: "size",
    19: "flags",
    20: "cnumber"
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
      Object.entries(_VM.CANONICAL_SLOT_FIELDS).map(([index, name]) => [name, Number(index)])
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
    this.constants = [];
    this.bytecode = [];
    this.globals = /* @__PURE__ */ new Map();
    this.natives = /* @__PURE__ */ new Map();
    this.processManager = new ProcessManager();
    this.processTable = /* @__PURE__ */ new Map();
    this.functionTable = /* @__PURE__ */ new Map();
    this.currentProcess = null;
    this.ip = 0;
    this.stack = [];
    this.locals = [];
    this.frameYield = false;
    this.callStack = [];
    this.dt = 1 / 60;
    this.running = false;
    this.halted = false;
    this.mainIp = 0;
    this.mainStack = [];
    this.mainLocals = [];
    this.mainCallStack = [];
    this.mainFinished = false;
    this.mainBudgetExhaustedStreak = 0;
    this.debug = false;
    this.frameValue = 100;
    this.spawnDepth = 0;
    this.deferredSpawns = [];
  }
  // Register native function
  registerNative(name, fn2) {
    this.natives.set(name, fn2);
  }
  // Load bytecode
  load(bytecode) {
    this.constants = bytecode.constants;
    this.bytecode = bytecode.instructions;
    this.processTable = bytecode.processTable || /* @__PURE__ */ new Map();
    this.functionTable = bytecode.functionTable || /* @__PURE__ */ new Map();
    if (bytecode.mainLocals) {
      this.processTable.set("__main__", {
        addr: bytecode.mainAddr ?? 0,
        params: [],
        privates: [],
        locals: bytecode.mainLocals
      });
    }
    if (this.mainProcess) {
      this.dropProgramProcesses();
    }
    this.mainIp = 0;
    this.mainStack = [];
    this.mainCallStack = [];
    this.mainFinished = false;
    this.mainBudgetExhaustedStreak = 0;
    this.mainProcess = this.processManager.create("__main__", {});
    this.mainProcess.isMain = true;
    this.mainLocals = this.mainProcess.locals;
  }
  // Run VM for one frame (scheduler)
  // One frame of the whole program. An exception escaping it (a native
  // that throws, a VM error) leaves the interrupted process half-run - its
  // ip, stack and locals mid-instruction - so the VM stops for good: it is
  // marked halted, later tick() calls do nothing, and the error still
  // reaches the host (runDivDemo reports it through onError).
  tick() {
    if (this.halted) {
      return;
    }
    try {
      this.runTick();
    } catch (err) {
      this.halted = true;
      throw err;
    }
  }
  runTick() {
    this.running = true;
    if (this.halted) {
      return;
    }
    const procs = this.processManager.processes;
    const procCount = procs.length;
    const main = this.mainProcess;
    if (!this.mainFinished && main && (main.dead || main.finished)) {
      this.mainFinished = true;
    }
    if (!this.mainFinished) {
      if (main && main.suspended) {
      } else if (main && main.frameDebt >= 100) {
        main.frameDebt -= 100;
      } else {
        this.runMain();
      }
    }
    let runOrder = procs;
    if (this.processManager.usesPriority) {
      runOrder = procs.slice(0, procCount);
      runOrder.sort((a2, b) => (b.priority || 0) - (a2.priority || 0));
    }
    const runCount = Math.min(procCount, runOrder.length);
    for (let pi = 0; pi < runCount; pi++) {
      if (this.halted) {
        break;
      }
      const process = runOrder[pi];
      if (!process.active || process.suspended || process.finished) {
        continue;
      }
      if (process.isMain || process.isMouse) {
        continue;
      }
      if (process.frameDebt >= 100) {
        process.frameDebt -= 100;
        continue;
      }
      this.runProcess(process);
    }
    this.runDeferredSpawns();
    this.processManager.sweep();
  }
  // First runs that SPAWN_PROCESS deferred because the spawn chain was
  // too deep. They still run in the tick they were created in, each from
  // an empty JS stack; whatever they spawn is appended and run here too.
  runDeferredSpawns() {
    const queue = this.deferredSpawns;
    for (let i = 0; i < queue.length && !this.halted; i++) {
      const process = queue[i];
      if (process.dead || process.finished || process.suspended) {
        continue;
      }
      this.runProcess(process);
    }
    queue.length = 0;
  }
  // Removes every process of the loaded program - MAIN included - but
  // not engine-owned ones (the runtime's mouse), which outlive programs.
  dropProgramProcesses() {
    const pm = this.processManager;
    for (const process of pm.getAll()) {
      if (!process.isMouse) {
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
    this.currentProcess = this.mainProcess;
    this.ip = this.mainIp;
    this.stack = this.mainStack;
    this.locals = this.mainLocals;
    this.frameYield = false;
    this.callStack = this.mainCallStack;
    const MAX_CONSECUTIVE_BUDGET_EXHAUSTIONS = 5;
    let budget = 1e5;
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
          `MAIN: exceeded the per-tick instruction budget (100000) on ${MAX_CONSECUTIVE_BUDGET_EXHAUSTIONS} consecutive ticks without ever reaching FRAME or finishing - this looks like a genuine infinite loop, not just a lot of legitimate work. Stopping MAIN permanently.`
        );
        this.mainFinished = true;
        if (this.mainProcess) {
          this.mainProcess.finished = true;
        }
      } else {
        console.warn(
          `MAIN: exceeded the per-tick instruction budget (100000) without reaching FRAME - resuming from where it left off on the next tick instead of stopping (attempt ${this.mainBudgetExhaustedStreak}/${MAX_CONSECUTIVE_BUDGET_EXHAUSTIONS}). If a single logical "tick" of MAIN genuinely needs more than ~100,000 instructions of real work (e.g. spawning a very large number of processes at once), consider spreading it across multiple FRAME-separated batches instead.`
        );
      }
    } else {
      this.mainBudgetExhaustedStreak = 0;
    }
    this.mainIp = this.ip;
    this.mainStack = this.stack;
    this.mainLocals = this.locals;
    this.mainCallStack = this.callStack;
    this.mainProcess.locals = this.ownLocalsOf(this.locals, this.callStack);
    this.mainProcess.sync();
  }
  // Run ONE process until FRAME or finished
  runProcess(process) {
    this.currentProcess = process;
    this.ip = process.ip;
    this.stack = process.stack;
    this.locals = process.frameLocals || process.locals;
    this.frameYield = false;
    this.callStack = process.callStack || [];
    const MAX_CONSECUTIVE_BUDGET_EXHAUSTIONS = 5;
    let budget = 1e5;
    let budgetExhausted = false;
    while (!this.frameYield && !process.finished && !this.halted) {
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
          `Process ${process.name}#${process.id}: exceeded the per-tick instruction budget (100000) on ${MAX_CONSECUTIVE_BUDGET_EXHAUSTIONS} consecutive ticks without ever reaching FRAME or finishing - this looks like a genuine infinite loop, not just a lot of legitimate work. Killing the process.`
        );
        process.kill();
      } else {
        console.warn(
          `Process ${process.name}#${process.id}: exceeded the per-tick instruction budget (100000) without reaching FRAME - resuming from where it left off on the next tick instead of killing it (attempt ${process.budgetExhaustedStreak}/${MAX_CONSECUTIVE_BUDGET_EXHAUSTIONS}).`
        );
      }
    } else {
      process.budgetExhaustedStreak = 0;
    }
    process.ip = this.ip;
    process.stack = this.stack;
    process.callStack = this.callStack;
    process.frameLocals = this.callStack.length > 0 ? this.locals : null;
    process.locals = this.ownLocalsOf(this.locals, this.callStack);
    process.sync();
  }
  // The locals array belonging to the process (or MAIN) itself. CALL
  // pushes [returnAddress, callerLocals] onto the call stack, so while a
  // FUNCTION is active the process's own locals sit at callStack[1].
  ownLocalsOf(activeLocals, callStack) {
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
        if (this.currentProcess !== null && this.callStack.length === 0) {
          if (operands[0] === 15) {
            this.processManager.markPriorityDirty();
          } else if (operands[0] === 13 && this.locals[13]) {
            this.processManager.notePriorityUse();
          }
        }
        if (this.currentProcess !== null && this.callStack.length === 0) {
          const field = _VM.CANONICAL_SLOT_FIELDS[operands[0]];
          if (field !== void 0) {
            this.currentProcess[field] = this.locals[operands[0]];
            if (operands[0] === 2 || operands[0] === 3) {
              this.currentProcess.sizeFromScript = true;
            }
          }
        }
        this.ip++;
        break;
      case OpCodes.LOAD_GLOBAL: {
        const gv = this.globals.get(operands[0]);
        this.push(gv === void 0 ? 0 : gv);
        this.ip++;
        break;
      }
      case OpCodes.STORE_GLOBAL:
        this.globals.set(operands[0], this.pop());
        this.ip++;
        break;
      case OpCodes.LOAD_LOCAL_IDX: {
        const li2 = this.pop();
        if (li2 < 0 || li2 >= operands[1] || !Number.isInteger(li2)) {
          console.error(`Array index out of bounds: [${li2}] (valid range 0..${operands[1] - 1})`);
          this.push(0);
        } else {
          this.push(this.locals[operands[0] + li2] ?? 0);
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
        const gi2 = this.pop();
        if (gi2 < 0 || gi2 >= operands[1] || !Number.isInteger(gi2)) {
          console.error(`Array index out of bounds: [${gi2}] (valid range 0..${operands[1] - 1})`);
          this.push(0);
        } else {
          const gv2 = this.globals.get(operands[0] + gi2);
          this.push(gv2 === void 0 ? 0 : gv2);
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
        const a2 = this.pop();
        this.push(a2 + b);
        this.ip++;
        break;
      }
      case OpCodes.SUB: {
        const b = this.pop();
        const a2 = this.pop();
        this.push(a2 - b);
        this.ip++;
        break;
      }
      case OpCodes.MUL: {
        const b = this.pop();
        const a2 = this.pop();
        this.push(a2 * b);
        this.ip++;
        break;
      }
      case OpCodes.DIV: {
        const b = this.pop();
        const a2 = this.pop();
        if (b === 0) {
          this.push(0);
        } else if (Number.isInteger(a2) && Number.isInteger(b)) {
          this.push(Math.trunc(a2 / b));
        } else {
          this.push(a2 / b);
        }
        this.ip++;
        break;
      }
      case OpCodes.MOD: {
        const b = this.pop();
        const a2 = this.pop();
        this.push(b === 0 ? 0 : a2 % b);
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
        const a2 = this.pop();
        this.push(a2 === b ? 1 : 0);
        this.ip++;
        break;
      }
      case OpCodes.NEQ: {
        const b = this.pop();
        const a2 = this.pop();
        this.push(a2 !== b ? 1 : 0);
        this.ip++;
        break;
      }
      case OpCodes.LT: {
        const b = this.pop();
        const a2 = this.pop();
        this.push(a2 < b ? 1 : 0);
        this.ip++;
        break;
      }
      case OpCodes.LTE: {
        const b = this.pop();
        const a2 = this.pop();
        this.push(a2 <= b ? 1 : 0);
        this.ip++;
        break;
      }
      case OpCodes.GT: {
        const b = this.pop();
        const a2 = this.pop();
        this.push(a2 > b ? 1 : 0);
        this.ip++;
        break;
      }
      case OpCodes.GTE: {
        const b = this.pop();
        const a2 = this.pop();
        this.push(a2 >= b ? 1 : 0);
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
        console.error("Unresolved BREAK opcode reached VM. Compiler should lower BREAK to JUMP.");
        this.halted = true;
        break;
      case OpCodes.CONTINUE:
        console.error("Unresolved CONTINUE opcode reached VM. Compiler should lower CONTINUE to JUMP.");
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
        this.callStack.push(this.ip + 1);
        this.ip = funcInfo.addr;
        this.callStack.push(this.locals);
        this.locals = [];
        for (let i = 0; i < funcInfo.params.length; i++) {
          this.locals[i] = funcArgs[i];
        }
        break;
      }
      case OpCodes.RETURN: {
        const returningToCaller = this.callStack.length >= 2;
        const returnValue = this.stack.length > 0 ? this.pop() : 0;
        if (this.callStack.length > 0) {
          this.locals = this.callStack.pop();
        }
        if (this.callStack.length > 0) {
          this.ip = this.callStack.pop();
        } else {
          if (this.currentProcess && !this.currentProcess.isMain) {
            this.currentProcess.finished = true;
            this.currentProcess.returnValue = returnValue;
          } else {
            this.mainFinished = true;
            if (this.mainProcess) {
              this.mainProcess.finished = true;
            }
          }
        }
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
          this.push(result === void 0 ? 0 : result);
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
        const params = {};
        const processInfo = this.processTable.get(processName);
        if (processInfo) {
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
        if (processInfo.params && processInfo.locals) {
          for (let i = 0; i < processInfo.params.length; i++) {
            const paramName = processInfo.params[i];
            const slot = processInfo.locals[paramName];
            if (slot !== void 0) {
              newProcess.locals[slot] = processArgs[i];
              if (slot === 2 || slot === 3) {
                newProcess.sizeFromScript = true;
              }
            }
          }
        }
        const savedProcess = this.currentProcess;
        const savedIp = this.ip;
        const savedStack = this.stack;
        const savedLocals = this.locals;
        const savedCallStack = this.callStack;
        const savedFrameYield = this.frameYield;
        if (this.spawnDepth >= _VM.MAX_SPAWN_DEPTH) {
          this.deferredSpawns.push(newProcess);
          this.push(newProcess.id);
          this.ip++;
          break;
        }
        this.spawnDepth++;
        try {
          this.runProcess(newProcess);
        } finally {
          this.spawnDepth--;
        }
        this.currentProcess = savedProcess;
        this.ip = savedIp;
        this.stack = savedStack;
        this.locals = savedLocals;
        this.callStack = savedCallStack;
        this.frameYield = savedFrameYield;
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
          this.currentProcess.frameDebt = Math.max(
            0,
            this.currentProcess.frameDebt + (this.frameValue - 100)
          );
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
        if (this.currentProcess === this.mainProcess) {
          this.mainFinished = true;
          this.mainProcess.finished = true;
        } else if (this.currentProcess) {
          this.currentProcess.finished = true;
        } else {
          this.halted = true;
        }
        this.frameYield = true;
        break;
      default:
        console.error(`Unknown opcode: ${opcode} (${OpCodeNames[opcode] || "UNKNOWN"})`);
        this.halted = true;
        break;
    }
  }
  // Push value
  push(value) {
    if (this.debug && value === void 0) {
      console.warn("Stack underflow detected");
      value = 0;
    }
    this.stack.push(value);
  }
  // Pop value
  pop() {
    if (this.stack.length === 0) {
      if (this.debug) {
        console.warn("Stack underflow");
      }
      return 0;
    }
    return this.stack.pop();
  }
  // VM truthiness: false, 0, null, undefined => false; everything else => true
  isTruthy(value) {
    return !(value === 0 || value === false || value === null || value === void 0);
  }
  // Reset VM
  reset() {
    this.dropProgramProcesses();
    this.constants = [];
    this.bytecode = [];
    this.globals = /* @__PURE__ */ new Map();
    this.processTable = /* @__PURE__ */ new Map();
    this.functionTable = /* @__PURE__ */ new Map();
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
};

// graph/graphics.js
var GraphicsManager = class {
  // firstId lets a registry hand out codes in a range of its own: DIV
  // numbers graphics loaded one by one (load_map) from 1000 up, so they
  // never clash with the 1-999 codes inside an FPG.
  constructor(options = {}) {
    this.firstId = Number(options.firstId) > 0 ? Number(options.firstId) : 1;
    this.graphics = /* @__PURE__ */ new Map();
    this.nextId = this.firstId;
  }
  // Load graphic
  load(src, sx, sy, sw, sh) {
    const id = this.nextId++;
    const image = new Image();
    image.src = src;
    const graphic = {
      id,
      image,
      loaded: false
    };
    if (sx !== void 0) {
      graphic.sx = sx;
      graphic.sy = sy;
      graphic.sw = sw || image.width;
      graphic.sh = sh || image.height;
    }
    image.onload = () => {
      graphic.loaded = true;
      if (!graphic.sw) graphic.sw = image.width;
      if (!graphic.sh) graphic.sh = image.height;
    };
    this.graphics.set(id, graphic);
    return id;
  }
  // Create a procedural graphic backed by an offscreen canvas
  create(width, height) {
    const id = this.nextId++;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width));
    canvas.height = Math.max(1, Math.round(height));
    const ctx2d = canvas.getContext("2d");
    ctx2d.clearRect(0, 0, canvas.width, canvas.height);
    this.graphics.set(id, {
      id,
      image: canvas,
      canvas,
      ctx2d,
      loaded: true,
      sw: canvas.width,
      sh: canvas.height
    });
    return id;
  }
  // Register an existing canvas/image-like object directly as a graphic
  addCanvas(canvas, sx, sy, sw, sh) {
    const id = this.nextId++;
    const width = canvas?.width || 1;
    const height = canvas?.height || 1;
    const graphic = {
      id,
      image: canvas,
      canvas,
      loaded: true,
      sw: sw || width,
      sh: sh || height
    };
    if (sx !== void 0) {
      graphic.sx = sx;
      graphic.sy = sy || 0;
    }
    this.graphics.set(id, graphic);
    return id;
  }
  // Replace a pre-reserved graphic id with decoded canvas data
  setCanvas(id, canvas, sx, sy, sw, sh) {
    const numericId = Number(id) || 0;
    const width = canvas?.width || 1;
    const height = canvas?.height || 1;
    const current = this.graphics.get(numericId) || { id: numericId };
    const next = {
      ...current,
      id: numericId,
      image: canvas,
      canvas,
      loaded: true,
      sw: sw || width,
      sh: sh || height
    };
    if (sx !== void 0) {
      next.sx = sx;
      next.sy = sy || 0;
    }
    this.graphics.set(numericId, next);
    return numericId;
  }
  // Get graphic by ID
  get(id) {
    return this.graphics.get(id);
  }
  // Remove graphic
  remove(id) {
    this.graphics.delete(id);
  }
  // Clear all graphics
  clear() {
    this.graphics.clear();
    this.nextId = this.firstId;
  }
};
var Graphics = new GraphicsManager();

// vm/bennu_bdf.js
function parseIntToken(value, fallback = 0) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}
function parseBbx(line) {
  const parts = String(line).trim().split(/\s+/);
  return {
    width: parseIntToken(parts[1], 0),
    height: parseIntToken(parts[2], 0),
    xoffset: parseIntToken(parts[3], 0),
    yoffset: parseIntToken(parts[4], 0)
  };
}
function parseDwidth(line) {
  const parts = String(line).trim().split(/\s+/);
  return {
    xadvance: parseIntToken(parts[1], 0),
    yadvance: parseIntToken(parts[2], 0)
  };
}
function decodeBitmapRows(rows2, width, height) {
  const out = new Uint8Array(Math.max(0, width * height));
  for (let y = 0; y < height; y++) {
    const row = String(rows2[y] || "").trim();
    const bytes = [];
    for (let i = 0; i + 1 < row.length; i += 2) {
      const byte = Number.parseInt(row.slice(i, i + 2), 16);
      bytes.push(Number.isFinite(byte) ? byte : 0);
    }
    for (let x2 = 0; x2 < width; x2++) {
      const byteIndex = x2 >> 3;
      const bitInByte = 7 - (x2 & 7);
      const byte = bytes[byteIndex] || 0;
      const on2 = byte >> bitInByte & 1;
      out[y * width + x2] = on2;
    }
  }
  return out;
}
function parseBennuBdfFont(bdfText) {
  const lines = String(bdfText || "").replace(/\r/g, "").split("\n");
  const glyphs = new Array(256).fill(null);
  let defaultXAdvance = 0;
  let defaultYAdvance = 0;
  let minYOffset = 0;
  let maxWidth = 0;
  let maxHeight = 0;
  let inChar = false;
  let encoding = -1;
  let width = 0;
  let height = 0;
  let xoffset = 0;
  let yoffset = 0;
  let xadvance = 0;
  let yadvance = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!inChar && line.startsWith("DWIDTH ")) {
      const d = parseDwidth(line);
      defaultXAdvance = d.xadvance;
      defaultYAdvance = d.yadvance;
      continue;
    }
    if (line.startsWith("STARTCHAR")) {
      inChar = true;
      encoding = -1;
      width = 0;
      height = 0;
      xoffset = 0;
      yoffset = 0;
      xadvance = defaultXAdvance;
      yadvance = defaultYAdvance;
      continue;
    }
    if (line.startsWith("ENDCHAR")) {
      inChar = false;
      continue;
    }
    if (!inChar) {
      continue;
    }
    if (line.startsWith("ENCODING ")) {
      encoding = parseIntToken(line.slice(9), -1);
      continue;
    }
    if (line.startsWith("DWIDTH ")) {
      const d = parseDwidth(line);
      xadvance = d.xadvance;
      yadvance = d.yadvance;
      continue;
    }
    if (line.startsWith("BBX ")) {
      const box = parseBbx(line);
      width = Math.max(0, box.width);
      height = Math.max(0, box.height);
      xoffset = box.xoffset;
      yoffset = box.yoffset;
      continue;
    }
    if (line.startsWith("BITMAP")) {
      if (encoding < 0 || encoding > 255 || width <= 0 || height <= 0) {
        continue;
      }
      const bitmapRows = lines.slice(i + 1, i + 1 + height);
      i += height;
      const parsedYOffset = -yoffset - height;
      minYOffset = Math.min(minYOffset, parsedYOffset);
      maxWidth = Math.max(maxWidth, width);
      maxHeight = Math.max(maxHeight, height);
      glyphs[encoding] = {
        width,
        height,
        xoffset,
        yoffset: parsedYOffset,
        xadvance,
        yadvance,
        bitmap: decodeBitmapRows(bitmapRows, width, height)
      };
    }
  }
  for (let i = 0; i < glyphs.length; i++) {
    if (glyphs[i]) {
      glyphs[i].yoffset -= minYOffset;
    }
  }
  if (glyphs[32] && glyphs[32].xadvance === 0 && glyphs[106]) {
    glyphs[32].xadvance = glyphs[106].xadvance;
  }
  const fallbackAdvance = (glyphs[32] && glyphs[32].xadvance > 0 ? glyphs[32].xadvance : 0) || (glyphs[106] && glyphs[106].xadvance > 0 ? glyphs[106].xadvance : 0) || Math.max(1, maxWidth || 8);
  return {
    kind: "bdf",
    glyphs,
    maxWidth,
    maxHeight,
    lineHeight: Math.max(1, maxHeight),
    fallbackAdvance
  };
}

// vm/div_formats.js
function toAscii(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    const c = bytes[i];
    out += c >= 32 && c <= 126 ? String.fromCharCode(c) : "\0";
  }
  return out;
}
var BinReader = class {
  constructor(buffer) {
    this.bytes = new Uint8Array(buffer);
    this.view = new DataView(buffer);
    this.pos = 0;
    this.length = this.bytes.length;
  }
  remaining() {
    return this.length - this.pos;
  }
  seek(offset) {
    this.pos = Math.max(0, Math.min(this.length, offset));
  }
  skip(n) {
    this.seek(this.pos + n);
  }
  readBytes(n) {
    if (this.pos + n > this.length) {
      throw new Error("Unexpected EOF");
    }
    const out = this.bytes.subarray(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }
  readUInt8() {
    return this.readBytes(1)[0];
  }
  readUInt16() {
    const v = this.view.getUint16(this.pos, true);
    this.pos += 2;
    return v;
  }
  readInt16() {
    const v = this.view.getInt16(this.pos, true);
    this.pos += 2;
    return v;
  }
  readInt32() {
    const v = this.view.getInt32(this.pos, true);
    this.pos += 4;
    return v;
  }
  readUInt32() {
    const v = this.view.getUint32(this.pos, true);
    this.pos += 4;
    return v;
  }
};
function readHeader(reader) {
  const header = reader.readBytes(8);
  const magic = toAscii(header.subarray(0, 7)).replace(/\0/g, "");
  let bpp = header[7];
  if (bpp === 0) {
    bpp = 8;
  }
  return { magic: magic.toLowerCase(), bpp };
}
function widthBytes(width, bpp) {
  if (bpp === 1) return Math.ceil(width / 8);
  if (bpp === 8) return width;
  if (bpp === 16) return width * 2;
  if (bpp === 32) return width * 4;
  throw new Error(`Unsupported bpp: ${bpp}`);
}
function scale6to8(v) {
  const c = Math.min(63, v);
  return c << 2 | c >> 4;
}
function parsePalette768(rgbBytes) {
  const palette = new Array(256);
  for (let i = 0; i < 256; i++) {
    palette[i] = {
      r: scale6to8(rgbBytes[i * 3 + 0] || 0),
      g: scale6to8(rgbBytes[i * 3 + 1] || 0),
      b: scale6to8(rgbBytes[i * 3 + 2] || 0)
    };
  }
  return palette;
}
function readPalette(reader, withGammaBlock) {
  if (reader.remaining() < 768) {
    throw new Error("Missing 8bpp palette data");
  }
  const paletteBytes = reader.readBytes(768);
  if (withGammaBlock && reader.remaining() >= 576) {
    reader.skip(576);
  }
  return parsePalette768(paletteBytes);
}
function decodePixelsToImageData(width, height, bpp, rowBytes, raw, palette) {
  const out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const rowOffset = y * rowBytes;
    for (let x2 = 0; x2 < width; x2++) {
      const outBase = (y * width + x2) * 4;
      let r = 0;
      let g2 = 0;
      let b = 0;
      let a2 = 255;
      if (bpp === 1) {
        const byte = raw[rowOffset + (x2 >> 3)] || 0;
        const bit = byte >> 7 - (x2 & 7) & 1;
        if (bit) {
          r = 255;
          g2 = 255;
          b = 255;
        } else {
          a2 = 0;
        }
      } else if (bpp === 8) {
        const idx = raw[rowOffset + x2] || 0;
        const color = palette?.[idx] || { r: idx, g: idx, b: idx };
        r = color.r;
        g2 = color.g;
        b = color.b;
        if (idx === 0) {
          a2 = 0;
        }
      } else if (bpp === 16) {
        const p = rowOffset + x2 * 2;
        const v = (raw[p] || 0) | (raw[p + 1] || 0) << 8;
        r = (v >> 11 & 31) * 255 / 31;
        g2 = (v >> 5 & 63) * 255 / 63;
        b = (v & 31) * 255 / 31;
      } else if (bpp === 32) {
        const p = rowOffset + x2 * 4;
        const v = (raw[p] || 0) | (raw[p + 1] || 0) << 8 | (raw[p + 2] || 0) << 16 | (raw[p + 3] || 0) << 24;
        a2 = v >>> 24 & 255;
        r = v >>> 16 & 255;
        g2 = v >>> 8 & 255;
        b = v & 255;
        if (a2 === 0) {
          a2 = 255;
        }
      }
      out[outBase + 0] = r;
      out[outBase + 1] = g2;
      out[outBase + 2] = b;
      out[outBase + 3] = a2;
    }
  }
  return new ImageData(out, width, height);
}
function imageDataToCanvas(imageData) {
  const canvas = document.createElement("canvas");
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  const ctx = canvas.getContext("2d");
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}
function readCString(bytes) {
  let end = 0;
  while (end < bytes.length && bytes[end] !== 0) end++;
  return new TextDecoder().decode(bytes.subarray(0, end));
}
function decodeMapPixels(reader, width, height, bpp, palette) {
  const rowBytes = widthBytes(width, bpp);
  const totalBytes = rowBytes * height;
  const raw = reader.readBytes(totalBytes);
  const imageData = decodePixelsToImageData(width, height, bpp, rowBytes, raw, palette);
  const canvas = imageDataToCanvas(imageData);
  return { raw, imageData, canvas, rowBytes };
}
function mapHasGammaBlock(reader, width, height, bpp) {
  const pixelBytes = widthBytes(width, bpp) * height;
  const fits = (offset) => {
    if (offset + 2 > reader.length) {
      return false;
    }
    const cpointCount = reader.view.getUint16(offset, true);
    return offset + 2 + cpointCount * 4 + pixelBytes === reader.length;
  };
  if (fits(reader.pos)) {
    return false;
  }
  return fits(reader.pos + 576);
}
function parseDivMapBuffer(buffer) {
  const reader = new BinReader(buffer);
  const { magic, bpp } = readHeader(reader);
  if (!magic.startsWith("map") && !magic.startsWith("m16") && !magic.startsWith("m32") && !magic.startsWith("m01")) {
    throw new Error(`Not a DIV MAP file (${magic})`);
  }
  const width = reader.readUInt16();
  const height = reader.readUInt16();
  const code = reader.readInt32();
  const name = readCString(reader.readBytes(32));
  let palette = null;
  if (bpp === 8) {
    palette = readPalette(reader, false);
    if (mapHasGammaBlock(reader, width, height, bpp)) {
      reader.skip(576);
    }
  }
  const cpointCount = reader.readUInt16();
  const cpoints = [];
  for (let i = 0; i < cpointCount; i++) {
    const x2 = reader.readInt16();
    const y = reader.readInt16();
    cpoints.push(x2 === -1 && y === -1 ? { x: -1, y: -1, undefined: true } : { x: x2, y });
  }
  const decoded = decodeMapPixels(reader, width, height, bpp, palette);
  return {
    format: "map",
    magic,
    bpp,
    width,
    height,
    code,
    name,
    cpoints,
    palette,
    ...decoded
  };
}
function parseDivFpgBuffer(buffer) {
  const reader = new BinReader(buffer);
  const { magic, bpp } = readHeader(reader);
  if (!magic.startsWith("fpg") && !magic.startsWith("f16") && !magic.startsWith("f32") && !magic.startsWith("f01")) {
    throw new Error(`Not a DIV FPG file (${magic})`);
  }
  let palette = null;
  if (bpp === 8) {
    palette = readPalette(reader, true);
  }
  const maps = [];
  const chunkSize = 64;
  while (reader.remaining() >= chunkSize) {
    const code = reader.readInt32();
    reader.skip(4);
    const name = readCString(reader.readBytes(32));
    reader.skip(12);
    const width = reader.readInt32();
    const height = reader.readInt32();
    const cpointCount = reader.readInt32();
    if (code < 0 || code > 999 || width <= 0 || height <= 0 || cpointCount < 0 || cpointCount > 1e4) {
      break;
    }
    const cpoints = [];
    for (let i = 0; i < cpointCount; i++) {
      if (reader.remaining() < 4) {
        throw new Error("Unexpected EOF in FPG cpoints");
      }
      const x2 = reader.readInt16();
      const y = reader.readInt16();
      cpoints.push(x2 === -1 && y === -1 ? { x: -1, y: -1, undefined: true } : { x: x2, y });
    }
    const decoded = decodeMapPixels(reader, width, height, bpp, palette);
    maps.push({
      code,
      name,
      width,
      height,
      cpoints,
      ...decoded
    });
  }
  return {
    format: "fpg",
    magic,
    bpp,
    palette,
    maps
  };
}
function averageGlyphAdvance(glyphs) {
  let total = 0;
  let count = 0;
  for (const glyph of glyphs) {
    const advance = glyph ? glyph.xadvance || glyph.width || 0 : 0;
    if (advance > 0) {
      total += advance;
      count += 1;
    }
  }
  return count > 0 ? Math.round(total / count) : 0;
}
function parseDivFntBuffer(buffer) {
  const reader = new BinReader(buffer);
  const { magic, bpp } = readHeader(reader);
  const isFnx = magic.startsWith("fnx");
  if (!magic.startsWith("fnt") && !isFnx) {
    throw new Error(`Not a DIV FNT/FNX file (${magic})`);
  }
  let palette = null;
  if (bpp === 8) {
    palette = readPalette(reader, true);
  }
  const types = reader.readInt32();
  const glyphMeta = new Array(256).fill(null);
  if (isFnx) {
    for (let i = 0; i < 256; i++) {
      glyphMeta[i] = {
        width: reader.readInt32(),
        height: reader.readInt32(),
        xadvance: reader.readInt32(),
        yadvance: reader.readInt32(),
        xoffset: reader.readInt32(),
        yoffset: reader.readInt32(),
        fileoffset: reader.readInt32()
      };
    }
  } else {
    for (let i = 0; i < 256; i++) {
      const width = reader.readInt32();
      const height = reader.readInt32();
      const yoffset = reader.readInt32();
      const fileoffset = reader.readInt32();
      glyphMeta[i] = {
        width,
        height,
        xadvance: width,
        yadvance: height + yoffset,
        xoffset: 0,
        yoffset,
        fileoffset
      };
    }
  }
  const glyphs = new Array(256).fill(null);
  let maxHeight = 0;
  for (let i = 0; i < 256; i++) {
    const meta = glyphMeta[i];
    if (!meta || meta.fileoffset <= 0 || meta.width <= 0 || meta.height <= 0) {
      continue;
    }
    const keep = reader.pos;
    reader.seek(meta.fileoffset);
    const decoded = decodeMapPixels(reader, meta.width, meta.height, bpp, palette);
    reader.seek(keep);
    glyphs[i] = {
      ...meta,
      ...decoded
    };
    if (meta.height > maxHeight) {
      maxHeight = meta.height;
    }
  }
  const fallbackAdvance = glyphs[32]?.xadvance || glyphs[106]?.xadvance || averageGlyphAdvance(glyphs) || 8;
  return {
    format: "fnt",
    magic,
    bpp,
    types,
    palette,
    glyphs,
    lineHeight: Math.max(1, maxHeight),
    fallbackAdvance
  };
}
async function fetchBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
  return res.arrayBuffer();
}
async function loadDivMapFromUrl(url) {
  return parseDivMapBuffer(await fetchBuffer(url));
}
async function loadDivFpgFromUrl(url) {
  return parseDivFpgBuffer(await fetchBuffer(url));
}
async function loadDivFntFromUrl(url) {
  return parseDivFntBuffer(await fetchBuffer(url));
}
function renderDivFontText(ctx, font, x2, y, text, align = 0) {
  if (!ctx || !font) {
    return 0;
  }
  const lines = String(text).split("\n");
  const widths = lines.map((line) => {
    let w = 0;
    for (let i = 0; i < line.length; i++) {
      const glyph = font.glyphs[line.charCodeAt(i) & 255];
      w += glyph ? glyph.xadvance || glyph.width || font.fallbackAdvance : font.fallbackAdvance;
    }
    return w;
  });
  let drawn = 0;
  for (let li2 = 0; li2 < lines.length; li2++) {
    const line = lines[li2];
    let penX = Number(x2) || 0;
    const penY = (Number(y) || 0) + li2 * font.lineHeight;
    if (align === 1) penX -= Math.round(widths[li2] * 0.5);
    else if (align === 2) penX -= widths[li2];
    for (let i = 0; i < line.length; i++) {
      const glyph = font.glyphs[line.charCodeAt(i) & 255];
      if (!glyph || !glyph.canvas) {
        penX += font.fallbackAdvance;
        continue;
      }
      ctx.drawImage(glyph.canvas, penX + (glyph.xoffset || 0), penY + (glyph.yoffset || 0));
      penX += glyph.xadvance || glyph.width || font.fallbackAdvance;
      drawn += 1;
    }
  }
  return drawn;
}

// vm/font_6x8.js
var FONT_6X8_WIDTH = 6;
var FONT_6X8_HEIGHT = 8;
var G = {
  " ": [],
  "!": ["..#..", "..#..", "..#..", "..#..", "..#..", ".....", "..#.."],
  '"': [".#.#.", ".#.#."],
  "#": [".#.#.", ".#.#.", "#####", ".#.#.", "#####", ".#.#.", ".#.#."],
  "$": ["..#..", ".####", "#.#..", ".###.", "..#.#", "####.", "..#.."],
  "%": ["##...", "##..#", "...#.", "..#..", ".#...", "#..##", "...##"],
  "&": [".##..", "#..#.", "#.#..", ".#...", "#.#.#", "#..#.", ".##.#"],
  "'": ["..#..", "..#..", ".#..."],
  "(": ["...#.", "..#..", ".#...", ".#...", ".#...", "..#..", "...#."],
  ")": [".#...", "..#..", "...#.", "...#.", "...#.", "..#..", ".#..."],
  "*": [".....", "..#..", "#.#.#", ".###.", "#.#.#", "..#.."],
  "+": [".....", "..#..", "..#..", "#####", "..#..", "..#.."],
  ",": [".....", ".....", ".....", ".....", ".....", ".##..", "..#..", ".#..."],
  "-": [".....", ".....", ".....", "#####"],
  ".": [".....", ".....", ".....", ".....", ".....", ".##..", ".##.."],
  "/": [".....", "....#", "...#.", "..#..", ".#...", "#...."],
  "0": [".###.", "#...#", "#..##", "#.#.#", "##..#", "#...#", ".###."],
  "1": ["..#..", ".##..", "..#..", "..#..", "..#..", "..#..", ".###."],
  "2": [".###.", "#...#", "....#", "..##.", ".#...", "#....", "#####"],
  "3": ["#####", "...#.", "..#..", "...#.", "....#", "#...#", ".###."],
  "4": ["...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#."],
  "5": ["#####", "#....", "####.", "....#", "....#", "#...#", ".###."],
  "6": ["..##.", ".#...", "#....", "####.", "#...#", "#...#", ".###."],
  "7": ["#####", "....#", "...#.", "..#..", ".#...", ".#...", ".#..."],
  "8": [".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###."],
  "9": [".###.", "#...#", "#...#", ".####", "....#", "...#.", ".##.."],
  ":": [".....", ".##..", ".##..", ".....", ".##..", ".##.."],
  ";": [".....", ".##..", ".##..", ".....", ".##..", "..#..", ".#..."],
  "<": ["...#.", "..#..", ".#...", "#....", ".#...", "..#..", "...#."],
  "=": [".....", ".....", "#####", ".....", "#####"],
  ">": [".#...", "..#..", "...#.", "....#", "...#.", "..#..", ".#..."],
  "?": [".###.", "#...#", "....#", "...#.", "..#..", ".....", "..#.."],
  "@": [".###.", "#...#", "#.###", "#.#.#", "#.###", "#....", ".###."],
  "A": [".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  "B": ["####.", "#...#", "#...#", "####.", "#...#", "#...#", "####."],
  "C": [".###.", "#...#", "#....", "#....", "#....", "#...#", ".###."],
  "D": ["###..", "#..#.", "#...#", "#...#", "#...#", "#..#.", "###.."],
  "E": ["#####", "#....", "#....", "####.", "#....", "#....", "#####"],
  "F": ["#####", "#....", "#....", "####.", "#....", "#....", "#...."],
  "G": [".###.", "#...#", "#....", "#.###", "#...#", "#...#", ".####"],
  "H": ["#...#", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  "I": [".###.", "..#..", "..#..", "..#..", "..#..", "..#..", ".###."],
  "J": ["..###", "...#.", "...#.", "...#.", "...#.", "#..#.", ".##.."],
  "K": ["#...#", "#..#.", "#.#..", "##...", "#.#..", "#..#.", "#...#"],
  "L": ["#....", "#....", "#....", "#....", "#....", "#....", "#####"],
  "M": ["#...#", "##.##", "#.#.#", "#.#.#", "#...#", "#...#", "#...#"],
  "N": ["#...#", "#...#", "##..#", "#.#.#", "#..##", "#...#", "#...#"],
  "O": [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  "P": ["####.", "#...#", "#...#", "####.", "#....", "#....", "#...."],
  "Q": [".###.", "#...#", "#...#", "#...#", "#.#.#", "#..#.", ".##.#"],
  "R": ["####.", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#"],
  "S": [".####", "#....", "#....", ".###.", "....#", "....#", "####."],
  "T": ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."],
  "U": ["#...#", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  "V": ["#...#", "#...#", "#...#", "#...#", "#...#", ".#.#.", "..#.."],
  "W": ["#...#", "#...#", "#...#", "#.#.#", "#.#.#", "#.#.#", ".#.#."],
  "X": ["#...#", "#...#", ".#.#.", "..#..", ".#.#.", "#...#", "#...#"],
  "Y": ["#...#", "#...#", ".#.#.", "..#..", "..#..", "..#..", "..#.."],
  "Z": ["#####", "....#", "...#.", "..#..", ".#...", "#....", "#####"],
  "[": [".###.", ".#...", ".#...", ".#...", ".#...", ".#...", ".###."],
  "\\": [".....", "#....", ".#...", "..#..", "...#.", "....#"],
  "]": [".###.", "...#.", "...#.", "...#.", "...#.", "...#.", ".###."],
  "^": ["..#..", ".#.#.", "#...#"],
  "_": [".....", ".....", ".....", ".....", ".....", ".....", "#####"],
  "`": [".#...", "..#..", "...#."],
  "a": [".....", ".....", ".###.", "....#", ".####", "#...#", ".####"],
  "b": ["#....", "#....", "#.##.", "##..#", "#...#", "#...#", "####."],
  "c": [".....", ".....", ".###.", "#....", "#....", "#...#", ".###."],
  "d": ["....#", "....#", ".##.#", "#..##", "#...#", "#...#", ".####"],
  "e": [".....", ".....", ".###.", "#...#", "#####", "#....", ".###."],
  "f": ["..##.", ".#..#", ".#...", "###..", ".#...", ".#...", ".#..."],
  "g": [".....", ".....", ".####", "#...#", "#...#", ".####", "....#", ".###."],
  "h": ["#....", "#....", "#.##.", "##..#", "#...#", "#...#", "#...#"],
  "i": ["..#..", ".....", ".##..", "..#..", "..#..", "..#..", ".###."],
  "j": ["...#.", ".....", "..##.", "...#.", "...#.", "...#.", "#..#.", ".##.."],
  "k": ["#....", "#....", "#..#.", "#.#..", "##...", "#.#..", "#..#."],
  "l": [".##..", "..#..", "..#..", "..#..", "..#..", "..#..", ".###."],
  "m": [".....", ".....", "##.#.", "#.#.#", "#.#.#", "#...#", "#...#"],
  "n": [".....", ".....", "#.##.", "##..#", "#...#", "#...#", "#...#"],
  "o": [".....", ".....", ".###.", "#...#", "#...#", "#...#", ".###."],
  "p": [".....", ".....", "####.", "#...#", "#...#", "####.", "#....", "#...."],
  "q": [".....", ".....", ".####", "#...#", "#...#", ".####", "....#", "....#"],
  "r": [".....", ".....", "#.##.", "##..#", "#....", "#....", "#...."],
  "s": [".....", ".....", ".####", "#....", ".###.", "....#", "####."],
  "t": [".#...", ".#...", "###..", ".#...", ".#...", ".#..#", "..##."],
  "u": [".....", ".....", "#...#", "#...#", "#...#", "#..##", ".##.#"],
  "v": [".....", ".....", "#...#", "#...#", "#...#", ".#.#.", "..#.."],
  "w": [".....", ".....", "#...#", "#...#", "#.#.#", "#.#.#", ".#.#."],
  "x": [".....", ".....", "#...#", ".#.#.", "..#..", ".#.#.", "#...#"],
  "y": [".....", ".....", "#...#", "#...#", "#...#", ".####", "....#", ".###."],
  "z": [".....", ".....", "#####", "...#.", "..#..", ".#...", "#####"],
  "{": ["...##", "..#..", "..#..", ".#...", "..#..", "..#..", "...##"],
  "|": ["..#..", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."],
  "}": ["##...", "..#..", "..#..", "...#.", "..#..", "..#..", "##..."],
  "~": [".....", ".....", ".#...", "#.#.#", "...#."],
  // Latin-1 punctuation
  "\xA1": ["..#..", ".....", "..#..", "..#..", "..#..", "..#..", "..#.."],
  "\xBF": ["..#..", ".....", "..#..", ".#...", "#....", "#...#", ".###."],
  "\xAB": [".....", "..#.#", ".#.#.", "#.#..", ".#.#.", "..#.#"],
  "\xBB": [".....", "#.#..", ".#.#.", "..#.#", ".#.#.", "#.#.."],
  "\xB0": [".##..", "#..#.", "#..#.", ".##.."],
  "\xAA": [".###.", "#..#.", ".###.", ".....", "####."],
  "\xBA": [".##..", "#..#.", ".##..", ".....", "####."],
  "\xB7": [".....", ".....", ".....", ".##..", ".##.."],
  "\xD7": [".....", "#...#", ".#.#.", "..#..", ".#.#.", "#...#"],
  "\xF7": [".....", "..#..", ".....", "#####", ".....", "..#.."],
  "\xA9": [".###.", "#...#", "#.###", "#.#.#", "#.###", "#...#", ".###."]
};
var ACCENTS = {
  grave: [".#...", "..#.."],
  acute: ["...#.", "..#.."],
  circumflex: ["..#..", ".#.#."],
  tilde: [".##.#", "#..#."],
  diaeresis: [".....", ".#.#."]
};
function accented(base, accent) {
  const rows2 = G[base];
  const body = base === base.toUpperCase() ? [rows2[0], rows2[1], rows2[3], rows2[4], rows2[6]] : base === "i" ? [".##..", "..#..", "..#..", "..#..", ".###."] : rows2.slice(2);
  return [...ACCENTS[accent], ...body];
}
function cedilla(base) {
  const out = G[base].slice(0, 7);
  out[7] = ".##..";
  return out;
}
var LATIN1 = [
  ["\xC0\xC1\xC2\xC3\xC4", "A"],
  ["\xC8\xC9\xCA\xCB", "E"],
  ["\xCC\xCD\xCE\xCF", "I"],
  ["\xD2\xD3\xD4\xD5\xD6", "O"],
  ["\xD9\xDA\xDB\xDC", "U"],
  ["\xE0\xE1\xE2\xE3\xE4", "a"],
  ["\xE8\xE9\xEA\xEB", "e"],
  ["\xEC\xED\xEE\xEF", "i"],
  ["\xF2\xF3\xF4\xF5\xF6", "o"],
  ["\xF9\xFA\xFB\xFC", "u"]
];
var ACCENT_ORDER = {
  A: ["grave", "acute", "circumflex", "tilde", "diaeresis"],
  E: ["grave", "acute", "circumflex", "diaeresis"],
  I: ["grave", "acute", "circumflex", "diaeresis"],
  O: ["grave", "acute", "circumflex", "tilde", "diaeresis"],
  U: ["grave", "acute", "circumflex", "diaeresis"]
};
for (const [chars, base] of LATIN1) {
  const order = ACCENT_ORDER[base.toUpperCase()];
  [...chars].forEach((ch, i) => {
    G[ch] = accented(base, order[i]);
  });
}
G["\xD1"] = accented("N", "tilde");
G["\xF1"] = accented("n", "tilde");
G["\xC7"] = cedilla("C");
G["\xE7"] = cedilla("c");
var rows = null;
function build() {
  rows = new Uint8Array(256 * FONT_6X8_HEIGHT);
  for (const [ch, glyph] of Object.entries(G)) {
    const code = ch.codePointAt(0);
    glyph.forEach((line, r) => {
      let bits = 0;
      for (let c = 0; c < 5; c++) {
        if (line[c] === "#") {
          bits |= 32 >> c;
        }
      }
      rows[code * FONT_6X8_HEIGHT + r] = bits;
    });
  }
  return rows;
}
var QUESTION = 63;
function font6x8Code(code) {
  const n = Number(code) || 0;
  if (n < 32 || n >= 127 && n < 160) {
    return 0;
  }
  if (n > 255 || !Object.prototype.hasOwnProperty.call(G, String.fromCharCode(n))) {
    return QUESTION;
  }
  return n;
}
function font6x8Pixel(code, col, row) {
  const table = rows || build();
  if (col < 0 || col >= FONT_6X8_WIDTH || row < 0 || row >= FONT_6X8_HEIGHT) {
    return false;
  }
  const c = font6x8Code(code);
  return (table[c * FONT_6X8_HEIGHT + row] & 32 >> col) !== 0;
}

// vendor/planck.js
/**
 * Planck.js v1.5.0
 * @license The MIT license
 * @copyright Copyright (c) 2026 Erin Catto, Ali Shakiba
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
var qr = function(i, t) {
  return qr = Object.setPrototypeOf || { __proto__: [] } instanceof Array && function(e, r) {
    e.__proto__ = r;
  } || function(e, r) {
    for (var s in r) Object.prototype.hasOwnProperty.call(r, s) && (e[s] = r[s]);
  }, qr(i, t);
};
function xt(i, t) {
  if (typeof t != "function" && t !== null) throw new TypeError("Class extends value " + String(t) + " is not a constructor or null");
  qr(i, t);
  function e() {
    this.constructor = i;
  }
  i.prototype = t === null ? Object.create(t) : (e.prototype = t.prototype, new e());
}
var dt = function() {
  return dt = Object.assign || function(t) {
    for (var e, r = 1, s = arguments.length; r < s; r++) {
      e = arguments[r];
      for (var o in e) Object.prototype.hasOwnProperty.call(e, o) && (t[o] = e[o]);
    }
    return t;
  }, dt.apply(this, arguments);
};
var qt = function(i, t) {
  (i === null || typeof i > "u") && (i = {});
  var e = dt({}, i);
  for (var r in t) t.hasOwnProperty(r) && typeof i[r] > "u" && (e[r] = t[r]);
  if (typeof Object.getOwnPropertySymbols == "function") for (var s = Object.getOwnPropertySymbols(t), o = 0; o < s.length; o++) {
    var n = s[o];
    t.propertyIsEnumerable(n) && typeof i[n] > "u" && (e[n] = t[n]);
  }
  return e;
};
var bo = Math.random;
var gt = 1e-9;
var wo = Number.isFinite;
function Vo(i) {
  return i |= i >> 1, i |= i >> 2, i |= i >> 4, i |= i >> 8, i |= i >> 16, i + 1;
}
function Co(i) {
  return i > 0 && (i & i - 1) === 0;
}
function so(i, t, e) {
  return typeof t > "u" ? (e = 1, t = 0) : typeof e > "u" && (e = t, t = 0), e > t ? (i = (i - t) % (e - t), i + (i < 0 ? e : t)) : (i = (i - e) % (t - e), i + (i <= 0 ? t : e));
}
function pt(i, t, e) {
  return i < t ? t : i > e ? e : i;
}
function Mo(i, t) {
  return typeof i > "u" ? (t = 1, i = 0) : typeof t > "u" && (t = i, i = 0), i === t ? i : bo() * (t - i) + i;
}
var ze = Object.create(Math);
ze.EPSILON = gt;
ze.isFinite = wo;
ze.nextPowerOfTwo = Vo;
ze.isPowerOfTwo = Co;
ze.mod = so;
ze.clamp = pt;
ze.random = Mo;
var ps = Math.abs;
var vr = Math.sqrt;
var vs = Math.max;
var ys = Math.min;
var a = (function() {
  function i(t, e) {
    if (!(this instanceof i)) return new i(t, e);
    typeof t > "u" ? (this.x = 0, this.y = 0) : typeof t == "object" ? (this.x = t.x, this.y = t.y) : (this.x = t, this.y = e);
  }
  return i.prototype._serialize = function() {
    return { x: this.x, y: this.y };
  }, i._deserialize = function(t) {
    var e = Object.create(i.prototype);
    return e.x = t.x, e.y = t.y, e;
  }, i.zero = function() {
    var t = Object.create(i.prototype);
    return t.x = 0, t.y = 0, t;
  }, i.neo = function(t, e) {
    var r = Object.create(i.prototype);
    return r.x = t, r.y = e, r;
  }, i.clone = function(t) {
    return i.neo(t.x, t.y);
  }, i.prototype.toString = function() {
    return JSON.stringify(this);
  }, i.isValid = function(t) {
    return t === null || typeof t > "u" ? false : Number.isFinite(t.x) && Number.isFinite(t.y);
  }, i.assert = function(t) {
  }, i.prototype.clone = function() {
    return i.clone(this);
  }, i.prototype.setZero = function() {
    return this.x = 0, this.y = 0, this;
  }, i.prototype.set = function(t, e) {
    return typeof t == "object" ? (this.x = t.x, this.y = t.y) : (this.x = t, this.y = e), this;
  }, i.prototype.setNum = function(t, e) {
    return this.x = t, this.y = e, this;
  }, i.prototype.setVec2 = function(t) {
    return this.x = t.x, this.y = t.y, this;
  }, i.prototype.wSet = function(t, e, r, s) {
    return typeof r < "u" || typeof s < "u" ? this.setCombine(t, e, r, s) : this.setMul(t, e);
  }, i.prototype.setCombine = function(t, e, r, s) {
    var o = t * e.x + r * s.x, n = t * e.y + r * s.y;
    return this.x = o, this.y = n, this;
  }, i.prototype.setMul = function(t, e) {
    var r = t * e.x, s = t * e.y;
    return this.x = r, this.y = s, this;
  }, i.prototype.add = function(t) {
    return this.x += t.x, this.y += t.y, this;
  }, i.prototype.wAdd = function(t, e, r, s) {
    return typeof r < "u" || typeof s < "u" ? this.addCombine(t, e, r, s) : this.addMul(t, e);
  }, i.prototype.addCombine = function(t, e, r, s) {
    var o = t * e.x + r * s.x, n = t * e.y + r * s.y;
    return this.x += o, this.y += n, this;
  }, i.prototype.addMul = function(t, e) {
    var r = t * e.x, s = t * e.y;
    return this.x += r, this.y += s, this;
  }, i.prototype.wSub = function(t, e, r, s) {
    return typeof r < "u" || typeof s < "u" ? this.subCombine(t, e, r, s) : this.subMul(t, e);
  }, i.prototype.subCombine = function(t, e, r, s) {
    var o = t * e.x + r * s.x, n = t * e.y + r * s.y;
    return this.x -= o, this.y -= n, this;
  }, i.prototype.subMul = function(t, e) {
    var r = t * e.x, s = t * e.y;
    return this.x -= r, this.y -= s, this;
  }, i.prototype.sub = function(t) {
    return this.x -= t.x, this.y -= t.y, this;
  }, i.prototype.mul = function(t) {
    return this.x *= t, this.y *= t, this;
  }, i.prototype.length = function() {
    return i.lengthOf(this);
  }, i.prototype.lengthSquared = function() {
    return i.lengthSquared(this);
  }, i.prototype.normalize = function() {
    var t = this.length();
    if (t < gt) return 0;
    var e = 1 / t;
    return this.x *= e, this.y *= e, t;
  }, i.normalize = function(t) {
    var e = i.lengthOf(t);
    if (e < gt) return i.zero();
    var r = 1 / e;
    return i.neo(t.x * r, t.y * r);
  }, i.lengthOf = function(t) {
    return vr(t.x * t.x + t.y * t.y);
  }, i.lengthSquared = function(t) {
    return t.x * t.x + t.y * t.y;
  }, i.distance = function(t, e) {
    var r = t.x - e.x, s = t.y - e.y;
    return vr(r * r + s * s);
  }, i.distanceSquared = function(t, e) {
    var r = t.x - e.x, s = t.y - e.y;
    return r * r + s * s;
  }, i.areEqual = function(t, e) {
    return t === e || typeof e == "object" && e !== null && t.x === e.x && t.y === e.y;
  }, i.skew = function(t) {
    return i.neo(-t.y, t.x);
  }, i.dot = function(t, e) {
    return t.x * e.x + t.y * e.y;
  }, i.cross = function(t, e) {
    return typeof e == "number" ? i.neo(e * t.y, -e * t.x) : typeof t == "number" ? i.neo(-t * e.y, t * e.x) : t.x * e.y - t.y * e.x;
  }, i.crossVec2Vec2 = function(t, e) {
    return t.x * e.y - t.y * e.x;
  }, i.crossVec2Num = function(t, e) {
    return i.neo(e * t.y, -e * t.x);
  }, i.crossNumVec2 = function(t, e) {
    return i.neo(-t * e.y, t * e.x);
  }, i.addCross = function(t, e, r) {
    if (typeof r == "number") return i.neo(r * e.y + t.x, -r * e.x + t.y);
    if (typeof e == "number") return i.neo(-e * r.y + t.x, e * r.x + t.y);
  }, i.addCrossVec2Num = function(t, e, r) {
    return i.neo(r * e.y + t.x, -r * e.x + t.y);
  }, i.addCrossNumVec2 = function(t, e, r) {
    return i.neo(-e * r.y + t.x, e * r.x + t.y);
  }, i.add = function(t, e) {
    return i.neo(t.x + e.x, t.y + e.y);
  }, i.wAdd = function(t, e, r, s) {
    return typeof r < "u" || typeof s < "u" ? i.combine(t, e, r, s) : i.mulNumVec2(t, e);
  }, i.combine = function(t, e, r, s) {
    return i.zero().setCombine(t, e, r, s);
  }, i.sub = function(t, e) {
    return i.neo(t.x - e.x, t.y - e.y);
  }, i.mul = function(t, e) {
    if (typeof t == "object") return i.neo(t.x * e, t.y * e);
    if (typeof e == "object") return i.neo(t * e.x, t * e.y);
  }, i.mulVec2Num = function(t, e) {
    return i.neo(t.x * e, t.y * e);
  }, i.mulNumVec2 = function(t, e) {
    return i.neo(t * e.x, t * e.y);
  }, i.prototype.neg = function() {
    return this.x = -this.x, this.y = -this.y, this;
  }, i.neg = function(t) {
    return i.neo(-t.x, -t.y);
  }, i.abs = function(t) {
    return i.neo(ps(t.x), ps(t.y));
  }, i.mid = function(t, e) {
    return i.neo((t.x + e.x) * 0.5, (t.y + e.y) * 0.5);
  }, i.upper = function(t, e) {
    return i.neo(vs(t.x, e.x), vs(t.y, e.y));
  }, i.lower = function(t, e) {
    return i.neo(ys(t.x, e.x), ys(t.y, e.y));
  }, i.prototype.clamp = function(t) {
    var e = this.x * this.x + this.y * this.y;
    if (e > t * t) {
      var r = t / vr(e);
      this.x *= r, this.y *= r;
    }
    return this;
  }, i.clamp = function(t, e) {
    var r = i.neo(t.x, t.y);
    return r.clamp(e), r;
  }, i.clampVec2 = function(t, e, r) {
    return { x: pt(t.x, e?.x, r?.x), y: pt(t.y, e?.y, r?.y) };
  }, i.scaleFn = function(t, e) {
    return function(r) {
      return i.neo(r.x * t, r.y * e);
    };
  }, i.translateFn = function(t, e) {
    return function(r) {
      return i.neo(r.x + t, r.y + e);
    };
  }, i;
})();
var Nt = Math.max;
var kt = Math.min;
var _t = (function() {
  function i(t, e) {
    if (!(this instanceof i)) return new i(t, e);
    this.lowerBound = a.zero(), this.upperBound = a.zero(), typeof t == "object" && this.lowerBound.setVec2(t), typeof e == "object" ? this.upperBound.setVec2(e) : typeof t == "object" && this.upperBound.setVec2(t);
  }
  return i.prototype.isValid = function() {
    return i.isValid(this);
  }, i.isValid = function(t) {
    return t === null || typeof t > "u" ? false : a.isValid(t.lowerBound) && a.isValid(t.upperBound) && a.sub(t.upperBound, t.lowerBound).lengthSquared() >= 0;
  }, i.assert = function(t) {
  }, i.prototype.getCenter = function() {
    return a.neo((this.lowerBound.x + this.upperBound.x) * 0.5, (this.lowerBound.y + this.upperBound.y) * 0.5);
  }, i.prototype.getExtents = function() {
    return a.neo((this.upperBound.x - this.lowerBound.x) * 0.5, (this.upperBound.y - this.lowerBound.y) * 0.5);
  }, i.prototype.getPerimeter = function() {
    return 2 * (this.upperBound.x - this.lowerBound.x + this.upperBound.y - this.lowerBound.y);
  }, i.prototype.combine = function(t, e) {
    e = e || this;
    var r = t.lowerBound, s = t.upperBound, o = e.lowerBound, n = e.upperBound, m = kt(r.x, o.x), h = kt(r.y, o.y), p = Nt(n.x, s.x), l = Nt(n.y, s.y);
    this.lowerBound.setNum(m, h), this.upperBound.setNum(p, l);
  }, i.prototype.combinePoints = function(t, e) {
    this.lowerBound.setNum(kt(t.x, e.x), kt(t.y, e.y)), this.upperBound.setNum(Nt(t.x, e.x), Nt(t.y, e.y));
  }, i.prototype.set = function(t) {
    this.lowerBound.setNum(t.lowerBound.x, t.lowerBound.y), this.upperBound.setNum(t.upperBound.x, t.upperBound.y);
  }, i.prototype.contains = function(t) {
    var e = true;
    return e = e && this.lowerBound.x <= t.lowerBound.x, e = e && this.lowerBound.y <= t.lowerBound.y, e = e && t.upperBound.x <= this.upperBound.x, e = e && t.upperBound.y <= this.upperBound.y, e;
  }, i.prototype.extend = function(t) {
    return i.extend(this, t), this;
  }, i.extend = function(t, e) {
    return t.lowerBound.x -= e, t.lowerBound.y -= e, t.upperBound.x += e, t.upperBound.y += e, t;
  }, i.testOverlap = function(t, e) {
    var r = e.lowerBound.x - t.upperBound.x, s = t.lowerBound.x - e.upperBound.x, o = e.lowerBound.y - t.upperBound.y, n = t.lowerBound.y - e.upperBound.y;
    return !(r > 0 || o > 0 || s > 0 || n > 0);
  }, i.areEqual = function(t, e) {
    return a.areEqual(t.lowerBound, e.lowerBound) && a.areEqual(t.upperBound, e.upperBound);
  }, i.diff = function(t, e) {
    var r = Nt(0, kt(t.upperBound.x, e.upperBound.x) - Nt(e.lowerBound.x, t.lowerBound.x)), s = Nt(0, kt(t.upperBound.y, e.upperBound.y) - Nt(e.lowerBound.y, t.lowerBound.y)), o = t.upperBound.x - t.lowerBound.x, n = t.upperBound.y - t.lowerBound.y, m = e.upperBound.x - e.lowerBound.x, h = e.upperBound.y - e.lowerBound.y;
    return o * n + m * h - r * s;
  }, i.prototype.rayCast = function(t, e) {
    var r = -1 / 0, s = 1 / 0, o = e.p1, n = a.sub(e.p2, e.p1), m = a.abs(n), h = a.zero();
    if (m.x < gt) {
      if (o.x < this.lowerBound.x || this.upperBound.x < o.x) return false;
    } else {
      var p = 1 / n.x, l = (this.lowerBound.x - o.x) * p, u = (this.upperBound.x - o.x) * p, c = -1;
      if (l > u) {
        var _ = l;
        l = u, u = _, c = 1;
      }
      if (l > r && (h.setZero(), h.x = c, r = l), s = kt(s, u), r > s) return false;
    }
    if (m.y < gt) {
      if (o.y < this.lowerBound.y || this.upperBound.y < o.y) return false;
    } else {
      var p = 1 / n.y, l = (this.lowerBound.y - o.y) * p, u = (this.upperBound.y - o.y) * p, c = -1;
      if (l > u) {
        var _ = l;
        l = u, u = _, c = 1;
      }
      if (l > r && (h.setZero(), h.y = c, r = l), s = kt(s, u), r > s) return false;
    }
    return r < 0 || e.maxFraction < r ? false : (t.fraction = r, t.normal = h, true);
  }, i.prototype.toString = function() {
    return JSON.stringify(this);
  }, i.combinePoints = function(t, e, r) {
    return t.lowerBound.x = kt(e.x, r.x), t.lowerBound.y = kt(e.y, r.y), t.upperBound.x = Nt(e.x, r.x), t.upperBound.y = Nt(e.y, r.y), t;
  }, i.combinedPerimeter = function(t, e) {
    var r = kt(t.lowerBound.x, e.lowerBound.x), s = kt(t.lowerBound.y, e.lowerBound.y), o = Nt(t.upperBound.x, e.upperBound.x), n = Nt(t.upperBound.y, e.upperBound.y);
    return 2 * (o - r + n - s);
  }, i;
})();
var Fi = Math.PI;
var R = (function() {
  function i() {
  }
  return Object.defineProperty(i, "polygonRadius", { get: function() {
    return 2 * i.linearSlop;
  }, enumerable: false, configurable: true }), i.lengthUnitsPerMeter = 1, i.maxManifoldPoints = 2, i.maxPolygonVertices = 12, i.aabbExtension = 0.1, i.aabbMultiplier = 2, i.linearSlop = 5e-3, i.angularSlop = 2 / 180 * Fi, i.maxSubSteps = 8, i.maxTOIContacts = 32, i.maxTOIIterations = 20, i.maxDistanceIterations = 20, i.velocityThreshold = 1, i.maxLinearCorrection = 0.2, i.maxAngularCorrection = 8 / 180 * Fi, i.maxTranslation = 2, i.maxRotation = 0.5 * Fi, i.baumgarte = 0.2, i.toiBaugarte = 0.75, i.timeToSleep = 0.5, i.linearSleepTolerance = 0.01, i.angularSleepTolerance = 2 / 180 * Fi, i;
})();
var z = (function() {
  function i() {
  }
  return Object.defineProperty(i, "maxManifoldPoints", { get: function() {
    return R.maxManifoldPoints;
  }, enumerable: false, configurable: true }), Object.defineProperty(i, "maxPolygonVertices", { get: function() {
    return R.maxPolygonVertices;
  }, enumerable: false, configurable: true }), Object.defineProperty(i, "aabbExtension", { get: function() {
    return R.aabbExtension * R.lengthUnitsPerMeter;
  }, enumerable: false, configurable: true }), Object.defineProperty(i, "aabbMultiplier", { get: function() {
    return R.aabbMultiplier;
  }, enumerable: false, configurable: true }), Object.defineProperty(i, "linearSlop", { get: function() {
    return R.linearSlop * R.lengthUnitsPerMeter;
  }, enumerable: false, configurable: true }), Object.defineProperty(i, "linearSlopSquared", { get: function() {
    return R.linearSlop * R.lengthUnitsPerMeter * R.linearSlop * R.lengthUnitsPerMeter;
  }, enumerable: false, configurable: true }), Object.defineProperty(i, "angularSlop", { get: function() {
    return R.angularSlop;
  }, enumerable: false, configurable: true }), Object.defineProperty(i, "polygonRadius", { get: function() {
    return 2 * R.linearSlop;
  }, enumerable: false, configurable: true }), Object.defineProperty(i, "maxSubSteps", { get: function() {
    return R.maxSubSteps;
  }, enumerable: false, configurable: true }), Object.defineProperty(i, "maxTOIContacts", { get: function() {
    return R.maxTOIContacts;
  }, enumerable: false, configurable: true }), Object.defineProperty(i, "maxTOIIterations", { get: function() {
    return R.maxTOIIterations;
  }, enumerable: false, configurable: true }), Object.defineProperty(i, "maxDistanceIterations", { get: function() {
    return R.maxDistanceIterations;
  }, enumerable: false, configurable: true }), Object.defineProperty(i, "velocityThreshold", { get: function() {
    return R.velocityThreshold * R.lengthUnitsPerMeter;
  }, enumerable: false, configurable: true }), Object.defineProperty(i, "maxLinearCorrection", { get: function() {
    return R.maxLinearCorrection * R.lengthUnitsPerMeter;
  }, enumerable: false, configurable: true }), Object.defineProperty(i, "maxAngularCorrection", { get: function() {
    return R.maxAngularCorrection;
  }, enumerable: false, configurable: true }), Object.defineProperty(i, "maxTranslation", { get: function() {
    return R.maxTranslation * R.lengthUnitsPerMeter;
  }, enumerable: false, configurable: true }), Object.defineProperty(i, "maxTranslationSquared", { get: function() {
    return R.maxTranslation * R.lengthUnitsPerMeter * R.maxTranslation * R.lengthUnitsPerMeter;
  }, enumerable: false, configurable: true }), Object.defineProperty(i, "maxRotation", { get: function() {
    return R.maxRotation;
  }, enumerable: false, configurable: true }), Object.defineProperty(i, "maxRotationSquared", { get: function() {
    return R.maxRotation * R.maxRotation;
  }, enumerable: false, configurable: true }), Object.defineProperty(i, "baumgarte", { get: function() {
    return R.baumgarte;
  }, enumerable: false, configurable: true }), Object.defineProperty(i, "toiBaugarte", { get: function() {
    return R.toiBaugarte;
  }, enumerable: false, configurable: true }), Object.defineProperty(i, "timeToSleep", { get: function() {
    return R.timeToSleep;
  }, enumerable: false, configurable: true }), Object.defineProperty(i, "linearSleepTolerance", { get: function() {
    return R.linearSleepTolerance * R.lengthUnitsPerMeter;
  }, enumerable: false, configurable: true }), Object.defineProperty(i, "linearSleepToleranceSqr", { get: function() {
    return R.linearSleepTolerance * R.lengthUnitsPerMeter * R.linearSleepTolerance * R.lengthUnitsPerMeter;
  }, enumerable: false, configurable: true }), Object.defineProperty(i, "angularSleepTolerance", { get: function() {
    return R.angularSleepTolerance;
  }, enumerable: false, configurable: true }), Object.defineProperty(i, "angularSleepToleranceSqr", { get: function() {
    return R.angularSleepTolerance * R.angularSleepTolerance;
  }, enumerable: false, configurable: true }), i;
})();
var Mi = (function() {
  function i(t) {
    this._list = [], this._max = 1 / 0, this._hasCreateFn = false, this._createCount = 0, this._hasAllocateFn = false, this._allocateCount = 0, this._hasReleaseFn = false, this._releaseCount = 0, this._hasDisposeFn = false, this._disposeCount = 0, this._list = [], this._max = t.max || this._max, this._createFn = t.create, this._hasCreateFn = typeof this._createFn == "function", this._allocateFn = t.allocate, this._hasAllocateFn = typeof this._allocateFn == "function", this._releaseFn = t.release, this._hasReleaseFn = typeof this._releaseFn == "function", this._disposeFn = t.dispose, this._hasDisposeFn = typeof this._disposeFn == "function";
  }
  return i.prototype.max = function(t) {
    return typeof t == "number" ? (this._max = t, this) : this._max;
  }, i.prototype.size = function() {
    return this._list.length;
  }, i.prototype.allocate = function() {
    var t;
    return this._list.length > 0 ? t = this._list.shift() : (this._createCount++, this._hasCreateFn ? t = this._createFn() : t = {}), this._allocateCount++, this._hasAllocateFn && this._allocateFn(t), t;
  }, i.prototype.release = function(t) {
    this._list.length < this._max ? (this._releaseCount++, this._hasReleaseFn && this._releaseFn(t), this._list.push(t)) : (this._disposeCount++, this._hasDisposeFn && (t = this._disposeFn(t)));
  }, i.prototype.toString = function() {
    return " +" + this._createCount + " >" + this._allocateCount + " <" + this._releaseCount + " -" + this._disposeCount + " =" + this._list.length + "/" + this._max;
  }, i;
})();
var fs = Math.abs;
var Pt = Math.max;
var oo = (function() {
  function i(t) {
    this.aabb = new _t(), this.userData = null, this.parent = null, this.child1 = null, this.child2 = null, this.height = -1, this.id = t;
  }
  return i.prototype.toString = function() {
    return this.id + ": " + this.userData;
  }, i.prototype.isLeaf = function() {
    return this.child1 == null;
  }, i;
})();
var ds = new Mi({ create: function() {
  return new oo();
}, release: function(i) {
  i.userData = null, i.parent = null, i.child1 = null, i.child2 = null, i.height = -1, i.id = void 0;
} });
var Gr = (function() {
  function i() {
    this.inputPool = new Mi({ create: function() {
      return {};
    }, release: function(t) {
    } }), this.stackPool = new Mi({ create: function() {
      return [];
    }, release: function(t) {
      t.length = 0;
    } }), this.iteratorPool = new Mi({ create: function() {
      return new Io();
    }, release: function(t) {
      t.close();
    } }), this.m_root = null, this.m_nodes = {}, this.m_lastProxyId = 0;
  }
  return i.prototype.getUserData = function(t) {
    var e = this.m_nodes[t];
    return e.userData;
  }, i.prototype.getFatAABB = function(t) {
    var e = this.m_nodes[t];
    return e.aabb;
  }, i.prototype.allocateNode = function() {
    var t = ds.allocate();
    return t.id = ++this.m_lastProxyId, this.m_nodes[t.id] = t, t;
  }, i.prototype.freeNode = function(t) {
    delete this.m_nodes[t.id], ds.release(t);
  }, i.prototype.createProxy = function(t, e) {
    var r = this.allocateNode();
    return r.aabb.set(t), _t.extend(r.aabb, z.aabbExtension), r.userData = e, r.height = 0, this.insertLeaf(r), r.id;
  }, i.prototype.destroyProxy = function(t) {
    var e = this.m_nodes[t];
    this.removeLeaf(e), this.freeNode(e);
  }, i.prototype.moveProxy = function(t, e, r) {
    var s = this.m_nodes[t];
    return s.aabb.contains(e) ? false : (this.removeLeaf(s), s.aabb.set(e), e = s.aabb, _t.extend(e, z.aabbExtension), r.x < 0 ? e.lowerBound.x += r.x * z.aabbMultiplier : e.upperBound.x += r.x * z.aabbMultiplier, r.y < 0 ? e.lowerBound.y += r.y * z.aabbMultiplier : e.upperBound.y += r.y * z.aabbMultiplier, this.insertLeaf(s), true);
  }, i.prototype.insertLeaf = function(t) {
    if (this.m_root == null) {
      this.m_root = t, this.m_root.parent = null;
      return;
    }
    for (var e = t.aabb, r = this.m_root; !r.isLeaf(); ) {
      var s = r.child1, o = r.child2, n = r.aabb.getPerimeter(), m = _t.combinedPerimeter(r.aabb, e), h = 2 * m, p = 2 * (m - n), l = _t.combinedPerimeter(e, s.aabb), u = l + p;
      if (!s.isLeaf()) {
        var c = s.aabb.getPerimeter();
        u -= c;
      }
      var _ = _t.combinedPerimeter(e, o.aabb), y = _ + p;
      if (!o.isLeaf()) {
        var c = o.aabb.getPerimeter();
        y -= c;
      }
      if (h < u && h < y) break;
      u < y ? r = s : r = o;
    }
    var v = r, f = v.parent, d = this.allocateNode();
    for (d.parent = f, d.userData = null, d.aabb.combine(e, v.aabb), d.height = v.height + 1, f != null ? (f.child1 === v ? f.child1 = d : f.child2 = d, d.child1 = v, d.child2 = t, v.parent = d, t.parent = d) : (d.child1 = v, d.child2 = t, v.parent = d, t.parent = d, this.m_root = d), r = t.parent; r != null; ) {
      r = this.balance(r);
      var s = r.child1, o = r.child2;
      r.height = 1 + Pt(s.height, o.height), r.aabb.combine(s.aabb, o.aabb), r = r.parent;
    }
  }, i.prototype.removeLeaf = function(t) {
    if (t === this.m_root) {
      this.m_root = null;
      return;
    }
    var e = t.parent, r = e.parent, s;
    if (e.child1 === t ? s = e.child2 : s = e.child1, r != null) {
      r.child1 === e ? r.child1 = s : r.child2 = s, s.parent = r, this.freeNode(e);
      for (var o = r; o != null; ) {
        o = this.balance(o);
        var n = o.child1, m = o.child2;
        o.aabb.combine(n.aabb, m.aabb), o.height = 1 + Pt(n.height, m.height), o = o.parent;
      }
    } else this.m_root = s, s.parent = null, this.freeNode(e);
  }, i.prototype.balance = function(t) {
    var e = t;
    if (e.isLeaf() || e.height < 2) return t;
    var r = e.child1, s = e.child2, o = s.height - r.height;
    if (o > 1) {
      var n = s.child1, m = s.child2;
      return s.child1 = e, s.parent = e.parent, e.parent = s, s.parent != null ? s.parent.child1 === t ? s.parent.child1 = s : s.parent.child2 = s : this.m_root = s, n.height > m.height ? (s.child2 = n, e.child2 = m, m.parent = e, e.aabb.combine(r.aabb, m.aabb), s.aabb.combine(e.aabb, n.aabb), e.height = 1 + Pt(r.height, m.height), s.height = 1 + Pt(e.height, n.height)) : (s.child2 = m, e.child2 = n, n.parent = e, e.aabb.combine(r.aabb, n.aabb), s.aabb.combine(e.aabb, m.aabb), e.height = 1 + Pt(r.height, n.height), s.height = 1 + Pt(e.height, m.height)), s;
    }
    if (o < -1) {
      var h = r.child1, p = r.child2;
      return r.child1 = e, r.parent = e.parent, e.parent = r, r.parent != null ? r.parent.child1 === e ? r.parent.child1 = r : r.parent.child2 = r : this.m_root = r, h.height > p.height ? (r.child2 = h, e.child1 = p, p.parent = e, e.aabb.combine(s.aabb, p.aabb), r.aabb.combine(e.aabb, h.aabb), e.height = 1 + Pt(s.height, p.height), r.height = 1 + Pt(e.height, h.height)) : (r.child2 = p, e.child1 = h, h.parent = e, e.aabb.combine(s.aabb, h.aabb), r.aabb.combine(e.aabb, p.aabb), e.height = 1 + Pt(s.height, h.height), r.height = 1 + Pt(e.height, p.height)), r;
    }
    return e;
  }, i.prototype.getHeight = function() {
    return this.m_root == null ? 0 : this.m_root.height;
  }, i.prototype.getAreaRatio = function() {
    if (this.m_root == null) return 0;
    for (var t = this.m_root, e = t.aabb.getPerimeter(), r = 0, s, o = this.iteratorPool.allocate().preorder(this.m_root); s = o.next(); ) s.height < 0 || (r += s.aabb.getPerimeter());
    return this.iteratorPool.release(o), r / e;
  }, i.prototype.computeHeight = function(t) {
    var e;
    if (typeof t < "u" ? e = this.m_nodes[t] : e = this.m_root, e.isLeaf()) return 0;
    var r = this.computeHeight(e.child1.id), s = this.computeHeight(e.child2.id);
    return 1 + Pt(r, s);
  }, i.prototype.validateStructure = function(t) {
    if (t != null) {
      this.m_root;
      var e = t.child1, r = t.child2;
      t.isLeaf() || (this.validateStructure(e), this.validateStructure(r));
    }
  }, i.prototype.validateMetrics = function(t) {
    if (t != null) {
      var e = t.child1, r = t.child2;
      t.isLeaf() || (this.validateMetrics(e), this.validateMetrics(r));
    }
  }, i.prototype.validate = function() {
  }, i.prototype.getMaxBalance = function() {
    for (var t = 0, e, r = this.iteratorPool.allocate().preorder(this.m_root); e = r.next(); ) if (!(e.height <= 1)) {
      var s = fs(e.child2.height - e.child1.height);
      t = Pt(t, s);
    }
    return this.iteratorPool.release(r), t;
  }, i.prototype.rebuildBottomUp = function() {
    for (var t = [], e = 0, r, s = this.iteratorPool.allocate().preorder(this.m_root); r = s.next(); ) r.height < 0 || (r.isLeaf() ? (r.parent = null, t[e] = r, ++e) : this.freeNode(r));
    for (this.iteratorPool.release(s); e > 1; ) {
      for (var o = 1 / 0, n = -1, m = -1, h = 0; h < e; ++h) for (var p = t[h].aabb, l = h + 1; l < e; ++l) {
        var u = t[l].aabb, c = _t.combinedPerimeter(p, u);
        c < o && (n = h, m = l, o = c);
      }
      var _ = t[n], y = t[m], v = this.allocateNode();
      v.child1 = _, v.child2 = y, v.height = 1 + Pt(_.height, y.height), v.aabb.combine(_.aabb, y.aabb), v.parent = null, _.parent = v, y.parent = v, t[m] = t[e - 1], t[n] = v, --e;
    }
    this.m_root = t[0];
  }, i.prototype.shiftOrigin = function(t) {
    for (var e, r = this.iteratorPool.allocate().preorder(this.m_root); e = r.next(); ) {
      var s = e.aabb;
      s.lowerBound.x -= t.x, s.lowerBound.y -= t.y, s.upperBound.x -= t.x, s.upperBound.y -= t.y;
    }
    this.iteratorPool.release(r);
  }, i.prototype.query = function(t, e) {
    var r = this.stackPool.allocate();
    for (r.push(this.m_root); r.length > 0; ) {
      var s = r.pop();
      if (s != null && _t.testOverlap(s.aabb, t)) if (s.isLeaf()) {
        var o = e(s.id);
        if (o === false) return;
      } else r.push(s.child1), r.push(s.child2);
    }
    this.stackPool.release(r);
  }, i.prototype.rayCast = function(t, e) {
    var r = t.p1, s = t.p2, o = a.sub(s, r);
    o.normalize();
    var n = a.crossNumVec2(1, o), m = a.abs(n), h = t.maxFraction, p = new _t(), l = a.combine(1 - h, r, h, s);
    p.combinePoints(r, l);
    var u = this.stackPool.allocate(), c = this.inputPool.allocate();
    for (u.push(this.m_root); u.length > 0; ) {
      var _ = u.pop();
      if (_ != null && _t.testOverlap(_.aabb, p) !== false) {
        var y = _.aabb.getCenter(), v = _.aabb.getExtents(), f = fs(a.dot(n, a.sub(r, y))) - a.dot(m, v);
        if (!(f > 0)) if (_.isLeaf()) {
          c.p1 = a.clone(t.p1), c.p2 = a.clone(t.p2), c.maxFraction = h;
          var d = e(c, _.id);
          if (d === 0) break;
          d > 0 && (h = d, l = a.combine(1 - h, r, h, s), p.combinePoints(r, l));
        } else u.push(_.child1), u.push(_.child2);
      }
    }
    this.stackPool.release(u), this.inputPool.release(c);
  }, i;
})();
var Io = (function() {
  function i() {
    this.parents = [], this.states = [];
  }
  return i.prototype.preorder = function(t) {
    return this.parents.length = 0, this.parents.push(t), this.states.length = 0, this.states.push(0), this;
  }, i.prototype.next = function() {
    for (; this.parents.length > 0; ) {
      var t = this.parents.length - 1, e = this.parents[t];
      if (this.states[t] === 0) return this.states[t] = 1, e;
      if (this.states[t] === 1 && (this.states[t] = 2, e.child1)) return this.parents.push(e.child1), this.states.push(1), e.child1;
      if (this.states[t] === 2 && (this.states[t] = 3, e.child2)) return this.parents.push(e.child2), this.states.push(1), e.child2;
      this.parents.pop(), this.states.pop();
    }
  }, i.prototype.close = function() {
    this.parents.length = 0;
  }, i;
})();
var Po = Math.max;
var zo = Math.min;
var no = (function() {
  function i() {
    var t = this;
    this.m_tree = new Gr(), this.m_moveBuffer = [], this.query = function(e, r) {
      t.m_tree.query(e, r);
    }, this.queryCallback = function(e) {
      if (e === t.m_queryProxyId) return true;
      var r = zo(e, t.m_queryProxyId), s = Po(e, t.m_queryProxyId), o = t.m_tree.getUserData(r), n = t.m_tree.getUserData(s);
      return t.m_callback(o, n), true;
    };
  }
  return i.prototype.getUserData = function(t) {
    return this.m_tree.getUserData(t);
  }, i.prototype.testOverlap = function(t, e) {
    var r = this.m_tree.getFatAABB(t), s = this.m_tree.getFatAABB(e);
    return _t.testOverlap(r, s);
  }, i.prototype.getFatAABB = function(t) {
    return this.m_tree.getFatAABB(t);
  }, i.prototype.getProxyCount = function() {
    return this.m_moveBuffer.length;
  }, i.prototype.getTreeHeight = function() {
    return this.m_tree.getHeight();
  }, i.prototype.getTreeBalance = function() {
    return this.m_tree.getMaxBalance();
  }, i.prototype.getTreeQuality = function() {
    return this.m_tree.getAreaRatio();
  }, i.prototype.rayCast = function(t, e) {
    this.m_tree.rayCast(t, e);
  }, i.prototype.shiftOrigin = function(t) {
    this.m_tree.shiftOrigin(t);
  }, i.prototype.createProxy = function(t, e) {
    var r = this.m_tree.createProxy(t, e);
    return this.bufferMove(r), r;
  }, i.prototype.destroyProxy = function(t) {
    this.unbufferMove(t), this.m_tree.destroyProxy(t);
  }, i.prototype.moveProxy = function(t, e, r) {
    var s = this.m_tree.moveProxy(t, e, r);
    s && this.bufferMove(t);
  }, i.prototype.touchProxy = function(t) {
    this.bufferMove(t);
  }, i.prototype.bufferMove = function(t) {
    this.m_moveBuffer.push(t);
  }, i.prototype.unbufferMove = function(t) {
    for (var e = 0; e < this.m_moveBuffer.length; ++e) this.m_moveBuffer[e] === t && (this.m_moveBuffer[e] = null);
  }, i.prototype.updatePairs = function(t) {
    for (this.m_callback = t; this.m_moveBuffer.length > 0; ) if (this.m_queryProxyId = this.m_moveBuffer.pop(), this.m_queryProxyId !== null) {
      var e = this.m_tree.getFatAABB(this.m_queryProxyId);
      this.m_tree.query(e, this.queryCallback);
    }
  }, i;
})();
var ao = Math.sin;
var mo = Math.cos;
var Qr = Math.sqrt;
function g(i, t) {
  return { x: i, y: t };
}
function So(i) {
  return { s: ao(i), c: mo(i) };
}
function ut(i, t, e) {
  return i.x = t, i.y = e, i;
}
function x(i, t) {
  return i.x = t.x, i.y = t.y, i;
}
function S(i) {
  return i.x = 0, i.y = 0, i;
}
function Pi(i) {
  return i.x = -i.x, i.y = -i.y, i;
}
function Jt(i, t) {
  return i.x += t.x, i.y += t.y, i;
}
function Lo(i, t, e) {
  return i.x = t.x + e.x, i.y = t.y + e.y, i;
}
function ve(i, t) {
  return i.x -= t.x, i.y -= t.y, i;
}
function N(i, t, e) {
  return i.x = t.x - e.x, i.y = t.y - e.y, i;
}
function xs(i, t) {
  return i.x *= t, i.y *= t, i;
}
function L(i, t, e) {
  return i.x = t * e.x, i.y = t * e.y, i;
}
function Xt(i, t, e) {
  return i.x += t * e.x, i.y += t * e.y, i;
}
function Ci(i, t, e) {
  return i.x -= t * e.x, i.y -= t * e.y, i;
}
function G2(i, t, e, r, s) {
  return i.x = t * e.x + r * s.x, i.y = t * e.y + r * s.y, i;
}
function se(i, t, e, r, s, o, n) {
  return i.x = t * e.x + r * s.x + o * n.x, i.y = t * e.y + r * s.y + o * n.y, i;
}
function Fo(i) {
  var t = Qr(i.x * i.x + i.y * i.y);
  if (t !== 0) {
    var e = 1 / t;
    i.x *= e, i.y *= e;
  }
  return t;
}
function Kt(i) {
  var t = Qr(i.x * i.x + i.y * i.y);
  if (t > 0) {
    var e = 1 / t;
    i.x *= e, i.y *= e;
  }
  return i;
}
function je(i, t, e) {
  var r = e * t.y, s = -e * t.x;
  return i.x = r, i.y = s, i;
}
function Lt(i, t, e) {
  var r = -t * e.y, s = t * e.x;
  return i.x = r, i.y = s, i;
}
function E(i, t) {
  return i.x * t.y - i.y * t.x;
}
function C(i, t) {
  return i.x * t.x + i.y * t.y;
}
function Ue(i) {
  return i.x * i.x + i.y * i.y;
}
function ho(i, t) {
  var e = i.x - t.x, r = i.y - t.y;
  return Qr(e * e + r * r);
}
function He(i, t) {
  var e = i.x - t.x, r = i.y - t.y;
  return e * e + r * r;
}
function qo(i, t) {
  return i.c = mo(t), i.s = ao(t), i;
}
function $t(i, t, e) {
  return i.x = t.c * e.x - t.s * e.y, i.y = t.s * e.x + t.c * e.y, i;
}
function ci(i, t, e) {
  var r = t.c * e.x + t.s * e.y, s = -t.s * e.x + t.c * e.y;
  return i.x = r, i.y = s, i;
}
function To(i, t, e, r) {
  var s = t.c * r.x + t.s * r.y, o = -t.s * r.x + t.c * r.y, n = e.c * s - e.s * o, m = e.s * s + e.c * o;
  return i.x = n, i.y = m, i;
}
function Ze(i, t, e) {
  return { p: g(i, t), q: So(e) };
}
function ar(i, t) {
  return i.p.x = t.p.x, i.p.y = t.p.y, i.q.s = t.q.s, i.q.c = t.q.c, i;
}
function T(i, t, e) {
  var r = t.q.c * e.x - t.q.s * e.y + t.p.x, s = t.q.s * e.x + t.q.c * e.y + t.p.y;
  return i.x = r, i.y = s, i;
}
function ts(i, t, e) {
  var r = e.x - t.p.x, s = e.y - t.p.y, o = t.q.c * r + t.q.s * s, n = -t.q.s * r + t.q.c * s;
  return i.x = o, i.y = n, i;
}
function lo(i, t, e, r) {
  var s = t.q.c * r.x - t.q.s * r.y + t.p.x, o = t.q.s * r.x + t.q.c * r.y + t.p.y, n = s - e.p.x, m = o - e.p.y, h = e.q.c * n + e.q.s * m, p = -e.q.s * n + e.q.c * m;
  return i.x = h, i.y = p, i;
}
function co(i, t, e) {
  var r = t.q.c * e.q.c + t.q.s * e.q.s, s = t.q.c * e.q.s - t.q.s * e.q.c, o = t.q.c * (e.p.x - t.p.x) + t.q.s * (e.p.y - t.p.y), n = -t.q.s * (e.p.x - t.p.x) + t.q.c * (e.p.y - t.p.y);
  return i.q.c = r, i.q.s = s, i.p.x = o, i.p.y = n, i;
}
var As = Math.sin;
var gs = Math.cos;
var No = Math.atan2;
var B = (function() {
  function i(t) {
    if (!(this instanceof i)) return new i(t);
    typeof t == "number" ? this.setAngle(t) : typeof t == "object" ? this.setRot(t) : this.setIdentity();
  }
  return i.neo = function(t) {
    var e = Object.create(i.prototype);
    return e.setAngle(t), e;
  }, i.clone = function(t) {
    var e = Object.create(i.prototype);
    return e.s = t.s, e.c = t.c, e;
  }, i.identity = function() {
    var t = Object.create(i.prototype);
    return t.s = 0, t.c = 1, t;
  }, i.isValid = function(t) {
    return t === null || typeof t > "u" ? false : Number.isFinite(t.s) && Number.isFinite(t.c);
  }, i.assert = function(t) {
  }, i.prototype.setIdentity = function() {
    this.s = 0, this.c = 1;
  }, i.prototype.set = function(t) {
    typeof t == "object" ? (this.s = t.s, this.c = t.c) : (this.s = As(t), this.c = gs(t));
  }, i.prototype.setRot = function(t) {
    this.s = t.s, this.c = t.c;
  }, i.prototype.setAngle = function(t) {
    this.s = As(t), this.c = gs(t);
  }, i.prototype.getAngle = function() {
    return No(this.s, this.c);
  }, i.prototype.getXAxis = function() {
    return a.neo(this.c, this.s);
  }, i.prototype.getYAxis = function() {
    return a.neo(-this.s, this.c);
  }, i.mul = function(t, e) {
    if ("c" in e && "s" in e) {
      var r = i.identity();
      return r.s = t.s * e.c + t.c * e.s, r.c = t.c * e.c - t.s * e.s, r;
    } else if ("x" in e && "y" in e) return a.neo(t.c * e.x - t.s * e.y, t.s * e.x + t.c * e.y);
  }, i.mulRot = function(t, e) {
    var r = i.identity();
    return r.s = t.s * e.c + t.c * e.s, r.c = t.c * e.c - t.s * e.s, r;
  }, i.mulVec2 = function(t, e) {
    return a.neo(t.c * e.x - t.s * e.y, t.s * e.x + t.c * e.y);
  }, i.mulSub = function(t, e, r) {
    var s = t.c * (e.x - r.x) - t.s * (e.y - r.y), o = t.s * (e.x - r.x) + t.c * (e.y - r.y);
    return a.neo(s, o);
  }, i.mulT = function(t, e) {
    if ("c" in e && "s" in e) {
      var r = i.identity();
      return r.s = t.c * e.s - t.s * e.c, r.c = t.c * e.c + t.s * e.s, r;
    } else if ("x" in e && "y" in e) return a.neo(t.c * e.x + t.s * e.y, -t.s * e.x + t.c * e.y);
  }, i.mulTRot = function(t, e) {
    var r = i.identity();
    return r.s = t.c * e.s - t.s * e.c, r.c = t.c * e.c + t.s * e.s, r;
  }, i.mulTVec2 = function(t, e) {
    return a.neo(t.c * e.x + t.s * e.y, -t.s * e.x + t.c * e.y);
  }, i;
})();
var ko = Math.atan2;
var Bs = Math.PI;
var qe = g(0, 0);
var Ie = (function() {
  function i() {
    this.localCenter = a.zero(), this.c = a.zero(), this.a = 0, this.alpha0 = 0, this.c0 = a.zero(), this.a0 = 0;
  }
  return i.prototype.recycle = function() {
    S(this.localCenter), S(this.c), this.a = 0, this.alpha0 = 0, S(this.c0), this.a0 = 0;
  }, i.prototype.setTransform = function(t) {
    T(qe, t, this.localCenter), x(this.c, qe), x(this.c0, qe), this.a = this.a0 = ko(t.q.s, t.q.c);
  }, i.prototype.setLocalCenter = function(t, e) {
    x(this.localCenter, t), T(qe, e, this.localCenter), x(this.c, qe), x(this.c0, qe);
  }, i.prototype.getTransform = function(t, e) {
    e === void 0 && (e = 0), qo(t.q, (1 - e) * this.a0 + e * this.a), G2(t.p, 1 - e, this.c0, e, this.c), ve(t.p, $t(qe, t.q, this.localCenter));
  }, i.prototype.advance = function(t) {
    var e = (t - this.alpha0) / (1 - this.alpha0);
    G2(this.c0, e, this.c, 1 - e, this.c0), this.a0 = e * this.a + (1 - e) * this.a0, this.alpha0 = t;
  }, i.prototype.forward = function() {
    this.a0 = this.a, x(this.c0, this.c);
  }, i.prototype.normalize = function() {
    var t = so(this.a0, -Bs, +Bs);
    this.a -= this.a0 - t, this.a0 = t;
  }, i.prototype.set = function(t) {
    x(this.localCenter, t.localCenter), x(this.c, t.c), this.a = t.a, this.alpha0 = t.alpha0, x(this.c0, t.c0), this.a0 = t.a0;
  }, i;
})();
var ft = (function() {
  function i(t, e) {
    if (!(this instanceof i)) return new i(t, e);
    this.p = a.zero(), this.q = B.identity(), typeof t < "u" && this.p.setVec2(t), typeof e < "u" && this.q.setAngle(e);
  }
  return i.clone = function(t) {
    var e = Object.create(i.prototype);
    return e.p = a.clone(t.p), e.q = B.clone(t.q), e;
  }, i.neo = function(t, e) {
    var r = Object.create(i.prototype);
    return r.p = a.clone(t), r.q = B.clone(e), r;
  }, i.identity = function() {
    var t = Object.create(i.prototype);
    return t.p = a.zero(), t.q = B.identity(), t;
  }, i.prototype.setIdentity = function() {
    this.p.setZero(), this.q.setIdentity();
  }, i.prototype.set = function(t, e) {
    typeof e > "u" ? (this.p.set(t.p), this.q.set(t.q)) : (this.p.set(t), this.q.set(e));
  }, i.prototype.setNum = function(t, e) {
    this.p.setVec2(t), this.q.setAngle(e);
  }, i.prototype.setTransform = function(t) {
    this.p.setVec2(t.p), this.q.setRot(t.q);
  }, i.isValid = function(t) {
    return t === null || typeof t > "u" ? false : a.isValid(t.p) && B.isValid(t.q);
  }, i.assert = function(t) {
  }, i.mul = function(t, e) {
    if (Array.isArray(e)) {
      for (var r = [], s = 0; s < e.length; s++) r[s] = i.mul(t, e[s]);
      return r;
    } else {
      if ("x" in e && "y" in e) return i.mulVec2(t, e);
      if ("p" in e && "q" in e) return i.mulXf(t, e);
    }
  }, i.mulAll = function(t, e) {
    for (var r = [], s = 0; s < e.length; s++) r[s] = i.mul(t, e[s]);
    return r;
  }, i.mulFn = function(t) {
    return function(e) {
      return i.mul(t, e);
    };
  }, i.mulVec2 = function(t, e) {
    var r = t.q.c * e.x - t.q.s * e.y + t.p.x, s = t.q.s * e.x + t.q.c * e.y + t.p.y;
    return a.neo(r, s);
  }, i.mulXf = function(t, e) {
    var r = i.identity();
    return r.q = B.mulRot(t.q, e.q), r.p = a.add(B.mulVec2(t.q, e.p), t.p), r;
  }, i.mulT = function(t, e) {
    if ("x" in e && "y" in e) return i.mulTVec2(t, e);
    if ("p" in e && "q" in e) return i.mulTXf(t, e);
  }, i.mulTVec2 = function(t, e) {
    var r = e.x - t.p.x, s = e.y - t.p.y, o = t.q.c * r + t.q.s * s, n = -t.q.s * r + t.q.c * s;
    return a.neo(o, n);
  }, i.mulTXf = function(t, e) {
    var r = i.identity();
    return r.q.setRot(B.mulTRot(t.q, e.q)), r.p.setVec2(B.mulTVec2(t.q, a.sub(e.p, t.p))), r;
  }, i;
})();
var Do = /* @__PURE__ */ (function() {
  function i() {
    this.v = a.zero(), this.w = 0;
  }
  return i;
})();
var _o = Math.sin;
var uo = Math.cos;
var Ro = (function() {
  function i() {
    this.c = a.zero(), this.a = 0;
  }
  return i.prototype.getTransform = function(t, e) {
    return t.q.c = uo(this.a), t.q.s = _o(this.a), t.p.x = this.c.x - (t.q.c * e.x - t.q.s * e.y), t.p.y = this.c.y - (t.q.s * e.x + t.q.c * e.y), t;
  }, i;
})();
function qi(i, t, e, r) {
  return i.q.c = uo(r), i.q.s = _o(r), i.p.x = e.x - (i.q.c * t.x - i.q.s * t.y), i.p.y = e.y - (i.q.s * t.x + i.q.c * t.y), i;
}
var Se = (function() {
  function i() {
    this.style = {}, this.appData = {};
  }
  return i.isValid = function(t) {
    return t === null || typeof t > "u" ? false : typeof t.m_type == "string" && typeof t.m_radius == "number";
  }, i;
})();
var bs = new _t();
var ws = new _t();
var Vs = g(0, 0);
var Eo = { userData: null, friction: 0.2, restitution: 0, density: 0, isSensor: false, filterGroupIndex: 0, filterCategoryBits: 1, filterMaskBits: 65535 };
var Tr = /* @__PURE__ */ (function() {
  function i(t, e) {
    this.aabb = new _t(), this.fixture = t, this.childIndex = e;
  }
  return i;
})();
var zi = (function() {
  function i(t, e, r) {
    this.style = {}, this.appData = {}, e.shape ? (r = e, e = e.shape) : typeof r == "number" && (r = { density: r }), r = qt(r, Eo), this.m_body = t, this.m_friction = r.friction, this.m_restitution = r.restitution, this.m_density = r.density, this.m_isSensor = r.isSensor, this.m_filterGroupIndex = r.filterGroupIndex, this.m_filterCategoryBits = r.filterCategoryBits, this.m_filterMaskBits = r.filterMaskBits, this.m_shape = e, this.m_next = null, this.m_proxies = [], this.m_proxyCount = 0;
    for (var s = this.m_shape.getChildCount(), o = 0; o < s; ++o) this.m_proxies[o] = new Tr(this, o);
    this.m_userData = r.userData, typeof r.style == "object" && r.style !== null && (this.style = r.style);
  }
  return i.prototype._reset = function() {
    var t = this.getBody(), e = t.m_world.m_broadPhase;
    this.destroyProxies(e), this.m_shape._reset && this.m_shape._reset();
    for (var r = this.m_shape.getChildCount(), s = 0; s < r; ++s) this.m_proxies[s] = new Tr(this, s);
    this.createProxies(e, t.m_xf), t.resetMassData();
  }, i.prototype._serialize = function() {
    return { friction: this.m_friction, restitution: this.m_restitution, density: this.m_density, isSensor: this.m_isSensor, filterGroupIndex: this.m_filterGroupIndex, filterCategoryBits: this.m_filterCategoryBits, filterMaskBits: this.m_filterMaskBits, shape: this.m_shape };
  }, i._deserialize = function(t, e, r) {
    var s = r(Se, t.shape), o = s && new i(e, s, t);
    return o;
  }, i.prototype.getType = function() {
    return this.m_shape.m_type;
  }, i.prototype.getShape = function() {
    return this.m_shape;
  }, i.prototype.isSensor = function() {
    return this.m_isSensor;
  }, i.prototype.setSensor = function(t) {
    t != this.m_isSensor && (this.m_body.setAwake(true), this.m_isSensor = t);
  }, i.prototype.getUserData = function() {
    return this.m_userData;
  }, i.prototype.setUserData = function(t) {
    this.m_userData = t;
  }, i.prototype.getBody = function() {
    return this.m_body;
  }, i.prototype.getNext = function() {
    return this.m_next;
  }, i.prototype.getDensity = function() {
    return this.m_density;
  }, i.prototype.setDensity = function(t) {
    this.m_density = t;
  }, i.prototype.getFriction = function() {
    return this.m_friction;
  }, i.prototype.setFriction = function(t) {
    this.m_friction = t;
  }, i.prototype.getRestitution = function() {
    return this.m_restitution;
  }, i.prototype.setRestitution = function(t) {
    this.m_restitution = t;
  }, i.prototype.testPoint = function(t) {
    return this.m_shape.testPoint(this.m_body.getTransform(), t);
  }, i.prototype.rayCast = function(t, e, r) {
    return this.m_shape.rayCast(t, e, this.m_body.getTransform(), r);
  }, i.prototype.getMassData = function(t) {
    this.m_shape.computeMass(t, this.m_density);
  }, i.prototype.getAABB = function(t) {
    return this.m_proxies[t].aabb;
  }, i.prototype.createProxies = function(t, e) {
    this.m_proxyCount = this.m_shape.getChildCount();
    for (var r = 0; r < this.m_proxyCount; ++r) {
      var s = this.m_proxies[r];
      this.m_shape.computeAABB(s.aabb, e, r), s.proxyId = t.createProxy(s.aabb, s);
    }
  }, i.prototype.destroyProxies = function(t) {
    for (var e = 0; e < this.m_proxyCount; ++e) {
      var r = this.m_proxies[e];
      t.destroyProxy(r.proxyId), r.proxyId = null;
    }
    this.m_proxyCount = 0;
  }, i.prototype.synchronize = function(t, e, r) {
    for (var s = 0; s < this.m_proxyCount; ++s) {
      var o = this.m_proxies[s];
      this.m_shape.computeAABB(bs, e, o.childIndex), this.m_shape.computeAABB(ws, r, o.childIndex), o.aabb.combine(bs, ws), N(Vs, r.p, e.p), t.moveProxy(o.proxyId, o.aabb, Vs);
    }
  }, i.prototype.setFilterData = function(t) {
    this.m_filterGroupIndex = t.groupIndex, this.m_filterCategoryBits = t.categoryBits, this.m_filterMaskBits = t.maskBits, this.refilter();
  }, i.prototype.getFilterGroupIndex = function() {
    return this.m_filterGroupIndex;
  }, i.prototype.setFilterGroupIndex = function(t) {
    this.m_filterGroupIndex = t, this.refilter();
  }, i.prototype.getFilterCategoryBits = function() {
    return this.m_filterCategoryBits;
  }, i.prototype.setFilterCategoryBits = function(t) {
    this.m_filterCategoryBits = t, this.refilter();
  }, i.prototype.getFilterMaskBits = function() {
    return this.m_filterMaskBits;
  }, i.prototype.setFilterMaskBits = function(t) {
    this.m_filterMaskBits = t, this.refilter();
  }, i.prototype.refilter = function() {
    if (this.m_body != null) {
      for (var t = this.m_body.getContactList(); t; ) {
        var e = t.contact, r = e.getFixtureA(), s = e.getFixtureB();
        (r == this || s == this) && e.flagForFiltering(), t = t.next;
      }
      var o = this.m_body.getWorld();
      if (o != null) for (var n = o.m_broadPhase, m = 0; m < this.m_proxyCount; ++m) n.touchProxy(this.m_proxies[m].proxyId);
    }
  }, i.prototype.shouldCollide = function(t) {
    if (t.m_filterGroupIndex === this.m_filterGroupIndex && t.m_filterGroupIndex !== 0) return t.m_filterGroupIndex > 0;
    var e = (t.m_filterMaskBits & this.m_filterCategoryBits) !== 0, r = (t.m_filterCategoryBits & this.m_filterMaskBits) !== 0, s = e && r;
    return s;
  }, i;
})();
var li = "static";
var Cs = "kinematic";
var jt = "dynamic";
var Ti = g(0, 0);
var Te = g(0, 0);
var Ni = g(0, 0);
var ki = g(0, 0);
var Ms = Ze(0, 0, 0);
var Oo = { type: li, position: a.zero(), angle: 0, linearVelocity: a.zero(), angularVelocity: 0, linearDamping: 0, angularDamping: 0, fixedRotation: false, bullet: false, gravityScale: 1, allowSleep: true, awake: true, active: true, userData: null };
var W = (function() {
  function i(t, e) {
    this.style = {}, this.appData = {}, e = qt(e, Oo), this.m_world = t, this.m_awakeFlag = e.awake, this.m_autoSleepFlag = e.allowSleep, this.m_bulletFlag = e.bullet, this.m_fixedRotationFlag = e.fixedRotation, this.m_activeFlag = e.active, this.m_islandFlag = false, this.m_toiFlag = false, this.m_userData = e.userData, this.m_type = e.type, this.m_type == jt ? (this.m_mass = 1, this.m_invMass = 1) : (this.m_mass = 0, this.m_invMass = 0), this.m_I = 0, this.m_invI = 0, this.m_xf = ft.identity(), this.m_xf.p.setVec2(e.position), this.m_xf.q.setAngle(e.angle), this.m_sweep = new Ie(), this.m_sweep.setTransform(this.m_xf), this.c_velocity = new Do(), this.c_position = new Ro(), this.m_force = a.zero(), this.m_torque = 0, this.m_linearVelocity = a.clone(e.linearVelocity), this.m_angularVelocity = e.angularVelocity, this.m_linearDamping = e.linearDamping, this.m_angularDamping = e.angularDamping, this.m_gravityScale = e.gravityScale, this.m_sleepTime = 0, this.m_jointList = null, this.m_contactList = null, this.m_fixtureList = null, this.m_prev = null, this.m_next = null, this.m_destroyed = false, typeof e.style == "object" && e.style !== null && (this.style = e.style);
  }
  return i.prototype._serialize = function() {
    for (var t = [], e = this.m_fixtureList; e; e = e.m_next) t.push(e);
    return { type: this.m_type, bullet: this.m_bulletFlag, fixedRotation: this.m_fixedRotationFlag, position: this.m_xf.p, angle: this.m_xf.q.getAngle(), linearVelocity: this.m_linearVelocity, angularVelocity: this.m_angularVelocity, fixtures: t };
  }, i._deserialize = function(t, e, r) {
    var s = new i(e, t);
    if (t.fixtures) for (var o = t.fixtures.length - 1; o >= 0; o--) {
      var n = r(zi, t.fixtures[o], s);
      s._addFixture(n);
    }
    return s;
  }, i.prototype.isWorldLocked = function() {
    return !!(this.m_world && this.m_world.isLocked());
  }, i.prototype.getWorld = function() {
    return this.m_world;
  }, i.prototype.getNext = function() {
    return this.m_next;
  }, i.prototype.setUserData = function(t) {
    this.m_userData = t;
  }, i.prototype.getUserData = function() {
    return this.m_userData;
  }, i.prototype.getFixtureList = function() {
    return this.m_fixtureList;
  }, i.prototype.getJointList = function() {
    return this.m_jointList;
  }, i.prototype.getContactList = function() {
    return this.m_contactList;
  }, i.prototype.isStatic = function() {
    return this.m_type == li;
  }, i.prototype.isDynamic = function() {
    return this.m_type == jt;
  }, i.prototype.isKinematic = function() {
    return this.m_type == Cs;
  }, i.prototype.setStatic = function() {
    return this.setType(li), this;
  }, i.prototype.setDynamic = function() {
    return this.setType(jt), this;
  }, i.prototype.setKinematic = function() {
    return this.setType(Cs), this;
  }, i.prototype.getType = function() {
    return this.m_type;
  }, i.prototype.setType = function(t) {
    if (this.isWorldLocked() != true && this.m_type != t) {
      this.m_type = t, this.resetMassData(), this.m_type == li && (this.m_linearVelocity.setZero(), this.m_angularVelocity = 0, this.m_sweep.forward(), this.synchronizeFixtures()), this.setAwake(true), this.m_force.setZero(), this.m_torque = 0;
      for (var e = this.m_contactList; e; ) {
        var r = e;
        e = e.next, this.m_world.destroyContact(r.contact);
      }
      this.m_contactList = null;
      for (var s = this.m_world.m_broadPhase, o = this.m_fixtureList; o; o = o.m_next) for (var n = 0; n < o.m_proxyCount; ++n) s.touchProxy(o.m_proxies[n].proxyId);
    }
  }, i.prototype.isBullet = function() {
    return this.m_bulletFlag;
  }, i.prototype.setBullet = function(t) {
    this.m_bulletFlag = !!t;
  }, i.prototype.isSleepingAllowed = function() {
    return this.m_autoSleepFlag;
  }, i.prototype.setSleepingAllowed = function(t) {
    this.m_autoSleepFlag = !!t, this.m_autoSleepFlag == false && this.setAwake(true);
  }, i.prototype.isAwake = function() {
    return this.m_awakeFlag;
  }, i.prototype.setAwake = function(t) {
    t ? (this.m_awakeFlag = true, this.m_sleepTime = 0) : (this.m_awakeFlag = false, this.m_sleepTime = 0, this.m_linearVelocity.setZero(), this.m_angularVelocity = 0, this.m_force.setZero(), this.m_torque = 0);
  }, i.prototype.isActive = function() {
    return this.m_activeFlag;
  }, i.prototype.setActive = function(t) {
    if (t != this.m_activeFlag) if (this.m_activeFlag = !!t, this.m_activeFlag) {
      for (var e = this.m_world.m_broadPhase, r = this.m_fixtureList; r; r = r.m_next) r.createProxies(e, this.m_xf);
      this.m_world.m_newFixture = true;
    } else {
      for (var e = this.m_world.m_broadPhase, r = this.m_fixtureList; r; r = r.m_next) r.destroyProxies(e);
      for (var s = this.m_contactList; s; ) {
        var o = s;
        s = s.next, this.m_world.destroyContact(o.contact);
      }
      this.m_contactList = null;
    }
  }, i.prototype.isFixedRotation = function() {
    return this.m_fixedRotationFlag;
  }, i.prototype.setFixedRotation = function(t) {
    this.m_fixedRotationFlag != t && (this.m_fixedRotationFlag = !!t, this.m_angularVelocity = 0, this.resetMassData());
  }, i.prototype.getTransform = function() {
    return this.m_xf;
  }, i.prototype.setTransform = function(t, e) {
    if (this.isWorldLocked() != true) {
      typeof e == "number" ? this.m_xf.setNum(t, e) : this.m_xf.setTransform(t), this.m_sweep.setTransform(this.m_xf);
      for (var r = this.m_world.m_broadPhase, s = this.m_fixtureList; s; s = s.m_next) s.synchronize(r, this.m_xf, this.m_xf);
      this.setAwake(true);
    }
  }, i.prototype.synchronizeTransform = function() {
    this.m_sweep.getTransform(this.m_xf, 1);
  }, i.prototype.synchronizeFixtures = function() {
    this.m_sweep.getTransform(Ms, 0);
    for (var t = this.m_world.m_broadPhase, e = this.m_fixtureList; e; e = e.m_next) e.synchronize(t, Ms, this.m_xf);
  }, i.prototype.advance = function(t) {
    this.m_sweep.advance(t), x(this.m_sweep.c, this.m_sweep.c0), this.m_sweep.a = this.m_sweep.a0, this.m_sweep.getTransform(this.m_xf, 1);
  }, i.prototype.getPosition = function() {
    return this.m_xf.p;
  }, i.prototype.setPosition = function(t) {
    this.setTransform(t, this.m_sweep.a);
  }, i.prototype.getAngle = function() {
    return this.m_sweep.a;
  }, i.prototype.setAngle = function(t) {
    this.setTransform(this.m_xf.p, t);
  }, i.prototype.getWorldCenter = function() {
    return this.m_sweep.c;
  }, i.prototype.getLocalCenter = function() {
    return this.m_sweep.localCenter;
  }, i.prototype.getLinearVelocity = function() {
    return this.m_linearVelocity;
  }, i.prototype.getLinearVelocityFromWorldPoint = function(t) {
    var e = a.sub(t, this.m_sweep.c);
    return a.add(this.m_linearVelocity, a.crossNumVec2(this.m_angularVelocity, e));
  }, i.prototype.getLinearVelocityFromLocalPoint = function(t) {
    return this.getLinearVelocityFromWorldPoint(this.getWorldPoint(t));
  }, i.prototype.setLinearVelocity = function(t) {
    this.m_type != li && (a.dot(t, t) > 0 && this.setAwake(true), this.m_linearVelocity.setVec2(t));
  }, i.prototype.getAngularVelocity = function() {
    return this.m_angularVelocity;
  }, i.prototype.setAngularVelocity = function(t) {
    this.m_type != li && (t * t > 0 && this.setAwake(true), this.m_angularVelocity = t);
  }, i.prototype.getLinearDamping = function() {
    return this.m_linearDamping;
  }, i.prototype.setLinearDamping = function(t) {
    this.m_linearDamping = t;
  }, i.prototype.getAngularDamping = function() {
    return this.m_angularDamping;
  }, i.prototype.setAngularDamping = function(t) {
    this.m_angularDamping = t;
  }, i.prototype.getGravityScale = function() {
    return this.m_gravityScale;
  }, i.prototype.setGravityScale = function(t) {
    this.m_gravityScale = t;
  }, i.prototype.getMass = function() {
    return this.m_mass;
  }, i.prototype.getInertia = function() {
    return this.m_I + this.m_mass * a.dot(this.m_sweep.localCenter, this.m_sweep.localCenter);
  }, i.prototype.getMassData = function(t) {
    t.mass = this.m_mass, t.I = this.getInertia(), x(t.center, this.m_sweep.localCenter);
  }, i.prototype.resetMassData = function() {
    if (this.m_mass = 0, this.m_invMass = 0, this.m_I = 0, this.m_invI = 0, S(this.m_sweep.localCenter), this.isStatic() || this.isKinematic()) {
      x(this.m_sweep.c0, this.m_xf.p), x(this.m_sweep.c, this.m_xf.p), this.m_sweep.a0 = this.m_sweep.a;
      return;
    }
    S(Te);
    for (var t = this.m_fixtureList; t; t = t.m_next) if (t.m_density != 0) {
      var e = { mass: 0, center: g(0, 0), I: 0 };
      t.getMassData(e), this.m_mass += e.mass, Xt(Te, e.mass, e.center), this.m_I += e.I;
    }
    this.m_mass > 0 ? (this.m_invMass = 1 / this.m_mass, L(Te, this.m_invMass, Te)) : (this.m_mass = 1, this.m_invMass = 1), this.m_I > 0 && this.m_fixedRotationFlag == false ? (this.m_I -= this.m_mass * C(Te, Te), this.m_invI = 1 / this.m_I) : (this.m_I = 0, this.m_invI = 0), x(Ti, this.m_sweep.c), this.m_sweep.setLocalCenter(Te, this.m_xf), N(Ni, this.m_sweep.c, Ti), Lt(ki, this.m_angularVelocity, Ni), Jt(this.m_linearVelocity, ki);
  }, i.prototype.setMassData = function(t) {
    this.isWorldLocked() != true && this.m_type == jt && (this.m_invMass = 0, this.m_I = 0, this.m_invI = 0, this.m_mass = t.mass, this.m_mass <= 0 && (this.m_mass = 1), this.m_invMass = 1 / this.m_mass, t.I > 0 && this.m_fixedRotationFlag == false && (this.m_I = t.I - this.m_mass * C(t.center, t.center), this.m_invI = 1 / this.m_I), x(Ti, this.m_sweep.c), this.m_sweep.setLocalCenter(t.center, this.m_xf), N(Ni, this.m_sweep.c, Ti), Lt(ki, this.m_angularVelocity, Ni), Jt(this.m_linearVelocity, ki));
  }, i.prototype.applyForce = function(t, e, r) {
    r === void 0 && (r = true), this.m_type == jt && (r && this.m_awakeFlag == false && this.setAwake(true), this.m_awakeFlag && (this.m_force.add(t), this.m_torque += a.crossVec2Vec2(a.sub(e, this.m_sweep.c), t)));
  }, i.prototype.applyForceToCenter = function(t, e) {
    e === void 0 && (e = true), this.m_type == jt && (e && this.m_awakeFlag == false && this.setAwake(true), this.m_awakeFlag && this.m_force.add(t));
  }, i.prototype.applyTorque = function(t, e) {
    e === void 0 && (e = true), this.m_type == jt && (e && this.m_awakeFlag == false && this.setAwake(true), this.m_awakeFlag && (this.m_torque += t));
  }, i.prototype.applyLinearImpulse = function(t, e, r) {
    r === void 0 && (r = true), this.m_type == jt && (r && this.m_awakeFlag == false && this.setAwake(true), this.m_awakeFlag && (this.m_linearVelocity.addMul(this.m_invMass, t), this.m_angularVelocity += this.m_invI * a.crossVec2Vec2(a.sub(e, this.m_sweep.c), t)));
  }, i.prototype.applyAngularImpulse = function(t, e) {
    e === void 0 && (e = true), this.m_type == jt && (e && this.m_awakeFlag == false && this.setAwake(true), this.m_awakeFlag && (this.m_angularVelocity += this.m_invI * t));
  }, i.prototype.shouldCollide = function(t) {
    if (this.m_type != jt && t.m_type != jt) return false;
    for (var e = this.m_jointList; e; e = e.next) if (e.other == t && e.joint.m_collideConnected == false) return false;
    return true;
  }, i.prototype._addFixture = function(t) {
    if (this.isWorldLocked() == true) return null;
    if (this.m_activeFlag) {
      var e = this.m_world.m_broadPhase;
      t.createProxies(e, this.m_xf);
    }
    return t.m_next = this.m_fixtureList, this.m_fixtureList = t, t.m_density > 0 && this.resetMassData(), this.m_world.m_newFixture = true, t;
  }, i.prototype.createFixture = function(t, e) {
    if (this.isWorldLocked() == true) return null;
    var r = new zi(this, t, e);
    return this._addFixture(r), this.m_world.publish("add-fixture", r), r;
  }, i.prototype.destroyFixture = function(t) {
    if (this.isWorldLocked() != true) {
      if (this.m_fixtureList === t) this.m_fixtureList = t.m_next;
      else for (var e = this.m_fixtureList; e != null; ) {
        if (e.m_next === t) {
          e.m_next = t.m_next;
          break;
        }
        e = e.m_next;
      }
      for (var r = this.m_contactList; r; ) {
        var s = r.contact;
        r = r.next;
        var o = s.getFixtureA(), n = s.getFixtureB();
        (t == o || t == n) && this.m_world.destroyContact(s);
      }
      if (this.m_activeFlag) {
        var m = this.m_world.m_broadPhase;
        t.destroyProxies(m);
      }
      t.m_body = null, t.m_next = null, this.m_world.publish("remove-fixture", t), this.resetMassData();
    }
  }, i.prototype.getWorldPoint = function(t) {
    return ft.mulVec2(this.m_xf, t);
  }, i.prototype.getWorldVector = function(t) {
    return B.mulVec2(this.m_xf.q, t);
  }, i.prototype.getLocalPoint = function(t) {
    return ft.mulTVec2(this.m_xf, t);
  }, i.prototype.getLocalVector = function(t) {
    return B.mulTVec2(this.m_xf.q, t);
  }, i.STATIC = "static", i.KINEMATIC = "kinematic", i.DYNAMIC = "dynamic", i;
})();
var Nr = /* @__PURE__ */ (function() {
  function i() {
    this.other = null, this.joint = null, this.prev = null, this.next = null;
  }
  return i;
})();
var yt = (function() {
  function i(t, e, r) {
    this.m_type = "unknown-joint", this.m_prev = null, this.m_next = null, this.m_edgeA = new Nr(), this.m_edgeB = new Nr(), this.m_islandFlag = false, this.style = {}, this.appData = {}, e = "bodyA" in t ? t.bodyA : e, r = "bodyB" in t ? t.bodyB : r, this.m_bodyA = e, this.m_bodyB = r, this.m_collideConnected = !!t.collideConnected, this.m_userData = t.userData, typeof t.style == "object" && t.style !== null && (this.style = t.style);
  }
  return i.prototype.isActive = function() {
    return this.m_bodyA.isActive() && this.m_bodyB.isActive();
  }, i.prototype.getType = function() {
    return this.m_type;
  }, i.prototype.getBodyA = function() {
    return this.m_bodyA;
  }, i.prototype.getBodyB = function() {
    return this.m_bodyB;
  }, i.prototype.getNext = function() {
    return this.m_next;
  }, i.prototype.getUserData = function() {
    return this.m_userData;
  }, i.prototype.setUserData = function(t) {
    this.m_userData = t;
  }, i.prototype.getCollideConnected = function() {
    return this.m_collideConnected;
  }, i.prototype.shiftOrigin = function(t) {
  }, i.prototype._resetAnchors = function(t) {
    return this._reset(t);
  }, i;
})();
var K = { gjkCalls: 0, gjkIters: 0, gjkMaxIters: 0, toiTime: 0, toiMaxTime: 0, toiCalls: 0, toiIters: 0, toiMaxIters: 0, toiRootIters: 0, toiMaxRootIters: 0, toString: function(i) {
  i = typeof i == "string" ? i : `
`;
  var t = "";
  for (var e in this) typeof this[e] != "function" && typeof this[e] != "object" && (t += e + ": " + this[e] + i);
  return t;
} };
var Jo = function() {
  return Date.now();
};
var $o = function(i) {
  return Date.now() - i;
};
var Is = { now: Jo, diff: $o };
var nr = Math.max;
var Di = g(0, 0);
var Ri = g(0, 0);
var zt = g(0, 0);
var Ei = g(0, 0);
var yr = g(0, 0);
var Yo = g(0, 0);
var Wo = g(0, 0);
K.gjkCalls = 0;
K.gjkIters = 0;
K.gjkMaxIters = 0;
var mr = (function() {
  function i() {
    this.proxyA = new Pe(), this.proxyB = new Pe(), this.transformA = ft.identity(), this.transformB = ft.identity(), this.useRadii = false;
  }
  return i.prototype.recycle = function() {
    this.proxyA.recycle(), this.proxyB.recycle(), this.transformA.setIdentity(), this.transformB.setIdentity(), this.useRadii = false;
  }, i;
})();
var hr = (function() {
  function i() {
    this.pointA = g(0, 0), this.pointB = g(0, 0), this.distance = 0, this.iterations = 0;
  }
  return i.prototype.recycle = function() {
    S(this.pointA), S(this.pointB), this.distance = 0, this.iterations = 0;
  }, i;
})();
var lr = (function() {
  function i() {
    this.metric = 0, this.indexA = [], this.indexB = [], this.count = 0;
  }
  return i.prototype.recycle = function() {
    this.metric = 0, this.indexA.length = 0, this.indexB.length = 0, this.count = 0;
  }, i;
})();
var xe = function(i, t, e) {
  ++K.gjkCalls;
  var r = e.proxyA, s = e.proxyB, o = e.transformA, n = e.transformB;
  Ut.recycle(), Ut.readCache(t, r, o, s, n);
  for (var m = Ut.m_v, h = z.maxDistanceIterations, p = [], l = [], u = 0, c = 0; c < h; ) {
    u = Ut.m_count;
    for (var _ = 0; _ < u; ++_) p[_] = m[_].indexA, l[_] = m[_].indexB;
    if (Ut.solve(), Ut.m_count === 3) break;
    var y = Ut.getSearchDirection();
    if (Ue(y) < gt * gt) break;
    var v = m[Ut.m_count];
    v.indexA = r.getSupport(ci(Di, o.q, L(Di, -1, y))), T(v.wA, o, r.getVertex(v.indexA)), v.indexB = s.getSupport(ci(Di, n.q, y)), T(v.wB, n, s.getVertex(v.indexB)), N(v.w, v.wB, v.wA), ++c, ++K.gjkIters;
    for (var f = false, _ = 0; _ < u; ++_) if (v.indexA === p[_] && v.indexB === l[_]) {
      f = true;
      break;
    }
    if (f) break;
    ++Ut.m_count;
  }
  if (K.gjkMaxIters = nr(K.gjkMaxIters, c), Ut.getWitnessPoints(i.pointA, i.pointB), i.distance = ho(i.pointA, i.pointB), i.iterations = c, Ut.writeCache(t), e.useRadii) {
    var d = r.m_radius, A = s.m_radius;
    if (i.distance > d + A && i.distance > gt) i.distance -= d + A, N(Ri, i.pointB, i.pointA), Kt(Ri), Xt(i.pointA, d, Ri), Ci(i.pointB, A, Ri);
    else {
      var b = N(Di, i.pointA, i.pointB);
      x(i.pointA, b), x(i.pointB, b), i.distance = 0;
    }
  }
};
var Pe = (function() {
  function i() {
    this.m_vertices = [], this.m_count = 0, this.m_radius = 0;
  }
  return i.prototype.recycle = function() {
    this.m_vertices.length = 0, this.m_count = 0, this.m_radius = 0;
  }, i.prototype.getVertexCount = function() {
    return this.m_count;
  }, i.prototype.getVertex = function(t) {
    return this.m_vertices[t];
  }, i.prototype.getSupport = function(t) {
    for (var e = -1, r = -1 / 0, s = 0; s < this.m_count; ++s) {
      var o = C(this.m_vertices[s], t);
      o > r && (e = s, r = o);
    }
    return e;
  }, i.prototype.getSupportVertex = function(t) {
    return this.m_vertices[this.getSupport(t)];
  }, i.prototype.set = function(t, e) {
    t.computeDistanceProxy(this, e);
  }, i.prototype.setVertices = function(t, e, r) {
    this.m_vertices = t, this.m_count = e, this.m_radius = r;
  }, i;
})();
var fr = (function() {
  function i() {
    this.wA = g(0, 0), this.indexA = 0, this.wB = g(0, 0), this.indexB = 0, this.w = g(0, 0), this.a = 0;
  }
  return i.prototype.recycle = function() {
    this.indexA = 0, this.indexB = 0, S(this.wA), S(this.wB), S(this.w), this.a = 0;
  }, i.prototype.set = function(t) {
    this.indexA = t.indexA, this.indexB = t.indexB, x(this.wA, t.wA), x(this.wB, t.wB), x(this.w, t.w), this.a = t.a;
  }, i;
})();
var Oi = g(0, 0);
var yi = g(0, 0);
var po = (function() {
  function i() {
    this.m_v1 = new fr(), this.m_v2 = new fr(), this.m_v3 = new fr(), this.m_v = [this.m_v1, this.m_v2, this.m_v3];
  }
  return i.prototype.recycle = function() {
    this.m_v1.recycle(), this.m_v2.recycle(), this.m_v3.recycle(), this.m_count = 0;
  }, i.prototype.toString = function() {
    return this.m_count === 3 ? ["+" + this.m_count, this.m_v1.a, this.m_v1.wA.x, this.m_v1.wA.y, this.m_v1.wB.x, this.m_v1.wB.y, this.m_v2.a, this.m_v2.wA.x, this.m_v2.wA.y, this.m_v2.wB.x, this.m_v2.wB.y, this.m_v3.a, this.m_v3.wA.x, this.m_v3.wA.y, this.m_v3.wB.x, this.m_v3.wB.y].toString() : this.m_count === 2 ? ["+" + this.m_count, this.m_v1.a, this.m_v1.wA.x, this.m_v1.wA.y, this.m_v1.wB.x, this.m_v1.wB.y, this.m_v2.a, this.m_v2.wA.x, this.m_v2.wA.y, this.m_v2.wB.x, this.m_v2.wB.y].toString() : this.m_count === 1 ? ["+" + this.m_count, this.m_v1.a, this.m_v1.wA.x, this.m_v1.wA.y, this.m_v1.wB.x, this.m_v1.wB.y].toString() : "+" + this.m_count;
  }, i.prototype.readCache = function(t, e, r, s, o) {
    this.m_count = t.count;
    for (var n = 0; n < this.m_count; ++n) {
      var m = this.m_v[n];
      m.indexA = t.indexA[n], m.indexB = t.indexB[n];
      var h = e.getVertex(m.indexA), p = s.getVertex(m.indexB);
      T(m.wA, r, h), T(m.wB, o, p), N(m.w, m.wB, m.wA), m.a = 0;
    }
    if (this.m_count > 1) {
      var l = t.metric, u = this.getMetric();
      (u < 0.5 * l || 2 * l < u || u < gt) && (this.m_count = 0);
    }
    if (this.m_count === 0) {
      var m = this.m_v[0];
      m.indexA = 0, m.indexB = 0;
      var h = e.getVertex(0), p = s.getVertex(0);
      T(m.wA, r, h), T(m.wB, o, p), N(m.w, m.wB, m.wA), m.a = 1, this.m_count = 1;
    }
  }, i.prototype.writeCache = function(t) {
    t.metric = this.getMetric(), t.count = this.m_count;
    for (var e = 0; e < this.m_count; ++e) t.indexA[e] = this.m_v[e].indexA, t.indexB[e] = this.m_v[e].indexB;
  }, i.prototype.getSearchDirection = function() {
    var t = this.m_v1, e = this.m_v2;
    switch (this.m_count) {
      case 1:
        return ut(Oi, -t.w.x, -t.w.y);
      case 2: {
        N(zt, e.w, t.w);
        var r = -E(zt, t.w);
        return r > 0 ? ut(Oi, -zt.y, zt.x) : ut(Oi, zt.y, -zt.x);
      }
      default:
        return S(Oi);
    }
  }, i.prototype.getClosestPoint = function() {
    var t = this.m_v1, e = this.m_v2;
    switch (this.m_count) {
      case 0:
        return S(yi);
      case 1:
        return x(yi, t.w);
      case 2:
        return G2(yi, t.a, t.w, e.a, e.w);
      case 3:
        return S(yi);
      default:
        return S(yi);
    }
  }, i.prototype.getWitnessPoints = function(t, e) {
    var r = this.m_v1, s = this.m_v2, o = this.m_v3;
    switch (this.m_count) {
      case 0:
        break;
      case 1:
        x(t, r.wA), x(e, r.wB);
        break;
      case 2:
        G2(t, r.a, r.wA, s.a, s.wA), G2(e, r.a, r.wB, s.a, s.wB);
        break;
      case 3:
        se(t, r.a, r.wA, s.a, s.wA, o.a, o.wA), x(e, t);
        break;
    }
  }, i.prototype.getMetric = function() {
    switch (this.m_count) {
      case 0:
        return 0;
      case 1:
        return 0;
      case 2:
        return ho(this.m_v1.w, this.m_v2.w);
      case 3:
        return E(N(Yo, this.m_v2.w, this.m_v1.w), N(Wo, this.m_v3.w, this.m_v1.w));
      default:
        return 0;
    }
  }, i.prototype.solve = function() {
    switch (this.m_count) {
      case 1:
        break;
      case 2:
        this.solve2();
        break;
      case 3:
        this.solve3();
        break;
    }
  }, i.prototype.solve2 = function() {
    var t = this.m_v1.w, e = this.m_v2.w;
    N(zt, e, t);
    var r = -C(t, zt);
    if (r <= 0) {
      this.m_v1.a = 1, this.m_count = 1;
      return;
    }
    var s = C(e, zt);
    if (s <= 0) {
      this.m_v2.a = 1, this.m_count = 1, this.m_v1.set(this.m_v2);
      return;
    }
    var o = 1 / (s + r);
    this.m_v1.a = s * o, this.m_v2.a = r * o, this.m_count = 2;
  }, i.prototype.solve3 = function() {
    var t = this.m_v1.w, e = this.m_v2.w, r = this.m_v3.w;
    N(zt, e, t);
    var s = C(t, zt), o = C(e, zt), n = o, m = -s;
    N(Ei, r, t);
    var h = C(t, Ei), p = C(r, Ei), l = p, u = -h;
    N(yr, r, e);
    var c = C(e, yr), _ = C(r, yr), y = _, v = -c, f = E(zt, Ei), d = f * E(e, r), A = f * E(r, t), b = f * E(t, e);
    if (m <= 0 && u <= 0) {
      this.m_v1.a = 1, this.m_count = 1;
      return;
    }
    if (n > 0 && m > 0 && b <= 0) {
      var w = 1 / (n + m);
      this.m_v1.a = n * w, this.m_v2.a = m * w, this.m_count = 2;
      return;
    }
    if (l > 0 && u > 0 && A <= 0) {
      var V = 1 / (l + u);
      this.m_v1.a = l * V, this.m_v3.a = u * V, this.m_count = 2, this.m_v2.set(this.m_v3);
      return;
    }
    if (n <= 0 && v <= 0) {
      this.m_v2.a = 1, this.m_count = 1, this.m_v1.set(this.m_v2);
      return;
    }
    if (l <= 0 && y <= 0) {
      this.m_v3.a = 1, this.m_count = 1, this.m_v1.set(this.m_v3);
      return;
    }
    if (y > 0 && v > 0 && d <= 0) {
      var I = 1 / (y + v);
      this.m_v2.a = y * I, this.m_v3.a = v * I, this.m_count = 2, this.m_v1.set(this.m_v3);
      return;
    }
    var M = 1 / (d + A + b);
    this.m_v1.a = d * M, this.m_v2.a = A * M, this.m_v3.a = b * M, this.m_count = 3;
  }, i;
})();
var Ut = new po();
var Ne = new mr();
var Ps = new lr();
var dr = new hr();
var es = function(i, t, e, r, s, o) {
  return Ne.recycle(), Ne.proxyA.set(i, t), Ne.proxyB.set(e, r), ar(Ne.transformA, s), ar(Ne.transformB, o), Ne.useRadii = true, dr.recycle(), Ps.recycle(), xe(dr, Ps, Ne), dr.distance < 10 * gt;
};
xe.testOverlap = es;
xe.Input = mr;
xe.Output = hr;
xe.Proxy = Pe;
xe.Cache = lr;
var jo = (function() {
  function i() {
    this.proxyA = new Pe(), this.proxyB = new Pe(), this.transformA = ft.identity(), this.transformB = ft.identity(), this.translationB = a.zero();
  }
  return i.prototype.recycle = function() {
    this.proxyA.recycle(), this.proxyB.recycle(), this.transformA.setIdentity(), this.transformB.setIdentity(), S(this.translationB);
  }, i;
})();
var Uo = /* @__PURE__ */ (function() {
  function i() {
    this.point = a.zero(), this.normal = a.zero(), this.lambda = 1, this.iterations = 0;
  }
  return i;
})();
var Ho = function(i, t) {
  i.iterations = 0, i.lambda = 1, i.normal.setZero(), i.point.setZero();
  var e = t.proxyA, r = t.proxyB, s = nr(e.m_radius, z.polygonRadius), o = nr(r.m_radius, z.polygonRadius), n = s + o, m = t.transformA, h = t.transformB, p = t.translationB, l = a.zero(), u = 0, c = new po();
  c.m_count = 0;
  for (var _ = c.m_v, y = e.getSupport(B.mulTVec2(m.q, a.neg(p))), v = ft.mulVec2(m, e.getVertex(y)), f = r.getSupport(B.mulTVec2(h.q, p)), d = ft.mulVec2(h, r.getVertex(f)), A = a.sub(v, d), b = nr(z.polygonRadius, n - z.polygonRadius), w = 0.5 * z.linearSlop, V = 20, I = 0; I < V && A.length() - b > w; ) {
    i.iterations += 1, y = e.getSupport(B.mulTVec2(m.q, a.neg(A))), v = ft.mulVec2(m, e.getVertex(y)), f = r.getSupport(B.mulTVec2(h.q, A)), d = ft.mulVec2(h, r.getVertex(f));
    var M = a.sub(v, d);
    A.normalize();
    var P = a.dot(A, M), k = a.dot(A, p);
    if (P - b > u * k) {
      if (k <= 0 || (u = (P - b) / k, u > 1)) return false;
      l.setMul(-1, A), c.m_count = 0;
    }
    var F = _[c.m_count];
    switch (F.indexA = f, F.wA = a.combine(1, d, u, p), F.indexB = y, F.wB = v, F.w = a.sub(F.wB, F.wA), F.a = 1, c.m_count += 1, c.m_count) {
      case 1:
        break;
      case 2:
        c.solve2();
        break;
      case 3:
        c.solve3();
        break;
    }
    if (c.m_count == 3) return false;
    A.setVec2(c.getClosestPoint()), ++I;
  }
  if (I == 0) return false;
  var O = a.zero(), Y = a.zero();
  return c.getWitnessPoints(Y, O), A.lengthSquared() > 0 && (l.setMul(-1, A), l.normalize()), i.point = a.combine(1, O, s, l), i.normal = l, i.lambda = u, i.iterations = I, true;
};
var Zo = Math.abs;
var Ji = Math.max;
var is = (function() {
  function i() {
    this.proxyA = new Pe(), this.proxyB = new Pe(), this.sweepA = new Ie(), this.sweepB = new Ie();
  }
  return i.prototype.recycle = function() {
    this.proxyA.recycle(), this.proxyB.recycle(), this.sweepA.recycle(), this.sweepB.recycle(), this.tMax = -1;
  }, i;
})();
var Ft;
(function(i) {
  i[i.e_unset = -1] = "e_unset", i[i.e_unknown = 0] = "e_unknown", i[i.e_failed = 1] = "e_failed", i[i.e_overlapped = 2] = "e_overlapped", i[i.e_touching = 3] = "e_touching", i[i.e_separated = 4] = "e_separated";
})(Ft || (Ft = {}));
var rs = (function() {
  function i() {
    this.state = Ft.e_unset, this.t = -1;
  }
  return i.prototype.recycle = function() {
    this.state = Ft.e_unset, this.t = -1;
  }, i;
})();
K.toiTime = 0;
K.toiMaxTime = 0;
K.toiCalls = 0;
K.toiIters = 0;
K.toiMaxIters = 0;
K.toiRootIters = 0;
K.toiMaxRootIters = 0;
var Ke = new mr();
var xr = new hr();
var Ar = new lr();
var wt = Ze(0, 0, 0);
var Vt = Ze(0, 0, 0);
var fi = g(0, 0);
var Qt = g(0, 0);
var Dt = g(0, 0);
var bt = g(0, 0);
var $i = g(0, 0);
var Yi = g(0, 0);
var Wi = g(0, 0);
var ji = g(0, 0);
var Si = function(i, t) {
  var e = Is.now();
  ++K.toiCalls, i.state = Ft.e_unknown, i.t = t.tMax;
  var r = t.proxyA, s = t.proxyB, o = t.sweepA, n = t.sweepB;
  o.normalize(), n.normalize();
  var m = t.tMax, h = r.m_radius + s.m_radius, p = Ji(z.linearSlop, h - 3 * z.linearSlop), l = 0.25 * z.linearSlop, u = 0, c = z.maxTOIIterations, _ = 0;
  for (Ar.recycle(), Ke.proxyA.setVertices(r.m_vertices, r.m_count, r.m_radius), Ke.proxyB.setVertices(s.m_vertices, s.m_count, s.m_radius), Ke.useRadii = false; ; ) {
    if (o.getTransform(wt, u), n.getTransform(Vt, u), ar(Ke.transformA, wt), ar(Ke.transformB, Vt), xe(xr, Ar, Ke), xr.distance <= 0) {
      i.state = Ft.e_overlapped, i.t = 0;
      break;
    }
    if (xr.distance < p + l) {
      i.state = Ft.e_touching, i.t = u;
      break;
    }
    di.initialize(Ar, r, o, s, n, u);
    for (var y = false, v = m, f = 0; ; ) {
      var d = di.findMinSeparation(v);
      if (d > p + l) {
        i.state = Ft.e_separated, i.t = m, y = true;
        break;
      }
      if (d > p - l) {
        u = v;
        break;
      }
      var A = di.evaluate(u);
      if (A < p - l) {
        i.state = Ft.e_failed, i.t = u, y = true;
        break;
      }
      if (A <= p + l) {
        i.state = Ft.e_touching, i.t = u, y = true;
        break;
      }
      for (var b = 0, w = u, V = v; ; ) {
        var I = void 0;
        b & 1 ? I = w + (p - A) * (V - w) / (d - A) : I = 0.5 * (w + V), ++b, ++K.toiRootIters;
        var M = di.evaluate(I);
        if (Zo(M - p) < l) {
          v = I;
          break;
        }
        if (M > p ? (w = I, A = M) : (V = I, d = M), b === 50) break;
      }
      if (K.toiMaxRootIters = Ji(K.toiMaxRootIters, b), ++f, f === z.maxPolygonVertices) break;
    }
    if (++_, ++K.toiIters, y) break;
    if (_ === c) {
      i.state = Ft.e_failed, i.t = u;
      break;
    }
  }
  K.toiMaxIters = Ji(K.toiMaxIters, _);
  var P = Is.diff(e);
  K.toiMaxTime = Ji(K.toiMaxTime, P), K.toiTime += P, di.recycle();
};
var oe;
(function(i) {
  i[i.e_unset = -1] = "e_unset", i[i.e_points = 1] = "e_points", i[i.e_faceA = 2] = "e_faceA", i[i.e_faceB = 3] = "e_faceB";
})(oe || (oe = {}));
var Xo = (function() {
  function i() {
    this.m_proxyA = null, this.m_proxyB = null, this.m_sweepA = null, this.m_sweepB = null, this.m_type = oe.e_unset, this.m_localPoint = g(0, 0), this.m_axis = g(0, 0), this.indexA = -1, this.indexB = -1;
  }
  return i.prototype.recycle = function() {
    this.m_proxyA = null, this.m_proxyB = null, this.m_sweepA = null, this.m_sweepB = null, this.m_type = oe.e_unset, S(this.m_localPoint), S(this.m_axis), this.indexA = -1, this.indexB = -1;
  }, i.prototype.initialize = function(t, e, r, s, o, n) {
    var m = t.count;
    if (this.m_proxyA = e, this.m_proxyB = s, this.m_sweepA = r, this.m_sweepB = o, this.m_sweepA.getTransform(wt, n), this.m_sweepB.getTransform(Vt, n), m === 1) {
      this.m_type = oe.e_points;
      var h = this.m_proxyA.getVertex(t.indexA[0]), p = this.m_proxyB.getVertex(t.indexB[0]);
      T(Qt, wt, h), T(Dt, Vt, p), N(this.m_axis, Dt, Qt);
      var l = Fo(this.m_axis);
      return l;
    } else if (t.indexA[0] === t.indexA[1]) {
      this.m_type = oe.e_faceB;
      var u = s.getVertex(t.indexB[0]), c = s.getVertex(t.indexB[1]);
      je(this.m_axis, N(fi, c, u), 1), Kt(this.m_axis), $t(bt, Vt.q, this.m_axis), G2(this.m_localPoint, 0.5, u, 0.5, c), T(Dt, Vt, this.m_localPoint);
      var _ = e.getVertex(t.indexA[0]), y = ft.mulVec2(wt, _), l = C(y, bt) - C(Dt, bt);
      return l < 0 && (Pi(this.m_axis), l = -l), l;
    } else {
      this.m_type = oe.e_faceA;
      var v = this.m_proxyA.getVertex(t.indexA[0]), f = this.m_proxyA.getVertex(t.indexA[1]);
      je(this.m_axis, N(fi, f, v), 1), Kt(this.m_axis), $t(bt, wt.q, this.m_axis), G2(this.m_localPoint, 0.5, v, 0.5, f), T(Qt, wt, this.m_localPoint);
      var d = this.m_proxyB.getVertex(t.indexB[0]);
      T(Dt, Vt, d);
      var l = C(Dt, bt) - C(Qt, bt);
      return l < 0 && (Pi(this.m_axis), l = -l), l;
    }
  }, i.prototype.compute = function(t, e) {
    switch (this.m_sweepA.getTransform(wt, e), this.m_sweepB.getTransform(Vt, e), this.m_type) {
      case oe.e_points: {
        t && (ci($i, wt.q, this.m_axis), ci(Yi, Vt.q, L(fi, -1, this.m_axis)), this.indexA = this.m_proxyA.getSupport($i), this.indexB = this.m_proxyB.getSupport(Yi)), x(Wi, this.m_proxyA.getVertex(this.indexA)), x(ji, this.m_proxyB.getVertex(this.indexB)), T(Qt, wt, Wi), T(Dt, Vt, ji);
        var r = C(Dt, this.m_axis) - C(Qt, this.m_axis);
        return r;
      }
      case oe.e_faceA: {
        $t(bt, wt.q, this.m_axis), T(Qt, wt, this.m_localPoint), t && (ci(Yi, Vt.q, L(fi, -1, bt)), this.indexA = -1, this.indexB = this.m_proxyB.getSupport(Yi)), x(ji, this.m_proxyB.getVertex(this.indexB)), T(Dt, Vt, ji);
        var r = C(Dt, bt) - C(Qt, bt);
        return r;
      }
      case oe.e_faceB: {
        $t(bt, Vt.q, this.m_axis), T(Dt, Vt, this.m_localPoint), t && (ci($i, wt.q, L(fi, -1, bt)), this.indexB = -1, this.indexA = this.m_proxyA.getSupport($i)), x(Wi, this.m_proxyA.getVertex(this.indexA)), T(Qt, wt, Wi);
        var r = C(Qt, bt) - C(Dt, bt);
        return r;
      }
      default:
        return t && (this.indexA = -1, this.indexB = -1), 0;
    }
  }, i.prototype.findMinSeparation = function(t) {
    return this.compute(true, t);
  }, i.prototype.evaluate = function(t) {
    return this.compute(false, t);
  }, i;
})();
var di = new Xo();
Si.Input = is;
Si.Output = rs;
var zs = Math.abs;
var Ss = Math.sqrt;
var Ui = Math.min;
var cr = (function() {
  function i() {
    this.dt = 0, this.inv_dt = 0, this.velocityIterations = 0, this.positionIterations = 0, this.warmStarting = false, this.blockSolve = true, this.inv_dt0 = 0, this.dtRatio = 1;
  }
  return i.prototype.reset = function(t) {
    this.dt > 0 && (this.inv_dt0 = this.inv_dt), this.dt = t, this.inv_dt = t == 0 ? 0 : 1 / t, this.dtRatio = t * this.inv_dt0;
  }, i;
})();
var Ge = new cr();
var me = g(0, 0);
var vt = g(0, 0);
var Hi = g(0, 0);
var Qe = new is();
var gr = new rs();
var Ls = new Ie();
var Fs = new Ie();
var qs = new Ie();
var vo = (function() {
  function i(t) {
    this.contact = t, this.normals = [], this.tangents = [];
  }
  return i.prototype.recycle = function() {
    this.normals.length = 0, this.tangents.length = 0;
  }, Object.defineProperty(i.prototype, "normalImpulses", { get: function() {
    var t = this.contact, e = this.normals;
    e.length = 0;
    for (var r = 0; r < t.v_points.length; ++r) e.push(t.v_points[r].normalImpulse);
    return e;
  }, enumerable: false, configurable: true }), Object.defineProperty(i.prototype, "tangentImpulses", { get: function() {
    var t = this.contact, e = this.tangents;
    e.length = 0;
    for (var r = 0; r < t.v_points.length; ++r) e.push(t.v_points[r].tangentImpulse);
    return e;
  }, enumerable: false, configurable: true }), i;
})();
var ss = (function() {
  function i(t) {
    this.m_world = t, this.m_stack = [], this.m_bodies = [], this.m_contacts = [], this.m_joints = [];
  }
  return i.prototype.clear = function() {
    this.m_stack.length = 0, this.m_bodies.length = 0, this.m_contacts.length = 0, this.m_joints.length = 0;
  }, i.prototype.addBody = function(t) {
    this.m_bodies.push(t);
  }, i.prototype.addContact = function(t) {
    this.m_contacts.push(t);
  }, i.prototype.addJoint = function(t) {
    this.m_joints.push(t);
  }, i.prototype.solveWorld = function(t) {
    for (var e = this.m_world, r = e.m_bodyList; r; r = r.m_next) r.m_islandFlag = false;
    for (var s = e.m_contactList; s; s = s.m_next) s.m_islandFlag = false;
    for (var o = e.m_jointList; o; o = o.m_next) o.m_islandFlag = false;
    for (var n = this.m_stack, m = e.m_bodyList; m; m = m.m_next) if (!m.m_islandFlag && !(m.isAwake() == false || m.isActive() == false) && !m.isStatic()) {
      for (this.clear(), n.push(m), m.m_islandFlag = true; n.length > 0; ) {
        var r = n.pop();
        if (this.addBody(r), r.m_awakeFlag = true, !r.isStatic()) {
          for (var h = r.m_contactList; h; h = h.next) {
            var p = h.contact;
            if (!p.m_islandFlag && !(p.isEnabled() == false || p.isTouching() == false)) {
              var l = p.m_fixtureA.m_isSensor, u = p.m_fixtureB.m_isSensor;
              if (!(l || u)) {
                this.addContact(p), p.m_islandFlag = true;
                var c = h.other;
                c.m_islandFlag || (n.push(c), c.m_islandFlag = true);
              }
            }
          }
          for (var _ = r.m_jointList; _; _ = _.next) if (_.joint.m_islandFlag != true) {
            var c = _.other;
            c.isActive() != false && (this.addJoint(_.joint), _.joint.m_islandFlag = true, !c.m_islandFlag && (n.push(c), c.m_islandFlag = true));
          }
        }
      }
      this.solveIsland(t);
      for (var y = 0; y < this.m_bodies.length; ++y) {
        var r = this.m_bodies[y];
        r.isStatic() && (r.m_islandFlag = false);
      }
    }
  }, i.prototype.solveIsland = function(t) {
    for (var e = this.m_world, r = e.m_gravity, s = e.m_allowSleep, o = t.dt, n = 0; n < this.m_bodies.length; ++n) {
      var m = this.m_bodies[n];
      x(me, m.m_sweep.c);
      var h = m.m_sweep.a;
      x(vt, m.m_linearVelocity);
      var p = m.m_angularVelocity;
      x(m.m_sweep.c0, m.m_sweep.c), m.m_sweep.a0 = m.m_sweep.a, m.isDynamic() && (Xt(vt, o * m.m_gravityScale, r), Xt(vt, o * m.m_invMass, m.m_force), p += o * m.m_invI * m.m_torque, L(vt, 1 / (1 + o * m.m_linearDamping), vt), p *= 1 / (1 + o * m.m_angularDamping)), x(m.c_position.c, me), m.c_position.a = h, x(m.c_velocity.v, vt), m.c_velocity.w = p;
    }
    for (var n = 0; n < this.m_contacts.length; ++n) {
      var l = this.m_contacts[n];
      l.initConstraint(t);
    }
    for (var n = 0; n < this.m_contacts.length; ++n) {
      var l = this.m_contacts[n];
      l.initVelocityConstraint(t);
    }
    if (t.warmStarting) for (var n = 0; n < this.m_contacts.length; ++n) {
      var l = this.m_contacts[n];
      l.warmStartConstraint(t);
    }
    for (var n = 0; n < this.m_joints.length; ++n) {
      var u = this.m_joints[n];
      u.initVelocityConstraints(t);
    }
    for (var n = 0; n < t.velocityIterations; ++n) {
      for (var c = 0; c < this.m_joints.length; ++c) {
        var u = this.m_joints[c];
        u.solveVelocityConstraints(t);
      }
      for (var c = 0; c < this.m_contacts.length; ++c) {
        var l = this.m_contacts[c];
        l.solveVelocityConstraint(t);
      }
    }
    for (var n = 0; n < this.m_contacts.length; ++n) {
      var l = this.m_contacts[n];
      l.storeConstraintImpulses(t);
    }
    for (var n = 0; n < this.m_bodies.length; ++n) {
      var m = this.m_bodies[n];
      x(me, m.c_position.c);
      var h = m.c_position.a;
      x(vt, m.c_velocity.v);
      var p = m.c_velocity.w;
      L(Hi, o, vt);
      var _ = Ue(Hi);
      if (_ > z.maxTranslationSquared) {
        var y = z.maxTranslation / Ss(_);
        xs(vt, y);
      }
      var v = o * p;
      if (v * v > z.maxRotationSquared) {
        var y = z.maxRotation / zs(v);
        p *= y;
      }
      Xt(me, o, vt), h += o * p, x(m.c_position.c, me), m.c_position.a = h, x(m.c_velocity.v, vt), m.c_velocity.w = p;
    }
    for (var f = false, n = 0; n < t.positionIterations; ++n) {
      for (var d = 0, c = 0; c < this.m_contacts.length; ++c) {
        var l = this.m_contacts[c], A = l.solvePositionConstraint(t);
        d = Ui(d, A);
      }
      for (var b = d >= -3 * z.linearSlop, w = true, c = 0; c < this.m_joints.length; ++c) {
        var u = this.m_joints[c], V = u.solvePositionConstraints(t);
        w = w && V;
      }
      if (b && w) {
        f = true;
        break;
      }
    }
    for (var n = 0; n < this.m_bodies.length; ++n) {
      var m = this.m_bodies[n];
      x(m.m_sweep.c, m.c_position.c), m.m_sweep.a = m.c_position.a, x(m.m_linearVelocity, m.c_velocity.v), m.m_angularVelocity = m.c_velocity.w, m.synchronizeTransform();
    }
    if (this.postSolveIsland(), s) {
      for (var I = 1 / 0, M = z.linearSleepToleranceSqr, P = z.angularSleepToleranceSqr, n = 0; n < this.m_bodies.length; ++n) {
        var m = this.m_bodies[n];
        m.isStatic() || (m.m_autoSleepFlag == false || m.m_angularVelocity * m.m_angularVelocity > P || Ue(m.m_linearVelocity) > M ? (m.m_sleepTime = 0, I = 0) : (m.m_sleepTime += o, I = Ui(I, m.m_sleepTime)));
      }
      if (I >= z.timeToSleep && f) for (var n = 0; n < this.m_bodies.length; ++n) {
        var m = this.m_bodies[n];
        m.setAwake(false);
      }
    }
  }, i.prototype.solveWorldTOI = function(t) {
    var e = this.m_world;
    if (e.m_stepComplete) {
      for (var r = e.m_bodyList; r; r = r.m_next) r.m_islandFlag = false, r.m_sweep.alpha0 = 0;
      for (var s = e.m_contactList; s; s = s.m_next) s.m_toiFlag = false, s.m_islandFlag = false, s.m_toiCount = 0, s.m_toi = 1;
    }
    for (; ; ) {
      for (var o = null, n = 1, m = e.m_contactList; m; m = m.m_next) if (m.isEnabled() != false && !(m.m_toiCount > z.maxSubSteps)) {
        var h = 1;
        if (m.m_toiFlag) h = m.m_toi;
        else {
          var p = m.getFixtureA(), l = m.getFixtureB();
          if (p.isSensor() || l.isSensor()) continue;
          var u = p.getBody(), c = l.getBody(), _ = u.isAwake() && !u.isStatic(), y = c.isAwake() && !c.isStatic();
          if (_ == false && y == false) continue;
          var v = u.isBullet() || !u.isDynamic(), f = c.isBullet() || !c.isDynamic();
          if (v == false && f == false) continue;
          var d = u.m_sweep.alpha0;
          u.m_sweep.alpha0 < c.m_sweep.alpha0 ? (d = c.m_sweep.alpha0, u.m_sweep.advance(d)) : c.m_sweep.alpha0 < u.m_sweep.alpha0 && (d = u.m_sweep.alpha0, c.m_sweep.advance(d));
          var A = m.getChildIndexA(), b = m.getChildIndexB();
          Qe.proxyA.set(p.getShape(), A), Qe.proxyB.set(l.getShape(), b), Qe.sweepA.set(u.m_sweep), Qe.sweepB.set(c.m_sweep), Qe.tMax = 1, Si(gr, Qe);
          var w = gr.t;
          gr.state == Ft.e_touching ? h = Ui(d + (1 - d) * w, 1) : h = 1, m.m_toi = h, m.m_toiFlag = true;
        }
        h < n && (o = m, n = h);
      }
      if (o == null || 1 - 10 * gt < n) {
        e.m_stepComplete = true;
        break;
      }
      var V = o.getFixtureA(), I = o.getFixtureB(), M = V.getBody(), P = I.getBody();
      if (Fs.set(M.m_sweep), qs.set(P.m_sweep), M.advance(n), P.advance(n), o.update(e), o.m_toiFlag = false, ++o.m_toiCount, o.isEnabled() == false || o.isTouching() == false) {
        o.setEnabled(false), M.m_sweep.set(Fs), P.m_sweep.set(qs), M.synchronizeTransform(), P.synchronizeTransform();
        continue;
      }
      M.setAwake(true), P.setAwake(true), this.clear(), this.addBody(M), this.addBody(P), this.addContact(o), M.m_islandFlag = true, P.m_islandFlag = true, o.m_islandFlag = true;
      for (var k = [M, P], F = 0; F < k.length; ++F) {
        var O = k[F];
        if (O.isDynamic()) for (var Y = O.m_contactList; Y; Y = Y.next) {
          var j = Y.contact;
          if (!j.m_islandFlag) {
            var H = Y.other;
            if (!(H.isDynamic() && !O.isBullet() && !H.isBullet())) {
              var It = j.m_fixtureA.m_isSensor, ct = j.m_fixtureB.m_isSensor;
              if (!(It || ct)) {
                if (Ls.set(H.m_sweep), H.m_islandFlag == false && H.advance(n), j.update(e), j.isEnabled() == false || j.isTouching() == false) {
                  H.m_sweep.set(Ls), H.synchronizeTransform();
                  continue;
                }
                j.m_islandFlag = true, this.addContact(j), !H.m_islandFlag && (H.m_islandFlag = true, H.isStatic() || H.setAwake(true), this.addBody(H));
              }
            }
          }
        }
      }
      Ge.reset((1 - n) * t.dt), Ge.dtRatio = 1, Ge.positionIterations = 20, Ge.velocityIterations = t.velocityIterations, Ge.warmStarting = false, this.solveIslandTOI(Ge, M, P);
      for (var F = 0; F < this.m_bodies.length; ++F) {
        var O = this.m_bodies[F];
        if (O.m_islandFlag = false, !!O.isDynamic()) {
          O.synchronizeFixtures();
          for (var Y = O.m_contactList; Y; Y = Y.next) Y.contact.m_toiFlag = false, Y.contact.m_islandFlag = false;
        }
      }
      if (e.findNewContacts(), e.m_subStepping) {
        e.m_stepComplete = false;
        break;
      }
    }
  }, i.prototype.solveIslandTOI = function(t, e, r) {
    for (var l = 0; l < this.m_bodies.length; ++l) {
      var s = this.m_bodies[l];
      x(s.c_position.c, s.m_sweep.c), s.c_position.a = s.m_sweep.a, x(s.c_velocity.v, s.m_linearVelocity), s.c_velocity.w = s.m_angularVelocity;
    }
    for (var l = 0; l < this.m_contacts.length; ++l) {
      var o = this.m_contacts[l];
      o.initConstraint(t);
    }
    for (var l = 0; l < t.positionIterations; ++l) {
      for (var n = 0, m = 0; m < this.m_contacts.length; ++m) {
        var o = this.m_contacts[m], h = o.solvePositionConstraintTOI(t, e, r);
        n = Ui(n, h);
      }
      var p = n >= -1.5 * z.linearSlop;
      if (p) break;
    }
    var l;
    x(e.m_sweep.c0, e.c_position.c), e.m_sweep.a0 = e.c_position.a, x(r.m_sweep.c0, r.c_position.c), r.m_sweep.a0 = r.c_position.a;
    for (var l = 0; l < this.m_contacts.length; ++l) {
      var o = this.m_contacts[l];
      o.initVelocityConstraint(t);
    }
    for (var l = 0; l < t.velocityIterations; ++l) for (var m = 0; m < this.m_contacts.length; ++m) {
      var o = this.m_contacts[m];
      o.solveVelocityConstraint(t);
    }
    for (var u = t.dt, l = 0; l < this.m_bodies.length; ++l) {
      var s = this.m_bodies[l];
      x(me, s.c_position.c);
      var c = s.c_position.a;
      x(vt, s.c_velocity.v);
      var _ = s.c_velocity.w;
      L(Hi, u, vt);
      var y = Ue(Hi);
      if (y > z.maxTranslationSquared) {
        var v = z.maxTranslation / Ss(y);
        xs(vt, v);
      }
      var f = u * _;
      if (f * f > z.maxRotationSquared) {
        var v = z.maxRotation / zs(f);
        _ *= v;
      }
      Xt(me, u, vt), c += u * _, x(s.c_position.c, me), s.c_position.a = c, x(s.c_velocity.v, vt), s.c_velocity.w = _, x(s.m_sweep.c, me), s.m_sweep.a = c, x(s.m_linearVelocity, vt), s.m_angularVelocity = _, s.synchronizeTransform();
    }
    this.postSolveIsland();
  }, i.prototype.postSolveIsland = function() {
    for (var t = 0; t < this.m_contacts.length; ++t) {
      var e = this.m_contacts[t];
      this.m_world.postSolve(e, e.m_impulse);
    }
  }, i;
})();
ss.TimeStep = cr;
var Yt = (function() {
  function i(t, e, r, s) {
    typeof t == "object" && t !== null ? (this.ex = a.clone(t), this.ey = a.clone(e)) : typeof t == "number" ? (this.ex = a.neo(t, r), this.ey = a.neo(e, s)) : (this.ex = a.zero(), this.ey = a.zero());
  }
  return i.prototype.toString = function() {
    return JSON.stringify(this);
  }, i.isValid = function(t) {
    return t === null || typeof t > "u" ? false : a.isValid(t.ex) && a.isValid(t.ey);
  }, i.assert = function(t) {
  }, i.prototype.set = function(t, e, r, s) {
    typeof t == "number" && typeof e == "number" && typeof r == "number" && typeof s == "number" ? (this.ex.setNum(t, r), this.ey.setNum(e, s)) : typeof t == "object" && typeof e == "object" ? (this.ex.setVec2(t), this.ey.setVec2(e)) : typeof t == "object" && (this.ex.setVec2(t.ex), this.ey.setVec2(t.ey));
  }, i.prototype.setIdentity = function() {
    this.ex.x = 1, this.ey.x = 0, this.ex.y = 0, this.ey.y = 1;
  }, i.prototype.setZero = function() {
    this.ex.x = 0, this.ey.x = 0, this.ex.y = 0, this.ey.y = 0;
  }, i.prototype.getInverse = function() {
    var t = this.ex.x, e = this.ey.x, r = this.ex.y, s = this.ey.y, o = t * s - e * r;
    o !== 0 && (o = 1 / o);
    var n = new i();
    return n.ex.x = o * s, n.ey.x = -o * e, n.ex.y = -o * r, n.ey.y = o * t, n;
  }, i.prototype.solve = function(t) {
    var e = this.ex.x, r = this.ey.x, s = this.ex.y, o = this.ey.y, n = e * o - r * s;
    n !== 0 && (n = 1 / n);
    var m = a.zero();
    return m.x = n * (o * t.x - r * t.y), m.y = n * (e * t.y - s * t.x), m;
  }, i.mul = function(t, e) {
    if (e && "x" in e && "y" in e) {
      var r = t.ex.x * e.x + t.ey.x * e.y, s = t.ex.y * e.x + t.ey.y * e.y;
      return a.neo(r, s);
    } else if (e && "ex" in e && "ey" in e) {
      var o = t.ex.x * e.ex.x + t.ey.x * e.ex.y, n = t.ex.x * e.ey.x + t.ey.x * e.ey.y, m = t.ex.y * e.ex.x + t.ey.y * e.ex.y, h = t.ex.y * e.ey.x + t.ey.y * e.ey.y;
      return new i(o, n, m, h);
    }
  }, i.mulVec2 = function(t, e) {
    var r = t.ex.x * e.x + t.ey.x * e.y, s = t.ex.y * e.x + t.ey.y * e.y;
    return a.neo(r, s);
  }, i.mulMat22 = function(t, e) {
    var r = t.ex.x * e.ex.x + t.ey.x * e.ex.y, s = t.ex.x * e.ey.x + t.ey.x * e.ey.y, o = t.ex.y * e.ex.x + t.ey.y * e.ex.y, n = t.ex.y * e.ey.x + t.ey.y * e.ey.y;
    return new i(r, s, o, n);
  }, i.mulT = function(t, e) {
    if (e && "x" in e && "y" in e) return a.neo(a.dot(e, t.ex), a.dot(e, t.ey));
    if (e && "ex" in e && "ey" in e) {
      var r = a.neo(a.dot(t.ex, e.ex), a.dot(t.ey, e.ex)), s = a.neo(a.dot(t.ex, e.ey), a.dot(t.ey, e.ey));
      return new i(r, s);
    }
  }, i.mulTVec2 = function(t, e) {
    return a.neo(a.dot(e, t.ex), a.dot(e, t.ey));
  }, i.mulTMat22 = function(t, e) {
    var r = a.neo(a.dot(t.ex, e.ex), a.dot(t.ey, e.ex)), s = a.neo(a.dot(t.ex, e.ey), a.dot(t.ey, e.ey));
    return new i(r, s);
  }, i.abs = function(t) {
    return new i(a.abs(t.ex), a.abs(t.ey));
  }, i.add = function(t, e) {
    return new i(a.add(t.ex, e.ex), a.add(t.ey, e.ey));
  }, i;
})();
var Ko = Math.sqrt;
var Br = g(0, 0);
var br = g(0, 0);
var xi = g(0, 0);
var he = g(0, 0);
var le = g(0, 0);
var wr = g(0, 0);
var Zi = g(0, 0);
var ge = g(0, 0);
var Q;
(function(i) {
  i[i.e_unset = -1] = "e_unset", i[i.e_circles = 0] = "e_circles", i[i.e_faceA = 1] = "e_faceA", i[i.e_faceB = 2] = "e_faceB";
})(Q || (Q = {}));
var J;
(function(i) {
  i[i.e_unset = -1] = "e_unset", i[i.e_vertex = 0] = "e_vertex", i[i.e_face = 1] = "e_face";
})(J || (J = {}));
var Me;
(function(i) {
  i[i.nullState = 0] = "nullState", i[i.addState = 1] = "addState", i[i.persistState = 2] = "persistState", i[i.removeState = 3] = "removeState";
})(Me || (Me = {}));
var Mt = (function() {
  function i() {
    this.v = g(0, 0), this.id = new os();
  }
  return i.prototype.set = function(t) {
    x(this.v, t.v), this.id.set(t.id);
  }, i.prototype.recycle = function() {
    S(this.v), this.id.recycle();
  }, i;
})();
var _r = (function() {
  function i() {
    this.localNormal = g(0, 0), this.localPoint = g(0, 0), this.points = [new kr(), new kr()], this.pointCount = 0;
  }
  return i.prototype.set = function(t) {
    this.type = t.type, x(this.localNormal, t.localNormal), x(this.localPoint, t.localPoint), this.pointCount = t.pointCount, this.points[0].set(t.points[0]), this.points[1].set(t.points[1]);
  }, i.prototype.recycle = function() {
    this.type = Q.e_unset, S(this.localNormal), S(this.localPoint), this.pointCount = 0, this.points[0].recycle(), this.points[1].recycle();
  }, i.prototype.getWorldManifold = function(t, e, r, s, o) {
    if (this.pointCount == 0) return t;
    t = t || new ns(), t.pointCount = this.pointCount;
    var n = t.normal, m = t.points, h = t.separations;
    switch (this.type) {
      case Q.e_circles: {
        ut(n, 1, 0);
        var p = this.points[0];
        T(Br, e, this.localPoint), T(br, s, p.localPoint), N(wr, br, Br);
        var l = Ue(wr);
        if (l > gt * gt) {
          var u = Ko(l);
          L(n, 1 / u, wr);
        }
        G2(he, 1, Br, r, n), G2(le, 1, br, -o, n), G2(m[0], 0.5, he, 0.5, le), h[0] = C(N(xi, le, he), n);
        break;
      }
      case Q.e_faceA: {
        $t(n, e.q, this.localNormal), T(Zi, e, this.localPoint);
        for (var c = 0; c < this.pointCount; ++c) {
          var p = this.points[c];
          T(ge, s, p.localPoint), G2(he, 1, ge, r - C(N(xi, ge, Zi), n), n), G2(le, 1, ge, -o, n), G2(m[c], 0.5, he, 0.5, le), h[c] = C(N(xi, le, he), n);
        }
        break;
      }
      case Q.e_faceB: {
        $t(n, s.q, this.localNormal), T(Zi, s, this.localPoint);
        for (var c = 0; c < this.pointCount; ++c) {
          var p = this.points[c];
          T(ge, e, p.localPoint), G2(le, 1, ge, o - C(N(xi, ge, Zi), n), n), G2(he, 1, ge, -r, n), G2(m[c], 0.5, he, 0.5, le), h[c] = C(N(xi, he, le), n);
        }
        Pi(n);
        break;
      }
    }
    return t;
  }, i.clipSegmentToLine = _i, i.ClipVertex = Mt, i.getPointStates = yo, i.PointState = Me, i;
})();
var kr = (function() {
  function i() {
    this.localPoint = g(0, 0), this.normalImpulse = 0, this.tangentImpulse = 0, this.id = new os();
  }
  return i.prototype.set = function(t) {
    x(this.localPoint, t.localPoint), this.normalImpulse = t.normalImpulse, this.tangentImpulse = t.tangentImpulse, this.id.set(t.id);
  }, i.prototype.recycle = function() {
    S(this.localPoint), this.normalImpulse = 0, this.tangentImpulse = 0, this.id.recycle();
  }, i;
})();
var os = (function() {
  function i() {
    this.key = -1, this.indexA = -1, this.indexB = -1, this.typeA = J.e_unset, this.typeB = J.e_unset;
  }
  return i.prototype.setFeatures = function(t, e, r, s) {
    this.indexA = t, this.indexB = r, this.typeA = e, this.typeB = s, this.key = this.indexA + this.indexB * 4 + this.typeA * 16 + this.typeB * 64;
  }, i.prototype.set = function(t) {
    this.indexA = t.indexA, this.indexB = t.indexB, this.typeA = t.typeA, this.typeB = t.typeB, this.key = this.indexA + this.indexB * 4 + this.typeA * 16 + this.typeB * 64;
  }, i.prototype.swapFeatures = function() {
    var t = this.indexA, e = this.indexB, r = this.typeA, s = this.typeB;
    this.indexA = e, this.indexB = t, this.typeA = s, this.typeB = r, this.key = this.indexA + this.indexB * 4 + this.typeA * 16 + this.typeB * 64;
  }, i.prototype.recycle = function() {
    this.indexA = 0, this.indexB = 0, this.typeA = J.e_unset, this.typeB = J.e_unset, this.key = -1;
  }, i;
})();
var ns = (function() {
  function i() {
    this.normal = g(0, 0), this.points = [g(0, 0), g(0, 0)], this.separations = [0, 0], this.pointCount = 0;
  }
  return i.prototype.recycle = function() {
    S(this.normal), S(this.points[0]), S(this.points[1]), this.separations[0] = 0, this.separations[1] = 0, this.pointCount = 0;
  }, i;
})();
function yo(i, t, e, r) {
  for (var s = 0; s < e.pointCount; ++s) {
    var o = e.points[s].id;
    i[s] = Me.removeState;
    for (var n = 0; n < r.pointCount; ++n) if (r.points[n].id.key === o.key) {
      i[s] = Me.persistState;
      break;
    }
  }
  for (var s = 0; s < r.pointCount; ++s) {
    var o = r.points[s].id;
    t[s] = Me.addState;
    for (var n = 0; n < e.pointCount; ++n) if (e.points[n].id.key === o.key) {
      t[s] = Me.persistState;
      break;
    }
  }
}
function _i(i, t, e, r, s) {
  var o = 0, n = C(e, t[0].v) - r, m = C(e, t[1].v) - r;
  if (n <= 0 && i[o++].set(t[0]), m <= 0 && i[o++].set(t[1]), n * m < 0) {
    var h = n / (n - m);
    G2(i[o].v, 1 - h, t[0].v, h, t[1].v), i[o].id.setFeatures(s, J.e_vertex, t[0].id.indexB, J.e_face), ++o;
  }
  return o;
}
var Go = Math.sqrt;
var Qo = Math.max;
var tn = Math.min;
var Ts = new Mi({ create: function() {
  return new Gt();
}, release: function(i) {
  i.recycle();
} });
var ti = new _r();
var Xi = new ns();
var Dr = (function() {
  function i(t) {
    this.prev = null, this.next = null, this.other = null, this.contact = t;
  }
  return i.prototype.recycle = function() {
    this.prev = null, this.next = null, this.other = null;
  }, i;
})();
function Rr(i, t) {
  return Go(i * t);
}
function Er(i, t) {
  return i > t ? i : t;
}
var ke = [];
var Or = (function() {
  function i() {
    this.rA = g(0, 0), this.rB = g(0, 0), this.normalImpulse = 0, this.tangentImpulse = 0, this.normalMass = 0, this.tangentMass = 0, this.velocityBias = 0;
  }
  return i.prototype.recycle = function() {
    S(this.rA), S(this.rB), this.normalImpulse = 0, this.tangentImpulse = 0, this.normalMass = 0, this.tangentMass = 0, this.velocityBias = 0;
  }, i;
})();
var ce = g(0, 0);
var et = g(0, 0);
var _e = g(0, 0);
var it = g(0, 0);
var Be = g(0, 0);
var De = Ze(0, 0, 0);
var Re = Ze(0, 0, 0);
var Ki = g(0, 0);
var Gi = g(0, 0);
var ei = g(0, 0);
var Qi = g(0, 0);
var Vr = g(0, 0);
var Cr = g(0, 0);
var rt = g(0, 0);
var U = g(0, 0);
var Ai = g(0, 0);
var Rt = g(0, 0);
var ii = g(0, 0);
var ri = g(0, 0);
var St = g(0, 0);
var ue = g(0, 0);
var X = g(0, 0);
var Et = g(0, 0);
var st = g(0, 0);
var ot = g(0, 0);
var te = g(0, 0);
var Gt = (function() {
  function i() {
    this.m_nodeA = new Dr(this), this.m_nodeB = new Dr(this), this.m_fixtureA = null, this.m_fixtureB = null, this.m_indexA = -1, this.m_indexB = -1, this.m_evaluateFcn = null, this.m_manifold = new _r(), this.m_prev = null, this.m_next = null, this.m_toi = 1, this.m_toiCount = 0, this.m_toiFlag = false, this.m_friction = 0, this.m_restitution = 0, this.m_tangentSpeed = 0, this.m_enabledFlag = true, this.m_islandFlag = false, this.m_touchingFlag = false, this.m_filterFlag = false, this.m_bulletHitFlag = false, this.m_impulse = new vo(this), this.v_points = [new Or(), new Or()], this.v_normal = g(0, 0), this.v_normalMass = new Yt(), this.v_K = new Yt(), this.v_pointCount = 0, this.v_tangentSpeed = 0, this.v_friction = 0, this.v_restitution = 0, this.v_invMassA = 0, this.v_invMassB = 0, this.v_invIA = 0, this.v_invIB = 0, this.p_localPoints = [g(0, 0), g(0, 0)], this.p_localNormal = g(0, 0), this.p_localPoint = g(0, 0), this.p_localCenterA = g(0, 0), this.p_localCenterB = g(0, 0), this.p_type = Q.e_unset, this.p_radiusA = 0, this.p_radiusB = 0, this.p_pointCount = 0, this.p_invMassA = 0, this.p_invMassB = 0, this.p_invIA = 0, this.p_invIB = 0;
  }
  return i.prototype.initialize = function(t, e, r, s, o) {
    this.m_fixtureA = t, this.m_fixtureB = r, this.m_indexA = e, this.m_indexB = s, this.m_evaluateFcn = o, this.m_friction = Rr(this.m_fixtureA.m_friction, this.m_fixtureB.m_friction), this.m_restitution = Er(this.m_fixtureA.m_restitution, this.m_fixtureB.m_restitution);
  }, i.prototype.recycle = function() {
    this.m_nodeA.recycle(), this.m_nodeB.recycle(), this.m_fixtureA = null, this.m_fixtureB = null, this.m_indexA = -1, this.m_indexB = -1, this.m_evaluateFcn = null, this.m_manifold.recycle(), this.m_prev = null, this.m_next = null, this.m_toi = 1, this.m_toiCount = 0, this.m_toiFlag = false, this.m_friction = 0, this.m_restitution = 0, this.m_tangentSpeed = 0, this.m_enabledFlag = true, this.m_islandFlag = false, this.m_touchingFlag = false, this.m_filterFlag = false, this.m_bulletHitFlag = false, this.m_impulse.recycle();
    for (var t = 0, e = this.v_points; t < e.length; t++) {
      var r = e[t];
      r.recycle();
    }
    S(this.v_normal), this.v_normalMass.setZero(), this.v_K.setZero(), this.v_pointCount = 0, this.v_tangentSpeed = 0, this.v_friction = 0, this.v_restitution = 0, this.v_invMassA = 0, this.v_invMassB = 0, this.v_invIA = 0, this.v_invIB = 0;
    for (var s = 0, o = this.p_localPoints; s < o.length; s++) {
      var n = o[s];
      S(n);
    }
    S(this.p_localNormal), S(this.p_localPoint), S(this.p_localCenterA), S(this.p_localCenterB), this.p_type = Q.e_unset, this.p_radiusA = 0, this.p_radiusB = 0, this.p_pointCount = 0, this.p_invMassA = 0, this.p_invMassB = 0, this.p_invIA = 0, this.p_invIB = 0;
  }, i.prototype.initConstraint = function(t) {
    var e = this.m_fixtureA, r = this.m_fixtureB;
    if (!(e === null || r === null)) {
      var s = e.m_body, o = r.m_body;
      if (!(s === null || o === null)) {
        var n = e.m_shape, m = r.m_shape;
        if (!(n === null || m === null)) {
          var h = this.m_manifold, p = h.pointCount;
          this.v_invMassA = s.m_invMass, this.v_invMassB = o.m_invMass, this.v_invIA = s.m_invI, this.v_invIB = o.m_invI, this.v_friction = this.m_friction, this.v_restitution = this.m_restitution, this.v_tangentSpeed = this.m_tangentSpeed, this.v_pointCount = p, this.v_K.setZero(), this.v_normalMass.setZero(), this.p_invMassA = s.m_invMass, this.p_invMassB = o.m_invMass, this.p_invIA = s.m_invI, this.p_invIB = o.m_invI, x(this.p_localCenterA, s.m_sweep.localCenter), x(this.p_localCenterB, o.m_sweep.localCenter), this.p_radiusA = n.m_radius, this.p_radiusB = m.m_radius, this.p_type = h.type, x(this.p_localNormal, h.localNormal), x(this.p_localPoint, h.localPoint), this.p_pointCount = p;
          for (var l = 0; l < z.maxManifoldPoints; ++l) this.v_points[l].recycle(), S(this.p_localPoints[l]);
          for (var l = 0; l < p; ++l) {
            var u = h.points[l], c = this.v_points[l];
            t.warmStarting && (c.normalImpulse = t.dtRatio * u.normalImpulse, c.tangentImpulse = t.dtRatio * u.tangentImpulse), x(this.p_localPoints[l], u.localPoint);
          }
        }
      }
    }
  }, i.prototype.getManifold = function() {
    return this.m_manifold;
  }, i.prototype.getWorldManifold = function(t) {
    var e = this.m_fixtureA, r = this.m_fixtureB;
    if (!(e === null || r === null)) {
      var s = e.m_body, o = r.m_body;
      if (!(s === null || o === null)) {
        var n = e.m_shape, m = r.m_shape;
        if (!(n === null || m === null)) return this.m_manifold.getWorldManifold(t, s.getTransform(), n.m_radius, o.getTransform(), m.m_radius);
      }
    }
  }, i.prototype.setEnabled = function(t) {
    this.m_enabledFlag = !!t;
  }, i.prototype.isEnabled = function() {
    return this.m_enabledFlag;
  }, i.prototype.isTouching = function() {
    return this.m_touchingFlag;
  }, i.prototype.getNext = function() {
    return this.m_next;
  }, i.prototype.getFixtureA = function() {
    return this.m_fixtureA;
  }, i.prototype.getFixtureB = function() {
    return this.m_fixtureB;
  }, i.prototype.getChildIndexA = function() {
    return this.m_indexA;
  }, i.prototype.getChildIndexB = function() {
    return this.m_indexB;
  }, i.prototype.flagForFiltering = function() {
    this.m_filterFlag = true;
  }, i.prototype.setFriction = function(t) {
    this.m_friction = t;
  }, i.prototype.getFriction = function() {
    return this.m_friction;
  }, i.prototype.resetFriction = function() {
    var t = this.m_fixtureA, e = this.m_fixtureB;
    t === null || e === null || (this.m_friction = Rr(t.m_friction, e.m_friction));
  }, i.prototype.setRestitution = function(t) {
    this.m_restitution = t;
  }, i.prototype.getRestitution = function() {
    return this.m_restitution;
  }, i.prototype.resetRestitution = function() {
    var t = this.m_fixtureA, e = this.m_fixtureB;
    t === null || e === null || (this.m_restitution = Er(t.m_restitution, e.m_restitution));
  }, i.prototype.setTangentSpeed = function(t) {
    this.m_tangentSpeed = t;
  }, i.prototype.getTangentSpeed = function() {
    return this.m_tangentSpeed;
  }, i.prototype.evaluate = function(t, e, r) {
    var s = this.m_fixtureA, o = this.m_fixtureB;
    s === null || o === null || this.m_evaluateFcn(t, e, s, this.m_indexA, r, o, this.m_indexB);
  }, i.prototype.update = function(t) {
    var e = this.m_fixtureA, r = this.m_fixtureB;
    if (!(e === null || r === null)) {
      var s = e.m_body, o = r.m_body;
      if (!(s === null || o === null)) {
        var n = e.m_shape, m = r.m_shape;
        if (!(n === null || m === null)) {
          this.m_enabledFlag = true;
          var h = false, p = this.m_touchingFlag, l = e.m_isSensor, u = r.m_isSensor, c = l || u, _ = s.m_xf, y = o.m_xf;
          if (c) h = es(n, this.m_indexA, m, this.m_indexB, _, y), this.m_manifold.pointCount = 0;
          else {
            ti.recycle(), ti.set(this.m_manifold), this.m_manifold.recycle(), this.evaluate(this.m_manifold, _, y), h = this.m_manifold.pointCount > 0;
            for (var v = 0; v < this.m_manifold.pointCount; ++v) {
              var f = this.m_manifold.points[v];
              f.normalImpulse = 0, f.tangentImpulse = 0;
              for (var d = 0; d < ti.pointCount; ++d) {
                var A = ti.points[d];
                if (A.id.key === f.id.key) {
                  f.normalImpulse = A.normalImpulse, f.tangentImpulse = A.tangentImpulse;
                  break;
                }
              }
            }
            h !== p && (s.setAwake(true), o.setAwake(true));
          }
          this.m_touchingFlag = h;
          var b = typeof t == "object" && t !== null;
          !p && h && b && t.beginContact(this), p && !h && b && t.endContact(this), !c && h && b && ti && t.preSolve(this, ti);
        }
      }
    }
  }, i.prototype.solvePositionConstraint = function(t) {
    return this._solvePositionConstraint(t, null, null);
  }, i.prototype.solvePositionConstraintTOI = function(t, e, r) {
    return this._solvePositionConstraint(t, e, r);
  }, i.prototype._solvePositionConstraint = function(t, e, r) {
    var s = e !== null && r !== null, o = 0, n = this.m_fixtureA, m = this.m_fixtureB;
    if (n === null || m === null) return o;
    var h = n.m_body, p = m.m_body;
    if (h === null || p === null) return o;
    var l = h.c_position, u = p.c_position, c = this.p_localCenterA, _ = this.p_localCenterB, y = 0, v = 0;
    (!s || h === e || h === r) && (y = this.p_invMassA, v = this.p_invIA);
    var f = 0, d = 0;
    (!s || p === e || p === r) && (f = this.p_invMassB, d = this.p_invIB), x(ce, l.c);
    var A = l.a;
    x(_e, u.c);
    for (var b = u.a, w = 0; w < this.p_pointCount; ++w) {
      qi(De, c, ce, A), qi(Re, _, _e, b);
      var V = void 0;
      switch (this.p_type) {
        case Q.e_circles: {
          T(Ki, De, this.p_localPoint), T(Gi, Re, this.p_localPoints[0]), N(U, Gi, Ki), Kt(U), G2(Ai, 0.5, Ki, 0.5, Gi), V = C(Gi, U) - C(Ki, U) - this.p_radiusA - this.p_radiusB;
          break;
        }
        case Q.e_faceA: {
          $t(U, De.q, this.p_localNormal), T(Qi, De, this.p_localPoint), T(ei, Re, this.p_localPoints[w]), V = C(ei, U) - C(Qi, U) - this.p_radiusA - this.p_radiusB, x(Ai, ei);
          break;
        }
        case Q.e_faceB: {
          $t(U, Re.q, this.p_localNormal), T(Qi, Re, this.p_localPoint), T(ei, De, this.p_localPoints[w]), V = C(ei, U) - C(Qi, U) - this.p_radiusA - this.p_radiusB, x(Ai, ei), Pi(U);
          break;
        }
        default:
          return o;
      }
      N(Vr, Ai, ce), N(Cr, Ai, _e), o = tn(o, V);
      var I = s ? z.toiBaugarte : z.baumgarte, M = z.linearSlop, P = z.maxLinearCorrection, k = pt(I * (V + M), -P, 0), F = E(Vr, U), O = E(Cr, U), Y = y + f + v * F * F + d * O * O, j = Y > 0 ? -k / Y : 0;
      L(rt, j, U), Ci(ce, y, rt), A -= v * E(Vr, rt), Xt(_e, f, rt), b += d * E(Cr, rt);
    }
    return x(l.c, ce), l.a = A, x(u.c, _e), u.a = b, o;
  }, i.prototype.initVelocityConstraint = function(t) {
    var e = this.m_fixtureA, r = this.m_fixtureB;
    if (!(e === null || r === null)) {
      var s = e.m_body, o = r.m_body;
      if (!(s === null || o === null)) {
        var n = s.c_velocity, m = o.c_velocity, h = s.c_position, p = o.c_position, l = this.p_radiusA, u = this.p_radiusB, c = this.m_manifold, _ = this.v_invMassA, y = this.v_invMassB, v = this.v_invIA, f = this.v_invIB, d = this.p_localCenterA, A = this.p_localCenterB;
        x(ce, h.c);
        var b = h.a;
        x(et, n.v);
        var w = n.w;
        x(_e, p.c);
        var V = p.a;
        x(it, m.v);
        var I = m.w;
        qi(De, d, ce, b), qi(Re, A, _e, V), Xi.recycle(), c.getWorldManifold(Xi, De, l, Re, u), x(this.v_normal, Xi.normal);
        for (var M = 0; M < this.v_pointCount; ++M) {
          var P = this.v_points[M], k = Xi.points[M];
          N(P.rA, k, ce), N(P.rB, k, _e);
          var F = E(P.rA, this.v_normal), O = E(P.rB, this.v_normal), Y = _ + y + v * F * F + f * O * O;
          P.normalMass = Y > 0 ? 1 / Y : 0, je(Be, this.v_normal, 1);
          var j = E(P.rA, Be), H = E(P.rB, Be), It = _ + y + v * j * j + f * H * H;
          P.tangentMass = It > 0 ? 1 / It : 0, P.velocityBias = 0;
          var ct = 0;
          ct += C(this.v_normal, it), ct += C(this.v_normal, Lt(te, I, P.rB)), ct -= C(this.v_normal, et), ct -= C(this.v_normal, Lt(te, w, P.rA)), ct < -z.velocityThreshold && (P.velocityBias = -this.v_restitution * ct);
        }
        if (this.v_pointCount == 2 && t.blockSolve) {
          var Wt = this.v_points[0], Bt = this.v_points[1], tt = E(Wt.rA, this.v_normal), pi = E(Wt.rB, this.v_normal), Tt = E(Bt.rA, this.v_normal), Ae = E(Bt.rB, this.v_normal), Le = _ + y + v * tt * tt + f * pi * pi, vi = _ + y + v * Tt * Tt + f * Ae * Ae, Xe = _ + y + v * tt * Tt + f * pi * Ae, pr = 1e3;
          if (Le * Le < pr * (Le * vi - Xe * Xe)) {
            this.v_K.ex.setNum(Le, Xe), this.v_K.ey.setNum(Xe, vi);
            var ls = this.v_K.ex.x, cs = this.v_K.ey.x, _s = this.v_K.ex.y, us = this.v_K.ey.y, Fe = ls * us - cs * _s;
            Fe !== 0 && (Fe = 1 / Fe), this.v_normalMass.ex.x = Fe * us, this.v_normalMass.ey.x = -Fe * cs, this.v_normalMass.ex.y = -Fe * _s, this.v_normalMass.ey.y = Fe * ls;
          } else this.v_pointCount = 1;
        }
        x(h.c, ce), h.a = b, x(n.v, et), n.w = w, x(p.c, _e), p.a = V, x(m.v, it), m.w = I;
      }
    }
  }, i.prototype.warmStartConstraint = function(t) {
    var e = this.m_fixtureA, r = this.m_fixtureB;
    if (!(e === null || r === null)) {
      var s = e.m_body, o = r.m_body;
      if (!(s === null || o === null)) {
        var n = s.c_velocity, m = o.c_velocity, h = this.v_invMassA, p = this.v_invIA, l = this.v_invMassB, u = this.v_invIB;
        x(et, n.v);
        var c = n.w;
        x(it, m.v);
        var _ = m.w;
        x(U, this.v_normal), je(Be, U, 1);
        for (var y = 0; y < this.v_pointCount; ++y) {
          var v = this.v_points[y];
          G2(rt, v.normalImpulse, U, v.tangentImpulse, Be), c -= p * E(v.rA, rt), Ci(et, h, rt), _ += u * E(v.rB, rt), Xt(it, l, rt);
        }
        x(n.v, et), n.w = c, x(m.v, it), m.w = _;
      }
    }
  }, i.prototype.storeConstraintImpulses = function(t) {
    for (var e = this.m_manifold, r = 0; r < this.v_pointCount; ++r) e.points[r].normalImpulse = this.v_points[r].normalImpulse, e.points[r].tangentImpulse = this.v_points[r].tangentImpulse;
  }, i.prototype.solveVelocityConstraint = function(t) {
    var e = this.m_fixtureA, r = this.m_fixtureB;
    if (!(e === null || r === null)) {
      var s = e.m_body, o = r.m_body;
      if (!(s === null || o === null)) {
        var n = s.c_velocity, m = o.c_velocity, h = this.v_invMassA, p = this.v_invIA, l = this.v_invMassB, u = this.v_invIB;
        x(et, n.v);
        var c = n.w;
        x(it, m.v);
        var _ = m.w;
        x(U, this.v_normal), je(Be, U, 1);
        for (var y = this.v_friction, v = 0; v < this.v_pointCount; ++v) {
          var f = this.v_points[v];
          S(Rt), Jt(Rt, it), Jt(Rt, Lt(te, _, f.rB)), ve(Rt, et), ve(Rt, Lt(te, c, f.rA));
          var d = C(Rt, Be) - this.v_tangentSpeed, A = f.tangentMass * -d, b = y * f.normalImpulse, w = pt(f.tangentImpulse + A, -b, b);
          A = w - f.tangentImpulse, f.tangentImpulse = w, L(rt, A, Be), Ci(et, h, rt), c -= p * E(f.rA, rt), Xt(it, l, rt), _ += u * E(f.rB, rt);
        }
        if (this.v_pointCount == 1 || t.blockSolve == false) for (var V = 0; V < this.v_pointCount; ++V) {
          var f = this.v_points[V];
          S(Rt), Jt(Rt, it), Jt(Rt, Lt(te, _, f.rB)), ve(Rt, et), ve(Rt, Lt(te, c, f.rA));
          var I = C(Rt, U), A = -f.normalMass * (I - f.velocityBias), w = Qo(f.normalImpulse + A, 0);
          A = w - f.normalImpulse, f.normalImpulse = w, L(rt, A, U), Ci(et, h, rt), c -= p * E(f.rA, rt), Xt(it, l, rt), _ += u * E(f.rB, rt);
        }
        else {
          var M = this.v_points[0], P = this.v_points[1];
          ut(ue, M.normalImpulse, P.normalImpulse), S(ii), Jt(ii, it), Jt(ii, Lt(te, _, M.rB)), ve(ii, et), ve(ii, Lt(te, c, M.rA)), S(ri), Jt(ri, it), Jt(ri, Lt(te, _, P.rB)), ve(ri, et), ve(ri, Lt(te, c, P.rA));
          var k = C(ii, U), F = C(ri, U);
          for (ut(St, k - M.velocityBias, F - P.velocityBias), St.x -= this.v_K.ex.x * ue.x + this.v_K.ey.x * ue.y, St.y -= this.v_K.ex.y * ue.x + this.v_K.ey.y * ue.y; ; ) {
            if (S(X), X.x = -(this.v_normalMass.ex.x * St.x + this.v_normalMass.ey.x * St.y), X.y = -(this.v_normalMass.ex.y * St.x + this.v_normalMass.ey.y * St.y), X.x >= 0 && X.y >= 0) {
              N(Et, X, ue), L(st, Et.x, U), L(ot, Et.y, U), se(et, -h, st, -h, ot, 1, et), c -= p * (E(M.rA, st) + E(P.rA, ot)), se(it, l, st, l, ot, 1, it), _ += u * (E(M.rB, st) + E(P.rB, ot)), M.normalImpulse = X.x, P.normalImpulse = X.y;
              break;
            }
            if (X.x = -M.normalMass * St.x, X.y = 0, k = 0, F = this.v_K.ex.y * X.x + St.y, X.x >= 0 && F >= 0) {
              N(Et, X, ue), L(st, Et.x, U), L(ot, Et.y, U), se(et, -h, st, -h, ot, 1, et), c -= p * (E(M.rA, st) + E(P.rA, ot)), se(it, l, st, l, ot, 1, it), _ += u * (E(M.rB, st) + E(P.rB, ot)), M.normalImpulse = X.x, P.normalImpulse = X.y;
              break;
            }
            if (X.x = 0, X.y = -P.normalMass * St.y, k = this.v_K.ey.x * X.y + St.x, F = 0, X.y >= 0 && k >= 0) {
              N(Et, X, ue), L(st, Et.x, U), L(ot, Et.y, U), se(et, -h, st, -h, ot, 1, et), c -= p * (E(M.rA, st) + E(P.rA, ot)), se(it, l, st, l, ot, 1, it), _ += u * (E(M.rB, st) + E(P.rB, ot)), M.normalImpulse = X.x, P.normalImpulse = X.y;
              break;
            }
            if (X.x = 0, X.y = 0, k = St.x, F = St.y, k >= 0 && F >= 0) {
              N(Et, X, ue), L(st, Et.x, U), L(ot, Et.y, U), se(et, -h, st, -h, ot, 1, et), c -= p * (E(M.rA, st) + E(P.rA, ot)), se(it, l, st, l, ot, 1, it), _ += u * (E(M.rB, st) + E(P.rB, ot)), M.normalImpulse = X.x, P.normalImpulse = X.y;
              break;
            }
            break;
          }
        }
        x(n.v, et), n.w = c, x(m.v, it), m.w = _;
      }
    }
  }, i.addType = function(t, e, r) {
    ke[t] = ke[t] || {}, ke[t][e] = r;
  }, i.create = function(t, e, r, s) {
    var o = t.m_shape.m_type, n = r.m_shape.m_type, m = Ts.allocate(), h;
    if (h = ke[o] && ke[o][n]) m.initialize(t, e, r, s, h);
    else if (h = ke[n] && ke[n][o]) m.initialize(r, s, t, e, h);
    else return null;
    t = m.m_fixtureA, r = m.m_fixtureB, e = m.getChildIndexA(), s = m.getChildIndexB();
    var p = t.m_body, l = r.m_body;
    return m.m_nodeA.contact = m, m.m_nodeA.other = l, m.m_nodeA.prev = null, m.m_nodeA.next = p.m_contactList, p.m_contactList != null && (p.m_contactList.prev = m.m_nodeA), p.m_contactList = m.m_nodeA, m.m_nodeB.contact = m, m.m_nodeB.other = p, m.m_nodeB.prev = null, m.m_nodeB.next = l.m_contactList, l.m_contactList != null && (l.m_contactList.prev = m.m_nodeB), l.m_contactList = m.m_nodeB, t.isSensor() == false && r.isSensor() == false && (p.setAwake(true), l.setAwake(true)), m;
  }, i.destroy = function(t, e) {
    var r = t.m_fixtureA, s = t.m_fixtureB;
    if (!(r === null || s === null)) {
      var o = r.m_body, n = s.m_body;
      o === null || n === null || (t.isTouching() && e.endContact(t), t.m_nodeA.prev && (t.m_nodeA.prev.next = t.m_nodeA.next), t.m_nodeA.next && (t.m_nodeA.next.prev = t.m_nodeA.prev), t.m_nodeA == o.m_contactList && (o.m_contactList = t.m_nodeA.next), t.m_nodeB.prev && (t.m_nodeB.prev.next = t.m_nodeB.next), t.m_nodeB.next && (t.m_nodeB.next.prev = t.m_nodeB.prev), t.m_nodeB == n.m_contactList && (n.m_contactList = t.m_nodeB.next), t.m_manifold.pointCount > 0 && !r.m_isSensor && !s.m_isSensor && (o.setAwake(true), n.setAwake(true)), Ts.release(t));
    }
  }, i;
})();
var en = { gravity: a.zero(), allowSleep: true, warmStarting: true, continuousPhysics: true, subStepping: false, blockSolve: true, velocityIterations: 8, positionIterations: 3 };
var Li = (function() {
  function i(t) {
    if (!(this instanceof i)) return new i(t);
    this.s_step = new cr(), t ? a.isValid(t) && (t = { gravity: t }) : t = {}, t = qt(t, en), this.m_solver = new ss(this), this.m_broadPhase = new no(), this.m_contactList = null, this.m_contactCount = 0, this.m_bodyList = null, this.m_bodyCount = 0, this.m_jointList = null, this.m_jointCount = 0, this.m_stepComplete = true, this.m_allowSleep = t.allowSleep, this.m_gravity = a.clone(t.gravity), this.m_clearForces = true, this.m_newFixture = false, this.m_locked = false, this.m_warmStarting = t.warmStarting, this.m_continuousPhysics = t.continuousPhysics, this.m_subStepping = t.subStepping, this.m_blockSolve = t.blockSolve, this.m_velocityIterations = t.velocityIterations, this.m_positionIterations = t.positionIterations, this.m_t = 0, this.m_step_callback = [];
  }
  return i.prototype._serialize = function() {
    for (var t = [], e = [], r = this.getBodyList(); r; r = r.getNext()) t.push(r);
    for (var s = this.getJointList(); s; s = s.getNext()) typeof s._serialize == "function" && e.push(s);
    return { gravity: this.m_gravity, bodies: t, joints: e };
  }, i._deserialize = function(t, e, r) {
    if (!t) return new i();
    var s = new i(t.gravity);
    if (t.bodies) for (var o = t.bodies.length - 1; o >= 0; o -= 1) s._addBody(r(W, t.bodies[o], s));
    if (t.joints) for (var o = t.joints.length - 1; o >= 0; o--) s.createJoint(r(yt, t.joints[o], s));
    return s;
  }, i.prototype.getBodyList = function() {
    return this.m_bodyList;
  }, i.prototype.getJointList = function() {
    return this.m_jointList;
  }, i.prototype.getContactList = function() {
    return this.m_contactList;
  }, i.prototype.getBodyCount = function() {
    return this.m_bodyCount;
  }, i.prototype.getJointCount = function() {
    return this.m_jointCount;
  }, i.prototype.getContactCount = function() {
    return this.m_contactCount;
  }, i.prototype.setGravity = function(t) {
    this.m_gravity.set(t);
  }, i.prototype.getGravity = function() {
    return this.m_gravity;
  }, i.prototype.isLocked = function() {
    return this.m_locked;
  }, i.prototype.setAllowSleeping = function(t) {
    if (t != this.m_allowSleep && (this.m_allowSleep = t, this.m_allowSleep == false)) for (var e = this.m_bodyList; e; e = e.m_next) e.setAwake(true);
  }, i.prototype.getAllowSleeping = function() {
    return this.m_allowSleep;
  }, i.prototype.setWarmStarting = function(t) {
    this.m_warmStarting = t;
  }, i.prototype.getWarmStarting = function() {
    return this.m_warmStarting;
  }, i.prototype.setContinuousPhysics = function(t) {
    this.m_continuousPhysics = t;
  }, i.prototype.getContinuousPhysics = function() {
    return this.m_continuousPhysics;
  }, i.prototype.setSubStepping = function(t) {
    this.m_subStepping = t;
  }, i.prototype.getSubStepping = function() {
    return this.m_subStepping;
  }, i.prototype.setAutoClearForces = function(t) {
    this.m_clearForces = t;
  }, i.prototype.getAutoClearForces = function() {
    return this.m_clearForces;
  }, i.prototype.clearForces = function() {
    for (var t = this.m_bodyList; t; t = t.getNext()) t.m_force.setZero(), t.m_torque = 0;
  }, i.prototype.queryAABB = function(t, e) {
    var r = this.m_broadPhase;
    this.m_broadPhase.query(t, function(s) {
      var o = r.getUserData(s);
      return e(o.fixture);
    });
  }, i.prototype.rayCast = function(t, e, r) {
    var s = this.m_broadPhase;
    this.m_broadPhase.rayCast({ maxFraction: 1, p1: t, p2: e }, function(o, n) {
      var m = s.getUserData(n), h = m.fixture, p = m.childIndex, l = {}, u = h.rayCast(l, o, p);
      if (u) {
        var c = l.fraction, _ = a.add(a.mulNumVec2(1 - c, o.p1), a.mulNumVec2(c, o.p2));
        return r(h, _, l.normal, c);
      }
      return o.maxFraction;
    });
  }, i.prototype.getProxyCount = function() {
    return this.m_broadPhase.getProxyCount();
  }, i.prototype.getTreeHeight = function() {
    return this.m_broadPhase.getTreeHeight();
  }, i.prototype.getTreeBalance = function() {
    return this.m_broadPhase.getTreeBalance();
  }, i.prototype.getTreeQuality = function() {
    return this.m_broadPhase.getTreeQuality();
  }, i.prototype.shiftOrigin = function(t) {
    if (!this.isLocked()) {
      for (var e = this.m_bodyList; e; e = e.m_next) e.m_xf.p.sub(t), e.m_sweep.c0.sub(t), e.m_sweep.c.sub(t);
      for (var r = this.m_jointList; r; r = r.m_next) r.shiftOrigin(t);
      this.m_broadPhase.shiftOrigin(t);
    }
  }, i.prototype._addBody = function(t) {
    this.isLocked() || (t.m_prev = null, t.m_next = this.m_bodyList, this.m_bodyList && (this.m_bodyList.m_prev = t), this.m_bodyList = t, ++this.m_bodyCount, this.publish("add-body", t));
  }, i.prototype.createBody = function(t, e) {
    if (this.isLocked()) return null;
    var r = {};
    t && (a.isValid(t) ? r = { position: t, angle: e } : typeof t == "object" && (r = t));
    var s = new W(this, r);
    return this._addBody(s), s;
  }, i.prototype.createDynamicBody = function(t, e) {
    var r = {};
    return t && (a.isValid(t) ? r = { position: t, angle: e } : typeof t == "object" && (r = t)), r.type = "dynamic", this.createBody(r);
  }, i.prototype.createKinematicBody = function(t, e) {
    var r = {};
    return t && (a.isValid(t) ? r = { position: t, angle: e } : typeof t == "object" && (r = t)), r.type = "kinematic", this.createBody(r);
  }, i.prototype.destroyBody = function(t) {
    if (!this.isLocked()) {
      if (t.m_destroyed) return false;
      for (var e = t.m_jointList; e; ) {
        var r = e;
        e = e.next, this.publish("remove-joint", r.joint), this.destroyJoint(r.joint), t.m_jointList = e;
      }
      t.m_jointList = null;
      for (var s = t.m_contactList; s; ) {
        var o = s;
        s = s.next, this.destroyContact(o.contact), t.m_contactList = s;
      }
      t.m_contactList = null;
      for (var n = t.m_fixtureList; n; ) {
        var m = n;
        n = n.m_next, this.publish("remove-fixture", m), m.destroyProxies(this.m_broadPhase), t.m_fixtureList = n;
      }
      return t.m_fixtureList = null, t.m_prev && (t.m_prev.m_next = t.m_next), t.m_next && (t.m_next.m_prev = t.m_prev), t == this.m_bodyList && (this.m_bodyList = t.m_next), t.m_destroyed = true, --this.m_bodyCount, this.publish("remove-body", t), true;
    }
  }, i.prototype.createJoint = function(t) {
    if (this.isLocked()) return null;
    if (t.m_prev = null, t.m_next = this.m_jointList, this.m_jointList && (this.m_jointList.m_prev = t), this.m_jointList = t, ++this.m_jointCount, t.m_edgeA.joint = t, t.m_edgeA.other = t.m_bodyB, t.m_edgeA.prev = null, t.m_edgeA.next = t.m_bodyA.m_jointList, t.m_bodyA.m_jointList && (t.m_bodyA.m_jointList.prev = t.m_edgeA), t.m_bodyA.m_jointList = t.m_edgeA, t.m_edgeB.joint = t, t.m_edgeB.other = t.m_bodyA, t.m_edgeB.prev = null, t.m_edgeB.next = t.m_bodyB.m_jointList, t.m_bodyB.m_jointList && (t.m_bodyB.m_jointList.prev = t.m_edgeB), t.m_bodyB.m_jointList = t.m_edgeB, t.m_collideConnected == false) for (var e = t.m_bodyB.getContactList(); e; e = e.next) e.other == t.m_bodyA && e.contact.flagForFiltering();
    return this.publish("add-joint", t), t;
  }, i.prototype.destroyJoint = function(t) {
    if (!this.isLocked()) {
      t.m_prev && (t.m_prev.m_next = t.m_next), t.m_next && (t.m_next.m_prev = t.m_prev), t == this.m_jointList && (this.m_jointList = t.m_next);
      var e = t.m_bodyA, r = t.m_bodyB;
      if (e.setAwake(true), r.setAwake(true), t.m_edgeA.prev && (t.m_edgeA.prev.next = t.m_edgeA.next), t.m_edgeA.next && (t.m_edgeA.next.prev = t.m_edgeA.prev), t.m_edgeA == e.m_jointList && (e.m_jointList = t.m_edgeA.next), t.m_edgeA.prev = null, t.m_edgeA.next = null, t.m_edgeB.prev && (t.m_edgeB.prev.next = t.m_edgeB.next), t.m_edgeB.next && (t.m_edgeB.next.prev = t.m_edgeB.prev), t.m_edgeB == r.m_jointList && (r.m_jointList = t.m_edgeB.next), t.m_edgeB.prev = null, t.m_edgeB.next = null, --this.m_jointCount, t.m_collideConnected == false) for (var s = r.getContactList(); s; ) s.other == e && s.contact.flagForFiltering(), s = s.next;
      this.publish("remove-joint", t);
    }
  }, i.prototype.step = function(t, e, r) {
    if (this.publish("pre-step", t), (e | 0) !== e && (e = 0), e = e || this.m_velocityIterations, r = r || this.m_positionIterations, this.m_newFixture && (this.findNewContacts(), this.m_newFixture = false), this.m_locked = true, this.s_step.reset(t), this.s_step.velocityIterations = e, this.s_step.positionIterations = r, this.s_step.warmStarting = this.m_warmStarting, this.s_step.blockSolve = this.m_blockSolve, this.updateContacts(), this.m_stepComplete && t > 0) {
      this.m_solver.solveWorld(this.s_step);
      for (var s = this.m_bodyList; s; s = s.getNext()) s.m_islandFlag != false && (s.isStatic() || s.synchronizeFixtures());
      this.findNewContacts();
    }
    this.m_continuousPhysics && t > 0 && this.m_solver.solveWorldTOI(this.s_step), this.m_clearForces && this.clearForces(), this.m_locked = false;
    for (var o; o = this.m_step_callback.shift(); ) o(this);
    this.publish("post-step", t);
  }, i.prototype.queueUpdate = function(t) {
    this.isLocked() ? this.m_step_callback.push(t) : t(this);
  }, i.prototype.findNewContacts = function() {
    var t = this;
    this.m_broadPhase.updatePairs(function(e, r) {
      return t.createContact(e, r);
    });
  }, i.prototype.createContact = function(t, e) {
    var r = t.fixture, s = e.fixture, o = t.childIndex, n = e.childIndex, m = r.getBody(), h = s.getBody();
    if (m != h) {
      for (var p = h.getContactList(); p; ) {
        if (p.other == m) {
          var l = p.contact.getFixtureA(), u = p.contact.getFixtureB(), c = p.contact.getChildIndexA(), _ = p.contact.getChildIndexB();
          if (l == r && u == s && c == o && _ == n || l == s && u == r && c == n && _ == o) return;
        }
        p = p.next;
      }
      if (h.shouldCollide(m) != false && s.shouldCollide(r) != false) {
        var y = Gt.create(r, o, s, n);
        y != null && (y.m_prev = null, this.m_contactList != null && (y.m_next = this.m_contactList, this.m_contactList.m_prev = y), this.m_contactList = y, ++this.m_contactCount);
      }
    }
  }, i.prototype.updateContacts = function() {
    for (var t, e = this.m_contactList; t = e; ) {
      e = t.getNext();
      var r = t.getFixtureA(), s = t.getFixtureB(), o = t.getChildIndexA(), n = t.getChildIndexB(), m = r.getBody(), h = s.getBody();
      if (t.m_filterFlag) {
        if (h.shouldCollide(m) == false) {
          this.destroyContact(t);
          continue;
        }
        if (s.shouldCollide(r) == false) {
          this.destroyContact(t);
          continue;
        }
        t.m_filterFlag = false;
      }
      var p = m.isAwake() && !m.isStatic(), l = h.isAwake() && !h.isStatic();
      if (!(p == false && l == false)) {
        var u = r.m_proxies[o].proxyId, c = s.m_proxies[n].proxyId, _ = this.m_broadPhase.testOverlap(u, c);
        if (_ == false) {
          this.destroyContact(t);
          continue;
        }
        t.update(this);
      }
    }
  }, i.prototype.destroyContact = function(t) {
    t.m_prev && (t.m_prev.m_next = t.m_next), t.m_next && (t.m_next.m_prev = t.m_prev), t == this.m_contactList && (this.m_contactList = t.m_next), Gt.destroy(t, this), --this.m_contactCount;
  }, i.prototype.on = function(t, e) {
    return typeof t != "string" || typeof e != "function" ? this : (this._listeners || (this._listeners = {}), this._listeners[t] || (this._listeners[t] = []), this._listeners[t].push(e), this);
  }, i.prototype.off = function(t, e) {
    if (typeof t != "string" || typeof e != "function") return this;
    var r = this._listeners && this._listeners[t];
    if (!r || !r.length) return this;
    var s = r.indexOf(e);
    return s >= 0 && r.splice(s, 1), this;
  }, i.prototype.publish = function(t, e, r, s) {
    var o = this._listeners && this._listeners[t];
    if (!o || !o.length) return 0;
    for (var n = 0; n < o.length; n++) o[n].call(this, e, r, s);
    return o.length;
  }, i.prototype.beginContact = function(t) {
    this.publish("begin-contact", t);
  }, i.prototype.endContact = function(t) {
    this.publish("end-contact", t);
  }, i.prototype.preSolve = function(t, e) {
    this.publish("pre-solve", t, e);
  }, i.prototype.postSolve = function(t, e) {
    this.publish("post-solve", t, e);
  }, i;
})();
var $ = (function() {
  function i(t, e, r) {
    if (!(this instanceof i)) return new i(t, e, r);
    typeof t > "u" ? (this.x = 0, this.y = 0, this.z = 0) : typeof t == "object" ? (this.x = t.x, this.y = t.y, this.z = t.z) : (this.x = t, this.y = e, this.z = r);
  }
  return i.prototype._serialize = function() {
    return { x: this.x, y: this.y, z: this.z };
  }, i._deserialize = function(t) {
    var e = Object.create(i.prototype);
    return e.x = t.x, e.y = t.y, e.z = t.z, e;
  }, i.neo = function(t, e, r) {
    var s = Object.create(i.prototype);
    return s.x = t, s.y = e, s.z = r, s;
  }, i.zero = function() {
    var t = Object.create(i.prototype);
    return t.x = 0, t.y = 0, t.z = 0, t;
  }, i.clone = function(t) {
    return i.neo(t.x, t.y, t.z);
  }, i.prototype.toString = function() {
    return JSON.stringify(this);
  }, i.isValid = function(t) {
    return t === null || typeof t > "u" ? false : Number.isFinite(t.x) && Number.isFinite(t.y) && Number.isFinite(t.z);
  }, i.assert = function(t) {
  }, i.prototype.setZero = function() {
    return this.x = 0, this.y = 0, this.z = 0, this;
  }, i.prototype.set = function(t, e, r) {
    return this.x = t, this.y = e, this.z = r, this;
  }, i.prototype.add = function(t) {
    return this.x += t.x, this.y += t.y, this.z += t.z, this;
  }, i.prototype.sub = function(t) {
    return this.x -= t.x, this.y -= t.y, this.z -= t.z, this;
  }, i.prototype.mul = function(t) {
    return this.x *= t, this.y *= t, this.z *= t, this;
  }, i.areEqual = function(t, e) {
    return t === e || typeof t == "object" && t !== null && typeof e == "object" && e !== null && t.x === e.x && t.y === e.y && t.z === e.z;
  }, i.dot = function(t, e) {
    return t.x * e.x + t.y * e.y + t.z * e.z;
  }, i.cross = function(t, e) {
    return new i(t.y * e.z - t.z * e.y, t.z * e.x - t.x * e.z, t.x * e.y - t.y * e.x);
  }, i.add = function(t, e) {
    return new i(t.x + e.x, t.y + e.y, t.z + e.z);
  }, i.sub = function(t, e) {
    return new i(t.x - e.x, t.y - e.y, t.z - e.z);
  }, i.mul = function(t, e) {
    return new i(e * t.x, e * t.y, e * t.z);
  }, i.prototype.neg = function() {
    return this.x = -this.x, this.y = -this.y, this.z = -this.z, this;
  }, i.neg = function(t) {
    return new i(-t.x, -t.y, -t.z);
  }, i;
})();
var Ns = g(0, 0);
var ks = g(0, 0);
var ne = (function(i) {
  xt(t, i);
  function t(e, r) {
    var s = this;
    return s instanceof t ? (s = i.call(this) || this, s.m_type = t.TYPE, s.m_radius = z.polygonRadius, s.m_vertex1 = e ? a.clone(e) : a.zero(), s.m_vertex2 = r ? a.clone(r) : a.zero(), s.m_vertex0 = a.zero(), s.m_vertex3 = a.zero(), s.m_hasVertex0 = false, s.m_hasVertex3 = false, s) : new t(e, r);
  }
  return t.prototype._serialize = function() {
    return { type: this.m_type, vertex1: this.m_vertex1, vertex2: this.m_vertex2, vertex0: this.m_vertex0, vertex3: this.m_vertex3 };
  }, t._deserialize = function(e) {
    var r = new t(e.vertex1, e.vertex2);
    return r.m_hasVertex0 && r.setPrevVertex(e.vertex0), r.m_hasVertex3 && r.setNextVertex(e.vertex3), r;
  }, t.prototype._reset = function() {
  }, t.prototype.getRadius = function() {
    return this.m_radius;
  }, t.prototype.getType = function() {
    return this.m_type;
  }, t.prototype.setNext = function(e) {
    return this.setNextVertex(e);
  }, t.prototype.setNextVertex = function(e) {
    return e ? (this.m_vertex3.setVec2(e), this.m_hasVertex3 = true) : (this.m_vertex3.setZero(), this.m_hasVertex3 = false), this;
  }, t.prototype.getNextVertex = function() {
    return this.m_vertex3;
  }, t.prototype.setPrev = function(e) {
    return this.setPrevVertex(e);
  }, t.prototype.setPrevVertex = function(e) {
    return e ? (this.m_vertex0.setVec2(e), this.m_hasVertex0 = true) : (this.m_vertex0.setZero(), this.m_hasVertex0 = false), this;
  }, t.prototype.getPrevVertex = function() {
    return this.m_vertex0;
  }, t.prototype._set = function(e, r) {
    return this.m_vertex1.setVec2(e), this.m_vertex2.setVec2(r), this.m_hasVertex0 = false, this.m_hasVertex3 = false, this;
  }, t.prototype._clone = function() {
    var e = new t();
    return e.m_type = this.m_type, e.m_radius = this.m_radius, e.m_vertex1.setVec2(this.m_vertex1), e.m_vertex2.setVec2(this.m_vertex2), e.m_vertex0.setVec2(this.m_vertex0), e.m_vertex3.setVec2(this.m_vertex3), e.m_hasVertex0 = this.m_hasVertex0, e.m_hasVertex3 = this.m_hasVertex3, e;
  }, t.prototype.getChildCount = function() {
    return 1;
  }, t.prototype.testPoint = function(e, r) {
    return false;
  }, t.prototype.rayCast = function(e, r, s, o) {
    var n = B.mulTVec2(s.q, a.sub(r.p1, s.p)), m = B.mulTVec2(s.q, a.sub(r.p2, s.p)), h = a.sub(m, n), p = this.m_vertex1, l = this.m_vertex2, u = a.sub(l, p), c = a.neo(u.y, -u.x);
    c.normalize();
    var _ = a.dot(c, a.sub(p, n)), y = a.dot(c, h);
    if (y == 0) return false;
    var v = _ / y;
    if (v < 0 || r.maxFraction < v) return false;
    var f = a.add(n, a.mulNumVec2(v, h)), d = a.sub(l, p), A = a.dot(d, d);
    if (A == 0) return false;
    var b = a.dot(a.sub(f, p), d) / A;
    return b < 0 || 1 < b ? false : (e.fraction = v, _ > 0 ? e.normal = B.mulVec2(s.q, c).neg() : e.normal = B.mulVec2(s.q, c), true);
  }, t.prototype.computeAABB = function(e, r, s) {
    T(Ns, r, this.m_vertex1), T(ks, r, this.m_vertex2), _t.combinePoints(e, Ns, ks), _t.extend(e, this.m_radius);
  }, t.prototype.computeMass = function(e, r) {
    e.mass = 0, G2(e.center, 0.5, this.m_vertex1, 0.5, this.m_vertex2), e.I = 0;
  }, t.prototype.computeDistanceProxy = function(e) {
    e.m_vertices[0] = this.m_vertex1, e.m_vertices[1] = this.m_vertex2, e.m_vertices.length = 2, e.m_count = 2, e.m_radius = this.m_radius;
  }, t.TYPE = "edge", t;
})(Se);
var Ds = g(0, 0);
var Rs = g(0, 0);
var ui = (function(i) {
  xt(t, i);
  function t(e, r) {
    var s = this;
    return s instanceof t ? (s = i.call(this) || this, s.m_type = t.TYPE, s.m_radius = z.polygonRadius, s.m_vertices = [], s.m_count = 0, s.m_prevVertex = null, s.m_nextVertex = null, s.m_hasPrevVertex = false, s.m_hasNextVertex = false, s.m_isLoop = !!r, e && e.length && (r ? s._createLoop(e) : s._createChain(e)), s) : new t(e, r);
  }
  return t.prototype._serialize = function() {
    var e = { type: this.m_type, vertices: this.m_isLoop ? this.m_vertices.slice(0, this.m_vertices.length - 1) : this.m_vertices, isLoop: this.m_isLoop, hasPrevVertex: this.m_hasPrevVertex, hasNextVertex: this.m_hasNextVertex, prevVertex: null, nextVertex: null };
    return this.m_prevVertex && (e.prevVertex = this.m_prevVertex), this.m_nextVertex && (e.nextVertex = this.m_nextVertex), e;
  }, t._deserialize = function(e, r, s) {
    var o = [];
    if (e.vertices) for (var n = 0; n < e.vertices.length; n++) o.push(e.vertices[n]);
    var m = new t(o, e.isLoop);
    return e.prevVertex && m.setPrevVertex(e.prevVertex), e.nextVertex && m.setNextVertex(e.nextVertex), m;
  }, t.prototype.getType = function() {
    return this.m_type;
  }, t.prototype.getRadius = function() {
    return this.m_radius;
  }, t.prototype._createLoop = function(e) {
    if (!(e.length < 3)) {
      var r;
      this.m_vertices = [], this.m_count = e.length + 1;
      for (var r = 0; r < e.length; ++r) this.m_vertices[r] = a.clone(e[r]);
      return this.m_vertices[e.length] = a.clone(e[0]), this.m_prevVertex = this.m_vertices[this.m_count - 2], this.m_nextVertex = this.m_vertices[1], this.m_hasPrevVertex = true, this.m_hasNextVertex = true, this;
    }
  }, t.prototype._createChain = function(e) {
    var r;
    this.m_vertices = [], this.m_count = e.length;
    for (var r = 0; r < e.length; ++r) this.m_vertices[r] = a.clone(e[r]);
    return this.m_prevVertex = null, this.m_nextVertex = null, this.m_hasPrevVertex = false, this.m_hasNextVertex = false, this;
  }, t.prototype._reset = function() {
    this.m_isLoop ? this._createLoop(this.m_vertices.slice(0, this.m_vertices.length - 1)) : this._createChain(this.m_vertices);
  }, t.prototype.setPrevVertex = function(e) {
    this.m_prevVertex = e, this.m_hasPrevVertex = true;
  }, t.prototype.getPrevVertex = function() {
    return this.m_prevVertex;
  }, t.prototype.setNextVertex = function(e) {
    this.m_nextVertex = e, this.m_hasNextVertex = true;
  }, t.prototype.getNextVertex = function() {
    return this.m_nextVertex;
  }, t.prototype._clone = function() {
    var e = new t();
    return e._createChain(this.m_vertices), e.m_type = this.m_type, e.m_radius = this.m_radius, e.m_prevVertex = this.m_prevVertex, e.m_nextVertex = this.m_nextVertex, e.m_hasPrevVertex = this.m_hasPrevVertex, e.m_hasNextVertex = this.m_hasNextVertex, e;
  }, t.prototype.getChildCount = function() {
    return this.m_count - 1;
  }, t.prototype.getChildEdge = function(e, r) {
    e.m_type = ne.TYPE, e.m_radius = this.m_radius, e.m_vertex1 = this.m_vertices[r], e.m_vertex2 = this.m_vertices[r + 1], r > 0 ? (e.m_vertex0 = this.m_vertices[r - 1], e.m_hasVertex0 = true) : (e.m_vertex0 = this.m_prevVertex, e.m_hasVertex0 = this.m_hasPrevVertex), r < this.m_count - 2 ? (e.m_vertex3 = this.m_vertices[r + 2], e.m_hasVertex3 = true) : (e.m_vertex3 = this.m_nextVertex, e.m_hasVertex3 = this.m_hasNextVertex);
  }, t.prototype.getVertex = function(e) {
    return e < this.m_count ? this.m_vertices[e] : this.m_vertices[0];
  }, t.prototype.isLoop = function() {
    return this.m_isLoop;
  }, t.prototype.testPoint = function(e, r) {
    return false;
  }, t.prototype.rayCast = function(e, r, s, o) {
    var n = new ne(this.getVertex(o), this.getVertex(o + 1));
    return n.rayCast(e, r, s, 0);
  }, t.prototype.computeAABB = function(e, r, s) {
    T(Ds, r, this.getVertex(s)), T(Rs, r, this.getVertex(s + 1)), _t.combinePoints(e, Ds, Rs);
  }, t.prototype.computeMass = function(e, r) {
    e.mass = 0, S(e.center), e.I = 0;
  }, t.prototype.computeDistanceProxy = function(e, r) {
    e.m_vertices[0] = this.getVertex(r), e.m_vertices[1] = this.getVertex(r + 1), e.m_count = 2, e.m_radius = this.m_radius;
  }, t.TYPE = "chain", t;
})(Se);
var Es = Math.max;
var Mr = Math.min;
var We = g(0, 0);
var Os = g(0, 0);
var gi = g(0, 0);
var si = g(0, 0);
var Ee = g(0, 0);
var be = g(0, 0);
var ae = (function(i) {
  xt(t, i);
  function t(e) {
    var r = this;
    return r instanceof t ? (r = i.call(this) || this, r.m_type = t.TYPE, r.m_radius = z.polygonRadius, r.m_centroid = a.zero(), r.m_vertices = [], r.m_normals = [], r.m_count = 0, e && e.length && r._set(e), r) : new t(e);
  }
  return t.prototype._serialize = function() {
    return { type: this.m_type, vertices: this.m_vertices };
  }, t._deserialize = function(e, r, s) {
    var o = [];
    if (e.vertices) for (var n = 0; n < e.vertices.length; n++) o.push(e.vertices[n]);
    var m = new t(o);
    return m;
  }, t.prototype.getType = function() {
    return this.m_type;
  }, t.prototype.getRadius = function() {
    return this.m_radius;
  }, t.prototype._clone = function() {
    var e = new t();
    e.m_type = this.m_type, e.m_radius = this.m_radius, e.m_count = this.m_count, e.m_centroid.setVec2(this.m_centroid);
    for (var r = 0; r < this.m_count; r++) e.m_vertices.push(this.m_vertices[r].clone());
    for (var r = 0; r < this.m_normals.length; r++) e.m_normals.push(this.m_normals[r].clone());
    return e;
  }, t.prototype.getChildCount = function() {
    return 1;
  }, t.prototype._reset = function() {
    this._set(this.m_vertices);
  }, t.prototype._set = function(e) {
    if (e.length < 3) {
      this._setAsBox(1, 1);
      return;
    }
    for (var r = Mr(e.length, z.maxPolygonVertices), s = [], o = 0; o < r; ++o) {
      for (var n = e[o], m = true, h = 0; h < s.length; ++h) if (a.distanceSquared(n, s[h]) < 0.25 * z.linearSlopSquared) {
        m = false;
        break;
      }
      m && s.push(a.clone(n));
    }
    if (r = s.length, r < 3) {
      this._setAsBox(1, 1);
      return;
    }
    for (var p = 0, l = s[0].x, o = 1; o < r; ++o) {
      var u = s[o].x;
      (u > l || u === l && s[o].y < s[p].y) && (p = o, l = u);
    }
    for (var c = [], _ = 0, y = p; ; ) {
      c[_] = y;
      for (var v = 0, h = 1; h < r; ++h) {
        if (v === y) {
          v = h;
          continue;
        }
        var f = a.sub(s[v], s[c[_]]), n = a.sub(s[h], s[c[_]]), d = a.crossVec2Vec2(f, n);
        d < 0 && (v = h), d === 0 && n.lengthSquared() > f.lengthSquared() && (v = h);
      }
      if (++_, y = v, v === p) break;
    }
    if (_ < 3) {
      this._setAsBox(1, 1);
      return;
    }
    this.m_count = _, this.m_vertices = [];
    for (var o = 0; o < _; ++o) this.m_vertices[o] = s[c[o]];
    for (var o = 0; o < _; ++o) {
      var A = o, b = o + 1 < _ ? o + 1 : 0, w = a.sub(this.m_vertices[b], this.m_vertices[A]);
      this.m_normals[o] = a.crossVec2Num(w, 1), this.m_normals[o].normalize();
    }
    this.m_centroid = rn(this.m_vertices, _);
  }, t.prototype._setAsBox = function(e, r, s, o) {
    if (this.m_vertices[0] = a.neo(e, -r), this.m_vertices[1] = a.neo(e, r), this.m_vertices[2] = a.neo(-e, r), this.m_vertices[3] = a.neo(-e, -r), this.m_normals[0] = a.neo(1, 0), this.m_normals[1] = a.neo(0, 1), this.m_normals[2] = a.neo(-1, 0), this.m_normals[3] = a.neo(0, -1), this.m_count = 4, s && a.isValid(s)) {
      o = o || 0, x(this.m_centroid, s);
      var n = ft.identity();
      n.p.setVec2(s), n.q.setAngle(o);
      for (var m = 0; m < this.m_count; ++m) this.m_vertices[m] = ft.mulVec2(n, this.m_vertices[m]), this.m_normals[m] = B.mulVec2(n.q, this.m_normals[m]);
    }
  }, t.prototype.testPoint = function(e, r) {
    for (var s = ts(We, e, r), o = 0; o < this.m_count; ++o) {
      var n = C(this.m_normals[o], s) - C(this.m_normals[o], this.m_vertices[o]);
      if (n > 0) return false;
    }
    return true;
  }, t.prototype.rayCast = function(e, r, s, o) {
    for (var n = B.mulTVec2(s.q, a.sub(r.p1, s.p)), m = B.mulTVec2(s.q, a.sub(r.p2, s.p)), h = a.sub(m, n), p = 0, l = r.maxFraction, u = -1, c = 0; c < this.m_count; ++c) {
      var _ = a.dot(this.m_normals[c], a.sub(this.m_vertices[c], n)), y = a.dot(this.m_normals[c], h);
      if (y == 0) {
        if (_ < 0) return false;
      } else y < 0 && _ < p * y ? (p = _ / y, u = c) : y > 0 && _ < l * y && (l = _ / y);
      if (l < p) return false;
    }
    return u >= 0 ? (e.fraction = p, e.normal = B.mulVec2(s.q, this.m_normals[u]), true) : false;
  }, t.prototype.computeAABB = function(e, r, s) {
    for (var o = 1 / 0, n = 1 / 0, m = -1 / 0, h = -1 / 0, p = 0; p < this.m_count; ++p) {
      var l = T(We, r, this.m_vertices[p]);
      o = Mr(o, l.x), m = Es(m, l.x), n = Mr(n, l.y), h = Es(h, l.y);
    }
    ut(e.lowerBound, o - this.m_radius, n - this.m_radius), ut(e.upperBound, m + this.m_radius, h + this.m_radius);
  }, t.prototype.computeMass = function(e, r) {
    S(Ee);
    var s = 0, o = 0;
    S(be);
    for (var n = 0; n < this.m_count; ++n) Jt(be, this.m_vertices[n]);
    L(be, 1 / this.m_count, be);
    for (var m = 1 / 3, n = 0; n < this.m_count; ++n) {
      N(gi, this.m_vertices[n], be), n + 1 < this.m_count ? N(si, this.m_vertices[n + 1], be) : N(si, this.m_vertices[0], be);
      var h = E(gi, si), p = 0.5 * h;
      s += p, G2(We, p * m, gi, p * m, si), Jt(Ee, We);
      var l = gi.x, u = gi.y, c = si.x, _ = si.y, y = l * l + c * l + c * c, v = u * u + _ * u + _ * _;
      o += 0.25 * m * h * (y + v);
    }
    e.mass = r * s, L(Ee, 1 / s, Ee), Lo(e.center, Ee, be), e.I = r * o, e.I += e.mass * (C(e.center, e.center) - C(Ee, Ee));
  }, t.prototype.validate = function() {
    for (var e = 0; e < this.m_count; ++e) {
      var r = e, s = e < this.m_count - 1 ? r + 1 : 0, o = this.m_vertices[r];
      N(Os, this.m_vertices[s], o);
      for (var n = 0; n < this.m_count; ++n) if (!(n == r || n == s)) {
        var m = E(Os, N(We, this.m_vertices[n], o));
        if (m < 0) return false;
      }
    }
    return true;
  }, t.prototype.computeDistanceProxy = function(e) {
    for (var r = 0; r < this.m_count; ++r) e.m_vertices[r] = this.m_vertices[r];
    e.m_vertices.length = this.m_count, e.m_count = this.m_count, e.m_radius = this.m_radius;
  }, t.TYPE = "polygon", t;
})(Se);
function rn(i, t) {
  for (var e = a.zero(), r = 0, s = a.zero(), o, n = 1 / 3, o = 0; o < t; ++o) {
    var m = s, h = i[o], p = o + 1 < t ? i[o + 1] : i[0], l = a.sub(h, m), u = a.sub(p, m), c = a.crossVec2Vec2(l, u), _ = 0.5 * c;
    r += _, se(We, 1, m, 1, h, 1, p), Xt(e, _ * n, We);
  }
  return e.mul(1 / r), e;
}
var sn = Math.sqrt;
var on = Math.PI;
var Js = g(0, 0);
var de = (function(i) {
  xt(t, i);
  function t(e, r) {
    var s = this;
    return s instanceof t ? (s = i.call(this) || this, s.m_type = t.TYPE, s.m_p = a.zero(), s.m_radius = 1, typeof e == "object" && a.isValid(e) ? (s.m_p.setVec2(e), typeof r == "number" && (s.m_radius = r)) : typeof e == "number" && (s.m_radius = e), s) : new t(e, r);
  }
  return t.prototype._serialize = function() {
    return { type: this.m_type, p: this.m_p, radius: this.m_radius };
  }, t._deserialize = function(e) {
    return new t(e.p, e.radius);
  }, t.prototype._reset = function() {
  }, t.prototype.getType = function() {
    return this.m_type;
  }, t.prototype.getRadius = function() {
    return this.m_radius;
  }, t.prototype.getCenter = function() {
    return this.m_p;
  }, t.prototype._clone = function() {
    var e = new t();
    return e.m_type = this.m_type, e.m_radius = this.m_radius, e.m_p = this.m_p.clone(), e;
  }, t.prototype.getChildCount = function() {
    return 1;
  }, t.prototype.testPoint = function(e, r) {
    var s = T(Js, e, this.m_p);
    return He(r, s) <= this.m_radius * this.m_radius;
  }, t.prototype.rayCast = function(e, r, s, o) {
    var n = a.add(s.p, B.mulVec2(s.q, this.m_p)), m = a.sub(r.p1, n), h = a.dot(m, m) - this.m_radius * this.m_radius, p = a.sub(r.p2, r.p1), l = a.dot(m, p), u = a.dot(p, p), c = l * l - u * h;
    if (c < 0 || u < gt) return false;
    var _ = -(l + sn(c));
    return 0 <= _ && _ <= r.maxFraction * u ? (_ /= u, e.fraction = _, e.normal = a.add(m, a.mulNumVec2(_, p)), e.normal.normalize(), true) : false;
  }, t.prototype.computeAABB = function(e, r, s) {
    var o = T(Js, r, this.m_p);
    ut(e.lowerBound, o.x - this.m_radius, o.y - this.m_radius), ut(e.upperBound, o.x + this.m_radius, o.y + this.m_radius);
  }, t.prototype.computeMass = function(e, r) {
    e.mass = r * on * this.m_radius * this.m_radius, x(e.center, this.m_p), e.I = e.mass * (0.5 * this.m_radius * this.m_radius + Ue(this.m_p));
  }, t.prototype.computeDistanceProxy = function(e) {
    e.m_vertices[0] = this.m_p, e.m_vertices.length = 1, e.m_count = 1, e.m_radius = this.m_radius;
  }, t.TYPE = "circle", t;
})(Se);
var nn = Math.abs;
var an = Math.PI;
var mn = { frequencyHz: 0, dampingRatio: 0 };
var Jr = (function(i) {
  xt(t, i);
  function t(e, r, s, o, n) {
    var m = this;
    if (!(m instanceof t)) return new t(e, r, s, o, n);
    if (s && o && "m_type" in o && "x" in s && "y" in s) {
      var h = s;
      s = o, o = h;
    }
    return e = qt(e, mn), m = i.call(this, e, r, s) || this, r = m.m_bodyA, s = m.m_bodyB, m.m_type = t.TYPE, m.m_localAnchorA = a.clone(o ? r.getLocalPoint(o) : e.localAnchorA || a.zero()), m.m_localAnchorB = a.clone(n ? s.getLocalPoint(n) : e.localAnchorB || a.zero()), m.m_length = Number.isFinite(e.length) ? e.length : a.distance(r.getWorldPoint(m.m_localAnchorA), s.getWorldPoint(m.m_localAnchorB)), m.m_frequencyHz = e.frequencyHz, m.m_dampingRatio = e.dampingRatio, m.m_impulse = 0, m.m_gamma = 0, m.m_bias = 0, m;
  }
  return t.prototype._serialize = function() {
    return { type: this.m_type, bodyA: this.m_bodyA, bodyB: this.m_bodyB, collideConnected: this.m_collideConnected, frequencyHz: this.m_frequencyHz, dampingRatio: this.m_dampingRatio, localAnchorA: this.m_localAnchorA, localAnchorB: this.m_localAnchorB, length: this.m_length };
  }, t._deserialize = function(e, r, s) {
    e = dt({}, e), e.bodyA = s(W, e.bodyA, r), e.bodyB = s(W, e.bodyB, r);
    var o = new t(e);
    return o;
  }, t.prototype._reset = function(e) {
    e.anchorA ? this.m_localAnchorA.setVec2(this.m_bodyA.getLocalPoint(e.anchorA)) : e.localAnchorA && this.m_localAnchorA.setVec2(e.localAnchorA), e.anchorB ? this.m_localAnchorB.setVec2(this.m_bodyB.getLocalPoint(e.anchorB)) : e.localAnchorB && this.m_localAnchorB.setVec2(e.localAnchorB), e.length > 0 ? this.m_length = +e.length : e.length < 0 || (e.anchorA || e.anchorA || e.anchorA || e.anchorA) && (this.m_length = a.distance(this.m_bodyA.getWorldPoint(this.m_localAnchorA), this.m_bodyB.getWorldPoint(this.m_localAnchorB))), Number.isFinite(e.frequencyHz) && (this.m_frequencyHz = e.frequencyHz), Number.isFinite(e.dampingRatio) && (this.m_dampingRatio = e.dampingRatio);
  }, t.prototype.getLocalAnchorA = function() {
    return this.m_localAnchorA;
  }, t.prototype.getLocalAnchorB = function() {
    return this.m_localAnchorB;
  }, t.prototype.setLength = function(e) {
    this.m_length = e;
  }, t.prototype.getLength = function() {
    return this.m_length;
  }, t.prototype.setFrequency = function(e) {
    this.m_frequencyHz = e;
  }, t.prototype.getFrequency = function() {
    return this.m_frequencyHz;
  }, t.prototype.setDampingRatio = function(e) {
    this.m_dampingRatio = e;
  }, t.prototype.getDampingRatio = function() {
    return this.m_dampingRatio;
  }, t.prototype.getAnchorA = function() {
    return this.m_bodyA.getWorldPoint(this.m_localAnchorA);
  }, t.prototype.getAnchorB = function() {
    return this.m_bodyB.getWorldPoint(this.m_localAnchorB);
  }, t.prototype.getReactionForce = function(e) {
    return a.mulNumVec2(this.m_impulse, this.m_u).mul(e);
  }, t.prototype.getReactionTorque = function(e) {
    return 0;
  }, t.prototype.initVelocityConstraints = function(e) {
    this.m_localCenterA = this.m_bodyA.m_sweep.localCenter, this.m_localCenterB = this.m_bodyB.m_sweep.localCenter, this.m_invMassA = this.m_bodyA.m_invMass, this.m_invMassB = this.m_bodyB.m_invMass, this.m_invIA = this.m_bodyA.m_invI, this.m_invIB = this.m_bodyB.m_invI;
    var r = this.m_bodyA.c_position.c, s = this.m_bodyA.c_position.a, o = this.m_bodyA.c_velocity.v, n = this.m_bodyA.c_velocity.w, m = this.m_bodyB.c_position.c, h = this.m_bodyB.c_position.a, p = this.m_bodyB.c_velocity.v, l = this.m_bodyB.c_velocity.w, u = B.neo(s), c = B.neo(h);
    this.m_rA = B.mulVec2(u, a.sub(this.m_localAnchorA, this.m_localCenterA)), this.m_rB = B.mulVec2(c, a.sub(this.m_localAnchorB, this.m_localCenterB)), this.m_u = a.sub(a.add(m, this.m_rB), a.add(r, this.m_rA));
    var _ = this.m_u.length();
    _ > z.linearSlop ? this.m_u.mul(1 / _) : this.m_u.setNum(0, 0);
    var y = a.crossVec2Vec2(this.m_rA, this.m_u), v = a.crossVec2Vec2(this.m_rB, this.m_u), f = this.m_invMassA + this.m_invIA * y * y + this.m_invMassB + this.m_invIB * v * v;
    if (this.m_mass = f != 0 ? 1 / f : 0, this.m_frequencyHz > 0) {
      var d = _ - this.m_length, A = 2 * an * this.m_frequencyHz, b = 2 * this.m_mass * this.m_dampingRatio * A, w = this.m_mass * A * A, V = e.dt;
      this.m_gamma = V * (b + V * w), this.m_gamma = this.m_gamma != 0 ? 1 / this.m_gamma : 0, this.m_bias = d * V * w * this.m_gamma, f += this.m_gamma, this.m_mass = f != 0 ? 1 / f : 0;
    } else this.m_gamma = 0, this.m_bias = 0;
    if (e.warmStarting) {
      this.m_impulse *= e.dtRatio;
      var I = a.mulNumVec2(this.m_impulse, this.m_u);
      o.subMul(this.m_invMassA, I), n -= this.m_invIA * a.crossVec2Vec2(this.m_rA, I), p.addMul(this.m_invMassB, I), l += this.m_invIB * a.crossVec2Vec2(this.m_rB, I);
    } else this.m_impulse = 0;
    this.m_bodyA.c_velocity.v.setVec2(o), this.m_bodyA.c_velocity.w = n, this.m_bodyB.c_velocity.v.setVec2(p), this.m_bodyB.c_velocity.w = l;
  }, t.prototype.solveVelocityConstraints = function(e) {
    var r = this.m_bodyA.c_velocity.v, s = this.m_bodyA.c_velocity.w, o = this.m_bodyB.c_velocity.v, n = this.m_bodyB.c_velocity.w, m = a.add(r, a.crossNumVec2(s, this.m_rA)), h = a.add(o, a.crossNumVec2(n, this.m_rB)), p = a.dot(this.m_u, h) - a.dot(this.m_u, m), l = -this.m_mass * (p + this.m_bias + this.m_gamma * this.m_impulse);
    this.m_impulse += l;
    var u = a.mulNumVec2(l, this.m_u);
    r.subMul(this.m_invMassA, u), s -= this.m_invIA * a.crossVec2Vec2(this.m_rA, u), o.addMul(this.m_invMassB, u), n += this.m_invIB * a.crossVec2Vec2(this.m_rB, u), this.m_bodyA.c_velocity.v.setVec2(r), this.m_bodyA.c_velocity.w = s, this.m_bodyB.c_velocity.v.setVec2(o), this.m_bodyB.c_velocity.w = n;
  }, t.prototype.solvePositionConstraints = function(e) {
    if (this.m_frequencyHz > 0) return true;
    var r = this.m_bodyA.c_position.c, s = this.m_bodyA.c_position.a, o = this.m_bodyB.c_position.c, n = this.m_bodyB.c_position.a, m = B.neo(s), h = B.neo(n), p = B.mulSub(m, this.m_localAnchorA, this.m_localCenterA), l = B.mulSub(h, this.m_localAnchorB, this.m_localCenterB), u = a.sub(a.add(o, l), a.add(r, p)), c = u.normalize(), _ = pt(c - this.m_length, -z.maxLinearCorrection, z.maxLinearCorrection), y = -this.m_mass * _, v = a.mulNumVec2(y, u);
    return r.subMul(this.m_invMassA, v), s -= this.m_invIA * a.crossVec2Vec2(p, v), o.addMul(this.m_invMassB, v), n += this.m_invIB * a.crossVec2Vec2(l, v), this.m_bodyA.c_position.c.setVec2(r), this.m_bodyA.c_position.a = s, this.m_bodyB.c_position.c.setVec2(o), this.m_bodyB.c_position.a = n, nn(_) < z.linearSlop;
  }, t.TYPE = "distance-joint", t;
})(yt);
var hn = { maxForce: 0, maxTorque: 0 };
var $r = (function(i) {
  xt(t, i);
  function t(e, r, s, o) {
    var n = this;
    return n instanceof t ? (e = qt(e, hn), n = i.call(this, e, r, s) || this, r = n.m_bodyA, s = n.m_bodyB, n.m_type = t.TYPE, n.m_localAnchorA = a.clone(o ? r.getLocalPoint(o) : e.localAnchorA || a.zero()), n.m_localAnchorB = a.clone(o ? s.getLocalPoint(o) : e.localAnchorB || a.zero()), n.m_linearImpulse = a.zero(), n.m_angularImpulse = 0, n.m_maxForce = e.maxForce, n.m_maxTorque = e.maxTorque, n) : new t(e, r, s, o);
  }
  return t.prototype._serialize = function() {
    return { type: this.m_type, bodyA: this.m_bodyA, bodyB: this.m_bodyB, collideConnected: this.m_collideConnected, maxForce: this.m_maxForce, maxTorque: this.m_maxTorque, localAnchorA: this.m_localAnchorA, localAnchorB: this.m_localAnchorB };
  }, t._deserialize = function(e, r, s) {
    e = dt({}, e), e.bodyA = s(W, e.bodyA, r), e.bodyB = s(W, e.bodyB, r);
    var o = new t(e);
    return o;
  }, t.prototype._reset = function(e) {
    e.anchorA ? this.m_localAnchorA.setVec2(this.m_bodyA.getLocalPoint(e.anchorA)) : e.localAnchorA && this.m_localAnchorA.setVec2(e.localAnchorA), e.anchorB ? this.m_localAnchorB.setVec2(this.m_bodyB.getLocalPoint(e.anchorB)) : e.localAnchorB && this.m_localAnchorB.setVec2(e.localAnchorB), Number.isFinite(e.maxForce) && (this.m_maxForce = e.maxForce), Number.isFinite(e.maxTorque) && (this.m_maxTorque = e.maxTorque);
  }, t.prototype.getLocalAnchorA = function() {
    return this.m_localAnchorA;
  }, t.prototype.getLocalAnchorB = function() {
    return this.m_localAnchorB;
  }, t.prototype.setMaxForce = function(e) {
    this.m_maxForce = e;
  }, t.prototype.getMaxForce = function() {
    return this.m_maxForce;
  }, t.prototype.setMaxTorque = function(e) {
    this.m_maxTorque = e;
  }, t.prototype.getMaxTorque = function() {
    return this.m_maxTorque;
  }, t.prototype.getAnchorA = function() {
    return this.m_bodyA.getWorldPoint(this.m_localAnchorA);
  }, t.prototype.getAnchorB = function() {
    return this.m_bodyB.getWorldPoint(this.m_localAnchorB);
  }, t.prototype.getReactionForce = function(e) {
    return a.mulNumVec2(e, this.m_linearImpulse);
  }, t.prototype.getReactionTorque = function(e) {
    return e * this.m_angularImpulse;
  }, t.prototype.initVelocityConstraints = function(e) {
    this.m_localCenterA = this.m_bodyA.m_sweep.localCenter, this.m_localCenterB = this.m_bodyB.m_sweep.localCenter, this.m_invMassA = this.m_bodyA.m_invMass, this.m_invMassB = this.m_bodyB.m_invMass, this.m_invIA = this.m_bodyA.m_invI, this.m_invIB = this.m_bodyB.m_invI;
    var r = this.m_bodyA.c_position.a, s = this.m_bodyA.c_velocity.v, o = this.m_bodyA.c_velocity.w, n = this.m_bodyB.c_position.a, m = this.m_bodyB.c_velocity.v, h = this.m_bodyB.c_velocity.w, p = B.neo(r), l = B.neo(n);
    this.m_rA = B.mulVec2(p, a.sub(this.m_localAnchorA, this.m_localCenterA)), this.m_rB = B.mulVec2(l, a.sub(this.m_localAnchorB, this.m_localCenterB));
    var u = this.m_invMassA, c = this.m_invMassB, _ = this.m_invIA, y = this.m_invIB, v = new Yt();
    if (v.ex.x = u + c + _ * this.m_rA.y * this.m_rA.y + y * this.m_rB.y * this.m_rB.y, v.ex.y = -_ * this.m_rA.x * this.m_rA.y - y * this.m_rB.x * this.m_rB.y, v.ey.x = v.ex.y, v.ey.y = u + c + _ * this.m_rA.x * this.m_rA.x + y * this.m_rB.x * this.m_rB.x, this.m_linearMass = v.getInverse(), this.m_angularMass = _ + y, this.m_angularMass > 0 && (this.m_angularMass = 1 / this.m_angularMass), e.warmStarting) {
      this.m_linearImpulse.mul(e.dtRatio), this.m_angularImpulse *= e.dtRatio;
      var f = a.neo(this.m_linearImpulse.x, this.m_linearImpulse.y);
      s.subMul(u, f), o -= _ * (a.crossVec2Vec2(this.m_rA, f) + this.m_angularImpulse), m.addMul(c, f), h += y * (a.crossVec2Vec2(this.m_rB, f) + this.m_angularImpulse);
    } else this.m_linearImpulse.setZero(), this.m_angularImpulse = 0;
    this.m_bodyA.c_velocity.v = s, this.m_bodyA.c_velocity.w = o, this.m_bodyB.c_velocity.v = m, this.m_bodyB.c_velocity.w = h;
  }, t.prototype.solveVelocityConstraints = function(e) {
    var r = this.m_bodyA.c_velocity.v, s = this.m_bodyA.c_velocity.w, o = this.m_bodyB.c_velocity.v, n = this.m_bodyB.c_velocity.w, m = this.m_invMassA, h = this.m_invMassB, p = this.m_invIA, l = this.m_invIB, u = e.dt;
    {
      var c = n - s, _ = -this.m_angularMass * c, y = this.m_angularImpulse, v = u * this.m_maxTorque;
      this.m_angularImpulse = pt(this.m_angularImpulse + _, -v, v), _ = this.m_angularImpulse - y, s -= p * _, n += l * _;
    }
    {
      var c = a.sub(a.add(o, a.crossNumVec2(n, this.m_rB)), a.add(r, a.crossNumVec2(s, this.m_rA))), _ = a.neg(Yt.mulVec2(this.m_linearMass, c)), y = this.m_linearImpulse;
      this.m_linearImpulse.add(_);
      var v = u * this.m_maxForce;
      this.m_linearImpulse.lengthSquared() > v * v && (this.m_linearImpulse.normalize(), this.m_linearImpulse.mul(v)), _ = a.sub(this.m_linearImpulse, y), r.subMul(m, _), s -= p * a.crossVec2Vec2(this.m_rA, _), o.addMul(h, _), n += l * a.crossVec2Vec2(this.m_rB, _);
    }
    this.m_bodyA.c_velocity.v = r, this.m_bodyA.c_velocity.w = s, this.m_bodyB.c_velocity.v = o, this.m_bodyB.c_velocity.w = n;
  }, t.prototype.solvePositionConstraints = function(e) {
    return true;
  }, t.TYPE = "friction-joint", t;
})(yt);
var fe = (function() {
  function i(t, e, r) {
    typeof t == "object" && t !== null ? (this.ex = $.clone(t), this.ey = $.clone(e), this.ez = $.clone(r)) : (this.ex = $.zero(), this.ey = $.zero(), this.ez = $.zero());
  }
  return i.prototype.toString = function() {
    return JSON.stringify(this);
  }, i.isValid = function(t) {
    return t === null || typeof t > "u" ? false : $.isValid(t.ex) && $.isValid(t.ey) && $.isValid(t.ez);
  }, i.assert = function(t) {
  }, i.prototype.setZero = function() {
    return this.ex.setZero(), this.ey.setZero(), this.ez.setZero(), this;
  }, i.prototype.solve33 = function(t) {
    var e = this.ey.y * this.ez.z - this.ey.z * this.ez.y, r = this.ey.z * this.ez.x - this.ey.x * this.ez.z, s = this.ey.x * this.ez.y - this.ey.y * this.ez.x, o = this.ex.x * e + this.ex.y * r + this.ex.z * s;
    o !== 0 && (o = 1 / o);
    var n = new $();
    return e = this.ey.y * this.ez.z - this.ey.z * this.ez.y, r = this.ey.z * this.ez.x - this.ey.x * this.ez.z, s = this.ey.x * this.ez.y - this.ey.y * this.ez.x, n.x = o * (t.x * e + t.y * r + t.z * s), e = t.y * this.ez.z - t.z * this.ez.y, r = t.z * this.ez.x - t.x * this.ez.z, s = t.x * this.ez.y - t.y * this.ez.x, n.y = o * (this.ex.x * e + this.ex.y * r + this.ex.z * s), e = this.ey.y * t.z - this.ey.z * t.y, r = this.ey.z * t.x - this.ey.x * t.z, s = this.ey.x * t.y - this.ey.y * t.x, n.z = o * (this.ex.x * e + this.ex.y * r + this.ex.z * s), n;
  }, i.prototype.solve22 = function(t) {
    var e = this.ex.x, r = this.ey.x, s = this.ex.y, o = this.ey.y, n = e * o - r * s;
    n !== 0 && (n = 1 / n);
    var m = a.zero();
    return m.x = n * (o * t.x - r * t.y), m.y = n * (e * t.y - s * t.x), m;
  }, i.prototype.getInverse22 = function(t) {
    var e = this.ex.x, r = this.ey.x, s = this.ex.y, o = this.ey.y, n = e * o - r * s;
    n !== 0 && (n = 1 / n), t.ex.x = n * o, t.ey.x = -n * r, t.ex.z = 0, t.ex.y = -n * s, t.ey.y = n * e, t.ey.z = 0, t.ez.x = 0, t.ez.y = 0, t.ez.z = 0;
  }, i.prototype.getSymInverse33 = function(t) {
    var e = $.dot(this.ex, $.cross(this.ey, this.ez));
    e !== 0 && (e = 1 / e);
    var r = this.ex.x, s = this.ey.x, o = this.ez.x, n = this.ey.y, m = this.ez.y, h = this.ez.z;
    t.ex.x = e * (n * h - m * m), t.ex.y = e * (o * m - s * h), t.ex.z = e * (s * m - o * n), t.ey.x = t.ex.y, t.ey.y = e * (r * h - o * o), t.ey.z = e * (o * s - r * m), t.ez.x = t.ex.z, t.ez.y = t.ey.z, t.ez.z = e * (r * n - s * s);
  }, i.mul = function(t, e) {
    if (e && "z" in e && "y" in e && "x" in e) {
      var r = t.ex.x * e.x + t.ey.x * e.y + t.ez.x * e.z, s = t.ex.y * e.x + t.ey.y * e.y + t.ez.y * e.z, o = t.ex.z * e.x + t.ey.z * e.y + t.ez.z * e.z;
      return new $(r, s, o);
    } else if (e && "y" in e && "x" in e) {
      var r = t.ex.x * e.x + t.ey.x * e.y, s = t.ex.y * e.x + t.ey.y * e.y;
      return a.neo(r, s);
    }
  }, i.mulVec3 = function(t, e) {
    var r = t.ex.x * e.x + t.ey.x * e.y + t.ez.x * e.z, s = t.ex.y * e.x + t.ey.y * e.y + t.ez.y * e.z, o = t.ex.z * e.x + t.ey.z * e.y + t.ez.z * e.z;
    return new $(r, s, o);
  }, i.mulVec2 = function(t, e) {
    var r = t.ex.x * e.x + t.ey.x * e.y, s = t.ex.y * e.x + t.ey.y * e.y;
    return a.neo(r, s);
  }, i.add = function(t, e) {
    return new i($.add(t.ex, e.ex), $.add(t.ey, e.ey), $.add(t.ez, e.ez));
  }, i;
})();
var $s = Math.abs;
var lt;
(function(i) {
  i[i.inactiveLimit = 0] = "inactiveLimit", i[i.atLowerLimit = 1] = "atLowerLimit", i[i.atUpperLimit = 2] = "atUpperLimit", i[i.equalLimits = 3] = "equalLimits";
})(lt || (lt = {}));
var oi = { lowerAngle: 0, upperAngle: 0, maxMotorTorque: 0, motorSpeed: 0, enableLimit: false, enableMotor: false };
var ye = (function(i) {
  xt(t, i);
  function t(e, r, s, o) {
    var n = this, m, h, p, l, u, c;
    return n instanceof t ? (e = e ?? {}, n = i.call(this, e, r, s) || this, r = n.m_bodyA, s = n.m_bodyB, n.m_mass = new fe(), n.m_limitState = lt.inactiveLimit, n.m_type = t.TYPE, a.isValid(o) ? n.m_localAnchorA = r.getLocalPoint(o) : a.isValid(e.localAnchorA) ? n.m_localAnchorA = a.clone(e.localAnchorA) : n.m_localAnchorA = a.zero(), a.isValid(o) ? n.m_localAnchorB = s.getLocalPoint(o) : a.isValid(e.localAnchorB) ? n.m_localAnchorB = a.clone(e.localAnchorB) : n.m_localAnchorB = a.zero(), Number.isFinite(e.referenceAngle) ? n.m_referenceAngle = e.referenceAngle : n.m_referenceAngle = s.getAngle() - r.getAngle(), n.m_impulse = new $(), n.m_motorImpulse = 0, n.m_lowerAngle = (m = e.lowerAngle) !== null && m !== void 0 ? m : oi.lowerAngle, n.m_upperAngle = (h = e.upperAngle) !== null && h !== void 0 ? h : oi.upperAngle, n.m_maxMotorTorque = (p = e.maxMotorTorque) !== null && p !== void 0 ? p : oi.maxMotorTorque, n.m_motorSpeed = (l = e.motorSpeed) !== null && l !== void 0 ? l : oi.motorSpeed, n.m_enableLimit = (u = e.enableLimit) !== null && u !== void 0 ? u : oi.enableLimit, n.m_enableMotor = (c = e.enableMotor) !== null && c !== void 0 ? c : oi.enableMotor, n) : new t(e, r, s, o);
  }
  return t.prototype._serialize = function() {
    return { type: this.m_type, bodyA: this.m_bodyA, bodyB: this.m_bodyB, collideConnected: this.m_collideConnected, lowerAngle: this.m_lowerAngle, upperAngle: this.m_upperAngle, maxMotorTorque: this.m_maxMotorTorque, motorSpeed: this.m_motorSpeed, enableLimit: this.m_enableLimit, enableMotor: this.m_enableMotor, localAnchorA: this.m_localAnchorA, localAnchorB: this.m_localAnchorB, referenceAngle: this.m_referenceAngle };
  }, t._deserialize = function(e, r, s) {
    e = dt({}, e), e.bodyA = s(W, e.bodyA, r), e.bodyB = s(W, e.bodyB, r);
    var o = new t(e);
    return o;
  }, t.prototype._reset = function(e) {
    e.anchorA ? this.m_localAnchorA.setVec2(this.m_bodyA.getLocalPoint(e.anchorA)) : e.localAnchorA && this.m_localAnchorA.setVec2(e.localAnchorA), e.anchorB ? this.m_localAnchorB.setVec2(this.m_bodyB.getLocalPoint(e.anchorB)) : e.localAnchorB && this.m_localAnchorB.setVec2(e.localAnchorB), Number.isFinite(e.referenceAngle) && (this.m_referenceAngle = e.referenceAngle), e.enableLimit !== void 0 && (this.m_enableLimit = e.enableLimit), Number.isFinite(e.lowerAngle) && (this.m_lowerAngle = e.lowerAngle), Number.isFinite(e.upperAngle) && (this.m_upperAngle = e.upperAngle), Number.isFinite(e.maxMotorTorque) && (this.m_maxMotorTorque = e.maxMotorTorque), Number.isFinite(e.motorSpeed) && (this.m_motorSpeed = e.motorSpeed), e.enableMotor !== void 0 && (this.m_enableMotor = e.enableMotor);
  }, t.prototype.getLocalAnchorA = function() {
    return this.m_localAnchorA;
  }, t.prototype.getLocalAnchorB = function() {
    return this.m_localAnchorB;
  }, t.prototype.getReferenceAngle = function() {
    return this.m_referenceAngle;
  }, t.prototype.getJointAngle = function() {
    var e = this.m_bodyA, r = this.m_bodyB;
    return r.m_sweep.a - e.m_sweep.a - this.m_referenceAngle;
  }, t.prototype.getJointSpeed = function() {
    var e = this.m_bodyA, r = this.m_bodyB;
    return r.m_angularVelocity - e.m_angularVelocity;
  }, t.prototype.isMotorEnabled = function() {
    return this.m_enableMotor;
  }, t.prototype.enableMotor = function(e) {
    e != this.m_enableMotor && (this.m_bodyA.setAwake(true), this.m_bodyB.setAwake(true), this.m_enableMotor = e);
  }, t.prototype.getMotorTorque = function(e) {
    return e * this.m_motorImpulse;
  }, t.prototype.setMotorSpeed = function(e) {
    e != this.m_motorSpeed && (this.m_bodyA.setAwake(true), this.m_bodyB.setAwake(true), this.m_motorSpeed = e);
  }, t.prototype.getMotorSpeed = function() {
    return this.m_motorSpeed;
  }, t.prototype.setMaxMotorTorque = function(e) {
    e != this.m_maxMotorTorque && (this.m_bodyA.setAwake(true), this.m_bodyB.setAwake(true), this.m_maxMotorTorque = e);
  }, t.prototype.getMaxMotorTorque = function() {
    return this.m_maxMotorTorque;
  }, t.prototype.isLimitEnabled = function() {
    return this.m_enableLimit;
  }, t.prototype.enableLimit = function(e) {
    e != this.m_enableLimit && (this.m_bodyA.setAwake(true), this.m_bodyB.setAwake(true), this.m_enableLimit = e, this.m_impulse.z = 0);
  }, t.prototype.getLowerLimit = function() {
    return this.m_lowerAngle;
  }, t.prototype.getUpperLimit = function() {
    return this.m_upperAngle;
  }, t.prototype.setLimits = function(e, r) {
    (e != this.m_lowerAngle || r != this.m_upperAngle) && (this.m_bodyA.setAwake(true), this.m_bodyB.setAwake(true), this.m_impulse.z = 0, this.m_lowerAngle = e, this.m_upperAngle = r);
  }, t.prototype.getAnchorA = function() {
    return this.m_bodyA.getWorldPoint(this.m_localAnchorA);
  }, t.prototype.getAnchorB = function() {
    return this.m_bodyB.getWorldPoint(this.m_localAnchorB);
  }, t.prototype.getReactionForce = function(e) {
    return a.neo(this.m_impulse.x, this.m_impulse.y).mul(e);
  }, t.prototype.getReactionTorque = function(e) {
    return e * this.m_impulse.z;
  }, t.prototype.initVelocityConstraints = function(e) {
    this.m_localCenterA = this.m_bodyA.m_sweep.localCenter, this.m_localCenterB = this.m_bodyB.m_sweep.localCenter, this.m_invMassA = this.m_bodyA.m_invMass, this.m_invMassB = this.m_bodyB.m_invMass, this.m_invIA = this.m_bodyA.m_invI, this.m_invIB = this.m_bodyB.m_invI;
    var r = this.m_bodyA.c_position.a, s = this.m_bodyA.c_velocity.v, o = this.m_bodyA.c_velocity.w, n = this.m_bodyB.c_position.a, m = this.m_bodyB.c_velocity.v, h = this.m_bodyB.c_velocity.w, p = B.neo(r), l = B.neo(n);
    this.m_rA = B.mulVec2(p, a.sub(this.m_localAnchorA, this.m_localCenterA)), this.m_rB = B.mulVec2(l, a.sub(this.m_localAnchorB, this.m_localCenterB));
    var u = this.m_invMassA, c = this.m_invMassB, _ = this.m_invIA, y = this.m_invIB, v = _ + y === 0;
    if (this.m_mass.ex.x = u + c + this.m_rA.y * this.m_rA.y * _ + this.m_rB.y * this.m_rB.y * y, this.m_mass.ey.x = -this.m_rA.y * this.m_rA.x * _ - this.m_rB.y * this.m_rB.x * y, this.m_mass.ez.x = -this.m_rA.y * _ - this.m_rB.y * y, this.m_mass.ex.y = this.m_mass.ey.x, this.m_mass.ey.y = u + c + this.m_rA.x * this.m_rA.x * _ + this.m_rB.x * this.m_rB.x * y, this.m_mass.ez.y = this.m_rA.x * _ + this.m_rB.x * y, this.m_mass.ex.z = this.m_mass.ez.x, this.m_mass.ey.z = this.m_mass.ez.y, this.m_mass.ez.z = _ + y, this.m_motorMass = _ + y, this.m_motorMass > 0 && (this.m_motorMass = 1 / this.m_motorMass), (this.m_enableMotor == false || v) && (this.m_motorImpulse = 0), this.m_enableLimit && v == false) {
      var f = n - r - this.m_referenceAngle;
      $s(this.m_upperAngle - this.m_lowerAngle) < 2 * z.angularSlop ? this.m_limitState = lt.equalLimits : f <= this.m_lowerAngle ? (this.m_limitState != lt.atLowerLimit && (this.m_impulse.z = 0), this.m_limitState = lt.atLowerLimit) : f >= this.m_upperAngle ? (this.m_limitState != lt.atUpperLimit && (this.m_impulse.z = 0), this.m_limitState = lt.atUpperLimit) : (this.m_limitState = lt.inactiveLimit, this.m_impulse.z = 0);
    } else this.m_limitState = lt.inactiveLimit;
    if (e.warmStarting) {
      this.m_impulse.mul(e.dtRatio), this.m_motorImpulse *= e.dtRatio;
      var d = a.neo(this.m_impulse.x, this.m_impulse.y);
      s.subMul(u, d), o -= _ * (a.crossVec2Vec2(this.m_rA, d) + this.m_motorImpulse + this.m_impulse.z), m.addMul(c, d), h += y * (a.crossVec2Vec2(this.m_rB, d) + this.m_motorImpulse + this.m_impulse.z);
    } else this.m_impulse.setZero(), this.m_motorImpulse = 0;
    this.m_bodyA.c_velocity.v = s, this.m_bodyA.c_velocity.w = o, this.m_bodyB.c_velocity.v = m, this.m_bodyB.c_velocity.w = h;
  }, t.prototype.solveVelocityConstraints = function(e) {
    var r = this.m_bodyA.c_velocity.v, s = this.m_bodyA.c_velocity.w, o = this.m_bodyB.c_velocity.v, n = this.m_bodyB.c_velocity.w, m = this.m_invMassA, h = this.m_invMassB, p = this.m_invIA, l = this.m_invIB, u = p + l === 0;
    if (this.m_enableMotor && this.m_limitState != lt.equalLimits && u == false) {
      var c = n - s - this.m_motorSpeed, _ = -this.m_motorMass * c, y = this.m_motorImpulse, v = e.dt * this.m_maxMotorTorque;
      this.m_motorImpulse = pt(this.m_motorImpulse + _, -v, v), _ = this.m_motorImpulse - y, s -= p * _, n += l * _;
    }
    if (this.m_enableLimit && this.m_limitState != lt.inactiveLimit && u == false) {
      var f = a.zero();
      f.addCombine(1, o, 1, a.crossNumVec2(n, this.m_rB)), f.subCombine(1, r, 1, a.crossNumVec2(s, this.m_rA));
      var d = n - s, c = new $(f.x, f.y, d), _ = $.neg(this.m_mass.solve33(c));
      if (this.m_limitState == lt.equalLimits) this.m_impulse.add(_);
      else if (this.m_limitState == lt.atLowerLimit) {
        var A = this.m_impulse.z + _.z;
        if (A < 0) {
          var b = a.combine(-1, f, this.m_impulse.z, a.neo(this.m_mass.ez.x, this.m_mass.ez.y)), w = this.m_mass.solve22(b);
          _.x = w.x, _.y = w.y, _.z = -this.m_impulse.z, this.m_impulse.x += w.x, this.m_impulse.y += w.y, this.m_impulse.z = 0;
        } else this.m_impulse.add(_);
      } else if (this.m_limitState == lt.atUpperLimit) {
        var A = this.m_impulse.z + _.z;
        if (A > 0) {
          var b = a.combine(-1, f, this.m_impulse.z, a.neo(this.m_mass.ez.x, this.m_mass.ez.y)), w = this.m_mass.solve22(b);
          _.x = w.x, _.y = w.y, _.z = -this.m_impulse.z, this.m_impulse.x += w.x, this.m_impulse.y += w.y, this.m_impulse.z = 0;
        } else this.m_impulse.add(_);
      }
      var V = a.neo(_.x, _.y);
      r.subMul(m, V), s -= p * (a.crossVec2Vec2(this.m_rA, V) + _.z), o.addMul(h, V), n += l * (a.crossVec2Vec2(this.m_rB, V) + _.z);
    } else {
      var c = a.zero();
      c.addCombine(1, o, 1, a.crossNumVec2(n, this.m_rB)), c.subCombine(1, r, 1, a.crossNumVec2(s, this.m_rA));
      var _ = this.m_mass.solve22(a.neg(c));
      this.m_impulse.x += _.x, this.m_impulse.y += _.y, r.subMul(m, _), s -= p * a.crossVec2Vec2(this.m_rA, _), o.addMul(h, _), n += l * a.crossVec2Vec2(this.m_rB, _);
    }
    this.m_bodyA.c_velocity.v = r, this.m_bodyA.c_velocity.w = s, this.m_bodyB.c_velocity.v = o, this.m_bodyB.c_velocity.w = n;
  }, t.prototype.solvePositionConstraints = function(e) {
    var r = this.m_bodyA.c_position.c, s = this.m_bodyA.c_position.a, o = this.m_bodyB.c_position.c, n = this.m_bodyB.c_position.a, m = B.neo(s), h = B.neo(n), p = 0, l = 0, u = this.m_invIA + this.m_invIB == 0;
    if (this.m_enableLimit && this.m_limitState != lt.inactiveLimit && u == false) {
      var c = n - s - this.m_referenceAngle, _ = 0;
      if (this.m_limitState == lt.equalLimits) {
        var y = pt(c - this.m_lowerAngle, -z.maxAngularCorrection, z.maxAngularCorrection);
        _ = -this.m_motorMass * y, p = $s(y);
      } else if (this.m_limitState == lt.atLowerLimit) {
        var y = c - this.m_lowerAngle;
        p = -y, y = pt(y + z.angularSlop, -z.maxAngularCorrection, 0), _ = -this.m_motorMass * y;
      } else if (this.m_limitState == lt.atUpperLimit) {
        var y = c - this.m_upperAngle;
        p = y, y = pt(y - z.angularSlop, 0, z.maxAngularCorrection), _ = -this.m_motorMass * y;
      }
      s -= this.m_invIA * _, n += this.m_invIB * _;
    }
    {
      m.setAngle(s), h.setAngle(n);
      var v = B.mulVec2(m, a.sub(this.m_localAnchorA, this.m_localCenterA)), f = B.mulVec2(h, a.sub(this.m_localAnchorB, this.m_localCenterB)), y = a.zero();
      y.addCombine(1, o, 1, f), y.subCombine(1, r, 1, v), l = y.length();
      var d = this.m_invMassA, A = this.m_invMassB, b = this.m_invIA, w = this.m_invIB, V = new Yt();
      V.ex.x = d + A + b * v.y * v.y + w * f.y * f.y, V.ex.y = -b * v.x * v.y - w * f.x * f.y, V.ey.x = V.ex.y, V.ey.y = d + A + b * v.x * v.x + w * f.x * f.x;
      var I = a.neg(V.solve(y));
      r.subMul(d, I), s -= b * a.crossVec2Vec2(v, I), o.addMul(A, I), n += w * a.crossVec2Vec2(f, I);
    }
    return this.m_bodyA.c_position.c.setVec2(r), this.m_bodyA.c_position.a = s, this.m_bodyB.c_position.c.setVec2(o), this.m_bodyB.c_position.a = n, l <= z.linearSlop && p <= z.angularSlop;
  }, t.TYPE = "revolute-joint", t;
})(yt);
var Bi = Math.abs;
var Ys = Math.max;
var ln = Math.min;
var Ct;
(function(i) {
  i[i.inactiveLimit = 0] = "inactiveLimit", i[i.atLowerLimit = 1] = "atLowerLimit", i[i.atUpperLimit = 2] = "atUpperLimit", i[i.equalLimits = 3] = "equalLimits";
})(Ct || (Ct = {}));
var cn = { enableLimit: false, lowerTranslation: 0, upperTranslation: 0, enableMotor: false, maxMotorForce: 0, motorSpeed: 0 };
var Yr = (function(i) {
  xt(t, i);
  function t(e, r, s, o, n) {
    var m = this;
    return m instanceof t ? (e = qt(e, cn), m = i.call(this, e, r, s) || this, r = m.m_bodyA, s = m.m_bodyB, m.m_type = t.TYPE, m.m_localAnchorA = a.clone(o ? r.getLocalPoint(o) : e.localAnchorA || a.zero()), m.m_localAnchorB = a.clone(o ? s.getLocalPoint(o) : e.localAnchorB || a.zero()), m.m_localXAxisA = a.clone(n ? r.getLocalVector(n) : e.localAxisA || a.neo(1, 0)), m.m_localXAxisA.normalize(), m.m_localYAxisA = a.crossNumVec2(1, m.m_localXAxisA), m.m_referenceAngle = Number.isFinite(e.referenceAngle) ? e.referenceAngle : s.getAngle() - r.getAngle(), m.m_impulse = new $(), m.m_motorMass = 0, m.m_motorImpulse = 0, m.m_lowerTranslation = e.lowerTranslation, m.m_upperTranslation = e.upperTranslation, m.m_maxMotorForce = e.maxMotorForce, m.m_motorSpeed = e.motorSpeed, m.m_enableLimit = e.enableLimit, m.m_enableMotor = e.enableMotor, m.m_limitState = Ct.inactiveLimit, m.m_axis = a.zero(), m.m_perp = a.zero(), m.m_K = new fe(), m) : new t(e, r, s, o, n);
  }
  return t.prototype._serialize = function() {
    return { type: this.m_type, bodyA: this.m_bodyA, bodyB: this.m_bodyB, collideConnected: this.m_collideConnected, lowerTranslation: this.m_lowerTranslation, upperTranslation: this.m_upperTranslation, maxMotorForce: this.m_maxMotorForce, motorSpeed: this.m_motorSpeed, enableLimit: this.m_enableLimit, enableMotor: this.m_enableMotor, localAnchorA: this.m_localAnchorA, localAnchorB: this.m_localAnchorB, localAxisA: this.m_localXAxisA, referenceAngle: this.m_referenceAngle };
  }, t._deserialize = function(e, r, s) {
    e = dt({}, e), e.bodyA = s(W, e.bodyA, r), e.bodyB = s(W, e.bodyB, r), e.localAxisA = a.clone(e.localAxisA);
    var o = new t(e);
    return o;
  }, t.prototype._reset = function(e) {
    e.anchorA ? this.m_localAnchorA.setVec2(this.m_bodyA.getLocalPoint(e.anchorA)) : e.localAnchorA && this.m_localAnchorA.setVec2(e.localAnchorA), e.anchorB ? this.m_localAnchorB.setVec2(this.m_bodyB.getLocalPoint(e.anchorB)) : e.localAnchorB && this.m_localAnchorB.setVec2(e.localAnchorB), e.localAxisA && (this.m_localXAxisA.setVec2(e.localAxisA), this.m_localYAxisA.setVec2(a.crossNumVec2(1, e.localAxisA))), Number.isFinite(e.referenceAngle) && (this.m_referenceAngle = e.referenceAngle), typeof e.enableLimit < "u" && (this.m_enableLimit = !!e.enableLimit), Number.isFinite(e.lowerTranslation) && (this.m_lowerTranslation = e.lowerTranslation), Number.isFinite(e.upperTranslation) && (this.m_upperTranslation = e.upperTranslation), typeof e.enableMotor < "u" && (this.m_enableMotor = !!e.enableMotor), Number.isFinite(e.maxMotorForce) && (this.m_maxMotorForce = e.maxMotorForce), Number.isFinite(e.motorSpeed) && (this.m_motorSpeed = e.motorSpeed);
  }, t.prototype.getLocalAnchorA = function() {
    return this.m_localAnchorA;
  }, t.prototype.getLocalAnchorB = function() {
    return this.m_localAnchorB;
  }, t.prototype.getLocalAxisA = function() {
    return this.m_localXAxisA;
  }, t.prototype.getReferenceAngle = function() {
    return this.m_referenceAngle;
  }, t.prototype.getJointTranslation = function() {
    var e = this.m_bodyA.getWorldPoint(this.m_localAnchorA), r = this.m_bodyB.getWorldPoint(this.m_localAnchorB), s = a.sub(r, e), o = this.m_bodyA.getWorldVector(this.m_localXAxisA), n = a.dot(s, o);
    return n;
  }, t.prototype.getJointSpeed = function() {
    var e = this.m_bodyA, r = this.m_bodyB, s = B.mulVec2(e.m_xf.q, a.sub(this.m_localAnchorA, e.m_sweep.localCenter)), o = B.mulVec2(r.m_xf.q, a.sub(this.m_localAnchorB, r.m_sweep.localCenter)), n = a.add(e.m_sweep.c, s), m = a.add(r.m_sweep.c, o), h = a.sub(m, n), p = B.mulVec2(e.m_xf.q, this.m_localXAxisA), l = e.m_linearVelocity, u = r.m_linearVelocity, c = e.m_angularVelocity, _ = r.m_angularVelocity, y = a.dot(h, a.crossNumVec2(c, p)) + a.dot(p, a.sub(a.addCrossNumVec2(u, _, o), a.addCrossNumVec2(l, c, s)));
    return y;
  }, t.prototype.isLimitEnabled = function() {
    return this.m_enableLimit;
  }, t.prototype.enableLimit = function(e) {
    e != this.m_enableLimit && (this.m_bodyA.setAwake(true), this.m_bodyB.setAwake(true), this.m_enableLimit = e, this.m_impulse.z = 0);
  }, t.prototype.getLowerLimit = function() {
    return this.m_lowerTranslation;
  }, t.prototype.getUpperLimit = function() {
    return this.m_upperTranslation;
  }, t.prototype.setLimits = function(e, r) {
    (e != this.m_lowerTranslation || r != this.m_upperTranslation) && (this.m_bodyA.setAwake(true), this.m_bodyB.setAwake(true), this.m_lowerTranslation = e, this.m_upperTranslation = r, this.m_impulse.z = 0);
  }, t.prototype.isMotorEnabled = function() {
    return this.m_enableMotor;
  }, t.prototype.enableMotor = function(e) {
    e != this.m_enableMotor && (this.m_bodyA.setAwake(true), this.m_bodyB.setAwake(true), this.m_enableMotor = e);
  }, t.prototype.setMotorSpeed = function(e) {
    e != this.m_motorSpeed && (this.m_bodyA.setAwake(true), this.m_bodyB.setAwake(true), this.m_motorSpeed = e);
  }, t.prototype.setMaxMotorForce = function(e) {
    e != this.m_maxMotorForce && (this.m_bodyA.setAwake(true), this.m_bodyB.setAwake(true), this.m_maxMotorForce = e);
  }, t.prototype.getMaxMotorForce = function() {
    return this.m_maxMotorForce;
  }, t.prototype.getMotorSpeed = function() {
    return this.m_motorSpeed;
  }, t.prototype.getMotorForce = function(e) {
    return e * this.m_motorImpulse;
  }, t.prototype.getAnchorA = function() {
    return this.m_bodyA.getWorldPoint(this.m_localAnchorA);
  }, t.prototype.getAnchorB = function() {
    return this.m_bodyB.getWorldPoint(this.m_localAnchorB);
  }, t.prototype.getReactionForce = function(e) {
    return a.combine(this.m_impulse.x, this.m_perp, this.m_motorImpulse + this.m_impulse.z, this.m_axis).mul(e);
  }, t.prototype.getReactionTorque = function(e) {
    return e * this.m_impulse.y;
  }, t.prototype.initVelocityConstraints = function(e) {
    this.m_localCenterA = this.m_bodyA.m_sweep.localCenter, this.m_localCenterB = this.m_bodyB.m_sweep.localCenter, this.m_invMassA = this.m_bodyA.m_invMass, this.m_invMassB = this.m_bodyB.m_invMass, this.m_invIA = this.m_bodyA.m_invI, this.m_invIB = this.m_bodyB.m_invI;
    var r = this.m_bodyA.c_position.c, s = this.m_bodyA.c_position.a, o = this.m_bodyA.c_velocity.v, n = this.m_bodyA.c_velocity.w, m = this.m_bodyB.c_position.c, h = this.m_bodyB.c_position.a, p = this.m_bodyB.c_velocity.v, l = this.m_bodyB.c_velocity.w, u = B.neo(s), c = B.neo(h), _ = B.mulVec2(u, a.sub(this.m_localAnchorA, this.m_localCenterA)), y = B.mulVec2(c, a.sub(this.m_localAnchorB, this.m_localCenterB)), v = a.zero();
    v.addCombine(1, m, 1, y), v.subCombine(1, r, 1, _);
    var f = this.m_invMassA, d = this.m_invMassB, A = this.m_invIA, b = this.m_invIB;
    this.m_axis = B.mulVec2(u, this.m_localXAxisA), this.m_a1 = a.crossVec2Vec2(a.add(v, _), this.m_axis), this.m_a2 = a.crossVec2Vec2(y, this.m_axis), this.m_motorMass = f + d + A * this.m_a1 * this.m_a1 + b * this.m_a2 * this.m_a2, this.m_motorMass > 0 && (this.m_motorMass = 1 / this.m_motorMass);
    {
      this.m_perp = B.mulVec2(u, this.m_localYAxisA), this.m_s1 = a.crossVec2Vec2(a.add(v, _), this.m_perp), this.m_s2 = a.crossVec2Vec2(y, this.m_perp), a.crossVec2Vec2(_, this.m_perp);
      var w = f + d + A * this.m_s1 * this.m_s1 + b * this.m_s2 * this.m_s2, V = A * this.m_s1 + b * this.m_s2, I = A * this.m_s1 * this.m_a1 + b * this.m_s2 * this.m_a2, M = A + b;
      M == 0 && (M = 1);
      var P = A * this.m_a1 + b * this.m_a2, k = f + d + A * this.m_a1 * this.m_a1 + b * this.m_a2 * this.m_a2;
      this.m_K.ex.set(w, V, I), this.m_K.ey.set(V, M, P), this.m_K.ez.set(I, P, k);
    }
    if (this.m_enableLimit) {
      var F = a.dot(this.m_axis, v);
      Bi(this.m_upperTranslation - this.m_lowerTranslation) < 2 * z.linearSlop ? this.m_limitState = Ct.equalLimits : F <= this.m_lowerTranslation ? this.m_limitState != Ct.atLowerLimit && (this.m_limitState = Ct.atLowerLimit, this.m_impulse.z = 0) : F >= this.m_upperTranslation ? this.m_limitState != Ct.atUpperLimit && (this.m_limitState = Ct.atUpperLimit, this.m_impulse.z = 0) : (this.m_limitState = Ct.inactiveLimit, this.m_impulse.z = 0);
    } else this.m_limitState = Ct.inactiveLimit, this.m_impulse.z = 0;
    if (this.m_enableMotor == false && (this.m_motorImpulse = 0), e.warmStarting) {
      this.m_impulse.mul(e.dtRatio), this.m_motorImpulse *= e.dtRatio;
      var O = a.combine(this.m_impulse.x, this.m_perp, this.m_motorImpulse + this.m_impulse.z, this.m_axis), Y = this.m_impulse.x * this.m_s1 + this.m_impulse.y + (this.m_motorImpulse + this.m_impulse.z) * this.m_a1, j = this.m_impulse.x * this.m_s2 + this.m_impulse.y + (this.m_motorImpulse + this.m_impulse.z) * this.m_a2;
      o.subMul(f, O), n -= A * Y, p.addMul(d, O), l += b * j;
    } else this.m_impulse.setZero(), this.m_motorImpulse = 0;
    this.m_bodyA.c_velocity.v.setVec2(o), this.m_bodyA.c_velocity.w = n, this.m_bodyB.c_velocity.v.setVec2(p), this.m_bodyB.c_velocity.w = l;
  }, t.prototype.solveVelocityConstraints = function(e) {
    var r = this.m_bodyA.c_velocity.v, s = this.m_bodyA.c_velocity.w, o = this.m_bodyB.c_velocity.v, n = this.m_bodyB.c_velocity.w, m = this.m_invMassA, h = this.m_invMassB, p = this.m_invIA, l = this.m_invIB;
    if (this.m_enableMotor && this.m_limitState != Ct.equalLimits) {
      var u = a.dot(this.m_axis, a.sub(o, r)) + this.m_a2 * n - this.m_a1 * s, c = this.m_motorMass * (this.m_motorSpeed - u), _ = this.m_motorImpulse, y = e.dt * this.m_maxMotorForce;
      this.m_motorImpulse = pt(this.m_motorImpulse + c, -y, y), c = this.m_motorImpulse - _;
      var v = a.mulNumVec2(c, this.m_axis), f = c * this.m_a1, d = c * this.m_a2;
      r.subMul(m, v), s -= p * f, o.addMul(h, v), n += l * d;
    }
    var A = a.zero();
    if (A.x += a.dot(this.m_perp, o) + this.m_s2 * n, A.x -= a.dot(this.m_perp, r) + this.m_s1 * s, A.y = n - s, this.m_enableLimit && this.m_limitState != Ct.inactiveLimit) {
      var b = 0;
      b += a.dot(this.m_axis, o) + this.m_a2 * n, b -= a.dot(this.m_axis, r) + this.m_a1 * s;
      var u = new $(A.x, A.y, b), w = $.clone(this.m_impulse), V = this.m_K.solve33($.neg(u));
      this.m_impulse.add(V), this.m_limitState == Ct.atLowerLimit ? this.m_impulse.z = Ys(this.m_impulse.z, 0) : this.m_limitState == Ct.atUpperLimit && (this.m_impulse.z = ln(this.m_impulse.z, 0));
      var I = a.combine(-1, A, -(this.m_impulse.z - w.z), a.neo(this.m_K.ez.x, this.m_K.ez.y)), M = a.add(this.m_K.solve22(I), a.neo(w.x, w.y));
      this.m_impulse.x = M.x, this.m_impulse.y = M.y, V = $.sub(this.m_impulse, w);
      var v = a.combine(V.x, this.m_perp, V.z, this.m_axis), f = V.x * this.m_s1 + V.y + V.z * this.m_a1, d = V.x * this.m_s2 + V.y + V.z * this.m_a2;
      r.subMul(m, v), s -= p * f, o.addMul(h, v), n += l * d;
    } else {
      var V = this.m_K.solve22(a.neg(A));
      this.m_impulse.x += V.x, this.m_impulse.y += V.y;
      var v = a.mulNumVec2(V.x, this.m_perp), f = V.x * this.m_s1 + V.y, d = V.x * this.m_s2 + V.y;
      r.subMul(m, v), s -= p * f, o.addMul(h, v), n += l * d;
    }
    this.m_bodyA.c_velocity.v = r, this.m_bodyA.c_velocity.w = s, this.m_bodyB.c_velocity.v = o, this.m_bodyB.c_velocity.w = n;
  }, t.prototype.solvePositionConstraints = function(e) {
    var r = this.m_bodyA.c_position.c, s = this.m_bodyA.c_position.a, o = this.m_bodyB.c_position.c, n = this.m_bodyB.c_position.a, m = B.neo(s), h = B.neo(n), p = this.m_invMassA, l = this.m_invMassB, u = this.m_invIA, c = this.m_invIB, _ = B.mulVec2(m, a.sub(this.m_localAnchorA, this.m_localCenterA)), y = B.mulVec2(h, a.sub(this.m_localAnchorB, this.m_localCenterB)), v = a.sub(a.add(o, y), a.add(r, _)), f = B.mulVec2(m, this.m_localXAxisA), d = a.crossVec2Vec2(a.add(v, _), f), A = a.crossVec2Vec2(y, f), b = B.mulVec2(m, this.m_localYAxisA), w = a.crossVec2Vec2(a.add(v, _), b), V = a.crossVec2Vec2(y, b), I = new $(), M = a.zero();
    M.x = a.dot(b, v), M.y = n - s - this.m_referenceAngle;
    var P = Bi(M.x), k = Bi(M.y), F = z.linearSlop, O = z.maxLinearCorrection, Y = false, j = 0;
    if (this.m_enableLimit) {
      var H = a.dot(f, v);
      Bi(this.m_upperTranslation - this.m_lowerTranslation) < 2 * F ? (j = pt(H, -O, O), P = Ys(P, Bi(H)), Y = true) : H <= this.m_lowerTranslation ? (j = pt(H - this.m_lowerTranslation + F, -O, 0), P = Math.max(P, this.m_lowerTranslation - H), Y = true) : H >= this.m_upperTranslation && (j = pt(H - this.m_upperTranslation - F, 0, O), P = Math.max(P, H - this.m_upperTranslation), Y = true);
    }
    if (Y) {
      var It = p + l + u * w * w + c * V * V, ct = u * w + c * V, Wt = u * w * d + c * V * A, Bt = u + c;
      Bt == 0 && (Bt = 1);
      var tt = u * d + c * A, pi = p + l + u * d * d + c * A * A, Tt = new fe();
      Tt.ex.set(It, ct, Wt), Tt.ey.set(ct, Bt, tt), Tt.ez.set(Wt, tt, pi);
      var Ae = new $();
      Ae.x = M.x, Ae.y = M.y, Ae.z = j, I = Tt.solve33($.neg(Ae));
    } else {
      var It = p + l + u * w * w + c * V * V, ct = u * w + c * V, Bt = u + c;
      Bt == 0 && (Bt = 1);
      var Tt = new Yt();
      Tt.ex.setNum(It, ct), Tt.ey.setNum(ct, Bt);
      var Le = Tt.solve(a.neg(M));
      I.x = Le.x, I.y = Le.y, I.z = 0;
    }
    var vi = a.combine(I.x, b, I.z, f), Xe = I.x * w + I.y + I.z * d, pr = I.x * V + I.y + I.z * A;
    return r.subMul(p, vi), s -= u * Xe, o.addMul(l, vi), n += c * pr, this.m_bodyA.c_position.c = r, this.m_bodyA.c_position.a = s, this.m_bodyB.c_position.c = o, this.m_bodyB.c_position.a = n, P <= z.linearSlop && k <= z.angularSlop;
  }, t.TYPE = "prismatic-joint", t;
})(yt);
var _n = { ratio: 1 };
var Wr = (function(i) {
  xt(t, i);
  function t(e, r, s, o, n, m) {
    var h = this;
    if (!(h instanceof t)) return new t(e, r, s, o, n, m);
    e = qt(e, _n), h = i.call(this, e, r, s) || this, r = h.m_bodyA, s = h.m_bodyB, h.m_type = t.TYPE, h.m_joint1 = o || e.joint1, h.m_joint2 = n || e.joint2, h.m_ratio = Number.isFinite(m) ? m : e.ratio, h.m_type1 = h.m_joint1.getType(), h.m_type2 = h.m_joint2.getType();
    var p, l;
    h.m_bodyC = h.m_joint1.getBodyA(), h.m_bodyA = h.m_joint1.getBodyB();
    var u = h.m_bodyA.m_xf, c = h.m_bodyA.m_sweep.a, _ = h.m_bodyC.m_xf, y = h.m_bodyC.m_sweep.a;
    if (h.m_type1 === ye.TYPE) {
      var v = h.m_joint1;
      h.m_localAnchorC = v.m_localAnchorA, h.m_localAnchorA = v.m_localAnchorB, h.m_referenceAngleA = v.m_referenceAngle, h.m_localAxisC = a.zero(), p = c - y - h.m_referenceAngleA;
    } else {
      var f = h.m_joint1;
      h.m_localAnchorC = f.m_localAnchorA, h.m_localAnchorA = f.m_localAnchorB, h.m_referenceAngleA = f.m_referenceAngle, h.m_localAxisC = f.m_localXAxisA;
      var d = h.m_localAnchorC, A = B.mulTVec2(_.q, a.add(B.mulVec2(u.q, h.m_localAnchorA), a.sub(u.p, _.p)));
      p = a.dot(A, h.m_localAxisC) - a.dot(d, h.m_localAxisC);
    }
    h.m_bodyD = h.m_joint2.getBodyA(), h.m_bodyB = h.m_joint2.getBodyB();
    var b = h.m_bodyB.m_xf, w = h.m_bodyB.m_sweep.a, V = h.m_bodyD.m_xf, I = h.m_bodyD.m_sweep.a;
    if (h.m_type2 === ye.TYPE) {
      var v = h.m_joint2;
      h.m_localAnchorD = v.m_localAnchorA, h.m_localAnchorB = v.m_localAnchorB, h.m_referenceAngleB = v.m_referenceAngle, h.m_localAxisD = a.zero(), l = w - I - h.m_referenceAngleB;
    } else {
      var f = h.m_joint2;
      h.m_localAnchorD = f.m_localAnchorA, h.m_localAnchorB = f.m_localAnchorB, h.m_referenceAngleB = f.m_referenceAngle, h.m_localAxisD = f.m_localXAxisA;
      var M = h.m_localAnchorD, P = B.mulTVec2(V.q, a.add(B.mulVec2(b.q, h.m_localAnchorB), a.sub(b.p, V.p)));
      l = a.dot(P, h.m_localAxisD) - a.dot(M, h.m_localAxisD);
    }
    return h.m_constant = p + h.m_ratio * l, h.m_impulse = 0, h;
  }
  return t.prototype._serialize = function() {
    return { type: this.m_type, bodyA: this.m_bodyA, bodyB: this.m_bodyB, collideConnected: this.m_collideConnected, joint1: this.m_joint1, joint2: this.m_joint2, ratio: this.m_ratio };
  }, t._deserialize = function(e, r, s) {
    e = dt({}, e), e.bodyA = s(W, e.bodyA, r), e.bodyB = s(W, e.bodyB, r), e.joint1 = s(yt, e.joint1, r), e.joint2 = s(yt, e.joint2, r);
    var o = new t(e);
    return o;
  }, t.prototype._reset = function(e) {
    Number.isFinite(e.ratio) && (this.m_ratio = e.ratio);
  }, t.prototype.getJoint1 = function() {
    return this.m_joint1;
  }, t.prototype.getJoint2 = function() {
    return this.m_joint2;
  }, t.prototype.setRatio = function(e) {
    this.m_ratio = e;
  }, t.prototype.getRatio = function() {
    return this.m_ratio;
  }, t.prototype.getAnchorA = function() {
    return this.m_bodyA.getWorldPoint(this.m_localAnchorA);
  }, t.prototype.getAnchorB = function() {
    return this.m_bodyB.getWorldPoint(this.m_localAnchorB);
  }, t.prototype.getReactionForce = function(e) {
    return a.mulNumVec2(this.m_impulse, this.m_JvAC).mul(e);
  }, t.prototype.getReactionTorque = function(e) {
    var r = this.m_impulse * this.m_JwA;
    return e * r;
  }, t.prototype.initVelocityConstraints = function(e) {
    this.m_lcA = this.m_bodyA.m_sweep.localCenter, this.m_lcB = this.m_bodyB.m_sweep.localCenter, this.m_lcC = this.m_bodyC.m_sweep.localCenter, this.m_lcD = this.m_bodyD.m_sweep.localCenter, this.m_mA = this.m_bodyA.m_invMass, this.m_mB = this.m_bodyB.m_invMass, this.m_mC = this.m_bodyC.m_invMass, this.m_mD = this.m_bodyD.m_invMass, this.m_iA = this.m_bodyA.m_invI, this.m_iB = this.m_bodyB.m_invI, this.m_iC = this.m_bodyC.m_invI, this.m_iD = this.m_bodyD.m_invI;
    var r = this.m_bodyA.c_position.a, s = this.m_bodyA.c_velocity.v, o = this.m_bodyA.c_velocity.w, n = this.m_bodyB.c_position.a, m = this.m_bodyB.c_velocity.v, h = this.m_bodyB.c_velocity.w, p = this.m_bodyC.c_position.a, l = this.m_bodyC.c_velocity.v, u = this.m_bodyC.c_velocity.w, c = this.m_bodyD.c_position.a, _ = this.m_bodyD.c_velocity.v, y = this.m_bodyD.c_velocity.w, v = B.neo(r), f = B.neo(n), d = B.neo(p), A = B.neo(c);
    if (this.m_mass = 0, this.m_type1 == ye.TYPE) this.m_JvAC = a.zero(), this.m_JwA = 1, this.m_JwC = 1, this.m_mass += this.m_iA + this.m_iC;
    else {
      var b = B.mulVec2(d, this.m_localAxisC), w = B.mulSub(d, this.m_localAnchorC, this.m_lcC), V = B.mulSub(v, this.m_localAnchorA, this.m_lcA);
      this.m_JvAC = b, this.m_JwC = a.crossVec2Vec2(w, b), this.m_JwA = a.crossVec2Vec2(V, b), this.m_mass += this.m_mC + this.m_mA + this.m_iC * this.m_JwC * this.m_JwC + this.m_iA * this.m_JwA * this.m_JwA;
    }
    if (this.m_type2 == ye.TYPE) this.m_JvBD = a.zero(), this.m_JwB = this.m_ratio, this.m_JwD = this.m_ratio, this.m_mass += this.m_ratio * this.m_ratio * (this.m_iB + this.m_iD);
    else {
      var b = B.mulVec2(A, this.m_localAxisD), I = B.mulSub(A, this.m_localAnchorD, this.m_lcD), M = B.mulSub(f, this.m_localAnchorB, this.m_lcB);
      this.m_JvBD = a.mulNumVec2(this.m_ratio, b), this.m_JwD = this.m_ratio * a.crossVec2Vec2(I, b), this.m_JwB = this.m_ratio * a.crossVec2Vec2(M, b), this.m_mass += this.m_ratio * this.m_ratio * (this.m_mD + this.m_mB) + this.m_iD * this.m_JwD * this.m_JwD + this.m_iB * this.m_JwB * this.m_JwB;
    }
    this.m_mass = this.m_mass > 0 ? 1 / this.m_mass : 0, e.warmStarting ? (s.addMul(this.m_mA * this.m_impulse, this.m_JvAC), o += this.m_iA * this.m_impulse * this.m_JwA, m.addMul(this.m_mB * this.m_impulse, this.m_JvBD), h += this.m_iB * this.m_impulse * this.m_JwB, l.subMul(this.m_mC * this.m_impulse, this.m_JvAC), u -= this.m_iC * this.m_impulse * this.m_JwC, _.subMul(this.m_mD * this.m_impulse, this.m_JvBD), y -= this.m_iD * this.m_impulse * this.m_JwD) : this.m_impulse = 0, this.m_bodyA.c_velocity.v.setVec2(s), this.m_bodyA.c_velocity.w = o, this.m_bodyB.c_velocity.v.setVec2(m), this.m_bodyB.c_velocity.w = h, this.m_bodyC.c_velocity.v.setVec2(l), this.m_bodyC.c_velocity.w = u, this.m_bodyD.c_velocity.v.setVec2(_), this.m_bodyD.c_velocity.w = y;
  }, t.prototype.solveVelocityConstraints = function(e) {
    var r = this.m_bodyA.c_velocity.v, s = this.m_bodyA.c_velocity.w, o = this.m_bodyB.c_velocity.v, n = this.m_bodyB.c_velocity.w, m = this.m_bodyC.c_velocity.v, h = this.m_bodyC.c_velocity.w, p = this.m_bodyD.c_velocity.v, l = this.m_bodyD.c_velocity.w, u = a.dot(this.m_JvAC, r) - a.dot(this.m_JvAC, m) + a.dot(this.m_JvBD, o) - a.dot(this.m_JvBD, p);
    u += this.m_JwA * s - this.m_JwC * h + (this.m_JwB * n - this.m_JwD * l);
    var c = -this.m_mass * u;
    this.m_impulse += c, r.addMul(this.m_mA * c, this.m_JvAC), s += this.m_iA * c * this.m_JwA, o.addMul(this.m_mB * c, this.m_JvBD), n += this.m_iB * c * this.m_JwB, m.subMul(this.m_mC * c, this.m_JvAC), h -= this.m_iC * c * this.m_JwC, p.subMul(this.m_mD * c, this.m_JvBD), l -= this.m_iD * c * this.m_JwD, this.m_bodyA.c_velocity.v.setVec2(r), this.m_bodyA.c_velocity.w = s, this.m_bodyB.c_velocity.v.setVec2(o), this.m_bodyB.c_velocity.w = n, this.m_bodyC.c_velocity.v.setVec2(m), this.m_bodyC.c_velocity.w = h, this.m_bodyD.c_velocity.v.setVec2(p), this.m_bodyD.c_velocity.w = l;
  }, t.prototype.solvePositionConstraints = function(e) {
    var r = this.m_bodyA.c_position.c, s = this.m_bodyA.c_position.a, o = this.m_bodyB.c_position.c, n = this.m_bodyB.c_position.a, m = this.m_bodyC.c_position.c, h = this.m_bodyC.c_position.a, p = this.m_bodyD.c_position.c, l = this.m_bodyD.c_position.a, u = B.neo(s), c = B.neo(n), _ = B.neo(h), y = B.neo(l), v = 0, f, d, A, b, w, V, I, M, P = 0;
    if (this.m_type1 == ye.TYPE) A = a.zero(), w = 1, I = 1, P += this.m_iA + this.m_iC, f = s - h - this.m_referenceAngleA;
    else {
      var k = B.mulVec2(_, this.m_localAxisC), F = B.mulSub(_, this.m_localAnchorC, this.m_lcC), O = B.mulSub(u, this.m_localAnchorA, this.m_lcA);
      A = k, I = a.crossVec2Vec2(F, k), w = a.crossVec2Vec2(O, k), P += this.m_mC + this.m_mA + this.m_iC * I * I + this.m_iA * w * w;
      var Y = a.sub(this.m_localAnchorC, this.m_lcC), j = B.mulTVec2(_, a.add(O, a.sub(r, m)));
      f = a.dot(a.sub(j, Y), this.m_localAxisC);
    }
    if (this.m_type2 == ye.TYPE) b = a.zero(), V = this.m_ratio, M = this.m_ratio, P += this.m_ratio * this.m_ratio * (this.m_iB + this.m_iD), d = n - l - this.m_referenceAngleB;
    else {
      var k = B.mulVec2(y, this.m_localAxisD), H = B.mulSub(y, this.m_localAnchorD, this.m_lcD), It = B.mulSub(c, this.m_localAnchorB, this.m_lcB);
      b = a.mulNumVec2(this.m_ratio, k), M = this.m_ratio * a.crossVec2Vec2(H, k), V = this.m_ratio * a.crossVec2Vec2(It, k), P += this.m_ratio * this.m_ratio * (this.m_mD + this.m_mB) + this.m_iD * M * M + this.m_iB * V * V;
      var ct = a.sub(this.m_localAnchorD, this.m_lcD), Wt = B.mulTVec2(y, a.add(It, a.sub(o, p)));
      d = a.dot(Wt, this.m_localAxisD) - a.dot(ct, this.m_localAxisD);
    }
    var Bt = f + this.m_ratio * d - this.m_constant, tt = 0;
    return P > 0 && (tt = -Bt / P), r.addMul(this.m_mA * tt, A), s += this.m_iA * tt * w, o.addMul(this.m_mB * tt, b), n += this.m_iB * tt * V, m.subMul(this.m_mC * tt, A), h -= this.m_iC * tt * I, p.subMul(this.m_mD * tt, b), l -= this.m_iD * tt * M, this.m_bodyA.c_position.c.setVec2(r), this.m_bodyA.c_position.a = s, this.m_bodyB.c_position.c.setVec2(o), this.m_bodyB.c_position.a = n, this.m_bodyC.c_position.c.setVec2(m), this.m_bodyC.c_position.a = h, this.m_bodyD.c_position.c.setVec2(p), this.m_bodyD.c_position.a = l, v < z.linearSlop;
  }, t.TYPE = "gear-joint", t;
})(yt);
var un = { maxForce: 1, maxTorque: 1, correctionFactor: 0.3 };
var jr = (function(i) {
  xt(t, i);
  function t(e, r, s) {
    var o = this;
    return o instanceof t ? (e = qt(e, un), o = i.call(this, e, r, s) || this, r = o.m_bodyA, s = o.m_bodyB, o.m_type = t.TYPE, o.m_linearOffset = a.isValid(e.linearOffset) ? a.clone(e.linearOffset) : r.getLocalPoint(s.getPosition()), o.m_angularOffset = Number.isFinite(e.angularOffset) ? e.angularOffset : s.getAngle() - r.getAngle(), o.m_linearImpulse = a.zero(), o.m_angularImpulse = 0, o.m_maxForce = e.maxForce, o.m_maxTorque = e.maxTorque, o.m_correctionFactor = e.correctionFactor, o) : new t(e, r, s);
  }
  return t.prototype._serialize = function() {
    return { type: this.m_type, bodyA: this.m_bodyA, bodyB: this.m_bodyB, collideConnected: this.m_collideConnected, maxForce: this.m_maxForce, maxTorque: this.m_maxTorque, correctionFactor: this.m_correctionFactor, linearOffset: this.m_linearOffset, angularOffset: this.m_angularOffset };
  }, t._deserialize = function(e, r, s) {
    e = dt({}, e), e.bodyA = s(W, e.bodyA, r), e.bodyB = s(W, e.bodyB, r);
    var o = new t(e);
    return o;
  }, t.prototype._reset = function(e) {
    Number.isFinite(e.angularOffset) && (this.m_angularOffset = e.angularOffset), Number.isFinite(e.maxForce) && (this.m_maxForce = e.maxForce), Number.isFinite(e.maxTorque) && (this.m_maxTorque = e.maxTorque), Number.isFinite(e.correctionFactor) && (this.m_correctionFactor = e.correctionFactor), a.isValid(e.linearOffset) && this.m_linearOffset.set(e.linearOffset);
  }, t.prototype.setMaxForce = function(e) {
    this.m_maxForce = e;
  }, t.prototype.getMaxForce = function() {
    return this.m_maxForce;
  }, t.prototype.setMaxTorque = function(e) {
    this.m_maxTorque = e;
  }, t.prototype.getMaxTorque = function() {
    return this.m_maxTorque;
  }, t.prototype.setCorrectionFactor = function(e) {
    this.m_correctionFactor = e;
  }, t.prototype.getCorrectionFactor = function() {
    return this.m_correctionFactor;
  }, t.prototype.setLinearOffset = function(e) {
    (e.x != this.m_linearOffset.x || e.y != this.m_linearOffset.y) && (this.m_bodyA.setAwake(true), this.m_bodyB.setAwake(true), this.m_linearOffset.set(e));
  }, t.prototype.getLinearOffset = function() {
    return this.m_linearOffset;
  }, t.prototype.setAngularOffset = function(e) {
    e != this.m_angularOffset && (this.m_bodyA.setAwake(true), this.m_bodyB.setAwake(true), this.m_angularOffset = e);
  }, t.prototype.getAngularOffset = function() {
    return this.m_angularOffset;
  }, t.prototype.getAnchorA = function() {
    return this.m_bodyA.getPosition();
  }, t.prototype.getAnchorB = function() {
    return this.m_bodyB.getPosition();
  }, t.prototype.getReactionForce = function(e) {
    return a.mulNumVec2(e, this.m_linearImpulse);
  }, t.prototype.getReactionTorque = function(e) {
    return e * this.m_angularImpulse;
  }, t.prototype.initVelocityConstraints = function(e) {
    this.m_localCenterA = this.m_bodyA.m_sweep.localCenter, this.m_localCenterB = this.m_bodyB.m_sweep.localCenter, this.m_invMassA = this.m_bodyA.m_invMass, this.m_invMassB = this.m_bodyB.m_invMass, this.m_invIA = this.m_bodyA.m_invI, this.m_invIB = this.m_bodyB.m_invI;
    var r = this.m_bodyA.c_position.c, s = this.m_bodyA.c_position.a, o = this.m_bodyA.c_velocity.v, n = this.m_bodyA.c_velocity.w, m = this.m_bodyB.c_position.c, h = this.m_bodyB.c_position.a, p = this.m_bodyB.c_velocity.v, l = this.m_bodyB.c_velocity.w, u = B.neo(s), c = B.neo(h);
    this.m_rA = B.mulVec2(u, a.sub(this.m_linearOffset, this.m_localCenterA)), this.m_rB = B.mulVec2(c, a.neg(this.m_localCenterB));
    var _ = this.m_invMassA, y = this.m_invMassB, v = this.m_invIA, f = this.m_invIB, d = new Yt();
    if (d.ex.x = _ + y + v * this.m_rA.y * this.m_rA.y + f * this.m_rB.y * this.m_rB.y, d.ex.y = -v * this.m_rA.x * this.m_rA.y - f * this.m_rB.x * this.m_rB.y, d.ey.x = d.ex.y, d.ey.y = _ + y + v * this.m_rA.x * this.m_rA.x + f * this.m_rB.x * this.m_rB.x, this.m_linearMass = d.getInverse(), this.m_angularMass = v + f, this.m_angularMass > 0 && (this.m_angularMass = 1 / this.m_angularMass), this.m_linearError = a.zero(), this.m_linearError.addCombine(1, m, 1, this.m_rB), this.m_linearError.subCombine(1, r, 1, this.m_rA), this.m_angularError = h - s - this.m_angularOffset, e.warmStarting) {
      this.m_linearImpulse.mul(e.dtRatio), this.m_angularImpulse *= e.dtRatio;
      var A = a.neo(this.m_linearImpulse.x, this.m_linearImpulse.y);
      o.subMul(_, A), n -= v * (a.crossVec2Vec2(this.m_rA, A) + this.m_angularImpulse), p.addMul(y, A), l += f * (a.crossVec2Vec2(this.m_rB, A) + this.m_angularImpulse);
    } else this.m_linearImpulse.setZero(), this.m_angularImpulse = 0;
    this.m_bodyA.c_velocity.v = o, this.m_bodyA.c_velocity.w = n, this.m_bodyB.c_velocity.v = p, this.m_bodyB.c_velocity.w = l;
  }, t.prototype.solveVelocityConstraints = function(e) {
    var r = this.m_bodyA.c_velocity.v, s = this.m_bodyA.c_velocity.w, o = this.m_bodyB.c_velocity.v, n = this.m_bodyB.c_velocity.w, m = this.m_invMassA, h = this.m_invMassB, p = this.m_invIA, l = this.m_invIB, u = e.dt, c = e.inv_dt;
    {
      var _ = n - s + c * this.m_correctionFactor * this.m_angularError, y = -this.m_angularMass * _, v = this.m_angularImpulse, f = u * this.m_maxTorque;
      this.m_angularImpulse = pt(this.m_angularImpulse + y, -f, f), y = this.m_angularImpulse - v, s -= p * y, n += l * y;
    }
    {
      var _ = a.zero();
      _.addCombine(1, o, 1, a.crossNumVec2(n, this.m_rB)), _.subCombine(1, r, 1, a.crossNumVec2(s, this.m_rA)), _.addMul(c * this.m_correctionFactor, this.m_linearError);
      var y = a.neg(Yt.mulVec2(this.m_linearMass, _)), v = a.clone(this.m_linearImpulse);
      this.m_linearImpulse.add(y);
      var f = u * this.m_maxForce;
      this.m_linearImpulse.clamp(f), y = a.sub(this.m_linearImpulse, v), r.subMul(m, y), s -= p * a.crossVec2Vec2(this.m_rA, y), o.addMul(h, y), n += l * a.crossVec2Vec2(this.m_rB, y);
    }
    this.m_bodyA.c_velocity.v = r, this.m_bodyA.c_velocity.w = s, this.m_bodyB.c_velocity.v = o, this.m_bodyB.c_velocity.w = n;
  }, t.prototype.solvePositionConstraints = function(e) {
    return true;
  }, t.TYPE = "motor-joint", t;
})(yt);
var pn = Math.PI;
var vn = { maxForce: 0, frequencyHz: 5, dampingRatio: 0.7 };
var Ur = (function(i) {
  xt(t, i);
  function t(e, r, s, o) {
    var n = this;
    return n instanceof t ? (e = qt(e, vn), n = i.call(this, e, r, s) || this, r = n.m_bodyA, s = n.m_bodyB, n.m_type = t.TYPE, a.isValid(o) ? n.m_targetA = a.clone(o) : a.isValid(e.target) ? n.m_targetA = a.clone(e.target) : n.m_targetA = a.zero(), n.m_localAnchorB = ft.mulTVec2(s.getTransform(), n.m_targetA), n.m_maxForce = e.maxForce, n.m_impulse = a.zero(), n.m_frequencyHz = e.frequencyHz, n.m_dampingRatio = e.dampingRatio, n.m_beta = 0, n.m_gamma = 0, n.m_rB = a.zero(), n.m_localCenterB = a.zero(), n.m_invMassB = 0, n.m_invIB = 0, n.m_mass = new Yt(), n.m_C = a.zero(), n) : new t(e, r, s, o);
  }
  return t.prototype._serialize = function() {
    return { type: this.m_type, bodyA: this.m_bodyA, bodyB: this.m_bodyB, collideConnected: this.m_collideConnected, target: this.m_targetA, maxForce: this.m_maxForce, frequencyHz: this.m_frequencyHz, dampingRatio: this.m_dampingRatio, _localAnchorB: this.m_localAnchorB };
  }, t._deserialize = function(e, r, s) {
    e = dt({}, e), e.bodyA = s(W, e.bodyA, r), e.bodyB = s(W, e.bodyB, r), e.target = a.clone(e.target);
    var o = new t(e);
    return e._localAnchorB && (o.m_localAnchorB = e._localAnchorB), o;
  }, t.prototype._reset = function(e) {
    Number.isFinite(e.maxForce) && (this.m_maxForce = e.maxForce), Number.isFinite(e.frequencyHz) && (this.m_frequencyHz = e.frequencyHz), Number.isFinite(e.dampingRatio) && (this.m_dampingRatio = e.dampingRatio);
  }, t.prototype.setTarget = function(e) {
    a.areEqual(e, this.m_targetA) || (this.m_bodyB.setAwake(true), this.m_targetA.set(e));
  }, t.prototype.getTarget = function() {
    return this.m_targetA;
  }, t.prototype.setMaxForce = function(e) {
    this.m_maxForce = e;
  }, t.prototype.getMaxForce = function() {
    return this.m_maxForce;
  }, t.prototype.setFrequency = function(e) {
    this.m_frequencyHz = e;
  }, t.prototype.getFrequency = function() {
    return this.m_frequencyHz;
  }, t.prototype.setDampingRatio = function(e) {
    this.m_dampingRatio = e;
  }, t.prototype.getDampingRatio = function() {
    return this.m_dampingRatio;
  }, t.prototype.getAnchorA = function() {
    return a.clone(this.m_targetA);
  }, t.prototype.getAnchorB = function() {
    return this.m_bodyB.getWorldPoint(this.m_localAnchorB);
  }, t.prototype.getReactionForce = function(e) {
    return a.mulNumVec2(e, this.m_impulse);
  }, t.prototype.getReactionTorque = function(e) {
    return e * 0;
  }, t.prototype.shiftOrigin = function(e) {
    this.m_targetA.sub(e);
  }, t.prototype.initVelocityConstraints = function(e) {
    this.m_localCenterB = this.m_bodyB.m_sweep.localCenter, this.m_invMassB = this.m_bodyB.m_invMass, this.m_invIB = this.m_bodyB.m_invI;
    var r = this.m_bodyB.c_position, s = this.m_bodyB.c_velocity, o = r.c, n = r.a, m = s.v, h = s.w, p = B.neo(n), l = this.m_bodyB.getMass(), u = 2 * pn * this.m_frequencyHz, c = 2 * l * this.m_dampingRatio * u, _ = l * (u * u), y = e.dt;
    this.m_gamma = y * (c + y * _), this.m_gamma != 0 && (this.m_gamma = 1 / this.m_gamma), this.m_beta = y * _ * this.m_gamma, this.m_rB = B.mulVec2(p, a.sub(this.m_localAnchorB, this.m_localCenterB));
    var v = new Yt();
    v.ex.x = this.m_invMassB + this.m_invIB * this.m_rB.y * this.m_rB.y + this.m_gamma, v.ex.y = -this.m_invIB * this.m_rB.x * this.m_rB.y, v.ey.x = v.ex.y, v.ey.y = this.m_invMassB + this.m_invIB * this.m_rB.x * this.m_rB.x + this.m_gamma, this.m_mass = v.getInverse(), this.m_C.setVec2(o), this.m_C.addCombine(1, this.m_rB, -1, this.m_targetA), this.m_C.mul(this.m_beta), h *= 0.98, e.warmStarting ? (this.m_impulse.mul(e.dtRatio), m.addMul(this.m_invMassB, this.m_impulse), h += this.m_invIB * a.crossVec2Vec2(this.m_rB, this.m_impulse)) : this.m_impulse.setZero(), s.v.setVec2(m), s.w = h;
  }, t.prototype.solveVelocityConstraints = function(e) {
    var r = this.m_bodyB.c_velocity, s = a.clone(r.v), o = r.w, n = a.crossNumVec2(o, this.m_rB);
    n.add(s), n.addCombine(1, this.m_C, this.m_gamma, this.m_impulse), n.neg();
    var m = Yt.mulVec2(this.m_mass, n), h = a.clone(this.m_impulse);
    this.m_impulse.add(m);
    var p = e.dt * this.m_maxForce;
    this.m_impulse.clamp(p), m = a.sub(this.m_impulse, h), s.addMul(this.m_invMassB, m), o += this.m_invIB * a.crossVec2Vec2(this.m_rB, m), r.v.setVec2(s), r.w = o;
  }, t.prototype.solvePositionConstraints = function(e) {
    return true;
  }, t.TYPE = "mouse-joint", t;
})(yt);
var yn = Math.abs;
var fn = { collideConnected: true };
var Hr = (function(i) {
  xt(t, i);
  function t(e, r, s, o, n, m, h, p) {
    var l = this;
    return l instanceof t ? (e = qt(e, fn), l = i.call(this, e, r, s) || this, r = l.m_bodyA, s = l.m_bodyB, l.m_type = t.TYPE, l.m_groundAnchorA = a.clone(o || e.groundAnchorA || a.neo(-1, 1)), l.m_groundAnchorB = a.clone(n || e.groundAnchorB || a.neo(1, 1)), l.m_localAnchorA = a.clone(m ? r.getLocalPoint(m) : e.localAnchorA || a.neo(-1, 0)), l.m_localAnchorB = a.clone(h ? s.getLocalPoint(h) : e.localAnchorB || a.neo(1, 0)), l.m_lengthA = Number.isFinite(e.lengthA) ? e.lengthA : a.distance(m, o), l.m_lengthB = Number.isFinite(e.lengthB) ? e.lengthB : a.distance(h, n), l.m_ratio = Number.isFinite(p) ? p : e.ratio, l.m_constant = l.m_lengthA + l.m_ratio * l.m_lengthB, l.m_impulse = 0, l) : new t(e, r, s, o, n, m, h, p);
  }
  return t.prototype._serialize = function() {
    return { type: this.m_type, bodyA: this.m_bodyA, bodyB: this.m_bodyB, collideConnected: this.m_collideConnected, groundAnchorA: this.m_groundAnchorA, groundAnchorB: this.m_groundAnchorB, localAnchorA: this.m_localAnchorA, localAnchorB: this.m_localAnchorB, lengthA: this.m_lengthA, lengthB: this.m_lengthB, ratio: this.m_ratio };
  }, t._deserialize = function(e, r, s) {
    e = dt({}, e), e.bodyA = s(W, e.bodyA, r), e.bodyB = s(W, e.bodyB, r);
    var o = new t(e);
    return o;
  }, t.prototype._reset = function(e) {
    a.isValid(e.groundAnchorA) && this.m_groundAnchorA.set(e.groundAnchorA), a.isValid(e.groundAnchorB) && this.m_groundAnchorB.set(e.groundAnchorB), a.isValid(e.localAnchorA) ? this.m_localAnchorA.set(e.localAnchorA) : a.isValid(e.anchorA) && this.m_localAnchorA.set(this.m_bodyA.getLocalPoint(e.anchorA)), a.isValid(e.localAnchorB) ? this.m_localAnchorB.set(e.localAnchorB) : a.isValid(e.anchorB) && this.m_localAnchorB.set(this.m_bodyB.getLocalPoint(e.anchorB)), Number.isFinite(e.lengthA) && (this.m_lengthA = e.lengthA), Number.isFinite(e.lengthB) && (this.m_lengthB = e.lengthB), Number.isFinite(e.ratio) && (this.m_ratio = e.ratio);
  }, t.prototype.getGroundAnchorA = function() {
    return this.m_groundAnchorA;
  }, t.prototype.getGroundAnchorB = function() {
    return this.m_groundAnchorB;
  }, t.prototype.getLengthA = function() {
    return this.m_lengthA;
  }, t.prototype.getLengthB = function() {
    return this.m_lengthB;
  }, t.prototype.getRatio = function() {
    return this.m_ratio;
  }, t.prototype.getCurrentLengthA = function() {
    var e = this.m_bodyA.getWorldPoint(this.m_localAnchorA), r = this.m_groundAnchorA;
    return a.distance(e, r);
  }, t.prototype.getCurrentLengthB = function() {
    var e = this.m_bodyB.getWorldPoint(this.m_localAnchorB), r = this.m_groundAnchorB;
    return a.distance(e, r);
  }, t.prototype.shiftOrigin = function(e) {
    this.m_groundAnchorA.sub(e), this.m_groundAnchorB.sub(e);
  }, t.prototype.getAnchorA = function() {
    return this.m_bodyA.getWorldPoint(this.m_localAnchorA);
  }, t.prototype.getAnchorB = function() {
    return this.m_bodyB.getWorldPoint(this.m_localAnchorB);
  }, t.prototype.getReactionForce = function(e) {
    return a.mulNumVec2(this.m_impulse, this.m_uB).mul(e);
  }, t.prototype.getReactionTorque = function(e) {
    return 0;
  }, t.prototype.initVelocityConstraints = function(e) {
    this.m_localCenterA = this.m_bodyA.m_sweep.localCenter, this.m_localCenterB = this.m_bodyB.m_sweep.localCenter, this.m_invMassA = this.m_bodyA.m_invMass, this.m_invMassB = this.m_bodyB.m_invMass, this.m_invIA = this.m_bodyA.m_invI, this.m_invIB = this.m_bodyB.m_invI;
    var r = this.m_bodyA.c_position.c, s = this.m_bodyA.c_position.a, o = this.m_bodyA.c_velocity.v, n = this.m_bodyA.c_velocity.w, m = this.m_bodyB.c_position.c, h = this.m_bodyB.c_position.a, p = this.m_bodyB.c_velocity.v, l = this.m_bodyB.c_velocity.w, u = B.neo(s), c = B.neo(h);
    this.m_rA = B.mulVec2(u, a.sub(this.m_localAnchorA, this.m_localCenterA)), this.m_rB = B.mulVec2(c, a.sub(this.m_localAnchorB, this.m_localCenterB)), this.m_uA = a.sub(a.add(r, this.m_rA), this.m_groundAnchorA), this.m_uB = a.sub(a.add(m, this.m_rB), this.m_groundAnchorB);
    var _ = this.m_uA.length(), y = this.m_uB.length();
    _ > 10 * z.linearSlop ? this.m_uA.mul(1 / _) : this.m_uA.setZero(), y > 10 * z.linearSlop ? this.m_uB.mul(1 / y) : this.m_uB.setZero();
    var v = a.crossVec2Vec2(this.m_rA, this.m_uA), f = a.crossVec2Vec2(this.m_rB, this.m_uB), d = this.m_invMassA + this.m_invIA * v * v, A = this.m_invMassB + this.m_invIB * f * f;
    if (this.m_mass = d + this.m_ratio * this.m_ratio * A, this.m_mass > 0 && (this.m_mass = 1 / this.m_mass), e.warmStarting) {
      this.m_impulse *= e.dtRatio;
      var b = a.mulNumVec2(-this.m_impulse, this.m_uA), w = a.mulNumVec2(-this.m_ratio * this.m_impulse, this.m_uB);
      o.addMul(this.m_invMassA, b), n += this.m_invIA * a.crossVec2Vec2(this.m_rA, b), p.addMul(this.m_invMassB, w), l += this.m_invIB * a.crossVec2Vec2(this.m_rB, w);
    } else this.m_impulse = 0;
    this.m_bodyA.c_velocity.v = o, this.m_bodyA.c_velocity.w = n, this.m_bodyB.c_velocity.v = p, this.m_bodyB.c_velocity.w = l;
  }, t.prototype.solveVelocityConstraints = function(e) {
    var r = this.m_bodyA.c_velocity.v, s = this.m_bodyA.c_velocity.w, o = this.m_bodyB.c_velocity.v, n = this.m_bodyB.c_velocity.w, m = a.add(r, a.crossNumVec2(s, this.m_rA)), h = a.add(o, a.crossNumVec2(n, this.m_rB)), p = -a.dot(this.m_uA, m) - this.m_ratio * a.dot(this.m_uB, h), l = -this.m_mass * p;
    this.m_impulse += l;
    var u = a.mulNumVec2(-l, this.m_uA), c = a.mulNumVec2(-this.m_ratio * l, this.m_uB);
    r.addMul(this.m_invMassA, u), s += this.m_invIA * a.crossVec2Vec2(this.m_rA, u), o.addMul(this.m_invMassB, c), n += this.m_invIB * a.crossVec2Vec2(this.m_rB, c), this.m_bodyA.c_velocity.v = r, this.m_bodyA.c_velocity.w = s, this.m_bodyB.c_velocity.v = o, this.m_bodyB.c_velocity.w = n;
  }, t.prototype.solvePositionConstraints = function(e) {
    var r = this.m_bodyA.c_position.c, s = this.m_bodyA.c_position.a, o = this.m_bodyB.c_position.c, n = this.m_bodyB.c_position.a, m = B.neo(s), h = B.neo(n), p = B.mulVec2(m, a.sub(this.m_localAnchorA, this.m_localCenterA)), l = B.mulVec2(h, a.sub(this.m_localAnchorB, this.m_localCenterB)), u = a.sub(a.add(r, this.m_rA), this.m_groundAnchorA), c = a.sub(a.add(o, this.m_rB), this.m_groundAnchorB), _ = u.length(), y = c.length();
    _ > 10 * z.linearSlop ? u.mul(1 / _) : u.setZero(), y > 10 * z.linearSlop ? c.mul(1 / y) : c.setZero();
    var v = a.crossVec2Vec2(p, u), f = a.crossVec2Vec2(l, c), d = this.m_invMassA + this.m_invIA * v * v, A = this.m_invMassB + this.m_invIB * f * f, b = d + this.m_ratio * this.m_ratio * A;
    b > 0 && (b = 1 / b);
    var w = this.m_constant - _ - this.m_ratio * y, V = yn(w), I = -b * w, M = a.mulNumVec2(-I, u), P = a.mulNumVec2(-this.m_ratio * I, c);
    return r.addMul(this.m_invMassA, M), s += this.m_invIA * a.crossVec2Vec2(p, M), o.addMul(this.m_invMassB, P), n += this.m_invIB * a.crossVec2Vec2(l, P), this.m_bodyA.c_position.c = r, this.m_bodyA.c_position.a = s, this.m_bodyB.c_position.c = o, this.m_bodyB.c_position.a = n, V < z.linearSlop;
  }, t.TYPE = "pulley-joint", t;
})(yt);
var dn = Math.min;
var Ii;
(function(i) {
  i[i.inactiveLimit = 0] = "inactiveLimit", i[i.atLowerLimit = 1] = "atLowerLimit", i[i.atUpperLimit = 2] = "atUpperLimit", i[i.equalLimits = 3] = "equalLimits";
})(Ii || (Ii = {}));
var xn = { maxLength: 0 };
var Zr = (function(i) {
  xt(t, i);
  function t(e, r, s, o) {
    var n = this;
    return n instanceof t ? (e = qt(e, xn), n = i.call(this, e, r, s) || this, r = n.m_bodyA, s = n.m_bodyB, n.m_type = t.TYPE, n.m_localAnchorA = a.clone(o ? r.getLocalPoint(o) : e.localAnchorA || a.neo(-1, 0)), n.m_localAnchorB = a.clone(o ? s.getLocalPoint(o) : e.localAnchorB || a.neo(1, 0)), n.m_maxLength = e.maxLength, n.m_mass = 0, n.m_impulse = 0, n.m_length = 0, n.m_state = Ii.inactiveLimit, n) : new t(e, r, s, o);
  }
  return t.prototype._serialize = function() {
    return { type: this.m_type, bodyA: this.m_bodyA, bodyB: this.m_bodyB, collideConnected: this.m_collideConnected, localAnchorA: this.m_localAnchorA, localAnchorB: this.m_localAnchorB, maxLength: this.m_maxLength };
  }, t._deserialize = function(e, r, s) {
    e = dt({}, e), e.bodyA = s(W, e.bodyA, r), e.bodyB = s(W, e.bodyB, r);
    var o = new t(e);
    return o;
  }, t.prototype._reset = function(e) {
    Number.isFinite(e.maxLength) && (this.m_maxLength = e.maxLength);
  }, t.prototype.getLocalAnchorA = function() {
    return this.m_localAnchorA;
  }, t.prototype.getLocalAnchorB = function() {
    return this.m_localAnchorB;
  }, t.prototype.setMaxLength = function(e) {
    this.m_maxLength = e;
  }, t.prototype.getMaxLength = function() {
    return this.m_maxLength;
  }, t.prototype.getLimitState = function() {
    return this.m_state;
  }, t.prototype.getAnchorA = function() {
    return this.m_bodyA.getWorldPoint(this.m_localAnchorA);
  }, t.prototype.getAnchorB = function() {
    return this.m_bodyB.getWorldPoint(this.m_localAnchorB);
  }, t.prototype.getReactionForce = function(e) {
    return a.mulNumVec2(this.m_impulse, this.m_u).mul(e);
  }, t.prototype.getReactionTorque = function(e) {
    return 0;
  }, t.prototype.initVelocityConstraints = function(e) {
    this.m_localCenterA = this.m_bodyA.m_sweep.localCenter, this.m_localCenterB = this.m_bodyB.m_sweep.localCenter, this.m_invMassA = this.m_bodyA.m_invMass, this.m_invMassB = this.m_bodyB.m_invMass, this.m_invIA = this.m_bodyA.m_invI, this.m_invIB = this.m_bodyB.m_invI;
    var r = this.m_bodyA.c_position.c, s = this.m_bodyA.c_position.a, o = this.m_bodyA.c_velocity.v, n = this.m_bodyA.c_velocity.w, m = this.m_bodyB.c_position.c, h = this.m_bodyB.c_position.a, p = this.m_bodyB.c_velocity.v, l = this.m_bodyB.c_velocity.w, u = B.neo(s), c = B.neo(h);
    this.m_rA = B.mulSub(u, this.m_localAnchorA, this.m_localCenterA), this.m_rB = B.mulSub(c, this.m_localAnchorB, this.m_localCenterB), this.m_u = a.zero(), this.m_u.addCombine(1, m, 1, this.m_rB), this.m_u.subCombine(1, r, 1, this.m_rA), this.m_length = this.m_u.length();
    var _ = this.m_length - this.m_maxLength;
    if (_ > 0 ? this.m_state = Ii.atUpperLimit : this.m_state = Ii.inactiveLimit, this.m_length > z.linearSlop) this.m_u.mul(1 / this.m_length);
    else {
      this.m_u.setZero(), this.m_mass = 0, this.m_impulse = 0;
      return;
    }
    var y = a.crossVec2Vec2(this.m_rA, this.m_u), v = a.crossVec2Vec2(this.m_rB, this.m_u), f = this.m_invMassA + this.m_invIA * y * y + this.m_invMassB + this.m_invIB * v * v;
    if (this.m_mass = f != 0 ? 1 / f : 0, e.warmStarting) {
      this.m_impulse *= e.dtRatio;
      var d = a.mulNumVec2(this.m_impulse, this.m_u);
      o.subMul(this.m_invMassA, d), n -= this.m_invIA * a.crossVec2Vec2(this.m_rA, d), p.addMul(this.m_invMassB, d), l += this.m_invIB * a.crossVec2Vec2(this.m_rB, d);
    } else this.m_impulse = 0;
    this.m_bodyA.c_velocity.v.setVec2(o), this.m_bodyA.c_velocity.w = n, this.m_bodyB.c_velocity.v.setVec2(p), this.m_bodyB.c_velocity.w = l;
  }, t.prototype.solveVelocityConstraints = function(e) {
    var r = this.m_bodyA.c_velocity.v, s = this.m_bodyA.c_velocity.w, o = this.m_bodyB.c_velocity.v, n = this.m_bodyB.c_velocity.w, m = a.addCrossNumVec2(r, s, this.m_rA), h = a.addCrossNumVec2(o, n, this.m_rB), p = this.m_length - this.m_maxLength, l = a.dot(this.m_u, a.sub(h, m));
    p < 0 && (l += e.inv_dt * p);
    var u = -this.m_mass * l, c = this.m_impulse;
    this.m_impulse = dn(0, this.m_impulse + u), u = this.m_impulse - c;
    var _ = a.mulNumVec2(u, this.m_u);
    r.subMul(this.m_invMassA, _), s -= this.m_invIA * a.crossVec2Vec2(this.m_rA, _), o.addMul(this.m_invMassB, _), n += this.m_invIB * a.crossVec2Vec2(this.m_rB, _), this.m_bodyA.c_velocity.v = r, this.m_bodyA.c_velocity.w = s, this.m_bodyB.c_velocity.v = o, this.m_bodyB.c_velocity.w = n;
  }, t.prototype.solvePositionConstraints = function(e) {
    var r = this.m_bodyA.c_position.c, s = this.m_bodyA.c_position.a, o = this.m_bodyB.c_position.c, n = this.m_bodyB.c_position.a, m = B.neo(s), h = B.neo(n), p = B.mulSub(m, this.m_localAnchorA, this.m_localCenterA), l = B.mulSub(h, this.m_localAnchorB, this.m_localCenterB), u = a.zero();
    u.addCombine(1, o, 1, l), u.subCombine(1, r, 1, p);
    var c = u.normalize(), _ = c - this.m_maxLength;
    _ = pt(_, 0, z.maxLinearCorrection);
    var y = -this.m_mass * _, v = a.mulNumVec2(y, u);
    return r.subMul(this.m_invMassA, v), s -= this.m_invIA * a.crossVec2Vec2(p, v), o.addMul(this.m_invMassB, v), n += this.m_invIB * a.crossVec2Vec2(l, v), this.m_bodyA.c_position.c.setVec2(r), this.m_bodyA.c_position.a = s, this.m_bodyB.c_position.c.setVec2(o), this.m_bodyB.c_position.a = n, c - this.m_maxLength < z.linearSlop;
  }, t.TYPE = "rope-joint", t;
})(yt);
var An = Math.abs;
var gn = Math.PI;
var Bn = { frequencyHz: 0, dampingRatio: 0 };
var Xr = (function(i) {
  xt(t, i);
  function t(e, r, s, o) {
    var n = this;
    return n instanceof t ? (e = qt(e, Bn), n = i.call(this, e, r, s) || this, r = n.m_bodyA, s = n.m_bodyB, n.m_type = t.TYPE, n.m_localAnchorA = a.clone(o ? r.getLocalPoint(o) : e.localAnchorA || a.zero()), n.m_localAnchorB = a.clone(o ? s.getLocalPoint(o) : e.localAnchorB || a.zero()), n.m_referenceAngle = Number.isFinite(e.referenceAngle) ? e.referenceAngle : s.getAngle() - r.getAngle(), n.m_frequencyHz = e.frequencyHz, n.m_dampingRatio = e.dampingRatio, n.m_impulse = new $(), n.m_bias = 0, n.m_gamma = 0, n.m_mass = new fe(), n) : new t(e, r, s, o);
  }
  return t.prototype._serialize = function() {
    return { type: this.m_type, bodyA: this.m_bodyA, bodyB: this.m_bodyB, collideConnected: this.m_collideConnected, frequencyHz: this.m_frequencyHz, dampingRatio: this.m_dampingRatio, localAnchorA: this.m_localAnchorA, localAnchorB: this.m_localAnchorB, referenceAngle: this.m_referenceAngle };
  }, t._deserialize = function(e, r, s) {
    e = dt({}, e), e.bodyA = s(W, e.bodyA, r), e.bodyB = s(W, e.bodyB, r);
    var o = new t(e);
    return o;
  }, t.prototype._reset = function(e) {
    e.anchorA ? this.m_localAnchorA.setVec2(this.m_bodyA.getLocalPoint(e.anchorA)) : e.localAnchorA && this.m_localAnchorA.setVec2(e.localAnchorA), e.anchorB ? this.m_localAnchorB.setVec2(this.m_bodyB.getLocalPoint(e.anchorB)) : e.localAnchorB && this.m_localAnchorB.setVec2(e.localAnchorB), Number.isFinite(e.frequencyHz) && (this.m_frequencyHz = e.frequencyHz), Number.isFinite(e.dampingRatio) && (this.m_dampingRatio = e.dampingRatio);
  }, t.prototype.getLocalAnchorA = function() {
    return this.m_localAnchorA;
  }, t.prototype.getLocalAnchorB = function() {
    return this.m_localAnchorB;
  }, t.prototype.getReferenceAngle = function() {
    return this.m_referenceAngle;
  }, t.prototype.setFrequency = function(e) {
    this.m_frequencyHz = e;
  }, t.prototype.getFrequency = function() {
    return this.m_frequencyHz;
  }, t.prototype.setDampingRatio = function(e) {
    this.m_dampingRatio = e;
  }, t.prototype.getDampingRatio = function() {
    return this.m_dampingRatio;
  }, t.prototype.getAnchorA = function() {
    return this.m_bodyA.getWorldPoint(this.m_localAnchorA);
  }, t.prototype.getAnchorB = function() {
    return this.m_bodyB.getWorldPoint(this.m_localAnchorB);
  }, t.prototype.getReactionForce = function(e) {
    return a.neo(this.m_impulse.x, this.m_impulse.y).mul(e);
  }, t.prototype.getReactionTorque = function(e) {
    return e * this.m_impulse.z;
  }, t.prototype.initVelocityConstraints = function(e) {
    this.m_localCenterA = this.m_bodyA.m_sweep.localCenter, this.m_localCenterB = this.m_bodyB.m_sweep.localCenter, this.m_invMassA = this.m_bodyA.m_invMass, this.m_invMassB = this.m_bodyB.m_invMass, this.m_invIA = this.m_bodyA.m_invI, this.m_invIB = this.m_bodyB.m_invI;
    var r = this.m_bodyA.c_position.a, s = this.m_bodyA.c_velocity.v, o = this.m_bodyA.c_velocity.w, n = this.m_bodyB.c_position.a, m = this.m_bodyB.c_velocity.v, h = this.m_bodyB.c_velocity.w, p = B.neo(r), l = B.neo(n);
    this.m_rA = B.mulVec2(p, a.sub(this.m_localAnchorA, this.m_localCenterA)), this.m_rB = B.mulVec2(l, a.sub(this.m_localAnchorB, this.m_localCenterB));
    var u = this.m_invMassA, c = this.m_invMassB, _ = this.m_invIA, y = this.m_invIB, v = new fe();
    if (v.ex.x = u + c + this.m_rA.y * this.m_rA.y * _ + this.m_rB.y * this.m_rB.y * y, v.ey.x = -this.m_rA.y * this.m_rA.x * _ - this.m_rB.y * this.m_rB.x * y, v.ez.x = -this.m_rA.y * _ - this.m_rB.y * y, v.ex.y = v.ey.x, v.ey.y = u + c + this.m_rA.x * this.m_rA.x * _ + this.m_rB.x * this.m_rB.x * y, v.ez.y = this.m_rA.x * _ + this.m_rB.x * y, v.ex.z = v.ez.x, v.ey.z = v.ez.y, v.ez.z = _ + y, this.m_frequencyHz > 0) {
      v.getInverse22(this.m_mass);
      var f = _ + y, d = f > 0 ? 1 / f : 0, A = n - r - this.m_referenceAngle, b = 2 * gn * this.m_frequencyHz, w = 2 * d * this.m_dampingRatio * b, V = d * b * b, I = e.dt;
      this.m_gamma = I * (w + I * V), this.m_gamma = this.m_gamma != 0 ? 1 / this.m_gamma : 0, this.m_bias = A * I * V * this.m_gamma, f += this.m_gamma, this.m_mass.ez.z = f != 0 ? 1 / f : 0;
    } else v.ez.z == 0 ? (v.getInverse22(this.m_mass), this.m_gamma = 0, this.m_bias = 0) : (v.getSymInverse33(this.m_mass), this.m_gamma = 0, this.m_bias = 0);
    if (e.warmStarting) {
      this.m_impulse.mul(e.dtRatio);
      var M = a.neo(this.m_impulse.x, this.m_impulse.y);
      s.subMul(u, M), o -= _ * (a.crossVec2Vec2(this.m_rA, M) + this.m_impulse.z), m.addMul(c, M), h += y * (a.crossVec2Vec2(this.m_rB, M) + this.m_impulse.z);
    } else this.m_impulse.setZero();
    this.m_bodyA.c_velocity.v = s, this.m_bodyA.c_velocity.w = o, this.m_bodyB.c_velocity.v = m, this.m_bodyB.c_velocity.w = h;
  }, t.prototype.solveVelocityConstraints = function(e) {
    var r = this.m_bodyA.c_velocity.v, s = this.m_bodyA.c_velocity.w, o = this.m_bodyB.c_velocity.v, n = this.m_bodyB.c_velocity.w, m = this.m_invMassA, h = this.m_invMassB, p = this.m_invIA, l = this.m_invIB;
    if (this.m_frequencyHz > 0) {
      var u = n - s, c = -this.m_mass.ez.z * (u + this.m_bias + this.m_gamma * this.m_impulse.z);
      this.m_impulse.z += c, s -= p * c, n += l * c;
      var _ = a.zero();
      _.addCombine(1, o, 1, a.crossNumVec2(n, this.m_rB)), _.subCombine(1, r, 1, a.crossNumVec2(s, this.m_rA));
      var y = a.neg(fe.mulVec2(this.m_mass, _));
      this.m_impulse.x += y.x, this.m_impulse.y += y.y;
      var v = a.clone(y);
      r.subMul(m, v), s -= p * a.crossVec2Vec2(this.m_rA, v), o.addMul(h, v), n += l * a.crossVec2Vec2(this.m_rB, v);
    } else {
      var _ = a.zero();
      _.addCombine(1, o, 1, a.crossNumVec2(n, this.m_rB)), _.subCombine(1, r, 1, a.crossNumVec2(s, this.m_rA));
      var u = n - s, f = new $(_.x, _.y, u), d = $.neg(fe.mulVec3(this.m_mass, f));
      this.m_impulse.add(d);
      var v = a.neo(d.x, d.y);
      r.subMul(m, v), s -= p * (a.crossVec2Vec2(this.m_rA, v) + d.z), o.addMul(h, v), n += l * (a.crossVec2Vec2(this.m_rB, v) + d.z);
    }
    this.m_bodyA.c_velocity.v = r, this.m_bodyA.c_velocity.w = s, this.m_bodyB.c_velocity.v = o, this.m_bodyB.c_velocity.w = n;
  }, t.prototype.solvePositionConstraints = function(e) {
    var r = this.m_bodyA.c_position.c, s = this.m_bodyA.c_position.a, o = this.m_bodyB.c_position.c, n = this.m_bodyB.c_position.a, m = B.neo(s), h = B.neo(n), p = this.m_invMassA, l = this.m_invMassB, u = this.m_invIA, c = this.m_invIB, _ = B.mulVec2(m, a.sub(this.m_localAnchorA, this.m_localCenterA)), y = B.mulVec2(h, a.sub(this.m_localAnchorB, this.m_localCenterB)), v, f, d = new fe();
    if (d.ex.x = p + l + _.y * _.y * u + y.y * y.y * c, d.ey.x = -_.y * _.x * u - y.y * y.x * c, d.ez.x = -_.y * u - y.y * c, d.ex.y = d.ey.x, d.ey.y = p + l + _.x * _.x * u + y.x * y.x * c, d.ez.y = _.x * u + y.x * c, d.ex.z = d.ez.x, d.ey.z = d.ez.y, d.ez.z = u + c, this.m_frequencyHz > 0) {
      var A = a.zero();
      A.addCombine(1, o, 1, y), A.subCombine(1, r, 1, _), v = A.length(), f = 0;
      var b = a.neg(d.solve22(A));
      r.subMul(p, b), s -= u * a.crossVec2Vec2(_, b), o.addMul(l, b), n += c * a.crossVec2Vec2(y, b);
    } else {
      var A = a.zero();
      A.addCombine(1, o, 1, y), A.subCombine(1, r, 1, _);
      var w = n - s - this.m_referenceAngle;
      v = A.length(), f = An(w);
      var V = new $(A.x, A.y, w), I = new $();
      if (d.ez.z > 0) I = $.neg(d.solve33(V));
      else {
        var M = a.neg(d.solve22(A));
        I.set(M.x, M.y, 0);
      }
      var b = a.neo(I.x, I.y);
      r.subMul(p, b), s -= u * (a.crossVec2Vec2(_, b) + I.z), o.addMul(l, b), n += c * (a.crossVec2Vec2(y, b) + I.z);
    }
    return this.m_bodyA.c_position.c = r, this.m_bodyA.c_position.a = s, this.m_bodyB.c_position.c = o, this.m_bodyB.c_position.a = n, v <= z.linearSlop && f <= z.angularSlop;
  }, t.TYPE = "weld-joint", t;
})(yt);
var bn = Math.abs;
var wn = Math.PI;
var Vn = { enableMotor: false, maxMotorTorque: 0, motorSpeed: 0, frequencyHz: 2, dampingRatio: 0.7 };
var Kr = (function(i) {
  xt(t, i);
  function t(e, r, s, o, n) {
    var m = this;
    return m instanceof t ? (e = qt(e, Vn), m = i.call(this, e, r, s) || this, r = m.m_bodyA, s = m.m_bodyB, m.m_ax = a.zero(), m.m_ay = a.zero(), m.m_type = t.TYPE, m.m_localAnchorA = a.clone(o ? r.getLocalPoint(o) : e.localAnchorA || a.zero()), m.m_localAnchorB = a.clone(o ? s.getLocalPoint(o) : e.localAnchorB || a.zero()), a.isValid(n) ? m.m_localXAxisA = r.getLocalVector(n) : a.isValid(e.localAxisA) ? m.m_localXAxisA = a.clone(e.localAxisA) : a.isValid(e.localAxis) ? m.m_localXAxisA = a.clone(e.localAxis) : m.m_localXAxisA = a.neo(1, 0), m.m_localYAxisA = a.crossNumVec2(1, m.m_localXAxisA), m.m_mass = 0, m.m_impulse = 0, m.m_motorMass = 0, m.m_motorImpulse = 0, m.m_springMass = 0, m.m_springImpulse = 0, m.m_maxMotorTorque = e.maxMotorTorque, m.m_motorSpeed = e.motorSpeed, m.m_enableMotor = e.enableMotor, m.m_frequencyHz = e.frequencyHz, m.m_dampingRatio = e.dampingRatio, m.m_bias = 0, m.m_gamma = 0, m) : new t(e, r, s, o, n);
  }
  return t.prototype._serialize = function() {
    return { type: this.m_type, bodyA: this.m_bodyA, bodyB: this.m_bodyB, collideConnected: this.m_collideConnected, enableMotor: this.m_enableMotor, maxMotorTorque: this.m_maxMotorTorque, motorSpeed: this.m_motorSpeed, frequencyHz: this.m_frequencyHz, dampingRatio: this.m_dampingRatio, localAnchorA: this.m_localAnchorA, localAnchorB: this.m_localAnchorB, localAxisA: this.m_localXAxisA };
  }, t._deserialize = function(e, r, s) {
    e = dt({}, e), e.bodyA = s(W, e.bodyA, r), e.bodyB = s(W, e.bodyB, r);
    var o = new t(e);
    return o;
  }, t.prototype._reset = function(e) {
    e.anchorA ? this.m_localAnchorA.setVec2(this.m_bodyA.getLocalPoint(e.anchorA)) : e.localAnchorA && this.m_localAnchorA.setVec2(e.localAnchorA), e.anchorB ? this.m_localAnchorB.setVec2(this.m_bodyB.getLocalPoint(e.anchorB)) : e.localAnchorB && this.m_localAnchorB.setVec2(e.localAnchorB), e.localAxisA && (this.m_localXAxisA.setVec2(e.localAxisA), this.m_localYAxisA.setVec2(a.crossNumVec2(1, e.localAxisA))), e.enableMotor !== void 0 && (this.m_enableMotor = e.enableMotor), Number.isFinite(e.maxMotorTorque) && (this.m_maxMotorTorque = e.maxMotorTorque), Number.isFinite(e.motorSpeed) && (this.m_motorSpeed = e.motorSpeed), Number.isFinite(e.frequencyHz) && (this.m_frequencyHz = e.frequencyHz), Number.isFinite(e.dampingRatio) && (this.m_dampingRatio = e.dampingRatio);
  }, t.prototype.getLocalAnchorA = function() {
    return this.m_localAnchorA;
  }, t.prototype.getLocalAnchorB = function() {
    return this.m_localAnchorB;
  }, t.prototype.getLocalAxisA = function() {
    return this.m_localXAxisA;
  }, t.prototype.getJointTranslation = function() {
    var e = this.m_bodyA, r = this.m_bodyB, s = e.getWorldPoint(this.m_localAnchorA), o = r.getWorldPoint(this.m_localAnchorB), n = a.sub(o, s), m = e.getWorldVector(this.m_localXAxisA), h = a.dot(n, m);
    return h;
  }, t.prototype.getJointSpeed = function() {
    var e = this.m_bodyA.m_angularVelocity, r = this.m_bodyB.m_angularVelocity;
    return r - e;
  }, t.prototype.isMotorEnabled = function() {
    return this.m_enableMotor;
  }, t.prototype.enableMotor = function(e) {
    e != this.m_enableMotor && (this.m_bodyA.setAwake(true), this.m_bodyB.setAwake(true), this.m_enableMotor = e);
  }, t.prototype.setMotorSpeed = function(e) {
    e != this.m_motorSpeed && (this.m_bodyA.setAwake(true), this.m_bodyB.setAwake(true), this.m_motorSpeed = e);
  }, t.prototype.getMotorSpeed = function() {
    return this.m_motorSpeed;
  }, t.prototype.setMaxMotorTorque = function(e) {
    e != this.m_maxMotorTorque && (this.m_bodyA.setAwake(true), this.m_bodyB.setAwake(true), this.m_maxMotorTorque = e);
  }, t.prototype.getMaxMotorTorque = function() {
    return this.m_maxMotorTorque;
  }, t.prototype.getMotorTorque = function(e) {
    return e * this.m_motorImpulse;
  }, t.prototype.setSpringFrequencyHz = function(e) {
    this.m_frequencyHz = e;
  }, t.prototype.getSpringFrequencyHz = function() {
    return this.m_frequencyHz;
  }, t.prototype.setSpringDampingRatio = function(e) {
    this.m_dampingRatio = e;
  }, t.prototype.getSpringDampingRatio = function() {
    return this.m_dampingRatio;
  }, t.prototype.getAnchorA = function() {
    return this.m_bodyA.getWorldPoint(this.m_localAnchorA);
  }, t.prototype.getAnchorB = function() {
    return this.m_bodyB.getWorldPoint(this.m_localAnchorB);
  }, t.prototype.getReactionForce = function(e) {
    return a.combine(this.m_impulse, this.m_ay, this.m_springImpulse, this.m_ax).mul(e);
  }, t.prototype.getReactionTorque = function(e) {
    return e * this.m_motorImpulse;
  }, t.prototype.initVelocityConstraints = function(e) {
    this.m_localCenterA = this.m_bodyA.m_sweep.localCenter, this.m_localCenterB = this.m_bodyB.m_sweep.localCenter, this.m_invMassA = this.m_bodyA.m_invMass, this.m_invMassB = this.m_bodyB.m_invMass, this.m_invIA = this.m_bodyA.m_invI, this.m_invIB = this.m_bodyB.m_invI;
    var r = this.m_invMassA, s = this.m_invMassB, o = this.m_invIA, n = this.m_invIB, m = this.m_bodyA.c_position.c, h = this.m_bodyA.c_position.a, p = this.m_bodyA.c_velocity.v, l = this.m_bodyA.c_velocity.w, u = this.m_bodyB.c_position.c, c = this.m_bodyB.c_position.a, _ = this.m_bodyB.c_velocity.v, y = this.m_bodyB.c_velocity.w, v = B.neo(h), f = B.neo(c), d = B.mulVec2(v, a.sub(this.m_localAnchorA, this.m_localCenterA)), A = B.mulVec2(f, a.sub(this.m_localAnchorB, this.m_localCenterB)), b = a.zero();
    if (b.addCombine(1, u, 1, A), b.subCombine(1, m, 1, d), this.m_ay = B.mulVec2(v, this.m_localYAxisA), this.m_sAy = a.crossVec2Vec2(a.add(b, d), this.m_ay), this.m_sBy = a.crossVec2Vec2(A, this.m_ay), this.m_mass = r + s + o * this.m_sAy * this.m_sAy + n * this.m_sBy * this.m_sBy, this.m_mass > 0 && (this.m_mass = 1 / this.m_mass), this.m_springMass = 0, this.m_bias = 0, this.m_gamma = 0, this.m_frequencyHz > 0) {
      this.m_ax = B.mulVec2(v, this.m_localXAxisA), this.m_sAx = a.crossVec2Vec2(a.add(b, d), this.m_ax), this.m_sBx = a.crossVec2Vec2(A, this.m_ax);
      var w = r + s + o * this.m_sAx * this.m_sAx + n * this.m_sBx * this.m_sBx;
      if (w > 0) {
        this.m_springMass = 1 / w;
        var V = a.dot(b, this.m_ax), I = 2 * wn * this.m_frequencyHz, M = 2 * this.m_springMass * this.m_dampingRatio * I, P = this.m_springMass * I * I, k = e.dt;
        this.m_gamma = k * (M + k * P), this.m_gamma > 0 && (this.m_gamma = 1 / this.m_gamma), this.m_bias = V * k * P * this.m_gamma, this.m_springMass = w + this.m_gamma, this.m_springMass > 0 && (this.m_springMass = 1 / this.m_springMass);
      }
    } else this.m_springImpulse = 0;
    if (this.m_enableMotor ? (this.m_motorMass = o + n, this.m_motorMass > 0 && (this.m_motorMass = 1 / this.m_motorMass)) : (this.m_motorMass = 0, this.m_motorImpulse = 0), e.warmStarting) {
      this.m_impulse *= e.dtRatio, this.m_springImpulse *= e.dtRatio, this.m_motorImpulse *= e.dtRatio;
      var F = a.combine(this.m_impulse, this.m_ay, this.m_springImpulse, this.m_ax), O = this.m_impulse * this.m_sAy + this.m_springImpulse * this.m_sAx + this.m_motorImpulse, Y = this.m_impulse * this.m_sBy + this.m_springImpulse * this.m_sBx + this.m_motorImpulse;
      p.subMul(this.m_invMassA, F), l -= this.m_invIA * O, _.addMul(this.m_invMassB, F), y += this.m_invIB * Y;
    } else this.m_impulse = 0, this.m_springImpulse = 0, this.m_motorImpulse = 0;
    this.m_bodyA.c_velocity.v.setVec2(p), this.m_bodyA.c_velocity.w = l, this.m_bodyB.c_velocity.v.setVec2(_), this.m_bodyB.c_velocity.w = y;
  }, t.prototype.solveVelocityConstraints = function(e) {
    var r = this.m_invMassA, s = this.m_invMassB, o = this.m_invIA, n = this.m_invIB, m = this.m_bodyA.c_velocity.v, h = this.m_bodyA.c_velocity.w, p = this.m_bodyB.c_velocity.v, l = this.m_bodyB.c_velocity.w;
    {
      var u = a.dot(this.m_ax, p) - a.dot(this.m_ax, m) + this.m_sBx * l - this.m_sAx * h, c = -this.m_springMass * (u + this.m_bias + this.m_gamma * this.m_springImpulse);
      this.m_springImpulse += c;
      var _ = a.mulNumVec2(c, this.m_ax), y = c * this.m_sAx, v = c * this.m_sBx;
      m.subMul(r, _), h -= o * y, p.addMul(s, _), l += n * v;
    }
    {
      var u = l - h - this.m_motorSpeed, c = -this.m_motorMass * u, f = this.m_motorImpulse, d = e.dt * this.m_maxMotorTorque;
      this.m_motorImpulse = pt(this.m_motorImpulse + c, -d, d), c = this.m_motorImpulse - f, h -= o * c, l += n * c;
    }
    {
      var u = a.dot(this.m_ay, p) - a.dot(this.m_ay, m) + this.m_sBy * l - this.m_sAy * h, c = -this.m_mass * u;
      this.m_impulse += c;
      var _ = a.mulNumVec2(c, this.m_ay), y = c * this.m_sAy, v = c * this.m_sBy;
      m.subMul(r, _), h -= o * y, p.addMul(s, _), l += n * v;
    }
    this.m_bodyA.c_velocity.v.setVec2(m), this.m_bodyA.c_velocity.w = h, this.m_bodyB.c_velocity.v.setVec2(p), this.m_bodyB.c_velocity.w = l;
  }, t.prototype.solvePositionConstraints = function(e) {
    var r = this.m_bodyA.c_position.c, s = this.m_bodyA.c_position.a, o = this.m_bodyB.c_position.c, n = this.m_bodyB.c_position.a, m = B.neo(s), h = B.neo(n), p = B.mulVec2(m, a.sub(this.m_localAnchorA, this.m_localCenterA)), l = B.mulVec2(h, a.sub(this.m_localAnchorB, this.m_localCenterB)), u = a.zero();
    u.addCombine(1, o, 1, l), u.subCombine(1, r, 1, p);
    var c = B.mulVec2(m, this.m_localYAxisA), _ = a.crossVec2Vec2(a.add(u, p), c), y = a.crossVec2Vec2(l, c), v = a.dot(u, c), f = this.m_invMassA + this.m_invMassB + this.m_invIA * this.m_sAy * this.m_sAy + this.m_invIB * this.m_sBy * this.m_sBy, d = f != 0 ? -v / f : 0, A = a.mulNumVec2(d, c), b = d * _, w = d * y;
    return r.subMul(this.m_invMassA, A), s -= this.m_invIA * b, o.addMul(this.m_invMassB, A), n += this.m_invIB * w, this.m_bodyA.c_position.c.setVec2(r), this.m_bodyA.c_position.a = s, this.m_bodyB.c_position.c.setVec2(o), this.m_bodyB.c_position.a = n, bn(v) <= z.linearSlop;
  }, t.TYPE = "wheel-joint", t;
})(yt);
var nt;
var Cn = 0;
var Ws = { World: Li, Body: W, Joint: yt, Fixture: zi, Shape: Se };
var js = { Vec2: a, Vec3: $, World: Li, Body: W, Joint: yt, Fixture: zi, Shape: Se };
var Mn = (nt = {}, nt[W.STATIC] = W, nt[W.DYNAMIC] = W, nt[W.KINEMATIC] = W, nt[ui.TYPE] = ui, nt[ae.TYPE] = ae, nt[ne.TYPE] = ne, nt[de.TYPE] = de, nt[Jr.TYPE] = Jr, nt[$r.TYPE] = $r, nt[Wr.TYPE] = Wr, nt[jr.TYPE] = jr, nt[Ur.TYPE] = Ur, nt[Yr.TYPE] = Yr, nt[Hr.TYPE] = Hr, nt[ye.TYPE] = ye, nt[Zr.TYPE] = Zr, nt[Xr.TYPE] = Xr, nt[Kr.TYPE] = Kr, nt);
var In = { rootClass: Li, preSerialize: function(i) {
  return i;
}, postSerialize: function(i, t) {
  return i;
}, preDeserialize: function(i) {
  return i;
}, postDeserialize: function(i, t) {
  return i;
} };
var ur = /* @__PURE__ */ (function() {
  function i(t) {
    var e = this;
    this.toJson = function(r) {
      var s = e.options.preSerialize, o = e.options.postSerialize, n = [], m = [r], h = {};
      function p(y, v) {
        if (y.__sid = y.__sid || ++Cn, !h[y.__sid]) {
          m.push(y);
          var f = n.length + m.length, d = { refIndex: f, refType: v };
          h[y.__sid] = d;
        }
        return h[y.__sid];
      }
      function l(y) {
        y = s(y);
        var v = y._serialize();
        return v = o(v, y), v;
      }
      function u(y, v) {
        if (v === void 0 && (v = false), typeof y != "object" || y === null) return y;
        if (typeof y._serialize == "function") {
          if (!v) {
            for (var f in Ws) if (y instanceof Ws[f]) return p(y, f);
          }
          y = l(y);
        }
        if (Array.isArray(y)) {
          for (var d = [], A = 0; A < y.length; A++) d[A] = u(y[A]);
          y = d;
        } else {
          var d = {};
          for (var A in y) y.hasOwnProperty(A) && (d[A] = u(y[A]));
          y = d;
        }
        return y;
      }
      for (; m.length; ) {
        var c = m.shift(), _ = u(c, true);
        n.push(_);
      }
      return n;
    }, this.fromJson = function(r) {
      var s = e.options.preDeserialize, o = e.options.postDeserialize, n = e.options.rootClass, m = {};
      function h(u, c, _) {
        (!u || !u._deserialize) && (u = Mn[c.type]);
        var y = u && u._deserialize;
        if (y) {
          c = s(c);
          var v = u._deserialize, f = v(c, _, p);
          return f = o(f, c), f;
        }
      }
      function p(u, c, _) {
        var y = c.refIndex && c.refType;
        if (!y) return h(u, c, _);
        var v = c;
        js[v.refType] && (u = js[v.refType]);
        var f = v.refIndex;
        if (!m[f]) {
          var d = r[f], A = h(u, d, _);
          m[f] = A;
        }
        return m[f];
      }
      var l = h(n, r[0], null);
      return l;
    }, this.options = dt(dt({}, In), t);
  }
  return i;
})();
var fo = new ur({ rootClass: Li });
ur.fromJson = fo.fromJson;
ur.toJson = fo.toJson;
var xo = (function() {
  function i() {
  }
  return i.mount = function(t) {
    throw new Error("Not implemented");
  }, i.start = function(t) {
    var e = i.mount();
    return e.start(t), e;
  }, i;
})();
function Pn(i, t) {
  var e, r;
  typeof i == "function" ? (e = i, r = t) : typeof t == "function" ? (e = t, r = i) : r = i ?? t;
  var s = xo.mount(r);
  if (e) {
    var o = e(s) || s.world;
    s.start(o);
  } else return s;
}
var Us = (function(i) {
  xt(t, i);
  function t(e, r, s, o) {
    var n = this;
    return n instanceof t ? (n = i.call(this) || this, n._setAsBox(e, r, s, o), n) : new t(e, r, s, o);
  }
  return t.TYPE = "polygon", t;
})(ae);
Gt.addType(de.TYPE, de.TYPE, zn);
function zn(i, t, e, r, s, o, n) {
  Ao(i, e.getShape(), t, o.getShape(), s);
}
var Hs = g(0, 0);
var Zs = g(0, 0);
var Ao = function(i, t, e, r, s) {
  i.pointCount = 0, T(Hs, e, t.m_p), T(Zs, s, r.m_p);
  var o = He(Zs, Hs), n = t.m_radius, m = r.m_radius, h = n + m;
  o > h * h || (i.type = Q.e_circles, x(i.localPoint, t.m_p), S(i.localNormal), i.pointCount = 1, x(i.points[0].localPoint, r.m_p), i.points[0].id.setFeatures(0, J.e_vertex, 0, J.e_vertex));
};
Gt.addType(ne.TYPE, de.TYPE, Sn);
Gt.addType(ui.TYPE, de.TYPE, Ln);
function Sn(i, t, e, r, s, o, n) {
  var m = e.getShape(), h = o.getShape();
  as(i, m, t, h, s);
}
function Ln(i, t, e, r, s, o, n) {
  var m = e.getShape(), h = new ne();
  m.getChildEdge(h, r);
  var p = h, l = o.getShape();
  as(i, p, t, l, s);
}
var Oe = g(0, 0);
var Ir = g(0, 0);
var Pr = g(0, 0);
var pe = g(0, 0);
var Je = g(0, 0);
var ni = g(0, 0);
var as = function(i, t, e, r, s) {
  i.pointCount = 0, lo(pe, s, e, r.m_p);
  var o = t.m_vertex1, n = t.m_vertex2;
  N(Oe, n, o);
  var m = C(Oe, n) - C(Oe, pe), h = C(Oe, pe) - C(Oe, o), p = t.m_radius + r.m_radius;
  if (h <= 0) {
    x(Je, o);
    var l = He(pe, o);
    if (l > p * p) return;
    if (t.m_hasVertex0) {
      var u = t.m_vertex0, c = o;
      N(Ir, c, u);
      var _ = C(Ir, c) - C(Ir, pe);
      if (_ > 0) return;
    }
    i.type = Q.e_circles, S(i.localNormal), x(i.localPoint, Je), i.pointCount = 1, x(i.points[0].localPoint, r.m_p), i.points[0].id.setFeatures(0, J.e_vertex, 0, J.e_vertex);
    return;
  }
  if (m <= 0) {
    x(Je, n);
    var y = He(pe, Je);
    if (y > p * p) return;
    if (t.m_hasVertex3) {
      var v = t.m_vertex3, f = n;
      N(Pr, v, f);
      var d = C(Pr, pe) - C(Pr, f);
      if (d > 0) return;
    }
    i.type = Q.e_circles, S(i.localNormal), x(i.localPoint, Je), i.pointCount = 1, x(i.points[0].localPoint, r.m_p), i.points[0].id.setFeatures(1, J.e_vertex, 0, J.e_vertex);
    return;
  }
  var A = Ue(Oe);
  G2(Je, m / A, o, h / A, n);
  var b = He(pe, Je);
  b > p * p || (Lt(ni, 1, Oe), C(ni, pe) - C(ni, o) < 0 && Pi(ni), Kt(ni), i.type = Q.e_faceA, x(i.localNormal, ni), x(i.localPoint, o), i.pointCount = 1, x(i.points[0].localPoint, r.m_p), i.points[0].id.setFeatures(0, J.e_face, 0, J.e_vertex));
};
var tr = [new Mt(), new Mt()];
var er = [new Mt(), new Mt()];
var $e = [new Mt(), new Mt()];
var ir = g(0, 0);
var Xs = g(0, 0);
var zr = g(0, 0);
var Sr = Ze(0, 0, 0);
var Ye = g(0, 0);
var ai = g(0, 0);
var rr = g(0, 0);
var Ks = g(0, 0);
var Gs = g(0, 0);
var we = g(0, 0);
var Lr = g(0, 0);
var Qs = g(0, 0);
Gt.addType(ae.TYPE, ae.TYPE, Fn);
function Fn(i, t, e, r, s, o, n) {
  ms(i, e.getShape(), t, o.getShape(), s);
}
function to(i, t, e, r, s) {
  var o = i.m_count, n = e.m_count, m = i.m_normals, h = i.m_vertices, p = e.m_vertices;
  co(Sr, r, t);
  for (var l = 0, u = -1 / 0, c = 0; c < o; ++c) {
    $t(zr, Sr.q, m[c]), T(Xs, Sr, h[c]);
    for (var _ = 1 / 0, y = 0; y < n; ++y) {
      var v = C(zr, p[y]) - C(zr, Xs);
      v < _ && (_ = v);
    }
    _ > u && (u = _, l = c);
  }
  s.maxSeparation = u, s.bestIndex = l;
}
function qn(i, t, e, r, s, o) {
  var n = t.m_normals, m = s.m_count, h = s.m_vertices, p = s.m_normals;
  To(Qs, o.q, e.q, n[r]);
  for (var l = 0, u = 1 / 0, c = 0; c < m; ++c) {
    var _ = C(Qs, p[c]);
    _ < u && (u = _, l = c);
  }
  var y = l, v = y + 1 < m ? y + 1 : 0;
  T(i[0].v, o, h[y]), i[0].id.setFeatures(r, J.e_face, y, J.e_vertex), T(i[1].v, o, h[v]), i[1].id.setFeatures(r, J.e_face, v, J.e_vertex);
}
var mi = { maxSeparation: 0, bestIndex: 0 };
var ms = function(i, t, e, r, s) {
  i.pointCount = 0;
  var o = t.m_radius + r.m_radius;
  to(t, e, r, s, mi);
  var n = mi.bestIndex, m = mi.maxSeparation;
  if (!(m > o)) {
    to(r, s, t, e, mi);
    var h = mi.bestIndex, p = mi.maxSeparation;
    if (!(p > o)) {
      var l, u, c, _, y, v, f = 0.1 * z.linearSlop;
      p > m + f ? (l = r, u = t, c = s, _ = e, y = h, i.type = Q.e_faceB, v = true) : (l = t, u = r, c = e, _ = s, y = n, i.type = Q.e_faceA, v = false), tr[0].recycle(), tr[1].recycle(), qn(tr, l, c, y, u, _);
      var d = l.m_count, A = l.m_vertices, b = y, w = y + 1 < d ? y + 1 : 0;
      x(Ye, A[b]), x(ai, A[w]), N(rr, ai, Ye), Kt(rr), je(Ks, rr, 1), G2(Gs, 0.5, Ye, 0.5, ai), $t(we, c.q, rr), je(Lr, we, 1), T(Ye, c, Ye), T(ai, c, ai);
      var V = C(Lr, Ye), I = -C(we, Ye) + o, M = C(we, ai) + o;
      er[0].recycle(), er[1].recycle(), $e[0].recycle(), $e[1].recycle(), ut(ir, -we.x, -we.y);
      var P = _i(er, tr, ir, I, b);
      if (!(P < 2)) {
        ut(ir, we.x, we.y);
        var k = _i($e, er, ir, M, w);
        if (!(k < 2)) {
          x(i.localNormal, Ks), x(i.localPoint, Gs);
          for (var F = 0, O = 0; O < $e.length; ++O) {
            var Y = C(Lr, $e[O].v) - V;
            if (Y <= o) {
              var j = i.points[F];
              ts(j.localPoint, _, $e[O].v), j.id.set($e[O].id), v && j.id.swapFeatures(), ++F;
            }
          }
          i.pointCount = F;
        }
      }
    }
  }
};
Gt.addType(ae.TYPE, de.TYPE, Tn);
function Tn(i, t, e, r, s, o, n) {
  go(i, e.getShape(), t, o.getShape(), s);
}
var Ht = g(0, 0);
var Fr = g(0, 0);
var go = function(i, t, e, r, s) {
  i.pointCount = 0, lo(Ht, s, e, r.m_p);
  for (var o = 0, n = -1 / 0, m = t.m_radius + r.m_radius, h = t.m_count, p = t.m_vertices, l = t.m_normals, u = 0; u < h; ++u) {
    var c = C(l[u], Ht) - C(l[u], p[u]);
    if (c > m) return;
    c > n && (n = c, o = u);
  }
  var _ = o, y = _ + 1 < h ? _ + 1 : 0, v = p[_], f = p[y];
  if (n < gt) {
    i.pointCount = 1, i.type = Q.e_faceA, x(i.localNormal, l[o]), G2(i.localPoint, 0.5, v, 0.5, f), x(i.points[0].localPoint, r.m_p), i.points[0].id.setFeatures(0, J.e_vertex, 0, J.e_vertex);
    return;
  }
  var d = C(Ht, f) - C(Ht, v) - C(v, f) + C(v, v), A = C(Ht, v) - C(Ht, f) - C(f, v) + C(f, f);
  if (d <= 0) {
    if (He(Ht, v) > m * m) return;
    i.pointCount = 1, i.type = Q.e_faceA, N(i.localNormal, Ht, v), Kt(i.localNormal), x(i.localPoint, v), x(i.points[0].localPoint, r.m_p), i.points[0].id.setFeatures(0, J.e_vertex, 0, J.e_vertex);
  } else if (A <= 0) {
    if (He(Ht, f) > m * m) return;
    i.pointCount = 1, i.type = Q.e_faceA, N(i.localNormal, Ht, f), Kt(i.localNormal), x(i.localPoint, f), x(i.points[0].localPoint, r.m_p), i.points[0].id.setFeatures(0, J.e_vertex, 0, J.e_vertex);
  } else {
    G2(Fr, 0.5, v, 0.5, f);
    var b = C(Ht, l[_]) - C(Fr, l[_]);
    if (b > m) return;
    i.pointCount = 1, i.type = Q.e_faceA, x(i.localNormal, l[_]), x(i.localPoint, Fr), x(i.points[0].localPoint, r.m_p), i.points[0].id.setFeatures(0, J.e_vertex, 0, J.e_vertex);
  }
};
var Nn = Math.min;
Gt.addType(ne.TYPE, ae.TYPE, kn);
Gt.addType(ui.TYPE, ae.TYPE, Dn);
function kn(i, t, e, r, s, o, n) {
  hs(i, e.getShape(), t, o.getShape(), s);
}
var eo = new ne();
function Dn(i, t, e, r, s, o, n) {
  var m = e.getShape();
  m.getChildEdge(eo, r), hs(i, eo, t, o.getShape(), s);
}
var Ot;
(function(i) {
  i[i.e_unknown = -1] = "e_unknown", i[i.e_edgeA = 1] = "e_edgeA", i[i.e_edgeB = 2] = "e_edgeB";
})(Ot || (Ot = {}));
var io;
(function(i) {
  i[i.e_isolated = 0] = "e_isolated", i[i.e_concave = 1] = "e_concave", i[i.e_convex = 2] = "e_convex";
})(io || (io = {}));
var Bo = /* @__PURE__ */ (function() {
  function i() {
  }
  return i;
})();
var Rn = /* @__PURE__ */ (function() {
  function i() {
    this.vertices = [], this.normals = [], this.count = 0;
    for (var t = 0; t < z.maxPolygonVertices; t++) this.vertices.push(g(0, 0)), this.normals.push(g(0, 0));
  }
  return i;
})();
var En = (function() {
  function i() {
    this.v1 = g(0, 0), this.v2 = g(0, 0), this.normal = g(0, 0), this.sideNormal1 = g(0, 0), this.sideNormal2 = g(0, 0);
  }
  return i.prototype.recycle = function() {
    S(this.v1), S(this.v2), S(this.normal), S(this.sideNormal1), S(this.sideNormal2);
  }, i;
})();
var sr = [new Mt(), new Mt()];
var Ve = [new Mt(), new Mt()];
var Zt = [new Mt(), new Mt()];
var ee = new Bo();
var At = new Bo();
var ht = new Rn();
var D = new En();
var or = g(0, 0);
var bi = g(0, 0);
var hi = g(0, 0);
var wi = g(0, 0);
var Vi = Ze(0, 0, 0);
var Z = g(0, 0);
var ie = g(0, 0);
var q = g(0, 0);
var re = g(0, 0);
var at = g(0, 0);
var mt = g(0, 0);
var ro = g(0, 0);
var Ce = g(0, 0);
var hs = function(i, t, e, r, s) {
  co(Vi, e, s), T(or, Vi, r.m_centroid);
  var o = t.m_vertex0, n = t.m_vertex1, m = t.m_vertex2, h = t.m_vertex3, p = t.m_hasVertex0, l = t.m_hasVertex3;
  N(hi, m, n), Kt(hi), ut(q, hi.y, -hi.x);
  var u = C(q, or) - C(q, n), c = 0, _ = 0, y = false, v = false;
  S(ie), S(re), p && (N(bi, n, o), Kt(bi), ut(ie, bi.y, -bi.x), y = E(bi, hi) >= 0, c = a.dot(ie, or) - a.dot(ie, o)), l && (N(wi, h, m), Kt(wi), ut(re, wi.y, -wi.x), v = a.crossVec2Vec2(hi, wi) > 0, _ = a.dot(re, or) - a.dot(re, m));
  var f;
  S(Z), S(at), S(mt), p && l ? y && v ? (f = c >= 0 || u >= 0 || _ >= 0, f ? (x(Z, q), x(at, ie), x(mt, re)) : (L(Z, -1, q), L(at, -1, q), L(mt, -1, q))) : y ? (f = c >= 0 || u >= 0 && _ >= 0, f ? (x(Z, q), x(at, ie), x(mt, q)) : (L(Z, -1, q), L(at, -1, re), L(mt, -1, q))) : v ? (f = _ >= 0 || c >= 0 && u >= 0, f ? (x(Z, q), x(at, q), x(mt, re)) : (L(Z, -1, q), L(at, -1, q), L(mt, -1, ie))) : (f = c >= 0 && u >= 0 && _ >= 0, f ? (x(Z, q), x(at, q), x(mt, q)) : (L(Z, -1, q), L(at, -1, re), L(mt, -1, ie))) : p ? y ? (f = c >= 0 || u >= 0, f ? (x(Z, q), x(at, ie), L(mt, -1, q)) : (L(Z, -1, q), x(at, q), L(mt, -1, q))) : (f = c >= 0 && u >= 0, f ? (x(Z, q), x(at, q), L(mt, -1, q)) : (L(Z, -1, q), x(at, q), L(mt, -1, ie))) : l ? v ? (f = u >= 0 || _ >= 0, f ? (x(Z, q), L(at, -1, q), x(mt, re)) : (L(Z, -1, q), L(at, -1, q), x(mt, q))) : (f = u >= 0 && _ >= 0, f ? (x(Z, q), L(at, -1, q), x(mt, q)) : (L(Z, -1, q), L(at, -1, re), x(mt, q))) : (f = u >= 0, f ? (x(Z, q), L(at, -1, q), L(mt, -1, q)) : (L(Z, -1, q), x(at, q), x(mt, q))), ht.count = r.m_count;
  for (var d = 0; d < r.m_count; ++d) T(ht.vertices[d], Vi, r.m_vertices[d]), $t(ht.normals[d], Vi.q, r.m_normals[d]);
  var A = r.m_radius + t.m_radius;
  i.pointCount = 0;
  {
    ee.type = Ot.e_edgeA, ee.index = f ? 0 : 1, ee.separation = 1 / 0;
    for (var d = 0; d < ht.count; ++d) {
      var b = ht.vertices[d], w = C(Z, b) - C(Z, n);
      w < ee.separation && (ee.separation = w);
    }
  }
  if (ee.type != Ot.e_unknown && !(ee.separation > A)) {
    {
      At.type = Ot.e_unknown, At.index = -1, At.separation = -1 / 0, ut(ro, -Z.y, Z.x);
      for (var d = 0; d < ht.count; ++d) {
        L(Ce, -1, ht.normals[d]);
        var V = C(Ce, ht.vertices[d]) - C(Ce, n), I = C(Ce, ht.vertices[d]) - C(Ce, m), w = Nn(V, I);
        if (w > A) {
          At.type = Ot.e_edgeB, At.index = d, At.separation = w;
          break;
        }
        if (C(Ce, ro) >= 0) {
          if (C(Ce, Z) - C(mt, Z) < -z.angularSlop) continue;
        } else if (C(Ce, Z) - C(at, Z) < -z.angularSlop) continue;
        w > At.separation && (At.type = Ot.e_edgeB, At.index = d, At.separation = w);
      }
    }
    if (!(At.type != Ot.e_unknown && At.separation > A)) {
      var M = 0.98, P = 1e-3, k;
      if (At.type == Ot.e_unknown ? k = ee : At.separation > M * ee.separation + P ? k = At : k = ee, Zt[0].recycle(), Zt[1].recycle(), k.type == Ot.e_edgeA) {
        i.type = Q.e_faceA;
        for (var F = 0, O = C(Z, ht.normals[0]), d = 1; d < ht.count; ++d) {
          var Y = C(Z, ht.normals[d]);
          Y < O && (O = Y, F = d);
        }
        var j = F, H = j + 1 < ht.count ? j + 1 : 0;
        x(Zt[0].v, ht.vertices[j]), Zt[0].id.setFeatures(0, J.e_face, j, J.e_vertex), x(Zt[1].v, ht.vertices[H]), Zt[1].id.setFeatures(0, J.e_face, H, J.e_vertex), f ? (D.i1 = 0, D.i2 = 1, x(D.v1, n), x(D.v2, m), x(D.normal, q)) : (D.i1 = 1, D.i2 = 0, x(D.v1, m), x(D.v2, n), L(D.normal, -1, q));
      } else i.type = Q.e_faceB, x(Zt[0].v, n), Zt[0].id.setFeatures(0, J.e_vertex, k.index, J.e_face), x(Zt[1].v, m), Zt[1].id.setFeatures(0, J.e_vertex, k.index, J.e_face), D.i1 = k.index, D.i2 = D.i1 + 1 < ht.count ? D.i1 + 1 : 0, x(D.v1, ht.vertices[D.i1]), x(D.v2, ht.vertices[D.i2]), x(D.normal, ht.normals[D.i1]);
      ut(D.sideNormal1, D.normal.y, -D.normal.x), ut(D.sideNormal2, -D.sideNormal1.x, -D.sideNormal1.y), D.sideOffset1 = C(D.sideNormal1, D.v1), D.sideOffset2 = C(D.sideNormal2, D.v2), sr[0].recycle(), sr[1].recycle(), Ve[0].recycle(), Ve[1].recycle();
      var It = _i(sr, Zt, D.sideNormal1, D.sideOffset1, D.i1);
      if (!(It < z.maxManifoldPoints)) {
        var ct = _i(Ve, sr, D.sideNormal2, D.sideOffset2, D.i2);
        if (!(ct < z.maxManifoldPoints)) {
          k.type == Ot.e_edgeA ? (x(i.localNormal, D.normal), x(i.localPoint, D.v1)) : (x(i.localNormal, r.m_normals[D.i1]), x(i.localPoint, r.m_vertices[D.i1]));
          for (var Wt = 0, d = 0; d < z.maxManifoldPoints; ++d) {
            var Bt = C(D.normal, Ve[d].v) - C(D.normal, D.v1);
            if (Bt <= A) {
              var tt = i.points[Wt];
              k.type == Ot.e_edgeA ? (ts(tt.localPoint, Vi, Ve[d].v), tt.id.set(Ve[d].id)) : (x(tt.localPoint, Ve[d].v), tt.id.set(Ve[d].id), tt.id.swapFeatures()), ++Wt;
            }
          }
          i.pointCount = Wt;
        }
      }
    }
  }
};
var On = { CollidePolygons: ms, Settings: R, Sweep: Ie, Manifold: _r, Distance: xe, TimeOfImpact: Si, DynamicTree: Gr, stats: K };
var Jn = (function() {
  function i(t, e) {
    this._refMap = {}, this._map = {}, this._xmap = {}, this._data = [], this._entered = [], this._exited = [], this._key = t, this._listener = e;
  }
  return i.prototype.update = function(t) {
    if (!Array.isArray(t)) throw "Invalid data: " + t;
    this._entered.length = 0, this._exited.length = 0, this._data.length = t.length;
    for (var e = 0; e < t.length; e++) if (!(typeof t[e] != "object" || t[e] === null)) {
      var r = t[e], s = this._key(r);
      this._map[s] ? delete this._map[s] : this._entered.push(r), this._data[e] = r, this._xmap[s] = r;
    }
    for (var s in this._map) this._exited.push(this._map[s]), delete this._map[s];
    var o = this._map;
    this._map = this._xmap, this._xmap = o;
    for (var e = 0; e < this._exited.length; e++) {
      var r = this._exited[e], n = this._key(r), m = this._refMap[n];
      this._listener.exit(r, m), delete this._refMap[n];
    }
    for (var e = 0; e < this._entered.length; e++) {
      var r = this._entered[e], n = this._key(r), m = this._listener.enter(r);
      m && (this._refMap[n] = m);
    }
    for (var e = 0; e < this._data.length; e++) if (!(typeof t[e] != "object" || t[e] === null)) {
      var r = this._data[e], n = this._key(r), m = this._refMap[n];
      this._listener.update(r, m);
    }
    this._entered.length = 0, this._exited.length = 0, this._data.length = 0;
  }, i.prototype.ref = function(t) {
    return this._refMap[this._key(t)];
  }, i;
})();
var $n = Object.freeze(Object.defineProperty({ __proto__: null, AABB: _t, Body: W, Box: Us, BoxShape: Us, BroadPhase: no, Chain: ui, ChainShape: ui, Circle: de, CircleShape: de, ClipVertex: Mt, CollideCircles: Ao, CollideEdgeCircle: as, CollideEdgePolygon: hs, CollidePolygonCircle: go, CollidePolygons: ms, Contact: Gt, ContactEdge: Dr, get ContactFeatureType() {
  return J;
}, ContactID: os, ContactImpulse: vo, DataDriver: Jn, Distance: xe, DistanceInput: mr, DistanceJoint: Jr, DistanceOutput: hr, DistanceProxy: Pe, DynamicTree: Gr, Edge: ne, EdgeShape: ne, Fixture: zi, FixtureProxy: Tr, FrictionJoint: $r, GearJoint: Wr, Joint: yt, JointEdge: Nr, Manifold: _r, ManifoldPoint: kr, get ManifoldType() {
  return Q;
}, Mat22: Yt, Mat33: fe, Math: ze, MotorJoint: jr, MouseJoint: Ur, get PointState() {
  return Me;
}, Polygon: ae, PolygonShape: ae, PrismaticJoint: Yr, PulleyJoint: Hr, RevoluteJoint: ye, RopeJoint: Zr, Rot: B, Serializer: ur, Settings: R, SettingsInternal: z, Shape: Se, ShapeCast: Ho, ShapeCastInput: jo, ShapeCastOutput: Uo, SimplexCache: lr, Solver: ss, Sweep: Ie, TOIInput: is, TOIOutput: rs, get TOIOutputState() {
  return Ft;
}, Testbed: xo, TimeOfImpact: Si, TimeStep: cr, Transform: ft, TreeNode: oo, Vec2: a, Vec3: $, VelocityConstraintPoint: Or, WeldJoint: Xr, WheelJoint: Kr, World: Li, WorldManifold: ns, clipSegmentToLine: _i, getPointStates: yo, internal: On, mixFriction: Rr, mixRestitution: Er, stats: K, testOverlap: es, testbed: Pn }, Symbol.toStringTag, { value: "Module" }));

// vm/physics.js
var PHYS_STATIC = 0;
var PHYS_DYNAMIC = 1;
var PHYS_KINEMATIC = 2;
var DIV_TO_RAD = Math.PI / 18e4;
var DEFAULT_SCALE = 32;
var DEFAULT_GRAVITY_Y = 600;
function bodyTypeName(type) {
  switch (Number(type) || 0) {
    case PHYS_DYNAMIC:
      return "dynamic";
    case PHYS_KINEMATIC:
      return "kinematic";
    default:
      return "static";
  }
}
var PhysicsWorld = class _PhysicsWorld {
  constructor() {
    this.scale = DEFAULT_SCALE;
    this.gravity = { x: 0, y: DEFAULT_GRAVITY_Y };
    this.world = null;
    this.entries = /* @__PURE__ */ new Map();
    this.joints = /* @__PURE__ */ new Map();
    this.nextJointId = 1;
    this.impacts = /* @__PURE__ */ new Map();
    this.pendingMaterials = /* @__PURE__ */ new Map();
    this.anchor = null;
    this.substeps = 1;
    this.velocityIterations = 8;
    this.positionIterations = 3;
  }
  worldAnchor() {
    if (!this.anchor) {
      this.anchor = this.ensureWorld().createBody();
    }
    return this.anchor;
  }
  ensureWorld() {
    if (!this.world) {
      this.world = new Li({ gravity: a(this.gravity.x / this.scale, this.gravity.y / this.scale) });
      this.world.on("post-solve", (contact, impulse) => {
        const strongest = Math.max(0, ...impulse.normalImpulses);
        for (const fixture of [contact.getFixtureA(), contact.getFixtureB()]) {
          const body = fixture.getBody();
          if (strongest > (this.impacts.get(body) || 0)) {
            this.impacts.set(body, strongest);
          }
        }
      });
    }
    return this.world;
  }
  get bodyCount() {
    return this.entries.size;
  }
  // ── Units ─────────────────────────────────────────────────────────────
  static resolutionOf(process) {
    return typeof process.getResolution === "function" ? process.getResolution() : 1;
  }
  toWorld(process, x2, y) {
    const res = _PhysicsWorld.resolutionOf(process);
    return a((Number(x2) || 0) / res / this.scale, (Number(y) || 0) / res / this.scale);
  }
  // ── World settings ────────────────────────────────────────────────────
  setGravity(gx, gy) {
    this.gravity = { x: Number(gx) || 0, y: Number(gy) || 0 };
    if (this.world) {
      this.world.setGravity(a(this.gravity.x / this.scale, this.gravity.y / this.scale));
    }
  }
  // Only before the first body: sizes already given would change meaning.
  setScale(pixelsPerMetre) {
    const value = Number(pixelsPerMetre);
    if (this.entries.size > 0 || !(value > 0)) {
      return 0;
    }
    this.scale = value;
    if (this.world) {
      this.world.setGravity(a(this.gravity.x / this.scale, this.gravity.y / this.scale));
    }
    return 1;
  }
  // ── Bodies ────────────────────────────────────────────────────────────
  entryOf(process) {
    return process ? this.entries.get(process.id) || null : null;
  }
  // The process's body, created on first use with its current position
  // and angle; a new type replaces the old body's type.
  bodyFor(process, type) {
    const world = this.ensureWorld();
    let entry = this.entryOf(process);
    if (!entry) {
      const body = world.createBody({
        type: bodyTypeName(type === void 0 ? PHYS_DYNAMIC : type),
        position: this.toWorld(process, process.x, process.y),
        angle: -(Number(process.angle) || 0) * DIV_TO_RAD
      });
      body.setUserData(process);
      entry = {
        process,
        body,
        material: this.pendingMaterials.get(process.id) || { density: 1, friction: 0.5, restitution: 0.1 },
        last: { x: process.x, y: process.y, angle: process.angle }
      };
      this.pendingMaterials.delete(process.id);
      this.entries.set(process.id, entry);
    } else if (type !== void 0) {
      entry.body.setType(bodyTypeName(type));
    }
    return entry;
  }
  addFixture(entry, shape) {
    const m = entry.material;
    entry.body.createFixture({ shape, density: m.density, friction: m.friction, restitution: m.restitution });
    entry.body.resetMassData();
  }
  pixels(process, value) {
    return (Number(value) || 0) / _PhysicsWorld.resolutionOf(process) / this.scale;
  }
  addBox(process, width, height, type, offsetX = 0, offsetY = 0) {
    const entry = this.bodyFor(process, type);
    const hw = Math.max(1e-3, this.pixels(process, width) / 2);
    const hh = Math.max(1e-3, this.pixels(process, height) / 2);
    this.addFixture(entry, Us(hw, hh, a(this.pixels(process, offsetX), this.pixels(process, offsetY)), 0));
    return 1;
  }
  addCircle(process, radius, type, offsetX = 0, offsetY = 0) {
    const entry = this.bodyFor(process, type);
    const r = Math.max(1e-3, this.pixels(process, radius));
    this.addFixture(entry, de(a(this.pixels(process, offsetX), this.pixels(process, offsetY)), r));
    return 1;
  }
  // A segment in the process's own coordinates (relative to its x, y):
  // chains of these make terrain. Edges never move, so they go on a
  // static body.
  addEdge(process, x1, y1, x2, y2) {
    const entry = this.entryOf(process) || this.bodyFor(process, PHYS_STATIC);
    const a2 = a(this.pixels(process, x1), this.pixels(process, y1));
    const b = a(this.pixels(process, x2), this.pixels(process, y2));
    if (a.distance(a2, b) < 1e-4) {
      return 0;
    }
    this.addFixture(entry, ne(a2, b));
    return 1;
  }
  setMaterial(process, density, friction, restitution) {
    const material = {
      density: Math.max(0, Number(density) || 0),
      friction: Math.max(0, Number(friction) || 0),
      restitution: Math.max(0, Number(restitution) || 0)
    };
    const entry = this.entryOf(process);
    if (!entry) {
      this.pendingMaterials.set(process.id, material);
      return 1;
    }
    entry.material = material;
    for (let f = entry.body.getFixtureList(); f; f = f.getNext()) {
      f.setDensity(entry.material.density);
      f.setFriction(entry.material.friction);
      f.setRestitution(entry.material.restitution);
    }
    entry.body.resetMassData();
    return 1;
  }
  remove(process) {
    const entry = this.entryOf(process);
    if (!entry) {
      return 0;
    }
    this.destroyEntry(process.id, entry);
    return 1;
  }
  destroyEntry(id, entry) {
    for (const [jointId, joint] of this.joints) {
      if (joint.getBodyA() === entry.body || joint.getBodyB() === entry.body) {
        this.joints.delete(jointId);
      }
    }
    this.impacts.delete(entry.body);
    this.world.destroyBody(entry.body);
    this.entries.delete(id);
  }
  clear() {
    for (const [id, entry] of [...this.entries]) {
      this.destroyEntry(id, entry);
    }
    this.pendingMaterials.clear();
  }
  // ── Motion ────────────────────────────────────────────────────────────
  setVelocity(process, vx, vy) {
    const entry = this.entryOf(process);
    if (!entry) {
      return 0;
    }
    entry.body.setLinearVelocity(this.toWorld(process, vx, vy));
    entry.body.setAwake(true);
    return 1;
  }
  velocity(process, axis) {
    const entry = this.entryOf(process);
    if (!entry) {
      return 0;
    }
    const v = entry.body.getLinearVelocity();
    return (axis === "x" ? v.x : v.y) * this.scale * _PhysicsWorld.resolutionOf(process);
  }
  // An impulse in pixel units: it changes the velocity (px/s) by
  // impulse / mass, mass being in kg as reported by phys_mass().
  applyImpulse(process, ix, iy) {
    const entry = this.entryOf(process);
    if (!entry) {
      return 0;
    }
    entry.body.applyLinearImpulse(this.toWorld(process, ix, iy), entry.body.getWorldCenter(), true);
    return 1;
  }
  applyForce(process, fx, fy) {
    const entry = this.entryOf(process);
    if (!entry) {
      return 0;
    }
    entry.body.applyForceToCenter(this.toWorld(process, fx, fy), true);
    return 1;
  }
  // DIV angle units per second, counter-clockwise positive.
  setSpin(process, divAnglePerSecond) {
    const entry = this.entryOf(process);
    if (!entry) {
      return 0;
    }
    entry.body.setAngularVelocity(-(Number(divAnglePerSecond) || 0) * DIV_TO_RAD);
    entry.body.setAwake(true);
    return 1;
  }
  setFlag(process, flag, value) {
    const entry = this.entryOf(process);
    if (!entry) {
      return 0;
    }
    const on2 = Boolean(Number(value));
    if (flag === "fixedRotation") {
      entry.body.setFixedRotation(on2);
    } else if (flag === "bullet") {
      entry.body.setBullet(on2);
    } else if (flag === "sensor") {
      for (let f = entry.body.getFixtureList(); f; f = f.getNext()) {
        f.setSensor(on2);
      }
    }
    return 1;
  }
  setType(process, type) {
    const entry = this.entryOf(process);
    if (!entry) {
      return 0;
    }
    entry.body.setType(bodyTypeName(type));
    entry.body.setAwake(true);
    return 1;
  }
  // 1 while the world is simulating the body. Static bodies never move,
  // so they report 0 (Planck leaves a lone static body's flag set).
  awake(process) {
    const entry = this.entryOf(process);
    return entry && !entry.body.isStatic() && entry.body.isAwake() ? 1 : 0;
  }
  mass(process) {
    const entry = this.entryOf(process);
    return entry ? entry.body.getMass() : 0;
  }
  // ── Contacts ──────────────────────────────────────────────────────────
  // The id of a process of type `typeCode` (any type when 0) whose body is
  // touching this process's body now, or 0.
  contact(process, typeCode) {
    const entry = this.entryOf(process);
    if (!entry) {
      return 0;
    }
    const code = Number(typeCode) || 0;
    for (let edge = entry.body.getContactList(); edge; edge = edge.next) {
      if (!edge.contact.isTouching()) {
        continue;
      }
      const other = edge.other.getUserData();
      if (other && !other.dead && !other.finished && (code === 0 || other.type === code)) {
        return other.id;
      }
    }
    return 0;
  }
  // The strongest hit the body took in the last step, as the change of
  // velocity (px/s) it would give this body - comparable across masses,
  // so "impact > 300" means "hit hard" for a pebble and a boulder alike.
  impact(process) {
    const entry = this.entryOf(process);
    if (!entry) {
      return 0;
    }
    const impulse = this.impacts.get(entry.body) || 0;
    const mass = entry.body.getMass();
    return mass > 0 ? impulse / mass * this.scale * _PhysicsWorld.resolutionOf(process) : 0;
  }
  // ── Joints ────────────────────────────────────────────────────────────
  // A pin between two processes' bodies at a point (the process's own
  // coordinates); `other` null pins to the world.
  addRevolute(process, other, anchorX, anchorY) {
    const a2 = this.entryOf(process);
    if (!a2) {
      return 0;
    }
    const world = this.ensureWorld();
    const b = other ? this.entryOf(other) : null;
    const anchor = this.toWorld(process, anchorX, anchorY);
    const bodyB = b ? b.body : this.worldAnchor();
    const joint = world.createJoint(ye({}, a2.body, bodyB, anchor));
    return this.keepJoint(joint);
  }
  // Glues two bodies together where they are now.
  addWeld(process, other) {
    const a2 = this.entryOf(process);
    const b = other ? this.entryOf(other) : null;
    if (!a2) {
      return 0;
    }
    const bodyB = b ? b.body : this.worldAnchor();
    return this.keepJoint(this.ensureWorld().createJoint(Xr({}, a2.body, bodyB, a2.body.getWorldCenter())));
  }
  // A rope that can go slack: the centres never get further apart than
  // maxLength pixels (the current distance when it is not given).
  addSlack(process, other, maxLength) {
    const a2 = this.entryOf(process);
    const b = other ? this.entryOf(other) : null;
    if (!a2 || !b) {
      return 0;
    }
    const length = maxLength === void 0 ? a.distance(a2.body.getWorldCenter(), b.body.getWorldCenter()) : this.pixels(process, maxLength);
    const joint = Zr({ maxLength: Math.max(1e-3, length) }, a2.body, b.body, a(0, 0));
    joint.m_localAnchorA = a(0, 0);
    joint.m_localAnchorB = a(0, 0);
    return this.keepJoint(this.ensureWorld().createJoint(joint));
  }
  // Revolute joints: the process that made the pin only turns between
  // `lower` and `upper` (DIV angles, counter-clockwise) relative to the
  // other body. Box2D's joint angle is angle(B) - angle(A) in y-down
  // radians, with the caller as A; a DIV angle is a negated body angle,
  // so DIV(A) - DIV(B) = angle(B) - angle(A): the same number, unsigned.
  setLimits(jointId, lower, upper) {
    const joint = this.joints.get(Number(jointId));
    if (!joint || typeof joint.setLimits !== "function") {
      return 0;
    }
    const lo2 = (Number(lower) || 0) * DIV_TO_RAD;
    const hi2 = (Number(upper) || 0) * DIV_TO_RAD;
    joint.setLimits(Math.min(lo2, hi2), Math.max(lo2, hi2));
    joint.enableLimit(true);
    return 1;
  }
  // Revolute joints: the process that made the pin turns at `speed` (DIV
  // angle units per second, counter-clockwise) relative to the other body,
  // with at most `maxTorque` (0 turns the motor off). The motor drives
  // angle(B) - angle(A), which by the reasoning above has the DIV sign.
  setMotor(jointId, speed, maxTorque) {
    const joint = this.joints.get(Number(jointId));
    if (!joint || typeof joint.enableMotor !== "function") {
      return 0;
    }
    const torque = Number(maxTorque) || 0;
    joint.enableMotor(torque > 0);
    joint.setMotorSpeed((Number(speed) || 0) * DIV_TO_RAD);
    joint.setMaxMotorTorque(torque);
    joint.getBodyA().setAwake(true);
    joint.getBodyB().setAwake(true);
    return 1;
  }
  // Distance joints: soften into a spring (frequency in Hz, damping 0-1;
  // frequency 0 makes it rigid again).
  setSpring(jointId, frequency, damping) {
    const joint = this.joints.get(Number(jointId));
    if (!joint || typeof joint.setFrequency !== "function") {
      return 0;
    }
    joint.setFrequency(Math.max(0, Number(frequency) || 0));
    joint.setDampingRatio(Math.max(0, Number(damping) || 0));
    return 1;
  }
  // A rod of fixed length between the two bodies' centres: their
  // distance now, or `length` pixels.
  addDistance(process, other, length) {
    const a2 = this.entryOf(process);
    const b = other ? this.entryOf(other) : null;
    if (!a2 || !b) {
      return 0;
    }
    const joint = this.ensureWorld().createJoint(Jr({}, a2.body, b.body, a2.body.getWorldCenter(), b.body.getWorldCenter()));
    if (joint && length !== void 0) {
      joint.setLength(Math.max(1e-3, this.pixels(process, length)));
    }
    return this.keepJoint(joint);
  }
  keepJoint(joint) {
    if (!joint) {
      return 0;
    }
    const id = this.nextJointId++;
    this.joints.set(id, joint);
    return id;
  }
  removeJoint(id) {
    const joint = this.joints.get(Number(id));
    if (!joint) {
      return 0;
    }
    this.world.destroyJoint(joint);
    this.joints.delete(Number(id));
    return 1;
  }
  // ── Queries ───────────────────────────────────────────────────────────
  // The id of the process whose body covers the point (x, y), or 0.
  // Coordinates in the calling process's units.
  processAt(caller, x2, y) {
    if (!this.world) {
      return 0;
    }
    const point = this.toWorld(caller, x2, y);
    let found = 0;
    const box = _t(a(point.x - 1e-3, point.y - 1e-3), a(point.x + 1e-3, point.y + 1e-3));
    this.world.queryAABB(box, (fixture) => {
      const p = fixture.getBody().getUserData();
      if (p && !p.dead && !p.finished && fixture.testPoint(point)) {
        found = p.id;
        return false;
      }
      return true;
    });
    return found;
  }
  // The first body a line from (x1, y1) to (x2, y2) hits: its process id
  // (0 for none) and the hit point in pixels.
  raycast(caller, x1, y1, x2, y2) {
    if (!this.world) {
      return { id: 0 };
    }
    const from = this.toWorld(caller, x1, y1);
    const to2 = this.toWorld(caller, x2, y2);
    if (a.distance(from, to2) < 1e-6) {
      return { id: 0 };
    }
    let best = null;
    this.world.rayCast(from, to2, (fixture, point, normal, fraction) => {
      const p = fixture.getBody().getUserData();
      if (!p || p.dead || p.finished || p === caller) {
        return -1;
      }
      best = { id: p.id, x: point.x, y: point.y };
      return fraction;
    });
    if (!best) {
      return { id: 0 };
    }
    const k = this.scale * _PhysicsWorld.resolutionOf(caller);
    return { id: best.id, x: best.x * k, y: best.y * k };
  }
  setIterations(velocity, position) {
    this.velocityIterations = Math.max(1, Math.min(100, Math.round(Number(velocity) || 8)));
    this.positionIterations = Math.max(1, Math.min(100, Math.round(Number(position) || 3)));
    return 1;
  }
  setSubsteps(n) {
    this.substeps = Math.max(1, Math.min(16, Math.round(Number(n) || 1)));
    return 1;
  }
  // ── The frame ─────────────────────────────────────────────────────────
  // One fixed step, then every body's position and angle into its process.
  step(dt2) {
    if (!this.world || this.entries.size === 0) {
      return;
    }
    for (const [id, entry] of [...this.entries]) {
      const p = entry.process;
      if (p.dead || p.finished) {
        this.destroyEntry(id, entry);
        continue;
      }
      if (p.x !== entry.last.x || p.y !== entry.last.y || p.angle !== entry.last.angle) {
        entry.body.setTransform(this.toWorld(p, p.x, p.y), -(Number(p.angle) || 0) * DIV_TO_RAD);
        entry.body.setAwake(true);
      }
    }
    this.impacts.clear();
    const frame = Math.min(Math.max(Number(dt2) || 0, 1 / 240), 1 / 15);
    for (let i = 0; i < this.substeps; i++) {
      this.world.step(frame / this.substeps, this.velocityIterations, this.positionIterations);
    }
    for (const entry of this.entries.values()) {
      const p = entry.process;
      const res = _PhysicsWorld.resolutionOf(p);
      const pos = entry.body.getPosition();
      const x2 = pos.x * this.scale * res;
      const y = pos.y * this.scale * res;
      const angle = -entry.body.getAngle() / DIV_TO_RAD;
      p.x = x2;
      p.y = y;
      p.angle = angle;
      p.locals[0] = x2;
      p.locals[1] = y;
      p.locals[7] = angle;
      entry.last = { x: x2, y, angle };
    }
  }
  // Outlines of a process's fixtures in pixels relative to the process
  // position (for the debug overlay): [{circle: [cx, cy, r]} | {points}].
  debugShapes(process) {
    const entry = this.entryOf(process);
    if (!entry) {
      return [];
    }
    const res = _PhysicsWorld.resolutionOf(process);
    const k = this.scale * res;
    const body = entry.body;
    const pos = body.getPosition();
    const out = [];
    for (let f = body.getFixtureList(); f; f = f.getNext()) {
      const shape = f.getShape();
      const type = shape.getType();
      if (type === "circle") {
        const c = body.getWorldPoint(shape.getCenter());
        out.push({ circle: [(c.x - pos.x) * k, (c.y - pos.y) * k, shape.getRadius() * k] });
      } else if (type === "polygon" || type === "edge") {
        const vertices = type === "edge" ? [shape.m_vertex1, shape.m_vertex2] : shape.m_vertices;
        out.push({
          points: vertices.map((v) => {
            const w = body.getWorldPoint(v);
            return [(w.x - pos.x) * k, (w.y - pos.y) * k];
          }),
          closed: type === "polygon"
        });
      }
    }
    return out;
  }
};

// vm/net.js
var NET_IDLE = 0;
var NET_CONNECTING = 1;
var NET_CONNECTED = 2;
var NET_CLOSED = 3;
var NET_DESYNC = 4;
var CODE_PREFIX = "DIVNET1.";
var HASH_EVERY = 60;
var DEFAULT_DELAY = 3;
function bytesToBase64Url(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function base64UrlToBytes(text) {
  const base64 = text.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64 + "=".repeat((4 - base64.length % 4) % 4));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}
async function encodeCode(value) {
  const stream = new Blob([JSON.stringify(value)]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  return CODE_PREFIX + bytesToBase64Url(new Uint8Array(await new Response(stream).arrayBuffer()));
}
async function decodeCode(code) {
  const text = String(code || "").trim();
  if (!text.startsWith(CODE_PREFIX)) {
    throw new Error("That is not a DivJS connection code");
  }
  const bytes = base64UrlToBytes(text.slice(CODE_PREFIX.length));
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return JSON.parse(await new Response(stream).text());
}
function hashState(vm) {
  let h = 2166136261;
  const mix = (value) => {
    const n = Math.round((Number(value) || 0) * 100) | 0;
    h = Math.imul(h ^ n, 16777619) >>> 0;
  };
  const processes = vm.processManager.getAll().filter((p) => !p.isMouse && !p.dead && !p.finished).sort((a2, b) => a2.id - b.id);
  for (const p of processes) {
    mix(p.id);
    mix(p.type);
    mix(p.x);
    mix(p.y);
    mix(p.angle);
    mix(p.graph);
    mix(p.size);
  }
  if (vm.globals && typeof vm.globals.forEach === "function") {
    vm.globals.forEach((value, key) => {
      if (typeof value === "number") {
        mix(key);
        mix(value);
      }
    });
  }
  return h;
}
function emptyInput() {
  return { down: /* @__PURE__ */ new Set(), pressed: /* @__PURE__ */ new Set(), mx: 0, my: 0, mb: 0 };
}
var NetSession = class {
  // ui: the page's code-exchange panel (see createNetPanel in divjs.js);
  // log: the program's log line function.
  constructor({ iceServers, ui: ui2 = null, log = () => {
  } } = {}) {
    this.iceServers = iceServers ?? [{ urls: "stun:stun.l.google.com:19302" }];
    this.ui = ui2;
    this.log = log;
    if (ui2) {
      ui2.onCancel = () => {
        if (this.status === NET_CONNECTING) {
          this.close();
          this.status = NET_CLOSED;
          this.log("[net] connection cancelled");
        }
      };
    }
    this.status = NET_IDLE;
    this.me = 0;
    this.transport = null;
    this.pc = null;
    this.inbox = [];
    this.current = null;
    this.resetLockstep();
  }
  resetLockstep() {
    this.lock = {
      active: false,
      pendingStart: null,
      delay: DEFAULT_DELAY,
      frame: 0,
      sentFor: -1,
      inputs: [/* @__PURE__ */ new Map(), /* @__PURE__ */ new Map()],
      cur: [emptyInput(), emptyInput()],
      hashes: [/* @__PURE__ */ new Map(), /* @__PURE__ */ new Map()]
    };
  }
  get players() {
    return this.status === NET_CONNECTED || this.status === NET_DESYNC ? 2 : 1;
  }
  // ── Connecting ────────────────────────────────────────────────────────
  send(message) {
    if (this.transport) {
      this.transport.send(message);
    }
  }
  connected(transport) {
    this.transport = transport;
    this.status = NET_CONNECTED;
    this.log(`[net] connected as player ${this.me + 1}`);
    if (this.ui) {
      this.ui.close();
    }
  }
  closed(reason) {
    if (this.status === NET_CONNECTED || this.status === NET_DESYNC || this.status === NET_CONNECTING) {
      this.status = NET_CLOSED;
      this.log(`[net] connection closed${reason ? ": " + reason : ""}`);
    }
  }
  // Two tabs of one browser, on a named room.
  hostLocal(room) {
    return this.openLocal(room, 0);
  }
  joinLocal(room) {
    return this.openLocal(room, 1);
  }
  openLocal(room, me2) {
    this.close();
    this.me = me2;
    this.status = NET_CONNECTING;
    const channel = new BroadcastChannel(`divjs-net:${room}`);
    const self = `${Math.random()}`;
    let peer = null;
    let helloTimer = 0;
    const transport = {
      send: (message) => channel.postMessage({ from: self, to: peer, message }),
      close: () => {
        clearInterval(helloTimer);
        channel.postMessage({ from: self, to: peer, bye: true });
        channel.close();
      }
    };
    channel.onmessage = (event) => {
      const data = event.data || {};
      if (data.from === self) {
        return;
      }
      if (data.hello && me2 === 0 && !peer) {
        peer = data.from;
        channel.postMessage({ from: self, to: peer, welcome: true });
        this.connected(transport);
        return;
      }
      if (data.welcome && me2 === 1 && !peer && data.to === self) {
        peer = data.from;
        clearInterval(helloTimer);
        this.connected(transport);
        return;
      }
      if (data.to !== self || data.from !== peer) {
        return;
      }
      if (data.bye) {
        this.closed("the other player left");
        return;
      }
      this.receive(data.message);
    };
    if (me2 === 1) {
      const hello = () => channel.postMessage({ from: self, hello: true });
      hello();
      helloTimer = setInterval(hello, 300);
    }
    this.localChannel = transport;
    return 1;
  }
  // WebRTC: the host makes an offer code for the guest and waits for the
  // guest's answer code.
  async hostWebRtc() {
    this.close();
    this.me = 0;
    this.status = NET_CONNECTING;
    try {
      const pc = this.newPeerConnection();
      this.useChannel(pc.createDataChannel("divjs", { ordered: true }));
      await pc.setLocalDescription(await pc.createOffer());
      await this.iceGathered(pc);
      const code = await encodeCode({ t: "offer", sdp: pc.localDescription.sdp });
      if (this.pc !== pc) {
        return;
      }
      if (!this.ui) {
        throw new Error("no connection panel on this page");
      }
      this.ui.showHost(code, async (answerCode) => {
        const answer = await decodeCode(answerCode);
        if (answer.t !== "answer") {
          throw new Error("That code is an invitation, not an answer");
        }
        await pc.setRemoteDescription({ type: "answer", sdp: answer.sdp });
      });
    } catch (err) {
      if (this.status === NET_CONNECTING) {
        this.fail(err);
      }
    }
  }
  // WebRTC: the guest pastes the host's code and sends back an answer code.
  async joinWebRtc() {
    this.close();
    this.me = 1;
    this.status = NET_CONNECTING;
    if (!this.ui) {
      this.fail(new Error("no connection panel on this page"));
      return;
    }
    this.ui.askJoin(async (offerCode) => {
      const offer = await decodeCode(offerCode);
      if (offer.t !== "offer") {
        throw new Error("That code is an answer, not an invitation");
      }
      if (this.pc) {
        this.pc.close();
      }
      const pc = this.newPeerConnection();
      pc.ondatachannel = (event) => this.useChannel(event.channel);
      await pc.setRemoteDescription({ type: "offer", sdp: offer.sdp });
      await pc.setLocalDescription(await pc.createAnswer());
      await this.iceGathered(pc);
      if (this.pc !== pc) {
        throw new Error("The connection was closed");
      }
      return encodeCode({ t: "answer", sdp: pc.localDescription.sdp });
    });
  }
  newPeerConnection() {
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    pc.onconnectionstatechange = () => {
      if (this.pc === pc && (pc.connectionState === "failed" || pc.connectionState === "closed")) {
        this.closed(`connection ${pc.connectionState}`);
      }
    };
    this.pc = pc;
    return pc;
  }
  // The codes carry every candidate address, so wait for gathering to end
  // (or give up after a few seconds and send what there is).
  iceGathered(pc) {
    if (pc.iceGatheringState === "complete") {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const done = () => {
        if (pc.iceGatheringState === "complete") {
          pc.removeEventListener("icegatheringstatechange", done);
          resolve();
        }
      };
      pc.addEventListener("icegatheringstatechange", done);
      setTimeout(resolve, 4e3);
    });
  }
  useChannel(channel) {
    channel.onopen = () => this.connected({
      send: (message) => {
        if (channel.readyState === "open") {
          channel.send(JSON.stringify(message));
        }
      },
      close: () => channel.close()
    });
    channel.onclose = () => this.closed("the other player left");
    channel.onmessage = (event) => {
      try {
        this.receive(JSON.parse(event.data));
      } catch {
      }
    };
  }
  fail(err) {
    this.status = NET_CLOSED;
    this.log(`[warn] net: ${err?.message || err}`);
    if (this.ui) {
      this.ui.error(String(err?.message || err));
    }
  }
  close() {
    if (this.transport) {
      this.transport.close();
    } else if (this.localChannel) {
      this.localChannel.close();
    }
    if (this.pc) {
      this.pc.close();
    }
    if (this.ui) {
      this.ui.close();
    }
    this.transport = null;
    this.localChannel = null;
    this.pc = null;
    this.status = NET_IDLE;
    this.inbox = [];
    this.current = null;
    this.resetLockstep();
  }
  // ── Incoming ──────────────────────────────────────────────────────────
  receive(message) {
    if (!message || typeof message !== "object") {
      return;
    }
    const other = 1 - this.me;
    switch (message.t) {
      case "msg":
        this.inbox.push({ from: other, type: message.type, value: message.value });
        break;
      case "start":
        this.lock.pendingStart = { seed: message.seed >>> 0, delay: message.delay };
        break;
      case "in":
        this.lock.inputs[other].set(message.f, {
          down: new Set(message.d),
          pressed: new Set(message.p),
          mx: message.mx,
          my: message.my,
          mb: message.mb
        });
        break;
      case "hash":
        this.lock.hashes[other].set(message.f, message.h);
        this.checkHash(message.f);
        break;
      default:
        break;
    }
  }
  // ── Messages ──────────────────────────────────────────────────────────
  sendMessage(type, value) {
    if (this.players < 2) {
      return 0;
    }
    this.send({ t: "msg", type, value: typeof value === "string" ? value : Number(value) || 0 });
    return 1;
  }
  // Takes the next message into `current` (read with net_msg_*): 1, or 0
  // when there is none.
  nextMessage() {
    this.current = this.inbox.shift() || null;
    return this.current ? 1 : 0;
  }
  // ── Lockstep ──────────────────────────────────────────────────────────
  // The host picks the seed and the delay; both sides start on their next
  // frame after the host's message.
  start(delay) {
    if (this.players < 2 || this.lock.active || this.lock.pendingStart) {
      return 0;
    }
    if (this.me === 0) {
      const seed = Math.random() * 4294967296 >>> 0;
      const d = Math.max(1, Math.min(15, Math.round(Number(delay) || DEFAULT_DELAY)));
      this.send({ t: "start", seed, delay: d });
      this.lock.pendingStart = { seed, delay: d };
    }
    return 1;
  }
  get running() {
    return this.lock.active;
  }
  // Called before each frame. Returns false while the other player's input
  // for this frame has not arrived (the frame must wait).
  beforeFrame(runtime) {
    const lock = this.lock;
    if (lock.pendingStart && !lock.active) {
      const { seed, delay } = lock.pendingStart;
      lock.pendingStart = null;
      lock.active = true;
      lock.delay = delay || DEFAULT_DELAY;
      lock.frame = 0;
      lock.sentFor = -1;
      runtime.randomSeed = seed >>> 0;
      this.log(`[net] lockstep started (input delay ${lock.delay} frames)`);
    }
    if (!lock.active) {
      return true;
    }
    const target = lock.frame + lock.delay;
    if (lock.sentFor < target) {
      const input = runtime.captureNetInput();
      lock.inputs[this.me].set(target, input);
      this.send({
        t: "in",
        f: target,
        d: [...input.down],
        p: [...input.pressed],
        mx: input.mx,
        my: input.my,
        mb: input.mb
      });
      lock.sentFor = target;
    }
    const connected = this.status === NET_CONNECTED || this.status === NET_DESYNC;
    const inputFor = (player) => {
      if (lock.frame < lock.delay) {
        return emptyInput();
      }
      return lock.inputs[player].get(lock.frame) || null;
    };
    const mine = inputFor(this.me);
    let theirs = inputFor(1 - this.me);
    if (!theirs) {
      if (connected) {
        return false;
      }
      theirs = emptyInput();
    }
    lock.cur[this.me] = mine || emptyInput();
    lock.cur[1 - this.me] = theirs;
    lock.inputs[0].delete(lock.frame);
    lock.inputs[1].delete(lock.frame);
    return true;
  }
  // Called after each frame that ran.
  afterFrame(vm) {
    const lock = this.lock;
    if (!lock.active) {
      return;
    }
    if (lock.frame % HASH_EVERY === 0 && lock.frame > 0) {
      const h = hashState(vm);
      lock.hashes[this.me].set(lock.frame, h);
      this.send({ t: "hash", f: lock.frame, h });
      this.checkHash(lock.frame);
    }
    lock.frame++;
  }
  checkHash(frame) {
    const mine = this.lock.hashes[this.me].get(frame);
    const theirs = this.lock.hashes[1 - this.me].get(frame);
    if (mine === void 0 || theirs === void 0) {
      return;
    }
    this.lock.hashes[0].delete(frame);
    this.lock.hashes[1].delete(frame);
    if (mine !== theirs && this.status !== NET_DESYNC) {
      this.status = NET_DESYNC;
      this.log(`[warn] net: the two games went out of step at frame ${frame} (something in the game reads key(), the clock or unseeded randomness instead of the shared input)`);
    }
  }
  input(player) {
    return this.lock.cur[Number(player) === 1 ? 1 : 0];
  }
};

// vm/audio.js
var SAMPLE_RATE = 44100;
var WAVE_SQUARE = 0;
var WAVE_TRIANGLE = 1;
var WAVE_SAW = 2;
var WAVE_SINE = 3;
var WAVE_NOISE = 4;
var SFX_COIN = 0;
var SFX_LASER = 1;
var SFX_EXPLOSION = 2;
var SFX_POWERUP = 3;
var SFX_HIT = 4;
var SFX_JUMP = 5;
var SFX_BLIP = 6;
var INST_SQUARE = 0;
var INST_TRIANGLE = 1;
var INST_SAW = 2;
var INST_SINE = 3;
var INST_DRUMS = 4;
var INST_PLUCK = 5;
var INST_PAD = 6;
var INST_BASS = 7;
var STEPS_PER_BEAT = 4;
var LOOKAHEAD = 0.12;
var SCHEDULE_EVERY_MS = 25;
function makeRandom(seed) {
  let a2 = Number(seed) >>> 0 || 2654435769;
  return () => {
    a2 = a2 + 1831565813 >>> 0;
    let t = a2;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function synthesize(recipe) {
  const {
    wave = WAVE_SQUARE,
    freq = 440,
    freqEnd = freq,
    ms: ms2 = 200,
    volume = 0.5,
    attackMs = 4,
    arpAt = 0,
    arpMul = 1,
    vibDepth = 0,
    vibHz = 0,
    lowpass = 0,
    lowpassEnd = lowpass,
    seed = 1
  } = recipe;
  const length = Math.max(1, Math.round(SAMPLE_RATE * Math.max(5, ms2) / 1e3));
  const out = new Float32Array(length);
  const attack = Math.max(1, Math.round(SAMPLE_RATE * attackMs / 1e3));
  const random = makeRandom(seed);
  let phase = 0;
  let noiseValue = random() * 2 - 1;
  let filtered = 0;
  for (let i = 0; i < length; i++) {
    const t = i / length;
    let f = freq + (freqEnd - freq) * t;
    if (arpAt > 0 && t >= arpAt) {
      f *= arpMul;
    }
    if (vibDepth > 0) {
      f *= 1 + vibDepth * Math.sin(2 * Math.PI * vibHz * i / SAMPLE_RATE);
    }
    phase += Math.max(1, f) / SAMPLE_RATE;
    if (phase >= 1) {
      phase -= Math.floor(phase);
      noiseValue = random() * 2 - 1;
    }
    let s;
    switch (wave) {
      case WAVE_TRIANGLE:
        s = 1 - 4 * Math.abs(phase - 0.5);
        break;
      case WAVE_SAW:
        s = 2 * phase - 1;
        break;
      case WAVE_SINE:
        s = Math.sin(2 * Math.PI * phase);
        break;
      case WAVE_NOISE:
        s = noiseValue;
        break;
      default:
        s = phase < 0.5 ? 0.6 : -0.6;
        break;
    }
    if (lowpass > 0) {
      const cutoff = lowpass + (lowpassEnd - lowpass) * t;
      const a2 = 1 - Math.exp(-2 * Math.PI * Math.max(20, cutoff) / SAMPLE_RATE);
      filtered += a2 * (s - filtered);
      s = filtered;
    }
    const env = i < attack ? i / attack : (1 - t) * (1 - t);
    out[i] = s * env * volume;
  }
  return out;
}
function sfxRecipe(kind, seed = 0) {
  const r = makeRandom((Number(seed) || 0) * 7919 + (Number(kind) || 0) + 1);
  const vary = (value, amount) => value * (1 + (r() * 2 - 1) * amount);
  switch (Number(kind)) {
    case SFX_COIN:
      return { wave: WAVE_SQUARE, freq: vary(990, 0.2), ms: vary(260, 0.2), arpAt: 0.22, arpMul: 1.5, volume: 0.45 };
    case SFX_LASER:
      return { wave: r() < 0.5 ? WAVE_SAW : WAVE_SQUARE, freq: vary(1300, 0.3), freqEnd: vary(180, 0.3), ms: vary(170, 0.3), volume: 0.4 };
    case SFX_EXPLOSION:
      return { wave: WAVE_NOISE, freq: vary(900, 0.3), freqEnd: vary(60, 0.3), ms: vary(700, 0.3), lowpass: 5e3, lowpassEnd: 200, volume: 0.9, seed: r() * 1e9 };
    case SFX_POWERUP:
      return { wave: WAVE_SQUARE, freq: vary(350, 0.2), freqEnd: vary(1300, 0.2), ms: vary(420, 0.2), vibDepth: 0.06, vibHz: 18, volume: 0.4 };
    case SFX_HIT:
      return { wave: WAVE_NOISE, freq: vary(1600, 0.3), freqEnd: vary(200, 0.3), ms: vary(130, 0.3), lowpass: 3e3, volume: 0.7, seed: r() * 1e9 };
    case SFX_JUMP:
      return { wave: WAVE_SQUARE, freq: vary(260, 0.2), freqEnd: vary(720, 0.2), ms: vary(190, 0.2), volume: 0.4 };
    case SFX_BLIP:
      return { wave: WAVE_SQUARE, freq: vary(880, 0.25), ms: vary(60, 0.2), volume: 0.35 };
    default: {
      const wave = Math.floor(r() * 5);
      return {
        wave,
        freq: 100 + r() * 1500,
        freqEnd: 100 + r() * 1500,
        ms: 60 + r() * 500,
        arpAt: r() < 0.3 ? 0.3 : 0,
        arpMul: 1 + r(),
        vibDepth: r() < 0.3 ? r() * 0.2 : 0,
        vibHz: 5 + r() * 20,
        lowpass: wave === WAVE_NOISE ? 4e3 : 0,
        lowpassEnd: 300,
        volume: 0.45,
        seed: r() * 1e9
      };
    }
  }
}
var NOTE_INDEX = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
function noteFrequency(token) {
  const m = /^([a-g])([#b]?)(-?\d)$/i.exec(String(token));
  if (!m) {
    return null;
  }
  let semitone = NOTE_INDEX[m[1].toLowerCase()];
  if (m[2] === "#") {
    semitone += 1;
  } else if (m[2] === "b") {
    semitone -= 1;
  }
  const midi = 12 * (Number(m[3]) + 1) + semitone;
  return 440 * Math.pow(2, (midi - 69) / 12);
}
function parseNotes(text, drums = false) {
  const tokens = String(text || "").split(/[\s|]+/).filter((t) => t.length > 0);
  const events = [];
  let last = null;
  tokens.forEach((token, step) => {
    if (token === "-") {
      if (last) {
        last.length++;
      }
      return;
    }
    last = null;
    if (token === ".") {
      return;
    }
    if (drums) {
      const hits = [...token.toLowerCase()].filter((c) => c === "k" || c === "s" || c === "h");
      if (hits.length > 0) {
        events.push({ step, length: 1, drums: hits });
      }
      return;
    }
    const freq = noteFrequency(token);
    if (freq !== null) {
      last = { step, length: 1, freq };
      events.push(last);
    }
  });
  return { events, steps: tokens.length };
}
var sharedContext = null;
function audioContextClass() {
  return typeof window !== "undefined" ? window.AudioContext || window.webkitAudioContext || null : null;
}
var AudioEngine = class {
  constructor({ log = () => {
  } } = {}) {
    this.log = log;
    this.available = !!audioContextClass();
    this.sounds = /* @__PURE__ */ new Map();
    this.nextSoundId = 1;
    this.sfxCache = /* @__PURE__ */ new Map();
    this.channels = /* @__PURE__ */ new Map();
    this.nextChannel = 1;
    this.songs = /* @__PURE__ */ new Map();
    this.nextSongId = 1;
    this.song = null;
    this.soundVolume = 1;
    this.musicVolume = 0.6;
    this.timer = 0;
    this.master = null;
    this.musicBus = null;
    this.stats = { played: 0, skipped: 0, notes: 0 };
    this.drumBuffers = null;
    this.decoder = null;
  }
  // The page-wide AudioContext (browsers limit how many a page may have),
  // with this engine's own output under it.
  context() {
    if (!this.available) {
      return null;
    }
    if (!sharedContext) {
      const Ctx = audioContextClass();
      sharedContext = new Ctx();
    }
    if (!this.master) {
      this.master = sharedContext.createGain();
      this.master.gain.value = this.soundVolume;
      this.master.connect(sharedContext.destination);
      this.musicBus = sharedContext.createGain();
      this.musicBus.gain.value = this.musicVolume;
      this.musicBus.connect(sharedContext.destination);
    }
    return sharedContext;
  }
  // True once the browser lets the page play.
  get running() {
    return !!sharedContext && sharedContext.state === "running";
  }
  // Called on the player's clicks and key presses (the host page and the
  // runtime install the listeners): lets sound start.
  unlock() {
    const ctx = this.context();
    if (ctx && ctx.state !== "running") {
      ctx.resume().then(() => this.startPendingSong()).catch(() => {
      });
    } else {
      this.startPendingSong();
    }
  }
  // ── Sounds ────────────────────────────────────────────────────────────
  addSamples(samples) {
    const id = this.nextSoundId++;
    this.sounds.set(id, { samples, buffer: null, ready: true, error: null });
    return id;
  }
  // A recipe (see synthesize) -> sound id. The same recipe gives the same
  // id: calling sfx() for every shot does not make a new sound each time.
  makeSound(recipe) {
    const key = JSON.stringify(recipe);
    let id = this.sfxCache.get(key);
    if (id === void 0) {
      id = this.addSamples(synthesize(recipe));
      this.sfxCache.set(key, id);
    }
    return id;
  }
  // Loads and decodes a sound file. Returns [id, promise].
  load(url) {
    const id = this.nextSoundId++;
    const entry = { samples: null, buffer: null, ready: false, error: null };
    this.sounds.set(id, entry);
    if (!this.available) {
      entry.error = "no Web Audio in this browser";
      return [id, Promise.resolve()];
    }
    const promise = fetch(url).then((response) => {
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return response.arrayBuffer();
    }).then((bytes) => this.decode(bytes)).then((buffer) => {
      entry.buffer = buffer;
      entry.ready = true;
    }).catch((err) => {
      entry.error = err?.message || String(err);
      this.log(`[warn] load_wav failed (${url}): ${entry.error}`);
    });
    return [id, promise];
  }
  // Decoding needs a context but not the player's permission to play: an
  // OfflineAudioContext does it before the first click.
  decode(bytes) {
    if (!this.decoder) {
      const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      this.decoder = new Offline(1, 1, SAMPLE_RATE);
    }
    return this.decoder.decodeAudioData(bytes);
  }
  bufferOf(entry) {
    if (!entry.buffer && entry.samples) {
      entry.buffer = new AudioBuffer({ length: entry.samples.length, numberOfChannels: 1, sampleRate: SAMPLE_RATE });
      entry.buffer.copyToChannel(entry.samples, 0);
    }
    return entry.buffer;
  }
  // Plays sound `id`: volume 1 = as recorded, rate 1 = normal speed and
  // pitch, pan -1 left .. 1 right. Returns the channel (0 if there is no
  // such sound). Skipped (but still given a channel) while the browser
  // does not yet allow sound, or while a file is still loading.
  play(id, volume = 1, rate = 1, pan = 0) {
    const entry = this.sounds.get(Number(id));
    if (!entry) {
      return 0;
    }
    const channel = this.nextChannel++;
    const record = { source: null, gain: null, panner: null, soundId: Number(id), ended: true };
    this.channels.set(channel, record);
    const ctx = this.context();
    if (!ctx || ctx.state !== "running" || !entry.ready || entry.error) {
      this.stats.skipped++;
      this.pruneChannels();
      return channel;
    }
    const source = ctx.createBufferSource();
    source.buffer = this.bufferOf(entry);
    source.playbackRate.value = Math.max(0.05, Math.min(16, rate));
    const gain = ctx.createGain();
    gain.gain.value = Math.max(0, volume);
    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan));
    source.connect(gain).connect(panner).connect(this.master);
    record.source = source;
    record.gain = gain;
    record.panner = panner;
    record.ended = false;
    source.onended = () => {
      record.ended = true;
    };
    source.start();
    this.stats.played++;
    this.pruneChannels();
    return channel;
  }
  // Forget finished channels once there are many (a program may play a
  // sound every frame for hours).
  pruneChannels() {
    if (this.channels.size < 256) {
      return;
    }
    for (const [channel, record] of this.channels) {
      if (record.ended) {
        this.channels.delete(channel);
      }
    }
  }
  isPlaying(channel) {
    const record = this.channels.get(Number(channel));
    return record && !record.ended ? 1 : 0;
  }
  change(channel, volume, rate, pan) {
    const record = this.channels.get(Number(channel));
    if (!record || record.ended) {
      return 0;
    }
    if (volume !== void 0) {
      record.gain.gain.value = Math.max(0, volume);
    }
    if (rate !== void 0) {
      record.source.playbackRate.value = Math.max(0.05, Math.min(16, rate));
    }
    if (pan !== void 0) {
      record.panner.pan.value = Math.max(-1, Math.min(1, pan));
    }
    return 1;
  }
  // Stops a channel, or every channel when `channel` is 0.
  stop(channel) {
    const stopOne = (record2) => {
      if (record2 && !record2.ended && record2.source) {
        try {
          record2.source.stop();
        } catch {
        }
        record2.ended = true;
      }
    };
    if (!Number(channel)) {
      this.channels.forEach(stopOne);
      return 1;
    }
    const record = this.channels.get(Number(channel));
    stopOne(record);
    return record ? 1 : 0;
  }
  setSoundVolume(value) {
    this.soundVolume = Math.max(0, Math.min(1, value));
    if (this.master) {
      this.master.gain.value = this.soundVolume;
    }
  }
  setMusicVolume(value) {
    this.musicVolume = Math.max(0, Math.min(1, value));
    if (this.musicBus) {
      this.musicBus.gain.value = this.musicVolume;
    }
  }
  // ── Music ─────────────────────────────────────────────────────────────
  newSong(bpm) {
    const id = this.nextSongId++;
    this.songs.set(id, { bpm: Math.max(20, Math.min(400, Number(bpm) || 120)), tracks: [] });
    return id;
  }
  addTrack(songId, instrument, notes, volume = 0.6) {
    const song = this.songs.get(Number(songId));
    if (!song) {
      return 0;
    }
    const inst = Number(instrument) || 0;
    const parsed = parseNotes(notes, inst === INST_DRUMS);
    if (parsed.steps === 0) {
      return 0;
    }
    song.tracks.push({ inst, events: parsed.events, steps: parsed.steps, volume: Math.max(0, Math.min(1, volume)) });
    return song.tracks.length;
  }
  // Starts a song (stopping the one playing). It waits for the browser's
  // permission to play when it does not have it yet.
  playSong(songId, loop = true) {
    const song = this.songs.get(Number(songId));
    if (!song || song.tracks.length === 0) {
      return 0;
    }
    this.stopSong();
    const length = Math.max(...song.tracks.map((t) => t.steps));
    this.song = { id: Number(songId), def: song, loop: !!loop, step: 0, nextTime: 0, length, nodes: /* @__PURE__ */ new Set(), started: false };
    this.startPendingSong();
    return 1;
  }
  startPendingSong() {
    const s = this.song;
    const ctx = this.running ? sharedContext : null;
    if (!s || s.started || !ctx) {
      return;
    }
    this.context();
    s.started = true;
    s.nextTime = ctx.currentTime + 0.05;
    this.schedule();
    this.timer = setInterval(() => this.schedule(), SCHEDULE_EVERY_MS);
  }
  stopSong() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = 0;
    }
    if (this.song) {
      for (const node of this.song.nodes) {
        try {
          node.stop();
        } catch {
        }
      }
      this.song = null;
    }
  }
  get songPlaying() {
    return this.song ? this.song.id : 0;
  }
  // Schedules every step that starts within the lookahead.
  schedule() {
    const s = this.song;
    const ctx = sharedContext;
    if (!s || !ctx) {
      return;
    }
    const stepTime = 60 / s.def.bpm / STEPS_PER_BEAT;
    while (s.nextTime < ctx.currentTime + LOOKAHEAD) {
      if (s.step >= s.length) {
        if (!s.loop) {
          clearInterval(this.timer);
          this.timer = 0;
          const nodes = s.nodes;
          setTimeout(() => nodes.clear(), 2e3);
          this.song = null;
          return;
        }
        s.step = 0;
      }
      for (const track of s.def.tracks) {
        const local = s.step % track.steps;
        for (const event of track.events) {
          if (event.step === local) {
            this.playNote(track, event, s.nextTime, stepTime);
          }
        }
      }
      s.step++;
      s.nextTime += stepTime;
    }
  }
  playNote(track, event, when, stepTime) {
    const ctx = sharedContext;
    const s = this.song;
    const length = event.length * stepTime;
    const remember = (node) => {
      s.nodes.add(node);
      node.onended = () => s.nodes.delete(node);
    };
    this.stats.notes++;
    if (track.inst === INST_DRUMS) {
      const drums = this.drums();
      for (const hit of event.drums) {
        const source = ctx.createBufferSource();
        source.buffer = drums[hit];
        const gain2 = ctx.createGain();
        gain2.gain.value = track.volume;
        source.connect(gain2).connect(this.musicBus);
        source.start(when);
        remember(source);
      }
      return;
    }
    const types = {
      [INST_SQUARE]: "square",
      [INST_TRIANGLE]: "triangle",
      [INST_SAW]: "sawtooth",
      [INST_SINE]: "sine",
      [INST_PLUCK]: "square",
      [INST_PAD]: "sawtooth",
      [INST_BASS]: "triangle"
    };
    const osc = ctx.createOscillator();
    osc.type = types[track.inst] || "square";
    osc.frequency.value = track.inst === INST_BASS ? event.freq / 2 : event.freq;
    const gain = ctx.createGain();
    const peak = track.volume * (osc.type === "square" || osc.type === "sawtooth" ? 0.18 : 0.35);
    const g2 = gain.gain;
    g2.setValueAtTime(0, when);
    let end;
    if (track.inst === INST_PLUCK) {
      g2.linearRampToValueAtTime(peak, when + 5e-3);
      g2.exponentialRampToValueAtTime(1e-4, when + Math.min(length, 0.35));
      end = when + Math.min(length, 0.35);
    } else if (track.inst === INST_PAD) {
      g2.linearRampToValueAtTime(peak * 0.7, when + Math.min(0.3, length * 0.5));
      g2.setValueAtTime(peak * 0.7, when + length * 0.8);
      g2.linearRampToValueAtTime(0, when + length);
      end = when + length;
    } else {
      g2.linearRampToValueAtTime(peak, when + 0.01);
      g2.setValueAtTime(peak, when + Math.max(0.01, length - 0.03));
      g2.linearRampToValueAtTime(0, when + length);
      end = when + length;
    }
    let out = gain;
    if (track.inst === INST_PAD) {
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 1400;
      gain.connect(filter);
      out = filter;
    }
    osc.connect(gain);
    out.connect(this.musicBus);
    osc.start(when);
    osc.stop(end + 0.02);
    remember(osc);
  }
  drums() {
    if (!this.drumBuffers) {
      const toBuffer = (samples) => {
        const buffer = new AudioBuffer({ length: samples.length, numberOfChannels: 1, sampleRate: SAMPLE_RATE });
        buffer.copyToChannel(samples, 0);
        return buffer;
      };
      this.drumBuffers = {
        k: toBuffer(synthesize({ wave: WAVE_SINE, freq: 150, freqEnd: 40, ms: 220, volume: 0.9, attackMs: 1 })),
        s: toBuffer(synthesize({ wave: WAVE_NOISE, freq: 6e3, ms: 160, lowpass: 7e3, lowpassEnd: 2500, volume: 0.5, attackMs: 1, seed: 7 })),
        h: toBuffer(synthesize({ wave: WAVE_NOISE, freq: 12e3, ms: 45, volume: 0.22, attackMs: 1, seed: 3 }))
      };
    }
    return this.drumBuffers;
  }
  // Everything stops; the shared context stays for the next program.
  dispose() {
    this.stopSong();
    this.stop(0);
    if (this.master) {
      this.master.disconnect();
      this.musicBus.disconnect();
      this.master = null;
      this.musicBus = null;
    }
  }
};

// vm/runtime.js
var CType = {
  C_SCREEN: 0,
  C_SCROLL: 1,
  C_M7: 2
};
var Graph = class {
  // A Graph can exist before its pixels do (a process may name a graphic
  // whose load_fpg/load_graphic has not finished). `sized` records whether
  // the real size is known yet. Using "still 32x32" as that signal, as
  // this used to, made every graphic that never had its size registered
  // (new_graphic, load_graphic) draw at 32x32 forever, and would have
  // mistaken a genuine 32x32 graphic for one still loading.
  constructor(fileId, graphId, width, height) {
    this.fileId = Number(fileId) || 0;
    this.graphId = Number(graphId) || 0;
    this.sized = Number(width) > 0 && Number(height) > 0;
    this.width = Number(width) || 32;
    this.height = Number(height) || 32;
    this.points = /* @__PURE__ */ new Map();
    this.pivotDefined = false;
    this.points.set(0, { x: this.width * 0.5, y: this.height * 0.5 });
  }
  setSize(width, height) {
    this.width = Number(width) || this.width;
    this.height = Number(height) || this.height;
    this.sized = true;
    if (!this.pivotDefined) {
      this.points.set(0, { x: this.width * 0.5, y: this.height * 0.5 });
    }
  }
  setPoint(index, x2, y) {
    const pointIndex = Number(index) || 0;
    if (pointIndex === 0) {
      this.pivotDefined = true;
    }
    this.points.set(pointIndex, {
      x: Number(x2) || 0,
      y: Number(y) || 0
    });
  }
  getPoint(index) {
    const pointIndex = Number(index) || 0;
    return this.points.get(pointIndex) || this.points.get(0) || { x: 0, y: 0 };
  }
};
function applyCpointsToGraph(graph, cpoints) {
  if (!graph || !cpoints || !cpoints.length) {
    return;
  }
  cpoints.forEach((cp, index) => {
    if (cp && !cp.undefined) {
      graph.setPoint(index, cp.x, cp.y);
    }
  });
}
var CanvasEngineRuntime = class _CanvasEngineRuntime {
  constructor(options) {
    this.vm = options.vm;
    this.ctx = options.ctx;
    this.width = options.width || this.ctx.canvas.width;
    this.height = options.height || this.ctx.canvas.height;
    this.clearColor = options.clearColor || "#0b1117";
    this.logFn = options.logFn || ((line) => console.log(line));
    this.graphics = options.graphics || new GraphicsManager({ firstId: 1e3 });
    this.libraryGraphics = new GraphicsManager();
    this.backgroundGraph = null;
    this.pendingLoads = [];
    this.pointsVersion = 0;
    this.nextTextId = 1;
    this.maxTexts = Number(options.maxTexts) > 0 ? Number(options.maxTexts) : 512;
    this._warnedTextLimit = false;
    this.keys = {};
    this.keyNameByCode = {};
    this.keysPressedSinceFrame = /* @__PURE__ */ new Set();
    this.keysPressedThisFrame = /* @__PURE__ */ new Set();
    this.keyQueryCache = /* @__PURE__ */ new Map();
    this.drawCommands = [];
    this.currentColor = "#ffffff";
    this.cameraX = 0;
    this.cameraY = 0;
    this.totalTime = 0;
    this.debugDrawProcessBounds = !!options.debugDrawProcessBounds;
    this.debugProcessBoundsColor = options.debugProcessBoundsColor || "#00ffff";
    this.debugShowStats = !!options.debugShowStats;
    this.debugStatsTextColor = options.debugStatsTextColor || "#e6fffb";
    this.debugStatsBgColor = options.debugStatsBgColor || "rgba(6, 10, 18, 0.7)";
    this.debugStatsX = Number(options.debugStatsX) || 8;
    this.debugStatsY = Number(options.debugStatsY) || 8;
    this.fpsValue = 0;
    this.fpsAccumTime = 0;
    this.fpsAccumFrames = 0;
    this.targetFps = _CanvasEngineRuntime.DEFAULT_FPS;
    this.state = {
      scroll: [],
      region: {},
      graphs: {}
    };
    this.bitmapFonts = /* @__PURE__ */ new Map();
    this.nextBitmapFontId = 1;
    this.graphLibraries = /* @__PURE__ */ new Map();
    this.nextGraphLibraryId = 0;
    this.paths = /* @__PURE__ */ new Map();
    this.nextPathId = 1;
    this.pathFollowers = /* @__PURE__ */ new Map();
    this.randomSeed = null;
    this._fade = { active: false, alpha: 0, target: 0, speed: 0, r: 0, g: 0, b: 0 };
    this._mouse = {
      x: 0,
      y: 0,
      buttons: [false, false, false],
      downSinceFrame: [false, false, false],
      frameButtons: [false, false, false]
    };
    this._mouseListeners = [];
    this.physics = new PhysicsWorld();
    this.net = new NetSession({
      iceServers: options.netIceServers,
      ui: options.netUi || null,
      log: (line) => this.logFn(line)
    });
    this.netKeysPressed = /* @__PURE__ */ new Set();
    this.audio = new AudioEngine({ log: (line) => this.logFn(line) });
    this._audioUnlock = null;
    if (typeof window !== "undefined" && this.audio.available) {
      this._audioUnlock = () => this.audio.unlock();
      window.addEventListener("pointerdown", this._audioUnlock, true);
      window.addEventListener("keydown", this._audioUnlock, true);
    }
    this._files = /* @__PURE__ */ new Map();
    this._filesByName = /* @__PURE__ */ new Map();
    if (options.files) {
      this.setFiles(options.files);
    }
    const inputElement = options.inputElement || this.ctx?.canvas;
    if (inputElement && typeof inputElement.addEventListener === "function") {
      this._setupMouseListeners(inputElement);
    }
  }
  _setupMouseListeners(element) {
    const m = this._mouse;
    const toScreen = (e) => {
      const r = element.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) {
        return;
      }
      m.x = Math.round((e.clientX - r.left) * (this.width / r.width));
      m.y = Math.round((e.clientY - r.top) * (this.height / r.height));
    };
    const handlers = {
      mousemove: (e) => {
        toScreen(e);
      },
      mousedown: (e) => {
        toScreen(e);
        m.buttons[e.button] = true;
        m.downSinceFrame[e.button] = true;
      },
      mouseup: (e) => {
        toScreen(e);
        m.buttons[e.button] = false;
      },
      mouseleave: () => {
        m.buttons = [false, false, false];
      },
      // The right button is game input (mouse.right): the browser menu
      // must not open over the program.
      contextmenu: (e) => {
        e.preventDefault();
      }
    };
    for (const [type, handler] of Object.entries(handlers)) {
      element.addEventListener(type, handler);
      this._mouseListeners.push({ element, type, handler });
    }
  }
  // Release everything this runtime attached outside itself. A host that
  // starts several programs on the same canvas (an editor's Run button)
  // must call this for each runtime it replaces: every listener closure
  // otherwise keeps the old runtime and its whole VM alive, and they
  // accumulate with each run.
  // A load_* path in the form project files are keyed by: forward
  // slashes, no leading "./", lower case (DIV programs were written for
  // DOS, where "SHIP.FPG" and "ship.fpg" are the same file).
  static normalizeAssetPath(path) {
    return String(path ?? "").replace(/\\/g, "/").replace(/^(\.\/)+/, "").toLowerCase();
  }
  // Files that come with the program rather than from its URL: the
  // playground's uploads, or the files embedded in a packed game. `files`
  // maps a name (or path) to a Blob, an ArrayBuffer / typed array, or a
  // URL string (data:, blob:, http...). load_graphic, load_tile, load_map,
  // load_fpg, load_fnt and load_bdf_font look a path up here first - by
  // the whole path, then by its file name alone - and only fetch it as a
  // URL when there is no such file.
  setFiles(files) {
    this.revokeFileUrls();
    this._files = /* @__PURE__ */ new Map();
    this._filesByName = /* @__PURE__ */ new Map();
    const entries = files instanceof Map ? files.entries() : Object.entries(files || {});
    for (const [name, data] of entries) {
      const key = _CanvasEngineRuntime.normalizeAssetPath(name);
      if (!key || data == null) {
        continue;
      }
      const entry = { name: String(name), data, url: typeof data === "string" ? data : null, owned: false };
      this._files.set(key, entry);
      const base = key.slice(key.lastIndexOf("/") + 1);
      if (!this._filesByName.has(base)) {
        this._filesByName.set(base, entry);
      }
    }
  }
  // The URL a load_* call should read `src` from: a project file's (an
  // object URL made on first use) or `src` itself.
  resolveAssetUrl(src) {
    const key = _CanvasEngineRuntime.normalizeAssetPath(src);
    const entry = this._files.get(key) || this._filesByName.get(key.slice(key.lastIndexOf("/") + 1));
    if (!entry) {
      return String(src);
    }
    if (!entry.url) {
      const blob = entry.data instanceof Blob ? entry.data : new Blob([entry.data]);
      entry.url = URL.createObjectURL(blob);
      entry.owned = true;
    }
    return entry.url;
  }
  revokeFileUrls() {
    for (const entry of this._files.values()) {
      if (entry.owned) {
        URL.revokeObjectURL(entry.url);
        entry.url = null;
        entry.owned = false;
      }
    }
  }
  dispose() {
    this.revokeFileUrls();
    this.physics.clear();
    this.net.close();
    this.audio.dispose();
    if (this._audioUnlock) {
      window.removeEventListener("pointerdown", this._audioUnlock, true);
      window.removeEventListener("keydown", this._audioUnlock, true);
      this._audioUnlock = null;
    }
    for (const { element, type, handler } of this._mouseListeners) {
      element.removeEventListener(type, handler);
    }
    this._mouseListeners = [];
    this.clearKeyState();
    this._mouse.buttons = [false, false, false];
    this._mouse.downSinceFrame = [false, false, false];
    this._mouse.frameButtons = [false, false, false];
  }
  nextRandom01() {
    if (this.randomSeed === null) {
      return Math.random();
    }
    const a2 = 1664525;
    const c = 1013904223;
    const m = 4294967296;
    this.randomSeed = a2 * this.randomSeed + c >>> 0;
    return this.randomSeed / m;
  }
  getGraphKey(fileId, graphId) {
    return `${Number(fileId) || 0}:${Number(graphId) || 0}`;
  }
  // Returns the metadata (size, control points) of a graphic, creating it
  // on first use. Passing width/height registers the real size; without
  // them the size is taken from the pixels as soon as they are available
  // (new_graphic, load_graphic and load_tile never pass one, and an image
  // only knows its size once it has decoded).
  ensureGraph(fileId, graphId, width, height) {
    const key = this.getGraphKey(fileId, graphId);
    let graph = this.state.graphs[key];
    if (!graph) {
      graph = new Graph(fileId, graphId);
      this.state.graphs[key] = graph;
    }
    if (width !== void 0 || height !== void 0) {
      this.registerGraphSize(graph, width, height);
    } else if (!graph.sized) {
      const graphic = this.getGraphAsset(fileId, graphId);
      if (graphic && graphic.image && graphic.loaded !== false) {
        const w = graphic.sx !== void 0 ? Number(graphic.sw) || 0 : Number(graphic.image.naturalWidth || graphic.image.width) || 0;
        const h = graphic.sx !== void 0 ? Number(graphic.sh) || 0 : Number(graphic.image.naturalHeight || graphic.image.height) || 0;
        if (w > 0 && h > 0) {
          this.registerGraphSize(graph, w, h);
        }
      }
    }
    return graph;
  }
  registerGraphSize(graph, width, height) {
    graph.setSize(width, height);
    this.pointsVersion++;
  }
  // Keys are stored under one canonical name (lowercase, see
  // canonicalKeyName) so a lookup is a single property read.
  //
  // `code` is KeyboardEvent.code, the physical key. DIV's key() tests
  // physical keys - its constants are keyboard scan codes (manual: the
  // scan code "indicates which key has been pressed and not which
  // character has been generated by it") - and event.key is the
  // character, which Shift changes: press A, press Shift, release A and
  // the release said "A" while the press said "a", so "a" stayed down
  // forever. With a code, letters and digits are named from the physical
  // key, and a release always clears whatever name that physical key was
  // pressed under.
  setKeyState(key, isDown, code) {
    let name = _CanvasEngineRuntime.canonicalKeyName(key);
    if (code) {
      const physical = _CanvasEngineRuntime.keyNameFromCode(code);
      if (physical !== null) {
        name = physical;
      }
      if (isDown) {
        this.keyNameByCode[code] = name;
      } else {
        const pressedAs = this.keyNameByCode[code];
        if (pressedAs !== void 0) {
          this.keys[pressedAs] = false;
          delete this.keyNameByCode[code];
        }
      }
    }
    if (isDown && !this.keys[name]) {
      this.keysPressedSinceFrame.add(name);
      this.netKeysPressed.add(name);
    }
    this.keys[name] = !!isDown;
  }
  clearKeyState() {
    for (const key of Object.keys(this.keys)) {
      this.keys[key] = false;
    }
    this.keyNameByCode = {};
    this.keysPressedSinceFrame.clear();
    this.keysPressedThisFrame.clear();
    this.netKeysPressed.clear();
  }
  // Names scripts and hosts use for the same key, mapped to the name keys
  // are stored under.
  static KEY_ALIASES = {
    left: "arrowleft",
    right: "arrowright",
    up: "arrowup",
    down: "arrowdown",
    space: " ",
    spacebar: " ",
    ctrl: "control",
    esc: "escape"
  };
  static canonicalKeyName(key) {
    const lower = String(key).toLowerCase();
    const alias = _CanvasEngineRuntime.KEY_ALIASES[lower];
    return alias !== void 0 ? alias : lower;
  }
  // Physical-key names for the keys whose character depends on Shift
  // (letters, digits, space) and for both sides of each modifier. Other
  // codes return null and keep the event.key name.
  static keyNameFromCode(code) {
    const c = String(code);
    if (c.length === 4 && c.startsWith("Key")) {
      return c[3].toLowerCase();
    }
    if (c.length === 6 && c.startsWith("Digit")) {
      return c[5];
    }
    switch (c) {
      case "Space":
        return " ";
      case "ShiftLeft":
      case "ShiftRight":
        return "shift";
      case "ControlLeft":
      case "ControlRight":
        return "control";
      case "AltLeft":
      case "AltRight":
        return "alt";
      case "MetaLeft":
      case "MetaRight":
        return "meta";
      default:
        return null;
    }
  }
  // Mirrors the real cursor onto the mouse Process (see registerNatives).
  updateMouseProcess() {
    const p = this.mouseProcess;
    if (!p) {
      return;
    }
    p.x = this._mouse.x;
    p.y = this._mouse.y;
    p.locals[0] = p.x;
    p.locals[1] = p.y;
    const pivot = this.getProcessPivot(p) || { x: 0, y: 0 };
    p.cboxes = [{
      shape: "circle",
      code: 0,
      x: Number(pivot.x) || 0,
      y: Number(pivot.y) || 0,
      radius: 1
    }];
  }
  // Reads/writes of `mouse.<field>` that aren't x/y/buttons land here.
  getMouseFieldNative(fieldName) {
    if (!this.mouseProcess) {
      return 0;
    }
    return this.getProcessFieldValue(this.mouseProcess, fieldName);
  }
  setMouseFieldNative(fieldName, value) {
    if (!this.mouseProcess) {
      return 0;
    }
    return this.setProcessFieldValue(this.mouseProcess, fieldName, value);
  }
  beginFrame(dt2) {
    const pressed = this.keysPressedThisFrame;
    pressed.clear();
    this.keysPressedThisFrame = this.keysPressedSinceFrame;
    this.keysPressedSinceFrame = pressed;
    const m = this._mouse;
    for (let b = 0; b < 3; b++) {
      m.frameButtons[b] = m.buttons[b] || m.downSinceFrame[b];
      m.downSinceFrame[b] = false;
    }
    this.updateMouseProcess();
    this.physics.step(this.targetFps > 0 ? 1 / this.targetFps : dt2);
    this.vm.dt = dt2;
    this.totalTime += dt2;
    this.fpsAccumTime += dt2;
    this.fpsAccumFrames += 1;
    if (this.fpsAccumTime >= 0.25) {
      this.fpsValue = this.fpsAccumFrames / this.fpsAccumTime;
      this.fpsAccumTime = 0;
      this.fpsAccumFrames = 0;
    }
    const f = this._fade;
    if (f.active) {
      const step = f.speed / 64;
      if (f.alpha < f.target) {
        f.alpha = Math.min(f.target, f.alpha + step);
      } else if (f.alpha > f.target) {
        f.alpha = Math.max(f.target, f.alpha - step);
      }
      if (f.alpha === f.target) f.active = false;
      else if (Math.abs(f.alpha - f.target) < 1e-9) {
        f.alpha = f.target;
        f.active = false;
      }
    }
  }
  getMemoryStatsText() {
    const perf = globalThis.performance;
    const mem = perf && perf.memory;
    if (!mem || !Number.isFinite(mem.usedJSHeapSize)) {
      return "RAM: n/a";
    }
    const usedMb = mem.usedJSHeapSize / (1024 * 1024);
    const limitMb = Number.isFinite(mem.jsHeapSizeLimit) ? mem.jsHeapSizeLimit / (1024 * 1024) : 0;
    return `RAM: ${usedMb.toFixed(1)}MB / ${limitMb.toFixed(0)}MB`;
  }
  // Colour key for drawProcessDebugOverlay, drawn as a small legend when
  // the shape overlay is on so the markers aren't guesswork.
  static DEBUG_LEGEND = [
    ["#ff2d95", "collision shape"],
    ["#ffffff", "COLLIDING now"],
    ["#ffe600", "pivot (point 0)"],
    ["#00ff6a", "control points"],
    ["#00ffff", "width/height box"],
    ["#7cff5a", "physics body"]
  ];
  drawDebugLegend() {
    if (!this.debugDrawProcessBounds) {
      return;
    }
    const entries = _CanvasEngineRuntime.DEBUG_LEGEND;
    const s = Math.max(0.5, Math.min(1, this.width / 800));
    const fontPx = Math.max(5, Math.round(10 * s));
    const lineHeight = Math.round(12 * s);
    const pad = Math.round(6 * s);
    const swatch = Math.round(8 * s);
    this.ctx.save();
    this.ctx.font = `${fontPx}px JetBrains Mono, Consolas, monospace`;
    this.ctx.textBaseline = "top";
    const textWidth = Math.max(...entries.map(([, label]) => this.ctx.measureText(label).width));
    const boxW = pad * 2 + swatch + 5 + textWidth;
    const boxH = pad * 2 + entries.length * lineHeight;
    const boxX = 4;
    const boxY = this.height - boxH - 4;
    this.ctx.fillStyle = "rgba(0,0,0,0.65)";
    this.ctx.fillRect(boxX, boxY, boxW, boxH);
    entries.forEach(([color, label], i) => {
      const y = boxY + pad + i * lineHeight;
      this.ctx.fillStyle = color;
      this.ctx.fillRect(boxX + pad, y + 1, swatch, swatch);
      this.ctx.fillStyle = "#fff";
      this.ctx.fillText(label, boxX + pad + swatch + 5, y);
    });
    this.ctx.restore();
  }
  // Toggle the collision-shape/pivot overlay at runtime. Exposed to
  // scripts as set_debug() and wired to a key in divjs.js, so it can be
  // flipped on without editing the page that hosts the demo.
  setDebugNative(enabled) {
    if (enabled === void 0) {
      this.debugDrawProcessBounds = !this.debugDrawProcessBounds;
    } else {
      this.debugDrawProcessBounds = !!(Number(enabled) || 0);
    }
    return this.debugDrawProcessBounds ? 1 : 0;
  }
  drawDebugStats() {
    if (!this.debugShowStats) {
      return;
    }
    const allProcesses = this.vm?.processManager?.getAll?.() || [];
    let active = 0;
    let sleeping = 0;
    for (const process of allProcesses) {
      if (process.active && !process.suspended && !process.dead) {
        active += 1;
      } else if (process.suspended && !process.dead) {
        sleeping += 1;
      }
    }
    const lines = [
      `FPS: ${this.fpsValue.toFixed(1)}`,
      `PROC: ${allProcesses.length} (active ${active}, sleep ${sleeping})`,
      this.getMemoryStatsText()
    ];
    this.ctx.save();
    this.ctx.font = "12px JetBrains Mono, Consolas, monospace";
    this.ctx.textBaseline = "top";
    const lineHeight = 15;
    const padX = 8;
    const padY = 6;
    const textWidth = Math.max(...lines.map((line) => this.ctx.measureText(line).width));
    const boxW = textWidth + padX * 2;
    const boxH = lineHeight * lines.length + padY * 2;
    this.ctx.fillStyle = this.debugStatsBgColor;
    this.ctx.fillRect(this.debugStatsX, this.debugStatsY, boxW, boxH);
    this.ctx.fillStyle = this.debugStatsTextColor;
    for (let i = 0; i < lines.length; i++) {
      this.ctx.fillText(lines[i], this.debugStatsX + padX, this.debugStatsY + padY + i * lineHeight);
    }
    this.ctx.restore();
  }
  // DIV's key() returns 1 or 0 (manual: "returns 0 if the key is not
  // pressed or 1 if it is pressed"). It returned true/false, and since
  // EQ compares strictly, "key(_a) == 1" was never true.
  // The query is canonicalised once per distinct argument (a script asks
  // for the same few keys every frame); this used to build an alias
  // table and walk every key ever seen on each call.
  keyDownNative(key) {
    let name = this.keyQueryCache.get(key);
    if (name === void 0) {
      name = _CanvasEngineRuntime.canonicalKeyName(key);
      this.keyQueryCache.set(key, name);
    }
    return this.keys[name] ? 1 : 0;
  }
  // Not a DIV function (DIV only has key(), which is 1 for as long as the
  // key is held). key_pressed() is the edge: 1 only in the frame after the
  // key went down, so "fire once per press" needs no manual latch.
  keyPressedNative(key) {
    let name = this.keyQueryCache.get(key);
    if (name === void 0) {
      name = _CanvasEngineRuntime.canonicalKeyName(key);
      this.keyQueryCache.set(key, name);
    }
    return this.keysPressedThisFrame.has(name) ? 1 : 0;
  }
  keyNative(key) {
    return this.keyDownNative(key);
  }
  // True once the program has asked about this key (key, key_pressed,
  // net_key...): the host page uses it to keep keys such as Tab, which
  // otherwise move the browser's focus, for the programs that play with
  // them.
  readsKey(key) {
    const name = _CanvasEngineRuntime.canonicalKeyName(key);
    for (const asked of this.keyQueryCache.values()) {
      if (asked === name) {
        return true;
      }
    }
    return false;
  }
  setColorNative(color) {
    this.currentColor = String(color);
    return 0;
  }
  setTitleNative() {
    return 0;
  }
  // Classic DIV calls SET_MODE with a single resolution constant
  // (SET_MODE(M640X480)); this engine's own demos call it with explicit
  // (width, height) instead. Support both: when called with one argument
  // that matches a known mode constant (see the negative m320x200/
  // m640x480 entries in compiler.js's builtinConstants), decode it here;
  // otherwise fall back to the plain two-argument form.
  static VIDEO_MODE_TABLE = {
    "-1": [320, 200],
    "-2": [640, 480]
  };
  setModeNative(width, height) {
    if (height === void 0) {
      const mode = _CanvasEngineRuntime.VIDEO_MODE_TABLE[Number(width)];
      if (mode) {
        [width, height] = mode;
      }
    }
    const w = Number(width) || this.width;
    const h = Number(height) || this.height;
    this.width = w;
    this.height = h;
    this.ctx.canvas.width = w;
    this.ctx.canvas.height = h;
    return 0;
  }
  screenColorNative(color) {
    this.clearColor = String(color);
    return 0;
  }
  // DIV's GET_PIXEL(x, y) - reads a pixel straight off the rendered
  // screen, which scripts use for collision against painted scenery
  // (tutor4's worm dies on "get_pixel(x,y)!=0", i.e. anything that isn't
  // the black background). Returns 0 for a fully-black/transparent
  // pixel, non-zero otherwise, approximating DIV's palette-index test
  // closely enough for that "is something there?" idiom.
  // The scenery buffer GET_PIXEL reads, mirroring DIV's `copia2`. DIV
  // keeps the background in its own buffer (exported as "background" in
  // i.c); PUT_SCREEN clears and draws into it, and every frame the
  // visible page is refreshed from it (memcpy(copia, copia2, ...)) before
  // process sprites are blitted on top. So GET_PIXEL sees scenery only -
  // never the sprites. Reading the composited canvas instead, as this
  // used to, made tutor4's worm die on its own trail: the head tests the
  // square ahead, and that square still held the previous frame's
  // rendering of the worm.
  // Builds (or returns the cached) buffer even with no PUT_SCREEN
  // background set - real DIV's copia2 exists from startup and xput/put
  // draw straight into it (see xputNative), independent of whether a
  // background graphic was ever assigned.
  ensureSceneryBuffer() {
    const bg = this.backgroundGraph;
    let graphic = null;
    if (bg) {
      graphic = this.getGraphAsset(bg.fileId, bg.graphId);
      if (!graphic || !graphic.image || graphic.loaded === false) {
        return null;
      }
    }
    const key = bg ? `${bg.fileId}:${bg.graphId}:${this.width}x${this.height}` : `none:${this.width}x${this.height}`;
    if (this._sceneryKey === key && this._sceneryCtx) {
      return this._sceneryCtx;
    }
    const canvas = document.createElement("canvas");
    canvas.width = this.width;
    canvas.height = this.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (bg) {
      this.blitBackground(ctx, graphic, bg.fileId, bg.graphId);
    }
    this._sceneryKey = key;
    this._sceneryCtx = ctx;
    this._sceneryHasXput = false;
    return ctx;
  }
  getPixelNative(x2, y) {
    const px = Math.round(Number(x2) || 0);
    const py = Math.round(Number(y) || 0);
    if (px < 0 || py < 0 || px >= this.width || py >= this.height) {
      return 0;
    }
    const ctx = this.ensureSceneryBuffer();
    if (!ctx) {
      return 0;
    }
    try {
      const data = ctx.getImageData(px, py, 1, 1).data;
      if (data[3] === 0) {
        return 0;
      }
      return data[0] << 16 | data[1] << 8 | data[2];
    } catch (error) {
      return 0;
    }
  }
  // Sets (or clears, when graphId <= 0) a graphic as a static full-screen
  // background, stretched to fill the screen behind every process - same
  // as DIV's put_screen(file, graph).
  // PUT_SCREEN draws the graphic 1:1, anchored at its pivot - DIV does
  // `put_sprite(file,graf,xg,yg,0,100,...)` into the background buffer
  // (f.c:1751), where xg,yg is control point 0 and size 100 means no
  // scaling. Stretching it to fill the screen, as this used to, only
  // looked right when the background happened to match the screen size;
  // anything else was silently rescaled instead of leaving the
  // uncovered area black the way DIV does.
  blitBackground(ctx, graphic, fileId, graphId) {
    const graph = this.ensureGraph(fileId, graphId);
    const pivot = graph.getPoint(0) || { x: 0, y: 0 };
    const dx = Math.round(this.width * 0.5 - (Number(pivot.x) || 0));
    const dy = Math.round(this.height * 0.5 - (Number(pivot.y) || 0));
    if (graphic.sx !== void 0) {
      ctx.drawImage(graphic.image, graphic.sx, graphic.sy, graphic.sw, graphic.sh, dx, dy, graphic.sw, graphic.sh);
    } else {
      ctx.drawImage(graphic.image, dx, dy);
    }
  }
  putScreenNative(fileId, graphId) {
    this._sceneryKey = null;
    this._sceneryCtx = null;
    const gid = Number(graphId) || 0;
    if (gid <= 0) {
      this.backgroundGraph = null;
      return 0;
    }
    this.backgroundGraph = { fileId: Number(fileId) || 0, graphId: gid };
    return 0;
  }
  drawBackgroundGraph() {
    this.flushPendingXputs();
    if (this._sceneryHasXput) {
      const scenery = this.ensureSceneryBuffer();
      if (scenery && this._sceneryHasXput) {
        this.ctx.drawImage(scenery.canvas, 0, 0);
        return;
      }
    }
    if (!this.backgroundGraph) {
      return;
    }
    const { fileId, graphId } = this.backgroundGraph;
    const graphic = this.getGraphAsset(fileId, graphId);
    if (!graphic || !graphic.image || graphic.loaded === false) {
      return;
    }
    this.blitBackground(this.ctx, graphic, fileId, graphId);
  }
  static DEFAULT_FPS = 18;
  static MIN_FPS = 4;
  static MAX_FPS = 200;
  // set_fps(fps, omissions): the manual allows 4 to 200 frames per second.
  // The second argument (frames that may be skipped on a slow machine) is
  // not implemented - the host loop never skips ticks.
  setFpsNative(fps) {
    const value = Number(fps);
    const valid = Number.isFinite(value) ? value : _CanvasEngineRuntime.DEFAULT_FPS;
    this.targetFps = Math.min(_CanvasEngineRuntime.MAX_FPS, Math.max(_CanvasEngineRuntime.MIN_FPS, valid));
    return 0;
  }
  // Real DIV exposes FPS as a bare read-only global (see the `fps`
  // identifier special-case in compiler.js); get_process_count has no
  // direct DIV equivalent but covers the other half of a typical
  // hand-written stats process ("FPS: 60 | procs: 12").
  getFpsNative() {
    return Math.round(this.fpsValue) || 0;
  }
  getProcessCountNative(activeOnly) {
    const all = (this.vm?.processManager?.getAll?.() || []).filter((p) => !p.isMouse);
    if (!activeOnly) {
      return all.length;
    }
    return all.filter((p) => p.active && !p.suspended && !p.dead).length;
  }
  toRadiansFromDivAngle(angle) {
    return (Number(angle) || 0) / 1e3 * (Math.PI / 180);
  }
  // DIV angles grow counter-clockwise with 90000 pointing up (manual 8.7),
  // but screen y grows downwards. This is the same angle as a rotation in
  // screen space (canvas rotate, clockwise-positive): its negation.
  screenRadiansFromDivAngle(angle) {
    return -this.toRadiansFromDivAngle(angle);
  }
  toDivAngleFromRadians(radians) {
    return (Number(radians) || 0) * 180 / Math.PI * 1e3;
  }
  absNative(value) {
    return Math.abs(Number(value) || 0);
  }
  sinNative(angle) {
    return Math.sin(this.toRadiansFromDivAngle(angle));
  }
  cosNative(angle) {
    return Math.cos(this.toRadiansFromDivAngle(angle));
  }
  tanNative(angle) {
    return Math.tan(this.toRadiansFromDivAngle(angle));
  }
  asinNative(value) {
    return this.toDivAngleFromRadians(Math.asin(Number(value) || 0));
  }
  acosNative(value) {
    return this.toDivAngleFromRadians(Math.acos(Number(value) || 0));
  }
  atanNative(value) {
    return this.toDivAngleFromRadians(Math.atan(Number(value) || 0));
  }
  atan2Native(y, x2) {
    return this.toDivAngleFromRadians(Math.atan2(Number(y) || 0, Number(x2) || 0));
  }
  sqrtNative(value) {
    return Math.sqrt(Math.max(0, Number(value) || 0));
  }
  powNative(base, exp) {
    return Math.pow(Number(base) || 0, Number(exp) || 0);
  }
  floorNative(value) {
    return Math.floor(Number(value) || 0);
  }
  ceilNative(value) {
    return Math.ceil(Number(value) || 0);
  }
  roundNative(value) {
    return Math.round(Number(value) || 0);
  }
  normalizeAngleNative(angle) {
    const fullTurn = 36e4;
    let a2 = Number(angle) || 0;
    a2 %= fullTurn;
    if (a2 < 0) {
      a2 += fullTurn;
    }
    return a2;
  }
  signNative(value) {
    const v = Number(value) || 0;
    if (v > 0) return 1;
    if (v < 0) return -1;
    return 0;
  }
  distanceNative(x1, y1, x2, y2) {
    const dx = (Number(x2) || 0) - (Number(x1) || 0);
    const dy = (Number(y2) || 0) - (Number(y1) || 0);
    return Math.hypot(dx, dy);
  }
  distanceRectNative(px, py, rx, ry, rw, rh) {
    const x2 = Number(px) || 0;
    const y = Number(py) || 0;
    const rectX = Number(rx) || 0;
    const rectY = Number(ry) || 0;
    const rectW = Math.max(0, Number(rw) || 0);
    const rectH = Math.max(0, Number(rh) || 0);
    const dx = Math.max(rectX - x2, 0, x2 - (rectX + rectW));
    const dy = Math.max(rectY - y, 0, y - (rectY + rectH));
    return Math.hypot(dx, dy);
  }
  fgetAngleNative(x1, y1, x2, y2) {
    const dx = (Number(x2) || 0) - (Number(x1) || 0);
    const dy = (Number(y2) || 0) - (Number(y1) || 0);
    return this.toDivAngleFromRadians(Math.atan2(-dy, dx));
  }
  fgetDistanceNative(x1, y1, x2, y2) {
    return this.distanceNative(x1, y1, x2, y2);
  }
  hermiteNative(fromValue, toValue, t) {
    const a2 = Number(fromValue) || 0;
    const b = Number(toValue) || 0;
    const u = this.clampNative(Number(t) || 0, 0, 1);
    const h = u * u * (3 - 2 * u);
    return a2 + (b - a2) * h;
  }
  // get_distx(angle, distance) / get_disty(angle, distance), in the
  // manual's argument order. get_disty is negative for angles pointing up,
  // so x += get_distx(a, d); y += get_disty(a, d); is advance(d) at angle a.
  getDistXNative(angle, distance) {
    const dist = Number(distance) || 0;
    const rad = this.toRadiansFromDivAngle(angle);
    return Math.cos(rad) * dist;
  }
  getDistYNative(angle, distance) {
    const dist = Number(distance) || 0;
    const rad = this.toRadiansFromDivAngle(angle);
    return -Math.sin(rad) * dist;
  }
  toRadNative(angle) {
    return this.toRadiansFromDivAngle(angle);
  }
  toDegNative(radians) {
    return this.toDivAngleFromRadians(radians);
  }
  pingPongNative(t, length) {
    const l = Math.abs(Number(length) || 0);
    if (l <= 1e-9) {
      return 0;
    }
    const period = l * 2;
    let x2 = Number(t) || 0;
    x2 %= period;
    if (x2 < 0) {
      x2 += period;
    }
    return x2 <= l ? x2 : period - x2;
  }
  wrapNative(value, min, max) {
    const v = Number(value) || 0;
    let lo2 = Number(min) || 0;
    let hi2 = Number(max) || 0;
    if (lo2 === hi2) {
      return lo2;
    }
    if (lo2 > hi2) {
      const tmp = lo2;
      lo2 = hi2;
      hi2 = tmp;
    }
    const range = hi2 - lo2;
    let out = (v - lo2) % range;
    if (out < 0) {
      out += range;
    }
    return lo2 + out;
  }
  lerpAngleNative(fromAngle, toAngle, t) {
    const from = Number(fromAngle) || 0;
    const to2 = Number(toAngle) || 0;
    const factor = Number(t) || 0;
    const fullTurn = 36e4;
    const halfTurn = fullTurn / 2;
    let delta = (to2 - from) % fullTurn;
    if (delta < -halfTurn) {
      delta += fullTurn;
    } else if (delta > halfTurn) {
      delta -= fullTurn;
    }
    return from + delta * factor;
  }
  clampNative(value, min, max) {
    const v = Number(value) || 0;
    let lo2 = Number(min) || 0;
    let hi2 = Number(max) || 0;
    if (lo2 > hi2) {
      const tmp = lo2;
      lo2 = hi2;
      hi2 = tmp;
    }
    return Math.max(lo2, Math.min(hi2, v));
  }
  lerpNative(fromValue, toValue, t) {
    const a2 = Number(fromValue) || 0;
    const b = Number(toValue) || 0;
    const factor = Number(t) || 0;
    return a2 + (b - a2) * factor;
  }
  smoothStepNative(min, max, value) {
    const lo2 = Number(min) || 0;
    const hi2 = Number(max) || 0;
    const v = Number(value) || 0;
    if (Math.abs(hi2 - lo2) <= 1e-9) {
      return 0;
    }
    const t = this.clampNative((v - lo2) / (hi2 - lo2), 0, 1);
    return t * t * (3 - 2 * t);
  }
  randSeedNative(seed) {
    if (seed === void 0 || seed === null) {
      this.randomSeed = null;
      return 0;
    }
    this.randomSeed = Number(seed) >>> 0;
    return 1;
  }
  randNative(min, max) {
    const hasMax = max !== void 0;
    const lo2 = hasMax ? Number(min) || 0 : 0;
    const hi2 = hasMax ? Number(max) || 0 : Number(min) || 0;
    const low = Math.min(lo2, hi2);
    const high = Math.max(lo2, hi2);
    const value = low + Math.floor(this.nextRandom01() * (high - low + 1));
    return value;
  }
  randomNative(min, max) {
    return this.randNative(min, max);
  }
  getProcessLocalSlot(process, localName) {
    if (!this.vm?.processTable || !process) {
      return null;
    }
    const info = this.vm.processTable.get(process.name);
    if (!info) {
      return null;
    }
    if (info.locals && Object.prototype.hasOwnProperty.call(info.locals, localName)) {
      return info.locals[localName];
    }
    return null;
  }
  getCurrentProcessAngle() {
    const process = this.vm?.currentProcess;
    if (!process) {
      return 0;
    }
    const angleSlot = this.getProcessLocalSlot(process, "angle");
    if (angleSlot !== null && angleSlot !== void 0) {
      return Number(process.locals[angleSlot] ?? 0) || 0;
    }
    return Number(process.angle ?? 0) || 0;
  }
  moveCurrentProcess(distance, angleDiv) {
    const process = this.vm?.currentProcess;
    if (!process) {
      return 0;
    }
    const dist = Number(distance) || 0;
    const rad = this.toRadiansFromDivAngle(angleDiv);
    const dx = Math.cos(rad) * dist;
    const dy = -Math.sin(rad) * dist;
    process.locals[0] = (Number(process.locals[0]) || 0) + dx;
    process.locals[1] = (Number(process.locals[1]) || 0) + dy;
    process.x = process.locals[0];
    process.y = process.locals[1];
    return 0;
  }
  advanceNative(distance, explicitAngle) {
    const angle = explicitAngle !== void 0 ? Number(explicitAngle) || 0 : this.getCurrentProcessAngle();
    return this.moveCurrentProcess(distance, angle);
  }
  xadvanceNative(distance, angle) {
    return this.moveCurrentProcess(distance, angle);
  }
  xputNative() {
    const [fileId, graphId, x2, y, angle, size, flags, region] = arguments;
    const put = {
      fileId: Number(fileId) || 0,
      graphId: Number(graphId) || 0,
      x: Number(x2) || 0,
      y: Number(y) || 0,
      angle: Number(angle) || 0,
      size: Number(size) || 100,
      flags: Number(flags) || 0
    };
    if (this.ensureSceneryBuffer()) {
      if (!this.xputIntoScenery(put) && this.isGraphPending(put.fileId, put.graphId)) {
        this.queuePendingXput(put);
      }
      return 1;
    }
    this.queuePendingXput(put);
    this.drawCommands.push({
      type: "xput",
      fileId: Number(fileId) || 0,
      graphId: Number(graphId) || 0,
      x: Number(x2) || 0,
      y: Number(y) || 0,
      angle: Number(angle) || 0,
      size: Number(size) || 100,
      flags: Number(flags) || 0,
      region: Number(region) || 0,
      color: this.currentColor,
      ctype: this.getCurrentCType()
    });
    return 1;
  }
  xputIntoScenery(put) {
    const sceneryCtx = this.ensureSceneryBuffer();
    if (!sceneryCtx) {
      return false;
    }
    const prevCtx = this.ctx;
    this.ctx = sceneryCtx;
    let drawn = false;
    try {
      drawn = this.drawGraphSprite(put.fileId, put.graphId, put.x, put.y, put.angle, put.size, put.size, put.flags);
    } finally {
      this.ctx = prevCtx;
    }
    this._sceneryHasXput = true;
    return drawn;
  }
  // True while a graphic can still appear: its FPG is loading, or its
  // load_map/load_graphic image has not decoded yet.
  isGraphPending(fileId, graphId) {
    const lib = this.graphLibraries.get(Number(fileId) || 0);
    if (lib && !lib.loaded && !lib.error) {
      return true;
    }
    const graphic = this.getGraphAsset(fileId, graphId);
    return !!graphic && graphic.loaded === false;
  }
  queuePendingXput(put) {
    if (!this._pendingXputs) {
      this._pendingXputs = [];
    }
    if (this._pendingXputs.length < 256) {
      this._pendingXputs.push(put);
    }
  }
  flushPendingXputs() {
    const pending = this._pendingXputs;
    if (!pending || pending.length === 0) {
      return;
    }
    this._pendingXputs = pending.filter((put) => {
      if (this.xputIntoScenery(put)) {
        return false;
      }
      return !this._sceneryCtx || this.isGraphPending(put.fileId, put.graphId);
    });
  }
  setPointNative(fileId, graphId, pointIndex, x2, y) {
    const graph = this.ensureGraph(fileId, graphId);
    graph.setPoint(pointIndex, x2, y);
    this.pointsVersion++;
    return 1;
  }
  // GET_POINT gives where a control point was originally placed in a
  // graphic (manual 9788, unlike get_real_point's current position).
  // Two forms:
  // - get_point(file, graph, point, OFFSET x, OFFSET y) stores x and y in
  //   the two variables and returns 0 - the DIV form. Its reference page
  //   is missing from the manual's text; the signature is inferred from
  //   get_real_point's OFFSET pair plus the file/graph a map needs.
  // - get_point(file, graph, point, axis) is this engine's own scalar
  //   form (axis 0 = x, 1 = y), also behind get_point_x/_y.
  getPointNative(fileId, graphId, pointIndex, axisOrX, offsetY) {
    const graph = this.ensureGraph(fileId, graphId);
    const point = graph.getPoint(pointIndex);
    if (this.isOffsetRef(axisOrX) && this.isOffsetRef(offsetY)) {
      this.writeOffsetRef(axisOrX, point.x);
      this.writeOffsetRef(offsetY, point.y);
      return 0;
    }
    return Number(axisOrX) === 1 ? point.y : point.x;
  }
  isMirrorX(flags) {
    const f = Number(flags) || 0;
    return f === 1 || f === 3 || f === 5 || f === 7;
  }
  isMirrorY(flags) {
    const f = Number(flags) || 0;
    return f === 2 || f === 3 || f === 6 || f === 7;
  }
  computeRealPoint(fileId, graphId, pointIndex, x2, y, angle, size, flags, scaleXPct, scaleYPct) {
    const graph = this.ensureGraph(fileId, graphId);
    const pivot = graph.getPoint(0);
    const point = graph.getPoint(pointIndex);
    const sizePct = Number(size) || 100;
    const scaleX = (scaleXPct !== void 0 ? Number(scaleXPct) || 0 : sizePct) / 100;
    const scaleY = (scaleYPct !== void 0 ? Number(scaleYPct) || 0 : sizePct) / 100;
    let dx = (point.x - pivot.x) * scaleX;
    let dy = (point.y - pivot.y) * scaleY;
    if (this.isMirrorX(flags)) {
      dx = -dx;
    }
    if (this.isMirrorY(flags)) {
      dy = -dy;
    }
    const rad = this.screenRadiansFromDivAngle(angle);
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    return {
      x: (Number(x2) || 0) + (dx * cos - dy * sin),
      y: (Number(y) || 0) + (dx * sin + dy * cos)
    };
  }
  getCurrentGraphId() {
    const process = this.vm?.currentProcess;
    if (!process) {
      return 0;
    }
    const graphSlot = this.getProcessLocalSlot(process, "graph");
    if (graphSlot !== null && graphSlot !== void 0) {
      return Number(process.locals[graphSlot] ?? 0) || 0;
    }
    return Number(process.graph ?? 0) || 0;
  }
  getCurrentProcessLocalValue(localName, fallbackValue) {
    const process = this.vm?.currentProcess;
    if (!process) {
      return fallbackValue;
    }
    const slot = this.getProcessLocalSlot(process, localName);
    if (slot !== null && slot !== void 0) {
      const value = Number(process.locals[slot]);
      if (Number.isFinite(value)) {
        return value;
      }
    }
    return fallbackValue;
  }
  // DIV's GET_REAL_POINT(<point>, OFFSET x, OFFSET y) stores the point's
  // current position in the two variables and returns nothing useful
  // (manual: "The function needs the address ... of two variables in
  // which it will return the x and y position of the control point").
  // This used to return a {x, y} JS object, which landed on the VM stack
  // and turned any arithmetic on it into string concatenation. The
  // engine's own (point) and (file, graph, point) forms have no variable
  // to write into, so they return 0; get_real_point_x/_y give scalars.
  getRealPointNative(...args) {
    if (args.length >= 3 && this.isOffsetRef(args[1]) && this.isOffsetRef(args[2])) {
      const point = this.computeCurrentRealPoint(args[0]);
      this.writeOffsetRef(args[1], point.x);
      this.writeOffsetRef(args[2], point.y);
      return 0;
    }
    if (!this._warnedRealPoint) {
      this._warnedRealPoint = true;
      this.logFn("[warn] get_real_point(point, OFFSET x, OFFSET y) needs two OFFSET variables; use get_real_point_x()/get_real_point_y() for a value");
    }
    return 0;
  }
  computeCurrentRealPoint(...args) {
    const process = this.vm?.currentProcess;
    const argc = args.length;
    let fileId = process ? this.getProcessGraphRef(process).fileId : 0;
    let graphId = this.getCurrentGraphId();
    let pointIndex = 0;
    if (argc >= 3) {
      fileId = Number(args[0]) || 0;
      graphId = Number(args[1]) || 0;
      pointIndex = Number(args[2]) || 0;
    } else if (argc >= 1) {
      pointIndex = Number(args[0]) || 0;
    }
    const x2 = Number(process?.locals?.[0] ?? 0) || 0;
    const y = Number(process?.locals?.[1] ?? 0) || 0;
    const angle = this.getCurrentProcessAngle();
    const size = this.getCurrentProcessLocalValue("size", 100);
    const flags = this.getCurrentProcessLocalValue("flags", 0);
    const scaleX = process ? this.getProcessLocalNumberAliased(process, ["scale_x", "scalex"], 100) : 100;
    const scaleY = process ? this.getProcessLocalNumberAliased(process, ["scale_y", "scaley"], 100) : 100;
    const scaleXPct = size * (scaleX / 100);
    const scaleYPct = size * (scaleY / 100);
    return this.computeRealPoint(fileId, graphId, pointIndex, x2, y, angle, size, flags, scaleXPct, scaleYPct);
  }
  getRealPointXNative(...args) {
    return this.computeCurrentRealPoint(...args).x;
  }
  getRealPointYNative(...args) {
    return this.computeCurrentRealPoint(...args).y;
  }
  defineRegionNative(id, x2, y, width, height) {
    const rid = Number(id) || 0;
    this.state.region[rid] = {
      x: Number(x2) || 0,
      y: Number(y) || 0,
      // Only an omitted size means "the screen's"; an explicit 0 is an
      // empty region, not a silent 320x200 one.
      width: width === void 0 ? this.width : Math.max(0, Number(width) || 0),
      height: height === void 0 ? this.height : Math.max(0, Number(height) || 0)
    };
    return rid;
  }
  startScrollNative(index, fileId, graphId, backId, regionId, flags) {
    const idx = Number(index) || 0;
    const entry = this.ensureScrollEntry(idx);
    entry.active = 1;
    entry.fileId = Number(fileId) || 0;
    entry.graphId = Number(graphId) || 0;
    entry.backId = Number(backId) || 0;
    entry.region = Number(regionId) || 0;
    entry.flags = Number(flags) || 0;
    if (entry.alpha === void 0) {
      entry.alpha = 100;
    }
    return idx;
  }
  stopScrollNative(index) {
    const idx = Number(index) || 0;
    const entry = this.ensureScrollEntry(idx);
    entry.active = 0;
    return 0;
  }
  getCurrentProcessBounds() {
    const process = this.vm?.currentProcess;
    if (!process) {
      return null;
    }
    const resRaw = Number(process.locals?.[14] ?? process.resolution ?? 0) || 0;
    const res = resRaw > 0 ? resRaw : 1;
    const cx = (Number(process.locals?.[0] ?? process.x ?? 0) || 0) / res;
    const cy = (Number(process.locals?.[1] ?? process.y ?? 0) || 0) / res;
    const width = Number(process.locals?.[2] ?? process.width ?? 0) || 0;
    const height = Number(process.locals?.[3] ?? process.height ?? 0) || 0;
    return { x: cx - width * 0.5, y: cy - height * 0.5, width, height };
  }
  outOfRegionNative(regionId = 0) {
    const bounds = this.getCurrentProcessBounds();
    if (!bounds) {
      return 0;
    }
    const region = this.getRegionRect(regionId);
    const right = region.x + region.width;
    const bottom = region.y + region.height;
    const processRight = bounds.x + bounds.width;
    const processBottom = bounds.y + bounds.height;
    const isOutside = bounds.x < region.x || bounds.y < region.y || processRight > right || processBottom > bottom;
    return isOutside ? 1 : 0;
  }
  outOfScreenNative() {
    return this.outOfRegionNative(0);
  }
  // DIV's OUT_REGION(processId, regionId) - differs from out_of_region
  // above in two ways: it names the process explicitly (rather than
  // always using the current one), and it's true only once the graphic
  // is *completely* outside the region, not merely touching the edge.
  // tutor1b relies on both: "WHILE (NOT out_region(id,0))" keeps a shot
  // alive until it has fully left the screen.
  outRegionNative(processId, regionId = 0) {
    const process = this.vm?.processManager?.get(Number(processId) || 0);
    if (!process) {
      if (!this._warnedOutRegion) {
        this._warnedOutRegion = true;
        this.logFn(`[warn] out_region(): no process with id ${processId}`);
      }
      return 0;
    }
    const width = Number(process.width) || 0;
    const height = Number(process.height) || 0;
    const res = typeof process.getResolution === "function" ? process.getResolution() : 1;
    const left = (Number(process.x) || 0) / res - width * 0.5;
    const top = (Number(process.y) || 0) / res - height * 0.5;
    const right = left + width;
    const bottom = top + height;
    const region = this.getRegionRect(regionId);
    const isFullyOutside = right < region.x || bottom < region.y || left > region.x + region.width || top > region.y + region.height;
    return isFullyOutside ? 1 : 0;
  }
  // An OFFSET <global> argument compiles to a live-reference descriptor
  // (see compileOffsetOperator) instead of a snapshotted value - resolve
  // it against the VM's current globals every time the text is drawn, so
  // "WRITE_INT(..., OFFSET score)" keeps showing the up-to-date score
  // without the script redrawing it. Anything else passes straight
  // through as an ordinary value.
  // Two kinds: { __divOffsetGlobal, slot } (a GLOBAL, a compile-time
  // constant) and { __divOffsetLocal, locals, slot, processId } (made by
  // __offset_local at run time: the locals array of the process or
  // FUNCTION call that evaluated OFFSET, which stays valid as long as the
  // reference is held).
  isOffsetRef(value) {
    return !!value && typeof value === "object" && (value.__divOffsetGlobal === true || value.__divOffsetLocal === true);
  }
  resolveOffsetRef(value) {
    if (!this.isOffsetRef(value)) {
      return value;
    }
    const raw = value.__divOffsetLocal ? value.locals[value.slot] : this.vm?.globals?.get(value.slot);
    return raw === void 0 ? 0 : raw;
  }
  // Store through an OFFSET reference (get_real_point, get_point). A
  // process field written this way is mirrored onto the Process at once,
  // like the VM's own STORE_LOCAL, so collision and drawing see it.
  writeOffsetRef(ref, value) {
    if (ref.__divOffsetGlobal) {
      this.vm?.globals?.set(ref.slot, value);
      return;
    }
    ref.locals[ref.slot] = value;
    const process = this.vm?.processManager?.get(Number(ref.processId) || 0);
    const field = VM.CANONICAL_SLOT_FIELDS[ref.slot];
    if (process && process.locals === ref.locals && field !== void 0) {
      process[field] = value;
      if (ref.slot === 2 || ref.slot === 3) {
        process.sizeFromScript = true;
      }
    }
  }
  // OFFSET <local variable>: see compileOffsetOperator.
  offsetLocalNative(slot) {
    return {
      __divOffsetLocal: true,
      locals: this.vm.locals,
      slot: Number(slot),
      processId: this.vm.currentProcess ? this.vm.currentProcess.id : 0
    };
  }
  countPersistentTexts() {
    let count = 0;
    for (const cmd of this.drawCommands) {
      if (cmd.type === "text" && cmd.persistent) {
        count += 1;
      }
    }
    return count;
  }
  writeNative(font, x2, y, align, text) {
    if (this.drawCommands.length >= this.maxTexts && this.countPersistentTexts() >= this.maxTexts) {
      if (!this._warnedTextLimit) {
        this._warnedTextLimit = true;
        this.logFn(
          `[warn] write(): ${this.maxTexts} texts already on screen - new texts are ignored. WRITE texts stay until delete_text(), so write them once (use OFFSET for values that change) or use text() to draw something for a single frame.`
        );
      }
      return 0;
    }
    const isOffset = this.isOffsetRef(text);
    const id = this.nextTextId++;
    this.drawCommands.push({
      type: "text",
      id,
      // Every WRITE text persists until DELETE_TEXT removes it - that is
      // what DIV does (f.c's write/delete_text), not just the
      // OFFSET-backed ones. Marking only OFFSET texts persistent meant a
      // plain write() drawn once from MAIN showed for a single frame and
      // then vanished, e.g. tutor5's "Use mouse to move snake."
      persistent: true,
      x: Number(x2),
      y: Number(y),
      // Keep the descriptor itself when it's an OFFSET, so the draw pass
      // re-resolves it; plain values are stringified once here as before.
      text: isOffset ? text : String(text),
      color: this.currentColor,
      ctype: this.getCurrentCType(),
      fontId: Number(font) || 0,
      align: Number(align) || 0
    });
    return id;
  }
  // DIV's DELETE_TEXT(id) - removes a text created by WRITE/WRITE_INT.
  // id 0 (DIV's all_text) clears all of them - "all the texts displayed in
  // the program with the write() and write_int() functions" (manual). It
  // used to remove this frame's text() drawings too.
  deleteTextNative(textId) {
    const id = Number(textId) || 0;
    this.drawCommands = this.drawCommands.filter((cmd) => {
      if (cmd.type !== "text" || !cmd.persistent) {
        return true;
      }
      return id !== 0 && cmd.id !== id;
    });
    return 0;
  }
  writeIntNative(font, x2, y, align, value) {
    if (this.isOffsetRef(value)) {
      return this.writeNative(font, x2, y, align, { ...value, asInt: true });
    }
    return this.writeNative(font, x2, y, align, Math.floor(Number(value) || 0));
  }
  // Not a DIV function: drops this frame's drawings (circle, text,
  // draw_rect...). WRITE texts are kept - in DIV they stay "until deleted
  // with the delete_text() function" (manual).
  clearNative() {
    this.drawCommands = this.drawCommands.filter((cmd) => cmd.persistent);
    return 0;
  }
  // Engine-internal scroll position (not exposed as script native).
  setScrollPosition(x2, y) {
    this.cameraX = Number(x2) || 0;
    this.cameraY = Number(y) || 0;
  }
  getCurrentCType() {
    return this.vm?.currentProcess?.ctype ?? CType.C_SCREEN;
  }
  circleNative(x2, y, radius) {
    this.drawCommands.push({
      type: "circle",
      x: Number(x2),
      y: Number(y),
      r: Math.max(0, Number(radius)),
      color: this.currentColor,
      ctype: this.getCurrentCType()
    });
    return 0;
  }
  textNative(x2, y, text) {
    this.drawCommands.push({
      type: "text",
      x: Number(x2),
      y: Number(y),
      text: String(text),
      color: this.currentColor,
      ctype: this.getCurrentCType()
    });
    return 0;
  }
  rectNative(x2, y, width, height, color) {
    this.drawCommands.push({
      type: "rect",
      x: Number(x2),
      y: Number(y),
      width: Number(width),
      height: Number(height),
      color: color !== void 0 ? String(color) : this.currentColor,
      ctype: this.getCurrentCType()
    });
    return 0;
  }
  logNative(...values) {
    this.logFn(`[log] ${values.map((v) => String(v)).join(" ")}`);
    return 0;
  }
  printNative(...values) {
    this.logFn(`[print] ${values.map((v) => String(v)).join(" ")}`);
    return 0;
  }
  // phys_* natives: see vm/physics.js and docs/natives.md. They act on the
  // calling process's body (created by the first phys_box / phys_circle /
  // phys_edge); an id argument names another process.
  // This player's input for one lockstep frame (vm/net.js): the keys held,
  // the keys that went down since the previous capture, and the mouse
  // (buttons as a bit mask: 1 left, 2 middle, 4 right; a click shorter
  // than a frame still counts).
  captureNetInput() {
    const down = /* @__PURE__ */ new Set();
    for (const name of Object.keys(this.keys)) {
      if (this.keys[name]) {
        down.add(name);
      }
    }
    const pressed = this.netKeysPressed;
    this.netKeysPressed = /* @__PURE__ */ new Set();
    const m = this._mouse;
    let mb = 0;
    for (let b = 0; b < 3; b++) {
      if (m.buttons[b] || m.downSinceFrame[b]) {
        mb |= 1 << b;
      }
    }
    return { down, pressed, mx: Math.round(m.x), my: Math.round(m.y), mb };
  }
  // DIV scales volume and frequency with 256 as "normal"; play_sound uses
  // percentages.
  registerAudioNatives() {
    const audio = this.audio;
    const load = (path) => {
      if (!path) {
        return 0;
      }
      const [id, promise] = audio.load(this.resolveAssetUrl(path));
      this.pendingLoads.push(promise);
      return id;
    };
    const num = (value, fallback) => value === void 0 ? fallback : Number(value) || 0;
    const natives = {
      load_wav: load,
      load_pcm: load,
      sfx: (kind, seed) => audio.makeSound(sfxRecipe(kind, seed)),
      sfx_tone: (wave, freq, freqEnd, ms2, volume) => audio.makeSound({
        wave: Number(wave) || 0,
        freq: num(freq, 440),
        freqEnd: num(freqEnd, num(freq, 440)),
        ms: num(ms2, 200),
        volume: num(volume, 50) / 100
      }),
      sound: (id, volume, frequency) => audio.play(id, num(volume, 256) / 256, num(frequency, 256) / 256),
      play_sound: (id, volume, pitch, pan) => audio.play(id, num(volume, 100) / 100, num(pitch, 100) / 100, num(pan, 0) / 100),
      change_sound: (channel, volume, frequency) => audio.change(
        channel,
        volume === void 0 ? void 0 : Number(volume) / 256,
        frequency === void 0 ? void 0 : Number(frequency) / 256
      ),
      stop_sound: (channel) => audio.stop(num(channel, 0)),
      is_playing_sound: (channel) => audio.isPlaying(channel),
      sound_volume: (volume) => {
        audio.setSoundVolume(num(volume, 100) / 100);
        return 1;
      },
      music_volume: (volume) => {
        audio.setMusicVolume(num(volume, 60) / 100);
        return 1;
      },
      song_new: (bpm) => audio.newSong(bpm),
      song_track: (song, instrument, notes, volume) => audio.addTrack(song, instrument, notes, num(volume, 60) / 100),
      song_play: (song, loop) => audio.playSong(song, num(loop, 1) !== 0),
      song_stop: () => {
        audio.stopSong();
        return 1;
      },
      song_playing: () => audio.songPlaying
    };
    for (const [name, fn2] of Object.entries(natives)) {
      this.vm.registerNative(name, fn2);
    }
  }
  registerNetNatives() {
    const net = this.net;
    const keyName = (key) => {
      let name = this.keyQueryCache.get(key);
      if (name === void 0) {
        name = _CanvasEngineRuntime.canonicalKeyName(key);
        this.keyQueryCache.set(key, name);
      }
      return name;
    };
    const room = (name) => String(name ?? "divjs").trim() || "divjs";
    const natives = {
      net_host: () => {
        net.hostWebRtc();
        return 1;
      },
      net_join: () => {
        net.joinWebRtc();
        return 1;
      },
      net_host_local: (name) => net.hostLocal(room(name)),
      net_join_local: (name) => net.joinLocal(room(name)),
      net_close: () => {
        net.close();
        return 1;
      },
      net_status: () => net.status,
      net_me: () => net.me,
      net_players: () => net.players,
      net_send: (type, value) => net.sendMessage(Number(type) || 0, value),
      net_receive: () => net.nextMessage(),
      net_msg_type: () => net.current ? net.current.type : 0,
      net_msg_value: () => net.current ? net.current.value : 0,
      net_msg_from: () => net.current ? net.current.from : 0,
      net_start: (delay) => net.start(delay),
      net_running: () => net.running ? 1 : 0,
      net_frame: () => net.lock.frame,
      net_key: (player, key) => net.input(player).down.has(keyName(key)) ? 1 : 0,
      net_key_pressed: (player, key) => net.input(player).pressed.has(keyName(key)) ? 1 : 0,
      net_mouse_x: (player) => net.input(player).mx,
      net_mouse_y: (player) => net.input(player).my,
      net_mouse_button: (player, b) => net.input(player).mb >> (Number(b) || 0) & 1
    };
    for (const [name, fn2] of Object.entries(natives)) {
      this.vm.registerNative(name, fn2);
    }
  }
  registerPhysicsNatives() {
    const physics = this.physics;
    const me2 = () => this.vm.currentProcess;
    const byId = (id) => Number(id) ? this.vm.processManager.get(Number(id)) || null : null;
    const who = (id) => id === void 0 || !Number(id) ? me2() : byId(id);
    const typeOr = (type) => type === void 0 ? PHYS_DYNAMIC : Number(type) || 0;
    const natives = {
      phys_gravity: (gx, gy) => {
        physics.setGravity(gx, gy);
        return 1;
      },
      phys_scale: (ppm) => physics.setScale(ppm),
      phys_iterations: (velocity, position) => physics.setIterations(velocity, position),
      phys_substeps: (n) => physics.setSubsteps(n),
      phys_box: (w, h, type) => me2() ? physics.addBox(me2(), w, h, typeOr(type)) : 0,
      phys_circle: (r, type) => me2() ? physics.addCircle(me2(), r, typeOr(type)) : 0,
      phys_add_box: (ox, oy, w, h) => me2() ? physics.addBox(me2(), w, h, void 0, ox, oy) : 0,
      phys_add_circle: (ox, oy, r) => me2() ? physics.addCircle(me2(), r, void 0, ox, oy) : 0,
      phys_edge: (x1, y1, x2, y2) => me2() ? physics.addEdge(me2(), x1, y1, x2, y2) : 0,
      phys_material: (density, friction, restitution) => me2() ? physics.setMaterial(me2(), density, friction, restitution) : 0,
      phys_type: (type, id) => physics.setType(who(id), type),
      phys_velocity: (vx, vy, id) => physics.setVelocity(who(id), vx, vy),
      phys_vx: (id) => physics.velocity(who(id), "x"),
      phys_vy: (id) => physics.velocity(who(id), "y"),
      phys_impulse: (ix, iy, id) => physics.applyImpulse(who(id), ix, iy),
      phys_force: (fx, fy, id) => physics.applyForce(who(id), fx, fy),
      phys_spin: (av, id) => physics.setSpin(who(id), av),
      phys_fixed_rotation: (on2, id) => physics.setFlag(who(id), "fixedRotation", on2),
      phys_bullet: (on2, id) => physics.setFlag(who(id), "bullet", on2),
      phys_sensor: (on2, id) => physics.setFlag(who(id), "sensor", on2),
      phys_mass: (id) => physics.mass(who(id)),
      phys_awake: (id) => physics.awake(who(id)),
      phys_contact: (type, id) => physics.contact(who(id), type),
      phys_impact: (id) => physics.impact(who(id)),
      phys_pin: (id, ax, ay) => me2() ? physics.addRevolute(me2(), byId(id), ax, ay) : 0,
      phys_weld: (id) => me2() ? physics.addWeld(me2(), byId(id)) : 0,
      phys_rope: (id, length) => me2() ? physics.addDistance(me2(), byId(id), length) : 0,
      phys_slack: (id, maxLength) => me2() ? physics.addSlack(me2(), byId(id), maxLength) : 0,
      phys_limits: (joint, lower, upper) => physics.setLimits(joint, lower, upper),
      phys_motor: (joint, speed, maxTorque) => physics.setMotor(joint, speed, maxTorque),
      phys_spring: (joint, frequency, damping) => physics.setSpring(joint, frequency, damping),
      phys_unjoin: (joint) => physics.removeJoint(joint),
      phys_at: (x2, y) => me2() ? physics.processAt(me2(), x2, y) : 0,
      phys_raycast: (x1, y1, x2, y2, hitX, hitY) => {
        if (!me2()) {
          return 0;
        }
        const hit = physics.raycast(me2(), x1, y1, x2, y2);
        if (hit.id && this.isOffsetRef(hitX) && this.isOffsetRef(hitY)) {
          this.writeOffsetRef(hitX, hit.x);
          this.writeOffsetRef(hitY, hit.y);
        }
        return hit.id;
      },
      phys_remove: (id) => physics.remove(who(id)),
      phys_clear: () => {
        physics.clear();
        return 1;
      },
      phys_bodies: () => physics.bodyCount
    };
    for (const [name, fn2] of Object.entries(natives)) {
      this.vm.registerNative(name, fn2);
    }
  }
  collisionNative(typeCode) {
    if (!this.vm?.currentProcess) return 0;
    const code = Number(typeCode);
    if (this.mouseProcess && code === this.mouseProcess.type) {
      return this.collideWithMouse(this.vm.currentProcess);
    }
    return this.vm.processManager.collision(this.vm.currentProcess, code);
  }
  // collision(TYPE mouse) is a special case in DIV, not an ordinary
  // process-vs-process test (src/shared/run/c.c):
  //
  //   if (bloque==0) { // collision(type mouse)
  //     if (mouse->x>=clipx0 && mouse->x<=clipx1 && ...)
  //       if (*(buffer + ...)) return(id); else return(0);
  //
  // The cursor is a *point*, tested against the calling process's own
  // pixel rectangle. That rectangle is inclusive of clipx1 = x0+width-1,
  // so neighbouring sprites never share a pixel. Modelling it as two
  // overlapping boxes made adjacent board squares both claim the pixel on
  // their shared edge, so every click toggled twice and undid itself.
  collideWithMouse(process) {
    const graph = this.getProcessGraphInfo(process);
    if (graph.graphId <= 0) {
      return 0;
    }
    const res = typeof process.getResolution === "function" ? process.getResolution() : 1;
    const pivot = this.getProcessPivot(process) || { x: 0, y: 0 };
    const left = process.x / res - (Number(pivot.x) || 0);
    const top = process.y / res - (Number(pivot.y) || 0);
    const runtimeGraph = this.ensureGraph(graph.fileId, graph.graphId);
    const width = Number(runtimeGraph?.width) || Number(process.width) || 0;
    const height = Number(runtimeGraph?.height) || Number(process.height) || 0;
    const mx = this._mouse.x;
    const my = this._mouse.y;
    if (mx < left || mx >= left + width || my < top || my >= top + height) {
      return 0;
    }
    return this.mouseProcess ? this.mouseProcess.id : 0;
  }
  collisionCircleNative(typeCode) {
    if (!this.vm?.currentProcess) return 0;
    return this.vm.processManager.collisionCircle(this.vm.currentProcess, Number(typeCode));
  }
  collisionOBBNative(typeCode) {
    if (!this.vm?.currentProcess) return 0;
    return this.vm.processManager.collisionOBB(this.vm.currentProcess, Number(typeCode));
  }
  collisionPointNative(px, py, typeCode) {
    return this.vm.processManager.collisionPoint(Number(px), Number(py), Number(typeCode), { collidableOnly: true });
  }
  setCollisionShapeNative(shape) {
    const p = this.vm?.currentProcess;
    if (!p) return 0;
    const s = String(shape ?? "").toLowerCase();
    p.collisionShape = s === "circle" || s === "1" ? "circle" : "box";
    return p.collisionShape === "circle" ? 1 : 0;
  }
  getCollisionShapeNative() {
    const p = this.vm?.currentProcess;
    if (!p) return 0;
    return p.collisionShape === "circle" ? 1 : 0;
  }
  clearCollisionBoxesNative() {
    const p = this.vm?.currentProcess;
    if (!p) return 0;
    p.cboxes = [];
    return 0;
  }
  addCollisionBoxNative(x2, y, width, height, code = -1) {
    const p = this.vm?.currentProcess;
    if (!p) return 0;
    if (!Array.isArray(p.cboxes)) p.cboxes = [];
    const c = {
      shape: "box",
      x: Number(x2) || 0,
      y: Number(y) || 0,
      width: Math.max(1, Number(width) || 1),
      height: Math.max(1, Number(height) || 1),
      code: Number.isFinite(Number(code)) ? Math.trunc(Number(code)) : -1
    };
    p.cboxes.push(c);
    return p.cboxes.length;
  }
  addCollisionCircleNative(x2, y, radius, code = -1) {
    const p = this.vm?.currentProcess;
    if (!p) return 0;
    if (!Array.isArray(p.cboxes)) p.cboxes = [];
    const c = {
      shape: "circle",
      x: Number(x2) || 0,
      y: Number(y) || 0,
      radius: Math.max(1, Number(radius) || 1),
      code: Number.isFinite(Number(code)) ? Math.trunc(Number(code)) : -1
    };
    p.cboxes.push(c);
    return p.cboxes.length;
  }
  getPenetrationXNative() {
    return Number(this.vm?.processManager?.lastPenetrationX) || 0;
  }
  getPenetrationYNative() {
    return Number(this.vm?.processManager?.lastPenetrationY) || 0;
  }
  // -1 means "no cbox"; 0 is a valid cbox code and used to come back as
  // -1 through `|| -1`.
  getColliderCBoxNative() {
    return _CanvasEngineRuntime.cboxCodeOrNone(this.vm?.processManager?.lastColliderCBox);
  }
  getCollidedCBoxNative() {
    return _CanvasEngineRuntime.cboxCodeOrNone(this.vm?.processManager?.lastCollidedCBox);
  }
  static cboxCodeOrNone(value) {
    const code = Number(value);
    return Number.isFinite(code) ? code : -1;
  }
  setCollisionRadiusNative(radius) {
    const p = this.vm?.currentProcess;
    if (!p) return 0;
    const r = Number(radius);
    p.collisionRadius = Number.isFinite(r) && r > 0 ? r : 0;
    return p.collisionRadius;
  }
  getCollisionRadiusNative() {
    const p = this.vm?.currentProcess;
    if (!p) return 0;
    return Number(p.collisionRadius) || 0;
  }
  setCollisionScaleNative(scale) {
    const p = this.vm?.currentProcess;
    if (!p) return 1;
    const s = Number(scale);
    p.collisionScale = Number.isFinite(s) && s > 0 ? s : 1;
    return p.collisionScale;
  }
  getCollisionScaleNative() {
    const p = this.vm?.currentProcess;
    if (!p) return 1;
    return Number(p.collisionScale) || 1;
  }
  placeMeetingNative(tx, ty, typeCode) {
    if (!this.vm?.currentProcess) return 0;
    return this.vm.processManager.placeMeeting(this.vm.currentProcess, Number(tx), Number(ty), Number(typeCode));
  }
  placeFreeNative(tx, ty, typeCode) {
    if (!this.vm?.currentProcess) return 1;
    return this.vm.processManager.placeFree(this.vm.currentProcess, Number(tx), Number(ty), Number(typeCode));
  }
  // TYPE values are negative and process ids positive (processTypeCode
  // in utils/hash.js), so the sign alone says which one this is. Trying
  // the value as an id first (as this used to) sent signal(TYPE a, ...)
  // to whichever process had id 97 - hashCode('a').
  signalNative(targetOrType, signalCode) {
    const target = Number(targetOrType) || 0;
    const signal = Number(signalCode) || 0;
    if (target < 0) {
      return this.vm.processManager.signalByType(target, signal);
    }
    return this.vm.processManager.signalById(target, signal);
  }
  letMeAloneNative() {
    if (!this.vm?.currentProcess) {
      return 0;
    }
    return this.vm.processManager.letMeAlone(this.vm.currentProcess);
  }
  // Scroll/region roots are arrays, so a numeric segment indexes them.
  // DIV also lets a script drop the index entirely - "scroll.x0" means
  // scroll[0].x0, which is how tutor5 drives the first scroll - so a
  // non-numeric segment on one of those arrays implies index 0 and is
  // re-applied to the entry it selects.
  normalizeSegment(container, segment) {
    if (Array.isArray(container)) {
      if (segment === "front") return 0;
      if (segment === "back") return 1;
      const n = Number(segment);
      if (Number.isInteger(n)) {
        return n;
      }
    }
    return segment;
  }
  // True when `segment` names a field rather than an index, i.e. the
  // implicit-index case described above.
  isImplicitScrollField(container, segment) {
    return Array.isArray(container) && !Number.isInteger(Number(segment));
  }
  resolveRelativeProcessRoot(rootName) {
    const process = this.vm?.currentProcess;
    if (!process) return null;
    const root = String(rootName || "").toLowerCase();
    if (root === "father") {
      return this.vm?.processManager?.get(Number(process.parentId) || 0) || null;
    }
    if (root === "son" || root === "bigbro" || root === "smallbro") {
      return this.vm?.processManager?.getRelative(process, root) || null;
    }
    return null;
  }
  isRelativeProcessRoot(rootName) {
    const root = String(rootName || "").toLowerCase();
    return root === "father" || root === "son" || root === "bigbro" || root === "smallbro";
  }
  getProcessFieldValue(process, fieldName) {
    if (!process) return 0;
    const key = String(fieldName || "");
    const lower = key.toLowerCase();
    if (Object.prototype.hasOwnProperty.call(VM.CANONICAL_SLOT_INDICES, lower)) {
      const slot2 = VM.CANONICAL_SLOT_INDICES[lower];
      const value = Number(process.locals?.[slot2]);
      if (Number.isFinite(value)) {
        return value;
      }
    }
    const slot = this.getProcessLocalSlot(process, key);
    if (slot !== null && slot !== void 0) {
      const value = process.locals?.[slot];
      if (value !== void 0) {
        return value;
      }
    }
    if (process[key] !== void 0) {
      return process[key];
    }
    if (process.privates && process.privates[key] !== void 0) {
      return process.privates[key];
    }
    return 0;
  }
  setProcessFieldValue(process, fieldName, value) {
    if (!process) return 0;
    const key = String(fieldName || "");
    const lower = key.toLowerCase();
    if (Object.prototype.hasOwnProperty.call(VM.CANONICAL_SLOT_INDICES, lower)) {
      const slot2 = VM.CANONICAL_SLOT_INDICES[lower];
      process.locals[slot2] = value;
      if (slot2 === 2 || slot2 === 3) {
        process.sizeFromScript = true;
      }
      const processManager = this.vm?.processManager;
      if (processManager) {
        if (slot2 === 15) {
          processManager.markPriorityDirty();
        } else if (slot2 === 13 && value) {
          processManager.notePriorityUse();
        }
      }
      process.sync();
      return value;
    }
    const slot = this.getProcessLocalSlot(process, key);
    if (slot !== null && slot !== void 0) {
      process.locals[slot] = value;
      return value;
    }
    process[key] = value;
    if (process.privates) {
      process.privates[key] = value;
    }
    return value;
  }
  // DIV cross-process field access: "raquet1.y" where raquet1 holds a
  // process id returned by a spawn. Emitted by compilePathGet/PathSet
  // when the root is a declared scalar (see isProcessRefRoot) - the
  // generic __get_path/__set_path can't cover it because they key off
  // the root's *name*, while here the root's runtime *value* names the
  // process. A dead/unknown id reads as 0 and ignores writes, matching
  // how the rest of the runtime treats missing processes.
  getProcessFieldNative(processId, fieldName) {
    const process = this.vm?.processManager?.get(Number(processId) || 0);
    if (!process) {
      return 0;
    }
    return this.getProcessFieldValue(process, fieldName);
  }
  setProcessFieldNative(processId, fieldName, value) {
    const process = this.vm?.processManager?.get(Number(processId) || 0);
    if (!process) {
      return 0;
    }
    return this.setProcessFieldValue(process, fieldName, value);
  }
  ensureScrollEntry(index) {
    if (!this.state.scroll[index]) {
      this.state.scroll[index] = {
        camera: 0,
        alpha: 100,
        active: 0,
        region: 0,
        flags: 0,
        // DIV's scroll variables: x0/y0 is the foreground plane's
        // position, x1/y1 the background plane's. A script may drive them
        // directly (tutor5) or let a camera process drive x0/y0 and have
        // x1/y1 derived from `ratio` (fenix g_scroll.c: gr_scroll_draw).
        x0: 0,
        y0: 0,
        x1: 0,
        y1: 0,
        ratio: 0,
        speed: 0,
        z: 512
      };
    }
    return this.state.scroll[index];
  }
  getPathNative(...args) {
    if (args.length === 0) {
      return 0;
    }
    const [rootName, ...segments] = args;
    const root = String(rootName);
    const relativeProcess = this.resolveRelativeProcessRoot(root);
    if (relativeProcess || this.isRelativeProcessRoot(root)) {
      if (!relativeProcess) {
        return 0;
      }
      if (segments.length === 0) {
        return relativeProcess.id || 0;
      }
      const first = segments[0];
      if (typeof first !== "string") {
        return 0;
      }
      return this.getProcessFieldValue(relativeProcess, first);
    }
    let current = this.state[root];
    if (current === void 0) {
      return 0;
    }
    for (const rawSegment of segments) {
      if (String(rootName) === "scroll" && this.isImplicitScrollField(current, rawSegment)) {
        current = this.ensureScrollEntry(0);
      }
      const segment = this.normalizeSegment(current, rawSegment);
      if (Array.isArray(current) && Number.isInteger(segment)) {
        if (String(rootName) === "scroll") {
          current = this.ensureScrollEntry(segment);
        } else {
          current = current[segment];
        }
      } else {
        current = current?.[segment];
      }
      if (current === void 0 || current === null) {
        return 0;
      }
    }
    if (typeof current === "number" || typeof current === "string" || typeof current === "boolean") {
      return current;
    }
    return current ?? 0;
  }
  setPathNative(...args) {
    if (args.length < 2) {
      return 0;
    }
    const rootName = String(args[0]);
    const value = args[args.length - 1];
    const segments = args.slice(1, -1);
    const relativeProcess = this.resolveRelativeProcessRoot(rootName);
    if (relativeProcess || this.isRelativeProcessRoot(rootName)) {
      if (!relativeProcess) {
        return 0;
      }
      if (segments.length !== 1 || typeof segments[0] !== "string") {
        return 0;
      }
      return this.setProcessFieldValue(relativeProcess, segments[0], value);
    }
    if (this.state[rootName] === void 0) {
      this.state[rootName] = rootName === "scroll" ? [] : {};
    }
    if (segments.length === 0) {
      this.state[rootName] = value;
      return value;
    }
    let current = this.state[rootName];
    if (rootName === "scroll" && this.isImplicitScrollField(current, segments[0])) {
      current = this.ensureScrollEntry(0);
    }
    for (let i = 0; i < segments.length - 1; i++) {
      const segment = this.normalizeSegment(current, segments[i]);
      if (Array.isArray(current) && Number.isInteger(segment)) {
        if (rootName === "scroll") {
          current = this.ensureScrollEntry(segment);
        } else {
          if (current[segment] === void 0 || current[segment] === null) {
            current[segment] = {};
          }
          current = current[segment];
        }
      } else {
        if (current[segment] === void 0 || current[segment] === null) {
          current[segment] = {};
        }
        current = current[segment];
      }
    }
    const finalSegment = this.normalizeSegment(current, segments[segments.length - 1]);
    current[finalSegment] = value;
    return value;
  }
  _gridKey(gx, gy) {
    return `${gx},${gy}`;
  }
  _octileDistance(ax, ay, bx, by) {
    const dx = Math.abs(ax - bx);
    const dy = Math.abs(ay - by);
    const minD = Math.min(dx, dy);
    const maxD = Math.max(dx, dy);
    return minD * 14 + (maxD - minD) * 10;
  }
  _manhattanDistance(ax, ay, bx, by) {
    return (Math.abs(ax - bx) + Math.abs(ay - by)) * 10;
  }
  _nodeBlocked(gx, gy, cellSize, obstacleTypeCode, clearance = 0) {
    if (!obstacleTypeCode) return false;
    const cx = gx * cellSize + Math.floor(cellSize * 0.5);
    const cy = gy * cellSize + Math.floor(cellSize * 0.5);
    const pm = this.vm?.processManager;
    if (!(clearance > 0)) {
      const hit = pm?.collisionPoint(cx, cy, obstacleTypeCode) || 0;
      return hit > 0;
    }
    const ids = pm?.byType?.get(obstacleTypeCode);
    if (!ids) return false;
    for (const id of ids) {
      const p = pm.get(id);
      if (!p || !p.active || p.dead || p.finished || p.sleeping) continue;
      for (const shape of getProcessShapes(p)) {
        const a2 = shape.aabb;
        if (a2 && a2.minX < cx + clearance && a2.maxX > cx - clearance && a2.minY < cy + clearance && a2.maxY > cy - clearance) {
          return true;
        }
      }
    }
    return false;
  }
  _buildPathPoints(cameFrom, endKey, startX, startY, endX, endY, cellSize) {
    const chain = [];
    let cursor = endKey;
    while (cursor) {
      const [gxRaw, gyRaw] = String(cursor).split(",");
      const gx = Number(gxRaw);
      const gy = Number(gyRaw);
      chain.push({
        x: gx * cellSize + Math.floor(cellSize * 0.5),
        y: gy * cellSize + Math.floor(cellSize * 0.5)
      });
      cursor = cameFrom.get(cursor);
    }
    chain.reverse();
    if (chain.length === 0) {
      return [];
    }
    chain[0].x = Math.round(startX);
    chain[0].y = Math.round(startY);
    chain[chain.length - 1].x = Math.round(endX);
    chain[chain.length - 1].y = Math.round(endY);
    return chain;
  }
  // clearance: how far (in pixels) the path keeps from obstacles - half
  // the size of whoever follows it. With 0 a cell is free when its centre
  // is; with more, when a square of that half-size around the centre
  // touches no obstacle. Diagonal steps never cut an obstacle's corner.
  pathFindNative(startX, startY, endX, endY, obstacleTypeCode = 0, cellSize = 16, allowDiagonal = 1, maxNodes = 4096, clearance = 0) {
    const size = Math.max(4, Math.floor(Number(cellSize) || 16));
    const allowDiag = Number(allowDiagonal) !== 0;
    const maxVisited = Math.max(64, Math.floor(Number(maxNodes) || 4096));
    const ox = Number(startX) || 0;
    const oy = Number(startY) || 0;
    const tx = Number(endX) || 0;
    const ty = Number(endY) || 0;
    const obstacleType = Math.trunc(Number(obstacleTypeCode) || 0);
    const keepOff = Math.max(0, Number(clearance) || 0);
    const sx = Math.floor(ox / size);
    const sy = Math.floor(oy / size);
    const ex = Math.floor(tx / size);
    const ey = Math.floor(ty / size);
    const startKey = this._gridKey(sx, sy);
    const endKey = this._gridKey(ex, ey);
    if (startKey === endKey) {
      const id = this.nextPathId++;
      this.paths.set(id, [{ x: Math.round(ox), y: Math.round(oy) }, { x: Math.round(tx), y: Math.round(ty) }]);
      return id;
    }
    const margin = 64;
    const minX = Math.min(sx, ex) - margin;
    const maxX = Math.max(sx, ex) + margin;
    const minY = Math.min(sy, ey) - margin;
    const maxY = Math.max(sy, ey) + margin;
    const neighbors = allowDiag ? [
      [1, 0, 10],
      [-1, 0, 10],
      [0, 1, 10],
      [0, -1, 10],
      [1, 1, 14],
      [1, -1, 14],
      [-1, 1, 14],
      [-1, -1, 14]
    ] : [
      [1, 0, 10],
      [-1, 0, 10],
      [0, 1, 10],
      [0, -1, 10]
    ];
    const heuristic = allowDiag ? this._octileDistance.bind(this) : this._manhattanDistance.bind(this);
    const open = [{ key: startKey, x: sx, y: sy, g: 0, f: heuristic(sx, sy, ex, ey) }];
    const openMap = /* @__PURE__ */ new Map([[startKey, open[0]]]);
    const closed = /* @__PURE__ */ new Set();
    const cameFrom = /* @__PURE__ */ new Map();
    const gScore = /* @__PURE__ */ new Map([[startKey, 0]]);
    let visited = 0;
    while (open.length > 0 && visited < maxVisited) {
      let bestIndex = 0;
      for (let i = 1; i < open.length; i++) {
        if (open[i].f < open[bestIndex].f) bestIndex = i;
      }
      const current = open.splice(bestIndex, 1)[0];
      openMap.delete(current.key);
      if (closed.has(current.key)) continue;
      closed.add(current.key);
      visited += 1;
      if (current.key === endKey) {
        const points = this._buildPathPoints(cameFrom, current.key, ox, oy, tx, ty, size);
        if (points.length === 0) return 0;
        const id = this.nextPathId++;
        this.paths.set(id, points);
        return id;
      }
      for (const [dx, dy, stepCost] of neighbors) {
        const nx = current.x + dx;
        const ny = current.y + dy;
        if (nx < minX || nx > maxX || ny < minY || ny > maxY) continue;
        const nKey = this._gridKey(nx, ny);
        if (closed.has(nKey)) continue;
        if (nKey !== endKey && this._nodeBlocked(nx, ny, size, obstacleType, keepOff)) {
          continue;
        }
        if (dx !== 0 && dy !== 0 && (this._nodeBlocked(current.x + dx, current.y, size, obstacleType, keepOff) || this._nodeBlocked(current.x, current.y + dy, size, obstacleType, keepOff))) {
          continue;
        }
        const tentativeG = current.g + stepCost;
        const bestKnown = gScore.get(nKey);
        if (bestKnown !== void 0 && tentativeG >= bestKnown) {
          continue;
        }
        cameFrom.set(nKey, current.key);
        gScore.set(nKey, tentativeG);
        const f = tentativeG + heuristic(nx, ny, ex, ey);
        const existing = openMap.get(nKey);
        if (existing) {
          existing.g = tentativeG;
          existing.f = f;
        } else {
          const node = { key: nKey, x: nx, y: ny, g: tentativeG, f };
          open.push(node);
          openMap.set(nKey, node);
        }
      }
    }
    return 0;
  }
  pathLengthNative(pathId) {
    const id = Math.trunc(Number(pathId) || 0);
    const path = this.paths.get(id);
    return Array.isArray(path) ? path.length : 0;
  }
  pathGetXNative(pathId, index) {
    const id = Math.trunc(Number(pathId) || 0);
    const i = Math.trunc(Number(index) || 0);
    const path = this.paths.get(id);
    if (!Array.isArray(path) || i < 0 || i >= path.length) return 0;
    return Number(path[i].x) || 0;
  }
  pathGetYNative(pathId, index) {
    const id = Math.trunc(Number(pathId) || 0);
    const i = Math.trunc(Number(index) || 0);
    const path = this.paths.get(id);
    if (!Array.isArray(path) || i < 0 || i >= path.length) return 0;
    return Number(path[i].y) || 0;
  }
  pathClearNative(pathId) {
    const id = Math.trunc(Number(pathId) || 0);
    if (!id) return 0;
    if (!this.paths.delete(id)) return 0;
    for (const [processId, state] of this.pathFollowers.entries()) {
      if (state?.pathId === id) {
        this.pathFollowers.delete(processId);
      }
    }
    return 1;
  }
  pathAssignNative(pathId, startIndex = 1) {
    const process = this.vm?.currentProcess;
    if (!process) return 0;
    const id = Math.trunc(Number(pathId) || 0);
    const path = this.paths.get(id);
    if (!Array.isArray(path) || path.length === 0) {
      this.pathFollowers.delete(process.id);
      return 0;
    }
    const idx = Math.max(0, Math.min(path.length - 1, Math.trunc(Number(startIndex) || 0)));
    this.pathFollowers.set(process.id, { pathId: id, index: idx });
    const pm = this.vm?.processManager;
    if (pm && this.pathFollowers.size > 2 * pm.count() + 16) {
      for (const processId of this.pathFollowers.keys()) {
        if (!pm.get(processId)) {
          this.pathFollowers.delete(processId);
        }
      }
    }
    return 1;
  }
  pathStopNative() {
    const process = this.vm?.currentProcess;
    if (!process) return 0;
    return this.pathFollowers.delete(process.id) ? 1 : 0;
  }
  pathIndexNative() {
    const process = this.vm?.currentProcess;
    if (!process) return 0;
    const state = this.pathFollowers.get(process.id);
    return Number(state?.index) || 0;
  }
  pathStepNative(speedPerSecond = 120, arriveRadius = 2) {
    const process = this.vm?.currentProcess;
    if (!process) return 0;
    const state = this.pathFollowers.get(process.id);
    if (!state) return 0;
    const path = this.paths.get(state.pathId);
    if (!Array.isArray(path) || path.length === 0) {
      this.pathFollowers.delete(process.id);
      return 0;
    }
    if (state.index >= path.length) {
      return 2;
    }
    const dt2 = Math.max(0, Number(this.vm?.dt) || 0);
    let remaining = Math.max(0, Number(speedPerSecond) || 0) * dt2;
    if (remaining <= 0) {
      return 1;
    }
    const radius = Math.max(0, Number(arriveRadius) || 0);
    while (remaining > 0 && state.index < path.length) {
      const target = path[state.index];
      const cx = Number(process.x) || 0;
      const cy = Number(process.y) || 0;
      const dx = (Number(target.x) || 0) - cx;
      const dy = (Number(target.y) || 0) - cy;
      const dist = Math.hypot(dx, dy);
      if (dist <= radius) {
        state.index += 1;
        continue;
      }
      const move = Math.min(remaining, dist);
      const nx = dist > 1e-9 ? dx / dist : 1;
      const ny = dist > 1e-9 ? dy / dist : 0;
      const nextX = (Number(process.x) || 0) + nx * move;
      const nextY = (Number(process.y) || 0) + ny * move;
      process.x = nextX;
      process.y = nextY;
      process.locals[0] = nextX;
      process.locals[1] = nextY;
      const facing = this.toDivAngleFromRadians(Math.atan2(-dy, dx));
      process.angle = facing;
      process.locals[7] = facing;
      remaining -= move;
      if (move >= dist - 1e-9) {
        state.index += 1;
      } else {
        break;
      }
    }
    if (state.index >= path.length) {
      return 2;
    }
    return 1;
  }
  loadGraphicNative(src, sx, sy, sw, sh) {
    if (!src) {
      return 0;
    }
    const url = this.resolveAssetUrl(src);
    if (sx !== void 0) {
      return this.graphics.load(url, Number(sx) || 0, Number(sy) || 0, Number(sw) || 0, Number(sh) || 0);
    }
    return this.graphics.load(url);
  }
  loadTileNative(src, sx, sy, sw, sh) {
    return this.loadGraphicNative(src, sx, sy, sw, sh);
  }
  reserveGraphLibrary() {
    const id = this.nextGraphLibraryId++;
    this.graphLibraries.set(id, {
      id,
      loaded: false,
      error: null,
      graphs: /* @__PURE__ */ new Map()
    });
    return id;
  }
  loadMapNative(src) {
    if (!src) {
      return 0;
    }
    const graphId = this.graphics.create(1, 1);
    this.graphics.get(graphId).loaded = false;
    const url = String(src);
    const promise = loadDivMapFromUrl(this.resolveAssetUrl(src)).then((map) => {
      this.graphics.setCanvas(graphId, map.canvas);
      const graph = this.ensureGraph(0, graphId, map.width, map.height);
      applyCpointsToGraph(graph, map.cpoints);
    }).catch((error) => {
      this.logFn(`[warn] load_map failed (${url}): ${error?.message || String(error)}`);
    });
    this.pendingLoads.push(promise);
    return graphId;
  }
  loadFpgNative(src) {
    if (!src) {
      return 0;
    }
    const libraryId = this.reserveGraphLibrary();
    const entry = this.graphLibraries.get(libraryId);
    const url = String(src);
    const promise = loadDivFpgFromUrl(this.resolveAssetUrl(src)).then((fpg) => {
      const count = fpg.maps.length;
      this.logFn(`[fpg] loaded ${url}: ${count} graph${count === 1 ? "" : "s"}`);
      for (const map of fpg.maps) {
        const code = Number(map.code) || 0;
        this.logFn(`  [fpg] graph ${code}: ${map.width}x${map.height}`);
        const assetId = this.libraryGraphics.addCanvas(map.canvas);
        entry.graphs.set(code, assetId);
        const graph = this.ensureGraph(libraryId, code, map.width, map.height);
        applyCpointsToGraph(graph, map.cpoints);
      }
      entry.loaded = true;
    }).catch((error) => {
      entry.error = error?.message || String(error);
      this.logFn(`[warn] load_fpg failed (${url}): ${entry.error}`);
    });
    this.pendingLoads.push(promise);
    return libraryId;
  }
  loadFntNative(src) {
    if (!src) {
      return 0;
    }
    const id = this.reserveBitmapFont();
    const entry = this.bitmapFonts.get(id);
    const url = String(src);
    const promise = loadDivFntFromUrl(this.resolveAssetUrl(src)).then((fnt) => {
      entry.font = {
        kind: "div_fnt",
        glyphs: fnt.glyphs,
        lineHeight: fnt.lineHeight,
        fallbackAdvance: fnt.fallbackAdvance
      };
      entry.loaded = true;
    }).catch((error) => {
      entry.error = error?.message || String(error);
      this.logFn(`[warn] load_fnt failed (${url}): ${entry.error}`);
    });
    this.pendingLoads.push(promise);
    return id;
  }
  reserveBitmapFont() {
    const id = this.nextBitmapFontId++;
    this.bitmapFonts.set(id, {
      id,
      loaded: false,
      error: null,
      font: null
    });
    return id;
  }
  loadBdfFontTextNative(text) {
    if (!text) {
      return 0;
    }
    const id = this.reserveBitmapFont();
    const entry = this.bitmapFonts.get(id);
    try {
      entry.font = parseBennuBdfFont(String(text));
      entry.loaded = true;
    } catch (error) {
      entry.error = error?.message || String(error);
      this.logFn(`[warn] load_bdf_font_text failed: ${entry.error}`);
    }
    return id;
  }
  loadBdfFontNative(src) {
    if (!src) {
      return 0;
    }
    const id = this.reserveBitmapFont();
    const entry = this.bitmapFonts.get(id);
    const url = String(src);
    const promise = fetch(this.resolveAssetUrl(src)).then((response) => {
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return response.text();
    }).then((text) => {
      entry.font = parseBennuBdfFont(text);
      entry.loaded = true;
    }).catch((error) => {
      entry.error = error?.message || String(error);
      this.logFn(`[warn] load_bdf_font failed (${url}): ${entry.error}`);
    });
    this.pendingLoads.push(promise);
    return id;
  }
  // ── DIV's built-in system font (its FONT 0) ────────────────────────
  //
  // The real 6x8 table from the original runtime, so WRITE output is
  // pixel-identical to DIV. Glyphs are built into a tinted atlas once per
  // colour: drawing them as hard pixels matters because a 320x200 canvas
  // is usually scaled up, and anything antialiased turns to mush.
  systemFontAtlas(color) {
    if (!this._systemFontAtlases) {
      this._systemFontAtlases = /* @__PURE__ */ new Map();
    }
    const key = String(color || "#ffffff");
    const cached = this._systemFontAtlases.get(key);
    if (cached) {
      return cached;
    }
    const w = FONT_6X8_WIDTH;
    const h = FONT_6X8_HEIGHT;
    const canvas = document.createElement("canvas");
    canvas.width = w * 256;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = key;
    for (let code = 0; code < 256; code++) {
      const ox = code * w;
      for (let row = 0; row < h; row++) {
        for (let col = 0; col < w; col++) {
          if (font6x8Pixel(code, col, row)) {
            ctx.fillRect(ox + col, row, 1, 1);
          }
        }
      }
    }
    if (this._systemFontAtlases.size >= _CanvasEngineRuntime.MAX_TEXT_COLOR_CACHE) {
      this._systemFontAtlases.clear();
    }
    this._systemFontAtlases.set(key, canvas);
    return canvas;
  }
  static MAX_TEXT_COLOR_CACHE = 32;
  // DIV's WRITE centring code (manual, write()/write_int()):
  //   0 up-left    1 up      2 up-right
  //   3 left       4 centre  5 right
  //   6 down-left  7 down    8 down-right
  // i.e. the column (code % 3) aligns x and the row (code / 3) aligns y.
  // Only 0/1/2 used to be understood, with 4 treated as 1 by the system
  // font and ignored by bitmap fonts, and nothing was ever aligned
  // vertically.
  static textAlignOffset(align, width, height) {
    const code = Math.trunc(Number(align) || 0);
    if (code < 0 || code > 8) {
      return { dx: 0, dy: 0 };
    }
    const col = code % 3;
    const row = Math.floor(code / 3);
    return {
      dx: col === 1 ? -Math.round(width * 0.5) : col === 2 ? -width : 0,
      dy: row === 1 ? -Math.round(height * 0.5) : row === 2 ? -height : 0
    };
  }
  drawSystemText(x2, y, align, text, color) {
    const w = FONT_6X8_WIDTH;
    const h = FONT_6X8_HEIGHT;
    const atlas = this.systemFontAtlas(color);
    const str = String(text);
    const offset = _CanvasEngineRuntime.textAlignOffset(align, str.length * w, h);
    let penX = Math.round(Number(x2) || 0) + offset.dx;
    const penY = Math.round(Number(y) || 0) + offset.dy;
    for (let i = 0; i < str.length; i++) {
      const c = str.charCodeAt(i);
      const code = c > 255 ? 63 : c;
      this.ctx.drawImage(atlas, code * w, 0, w, h, penX, penY, w, h);
      penX += w;
    }
    return str.length;
  }
  // Height of a line of this font as drawn: glyphs hang from the top of
  // the line by their yoffset, so the box reaches the lowest glyph bottom.
  static bitmapFontTextHeight(font) {
    if (font._textHeight === void 0) {
      let bottom = 0;
      for (const glyph of font.glyphs) {
        if (glyph) {
          bottom = Math.max(bottom, (glyph.yoffset || 0) + (glyph.height || 0));
        }
      }
      font._textHeight = bottom > 0 ? bottom : font.lineHeight;
    }
    return font._textHeight;
  }
  // BDF glyphs are 1-bit bitmaps drawn in the current colour. Each glyph
  // is rendered once per colour into a small canvas; drawing them one
  // fillRect per pixel, as this used to, cost ~9x the system font.
  bitmapGlyphCanvas(entry, glyph, code, color) {
    if (!entry.glyphCanvases) {
      entry.glyphCanvases = /* @__PURE__ */ new Map();
    }
    let byCode = entry.glyphCanvases.get(color);
    if (!byCode) {
      if (entry.glyphCanvases.size >= _CanvasEngineRuntime.MAX_TEXT_COLOR_CACHE) {
        entry.glyphCanvases.clear();
      }
      byCode = /* @__PURE__ */ new Map();
      entry.glyphCanvases.set(color, byCode);
    }
    let canvas = byCode.get(code);
    if (!canvas) {
      canvas = document.createElement("canvas");
      canvas.width = glyph.width;
      canvas.height = glyph.height;
      const gctx = canvas.getContext("2d");
      gctx.fillStyle = color;
      for (let gy = 0; gy < glyph.height; gy++) {
        for (let gx = 0; gx < glyph.width; gx++) {
          if (glyph.bitmap[gy * glyph.width + gx]) {
            gctx.fillRect(gx, gy, 1, 1);
          }
        }
      }
      byCode.set(code, canvas);
    }
    return canvas;
  }
  drawBitmapText(fontId, x2, y, align, text, color) {
    const entry = this.bitmapFonts.get(Number(fontId) || 0);
    if (!entry || !entry.loaded || !entry.font) {
      return false;
    }
    const str = String(text);
    const font = entry.font;
    const fillColor = String(color || this.ctx.fillStyle || "#ffffff");
    const lines = str.split("\n");
    const lineWidths = lines.map((line) => {
      let w = 0;
      for (let i = 0; i < line.length; i++) {
        const glyph = font.glyphs[line.charCodeAt(i) & 255];
        w += glyph ? glyph.xadvance || glyph.width || font.fallbackAdvance : font.fallbackAdvance;
      }
      return w;
    });
    const blockHeight = (lines.length - 1) * font.lineHeight + _CanvasEngineRuntime.bitmapFontTextHeight(font);
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const line = lines[lineIndex];
      const lineWidth = lineWidths[lineIndex] || 0;
      const offset = _CanvasEngineRuntime.textAlignOffset(align, lineWidth, blockHeight);
      let penX = (Number(x2) || 0) + offset.dx;
      const penY = (Number(y) || 0) + offset.dy + lineIndex * font.lineHeight;
      for (let i = 0; i < line.length; i++) {
        const code = line.charCodeAt(i) & 255;
        const glyph = font.glyphs[code];
        if (!glyph) {
          penX += font.fallbackAdvance;
          continue;
        }
        const baseX = penX + (glyph.xoffset || 0);
        const baseY = penY + (glyph.yoffset || 0);
        if (glyph.canvas) {
          this.ctx.drawImage(glyph.canvas, baseX, baseY);
          penX += glyph.xadvance || glyph.width || font.fallbackAdvance;
          continue;
        }
        if (!glyph.bitmap) {
          penX += font.fallbackAdvance;
          continue;
        }
        this.ctx.drawImage(this.bitmapGlyphCanvas(entry, glyph, code, fillColor), baseX, baseY);
        penX += glyph.xadvance || glyph.width || font.fallbackAdvance;
      }
    }
    return true;
  }
  registerNatives() {
    if (this.vm?.processManager) {
      this.vm.processManager.graphIdOf = (process) => this.getProcessGraphRef(process).graphId;
      this.mouseProcess = this.vm.processManager.create("mouse", {});
      this.mouseProcess.isMouse = true;
      this.mouseProcess.hasCompletedFrame = true;
      this.mouseProcess.graph = 0;
      this.mouseProcess.file = 0;
    }
    if (this.vm?.processManager) {
      this.vm.processManager.pivotResolver = (process) => {
        this.syncProcessSizeToGraph(process, this.getProcessGraphRef(process));
        return this.getProcessPivot(process);
      };
    }
    this.vm.registerNative("key_down", this.keyDownNative.bind(this));
    this.vm.registerNative("key_pressed", this.keyPressedNative.bind(this));
    this.vm.registerNative("key", this.keyNative.bind(this));
    this.vm.registerNative("get_time", () => this.totalTime);
    this.vm.registerNative("get_delta", () => this.vm.dt);
    this.vm.registerNative("set_title", this.setTitleNative.bind(this));
    this.vm.registerNative("set_mode", this.setModeNative.bind(this));
    this.vm.registerNative("screen_color", this.screenColorNative.bind(this));
    this.vm.registerNative("put_screen", this.putScreenNative.bind(this));
    this.vm.registerNative("get_pixel", this.getPixelNative.bind(this));
    this.vm.registerNative("set_debug", this.setDebugNative.bind(this));
    this.vm.registerNative("__get_mouse_field", this.getMouseFieldNative.bind(this));
    this.vm.registerNative("__set_mouse_field", this.setMouseFieldNative.bind(this));
    this.vm.registerNative("exit", (message, code) => {
      if (message !== void 0 && message !== null && String(message).length > 0) {
        this.logFn(`[exit] ${String(message)}`);
      }
      if (this.vm) {
        this.vm.halted = true;
        this.vm.mainFinished = true;
      }
      return Number(code) || 0;
    });
    this.vm.registerNative("set_fps", this.setFpsNative.bind(this));
    this.vm.registerNative("get_fps", this.getFpsNative.bind(this));
    this.vm.registerNative("get_process_count", this.getProcessCountNative.bind(this));
    this.vm.registerNative("abs", this.absNative.bind(this));
    this.vm.registerNative("sin", this.sinNative.bind(this));
    this.vm.registerNative("cos", this.cosNative.bind(this));
    this.vm.registerNative("tan", this.tanNative.bind(this));
    this.vm.registerNative("asin", this.asinNative.bind(this));
    this.vm.registerNative("acos", this.acosNative.bind(this));
    this.vm.registerNative("atan", this.atanNative.bind(this));
    this.vm.registerNative("atan2", this.atan2Native.bind(this));
    this.vm.registerNative("sqrt", this.sqrtNative.bind(this));
    this.vm.registerNative("pow", this.powNative.bind(this));
    this.vm.registerNative("floor", this.floorNative.bind(this));
    this.vm.registerNative("ceil", this.ceilNative.bind(this));
    this.vm.registerNative("round", this.roundNative.bind(this));
    this.vm.registerNative("int", (value) => Math.trunc(Number(value) || 0));
    this.vm.registerNative("ping_pong", this.pingPongNative.bind(this));
    this.vm.registerNative("wrap", this.wrapNative.bind(this));
    this.vm.registerNative("lerp_angle", this.lerpAngleNative.bind(this));
    this.vm.registerNative("clamp", this.clampNative.bind(this));
    this.vm.registerNative("min", (...values) => Math.min(...values.map((v) => Number(v) || 0)));
    this.vm.registerNative("max", (...values) => Math.max(...values.map((v) => Number(v) || 0)));
    this.vm.registerNative("lerp", this.lerpNative.bind(this));
    this.vm.registerNative("smoothstep", this.smoothStepNative.bind(this));
    this.vm.registerNative("normalize_angle", this.normalizeAngleNative.bind(this));
    this.vm.registerNative("sign", this.signNative.bind(this));
    this.vm.registerNative("distance", this.distanceNative.bind(this));
    this.vm.registerNative("distance_rect", this.distanceRectNative.bind(this));
    this.vm.registerNative("fget_angle", this.fgetAngleNative.bind(this));
    this.vm.registerNative("fget_distance", this.fgetDistanceNative.bind(this));
    this.vm.registerNative("hermite", this.hermiteNative.bind(this));
    this.vm.registerNative("get_distx", this.getDistXNative.bind(this));
    this.vm.registerNative("get_disty", this.getDistYNative.bind(this));
    this.vm.registerNative("torad", this.toRadNative.bind(this));
    this.vm.registerNative("todeg", this.toDegNative.bind(this));
    this.vm.registerNative("rand_seed", this.randSeedNative.bind(this));
    this.vm.registerNative("rand", this.randNative.bind(this));
    this.vm.registerNative("random", this.randomNative.bind(this));
    this.vm.registerNative("advance", this.advanceNative.bind(this));
    this.vm.registerNative("xadvance", this.xadvanceNative.bind(this));
    this.vm.registerNative("xput", this.xputNative.bind(this));
    this.vm.registerNative("set_point", this.setPointNative.bind(this));
    this.vm.registerNative("get_point", this.getPointNative.bind(this));
    this.vm.registerNative("get_point_x", (fileId, graphId, pointIndex) => this.getPointNative(fileId, graphId, pointIndex, 0));
    this.vm.registerNative("get_point_y", (fileId, graphId, pointIndex) => this.getPointNative(fileId, graphId, pointIndex, 1));
    this.vm.registerNative("get_real_point", this.getRealPointNative.bind(this));
    this.vm.registerNative("get_real_point_x", this.getRealPointXNative.bind(this));
    this.vm.registerNative("get_real_point_y", this.getRealPointYNative.bind(this));
    this.vm.registerNative("define_region", this.defineRegionNative.bind(this));
    this.vm.registerNative("start_scroll", this.startScrollNative.bind(this));
    this.vm.registerNative("stop_scroll", this.stopScrollNative.bind(this));
    this.vm.registerNative("out_of_region", this.outOfRegionNative.bind(this));
    this.vm.registerNative("exit_region", this.outOfRegionNative.bind(this));
    this.vm.registerNative("out_region", this.outRegionNative.bind(this));
    this.vm.registerNative("out_of_screen", this.outOfScreenNative.bind(this));
    this.vm.registerNative("exit_screen", this.outOfScreenNative.bind(this));
    this.vm.registerNative("write", this.writeNative.bind(this));
    this.vm.registerNative("write_int", this.writeIntNative.bind(this));
    this.vm.registerNative("delete_text", this.deleteTextNative.bind(this));
    this.vm.registerNative("set_color", this.setColorNative.bind(this));
    this.vm.registerNative("clear", this.clearNative.bind(this));
    this.vm.registerNative("circle", this.circleNative.bind(this));
    this.vm.registerNative("text", this.textNative.bind(this));
    this.vm.registerNative("draw_rect", this.rectNative.bind(this));
    this.vm.registerNative("log", this.logNative.bind(this));
    this.vm.registerNative("print", this.printNative.bind(this));
    this.vm.registerNative("collision", this.collisionNative.bind(this));
    this.registerPhysicsNatives();
    this.registerNetNatives();
    this.registerAudioNatives();
    this.vm.registerNative("collision_circle", this.collisionCircleNative.bind(this));
    this.vm.registerNative("collision_obb", this.collisionOBBNative.bind(this));
    this.vm.registerNative("collision_point", this.collisionPointNative.bind(this));
    this.vm.registerNative("set_collision_shape", this.setCollisionShapeNative.bind(this));
    this.vm.registerNative("get_collision_shape", this.getCollisionShapeNative.bind(this));
    this.vm.registerNative("clear_collision_boxes", this.clearCollisionBoxesNative.bind(this));
    this.vm.registerNative("add_collision_box", this.addCollisionBoxNative.bind(this));
    this.vm.registerNative("add_collision_circle", this.addCollisionCircleNative.bind(this));
    this.vm.registerNative("set_collision_radius", this.setCollisionRadiusNative.bind(this));
    this.vm.registerNative("get_collision_radius", this.getCollisionRadiusNative.bind(this));
    this.vm.registerNative("set_collision_scale", this.setCollisionScaleNative.bind(this));
    this.vm.registerNative("get_collision_scale", this.getCollisionScaleNative.bind(this));
    this.vm.registerNative("penetration_x", this.getPenetrationXNative.bind(this));
    this.vm.registerNative("penetration_y", this.getPenetrationYNative.bind(this));
    this.vm.registerNative("collider_cbox", this.getColliderCBoxNative.bind(this));
    this.vm.registerNative("collided_cbox", this.getCollidedCBoxNative.bind(this));
    this.vm.registerNative("place_meeting", this.placeMeetingNative.bind(this));
    this.vm.registerNative("place_free", this.placeFreeNative.bind(this));
    this.vm.registerNative("signal", this.signalNative.bind(this));
    this.vm.registerNative("let_me_alone", this.letMeAloneNative.bind(this));
    this.vm.registerNative("load_graphic", this.loadGraphicNative.bind(this));
    this.vm.registerNative("load_tile", this.loadTileNative.bind(this));
    this.vm.registerNative("load_map", this.loadMapNative.bind(this));
    this.vm.registerNative("load_fpg", this.loadFpgNative.bind(this));
    this.vm.registerNative("load_fnt", this.loadFntNative.bind(this));
    this.vm.registerNative("load_bdf_font", this.loadBdfFontNative.bind(this));
    this.vm.registerNative("load_bdf_font_text", this.loadBdfFontTextNative.bind(this));
    this.vm.registerNative("__offset_local", this.offsetLocalNative.bind(this));
    this.vm.registerNative("__get_path", this.getPathNative.bind(this));
    this.vm.registerNative("__set_path", this.setPathNative.bind(this));
    this.vm.registerNative("__get_process_field", this.getProcessFieldNative.bind(this));
    this.vm.registerNative("__set_process_field", this.setProcessFieldNative.bind(this));
    this.vm.registerNative("path_find", this.pathFindNative.bind(this));
    this.vm.registerNative("path_length", this.pathLengthNative.bind(this));
    this.vm.registerNative("path_get_x", this.pathGetXNative.bind(this));
    this.vm.registerNative("path_get_y", this.pathGetYNative.bind(this));
    this.vm.registerNative("path_clear", this.pathClearNative.bind(this));
    this.vm.registerNative("path_assign", this.pathAssignNative.bind(this));
    this.vm.registerNative("path_step", this.pathStepNative.bind(this));
    this.vm.registerNative("path_stop", this.pathStopNative.bind(this));
    this.vm.registerNative("path_index", this.pathIndexNative.bind(this));
    this.vm.registerNative("fade_off", (speed) => {
      this._fadeStart(0, 0, 0, Number(speed) || 8, 1);
      return 0;
    });
    this.vm.registerNative("fade_on", (speed) => {
      this._fadeStart(0, 0, 0, Number(speed) || 8, 0);
      return 0;
    });
    this.vm.registerNative("fade", (r, g2, b, speed) => {
      const avg = ((Number(r) || 0) + (Number(g2) || 0) + (Number(b) || 0)) / 3;
      const intensity = Math.max(0, Math.min(100, avg));
      this._fadeStart(0, 0, 0, Number(speed) || 8, 1 - intensity / 100);
      return 0;
    });
    this.vm.registerNative("is_fading", () => this._fade.active ? 1 : 0);
    this.vm.registerNative("new_graphic", this.newGraphicNative.bind(this));
    this.vm.registerNative("gfx_fill", this.gfxFillNative.bind(this));
    this.vm.registerNative("gfx_fill_rgba", this.gfxFillRGBANative.bind(this));
    this.vm.registerNative("gfx_pixel", this.gfxPixelNative.bind(this));
    this.vm.registerNative("gfx_line", this.gfxLineNative.bind(this));
    this.vm.registerNative("gfx_rect", this.gfxRectNative.bind(this));
    this.vm.registerNative("gfx_rect_outline", this.gfxRectOutlineNative.bind(this));
    this.vm.registerNative("gfx_circle", this.gfxCircleNative.bind(this));
    this.vm.registerNative("gfx_circle_outline", this.gfxCircleOutlineNative.bind(this));
    this.vm.registerNative("gfx_text", this.gfxTextNative.bind(this));
    this.vm.registerNative("free_graphic", (id) => {
      this.graphics.remove(Number(id));
      delete this.state.graphs[this.getGraphKey(0, id)];
      return 0;
    });
    this.vm.registerNative("mouse_x", () => this._mouse.x);
    this.vm.registerNative("mouse_y", () => this._mouse.y);
    this.vm.registerNative("mouse_button", (b) => this._mouse.frameButtons[Number(b) || 0] ? 1 : 0);
  }
  // target: 1 = fade to opaque (fade out), 0 = fade to transparent (fade in)
  _fadeStart(r, g2, b, speed, target) {
    const f = this._fade;
    f.r = Math.max(0, Math.min(255, Math.round(r)));
    f.g = Math.max(0, Math.min(255, Math.round(g2)));
    f.b = Math.max(0, Math.min(255, Math.round(b)));
    f.speed = Math.max(0.1, Math.min(64, speed));
    f.target = Math.max(0, Math.min(1, Number(target) || 0));
    f.active = f.alpha !== f.target;
  }
  // ── Procedural graphics API ──────────────────────────────────────────────
  // Every caller draws into the graphic, so its tinted copies are stale.
  _gfxCtx(id) {
    const g2 = this.graphics.get(Number(id));
    if (!g2 || !g2.ctx2d) {
      return null;
    }
    g2.version = (g2.version || 0) + 1;
    return g2.ctx2d;
  }
  static clampByte(value) {
    return Math.max(0, Math.min(255, Math.round(Number(value) || 0)));
  }
  _cssRGB(r, g2, b) {
    return `rgb(${Math.round(r)},${Math.round(g2)},${Math.round(b)})`;
  }
  _cssRGBA(r, g2, b, a2) {
    return `rgba(${Math.round(r)},${Math.round(g2)},${Math.round(b)},${Math.max(0, Math.min(1, a2 / 100))})`;
  }
  newGraphicNative(w, h) {
    return this.graphics.create(Number(w) || 1, Number(h) || 1);
  }
  gfxFillNative(id, r, g2, b) {
    const c = this._gfxCtx(id);
    if (!c) return 0;
    c.fillStyle = this._cssRGB(r, g2, b);
    c.fillRect(0, 0, c.canvas.width, c.canvas.height);
    return 0;
  }
  gfxFillRGBANative(id, r, g2, b, a2) {
    const c = this._gfxCtx(id);
    if (!c) return 0;
    c.clearRect(0, 0, c.canvas.width, c.canvas.height);
    if ((a2 ?? 100) > 0) {
      c.fillStyle = this._cssRGBA(r, g2, b, a2 ?? 100);
      c.fillRect(0, 0, c.canvas.width, c.canvas.height);
    }
    return 0;
  }
  gfxPixelNative(id, x2, y, r, g2, b) {
    const c = this._gfxCtx(id);
    if (!c) return 0;
    c.fillStyle = this._cssRGB(r, g2, b);
    c.fillRect(x2, y, 1, 1);
    return 0;
  }
  gfxLineNative(id, x1, y1, x2, y2, r, g2, b) {
    const c = this._gfxCtx(id);
    if (!c) return 0;
    c.strokeStyle = this._cssRGB(r, g2, b);
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(x1, y1);
    c.lineTo(x2, y2);
    c.stroke();
    return 0;
  }
  gfxRectNative(id, x2, y, w, h, r, g2, b) {
    const c = this._gfxCtx(id);
    if (!c) return 0;
    c.fillStyle = this._cssRGB(r, g2, b);
    c.fillRect(x2, y, w, h);
    return 0;
  }
  gfxRectOutlineNative(id, x2, y, w, h, r, g2, b) {
    const c = this._gfxCtx(id);
    if (!c) return 0;
    c.strokeStyle = this._cssRGB(r, g2, b);
    c.lineWidth = 1;
    c.strokeRect(x2 + 0.5, y + 0.5, w - 1, h - 1);
    return 0;
  }
  gfxCircleNative(id, cx, cy, radius, r, g2, b) {
    const c = this._gfxCtx(id);
    if (!c) return 0;
    c.fillStyle = this._cssRGB(r, g2, b);
    c.beginPath();
    c.arc(cx, cy, Math.abs(radius), 0, Math.PI * 2);
    c.fill();
    return 0;
  }
  gfxCircleOutlineNative(id, cx, cy, radius, r, g2, b) {
    const c = this._gfxCtx(id);
    if (!c) return 0;
    c.strokeStyle = this._cssRGB(r, g2, b);
    c.lineWidth = 1;
    c.beginPath();
    c.arc(cx, cy, Math.abs(radius), 0, Math.PI * 2);
    c.stroke();
    return 0;
  }
  gfxTextNative(id, x2, y, text, r, g2, b, size) {
    const c = this._gfxCtx(id);
    if (!c) return 0;
    c.fillStyle = this._cssRGB(r, g2, b);
    c.font = `${Math.round(size || 12)}px monospace`;
    c.textBaseline = "top";
    c.fillText(String(text), x2, y);
    return 0;
  }
  transformPoint(x2, y, ctype) {
    if (ctype === CType.C_SCROLL) {
      return {
        x: x2 - this.cameraX,
        y: y - this.cameraY
      };
    }
    return { x: x2, y };
  }
  getRegionRect(regionId) {
    const rect = this.state.region[Number(regionId) || 0];
    if (rect) {
      return rect;
    }
    return { x: 0, y: 0, width: this.width, height: this.height };
  }
  // Advances a scroll's own variables for this frame, mirroring
  // gr_scroll_draw in fenix's g_scroll.c: a camera process pulls x0/y0
  // toward centring itself in the region (limited by `speed`, 0 meaning
  // "snap"), non-wrapping planes are clamped to the graphic, and x1/y1
  // are derived from `ratio` when one is set. With no camera the script
  // owns x0/y0 directly, which is how tutor5 scrolls.
  updateScrollEntry(index) {
    const entry = this.ensureScrollEntry(index);
    const region = this.getRegionRect(entry.region);
    const camProcess = this.vm.processManager.get(Number(entry.camera) || 0);
    if (camProcess) {
      const res = typeof camProcess.getResolution === "function" ? camProcess.getResolution() : 1;
      const cx = (Number(camProcess.x) || 0) / res - region.width * 0.5;
      const cy = (Number(camProcess.y) || 0) / res - region.height * 0.5;
      const speed = Number(entry.speed) || Number.MAX_SAFE_INTEGER;
      if (entry.x0 < cx) entry.x0 = Math.min(entry.x0 + speed, cx);
      else if (entry.x0 > cx) entry.x0 = Math.max(entry.x0 - speed, cx);
      if (entry.y0 < cy) entry.y0 = Math.min(entry.y0 + speed, cy);
      else if (entry.y0 > cy) entry.y0 = Math.max(entry.y0 - speed, cy);
    }
    const flags = Number(entry.flags) || 0;
    const graphic = this.getGraphAsset(entry.fileId, entry.graphId);
    if (graphic && graphic.image) {
      const gw = Number(graphic.sw) || graphic.image.width || 0;
      const gh = Number(graphic.sh) || graphic.image.height || 0;
      if (!(flags & 1) && gw > 0) {
        entry.x0 = Math.max(0, Math.min(entry.x0, gw - region.width));
      }
      if (!(flags & 2) && gh > 0) {
        entry.y0 = Math.max(0, Math.min(entry.y0, gh - region.height));
      }
    }
    const ratio = Number(entry.ratio) || 0;
    if (ratio) {
      entry.x1 = entry.x0 * 100 / ratio;
      entry.y1 = entry.y0 * 100 / ratio;
    }
    return entry;
  }
  getScrollCamera(index) {
    const entry = this.ensureScrollEntry(index);
    return { x: Number(entry.x0) || 0, y: Number(entry.y0) || 0 };
  }
  // Tiles one plane across the region, offset by (-ox,-oy). Wrapping is
  // what makes a scroll endless; a plane whose wrap bit is off has
  // already been clamped in updateScrollEntry, so tiling it is harmless.
  drawScrollPlane(graphic, region, ox, oy) {
    if (!graphic || !graphic.image || graphic.loaded === false) {
      return;
    }
    const gw = Number(graphic.sw) || graphic.image.width || 0;
    const gh = Number(graphic.sh) || graphic.image.height || 0;
    if (gw <= 0 || gh <= 0) {
      return;
    }
    let startX = -((ox % gw + gw) % gw);
    let startY = -((oy % gh + gh) % gh);
    for (let y = startY; y < region.height; y += gh) {
      for (let x2 = startX; x2 < region.width; x2 += gw) {
        const dx = region.x + x2;
        const dy = region.y + y;
        if (graphic.sx !== void 0) {
          this.ctx.drawImage(graphic.image, graphic.sx, graphic.sy, gw, gh, dx, dy, gw, gh);
        } else {
          this.ctx.drawImage(graphic.image, dx, dy);
        }
      }
    }
  }
  // Draws every active scroll: background plane first (x1/y1), then the
  // foreground (x0/y0), each clipped to the scroll's region.
  drawScrolls() {
    for (let index = 0; index < this.state.scroll.length; index++) {
      const entry = this.state.scroll[index];
      if (!entry || !entry.active) {
        continue;
      }
      this.updateScrollEntry(index);
      const region = this.getRegionRect(entry.region);
      const back = this.getGraphAsset(entry.fileId, entry.backId);
      const front = this.getGraphAsset(entry.fileId, entry.graphId);
      this.withRegionClip(region, () => {
        this.drawScrollPlane(back, region, Number(entry.x1) || 0, Number(entry.y1) || 0);
        this.drawScrollPlane(front, region, Number(entry.x0) || 0, Number(entry.y0) || 0);
      });
    }
  }
  withRegionClip(region, drawFn) {
    this.ctx.save();
    this.ctx.beginPath();
    this.ctx.rect(region.x, region.y, region.width, region.height);
    this.ctx.clip();
    drawFn();
    this.ctx.restore();
  }
  getProcessLocalNumber(process, localName, fallbackValue = 0) {
    const slot = this.getProcessLocalSlot(process, localName);
    if (slot !== null && slot !== void 0) {
      const value = Number(process.locals?.[slot]);
      if (Number.isFinite(value)) {
        return value;
      }
    }
    return fallbackValue;
  }
  // Like getProcessLocalNumber, but tries each name in order and uses the
  // first one the process actually declared a local for - lets a field
  // have more than one accepted spelling (e.g. scale_x / scalex) without
  // silently summing both if a script happens to touch both names.
  getProcessLocalNumberAliased(process, names, fallbackValue = 0) {
    for (const name of names) {
      const slot = this.getProcessLocalSlot(process, name);
      if (slot !== null && slot !== void 0) {
        const value = Number(process.locals?.[slot]);
        if (Number.isFinite(value)) {
          return value;
        }
      }
    }
    return fallbackValue;
  }
  // Just the graphic identity, without the angle/size/flags/scale work
  // getProcessGraphInfo does. The collision path needs only this, and it
  // runs per candidate pair - the full version costs 9 slot lookups plus
  // an object allocation, which is far too much for a hot loop.
  getProcessGraphRef(process) {
    const graphId = this.getProcessLocalNumber(process, "graph", Number(process.graph ?? 0) || 0);
    const fileId = this.getProcessLocalNumber(process, "file", Number(process.file ?? 0) || 0);
    return { fileId, graphId };
  }
  // Pivot (control point 0) for a process's current graphic, memoized on
  // the process. A graphic's pivot only moves when set_point() edits it,
  // so a global version counter is enough to invalidate every cache at
  // once. Without this, every getCenter() in a collision loop re-resolved
  // the graph and re-read the point.
  getProcessPivot(process) {
    const { fileId, graphId } = this.getProcessGraphRef(process);
    if (graphId <= 0) {
      return null;
    }
    const key = `${fileId}:${graphId}`;
    if (process.__pivotKey === key && process.__pivotVersion === this.pointsVersion) {
      return process.__pivot;
    }
    const pivot = this.ensureGraph(fileId, graphId).getPoint(0);
    process.__pivotKey = key;
    process.__pivotVersion = this.pointsVersion;
    process.__pivot = pivot;
    return pivot;
  }
  getProcessGraphInfo(process) {
    const graphId = this.getProcessLocalNumber(process, "graph", Number(process.graph ?? 0) || 0);
    const fileId = this.getProcessLocalNumber(process, "file", Number(process.file ?? 0) || 0);
    const angle = this.getProcessLocalNumber(process, "angle", Number(process.angle ?? 0) || 0);
    const size = this.getProcessLocalNumber(process, "size", 100);
    const flags = this.getProcessLocalNumber(process, "flags", Number(process.flags ?? 0) || 0);
    const scaleX = this.getProcessLocalNumberAliased(process, ["scale_x", "scalex"], 100);
    const scaleY = this.getProcessLocalNumberAliased(process, ["scale_y", "scaley"], 100);
    return { fileId, graphId, angle, size, flags, scaleX, scaleY };
  }
  getGraphAsset(fileId, graphId) {
    const fid = Number(fileId) || 0;
    const gid = Number(graphId) || 0;
    const lib = this.graphLibraries.get(fid);
    const mapped = lib?.graphs?.get(gid);
    if (mapped !== void 0) {
      return this.libraryGraphics.get(mapped) || null;
    }
    if (fid === 0) {
      return this.graphics.get(gid) || null;
    }
    return null;
  }
  // Returns a canvas holding the graphic's pixels multiplied by r,g,b,
  // with the graphic's own alpha, so only opaque pixels are tinted.
  // Tinting used to multiply a rectangle over the drawn sprite, which
  // coloured the transparent part of the box as well (a white background
  // behind a red-tinted sprite turned red) and ignored the pivot and
  // rotation. Built once per graphic and colour: WeakMap keyed by the
  // graphic record (replaced whenever its pixels are), plus the version
  // the gfx_* natives bump when they draw into a new_graphic canvas.
  getTintedImage(graphic, srcX, srcY, srcW, srcH, r, g2, b) {
    if (!this._tintCache) {
      this._tintCache = /* @__PURE__ */ new WeakMap();
    }
    let perGraphic = this._tintCache.get(graphic);
    if (!perGraphic || perGraphic.version !== (graphic.version || 0)) {
      perGraphic = { version: graphic.version || 0, byColor: /* @__PURE__ */ new Map() };
      this._tintCache.set(graphic, perGraphic);
    }
    const key = r << 16 | g2 << 8 | b;
    let canvas = perGraphic.byColor.get(key);
    if (canvas) {
      return canvas;
    }
    canvas = document.createElement("canvas");
    canvas.width = srcW;
    canvas.height = srcH;
    const tctx = canvas.getContext("2d");
    tctx.drawImage(graphic.image, srcX, srcY, srcW, srcH, 0, 0, srcW, srcH);
    tctx.globalCompositeOperation = "multiply";
    tctx.fillStyle = `rgb(${r},${g2},${b})`;
    tctx.fillRect(0, 0, srcW, srcH);
    tctx.globalCompositeOperation = "destination-in";
    tctx.drawImage(graphic.image, srcX, srcY, srcW, srcH, 0, 0, srcW, srcH);
    if (perGraphic.byColor.size >= 64) {
      perGraphic.byColor.clear();
    }
    perGraphic.byColor.set(key, canvas);
    return canvas;
  }
  drawGraphSprite(fileId, graphId, x2, y, angle, scaleXPct, scaleYPct, flags, baseWidth, baseHeight, tint) {
    const graph = this.ensureGraph(fileId, graphId);
    const graphic = this.getGraphAsset(fileId, graphId);
    if (!graphic || !graphic.image || graphic.loaded === false) {
      return false;
    }
    const srcW = graphic.sx !== void 0 ? Number(graphic.sw) || 0 : Number(graphic.image.naturalWidth || graphic.image.width) || 0;
    const srcH = graphic.sx !== void 0 ? Number(graphic.sh) || 0 : Number(graphic.image.naturalHeight || graphic.image.height) || 0;
    if (srcW <= 0 || srcH <= 0) {
      return false;
    }
    const graphW = Number(graph.width) || srcW;
    const graphH = Number(graph.height) || srcH;
    const sxp = Number(scaleXPct);
    const syp = Number(scaleYPct);
    const scaleX = (Number.isFinite(sxp) ? sxp : 100) / 100;
    const scaleY = (Number.isFinite(syp) ? syp : 100) / 100;
    const drawW = Math.max(1, (Number(baseWidth) || graphW) * scaleX);
    const drawH = Math.max(1, (Number(baseHeight) || graphH) * scaleY);
    const pivot = graph.getPoint(0);
    const pivotX = (Number(pivot.x) || 0) * (drawW / graphW);
    const pivotY = (Number(pivot.y) || 0) * (drawH / graphH);
    this.ctx.save();
    this.ctx.translate(x2, y);
    this.ctx.rotate(this.screenRadiansFromDivAngle(angle));
    this.ctx.scale(this.isMirrorX(flags) ? -1 : 1, this.isMirrorY(flags) ? -1 : 1);
    if (tint) {
      const tinted = this.getTintedImage(
        graphic,
        graphic.sx !== void 0 ? Number(graphic.sx) || 0 : 0,
        graphic.sx !== void 0 ? Number(graphic.sy) || 0 : 0,
        srcW,
        srcH,
        tint.r,
        tint.g,
        tint.b
      );
      this.ctx.drawImage(tinted, -pivotX, -pivotY, drawW, drawH);
    } else if (graphic.sx !== void 0) {
      this.ctx.drawImage(
        graphic.image,
        Number(graphic.sx) || 0,
        Number(graphic.sy) || 0,
        srcW,
        srcH,
        -pivotX,
        -pivotY,
        drawW,
        drawH
      );
    } else {
      this.ctx.drawImage(graphic.image, -pivotX, -pivotY, drawW, drawH);
    }
    this.ctx.restore();
    return true;
  }
  drawGraphPlaceholder(px, py, angle, scaleXPct, scaleYPct, color) {
    const radians = this.screenRadiansFromDivAngle(angle);
    const sx = Number(scaleXPct);
    const sy = Number(scaleYPct ?? scaleXPct);
    const scaleX = (Number.isFinite(sx) ? sx : 100) / 100;
    const scaleY = (Number.isFinite(sy) ? sy : 100) / 100;
    const w = 18 * scaleX;
    const h = 10 * scaleY;
    this.ctx.save();
    this.ctx.fillStyle = color;
    this.ctx.translate(px, py);
    this.ctx.rotate(radians);
    this.ctx.beginPath();
    this.ctx.moveTo(w, 0);
    this.ctx.lineTo(-w * 0.6, -h);
    this.ctx.lineTo(-w * 0.2, 0);
    this.ctx.lineTo(-w * 0.6, h);
    this.ctx.closePath();
    this.ctx.fill();
    this.ctx.restore();
  }
  // Real DIV sizes a process to its graphic's native dimensions whenever
  // GRAPH/FILE is set; WIDTH/HEIGHT written by the program override it.
  // So until the script writes either one (Process.sizeFromScript, set by
  // the VM), width/height follow the current graphic - also when GRAPH
  // changes later. This used to happen only once, and only while both
  // were still the constructor's 32x32 default, so a process kept the
  // size of its first graphic and a real 32x32 graphic was mistaken for
  // "not sized yet". Graph.sized says whether the pixels are known.
  syncProcessSizeToGraph(process, graph) {
    if (graph.graphId <= 0 || process.sizeFromScript) {
      return;
    }
    const runtimeGraph = this.ensureGraph(graph.fileId, graph.graphId);
    if (!runtimeGraph.sized) {
      return;
    }
    if (process.width === runtimeGraph.width && process.height === runtimeGraph.height) {
      return;
    }
    process.width = runtimeGraph.width;
    process.height = runtimeGraph.height;
    const widthSlot = this.getProcessLocalSlot(process, "width");
    const heightSlot = this.getProcessLocalSlot(process, "height");
    if (widthSlot !== null && widthSlot !== void 0) process.locals[widthSlot] = process.width;
    if (heightSlot !== null && heightSlot !== void 0) process.locals[heightSlot] = process.height;
  }
  drawProcessAt(process, offsetX, offsetY) {
    const graph = this.getProcessGraphInfo(process);
    this.syncProcessSizeToGraph(process, graph);
    const res = typeof process.getResolution === "function" ? process.getResolution() : 1;
    const centerX = process.x / res - offsetX;
    const centerY = process.y / res - offsetY;
    const dbgPivot = graph.graphId > 0 ? this.ensureGraph(graph.fileId, graph.graphId).getPoint(0) : null;
    const px = centerX - (dbgPivot ? Number(dbgPivot.x) || 0 : process.width * 0.5);
    const py = centerY - (dbgPivot ? Number(dbgPivot.y) || 0 : process.height * 0.5);
    const alpha = (process.alpha ?? 100) / 100;
    if (alpha <= 0) return;
    const r = process.red ?? 255;
    const g2 = process.green ?? 255;
    const b = process.blue ?? 255;
    const hasTint = r !== 255 || g2 !== 255 || b !== 255;
    this.ctx.save();
    if (alpha < 1) this.ctx.globalAlpha = alpha;
    const sizePct = Number.isFinite(graph.size) ? graph.size : 100;
    const scaleXPct = sizePct * ((graph.scaleX ?? 100) / 100);
    const scaleYPct = sizePct * ((graph.scaleY ?? 100) / 100);
    if (graph.graphId > 0) {
      const tint = hasTint ? { r: _CanvasEngineRuntime.clampByte(r), g: _CanvasEngineRuntime.clampByte(g2), b: _CanvasEngineRuntime.clampByte(b) } : null;
      const drewSprite = this.drawGraphSprite(
        graph.fileId,
        graph.graphId,
        centerX,
        centerY,
        graph.angle,
        scaleXPct,
        scaleYPct,
        graph.flags,
        process.width,
        process.height,
        tint
      );
      if (!drewSprite && this.debugDrawProcessBounds) {
        this.drawGraphPlaceholder(centerX, centerY, graph.angle, scaleXPct, scaleYPct, `rgb(${Math.round(r)},${Math.round(g2)},${Math.round(b)})`);
      }
    }
    this.ctx.restore();
    if (this.debugDrawProcessBounds && graph.graphId > 0) {
      this.ctx.save();
      this.ctx.strokeStyle = this.debugProcessBoundsColor;
      this.ctx.lineWidth = 1;
      this.ctx.strokeRect(px, py, process.width, process.height);
      this.ctx.restore();
      this.drawProcessDebugOverlay(process, graph, centerX, centerY, offsetX, offsetY, scaleXPct, scaleYPct);
    }
  }
  // Debug-mode visualization: the collision shape(s) actually used by
  // collision()/place_meeting/etc (not just the plain width/height box
  // above - a process can have circle or custom cboxes instead), the
  // graphic's pivot (control point 0 - where rotation/scale/position
  // anchor, see g_blit.c's F_NCPOINTS check), and every other control
  // point defined on the graphic.
  drawProcessDebugOverlay(process, graph, centerX, centerY, offsetX, offsetY, scaleXPct, scaleYPct) {
    this.ctx.save();
    const s = Math.max(0.35, Math.min(1, this.width / 800));
    const lineW = s;
    const pivotR = 1.6 * s;
    const pointR = 1.2 * s;
    const crossR = 3 * s;
    const pm = this.vm?.processManager;
    const isCulprit = pm && (pm.lastCollisionA === process.id || pm.lastCollisionB === process.id);
    const shapes = getProcessShapes(process, process.x - offsetX, process.y - offsetY, false);
    this.ctx.strokeStyle = isCulprit ? "#ffffff" : "#ff2d95";
    this.ctx.lineWidth = isCulprit ? lineW * 2 : lineW;
    for (const shape of shapes) {
      this.ctx.beginPath();
      if (shape.shape === "circle") {
        this.ctx.arc(shape.cx, shape.cy, shape.r, 0, Math.PI * 2);
      } else {
        const c = shape.corners;
        this.ctx.moveTo(c[0].x, c[0].y);
        for (let i = 1; i < c.length; i++) this.ctx.lineTo(c[i].x, c[i].y);
        this.ctx.closePath();
      }
      this.ctx.stroke();
    }
    const bodyShapes = this.physics.debugShapes(process);
    if (bodyShapes.length > 0) {
      const px = centerX;
      const py = centerY;
      this.ctx.strokeStyle = "#7cff5a";
      this.ctx.lineWidth = lineW;
      for (const shape of bodyShapes) {
        this.ctx.beginPath();
        if (shape.circle) {
          const [cx, cy, r] = shape.circle;
          this.ctx.arc(px + cx, py + cy, r, 0, Math.PI * 2);
        } else {
          shape.points.forEach(([x2, y], i) => i === 0 ? this.ctx.moveTo(px + x2, py + y) : this.ctx.lineTo(px + x2, py + y));
          if (shape.closed) {
            this.ctx.closePath();
          }
        }
        this.ctx.stroke();
      }
    }
    if (isCulprit) {
      this.ctx.fillStyle = "#ffffff";
      this.ctx.font = `${Math.max(4, Math.round(7 * s))}px JetBrains Mono, Consolas, monospace`;
      this.ctx.textBaseline = "bottom";
      this.ctx.fillText(`${process.name}#${process.id}`, centerX + 4 * s, centerY - 4 * s);
    }
    if (graph.graphId > 0) {
      const runtimeGraph = this.ensureGraph(graph.fileId, graph.graphId);
      for (const [index, point] of runtimeGraph.points) {
        const world = this.computeRealPoint(
          graph.fileId,
          graph.graphId,
          index,
          centerX,
          centerY,
          graph.angle,
          graph.size,
          graph.flags,
          scaleXPct,
          scaleYPct
        );
        const isPivot = index === 0;
        this.ctx.fillStyle = isPivot ? "#ffe600" : "#00ff6a";
        this.ctx.beginPath();
        this.ctx.arc(world.x, world.y, isPivot ? pivotR : pointR, 0, Math.PI * 2);
        this.ctx.fill();
        if (isPivot) {
          this.ctx.strokeStyle = "#ffe600";
          this.ctx.lineWidth = lineW;
          this.ctx.beginPath();
          this.ctx.moveTo(world.x - crossR, world.y);
          this.ctx.lineTo(world.x + crossR, world.y);
          this.ctx.moveTo(world.x, world.y - crossR);
          this.ctx.lineTo(world.x, world.y + crossR);
          this.ctx.stroke();
        }
      }
    }
    this.ctx.restore();
  }
  drawProcessesFallback() {
    const processes = this.vm.processManager.getDrawList();
    const activeScrollEntries = this.state.scroll.map((entry, index) => ({ entry, index })).filter(({ entry }) => entry && entry.active);
    for (const process of processes) {
      if (process.sleeping) {
        continue;
      }
      const ctype = process.ctype ?? CType.C_SCREEN;
      if (ctype === CType.C_SCROLL && activeScrollEntries.length > 0) {
        const cnumber = Number(process.cnumber) || 0;
        for (const { entry, index } of activeScrollEntries) {
          if (cnumber !== 0 && (cnumber & 1 << index) === 0) {
            continue;
          }
          const region = this.getRegionRect(entry.region);
          const cam = this.getScrollCamera(index);
          this.withRegionClip(region, () => {
            this.drawProcessAt(process, cam.x - region.x, cam.y - region.y);
          });
        }
        continue;
      }
      this.drawProcessAt(process, 0, 0);
    }
  }
  drawCommandsToCanvas() {
    this.ctx.save();
    this.ctx.font = "8px JetBrains Mono, Consolas, monospace";
    this.ctx.textBaseline = "top";
    const drawXput = (cmd, px, py) => {
      const drewSprite = this.drawGraphSprite(
        cmd.fileId,
        cmd.graphId,
        px,
        py,
        cmd.angle,
        cmd.size,
        cmd.size,
        cmd.flags
      );
      if (!drewSprite) {
        this.drawGraphPlaceholder(px, py, cmd.angle, cmd.size, cmd.size, cmd.color);
      }
    };
    for (const cmd of this.drawCommands) {
      this.ctx.fillStyle = cmd.color;
      this.ctx.strokeStyle = cmd.color;
      const drawOne = (offsetX, offsetY) => {
        const pos = {
          x: cmd.x - offsetX,
          y: cmd.y - offsetY
        };
        if (cmd.type === "circle") {
          this.ctx.beginPath();
          this.ctx.arc(pos.x, pos.y, cmd.r, 0, Math.PI * 2);
          this.ctx.fill();
          return;
        }
        if (cmd.type === "text") {
          let text = cmd.text;
          if (this.isOffsetRef(text)) {
            const value = this.resolveOffsetRef(text);
            text = text.asInt ? String(Math.floor(Number(value) || 0)) : String(value);
          }
          const drewBitmap = cmd.fontId > 0 ? this.drawBitmapText(cmd.fontId, pos.x, pos.y, cmd.align || 0, text, cmd.color) : false;
          if (!drewBitmap) {
            this.drawSystemText(pos.x, pos.y, cmd.align || 0, text, cmd.color);
          }
          return;
        }
        if (cmd.type === "rect") {
          this.ctx.fillRect(pos.x, pos.y, cmd.width, cmd.height);
        }
        if (cmd.type === "xput") {
          drawXput(cmd, pos.x, pos.y);
        }
      };
      const drawWithCommandRegion = (offsetX, offsetY) => {
        if (cmd.region && cmd.region > 0) {
          const regionRect = this.getRegionRect(cmd.region);
          this.withRegionClip(regionRect, () => drawOne(offsetX, offsetY));
          return;
        }
        drawOne(offsetX, offsetY);
      };
      if ((cmd.ctype ?? CType.C_SCREEN) === CType.C_SCROLL) {
        const activeScrollEntries = this.state.scroll.map((entry, index) => ({ entry, index })).filter(({ entry }) => entry && entry.active);
        if (activeScrollEntries.length === 0) {
          drawWithCommandRegion(this.cameraX, this.cameraY);
          continue;
        }
        for (const { entry, index } of activeScrollEntries) {
          const region = this.getRegionRect(entry.region);
          const cam = this.getScrollCamera(index);
          this.withRegionClip(region, () => drawWithCommandRegion(cam.x - region.x, cam.y - region.y));
        }
        continue;
      }
      drawWithCommandRegion(0, 0);
    }
    this.ctx.restore();
    this.drawCommands = this.drawCommands.filter((cmd) => cmd.persistent);
  }
  render() {
    this.ctx.fillStyle = this.clearColor;
    this.ctx.fillRect(0, 0, this.width, this.height);
    this.drawBackgroundGraph();
    this.drawScrolls();
    this.drawProcessesFallback();
    this.drawCommandsToCanvas();
    this.drawDebugStats();
    this.drawDebugLegend();
    if (this.vm?.processManager) {
      this.vm.processManager.lastCollisionA = 0;
      this.vm.processManager.lastCollisionB = 0;
    }
    if (this._fade.alpha > 0) {
      const f = this._fade;
      this.ctx.save();
      this.ctx.globalAlpha = f.alpha;
      this.ctx.fillStyle = `rgb(${f.r},${f.g},${f.b})`;
      this.ctx.fillRect(0, 0, this.width, this.height);
      this.ctx.restore();
    }
  }
};

// divjs.js
function compileSource(source) {
  const lexer = new Lexer(source);
  const tokens = lexer.tokenize();
  const parser = new Parser(tokens);
  const ast = parser.parse();
  const compiler = new Compiler();
  return compiler.compile(ast);
}
function resolveCanvas(canvasOrId) {
  if (typeof canvasOrId === "string") {
    const el = document.getElementById(canvasOrId);
    if (!el) {
      throw new Error(`Canvas not found: ${canvasOrId}`);
    }
    return el;
  }
  if (!canvasOrId || typeof canvasOrId.getContext !== "function") {
    throw new Error("Invalid canvas element");
  }
  return canvasOrId;
}
function isEditableTarget(target) {
  if (!target || target === window || target === document) {
    return false;
  }
  if (target.isContentEditable) {
    return true;
  }
  const tag = String(target.tagName || "").toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}
function createNetPanel(doc = document, { inviteLink = null } = {}) {
  let root = null;
  const panel = {
    onCancel: null,
    invite: null,
    showHost,
    askJoin,
    close,
    error
  };
  function el(tag, style, text) {
    const node = doc.createElement(tag);
    if (style) {
      node.style.cssText = style;
    }
    if (text !== void 0) {
      node.textContent = text;
    }
    return node;
  }
  const BUTTON = "font:600 13px system-ui,sans-serif;padding:7px 14px;border-radius:6px;border:1px solid #3a5068;background:#1d3348;color:#e6f1ff;cursor:pointer;margin-right:8px";
  const AREA = "display:block;box-sizing:border-box;width:100%;height:84px;margin:6px 0 10px;font:11px ui-monospace,Consolas,monospace;background:#0b1117;color:#9fe6c8;border:1px solid #2a3b4d;border-radius:6px;padding:6px;resize:none;word-break:break-all";
  function open(title) {
    close();
    root = el("div", "position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.55)");
    root.setAttribute("data-divjs-net", "");
    const box = el("div", "width:min(460px,calc(100vw - 32px));background:#132030;color:#dbe7f3;border:1px solid #2f4760;border-radius:10px;padding:16px 18px;font:14px system-ui,sans-serif;box-shadow:0 12px 40px rgba(0,0,0,.5)");
    box.appendChild(el("div", "font-weight:700;font-size:16px;margin-bottom:8px", title));
    const body = el("div");
    const status = el("div", "min-height:18px;font-size:13px;color:#8fb3d6;margin:4px 0 10px");
    status.setAttribute("data-net-status", "");
    const buttons = el("div");
    const cancel = el("button", BUTTON, "Cancel");
    cancel.setAttribute("data-net-cancel", "");
    cancel.onclick = () => {
      close();
      if (typeof panel.onCancel === "function") {
        panel.onCancel();
      }
    };
    box.append(body, status, buttons);
    buttons.appendChild(cancel);
    root.appendChild(box);
    doc.body.appendChild(root);
    return { body, status, buttons, cancel };
  }
  async function copyText(button, text, done) {
    try {
      await navigator.clipboard.writeText(text);
      button.textContent = done;
    } catch {
      button.textContent = "Select and copy it";
    }
  }
  function codeBox(parent, code) {
    const area = el("textarea", AREA);
    area.readOnly = true;
    area.value = code;
    area.setAttribute("data-net-code", "");
    const copy = el("button", BUTTON, "Copy code");
    copy.onclick = () => {
      area.select();
      copyText(copy, code, "Copied");
    };
    parent.append(area, copy);
    return area;
  }
  function inputBox(parent, label, attr) {
    parent.appendChild(el("div", "margin-top:12px", label));
    const area = el("textarea", AREA);
    area.setAttribute(attr, "");
    area.placeholder = "DIVNET1....";
    parent.appendChild(area);
    return area;
  }
  function showHost(code, onAnswer) {
    const ui2 = open("Host an online game");
    ui2.body.appendChild(el("div", "", "1. Send this invitation to the other player:"));
    const area = codeBox(ui2.body, code);
    if (typeof inviteLink === "function") {
      const copyLink = el("button", BUTTON, "Copy invitation link");
      copyLink.setAttribute("data-net-copy-link", "");
      copyLink.onclick = async () => {
        try {
          const url = await inviteLink(code);
          area.value = url;
          area.select();
          copyText(copyLink, url, "Link copied");
        } catch (err) {
          error(String(err?.message || err));
        }
      };
      ui2.body.appendChild(copyLink);
    }
    const answer = inputBox(ui2.body, "2. Paste the answer code they send back:", "data-net-answer");
    const connect = el("button", BUTTON, "Connect");
    connect.setAttribute("data-net-connect", "");
    connect.onclick = async () => {
      ui2.status.style.color = "#8fb3d6";
      ui2.status.textContent = "Connecting...";
      try {
        await onAnswer(answer.value);
      } catch (err) {
        error(String(err?.message || err));
      }
    };
    ui2.buttons.insertBefore(connect, ui2.cancel);
  }
  function askJoin(onOffer) {
    const ui2 = open("Join an online game");
    const offer = inputBox(ui2.body, "Paste the invitation code from the host:", "data-net-offer");
    const make = el("button", BUTTON, "Make answer");
    make.setAttribute("data-net-make-answer", "");
    make.onclick = async () => {
      ui2.status.style.color = "#8fb3d6";
      ui2.status.textContent = "Preparing the answer...";
      make.disabled = true;
      try {
        const answer = await onOffer(offer.value);
        ui2.body.textContent = "";
        ui2.body.appendChild(el("div", "", "Send this answer back to the host. The game connects when they paste it:"));
        codeBox(ui2.body, answer);
        make.remove();
        ui2.status.textContent = "Waiting for the host...";
      } catch (err) {
        make.disabled = false;
        error(String(err?.message || err));
      }
    };
    ui2.buttons.insertBefore(make, ui2.cancel);
    if (panel.invite) {
      offer.value = panel.invite;
      panel.invite = null;
      make.click();
    }
  }
  function error(message) {
    const status = root && root.querySelector("[data-net-status]");
    if (status) {
      status.style.color = "#ff8f8f";
      status.textContent = message;
    }
  }
  function close() {
    if (root) {
      root.remove();
      root = null;
    }
  }
  return panel;
}
function createTicker(intervalMs, onTick) {
  try {
    const code = "let t = 0; onmessage = (e) => { clearInterval(t); t = setInterval(() => postMessage(0), e.data); };";
    const url = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
    const worker = new Worker(url);
    let first = true;
    worker.onmessage = () => {
      if (first) {
        URL.revokeObjectURL(url);
        first = false;
      }
      onTick();
    };
    worker.postMessage(intervalMs);
    return { stop: () => worker.terminate() };
  } catch {
    const timer = setInterval(onTick, intervalMs);
    return { stop: () => clearInterval(timer) };
  }
}
function runDivDemo(options) {
  const {
    canvas,
    source,
    clearColor = "#0b1117",
    autoStart = true,
    preventDefaultKeys = true,
    virtualWidth,
    virtualHeight,
    debugDrawProcessBounds = false,
    debugProcessBoundsColor = "#00ffff",
    debugShowStats = false,
    debugStatsTextColor = "#e6fffb",
    debugStatsBgColor = "rgba(6, 10, 18, 0.7)",
    debugStatsX = 8,
    debugStatsY = 8,
    onLog,
    onError,
    onFrame,
    width,
    height,
    // How long a frame may wait for load_fpg/load_fnt/load_map fetches
    // started in the same tick before it renders anyway (placeholders
    // for whatever hasn't arrived). A fetch that never answers used to
    // freeze the program for good.
    loadHoldTimeoutMs = 3e3,
    // Maximum number of live WRITE texts (see CanvasEngineRuntime.maxTexts).
    maxTexts,
    // Files that come with the program (name -> Blob / ArrayBuffer /
    // typed array / URL): load_fpg("ship.fpg") and friends read them
    // before trying a URL. See CanvasEngineRuntime.setFiles.
    files,
    // Online play (vm/net.js). netIceServers: the STUN/TURN servers
    // WebRTC uses to find a route between the players (default: one
    // public STUN server; [] for local networks only). netUi: a
    // replacement for the built-in code-exchange panel (see
    // createNetPanel for the interface). netInviteLink(code): makes a link
    // to this game carrying an invitation (the built-in panel then offers
    // it to the host); the page that opens it passes the code to
    // setNetInvite().
    netIceServers,
    netUi,
    netInviteLink
  } = options || {};
  const canvasEl = resolveCanvas(canvas);
  const screenCtx = canvasEl.getContext("2d", { willReadFrequently: true });
  if (width) {
    canvasEl.width = Number(width) || canvasEl.width;
  }
  if (height) {
    canvasEl.height = Number(height) || canvasEl.height;
  }
  const useVirtualScreen = Number.isFinite(Number(virtualWidth)) && Number.isFinite(Number(virtualHeight));
  const runtimeCanvas = useVirtualScreen ? document.createElement("canvas") : canvasEl;
  const runtimeCtx = useVirtualScreen ? runtimeCanvas.getContext("2d", { willReadFrequently: true }) : screenCtx;
  if (useVirtualScreen) {
    runtimeCanvas.width = Math.max(1, Number(virtualWidth));
    runtimeCanvas.height = Math.max(1, Number(virtualHeight));
    screenCtx.imageSmoothingEnabled = false;
  }
  const initialRuntimeWidth = runtimeCanvas.width;
  const initialRuntimeHeight = runtimeCanvas.height;
  const netPanel = netUi || (typeof document !== "undefined" ? createNetPanel(document, { inviteLink: netInviteLink }) : null);
  let vm = null;
  let bytecode = null;
  let runtime = null;
  let running = false;
  let rafId = 0;
  let rafPending = false;
  let lastRafAt = 0;
  let ticker = null;
  const netActive = (net) => net.running || net.status === 1 || net.status === 2 || net.status === 4;
  let lastTs = 0;
  let nextFrameTs = 0;
  let currentSource = String(source || "");
  let currentFiles = files || null;
  let generation = 0;
  const blockedKeys = /* @__PURE__ */ new Set([
    "ArrowUp",
    "ArrowDown",
    "ArrowLeft",
    "ArrowRight",
    " ",
    "Spacebar",
    "Space",
    "PageUp",
    "PageDown",
    "Home",
    "End"
  ]);
  const handleKeyDown = (event) => {
    if (isEditableTarget(event.target)) {
      return;
    }
    if (preventDefaultKeys && blockedKeys.has(event.key)) {
      event.preventDefault();
    } else if (preventDefaultKeys && event.key === "Tab" && event.target === canvasEl && runtime && runtime.readsKey("Tab")) {
      event.preventDefault();
    }
    if (runtime) {
      runtime.setKeyState(event.key, true, event.code);
    }
  };
  const handleKeyUp = (event) => {
    if (runtime) {
      runtime.setKeyState(event.key, false, event.code);
    }
  };
  const handleBlur = () => {
    if (runtime) {
      runtime.clearKeyState();
    }
  };
  window.addEventListener("keydown", handleKeyDown, { passive: false });
  window.addEventListener("keyup", handleKeyUp);
  window.addEventListener("blur", handleBlur);
  const emitError = (err) => {
    if (typeof onError === "function") {
      onError(err);
      return;
    }
    throw err;
  };
  const schedule = (runId) => {
    if (rafPending) {
      return;
    }
    rafPending = true;
    rafId = requestAnimationFrame((ts2) => {
      rafPending = false;
      lastRafAt = performance.now();
      runFrame(ts2, runId);
    });
  };
  const startTicker = (runId, fps) => {
    ticker = createTicker(1e3 / (fps > 0 ? fps : 60), () => {
      if (!running || runId !== generation || !netActive(runtime.net)) {
        return;
      }
      if (performance.now() - lastRafAt < 250) {
        return;
      }
      runFrame(performance.now(), runId);
    });
  };
  const runFrame = (timestamp, runId) => {
    if (!running || runId !== generation) {
      return;
    }
    const targetFps = runtime.targetFps || 0;
    if (targetFps > 0) {
      const frameInterval = 1e3 / targetFps;
      if (nextFrameTs === 0) {
        nextFrameTs = timestamp;
      }
      if (timestamp < nextFrameTs - 1) {
        schedule(runId);
        return;
      }
      nextFrameTs += frameInterval;
      if (timestamp - nextFrameTs > frameInterval) {
        nextFrameTs = timestamp + frameInterval;
      }
    } else {
      nextFrameTs = 0;
    }
    const net = runtime.net;
    if (!net.beforeFrame(runtime)) {
      lastTs = timestamp;
      nextFrameTs = timestamp;
      schedule(runId);
      return;
    }
    if (!ticker && netActive(net)) {
      startTicker(runId, targetFps);
    }
    const fixedDt = 1 / (targetFps > 0 ? targetFps : 60);
    const dt2 = lastTs === 0 || net.running ? fixedDt : (timestamp - lastTs) / 1e3;
    lastTs = timestamp;
    runtime.beginFrame(dt2);
    const finishFrame = () => {
      if (!running || runId !== generation) {
        return;
      }
      try {
        runtime.render();
        if (useVirtualScreen) {
          screenCtx.fillStyle = clearColor;
          screenCtx.fillRect(0, 0, canvasEl.width, canvasEl.height);
          screenCtx.drawImage(runtimeCanvas, 0, 0, canvasEl.width, canvasEl.height);
        }
        if (typeof onFrame === "function") {
          onFrame({ vm, runtime, dt: dt2 });
        }
      } catch (err) {
        running = false;
        emitError(err);
        return;
      }
      if (vm.halted) {
        running = false;
        return;
      }
      schedule(runId);
    };
    try {
      vm.tick();
      net.afterFrame(vm);
    } catch (err) {
      running = false;
      emitError(err);
      return;
    }
    if (runtime.pendingLoads && runtime.pendingLoads.length > 0) {
      const pending = runtime.pendingLoads.splice(0, runtime.pendingLoads.length);
      waitForLoads(pending).then((timedOut) => {
        if (timedOut && runId === generation && typeof onLog === "function") {
          onLog(`[warn] assets still loading after ${loadHoldTimeoutMs} ms - continuing without them`);
        }
        finishFrame();
      });
      return;
    }
    finishFrame();
  };
  const waitForLoads = (pending) => {
    const settled = Promise.allSettled(pending).then(() => false);
    if (!(loadHoldTimeoutMs > 0)) {
      return settled;
    }
    let timer = 0;
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => resolve(true), loadHoldTimeoutMs);
    });
    return Promise.race([settled, timeout]).finally(() => clearTimeout(timer));
  };
  const endRun = () => {
    running = false;
    generation += 1;
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
    rafPending = false;
    if (ticker) {
      ticker.stop();
      ticker = null;
    }
  };
  const start = (nextSource) => {
    if (nextSource !== void 0) {
      currentSource = String(nextSource);
    }
    endRun();
    if (runtime) {
      runtime.dispose();
    }
    if (!currentSource.trim()) {
      emitError(new Error("Empty source"));
      return;
    }
    try {
      bytecode = compileSource(currentSource);
      runtimeCanvas.width = initialRuntimeWidth;
      runtimeCanvas.height = initialRuntimeHeight;
      vm = new VM();
      vm.load(bytecode);
      runtime = new CanvasEngineRuntime({
        vm,
        ctx: runtimeCtx,
        inputElement: canvasEl,
        maxTexts,
        files: currentFiles,
        netIceServers,
        netUi: netPanel,
        width: runtimeCanvas.width,
        height: runtimeCanvas.height,
        clearColor,
        debugDrawProcessBounds,
        debugProcessBoundsColor,
        debugShowStats,
        debugStatsTextColor,
        debugStatsBgColor,
        debugStatsX,
        debugStatsY,
        logFn: (line) => {
          if (typeof onLog === "function") {
            onLog(line);
          }
        }
      });
      runtime.registerNatives();
      running = true;
      lastTs = 0;
      nextFrameTs = 0;
      const runId = generation;
      schedule(runId);
    } catch (err) {
      emitError(err);
    }
  };
  const stop = () => {
    endRun();
  };
  const destroy = () => {
    endRun();
    if (runtime) {
      runtime.dispose();
    }
    window.removeEventListener("keydown", handleKeyDown);
    window.removeEventListener("keyup", handleKeyUp);
    window.removeEventListener("blur", handleBlur);
    if (netPanel) {
      netPanel.close();
    }
    vm = null;
    runtime = null;
    bytecode = null;
  };
  const setSource = (nextSource) => {
    currentSource = String(nextSource || "");
  };
  const setFiles = (nextFiles) => {
    currentFiles = nextFiles || null;
  };
  const setNetInvite = (code) => {
    if (netPanel) {
      netPanel.invite = code ? String(code) : null;
    }
  };
  const getState = () => ({
    running,
    vm,
    runtime,
    bytecode,
    source: currentSource
  });
  if (autoStart) {
    start();
  }
  return {
    start,
    stop,
    destroy,
    setSource,
    setFiles,
    setNetInvite,
    getState
  };
}
function preloadAssets(manifest) {
  const safeManifest = manifest || {};
  const imageJobs = (safeManifest.images || []).map((src) => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve();
    img.onerror = () => reject(new Error(`Failed to load image: ${src}`));
    img.src = src;
  }));
  const audioJobs = (safeManifest.audio || []).map((src) => new Promise((resolve, reject) => {
    const audio = new Audio();
    const done = () => {
      audio.removeEventListener("canplaythrough", done);
      audio.removeEventListener("error", fail);
      resolve();
    };
    const fail = () => {
      audio.removeEventListener("canplaythrough", done);
      audio.removeEventListener("error", fail);
      reject(new Error(`Failed to load audio: ${src}`));
    };
    audio.addEventListener("canplaythrough", done, { once: true });
    audio.addEventListener("error", fail, { once: true });
    audio.preload = "auto";
    audio.src = src;
    audio.load();
  }));
  return Promise.all([...imageJobs, ...audioJobs]);
}
function installVirtualKeys(options) {
  const {
    container,
    getRuntime,
    mapping = {
      up: "ArrowUp",
      down: "ArrowDown",
      left: "ArrowLeft",
      right: "ArrowRight",
      fire: "z"
    }
  } = options;
  if (!container) {
    return () => {
    };
  }
  const wrapper = document.createElement("div");
  wrapper.className = "divjs-vkeys";
  wrapper.innerHTML = `
    <div class="divjs-pad divjs-pad-left">
      <button class="divjs-vkey divjs-vkey-up" data-key="${mapping.up}">UP</button>
      <button class="divjs-vkey divjs-vkey-left" data-key="${mapping.left}">LEFT</button>
      <button class="divjs-vkey divjs-vkey-right" data-key="${mapping.right}">RIGHT</button>
      <button class="divjs-vkey divjs-vkey-down" data-key="${mapping.down}">DOWN</button>
    </div>
    <div class="divjs-pad divjs-pad-right">
      <button class="divjs-vkey divjs-vkey-fire" data-key="${mapping.fire}">FIRE</button>
    </div>
  `;
  const pressedByPointer = /* @__PURE__ */ new Map();
  const keyPressCount = /* @__PURE__ */ new Map();
  const cleanups = [];
  const setState = (key, isDown) => {
    const runtime = getRuntime?.();
    if (!runtime) {
      return;
    }
    runtime.setKeyState(key, isDown);
  };
  const holdKey = (key) => {
    const count = keyPressCount.get(key) || 0;
    keyPressCount.set(key, count + 1);
    if (count === 0) {
      setState(key, true);
    }
  };
  const releaseKey = (key) => {
    const count = keyPressCount.get(key) || 0;
    if (count <= 1) {
      keyPressCount.delete(key);
      setState(key, false);
      return;
    }
    keyPressCount.set(key, count - 1);
  };
  const buttons = Array.from(wrapper.querySelectorAll(".divjs-vkey"));
  for (const button of buttons) {
    const key = button.dataset.key;
    const pointerDown = (event) => {
      event.preventDefault();
      button.setPointerCapture(event.pointerId);
      pressedByPointer.set(event.pointerId, key);
      button.classList.add("active");
      holdKey(key);
    };
    const pointerUp = (event) => {
      const stored = pressedByPointer.get(event.pointerId);
      if (!stored) {
        return;
      }
      pressedByPointer.delete(event.pointerId);
      button.classList.remove("active");
      releaseKey(stored);
    };
    button.addEventListener("pointerdown", pointerDown);
    button.addEventListener("pointerup", pointerUp);
    button.addEventListener("pointercancel", pointerUp);
    button.addEventListener("lostpointercapture", pointerUp);
    cleanups.push(() => {
      button.removeEventListener("pointerdown", pointerDown);
      button.removeEventListener("pointerup", pointerUp);
      button.removeEventListener("pointercancel", pointerUp);
      button.removeEventListener("lostpointercapture", pointerUp);
    });
  }
  container.appendChild(wrapper);
  return () => {
    for (const key of keyPressCount.keys()) {
      setState(key, false);
    }
    keyPressCount.clear();
    pressedByPointer.clear();
    for (const cleanup of cleanups) {
      cleanup();
    }
    wrapper.remove();
  };
}
async function bootDivDemo(options) {
  const {
    canvas,
    source,
    clearColor = "#0b1117",
    virtualWidth,
    virtualHeight,
    debugDrawProcessBounds = false,
    debugProcessBoundsColor = "#00ffff",
    debugShowStats = false,
    debugStatsTextColor = "#e6fffb",
    debugStatsBgColor = "rgba(6, 10, 18, 0.7)",
    debugStatsX = 8,
    debugStatsY = 8,
    preventDefaultKeys = true,
    preload = { images: [], audio: [] },
    loadingElement,
    errorElement,
    loadingText = "Loading assets...",
    startingText = "Starting VM...",
    showVirtualKeys = false,
    virtualKeysContainer,
    onLog,
    onFrame,
    onError
  } = options || {};
  const setLoading = (text) => {
    if (!loadingElement) return;
    loadingElement.textContent = text;
    loadingElement.classList.remove("hidden");
  };
  const hideLoading = () => {
    if (!loadingElement) return;
    loadingElement.classList.add("hidden");
  };
  const showError = (err) => {
    if (errorElement) {
      errorElement.textContent = err?.message || String(err);
      errorElement.classList.remove("hidden");
    }
    if (typeof onError === "function") {
      onError(err);
    } else {
      console.error(err);
    }
  };
  setLoading(loadingText);
  try {
    await preloadAssets(preload);
    setLoading(startingText);
    const runner = runDivDemo({
      canvas,
      source,
      clearColor,
      autoStart: true,
      preventDefaultKeys,
      virtualWidth,
      virtualHeight,
      debugDrawProcessBounds,
      debugProcessBoundsColor,
      debugShowStats,
      debugStatsTextColor,
      debugStatsBgColor,
      debugStatsX,
      debugStatsY,
      onLog,
      onFrame,
      onError: showError
    });
    let uninstallKeys = () => {
    };
    if (showVirtualKeys) {
      uninstallKeys = installVirtualKeys({
        container: virtualKeysContainer,
        getRuntime: () => runner.getState().runtime
      });
    }
    hideLoading();
    return {
      runner,
      destroy() {
        uninstallKeys();
        runner.destroy();
      }
    };
  } catch (err) {
    showError(err);
    throw err;
  }
}

// compiler/disasm.js
function invert(obj) {
  const out = {};
  for (const [key, value] of Object.entries(obj || {})) {
    out[value] = key;
  }
  return out;
}
function formatConstant(value) {
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  return String(value);
}
function buildAddressRanges(bytecode) {
  const entries = [];
  for (const [name, info] of bytecode.functionTable) {
    entries.push({ name, kind: "FUNCTION", addr: info.addr, locals: info.locals || null });
  }
  for (const [name, info] of bytecode.processTable) {
    entries.push({ name, kind: "PROCESS", addr: info.addr, locals: info.locals || null });
  }
  entries.push({ name: "main", kind: "MAIN", addr: bytecode.mainAddr, locals: bytecode.mainLocals || null });
  entries.sort((a2, b) => a2.addr - b.addr);
  if (entries.length > 0 && entries[0].addr > 0) {
    entries.unshift({ name: "globals", kind: "INIT", addr: 0, locals: null });
  }
  for (let i = 0; i < entries.length; i++) {
    entries[i].end = i + 1 < entries.length ? entries[i + 1].addr : bytecode.instructions.length;
  }
  return entries;
}
function formatOperands(bytecode, instr, localsByIdx, globalsByIdx) {
  const ops = instr.operands || [];
  switch (instr.opcode) {
    case OpCodes.LOAD_CONST: {
      const idx = ops[0];
      const value = bytecode.constants[idx];
      return { text: String(idx), comment: formatConstant(value) };
    }
    case OpCodes.LOAD_LOCAL:
    case OpCodes.STORE_LOCAL: {
      const slot = ops[0];
      const varName = localsByIdx ? localsByIdx[slot] : void 0;
      return { text: String(slot), comment: varName };
    }
    case OpCodes.LOAD_GLOBAL:
    case OpCodes.STORE_GLOBAL: {
      const idx = ops[0];
      return { text: String(idx), comment: globalsByIdx[idx] };
    }
    case OpCodes.JUMP:
    case OpCodes.JUMP_IF_FALSE:
    case OpCodes.JUMP_IF_TRUE:
    case OpCodes.LOOP:
      return { text: `-> ${ops[0]}` };
    case OpCodes.CALL:
    case OpCodes.CALL_NATIVE:
    case OpCodes.SPAWN_PROCESS:
      return { text: ops.map((o) => typeof o === "string" ? o : String(o)).join(", ") };
    case OpCodes.FRAME:
      return { text: ops[0] === 1 ? "(value from stack)" : "(default 100)" };
    default:
      return { text: ops.map((o) => typeof o === "string" ? JSON.stringify(o) : String(o)).join(", ") };
  }
}
function disassemble(bytecode) {
  const lines = [];
  const ranges = buildAddressRanges(bytecode);
  const globalsByIdx = invert(bytecode.globals);
  lines.push(`; ${bytecode.instructions.length} instructions, ${bytecode.constants.length} constants, ${bytecode.processTable.size} processes, ${bytecode.functionTable.size} functions`);
  if (bytecode.constants.length > 0) {
    lines.push("");
    lines.push("; --- constant pool ---");
    bytecode.constants.forEach((value, idx) => {
      lines.push(`;   [${idx}] ${formatConstant(value)}`);
    });
  }
  for (const range of ranges) {
    const header = `== ${range.kind} ${range.name} `;
    lines.push("");
    lines.push(header + "=".repeat(Math.max(0, 60 - header.length)));
    const localsByIdx = range.locals ? invert(range.locals) : null;
    for (let addr = range.addr; addr < range.end; addr++) {
      const instr = bytecode.instructions[addr];
      const opName = OpCodeNames[instr.opcode] || `UNKNOWN(0x${instr.opcode.toString(16)})`;
      const { text, comment } = formatOperands(bytecode, instr, localsByIdx, globalsByIdx);
      let line = `${String(addr).padStart(5, " ")}: ${opName.padEnd(14)} ${text}`;
      if (comment) {
        line += `  ; ${comment}`;
      }
      lines.push(line);
    }
  }
  return lines.join("\n");
}

// tools/packer.js
var ENGINE_ENTRY = "divjs.js";
var IMPORT_RE = /^[ \t]*import\s+(?:[\s\S]*?\s+from\s+)?(['"])(\.{1,2}\/[^'"]+)\1\s*;?/gm;
var DYNAMIC_IMPORT_RE = /\bimport\s*\(/;
var MODULE_TOKEN = (path) => `__DIVJS_MODULE__[${path}]`;
function resolveModulePath(fromPath, specifier) {
  const parts = fromPath.split("/");
  parts.pop();
  for (const part of specifier.split("/")) {
    if (part === "..") {
      if (parts.length === 0) {
        throw new Error(`Import ${specifier} in ${fromPath} leaves the engine folder`);
      }
      parts.pop();
    } else if (part !== "." && part !== "") {
      parts.push(part);
    }
  }
  return parts.join("/");
}
async function collectEngineModules(readText, entry = ENGINE_ENTRY) {
  const sources = /* @__PURE__ */ new Map();
  const order = [];
  const visiting = /* @__PURE__ */ new Set();
  const visit = async (path, chain) => {
    if (sources.has(path)) {
      return;
    }
    if (visiting.has(path)) {
      throw new Error(`Import cycle: ${[...chain, path].join(" -> ")} (the packer needs an acyclic engine)`);
    }
    visiting.add(path);
    const source = await readText(path);
    if (DYNAMIC_IMPORT_RE.test(source.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, ""))) {
      throw new Error(`${path} uses a dynamic import(), which the packer does not follow`);
    }
    const deps = [];
    const rewritten = source.replace(IMPORT_RE, (statement, quote, specifier) => {
      const target = resolveModulePath(path, specifier);
      deps.push(target);
      return statement.replace(`${quote}${specifier}${quote}`, `${quote}${MODULE_TOKEN(target)}${quote}`);
    });
    for (const dep of deps) {
      await visit(dep, [...chain, path]);
    }
    visiting.delete(path);
    sources.set(path, rewritten);
    order.push(path);
  };
  await visit(entry, []);
  return order.map((path) => ({ path, source: sources.get(path) }));
}
function programResolution(source) {
  const code = String(source).replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  const call = code.match(/set_mode\s*\(([^)]*)\)/i);
  if (!call) {
    return [320, 200];
  }
  const mode = call[1].trim().match(/^m(\d+)x(\d+)$/i);
  if (mode) {
    return [Number(mode[1]), Number(mode[2])];
  }
  const pair = call[1].split(",").map((v) => Number(v.trim()));
  return pair.length === 2 && pair.every(Number.isInteger) ? pair : null;
}
function findAssetReferences(source) {
  const code = String(source).replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  const re2 = /\bload_(?:graphic|tile|map|fpg|fnt|bdf_font|wav|pcm)\s*\(\s*(["'])([^"'\n]+)\1/gi;
  const found = [];
  for (const match of code.matchAll(re2)) {
    if (!found.includes(match[2])) {
      found.push(match[2]);
    }
  }
  return found;
}
var B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function bytesToBase64(bytes) {
  let out = "";
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = bytes[i] << 16 | bytes[i + 1] << 8 | bytes[i + 2];
    out += B64[n >> 18] + B64[n >> 12 & 63] + B64[n >> 6 & 63] + B64[n & 63];
  }
  if (i < bytes.length) {
    const n = bytes[i] << 16 | (i + 1 < bytes.length ? bytes[i + 1] : 0) << 8;
    out += B64[n >> 18] + B64[n >> 12 & 63];
    out += i + 1 < bytes.length ? B64[n >> 6 & 63] : "=";
    out += "=";
  }
  return out;
}
function scriptJson(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}
function escapeHtml(text) {
  return String(text).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}
var ENGINE_NOTICE = `DivJS engine - https://github.com/akadjoker/divjs
MIT License. Copyright (c) 2026 akadjoker

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;
var LOADER = `
const modules = JSON.parse(document.getElementById('divjs-modules').textContent);
const game = JSON.parse(document.getElementById('divjs-game').textContent);
const errorEl = document.getElementById('divjs-error');
const showError = (err) =>
{
  errorEl.textContent = String(err && err.message ? err.message : err);
  errorEl.hidden = false;
  console.error(err);
};
try
{
  const urls = {};
  for (const mod of modules)
  {
    // One module (the dist/divjs.js bundle) has no imports to rewrite -
    // and its own text holds the packer, token pattern included.
    const code = modules.length === 1 ? mod.source
      : mod.source.replace(/__DIVJS_MODULE__\\[([^\\]]+)\\]/g, (token, path) => urls[path]);
    urls[mod.path] = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
  }
  const { runDivDemo } = await import(urls[modules[modules.length - 1].path]);
  const files = {};
  for (const [name, b64] of Object.entries(game.files))
  {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++)
    {
      bytes[i] = bin.charCodeAt(i);
    }
    files[name] = bytes;
  }
  const canvas = document.getElementById('game');
  // Scale to the window, keeping the aspect ratio of whatever size the
  // program runs at (set_mode can change it while it runs).
  let fitted = '';
  const fit = () =>
  {
    const scale = Math.min(window.innerWidth / canvas.width, window.innerHeight / canvas.height);
    canvas.style.width = Math.floor(canvas.width * scale) + 'px';
    canvas.style.height = Math.floor(canvas.height * scale) + 'px';
    fitted = canvas.width + 'x' + canvas.height;
  };
  fit();
  window.addEventListener('resize', fit);
  // Full screen on the button; fit() rescales on the resize that follows.
  const fullscreenBtn = document.getElementById('divjs-fullscreen');
  let hideTimer = 0;
  const showButton = () =>
  {
    const credit = document.getElementById('divjs-credit');
    fullscreenBtn.classList.add('show');
    credit?.classList.add('show');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() =>
    {
      fullscreenBtn.classList.remove('show');
      credit?.classList.remove('show');
    }, 2000);
  };
  window.addEventListener('mousemove', showButton);
  showButton();
  if (!document.documentElement.requestFullscreen)
  {
    fullscreenBtn.hidden = true;
  }
  fullscreenBtn.addEventListener('click', async () =>
  {
    if (document.fullscreenElement)
    {
      await document.exitFullscreen();
    }
    else
    {
      await document.documentElement.requestFullscreen().catch(() => {});
    }
    canvas.focus({ preventScroll: true });
  });
  canvas.addEventListener('pointerdown', () => canvas.focus({ preventScroll: true }));
  canvas.focus({ preventScroll: true });
  window.divGame = runDivDemo({
    canvas,
    source: game.source,
    files,
    clearColor: game.clearColor,
    onFrame: () =>
    {
      if (fitted !== canvas.width + 'x' + canvas.height)
      {
        fit();
      }
    },
    onError: showError,
    // Online games: when this page is on a web site, an invitation can
    // travel as a link to it (a file on disk cannot be opened by someone
    // else, so there only the code is offered).
    netInviteLink: /^https?:$/.test(location.protocol)
      ? (code) => location.href.split('#')[0] + '#net=' + code
      : null
  });
  const invite = new URLSearchParams(location.hash.slice(1)).get('net');
  if (invite)
  {
    window.divGame.setNetInvite(invite);
    history.replaceState(null, '', location.href.split('#')[0]);
  }
}
catch (err)
{
  showError(err);
}
`;
function buildPackedHtml({ modules, source, files = {}, title = "DivJS game", width, height, clearColor = "#000000", credit = true }) {
  const [autoW, autoH] = programResolution(source) || [320, 200];
  if (!/^(#[0-9a-f]{3,8}|[a-z]+)$/i.test(String(clearColor))) {
    clearColor = "#000000";
  }
  const w = Number(width) || autoW;
  const h = Number(height) || autoH;
  const encoded = {};
  for (const [name, bytes] of Object.entries(files)) {
    encoded[name] = bytesToBase64(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  }
  const game = { source: String(source), files: encoded, clearColor };
  return `<!DOCTYPE html>
<!--
${ENGINE_NOTICE}
-->
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="DivJS packer">
<title>${escapeHtml(title)}</title>
<style>
  html, body { margin: 0; height: 100%; background: ${escapeHtml(clearColor)}; }
  body { display: flex; align-items: center; justify-content: center; overflow: hidden; }
  /* The game keeps its own resolution; fit() scales it to the window. */
  canvas { image-rendering: pixelated; outline: none; display: block; }
  /* Full screen button: shown while the mouse moves, hidden when idle. */
  #divjs-fullscreen { position: fixed; top: 8px; right: 8px; padding: 4px 9px; border: 1px solid #fff4;
                      border-radius: 6px; background: #0008; color: #fff; font: 16px sans-serif; cursor: pointer;
                      opacity: 0; transition: opacity 0.3s; }
  #divjs-fullscreen.show, #divjs-credit.show { opacity: 1; }
  #divjs-credit { position: fixed; bottom: 6px; right: 8px; color: #fffa; font: 11px sans-serif; text-decoration: none;
                  background: #0008; padding: 2px 6px; border-radius: 4px; opacity: 0; transition: opacity 0.3s; }
  #divjs-error { position: fixed; left: 8px; right: 8px; bottom: 8px; margin: 0; padding: 8px;
                 background: #300; color: #fbb; font: 13px monospace; white-space: pre-wrap; }
</style>
</head>
<body>
<canvas id="game" width="${w}" height="${h}" tabindex="0"></canvas>
<button id="divjs-fullscreen" title="Full screen (Esc leaves)">\u26F6</button>
${credit ? '<a id="divjs-credit" href="https://github.com/akadjoker/divjs" target="_blank" rel="noopener">made with DivJS</a>\n' : ""}<pre id="divjs-error" hidden></pre>
<script type="application/json" id="divjs-modules">${scriptJson(modules)}<\/script>
<script type="application/json" id="divjs-game">${scriptJson(game)}<\/script>
<script type="module">${LOADER}<\/script>
</body>
</html>
`;
}

// index.js
var VERSION = "1.0.0";
function compile(source) {
  const tokens = new Lexer(String(source)).tokenize();
  const ast = new Parser(tokens).parse();
  return new Compiler().compile(ast);
}
function bundleEngineModules(bundleText) {
  return [{ path: "divjs.js", source: String(bundleText) }];
}
export {
  BUILTIN_CONSTANTS,
  CType,
  CanvasEngineRuntime,
  Compiler,
  DivError,
  KEYWORD_NAMES,
  Lexer,
  OpCodeNames,
  OpCodes,
  PROCESS_FIELD_NAMES,
  Parser,
  TokenType,
  VERSION,
  VM,
  bootDivDemo,
  buildPackedHtml,
  bundleEngineModules,
  collectEngineModules,
  compile,
  createNetPanel,
  decodeCode,
  disassemble,
  encodeCode,
  findAssetReferences,
  hashState,
  loadDivFntFromUrl,
  loadDivFpgFromUrl,
  loadDivMapFromUrl,
  noteFrequency,
  parseDivFntBuffer,
  parseDivFpgBuffer,
  parseDivMapBuffer,
  parseNotes,
  programResolution,
  renderDivFontText,
  runDivDemo,
  sfxRecipe,
  synthesize
};
