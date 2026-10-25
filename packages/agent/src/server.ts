// AgentCore Runtime container entry point: GET /ping for health, POST /invocations for work.
// Placeholder until Spike A (PLAN §10, M0) wires in the Strands agent and Bedrock.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

const PORT = 8080;

export function route(req: IncomingMessage, res: ServerResponse): void {
  if (req.method === 'GET' && req.url === '/ping') {
    send(res, 200, { status: 'Healthy' });
    return;
  }
  if (req.method === 'POST' && req.url === '/invocations') {
    send(res, 501, { error: 'NOT_IMPLEMENTED' });
    return;
  }
  send(res, 404, { error: 'NOT_FOUND' });
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  createServer(route).listen(PORT, () => console.log(`agent listening on :${PORT}`));
}
