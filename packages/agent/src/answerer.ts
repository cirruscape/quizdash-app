// Spike A (PLAN §10, M0): prove a Strands agent on AgentCore can call Claude Opus 5.5 through
// the Australian Bedrock inference profile. The real generate/verify pipeline arrives in M3.
import { Agent, BedrockModel } from '@strands-agents/sdk';

export type Answerer = (prompt: string) => Promise<string>;

export interface AnswererConfig {
  region: string;
  modelId: string;
}

export function createAnswerer({ region, modelId }: AnswererConfig): Answerer {
  // No temperature/topP: Claude Opus 5.5 rejects sampling parameters.
  const model = new BedrockModel({ region, modelId, maxTokens: 1024 });

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
