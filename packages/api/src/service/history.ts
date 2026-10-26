// Game History (FR-9.1): a Finished Game, as its Host will see it later. Pure functions.
import { leaderboard, type Game, type Instant, type Question } from '@quizapp/domain';
import type { HistoryRecord } from '../repository/repository.js';

export function historyRecord(game: Game, finishedAt: Instant, abandoned: boolean): HistoryRecord {
  return {
    gameId: game.gameId,
    hostId: game.hostId,
    quizId: game.quiz.quizId,
    topic: game.quiz.topic ?? null,
    finishedAt,
    abandoned,
    // Only the Questions that were revealed: an abandoned Game may not have reached them all.
    questions: (game.revealed ?? []).map(({ questionIndex, optionCounts }) => {
      const q = game.quiz.questions[questionIndex] as Question;
      return { text: q.text, options: q.options, correctOptionId: q.correctOptionId, optionCounts };
    }),
    leaderboard: leaderboard(game),
  };
}

export interface HistorySummary {
  gameId: string;
  topic: string | null;
  finishedAt: Instant;
  abandoned: boolean;
  playerCount: number;
  /** The top-ranked Player (the first listed, on a tie), or null if nobody played. */
  winner: string | null;
}

export function historySummary(record: HistoryRecord): HistorySummary {
  return {
    gameId: record.gameId,
    topic: record.topic,
    finishedAt: record.finishedAt,
    abandoned: record.abandoned,
    playerCount: record.leaderboard.length,
    winner: record.leaderboard[0]?.nickname ?? null,
  };
}
