/**
 * Online play for DIV programs: two players, peer to peer, no server.
 *
 * Transports
 *  - WebRTC data channel. The players find each other by exchanging two
 *    codes by hand (chat, e-mail...): the host's offer and the guest's
 *    answer, each a complete session description compressed into text.
 *    STUN servers (configurable) only help the browsers learn their
 *    public address; no game data goes through them.
 *  - BroadcastChannel, for two tabs of the same browser (testing, local
 *    play, the engine's own tests).
 *
 * Two ways to play
 *  - Messages: net_send(type, value) / net_receive(), for turn-based games
 *    or anything that syncs its own state.
 *  - Lockstep: after net_start(), every frame each side sends its keys and
 *    mouse, and a frame only runs when both players' input for it has
 *    arrived. Input is applied `delay` frames after it was read, hiding the
 *    network's latency. Both simulations then stay identical: the random
 *    seed is shared and the frame time fixed. Gameplay reads
 *    net_key(player, key) for both players; key() stays the local keyboard.
 *    Every 60 frames the sides compare a hash of their state and report a
 *    desync (status 4) if it differs.
 */

export const NET_IDLE = 0;
export const NET_CONNECTING = 1;
export const NET_CONNECTED = 2;
export const NET_CLOSED = 3;
export const NET_DESYNC = 4;

const CODE_PREFIX = 'DIVNET1.';
const HASH_EVERY = 60;
const DEFAULT_DELAY = 3;

// ── Codes: deflate-raw + base64url ──────────────────────────────────────

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
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

export async function encodeCode(value)
{
  const stream = new Blob([JSON.stringify(value)]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return CODE_PREFIX + bytesToBase64Url(new Uint8Array(await new Response(stream).arrayBuffer()));
}

export async function decodeCode(code)
{
  const text = String(code || '').trim();
  if (!text.startsWith(CODE_PREFIX))
  {
    throw new Error('That is not a DivJS connection code');
  }
  const bytes = base64UrlToBytes(text.slice(CODE_PREFIX.length));
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return JSON.parse(await new Response(stream).text());
}

// A hash of what a program's simulation is made of: every process's
// identity, position, angle and graphic, and every global. Two sides of a
// lockstep game must agree on it frame by frame.
export function hashState(vm)
{
  let h = 2166136261;
  const mix = (value) =>
  {
    const n = Math.round((Number(value) || 0) * 100) | 0;
    h = Math.imul(h ^ n, 16777619) >>> 0;
  };
  const processes = vm.processManager.getAll()
    .filter((p) => !p.isMouse && !p.dead && !p.finished)
    .sort((a, b) => a.id - b.id);
  for (const p of processes)
  {
    mix(p.id); mix(p.type); mix(p.x); mix(p.y); mix(p.angle); mix(p.graph); mix(p.size);
  }
  if (vm.globals && typeof vm.globals.forEach === 'function')
  {
    vm.globals.forEach((value, key) =>
    {
      if (typeof value === 'number')
      {
        mix(key); mix(value);
      }
    });
  }
  return h;
}

function emptyInput()
{
  return { down: new Set(), pressed: new Set(), mx: 0, my: 0, mb: 0 };
}

export class NetSession
{
  // ui: the page's code-exchange panel (see createNetPanel in divjs.js);
  // log: the program's log line function.
  constructor({ iceServers, ui = null, log = () => {} } = {})
  {
    this.iceServers = iceServers ?? [{ urls: 'stun:stun.l.google.com:19302' }];
    this.ui = ui;
    this.log = log;
    if (ui)
    {
      // The player closed the panel before the connection was made.
      ui.onCancel = () =>
      {
        if (this.status === NET_CONNECTING)
        {
          this.close();
          this.status = NET_CLOSED;
          this.log('[net] connection cancelled');
        }
      };
    }
    this.status = NET_IDLE;
    this.me = 0;
    this.transport = null;
    this.pc = null;
    this.inbox = [];
    this.current = null;
    this.resetLockstep();
  }

  resetLockstep()
  {
    this.lock = {
      active: false,
      pendingStart: null,
      delay: DEFAULT_DELAY,
      frame: 0,
      sentFor: -1,
      inputs: [new Map(), new Map()],
      cur: [emptyInput(), emptyInput()],
      hashes: [new Map(), new Map()]
    };
  }

  get players()
  {
    return this.status === NET_CONNECTED || this.status === NET_DESYNC ? 2 : 1;
  }

  // ── Connecting ────────────────────────────────────────────────────────

  send(message)
  {
    if (this.transport)
    {
      this.transport.send(message);
    }
  }

  connected(transport)
  {
    this.transport = transport;
    this.status = NET_CONNECTED;
    this.log(`[net] connected as player ${this.me + 1}`);
    if (this.ui)
    {
      this.ui.close();
    }
  }

  closed(reason)
  {
    if (this.status === NET_CONNECTED || this.status === NET_DESYNC || this.status === NET_CONNECTING)
    {
      this.status = NET_CLOSED;
      this.log(`[net] connection closed${reason ? ': ' + reason : ''}`);
    }
  }

  // Two tabs of one browser, on a named room.
  hostLocal(room)
  {
    return this.openLocal(room, 0);
  }

  joinLocal(room)
  {
    return this.openLocal(room, 1);
  }

  openLocal(room, me)
  {
    this.close();
    this.me = me;
    this.status = NET_CONNECTING;
    const channel = new BroadcastChannel(`divjs-net:${room}`);
    const self = `${Math.random()}`;
    let peer = null;
    let helloTimer = 0;
    const transport = {
      send: (message) => channel.postMessage({ from: self, to: peer, message }),
      close: () =>
      {
        clearInterval(helloTimer);
        channel.postMessage({ from: self, to: peer, bye: true });
        channel.close();
      }
    };
    channel.onmessage = (event) =>
    {
      const data = event.data || {};
      if (data.from === self)
      {
        return;
      }
      if (data.hello && me === 0 && !peer)
      {
        peer = data.from;
        channel.postMessage({ from: self, to: peer, welcome: true });
        this.connected(transport);
        return;
      }
      if (data.welcome && me === 1 && !peer && data.to === self)
      {
        peer = data.from;
        clearInterval(helloTimer);
        this.connected(transport);
        return;
      }
      if (data.to !== self || data.from !== peer)
      {
        return;
      }
      if (data.bye)
      {
        this.closed('the other player left');
        return;
      }
      this.receive(data.message);
    };
    if (me === 1)
    {
      const hello = () => channel.postMessage({ from: self, hello: true });
      hello();
      helloTimer = setInterval(hello, 300);
    }
    this.localChannel = transport;
    return 1;
  }

  // WebRTC: the host makes an offer code for the guest and waits for the
  // guest's answer code.
  async hostWebRtc()
  {
    this.close();
    this.me = 0;
    this.status = NET_CONNECTING;
    try
    {
      const pc = this.newPeerConnection();
      this.useChannel(pc.createDataChannel('divjs', { ordered: true }));
      await pc.setLocalDescription(await pc.createOffer());
      await this.iceGathered(pc);
      const code = await encodeCode({ t: 'offer', sdp: pc.localDescription.sdp });
      if (this.pc !== pc)
      {
        return;                        // closed (net_close) while gathering
      }
      if (!this.ui)
      {
        throw new Error('no connection panel on this page');
      }
      this.ui.showHost(code, async (answerCode) =>
      {
        const answer = await decodeCode(answerCode);
        if (answer.t !== 'answer')
        {
          throw new Error('That code is an invitation, not an answer');
        }
        await pc.setRemoteDescription({ type: 'answer', sdp: answer.sdp });
      });
    }
    catch (err)
    {
      if (this.status === NET_CONNECTING)
      {
        this.fail(err);
      }
    }
  }

  // WebRTC: the guest pastes the host's code and sends back an answer code.
  async joinWebRtc()
  {
    this.close();
    this.me = 1;
    this.status = NET_CONNECTING;
    if (!this.ui)
    {
      this.fail(new Error('no connection panel on this page'));
      return;
    }
    this.ui.askJoin(async (offerCode) =>
    {
      const offer = await decodeCode(offerCode);
      if (offer.t !== 'offer')
      {
        throw new Error('That code is an answer, not an invitation');
      }
      if (this.pc)
      {
        this.pc.close();               // an earlier attempt with another code
      }
      const pc = this.newPeerConnection();
      pc.ondatachannel = (event) => this.useChannel(event.channel);
      await pc.setRemoteDescription({ type: 'offer', sdp: offer.sdp });
      await pc.setLocalDescription(await pc.createAnswer());
      await this.iceGathered(pc);
      if (this.pc !== pc)
      {
        throw new Error('The connection was closed');
      }
      return encodeCode({ t: 'answer', sdp: pc.localDescription.sdp });
    });
  }

  newPeerConnection()
  {
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    pc.onconnectionstatechange = () =>
    {
      // Only the current connection: an abandoned attempt closing is news
      // to nobody.
      if (this.pc === pc && (pc.connectionState === 'failed' || pc.connectionState === 'closed'))
      {
        this.closed(`connection ${pc.connectionState}`);
      }
    };
    this.pc = pc;
    return pc;
  }

  // The codes carry every candidate address, so wait for gathering to end
  // (or give up after a few seconds and send what there is).
  iceGathered(pc)
  {
    if (pc.iceGatheringState === 'complete')
    {
      return Promise.resolve();
    }
    return new Promise((resolve) =>
    {
      const done = () =>
      {
        if (pc.iceGatheringState === 'complete')
        {
          pc.removeEventListener('icegatheringstatechange', done);
          resolve();
        }
      };
      pc.addEventListener('icegatheringstatechange', done);
      setTimeout(resolve, 4000);
    });
  }

  useChannel(channel)
  {
    channel.onopen = () => this.connected({
      send: (message) =>
      {
        if (channel.readyState === 'open')
        {
          channel.send(JSON.stringify(message));
        }
      },
      close: () => channel.close()
    });
    channel.onclose = () => this.closed('the other player left');
    channel.onmessage = (event) =>
    {
      try
      {
        this.receive(JSON.parse(event.data));
      }
      catch
      {
        // Not ours: ignore.
      }
    };
  }

  fail(err)
  {
    this.status = NET_CLOSED;
    this.log(`[warn] net: ${err?.message || err}`);
    if (this.ui)
    {
      this.ui.error(String(err?.message || err));
    }
  }

  close()
  {
    if (this.transport)
    {
      this.transport.close();
    }
    else if (this.localChannel)
    {
      this.localChannel.close();
    }
    if (this.pc)
    {
      this.pc.close();
    }
    if (this.ui)
    {
      this.ui.close();
    }
    this.transport = null;
    this.localChannel = null;
    this.pc = null;
    this.status = NET_IDLE;
    this.inbox = [];
    this.current = null;
    this.resetLockstep();
  }

  // ── Incoming ──────────────────────────────────────────────────────────

  receive(message)
  {
    if (!message || typeof message !== 'object')
    {
      return;
    }
    const other = 1 - this.me;
    switch (message.t)
    {
      case 'msg':
        this.inbox.push({ from: other, type: message.type, value: message.value });
        break;
      case 'start':
        this.lock.pendingStart = { seed: message.seed >>> 0, delay: message.delay };
        break;
      case 'in':
        this.lock.inputs[other].set(message.f, {
          down: new Set(message.d),
          pressed: new Set(message.p),
          mx: message.mx,
          my: message.my,
          mb: message.mb
        });
        break;
      case 'hash':
        this.lock.hashes[other].set(message.f, message.h);
        this.checkHash(message.f);
        break;
      default:
        break;
    }
  }

  // ── Messages ──────────────────────────────────────────────────────────

  sendMessage(type, value)
  {
    if (this.players < 2)
    {
      return 0;
    }
    this.send({ t: 'msg', type, value: typeof value === 'string' ? value : Number(value) || 0 });
    return 1;
  }

  // Takes the next message into `current` (read with net_msg_*): 1, or 0
  // when there is none.
  nextMessage()
  {
    this.current = this.inbox.shift() || null;
    return this.current ? 1 : 0;
  }

  // ── Lockstep ──────────────────────────────────────────────────────────

  // The host picks the seed and the delay; both sides start on their next
  // frame after the host's message.
  start(delay)
  {
    if (this.players < 2 || this.lock.active || this.lock.pendingStart)
    {
      return 0;
    }
    if (this.me === 0)
    {
      const seed = (Math.random() * 0x100000000) >>> 0;
      const d = Math.max(1, Math.min(15, Math.round(Number(delay) || DEFAULT_DELAY)));
      this.send({ t: 'start', seed, delay: d });
      this.lock.pendingStart = { seed, delay: d };
    }
    return 1;
  }

  get running()
  {
    return this.lock.active;
  }

  // Called before each frame. Returns false while the other player's input
  // for this frame has not arrived (the frame must wait).
  beforeFrame(runtime)
  {
    const lock = this.lock;
    if (lock.pendingStart && !lock.active)
    {
      // The queues are kept: the side that started first may already
      // have sent its input (and hashes) for the first frames, and
      // dropping them would leave this side waiting for them forever.
      const { seed, delay } = lock.pendingStart;
      lock.pendingStart = null;
      lock.active = true;
      lock.delay = delay || DEFAULT_DELAY;
      lock.frame = 0;
      lock.sentFor = -1;
      runtime.randomSeed = seed >>> 0;
      this.log(`[net] lockstep started (input delay ${lock.delay} frames)`);
    }
    if (!lock.active)
    {
      return true;
    }
    // Read this side's input once per frame, for frame + delay.
    const target = lock.frame + lock.delay;
    if (lock.sentFor < target)
    {
      const input = runtime.captureNetInput();
      lock.inputs[this.me].set(target, input);
      this.send({
        t: 'in', f: target, d: [...input.down], p: [...input.pressed], mx: input.mx, my: input.my, mb: input.mb
      });
      lock.sentFor = target;
    }
    const connected = this.status === NET_CONNECTED || this.status === NET_DESYNC;
    const inputFor = (player) =>
    {
      if (lock.frame < lock.delay)
      {
        return emptyInput();
      }
      return lock.inputs[player].get(lock.frame) || null;
    };
    const mine = inputFor(this.me);
    let theirs = inputFor(1 - this.me);
    if (!theirs)
    {
      if (connected)
      {
        return false;                  // wait for the other player
      }
      theirs = emptyInput();           // they left: carry on without them
    }
    lock.cur[this.me] = mine || emptyInput();
    lock.cur[1 - this.me] = theirs;
    lock.inputs[0].delete(lock.frame);
    lock.inputs[1].delete(lock.frame);
    return true;
  }

  // Called after each frame that ran.
  afterFrame(vm)
  {
    const lock = this.lock;
    if (!lock.active)
    {
      return;
    }
    if (lock.frame % HASH_EVERY === 0 && lock.frame > 0)
    {
      const h = hashState(vm);
      lock.hashes[this.me].set(lock.frame, h);
      this.send({ t: 'hash', f: lock.frame, h });
      this.checkHash(lock.frame);
    }
    lock.frame++;
  }

  checkHash(frame)
  {
    const mine = this.lock.hashes[this.me].get(frame);
    const theirs = this.lock.hashes[1 - this.me].get(frame);
    if (mine === undefined || theirs === undefined)
    {
      return;
    }
    this.lock.hashes[0].delete(frame);
    this.lock.hashes[1].delete(frame);
    if (mine !== theirs && this.status !== NET_DESYNC)
    {
      this.status = NET_DESYNC;
      this.log(`[warn] net: the two games went out of step at frame ${frame} (something in the game reads key(), the clock or unseeded randomness instead of the shared input)`);
    }
  }

  input(player)
  {
    return this.lock.cur[Number(player) === 1 ? 1 : 0];
  }
}
