// On-screen touch controls and gamepads.
//
// Both turn into the same key presses a keyboard makes (runtime.setKeyState),
// so key(), key_pressed(), net_key() and online lockstep see no difference.
// runDivDemo creates them (see its touchControls / touchLayout / gamepad
// options); a program changes the layout with touch_pad, touch_buttons,
// touch_menu and touch_controls (see docs/natives.md).
//
// A layout:
//   {
//     pad: 'dpad' | 'stick' | 'none',          left side, 8 directions
//     padKeys: 'up,down,left,right',           the keys the pad presses
//     buttons: 'z:A,x:B' or [{ key, label }],  up to 6 on the right
//     menu: 'enter:Start,esc:Back' or [...]    up to 2 small ones
//   }
// Missing fields take the default layout's; false or 'none' is no overlay.

import { CanvasEngineRuntime } from './runtime.js';

export const MAX_TOUCH_BUTTONS = 6;
export const MAX_TOUCH_MENU = 2;

export const DEFAULT_TOUCH_LAYOUT = Object.freeze({
  pad: 'dpad',
  padKeys: ['up', 'down', 'left', 'right'],
  buttons: [{ key: 'z', label: 'A' }, { key: 'x', label: 'B' }],
  menu: [{ key: 'enter', label: 'Start' }]
});

// Gamepad face buttons (A, B, X, Y) press these when the layout has fewer
// buttons.
export const DEFAULT_GAMEPAD_KEYS = ['z', 'x', 'c', 'space'];

// "z:A, x:B, space" -> [{ key: 'z', label: 'A' }, { key: 'x', label: 'B' },
// { key: 'space', label: 'SPACE' }]. Arrays of { key, label } (or plain key
// names) pass through. Keys use the names of the key constants without
// the underscore: z, space, enter, esc, ctrl, left, 1...
export function parseKeyList(list, max)
{
  let items = [];
  if (Array.isArray(list))
  {
    items = list.map((item) => (typeof item === 'string' ? { key: item } : { key: item?.key, label: item?.label }));
  }
  else if (list !== null && list !== undefined && list !== false)
  {
    items = String(list).split(',').map((part) =>
    {
      const colon = part.indexOf(':');
      return colon < 0 ? { key: part } : { key: part.slice(0, colon), label: part.slice(colon + 1) };
    });
  }
  const out = [];
  for (const item of items)
  {
    const key = String(item.key ?? '').trim().toLowerCase().replace(/^_/, '');
    if (!key)
    {
      continue;
    }
    const label = String(item.label ?? '').trim() || key.toUpperCase();
    out.push({ key, label });
    if (out.length >= max)
    {
      break;
    }
  }
  return out;
}

function parsePadKeys(keys)
{
  const list = Array.isArray(keys) ? keys : String(keys ?? '').split(',');
  const clean = list.map((k) => String(k ?? '').trim().toLowerCase().replace(/^_/, ''));
  return clean.length === 4 && clean.every(Boolean) ? clean : [...DEFAULT_TOUCH_LAYOUT.padKeys];
}

function parsePad(pad)
{
  const kind = String(pad ?? 'dpad').toLowerCase();
  if (kind === 'stick' || kind === '2')
  {
    return 'stick';
  }
  if (kind === 'none' || kind === '0' || kind === 'false')
  {
    return 'none';
  }
  return 'dpad';
}

// A full layout from a partial one (see the top of this file), or null for
// "no overlay".
export function normalizeTouchLayout(layout)
{
  if (layout === false || layout === 'none' || layout === 0)
  {
    return null;
  }
  const src = layout && typeof layout === 'object' ? layout : {};
  const has = (name) => Object.prototype.hasOwnProperty.call(src, name);
  return {
    pad: parsePad(has('pad') ? src.pad : DEFAULT_TOUCH_LAYOUT.pad),
    padKeys: parsePadKeys(has('padKeys') ? src.padKeys : DEFAULT_TOUCH_LAYOUT.padKeys),
    buttons: parseKeyList(has('buttons') ? src.buttons : DEFAULT_TOUCH_LAYOUT.buttons, MAX_TOUCH_BUTTONS),
    menu: parseKeyList(has('menu') ? src.menu : DEFAULT_TOUCH_LAYOUT.menu, MAX_TOUCH_MENU)
  };
}

// The directions a pad offset points to, 8 ways: nothing inside the dead
// zone, then 45-degree sectors (a direction counts when it is within 67.5
// degrees of the offset). Returns [up, down, left, right] as booleans.
export function padDirections(dx, dy, radius, deadZone = 0.28)
{
  const len = Math.hypot(dx, dy);
  if (!(radius > 0) || len < radius * deadZone)
  {
    return [false, false, false, false];
  }
  const t = Math.sin(Math.PI / 8) * len;
  return [dy < -t, dy > t, dx < -t, dx > t];
}

// Keys held by the controls and gamepads, counted, so two fingers (or a
// finger and a gamepad) on the same key release it only when both let go.
// Presses go to whatever runtime getRuntime() returns now; reapply() hands
// the held ones to a new runtime after a restart.
export class VirtualKeys
{
  constructor(getRuntime)
  {
    this.getRuntime = getRuntime;
    this.counts = new Map();
  }

  press(name)
  {
    const key = CanvasEngineRuntime.canonicalKeyName(name);
    const count = this.counts.get(key) || 0;
    this.counts.set(key, count + 1);
    if (count === 0)
    {
      this.getRuntime()?.setKeyState(key, true);
    }
  }

  release(name)
  {
    const key = CanvasEngineRuntime.canonicalKeyName(name);
    const count = this.counts.get(key) || 0;
    if (count <= 1)
    {
      this.counts.delete(key);
      this.getRuntime()?.setKeyState(key, false);
    }
    else
    {
      this.counts.set(key, count - 1);
    }
  }

  reapply()
  {
    const runtime = this.getRuntime();
    for (const key of this.counts.keys())
    {
      runtime?.setKeyState(key, true);
    }
  }
}

// Replaces the keys a source holds with `next`: presses the new ones and
// releases the ones it no longer holds.
function holdKeys(keys, held, next)
{
  for (const key of held)
  {
    if (!next.has(key))
    {
      keys.release(key);
    }
  }
  for (const key of next)
  {
    if (!held.has(key))
    {
      keys.press(key);
    }
  }
  return next;
}

// True for elements that consume typed keys themselves.
function isEditable(target)
{
  if (!target || !target.tagName)
  {
    return false;
  }
  const tag = String(target.tagName).toUpperCase();
  return target.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

// Primary pointer is a finger (phones, tablets).
export function coarsePointer(win = typeof window !== 'undefined' ? window : null)
{
  try
  {
    return !!win?.matchMedia?.('(pointer: coarse)').matches;
  }
  catch
  {
    return false;
  }
}

const FACE = 'rgba(255,255,255,0.13)';
const FACE_DOWN = 'rgba(255,255,255,0.42)';
const EDGE = '2px solid rgba(255,255,255,0.38)';
const INK = 'rgba(255,255,255,0.85)';

// The overlay: a pad on the left and the buttons on the right, over the
// bottom corners of `area` (the canvas, or a larger element around it),
// drawn as DOM above the page. Only its own elements take touches, so a
// finger anywhere else on the canvas is still the mouse.
//
// mode: 'auto' shows it from the first touch on the page until a key is
// typed on a keyboard (or a gamepad is used); true shows it always.
export class TouchControls
{
  constructor({ canvas, area = null, keys, mode = 'auto', layout, doc = document })
  {
    this.doc = doc;
    this.win = doc.defaultView;
    this.canvas = canvas;
    this.area = area || canvas;
    this.keys = keys;
    this.mode = mode === true ? 'on' : 'auto';
    this.baseLayout = normalizeTouchLayout(layout);
    this.layout = this.baseLayout;
    this.layoutKey = '';
    this.enabled = true;
    this.running = false;
    this.touchSeen = false;
    this.active = this.mode === 'on';
    this.fingers = new Map();
    this.placedFor = '';
    this.root = null;
    this.pad = null;
    this.knob = null;
    this.arms = [];
    this.buttonEls = [];
    this.listeners = [];

    this.listen(this.win, 'pointerdown', (e) =>
    {
      if (e.pointerType === 'touch')
      {
        this.touched();
      }
    }, true);
    this.listen(this.win, 'touchstart', () => this.touched(), { capture: true, passive: true });
    this.listen(this.win, 'keydown', (e) =>
    {
      if (!isEditable(e.target))
      {
        this.otherInput();
      }
    }, true);
    this.listen(this.win, 'resize', () => this.update());
    this.listen(this.win, 'orientationchange', () => this.update());
    this.listen(doc, 'fullscreenchange', () =>
    {
      this.placedFor = '';
      this.update();
    });
  }

  listen(target, type, handler, options)
  {
    if (target && typeof target.addEventListener === 'function')
    {
      target.addEventListener(type, handler, options);
      this.listeners.push({ target, type, handler, options });
    }
  }

  touched()
  {
    this.touchSeen = true;
    if (this.mode === 'auto' && !this.active)
    {
      this.active = true;
      this.update();
    }
  }

  // A keyboard key or a gamepad: the player has something better than
  // thumbs on glass.
  otherInput()
  {
    if (this.mode === 'auto' && this.active)
    {
      this.active = false;
      this.update();
    }
  }

  isTouch()
  {
    return this.touchSeen || coarsePointer(this.win);
  }

  isShown()
  {
    return !!(this.root && this.root.style.display !== 'none');
  }

  // The runDivDemo-level layout (options.touchLayout / runner.setTouchLayout):
  // what every run starts from.
  setBaseLayout(layout)
  {
    this.baseLayout = normalizeTouchLayout(layout);
    this.setLayout(this.baseLayout);
  }

  setLayout(layout)
  {
    const key = JSON.stringify(layout);
    if (key === this.layoutKey && (this.root || !layout))
    {
      return;
    }
    this.releaseAll();
    this.layout = layout;
    this.layoutKey = key;
    this.build();
    this.update();
  }

  // A program's touch_* call: changes one part of the current layout.
  patchLayout(patch)
  {
    const base = this.layout || normalizeTouchLayout({ pad: 'none', buttons: [], menu: [] });
    this.setLayout(normalizeTouchLayout({ ...base, ...patch }));
  }

  // touch_controls(): 0 hides the overlay, 1 is the 'auto' behaviour, 2
  // shows it even without a touch.
  setEnabled(state)
  {
    const n = Number(state) || 0;
    this.enabled = n > 0;
    if (n >= 2)
    {
      this.active = true;
    }
    this.update();
  }

  // Each run starts from the base layout, enabled.
  reset()
  {
    this.enabled = true;
    this.setLayout(this.baseLayout);
  }

  setRunning(running)
  {
    this.running = running;
    this.update();
  }

  wanted()
  {
    return !!(this.layout && this.enabled && this.active && this.running);
  }

  build()
  {
    if (this.root)
    {
      this.root.remove();
      this.root = null;
    }
    this.pad = null;
    this.knob = null;
    this.arms = [];
    this.buttonEls = [];
    this.placedFor = '';
    if (!this.layout)
    {
      return;
    }
    const doc = this.doc;
    const el = (css, parent) =>
    {
      const node = doc.createElement('div');
      node.style.cssText = css;
      parent?.appendChild(node);
      return node;
    };
    const root = el('position:fixed;left:0;top:0;width:0;height:0;z-index:2147482000;pointer-events:none;'
      + 'user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;touch-action:none;display:none;'
      + 'font:600 16px system-ui,sans-serif;-webkit-tap-highlight-color:transparent');
    root.setAttribute('data-divjs-touch', '');
    const touchable = 'position:absolute;pointer-events:auto;touch-action:none;box-sizing:border-box;';

    if (this.layout.pad !== 'none')
    {
      this.pad = el(`${touchable}border-radius:50%;background:${FACE};border:${EDGE}`, root);
      this.pad.setAttribute('data-touch-pad', this.layout.pad);
      if (this.layout.pad === 'stick')
      {
        this.knob = el(`position:absolute;border-radius:50%;background:${FACE_DOWN};border:${EDGE};box-sizing:border-box`, this.pad);
      }
      else
      {
        // up, down, left, right
        for (let i = 0; i < 4; i++)
        {
          this.arms.push(el(`position:absolute;border-radius:6px;background:${FACE}`, this.pad));
        }
      }
    }
    const addButton = (item, kind) =>
    {
      const node = el(`${touchable}display:flex;align-items:center;justify-content:center;color:${INK};`
        + `background:${FACE};border:${EDGE};white-space:nowrap;overflow:hidden`, root);
      node.textContent = item.label;
      node.setAttribute('data-touch-key', item.key);
      node.setAttribute('data-touch-kind', kind);
      this.buttonEls.push({ node, key: item.key, kind });
    };
    this.layout.buttons.forEach((item) => addButton(item, 'button'));
    this.layout.menu.forEach((item) => addButton(item, 'menu'));

    const stop = (e) =>
    {
      e.preventDefault();
      e.stopPropagation();
    };
    root.addEventListener('pointerdown', (e) =>
    {
      stop(e);
      this.fingerDown(e);
    });
    root.addEventListener('pointermove', (e) =>
    {
      if (this.fingers.has(e.pointerId))
      {
        stop(e);
        this.fingerMove(e);
      }
    });
    const up = (e) =>
    {
      if (this.fingers.has(e.pointerId))
      {
        this.fingerUp(e.pointerId);
      }
    };
    root.addEventListener('pointerup', up);
    root.addEventListener('pointercancel', up);
    root.addEventListener('lostpointercapture', up);
    root.addEventListener('contextmenu', stop);
    this.root = root;
  }

  // Where to put the overlay: inside the full-screen element when the game
  // is in it (nothing else is drawn then), else in the page's body.
  host()
  {
    const fs = this.doc.fullscreenElement;
    if (fs && fs !== this.doc.documentElement && fs.contains(this.canvas))
    {
      return fs;
    }
    return this.doc.body;
  }

  // Shows, hides and places the overlay. Called on every frame (cheap when
  // nothing moved) and on resizes.
  update()
  {
    if (!this.root)
    {
      return;
    }
    if (!this.wanted())
    {
      if (this.root.style.display !== 'none')
      {
        this.root.style.display = 'none';
        this.releaseAll();
      }
      return;
    }
    const host = this.host();
    if (host && this.root.parentNode !== host)
    {
      host.appendChild(this.root);
    }
    const r = this.area.getBoundingClientRect();
    const vw = this.win.innerWidth;
    const vh = this.win.innerHeight;
    const left = Math.max(0, r.left);
    const top = Math.max(0, r.top);
    const w = Math.min(vw, r.right) - left;
    const h = Math.min(vh, r.bottom) - top;
    if (w < 40 || h < 40)
    {
      this.root.style.display = 'none';
      this.releaseAll();
      return;
    }
    this.root.style.display = 'block';
    const c = this.canvas.getBoundingClientRect();
    const at = `${left},${top},${w},${h},${vw},${vh},${c.left},${c.top},${c.width},${c.height}`;
    if (at !== this.placedFor)
    {
      this.placedFor = at;
      this.place(left, top, w, h, vw, vh);
    }
  }

  // The notch and the home bar, from CSS env(): only where the area
  // reaches the screen's edges.
  safeInsets()
  {
    const probe = this.doc.createElement('div');
    probe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;'
      + 'padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)';
    this.doc.body.appendChild(probe);
    const cs = this.win.getComputedStyle(probe);
    const insets = {
      top: parseFloat(cs.paddingTop) || 0,
      right: parseFloat(cs.paddingRight) || 0,
      bottom: parseFloat(cs.paddingBottom) || 0,
      left: parseFloat(cs.paddingLeft) || 0
    };
    probe.remove();
    return insets;
  }

  place(left, top, w, h, vw, vh)
  {
    const root = this.root;
    root.style.left = `${left}px`;
    root.style.top = `${top}px`;
    root.style.width = `${w}px`;
    root.style.height = `${h}px`;
    const safe = this.safeInsets();
    const insL = Math.max(0, safe.left - left);
    const insR = Math.max(0, safe.right - (vw - left - w));
    const insT = Math.max(0, safe.top - top);
    const insB = Math.max(0, safe.bottom - (vh - top - h));
    const margin = 12;
    const gap = 12;

    // The free bands the game leaves in the area (a panel wider or taller
    // than the scaled canvas): the controls go there when they fit, and
    // over the game's corners when they don't.
    const c = this.canvas.getBoundingClientRect();
    const bandL = Math.max(0, Math.min(w, c.left - left));
    const bandR = Math.max(0, Math.min(w, left + w - c.right));
    const bandB = Math.max(0, Math.min(h, top + h - c.bottom));
    const bottom = margin + insB;

    const buttons = this.buttonEls.filter((b) => b.kind === 'button');
    const menu = this.buttonEls.filter((b) => b.kind === 'menu');
    const n = buttons.length;

    // The pad: about a thumb's reach, less when a side band is narrower.
    let pad = 0;
    if (this.pad)
    {
      pad = Math.max(100, Math.min(170, 0.4 * Math.min(w, h)));
      if (bandB < pad + 2 * margin && bandL > 0)
      {
        pad = Math.max(120, Math.min(pad, bandL - 2 * margin - insL));
      }
    }

    // The buttons: the grid shape (1 to 3 columns) that gives the biggest
    // buttons in the space beside the pad or in the right-hand band.
    const regionW = bandB < 120 && bandR >= 2 * margin + 44 ? bandR - 2 * margin - insR : w - pad - 3 * margin - insL - insR;
    // (Under the game, room is kept for the small buttons too.)
    const menuRoom = menu.length ? 38 : 0;
    const regionH = bandB >= 44 + 2 * margin ? bandB - 2 * margin - insB - menuRoom : h - 2 * margin - insT - insB;
    let btn = 0;
    let cols = 1;
    for (let k = Math.min(n, 3); k >= 1; k--)
    {
      const r = Math.ceil(n / k);
      const lifted = k === 2 && r === 1 ? 0.45 : 0;
      const size = Math.min(76, (regionW - (k - 1) * gap) / k, (regionH - (r - 1) * gap) / (r + lifted));
      if (size > btn * 1.1)
      {
        btn = size;
        cols = k;
      }
    }
    btn = Math.max(44, btn);
    const rows = n ? Math.ceil(n / cols) : 0;
    // Two buttons side by side sit on a diagonal, the second higher (A/B
    // on a console).
    const lift = cols === 2 && rows === 1 ? btn * 0.45 : 0;
    const clusterW = n ? cols * btn + (cols - 1) * gap : 0;
    const clusterH = n ? rows * btn + (rows - 1) * gap + lift : 0;

    if (this.pad)
    {
      Object.assign(this.pad.style, {
        width: `${pad}px`, height: `${pad}px`, left: `${margin + insL}px`, top: `${h - bottom - pad}px`
      });
      if (this.knob)
      {
        const k = pad * 0.44;
        Object.assign(this.knob.style, { width: `${k}px`, height: `${k}px`, left: `${(pad - k) / 2 - 2}px`, top: `${(pad - k) / 2 - 2}px` });
      }
      const arm = pad * 0.3;
      const len = pad * 0.36;
      const mid = (pad - arm) / 2 - 2;
      const edge = pad * 0.07;
      const spots = [[mid, edge, arm, len], [mid, pad - edge - len - 4, arm, len], [edge, mid, len, arm], [pad - edge - len - 4, mid, len, arm]];
      this.arms.forEach((node, i) =>
      {
        const [x, y, aw, ah] = spots[i];
        Object.assign(node.style, { left: `${x}px`, top: `${y}px`, width: `${aw}px`, height: `${ah}px` });
      });
    }

    // Buttons in reading order, the grid's bottom-right corner in the
    // area's bottom-right corner.
    const gridLeft = w - margin - insR - clusterW;
    const gridTop = h - bottom - clusterH;
    buttons.forEach((b, i) =>
    {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const y = gridTop + lift + row * (btn + gap) - (lift && col === 1 ? lift : 0);
      Object.assign(b.node.style, {
        width: `${btn}px`, height: `${btn}px`, borderRadius: '50%',
        left: `${gridLeft + col * (btn + gap)}px`, top: `${y}px`,
        fontSize: `${Math.round(Math.max(10, Math.min(btn * 0.36, btn * 1.25 / Math.max(1, b.node.textContent.length))))}px`
      });
    });

    // The small buttons: in the band under the game, or at the top of the
    // right-hand band, or between the pad and the buttons, or above them.
    const mw = 70;
    const mh = 30;
    const count = menu.length;
    const rowW = count * mw + (count - 1) * 10;
    const controlsTop = h - bottom - Math.max(pad, clusterH);
    const gameBottom = c.bottom - top;
    const spots = [];
    if (count && controlsTop - gameBottom >= mh + 8 && gameBottom > 0)
    {
      const y = gameBottom + (controlsTop - gameBottom - mh) / 2;
      menu.forEach((b, i) => spots.push([(w - rowW) / 2 + i * (mw + 10), y]));
    }
    else if (count && bandR >= mw + 2 * margin + insR && gridTop - margin - insT >= count * (mh + 8))
    {
      menu.forEach((b, i) => spots.push([w - margin - insR - mw - (bandR - mw - 2 * margin - insR) / 2, margin + insT + i * (mh + 8)]));
    }
    else
    {
      const freeLeft = this.pad ? margin + insL + pad + 8 : 8;
      const freeRight = n ? gridLeft - 8 : w - 8;
      const y = freeRight - freeLeft >= rowW ? h - bottom - mh : controlsTop - mh - 12;
      menu.forEach((b, i) => spots.push([(w - rowW) / 2 + i * (mw + 10), Math.max(0, y)]));
    }
    menu.forEach((b, i) =>
    {
      Object.assign(b.node.style, {
        width: `${mw}px`, height: `${mh}px`, borderRadius: `${mh / 2}px`,
        left: `${spots[i][0]}px`, top: `${spots[i][1]}px`, fontSize: '13px'
      });
    });
    this.paint();
  }

  // The button under a point, or null: the nearest whose (slightly
  // enlarged) shape holds it, so a finger sliding across passes from one
  // to the next.
  buttonAt(x, y)
  {
    let best = null;
    let bestDist = Infinity;
    for (const b of this.buttonEls)
    {
      const r = b.node.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const d = b.kind === 'button'
        ? Math.hypot(x - cx, y - cy) - r.width * 0.6
        : Math.max(Math.abs(x - cx) - r.width / 2, Math.abs(y - cy) - r.height / 2) - 6;
      if (d <= 0 && d < bestDist)
      {
        best = b;
        bestDist = d;
      }
    }
    return best;
  }

  fingerDown(e)
  {
    // The overlay's own taps also count as touch use.
    if (e.pointerType === 'touch')
    {
      this.touchSeen = true;
    }
    try
    {
      e.target.setPointerCapture(e.pointerId);
    }
    catch
    {
      // an untrusted (synthetic) event has no active pointer
    }
    if (this.pad && this.pad.contains(e.target))
    {
      // One finger works the pad: a new one takes it over.
      for (const [id, finger] of this.fingers)
      {
        if (finger.kind === 'pad')
        {
          this.fingerUp(id);
        }
      }
      this.fingers.set(e.pointerId, { kind: 'pad', held: new Set() });
    }
    else
    {
      this.fingers.set(e.pointerId, { kind: 'button', held: new Set() });
    }
    this.fingerMove(e);
  }

  fingerMove(e)
  {
    const finger = this.fingers.get(e.pointerId);
    const next = new Set();
    if (finger.kind === 'pad')
    {
      const r = this.pad.getBoundingClientRect();
      const radius = r.width / 2;
      const dx = e.clientX - (r.left + radius);
      const dy = e.clientY - (r.top + radius);
      padDirections(dx, dy, radius).forEach((on, i) =>
      {
        if (on)
        {
          next.add(this.layout.padKeys[i]);
        }
      });
      finger.dx = dx;
      finger.dy = dy;
    }
    else
    {
      const b = this.buttonAt(e.clientX, e.clientY);
      if (b)
      {
        next.add(b.key);
      }
    }
    finger.held = holdKeys(this.keys, finger.held, next);
    this.paint();
  }

  fingerUp(id)
  {
    const finger = this.fingers.get(id);
    this.fingers.delete(id);
    holdKeys(this.keys, finger.held, new Set());
    this.paint();
  }

  releaseAll()
  {
    for (const id of [...this.fingers.keys()])
    {
      this.fingerUp(id);
    }
  }

  // Pressed looks pressed.
  paint()
  {
    const held = new Set();
    let padFinger = null;
    for (const finger of this.fingers.values())
    {
      finger.held.forEach((k) => held.add(k));
      if (finger.kind === 'pad')
      {
        padFinger = finger;
      }
    }
    for (const b of this.buttonEls)
    {
      b.node.style.background = held.has(b.key) ? FACE_DOWN : FACE;
    }
    if (this.layout && this.arms.length)
    {
      this.arms.forEach((node, i) =>
      {
        node.style.background = padFinger && padFinger.held.has(this.layout.padKeys[i]) ? FACE_DOWN : FACE;
      });
    }
    if (this.knob)
    {
      let x = 0;
      let y = 0;
      if (padFinger)
      {
        const max = this.pad.getBoundingClientRect().width * 0.3;
        const len = Math.hypot(padFinger.dx, padFinger.dy) || 1;
        const k = Math.min(1, max / len);
        x = padFinger.dx * k;
        y = padFinger.dy * k;
      }
      this.knob.style.transform = `translate(${x}px,${y}px)`;
    }
  }

  dispose()
  {
    this.releaseAll();
    for (const { target, type, handler, options } of this.listeners)
    {
      target.removeEventListener(type, handler, options);
    }
    this.listeners = [];
    if (this.root)
    {
      this.root.remove();
      this.root = null;
    }
  }
}

// Standard-mapping gamepads (Xbox, PlayStation and most others in the
// browser): the d-pad and the left stick press the pad's keys, A B X Y and
// the shoulder buttons the layout's buttons in order, Start and Back/Select
// its menu keys (Enter and Esc by default). Read once per frame with poll().
export class GamepadInput
{
  constructor({ keys, getLayout, onUse = null, nav = typeof navigator !== 'undefined' ? navigator : null })
  {
    this.keys = keys;
    this.getLayout = getLayout;
    this.onUse = onUse;
    this.nav = nav;
    // gamepad index -> keys it holds
    this.held = new Map();
  }

  keysFor(pad)
  {
    const layout = this.getLayout() || DEFAULT_TOUCH_LAYOUT;
    const [up, down, left, right] = layout.padKeys || DEFAULT_TOUCH_LAYOUT.padKeys;
    const actions = (layout.buttons || []).map((b) => b.key);
    const menu = (layout.menu || []).map((b) => b.key);
    const next = new Set();
    const pressed = (i) =>
    {
      const b = pad.buttons?.[i];
      return !!b && (b.pressed || b.value > 0.5);
    };
    const standard = pad.mapping === 'standard';
    const ax = Number(pad.axes?.[0]) || 0;
    const ay = Number(pad.axes?.[1]) || 0;
    const [su, sd, sl, sr] = padDirections(ax, ay, 1, 0.4);
    if ((standard && pressed(12)) || su)
    {
      next.add(up);
    }
    if ((standard && pressed(13)) || sd)
    {
      next.add(down);
    }
    if ((standard && pressed(14)) || sl)
    {
      next.add(left);
    }
    if ((standard && pressed(15)) || sr)
    {
      next.add(right);
    }
    // A, B, X, Y, LB, RB
    for (let i = 0; i < 6; i++)
    {
      const key = actions[i] || DEFAULT_GAMEPAD_KEYS[i];
      if (key && pressed(i))
      {
        next.add(key);
      }
    }
    if (pressed(9))
    {
      next.add(menu[0] || 'enter');
    }
    if (pressed(8))
    {
      next.add(menu[1] || 'escape');
    }
    return next;
  }

  poll()
  {
    let pads = [];
    try
    {
      pads = typeof this.nav?.getGamepads === 'function' ? Array.from(this.nav.getGamepads() || []) : [];
    }
    catch
    {
      pads = [];
    }
    const seen = new Set();
    let used = false;
    for (const pad of pads)
    {
      if (!pad || pad.connected === false)
      {
        continue;
      }
      seen.add(pad.index);
      const before = this.held.get(pad.index) || new Set();
      const next = this.keysFor(pad);
      if (next.size > 0 && [...next].some((k) => !before.has(k)))
      {
        used = true;
      }
      this.held.set(pad.index, holdKeys(this.keys, before, next));
    }
    // Unplugged: nothing it held stays down.
    for (const [index, keys] of this.held)
    {
      if (!seen.has(index))
      {
        holdKeys(this.keys, keys, new Set());
        this.held.delete(index);
      }
    }
    if (used && typeof this.onUse === 'function')
    {
      this.onUse();
    }
  }

  releaseAll()
  {
    for (const keys of this.held.values())
    {
      holdKeys(this.keys, keys, new Set());
    }
    this.held.clear();
  }
}
