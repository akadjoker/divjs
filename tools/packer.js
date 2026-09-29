/**
 * DivJS packer: turns a DIV program, the files it loads and the engine
 * itself into one self-contained .html page. The page needs no server
 * (it opens from disk with a double click) and no network.
 *
 * Shared by the playground's Export button and tools/pack.mjs: the host
 * only supplies how to read a text file of the engine (fetch in the
 * browser, fs in node) and the bytes of the program's files.
 *
 * The engine is not pre-bundled: its ES modules are read from their
 * sources, starting at divjs.js and following their static imports, so a
 * packed game always carries the engine as it is now. In the page each
 * module becomes a blob: URL, dependencies first, with its import
 * specifiers pointed at those URLs.
 */

export const ENGINE_ENTRY = 'divjs.js';

// A static import with a relative specifier, possibly spread over lines:
//   import { a, b } from './x.js';   import * as ns from '../y.js';
const IMPORT_RE = /^[ \t]*import\s+(?:[\s\S]*?\s+from\s+)?(['"])(\.{1,2}\/[^'"]+)\1\s*;?/gm;
const DYNAMIC_IMPORT_RE = /\bimport\s*\(/;
const MODULE_TOKEN = (path) => `__DIVJS_MODULE__[${path}]`;

// "vm/runtime.js" + "../compiler/errors.js" -> "compiler/errors.js"
export function resolveModulePath(fromPath, specifier)
{
  const parts = fromPath.split('/');
  parts.pop();
  for (const part of specifier.split('/'))
  {
    if (part === '..')
    {
      if (parts.length === 0)
      {
        throw new Error(`Import ${specifier} in ${fromPath} leaves the engine folder`);
      }
      parts.pop();
    }
    else if (part !== '.' && part !== '')
    {
      parts.push(part);
    }
  }
  return parts.join('/');
}

// Reads the engine's module graph. Returns the modules dependencies first,
// each with its imports already replaced by tokens the page swaps for
// blob URLs. readText(path) reads a file relative to the repository root.
export async function collectEngineModules(readText, entry = ENGINE_ENTRY)
{
  const sources = new Map();
  const order = [];
  const visiting = new Set();

  const visit = async (path, chain) =>
  {
    if (sources.has(path))
    {
      return;
    }
    if (visiting.has(path))
    {
      throw new Error(`Import cycle: ${[...chain, path].join(' -> ')} (the packer needs an acyclic engine)`);
    }
    visiting.add(path);
    const source = await readText(path);
    if (DYNAMIC_IMPORT_RE.test(source.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')))
    {
      throw new Error(`${path} uses a dynamic import(), which the packer does not follow`);
    }
    const deps = [];
    const rewritten = source.replace(IMPORT_RE, (statement, quote, specifier) =>
    {
      const target = resolveModulePath(path, specifier);
      deps.push(target);
      return statement.replace(`${quote}${specifier}${quote}`, `${quote}${MODULE_TOKEN(target)}${quote}`);
    });
    for (const dep of deps)
    {
      await visit(dep, [...chain, path]);
    }
    visiting.delete(path);
    sources.set(path, rewritten);
    order.push(path);
  };

  await visit(entry, []);
  return order.map((path) => ({ path, source: sources.get(path) }));
}

// The screen size a program asks for with set_mode(), or DIV's default
// 320x200 when it never calls it. null when the call cannot be read
// statically (e.g. set_mode(w, h) with variables).
export function programResolution(source)
{
  const code = String(source).replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const call = code.match(/set_mode\s*\(([^)]*)\)/i);
  if (!call)
  {
    return [320, 200];
  }
  const mode = call[1].trim().match(/^m(\d+)x(\d+)$/i);
  if (mode)
  {
    return [Number(mode[1]), Number(mode[2])];
  }
  const pair = call[1].split(',').map((v) => Number(v.trim()));
  return pair.length === 2 && pair.every(Number.isInteger) ? pair : null;
}

// The file names a program passes as string literals to the load_*
// functions, in order of appearance, without duplicates. Paths built at
// run time cannot be found this way; hosts add those files explicitly.
export function findAssetReferences(source)
{
  const code = String(source).replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const re = /\bload_(?:graphic|tile|map|fpg|fnt|bdf_font|wav|pcm)\s*\(\s*(["'])([^"'\n]+)\1/gi;
  const found = [];
  for (const match of code.matchAll(re))
  {
    if (!found.includes(match[2]))
    {
      found.push(match[2]);
    }
  }
  return found;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function bytesToBase64(bytes)
{
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3)
  {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += B64[n >> 18] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63];
  }
  if (i < bytes.length)
  {
    const n = (bytes[i] << 16) | ((i + 1 < bytes.length ? bytes[i + 1] : 0) << 8);
    out += B64[n >> 18] + B64[(n >> 12) & 63];
    out += i + 1 < bytes.length ? B64[(n >> 6) & 63] : '=';
    out += '=';
  }
  return out;
}

// JSON that is safe inside a <script> element: no "</script>", no "<!--".
function scriptJson(value)
{
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

function escapeHtml(text)
{
  return String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

// Runs in the packed page: turns the embedded modules into blob URLs
// (dependencies first, so every import already has its URL), decodes the
// files and starts the game. Kept as a plain string so the packer does
// not depend on how a host serialises functions.
// A packed page carries a copy of the engine, so it carries the engine's
// MIT notice (LICENSE) too.
const ENGINE_NOTICE = `DivJS engine - https://github.com/akadjoker/divjs
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

const LOADER = `
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
    // On a phone the controls sit in the window's corners, around the game.
    touchLayout: game.touch,
    touchArea: document.body,
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

/**
 * Builds the page.
 *  - modules: from collectEngineModules()
 *  - source: the DIV program
 *  - files: { name: Uint8Array } - the names the program loads them by
 *  - title, width, height, clearColor: optional (size defaults to the
 *    program's set_mode, else 320x200)
 *  - credit: a small "made with DivJS" link in a corner, shown with the
 *    full screen button while the mouse moves (default on)
 *  - touch: the on-screen controls' layout (runDivDemo's touchLayout;
 *    false for none; default the standard one)
 */
export function buildPackedHtml({ modules, source, files = {}, title = 'DivJS game', width, height, clearColor = '#000000', credit = true, touch })
{
  const [autoW, autoH] = programResolution(source) || [320, 200];
  // Only a plain colour reaches the page's CSS.
  if (!/^(#[0-9a-f]{3,8}|[a-z]+)$/i.test(String(clearColor)))
  {
    clearColor = '#000000';
  }
  const w = Number(width) || autoW;
  const h = Number(height) || autoH;
  const encoded = {};
  for (const [name, bytes] of Object.entries(files))
  {
    encoded[name] = bytesToBase64(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  }
  const game = { source: String(source), files: encoded, clearColor, touch: touch === undefined ? null : touch };
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
<button id="divjs-fullscreen" title="Full screen (Esc leaves)">⛶</button>
${credit ? '<a id="divjs-credit" href="https://github.com/akadjoker/divjs" target="_blank" rel="noopener">made with DivJS</a>\n' : ''}<pre id="divjs-error" hidden></pre>
<script type="application/json" id="divjs-modules">${scriptJson(modules)}</script>
<script type="application/json" id="divjs-game">${scriptJson(game)}</script>
<script type="module">${LOADER}</script>
</body>
</html>
`;
}
