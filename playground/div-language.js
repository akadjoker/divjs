// DIV language support for the playground's CodeMirror editor:
// highlighting, completion and live error checking. Every word list comes
// from the engine itself (tokenizer keywords, compiler constants and
// process fields, the runtime's registered natives), so the editor can't
// drift from what the compiler accepts.

import {
  StreamLanguage,
  HighlightStyle,
  syntaxHighlighting,
  linter,
  lintGutter,
  autocompletion,
  tags
} from './vendor/codemirror.js';
import { Lexer, KEYWORD_NAMES } from '../compiler/tokenizer.js';
import { Parser } from '../parser/parser.js';
import { Compiler, BUILTIN_CONSTANTS, PROCESS_FIELD_NAMES } from '../compiler/compiler.js';

const KEYWORDS = new Set(KEYWORD_NAMES.map((k) => k.toLowerCase()));
const CONSTANTS = new Set(Object.keys(BUILTIN_CONSTANTS));
// father/son/... are resolved by the runtime, not declared anywhere.
const PROCESS_FIELDS = new Set([...PROCESS_FIELD_NAMES, 'father', 'son', 'bigbro', 'smallbro', 'mouse', 'scroll', 'region']);
const DECLARING_KEYWORDS = new Set(['process', 'function', 'program']);

// A "--" is the decrement operator only right after a value and before
// ";" or ")" (see isDecrementContext in compiler/tokenizer.js); anywhere
// else it starts a comment.
function isDecrementAt(stream)
{
  const rest = stream.string.slice(stream.pos + 2);
  return /^\s*[;)]/.test(rest);
}

function createStreamParser(nativeNames)
{
  return {
    name: 'div',
    startState()
    {
      return { inBlockComment: false, expectName: false };
    },
    token(stream, state)
    {
      if (state.inBlockComment)
      {
        if (stream.skipTo('*/'))
        {
          stream.pos += 2;
          state.inBlockComment = false;
        }
        else
        {
          stream.skipToEnd();
        }
        return 'comment';
      }
      if (stream.eatSpace())
      {
        return null;
      }
      if (stream.match('//'))
      {
        stream.skipToEnd();
        return 'comment';
      }
      if (stream.match('/*'))
      {
        state.inBlockComment = true;
        return 'comment';
      }
      if (stream.match('--', false) && !isDecrementAt(stream))
      {
        stream.skipToEnd();
        return 'comment';
      }
      const ch = stream.peek();
      if (ch === '"' || ch === "'")
      {
        stream.next();
        let escaped = false;
        let next;
        while ((next = stream.next()) !== undefined)
        {
          if (next === ch && !escaped)
          {
            break;
          }
          escaped = !escaped && next === '\\';
        }
        return 'string';
      }
      if (stream.match(/^\d+(\.\d+)?/))
      {
        return 'number';
      }
      if (stream.match(/^[A-Za-z_][A-Za-z0-9_]*/))
      {
        const word = stream.current().toLowerCase();
        if (state.expectName)
        {
          state.expectName = false;
          return 'def';
        }
        if (KEYWORDS.has(word))
        {
          state.expectName = DECLARING_KEYWORDS.has(word);
          return 'keyword';
        }
        if (CONSTANTS.has(word))
        {
          return 'atom';
        }
        if (PROCESS_FIELDS.has(word))
        {
          return 'field';
        }
        if (nativeNames.has(word))
        {
          return 'builtin';
        }
        return 'variableName';
      }
      stream.next();
      return 'operator';
    },
    languageData: {
      commentTokens: { line: '//', block: { open: '/*', close: '*/' } }
    },
    tokenTable: {
      field: tags.special(tags.variableName),
      def: tags.definition(tags.function(tags.variableName))
    }
  };
}

const divHighlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: '#c792ea', fontWeight: '600' },
  { tag: tags.atom, color: '#f78c6c' },
  { tag: tags.number, color: '#f78c6c' },
  { tag: tags.string, color: '#c3e88d' },
  { tag: tags.comment, color: '#6b7f94', fontStyle: 'italic' },
  { tag: tags.special(tags.variableName), color: '#ffcb6b' },
  { tag: tags.standard(tags.variableName), color: '#82aaff' },
  { tag: tags.definition(tags.function(tags.variableName)), color: '#89ddff', fontWeight: '600' },
  { tag: tags.operator, color: '#89ddff' }
]);

// Compile the whole document and turn a DivError into a diagnostic at its
// line and column. Only compiles - nothing runs.
export function compileDiagnostics(source, doc)
{
  try
  {
    new Compiler().compile(new Parser(new Lexer(source).tokenize()).parse());
    return [];
  }
  catch (err)
  {
    return [errorToDiagnostic(err, doc)];
  }
}

export function errorToDiagnostic(err, doc)
{
  const message = err?.reason || err?.message || String(err);
  if (!Number.isInteger(err?.line) || err.line < 1 || err.line > doc.lines)
  {
    return { from: 0, to: Math.min(doc.length, doc.line(1).to), severity: 'error', message };
  }
  const line = doc.line(err.line);
  const from = Math.min(line.from + Math.max(0, (err.col || 1) - 1), line.to);
  // Underline the word at the error position, or one character.
  const rest = doc.sliceString(from, line.to);
  const word = rest.match(/^[A-Za-z0-9_]+/);
  const to = word ? from + word[0].length : Math.min(from + 1, line.to);
  return { from, to: Math.max(to, from), severity: 'error', message };
}

// Names the program itself declares, for completion.
function declaredNames(text)
{
  const names = new Set();
  const re = /\b(?:process|function|global|private|local|var)\s+([A-Za-z_][A-Za-z0-9_]*)/gi;
  let m;
  while ((m = re.exec(text)) !== null)
  {
    names.add(m[1].toLowerCase());
  }
  return names;
}

function createCompletionSource(nativeInfo)
{
  const keywordOptions = KEYWORD_NAMES.map((k) => ({ label: k, type: 'keyword' }));
  const constantOptions = [...CONSTANTS].map((c) => ({ label: c, type: 'constant' }));
  const fieldOptions = [...PROCESS_FIELDS].map((f) => ({ label: f, type: 'property', detail: 'process field' }));
  const nativeOptions = [...nativeInfo.entries()].map(([name, info]) => ({
    label: name,
    type: 'function',
    detail: info.args ? `(${info.args})` : '()',
    info: info.description || undefined,
    apply: `${name}(`
  }));
  const fixed = [...keywordOptions, ...constantOptions, ...fieldOptions, ...nativeOptions];

  return (context) =>
  {
    const word = context.matchBefore(/[A-Za-z_][A-Za-z0-9_]*/);
    if (!word || (word.from === word.to && !context.explicit))
    {
      return null;
    }
    const own = [...declaredNames(context.state.doc.toString())]
      .filter((name) => !KEYWORDS.has(name))
      .map((name) => ({ label: name, type: 'variable' }));
    return { from: word.from, options: [...own, ...fixed], validFor: /^[A-Za-z0-9_]*$/ };
  };
}

// nativeInfo: Map name -> { args, description } (see loadNativeInfo).
export function divLanguage(nativeInfo)
{
  const language = StreamLanguage.define(createStreamParser(new Set(nativeInfo.keys())));
  return [
    language,
    syntaxHighlighting(divHighlightStyle),
    autocompletion({ override: [createCompletionSource(nativeInfo)] }),
    lintGutter(),
    linter((view) => compileDiagnostics(view.state.doc.toString(), view.state.doc), { delay: 500 })
  ];
}

// The natives the runtime registers, with their argument list and a short
// description from docs/natives.md when available. registeredNames comes
// from a runtime instance (vm.natives), so the list is always complete even
// if the document can't be fetched.
export async function loadNativeInfo(registeredNames, docsUrl)
{
  const info = new Map();
  for (const name of registeredNames)
  {
    if (!name.startsWith('__'))
    {
      info.set(name, { args: '', description: '' });
    }
  }
  try
  {
    const text = await (await fetch(docsUrl)).text();
    const row = /^\|\s*`([a-z0-9_]+)`\s*\|\s*([^|]*)\|\s*([^|]*)\|\s*(.*)\|\s*$/gim;
    let m;
    while ((m = row.exec(text)) !== null)
    {
      const entry = info.get(m[1]);
      if (entry)
      {
        entry.args = m[2].replace(/`/g, '').trim();
        entry.description = m[4].replace(/`/g, '').trim();
      }
    }
  }
  catch
  {
    // Completion still lists every native, just without argument details.
  }
  return info;
}
