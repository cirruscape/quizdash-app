import { describe, expect, it } from 'vitest';
import { MemoryRepository } from '../repository/memory-repository.js';
import { sampleQuiz, T0 } from '../repository/repository.contract.js';
import { createGameService } from '../service/game-service.js';
import { createQuizService, type QuizJob } from '../service/quiz-service.js';
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
    isBlocked: () => false,
    isToxic: async () => false,
  });
  // Stands in for verifyPlayerToken: accepts exactly the tokens issued above.
  const verifyPlayer = (token: string) => {
    const [, gameId, playerId] = token.split('.');
    return token.startsWith('token.') && gameId && playerId ? { gameId, playerId } : null;
  };
  const jobs: QuizJob[] = [];
  const quizzes = createQuizService({
    repo,
    now: () => T0,
    newId: () => `id${++ids}`,
    startJob: async (job) => {
      jobs.push(job);
    },
    agent: async () => ({
      status: 'success',
      questions: Array.from({ length: 5 }, (_, i) => ({
        text: `Generated ${i}?`,
        options: [
          { optionId: 'a', text: 'Yes' },
          { optionId: 'b', text: 'No' },
        ],
        correctOptionId: 'a',
      })),
    }),
    generationLimit: 2,
  });
  const call = (request: Partial<HttpRequest>): Promise<HttpResponse> =>
    handleHttp(
      { method: 'GET', path: '/', headers: {}, body: null, ...request },
      { service, quizzes, verifyPlayer },
    );

  await repo.putQuiz(HOST, sampleQuiz('quiz1'));
  return { repo, service, quizzes, jobs, call };
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

describe('GET /api/quizzes', () => {
  it("lists the signed-in Host's Ready Quizzes", async () => {
    const { call } = await setup();
    expect((await call({ method: 'GET', path: '/api/quizzes' })).statusCode).toBe(401);

    const res = await call({ method: 'GET', path: '/api/quizzes', hostId: HOST });
    expect([res.statusCode, json(res)]).toEqual([
      200,
      [{ quizId: 'quiz1', topic: null, status: 'READY', questionCount: 1, failureReason: null }],
    ]);
  });
});

describe('History routes', () => {
  it("serve the signed-in Host's History, and 404 for anyone else's Game", async () => {
    const { service, call } = await setup();
    const created = await service.createGame(HOST, 'quiz1');
    if (!created.ok) throw new Error(created.error);
    const { gameId, joinCode } = created.value;
    const alice = await service.joinGame(joinCode, 'Alice');
    if (!alice.ok) throw new Error(alice.error);
    await service.hostCommand(HOST, gameId, { type: 'Start' });
    await service.submitAnswer(alice.value, 0, 'a');
    await service.hostCommand(HOST, gameId, { type: 'Next' });

    expect((await call({ method: 'GET', path: '/api/history' })).statusCode).toBe(401);

    const list = await call({ method: 'GET', path: '/api/history', hostId: HOST });
    expect(list.statusCode).toBe(200);
    expect(json(list)).toMatchObject([{ gameId, winner: 'Alice', playerCount: 1 }]);

    const detail = await call({ method: 'GET', path: `/api/history/${gameId}`, hostId: HOST });
    expect(detail.statusCode).toBe(200);
    expect(json(detail)).toMatchObject({ gameId, leaderboard: [{ nickname: 'Alice' }] });

    const intruder = await call({ method: 'GET', path: `/api/history/${gameId}`, hostId: 'x' });
    expect([intruder.statusCode, json(intruder)]).toEqual([404, { error: 'HISTORY_NOT_FOUND' }]);
  });
});

describe('Quiz generation routes', () => {
  it('generate in the background, then let the Host review and approve the Draft', async () => {
    const { call, quizzes, jobs } = await setup();
    const asHost = (method: string, path: string, body?: unknown) =>
      call({ method, path, hostId: HOST, body: body === undefined ? null : JSON.stringify(body) });
    const request = {
      topic: 'Capitals',
      difficulty: 'EASY',
      questionCount: 5,
      defaultTimeLimitSeconds: 20,
    };

    const created = await asHost('POST', '/api/quizzes', request);
    expect(created.statusCode).toBe(202);
    const { quizId } = json(created) as { quizId: string };
    expect(json(await asHost('GET', `/api/quizzes/${quizId}`))).toMatchObject({
      status: 'GENERATING',
    });

    await quizzes.runJob(jobs.shift()!); // what the worker Lambda does
    const draft = json(await asHost('GET', `/api/quizzes/${quizId}`)) as {
      status: string;
      questions: { questionId: string }[];
    };
    expect(draft.status).toBe('DRAFT');
    const [first, second] = draft.questions;

    const timed = await asHost('PATCH', `/api/quizzes/${quizId}/questions/${first!.questionId}`, {
      timeLimitSeconds: 45,
    });
    expect(timed.statusCode).toBe(200);
    const regen = await asHost(
      'POST',
      `/api/quizzes/${quizId}/questions/${second!.questionId}/regenerate`,
    );
    expect(regen.statusCode).toBe(202);
    await quizzes.runJob(jobs.shift()!);

    const discarded = await asHost(
      'DELETE',
      `/api/quizzes/${quizId}/questions/${first!.questionId}`,
    );
    expect(discarded.statusCode).toBe(200);
    const tooFew = await asHost('POST', `/api/quizzes/${quizId}/approve`);
    expect([tooFew.statusCode, json(tooFew)]).toEqual([409, { error: 'TOO_FEW_QUESTIONS' }]);

    expect((await asHost('DELETE', `/api/quizzes/${quizId}`)).statusCode).toBe(200);
    expect((await asHost('GET', `/api/quizzes/${quizId}`)).statusCode).toBe(404);
  });

  it('answers 400 for a bad request, 429 over the daily limit, and 404 for another Host', async () => {
    const { call } = await setup(); // limit 2
    const post = (body: unknown, hostId = HOST) =>
      call({ method: 'POST', path: '/api/quizzes', hostId, body: JSON.stringify(body) });
    const request = {
      topic: 'Capitals',
      difficulty: 'EASY',
      questionCount: 5,
      defaultTimeLimitSeconds: 20,
    };

    const bad = await post({ ...request, questionCount: 50 });
    expect([bad.statusCode, json(bad)]).toEqual([400, { error: 'INVALID_QUESTION_COUNT' }]);
    expect((await post({ topic: 'x' })).statusCode).toBe(400);

    const { quizId } = json(await post(request)) as { quizId: string };
    await post(request);
    const over = await post(request);
    expect([over.statusCode, json(over)]).toEqual([429, { error: 'QUOTA_EXCEEDED' }]);

    const theirs = await call({ method: 'GET', path: `/api/quizzes/${quizId}`, hostId: 'x' });
    expect([theirs.statusCode, json(theirs)]).toEqual([404, { error: 'QUIZ_NOT_FOUND' }]);
  });
});
