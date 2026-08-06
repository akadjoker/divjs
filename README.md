# DivJS

Div Games Studio-inspired language in JavaScript - VM + Parser + Canvas Renderer

## Status

- [x] Lexer (Tokenizer)
- [ ] Parser (AST)
- [ ] VM (Bytecode)
- [ ] Runtime (Native functions)
- [ ] Graph (Canvas 2D)

## Exemplo

```div
program "Platformer";

global
  player_graph;

process player(x=100, y=400, width=32, height=32);
private
  graph = player_graph;
  vy = 0;
  grounded = false;

begin
  repeat
    if (key_down(_right)) x += 200 * _dt; end
    if (key_down(_left)) x -= 200 * _dt; end
    if (key_down(_space) && grounded) vy = -400; end
    
    vy += 500 * _dt;
    y += vy * _dt;
    
    if (collision(type ground))
      vy = 0;
      y = ground.y - height;
      grounded = true;
    end
    
    frame;
  until (false)
end
```

## LicenÃ§a

MIT
