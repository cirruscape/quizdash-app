// The Quiz lifecycle (GLOSSARY: Draft Quiz, Ready Quiz; FR-3.x).

export type QuizStatus = 'GENERATING' | 'DRAFT' | 'READY' | 'FAILED';

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
}

export interface Quiz {
  quizId: string;
  status: QuizStatus;
  defaultTimeLimitSeconds: number;
  questions: Question[];
}

/** The fewest Questions a Quiz may be approved with (FR-3.2). */
export const MIN_QUESTIONS_TO_APPROVE = 5;

export function canApprove(quiz: Quiz): boolean {
  return quiz.status === 'DRAFT' && quiz.questions.length >= MIN_QUESTIONS_TO_APPROVE;
}
