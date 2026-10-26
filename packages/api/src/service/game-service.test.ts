import { describe, expect, it } from 'vitest';
import { MemoryRepository } from '../repository/memory-repository.js';
import { ConflictError } from '../repository/repository.js';
import { sampleQuiz, T0 } from '../repository/repository.contract.js';
import type { ChannelMessage } from './events.js';
import { createGameService, type GameService, type ServiceDeps } from './game-service.js';

interface Harness {
  service: GameService;
  repo: MemoryRepository;
  clock: { now: number };
  /** Every message the service asked to publish, in order. */
  published: ChannelMessage[];
}

function harness(overrides: Partial<ServiceDeps> = {}): Harness {
  const repo = new MemoryRepository();
  const clock = { now: T0 };
  const published: ChannelMessage[] = [];
  let ids = 0;
  const service = createGameService({
    repo,
    now: () => clock.now,
    newId: () => `id${++ids}`,
    random: Math.random,
    issuePlayerToken: ({ gameId, playerId }) => `token:${gameId}:${playerId}`,
    publish: async (messages) => {
      published.push(...messages);
    },
    ...overrides,
  });
  return { service, repo, clock, published };
}

/** A harness with one Game in its Lobby, created by HOST from a Ready one-Question Quiz. */
async function withGame(overrides: Partial<ServiceDeps> = {}) {
  const h = harness(overrides);
  await h.repo.putQuiz(HOST, sampleQuiz('quiz1'));
  const created = await h.service.createGame(HOST, 'quiz1');
  if (!created.ok) throw new Error(created.error);
  return { ...h, ...created.value };
}

const HOST = 'host-1';

describe('createGame', () => {
  it("creates a Game in its Lobby from the Host's Ready Quiz, claiming a Join Code", async () => {
    const { service, repo } = harness();
    await repo.putQuiz(HOST, sampleQuiz('quiz1'));

    const result = await service.createGame(HOST, 'quiz1');
    if (!result.ok) throw new Error(result.error);
    const { gameId, joinCode } = result.value;

    expect(joinCode).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(await repo.findGameIdByJoinCode(joinCode)).toBe(gameId);
    expect(await repo.getActiveGameId(HOST)).toBe(gameId);
    expect((await repo.getGame(gameId))?.game).toMatchObject({
      hostId: HOST,
      phase: 'LOBBY',
      joinCode,
    });
  });

  it("refuses another Host's Quiz, and a Quiz that isn't Ready", async () => {
    const { service, repo } = harness();
    await repo.putQuiz('someone-else', sampleQuiz('theirs'));
    await repo.putQuiz(HOST, { ...sampleQuiz('draft'), status: 'DRAFT' });

    expect(await service.createGame(HOST, 'theirs')).toEqual({
      ok: false,
      error: 'QUIZ_NOT_FOUND',
    });
    expect(await service.createGame(HOST, 'draft')).toEqual({ ok: false, error: 'QUIZ_NOT_READY' });
    expect(await repo.getActiveGameId(HOST)).toBeNull();
  });

  it('refuses a second Game while the Host has one unfinished, without stranding a Join Code', async () => {
    const { service, repo } = harness();
    await repo.putQuiz(HOST, sampleQuiz('quiz1'));
    const first = await service.createGame(HOST, 'quiz1');

    expect(await service.createGame(HOST, 'quiz1')).toEqual({
      ok: false,
      error: 'ACTIVE_GAME_EXISTS',
    });
    expect(repo.heldJoinCodes()).toEqual([first.ok && first.value.joinCode]);
  });

  it('picks another Join Code when the first one is held by another Game', async () => {
    // The first six draws spell AAAAAA; later draws spell something else.
    let draws = 0;
    const { service, repo } = harness({ random: () => (draws++ < 6 ? 0 : 0.99) });
    await repo.putQuiz(HOST, sampleQuiz('quiz1'));
    await repo.claimJoinCode('AAAAAA', 'someone-elses-game');

    const result = await service.createGame(HOST, 'quiz1');
    if (!result.ok) throw new Error(result.error);
    expect(result.value.joinCode).not.toBe('AAAAAA');
    expect(await repo.findGameIdByJoinCode(result.value.joinCode)).toBe(result.value.gameId);
    expect(await repo.findGameIdByJoinCode('AAAAAA')).toBe('someone-elses-game');
  });

  it("gives up after repeated Join Code collisions, releasing the Host's claim", async () => {
    const { service, repo } = harness({ random: () => 0 }); // always AAAAAA
    await repo.putQuiz(HOST, sampleQuiz('quiz1'));
    await repo.claimJoinCode('AAAAAA', 'someone-elses-game');

    expect(await service.createGame(HOST, 'quiz1')).toEqual({
      ok: false,
      error: 'JOIN_CODE_UNAVAILABLE',
    });
    expect(await repo.getActiveGameId(HOST)).toBeNull();
  });
});

describe('joinGame', () => {
  it('joins a Player by Join Code, returns their token, and tells the Host', async () => {
    const { service, published, gameId, joinCode } = await withGame();

    const result = await service.joinGame(joinCode, '  Quiz Whiz ');
    if (!result.ok) throw new Error(result.error);
    const { playerId, playerToken } = result.value;

    expect(result.value.gameId).toBe(gameId);
    expect(playerToken).toBe(`token:${gameId}:${playerId}`);
    expect(published).toEqual([
      {
        channel: `/game/${gameId}/host`,
        event: {
          type: 'PLAYER_JOINED',
          gameId,
          version: 2,
          serverNow: T0,
          payload: { playerId, nickname: 'Quiz Whiz', playerCount: 1 },
        },
      },
    ]);
  });

  it('lets two Players who join at the same moment both in, retrying the lost write', async () => {
    const { service, repo, gameId, joinCode } = await withGame();

    const results = await Promise.all([
      service.joinGame(joinCode, 'Alice'),
      service.joinGame(joinCode, 'Bob'),
    ]);

    expect(results.map((r) => r.ok)).toEqual([true, true]);
    const players = (await repo.getGame(gameId))?.game.players.map((p) => p.nickname);
    expect(players?.sort()).toEqual(['Alice', 'Bob']);
  });

  it('refuses an unknown Join Code, a malformed Nickname, and a taken one', async () => {
    const { service, joinCode } = await withGame();
    await service.joinGame(joinCode, 'Alice');

    expect(await service.joinGame('ZZZZZZ', 'Bob')).toEqual({ ok: false, error: 'GAME_NOT_FOUND' });
    expect(await service.joinGame(joinCode, 'B!')).toEqual({ ok: false, error: 'NICKNAME_FORMAT' });
    expect(await service.joinGame(joinCode, 'alice')).toEqual({
      ok: false,
      error: 'NICKNAME_TAKEN',
    });
  });

  it('gives up after repeated write conflicts, publishing nothing', async () => {
    const { service, repo, published, joinCode } = await withGame();
    repo.saveGame = async () => {
      throw new ConflictError();
    };
    published.length = 0;

    expect(await service.joinGame(joinCode, 'Alice')).toEqual({
      ok: false,
      error: 'TOO_MANY_CONFLICTS',
    });
    expect(published).toEqual([]);
  });
});

describe('hostCommand', () => {
  it("refuses another Host's commands, and publishes nothing for them", async () => {
    const { service, published, gameId, joinCode } = await withGame();
    await service.joinGame(joinCode, 'Alice');
    published.length = 0;

    expect(await service.hostCommand('intruder', gameId, { type: 'Start' })).toEqual({
      ok: false,
      error: 'NOT_YOUR_GAME',
    });
    expect(published).toEqual([]);
  });

  it("starts the owner's Game, opening the first Question on the players channel", async () => {
    const { service, published, gameId, joinCode } = await withGame();
    await service.joinGame(joinCode, 'Alice');
    published.length = 0;

    expect((await service.hostCommand(HOST, gameId, { type: 'Start' })).ok).toBe(true);
    expect(published).toEqual([
      {
        channel: `/game/${gameId}/players`,
        event: expect.objectContaining({
          type: 'QUESTION_OPENED',
          version: 3,
          payload: expect.objectContaining({ questionIndex: 0, text: 'Capital of Australia?' }),
        }),
      },
    ]);
  });
});

/** A Game with the given Players joined and its first Question open. */
async function startedGame(...nicknames: string[]) {
  const h = await withGame();
  const players: Record<string, { gameId: string; playerId: string }> = {};
  for (const n of nicknames) {
    const joined = await h.service.joinGame(h.joinCode, n);
    if (!joined.ok) throw new Error(joined.error);
    players[n] = { gameId: h.gameId, playerId: joined.value.playerId };
  }
  const started = await h.service.hostCommand(HOST, h.gameId, { type: 'Start' });
  if (!started.ok) throw new Error(started.error);
  h.published.length = 0;
  return { ...h, players };
}

describe('submitAnswer', () => {
  it('counts an Answer for the Host, and reveals Option counts only on the host channel', async () => {
    const { service, published, gameId, players } = await startedGame('Alice', 'Bob');

    expect((await service.submitAnswer(players.Alice!, 0, 'a')).ok).toBe(true);
    expect(published.map((m) => [m.channel, m.event.type])).toEqual([
      [`/game/${gameId}/host`, 'ANSWER_COUNT'],
    ]);

    published.length = 0;
    await service.submitAnswer(players.Bob!, 0, 'b'); // last Answer: Reveal
    expect(published.map((m) => [m.channel, m.event.type])).toEqual([
      [`/game/${gameId}/host`, 'ANSWER_COUNT'],
      [`/game/${gameId}/players`, 'QUESTION_REVEALED'],
      [`/game/${gameId}/host`, 'QUESTION_REVEALED_HOST'],
    ]);
    const onPlayersChannel = published.filter((m) => m.channel.endsWith('/players'));
    expect(JSON.stringify(onPlayersChannel)).not.toContain('optionCounts');
  });
});

describe('finishing', () => {
  it("frees the Join Code and the Host's active-Game slot when the Game finishes", async () => {
    const { service, repo, gameId, joinCode, players } = await startedGame('Alice');
    await service.submitAnswer(players.Alice!, 0, 'a'); // only Player: Reveal

    const finished = await service.hostCommand(HOST, gameId, { type: 'Next' }); // last Question
    expect(finished.ok && finished.value.phase).toBe('FINISHED');

    expect(await repo.findGameIdByJoinCode(joinCode)).toBeNull();
    expect(await repo.getActiveGameId(HOST)).toBeNull();
    expect((await service.createGame(HOST, 'quiz1')).ok).toBe(true);
  });
});

describe('playerSnapshot', () => {
  it('shows the open Question and my own Answer, but never the correct Option', async () => {
    const { service, players, clock } = await startedGame('Alice', 'Bob');

    const before = await service.playerSnapshot(players.Alice!);
    expect(before).toEqual({
      ok: true,
      value: {
        version: 4,
        phase: 'QUESTION_OPEN',
        me: { playerId: players.Alice!.playerId, nickname: 'Alice', score: 0 },
        question: {
          questionIndex: 0,
          questionCount: 1,
          text: 'Capital of Australia?',
          options: [
            { optionId: 'a', text: 'Canberra' },
            { optionId: 'b', text: 'Sydney' },
          ],
          deadline: T0 + 20_000,
          myAnswer: null,
        },
        reveal: null,
        leaderboard: null,
        serverNow: T0,
      },
    });
    expect(JSON.stringify(before)).not.toContain('correct');

    clock.now = T0 + 2_000;
    await service.submitAnswer(players.Alice!, 0, 'b');
    const after = await service.playerSnapshot(players.Alice!);
    expect(after.ok && after.value.question?.myAnswer).toBe('b');
  });
});

describe('playerSnapshot during Reveal', () => {
  it('shows the correct Option and my points and rank, as at Reveal', async () => {
    const { service, players, clock } = await startedGame('Alice', 'Bob');
    clock.now = T0 + 10_000;
    await service.submitAnswer(players.Alice!, 0, 'a'); // correct at 10 of 20 s: 750
    await service.submitAnswer(players.Bob!, 0, 'b'); // wrong; everyone answered: Reveal

    const snapshot = await service.playerSnapshot(players.Bob!);
    expect(snapshot.ok && snapshot.value).toMatchObject({
      phase: 'REVEAL',
      reveal: { correctOptionId: 'a', myPoints: 0, myRank: 2 },
    });
    const alice = await service.playerSnapshot(players.Alice!);
    expect(alice.ok && alice.value).toMatchObject({
      me: { score: 750 },
      reveal: { myPoints: 750, myRank: 1 },
    });
  });
});

describe('playerSnapshot edge cases', () => {
  it('tells a removed Player they were removed', async () => {
    const { service, gameId, players } = await startedGame('Alice', 'Bob');
    await service.hostCommand(HOST, gameId, {
      type: 'RemovePlayer',
      playerId: players.Bob!.playerId,
    });
    expect(await service.playerSnapshot(players.Bob!)).toEqual({
      ok: false,
      error: 'PLAYER_REMOVED',
    });
  });

  it('includes the final Leaderboard once the Game is Finished', async () => {
    const { service, gameId, players } = await startedGame('Alice');
    await service.submitAnswer(players.Alice!, 0, 'a'); // instant and correct: 1000
    await service.hostCommand(HOST, gameId, { type: 'Next' });

    const snapshot = await service.playerSnapshot(players.Alice!);
    expect(snapshot.ok && snapshot.value).toMatchObject({
      phase: 'FINISHED',
      leaderboard: [{ nickname: 'Alice', score: 1000, rank: 1 }],
    });
  });
});

describe('hostSnapshot', () => {
  it('shows the owner the Join Code and Players, and refuses anyone else', async () => {
    const { service, gameId, joinCode } = await withGame();
    await service.joinGame(joinCode, 'Alice');

    expect(await service.hostSnapshot('intruder', gameId)).toEqual({
      ok: false,
      error: 'NOT_YOUR_GAME',
    });
    const snapshot = await service.hostSnapshot(HOST, gameId);
    expect(snapshot.ok && snapshot.value).toMatchObject({
      gameId,
      joinCode,
      phase: 'LOBBY',
      players: [{ nickname: 'Alice', score: 0 }],
    });
  });

  it('shows the answered count during a Question, and Option counts only from Reveal', async () => {
    const { service, gameId, players } = await startedGame('Alice', 'Bob');
    await service.submitAnswer(players.Alice!, 0, 'b');

    const open = await service.hostSnapshot(HOST, gameId);
    expect(open.ok && open.value).toMatchObject({
      phase: 'QUESTION_OPEN',
      answered: { answered: 1, total: 2 },
      reveal: null,
    });
    expect(JSON.stringify(open)).not.toContain('correct');

    await service.submitAnswer(players.Bob!, 0, 'a');
    const revealed = await service.hostSnapshot(HOST, gameId);
    expect(revealed.ok && revealed.value).toMatchObject({
      phase: 'REVEAL',
      reveal: { correctOptionId: 'a', optionCounts: { a: 1, b: 1 } },
    });
  });
});

describe('activeGame', () => {
  it("finds the Host's unfinished Game so any of their devices can resume it", async () => {
    const h = harness();
    expect(await h.service.activeGame(HOST)).toEqual({ ok: true, value: null });

    await h.repo.putQuiz(HOST, sampleQuiz('quiz1'));
    const created = await h.service.createGame(HOST, 'quiz1');
    const gameId = created.ok && created.value.gameId;
    expect(await h.service.activeGame(HOST)).toEqual({ ok: true, value: { gameId } });
  });
});

describe('snapshot versions', () => {
  it("carry the Game's version, so clients can ignore out-of-date responses", async () => {
    const { service, gameId, players } = await startedGame('Alice');
    // created (1), Alice joined (2), started (3)
    const player = await service.playerSnapshot(players.Alice!);
    const host = await service.hostSnapshot(HOST, gameId);
    expect(player.ok && player.value.version).toBe(3);
    expect(host.ok && host.value.version).toBe(3);
  });
});

describe('Game History', () => {
  it('records a finished Game, and lets only its Host list and open it', async () => {
    const { service, gameId, players, clock } = await startedGame('Alice', 'Bob');
    clock.now = T0 + 10_000;
    await service.submitAnswer(players.Alice!, 0, 'a'); // correct at 10 of 20 s: 750
    await service.submitAnswer(players.Bob!, 0, 'b'); // wrong: 0; Reveal
    clock.now = T0 + 15_000;
    await service.hostCommand(HOST, gameId, { type: 'Next' }); // last Question: Finished

    expect(await service.getHistory(HOST, gameId)).toEqual({
      ok: true,
      value: {
        gameId,
        hostId: HOST,
        quizId: 'quiz1',
        topic: null,
        finishedAt: T0 + 15_000,
        abandoned: false,
        questions: [
          {
            text: 'Capital of Australia?',
            options: [
              { optionId: 'a', text: 'Canberra' },
              { optionId: 'b', text: 'Sydney' },
            ],
            correctOptionId: 'a',
            optionCounts: { a: 1, b: 1 },
          },
        ],
        leaderboard: [
          { playerId: players.Alice!.playerId, nickname: 'Alice', score: 750, rank: 1 },
          { playerId: players.Bob!.playerId, nickname: 'Bob', score: 0, rank: 2 },
        ],
      },
    });
    expect(await service.listHistory(HOST)).toEqual({
      ok: true,
      value: [
        {
          gameId,
          topic: null,
          finishedAt: T0 + 15_000,
          abandoned: false,
          playerCount: 2,
          winner: 'Alice',
        },
      ],
    });
    expect(await service.getHistory('intruder', gameId)).toEqual({
      ok: false,
      error: 'HISTORY_NOT_FOUND',
    });
    expect(await service.listHistory('intruder')).toEqual({ ok: true, value: [] });
  });
});
