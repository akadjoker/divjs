// Browser checks, run with `npm run test:browser` (needs Playwright's
// Chromium: `npx playwright install chromium` on a fresh machine).
//
// 1. tests/test.html - the engine's in-browser test suite must pass.
// 2. Every demo and example page loads without errors and draws.
// 3. The playground: every program runs, errors are located, edits
//    persist, share links round-trip, run/stop stays clean, keys typed in
//    the editor don't reach the game.
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

  // ── 2. Demo and example pages ─────────────────────────────────────────
  const pages = [...await listPages('demos'), ...await listPages('examples'), 'tests/simples.html', 'ide/index.html'];
  for (const path of pages)
  {
    await check(`page ${path}`, async () =>
    {
      const page = await browser.newPage();
      const problems = watch(page);
      await page.goto(`${BASE}/${path}`);
      await page.waitForTimeout(1500);
      const colours = await canvasColours(page);
      await page.close();
      assert(problems.length === 0, problems.join('\n'));
      assert(colours > 1, 'the canvas is blank');
    });
  }

  await check('site root opens the playground', async () =>
  {
    const page = await browser.newPage();
    await page.goto(`${BASE}/`);
    await page.waitForURL('**/playground/**', { timeout: 10000 });
    await page.close();
  });

  // ── 3. Playground ─────────────────────────────────────────────────────
  const manifest = JSON.parse(await readFile(join(ROOT, 'playground/programs/manifest.json'), 'utf8'));

  const openPlayground = async (hash, context = null) =>
  {
    const page = await (context || browser).newPage({ viewport: { width: 1400, height: 850 } });
    const problems = watch(page);
    await page.goto(`${BASE}/playground/${hash}`);
    await page.waitForFunction(() => window.divPlayground && window.divPlayground.getState() !== null, null, { timeout: 15000 });
    await page.waitForTimeout(300);
    return { page, problems };
  };

  for (const program of manifest.programs)
  {
    await check(`playground runs ${program.id}`, async () =>
    {
      const { page, problems } = await openPlayground(`#p=${program.id}`);
      await page.waitForTimeout(1500);
      const state = await page.evaluate(() =>
      {
        const s = window.divPlayground.getState();
        return { running: s.running, halted: s.vm?.halted, status: document.getElementById('status').textContent };
      });
      const size = await page.$eval('#game', (c) => [c.width, c.height]);
      const colours = await canvasColours(page, '#game');
      await page.close();
      assert(problems.length === 0, problems.join('\n'));
      assert(state.running || state.halted, `not running: status "${state.status}"`);
      assert(colours > 1, 'the canvas is blank');
      assert(size[0] === program.width && size[1] === program.height,
        `canvas ${size.join('x')}, manifest says ${program.width}x${program.height}`);
    });
  }

  await check('playground: a compile error is marked at its line', async () =>
  {
    const { page, problems } = await openPlayground('#p=tutor2');
    await page.locator('.cm-line').nth(4).click();
    await page.keyboard.press('End');
    await page.keyboard.type(' zz = unknown_var;');
    await page.keyboard.press('Control+Enter');
    // Checked before the editor's own live check (500 ms after typing) can
    // mark the error, so this is the mark Run itself puts there.
    await page.waitForTimeout(150);
    const marks = await page.locator('.cm-lintRange-error').count();
    const status = await page.textContent('#status');
    const consoleText = await page.textContent('#console');
    await page.click('#console a');
    const caretWord = await page.evaluate(() => window.getSelection().anchorNode?.textContent);
    await page.close();
    assert(problems.length === 0, problems.join('\n'));
    assert(status === 'Compile error', `status "${status}"`);
    assert(/Unknown variable: unknown_var \(line 5, column \d+\)/.test(consoleText), `console: ${consoleText}`);
    assert(marks === 1, `${marks} error marks in the editor`);
    assert(caretWord === 'unknown_var', `the link should put the caret on the error, got "${caretWord}"`);
  });

  await check('playground: edits persist across reloads and Reset restores', async () =>
  {
    const context = await browser.newContext();
    const { page } = await openPlayground('#p=tutor3', context);
    await page.locator('.cm-line').first().click();
    await page.keyboard.press('Home');
    await page.keyboard.type('// my edit\n');
    await page.waitForTimeout(700);
    await page.reload();
    await page.waitForFunction(() => window.divPlayground?.getState() !== null);
    await page.waitForTimeout(300);
    const afterReload = await page.locator('.cm-content').innerText();
    const editedMark = await page.locator('button[data-id="tutor3"] .edited').isVisible();
    page.once('dialog', (d) => d.accept());
    await page.click('#resetBtn');
    await page.waitForTimeout(300);
    const afterReset = await page.locator('.cm-content').innerText();
    const stored = await page.evaluate(() => window.localStorage.getItem('divjs.playground.source.tutor3'));
    await context.close();
    assert(afterReload.startsWith('// my edit'), 'the edit was not restored after a reload');
    assert(editedMark, 'the program should be marked edited');
    assert(!afterReset.includes('// my edit'), 'Reset should restore the original');
    assert(stored === null, 'Reset should forget the saved edit');
  });

  await check('playground: a share link reproduces the code', async () =>
  {
    const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
    const { page } = await openPlayground('#p=tutor2', context);
    await page.locator('.cm-line').first().click();
    await page.keyboard.press('Home');
    await page.keyboard.type('// shared ÿ é\n');
    await page.click('#shareBtn');
    await page.waitForTimeout(300);
    const link = await page.evaluate(() => navigator.clipboard.readText());
    const original = await page.locator('.cm-content').innerText();
    await context.close();
    const fresh = await browser.newContext();
    const { page: other, problems } = await openPlayground(link.slice(link.indexOf('#')), fresh);
    const opened = await other.locator('.cm-content').innerText();
    const stored = await other.evaluate(() => window.localStorage.getItem('divjs.playground.source.tutor2'));
    await fresh.close();
    assert(link.includes('#p=tutor2&code='), `unexpected link ${link}`);
    assert(opened === original, 'the shared code differs from the original');
    assert(stored === null, 'opening a link must not save it before the code is changed');
    assert(problems.length === 0, problems.join('\n'));
  });

  await check('playground: repeated run/stop keeps one loop and one set of listeners', async () =>
  {
    const { page, problems } = await openPlayground('#p=tutor4');
    for (let i = 0; i < 10; i++)
    {
      await page.click('#stopBtn', { force: true });
      await page.click('#runBtn');
    }
    await page.waitForTimeout(500);
    const ticks = await page.evaluate(async () =>
    {
      const vm = window.divPlayground.getState().vm;
      let n = 0;
      const tick = vm.tick.bind(vm);
      vm.tick = () => { n += 1; return tick(); };
      await new Promise((r) => setTimeout(r, 1000));
      return n;
    });
    const client = await page.context().newCDPSession(page);
    const { result } = await client.send('Runtime.evaluate', { expression: 'document.getElementById("game")' });
    const { listeners } = await client.send('DOMDebugger.getEventListeners', { objectId: result.objectId });
    const moves = listeners.filter((l) => l.type === 'mousemove').length;
    await page.close();
    assert(problems.length === 0, problems.join('\n'));
    assert(ticks <= 75, `${ticks} VM ticks in one second - more than one loop is running`);
    assert(ticks >= 20, `${ticks} VM ticks in one second - the program is not running`);
    assert(moves === 1, `${moves} mousemove listeners on the canvas`);
  });

  await check('playground: game speed does not depend on the display rate', async () =>
  {
    // A 144 Hz display: requestAnimationFrame every ~7 ms. A program
    // without set_fps must still run at DIV's 18 fps, and set_fps(60) at
    // 60 - it used to tick once per display frame.
    const context = await browser.newContext();
    await context.addInitScript(() =>
    {
      window.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 1000 / 144);
      window.cancelAnimationFrame = (id) => clearTimeout(id);
    });
    const rates = {};
    for (const id of ['tutor3', 'breakout'])
    {
      const { page } = await openPlayground(`#p=${id}`, context);
      await page.waitForTimeout(500);
      rates[id] = await page.evaluate(async () =>
      {
        const vm = window.divPlayground.getState().vm;
        let n = 0;
        const tick = vm.tick.bind(vm);
        vm.tick = () => { n += 1; return tick(); };
        await new Promise((r) => setTimeout(r, 2000));
        return n / 2;
      });
      await page.close();
    }
    await context.close();
    assert(rates.tutor3 >= 15 && rates.tutor3 <= 20, `tutor3 (no set_fps) ran at ${rates.tutor3} ticks/s, expected ~18`);
    assert(rates.breakout >= 52 && rates.breakout <= 64, `breakout (set_fps 60) ran at ${rates.breakout} ticks/s, expected ~60`);
  });

  await check('playground: keys typed in the editor do not reach the game', async () =>
  {
    const { page } = await openPlayground('#p=scroll');
    await page.locator('.cm-line').nth(2).click();
    await page.keyboard.down('ArrowRight');
    const inEditor = await page.evaluate(() => window.divPlayground.getState().runtime.keys.arrowright || false);
    await page.keyboard.up('ArrowRight');
    await page.click('#game');
    await page.keyboard.down('ArrowRight');
    const inGame = await page.evaluate(() => window.divPlayground.getState().runtime.keys.arrowright || false);
    await page.keyboard.up('ArrowRight');
    await page.close();
    assert(!inEditor, 'a key pressed in the editor reached the game');
    assert(inGame === true, 'a key pressed on the game did not reach it');
  });

  await check('playground: new program and switching screen sizes', async () =>
  {
    const context = await browser.newContext();
    const { page, problems } = await openPlayground('#p=tutor3', context);
    const small = await page.$eval('#game', (c) => [c.width, c.height]);
    await page.click('button[data-id="breakout"]');
    await page.waitForTimeout(800);
    const breakout = await page.$eval('#game', (c) => [c.width, c.height]);
    await page.click('#newBtn');
    await page.waitForTimeout(800);
    const title = await page.textContent('#programTitle');
    const running = await page.evaluate(() => window.divPlayground.getState().running);
    await page.locator('.cm-line').first().click();
    await page.keyboard.type('// mine\n');
    await page.waitForTimeout(700);
    const yours = await page.locator('.program-list h3', { hasText: 'Yours' }).count();
    await context.close();
    assert(problems.length === 0, problems.join('\n'));
    assert(small.join('x') === '320x200', `tutor3 canvas ${small.join('x')}`);
    assert(breakout.join('x') === '480x520', `breakout canvas ${breakout.join('x')}`);
    assert(title === 'New program' && running, 'the new program should open and run');
    assert(yours === 1, 'an edited new program should be listed under "Yours"');
  });

  // Full screen: the game panel alone on the screen, scaled up, with the
  // keyboard still going to the game.
  await check('playground: full screen shows the game scaled up', async () =>
  {
    const { page, problems } = await openPlayground('#p=tutor3');
    const before = await page.$eval('#game', (c) => c.getBoundingClientRect().width);
    await page.click('#fullscreenBtn');
    await page.waitForTimeout(500);
    const inside = await page.evaluate(() => ({
      element: document.fullscreenElement?.id || (document.getElementById('screen').classList.contains('screen-max') ? 'screen-max' : null),
      width: document.getElementById('game').getBoundingClientRect().width,
      height: document.getElementById('game').getBoundingClientRect().height,
      focused: document.activeElement?.id,
      viewport: [window.innerWidth, window.innerHeight]
    }));
    await page.evaluate(() => (document.fullscreenElement ? document.exitFullscreen() : null));
    await page.waitForTimeout(400);
    const label = await page.textContent('#fullscreenBtn');
    const after = await page.$eval('#game', (c) => c.getBoundingClientRect().width);
    await page.close();
    assert(problems.length === 0, problems.join('\n'));
    assert(inside.element === 'screen' || inside.element === 'screen-max', `the game panel should be full screen, got ${inside.element}`);
    assert(inside.width > before * 1.2, `the game should be scaled up in full screen (${before} -> ${inside.width} px)`);
    assert(Math.abs(inside.width / inside.height - 320 / 200) < 0.02, `the aspect ratio should be kept (${inside.width}x${inside.height})`);
    assert(inside.focused === 'game', `the canvas should keep the keyboard focus, focus is on ${inside.focused}`);
    assert(label.includes('Full screen') && Math.abs(after - before) < 2, `leaving should restore the button and the size (${label}, ${after} px)`);
  });

  // The Files tab: a program's own FPG/FNT (uploaded here), kept across
  // reloads, carried by a share link when small, and packed by Export.
  await check('playground: project files - upload, keep, share, export', async () =>
  {
    // 614 KB, 165 KB deflated: over the share-link limit (100 KB).
    const fpg = await readFile(join(ROOT, 'assets/div-support/tutor1.fpg'));
    const fnt = await readFile(join(ROOT, 'assets/div-support/tutor1.fnt'));
    const program = [
      'PROGRAM files_test;',
      'GLOBAL lib; fnt;',
      'BEGIN',
      '  set_mode(320, 200);',
      '  lib = load_fpg("SHIP.FPG");      // uploaded as Ship.fpg',
      '  fnt = load_fnt("gfx\\font.fnt"); // uploaded as font.fnt',
      '  LOOP FRAME; END',
      'END',
      ''
    ].join('\n');
    const loaded = (page) => page.evaluate(() =>
    {
      const s = window.divPlayground.getState();
      return {
        files: window.divPlayground.getFiles().map((f) => f.name),
        fpg: [...s.runtime.graphLibraries.values()].map((l) => l.graphs.size),
        fnt: [...s.runtime.bitmapFonts.values()].some((f) => f.loaded)
      };
    });
    const dir = await mkdtemp(join(tmpdir(), 'divjs-export-'));
    const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'], acceptDownloads: true });
    try
    {
      const { page, problems } = await openPlayground('#p=new', context);
      await page.locator('.cm-content').click();
      await page.keyboard.press('Control+A');
      await page.keyboard.insertText(program);
      await page.setInputFiles('#fileInput', [
        { name: 'Ship.fpg', mimeType: 'application/octet-stream', buffer: fpg },
        { name: 'font.fnt', mimeType: 'application/octet-stream', buffer: fnt }
      ]);
      await page.waitForTimeout(1500);
      const first = await loaded(page);
      await page.click('#filesTab');
      await page.waitForTimeout(300);
      const listing = await page.locator('#fileList').innerText();

      await page.reload();
      await page.waitForFunction(() => window.divPlayground?.getState() !== null, null, { timeout: 15000 });
      await page.waitForTimeout(1500);
      const afterReload = await loaded(page);

      // Export: one .html, opened from disk with the network blocked.
      const [download] = await Promise.all([page.waitForEvent('download'), page.click('#exportBtn')]);
      const exported = join(dir, download.suggestedFilename());
      await download.saveAs(exported);
      const offline = await context.newPage();
      const offlineProblems = watch(offline);
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
      await offline.goto(`file://${exported}`);
      await offline.waitForTimeout(1500);
      const packed = await offline.evaluate(() =>
      {
        const s = window.divGame.getState();
        return {
          fpg: [...s.runtime.graphLibraries.values()].map((l) => l.graphs.size),
          fnt: [...s.runtime.bitmapFonts.values()].some((f) => f.loaded)
        };
      });

      // Share: the FPG is too big for a link, so the link has the code only...
      await page.click('#shareBtn');
      await page.waitForTimeout(500);
      const bigLink = await page.evaluate(() => navigator.clipboard.readText());
      const consoleText = await page.locator('#console').innerText();
      // ...without it, the font fits and travels in the link. (From here the
      // program's load_fpg("SHIP.FPG") has no project file and goes to the
      // server, which has none: those 404s are expected.)
      const beforeRemove = problems.length;
      await page.click('#filesTab');
      await page.locator('#fileList li', { hasText: 'Ship.fpg' }).getByRole('button', { name: 'Remove' }).click();
      await page.waitForTimeout(500);
      await page.click('#shareBtn');
      await page.waitForTimeout(500);
      const smallLink = await page.evaluate(() => navigator.clipboard.readText());
      const fresh = await browser.newContext();
      const { page: other, problems: otherProblems } = await openPlayground(smallLink.slice(smallLink.indexOf('#')), fresh);
      await other.waitForTimeout(1500);
      const shared = await loaded(other);
      await fresh.close();

      const expected404 = (line) => /SHIP\.FPG|status of 404/.test(line);
      const unexpected = [
        ...problems.slice(0, beforeRemove),
        ...problems.slice(beforeRemove).filter((line) => !expected404(line)),
        ...offlineProblems,
        ...otherProblems.filter((line) => !expected404(line))
      ];
      assert(unexpected.length === 0, unexpected.join('\n'));
      assert(JSON.stringify(first.files) === '["font.fnt","Ship.fpg"]', `uploaded files ${JSON.stringify(first.files)}`);
      assert(first.fpg[0] > 0 && first.fnt, `the uploaded files should load: ${JSON.stringify(first)}`);
      assert(/FPG, \d+ graphics/.test(listing) && /FNT, \d+ characters/.test(listing), `files listing: ${listing}`);
      assert(afterReload.files.length === 2 && afterReload.fpg[0] > 0 && afterReload.fnt, `after reload: ${JSON.stringify(afterReload)}`);
      assert(download.suggestedFilename() === 'my-game.html', `export name ${download.suggestedFilename()}`);
      assert(network.length === 0, `the exported page asked the network for: ${network.join(', ')}`);
      assert(packed.fpg[0] > 0 && packed.fnt, `exported game: ${JSON.stringify(packed)}`);
      assert(!bigLink.includes('&files=') && consoleText.includes('too big for a link'), 'a link must not carry files over the limit, and say so');
      assert(smallLink.includes('&files='), 'a small file should travel in the link');
      assert(JSON.stringify(shared.files) === '["font.fnt"]' && shared.fnt, `opened link: ${JSON.stringify(shared)}`);
    }
    finally
    {
      await context.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  // Online play between two tabs (BroadcastChannel): host with 3, join
  // with 4, each tab drives its own tank with its own keyboard, and both
  // simulations stay identical (the same hash of every process and global)
  // with no desync reported.
  await check('online: two tabs play Net Tanks in lockstep and stay identical', async () =>
  {
    const context = await browser.newContext();
    try
    {
      const { page: a, problems: pa } = await openPlayground('#p=net-tanks', context);
      const { page: b, problems: pb } = await openPlayground('#p=net-tanks', context);
      const info = (page) => page.evaluate(async () =>
      {
        const { hashState } = await import('/vm/net.js');
        const s = window.divPlayground.getState();
        const n = s.runtime.net;
        const tanks = s.vm.processManager.getAll().filter((p) => String(p.name).toLowerCase() === 'tank' && !p.dead)
          .sort((p, q) => p.id - q.id).map((p) => [Math.round(p.x), Math.round(p.y), p.angle]);
        return { status: n.status, me: n.me, running: n.running, frame: n.lock.frame, hash: hashState(s.vm), tanks };
      });
      await a.click('#game');
      await a.keyboard.press('3');
      await b.click('#game');
      await b.keyboard.press('4');
      await a.waitForFunction(() => window.divPlayground.getState().runtime.net.running, null, { timeout: 5000 });
      await b.waitForFunction(() => window.divPlayground.getState().runtime.net.running, null, { timeout: 5000 });
      const start = await info(a);
      // Blue (host) drives forward, red (guest) turns; no shots.
      await a.keyboard.down('ArrowUp');
      await b.keyboard.down('ArrowLeft');
      await a.waitForTimeout(400);
      await a.keyboard.up('ArrowUp');
      await b.keyboard.up('ArrowLeft');
      // Past the next state comparison (every 60 frames) with nobody moving.
      await a.waitForTimeout(1800);
      const ia = await info(a);
      const ib = await info(b);
      await context.close();
      assert(pa.length === 0 && pb.length === 0, [...pa, ...pb].join('\n'));
      assert(ia.me === 0 && ib.me === 1, `players ${ia.me}/${ib.me}`);
      assert(ia.status === 2 && ib.status === 2, `both sides should stay connected and in step: status ${ia.status}/${ib.status}`);
      assert(ia.frame > 90 && Math.abs(ia.frame - ib.frame) <= 3, `lockstep frames ${ia.frame}/${ib.frame}`);
      assert(ia.hash === ib.hash, `the two games should be identical: ${JSON.stringify(ia.tanks)} vs ${JSON.stringify(ib.tanks)}`);
      assert(ia.tanks[0][0] > start.tanks[0][0] + 20, `blue should have driven right: ${start.tanks[0]} -> ${ia.tanks[0]}`);
      assert(ia.tanks[1][2] !== start.tanks[1][2], `red should have turned: ${start.tanks[1]} -> ${ia.tanks[1]}`);
    }
    finally
    {
      await context.close().catch(() => {});
    }
  });

  // A hidden tab gets no animation frames (browsers pause
  // requestAnimationFrame in background tabs). In lockstep the other side
  // would then wait for its input for ever: the hidden side must keep
  // stepping its game on its own timer.
  await check('online: the game keeps going when the other tab is hidden', async () =>
  {
    const context = await browser.newContext();
    try
    {
      const { page: a, problems: pa } = await openPlayground('#p=net-tanks', context);
      const { page: b, problems: pb } = await openPlayground('#p=net-tanks', context);
      await a.click('#game');
      await a.keyboard.press('3');
      await b.click('#game');
      await b.keyboard.press('4');
      for (const page of [a, b])
      {
        await page.waitForFunction(() => window.divPlayground.getState().runtime.net.running, null, { timeout: 5000 });
      }
      // B goes to the background: no more animation frames, hidden.
      await b.evaluate(() =>
      {
        window.requestAnimationFrame = () => 0;
        Object.defineProperty(document, 'hidden', { get: () => true });
        Object.defineProperty(document, 'visibilityState', { get: () => 'hidden' });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await a.waitForTimeout(300);
      const frame = (page) => page.evaluate(() => window.divPlayground.getState().runtime.net.lock.frame);
      const [a0, b0] = [await frame(a), await frame(b)];
      await a.waitForTimeout(1500);
      const [a1, b1] = [await frame(a), await frame(b)];
      const status = [await a.evaluate(() => window.divPlayground.getState().runtime.net.status),
        await b.evaluate(() => window.divPlayground.getState().runtime.net.status)];
      await context.close();
      assert(pa.length === 0 && pb.length === 0, [...pa, ...pb].join('\n'));
      assert(status[0] === 2 && status[1] === 2, `both sides should stay connected and in step (status ${status})`);
      assert(b1 - b0 > 45, `the hidden side should keep stepping: ${b1 - b0} frames in 1.5 s`);
      assert(a1 - a0 > 45, `the visible side should not wait for the hidden one: ${a1 - a0} frames in 1.5 s`);
    }
    finally
    {
      await context.close().catch(() => {});
    }
  });

  // The usual way to try two tabs: host in tab A, then switch to tab B and
  // join - so the host's tab is already hidden while the guest connects,
  // and it is the host that has to start the game.
  await check('online: a host whose tab is hidden before the guest joins still starts the game', async () =>
  {
    const context = await browser.newContext();
    try
    {
      const { page: a, problems: pa } = await openPlayground('#p=net-tanks', context);
      const { page: b, problems: pb } = await openPlayground('#p=net-tanks', context);
      await a.click('#game');
      await a.keyboard.press('3');
      await a.waitForTimeout(300);
      await a.evaluate(() =>
      {
        window.requestAnimationFrame = () => 0;
        Object.defineProperty(document, 'hidden', { get: () => true });
        Object.defineProperty(document, 'visibilityState', { get: () => 'hidden' });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await a.waitForTimeout(500);
      await b.click('#game');
      await b.keyboard.press('4');
      let started = true;
      try
      {
        await b.waitForFunction(() => window.divPlayground.getState().runtime.net.running, null, { timeout: 4000 });
      }
      catch
      {
        started = false;
      }
      const frames = started ? await b.evaluate(async () =>
      {
        const net = window.divPlayground.getState().runtime.net;
        const f0 = net.lock.frame;
        await new Promise((resolve) => setTimeout(resolve, 1000));
        return net.lock.frame - f0;
      }) : 0;
      await context.close();
      assert(pa.length === 0 && pb.length === 0, [...pa, ...pb].join('\n'));
      assert(started, 'the guest should get into the game although the host tab is hidden');
      assert(frames > 30, `the game should run once started: ${frames} frames in 1 s`);
    }
    finally
    {
      await context.close().catch(() => {});
    }
  });

  // Online play over WebRTC, as two players would: the host chooses
  // "host", copies the invitation link (this code + the invitation) and
  // the guest opens it and chooses "join": the invitation is filled in and
  // the answer made. The host pastes the answer; both connect and start.
  await check('online: WebRTC connection through an invitation link and an answer code', async () =>
  {
    const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
    try
    {
      const { page: a, problems: pa } = await openPlayground('#p=net-tanks', context);
      await a.click('#game');
      await a.keyboard.press('1');
      await a.waitForSelector('[data-net-copy-link]', { timeout: 15000 });
      await a.click('[data-net-copy-link]');
      await a.waitForFunction(() => document.querySelector('[data-net-code]').value.startsWith('http'));
      const link = await a.$eval('[data-net-code]', (e) => e.value);
      assert(/#p=net-tanks&code=[^&]+&net=DIVNET1\.[A-Za-z0-9_-]+$/.test(link), `invitation link: ${link.slice(0, 120)}`);

      const { page: b, problems: pb } = await openPlayground(link.slice(link.indexOf('#')), context);
      assert(!(await b.evaluate(() => window.location.hash)).includes('net='), 'the invitation should leave the address once used');
      await b.click('#game');
      await b.keyboard.press('2');
      await b.waitForFunction(() => document.querySelector('[data-net-code]')?.value.startsWith('DIVNET1.'), null, { timeout: 15000 });
      const answer = await b.$eval('[data-net-code]', (e) => e.value);

      await a.fill('[data-net-answer]', answer);
      await a.click('[data-net-connect]');
      for (const page of [a, b])
      {
        await page.waitForFunction(() => window.divPlayground.getState().runtime.net.running, null, { timeout: 15000 });
      }
      const panels = (await a.$$('[data-divjs-net]')).length + (await b.$$('[data-divjs-net]')).length;
      await a.keyboard.down('ArrowUp');
      await a.waitForTimeout(300);
      await a.keyboard.up('ArrowUp');
      await a.waitForTimeout(1500);
      const state = (page) => page.evaluate(async () =>
      {
        const { hashState } = await import('/vm/net.js');
        const s = window.divPlayground.getState();
        return { status: s.runtime.net.status, me: s.runtime.net.me, hash: hashState(s.vm) };
      });
      const sa = await state(a);
      const sb = await state(b);
      assert(pa.length === 0 && pb.length === 0, [...pa, ...pb].join('\n'));
      assert(panels === 0, 'the connection panels should close once connected');
      assert(sa.me === 0 && sb.me === 1 && sa.status === 2 && sb.status === 2, `after connecting: ${JSON.stringify([sa, sb])}`);
      assert(sa.hash === sb.hash, 'the two games should be identical');
    }
    finally
    {
      await context.close();
    }
  });

  // Sound in a browser that, like a normal one, only allows it after a
  // gesture: nothing plays and the song waits until the first key press,
  // then the music runs and the effect for the key plays.
  await check('sound: silent until the first key, then music and effects', async () =>
  {
    const locked = await chromium.launch({ args: ['--autoplay-policy=user-gesture-required'] });
    try
    {
      const page = await locked.newPage({ viewport: { width: 1400, height: 850 } });
      const problems = watch(page);
      await page.goto(`${BASE}/playground/#p=sound-lab`);
      await page.waitForFunction(() => window.divPlayground?.getState()?.runtime);
      await page.waitForTimeout(600);
      const stats = () => page.evaluate(() =>
      {
        const a = window.divPlayground.getState().runtime.audio;
        return { running: a.running, played: a.stats.played, notes: a.stats.notes, song: a.songPlaying };
      });
      const before = await stats();
      await page.click('#game');
      await page.keyboard.press('3');
      await page.waitForTimeout(600);
      const after = await stats();
      assert(problems.length === 0, problems.join('\n'));
      assert(!before.running && before.played === 0 && before.notes === 0 && before.song > 0,
        `before a gesture nothing should play and the song should wait: ${JSON.stringify(before)}`);
      assert(after.running && after.played >= 1 && after.notes > 4, `after a key the music and the effect should play: ${JSON.stringify(after)}`);
    }
    finally
    {
      await locked.close();
    }
  });

  // Tab: a program that plays with it (Ghost Squad switches ghosts with it
  // once a round is on) keeps
  // the focus on the game; one that doesn't (Tutorial 2) lets Tab move on
  // through the page as usual.
  await check('playground: Tab stays in a game that uses it, moves on otherwise', async () =>
  {
    const focusAfterTab = async (id, startKey) =>
    {
      const { page, problems } = await openPlayground(`#p=${id}`);
      await page.click('#game');
      await page.waitForTimeout(1500);
      if (startKey)
      {
        await page.keyboard.press(startKey);    // past the title screen
        await page.waitForTimeout(1000);
      }
      await page.keyboard.press('Tab');
      await page.waitForTimeout(100);
      const focused = await page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName);
      await page.close();
      assert(problems.length === 0, problems.join('\n'));
      return focused;
    };
    const ghosts = await focusAfterTab('ghost-squad', 'Space');
    const tutor = await focusAfterTab('tutor2');
    assert(ghosts === 'game', `in Ghost Squad Tab should stay on the game, focus went to ${ghosts}`);
    assert(tutor !== 'game', 'in a program that does not use Tab, Tab should move the focus on');
  });

  // tools/pack.mjs: one .html with the engine, the program and its files,
  // opened from disk with every network request blocked.
  await check('packed game runs from file:// with no network', async () =>
  {
    const dir = await mkdtemp(join(tmpdir(), 'divjs-pack-'));
    const out = join(dir, 'tutor1b.html');
    try
    {
      execFileSync(process.execPath, ['tools/pack.mjs', 'playground/programs/tutor1b.div', '--base', 'playground', '-o', out],
        { cwd: ROOT, stdio: 'pipe' });
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
      // load_fpg numbers files from 0, as in DIV.
      await page.waitForFunction(() => window.divGame?.getState?.().runtime?.graphLibraries?.get(0)?.loaded, null, { timeout: 5000 });
      const state = await page.evaluate(() =>
      {
        const s = window.divGame.getState();
        return {
          running: s.running,
          graphs: s.runtime.graphLibraries.get(0).graphs.size,
          font: [...s.runtime.bitmapFonts.values()].some((f) => f.loaded)
        };
      });
      const colours = await canvasColours(page, '#game');
      await page.mouse.move(20, 20);
      await page.click('#divjs-fullscreen');
      await page.waitForTimeout(500);
      const fullscreen = await page.evaluate(() => ({
        on: document.fullscreenElement === document.documentElement,
        width: document.getElementById('game').getBoundingClientRect().width,
        viewport: window.innerWidth
      }));
      await context.close();
      assert(problems.length === 0, problems.join('\n'));
      assert(fullscreen.on, 'the packed page\'s button should put it in full screen');
      assert(Math.abs(fullscreen.width - fullscreen.viewport) < 2 || fullscreen.width > 600, `the packed game should fill the screen (${fullscreen.width} of ${fullscreen.viewport})`);
      assert(network.length === 0, `the packed page asked the network for: ${network.join(', ')}`);
      assert(state.running && state.graphs === 63 && state.font, `packed game state ${JSON.stringify(state)}`);
      assert(colours > 20, `the packed game should draw its FPG graphics (${colours} colours)`);
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
