// Shared zod schemas: HTTP bodies (PLAN §5), event payloads (§6), agent I/O (§8).
import { z } from 'zod';

export const HealthResponse = z.object({
  status: z.literal('ok'),
  env: z.string(),
});
export type HealthResponse = z.infer<typeof HealthResponse>;

/** POST /api/join. The Nickname's own rules are checked by the domain (FR-5.1). */
export const JoinRequest = z.object({
  joinCode: z.string().max(16),
  nickname: z.string().max(64),
});
export type JoinRequest = z.infer<typeof JoinRequest>;

/** POST /api/games: start a Game from one of the Host's Ready Quizzes (FR-4.1). */
export const CreateGameRequest = z.object({ quizId: z.string().min(1).max(128) });
export type CreateGameRequest = z.infer<typeof CreateGameRequest>;

/** POST /api/play/answers: the Player's identity comes from their token, not the body. */
export const AnswerRequest = z.object({
  questionIndex: z.number().int().min(0).max(100),
  optionId: z.string().min(1).max(64),
});
export type AnswerRequest = z.infer<typeof AnswerRequest>;
