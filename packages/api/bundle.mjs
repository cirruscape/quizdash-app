// Bundles each Lambda entry point into dist-lambda/<name>/index.mjs for SAM to zip as-is.
// SAM's own esbuild builder runs `npm install`, which breaks pnpm workspace:* dependencies.
import { build } from 'esbuild';
import { rm } from 'node:fs/promises';

const entries = {
  health: 'src/health.ts',
  http: 'src/lambda/http.ts',
  worker: 'src/lambda/worker.ts',
  sweeper: 'src/lambda/sweeper.ts',
  'events-authoriser': 'src/events-authoriser.ts',
};

await rm('dist-lambda', { recursive: true, force: true });

await Promise.all(
  Object.entries(entries).map(([name, entry]) =>
    build({
      entryPoints: [entry],
      outfile: `dist-lambda/${name}/index.mjs`,
      bundle: true,
      platform: 'node',
      target: 'node22',
      format: 'esm',
      sourcemap: true,
      minify: true,
      // Bundle workspace packages from their TypeScript source.
      conditions: ['@quizapp/source'],
      // The Lambda Node.js runtime ships AWS SDK v3.
      external: ['@aws-sdk/*'],
      banner: {
        js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
      },
    }),
  ),
);
