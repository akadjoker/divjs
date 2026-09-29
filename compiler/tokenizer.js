import { DivError } from './errors.js';

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
  STRUCT: 'STRUCT',
  GLOBAL: 'GLOBAL',
  PRIVATE: 'PRIVATE',
  VAR: 'VAR',
  BEGIN: 'BEGIN',
  END: 'END',
  IF: 'IF',
  ELSE: 'ELSE',
  FOR: 'FOR',
  FROM: 'FROM', // classic-DIV spelling of FOR ... TO ...; body END
  TO: 'TO',
  STEP: 'STEP',
  WHILE: 'WHILE',
  REPEAT: 'REPEAT',
  UNTIL: 'UNTIL',
  LOOP: 'LOOP',
  LOCAL: 'LOCAL',
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
  OFFSET: 'OFFSET',

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
  INCREMENT: 'INCREMENT',       // ++
  DECREMENT: 'DECREMENT',       // --
  PLUS_ASSIGN: 'PLUS_ASSIGN',   // +=
  MINUS_ASSIGN: 'MINUS_ASSIGN', // -=
  STAR_ASSIGN: 'STAR_ASSIGN',   // *=
  SLASH_ASSIGN: 'SLASH_ASSIGN', // /=

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
  'STRUCT': TokenType.STRUCT,
  'GLOBAL': TokenType.GLOBAL,
  'PRIVATE': TokenType.PRIVATE,
  'VAR': TokenType.VAR,
  'BEGIN': TokenType.BEGIN,
  'END': TokenType.END,
  'IF': TokenType.IF,
  'ELSE': TokenType.ELSE,
  'FOR': TokenType.FOR,
  'FROM': TokenType.FROM,
  'TO': TokenType.TO,
  'STEP': TokenType.STEP,
  'WHILE': TokenType.WHILE,
  'REPEAT': TokenType.REPEAT,
  'UNTIL': TokenType.UNTIL,
  'LOOP': TokenType.LOOP,
  'LOCAL': TokenType.LOCAL,
  // DIV spells the modulus operator MOD as well as %
  'MOD': TokenType.PERCENT,
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
  'TYPE': TokenType.TYPE,
  'OFFSET': TokenType.OFFSET
};

// Reserved words, uppercase as DIV writes them (the lexer matches them in
// any case). Exported for tooling such as the playground's highlighting.
export const KEYWORD_NAMES = Object.freeze(Object.keys(KEYWORDS));

// Keywords that stand in for an operator symbol.
const KEYWORD_OPERATOR_VALUES = {
  [TokenType.PERCENT]: '%'
};

// Keywords the parser also accepts as variable names (see
// Parser.isIdentifierLike), so their value is a name like any other.
const NAME_LIKE_KEYWORDS = new Set([TokenType.VAR, TokenType.TO, TokenType.STEP]);

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

  // True when a "--" at the current position is the decrement operator
  // rather than the start of a single-line comment. Both spellings are
  // supported (DIV proper only has // and /* */, but this engine's own
  // demos use -- for comments). Decrement is postfix-only and only valid
  // as a statement or a C-FOR step ("n--;", "FOR (...; i--)"), so it must
  // follow something assignable AND be followed by ';' or ')'. Looking
  // only at what came before misread "IF (r == 0) -- note" and
  // "x = 5 -- note" as a decrement. VAR/TO/STEP are keywords that are
  // also accepted as variable names ("step--;").
  isDecrementContext()
  {
    const prev = this.tokens[this.tokens.length - 1];
    if (!prev)
    {
      return false;
    }
    const followsValue = prev.type === TokenType.IDENTIFIER ||
      prev.type === TokenType.VAR ||
      prev.type === TokenType.TO ||
      prev.type === TokenType.STEP ||
      prev.type === TokenType.RPAREN ||
      prev.type === TokenType.RBRACKET;
    if (!followsValue)
    {
      return false;
    }
    let i = this.pos + 2;
    while (i < this.source.length && (this.source[i] === ' ' || this.source[i] === '\t'))
    {
      i++;
    }
    return this.source[i] === ';' || this.source[i] === ')';
  }

  // Skip comments
  skipComment() {
    // Single-line: // or -- (the latter only when it isn't a decrement)
    if ((this.current() === '/' && this.peek() === '/') ||
        (this.current() === '-' && this.peek() === '-' && !this.isDecrementContext())) {
      while (this.current() && this.current() !== '\n') this.advance();
      if (this.current() === '\n') this.advance();
      return true;
    }
    // Block: /* ... */. An unclosed one used to swallow the rest of the
    // file silently, surfacing as a misleading error far away (or none).
    if (this.current() === '/' && this.peek() === '*')
    {
      const startLine = this.line;
      const startCol = this.col;
      this.advance(); this.advance(); // consume /*
      while (this.current())
      {
        if (this.current() === '*' && this.peek() === '/')
        {
          this.advance(); this.advance(); // consume */
          return true;
        }
        this.advance();
      }
      throw new DivError('Unterminated /* comment', { stage: 'lexer', line: startLine, col: startCol });
    }
    return false;
  }

  // Read number. At most one decimal point: "1.2.3" used to be read as
  // the single token "1.2.3", which parseFloat quietly turned into 1.2.
  readNumber()
  {
    const startLine = this.line;
    const startCol = this.col;
    let num = '';
    let seenDot = false;
    while (this.current() && /[0-9.]/.test(this.current()))
    {
      if (this.current() === '.')
      {
        if (seenDot)
        {
          throw new DivError(`Malformed number '${num}.'`, { stage: 'lexer', line: startLine, col: startCol });
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
    this.advance(); // consume opening quote

    // Standard backslash escapes. The previous implementation only
    // special-cased "\" followed by the *same* quote character (so a
    // string could contain its own delimiter), and treated every other
    // backslash as a literal character - meaning "line1\nline2" produced
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

    throw new DivError('Unterminated string', { stage: 'lexer', line: startLine, col: startCol });
  }

  // Read identifier or keyword
  readIdentifier() {
    let id = '';
    while (this.current() && /[a-zA-Z0-9_]/.test(this.current())) {
      id += this.advance();
    }
    return id;
  }

  // Record where the most recently pushed token ends (the position just
  // past its last character). The parser uses it to report a missing ';'
  // right after the statement instead of at the start of the next line.
  markLastTokenEnd()
  {
    const last = this.tokens[this.tokens.length - 1];
    if (last && last.endLine === undefined)
    {
      last.endLine = this.line;
      last.endCol = this.col;
    }
  }

  // Tokenize
  tokenize() {
    this.tokens = [];

    while (this.current()) {
      // The previous iteration's token (if any) ended exactly here.
      this.markLastTokenEnd();

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
        // DIV names are case-insensitive ("ABc or abC are the same name",
        // DIV 2 manual 5.5), like its keywords. Folding every name to
        // lower case here, once, makes X/x, SAY/say, TYPE Enemy/enemy and
        // every declared name agree everywhere downstream (compiler maps,
        // processTable/functionTable/globals, native lookups). The
        // keywords that double as names (VAR/TO/STEP) are folded too.
        if (keyword) {
          // Word-spelled operators carry the symbol as their value, since
          // the parser passes token.value straight through as the operator
          // name (compileBinary only knows the symbols). Without this,
          // "a MOD b" reached the compiler as the operator "MOD".
          const value = KEYWORD_OPERATOR_VALUES[keyword] ??
            (NAME_LIKE_KEYWORDS.has(keyword) ? id.toLowerCase() : id);
          this.tokens.push(new Token(keyword, value, line, col));
        } else {
          this.tokens.push(new Token(TokenType.IDENTIFIER, id.toLowerCase(), line, col));
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

      // ++/-- must be tested before += and -=, and before the bare
      // +/- single-character cases further down.
      if (char === '+' && this.peek() === '+') {
        this.advance();
        this.advance();
        this.tokens.push(new Token(TokenType.INCREMENT, '++', line, col));
        continue;
      }

      if (char === '-' && this.peek() === '-') {
        this.advance();
        this.advance();
        this.tokens.push(new Token(TokenType.DECREMENT, '--', line, col));
        continue;
      }

      if (char === '+' && this.peek() === '=') {
        this.advance();
        this.advance();
        this.tokens.push(new Token(TokenType.PLUS_ASSIGN, '+=', line, col));
        continue;
      }

      if (char === '-' && this.peek() === '=') {
        this.advance();
        this.advance();
        this.tokens.push(new Token(TokenType.MINUS_ASSIGN, '-=', line, col));
        continue;
      }

      if (char === '*' && this.peek() === '=') {
        this.advance();
        this.advance();
        this.tokens.push(new Token(TokenType.STAR_ASSIGN, '*=', line, col));
        continue;
      }

      if (char === '/' && this.peek() === '=') {
        this.advance();
        this.advance();
        this.tokens.push(new Token(TokenType.SLASH_ASSIGN, '/=', line, col));
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
        case '&':
          // A lone & is DIV's address-of operator - "&score" is just
          // another spelling of "OFFSET score" (&& was already consumed
          // as AND above), so emit the same token the parser expects.
          this.advance();
          this.tokens.push(new Token(TokenType.OFFSET, '&', line, col));
          break;
        default:
          throw new DivError(`Unexpected character '${char}'`, { stage: 'lexer', line, col });
      }
    }

    this.markLastTokenEnd();

    // Add EOF token
    this.tokens.push(new Token(TokenType.EOF, '', this.line, this.col));

    return this.tokens;
  }
}
