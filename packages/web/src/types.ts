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

export interface QuizSummary {
  quizId: string;
  topic: string | null;
  questionCount: number;
}

/** For the sync controller: the running deadline, if a Question is open. */
export function runningDeadline(s: { phase: Phase; question: { deadline: number } | null }) {
  return s.phase === 'QUESTION_OPEN' && s.question ? s.question.deadline : null;
}
