// Browser checks of the engine, run with `npm run test:browser` (needs
// Playwright's Chromium: `npx playwright install chromium` on a fresh
// machine): the engine's test suite (tests/test.html), the single-file
// build, and a packed game. The playground and the games are tested in
// github.com/akadjoker/divjs-playground.
//
// A small static server over the repository root is started on a free
// port, so nothing else needs to be running.

import http from 'node:http';
import { readFile, readdir, stat, mkdtemp, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.div': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.fpg': 'application/octet-stream',
  '.fnt': 'application/octet-stream',
  '.map': 'application/octet-stream'
};

function startServer()
{
  const server = http.createServer(async (req, res) =>
  {
    try
    {
      const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      let file = normalize(join(ROOT, urlPath));
      if (!file.startsWith(ROOT))
      {
        res.writeHead(403).end();
        return;
      }
      if ((await stat(file)).isDirectory())
      {
        file = join(file, 'index.html');
      }
      const body = await readFile(file);
      res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
      res.end(body);
    }
    catch
    {
      res.writeHead(404).end('not found');
    }
  });
  return new Promise((resolve) =>
  {
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

const results = [];

async function check(name, fn)
{
  const started = Date.now();
  try
  {
    await fn();
    results.push({ name, ok: true });
    console.log(`PASS  ${name} (${Date.now() - started} ms)`);
  }
  catch (err)
  {
    results.push({ name, ok: false, error: err.message });
    console.log(`FAIL  ${name}\n      ${String(err.message).split('\n').join('\n      ')}`);
  }
}

function assert(condition, message)
{
  if (!condition)
  {
    throw new Error(message);
  }
}

// Collect page errors, console errors and failed requests.
function watch(page)
{
  const problems = [];
  page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
  page.on('console', (m) =>
  {
    if (m.type() === 'error')
    {
      problems.push(`console error: ${m.text()}`);
    }
  });
  page.on('requestfailed', (r) => problems.push(`request failed: ${r.url()}`));
  page.on('response', (r) =>
  {
    if (r.status() >= 400)
    {
      problems.push(`HTTP ${r.status()}: ${r.url()}`);
    }
  });
  return problems;
}

// Number of distinct colours in a sample of the canvas (1 = blank).
async function canvasColours(page, selector = 'canvas')
{
  return page.$eval(selector, (canvas) =>
  {
    const ctx = canvas.getContext('2d');
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const seen = new Set();
    for (let i = 0; i < data.length; i += 4 * 97)
    {
      seen.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
    }
    return seen.size;
  });
}

async function listPages(dir)
{
  const names = await readdir(join(ROOT, dir));
  return names.filter((n) => n.endsWith('.html')).map((n) => `${dir}/${n}`);
}

const server = await startServer();
const BASE = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();

try
{
  // ── 1. Engine test suite ──────────────────────────────────────────────
  await check('tests/test.html: engine test suite', async () =>
  {
    const page = await browser.newPage();
    await page.goto(`${BASE}/tests/test.html`);
    await page.waitForFunction(() => /test\(s\) (passed|failed)|All .*passed|failed\./i.test(document.body.innerText), null, { timeout: 120000 });
    const lines = (await page.evaluate(() => document.body.innerText)).split('\n');
    const failed = [];
    lines.forEach((line, i) =>
    {
      if (/^FAIL/.test(line))
      {
        failed.push(`${line} :: ${lines[i + 2] || ''}`);
      }
    });
    const passed = lines.filter((line) => /^PASS/.test(line)).length;
    await page.close();
    assert(passed > 0, 'no test ran');
    assert(failed.length === 0, `${failed.length} failed:\n${failed.join('\n')}`);
  });

  // dist/divjs.js (npm run build): the whole engine in one module with no
  // imports. It runs a program on its own, exposes the public API, and a
  // game packed from it (as divjs-playground's Export does) runs offline.
  await check('bundle: dist/divjs.js runs a program, and a game packed from it runs offline', async () =>
  {
    const page = await browser.newPage();
    const problems = watch(page);
    await page.goto(`${BASE}/tests/simples.html`);
    const result = await page.evaluate(async () =>
    {
      const divjs = await import('/dist/divjs.js');
      const canvas = document.createElement('canvas');
      canvas.width = 160;
      canvas.height = 100;
      document.body.appendChild(canvas);
      const game = divjs.runDivDemo({ canvas, source: 'program b; global n; begin loop n = n + 1; frame; end end' });
      await new Promise((resolve) => setTimeout(resolve, 400));
      const state = game.getState();
      const frames = state.vm.globals.get(state.bytecode.globals.n);
      game.destroy();
      const bytecode = divjs.compile('program c; begin end');
      const response = await fetch('/dist/divjs.js');
      const html = divjs.buildPackedHtml({
        modules: divjs.bundleEngineModules(await response.text()),
        source: 'program packed; global n; begin set_mode(160, 100); loop n = n + 1; frame; end end'
      });
      return {
        version: divjs.VERSION,
        api: ['runDivDemo', 'VM', 'CanvasEngineRuntime', 'Lexer', 'Parser', 'Compiler', 'DivError', 'hashState', 'parseDivFpgBuffer'].filter((k) => !divjs[k]),
        frames,
        compiled: Array.isArray(bytecode.code) || typeof bytecode === 'object',
        html
      };
    });
    await page.close();
    assert(problems.length === 0, problems.join('\n'));
    const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
    assert(result.version === pkg.version, `VERSION ${result.version} should match package.json ${pkg.version}`);
    assert(result.api.length === 0, `missing from the public API: ${result.api.join(', ')}`);
    assert(result.frames > 5, `the bundle should run the program (${result.frames} frames)`);
    assert(result.compiled, 'compile() should return bytecode');

    const dir = await mkdtemp(join(tmpdir(), 'divjs-bundle-'));
    try
    {
      const file = join(dir, 'packed.html');
      await (await import('node:fs/promises')).writeFile(file, result.html);
      const offline = await browser.newPage();
      const offProblems = watch(offline);
      const network = [];
      await offline.route('**/*', (route) =>
      {
        const url = route.request().url();
        if (/^(file|blob|data):/.test(url))
        {
          return route.continue();
        }
        network.push(url);
        return route.abort();
      });
      await offline.goto(`file://${file}`);
      await offline.waitForFunction(() => window.divGame?.getState?.().running, null, { timeout: 5000 });
      await offline.waitForTimeout(300);
      const n = await offline.evaluate(() =>
      {
        const s = window.divGame.getState();
        return s.vm.globals.get(s.bytecode.globals.n);
      });
      await offline.close();
      assert(offProblems.length === 0, offProblems.join('\n'));
      assert(network.length === 0, `the packed game asked the network for ${network.join(', ')}`);
      assert(n > 5, `the game packed from the bundle should run (${n} frames)`);
    }
    finally
    {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // tools/pack.mjs: one .html with the engine, the program and the files it
  // loads, opened from disk with every network request blocked.
  await check('packed game runs from file:// with no network', async () =>
  {
    const dir = await mkdtemp(join(tmpdir(), 'divjs-pack-'));
    const out = join(dir, 'game.html');
    try
    {
      // A 2x2 PNG the program loads by name: pack.mjs must embed it.
      const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR4nGP4z8DwnwEIGGEMAP4TCf1yfg1qAAAAAElFTkSuQmCC', 'base64');
      const { writeFile } = await import('node:fs/promises');
      await writeFile(join(dir, 'dot.png'), png);
      await writeFile(join(dir, 'game.div'), `program packed;
global g; n;
begin
  set_mode(160, 100);
  g = load_graphic("dot.png");
  loop n = n + 1; frame; end
end`);
      execFileSync(process.execPath, ['tools/pack.mjs', join(dir, 'game.div'), '-o', out], { cwd: ROOT, stdio: 'pipe' });
      const context = await browser.newContext();
      const page = await context.newPage();
      const problems = watch(page);
      const network = [];
      await page.route('**/*', (route) =>
      {
        const url = route.request().url();
        if (/^(file|blob|data):/.test(url))
        {
          return route.continue();
        }
        network.push(url);
        return route.abort();
      });
      await page.goto(`file://${out}`);
      await page.waitForFunction(() => window.divGame?.getState?.().running, null, { timeout: 5000 });
      await page.waitForTimeout(500);
      const state = await page.evaluate(() =>
      {
        const s = window.divGame.getState();
        const g = s.vm.globals.get(s.bytecode.globals.g);
        const graphic = s.runtime.graphics.get(g);
        return { n: s.vm.globals.get(s.bytecode.globals.n), g, loaded: !!graphic && graphic.loaded !== false };
      });
      await context.close();
      assert(problems.length === 0, problems.join('\n'));
      assert(network.length === 0, `the packed page asked the network for: ${network.join(', ')}`);
      assert(state.n > 5, `the packed game should run (${state.n} frames)`);
      assert(state.g >= 1000 && state.loaded, `the embedded PNG should load: ${JSON.stringify(state)}`);
    }
    finally
    {
      await rm(dir, { recursive: true, force: true });
    }
  });
}
finally
{
  await browser.close();
  server.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\nSummary: ${results.length - failed.length} passed, ${failed.length} failed`);
if (failed.length > 0)
{
  process.exitCode = 1;
}
