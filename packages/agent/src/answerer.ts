// Spike A (PLAN §10, M0): prove a Strands agent on AgentCore can call a Bedrock model through
// the Converse API. The real generate/verify pipeline arrives in M3.
import { Agent } from '@strands-agents/sdk';
import { createModel, type ModelConfig } from './model.js';

export type Answerer = (prompt: string) => Promise<string>;

export function createAnswerer(config: ModelConfig): Answerer {
  const model = createModel(config);

  return async (prompt) => {
    // A fresh Agent per request, so no conversation history leaks between invocations.
    const agent = new Agent({
      model,
      systemPrompt: 'You are a trivia expert. Answer briefly.',
    });
    const result = await agent.invoke(prompt);
    return result.toString();
  };
}
