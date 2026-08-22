import obsidianmd from 'eslint-plugin-obsidianmd';
import globals from 'globals';
import { defineConfig, globalIgnores } from 'eslint/config';

export default defineConfig(
  globalIgnores([
    'node_modules',
    'coverage',
    'main.js',
    'build-meta.json',
    'docs',
    'esbuild.config.mjs',
    'eslint.config.mts',
    'package-lock.json',
    'project_status.md',
  ]),
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      globals: globals.browser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['tests/**/*.ts'],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.browser,
      },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  ...obsidianmd.configs.recommended,
  {
    files: ['src/platform/obsidian-vault-adapter.ts'],
    rules: {
      // SelfGrow's confirmed permanent-delete contract intentionally bypasses trash.
      'obsidianmd/prefer-file-manager-trash-file': 'off',
    },
  },
  {
    files: ['src/inbox/inbox-view.ts'],
    rules: {
      // SelfGrow is the product's fixed camel-case brand name.
      'obsidianmd/ui/sentence-case': 'off',
    },
  },
  {
    files: ['tests/**/*.ts'],
    rules: {
      'obsidianmd/hardcoded-config-path': 'off',
      'obsidianmd/no-nodejs-modules': 'off',
    },
  },
);
