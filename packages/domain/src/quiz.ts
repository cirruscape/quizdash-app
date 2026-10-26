// The Quiz lifecycle (GLOSSARY: Draft Quiz, Ready Quiz; FR-3.x).

export type QuizStatus = 'GENERATING' | 'DRAFT' | 'READY' | 'FAILED';

export type Difficulty = 'EASY' | 'MEDIUM' | 'HARD';
export const DIFFICULTIES: readonly Difficulty[] = ['EASY', 'MEDIUM', 'HARD'];

/** Why a Quiz couldn't be generated (FR-2.6). */
export type GenerationFailure = 'TOPIC_REFUSED' | 'GENERATION_FAILED';

export interface Option {
  optionId: string;
  text: string;
}

export interface Question {
  questionId: string;
  text: string;
  /** 2–4 Options, exactly one of them correct. */
  options: Option[];
  correctOptionId: string;
  /** Overrides the Quiz's default Time Limit when present. */
  timeLimitSeconds?: number;
  /** Set while the generation agent is replacing this Question (FR-3.2). */
  status?: 'REGENERATING';
}

export interface Quiz {
  quizId: string;
  status: QuizStatus;
  /** What the Quiz is about (GLOSSARY: Topic). */
  topic?: string;
  difficulty?: Difficulty;
  /** How many Questions the Host asked for; a Draft may end up with fewer. */
  requestedCount?: number;
  /** Set when the Quiz is FAILED. */
  failureReason?: GenerationFailure | null;
  defaultTimeLimitSeconds: number;
  questions: Question[];
}

/** The fewest Questions a Quiz may be approved with (FR-3.2). */
export const MIN_QUESTIONS_TO_APPROVE = 5;

export function canApprove(quiz: Quiz): boolean {
  return quiz.status === 'DRAFT' && quiz.questions.length >= MIN_QUESTIONS_TO_APPROVE;
}

/** What a Host asks for when generating a Quiz (FR-2.1). */
export interface QuizRequest {
  topic: string;
  difficulty: Difficulty;
  questionCount: number;
  defaultTimeLimitSeconds: number;
}

export type QuizRequestError =
  'INVALID_TOPIC' | 'INVALID_DIFFICULTY' | 'INVALID_QUESTION_COUNT' | 'INVALID_TIME_LIMIT';

/** Time Limits, both the Quiz default and per-Question overrides (FR-2.1, FR-3.2). */
export const MIN_TIME_LIMIT_SECONDS = 5;
export const MAX_TIME_LIMIT_SECONDS = 120;

export function isValidTimeLimit(seconds: number): boolean {
  return (
    Number.isInteger(seconds) &&
    seconds >= MIN_TIME_LIMIT_SECONDS &&
    seconds <= MAX_TIME_LIMIT_SECONDS
  );
}

export function validateQuizRequest(
  input: QuizRequest,
): { ok: true; value: QuizRequest } | { ok: false; error: QuizRequestError } {
  const topic = input.topic.trim();
  if (topic.length < 3 || topic.length > 80) return { ok: false, error: 'INVALID_TOPIC' };
  if (!DIFFICULTIES.includes(input.difficulty)) return { ok: false, error: 'INVALID_DIFFICULTY' };
  const count = input.questionCount;
  if (!Number.isInteger(count) || count < 5 || count > 20) {
    return { ok: false, error: 'INVALID_QUESTION_COUNT' };
  }
  if (!isValidTimeLimit(input.defaultTimeLimitSeconds)) {
    return { ok: false, error: 'INVALID_TIME_LIMIT' };
  }
  return { ok: true, value: { ...input, topic } };
}

/** A Quiz waiting for the generation agent (FR-2.2). */
export function newGeneratingQuiz(quizId: string, request: QuizRequest): Quiz {
  return {
    quizId,
    status: 'GENERATING',
    topic: request.topic,
    difficulty: request.difficulty,
    requestedCount: request.questionCount,
    defaultTimeLimitSeconds: request.defaultTimeLimitSeconds,
    questions: [],
    failureReason: null,
  };
}

export type QuizCommand =
  | { type: 'GenerationSucceeded'; questions: Question[] }
  | { type: 'GenerationFailed'; reason: GenerationFailure }
  | { type: 'Discard'; questionId: string }
  /** `null` clears the override, so the Quiz default applies. */
  | { type: 'SetTimeLimit'; questionId: string; seconds: number | null }
  | { type: 'StartRegenerate'; questionId: string }
  /** `question` comes from the agent; it keeps this Question's ID and Time Limit override. */
  | { type: 'RegenerateSucceeded'; questionId: string; question: Question }
  | { type: 'RegenerateFailed'; questionId: string }
  | { type: 'Approve' };

export type QuizError =
  | 'WRONG_STATUS'
  | 'NO_QUESTIONS'
  | 'QUESTION_NOT_FOUND'
  | 'INVALID_TIME_LIMIT'
  | 'ALREADY_REGENERATING'
  | 'TOO_FEW_QUESTIONS'
  | 'QUESTION_REGENERATING';

export type QuizDecision = { ok: true; quiz: Quiz } | { ok: false; error: QuizError };

/** The Quiz lifecycle (FR-2.x, FR-3.x): generating, then Draft (or Failed), then Ready. */
export function decideQuiz(quiz: Quiz, command: QuizCommand): QuizDecision {
  switch (command.type) {
    case 'GenerationSucceeded':
      if (quiz.status !== 'GENERATING') return { ok: false, error: 'WRONG_STATUS' };
      if (command.questions.length === 0) return { ok: false, error: 'NO_QUESTIONS' };
      return { ok: true, quiz: { ...quiz, status: 'DRAFT', questions: command.questions } };
    case 'GenerationFailed':
      if (quiz.status !== 'GENERATING') return { ok: false, error: 'WRONG_STATUS' };
      return { ok: true, quiz: { ...quiz, status: 'FAILED', failureReason: command.reason } };
    case 'Discard':
      return editDraft(quiz, command.questionId, () => null);
    case 'SetTimeLimit': {
      const { seconds } = command;
      if (seconds !== null && !isValidTimeLimit(seconds)) {
        return { ok: false, error: 'INVALID_TIME_LIMIT' };
      }
      return editDraft(quiz, command.questionId, (q) => {
        const { timeLimitSeconds: _cleared, ...rest } = q;
        return seconds === null ? rest : { ...rest, timeLimitSeconds: seconds };
      });
    }
    case 'StartRegenerate': {
      const target = quiz.questions.find((q) => q.questionId === command.questionId);
      if (quiz.status === 'DRAFT' && target?.status === 'REGENERATING') {
        return { ok: false, error: 'ALREADY_REGENERATING' };
      }
      return editDraft(quiz, command.questionId, (q) => ({ ...q, status: 'REGENERATING' }));
    }
    case 'RegenerateSucceeded':
      return editDraft(quiz, command.questionId, (q) => {
        // The fresh Question takes over this one's ID and keeps its Time Limit override.
        const { status: _status, timeLimitSeconds: _limit, ...fresh } = command.question;
        return {
          ...fresh,
          questionId: q.questionId,
          ...(q.timeLimitSeconds !== undefined ? { timeLimitSeconds: q.timeLimitSeconds } : {}),
        };
      });
    case 'RegenerateFailed':
      return editDraft(quiz, command.questionId, ({ status: _status, ...old }) => old);
    case 'Approve':
      if (quiz.status !== 'DRAFT') return { ok: false, error: 'WRONG_STATUS' };
      if (quiz.questions.some((q) => q.status === 'REGENERATING')) {
        return { ok: false, error: 'QUESTION_REGENERATING' };
      }
      if (!canApprove(quiz)) return { ok: false, error: 'TOO_FEW_QUESTIONS' };
      return { ok: true, quiz: { ...quiz, status: 'READY' } };
  }
}

/** Applies `change` to one Question of a Draft; returning null removes it. */
function editDraft(
  quiz: Quiz,
  questionId: string,
  change: (question: Question) => Question | null,
): QuizDecision {
  if (quiz.status !== 'DRAFT') return { ok: false, error: 'WRONG_STATUS' };
  const index = quiz.questions.findIndex((q) => q.questionId === questionId);
  if (index === -1) return { ok: false, error: 'QUESTION_NOT_FOUND' };
  const changed = change(quiz.questions[index] as Question);
  const questions = [...quiz.questions];
  if (changed) questions[index] = changed;
  else questions.splice(index, 1);
  return { ok: true, quiz: { ...quiz, questions } };
}
