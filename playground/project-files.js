/**
 * The playground's project files: the FPG, MAP, FNT, PNG... a program
 * loads by name (load_fpg("ship.fpg")). They are kept per program in
 * IndexedDB (localStorage is far too small for graphics), or only in
 * memory when the browser refuses IndexedDB (private windows, blocked
 * site data).
 */

import { parseDivFpgBuffer, parseDivMapBuffer, parseDivFntBuffer } from '../vm/div_formats.js';

const DB_NAME = 'divjs-playground';
const STORE = 'files';

function request(req)
{
  return new Promise((resolve, reject) =>
  {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function openDatabase()
{
  return new Promise((resolve, reject) =>
  {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () =>
    {
      const store = req.result.createObjectStore(STORE, { keyPath: ['programId', 'name'] });
      store.createIndex('programId', 'programId');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// { persistent, list(programId), put(programId, name, bytes),
//   remove(programId, name), replaceAll(programId, files) }
// Files are { name, bytes: Uint8Array }, listed in name order.
export async function openFileStore()
{
  let db = null;
  try
  {
    db = await openDatabase();
  }
  catch
  {
    db = null;
  }

  if (!db)
  {
    const memory = new Map();
    const bucket = (id) =>
    {
      if (!memory.has(id))
      {
        memory.set(id, new Map());
      }
      return memory.get(id);
    };
    return {
      persistent: false,
      list: async (id) => [...bucket(id).entries()].map(([name, bytes]) => ({ name, bytes })).sort((a, b) => a.name.localeCompare(b.name)),
      put: async (id, name, bytes) => { bucket(id).set(name, bytes); },
      remove: async (id, name) => { bucket(id).delete(name); },
      replaceAll: async (id, files) => { memory.set(id, new Map(files.map((f) => [f.name, f.bytes]))); }
    };
  }

  const store = (mode) => db.transaction(STORE, mode).objectStore(STORE);
  const done = (tx) => new Promise((resolve, reject) =>
  {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
  return {
    persistent: true,
    list: async (id) =>
    {
      const rows = await request(store('readonly').index('programId').getAll(id));
      return rows.map((row) => ({ name: row.name, bytes: new Uint8Array(row.bytes) })).sort((a, b) => a.name.localeCompare(b.name));
    },
    put: async (id, name, bytes) =>
    {
      await request(store('readwrite').put({ programId: id, name, bytes: bytes.slice().buffer }));
    },
    remove: async (id, name) =>
    {
      await request(store('readwrite').delete([id, name]));
    },
    replaceAll: async (id, files) =>
    {
      const tx = db.transaction(STORE, 'readwrite');
      const s = tx.objectStore(STORE);
      const keys = await request(s.index('programId').getAllKeys(id));
      for (const key of keys)
      {
        s.delete(key);
      }
      for (const file of files)
      {
        s.put({ programId: id, name: file.name, bytes: file.bytes.slice().buffer });
      }
      await done(tx);
    }
  };
}

// ── Files in a share link ───────────────────────────────────────────────
// One binary blob: for each file, u16 name length, UTF-8 name, u32 size,
// bytes (little-endian). The caller deflates it.

export function packFiles(files)
{
  const encoder = new TextEncoder();
  const names = files.map((f) => encoder.encode(f.name));
  const total = files.reduce((sum, f, i) => sum + 6 + names[i].length + f.bytes.length, 0);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  let at = 0;
  files.forEach((file, i) =>
  {
    view.setUint16(at, names[i].length, true);
    out.set(names[i], at + 2);
    at += 2 + names[i].length;
    view.setUint32(at, file.bytes.length, true);
    out.set(file.bytes, at + 4);
    at += 4 + file.bytes.length;
  });
  return out;
}

export function unpackFiles(bytes)
{
  const decoder = new TextDecoder();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const files = [];
  let at = 0;
  while (at < bytes.length)
  {
    const nameLength = view.getUint16(at, true);
    const name = decoder.decode(bytes.subarray(at + 2, at + 2 + nameLength));
    at += 2 + nameLength;
    const size = view.getUint32(at, true);
    if (at + 4 + size > bytes.length)
    {
      throw new Error('Truncated file data');
    }
    files.push({ name, bytes: bytes.slice(at + 4, at + 4 + size) });
    at += 4 + size;
  }
  return files;
}

// ── Describing a file ───────────────────────────────────────────────────

export function formatSize(bytes)
{
  if (bytes < 1024)
  {
    return `${bytes} B`;
  }
  return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// What the file is, as far as the engine can tell ("FPG, 63 graphics").
// Unknown or unreadable files get no details rather than an error.
export async function describeFile(name, bytes)
{
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  const buffer = bytes.slice().buffer;
  try
  {
    switch (ext)
    {
      case 'fpg':
      {
        const count = parseDivFpgBuffer(buffer).maps.length;
        return `FPG, ${count} graphic${count === 1 ? '' : 's'}`;
      }
      case 'map':
      {
        const map = parseDivMapBuffer(buffer);
        return `MAP, ${map.width}x${map.height}`;
      }
      case 'fnt':
      {
        const font = parseDivFntBuffer(buffer);
        const count = font.glyphs.filter(Boolean).length;
        return `FNT, ${count} character${count === 1 ? '' : 's'}`;
      }
      case 'png': case 'jpg': case 'jpeg': case 'gif': case 'webp': case 'bmp':
      {
        const image = await createImageBitmap(new Blob([bytes]));
        const size = `${image.width}x${image.height}`;
        image.close();
        return `${ext.toUpperCase()}, ${size}`;
      }
      default:
        return ext.toUpperCase();
    }
  }
  catch (err)
  {
    return `${ext.toUpperCase()}, not readable (${err.message || err})`;
  }
}
