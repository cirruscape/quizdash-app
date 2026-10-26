// Behaviour every GameRepository must have (seam S3). Run against the in-memory repository on
// every test run, and against DynamoDB on demand, so the fake used by the service tests stays
// faithful to the real thing.
import { createGame, type Game, type Quiz } from '@quizapp/domain';
import { beforeEach, describe, expect, it } from 'vitest';
import { ConflictError, type GameRepository, type HistoryRecord } from './repository.js';

export const T0 = 1_800_000_000_000;

export function sampleQuiz(quizId = 'quiz1'): Quiz {
  return {
    quizId,
    status: 'READY',
    defaultTimeLimitSeconds: 20,
    questions: [
      {
        questionId: 'qn0',
        text: 'Capital of Australia?',
        options: [
          { optionId: 'a', text: 'Canberra' },
          { optionId: 'b', text: 'Sydney' },
        ],
        correctOptionId: 'a',
      },
    ],
  };
}

/** Game IDs are unique per test run, so the DynamoDB run never collides with old data. */
let counter = 0;
function uniqueId(prefix: string): string {
  counter += 1;
  return `${prefix}-${process.pid}-${Date.now()}-${counter}`;
}

export function sampleGame(gameId = uniqueId('game'), hostId = uniqueId('host')): Game {
  return createGame({ gameId, hostId, joinCode: 'ABC234', quiz: sampleQuiz(), now: T0 });
}

export function repositoryContract(name: string, makeRepository: () => GameRepository): void {
  describe(`${name} repository contract`, () => {
    let repo: GameRepository;
    beforeEach(() => {
      repo = makeRepository();
    });

    it('reads back a created Game at version 1', async () => {
      const game = sampleGame();
      await repo.createGame(game);
      expect(await repo.getGame(game.gameId)).toEqual({ game, version: 1 });
    });

    it('returns null for an unknown Game, and refuses to create a Game ID twice', async () => {
      expect(await repo.getGame('no-such-game')).toBeNull();
      const game = sampleGame();
      await repo.createGame(game);
      await expect(repo.createGame(game)).rejects.toBeInstanceOf(ConflictError);
    });

    it('saves only against the version that was read, bumping it each time', async () => {
      const game = sampleGame();
      await repo.createGame(game);
      const renamed = { ...game, joinCode: 'XYZ789' };

      expect(await repo.saveGame(renamed, 1)).toBe(2);
      expect(await repo.getGame(game.gameId)).toEqual({ game: renamed, version: 2 });

      // A writer that read version 1 has lost the race.
      await expect(repo.saveGame(game, 1)).rejects.toBeInstanceOf(ConflictError);
      expect((await repo.getGame(game.gameId))?.game.joinCode).toBe('XYZ789');
    });

    it('lets one Game at a time claim a Join Code, and frees it on release', async () => {
      const code = uniqueId('code');
      expect(await repo.claimJoinCode(code, 'game-a')).toBe(true);
      expect(await repo.claimJoinCode(code, 'game-b')).toBe(false);
      expect(await repo.findGameIdByJoinCode(code)).toBe('game-a');

      await repo.releaseJoinCode(code);
      expect(await repo.findGameIdByJoinCode(code)).toBeNull();
      expect(await repo.claimJoinCode(code, 'game-b')).toBe(true);
    });

    it('lets a Host hold one active Game, released only by that same Game', async () => {
      const hostId = uniqueId('host');
      expect(await repo.claimActiveGame(hostId, 'game-a')).toBe(true);
      expect(await repo.claimActiveGame(hostId, 'game-b')).toBe(false);
      expect(await repo.getActiveGameId(hostId)).toBe('game-a');

      await repo.releaseActiveGame(hostId, 'game-b'); // not the holder: no effect
      expect(await repo.getActiveGameId(hostId)).toBe('game-a');

      await repo.releaseActiveGame(hostId, 'game-a');
      expect(await repo.getActiveGameId(hostId)).toBeNull();
      expect(await repo.claimActiveGame(hostId, 'game-b')).toBe(true);
    });

    it("stores Quizzes per Host, so one Host can't read another's", async () => {
      const [owner, other] = [uniqueId('host'), uniqueId('host')];
      const quiz = sampleQuiz(uniqueId('quiz'));
      await repo.putQuiz(owner, quiz);

      expect(await repo.getQuiz(owner, quiz.quizId)).toEqual(quiz);
      expect(await repo.getQuiz(other, quiz.quizId)).toBeNull();
    });

    it("lists a Host's own Quizzes, and only theirs", async () => {
      const [owner, other] = [uniqueId('host'), uniqueId('host')];
      const [a, b] = [sampleQuiz(uniqueId('quiz')), sampleQuiz(uniqueId('quiz'))];
      await repo.putQuiz(owner, a);
      await repo.putQuiz(owner, b);
      await repo.putQuiz(other, sampleQuiz(uniqueId('quiz')));

      const listed = await repo.listQuizzes(owner);
      expect(listed.map((q) => q.quizId).sort()).toEqual([a.quizId, b.quizId].sort());
      expect(await repo.listQuizzes(uniqueId('host'))).toEqual([]);
    });

    it("keeps a Host's History newest first, private to that Host", async () => {
      const [owner, other] = [uniqueId('host'), uniqueId('host')];
      const record = (gameId: string, finishedAt: number): HistoryRecord => ({
        gameId,
        hostId: owner,
        quizId: 'quiz1',
        topic: 'Capitals',
        finishedAt,
        abandoned: false,
        questions: [
          {
            text: 'Capital of Australia?',
            options: [
              { optionId: 'a', text: 'Canberra' },
              { optionId: 'b', text: 'Sydney' },
            ],
            correctOptionId: 'a',
            optionCounts: { a: 2, b: 1 },
          },
        ],
        leaderboard: [{ playerId: 'p1', nickname: 'Alice', score: 975, rank: 1 }],
      });
      const [older, newer] = [record(uniqueId('game'), T0), record(uniqueId('game'), T0 + 60_000)];
      await repo.putHistory(older);
      await repo.putHistory(newer);

      expect(await repo.listHistory(owner)).toEqual([newer, older]);
      expect(await repo.getHistory(owner, older.gameId)).toEqual(older);
      expect(await repo.listHistory(other)).toEqual([]);
      expect(await repo.getHistory(other, older.gameId)).toBeNull();
    });

    it('saves a Quiz only against the version that was read, and can delete it', async () => {
      const hostId = uniqueId('host');
      const quiz = sampleQuiz(uniqueId('quiz'));
      await repo.putQuiz(hostId, quiz);
      expect(await repo.getStoredQuiz(hostId, quiz.quizId)).toEqual({ quiz, version: 1 });

      const edited = { ...quiz, topic: 'Edited' };
      expect(await repo.saveQuiz(hostId, edited, 1)).toBe(2);
      await expect(repo.saveQuiz(hostId, quiz, 1)).rejects.toBeInstanceOf(ConflictError);
      expect(await repo.getQuiz(hostId, quiz.quizId)).toEqual(edited);

      await repo.deleteQuiz(hostId, quiz.quizId);
      expect(await repo.getQuiz(hostId, quiz.quizId)).toBeNull();
      expect(await repo.listQuizzes(hostId)).toEqual([]);
    });

    it("counts a Host's generations per day, up to the limit, atomically", async () => {
      const [hostId, other] = [uniqueId('host'), uniqueId('host')];
      const results = await Promise.all(
        [1, 2, 3, 4].map(() => repo.useGeneration(hostId, '2026-10-26', 3, T0)),
      );
      expect(results.filter(Boolean)).toHaveLength(3); // never four, even at once
      expect(await repo.useGeneration(hostId, '2026-10-26', 3, T0)).toBe(false);
      expect(await repo.useGeneration(hostId, '2026-10-27', 3, T0)).toBe(true); // a new day
      expect(await repo.useGeneration(other, '2026-10-26', 3, T0)).toBe(true); // a different Host
    });
  });
}
