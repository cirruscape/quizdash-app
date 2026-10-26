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
  private readonly quizzes = new Map<string, Quiz>();
  private readonly games = new Map<string, StoredGame>();
  private readonly joinCodes = new Map<string, string>();
  private readonly activeGames = new Map<string, string>();
  private readonly history = new Map<string, HistoryRecord>();

  /** Test inspection: every Join Code currently claimed. */
  heldJoinCodes(): string[] {
    return [...this.joinCodes.keys()];
  }

  async putQuiz(hostId: string, quiz: Quiz): Promise<void> {
    this.quizzes.set(`${hostId}/${quiz.quizId}`, structuredClone(quiz));
  }

  async getQuiz(hostId: string, quizId: string): Promise<Quiz | null> {
    const quiz = this.quizzes.get(`${hostId}/${quizId}`);
    return quiz ? structuredClone(quiz) : null;
  }

  async listQuizzes(hostId: string): Promise<Quiz[]> {
    return [...this.quizzes.entries()]
      .filter(([key]) => key.startsWith(`${hostId}/`))
      .map(([, quiz]) => structuredClone(quiz));
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
