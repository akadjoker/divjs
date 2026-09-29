/**
 * Sound for DIV programs (Web Audio).
 *
 *  - Sounds: loaded files (load_wav / load_pcm: whatever the browser
 *    decodes - WAV, OGG, MP3) or effects synthesised here from a recipe
 *    (sfx / sfx_tone: coins, lasers, explosions... no file needed).
 *    sound() plays one on a new channel.
 *  - Music: a small step sequencer. A song has a tempo and tracks; a track
 *    is an instrument and a line of notes ("C4 . E4 - G4 ."), one step per
 *    sixteenth note, and the tracks loop under the longest one.
 *
 * Browsers only let a page make sound after the player has interacted
 * with it (a click or a key): until then sounds are skipped and a song
 * waits, and it starts as soon as the page is allowed to play.
 * Sound is output only: it never changes the simulation, so it is safe in
 * online lockstep games.
 */

export const SAMPLE_RATE = 44100;

export const WAVE_SQUARE = 0;
export const WAVE_TRIANGLE = 1;
export const WAVE_SAW = 2;
export const WAVE_SINE = 3;
export const WAVE_NOISE = 4;

export const SFX_COIN = 0;
export const SFX_LASER = 1;
export const SFX_EXPLOSION = 2;
export const SFX_POWERUP = 3;
export const SFX_HIT = 4;
export const SFX_JUMP = 5;
export const SFX_BLIP = 6;
export const SFX_RANDOM = 7;

export const INST_SQUARE = 0;
export const INST_TRIANGLE = 1;
export const INST_SAW = 2;
export const INST_SINE = 3;
export const INST_DRUMS = 4;
export const INST_PLUCK = 5;
export const INST_PAD = 6;
export const INST_BASS = 7;

const STEPS_PER_BEAT = 4;           // one step = a sixteenth note
const LOOKAHEAD = 0.12;             // seconds of music scheduled ahead
const SCHEDULE_EVERY_MS = 25;

// ── Synthesis ───────────────────────────────────────────────────────────

// Small seeded generator: the same recipe and seed always make the same
// sound.
function makeRandom(seed)
{
  let a = (Number(seed) >>> 0) || 0x9e3779b9;
  return () =>
  {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * One synthesised sound as mono samples at SAMPLE_RATE.
 *  wave: WAVE_*; freq -> freqEnd (Hz) slides over the length;
 *  ms: length; volume 0-1; attackMs; arpAt (0-1 of the length) and arpMul:
 *  the pitch jumps by arpMul there (coins); vibDepth (0-1) and vibHz;
 *  lowpass / lowpassEnd: a filter cutoff in Hz sliding over the length
 *  (0 = none); seed: for noise.
 */
export function synthesize(recipe)
{
  const {
    wave = WAVE_SQUARE, freq = 440, freqEnd = freq, ms = 200, volume = 0.5, attackMs = 4,
    arpAt = 0, arpMul = 1, vibDepth = 0, vibHz = 0, lowpass = 0, lowpassEnd = lowpass, seed = 1
  } = recipe;
  const length = Math.max(1, Math.round(SAMPLE_RATE * Math.max(5, ms) / 1000));
  const out = new Float32Array(length);
  const attack = Math.max(1, Math.round(SAMPLE_RATE * attackMs / 1000));
  const random = makeRandom(seed);
  let phase = 0;
  let noiseValue = random() * 2 - 1;
  let filtered = 0;
  for (let i = 0; i < length; i++)
  {
    const t = i / length;
    let f = freq + (freqEnd - freq) * t;
    if (arpAt > 0 && t >= arpAt)
    {
      f *= arpMul;
    }
    if (vibDepth > 0)
    {
      f *= 1 + vibDepth * Math.sin(2 * Math.PI * vibHz * i / SAMPLE_RATE);
    }
    phase += Math.max(1, f) / SAMPLE_RATE;
    if (phase >= 1)
    {
      phase -= Math.floor(phase);
      noiseValue = random() * 2 - 1;     // noise: a new value every period
    }
    let s;
    switch (wave)
    {
      case WAVE_TRIANGLE: s = 1 - 4 * Math.abs(phase - 0.5); break;
      case WAVE_SAW: s = 2 * phase - 1; break;
      case WAVE_SINE: s = Math.sin(2 * Math.PI * phase); break;
      case WAVE_NOISE: s = noiseValue; break;
      default: s = phase < 0.5 ? 0.6 : -0.6; break;   // square, a little quieter
    }
    if (lowpass > 0)
    {
      const cutoff = lowpass + (lowpassEnd - lowpass) * t;
      const a = 1 - Math.exp(-2 * Math.PI * Math.max(20, cutoff) / SAMPLE_RATE);
      filtered += a * (s - filtered);
      s = filtered;
    }
    const env = i < attack ? i / attack : (1 - t) * (1 - t);
    out[i] = s * env * volume;
  }
  return out;
}

// The recipe of one of the ready-made effects, varied by seed.
export function sfxRecipe(kind, seed = 0)
{
  const r = makeRandom((Number(seed) || 0) * 7919 + (Number(kind) || 0) + 1);
  const vary = (value, amount) => value * (1 + (r() * 2 - 1) * amount);
  switch (Number(kind))
  {
    case SFX_COIN:
      return { wave: WAVE_SQUARE, freq: vary(990, 0.2), ms: vary(260, 0.2), arpAt: 0.22, arpMul: 1.5, volume: 0.45 };
    case SFX_LASER:
      return { wave: r() < 0.5 ? WAVE_SAW : WAVE_SQUARE, freq: vary(1300, 0.3), freqEnd: vary(180, 0.3), ms: vary(170, 0.3), volume: 0.4 };
    case SFX_EXPLOSION:
      return { wave: WAVE_NOISE, freq: vary(900, 0.3), freqEnd: vary(60, 0.3), ms: vary(700, 0.3), lowpass: 5000, lowpassEnd: 200, volume: 0.9, seed: r() * 1e9 };
    case SFX_POWERUP:
      return { wave: WAVE_SQUARE, freq: vary(350, 0.2), freqEnd: vary(1300, 0.2), ms: vary(420, 0.2), vibDepth: 0.06, vibHz: 18, volume: 0.4 };
    case SFX_HIT:
      return { wave: WAVE_NOISE, freq: vary(1600, 0.3), freqEnd: vary(200, 0.3), ms: vary(130, 0.3), lowpass: 3000, volume: 0.7, seed: r() * 1e9 };
    case SFX_JUMP:
      return { wave: WAVE_SQUARE, freq: vary(260, 0.2), freqEnd: vary(720, 0.2), ms: vary(190, 0.2), volume: 0.4 };
    case SFX_BLIP:
      return { wave: WAVE_SQUARE, freq: vary(880, 0.25), ms: vary(60, 0.2), volume: 0.35 };
    default:
    {
      const wave = Math.floor(r() * 5);
      return {
        wave, freq: 100 + r() * 1500, freqEnd: 100 + r() * 1500, ms: 60 + r() * 500,
        arpAt: r() < 0.3 ? 0.3 : 0, arpMul: 1 + r(), vibDepth: r() < 0.3 ? r() * 0.2 : 0, vibHz: 5 + r() * 20,
        lowpass: wave === WAVE_NOISE ? 4000 : 0, lowpassEnd: 300, volume: 0.45, seed: r() * 1e9
      };
    }
  }
}

// ── Notes ───────────────────────────────────────────────────────────────

const NOTE_INDEX = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

// "C4", "C#4", "Eb3" -> Hz (A4 = 440); null for anything else.
export function noteFrequency(token)
{
  const m = /^([a-g])([#b]?)(-?\d)$/i.exec(String(token));
  if (!m)
  {
    return null;
  }
  let semitone = NOTE_INDEX[m[1].toLowerCase()];
  if (m[2] === '#')
  {
    semitone += 1;
  }
  else if (m[2] === 'b')
  {
    semitone -= 1;
  }
  const midi = 12 * (Number(m[3]) + 1) + semitone;
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/**
 * A track's line of notes, one token per step (separated by spaces or |):
 *  a note (C4, F#3, Bb2) starts it, `-` holds the previous note one more
 *  step, `.` is silence. For drums the tokens are made of k (kick),
 *  s (snare) and h (hi-hat), e.g. `k . h . s . h .` or `kh`.
 * Returns [{ step, length, freq | drums }] and the number of steps.
 */
export function parseNotes(text, drums = false)
{
  const tokens = String(text || '').split(/[\s|]+/).filter((t) => t.length > 0);
  const events = [];
  let last = null;
  tokens.forEach((token, step) =>
  {
    if (token === '-')
    {
      if (last)
      {
        last.length++;
      }
      return;
    }
    last = null;
    if (token === '.')
    {
      return;
    }
    if (drums)
    {
      const hits = [...token.toLowerCase()].filter((c) => c === 'k' || c === 's' || c === 'h');
      if (hits.length > 0)
      {
        events.push({ step, length: 1, drums: hits });
      }
      return;
    }
    const freq = noteFrequency(token);
    if (freq !== null)
    {
      last = { step, length: 1, freq };
      events.push(last);
    }
  });
  return { events, steps: tokens.length };
}

// ── The engine ──────────────────────────────────────────────────────────

let sharedContext = null;

function audioContextClass()
{
  return typeof window !== 'undefined' ? (window.AudioContext || window.webkitAudioContext || null) : null;
}

export class AudioEngine
{
  constructor({ log = () => {} } = {})
  {
    this.log = log;
    this.available = !!audioContextClass();
    this.sounds = new Map();         // id -> { buffer, samples, ready, error }
    this.nextSoundId = 1;
    this.sfxCache = new Map();       // recipe key -> sound id
    this.channels = new Map();       // channel -> { source, gain, soundId, ended }
    this.nextChannel = 1;
    this.songs = new Map();          // id -> { bpm, tracks: [{ inst, events, steps, volume }] }
    this.nextSongId = 1;
    this.song = null;                // { id, loop, step, nextTime, length, nodes }
    this.soundVolume = 1;
    this.musicVolume = 0.6;
    this.timer = 0;
    this.master = null;
    this.musicBus = null;
    this.stats = { played: 0, skipped: 0, notes: 0 };
    this.drumBuffers = null;
    this.decoder = null;
  }

  // The page-wide AudioContext (browsers limit how many a page may have),
  // with this engine's own output under it.
  context()
  {
    if (!this.available)
    {
      return null;
    }
    if (!sharedContext)
    {
      const Ctx = audioContextClass();
      sharedContext = new Ctx();
    }
    if (!this.master)
    {
      this.master = sharedContext.createGain();
      this.master.gain.value = this.soundVolume;
      this.master.connect(sharedContext.destination);
      this.musicBus = sharedContext.createGain();
      this.musicBus.gain.value = this.musicVolume;
      this.musicBus.connect(sharedContext.destination);
    }
    return sharedContext;
  }

  // True once the browser lets the page play.
  get running()
  {
    return !!sharedContext && sharedContext.state === 'running';
  }

  // Called on the player's clicks and key presses (the host page and the
  // runtime install the listeners): lets sound start.
  unlock()
  {
    const ctx = this.context();
    if (ctx && ctx.state !== 'running')
    {
      ctx.resume().then(() => this.startPendingSong()).catch(() => {});
    }
    else
    {
      this.startPendingSong();
    }
  }

  // ── Sounds ────────────────────────────────────────────────────────────

  addSamples(samples)
  {
    const id = this.nextSoundId++;
    this.sounds.set(id, { samples, buffer: null, ready: true, error: null });
    return id;
  }

  // A recipe (see synthesize) -> sound id. The same recipe gives the same
  // id: calling sfx() for every shot does not make a new sound each time.
  makeSound(recipe)
  {
    const key = JSON.stringify(recipe);
    let id = this.sfxCache.get(key);
    if (id === undefined)
    {
      id = this.addSamples(synthesize(recipe));
      this.sfxCache.set(key, id);
    }
    return id;
  }

  // Loads and decodes a sound file. Returns [id, promise].
  load(url)
  {
    const id = this.nextSoundId++;
    const entry = { samples: null, buffer: null, ready: false, error: null };
    this.sounds.set(id, entry);
    if (!this.available)
    {
      entry.error = 'no Web Audio in this browser';
      return [id, Promise.resolve()];
    }
    const promise = fetch(url)
      .then((response) =>
      {
        if (!response.ok)
        {
          throw new Error(`HTTP ${response.status}`);
        }
        return response.arrayBuffer();
      })
      .then((bytes) => this.decode(bytes))
      .then((buffer) =>
      {
        entry.buffer = buffer;
        entry.ready = true;
      })
      .catch((err) =>
      {
        entry.error = err?.message || String(err);
        this.log(`[warn] load_wav failed (${url}): ${entry.error}`);
      });
    return [id, promise];
  }

  // Decoding needs a context but not the player's permission to play: an
  // OfflineAudioContext does it before the first click.
  decode(bytes)
  {
    if (!this.decoder)
    {
      const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      this.decoder = new Offline(1, 1, SAMPLE_RATE);
    }
    return this.decoder.decodeAudioData(bytes);
  }

  bufferOf(entry)
  {
    if (!entry.buffer && entry.samples)
    {
      entry.buffer = new AudioBuffer({ length: entry.samples.length, numberOfChannels: 1, sampleRate: SAMPLE_RATE });
      entry.buffer.copyToChannel(entry.samples, 0);
    }
    return entry.buffer;
  }

  // Plays sound `id`: volume 1 = as recorded, rate 1 = normal speed and
  // pitch, pan -1 left .. 1 right. Returns the channel (0 if there is no
  // such sound). Skipped (but still given a channel) while the browser
  // does not yet allow sound, or while a file is still loading.
  play(id, volume = 1, rate = 1, pan = 0)
  {
    const entry = this.sounds.get(Number(id));
    if (!entry)
    {
      return 0;
    }
    const channel = this.nextChannel++;
    const record = { source: null, gain: null, panner: null, soundId: Number(id), ended: true };
    this.channels.set(channel, record);
    const ctx = this.context();
    if (!ctx || ctx.state !== 'running' || !entry.ready || entry.error)
    {
      this.stats.skipped++;
      this.pruneChannels();
      return channel;
    }
    const source = ctx.createBufferSource();
    source.buffer = this.bufferOf(entry);
    source.playbackRate.value = Math.max(0.05, Math.min(16, rate));
    const gain = ctx.createGain();
    gain.gain.value = Math.max(0, volume);
    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan));
    source.connect(gain).connect(panner).connect(this.master);
    record.source = source;
    record.gain = gain;
    record.panner = panner;
    record.ended = false;
    source.onended = () =>
    {
      record.ended = true;
    };
    source.start();
    this.stats.played++;
    this.pruneChannels();
    return channel;
  }

  // Forget finished channels once there are many (a program may play a
  // sound every frame for hours).
  pruneChannels()
  {
    if (this.channels.size < 256)
    {
      return;
    }
    for (const [channel, record] of this.channels)
    {
      if (record.ended)
      {
        this.channels.delete(channel);
      }
    }
  }

  isPlaying(channel)
  {
    const record = this.channels.get(Number(channel));
    return record && !record.ended ? 1 : 0;
  }

  change(channel, volume, rate, pan)
  {
    const record = this.channels.get(Number(channel));
    if (!record || record.ended)
    {
      return 0;
    }
    if (volume !== undefined)
    {
      record.gain.gain.value = Math.max(0, volume);
    }
    if (rate !== undefined)
    {
      record.source.playbackRate.value = Math.max(0.05, Math.min(16, rate));
    }
    if (pan !== undefined)
    {
      record.panner.pan.value = Math.max(-1, Math.min(1, pan));
    }
    return 1;
  }

  // Stops a channel, or every channel when `channel` is 0.
  stop(channel)
  {
    const stopOne = (record) =>
    {
      if (record && !record.ended && record.source)
      {
        try
        {
          record.source.stop();
        }
        catch
        {
          // already stopped
        }
        record.ended = true;
      }
    };
    if (!Number(channel))
    {
      this.channels.forEach(stopOne);
      return 1;
    }
    const record = this.channels.get(Number(channel));
    stopOne(record);
    return record ? 1 : 0;
  }

  setSoundVolume(value)
  {
    this.soundVolume = Math.max(0, Math.min(1, value));
    if (this.master)
    {
      this.master.gain.value = this.soundVolume;
    }
  }

  setMusicVolume(value)
  {
    this.musicVolume = Math.max(0, Math.min(1, value));
    if (this.musicBus)
    {
      this.musicBus.gain.value = this.musicVolume;
    }
  }

  // ── Music ─────────────────────────────────────────────────────────────

  newSong(bpm)
  {
    const id = this.nextSongId++;
    this.songs.set(id, { bpm: Math.max(20, Math.min(400, Number(bpm) || 120)), tracks: [] });
    return id;
  }

  addTrack(songId, instrument, notes, volume = 0.6)
  {
    const song = this.songs.get(Number(songId));
    if (!song)
    {
      return 0;
    }
    const inst = Number(instrument) || 0;
    const parsed = parseNotes(notes, inst === INST_DRUMS);
    if (parsed.steps === 0)
    {
      return 0;
    }
    song.tracks.push({ inst, events: parsed.events, steps: parsed.steps, volume: Math.max(0, Math.min(1, volume)) });
    return song.tracks.length;
  }

  // Starts a song (stopping the one playing). It waits for the browser's
  // permission to play when it does not have it yet.
  playSong(songId, loop = true)
  {
    const song = this.songs.get(Number(songId));
    if (!song || song.tracks.length === 0)
    {
      return 0;
    }
    this.stopSong();
    const length = Math.max(...song.tracks.map((t) => t.steps));
    this.song = { id: Number(songId), def: song, loop: !!loop, step: 0, nextTime: 0, length, nodes: new Set(), started: false };
    this.startPendingSong();
    return 1;
  }

  startPendingSong()
  {
    const s = this.song;
    const ctx = this.running ? sharedContext : null;
    if (!s || s.started || !ctx)
    {
      return;
    }
    this.context();
    s.started = true;
    s.nextTime = ctx.currentTime + 0.05;
    this.schedule();
    this.timer = setInterval(() => this.schedule(), SCHEDULE_EVERY_MS);
  }

  stopSong()
  {
    if (this.timer)
    {
      clearInterval(this.timer);
      this.timer = 0;
    }
    if (this.song)
    {
      for (const node of this.song.nodes)
      {
        try
        {
          node.stop();
        }
        catch
        {
          // already stopped
        }
      }
      this.song = null;
    }
  }

  get songPlaying()
  {
    return this.song ? this.song.id : 0;
  }

  // Schedules every step that starts within the lookahead.
  schedule()
  {
    const s = this.song;
    const ctx = sharedContext;
    if (!s || !ctx)
    {
      return;
    }
    const stepTime = 60 / s.def.bpm / STEPS_PER_BEAT;
    while (s.nextTime < ctx.currentTime + LOOKAHEAD)
    {
      if (s.step >= s.length)
      {
        if (!s.loop)
        {
          clearInterval(this.timer);
          this.timer = 0;
          const nodes = s.nodes;
          setTimeout(() => nodes.clear(), 2000);
          this.song = null;
          return;
        }
        s.step = 0;
      }
      for (const track of s.def.tracks)
      {
        const local = s.step % track.steps;
        for (const event of track.events)
        {
          if (event.step === local)
          {
            this.playNote(track, event, s.nextTime, stepTime);
          }
        }
      }
      s.step++;
      s.nextTime += stepTime;
    }
  }

  playNote(track, event, when, stepTime)
  {
    const ctx = sharedContext;
    const s = this.song;
    const length = event.length * stepTime;
    const remember = (node) =>
    {
      s.nodes.add(node);
      node.onended = () => s.nodes.delete(node);
    };
    this.stats.notes++;
    if (track.inst === INST_DRUMS)
    {
      const drums = this.drums();
      for (const hit of event.drums)
      {
        const source = ctx.createBufferSource();
        source.buffer = drums[hit];
        const gain = ctx.createGain();
        gain.gain.value = track.volume;
        source.connect(gain).connect(this.musicBus);
        source.start(when);
        remember(source);
      }
      return;
    }
    const types = {
      [INST_SQUARE]: 'square', [INST_TRIANGLE]: 'triangle', [INST_SAW]: 'sawtooth', [INST_SINE]: 'sine',
      [INST_PLUCK]: 'square', [INST_PAD]: 'sawtooth', [INST_BASS]: 'triangle'
    };
    const osc = ctx.createOscillator();
    osc.type = types[track.inst] || 'square';
    osc.frequency.value = track.inst === INST_BASS ? event.freq / 2 : event.freq;
    const gain = ctx.createGain();
    const peak = track.volume * (osc.type === 'square' || osc.type === 'sawtooth' ? 0.18 : 0.35);
    const g = gain.gain;
    g.setValueAtTime(0, when);
    let end;
    if (track.inst === INST_PLUCK)
    {
      g.linearRampToValueAtTime(peak, when + 0.005);
      g.exponentialRampToValueAtTime(0.0001, when + Math.min(length, 0.35));
      end = when + Math.min(length, 0.35);
    }
    else if (track.inst === INST_PAD)
    {
      g.linearRampToValueAtTime(peak * 0.7, when + Math.min(0.3, length * 0.5));
      g.setValueAtTime(peak * 0.7, when + length * 0.8);
      g.linearRampToValueAtTime(0, when + length);
      end = when + length;
    }
    else
    {
      g.linearRampToValueAtTime(peak, when + 0.01);
      g.setValueAtTime(peak, when + Math.max(0.01, length - 0.03));
      g.linearRampToValueAtTime(0, when + length);
      end = when + length;
    }
    let out = gain;
    if (track.inst === INST_PAD)
    {
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 1400;
      gain.connect(filter);
      out = filter;
    }
    osc.connect(gain);
    out.connect(this.musicBus);
    osc.start(when);
    osc.stop(end + 0.02);
    remember(osc);
  }

  drums()
  {
    if (!this.drumBuffers)
    {
      const toBuffer = (samples) =>
      {
        const buffer = new AudioBuffer({ length: samples.length, numberOfChannels: 1, sampleRate: SAMPLE_RATE });
        buffer.copyToChannel(samples, 0);
        return buffer;
      };
      this.drumBuffers = {
        k: toBuffer(synthesize({ wave: WAVE_SINE, freq: 150, freqEnd: 40, ms: 220, volume: 0.9, attackMs: 1 })),
        s: toBuffer(synthesize({ wave: WAVE_NOISE, freq: 6000, ms: 160, lowpass: 7000, lowpassEnd: 2500, volume: 0.5, attackMs: 1, seed: 7 })),
        h: toBuffer(synthesize({ wave: WAVE_NOISE, freq: 12000, ms: 45, volume: 0.22, attackMs: 1, seed: 3 }))
      };
    }
    return this.drumBuffers;
  }

  // Everything stops; the shared context stays for the next program.
  dispose()
  {
    this.stopSong();
    this.stop(0);
    if (this.master)
    {
      this.master.disconnect();
      this.musicBus.disconnect();
      this.master = null;
      this.musicBus = null;
    }
  }
}
