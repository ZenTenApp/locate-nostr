import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';
import { defineConfig, globalIgnores } from 'eslint/config';

export default defineConfig([
  globalIgnores(['dist', 'node_modules']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.worker },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
      ],
    },
  },
  {
    // Byte-handling code ported from `chat`, itself ported from React Native
    // where `Buffer.prototype.slice()` returned a **view** — so wiping the
    // parent buffer in a `finally` also wiped the child.
    // `Uint8Array.prototype.slice()` returns a **copy**, which would silently
    // survive the wipe and leave key material alive. Use `subarray()` for a
    // view, or `copyBytes()` when a copy is genuinely what you want.
    files: ['src/services/ssh/**/*.ts', 'src/services/crypto/**/*.ts', 'src/lib/bytes.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.property.name='slice']",
          message:
            'Uint8Array.slice() copies and escapes the fill(0) wipe. Use subarray() for a view or copyBytes() for an explicit copy.',
        },
      ],
    },
  },
]);
