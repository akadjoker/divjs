# DivJS quick testing tutorials

These are small tests to validate game APIs fast.

## 1) Random API smoke test

Goal: validate rand/random/rand_seed range behavior.

```div
program test_rand;
global i = 0;

begin
  rand_seed(12345);

  loop
    if (i < 5)
      print('rand=', rand(1, 10), ' random=', random(20, 30));
      i = i + 1;
    end
    frame;
  end
end
```

Expected:
- rand values stay between 1 and 10
- random values stay between 20 and 30
- same sequence after same rand_seed

## 2) Point and pivot test

Goal: validate graph points and point 0 as pivot.

```div
program test_points;

process probe();
begin
  graph = 7;
  x = 200;
  y = 120;
  angle = 45000;
  size = 120;

  set_point(0, graph, 0, 16, 16);
  set_point(0, graph, 1, 32, 16);

  loop
    var p = get_point(0, graph, 1);
    var rp = get_real_point(0, graph, 1);
    print('p=', p.x, p.y, ' rp=', rp.x, rp.y);
    frame;
  end
end

begin
  probe();
  loop frame; end
end
```

Expected:
- p stays constant (local graph point)
- rp changes with x/y/angle/size of process

## 3) Movement with advance/xadvance

Goal: validate process movement by angle.

```div
program test_advance;

process mover();
begin
  x = 200;
  y = 200;
  angle = 0;

  loop
    if (key(_right)) angle = angle + 2000; end
    if (key(_left)) angle = angle - 2000; end

    advance(2);
    xput(0, 2, x, y, angle, 100, 0, 0);
    frame;
  end
end

begin
  mover();
  loop frame; end
end
```

Expected:
- object moves in current process angle
- turning left/right changes trajectory

## Fast run flow

1. Open examples page.
2. Replace source with one test above.
3. Press Play.
4. Watch console output and canvas behavior.
