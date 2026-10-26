// The Quiz service: generating, reviewing and approving Quizzes (PRD §5.2–5.3, PLAN §8).
// Generation runs as a background job (the worker Lambda), because it takes tens of seconds.
import type { AgentRequest, AgentResponse } from '@quizapp/contracts';
import {
  decideQuiz,
  newGeneratingQuiz,
  validateQuizRequest,
  type Instant,
  type Question,
  type Quiz,
  type QuizCommand,
  type QuizRequest,
  type QuizStatus,
} from '@quizapp/domain';
import { ConflictError, type GameRepository } from '../repository/repository.js';
import type { Result } from './game-service.js';

/** Work for the worker Lambda. */
export type QuizJob =
  | { kind: 'generate'; hostId: string; quizId: string }
  | { kind: 'regenerate'; hostId: string; quizId: string; questionId: string };

export interface QuizServiceDeps {
  repo: GameRepository;
  now: () => Instant;
  newId: () => string;
  /** Starts a job in the background, without waiting for it (the worker Lambda). */
  startJob: (job: QuizJob) => Promise<void>;
  /** Calls the generation agent (AgentCore), waiting for its answer. */
  agent: (request: AgentRequest) => Promise<AgentResponse>;
  /** Generations per Host per day (FR-2.7). */
  generationLimit: number;
}

/** A refused Topic is the model's safeguard working, so it isn't counted as a failure. */
export type JobOutcome = 'SUCCEEDED' | 'REFUSED' | 'FAILED' | 'SKIPPED';

export interface QuizService {
  createQuiz(hostId: string, request: QuizRequest): Promise<Result<{ quizId: string }>>;
  /**
   * Runs a background job; called by the worker Lambda. Never throws for agent failures.
   * Reports the outcome, which the worker publishes for the failure-rate alarm (M5).
   */
  runJob(job: QuizJob): Promise<JobOutcome>;
  /** All the Host's Quizzes, whatever their status. */
  listQuizzes(hostId: string): Promise<Result<QuizListItem[]>>;
  /** The whole Quiz, correct answers included: only its Host ever sees this. */
  getQuiz(hostId: string, quizId: string): Promise<Result<Quiz>>;
  discardQuestion(hostId: string, quizId: string, questionId: string): Promise<Result<Quiz>>;
  setTimeLimit(
    hostId: string,
    quizId: string,
    questionId: string,
    seconds: number | null,
  ): Promise<Result<Quiz>>;
  approveQuiz(hostId: string, quizId: string): Promise<Result<Quiz>>;
  deleteQuiz(hostId: string, quizId: string): Promise<Result<{ deleted: true }>>;
  /** Replaces one Draft Question in the background; uses a generation (FR-3.2, FR-2.7). */
  regenerateQuestion(hostId: string, quizId: string, questionId: string): Promise<Result<Quiz>>;
}

export interface QuizListItem {
  quizId: string;
  topic: string | null;
  status: QuizStatus;
  questionCount: number;
  failureReason: string | null;
}

/** Enough for the worker racing a Host's edits; beyond this, report rather than spin. */
const SAVE_ATTEMPTS = 10;
/** How many earlier Question texts to send the agent to avoid (PLAN §8). */
const MAX_AVOID = 200;

const STOPWORDS = new Set(['the', 'and', 'for', 'with', 'about', 'from', 'that', 'this']);

/** A Topic's distinctive words, for finding the Host's earlier Quizzes on similar Topics. */
function topicWords(topic: string | undefined): Set<string> {
  const words = (topic ?? '').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  return new Set(words.filter((w) => w.length >= 3 && !STOPWORDS.has(w)));
}

/** The calendar day in Sydney, YYYY-MM-DD: the daily limit resets at midnight there (D6). */
export function sydneyDay(at: Instant): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Australia/Sydney',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

export function createQuizService(deps: QuizServiceDeps): QuizService {
  const { repo, now, newId, startJob, agent, generationLimit } = deps;

  /** Loads the Quiz, decides, and saves against the version read, retrying lost races. */
  async function applyQuiz(
    hostId: string,
    quizId: string,
    command: (quiz: Quiz) => QuizCommand,
  ): Promise<Result<Quiz>> {
    for (let attempt = 0; attempt < SAVE_ATTEMPTS; attempt++) {
      const stored = await repo.getStoredQuiz(hostId, quizId);
      if (!stored) return { ok: false, error: 'QUIZ_NOT_FOUND' };
      const decision = decideQuiz(stored.quiz, command(stored.quiz));
      if (!decision.ok) return decision;
      try {
        await repo.saveQuiz(hostId, decision.quiz, stored.version);
        return { ok: true, value: decision.quiz };
      } catch (err) {
        if (err instanceof ConflictError) continue;
        throw err;
      }
    }
    return { ok: false, error: 'TOO_MANY_CONFLICTS' };
  }

  /** The Host's earlier Question texts on similar Topics, so the agent avoids repeats. */
  async function avoidFor(hostId: string, quiz: Quiz): Promise<string[]> {
    const words = topicWords(quiz.topic);
    const similar = (await repo.listQuizzes(hostId)).filter(
      (other) =>
        other.quizId !== quiz.quizId && [...topicWords(other.topic)].some((w) => words.has(w)),
    );
    return similar.flatMap((other) => other.questions.map((q) => q.text)).slice(0, MAX_AVOID);
  }

  /** The agent's answer, with any crash reported as a generation failure. */
  async function callAgent(request: AgentRequest): Promise<AgentResponse> {
    try {
      return await agent(request);
    } catch (err) {
      console.error('generation agent failed', err);
      return { status: 'error', error: 'GENERATION_FAILED' };
    }
  }

  async function runGenerate(hostId: string, quizId: string): Promise<JobOutcome> {
    const quiz = await repo.getQuiz(hostId, quizId);
    if (!quiz || quiz.status !== 'GENERATING') return 'SKIPPED';
    const reply = await callAgent({
      mode: 'generate',
      topic: quiz.topic ?? '',
      difficulty: quiz.difficulty ?? 'MEDIUM',
      count: quiz.requestedCount ?? 10,
      avoid: await avoidFor(hostId, quiz),
    });
    await applyQuiz(hostId, quizId, () =>
      reply.status === 'success' && reply.questions.length > 0
        ? {
            type: 'GenerationSucceeded',
            questions: reply.questions.map((q): Question => ({ ...q, questionId: newId() })),
          }
        : {
            type: 'GenerationFailed',
            reason:
              reply.status === 'error' && reply.error === 'TOPIC_REFUSED'
                ? 'TOPIC_REFUSED'
                : 'GENERATION_FAILED',
          },
    );
    if (reply.status === 'success' && reply.questions.length > 0) return 'SUCCEEDED';
    return reply.status === 'error' && reply.error === 'TOPIC_REFUSED' ? 'REFUSED' : 'FAILED';
  }

  async function runRegenerate(
    hostId: string,
    quizId: string,
    questionId: string,
  ): Promise<JobOutcome> {
    const quiz = await repo.getQuiz(hostId, quizId);
    const target = quiz?.questions.find((q) => q.questionId === questionId);
    if (!quiz || target?.status !== 'REGENERATING') return 'SKIPPED';
    const others = quiz.questions.filter((q) => q.questionId !== questionId).map((q) => q.text);
    const reply = await callAgent({
      mode: 'regenerate',
      topic: quiz.topic ?? '',
      difficulty: quiz.difficulty ?? 'MEDIUM',
      avoid: [...others, target.text, ...(await avoidFor(hostId, quiz))].slice(0, MAX_AVOID),
    });
    const fresh = reply.status === 'success' ? reply.questions[0] : undefined;
    await applyQuiz(hostId, quizId, () =>
      fresh
        ? { type: 'RegenerateSucceeded', questionId, question: { ...fresh, questionId } }
        : { type: 'RegenerateFailed', questionId },
    );
    if (fresh) return 'SUCCEEDED';
    return reply.status === 'error' && reply.error === 'TOPIC_REFUSED' ? 'REFUSED' : 'FAILED';
  }

  return {
    async createQuiz(hostId, request) {
      const valid = validateQuizRequest(request);
      if (!valid.ok) return valid;
      const at = now();
      if (!(await repo.useGeneration(hostId, sydneyDay(at), generationLimit, at))) {
        return { ok: false, error: 'QUOTA_EXCEEDED' };
      }
      const quizId = newId();
      await repo.putQuiz(hostId, newGeneratingQuiz(quizId, valid.value));
      await startJob({ kind: 'generate', hostId, quizId });
      return { ok: true, value: { quizId } };
    },

    async runJob(job) {
      return job.kind === 'generate'
        ? runGenerate(job.hostId, job.quizId)
        : runRegenerate(job.hostId, job.quizId, job.questionId);
    },

    async regenerateQuestion(hostId, quizId, questionId) {
      // Check it can be regenerated before using one of the Host's generations on it.
      const quiz = await repo.getQuiz(hostId, quizId);
      if (!quiz) return { ok: false, error: 'QUIZ_NOT_FOUND' };
      const check = decideQuiz(quiz, { type: 'StartRegenerate', questionId });
      if (!check.ok) return check;
      const at = now();
      if (!(await repo.useGeneration(hostId, sydneyDay(at), generationLimit, at))) {
        return { ok: false, error: 'QUOTA_EXCEEDED' };
      }
      const marked = await applyQuiz(hostId, quizId, () => ({
        type: 'StartRegenerate',
        questionId,
      }));
      if (marked.ok) await startJob({ kind: 'regenerate', hostId, quizId, questionId });
      return marked;
    },

    async listQuizzes(hostId) {
      const quizzes = await repo.listQuizzes(hostId);
      return {
        ok: true,
        value: quizzes.map((q) => ({
          quizId: q.quizId,
          topic: q.topic ?? null,
          status: q.status,
          questionCount: q.questions.length,
          failureReason: q.failureReason ?? null,
        })),
      };
    },

    async getQuiz(hostId, quizId) {
      const quiz = await repo.getQuiz(hostId, quizId);
      return quiz ? { ok: true, value: quiz } : { ok: false, error: 'QUIZ_NOT_FOUND' };
    },

    discardQuestion: (hostId, quizId, questionId) =>
      applyQuiz(hostId, quizId, () => ({ type: 'Discard', questionId })),

    setTimeLimit: (hostId, quizId, questionId, seconds) =>
      applyQuiz(hostId, quizId, () => ({ type: 'SetTimeLimit', questionId, seconds })),

    approveQuiz: (hostId, quizId) => applyQuiz(hostId, quizId, () => ({ type: 'Approve' })),

    async deleteQuiz(hostId, quizId) {
      // Games already played keep their own snapshot of it, and History is untouched (FR-3.4).
      if (!(await repo.getQuiz(hostId, quizId))) return { ok: false, error: 'QUIZ_NOT_FOUND' };
      await repo.deleteQuiz(hostId, quizId);
      return { ok: true, value: { deleted: true } };
    },
  };
}
