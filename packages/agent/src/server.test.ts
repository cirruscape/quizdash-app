import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Answerer } from './answerer.js';
import { createRouter } from './server.js';

describe('agent server', () => {
  let server: Server;
  let base: string;
  let answer: Answerer = async (prompt) => `echo: ${prompt}`;

  beforeAll(async () => {
    const route = createRouter((prompt) => answer(prompt));
    server = createServer((req, res) => void route(req, res));
    await new Promise<void>((resolve) => server.listen(0, resolve));
    base = `http://localhost:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const invoke = (body: string) =>
    fetch(`${base}/invocations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });

  it('reports healthy on /ping', async () => {
    const res = await fetch(`${base}/ping`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'Healthy' });
  });

  it('answers a prompt on /invocations', async () => {
    const res = await invoke(JSON.stringify({ prompt: 'hello' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'success', response: 'echo: hello' });
  });

  it.each(['not json', '{}', JSON.stringify({ prompt: '' })])('rejects body %j', async (body) => {
    const res = await invoke(body);
    expect(res.status).toBe(400);
  });

  it('returns 500 when the model call fails', async () => {
    answer = async () => {
      throw new Error('bedrock down');
    };
    const res = await invoke(JSON.stringify({ prompt: 'hello' }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ status: 'error', error: 'INVOCATION_FAILED' });
  });

  it('returns 404 for unknown routes', async () => {
    const res = await fetch(`${base}/nope`);
    expect(res.status).toBe(404);
  });
});
