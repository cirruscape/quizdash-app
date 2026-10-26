// AgentCore Runtime HTTP contract: listen on 0.0.0.0:8080 (arm64 image),
// GET /ping for health, POST /invocations with a JSON AgentRequest (PLAN §8).
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { AgentRequest, type AgentResponse } from '@quizapp/contracts';
import { createBedrockGenerationModel } from './generation/bedrock-model.js';
import { createGenerationHandler } from './generation/handler.js';
import { modelConfigFromEnv } from './model.js';

const PORT = 8080;
const MAX_BODY_BYTES = 256 * 1024;

export function createRouter(handle: (request: AgentRequest) => Promise<AgentResponse>) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (req.method === 'GET' && req.url === '/ping') {
      send(res, 200, { status: 'Healthy' });
      return;
    }
    if (req.method === 'POST' && req.url === '/invocations') {
      const parsed = AgentRequest.safeParse(await readJson(req));
      if (!parsed.success) {
        send(res, 400, { status: 'error', error: 'INVALID_REQUEST' });
        return;
      }
      try {
        send(res, 200, await handle(parsed.data));
      } catch (err) {
        console.error('generation failed', err);
        send(res, 500, { status: 'error', error: 'GENERATION_FAILED' });
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
  const handle = createGenerationHandler(createBedrockGenerationModel(modelConfigFromEnv()));
  createServer((req, res) => void createRouter(handle)(req, res)).listen(PORT, '0.0.0.0', () =>
    console.log(`agent listening on 0.0.0.0:${PORT}`),
  );
}
