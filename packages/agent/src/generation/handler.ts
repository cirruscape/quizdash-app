// Maps an AgentRequest onto the pipeline: a whole Quiz, or one replacement Question.
import type { AgentRequest, AgentResponse } from '@quizapp/contracts';
import { generateQuiz, type GenerationModel } from './pipeline.js';

export function createGenerationHandler(model: GenerationModel) {
  return async (request: AgentRequest): Promise<AgentResponse> => {
    const count = request.mode === 'generate' ? request.count : 1;
    const result = await generateQuiz(model, {
      topic: request.topic,
      difficulty: request.difficulty,
      count,
      avoid: request.avoid,
    });
    return result.ok
      ? { status: 'success', questions: result.questions }
      : { status: 'error', error: result.error };
  };
}
