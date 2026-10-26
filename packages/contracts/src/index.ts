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

// ---------------------------------------------------------------- Generation agent (PLAN §8)

const Difficulty = z.enum(['EASY', 'MEDIUM', 'HARD']);

/** The worker Lambda's request to the AgentCore agent's /invocations. */
export const AgentRequest = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('generate'),
    topic: z.string().min(1).max(80),
    difficulty: Difficulty,
    count: z.number().int().min(1).max(20),
    /** Earlier Question texts to avoid repeating (FR-2.5). */
    avoid: z.array(z.string().max(400)).max(250),
  }),
  z.object({
    /** One replacement Question for a Draft (FR-3.2). */
    mode: z.literal('regenerate'),
    topic: z.string().min(1).max(80),
    difficulty: Difficulty,
    avoid: z.array(z.string().max(400)).max(250),
  }),
]);
export type AgentRequest = z.infer<typeof AgentRequest>;

const GeneratedQuestion = z.object({
  text: z.string(),
  options: z
    .array(z.object({ optionId: z.string(), text: z.string() }))
    .min(2)
    .max(4),
  correctOptionId: z.string(),
});

export const AgentResponse = z.discriminatedUnion('status', [
  z.object({ status: z.literal('success'), questions: z.array(GeneratedQuestion) }),
  z.object({
    status: z.literal('error'),
    error: z.enum(['TOPIC_REFUSED', 'GENERATION_FAILED', 'INVALID_REQUEST']),
  }),
]);
export type AgentResponse = z.infer<typeof AgentResponse>;

/** POST /api/quizzes. Types only here; the domain checks the ranges (FR-2.1). */
export const CreateQuizRequest = z.object({
  topic: z.string().max(200),
  difficulty: Difficulty,
  questionCount: z.number(),
  defaultTimeLimitSeconds: z.number(),
});
export type CreateQuizRequest = z.infer<typeof CreateQuizRequest>;

/** PATCH /api/quizzes/{quizId}/questions/{questionId}: null clears the override. */
export const SetTimeLimitRequest = z.object({ timeLimitSeconds: z.number().nullable() });
