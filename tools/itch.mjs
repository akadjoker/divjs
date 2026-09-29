// Builds the itch.io uploads of the games that have a page in itch/:
// dist/itch/<game>/<game>-html5.zip holds the exported game as index.html
// (the same single file as the playground's Export), and the game's GIF
// from docs/media is copied next to it.
//
//   node tools/itch.mjs            every game with an itch/<game>.md
//   node tools/itch.mjs fighter    one game

import { readFileSync, readdirSync, mkdirSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync, strToU8 } from 'fflate';
import { collectEngineModules, buildPackedHtml } from './packer.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(ROOT, 'playground/programs/manifest.json'), 'utf-8'));
const pages = readdirSync(join(ROOT, 'itch')).filter((f) => f.endsWith('.md') && f !== 'README.md').map((f) => f.slice(0, -3));
const wanted = process.argv.slice(2);
const ids = wanted.length > 0 ? wanted : pages;

const modules = await collectEngineModules((path) => readFileSync(join(ROOT, path), 'utf-8'));

for (const id of ids)
{
  const entry = manifest.programs.find((p) => p.id === id);
  if (!entry)
  {
    console.error(`${id}: not in playground/programs/manifest.json`);
    process.exitCode = 1;
    continue;
  }
  if (!pages.includes(id))
  {
    console.warn(`${id}: no itch/${id}.md page text yet`);
  }
  // Titles in the page file win over the playground's (which may carry a
  // "(Street Fighter style)" hint).
  const pageFile = join(ROOT, 'itch', `${id}.md`);
  const heading = existsSync(pageFile) ? /^# (.+)$/m.exec(readFileSync(pageFile, 'utf-8')) : null;
  const html = buildPackedHtml({
    modules,
    source: readFileSync(join(ROOT, 'playground/programs', entry.file), 'utf-8'),
    title: heading ? heading[1] : entry.title,
    width: entry.width,
    height: entry.height,
    clearColor: entry.clearColor
  });
  const outDir = join(ROOT, 'dist/itch', id);
  mkdirSync(outDir, { recursive: true });
  const zip = zipSync({ 'index.html': strToU8(html) }, { level: 9 });
  writeFileSync(join(outDir, `${id}-html5.zip`), zip);
  const gif = join(ROOT, 'docs/media', `${id}.gif`);
  if (existsSync(gif))
  {
    copyFileSync(gif, join(outDir, `${id}.gif`));
  }
  console.log(`${id}: ${(zip.length / 1024).toFixed(0)} KB zip (${entry.width}x${entry.height})${existsSync(gif) ? ', gif' : ', no gif'}`);
}
