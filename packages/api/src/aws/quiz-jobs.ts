// The Quiz service's two AWS-backed dependencies (PLAN §8):
//   startJob: an asynchronous invoke of the worker Lambda, which has retries turned off (Q2)
//   agent:    a synchronous call to the AgentCore generation agent, made by the worker
import { randomUUID } from 'node:crypto';
import {
  BedrockAgentCoreClient,
  InvokeAgentRuntimeCommand,
} from '@aws-sdk/client-bedrock-agentcore';
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { AgentResponse, type AgentRequest } from '@quizapp/contracts';
import type { QuizJob } from '../service/quiz-service.js';

export function createJobStarter(workerFunctionName: string): (job: QuizJob) => Promise<void> {
  const lambda = new LambdaClient({});
  return async (job) => {
    await lambda.send(
      new InvokeCommand({
        FunctionName: workerFunctionName,
        InvocationType: 'Event', // don't wait: generation takes tens of seconds
        Payload: Buffer.from(JSON.stringify(job)),
      }),
    );
  };
}

export function createAgentClient(
  runtimeArn: string,
): (request: AgentRequest) => Promise<AgentResponse> {
  const agentCore = new BedrockAgentCoreClient({});
  return async (request) => {
    const res = await agentCore.send(
      new InvokeAgentRuntimeCommand({
        agentRuntimeArn: runtimeArn,
        // One session per job: no state is shared between generations. At least 33 characters.
        runtimeSessionId: `quiz-${randomUUID()}`,
        contentType: 'application/json',
        accept: 'application/json',
        payload: Buffer.from(JSON.stringify(request)),
      }),
    );
    const body = await res.response?.transformToString();
    return AgentResponse.parse(JSON.parse(body ?? ''));
  };
}
