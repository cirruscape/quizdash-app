// A small Ready Quiz for development and the smoke test. Dev-only fixture: importing Quizzes
// isn't a product feature (PRD non-goals). Option "a" is always correct, for predictable tests.
import type { Quiz } from '@quizapp/domain';

export function sampleQuiz(quizId = 'sample-quiz'): Quiz {
  const q = (n: number, text: string, options: [string, string, string, string]) => ({
    questionId: `${quizId}-q${n}`,
    text,
    options: options.map((t, i) => ({ optionId: 'abcd'[i] as string, text: t })),
    correctOptionId: 'a',
  });
  return {
    quizId,
    status: 'READY',
    defaultTimeLimitSeconds: 20,
    questions: [
      q(1, 'What is the capital city of Australia?', ['Canberra', 'Sydney', 'Melbourne', 'Perth']),
      q(2, 'Which planet is known as the Red Planet?', ['Mars', 'Venus', 'Jupiter', 'Mercury']),
      q(3, 'How many sides does a hexagon have?', ['Six', 'Five', 'Seven', 'Eight']),
      q(4, 'Which gas do plants absorb from the air?', [
        'Carbon dioxide',
        'Oxygen',
        'Nitrogen',
        'Helium',
      ]),
      q(5, 'Who wrote "Romeo and Juliet"?', [
        'William Shakespeare',
        'Charles Dickens',
        'Jane Austen',
        'Mark Twain',
      ]),
    ],
  };
}
