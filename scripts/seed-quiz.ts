// Seeds the sample Ready Quiz for a Host, so a Game can be played before Quiz generation (M3).
// Dev only. Usage:
//   AWS_PROFILE=quizdash pnpm --filter @quizapp/scripts seed -- you@example.com
import { DynamoRepository } from '@quizapp/api/repository';
import { APP_ENV, hostIdForEmail, stackOutputs } from './lib/aws.js';
import { sampleQuiz } from './lib/sample-quiz.js';

const email = process.argv.slice(2).find((a) => a !== '--');
if (!email) {
  console.error('usage: seed-quiz <host email>');
  process.exit(2);
}
if (APP_ENV === 'prod') {
  console.error('refusing to seed prod: sample Quizzes are a dev-only fixture');
  process.exit(2);
}

const foundation = await stackOutputs('foundation');
const hostId = await hostIdForEmail(foundation.UserPoolId as string, email);
if (!hostId) {
  console.error(`no Host with email ${email}: sign up in the app first`);
  process.exit(1);
}

const quiz = sampleQuiz();
await new DynamoRepository(foundation.TableName as string).putQuiz(hostId, quiz);
console.log(`seeded "${quiz.quizId}" (${quiz.questions.length} Questions) for ${email}`);
