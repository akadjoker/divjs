// Records short animated GIFs of the playground's games, for the README
// and the game pages: each game is opened in Chromium (Playwright), taken
// past its title screens, played for a few seconds with real key presses
// and mouse drags, and its canvas is recorded.
//
//   node tools/capture.mjs                     every game in SHOTS
//   node tools/capture.mjs fighter bomber      some of them
//   options: --out docs/media  --width 320  --fps 8
//            --check  also saves <id>-end.png, the game's last frame
//
// Needs Playwright's Chromium (npx playwright install chromium) and the
// gifenc package (a dev dependency).

import http from 'node:http';
import { readFile, stat, mkdir, writeFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import gifenc from 'gifenc';

const { GIFEncoder, quantize, applyPalette } = gifenc;
const ROOT = fileURLToPath(new URL('..', import.meta.url));

// Steps: ['wait', ms], ['press', key], ['down', key], ['up', key],
// ['hold', key, ms], ['drag', x1, y1, x2, y2, ms] and ['click', x, y] in
// the game's own coordinates. `setup` runs before recording, `play` while
// it records for `seconds`.
const hold = (key, ms) => ['hold', key, ms];
const SHOTS = {
  fighter: {
    seconds: 7,
    setup: [['wait', 1500], ['press', 'Enter'], ['wait', 900], ['press', 'Enter'], ['wait', 900], ['press', 'Enter'], ['wait', 900], ['press', 'Enter'], ['wait', 2600]],
    play: [hold('ArrowRight', 500), ['press', 'a'], ['wait', 150], ['press', 's'], ['wait', 150], ['press', 'd'], ['wait', 300],
      ['press', 'z'], ['wait', 200], ['press', 'c'], ['wait', 400], hold('ArrowRight', 300), ['press', 'x'], ['wait', 300],
      ['down', 'ArrowDown'], ['wait', 50], ['down', 'ArrowRight'], ['wait', 50], ['up', 'ArrowDown'], ['press', 'd'], ['up', 'ArrowRight'],
      ['wait', 700], hold('ArrowUp', 100), ['wait', 300], ['press', 'c'], ['wait', 600], ['press', 'a'], ['press', 's'], ['press', 'd']]
  },
  bomber: {
    seconds: 7,
    setup: [['wait', 1500], ['press', 'Enter'], ['wait', 900], ['press', 'Enter'], ['wait', 1500]],
    play: [['press', 'Space'], hold('ArrowDown', 400), hold('ArrowRight', 500), ['wait', 1600], hold('ArrowLeft', 500),
      ['press', 'Space'], hold('ArrowUp', 400), hold('ArrowRight', 300), ['wait', 1500], hold('ArrowDown', 500)]
  },
  strike: {
    seconds: 7,
    setup: [['wait', 7000], ['press', 'Space'], ['wait', 900], ['press', 'Space'], ['wait', 1200]],
    play: [['down', 'ArrowUp'], ['down', 'Space'], ['wait', 1200], hold('ArrowLeft', 500), ['wait', 800], ['press', 'z'],
      ['wait', 500], ['press', 'z'], hold('d', 600), ['up', 'Space'], ['wait', 600], ['press', 'x'], hold('ArrowRight', 600), ['up', 'ArrowUp']]
  },
  'bad-cat': {
    seconds: 7,
    setup: [['wait', 1500], ['press', 'Enter'], ['wait', 1500]],
    play: [hold('ArrowRight', 600), hold('ArrowUp', 200), ['press', 'x'], hold('ArrowRight', 400), hold('Space', 250), ['press', 'x'],
      ['wait', 150], ['press', 'x'], hold('ArrowLeft', 700), hold('ArrowUp', 300), ['press', 'x'], ['wait', 800], hold('ArrowRight', 900), ['press', 'x']]
  },
  'chicken-cannon': {
    seconds: 7,
    setup: [['wait', 1500], ['press', 'Space'], ['wait', 1200]],
    play: [['drag', 400, 300, 330, 190, 400], ['wait', 3000], ['press', '3'], ['drag', 400, 300, 360, 200, 400], ['wait', 900], ['click', 400, 200]]
  },
  'wobbly-walker': {
    seconds: 7,
    setup: [['wait', 1200]],
    play: [hold('q', 300), hold('o', 200), hold('w', 300), hold('p', 200), hold('q', 300), hold('o', 200), hold('w', 300), hold('p', 200),
      hold('q', 300), hold('o', 200), hold('w', 300), hold('p', 200), hold('q', 400), hold('o', 300)]
  },
  'ghost-squad': {
    seconds: 7,
    setup: [['wait', 1500], ['press', 'Space'], ['wait', 2600]],
    play: [hold('ArrowLeft', 700), hold('ArrowUp', 600), ['press', '2'], hold('ArrowRight', 700), hold('ArrowDown', 500), ['press', '3'],
      hold('ArrowUp', 800), ['press', '4'], hold('ArrowLeft', 900), hold('ArrowDown', 700)]
  },
  'net-tanks': {
    seconds: 6,
    setup: [['wait', 1000], ['press', '5'], ['wait', 800]],
    play: [['down', 'w'], ['down', 'ArrowUp'], ['wait', 700], ['press', 'Space'], ['press', 'Enter'], hold('a', 300), hold('ArrowLeft', 300),
      ['wait', 600], ['press', 'Space'], ['press', 'Enter'], hold('d', 400), ['wait', 700], ['press', 'Space'], ['up', 'w'], ['up', 'ArrowUp']]
  },
  racer: {
    seconds: 6,
    setup: [['wait', 1500], ['press', 'Space'], ['wait', 1500]],
    play: [['down', 'ArrowUp'], ['wait', 1200], hold('ArrowLeft', 400), ['wait', 800], hold('ArrowRight', 500), ['wait', 900], hold('ArrowLeft', 300), ['up', 'ArrowUp']]
  },
  pinball: {
    seconds: 6,
    setup: [['wait', 1500], ['press', 'Space'], ['wait', 800]],
    play: [hold('Space', 1000), ['wait', 1200], ['press', 'z'], ['press', 'm'], ['wait', 600], ['press', 'z'], ['wait', 400], ['press', 'm'],
      ['wait', 500], ['press', 'z'], ['press', 'm']]
  },
  'vector-asteroids': {
    seconds: 6,
    setup: [['wait', 1200], ['press', 'Enter'], ['wait', 800]],
    play: [['down', 'Space'], hold('ArrowLeft', 500), hold('ArrowUp', 400), hold('ArrowRight', 700), hold('ArrowUp', 300), ['wait', 600],
      hold('ArrowLeft', 900), ['up', 'Space']]
  }
};

function option(name, fallback)
{
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.div': 'text/plain', '.md': 'text/markdown' };

function startServer()
{
  const server = http.createServer(async (req, res) =>
  {
    try
    {
      let file = normalize(join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname)));
      if (!file.startsWith(ROOT))
      {
        res.writeHead(403).end();
        return;
      }
      if ((await stat(file)).isDirectory())
      {
        file = join(file, 'index.html');
      }
      res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
      res.end(await readFile(file));
    }
    catch
    {
      res.writeHead(404).end();
    }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function runSteps(page, steps)
{
  const box = async () => page.$eval('#game', (c) =>
  {
    const r = c.getBoundingClientRect();
    return { x: r.x, y: r.y, sx: r.width / c.width, sy: r.height / c.height };
  });
  for (const step of steps)
  {
    const [kind, a, b, c, d, e] = step;
    if (kind === 'wait')
    {
      await page.waitForTimeout(a);
    }
    else if (kind === 'press')
    {
      await page.keyboard.press(a);
    }
    else if (kind === 'down')
    {
      await page.keyboard.down(a);
    }
    else if (kind === 'up')
    {
      await page.keyboard.up(a);
    }
    else if (kind === 'hold')
    {
      await page.keyboard.down(a);
      await page.waitForTimeout(b);
      await page.keyboard.up(a);
    }
    else if (kind === 'drag' || kind === 'click')
    {
      const g = await box();
      await page.mouse.move(g.x + a * g.sx, g.y + b * g.sy);
      await page.mouse.down();
      if (kind === 'drag')
      {
        await page.mouse.move(g.x + c * g.sx, g.y + d * g.sy, { steps: 10 });
        await page.waitForTimeout(e);
      }
      await page.mouse.up();
    }
  }
}

async function record(page, seconds, fps, width)
{
  await page.evaluate((w) =>
  {
    const src = document.getElementById('game');
    const h = Math.round(src.height * w / src.width);
    const small = document.createElement('canvas');
    small.width = w;
    small.height = h;
    const ctx = small.getContext('2d', { willReadFrequently: true });
    window.__grab = () =>
    {
      ctx.drawImage(src, 0, 0, w, h);
      const data = ctx.getImageData(0, 0, w, h).data;
      let binary = '';
      for (let i = 0; i < data.length; i += 0x8000)
      {
        binary += String.fromCharCode.apply(null, data.subarray(i, i + 0x8000));
      }
      return { w, h, b64: btoa(binary) };
    };
  }, width);
  const frames = [];
  const step = 1000 / fps;
  const start = Date.now();
  let next = start;
  while (Date.now() - start < seconds * 1000)
  {
    const shot = await page.evaluate(() => window.__grab());
    frames.push({ ...shot, t: Date.now() });
    next += step;
    const wait = next - Date.now();
    if (wait > 0)
    {
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }
  return frames;
}

function encode(frames)
{
  const { w, h } = frames[0];
  const pixels = frames.map((f) => new Uint8Array(Buffer.from(f.b64, 'base64')));
  // One palette for the whole clip, from a sample of its frames.
  const sampleEvery = Math.max(1, Math.floor(frames.length / 8));
  const sample = pixels.filter((_, i) => i % sampleEvery === 0);
  const joined = new Uint8Array(sample.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of sample)
  {
    joined.set(p, offset);
    offset += p.length;
  }
  const palette = quantize(joined, 256);
  const gif = GIFEncoder();
  pixels.forEach((p, i) =>
  {
    const delay = i + 1 < frames.length ? frames[i + 1].t - frames[i].t : 100;
    gif.writeFrame(applyPalette(p, palette), w, h, i === 0 ? { palette, delay } : { delay });
  });
  gif.finish();
  return gif.bytes();
}

const names = process.argv.slice(2).filter((a, i, all) => !a.startsWith('--') && !(all[i - 1] || '').startsWith('--'));
const ids = names.length > 0 ? names : Object.keys(SHOTS);
const outDir = join(ROOT, option('out', 'docs/media'));
const width = Number(option('width', 320));
const fps = Number(option('fps', 8));

const server = await startServer();
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();
await mkdir(outDir, { recursive: true });
try
{
  for (const id of ids)
  {
    const shot = SHOTS[id];
    if (!shot)
    {
      console.log(`skip ${id}: no script for it in tools/capture.mjs`);
      continue;
    }
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    const problems = [];
    page.on('pageerror', (e) => problems.push(e.message));
    page.on('console', (m) =>
    {
      if (m.type() === 'error' || m.type() === 'warning')
      {
        problems.push(m.text());
      }
    });
    await page.goto(`${base}/playground/#p=${id}`);
    await page.waitForFunction(() => window.divPlayground?.getState()?.runtime, null, { timeout: 15000 });
    await page.click('#game');
    await runSteps(page, shot.setup);
    const recording = record(page, shot.seconds, fps, width);
    await runSteps(page, shot.play);
    const frames = await recording;
    const bytes = encode(frames);
    const file = join(outDir, `${id}.gif`);
    await writeFile(file, bytes);
    if (process.argv.includes('--check'))
    {
      await (await page.$('#game')).screenshot({ path: join(outDir, `${id}-end.png`) });
    }
    console.log(`${id}: ${frames.length} frames, ${frames[0].w}x${frames[0].h}, ${(bytes.length / 1024).toFixed(0)} KB${problems.length ? `, ${problems.length} console problems: ${problems[0]}` : ''}`);
    await page.close();
  }
}
finally
{
  await browser.close();
  server.close();
}
