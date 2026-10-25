// What a client sees when it loads or reconnects (FR-8.1, FR-8.3). Pure functions of a Game.
// The Player view never includes the correct Option while a Question is open.
import {
  answeredCount,
  leaderboard,
  optionCounts,
  revealResults,
  type Game,
  type Instant,
  type LeaderboardEntry,
  type Option,
  type Phase,
  type Question,
  type RevealResult,
} from '@quizapp/domain';

export interface PlayerSnapshot {
  /** The Game's version: a client keeps only the newest snapshot it has seen. */
  version: number;
  phase: Phase;
  me: { playerId: string; nickname: string; score: number };
  question: {
    questionIndex: number;
    questionCount: number;
    text: string;
    options: Option[];
    deadline: Instant;
    myAnswer: string | null;
  } | null;
  /** Present during Reveal, matching what was shown live (FR-6.7). */
  reveal: { correctOptionId: string; myPoints: number; myRank: number } | null;
  /** Present once the Game is Finished (FR-6.9). */
  leaderboard: LeaderboardEntry[] | null;
  serverNow: Instant;
}

export function playerSnapshot(
  game: Game,
  version: number,
  playerId: string,
  now: Instant,
): PlayerSnapshot | 'NOT_A_PLAYER' | 'PLAYER_REMOVED' {
  const me = game.players.find((p) => p.playerId === playerId);
  if (!me) return 'NOT_A_PLAYER';
  if (me.removed) return 'PLAYER_REMOVED';
  const inQuestion = game.phase === 'QUESTION_OPEN' || game.phase === 'REVEAL';
  const question = game.quiz.questions[game.questionIndex] as Question | undefined;
  return {
    version,
    phase: game.phase,
    me: { playerId: me.playerId, nickname: me.nickname, score: me.score },
    question:
      inQuestion && question
        ? {
            questionIndex: game.questionIndex,
            questionCount: game.quiz.questions.length,
            text: question.text,
            options: question.options,
            deadline: game.deadline as Instant,
            myAnswer: game.answers.find((a) => a.playerId === playerId)?.optionId ?? null,
          }
        : null,
    reveal: game.phase === 'REVEAL' && question ? myReveal(game, question, playerId) : null,
    leaderboard: game.phase === 'FINISHED' ? leaderboard(game) : null,
    serverNow: now,
  };
}

function myReveal(game: Game, question: Question, playerId: string): PlayerSnapshot['reveal'] {
  const mine = revealResults(game).find((r) => r.playerId === playerId);
  return {
    correctOptionId: question.correctOptionId,
    myPoints: mine?.points ?? 0,
    myRank: mine?.rank ?? 0,
  };
}

export interface HostSnapshot {
  version: number;
  gameId: string;
  joinCode: string;
  phase: Phase;
  players: { playerId: string; nickname: string; score: number }[];
  question: {
    questionIndex: number;
    questionCount: number;
    text: string;
    options: Option[];
    deadline: Instant;
  } | null;
  /** During a Question: "N of M answered" (FR-6.3). */
  answered: { answered: number; total: number } | null;
  /** From Reveal: the correct Option, results, and per-Option counts (FR-6.7). */
  reveal: {
    correctOptionId: string;
    results: RevealResult[];
    optionCounts: Record<string, number>;
  } | null;
  leaderboard: LeaderboardEntry[] | null;
  serverNow: Instant;
}

export function hostSnapshot(game: Game, version: number, now: Instant): HostSnapshot {
  const question = game.quiz.questions[game.questionIndex] as Question | undefined;
  const inQuestion = (game.phase === 'QUESTION_OPEN' || game.phase === 'REVEAL') && question;
  return {
    version,
    gameId: game.gameId,
    joinCode: game.joinCode,
    phase: game.phase,
    players: game.players
      .filter((p) => !p.removed)
      .map((p) => ({ playerId: p.playerId, nickname: p.nickname, score: p.score })),
    question: inQuestion
      ? {
          questionIndex: game.questionIndex,
          questionCount: game.quiz.questions.length,
          text: question.text,
          options: question.options,
          deadline: game.deadline as Instant,
        }
      : null,
    answered: game.phase === 'QUESTION_OPEN' ? answeredCount(game) : null,
    reveal:
      game.phase === 'REVEAL' && question
        ? {
            correctOptionId: question.correctOptionId,
            results: revealResults(game),
            optionCounts: optionCounts(game),
          }
        : null,
    leaderboard: game.phase === 'FINISHED' ? leaderboard(game) : null,
    serverNow: now,
  };
}
