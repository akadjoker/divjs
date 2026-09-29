import { Lexer } from './compiler/tokenizer.js';
import { Parser } from './parser/parser.js';
import { Compiler } from './compiler/compiler.js';
import { VM } from './vm/vm.js';
import { CanvasEngineRuntime } from './vm/runtime.js';
import { TouchControls, GamepadInput, VirtualKeys, normalizeTouchLayout } from './vm/controls.js';

function compileSource(source) {
  const lexer = new Lexer(source);
  const tokens = lexer.tokenize();
  const parser = new Parser(tokens);
  const ast = parser.parse();
  const compiler = new Compiler();
  return compiler.compile(ast);
}

function resolveCanvas(canvasOrId) {
  if (typeof canvasOrId === 'string') {
    const el = document.getElementById(canvasOrId);
    if (!el) {
      throw new Error(`Canvas not found: ${canvasOrId}`);
    }
    return el;
  }

  if (!canvasOrId || typeof canvasOrId.getContext !== 'function') {
    throw new Error('Invalid canvas element');
  }

  return canvasOrId;
}

// True for elements that consume typed keys themselves: form fields and
// anything contenteditable (code editors such as CodeMirror use that).
function isEditableTarget(target)
{
  if (!target || target === window || target === document)
  {
    return false;
  }
  if (target.isContentEditable)
  {
    return true;
  }
  const tag = String(target.tagName || '').toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

// The panel online games use to exchange connection codes (vm/net.js):
// the host shows an invitation code and pastes back the guest's answer;
// the guest pastes the invitation and shows the answer. Built on first
// use, styled inline so it works on any page (and in packed games).
//
// inviteLink(code), optional and possibly async, turns an invitation code
// into a link to this same game (see runDivDemo's netInviteLink); the host
// then gets a "Copy invitation link" button. A page opened from such a
// link sets panel.invite: the next join fills it in and makes the answer
// straight away.
export function createNetPanel(doc = document, { inviteLink = null } = {})
{
  let root = null;
  const panel = {
    onCancel: null,
    invite: null,
    showHost,
    askJoin,
    close,
    error
  };

  function el(tag, style, text)
  {
    const node = doc.createElement(tag);
    if (style)
    {
      node.style.cssText = style;
    }
    if (text !== undefined)
    {
      node.textContent = text;
    }
    return node;
  }

  const BUTTON = 'font:600 13px system-ui,sans-serif;padding:7px 14px;border-radius:6px;border:1px solid #3a5068;background:#1d3348;color:#e6f1ff;cursor:pointer;margin-right:8px';
  const AREA = 'display:block;box-sizing:border-box;width:100%;height:84px;margin:6px 0 10px;font:11px ui-monospace,Consolas,monospace;background:#0b1117;color:#9fe6c8;border:1px solid #2a3b4d;border-radius:6px;padding:6px;resize:none;word-break:break-all';

  function open(title)
  {
    close();
    root = el('div', 'position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.55)');
    root.setAttribute('data-divjs-net', '');
    const box = el('div', 'width:min(460px,calc(100vw - 32px));background:#132030;color:#dbe7f3;border:1px solid #2f4760;border-radius:10px;padding:16px 18px;font:14px system-ui,sans-serif;box-shadow:0 12px 40px rgba(0,0,0,.5)');
    box.appendChild(el('div', 'font-weight:700;font-size:16px;margin-bottom:8px', title));
    const body = el('div');
    const status = el('div', 'min-height:18px;font-size:13px;color:#8fb3d6;margin:4px 0 10px');
    status.setAttribute('data-net-status', '');
    const buttons = el('div');
    const cancel = el('button', BUTTON, 'Cancel');
    cancel.setAttribute('data-net-cancel', '');
    cancel.onclick = () =>
    {
      close();
      if (typeof panel.onCancel === 'function')
      {
        panel.onCancel();
      }
    };
    box.append(body, status, buttons);
    buttons.appendChild(cancel);
    root.appendChild(box);
    doc.body.appendChild(root);
    return { body, status, buttons, cancel };
  }

  async function copyText(button, text, done)
  {
    try
    {
      await navigator.clipboard.writeText(text);
      button.textContent = done;
    }
    catch
    {
      button.textContent = 'Select and copy it';
    }
  }

  function codeBox(parent, code)
  {
    const area = el('textarea', AREA);
    area.readOnly = true;
    area.value = code;
    area.setAttribute('data-net-code', '');
    const copy = el('button', BUTTON, 'Copy code');
    copy.onclick = () =>
    {
      area.select();
      copyText(copy, code, 'Copied');
    };
    parent.append(area, copy);
    return area;
  }

  function inputBox(parent, label, attr)
  {
    parent.appendChild(el('div', 'margin-top:12px', label));
    const area = el('textarea', AREA);
    area.setAttribute(attr, '');
    area.placeholder = 'DIVNET1....';
    parent.appendChild(area);
    return area;
  }

  // onAnswer(code) is async and throws on a bad code.
  function showHost(code, onAnswer)
  {
    const ui = open('Host an online game');
    ui.body.appendChild(el('div', '', '1. Send this invitation to the other player:'));
    const area = codeBox(ui.body, code);
    if (typeof inviteLink === 'function')
    {
      // A link opens this game with the invitation already in it.
      const copyLink = el('button', BUTTON, 'Copy invitation link');
      copyLink.setAttribute('data-net-copy-link', '');
      copyLink.onclick = async () =>
      {
        try
        {
          const url = await inviteLink(code);
          area.value = url;
          area.select();
          copyText(copyLink, url, 'Link copied');
        }
        catch (err)
        {
          error(String(err?.message || err));
        }
      };
      ui.body.appendChild(copyLink);
    }
    const answer = inputBox(ui.body, '2. Paste the answer code they send back:', 'data-net-answer');
    const connect = el('button', BUTTON, 'Connect');
    connect.setAttribute('data-net-connect', '');
    connect.onclick = async () =>
    {
      ui.status.style.color = '#8fb3d6';
      ui.status.textContent = 'Connecting...';
      try
      {
        await onAnswer(answer.value);
      }
      catch (err)
      {
        error(String(err?.message || err));
      }
    };
    ui.buttons.insertBefore(connect, ui.cancel);
  }

  // onOffer(code) is async, returns the answer code and throws on a bad
  // code.
  function askJoin(onOffer)
  {
    const ui = open('Join an online game');
    const offer = inputBox(ui.body, 'Paste the invitation code from the host:', 'data-net-offer');
    const make = el('button', BUTTON, 'Make answer');
    make.setAttribute('data-net-make-answer', '');
    make.onclick = async () =>
    {
      ui.status.style.color = '#8fb3d6';
      ui.status.textContent = 'Preparing the answer...';
      make.disabled = true;
      try
      {
        const answer = await onOffer(offer.value);
        ui.body.textContent = '';
        ui.body.appendChild(el('div', '', 'Send this answer back to the host. The game connects when they paste it:'));
        codeBox(ui.body, answer);
        make.remove();
        ui.status.textContent = 'Waiting for the host...';
      }
      catch (err)
      {
        make.disabled = false;
        error(String(err?.message || err));
      }
    };
    ui.buttons.insertBefore(make, ui.cancel);
    if (panel.invite)
    {
      offer.value = panel.invite;
      panel.invite = null;
      make.click();
    }
  }

  function error(message)
  {
    const status = root && root.querySelector('[data-net-status]');
    if (status)
    {
      status.style.color = '#ff8f8f';
      status.textContent = message;
    }
  }

  function close()
  {
    if (root)
    {
      root.remove();
      root = null;
    }
  }

  return panel;
}

// Calls onTick every intervalMs. A page's own timers are slowed down by
// browsers while its tab is in the background, a worker's much less (how
// much depends on the browser), so the ticks come from a small worker when
// the page may start one, and from setInterval otherwise.
function createTicker(intervalMs, onTick)
{
  try
  {
    const code = 'let t = 0; onmessage = (e) => { clearInterval(t); t = setInterval(() => postMessage(0), e.data); };';
    const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
    const worker = new Worker(url);
    let first = true;
    worker.onmessage = () =>
    {
      if (first)
      {
        URL.revokeObjectURL(url);
        first = false;
      }
      onTick();
    };
    worker.postMessage(intervalMs);
    return { stop: () => worker.terminate() };
  }
  catch
  {
    const timer = setInterval(onTick, intervalMs);
    return { stop: () => clearInterval(timer) };
  }
}

export function runDivDemo(options) {
  const {
    canvas,
    source,
    clearColor = '#0b1117',
    autoStart = true,
    preventDefaultKeys = true,
    virtualWidth,
    virtualHeight,
    debugDrawProcessBounds = false,
    debugProcessBoundsColor = '#00ffff',
    debugShowStats = false,
    debugStatsTextColor = '#e6fffb',
    debugStatsBgColor = 'rgba(6, 10, 18, 0.7)',
    debugStatsX = 8,
    debugStatsY = 8,
    onLog,
    onError,
    onFrame,
    width,
    height,
    // How long a frame may wait for load_fpg/load_fnt/load_map fetches
    // started in the same tick before it renders anyway (placeholders
    // for whatever hasn't arrived). A fetch that never answers used to
    // freeze the program for good.
    loadHoldTimeoutMs = 3000,
    // Maximum number of live WRITE texts (see CanvasEngineRuntime.maxTexts).
    maxTexts,
    // Files that come with the program (name -> Blob / ArrayBuffer /
    // typed array / URL): load_fpg("ship.fpg") and friends read them
    // before trying a URL. See CanvasEngineRuntime.setFiles.
    files,
    // Online play (vm/net.js). netIceServers: the STUN/TURN servers
    // WebRTC uses to find a route between the players (default: one
    // public STUN server; [] for local networks only). netUi: a
    // replacement for the built-in code-exchange panel (see
    // createNetPanel for the interface). netInviteLink(code): makes a link
    // to this game carrying an invitation (the built-in panel then offers
    // it to the host); the page that opens it passes the code to
    // setNetInvite().
    netIceServers,
    netUi,
    netInviteLink,
    // On-screen controls for phones and tablets (vm/controls.js): 'auto'
    // shows them from the first touch until a key is typed on a keyboard,
    // true always, false never. touchLayout: which pad and buttons (see
    // vm/controls.js; false = none, for mouse-only games); a program can
    // change it with touch_pad / touch_buttons / touch_menu. touchArea: the
    // element whose bottom corners they sit in (default: the canvas).
    touchControls = 'auto',
    touchLayout,
    touchArea,
    // Gamepads press the same keys as the on-screen controls.
    gamepad = true
  } = options || {};

  const canvasEl = resolveCanvas(canvas);
  // willReadFrequently: get_pixel() reads back single pixels, potentially
  // every frame (DIV scripts use it for scenery collision), which the
  // browser otherwise warns is slow against a GPU-backed canvas.
  const screenCtx = canvasEl.getContext('2d', { willReadFrequently: true });

  if (width) {
    canvasEl.width = Number(width) || canvasEl.width;
  }
  if (height) {
    canvasEl.height = Number(height) || canvasEl.height;
  }

  const useVirtualScreen = Number.isFinite(Number(virtualWidth)) && Number.isFinite(Number(virtualHeight));
  const runtimeCanvas = useVirtualScreen ? document.createElement('canvas') : canvasEl;
  const runtimeCtx = useVirtualScreen
    ? runtimeCanvas.getContext('2d', { willReadFrequently: true })
    : screenCtx;

  if (useVirtualScreen) {
    runtimeCanvas.width = Math.max(1, Number(virtualWidth));
    runtimeCanvas.height = Math.max(1, Number(virtualHeight));
    screenCtx.imageSmoothingEnabled = false;
  }

  // set_mode() resizes the runtime canvas; every start() puts it back so
  // one program's video mode doesn't carry over into the next.
  const initialRuntimeWidth = runtimeCanvas.width;
  const initialRuntimeHeight = runtimeCanvas.height;
  const netPanel = netUi || (typeof document !== 'undefined' ? createNetPanel(document, { inviteLink: netInviteLink }) : null);

  const virtualKeys = new VirtualKeys(() => runtime);
  let currentTouchLayout = touchLayout;
  const touch = touchControls !== false && typeof document !== 'undefined'
    ? new TouchControls({
      canvas: canvasEl,
      area: typeof touchArea === 'string' ? document.getElementById(touchArea) : touchArea,
      keys: virtualKeys,
      mode: touchControls,
      layout: touchLayout
    })
    : null;
  const pads = gamepad
    ? new GamepadInput({
      keys: virtualKeys,
      getLayout: () => (touch ? touch.layout : normalizeTouchLayout(currentTouchLayout)),
      onUse: () => touch?.otherInput()
    })
    : null;

  let vm = null;
  let bytecode = null; // the running program's, for tools (global names, disassembly)
  let runtime = null;
  let running = false;
  let rafId = 0;
  // At most one animation frame is ever requested: while the tab is hidden
  // the backup ticker below runs frames, and the one request waiting for
  // the tab to come back must not have company.
  let rafPending = false;
  let lastRafAt = 0;
  // Online play only: browsers stop animation frames in a background tab,
  // and the other player would wait for this side for ever - for its
  // input in lockstep, or, before that, for a host whose tab went to the
  // background while the guest was joining to call net_start. From the
  // moment a connection is being made, the ticker runs the game's frames
  // whenever animation frames stop.
  let ticker = null;
  const netActive = (net) => net.running || net.status === 1 || net.status === 2 || net.status === 4;
  let lastTs = 0;
  let nextFrameTs = 0;
  let currentSource = String(source || '');
  let currentFiles = files || null;
  // Identifies the current run. Every scheduled callback (the RAF loop
  // and the deferred finishFrame after pending loads) carries the value
  // it was created with and does nothing once it no longer matches, so a
  // stop()/start() can never leave a second loop ticking alongside the
  // new one.
  let generation = 0;

  const blockedKeys = new Set([
    'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
    ' ', 'Spacebar', 'Space',
    'PageUp', 'PageDown', 'Home', 'End'
  ]);

  const handleKeyDown = (event) =>
  {
    // Keys typed into an editor, input or other editable element on the
    // same page belong to that element: don't swallow them and don't
    // feed them to the game.
    if (isEditableTarget(event.target))
    {
      return;
    }

    if (preventDefaultKeys && blockedKeys.has(event.key))
    {
      event.preventDefault();
    }
    // Tab moves the focus between the page's controls, so it is only kept
    // from doing that while the game has the focus and the program uses
    // Tab itself: other programs (and keyboard users) keep Tab for moving
    // around the page.
    else if (preventDefaultKeys && event.key === 'Tab' && event.target === canvasEl && runtime && runtime.readsKey('Tab'))
    {
      event.preventDefault();
    }

    if (runtime)
    {
      runtime.setKeyState(event.key, true, event.code);
    }
  };

  // Always honoured, even from an editable element: a key pressed for
  // the game and released after focus moved into an editor must not stay
  // held down.
  const handleKeyUp = (event) =>
  {
    if (runtime)
    {
      runtime.setKeyState(event.key, false, event.code);
    }
  };

  const handleBlur = () => {
    if (runtime) {
      runtime.clearKeyState();
    }
    touch?.releaseAll();
    pads?.releaseAll();
  };

  window.addEventListener('keydown', handleKeyDown, { passive: false });
  window.addEventListener('keyup', handleKeyUp);
  window.addEventListener('blur', handleBlur);

  const emitError = (err) => {
    if (typeof onError === 'function') {
      onError(err);
      return;
    }
    throw err;
  };

  const schedule = (runId) =>
  {
    if (rafPending)
    {
      return;
    }
    rafPending = true;
    rafId = requestAnimationFrame((ts) =>
    {
      rafPending = false;
      lastRafAt = performance.now();
      runFrame(ts, runId);
    });
  };

  const startTicker = (runId, fps) =>
  {
    ticker = createTicker(1000 / (fps > 0 ? fps : 60), () =>
    {
      if (!running || runId !== generation || !netActive(runtime.net))
      {
        return;
      }
      // Animation frames still arriving: they drive the game.
      if (performance.now() - lastRafAt < 250)
      {
        return;
      }
      runFrame(performance.now(), runId);
    });
  };

  const runFrame = (timestamp, runId) =>
  {
    if (!running || runId !== generation)
    {
      return;
    }

    // Before the frame reads its input (key_pressed, lockstep capture).
    pads?.poll();
    touch?.update();

    const targetFps = runtime.targetFps || 0;
    if (targetFps > 0)
    {
      const frameInterval = 1000 / targetFps;
      if (nextFrameTs === 0)
      {
        nextFrameTs = timestamp;
      }
      // 1 ms of slack: display frames jitter around their period, and a
      // strict comparison skipped every other frame when the game's rate
      // equals the display's (60 fps on a 60 Hz screen ran at 30).
      if (timestamp < nextFrameTs - 1)
      {
        schedule(runId);
        return;
      }
      // Advance by fixed steps to avoid drift; resync if we fell far behind.
      nextFrameTs += frameInterval;
      if (timestamp - nextFrameTs > frameInterval)
      {
        nextFrameTs = timestamp + frameInterval;
      }
    }
    else
    {
      nextFrameTs = 0;
    }

    // Online lockstep: a frame runs only once both players' input for it
    // is here. Waiting keeps the previous picture and retries on the next
    // display frame (not a whole game frame later).
    const net = runtime.net;
    if (!net.beforeFrame(runtime))
    {
      lastTs = timestamp;
      nextFrameTs = timestamp;
      schedule(runId);
      return;
    }
    if (!ticker && netActive(net))
    {
      startTicker(runId, targetFps);
    }

    const fixedDt = 1 / (targetFps > 0 ? targetFps : 60);
    // Both sides of a lockstep game must step by the same time.
    const dt = lastTs === 0 || net.running ? fixedDt : (timestamp - lastTs) / 1000;
    lastTs = timestamp;

    runtime.beginFrame(dt);

    const finishFrame = () =>
    {
      if (!running || runId !== generation)
      {
        return;
      }
      try
      {
        runtime.render();

        if (useVirtualScreen)
        {
          screenCtx.fillStyle = clearColor;
          screenCtx.fillRect(0, 0, canvasEl.width, canvasEl.height);
          screenCtx.drawImage(runtimeCanvas, 0, 0, canvasEl.width, canvasEl.height);
        }

        if (typeof onFrame === 'function')
        {
          onFrame({ vm, runtime, dt });
        }
      }
      catch (err)
      {
        running = false;
        emitError(err);
        return;
      }
      // exit() sets vm.halted to mean "stop the whole program" - render
      // this final frame, then stop rescheduling the RAF loop instead of
      // sitting idle-but-alive forever.
      if (vm.halted)
      {
        running = false;
        return;
      }
      schedule(runId);
    };

    try
    {
      vm.tick();
      net.afterFrame(vm);
    }
    catch (err)
    {
      running = false;
      emitError(err);
      return;
    }

    // A process spawned this tick (by MAIN or by another process - see
    // SPAWN_PROCESS's immediate-run in vm.js) can already reference a
    // graphic/font whose load_fpg/load_fnt/load_map fetch() is still in
    // flight. Rendering immediately would draw the fallback placeholder
    // for it - hold this frame until anything that started loading this
    // tick has settled (allSettled: a failed load already logs its own
    // warning via onLog), but never longer than loadHoldTimeoutMs.
    if (runtime.pendingLoads && runtime.pendingLoads.length > 0)
    {
      const pending = runtime.pendingLoads.splice(0, runtime.pendingLoads.length);
      waitForLoads(pending).then((timedOut) =>
      {
        if (timedOut && runId === generation && typeof onLog === 'function')
        {
          onLog(`[warn] assets still loading after ${loadHoldTimeoutMs} ms - continuing without them`);
        }
        finishFrame();
      });
      return;
    }

    finishFrame();
  };

  // Resolves true if the timeout won, false if every load settled first.
  const waitForLoads = (pending) =>
  {
    const settled = Promise.allSettled(pending).then(() => false);
    if (!(loadHoldTimeoutMs > 0))
    {
      return settled;
    }
    let timer = 0;
    const timeout = new Promise((resolve) =>
    {
      timer = setTimeout(() => resolve(true), loadHoldTimeoutMs);
    });
    return Promise.race([settled, timeout]).finally(() => clearTimeout(timer));
  };

  // Ends the current run: cancels its frame, invalidates every callback
  // it scheduled and releases the runtime's DOM listeners. The vm and
  // runtime objects stay readable through getState() for inspection.
  const endRun = () =>
  {
    running = false;
    generation += 1;
    if (rafId)
    {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
    rafPending = false;
    if (ticker)
    {
      ticker.stop();
      ticker = null;
    }
    touch?.setRunning(false);
  };

  const start = (nextSource) =>
  {
    if (nextSource !== undefined)
    {
      currentSource = String(nextSource);
    }

    endRun();
    if (runtime)
    {
      runtime.dispose();
    }

    if (!currentSource.trim())
    {
      emitError(new Error('Empty source'));
      return;
    }

    try
    {
      bytecode = compileSource(currentSource);

      runtimeCanvas.width = initialRuntimeWidth;
      runtimeCanvas.height = initialRuntimeHeight;
      vm = new VM();
      vm.load(bytecode);

      runtime = new CanvasEngineRuntime({
        vm,
        ctx: runtimeCtx,
        inputElement: canvasEl,
        maxTexts,
        files: currentFiles,
        netIceServers,
        netUi: netPanel,
        touchHost: touch,
        width: runtimeCanvas.width,
        height: runtimeCanvas.height,
        clearColor,
        debugDrawProcessBounds,
        debugProcessBoundsColor,
        debugShowStats,
        debugStatsTextColor,
        debugStatsBgColor,
        debugStatsX,
        debugStatsY,
        logFn: (line) =>
        {
          if (typeof onLog === 'function')
          {
            onLog(line);
          }
        }
      });
      runtime.registerNatives();
      // Keys still held on the controls or a gamepad carry over.
      virtualKeys.reapply();
      touch?.reset();
      touch?.setRunning(true);

      running = true;
      lastTs = 0;
      nextFrameTs = 0;
      const runId = generation;
      schedule(runId);
    }
    catch (err)
    {
      emitError(err);
    }
  };

  const stop = () =>
  {
    endRun();
  };

  const destroy = () =>
  {
    endRun();
    if (runtime)
    {
      runtime.dispose();
    }
    window.removeEventListener('keydown', handleKeyDown);
    window.removeEventListener('keyup', handleKeyUp);
    window.removeEventListener('blur', handleBlur);
    touch?.dispose();
    pads?.releaseAll();
    if (netPanel)
    {
      netPanel.close();
    }
    vm = null;
    runtime = null;
    bytecode = null;
  };

  const setSource = (nextSource) => {
    currentSource = String(nextSource || '');
  };

  // Used by the next start(), like setSource.
  const setFiles = (nextFiles) =>
  {
    currentFiles = nextFiles || null;
  };

  // An invitation this page was opened with: the program's next net_join()
  // uses it without asking.
  const setNetInvite = (code) =>
  {
    if (netPanel)
    {
      netPanel.invite = code ? String(code) : null;
    }
  };

  // The on-screen controls' layout for this and the next runs (see
  // touchLayout).
  const setTouchLayout = (layout) =>
  {
    currentTouchLayout = layout;
    touch?.setBaseLayout(layout);
  };

  const getState = () => ({
    running,
    vm,
    runtime,
    bytecode,
    source: currentSource
  });

  if (autoStart) {
    start();
  }

  return {
    start,
    stop,
    destroy,
    setSource,
    setFiles,
    setNetInvite,
    setTouchLayout,
    getState
  };
}

function preloadAssets(manifest) {
  const safeManifest = manifest || {};
  const imageJobs = (safeManifest.images || []).map((src) => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve();
    img.onerror = () => reject(new Error(`Failed to load image: ${src}`));
    img.src = src;
  }));

  const audioJobs = (safeManifest.audio || []).map((src) => new Promise((resolve, reject) => {
    const audio = new Audio();
    const done = () => {
      audio.removeEventListener('canplaythrough', done);
      audio.removeEventListener('error', fail);
      resolve();
    };
    const fail = () => {
      audio.removeEventListener('canplaythrough', done);
      audio.removeEventListener('error', fail);
      reject(new Error(`Failed to load audio: ${src}`));
    };
    audio.addEventListener('canplaythrough', done, { once: true });
    audio.addEventListener('error', fail, { once: true });
    audio.preload = 'auto';
    audio.src = src;
    audio.load();
  }));

  return Promise.all([...imageJobs, ...audioJobs]);
}

function installVirtualKeys(options) {
  const {
    container,
    getRuntime,
    mapping = {
      up: 'ArrowUp',
      down: 'ArrowDown',
      left: 'ArrowLeft',
      right: 'ArrowRight',
      fire: 'z'
    }
  } = options;

  if (!container) {
    return () => {};
  }

  const wrapper = document.createElement('div');
  wrapper.className = 'divjs-vkeys';
  wrapper.innerHTML = `
    <div class="divjs-pad divjs-pad-left">
      <button class="divjs-vkey divjs-vkey-up" data-key="${mapping.up}">UP</button>
      <button class="divjs-vkey divjs-vkey-left" data-key="${mapping.left}">LEFT</button>
      <button class="divjs-vkey divjs-vkey-right" data-key="${mapping.right}">RIGHT</button>
      <button class="divjs-vkey divjs-vkey-down" data-key="${mapping.down}">DOWN</button>
    </div>
    <div class="divjs-pad divjs-pad-right">
      <button class="divjs-vkey divjs-vkey-fire" data-key="${mapping.fire}">FIRE</button>
    </div>
  `;

  const pressedByPointer = new Map();
  const keyPressCount = new Map();
  const cleanups = [];

  const setState = (key, isDown) => {
    const runtime = getRuntime?.();
    if (!runtime) {
      return;
    }
    runtime.setKeyState(key, isDown);
  };

  const holdKey = (key) => {
    const count = keyPressCount.get(key) || 0;
    keyPressCount.set(key, count + 1);
    if (count === 0) {
      setState(key, true);
    }
  };

  const releaseKey = (key) => {
    const count = keyPressCount.get(key) || 0;
    if (count <= 1) {
      keyPressCount.delete(key);
      setState(key, false);
      return;
    }
    keyPressCount.set(key, count - 1);
  };

  const buttons = Array.from(wrapper.querySelectorAll('.divjs-vkey'));
  for (const button of buttons) {
    const key = button.dataset.key;

    const pointerDown = (event) => {
      event.preventDefault();
      button.setPointerCapture(event.pointerId);
      pressedByPointer.set(event.pointerId, key);
      button.classList.add('active');
      holdKey(key);
    };

    const pointerUp = (event) => {
      const stored = pressedByPointer.get(event.pointerId);
      if (!stored) {
        return;
      }
      pressedByPointer.delete(event.pointerId);
      button.classList.remove('active');
      releaseKey(stored);
    };

    button.addEventListener('pointerdown', pointerDown);
    button.addEventListener('pointerup', pointerUp);
    button.addEventListener('pointercancel', pointerUp);
    button.addEventListener('lostpointercapture', pointerUp);

    cleanups.push(() => {
      button.removeEventListener('pointerdown', pointerDown);
      button.removeEventListener('pointerup', pointerUp);
      button.removeEventListener('pointercancel', pointerUp);
      button.removeEventListener('lostpointercapture', pointerUp);
    });
  }

  container.appendChild(wrapper);

  return () => {
    for (const key of keyPressCount.keys()) {
      setState(key, false);
    }
    keyPressCount.clear();
    pressedByPointer.clear();
    for (const cleanup of cleanups) {
      cleanup();
    }
    wrapper.remove();
  };
}

export async function bootDivDemo(options) {
  const {
    canvas,
    source,
    clearColor = '#0b1117',
    virtualWidth,
    virtualHeight,
    debugDrawProcessBounds = false,
    debugProcessBoundsColor = '#00ffff',
    debugShowStats = false,
    debugStatsTextColor = '#e6fffb',
    debugStatsBgColor = 'rgba(6, 10, 18, 0.7)',
    debugStatsX = 8,
    debugStatsY = 8,
    preventDefaultKeys = true,
    preload = { images: [], audio: [] },
    loadingElement,
    errorElement,
    loadingText = 'Loading assets...',
    startingText = 'Starting VM...',
    showVirtualKeys = false,
    virtualKeysContainer,
    onLog,
    onFrame,
    onError
  } = options || {};

  const setLoading = (text) => {
    if (!loadingElement) return;
    loadingElement.textContent = text;
    loadingElement.classList.remove('hidden');
  };

  const hideLoading = () => {
    if (!loadingElement) return;
    loadingElement.classList.add('hidden');
  };

  const showError = (err) => {
    if (errorElement) {
      errorElement.textContent = err?.message || String(err);
      errorElement.classList.remove('hidden');
    }
    if (typeof onError === 'function') {
      onError(err);
    } else {
      console.error(err);
    }
  };

  setLoading(loadingText);

  try {
    await preloadAssets(preload);
    setLoading(startingText);

    const runner = runDivDemo({
      canvas,
      source,
      clearColor,
      autoStart: true,
      preventDefaultKeys,
      virtualWidth,
      virtualHeight,
      debugDrawProcessBounds,
      debugProcessBoundsColor,
      debugShowStats,
      debugStatsTextColor,
      debugStatsBgColor,
      debugStatsX,
      debugStatsY,
      onLog,
      onFrame,
      onError: showError
    });

    let uninstallKeys = () => {};
    if (showVirtualKeys) {
      uninstallKeys = installVirtualKeys({
        container: virtualKeysContainer,
        getRuntime: () => runner.getState().runtime
      });
    }

    hideLoading();

    return {
      runner,
      destroy() {
        uninstallKeys();
        runner.destroy();
      }
    };
  } catch (err) {
    showError(err);
    throw err;
  }
}
