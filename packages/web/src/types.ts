// The API's response shapes, as the screens use them (mirrors packages/api snapshots.ts).
export type Phase = 'LOBBY' | 'QUESTION_OPEN' | 'REVEAL' | 'FINISHED';

export interface Option {
  optionId: string;
  text: string;
}

export interface LeaderboardEntry {
  playerId: string;
  nickname: string;
  score: number;
  rank: number;
}

export interface RevealResult extends LeaderboardEntry {
  points: number;
}

interface QuestionView {
  questionIndex: number;
  questionCount: number;
  text: string;
  options: Option[];
  deadline: number;
}

export interface PlayerSnapshot {
  version: number;
  phase: Phase;
  me: { playerId: string; nickname: string; score: number };
  question: (QuestionView & { myAnswer: string | null }) | null;
  reveal: { correctOptionId: string; myPoints: number; myRank: number } | null;
  leaderboard: LeaderboardEntry[] | null;
  serverNow: number;
}

export interface HostSnapshot {
  version: number;
  gameId: string;
  joinCode: string;
  phase: Phase;
  players: { playerId: string; nickname: string; score: number }[];
  question: QuestionView | null;
  answered: { answered: number; total: number } | null;
  reveal: {
    correctOptionId: string;
    results: RevealResult[];
    optionCounts: Record<string, number>;
  } | null;
  leaderboard: LeaderboardEntry[] | null;
  serverNow: number;
}

export type QuizStatus = 'GENERATING' | 'DRAFT' | 'READY' | 'FAILED';

export interface QuizSummary {
  quizId: string;
  topic: string | null;
  status: QuizStatus;
  questionCount: number;
  failureReason: string | null;
}

export interface QuizDetail {
  quizId: string;
  status: QuizStatus;
  topic?: string;
  difficulty?: 'EASY' | 'MEDIUM' | 'HARD';
  requestedCount?: number;
  defaultTimeLimitSeconds: number;
  failureReason?: string | null;
  questions: {
    questionId: string;
    text: string;
    options: Option[];
    correctOptionId: string;
    timeLimitSeconds?: number;
    status?: 'REGENERATING';
  }[];
}

/** For the sync controller: the running deadline, if a Question is open. */
export function runningDeadline(s: { phase: Phase; question: { deadline: number } | null }) {
  return s.phase === 'QUESTION_OPEN' && s.question ? s.question.deadline : null;
}

export interface HistorySummary {
  gameId: string;
  topic: string | null;
  finishedAt: number;
  abandoned: boolean;
  playerCount: number;
  winner: string | null;
}

export interface HistoryRecord {
  gameId: string;
  quizId: string;
  topic: string | null;
  finishedAt: number;
  abandoned: boolean;
  questions: {
    text: string;
    options: Option[];
    correctOptionId: string;
    optionCounts: Record<string, number>;
  }[];
  leaderboard: LeaderboardEntry[];
}
