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

/**
 * Generates a real Quiz end to end (M3): the API, the worker Lambda, AgentCore and Bedrock.
 * Approves it if it has enough Questions, then deletes it. Skips if the smoke Host has used
 * today's generations (many deploys in one day), since that's the limit working, not a fault.
 */
async function smokeGeneration(token: string): Promise<void> {
  const created = await call('POST', '/api/quizzes', {
    token,
    body: {
      topic: 'The solar system',
      difficulty: 'EASY',
      questionCount: 5,
      defaultTimeLimitSeconds: 20,
    },
  });
  if (created.status === 429) {
    step('Quiz generation skipped: the smoke Host has used today’s generations');
    return;
  }
  assert.equal(
    created.status,
    202,
    `POST /api/quizzes -> ${created.status} ${JSON.stringify(created.json)}`,
  );
  const quizId = created.json.quizId as string;

  const giveUpAt = Date.now() + 180_000;
  let quiz: { status: string; questions: unknown[]; failureReason?: string | null } | undefined;
  while (Date.now() < giveUpAt) {
    quiz = (await expectOk('GET', `/api/quizzes/${quizId}`, { token })) as typeof quiz;
    if (quiz?.status !== 'GENERATING') break;
    await new Promise((r) => setTimeout(r, 3_000));
  }
  assert.equal(
    quiz?.status,
    'DRAFT',
    `generation ended as ${quiz?.status} (${quiz?.failureReason})`,
  );
  const count = quiz?.questions.length ?? 0;
  if (count >= 5) {
    const approved = await expectOk('POST', `/api/quizzes/${quizId}/approve`, { token });
    assert.equal(approved.status, 'READY');
  }
  await expectOk('DELETE', `/api/quizzes/${quizId}`, { token });
  step(`generated a ${count}-Question Draft${count >= 5 ? ', approved it' : ''}, and deleted it`);
}

/** Pushed events expected, and how many AppSync dropped (it's at-most-once delivery). */
let expected = 0;
let lost = 0;

/**
 * Waits for a pushed event, like a real client. AppSync Events delivers at most once, so if the
 * event doesn't arrive, fall back to the snapshot, which is the source of truth (PLAN §2).
 */
async function eventOrSnapshot<T>(
  client: EventsClient,
  match: (e: GameEventEnvelope) => boolean,
  what: string,
  fromEvent: (e: GameEventEnvelope) => T,
  fromSnapshot: () => Promise<T | undefined>,
): Promise<T> {
  expected += 1;
  try {
    return fromEvent(await client.waitFor(match, what, 5_000));
  } catch (err) {
    if (!(err instanceof Error && err.message.startsWith('timed out'))) throw err;
  }
  lost += 1;
  step(`  (event lost: ${what}; recovering from the snapshot)`);
  const giveUpAt = Date.now() + 10_000;
  while (Date.now() < giveUpAt) {
    const value = await fromSnapshot();
    if (value !== undefined) return value;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`neither the event nor the snapshot showed ${what}`);
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
  // Nickname moderation (FR-5.3): the real Comprehend check refuses an abusive Nickname.
  const abusive = await call('POST', '/api/join', { body: { joinCode, nickname: 'stupid idiot' } });
  assert.deepEqual([abusive.status, abusive.json], [400, { error: 'NICKNAME_REJECTED' }]);
  step('an abusive Nickname was refused');

  await hostEvents.waitFor(
    (e) => e.type === 'PLAYER_JOINED' && e.payload.playerCount === 3,
    'three PLAYER_JOINED',
  );
  step('three bot Players joined and subscribed');

  const pointsByName: Record<string, number> = { Alice: 0, Bob: 0, Cara: 0 };
  const playerSnapshot = (bot: { token: string }) =>
    expectOk('GET', '/api/play', { token: bot.token });
  const hostSnapshot = () => expectOk('GET', `/api/games/${gameId}`, { token: host.idToken });
  const questionIndexOf = (snapshot: Record<string, unknown>) =>
    (snapshot.question as { questionIndex?: number } | null)?.questionIndex;

  for (let questionIndex = 0; questionIndex < quiz.questions.length; questionIndex++) {
    const command = questionIndex === 0 ? 'start' : 'next';
    await expectOk('POST', `/api/games/${gameId}/${command}`, { token: host.idToken });

    for (const bot of bots) {
      await eventOrSnapshot(
        bot.events,
        (e) => e.type === 'QUESTION_OPENED' && e.payload.questionIndex === questionIndex,
        `QUESTION_OPENED ${questionIndex} for ${bot.name}`,
        (e) => {
          assert.equal(JSON.stringify(e).includes('correct'), false, 'correct Option leaked');
          return true;
        },
        async () => {
          const snap = await playerSnapshot(bot);
          return snap.phase === 'QUESTION_OPEN' && questionIndexOf(snap) === questionIndex
            ? true
            : undefined;
        },
      );
      await expectOk('POST', '/api/play/answers', {
        token: bot.token,
        body: { questionIndex, optionId: bot.option },
      });
    }

    // Everyone answered, so the Question closes early.
    const optionCounts = await eventOrSnapshot(
      hostEvents,
      (e) => e.type === 'QUESTION_REVEALED_HOST' && e.payload.questionIndex === questionIndex,
      `QUESTION_REVEALED_HOST ${questionIndex}`,
      (e) => e.payload.optionCounts,
      async () => {
        const snap = await hostSnapshot();
        const reveal = snap.reveal as { optionCounts: unknown } | null;
        return snap.phase === 'REVEAL' && questionIndexOf(snap) === questionIndex
          ? reveal?.optionCounts
          : undefined;
      },
    );
    assert.deepEqual(optionCounts, { a: 2, b: 1, c: 0, d: 0 });

    for (const bot of bots) {
      const mine = await eventOrSnapshot(
        bot.events,
        (e) => e.type === 'QUESTION_REVEALED' && e.payload.questionIndex === questionIndex,
        `QUESTION_REVEALED ${questionIndex} for ${bot.name}`,
        (e) => {
          assert.equal('optionCounts' in e.payload, false, 'Host-only data on players channel');
          const results = e.payload.results as { nickname: string; points: number }[];
          const entry = results.find((r) => r.nickname === bot.name);
          assert.ok(entry, `${bot.name} missing from results`);
          return { correctOptionId: e.payload.correctOptionId, points: entry.points };
        },
        async () => {
          const snap = await playerSnapshot(bot);
          const reveal = snap.reveal as { correctOptionId: string; myPoints: number } | null;
          return snap.phase === 'REVEAL' && questionIndexOf(snap) === questionIndex && reveal
            ? { correctOptionId: reveal.correctOptionId, points: reveal.myPoints }
            : undefined;
        },
      );
      assert.equal(mine.correctOptionId, 'a');
      // Correct and well inside the 20 s Time Limit: more than 500 points. Wrong: 0 (FR-7.1, 7.2).
      if (bot.option === 'a') {
        assert.ok(mine.points > 500 && mine.points <= 1000, `${bot.name} points ${mine.points}`);
      } else {
        assert.equal(mine.points, 0);
      }
      pointsByName[bot.name] = (pointsByName[bot.name] ?? 0) + mine.points;
    }
    step(`Question ${questionIndex + 1}: opened, answered, revealed`);
  }

  await expectOk('POST', `/api/games/${gameId}/next`, { token: host.idToken });
  const board = (await eventOrSnapshot(
    bots[0]!.events,
    (e) => e.type === 'GAME_FINISHED',
    'GAME_FINISHED',
    (e) => e.payload.leaderboard,
    async () => {
      const snap = await playerSnapshot(bots[0]!);
      return snap.phase === 'FINISHED' ? snap.leaderboard : undefined;
    },
  )) as { nickname: string; score: number; rank: number }[];
  assert.equal(board.length, 3);
  for (const entry of board) assert.equal(entry.score, pointsByName[entry.nickname]);
  assert.equal(board.find((e) => e.nickname === 'Bob')?.rank, 3);
  for (let i = 1; i < board.length; i++) assert.ok(board[i - 1]!.score >= board[i]!.score);
  step(`Game finished: ${board.map((e) => `${e.rank}. ${e.nickname} ${e.score}`).join(', ')}`);
  step(`real-time events lost and recovered from snapshots: ${lost} of ${expected}`);

  // History (FR-9.1): the Game is recorded as played.
  const history = (await expectOk('GET', `/api/history/${gameId}`, { token: host.idToken })) as {
    questions: { optionCounts: Record<string, number> }[];
    leaderboard: { nickname: string; score: number }[];
  };
  assert.equal(history.questions.length, quiz.questions.length);
  for (const q of history.questions) assert.deepEqual(q.optionCounts, { a: 2, b: 1, c: 0, d: 0 });
  for (const entry of history.leaderboard) assert.equal(entry.score, pointsByName[entry.nickname]);
  const past = (await expectOk('GET', '/api/history', { token: host.idToken })) as unknown as {
    gameId: string;
  }[];
  assert.ok(
    past.some((g) => g.gameId === gameId),
    'Game missing from the History list',
  );
  step('History recorded the Game as played');

  await smokeGeneration(host.idToken);

  const active = await expectOk('GET', '/api/games/active', { token: host.idToken });
  assert.equal(active.gameId, null, "the Host's active-Game slot should be free");

  console.log('\nSMOKE TEST PASSED');
} catch (err) {
  console.error('\nSMOKE TEST FAILED:', err instanceof Error ? err.message : err);
  for (const [i, c] of clients.entries()) {
    console.error(`  client ${i === 0 ? 'host' : `bot ${i}`}: ${c.received()}`);
  }
  process.exitCode = 1;
} finally {
  for (const c of clients) c.close();
}
