// The real GenerationModel: two Strands agents on the configured Bedrock model, via Converse
// (ADR 0005). Structured output comes from Converse tool use (Strands' structured output), since
// Nova 2 Lite has no native structured outputs.
import { Agent } from '@strands-agents/sdk';
import { z } from 'zod';
import { createModel, type ModelConfig } from '../model.js';
import { ModelRefusedError, type Candidate, type GenerationModel } from './pipeline.js';

const DIFFICULTY_GUIDE = {
  EASY: 'widely known facts most adults would recognise',
  MEDIUM: 'facts a keen enthusiast would know',
  HARD: 'specialist knowledge that challenges experts',
} as const;

const GeneratedBatch = z.object({
  declined: z
    .boolean()
    .describe('true only if the Topic is unsuitable for a friendly trivia game; then no questions'),
  questions: z.array(
    z.object({
      text: z.string().describe('The question, ending with a question mark'),
      options: z.array(z.string()).min(2).max(4).describe('2 to 4 answer options'),
      correctIndex: z.number().int().describe('Index into options of the single correct answer'),
    }),
  ),
});

const Verdict = z.object({
  ok: z
    .boolean()
    .describe('true only if exactly one option is defensibly correct and it is the one marked'),
  reason: z.string().describe('One short sentence explaining the verdict'),
});

const WRITER = `You write multiple-choice trivia questions for a live party game.
Every question has 2 to 4 options and exactly one answer that is clearly, defensibly correct.
Wrong options are plausible but unambiguously wrong. Avoid trick questions, opinions, and facts
that change often. Keep questions and options short enough to read on a phone.`;

const CHECKER = `You are a sceptical fact-checker for a trivia game. Judge one question:
is exactly one option defensibly correct, is it the option marked correct, and is the question
unambiguous? If you are unsure, or two options could be argued, the question fails.`;

/** Model calls that stopped because the model or a filter declined the content. */
const REFUSALS = new Set(['refusal', 'contentFiltered', 'guardrailIntervened']);

export function createBedrockGenerationModel(config: ModelConfig): GenerationModel {
  const model = createModel({ ...config, maxTokens: 4096 });

  return {
    async generate({ topic, difficulty, count, avoid }) {
      const agent = new Agent({ model, systemPrompt: WRITER, printer: false });
      const avoidList = avoid.length
        ? `\nDo not repeat or closely resemble any of these questions:\n${avoid.map((t) => `- ${t}`).join('\n')}`
        : '';
      const result = await agent.invoke(
        `Write ${count} questions about the topic "${topic}". Difficulty: ${difficulty.toLowerCase()} (${DIFFICULTY_GUIDE[difficulty]}).${avoidList}`,
        { structuredOutputSchema: GeneratedBatch },
      );
      if (REFUSALS.has(result.stopReason)) throw new ModelRefusedError();
      const batch = GeneratedBatch.parse(result.structuredOutput);
      if (batch.declined) throw new ModelRefusedError();
      return batch.questions satisfies Candidate[];
    },

    async verify({ topic, question }) {
      const agent = new Agent({ model, systemPrompt: CHECKER, printer: false });
      const options = question.options.map((o, i) => `${i + 1}. ${o}`).join('\n');
      const result = await agent.invoke(
        `Topic: ${topic}\nQuestion: ${question.text}\nOptions:\n${options}\nMarked correct: option ${question.correctIndex + 1}`,
        { structuredOutputSchema: Verdict },
      );
      if (REFUSALS.has(result.stopReason)) return { ok: false, reason: 'the checker declined' };
      return Verdict.parse(result.structuredOutput);
    },
  };
}
