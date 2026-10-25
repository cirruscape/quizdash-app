// The single place a model is constructed (ADR 0005). Every model call goes through the
// Amazon Bedrock Converse API via Strands' BedrockModel, so switching models (e.g. Nova 2 Lite
// back to Claude Opus 5.5) is a configuration change: MODEL_ID, plus the agent stack's IAM
// parameters. ESLint forbids constructing models or calling Bedrock InvokeModel anywhere else.
import { BedrockModel } from '@strands-agents/sdk';

export interface ModelConfig {
  region: string;
  /** Bedrock model or inference profile ID, e.g. global.amazon.nova-2-lite-v1:0 */
  modelId: string;
  maxTokens?: number;
}

export function createModel({ region, modelId, maxTokens = 1024 }: ModelConfig): BedrockModel {
  return new BedrockModel({
    region,
    modelId,
    maxTokens,
    // Streaming, so Strands sends ConverseStreamCommand (the Converse API's streaming form) and
    // callers can consume tokens as they arrive. Needs bedrock:InvokeModelWithResponseStream.
    stream: true,
    // No temperature/topP: portable Converse settings only. Claude Opus 5.5 rejects sampling
    // parameters, so leaving them out keeps every candidate model swappable.
  });
}

/** Reads the model configuration from the environment set by infra/agent.yaml. */
export function modelConfigFromEnv(env: NodeJS.ProcessEnv = process.env): ModelConfig {
  const modelId = env.MODEL_ID;
  if (!modelId) throw new Error('MODEL_ID is not set');
  return { region: env.AWS_REGION ?? 'ap-southeast-2', modelId };
}
