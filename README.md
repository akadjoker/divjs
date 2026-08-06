# DivJS

Div Games Studio-inspired language in JavaScript - VM + Parser + Canvas Renderer

## Status

- [x] Lexer (Tokenizer)
- [x] Parser (AST)
- [x] Compiler (Bytecode)
- [x] VM (Virtual Machine)
- [x] Process Manager (Indexed)
- [x] Canvas 2D Renderer
- [x] Input System
- [x] Graphics Manager
- [ ] Full integration test

## Estrutura

```
├── parser/
│   ├── lexer.js       # Tokenizer
│   ├── ast.js         # Node types
│   └── parser.js      # Parser
│
├── compiler/
│   ├── bytecode.js    # Opcodes
│   └── compiler.js    # AST → Bytecode
│
├── vm/
│   ├── vm.js          # Virtual Machine
│   ├── process.js     # Process manager (indexed)
│   ├── frame.js       # Frame system
│   └── runtime.js     # Native functions
│
├── graph/
│   ├── canvas2d.js    # Canvas 2D renderer
│   ├── graphics.js    # Graphics manager
│   └── input.js       # Input system
│
└── examples/
    ├── platformer.div # DivLang code
    └── index.html     # Example
```

## Exemplo

```div
program "Platformer";

global
  player_graph;

process player(x=100, y=400, width=32, height=32);
private
  graph = 0;
  vy = 0;
  grounded = false;

begin
  repeat
    if (key_down("right")) x += 200 * _dt; end
    if (key_down("left")) x -= 200 * _dt; end
    if (key_down("space") && grounded) vy = -400; end
    
    vy += 500 * _dt;
    y += vy * _dt;
    
    if (collision(TYPE ground))
      vy = 0;
      y = ground.y - height;
      grounded = true;
    end
    
    frame;
  until (false)
end
```

## Uso

```bash
# Open in browser
open examples/index.html
```

Teste smoke (browser-first, com preload de assets):

```bash
open examples/browser-smoke.html
```

Teste unitario VM (browser, corre tudo numa pagina):

```bash
open tests/test.html
```

## API de arranque rapido

Para reduzir boilerplate nas demos, usa a API unica:

```js
import { runDivDemo } from './divjs.js';

runDivDemo({
  canvas: 'gameCanvas',
  source: `program demo; begin loop frame; end end`
});
```

Isso faz automaticamente:
- lexer + parser + compiler
- criacao da VM
- registo dos natives do runtime
- input de teclado
- game loop com render

## LicenÃ§a

MIT
