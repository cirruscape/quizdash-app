import { describe, expect, it } from 'vitest';
import { canApprove, type Quiz, type QuizStatus } from './quiz.js';

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
