// In-memory GameRepository for tests (seam S3). Values are deep-copied in and out, so callers
// can't mutate stored state, just as with a real database.
import type { Game, Quiz } from '@quizapp/domain';
import {
  ConflictError,
  type GameRepository,
  type HistoryRecord,
  type StoredGame,
} from './repository.js';

export class MemoryRepository implements GameRepository {
  private readonly quizzes = new Map<string, { quiz: Quiz; version: number }>();
  private readonly generations = new Map<string, number>();
  private readonly games = new Map<string, StoredGame>();
  private readonly joinCodes = new Map<string, string>();
  private readonly activeGames = new Map<string, string>();
  private readonly history = new Map<string, HistoryRecord>();

  /** Test inspection: every Join Code currently claimed. */
  heldJoinCodes(): string[] {
    return [...this.joinCodes.keys()];
  }

  async putQuiz(hostId: string, quiz: Quiz): Promise<void> {
    this.quizzes.set(`${hostId}/${quiz.quizId}`, { quiz: structuredClone(quiz), version: 1 });
  }

  async getQuiz(hostId: string, quizId: string): Promise<Quiz | null> {
    return (await this.getStoredQuiz(hostId, quizId))?.quiz ?? null;
  }

  async getStoredQuiz(hostId: string, quizId: string) {
    const stored = this.quizzes.get(`${hostId}/${quizId}`);
    return stored ? structuredClone(stored) : null;
  }

  async saveQuiz(hostId: string, quiz: Quiz, expectedVersion: number): Promise<number> {
    const key = `${hostId}/${quiz.quizId}`;
    if (this.quizzes.get(key)?.version !== expectedVersion) {
      throw new ConflictError(`quiz ${quiz.quizId} is not at version ${expectedVersion}`);
    }
    this.quizzes.set(key, { quiz: structuredClone(quiz), version: expectedVersion + 1 });
    return expectedVersion + 1;
  }

  async deleteQuiz(hostId: string, quizId: string): Promise<void> {
    this.quizzes.delete(`${hostId}/${quizId}`);
  }

  async useGeneration(hostId: string, day: string, limit: number): Promise<boolean> {
    const key = `${hostId}/${day}`;
    const used = this.generations.get(key) ?? 0;
    if (used >= limit) return false;
    this.generations.set(key, used + 1);
    return true;
  }

  async listQuizzes(hostId: string): Promise<Quiz[]> {
    return [...this.quizzes.entries()]
      .filter(([key]) => key.startsWith(`${hostId}/`))
      .map(([, stored]) => structuredClone(stored.quiz));
  }

  async getGame(gameId: string): Promise<StoredGame | null> {
    const stored = this.games.get(gameId);
    return stored ? structuredClone(stored) : null;
  }

  async createGame(game: Game): Promise<void> {
    if (this.games.has(game.gameId)) throw new ConflictError(`game ${game.gameId} exists`);
    this.games.set(game.gameId, { game: structuredClone(game), version: 1 });
  }

  async saveGame(game: Game, expectedVersion: number): Promise<number> {
    const current = this.games.get(game.gameId);
    if (!current || current.version !== expectedVersion) {
      throw new ConflictError(`game ${game.gameId} is not at version ${expectedVersion}`);
    }
    const version = expectedVersion + 1;
    this.games.set(game.gameId, { game: structuredClone(game), version });
    return version;
  }

  async claimJoinCode(joinCode: string, gameId: string): Promise<boolean> {
    if (this.joinCodes.has(joinCode)) return false;
    this.joinCodes.set(joinCode, gameId);
    return true;
  }

  async findGameIdByJoinCode(joinCode: string): Promise<string | null> {
    return this.joinCodes.get(joinCode) ?? null;
  }

  async releaseJoinCode(joinCode: string): Promise<void> {
    this.joinCodes.delete(joinCode);
  }

  async claimActiveGame(hostId: string, gameId: string): Promise<boolean> {
    if (this.activeGames.has(hostId)) return false;
    this.activeGames.set(hostId, gameId);
    return true;
  }

  async getActiveGameId(hostId: string): Promise<string | null> {
    return this.activeGames.get(hostId) ?? null;
  }

  async releaseActiveGame(hostId: string, gameId: string): Promise<void> {
    if (this.activeGames.get(hostId) === gameId) this.activeGames.delete(hostId);
  }

  async listIdleGameIds(cutoff: number): Promise<string[]> {
    return [...this.games.values()]
      .filter(({ game }) => game.phase !== 'FINISHED' && game.lastActivityAt <= cutoff)
      .map(({ game }) => game.gameId);
  }

  async putHistory(record: HistoryRecord): Promise<void> {
    this.history.set(`${record.hostId}/${record.gameId}`, structuredClone(record));
  }

  async listHistory(hostId: string): Promise<HistoryRecord[]> {
    return [...this.history.values()]
      .filter((r) => r.hostId === hostId)
      .sort((a, b) => b.finishedAt - a.finishedAt)
      .map((r) => structuredClone(r));
  }

  async getHistory(hostId: string, gameId: string): Promise<HistoryRecord | null> {
    const record = this.history.get(`${hostId}/${gameId}`);
    return record ? structuredClone(record) : null;
  }
}
