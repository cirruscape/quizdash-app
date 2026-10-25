// AgentCore Runtime HTTP contract: listen on 0.0.0.0:8080 (arm64 image),
// GET /ping for health, POST /invocations with a JSON body.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { z } from 'zod';
import { createAnswerer, type Answerer } from './answerer.js';

const PORT = 8080;
const MAX_BODY_BYTES = 64 * 1024;

const InvocationRequest = z.object({ prompt: z.string().min(1).max(4000) });

export function createRouter(answer: Answerer) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (req.method === 'GET' && req.url === '/ping') {
      send(res, 200, { status: 'Healthy' });
      return;
    }
    if (req.method === 'POST' && req.url === '/invocations') {
      const body = await readJson(req);
      const parsed = InvocationRequest.safeParse(body);
      if (!parsed.success) {
        send(res, 400, { status: 'error', error: 'INVALID_REQUEST' });
        return;
      }
      try {
        send(res, 200, { status: 'success', response: await answer(parsed.data.prompt) });
      } catch (err) {
        console.error('invocation failed', err);
        send(res, 500, { status: 'error', error: 'INVOCATION_FAILED' });
      }
      return;
    }
    send(res, 404, { error: 'NOT_FOUND' });
  };
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) return undefined;
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return undefined;
  }
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const answer = createAnswerer({
    region: process.env.AWS_REGION ?? 'ap-southeast-2',
    modelId: process.env.MODEL_ID ?? 'au.anthropic.claude-opus-5-5',
  });
  createServer((req, res) => void createRouter(answer)(req, res)).listen(PORT, '0.0.0.0', () =>
    console.log(`agent listening on 0.0.0.0:${PORT}`),
  );
}
