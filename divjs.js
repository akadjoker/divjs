import { Lexer } from './compiler/tokenizer.js';
import { Parser } from './parser/parser.js';
import { Compiler } from './compiler/compiler.js';
import { VM } from './vm/vm.js';
import { CanvasEngineRuntime } from './vm/runtime.js';

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
    height
  } = options || {};

  const canvasEl = resolveCanvas(canvas);
  const screenCtx = canvasEl.getContext('2d');

  if (width) {
    canvasEl.width = Number(width) || canvasEl.width;
  }
  if (height) {
    canvasEl.height = Number(height) || canvasEl.height;
  }

  const useVirtualScreen = Number.isFinite(Number(virtualWidth)) && Number.isFinite(Number(virtualHeight));
  const runtimeCanvas = useVirtualScreen ? document.createElement('canvas') : canvasEl;
  const runtimeCtx = useVirtualScreen ? runtimeCanvas.getContext('2d') : screenCtx;

  if (useVirtualScreen) {
    runtimeCanvas.width = Math.max(1, Number(virtualWidth));
    runtimeCanvas.height = Math.max(1, Number(virtualHeight));
    screenCtx.imageSmoothingEnabled = false;
  }

  let vm = null;
  let runtime = null;
  let running = false;
  let rafId = 0;
  let lastTs = 0;
  let currentSource = String(source || '');

  const handleKeyDown = (event) => {
    if (preventDefaultKeys) {
      const blockedKeys = new Set([
        'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
        ' ', 'Spacebar', 'Space',
        'PageUp', 'PageDown', 'Home', 'End'
      ]);
      if (blockedKeys.has(event.key)) {
        event.preventDefault();
      }
    }

    if (runtime) {
      runtime.setKeyState(event.key, true);
    }
  };

  const handleKeyUp = (event) => {
    if (runtime) {
      runtime.setKeyState(event.key, false);
    }
  };

  const handleBlur = () => {
    if (runtime) {
      runtime.clearKeyState();
    }
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

  const loop = (timestamp) => {
    if (!running) {
      return;
    }

    const dt = lastTs === 0 ? (1 / 60) : (timestamp - lastTs) / 1000;
    lastTs = timestamp;

    runtime.beginFrame(dt);

    try {
      vm.tick();
      runtime.render();

      if (useVirtualScreen) {
        screenCtx.fillStyle = clearColor;
        screenCtx.fillRect(0, 0, canvasEl.width, canvasEl.height);
        screenCtx.drawImage(runtimeCanvas, 0, 0, canvasEl.width, canvasEl.height);
      }

      if (typeof onFrame === 'function') {
        onFrame({ vm, runtime, dt });
      }
    } catch (err) {
      running = false;
      emitError(err);
      return;
    }

    rafId = requestAnimationFrame(loop);
  };

  const start = (nextSource) => {
    if (nextSource !== undefined) {
      currentSource = String(nextSource);
    }

    if (!currentSource.trim()) {
      emitError(new Error('Empty source'));
      return;
    }

    try {
      const bytecode = compileSource(currentSource);
      vm = new VM();
      vm.load(bytecode);

      runtime = new CanvasEngineRuntime({
        vm,
        ctx: runtimeCtx,
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
        logFn: (line) => {
          if (typeof onLog === 'function') {
            onLog(line);
          }
        }
      });
      runtime.registerNatives();

      running = true;
      lastTs = 0;
      rafId = requestAnimationFrame(loop);
    } catch (err) {
      emitError(err);
    }
  };

  const stop = () => {
    running = false;
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
  };

  const destroy = () => {
    stop();
    window.removeEventListener('keydown', handleKeyDown);
    window.removeEventListener('keyup', handleKeyUp);
    window.removeEventListener('blur', handleBlur);
    vm = null;
    runtime = null;
  };

  const setSource = (nextSource) => {
    currentSource = String(nextSource || '');
  };

  const getState = () => ({
    running,
    vm,
    runtime,
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
