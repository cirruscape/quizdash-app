// Runs the repository contract against a real DynamoDB table, on demand only:
//   QUIZAPP_DYNAMO_TABLE=quizapp-dev AWS_PROFILE=quizdash AWS_REGION=ap-southeast-2 \
//     pnpm vitest run packages/api/src/repository/dynamo-repository.test.ts
// Every ID the contract writes is unique to the run.
import { describe } from 'vitest';
import { DynamoRepository } from './dynamo-repository.js';
import { repositoryContract } from './repository.contract.js';

const table = process.env.QUIZAPP_DYNAMO_TABLE;

if (table) {
  repositoryContract('DynamoDB', () => new DynamoRepository(table));
} else {
  describe.skip('DynamoDB repository contract (set QUIZAPP_DYNAMO_TABLE to run)', () => {});
}
