// API-only smoke test (PLAN M2b): plays a whole Game against a deployed environment, through the
// real HTTP API and AppSync Events. A Host and three bot Players play two Questions, and the
// real-time events and final Leaderboard are checked. Usage:
//   AWS_PROFILE=quizdash pnpm --filter @quizapp/scripts smoke
import { DeleteCommand, DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoRepository } from '@quizapp/api/repository';
import type { Quiz } from '@quizapp/domain';
import assert from 'node:assert/strict';
import { REGION, signInSmokeHost, stackOutputs } from './lib/aws.js';
import { EventsClient, type GameEventEnvelope } from './lib/events-client.js';
import { sampleQuiz } from './lib/sample-quiz.js';

const foundation = await stackOutputs('foundation');
const api = await stackOutputs('api');
const apiUrl = api.ApiUrl as string;
const [httpDomain, realtimeDomain] = [
  api.EventsHttpDomain as string,
  api.EventsRealtimeDomain as string,
];
const table = foundation.TableName as string;
const clients: EventsClient[] = [];

function step(message: string): void {
  console.log(`• ${message}`);
}

async function call(
  method: string,
  path: string,
  { token, body }: { token?: string; body?: unknown } = {},
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${apiUrl}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

async function expectOk(
  method: string,
  path: string,
  options?: { token?: string; body?: unknown },
) {
  const res = await call(method, path, options);
  assert.ok(res.status < 300, `${method} ${path} -> ${res.status} ${JSON.stringify(res.json)}`);
  return res.json;
}

try {
  step('signing in the smoke-test Host');
  const host = await signInSmokeHost(
    foundation.UserPoolId as string,
    foundation.UserPoolClientId as string,
  );

  // A failed earlier run can leave the smoke Host with an unfinished Game; clear that claim.
  await DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION })).send(
    new DeleteCommand({ TableName: table, Key: { PK: `HOST#${host.hostId}`, SK: 'ACTIVE_GAME' } }),
  );

  const full = sampleQuiz('smoke-quiz');
  const quiz: Quiz = { ...full, questions: full.questions.slice(0, 2) };
  await new DynamoRepository(table).putQuiz(host.hostId, quiz);
  step(`seeded a ${quiz.questions.length}-Question Quiz`);

  const health = await expectOk('GET', '/api/health');
  assert.equal(health.status, 'ok');

  const { gameId, joinCode } = (await expectOk('POST', '/api/games', {
    token: host.idToken,
    body: { quizId: quiz.quizId },
  })) as { gameId: string; joinCode: string };
  step(`created Game ${gameId} with Join Code ${joinCode}`);

  const hostEvents = await EventsClient.connect(realtimeDomain, httpDomain, host.idToken);
  clients.push(hostEvents);
  await hostEvents.subscribe(`/game/${gameId}/host`);
  await hostEvents.subscribe(`/game/${gameId}/players`);
  step('Host subscribed to both channels');

  // Alice and Cara always answer correctly; Bob always answers wrongly.
  const bots: {
    name: string;
    option: string;
    token: string;
    playerId: string;
    events: EventsClient;
  }[] = [];
  for (const [name, option] of [
    ['Alice', 'a'],
    ['Bob', 'b'],
    ['Cara', 'a'],
  ] as const) {
    const joined = (await expectOk('POST', '/api/join', {
      body: { joinCode, nickname: name },
    })) as {
      playerToken: string;
      playerId: string;
    };
    const events = await EventsClient.connect(realtimeDomain, httpDomain, joined.playerToken);
    clients.push(events);
    await events.subscribe(`/game/${gameId}/players`);
    bots.push({ name, option, token: joined.playerToken, playerId: joined.playerId, events });
  }
  await hostEvents.waitFor(
    (e) => e.type === 'PLAYER_JOINED' && e.payload.playerCount === 3,
    'three PLAYER_JOINED',
  );
  step('three bot Players joined and subscribed');

  const pointsByName: Record<string, number> = { Alice: 0, Bob: 0, Cara: 0 };

  for (let questionIndex = 0; questionIndex < quiz.questions.length; questionIndex++) {
    const command = questionIndex === 0 ? 'start' : 'next';
    await expectOk('POST', `/api/games/${gameId}/${command}`, { token: host.idToken });

    for (const bot of bots) {
      const opened = await bot.events.waitFor(
        (e) => e.type === 'QUESTION_OPENED' && e.payload.questionIndex === questionIndex,
        `QUESTION_OPENED ${questionIndex} for ${bot.name}`,
      );
      assert.equal(JSON.stringify(opened).includes('correct'), false, 'correct Option leaked');
      const snapshot = await expectOk('GET', '/api/play', { token: bot.token });
      assert.equal(snapshot.phase, 'QUESTION_OPEN');
      await expectOk('POST', '/api/play/answers', {
        token: bot.token,
        body: { questionIndex, optionId: bot.option },
      });
    }

    // Everyone answered, so the Question closes early.
    const hostReveal = await hostEvents.waitFor(
      (e) => e.type === 'QUESTION_REVEALED_HOST' && e.payload.questionIndex === questionIndex,
      `QUESTION_REVEALED_HOST ${questionIndex}`,
    );
    assert.deepEqual(hostReveal.payload.optionCounts, { a: 2, b: 1, c: 0, d: 0 });

    for (const bot of bots) {
      const reveal: GameEventEnvelope = await bot.events.waitFor(
        (e) => e.type === 'QUESTION_REVEALED' && e.payload.questionIndex === questionIndex,
        `QUESTION_REVEALED ${questionIndex} for ${bot.name}`,
      );
      assert.equal(reveal.payload.correctOptionId, 'a');
      assert.equal('optionCounts' in reveal.payload, false, 'Host-only data on players channel');
      const results = reveal.payload.results as { nickname: string; points: number }[];
      const mine = results.find((r) => r.nickname === bot.name);
      assert.ok(mine, `${bot.name} missing from results`);
      // Correct and well inside the 20 s Time Limit: more than 500 points. Wrong: 0 (FR-7.1, 7.2).
      if (bot.option === 'a')
        assert.ok(mine.points > 500 && mine.points <= 1000, `${bot.name} points`);
      else assert.equal(mine.points, 0);
      pointsByName[bot.name] = (pointsByName[bot.name] ?? 0) + mine.points;
    }
    step(`Question ${questionIndex + 1}: opened, answered, revealed`);
  }

  await expectOk('POST', `/api/games/${gameId}/next`, { token: host.idToken });
  const finished = await bots[0]!.events.waitFor(
    (e) => e.type === 'GAME_FINISHED',
    'GAME_FINISHED',
  );
  const board = finished.payload.leaderboard as { nickname: string; score: number; rank: number }[];
  assert.equal(board.length, 3);
  for (const entry of board) assert.equal(entry.score, pointsByName[entry.nickname]);
  assert.equal(board.find((e) => e.nickname === 'Bob')?.rank, 3);
  for (let i = 1; i < board.length; i++) assert.ok(board[i - 1]!.score >= board[i]!.score);
  step(`Game finished: ${board.map((e) => `${e.rank}. ${e.nickname} ${e.score}`).join(', ')}`);

  const active = await expectOk('GET', '/api/games/active', { token: host.idToken });
  assert.equal(active.gameId, null, "the Host's active-Game slot should be free");

  console.log('\nSMOKE TEST PASSED');
} catch (err) {
  console.error('\nSMOKE TEST FAILED:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  for (const c of clients) c.close();
}
