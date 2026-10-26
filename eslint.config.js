import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Model calls go only through the Bedrock Converse API, and models are constructed only in
// packages/agent/src/model.ts, so swapping models stays a configuration change (ADR 0005).
const bedrockInvokeModel = {
  name: '@aws-sdk/client-bedrock-runtime',
  importNames: ['InvokeModelCommand', 'InvokeModelWithResponseStreamCommand'],
  message: 'Call models through the Bedrock Converse API only (ADR 0005).',
};
const strandsBedrockModel = {
  name: '@strands-agents/sdk',
  importNames: ['BedrockModel'],
  message: 'Construct models only in packages/agent/src/model.ts (ADR 0005).',
};
const strandsOtherProviders = {
  group: ['@strands-agents/sdk/models/*'],
  message: 'Only Bedrock (Converse) models are allowed (ADR 0005).',
};

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/dist-lambda/**',
      '**/dist-bundle/**',
      '**/.tsbuild/**',
      '**/.aws-sam/**',
      '**/coverage/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      // `_`-prefixed names, and properties left out with `...rest`, are deliberately unused.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
      'no-restricted-imports': [
        'error',
        {
          paths: [bedrockInvokeModel, strandsBedrockModel],
          patterns: [strandsOtherProviders],
        },
      ],
    },
  },
  {
    // The one module allowed to construct a model (still Converse-only).
    files: ['packages/agent/src/model.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { paths: [bedrockInvokeModel], patterns: [strandsOtherProviders] },
      ],
    },
  },
  {
    // The domain package must stay free of I/O and AWS dependencies (PLAN §1, §7).
    files: ['packages/domain/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: ['@aws-sdk/*', 'node:*', '@quizapp/api', '@quizapp/agent', '@quizapp/web'] },
      ],
    },
  },
  {
    files: ['packages/web/src/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
  },
  prettier,
);
