// The worker Lambda (PLAN §8): runs Quiz generation jobs in the background, invoked
// asynchronously by the API Lambda with retries off, so a job never runs (or charges) twice.
import { randomUUID } from 'node:crypto';
import { createAgentClient } from '../aws/quiz-jobs.js';
import { DynamoRepository } from '../repository/dynamo-repository.js';
import { createQuizService, type QuizJob } from '../service/quiz-service.js';

const quizzes = createQuizService({
  repo: new DynamoRepository(required('TABLE_NAME')),
  now: () => Date.now(),
  newId: randomUUID,
  startJob: async () => {
    throw new Error('the worker does not start jobs');
  },
  agent: createAgentClient(required('AGENT_RUNTIME_ARN')),
  generationLimit: 20,
});

export const handler = async (job: QuizJob): Promise<void> => {
  await quizzes.runJob(job);
};

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}
