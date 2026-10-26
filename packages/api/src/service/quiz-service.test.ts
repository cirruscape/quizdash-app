import type { AgentRequest, AgentResponse } from '@quizapp/contracts';
import { describe, expect, it } from 'vitest';
import { MemoryRepository } from '../repository/memory-repository.js';
import { sampleQuiz } from '../repository/repository.contract.js';
import {
  createQuizService,
  sydneyDay,
  type QuizJob,
  type QuizServiceDeps,
} from './quiz-service.js';

const HOST = 'host-1';
// 2026-10-25 23:30 in Sydney (AEDT, UTC+11).
const LATE_SATURDAY = Date.UTC(2026, 9, 25, 12, 30);
const request = {
  topic: '90s Britpop',
  difficulty: 'MEDIUM',
  questionCount: 5,
  defaultTimeLimitSeconds: 20,
} as const;

function generated(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    text: `Generated ${i + 1}?`,
    options: [
      { optionId: 'a', text: 'Yes' },
      { optionId: 'b', text: 'No' },
    ],
    correctOptionId: 'a',
  }));
}

function harness(overrides: Partial<QuizServiceDeps> = {}) {
  const repo = new MemoryRepository();
  const clock = { now: LATE_SATURDAY };
  const jobs: QuizJob[] = [];
  const agentCalls: AgentRequest[] = [];
  let agentReply: AgentResponse | Error = { status: 'success', questions: generated(5) };
  let ids = 0;
  const service = createQuizService({
    repo,
    now: () => clock.now,
    newId: () => `id${++ids}`,
    startJob: async (job) => {
      jobs.push(job);
    },
    agent: async (req) => {
      agentCalls.push(req);
      if (agentReply instanceof Error) throw agentReply;
      return agentReply;
    },
    generationLimit: 3,
    ...overrides,
  });
  return {
    service,
    repo,
    clock,
    jobs,
    agentCalls,
    reply: (r: AgentResponse | Error) => {
      agentReply = r;
    },
  };
}

describe('createQuiz', () => {
  it('stores a generating Quiz and hands the work to a background job', async () => {
    const { service, repo, jobs } = harness();
    const result = await service.createQuiz(HOST, request);
    if (!result.ok) throw new Error(result.error);

    expect(await repo.getQuiz(HOST, result.value.quizId)).toMatchObject({
      status: 'GENERATING',
      topic: '90s Britpop',
      requestedCount: 5,
    });
    expect(jobs).toEqual([{ kind: 'generate', hostId: HOST, quizId: result.value.quizId }]);
  });

  it('refuses an invalid request without using a generation or starting work', async () => {
    const { service, jobs } = harness({ generationLimit: 1 });
    expect(await service.createQuiz(HOST, { ...request, questionCount: 99 })).toEqual({
      ok: false,
      error: 'INVALID_QUESTION_COUNT',
    });
    expect(jobs).toEqual([]);
    expect((await service.createQuiz(HOST, request)).ok).toBe(true); // the one generation remains
  });

  it('allows the daily limit, then refuses until midnight in Sydney (FR-2.7, D6)', async () => {
    const { service, clock } = harness(); // limit 3
    for (let i = 0; i < 3; i++) expect((await service.createQuiz(HOST, request)).ok).toBe(true);
    expect(await service.createQuiz(HOST, request)).toEqual({ ok: false, error: 'QUOTA_EXCEEDED' });

    clock.now = LATE_SATURDAY + 60 * 60 * 1000; // 00:30 Sunday in Sydney
    expect((await service.createQuiz(HOST, request)).ok).toBe(true);
  });
});

describe('sydneyDay', () => {
  it('names the calendar day in Sydney, not UTC', () => {
    expect(sydneyDay(Date.UTC(2026, 9, 25, 12, 30))).toBe('2026-10-25'); // 23:30 AEDT
    expect(sydneyDay(Date.UTC(2026, 9, 25, 13, 30))).toBe('2026-10-26'); // 00:30 AEDT
  });
});

describe('runJob: generate', () => {
  async function created(h: ReturnType<typeof harness>) {
    const result = await h.service.createQuiz(HOST, request);
    if (!result.ok) throw new Error(result.error);
    return result.value.quizId;
  }

  it('turns the Quiz into a Draft, giving each Question its own ID', async () => {
    const h = harness();
    const quizId = await created(h);
    await h.service.runJob(h.jobs[0]!);

    const quiz = await h.repo.getQuiz(HOST, quizId);
    expect(quiz?.status).toBe('DRAFT');
    expect(quiz?.questions).toHaveLength(5);
    const ids = quiz?.questions.map((q) => q.questionId) ?? [];
    expect(new Set(ids).size).toBe(5);
    expect(ids).not.toContain(quizId);
  });

  it("asks the agent to avoid the Host's earlier Questions on similar Topics only", async () => {
    const h = harness();
    await h.repo.putQuiz(HOST, {
      ...sampleQuiz('older-britpop'),
      topic: 'Britpop bands',
      questions: [{ ...sampleQuiz().questions[0]!, text: 'Who sang Wonderwall?' }],
    });
    await h.repo.putQuiz(HOST, {
      ...sampleQuiz('older-maths'),
      topic: 'Prime numbers',
      questions: [{ ...sampleQuiz().questions[0]!, text: 'Is 7 prime?' }],
    });
    await created(h);
    await h.service.runJob(h.jobs[0]!);

    expect(h.agentCalls).toEqual([
      {
        mode: 'generate',
        topic: '90s Britpop',
        difficulty: 'MEDIUM',
        count: 5,
        avoid: ['Who sang Wonderwall?'],
      },
    ]);
  });

  it('marks the Quiz Failed when the agent refuses the Topic, or fails outright', async () => {
    const h = harness();
    const refused = await created(h);
    h.reply({ status: 'error', error: 'TOPIC_REFUSED' });
    await h.service.runJob(h.jobs[0]!);
    expect(await h.repo.getQuiz(HOST, refused)).toMatchObject({
      status: 'FAILED',
      failureReason: 'TOPIC_REFUSED',
    });

    const crashed = await created(h);
    h.reply(new Error('AgentCore timed out'));
    await h.service.runJob(h.jobs[1]!);
    expect(await h.repo.getQuiz(HOST, crashed)).toMatchObject({
      status: 'FAILED',
      failureReason: 'GENERATION_FAILED',
    });
  });
});

/** A harness with one generated Draft of 6 Questions. */
async function withDraft() {
  const h = harness();
  h.reply({ status: 'success', questions: generated(6) });
  const created = await h.service.createQuiz(HOST, { ...request, questionCount: 6 });
  if (!created.ok) throw new Error(created.error);
  await h.service.runJob(h.jobs.shift()!);
  const quiz = await h.repo.getQuiz(HOST, created.value.quizId);
  return {
    ...h,
    quizId: created.value.quizId,
    questionIds: quiz!.questions.map((q) => q.questionId),
  };
}

describe('reviewing a Draft', () => {
  it('lets the Host read, discard, override a Time Limit, and approve', async () => {
    const { service, quizId, questionIds } = await withDraft();

    expect((await service.discardQuestion(HOST, quizId, questionIds[0]!)).ok).toBe(true);
    expect((await service.setTimeLimit(HOST, quizId, questionIds[1]!, 45)).ok).toBe(true);
    const read = await service.getQuiz(HOST, quizId);
    expect(read.ok && read.value.questions.map((q) => q.timeLimitSeconds ?? null)).toEqual([
      45,
      null,
      null,
      null,
      null,
    ]);

    const approved = await service.approveQuiz(HOST, quizId);
    expect(approved.ok && approved.value.status).toBe('READY');
  });

  it('lists every Quiz with its status, so Drafts and failures show up too', async () => {
    const { service, repo, quizId } = await withDraft();
    await repo.putQuiz(HOST, { ...sampleQuiz('ready'), topic: 'Capitals' });

    const listed = await service.listQuizzes(HOST);
    expect(listed.ok && [...listed.value].sort((a, b) => a.quizId.localeCompare(b.quizId))).toEqual(
      [
        { quizId, topic: '90s Britpop', status: 'DRAFT', questionCount: 6, failureReason: null },
        {
          quizId: 'ready',
          topic: 'Capitals',
          status: 'READY',
          questionCount: 1,
          failureReason: null,
        },
      ],
    );
  });

  it('deletes a Quiz', async () => {
    const { service, quizId } = await withDraft();
    expect((await service.deleteQuiz(HOST, quizId)).ok).toBe(true);
    expect(await service.getQuiz(HOST, quizId)).toEqual({ ok: false, error: 'QUIZ_NOT_FOUND' });
  });

  it("keeps every operation to the Quiz's own Host", async () => {
    const { service, quizId, questionIds } = await withDraft();
    const notFound = { ok: false, error: 'QUIZ_NOT_FOUND' };
    expect(await service.getQuiz('intruder', quizId)).toEqual(notFound);
    expect(await service.discardQuestion('intruder', quizId, questionIds[0]!)).toEqual(notFound);
    expect(await service.approveQuiz('intruder', quizId)).toEqual(notFound);
    expect(await service.deleteQuiz('intruder', quizId)).toEqual(notFound);
    expect((await service.getQuiz(HOST, quizId)).ok).toBe(true);
  });
});

describe('regenerating one Question', () => {
  it('replaces it in the background, avoiding the Draft’s other Questions', async () => {
    const h = await withDraft();
    const target = h.questionIds[2]!;

    expect((await h.service.regenerateQuestion(HOST, h.quizId, target)).ok).toBe(true);
    const marked = await h.service.getQuiz(HOST, h.quizId);
    expect(marked.ok && marked.value.questions[2]?.status).toBe('REGENERATING');
    expect(h.jobs).toEqual([
      { kind: 'regenerate', hostId: HOST, quizId: h.quizId, questionId: target },
    ]);

    h.reply({ status: 'success', questions: [{ ...generated(1)[0]!, text: 'Fresh one?' }] });
    h.agentCalls.length = 0;
    await h.service.runJob(h.jobs[0]!);

    expect(h.agentCalls[0]).toMatchObject({ mode: 'regenerate', topic: '90s Britpop' });
    expect((h.agentCalls[0] as { avoid: string[] }).avoid).toEqual(
      expect.arrayContaining(['Generated 1?', 'Generated 3?', 'Generated 6?']),
    );
    const done = await h.service.getQuiz(HOST, h.quizId);
    expect(done.ok && done.value.questions[2]).toMatchObject({
      questionId: target,
      text: 'Fresh one?',
    });
    expect(done.ok && done.value.questions[2]?.status).toBeUndefined();
  });

  it('restores the old Question if the agent fails', async () => {
    const h = await withDraft();
    const target = h.questionIds[0]!;
    await h.service.regenerateQuestion(HOST, h.quizId, target);
    h.reply(new Error('timed out'));
    await h.service.runJob(h.jobs[0]!);

    const quiz = await h.service.getQuiz(HOST, h.quizId);
    expect(quiz.ok && quiz.value.questions[0]).toMatchObject({
      questionId: target,
      text: 'Generated 1?',
    });
    expect(quiz.ok && quiz.value.questions[0]?.status).toBeUndefined();
  });

  it('counts against the daily limit, but only once the request is valid', async () => {
    const h = await withDraft(); // the Draft used 1 of the 3 generations
    expect(await h.service.regenerateQuestion(HOST, h.quizId, 'no-such-question')).toEqual({
      ok: false,
      error: 'QUESTION_NOT_FOUND',
    });
    expect((await h.service.regenerateQuestion(HOST, h.quizId, h.questionIds[0]!)).ok).toBe(true);
    expect((await h.service.regenerateQuestion(HOST, h.quizId, h.questionIds[1]!)).ok).toBe(true);
    expect(await h.service.regenerateQuestion(HOST, h.quizId, h.questionIds[2]!)).toEqual({
      ok: false,
      error: 'QUOTA_EXCEEDED',
    });
  });
});
