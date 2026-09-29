// Entry point for playground/vendor/codemirror.js, the single-file
// CodeMirror 6 build the playground imports. Regenerate with
// `npm run build:vendor` after changing this list or upgrading the
// @codemirror packages in package.json. Only what the playground uses is
// re-exported, so esbuild can drop the rest.
export { basicSetup } from 'codemirror';
export { EditorView, keymap, Decoration } from '@codemirror/view';
export { EditorState, StateEffect, StateField, Compartment, Prec } from '@codemirror/state';
export { StreamLanguage, HighlightStyle, syntaxHighlighting } from '@codemirror/language';
export { linter, lintGutter, setDiagnostics } from '@codemirror/lint';
export { autocompletion } from '@codemirror/autocomplete';
export { indentWithTab } from '@codemirror/commands';
export { oneDarkTheme } from '@codemirror/theme-one-dark';
export { tags } from '@lezer/highlight';
