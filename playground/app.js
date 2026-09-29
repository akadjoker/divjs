// DivJS Playground: pick a program, edit it, run it.
//
// The page is static. Programs come from programs/manifest.json and their
// .div files; edits are kept in localStorage (per program, only while they
// differ from the original); "Share" puts the code, compressed, in the URL
// hash so a link carries it without any server. A program's own files
// (FPG, MAP, PNG...) are kept in IndexedDB (project-files.js) and travel
// in the link when small; "Export" packs everything into one .html.

import {
  basicSetup,
  EditorView,
  EditorState,
  keymap,
  Prec,
  indentWithTab,
  oneDarkTheme,
  setDiagnostics
} from './vendor/codemirror.js';
import { runDivDemo } from '../divjs.js';
import { VM } from '../vm/vm.js';
import { CanvasEngineRuntime } from '../vm/runtime.js';
import { divLanguage, loadNativeInfo, errorToDiagnostic } from './div-language.js';
import { openFileStore, packFiles, unpackFiles, describeFile, formatSize } from './project-files.js';
import { collectEngineModules, buildPackedHtml, findAssetReferences } from '../tools/packer.js';

const MANIFEST_URL = 'programs/manifest.json';
// GitHub Pages serves files with a 10 minute max-age; revalidate the program
// list and sources so a new deploy shows up on the next load.
const FETCH_OPTIONS = { cache: 'no-cache' };
const NATIVES_DOC_URL = '../docs/natives.md';
const STORAGE_PREFIX = 'divjs.playground.source.';
const MAX_CONSOLE_LINES = 500;
const INSPECTOR_INTERVAL_MS = 300;
const STATS_INTERVAL_MS = 500;
// Files ride in a share link only while they stay this small compressed;
// bigger ones make links that apps cut or refuse. Export has no limit.
const SHARE_FILES_LIMIT = 100 * 1024;
const MAX_FILE_SIZE = 32 * 1024 * 1024;

// The "New program" entry: not in the manifest, saved like any other.
const NEW_PROGRAM = {
  id: 'new',
  title: 'New program',
  category: 'yours',
  width: 640,
  height: 480,
  clearColor: '#000000',
  description: 'Your own program. Edits are saved in this browser.'
};

const NEW_PROGRAM_SOURCE = `PROGRAM my_game;

PROCESS ball(x, y, vx, vy);
BEGIN
  LOOP
    x = x + vx;
    y = y + vy;
    IF (x < 10 OR x > 630) vx = -vx; END
    IF (y < 10 OR y > 470) vy = -vy; END
    set_color('#2dd4bf');
    circle(x, y, 10);
    FRAME;
  END
END

BEGIN
  set_mode(640, 480);   // screen size (DIV's default is 320x200)
  set_fps(60, 0);       // frames per second (DIV's default is 18)
  write(0, 320, 8, 1, 'Edit me and press Ctrl+Enter');
  ball(320, 240, 3, 2);
  LOOP
    FRAME;
  END
END
`;

const el = {
  runBtn: document.getElementById('runBtn'),
  stopBtn: document.getElementById('stopBtn'),
  resetBtn: document.getElementById('resetBtn'),
  shareBtn: document.getElementById('shareBtn'),
  exportBtn: document.getElementById('exportBtn'),
  newBtn: document.getElementById('newBtn'),
  programList: document.getElementById('programList'),
  title: document.getElementById('programTitle'),
  description: document.getElementById('programDescription'),
  controls: document.getElementById('programControls'),
  editor: document.getElementById('editor'),
  screen: document.getElementById('screen'),
  canvas: document.getElementById('game'),
  status: document.getElementById('status'),
  stats: document.getElementById('stats'),
  consoleTab: document.getElementById('consoleTab'),
  inspectorTab: document.getElementById('inspectorTab'),
  console: document.getElementById('console'),
  inspector: document.getElementById('inspector'),
  inspectProcesses: document.getElementById('inspectProcesses'),
  inspectGlobals: document.getElementById('inspectGlobals'),
  filesTab: document.getElementById('filesTab'),
  filesCount: document.getElementById('filesCount'),
  files: document.getElementById('files'),
  dropZone: document.getElementById('dropZone'),
  fileInput: document.getElementById('fileInput'),
  fileList: document.getElementById('fileList'),
  filesWhere: document.getElementById('filesWhere'),
  toast: document.getElementById('toast'),
  fullscreenBtn: document.getElementById('fullscreenBtn')
};

let manifest = { programs: [], categories: [] };
let current = null;          // the open program's manifest entry
let originalSource = '';     // its unedited source
let view = null;             // the CodeMirror EditorView
let runner = null;           // runDivDemo instance for the current screen size
let runnerKey = '';
let settingDoc = false;      // true while the page replaces the document itself
let sharedUnsaved = false;   // shared code on screen, not saved until the user edits it
let saveTimer = 0;
let lastStatsAt = 0;
let lastCanvasSize = '';
const sourceCache = new Map();
let fileStore = null;        // see project-files.js
let projectFiles = [];       // the open program's files: { name, bytes }
let filesPendingSave = false; // files from a share link, saved with the code
let renderFilesToken = 0;
let engineModules = null;    // the engine's sources, read once for Export

// ── Storage (may be unavailable: private windows, blocked site data) ────

function storageGet(id)
{
  try
  {
    return window.localStorage.getItem(STORAGE_PREFIX + id);
  }
  catch
  {
    return null;
  }
}

function storageSet(id, text)
{
  try
  {
    window.localStorage.setItem(STORAGE_PREFIX + id, text);
  }
  catch
  {
    // Not saved; the page keeps working.
  }
}

function storageRemove(id)
{
  try
  {
    window.localStorage.removeItem(STORAGE_PREFIX + id);
  }
  catch
  {
    // Nothing to remove.
  }
}

// ── Share links: deflate-raw + base64url in the URL hash ────────────────

function bytesToBase64Url(bytes)
{
  let binary = '';
  for (let i = 0; i < bytes.length; i++)
  {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(text)
{
  const base64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++)
  {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function deflateBytes(bytes)
{
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function inflateBytes(bytes)
{
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function encodeSource(text)
{
  return bytesToBase64Url(await deflateBytes(new TextEncoder().encode(text)));
}

async function decodeSource(encoded)
{
  return new TextDecoder().decode(await inflateBytes(base64UrlToBytes(encoded)));
}

function parseHash()
{
  const params = new URLSearchParams(window.location.hash.slice(1));
  return { programId: params.get('p'), code: params.get('code'), files: params.get('files'), net: params.get('net') };
}

function setHash(programId)
{
  const hash = `#p=${encodeURIComponent(programId)}`;
  if (window.location.hash !== hash)
  {
    window.history.replaceState(null, '', hash);
  }
}

// ── Console, status, toast ──────────────────────────────────────────────

function logLine(text, kind = '')
{
  const line = document.createElement('div');
  if (kind)
  {
    line.className = kind;
  }
  line.textContent = text;
  el.console.appendChild(line);
  while (el.console.childElementCount > MAX_CONSOLE_LINES)
  {
    el.console.firstElementChild.remove();
  }
  el.console.scrollTop = el.console.scrollHeight;
  return line;
}

// A compile error line whose location jumps to the code when clicked.
function logCompileError(err)
{
  const line = logLine('', 'error');
  line.append('Compile error: ' + (err.reason || err.message) + ' ');
  if (Number.isInteger(err.line))
  {
    const link = document.createElement('a');
    link.textContent = `(line ${err.line}, column ${err.col})`;
    link.addEventListener('click', () => jumpTo(err.line, err.col));
    line.append(link);
  }
}

function clearConsole()
{
  el.console.textContent = '';
}

function setStatus(text, kind = '')
{
  el.status.textContent = text;
  el.status.className = kind;
}

let toastTimer = 0;
function toast(text)
{
  el.toast.textContent = text;
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() =>
  {
    el.toast.hidden = true;
  }, 2500);
}

// ── Editor ──────────────────────────────────────────────────────────────

function createEditor(nativeInfo)
{
  view = new EditorView({
    parent: el.editor,
    state: EditorState.create({
      doc: '',
      extensions: [
        basicSetup,
        // Above basicSetup's own Mod-Enter (insert blank line).
        Prec.highest(keymap.of([
          { key: 'Mod-Enter', run: () => { run(); return true; } },
          { key: 'Mod-s', run: () => { saveNow(); toast('Saved in this browser'); return true; } }
        ])),
        keymap.of([indentWithTab]),
        // Editor chrome only; token colours come from the DIV highlight
        // style in div-language.js (oneDark's own would override them).
        oneDarkTheme,
        EditorView.lineWrapping,
        divLanguage(nativeInfo),
        EditorView.updateListener.of((update) =>
        {
          if (update.docChanged && !settingDoc)
          {
            sharedUnsaved = false;
            scheduleSave();
          }
        })
      ]
    })
  });
}

function setEditorText(text)
{
  settingDoc = true;
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
  view.dispatch(setDiagnostics(view.state, []));
  settingDoc = false;
}

function jumpTo(line, col)
{
  const doc = view.state.doc;
  if (line < 1 || line > doc.lines)
  {
    return;
  }
  const info = doc.line(line);
  const pos = Math.min(info.from + Math.max(0, (col || 1) - 1), info.to);
  view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
  view.focus();
}

function currentText()
{
  return view.state.doc.toString();
}

// ── Saving edits ────────────────────────────────────────────────────────

function saveNow()
{
  clearTimeout(saveTimer);
  // Shared code only replaces the saved edits once the user changes it.
  if (!current || sharedUnsaved)
  {
    return;
  }
  const text = currentText();
  if (text === originalSource)
  {
    storageRemove(current.id);
  }
  else
  {
    storageSet(current.id, text);
  }
  if (filesPendingSave)
  {
    saveProjectFiles();
  }
  updateEditedState();
}

function scheduleSave()
{
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 400);
  updateEditedState();
}

function isEdited(id)
{
  return storageGet(id) !== null;
}

function updateEditedState()
{
  const edited = Boolean(current) && currentText() !== originalSource;
  el.resetBtn.disabled = !edited;
  for (const button of el.programList.querySelectorAll('button[data-id]'))
  {
    const mark = button.querySelector('.edited');
    const show = button.dataset.id === current?.id ? edited : isEdited(button.dataset.id);
    mark.hidden = !show;
  }
}

// ── Program list ────────────────────────────────────────────────────────

function renderProgramList()
{
  el.programList.textContent = '';
  const categories = [{ id: 'yours', title: 'Yours' }, ...manifest.categories];
  for (const category of categories)
  {
    const entries = allPrograms().filter((p) => p.category === category.id);
    if (category.id === 'yours' && !isEdited(NEW_PROGRAM.id) && current?.id !== NEW_PROGRAM.id)
    {
      continue;
    }
    if (entries.length === 0)
    {
      continue;
    }
    const heading = document.createElement('h3');
    heading.textContent = category.title;
    el.programList.appendChild(heading);
    for (const entry of entries)
    {
      const button = document.createElement('button');
      button.dataset.id = entry.id;
      button.append(entry.title);
      const mark = document.createElement('span');
      mark.className = 'edited';
      mark.textContent = 'edited';
      mark.hidden = true;
      button.append(mark);
      button.addEventListener('click', () => openProgram(entry));
      el.programList.appendChild(button);
    }
  }
  markCurrentInList();
  updateEditedState();
}

function allPrograms()
{
  return [NEW_PROGRAM, ...manifest.programs];
}

function markCurrentInList()
{
  for (const button of el.programList.querySelectorAll('button[data-id]'))
  {
    button.setAttribute('aria-current', String(button.dataset.id === current?.id));
  }
}

async function fetchOriginal(entry)
{
  if (entry.id === NEW_PROGRAM.id)
  {
    return NEW_PROGRAM_SOURCE;
  }
  if (!sourceCache.has(entry.id))
  {
    const response = await fetch(`programs/${entry.file}`, FETCH_OPTIONS);
    if (!response.ok)
    {
      throw new Error(`Could not load ${entry.file} (${response.status})`);
    }
    sourceCache.set(entry.id, await response.text());
  }
  return sourceCache.get(entry.id);
}

// Open a program. `sharedSource` is code from a share link: it replaces the
// editor text (and becomes the saved edit once the user changes it) but
// never silently overwrites edits already saved for that program.
async function openProgram(entry, { sharedSource = null, sharedFiles = null } = {})
{
  saveNow();
  stop();
  current = entry;
  try
  {
    originalSource = await fetchOriginal(entry);
  }
  catch (err)
  {
    logLine(String(err.message || err), 'error');
    return;
  }
  const saved = storageGet(entry.id);
  let text = saved ?? originalSource;
  // Shown after run(), which clears the console.
  const notices = [];
  if (sharedSource !== null)
  {
    if (saved !== null && saved !== sharedSource)
    {
      notices.push('Opened shared code. Your saved edits for this program are kept until you change this code.');
    }
    text = sharedSource;
  }
  setEditorText(text);
  sharedUnsaved = sharedSource !== null && text !== saved;
  if (sharedFiles)
  {
    // Like shared code, the link's files replace this program's own only
    // once the user changes something.
    projectFiles = sharedFiles;
    filesPendingSave = true;
    sharedUnsaved = true;
    notices.push(`This link brought ${sharedFiles.length} file${sharedFiles.length === 1 ? '' : 's'}: `
      + `${sharedFiles.map((f) => f.name).join(', ')}. They are saved for this program once you edit it.`);
  }
  else
  {
    projectFiles = await loadProjectFiles(entry.id);
    filesPendingSave = false;
  }
  renderFiles();
  el.title.textContent = entry.title;
  el.description.textContent = entry.description || '';
  el.controls.textContent = entry.controls || '';
  document.title = `${entry.title} - DivJS Playground`;
  setHash(entry.id);
  renderProgramList();
  run();
  for (const notice of notices)
  {
    logLine(notice, 'warn');
  }
}

// ── Running ─────────────────────────────────────────────────────────────

function ensureRunner(entry)
{
  const key = `${entry.width}x${entry.height}|${entry.clearColor || ''}`;
  if (runner && runnerKey === key)
  {
    return runner;
  }
  if (runner)
  {
    runner.destroy();
  }
  runner = runDivDemo({
    canvas: el.canvas,
    source: '',
    width: entry.width,
    height: entry.height,
    clearColor: entry.clearColor || '#000000',
    autoStart: false,
    onLog: (line) => logLine(line, line.startsWith('[warn]') ? 'warn' : ''),
    onError: handleError,
    onFrame: handleFrame,
    // An online game's invitation as a link: this code plus the
    // invitation, so the guest runs exactly the same program.
    netInviteLink: async (code) => `${await buildShareUrl()}&net=${code}`
  });
  runnerKey = key;
  return runner;
}

function handleError(err)
{
  if (err && err.name === 'DivError')
  {
    view.dispatch(setDiagnostics(view.state, [errorToDiagnostic(err, view.state.doc)]));
    logCompileError(err);
    setStatus('Compile error', 'error');
    // Nothing ran: don't leave the previous program's picture and numbers
    // on screen as if they were this code's.
    const ctx = el.canvas.getContext('2d');
    ctx.fillStyle = current?.clearColor || '#000000';
    ctx.fillRect(0, 0, el.canvas.width, el.canvas.height);
    el.stats.textContent = '';
  }
  else
  {
    logLine('Runtime error: ' + (err?.message || String(err)), 'error');
    setStatus('Stopped by an error', 'error');
  }
  el.stopBtn.disabled = true;
}

function handleFrame({ runtime, vm })
{
  const size = `${el.canvas.width}x${el.canvas.height}`;
  if (size !== lastCanvasSize)
  {
    lastCanvasSize = size;
    fitCanvas();
  }
  const now = performance.now();
  if (now - lastStatsAt >= STATS_INTERVAL_MS)
  {
    lastStatsAt = now;
    const processes = vm.processManager.getAll().filter((p) => !p.isMouse).length;
    el.stats.textContent = `${Math.round(runtime.fpsValue || 0)} fps · ${processes} processes`;
  }
  if (vm.halted && !el.stopBtn.disabled)
  {
    setStatus('Finished (exit)');
    el.stopBtn.disabled = true;
  }
}

function run()
{
  if (!current)
  {
    return;
  }
  saveNow();
  clearConsole();
  view.dispatch(setDiagnostics(view.state, []));
  const active = ensureRunner(current);
  setStatus('Running', 'running');
  el.stopBtn.disabled = false;
  active.setFiles(filesForRuntime());
  active.start(currentText());
  if (active.getState().running)
  {
    el.canvas.focus({ preventScroll: true });
  }
}

function stop()
{
  if (runner)
  {
    runner.stop();
  }
  setStatus('Stopped');
  el.stopBtn.disabled = true;
}

// Scale the canvas to fit its panel, keeping the aspect ratio. When
// enlarging, a whole-number scale keeps pixel art even, but only if it
// uses most of the space (a 320x200 game in a 1.9x panel would otherwise
// stay at 1x).
function fitCanvas()
{
  const box = el.screen.getBoundingClientRect();
  const width = el.canvas.width;
  const height = el.canvas.height;
  if (box.width <= 0 || box.height <= 0 || width <= 0 || height <= 0)
  {
    return;
  }
  let scale = Math.min(box.width / width, box.height / height);
  const whole = Math.floor(scale);
  if (whole >= 1 && whole / scale >= 0.85)
  {
    scale = whole;
  }
  el.canvas.style.width = `${Math.floor(width * scale)}px`;
  el.canvas.style.height = `${Math.floor(height * scale)}px`;
}

// ── Full screen ─────────────────────────────────────────────────────────

function isFullscreen()
{
  return document.fullscreenElement === el.screen || el.screen.classList.contains('screen-max');
}

// The game panel on the whole screen, scaled by fitCanvas like any other
// resize. Esc leaves (the browser's own key for the Fullscreen API; the
// fallback listens for it). The canvas keeps the focus so the keys still
// reach the game.
async function toggleFullscreen()
{
  if (isFullscreen())
  {
    if (document.fullscreenElement)
    {
      await document.exitFullscreen();
    }
    el.screen.classList.remove('screen-max');
  }
  else if (el.screen.requestFullscreen)
  {
    try
    {
      await el.screen.requestFullscreen();
    }
    catch
    {
      el.screen.classList.add('screen-max');
    }
  }
  else
  {
    el.screen.classList.add('screen-max');
  }
  updateFullscreenButton();
  el.canvas.focus({ preventScroll: true });
}

function updateFullscreenButton()
{
  el.fullscreenBtn.textContent = isFullscreen() ? '✕ Leave full screen' : '⛶ Full screen';
  fitCanvas();
}

// ── Inspector ───────────────────────────────────────────────────────────

function table(headers, rows)
{
  const t = document.createElement('table');
  const head = t.createTHead().insertRow();
  for (const h of headers)
  {
    const th = document.createElement('th');
    th.textContent = h;
    head.appendChild(th);
  }
  const body = t.createTBody();
  for (const row of rows)
  {
    const tr = body.insertRow();
    for (const cell of row)
    {
      tr.insertCell().textContent = cell;
    }
  }
  return t;
}

function formatValue(value)
{
  if (typeof value === 'number')
  {
    return Number.isInteger(value) ? String(value) : value.toFixed(2);
  }
  if (typeof value === 'string')
  {
    return JSON.stringify(value);
  }
  return String(value);
}

function updateInspector()
{
  if (el.inspector.hidden || !runner)
  {
    return;
  }
  const { vm, bytecode } = runner.getState();
  if (!vm)
  {
    return;
  }
  const processes = vm.processManager.getAll().filter((p) => !p.isMouse);
  const shown = processes.slice(0, 100);
  const rows = shown.map((p) => [
    p.id,
    p.isMain ? 'MAIN' : p.name,
    formatValue(p.x),
    formatValue(p.y),
    p.graph,
    p.dead ? 'dead' : p.sleeping ? 'asleep' : p.suspended ? 'frozen' : 'alive'
  ]);
  el.inspectProcesses.replaceChildren(table(['id', 'name', 'x', 'y', 'graph', 'state'], rows));
  if (processes.length > shown.length)
  {
    const more = document.createElement('div');
    more.textContent = `… and ${processes.length - shown.length} more`;
    el.inspectProcesses.appendChild(more);
  }
  const globals = Object.entries(bytecode?.globals || {}).map(([name, slot]) =>
  {
    const value = typeof slot === 'object' ? `[${slot.size} values]` : formatValue(vm.globals.get(slot) ?? 0);
    return [name, value];
  });
  el.inspectGlobals.replaceChildren(table(['name', 'value'], globals));
}

function showTab(which)
{
  const tabs = {
    console: [el.consoleTab, el.console],
    inspector: [el.inspectorTab, el.inspector],
    files: [el.filesTab, el.files]
  };
  for (const [name, [tab, panel]] of Object.entries(tabs))
  {
    const on = name === which;
    panel.hidden = !on;
    tab.classList.toggle('active', on);
    tab.setAttribute('aria-selected', String(on));
  }
  updateInspector();
}

// ── Project files ───────────────────────────────────────────────────────

function filesForRuntime()
{
  return Object.fromEntries(projectFiles.map((f) => [f.name, f.bytes]));
}

// Whether load_*(ref) finds a project file - the runtime's own rule: the
// whole path, or the file name alone, in any case, with either slash.
function isProjectFile(ref)
{
  const key = CanvasEngineRuntime.normalizeAssetPath(ref);
  const base = key.slice(key.lastIndexOf('/') + 1);
  return projectFiles.some((f) =>
  {
    const name = CanvasEngineRuntime.normalizeAssetPath(f.name);
    return name === key || name.slice(name.lastIndexOf('/') + 1) === base;
  });
}

async function loadProjectFiles(id)
{
  try
  {
    return await fileStore.list(id);
  }
  catch (err)
  {
    logLine(`Could not read this program's files: ${err.message || err}`, 'error');
    return [];
  }
}

async function saveProjectFiles()
{
  if (!current || sharedUnsaved)
  {
    return;
  }
  filesPendingSave = false;
  const id = current.id;
  const files = projectFiles;
  try
  {
    await fileStore.replaceAll(id, files);
  }
  catch (err)
  {
    logLine(`Could not save this program's files: ${err.message || err}`, 'error');
  }
}

function renderFiles()
{
  const token = ++renderFilesToken;
  el.filesCount.hidden = projectFiles.length === 0;
  el.filesCount.textContent = String(projectFiles.length);
  el.filesWhere.textContent = fileStore.persistent
    ? 'They are kept in this browser, for this program.'
    : 'This browser does not let the page store them: they last until it is closed.';
  el.fileList.textContent = '';
  for (const file of projectFiles)
  {
    const item = document.createElement('li');
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = file.name;
    const info = document.createElement('span');
    info.className = 'info';
    info.textContent = formatSize(file.bytes.length);
    const remove = document.createElement('button');
    remove.textContent = 'Remove';
    remove.title = `Remove ${file.name}`;
    remove.addEventListener('click', () => removeFile(file.name));
    item.append(name, info, remove);
    el.fileList.appendChild(item);
    describeFile(file.name, file.bytes).then((text) =>
    {
      if (token === renderFilesToken)
      {
        info.textContent = `${text} · ${formatSize(file.bytes.length)}`;
      }
    });
  }
}

// Adding or removing a file is an edit: shared code and files become this
// program's saved ones, and the program restarts so load_* sees the change.
function filesChanged()
{
  filesPendingSave = true;
  sharedUnsaved = false;
  saveNow();
  renderFiles();
  run();
}

async function addFiles(list)
{
  if (!current)
  {
    return;
  }
  const added = [];
  for (const file of list)
  {
    if (file.size > MAX_FILE_SIZE)
    {
      logLine(`${file.name} is ${formatSize(file.size)}; files over ${formatSize(MAX_FILE_SIZE)} are not accepted.`, 'warn');
      continue;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    projectFiles = projectFiles.filter((f) => f.name.toLowerCase() !== file.name.toLowerCase());
    projectFiles.push({ name: file.name, bytes });
    added.push(file.name);
  }
  if (added.length === 0)
  {
    return;
  }
  projectFiles.sort((a, b) => a.name.localeCompare(b.name));
  filesChanged();
  logLine(`Added ${added.join(', ')}.`, 'ok');
}

function removeFile(name)
{
  projectFiles = projectFiles.filter((f) => f.name !== name);
  filesChanged();
  logLine(`Removed ${name}.`);
}

function setupFileDrop()
{
  const hasFiles = (event) => [...(event.dataTransfer?.types || [])].includes('Files');
  el.fileInput.addEventListener('change', async () =>
  {
    await addFiles([...el.fileInput.files]);
    el.fileInput.value = '';
  });
  // Files dropped anywhere on the page are added (and the browser does
  // not navigate away to show them).
  window.addEventListener('dragover', (event) =>
  {
    if (hasFiles(event))
    {
      event.preventDefault();
      el.dropZone.classList.add('over');
    }
  });
  window.addEventListener('dragleave', (event) =>
  {
    if (!event.relatedTarget)
    {
      el.dropZone.classList.remove('over');
    }
  });
  window.addEventListener('drop', async (event) =>
  {
    if (!hasFiles(event))
    {
      return;
    }
    event.preventDefault();
    el.dropZone.classList.remove('over');
    showTab('files');
    await addFiles([...event.dataTransfer.files]);
  });
}

// ── Actions ─────────────────────────────────────────────────────────────

// A link that opens the current code (and its files, when they fit).
async function buildShareUrl()
{
  saveNow();
  const encoded = await encodeSource(currentText());
  let filesParam = '';
  if (projectFiles.length > 0)
  {
    const packed = await deflateBytes(packFiles(projectFiles));
    if (packed.length <= SHARE_FILES_LIMIT)
    {
      filesParam = `&files=${bytesToBase64Url(packed)}`;
    }
    else
    {
      logLine(`The files are too big for a link (${formatSize(packed.length)} compressed, the limit is `
        + `${formatSize(SHARE_FILES_LIMIT)}): this link has the code only. Use Export to send the whole game.`, 'warn');
    }
  }
  return `${window.location.origin}${window.location.pathname}#p=${encodeURIComponent(current.id)}&code=${encoded}${filesParam}`;
}

async function share()
{
  const url = await buildShareUrl();
  try
  {
    await navigator.clipboard.writeText(url);
    toast('Link copied');
  }
  catch
  {
    window.prompt('Copy this link:', url);
  }
  if (url.length > 8000)
  {
    logLine(`This link is ${url.length} characters long; some apps may cut long links.`, 'warn');
  }
}

// One .html with the engine, this code and its files: the program's own
// files plus the repository files its load_* calls name (the examples'
// ../assets/...). Nothing is uploaded; the page builds the file itself.
async function exportGame()
{
  if (!current)
  {
    return;
  }
  saveNow();
  el.exportBtn.disabled = true;
  try
  {
    if (!engineModules)
    {
      engineModules = await collectEngineModules(async (path) =>
      {
        const response = await fetch(`../${path}`, FETCH_OPTIONS);
        if (!response.ok)
        {
          throw new Error(`${path}: HTTP ${response.status}`);
        }
        return response.text();
      });
    }
    const source = currentText();
    const files = filesForRuntime();
    const missing = [];
    for (const ref of findAssetReferences(source))
    {
      if (isProjectFile(ref))
      {
        continue;
      }
      try
      {
        const response = await fetch(new URL(ref, window.location.href), FETCH_OPTIONS);
        if (!response.ok)
        {
          throw new Error(`HTTP ${response.status}`);
        }
        files[ref] = new Uint8Array(await response.arrayBuffer());
      }
      catch
      {
        missing.push(ref);
      }
    }
    const html = buildPackedHtml({
      modules: engineModules,
      source,
      files,
      title: current.title,
      width: current.width,
      height: current.height,
      clearColor: current.clearColor || '#000000'
    });
    const name = `${current.id === NEW_PROGRAM.id ? 'my-game' : current.id}.html`;
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 10000);
    const count = Object.keys(files).length;
    logLine(`Exported ${name} (${formatSize(html.length)}): the engine, this code and ${count} file${count === 1 ? '' : 's'}. `
      + 'It opens with a double click and needs no internet.', 'ok');
    if (missing.length > 0)
    {
      logLine(`Not found, so not in the export: ${missing.join(', ')}. Add them in the Files tab.`, 'warn');
    }
  }
  catch (err)
  {
    logLine(`Export failed: ${err.message || err}`, 'error');
  }
  finally
  {
    el.exportBtn.disabled = false;
  }
}

function reset()
{
  if (!current || currentText() === originalSource)
  {
    return;
  }
  if (!window.confirm(`Discard your edits to "${current.title}"?`))
  {
    return;
  }
  storageRemove(current.id);
  sharedUnsaved = false;
  setEditorText(originalSource);
  updateEditedState();
  run();
}

// The native list comes from a real runtime, so highlighting and
// completion match what programs can call.
function registeredNativeNames()
{
  const vm = new VM();
  const runtime = new CanvasEngineRuntime({ vm, ctx: document.createElement('canvas').getContext('2d') });
  runtime.registerNatives();
  const names = [...vm.natives.keys()];
  runtime.dispose();
  return names;
}

async function openFromHash()
{
  const { net } = parseHash();
  await openProgramFromHash();
  if (net && runner)
  {
    // Used once, by the program's next net_join(); a reload must not reuse it.
    runner.setNetInvite(net);
    window.history.replaceState(null, '', window.location.hash.replace(/&net=[^&]*/, ''));
    logLine('This link carries an invitation to an online game: choose "join" in the game to connect.');
  }
}

async function openProgramFromHash()
{
  const { programId, code, files } = parseHash();
  const entry = allPrograms().find((p) => p.id === programId) || manifest.programs[0];
  if (code)
  {
    let sharedFiles = null;
    if (files)
    {
      try
      {
        sharedFiles = unpackFiles(await inflateBytes(base64UrlToBytes(files)));
      }
      catch
      {
        logLine('The files in this link could not be read.', 'error');
      }
    }
    try
    {
      await openProgram(entry, { sharedSource: await decodeSource(code), sharedFiles });
      return;
    }
    catch
    {
      logLine('The shared code in this link could not be read.', 'error');
    }
  }
  await openProgram(entry);
}

async function init()
{
  el.stopBtn.disabled = true;
  el.resetBtn.disabled = true;
  try
  {
    manifest = await (await fetch(MANIFEST_URL, FETCH_OPTIONS)).json();
  }
  catch (err)
  {
    el.title.textContent = 'Could not load the program list';
    logLine(String(err.message || err), 'error');
    return;
  }
  const nativeInfo = await loadNativeInfo(registeredNativeNames(), NATIVES_DOC_URL);
  createEditor(nativeInfo);
  fileStore = await openFileStore();

  el.runBtn.addEventListener('click', run);
  el.stopBtn.addEventListener('click', stop);
  el.resetBtn.addEventListener('click', reset);
  el.shareBtn.addEventListener('click', share);
  el.exportBtn.addEventListener('click', exportGame);
  el.fullscreenBtn.addEventListener('click', toggleFullscreen);
  document.addEventListener('fullscreenchange', updateFullscreenButton);
  window.addEventListener('keydown', (event) =>
  {
    if (event.key === 'Escape' && el.screen.classList.contains('screen-max'))
    {
      el.screen.classList.remove('screen-max');
      updateFullscreenButton();
    }
  });
  el.filesTab.addEventListener('click', () => showTab('files'));
  setupFileDrop();
  el.newBtn.addEventListener('click', () => openProgram(NEW_PROGRAM));
  el.consoleTab.addEventListener('click', () => showTab('console'));
  el.inspectorTab.addEventListener('click', () => showTab('inspector'));
  el.canvas.addEventListener('pointerdown', () => el.canvas.focus({ preventScroll: true }));
  window.addEventListener('beforeunload', saveNow);
  window.addEventListener('hashchange', () =>
  {
    const { programId, code } = parseHash();
    if (code || programId !== current?.id)
    {
      openFromHash();
    }
  });
  new ResizeObserver(fitCanvas).observe(el.screen);
  setInterval(updateInspector, INSPECTOR_INTERVAL_MS);

  await openFromHash();
}

// For debugging from the browser console (and the playground tests):
// the running program's vm, runtime and bytecode.
window.divPlayground = {
  getState: () => (runner ? runner.getState() : null),
  getProgramId: () => current?.id ?? null,
  getFiles: () => projectFiles.map((f) => ({ name: f.name, size: f.bytes.length }))
};

init();
