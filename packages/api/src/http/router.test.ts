import { describe, expect, it } from 'vitest';
import { MemoryRepository } from '../repository/memory-repository.js';
import { sampleQuiz, T0 } from '../repository/repository.contract.js';
import { createGameService } from '../service/game-service.js';
import { handleHttp, type HttpRequest, type HttpResponse } from './router.js';

const HOST = 'host-1';

async function setup() {
  const repo = new MemoryRepository();
  let ids = 0;
  const service = createGameService({
    repo,
    now: () => T0,
    newId: () => `id${++ids}`,
    random: Math.random,
    issuePlayerToken: ({ gameId, playerId }) => `token.${gameId}.${playerId}`,
    publish: async () => {},
  });
  // Stands in for verifyPlayerToken: accepts exactly the tokens issued above.
  const verifyPlayer = (token: string) => {
    const [, gameId, playerId] = token.split('.');
    return token.startsWith('token.') && gameId && playerId ? { gameId, playerId } : null;
  };
  const call = (request: Partial<HttpRequest>): Promise<HttpResponse> =>
    handleHttp(
      { method: 'GET', path: '/', headers: {}, body: null, ...request },
      {
        service,
        verifyPlayer,
      },
    );

  await repo.putQuiz(HOST, sampleQuiz('quiz1'));
  return { repo, service, call };
}

function json(response: HttpResponse): unknown {
  return JSON.parse(response.body);
}

describe('POST /api/join', () => {
  it('joins a Game and returns a Player token', async () => {
    const { service, call } = await setup();
    const created = await service.createGame(HOST, 'quiz1');
    if (!created.ok) throw new Error(created.error);

    const res = await call({
      method: 'POST',
      path: '/api/join',
      body: JSON.stringify({ joinCode: created.value.joinCode, nickname: 'Alice' }),
    });

    expect(res.statusCode).toBe(201);
    expect(json(res)).toEqual({
      gameId: created.value.gameId,
      playerId: expect.any(String),
      playerToken: expect.stringMatching(/^token\./),
    });
  });

  it.each([
    ['no body', null],
    ['invalid JSON', '{nope'],
    ['a missing Nickname', JSON.stringify({ joinCode: 'ABC234' })],
    ['a non-string Join Code', JSON.stringify({ joinCode: 7, nickname: 'Alice' })],
  ])('rejects %s with 400', async (_why, body) => {
    const { call } = await setup();
    const res = await call({ method: 'POST', path: '/api/join', body });
    expect(res.statusCode).toBe(400);
    expect(json(res)).toEqual({ error: 'INVALID_REQUEST' });
  });
});

describe('error status codes', () => {
  it('maps service errors to 404, 400 and 409', async () => {
    const { service, call } = await setup();
    const created = await service.createGame(HOST, 'quiz1');
    if (!created.ok) throw new Error(created.error);
    const join = (joinCode: string, nickname: string) =>
      call({ method: 'POST', path: '/api/join', body: JSON.stringify({ joinCode, nickname }) });

    const unknown = await join('ZZZZZZ', 'Alice');
    expect([unknown.statusCode, json(unknown)]).toEqual([404, { error: 'GAME_NOT_FOUND' }]);

    const malformed = await join(created.value.joinCode, 'A!');
    expect([malformed.statusCode, json(malformed)]).toEqual([400, { error: 'NICKNAME_FORMAT' }]);

    await join(created.value.joinCode, 'Alice');
    const taken = await join(created.value.joinCode, 'alice');
    expect([taken.statusCode, json(taken)]).toEqual([409, { error: 'NICKNAME_TAKEN' }]);
  });
});

describe('Host routes', () => {
  it('needs a signed-in Host, then creates a Game', async () => {
    const { call } = await setup();
    const request = {
      method: 'POST',
      path: '/api/games',
      body: JSON.stringify({ quizId: 'quiz1' }),
    };

    const anonymous = await call(request);
    expect([anonymous.statusCode, json(anonymous)]).toEqual([401, { error: 'UNAUTHENTICATED' }]);

    const res = await call({ ...request, hostId: HOST });
    expect(res.statusCode).toBe(201);
    expect(json(res)).toEqual({ gameId: expect.any(String), joinCode: expect.any(String) });
  });
});

describe('driving a Game over HTTP', () => {
  it('lets the Host resume, start, inspect and moderate their Game, and no one else', async () => {
    const { service, call } = await setup();
    const created = await service.createGame(HOST, 'quiz1');
    if (!created.ok) throw new Error(created.error);
    const { gameId, joinCode } = created.value;
    const alice = await service.joinGame(joinCode, 'Alice');
    const bob = await service.joinGame(joinCode, 'Bob');
    if (!alice.ok || !bob.ok) throw new Error('join failed');
    const asHost = (method: string, path: string) => call({ method, path, hostId: HOST });

    const active = await asHost('GET', '/api/games/active');
    expect([active.statusCode, json(active)]).toEqual([200, { gameId }]);

    const intruder = await call({
      method: 'POST',
      path: `/api/games/${gameId}/start`,
      hostId: 'x',
    });
    expect([intruder.statusCode, json(intruder)]).toEqual([403, { error: 'NOT_YOUR_GAME' }]);

    const started = await asHost('POST', `/api/games/${gameId}/start`);
    expect([started.statusCode, json(started)]).toEqual([200, { phase: 'QUESTION_OPEN' }]);

    const removed = await asHost('DELETE', `/api/games/${gameId}/players/${bob.value.playerId}`);
    expect(removed.statusCode).toBe(200);

    const snapshot = await asHost('GET', `/api/games/${gameId}`);
    expect(snapshot.statusCode).toBe(200);
    expect(json(snapshot)).toMatchObject({
      phase: 'QUESTION_OPEN',
      players: [{ nickname: 'Alice' }],
      answered: { answered: 0, total: 1 },
    });

    const tooEarly = await asHost('POST', `/api/games/${gameId}/close`);
    expect([tooEarly.statusCode, json(tooEarly)]).toEqual([409, { error: 'DEADLINE_NOT_REACHED' }]);
    const wrongPhase = await asHost('POST', `/api/games/${gameId}/next`);
    expect([wrongPhase.statusCode, json(wrongPhase)]).toEqual([409, { error: 'WRONG_PHASE' }]);
  });
});

describe('Player routes', () => {
  it('need a valid Player token, then serve the snapshot and accept Answers', async () => {
    const { service, call } = await setup();
    const created = await service.createGame(HOST, 'quiz1');
    if (!created.ok) throw new Error(created.error);
    const alice = await service.joinGame(created.value.joinCode, 'Alice');
    const bob = await service.joinGame(created.value.joinCode, 'Bob');
    if (!alice.ok || !bob.ok) throw new Error('join failed');
    await service.hostCommand(HOST, created.value.gameId, { type: 'Start' });
    const bearer = { authorization: `Bearer ${alice.value.playerToken}` };

    for (const headers of [{}, { authorization: 'Bearer forged' }, { authorization: 'Basic x' }]) {
      const res = await call({ method: 'GET', path: '/api/play', headers });
      expect([res.statusCode, json(res)]).toEqual([401, { error: 'UNAUTHENTICATED' }]);
    }

    const snapshot = await call({ method: 'GET', path: '/api/play', headers: bearer });
    expect(snapshot.statusCode).toBe(200);
    expect(json(snapshot)).toMatchObject({ phase: 'QUESTION_OPEN', me: { nickname: 'Alice' } });

    const answer = (body: unknown) =>
      call({
        method: 'POST',
        path: '/api/play/answers',
        headers: bearer,
        body: JSON.stringify(body),
      });
    expect((await answer({ questionIndex: 0 })).statusCode).toBe(400);
    const accepted = await answer({ questionIndex: 0, optionId: 'a' });
    expect([accepted.statusCode, json(accepted)]).toEqual([200, { phase: 'QUESTION_OPEN' }]);
    const again = await answer({ questionIndex: 0, optionId: 'b' });
    expect([again.statusCode, json(again)]).toEqual([409, { error: 'ALREADY_ANSWERED' }]);
  });
});
