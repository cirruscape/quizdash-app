import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { AgentRequest, AgentResponse } from '@quizapp/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRouter } from './server.js';

describe('agent server', () => {
  let server: Server;
  let base: string;
  let handle: (request: AgentRequest) => Promise<AgentResponse>;

  beforeAll(async () => {
    const route = createRouter((request) => handle(request));
    server = createServer((req, res) => void route(req, res));
    await new Promise<void>((resolve) => server.listen(0, resolve));
    base = `http://localhost:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const invoke = (body: unknown) =>
    fetch(`${base}/invocations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });

  const generate = { mode: 'generate', topic: 'Capitals', difficulty: 'EASY', count: 5, avoid: [] };

  it('reports healthy on /ping', async () => {
    const res = await fetch(`${base}/ping`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'Healthy' });
  });

  it('passes a valid request to the pipeline and returns its result', async () => {
    let received: AgentRequest | undefined;
    handle = async (request) => {
      received = request;
      return { status: 'error', error: 'TOPIC_REFUSED' };
    };
    const res = await invoke(generate);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'error', error: 'TOPIC_REFUSED' });
    expect(received).toEqual(generate);
  });

  it.each([
    ['not JSON', 'nope'],
    ['an unknown mode', { ...generate, mode: 'chat' }],
    ['too many Questions', { ...generate, count: 21 }],
  ])('rejects %s with 400', async (_why, body) => {
    const res = await invoke(body);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ status: 'error', error: 'INVALID_REQUEST' });
  });

  it('returns 500 when generation throws', async () => {
    handle = async () => {
      throw new Error('bedrock down');
    };
    const res = await invoke(generate);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ status: 'error', error: 'GENERATION_FAILED' });
  });

  it('returns 404 for unknown routes', async () => {
    expect((await fetch(`${base}/nope`)).status).toBe(404);
  });
});
