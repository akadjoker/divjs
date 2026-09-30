// Small persistent data for games (save_data/load_data, DIV's save/load):
// the browser's localStorage when the page may use it, otherwise (Node,
// tests, a browser that blocks storage) a map in memory that lasts as
// long as the page or process. Every access is guarded: storage can be
// missing, blocked or full, and then the natives return 0.

// Longest text one saved value (or one save() block) may take once
// encoded, well under the browser's few megabytes for the whole site.
export const MAX_SAVED_CHARS = 65536;

const memory = new Map();
const memoryStore = {
  getItem: (key) => (memory.has(key) ? memory.get(key) : null),
  setItem: (key, value) => { memory.set(key, String(value)); },
  removeItem: (key) => { memory.delete(key); }
};

let backend = null;

export function storageBackend()
{
  if (backend)
  {
    return backend;
  }
  backend = memoryStore;
  try
  {
    const ls = globalThis.localStorage;
    if (ls)
    {
      const probe = '__divjs_probe__';
      ls.setItem(probe, '1');
      ls.removeItem(probe);
      backend = ls;
    }
  }
  catch
  {
    // No usable localStorage: keep the in-memory store.
  }
  return backend;
}

// For tests: forget the chosen backend (and the in-memory data).
export function resetStorageBackend(store = null)
{
  backend = store;
  memory.clear();
}

// A value that can be saved: a number or a string.
export function isSavable(value)
{
  return (typeof value === 'number' && Number.isFinite(value)) || typeof value === 'string';
}

export function storageWrite(key, value)
{
  let text;
  try
  {
    text = JSON.stringify(value);
  }
  catch
  {
    return false;
  }
  if (text.length > MAX_SAVED_CHARS)
  {
    return false;
  }
  try
  {
    storageBackend().setItem(key, text);
    return true;
  }
  catch
  {
    return false;
  }
}

// The stored value, or undefined when there is none (or it can't be read).
export function storageRead(key)
{
  try
  {
    const text = storageBackend().getItem(key);
    return text === null || text === undefined ? undefined : JSON.parse(text);
  }
  catch
  {
    return undefined;
  }
}

export function storageRemove(key)
{
  try
  {
    const store = storageBackend();
    const had = store.getItem(key) !== null;
    store.removeItem(key);
    return had;
  }
  catch
  {
    return false;
  }
}
