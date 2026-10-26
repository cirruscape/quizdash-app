import { describe, expect, it, vi } from 'vitest';
import {
  generateQuiz,
  ModelRefusedError,
  type Candidate,
  type GenerationModel,
} from './pipeline.js';

const request = { topic: 'Capitals', difficulty: 'EASY' as const };

function candidate(n: number, extra: Partial<Candidate> = {}): Candidate {
  return {
    text: `Question ${n}?`,
    options: ['Right', 'Wrong', 'Also wrong'],
    correctIndex: 0,
    ...extra,
  };
}

/** A fake model: `batches` are returned by successive generate calls; verify fails `rejected`. */
function fakeModel(batches: Candidate[][], rejected: string[] = []): GenerationModel {
  const queue = [...batches];
  return {
    generate: vi.fn(async () => queue.shift() ?? []),
    verify: vi.fn(async ({ question }) =>
      rejected.includes(question.text)
        ? { ok: false, reason: 'two Options are defensible' }
        : { ok: true, reason: '' },
    ),
  };
}

describe('generateQuiz', () => {
  it('returns the verified Questions, with Options labelled a-d and the correct one marked', async () => {
    const model = fakeModel([[candidate(1), candidate(2, { correctIndex: 2 })]]);
    const result = await generateQuiz(model, { ...request, count: 2, avoid: [] });

    expect(result).toEqual({
      ok: true,
      questions: [
        {
          text: 'Question 1?',
          options: [
            { optionId: 'a', text: 'Right' },
            { optionId: 'b', text: 'Wrong' },
            { optionId: 'c', text: 'Also wrong' },
          ],
          correctOptionId: 'a',
        },
        {
          text: 'Question 2?',
          options: [
            { optionId: 'a', text: 'Right' },
            { optionId: 'b', text: 'Wrong' },
            { optionId: 'c', text: 'Also wrong' },
          ],
          correctOptionId: 'c',
        },
      ],
    });
    expect(model.verify).toHaveBeenCalledTimes(2);
  });

  it('drops Questions that fail verification and generates replacements, avoiding them', async () => {
    const model = fakeModel(
      [[candidate(1), candidate(2), candidate(3)], [candidate(4)]],
      ['Question 2?'],
    );
    const result = await generateQuiz(model, { ...request, count: 3, avoid: ['Older one?'] });

    expect(result.ok && result.questions.map((q) => q.text)).toEqual([
      'Question 1?',
      'Question 3?',
      'Question 4?',
    ]);
    // The second round asks for just the shortfall, and avoids everything seen so far.
    expect(model.generate).toHaveBeenLastCalledWith({
      ...request,
      count: 1,
      avoid: ['Older one?', 'Question 1?', 'Question 2?', 'Question 3?'],
    });
  });

  it('stops after two replacement rounds, returning what passed', async () => {
    const model = fakeModel(
      [[candidate(1), candidate(2)], [candidate(3)], [candidate(4)], [candidate(5)]],
      ['Question 2?', 'Question 3?', 'Question 4?'],
    );
    const result = await generateQuiz(model, { ...request, count: 2, avoid: [] });
    expect(result.ok && result.questions.map((q) => q.text)).toEqual(['Question 1?']);
    expect(model.generate).toHaveBeenCalledTimes(3);
  });

  it('fails when nothing passes', async () => {
    const model = fakeModel(
      [[candidate(1)], [candidate(2)], [candidate(3)]],
      ['Question 1?', 'Question 2?', 'Question 3?'],
    );
    expect(await generateQuiz(model, { ...request, count: 1, avoid: [] })).toEqual({
      ok: false,
      error: 'GENERATION_FAILED',
    });
  });

  it('reports a refused Topic as TOPIC_REFUSED', async () => {
    const model: GenerationModel = {
      generate: async () => {
        throw new ModelRefusedError();
      },
      verify: async () => ({ ok: true, reason: '' }),
    };
    expect(await generateQuiz(model, { ...request, count: 5, avoid: [] })).toEqual({
      ok: false,
      error: 'TOPIC_REFUSED',
    });
  });
});

describe('generateQuiz: validation in code', () => {
  it.each([
    ['only one Option', { options: ['Lonely'] }],
    ['five Options', { options: ['a', 'b', 'c', 'd', 'e'] }],
    ['duplicate Options', { options: ['Same', 'same ', 'Other'] }],
    ['an empty Option', { options: ['Fine', '  '] }],
    ['a correct index out of range', { correctIndex: 3 }],
    ['a fractional correct index', { correctIndex: 0.5 }],
    ['empty text', { text: '   ' }],
    ['text over 300 characters', { text: `${'x'.repeat(300)}?` }],
  ])('drops a Question with %s, without spending a verification on it', async (_why, extra) => {
    const model = fakeModel([[candidate(1, extra), candidate(2)]]);
    const result = await generateQuiz(model, { ...request, count: 1, avoid: [] });
    expect(result.ok && result.questions.map((q) => q.text)).toEqual(['Question 2?']);
    expect(model.verify).toHaveBeenCalledTimes(1);
  });

  it("drops repeats of the Host's earlier Questions and of each other, ignoring case and spacing", async () => {
    const model = fakeModel([
      [
        candidate(1, { text: 'what is the CAPITAL  of France?' }),
        candidate(2),
        candidate(3, { text: 'question 2' }),
      ],
    ]);
    const result = await generateQuiz(model, {
      ...request,
      count: 3,
      avoid: ['What is the capital of France?'],
    });
    expect(result.ok && result.questions.map((q) => q.text)).toEqual(['Question 2?']);
  });
});
