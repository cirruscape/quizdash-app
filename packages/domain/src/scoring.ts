// Scoring and the Leaderboard (FR-7.1–7.4). Exported for the API layer; tested through decide.

/** Points for one Answer (FR-7.1, FR-7.2). */
export function scoreAnswer(correct: boolean, elapsedMs: number, timeLimitMs: number): number {
  if (!correct) return 0;
  return Math.round(1000 - (500 * elapsedMs) / timeLimitMs);
}

export interface Ranked {
  playerId: string;
  score: number;
  rank: number;
}

/** Highest Score first; equal Scores share a rank, e.g. 1, 2, 2, 4 (FR-7.4). Stable for ties. */
export function rank<T extends { playerId: string; score: number }>(
  players: readonly T[],
): (T & { rank: number })[] {
  const sorted = [...players].sort((a, b) => b.score - a.score);
  return sorted.map((p) => ({
    ...p,
    rank: sorted.findIndex((q) => q.score === p.score) + 1,
  }));
}
