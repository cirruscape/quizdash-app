import { defineConfig } from 'vitest/config';

// Resolve workspace packages to their TypeScript source, so tests never need a prior build.
const source = '@quizapp/source';

// Tests run in Node. Omit Vite's default `module` condition: it selects packages' ESM builds
// (e.g. the AWS SDK's dist-es), which use extensionless imports that plain Node can't load.
const conditions = [source, 'node', 'development|production'];

export default defineConfig({
  resolve: { conditions },
  ssr: { resolve: { conditions } },
  test: {
    include: ['packages/*/src/**/*.test.{ts,tsx}', 'infra/**/*.test.ts'],
  },
});
