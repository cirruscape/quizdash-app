// The storage port for the game service (ADR 0006). Implemented in memory for tests and by
// DynamoDB in deployed environments; both must pass repository.contract.ts.
import type { Game, Instant, LeaderboardEntry, Option, Quiz } from '@quizapp/domain';

export interface StoredGame {
  game: Game;
  /** Optimistic-locking version: 1 when created, +1 on every save. */
  version: number;
}

/** A Finished Game, as kept in its Host's History indefinitely (FR-9.1–9.3). */
export interface HistoryRecord {
  gameId: string;
  hostId: string;
  quizId: string;
  topic: string | null;
  finishedAt: Instant;
  abandoned: boolean;
  /** The Questions that were revealed, as played, with how many Players chose each Option. */
  questions: {
    text: string;
    options: Option[];
    correctOptionId: string;
    optionCounts: Record<string, number>;
  }[];
  leaderboard: LeaderboardEntry[];
}

/** A conditional write lost a race; reload and retry (ADR 0006). */
export class ConflictError extends Error {
  constructor(message = 'conditional write conflict') {
    super(message);
    this.name = 'ConflictError';
  }
}

export interface GameRepository {
  /** Quizzes belong to one Host, and only that Host can read them (FR-1.2). */
  putQuiz(hostId: string, quiz: Quiz): Promise<void>;
  getQuiz(hostId: string, quizId: string): Promise<Quiz | null>;
  listQuizzes(hostId: string): Promise<Quiz[]>;

  getGame(gameId: string): Promise<StoredGame | null>;
  /** Stores a new Game at version 1. Throws ConflictError if the gameId exists. */
  createGame(game: Game): Promise<void>;
  /**
   * Replaces the Game if it is still at `expectedVersion`, returning the new version.
   * Throws ConflictError if another writer got there first.
   */
  saveGame(game: Game, expectedVersion: number): Promise<number>;

  /** Claims a Join Code for a Game; false if another Game holds it (FR-4.3). */
  claimJoinCode(joinCode: string, gameId: string): Promise<boolean>;
  findGameIdByJoinCode(joinCode: string): Promise<string | null>;
  /** Frees a Join Code once its Game is Finished, so it can be reused. */
  releaseJoinCode(joinCode: string): Promise<void>;

  /** Records a Host's one unfinished Game; false if they already have one (FR-4.2). */
  claimActiveGame(hostId: string, gameId: string): Promise<boolean>;
  getActiveGameId(hostId: string): Promise<string | null>;
  /** Clears the claim only if it is still held by `gameId`. */
  releaseActiveGame(hostId: string, gameId: string): Promise<void>;

  putHistory(record: HistoryRecord): Promise<void>;
  /** Newest first. */
  listHistory(hostId: string): Promise<HistoryRecord[]>;
  getHistory(hostId: string, gameId: string): Promise<HistoryRecord | null>;
}
