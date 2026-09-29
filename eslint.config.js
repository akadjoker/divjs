// ESLint flat config (ESLint 9+). Only enforces brace style for now —
// opening braces always on their own line (Allman), single-line blocks
// left alone so short guards like `if (x) return;` aren't forced to wrap.
export default [
  // Generated bundle (npm run build:vendor), not project code.
  { ignores: ['playground/vendor/**'] },
  {
    files: ['**/*.js', '**/*.mjs'],
    rules: {
      'brace-style': ['error', 'allman', { allowSingleLine: true }]
    }
  }
];
