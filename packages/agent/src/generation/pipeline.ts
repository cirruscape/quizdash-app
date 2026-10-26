// The Quiz generation pipeline (PLAN §8, ADR 0001): generate, verify each Question separately,
// regenerate failures (at most two more rounds), validating in code throughout. Orchestrated in
// code, not by the model, so its behaviour is predictable. The model sits behind
// GenerationModel, so this file is tested without Bedrock.

export type Difficulty = 'EASY' | 'MEDIUM' | 'HARD';

/** A Question as the model proposes it. */
export interface Candidate {
  text: string;
  /** 2–4 Options. */
  options: string[];
  correctIndex: number;
}

export interface GenerateInput {
  topic: string;
  difficulty: Difficulty;
  count: number;
  /** Question texts to steer away from: the Host's earlier ones, and anything already seen. */
  avoid: string[];
}

export interface GenerationModel {
  generate(input: GenerateInput): Promise<Candidate[]>;
  /** An independent check: exactly one Option defensibly correct, and unambiguous. */
  verify(input: {
    topic: string;
    difficulty: Difficulty;
    question: Candidate;
  }): Promise<{ ok: boolean; reason: string }>;
}

/** Thrown by a GenerationModel when the model declines the Topic (FR-2.6). */
export class ModelRefusedError extends Error {
  constructor() {
    super('the model declined this Topic');
    this.name = 'ModelRefusedError';
  }
}

export interface GeneratedQuestion {
  text: string;
  options: { optionId: string; text: string }[];
  correctOptionId: string;
}

export type GenerationResult =
  | { ok: true; questions: GeneratedQuestion[] }
  | { ok: false; error: 'TOPIC_REFUSED' | 'GENERATION_FAILED' };

/** The first round plus two replacement rounds (PLAN §8). */
const ROUNDS = 3;

export async function generateQuiz(
  model: GenerationModel,
  input: GenerateInput,
): Promise<GenerationResult> {
  const kept: Candidate[] = [];
  const seen = [...input.avoid];
  const seenKeys = new Set(input.avoid.map(textKey));
  try {
    for (let round = 0; round < ROUNDS && kept.length < input.count; round++) {
      const batch = await model.generate({
        topic: input.topic,
        difficulty: input.difficulty,
        count: input.count - kept.length,
        avoid: [...seen],
      });
      // Drop malformed Questions and repeats before spending a verification call on them.
      const fresh = batch.filter((question) => {
        const key = textKey(question.text);
        const usable = isWellFormed(question) && !seenKeys.has(key);
        seenKeys.add(key);
        seen.push(question.text);
        return usable;
      });
      const verdicts = await Promise.all(
        fresh.map((question) =>
          model.verify({ topic: input.topic, difficulty: input.difficulty, question }),
        ),
      );
      fresh.forEach((question, i) => {
        if (verdicts[i]?.ok && kept.length < input.count) kept.push(question);
      });
    }
  } catch (err) {
    if (err instanceof ModelRefusedError) return { ok: false, error: 'TOPIC_REFUSED' };
    throw err;
  }
  if (kept.length === 0) return { ok: false, error: 'GENERATION_FAILED' };
  return { ok: true, questions: kept.map(labelled) };
}

const MAX_TEXT = 300;
const MAX_OPTION = 120;

/** The shape rules from FR-2.3: 2–4 distinct, non-empty Options, exactly one correct. */
function isWellFormed(c: Candidate): boolean {
  const text = c.text.trim();
  const options = c.options.map((o) => o.trim());
  return (
    text.length > 0 &&
    text.length <= MAX_TEXT &&
    options.length >= 2 &&
    options.length <= 4 &&
    options.every((o) => o.length > 0 && o.length <= MAX_OPTION) &&
    new Set(options.map((o) => o.toLowerCase())).size === options.length &&
    Number.isInteger(c.correctIndex) &&
    c.correctIndex >= 0 &&
    c.correctIndex < options.length
  );
}

/** Compares Question texts ignoring case, spacing and punctuation. */
function textKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function labelled(c: Candidate): GeneratedQuestion {
  const ids = ['a', 'b', 'c', 'd'];
  return {
    text: c.text.trim(),
    options: c.options.map((text, i) => ({ optionId: ids[i] as string, text: text.trim() })),
    correctOptionId: ids[c.correctIndex] as string,
  };
}
