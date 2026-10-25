// Bundles the agent into dist-bundle/index.mjs, which the Dockerfile copies into an arm64 image.
// Bundling (rather than `pnpm deploy`) keeps the image tiny and the CI build fast under emulation.
import { build } from 'esbuild';
import { rm } from 'node:fs/promises';

await rm('dist-bundle', { recursive: true, force: true });

await build({
  entryPoints: ['src/server.ts'],
  outfile: 'dist-bundle/index.mjs',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  conditions: ['@quizapp/source'],
  // Strands' optional peer dependencies that aren't installed (other model providers, A2A,
  // telemetry exporters). This agent never loads them. Installed peers that Strands imports
  // at startup (@modelcontextprotocol/client, @opentelemetry/api) are bundled.
  external: [
    '@a2a-js/sdk',
    '@ai-sdk/provider',
    '@anthropic-ai/sdk',
    '@aws/bedrock-token-generator',
    '@aws-sdk/client-bedrock-agent',
    '@aws-sdk/client-bedrock-agent-runtime',
    '@aws-sdk/client-s3',
    '@cedar-policy/cedar-wasm',
    '@cedar-policy/mcp-schema-generator-wasm',
    '@google/genai',
    '@opentelemetry/baggage-span-processor',
    '@opentelemetry/exporter-metrics-otlp-http',
    '@opentelemetry/exporter-trace-otlp-http',
    '@opentelemetry/resources',
    '@opentelemetry/sdk-metrics',
    '@opentelemetry/sdk-trace-base',
    '@opentelemetry/sdk-trace-node',
    '@tobilu/qmd',
    'express',
    'openai',
    'turndown',
  ],
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
});
