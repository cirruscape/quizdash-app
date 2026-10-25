import react from '@vitejs/plugin-react';
import { defaultClientConditions, defineConfig } from 'vite';

// Local development talks to a deployed environment: set QUIZAPP_DEV_URL to its CloudFront URL
// (e.g. https://d123.cloudfront.net) and /api and /config.json are proxied there.
const target = process.env.QUIZAPP_DEV_URL;

export default defineConfig({
  plugins: [react()],
  resolve: { conditions: ['@quizapp/source', ...defaultClientConditions] },
  build: { target: 'es2022' },
  server: target
    ? {
        proxy: {
          '/api': { target, changeOrigin: true },
          '/config.json': { target, changeOrigin: true },
        },
      }
    : {},
});
