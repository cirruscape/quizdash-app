// Behaviour every GameRepository must have (seam S3). Run against the in-memory repository on
// every test run, and against DynamoDB on demand, so the fake used by the service tests stays
// faithful to the real thing.
import { createGame, type Game, type Quiz } from '@quizapp/domain';
import { beforeEach, describe, expect, it } from 'vitest';
import { ConflictError, type GameRepository } from './repository.js';

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
  });
}
