import js from '@eslint/js';

export default [
  {
    ignores: ['dist/**', 'node_modules/**', 'data/**', 'public/**', '.jj/**'],
  },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        Blob: 'readonly',
        DOMParser: 'readonly',
        Element: 'readonly',
        Event: 'readonly',
        FileReader: 'readonly',
        Node: 'readonly',
        Range: 'readonly',
        URL: 'readonly',
        crypto: 'readonly',
        requestAnimationFrame: 'readonly',
        clearTimeout: 'readonly',
        confirm: 'readonly',
        console: 'readonly',
        document: 'readonly',
        fetch: 'readonly',
        navigator: 'readonly',
        performance: 'readonly',
        prompt: 'readonly',
        process: 'readonly',
        setTimeout: 'readonly',
        window: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-case-declarations': 'off',
      'no-control-regex': 'off',
    },
  },
];
