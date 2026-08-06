// Token types
export const TokenType = {
  // Literals
  NUMBER: 'NUMBER',
  STRING: 'STRING',
  IDENTIFIER: 'IDENTIFIER',

  // Keywords
  PROGRAM: 'PROGRAM',
  PROCESS: 'PROCESS',
  FUNCTION: 'FUNCTION',
  GLOBAL: 'GLOBAL',
  PRIVATE: 'PRIVATE',
  VAR: 'VAR',
  BEGIN: 'BEGIN',
  END: 'END',
  IF: 'IF',
  ELSE: 'ELSE',
  FOR: 'FOR',
  TO: 'TO',
  STEP: 'STEP',
  WHILE: 'WHILE',
  REPEAT: 'REPEAT',
  UNTIL: 'UNTIL',
  LOOP: 'LOOP',
  FRAME: 'FRAME',
  RETURN: 'RETURN',
  BREAK: 'BREAK',
  CONTINUE: 'CONTINUE',
  SWITCH: 'SWITCH',
  CASE: 'CASE',
  DEFAULT: 'DEFAULT',
  NOT: 'NOT',
  AND: 'AND',
  OR: 'OR',
  TYPE: 'TYPE',

  // Operators
  EQUALS: 'EQUALS',     // = (assignment)
  EQ: 'EQ',            // == (equality)
  NEQ: 'NEQ',          // != (inequality)
  LT: 'LT',            // < (less than)
  LTE: 'LTE',          // <= (less than or equal)
  GT: 'GT',            // > (greater than)
  GTE: 'GTE',          // >= (greater than or equal)
  PLUS: 'PLUS',        // +
  MINUS: 'MINUS',      // -
  STAR: 'STAR',        // *
  SLASH: 'SLASH',      // /
  PERCENT: 'PERCENT',  // %

  // Delimiters
  LPAREN: 'LPAREN',
  RPAREN: 'RPAREN',
  LBRACKET: 'LBRACKET',
  RBRACKET: 'RBRACKET',
  DOT: 'DOT',
  COMMA: 'COMMA',
  SEMICOLON: 'SEMICOLON',

  // Special
  EOF: 'EOF'
};

// Token class
export class Token {
  constructor(type, value, line, col) {
    this.type = type;
    this.value = value;
    this.line = line;
    this.col = col;
  }
}

// Keywords map
const KEYWORDS = {
  'PROGRAM': TokenType.PROGRAM,
  'PROCESS': TokenType.PROCESS,
  'FUNCTION': TokenType.FUNCTION,
  'GLOBAL': TokenType.GLOBAL,
  'PRIVATE': TokenType.PRIVATE,
  'VAR': TokenType.VAR,
  'BEGIN': TokenType.BEGIN,
  'END': TokenType.END,
  'IF': TokenType.IF,
  'ELSE': TokenType.ELSE,
  'FOR': TokenType.FOR,
  'TO': TokenType.TO,
  'STEP': TokenType.STEP,
  'WHILE': TokenType.WHILE,
  'REPEAT': TokenType.REPEAT,
  'UNTIL': TokenType.UNTIL,
  'LOOP': TokenType.LOOP,
  'FRAME': TokenType.FRAME,
  'RETURN': TokenType.RETURN,
  'BREAK': TokenType.BREAK,
  'CONTINUE': TokenType.CONTINUE,
  'SWITCH': TokenType.SWITCH,
  'CASE': TokenType.CASE,
  'DEFAULT': TokenType.DEFAULT,
  'NOT': TokenType.NOT,
  'AND': TokenType.AND,
  'OR': TokenType.OR,
  'TYPE': TokenType.TYPE
};

// Lexer class
export class Lexer {
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
    if (char === '\n') {
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

  // Skip comments
  skipComment() {
    if (this.current() === '/' && this.peek() === '/') {
      while (this.current() && this.current() !== '\n') {
        this.advance();
      }
      // Consume newline
      if (this.current() === '\n') {
        this.advance();
      }
      return true;
    }
    return false;
  }

  // Read number
  readNumber() {
    let num = '';
    while (this.current() && /[0-9.]/.test(this.current())) {
      num += this.advance();
    }
    return num;
  }

  // Read string
  readString() {
    const quote = this.current();
    const startLine = this.line;
    const startCol = this.col;
    this.advance(); // consume opening quote

    // Standard backslash escapes. The previous implementation only
    // special-cased "\" followed by the *same* quote character (so a
    // string could contain its own delimiter), and treated every other
    // backslash as a literal character — meaning "line1\nline2" produced
    // the four literal characters '\', 'n' between "line1" and "line2"
    // instead of an actual newline. Any DIV script trying to embed a
    // newline, tab, or literal backslash in a string (e.g. for a
    // multi-line text() call) got silently wrong data with no error.
    const escapes = {
      n: '\n',
      t: '\t',
      r: '\r',
      '0': '\0',
      '\\': '\\',
      "'": "'",
      '"': '"'
    };

    let str = '';
    while (this.current()) {
      if (this.current() === '\\') {
        const next = this.peek();
        if (next !== null && Object.prototype.hasOwnProperty.call(escapes, next)) {
          this.advance(); // consume backslash
          str += escapes[this.advance()]; // consume + translate escaped char
          continue;
        }
        // Unknown escape (e.g. "\q"): keep the backslash literal rather
        // than silently eating it, so unrecognized sequences are visible
        // in the output instead of vanishing.
        str += this.advance();
        continue;
      }

      if (this.current() === quote) {
        this.advance(); // consume closing quote
        return str;
      }

      str += this.advance();
    }

    throw new Error(`Unterminated string at line ${startLine}, col ${startCol}`);
  }

  // Read identifier or keyword
  readIdentifier() {
    let id = '';
    while (this.current() && /[a-zA-Z0-9_]/.test(this.current())) {
      id += this.advance();
    }
    return id;
  }

  // Tokenize
  tokenize() {
    this.tokens = [];

    while (this.current()) {
      // Skip whitespace
      this.skipWhitespace();

      // Skip comments
      if (this.skipComment()) {
        continue;
      }

      if (!this.current()) {
        break;
      }

      const line = this.line;
      const col = this.col;
      const char = this.current();

      // Number
      if (/[0-9]/.test(char)) {
        const num = this.readNumber();
        this.tokens.push(new Token(TokenType.NUMBER, num, line, col));
        continue;
      }

      // String
      if (char === '"' || char === "'") {
        const str = this.readString();
        this.tokens.push(new Token(TokenType.STRING, str, line, col));
        continue;
      }

      // Identifier or keyword
      if (/[a-zA-Z_]/.test(char)) {
        const id = this.readIdentifier();
        const keyword = KEYWORDS[id.toUpperCase()];
        if (keyword) {
          this.tokens.push(new Token(keyword, id, line, col));
        } else {
          this.tokens.push(new Token(TokenType.IDENTIFIER, id, line, col));
        }
        continue;
      }

      // Two-character operators
      if (char === '=' && this.peek() === '=') {
        this.advance();
        this.advance();
        this.tokens.push(new Token(TokenType.EQ, '==', line, col));
        continue;
      }

      if (char === '!' && this.peek() === '=') {
        this.advance();
        this.advance();
        this.tokens.push(new Token(TokenType.NEQ, '!=', line, col));
        continue;
      }

      if (char === '<' && this.peek() === '=') {
        this.advance();
        this.advance();
        this.tokens.push(new Token(TokenType.LTE, '<=', line, col));
        continue;
      }

      if (char === '>' && this.peek() === '=') {
        this.advance();
        this.advance();
        this.tokens.push(new Token(TokenType.GTE, '>=', line, col));
        continue;
      }

      if (char === '&' && this.peek() === '&') {
        this.advance();
        this.advance();
        this.tokens.push(new Token(TokenType.AND, '&&', line, col));
        continue;
      }

      if (char === '|' && this.peek() === '|') {
        this.advance();
        this.advance();
        this.tokens.push(new Token(TokenType.OR, '||', line, col));
        continue;
      }

      // Single-character operators and delimiters
      switch (char) {
        case '=':
          this.advance();
          this.tokens.push(new Token(TokenType.EQUALS, '=', line, col));
          break;
        case '<':
          this.advance();
          this.tokens.push(new Token(TokenType.LT, '<', line, col));
          break;
        case '>':
          this.advance();
          this.tokens.push(new Token(TokenType.GT, '>', line, col));
          break;
        case '+':
          this.advance();
          this.tokens.push(new Token(TokenType.PLUS, '+', line, col));
          break;
        case '-':
          this.advance();
          this.tokens.push(new Token(TokenType.MINUS, '-', line, col));
          break;
        case '*':
          this.advance();
          this.tokens.push(new Token(TokenType.STAR, '*', line, col));
          break;
        case '/':
          this.advance();
          this.tokens.push(new Token(TokenType.SLASH, '/', line, col));
          break;
        case '%':
          this.advance();
          this.tokens.push(new Token(TokenType.PERCENT, '%', line, col));
          break;
        case '(':
          this.advance();
          this.tokens.push(new Token(TokenType.LPAREN, '(', line, col));
          break;
        case ')':
          this.advance();
          this.tokens.push(new Token(TokenType.RPAREN, ')', line, col));
          break;
        case '[':
          this.advance();
          this.tokens.push(new Token(TokenType.LBRACKET, '[', line, col));
          break;
        case ']':
          this.advance();
          this.tokens.push(new Token(TokenType.RBRACKET, ']', line, col));
          break;
        case '.':
          this.advance();
          this.tokens.push(new Token(TokenType.DOT, '.', line, col));
          break;
        case ',':
          this.advance();
          this.tokens.push(new Token(TokenType.COMMA, ',', line, col));
          break;
        case ';':
          this.advance();
          this.tokens.push(new Token(TokenType.SEMICOLON, ';', line, col));
          break;
        case '!':
          this.advance();
          this.tokens.push(new Token(TokenType.NOT, '!', line, col));
          break;
        default:
          throw new Error(`Unexpected character '${char}' at line ${line}, col ${col}`);
      }
    }

    // Add EOF token
    this.tokens.push(new Token(TokenType.EOF, '', this.line, this.col));

    return this.tokens;
  }
}
