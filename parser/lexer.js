/**
 * DivLang Lexer
 * Tokenizer para a linguagem Div (estilo Div Games Studio)
 */

// Tokens
export const TokenType = {
  // EOF
  EOF: 'eof',
  
  // Literais
  IDENTIFIER: 'identifier',
  NUMBER: 'number',
  STRING: 'string',
  
  // Keywords
  PROGRAM: 'program',
  PROCESS: 'process',
  GLOBAL: 'global',
  LOCAL: 'local',
  PRIVATE: 'private',
  
  BEGIN: 'begin',
  END: 'end',
  
  IF: 'if',
  ELSE: 'else',
  
  SWITCH: 'switch',
  CASE: 'case',
  DEFAULT: 'default',
  
  WHILE: 'while',
  DO: 'do',
  REPEAT: 'repeat',
  UNTIL: 'until',
  LOOP: 'loop',
  FOR: 'for',
  
  BREAK: 'break',
  CONTINUE: 'continue',
  RETURN: 'return',
  
  FRAME: 'frame',
  
  TRUE: 'true',
  FALSE: 'false',
  NIL: 'nil',
  
  // Operadores
  PLUS: 'plus',
  MINUS: 'minus',
  STAR: 'star',
  SLASH: 'slash',
  MOD: 'mod',
  
  ASSIGN: 'assign',
  
  PLUS_ASSIGN: 'plus_assign',
  MINUS_ASSIGN: 'minus_assign',
  STAR_ASSIGN: 'star_assign',
  SLASH_ASSIGN: 'slash_assign',
  MOD_ASSIGN: 'mod_assign',
  
  INC: 'inc',
  DEC: 'dec',
  
  EQUAL: 'equal',
  NOT_EQUAL: 'not_equal',
  
  LESS: 'less',
  LESS_EQUAL: 'less_equal',
  
  GREATER: 'greater',
  GREATER_EQUAL: 'greater_equal',
  
  NOT: 'not',
  AND: 'and',
  OR: 'or',
  XOR: 'xor',
  
  // Delimitadores
  LPAREN: 'lparen',
  RPAREN: 'rparen',
  
  LBRACE: 'lbrace',
  RBRACE: 'rbrace',
  
  LBRACKET: 'lbracket',
  RBRACKET: 'rbracket',
  
  COMMA: 'comma',
  DOT: 'dot',
  COLON: 'colon',
  SEMICOLON: 'semicolon',
  
  QUESTION: 'question',
  
  // Misc
  ARROW: 'arrow'
};

// Keywords map
const keywords = {
  'program': TokenType.PROGRAM,
  'process': TokenType.PROCESS,
  'global': TokenType.GLOBAL,
  'local': TokenType.LOCAL,
  'private': TokenType.PRIVATE,
  'begin': TokenType.BEGIN,
  'end': TokenType.END,
  
  'if': TokenType.IF,
  'else': TokenType.ELSE,
  
  'switch': TokenType.SWITCH,
  'case': TokenType.CASE,
  'default': TokenType.DEFAULT,
  
  'while': TokenType.WHILE,
  'do': TokenType.DO,
  'repeat': TokenType.REPEAT,
  'until': TokenType.UNTIL,
  'loop': TokenType.LOOP,
  'for': TokenType.FOR,
  
  'break': TokenType.BREAK,
  'continue': TokenType.CONTINUE,
  'return': TokenType.RETURN,
  
  'frame': TokenType.FRAME,
  
  'true': TokenType.TRUE,
  'false': TokenType.FALSE,
  'nil': TokenType.NIL,
  
  'and': TokenType.AND,
  'or': TokenType.OR,
  'xor': TokenType.XOR,
  'not': TokenType.NOT,
  'mod': TokenType.MOD
};

// Constants (começam com _)
const constants = {
  '_esc': TokenType.IDENTIFIER,
  '_space': TokenType.IDENTIFIER,
  '_right': TokenType.IDENTIFIER,
  '_left': TokenType.IDENTIFIER,
  '_up': TokenType.IDENTIFIER,
  '_down': TokenType.IDENTIFIER,
  '_dt': TokenType.IDENTIFIER,
  '_solid': TokenType.IDENTIFIER,
  '_sensor': TokenType.IDENTIFIER,
  '_platform': TokenType.IDENTIFIER,
  '_oneway': TokenType.IDENTIFIER,
  '_shot': TokenType.IDENTIFIER,
  '_danger': TokenType.IDENTIFIER
};

// Token class
export class Token {
  constructor(type, value, line, column) {
    this.type = type;
    this.value = value;
    this.line = line;
    this.column = column;
  }
  
  toString() {
    return `Token(${this.type}, "${this.value}", ${this.line}:${this.column})`;
  }
}

// Lexer
class Lexer {
  constructor(source) {
    this.source = source;
    this.pos = 0;
    this.line = 1;
    this.column = 1;
    this.tokens = [];
  }
  
  // Caractere atual
  currentChar() {
    if (this.pos >= this.source.length) {
      return null;
    }
    return this.source[this.pos];
  }
  
  // Próximo caractere
  peekChar() {
    if (this.pos + 1 >= this.source.length) {
      return null;
    }
    return this.source[this.pos + 1];
  }
  
  // Avançar
  advance() {
    const char = this.currentChar();
    if (char === '\n') {
      this.line++;
      this.column = 1;
    } else {
      this.column++;
    }
    this.pos++;
    return char;
  }
  
  // Skip whitespace
  skipWhitespace() {
    while (this.currentChar() && this.currentChar().trim() === '') {
      this.advance();
    }
  }
  
  // Skip comments
  skipComment() {
    if (this.currentChar() === '/' && this.peekChar() === '/') {
      while (this.currentChar() && this.currentChar() !== '\n') {
        this.advance();
      }
    }
  }
  
  // Ler número
  readNumber() {
    const startLine = this.line;
    const startColumn = this.column;
    let result = '';
    
    // Parte inteira
    while (this.currentChar() && /[0-9]/.test(this.currentChar())) {
      result += this.advance();
    }
    
    // Parte decimal
    if (this.currentChar() === '.' && this.peekChar() && /[0-9]/.test(this.peekChar())) {
      result += this.advance(); // .
      while (this.currentChar() && /[0-9]/.test(this.currentChar())) {
        result += this.advance();
      }
    }
    
    return new Token(TokenType.NUMBER, result, startLine, startColumn);
  }
  
  // Ler string
  readString() {
    const startLine = this.line;
    const startColumn = this.column;
    const quote = this.advance(); // " ou '
    let result = '';
    
    while (this.currentChar() && this.currentChar() !== quote) {
      if (this.currentChar() === '\\') {
        this.advance(); // \
        const escaped = this.advance();
        
        switch (escaped) {
          case 'n': result += '\n'; break;
          case 't': result += '\t'; break;
          case 'r': result += '\r'; break;
          case '\\': result += '\\'; break;
          case quote: result += quote; break;
          default: result += escaped;
        }
      } else {
        result += this.advance();
      }
    }
    
    if (this.currentChar() === quote) {
      this.advance(); // fecha string
    }
    
    return new Token(TokenType.STRING, result, startLine, startColumn);
  }
  
  // Ler identificador ou keyword
  readIdent() {
    const startLine = this.line;
    const startColumn = this.column;
    let result = '';
    
    // Primeiro caractere: letra, _ ou $
    while (this.currentChar() && /[a-zA-Z_$]/.test(this.currentChar())) {
      result += this.advance();
    }
    
    // Restante: letra, dólar, underscore ou dólar
    while (this.currentChar() && /[a-zA-Z0-9_$]/.test(this.currentChar())) {
      result += this.advance();
    }
    
    // Verificar se é keyword
    if (keywords[result]) {
      return new Token(keywords[result], result, startLine, startColumn);
    }
    
    // Constants e identificadores
    return new Token(TokenType.IDENTIFIER, result, startLine, startColumn);
  }
  
  // Ler operador ou delimiter
  readOperator() {
    const startLine = this.line;
    const startColumn = this.column;
    const char = this.advance();
    const next = this.peekChar();
    
    switch (char) {
      case '=':
        if (next === '=') {
          this.advance();
          return new Token(TokenType.EQUAL, '==', startLine, startColumn);
        }
        return new Token(TokenType.ASSIGN, '=', startLine, startColumn);
      
      case '!':
        if (next === '=') {
          this.advance();
          return new Token(TokenType.NOT_EQUAL, '!=', startLine, startColumn);
        }
        return new Token(TokenType.NOT, '!', startLine, startColumn);
      
      case '<':
        if (next === '=') {
          this.advance();
          return new Token(TokenType.LESS_EQUAL, '<=', startLine, startColumn);
        }
        return new Token(TokenType.LESS, '<', startLine, startColumn);
      
      case '>':
        if (next === '=') {
          this.advance();
          return new Token(TokenType.GREATER_EQUAL, '>=', startLine, startColumn);
        }
        return new Token(TokenType.GREATER, '>', startLine, startColumn);
      
      case '+':
        if (next === '=') {
          this.advance();
          return new Token(TokenType.PLUS_ASSIGN, '+=', startLine, startColumn);
        }
        if (next === '+') {
          this.advance();
          return new Token(TokenType.INC, '++', startLine, startColumn);
        }
        return new Token(TokenType.PLUS, '+', startLine, startColumn);
      
      case '-':
        if (next === '=') {
          this.advance();
          return new Token(TokenType.MINUS_ASSIGN, '-=', startLine, startColumn);
        }
        if (next === '-') {
          this.advance();
          return new Token(TokenType.DEC, '--', startLine, startColumn);
        }
        if (next === '>') {
          this.advance();
          return new Token(TokenType.ARROW, '->', startLine, startColumn);
        }
        return new Token(TokenType.MINUS, '-', startLine, startColumn);
      
      case '*':
        if (next === '=') {
          this.advance();
          return new Token(TokenType.STAR_ASSIGN, '*=', startLine, startColumn);
        }
        return new Token(TokenType.STAR, '*', startLine, startColumn);
      
      case '/':
        if (next === '=') {
          this.advance();
          return new Token(TokenType.SLASH_ASSIGN, '/=', startLine, startColumn);
        }
        return new Token(TokenType.SLASH, '/', startLine, startColumn);
      
      case '%':
        if (next === '=') {
          this.advance();
          return new Token(TokenType.MOD_ASSIGN, '%=', startLine, startColumn);
        }
        return new Token(TokenType.MOD, '%', startLine, startColumn);
      
      case '&':
        if (next === '&') {
          this.advance();
          return new Token(TokenType.AND, '&&', startLine, startColumn);
        }
        return new Token(TokenType.ILLEGAL, '&', startLine, startColumn);
      
      case '|':
        if (next === '|') {
          this.advance();
          return new Token(TokenType.OR, '||', startLine, startColumn);
        }
        return new Token(TokenType.ILLEGAL, '|', startLine, startColumn);
      
      case '^':
        return new Token(TokenType.XOR, '^', startLine, startColumn);
      
      case '(':
        return new Token(TokenType.LPAREN, '(', startLine, startColumn);
      
      case ')':
        return new Token(TokenType.RPAREN, ')', startLine, startColumn);
      
      case '{':
        return new Token(TokenType.LBRACE, '{', startLine, startColumn);
      
      case '}':
        return new Token(TokenType.RBRACE, '}', startLine, startColumn);
      
      case '[':
        return new Token(TokenType.LBRACKET, '[', startLine, startColumn);
      
      case ']':
        return new Token(TokenType.RBRACKET, ']', startLine, startColumn);
      
      case ',':
        return new Token(TokenType.COMMA, ',', startLine, startColumn);
      
      case ';':
        return new Token(TokenType.SEMICOLON, ';', startLine, startColumn);
      
      case ':':
        return new Token(TokenType.COLON, ':', startLine, startColumn);
      
      case '.':
        return new Token(TokenType.DOT, '.', startLine, startColumn);
      
      case '?':
        return new Token(TokenType.QUESTION, '?', startLine, startColumn);
      
      default:
        return new Token(TokenType.EOF, char, startLine, startColumn);
    }
  }
  
  // Tokenizar
  tokenize() {
    while (this.currentChar()) {
      // Skip whitespace
      this.skipWhitespace();
      if (!this.currentChar()) break;
      
      // Skip comments
      this.skipComment();
      if (!this.currentChar()) break;
      
      const char = this.currentChar();
      
      // Números
      if (/[0-9]/.test(char)) {
        this.tokens.push(this.readNumber());
      }
      // Strings
      else if (char === '"' || char === "'") {
        this.tokens.push(this.readString());
      }
      // Identificadores ou keywords
      else if (/[a-zA-Z_$]/.test(char)) {
        this.tokens.push(this.readIdent());
      }
      // Operadores ou delimiters
      else {
        this.tokens.push(this.readOperator());
      }
    }
    
    // EOF
    this.tokens.push(new Token(TokenType.EOF, '', this.line, this.column));
    
    return this.tokens;
  }
}

// Export
export { Lexer };
