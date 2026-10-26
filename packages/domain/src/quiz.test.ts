import { describe, expect, it } from 'vitest';
import {
  canApprove,
  decideQuiz,
  newGeneratingQuiz,
  validateQuizRequest,
  type Quiz,
  type QuizStatus,
} from './quiz.js';

function quiz(status: QuizStatus, questionCount: number): Quiz {
  return {
    quizId: 'q1',
    status,
    defaultTimeLimitSeconds: 20,
    questions: Array.from({ length: questionCount }, (_, i) => ({
      questionId: `qn${i}`,
      text: `Question ${i}?`,
      options: [
        { optionId: 'a', text: 'A' },
        { optionId: 'b', text: 'B' },
      ],
      correctOptionId: 'a',
    })),
  };
}

describe('canApprove', () => {
  it('approves a Draft Quiz with at least 5 Questions', () => {
    expect(canApprove(quiz('DRAFT', 5))).toBe(true);
    expect(canApprove(quiz('DRAFT', 20))).toBe(true);
  });

  it('refuses a Draft Quiz with fewer than 5 Questions', () => {
    expect(canApprove(quiz('DRAFT', 4))).toBe(false);
  });

  it.each(['GENERATING', 'READY', 'FAILED'] as const)('refuses a %s Quiz', (status) => {
    expect(canApprove(quiz(status, 10))).toBe(false);
  });
});

describe('quiz requests', () => {
  const valid = {
    topic: '  90s Britpop ',
    difficulty: 'MEDIUM',
    questionCount: 10,
    defaultTimeLimitSeconds: 20,
  } as const;

  it('accepts a valid request, trimming the Topic, and starts a Quiz generating', () => {
    const result = validateQuizRequest(valid);
    expect(result).toEqual({ ok: true, value: { ...valid, topic: '90s Britpop' } });
    if (!result.ok) return;
    expect(newGeneratingQuiz('quiz9', result.value)).toEqual({
      quizId: 'quiz9',
      status: 'GENERATING',
      topic: '90s Britpop',
      difficulty: 'MEDIUM',
      requestedCount: 10,
      defaultTimeLimitSeconds: 20,
      questions: [],
      failureReason: null,
    });
  });

  it.each([
    ['a Topic under 3 characters', { topic: ' ab ' }, 'INVALID_TOPIC'],
    ['a Topic over 80 characters', { topic: 'x'.repeat(81) }, 'INVALID_TOPIC'],
    ['an unknown Difficulty', { difficulty: 'IMPOSSIBLE' }, 'INVALID_DIFFICULTY'],
    ['fewer than 5 Questions', { questionCount: 4 }, 'INVALID_QUESTION_COUNT'],
    ['more than 20 Questions', { questionCount: 21 }, 'INVALID_QUESTION_COUNT'],
    ['a fractional Question count', { questionCount: 7.5 }, 'INVALID_QUESTION_COUNT'],
    ['a Time Limit under 5 s', { defaultTimeLimitSeconds: 4 }, 'INVALID_TIME_LIMIT'],
    ['a Time Limit over 120 s', { defaultTimeLimitSeconds: 121 }, 'INVALID_TIME_LIMIT'],
  ])('refuses %s', (_why, change, error) => {
    expect(validateQuizRequest({ ...valid, ...change } as never)).toEqual({ ok: false, error });
  });

  it('accepts the boundaries: 3 and 80 characters, 5 and 20 Questions, 5 and 120 s', () => {
    for (const change of [
      { topic: 'abc' },
      { topic: 'x'.repeat(80) },
      { questionCount: 5 },
      { questionCount: 20 },
      { defaultTimeLimitSeconds: 5 },
      { defaultTimeLimitSeconds: 120 },
    ]) {
      expect(validateQuizRequest({ ...valid, ...change }).ok).toBe(true);
    }
  });
});

describe('decideQuiz: generation outcomes', () => {
  const request = {
    topic: 'Capitals',
    difficulty: 'EASY',
    questionCount: 5,
    defaultTimeLimitSeconds: 20,
  } as const;
  const generating = () => newGeneratingQuiz('q1', request);
  const questions = quiz('DRAFT', 5).questions;

  it('turns a generating Quiz into a Draft with its Questions', () => {
    expect(decideQuiz(generating(), { type: 'GenerationSucceeded', questions })).toEqual({
      ok: true,
      quiz: { ...generating(), status: 'DRAFT', questions },
    });
  });

  it('refuses a "success" with no Questions: that is a failure', () => {
    expect(decideQuiz(generating(), { type: 'GenerationSucceeded', questions: [] })).toEqual({
      ok: false,
      error: 'NO_QUESTIONS',
    });
  });

  it('marks a failed generation, recording why', () => {
    expect(decideQuiz(generating(), { type: 'GenerationFailed', reason: 'TOPIC_REFUSED' })).toEqual(
      {
        ok: true,
        quiz: { ...generating(), status: 'FAILED', failureReason: 'TOPIC_REFUSED' },
      },
    );
  });

  it('applies generation outcomes only to a Quiz that is still generating', () => {
    const draft = quiz('DRAFT', 5);
    expect(decideQuiz(draft, { type: 'GenerationSucceeded', questions })).toEqual({
      ok: false,
      error: 'WRONG_STATUS',
    });
    expect(decideQuiz(draft, { type: 'GenerationFailed', reason: 'GENERATION_FAILED' })).toEqual({
      ok: false,
      error: 'WRONG_STATUS',
    });
  });
});

describe('decideQuiz: editing a Draft', () => {
  it('discards a Question', () => {
    const d = decideQuiz(quiz('DRAFT', 6), { type: 'Discard', questionId: 'qn2' });
    expect(d.ok && d.quiz.questions.map((q) => q.questionId)).toEqual([
      'qn0',
      'qn1',
      'qn3',
      'qn4',
      'qn5',
    ]);
  });

  it("overrides a Question's Time Limit within 5-120 s, and can clear it", () => {
    const set = decideQuiz(quiz('DRAFT', 5), {
      type: 'SetTimeLimit',
      questionId: 'qn1',
      seconds: 45,
    });
    expect(set.ok && set.quiz.questions[1]?.timeLimitSeconds).toBe(45);
    if (!set.ok) return;

    const cleared = decideQuiz(set.quiz, {
      type: 'SetTimeLimit',
      questionId: 'qn1',
      seconds: null,
    });
    expect(cleared.ok && 'timeLimitSeconds' in (cleared.quiz.questions[1] ?? {})).toBe(false);

    for (const seconds of [4, 121, 12.5]) {
      expect(
        decideQuiz(quiz('DRAFT', 5), { type: 'SetTimeLimit', questionId: 'qn1', seconds }),
      ).toEqual({
        ok: false,
        error: 'INVALID_TIME_LIMIT',
      });
    }
  });

  it('refuses an unknown Question', () => {
    expect(decideQuiz(quiz('DRAFT', 5), { type: 'Discard', questionId: 'nope' })).toEqual({
      ok: false,
      error: 'QUESTION_NOT_FOUND',
    });
  });

  it('never changes a Ready Quiz (FR-3.3)', () => {
    for (const command of [
      { type: 'Discard', questionId: 'qn0' },
      { type: 'SetTimeLimit', questionId: 'qn0', seconds: 30 },
    ] as const) {
      expect(decideQuiz(quiz('READY', 5), command)).toEqual({ ok: false, error: 'WRONG_STATUS' });
    }
  });
});

describe('decideQuiz: regenerating one Question', () => {
  const fresh = {
    questionId: 'from-agent',
    text: 'A better Question?',
    options: [
      { optionId: 'a', text: 'Yes' },
      { optionId: 'b', text: 'No' },
    ],
    correctOptionId: 'a',
  };

  function regenerating() {
    const withLimit = decideQuiz(quiz('DRAFT', 5), {
      type: 'SetTimeLimit',
      questionId: 'qn1',
      seconds: 45,
    });
    if (!withLimit.ok) throw new Error(withLimit.error);
    const d = decideQuiz(withLimit.quiz, { type: 'StartRegenerate', questionId: 'qn1' });
    if (!d.ok) throw new Error(d.error);
    return d.quiz;
  }

  it('marks the Question as regenerating, and refuses a second request meanwhile', () => {
    expect(regenerating().questions[1]?.status).toBe('REGENERATING');
    expect(decideQuiz(regenerating(), { type: 'StartRegenerate', questionId: 'qn1' })).toEqual({
      ok: false,
      error: 'ALREADY_REGENERATING',
    });
  });

  it('replaces its text and Options, keeping its ID and Time Limit override', () => {
    const d = decideQuiz(regenerating(), {
      type: 'RegenerateSucceeded',
      questionId: 'qn1',
      question: fresh,
    });
    expect(d.ok && d.quiz.questions[1]).toEqual({
      ...fresh,
      questionId: 'qn1',
      timeLimitSeconds: 45,
    });
  });

  it('puts the old Question back if regenerating fails', () => {
    const d = decideQuiz(regenerating(), { type: 'RegenerateFailed', questionId: 'qn1' });
    expect(d.ok && d.quiz.questions[1]).toEqual({
      ...quiz('DRAFT', 5).questions[1],
      timeLimitSeconds: 45,
    });
  });
});

describe('decideQuiz: approving', () => {
  it('makes a Draft with at least 5 Questions Ready', () => {
    expect(decideQuiz(quiz('DRAFT', 5), { type: 'Approve' })).toEqual({
      ok: true,
      quiz: { ...quiz('DRAFT', 5), status: 'READY' },
    });
  });

  it('refuses fewer than 5 Questions, a Question still regenerating, and anything not a Draft', () => {
    expect(decideQuiz(quiz('DRAFT', 4), { type: 'Approve' })).toEqual({
      ok: false,
      error: 'TOO_FEW_QUESTIONS',
    });
    const busy = decideQuiz(quiz('DRAFT', 5), { type: 'StartRegenerate', questionId: 'qn0' });
    expect(busy.ok && decideQuiz(busy.quiz, { type: 'Approve' })).toEqual({
      ok: false,
      error: 'QUESTION_REGENERATING',
    });
    expect(decideQuiz(quiz('READY', 5), { type: 'Approve' })).toEqual({
      ok: false,
      error: 'WRONG_STATUS',
    });
  });
});
