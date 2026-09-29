#!/usr/bin/env node
/**
 * Packs a DIV program into one self-contained .html page (engine, program
 * and its files), the same page the playground's Export button makes.
 *
 *   node tools/pack.mjs game.div [-o game.html] [--base dir] [--assets dir]... [--file path]...
 *                      [--title "My game"] [--width 640 --height 480] [--clear-color "#000"]
 *                      [--no-auto] [--no-credit]
 *
 * Files: every string passed to load_graphic/load_tile/load_map/load_fpg/
 * load_fnt/load_bdf_font is looked up relative to --base (default: the
 * .div file's folder) and embedded under that same name (turn off with
 * --no-auto). The playground's programs load paths relative to the
 * playground page: pack them with --base playground. --assets adds every file
 * of a folder by its path inside the folder, --file adds one file by its
 * name; use them for paths the program builds at run time.
 */

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve, basename, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectEngineModules, buildPackedHtml, findAssetReferences } from './packer.js';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function usage(message)
{
  if (message)
  {
    console.error(`pack: ${message}`);
  }
  console.error('usage: node tools/pack.mjs game.div [-o game.html] [--base dir] [--assets dir]... [--file path]... [--title T] [--width W --height H] [--clear-color C] [--no-auto] [--no-credit]');
  process.exit(message ? 1 : 0);
}

function parseArgs(argv)
{
  const args = { input: null, output: null, assets: [], files: [], auto: true, credit: true };
  for (let i = 0; i < argv.length; i++)
  {
    const arg = argv[i];
    const value = () =>
    {
      if (i + 1 >= argv.length)
      {
        usage(`${arg} needs a value`);
      }
      return argv[++i];
    };
    switch (arg)
    {
      case '-h': case '--help': usage(); break;
      case '-o': case '--out': args.output = value(); break;
      case '--base': args.base = value(); break;
      case '--assets': args.assets.push(value()); break;
      case '--file': args.files.push(value()); break;
      case '--title': args.title = value(); break;
      case '--width': args.width = Number(value()); break;
      case '--height': args.height = Number(value()); break;
      case '--clear-color': args.clearColor = value(); break;
      case '--no-auto': args.auto = false; break;
      case '--no-credit': args.credit = false; break;
      default:
        if (arg.startsWith('-') || args.input)
        {
          usage(`unexpected argument ${arg}`);
        }
        args.input = arg;
    }
  }
  if (!args.input)
  {
    usage('no .div file given');
  }
  return args;
}

function listFiles(dir)
{
  const out = [];
  for (const name of readdirSync(dir))
  {
    const full = join(dir, name);
    if (statSync(full).isDirectory())
    {
      out.push(...listFiles(full));
    }
    else
    {
      out.push(full);
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const inputPath = resolve(args.input);
const source = readFileSync(inputPath, 'utf-8');
const files = {};
const add = (name, path) =>
{
  files[name] = new Uint8Array(readFileSync(path));
  console.log(`  + ${name} (${files[name].length} bytes)`);
};

if (args.auto)
{
  const baseDir = args.base ? resolve(args.base) : dirname(inputPath);
  for (const ref of findAssetReferences(source))
  {
    const path = resolve(baseDir, ref.replace(/\\/g, '/'));
    if (existsSync(path) && statSync(path).isFile())
    {
      add(ref, path);
    }
    else
    {
      console.warn(`  ! ${ref}: not found in ${relative(process.cwd(), baseDir) || '.'} (set --base, or add it with --file or --assets)`);
    }
  }
}
for (const dir of args.assets)
{
  for (const path of listFiles(resolve(dir)))
  {
    add(relative(resolve(dir), path).split(sep).join('/'), path);
  }
}
for (const file of args.files)
{
  add(basename(file), resolve(file));
}

const modules = await collectEngineModules((path) => readFileSync(join(rootDir, path), 'utf-8'));
const html = buildPackedHtml({
  modules,
  source,
  files,
  title: args.title || basename(inputPath).replace(/\.div$/i, ''),
  width: args.width,
  height: args.height,
  clearColor: args.clearColor,
  credit: args.credit
});
const outputPath = resolve(args.output || inputPath.replace(/\.div$/i, '') + '.html');
writeFileSync(outputPath, html);
console.log(`packed ${relative(process.cwd(), inputPath)} -> ${relative(process.cwd(), outputPath)} (${modules.length} engine modules, ${Object.keys(files).length} files, ${(html.length / 1024).toFixed(0)} KB)`);
