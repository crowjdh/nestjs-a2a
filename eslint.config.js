const tsEsLint = require('typescript-eslint');
const tsParser = require('@typescript-eslint/parser');
const prettier = require('eslint-config-prettier');
const prettierPlugin = require('eslint-plugin-prettier');
const { defineConfig, globalIgnores } = require('eslint/config');
const importPlugin = require('eslint-plugin-import');

module.exports = defineConfig([
  ...tsEsLint.configs.recommended,
  prettier,
  globalIgnores(['**/node_modules/**', '**/dist/**', 'eslint.config.js']),
  {
    languageOptions: {
      parser: tsParser,
    },
    plugins: {
      prettier: prettierPlugin,
      import: importPlugin,
    },
    files: ['lib/**/*.ts'],
    rules: {
      'prettier/prettier': 'error',
      'no-console': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_' },
      ],
      'import/order': [
        'error',
        {
          groups: [
            'builtin',
            'external',
            'internal',
            'parent',
            'sibling',
            'index',
          ],
          pathGroups: [],
          alphabetize: {
            order: 'asc',
            caseInsensitive: true,
          },
        },
      ],
    },
  },
]);
