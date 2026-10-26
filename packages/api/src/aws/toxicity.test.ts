// Runs the toxicity check against the real Comprehend service, on demand only:
//   QUIZAPP_COMPREHEND=1 AWS_PROFILE=quizdash AWS_REGION=ap-southeast-2 \
//     pnpm vitest run packages/api/src/aws/toxicity.test.ts
import { describe, expect, it } from 'vitest';
import { createToxicityCheck } from './toxicity.js';

const enabled = process.env.QUIZAPP_COMPREHEND === '1';

(enabled ? describe : describe.skip)('Comprehend toxicity check (set QUIZAPP_COMPREHEND=1)', () => {
  const isToxic = createToxicityCheck(undefined); // the default 0.5 threshold

  it.each(['Quiz Whiz', 'Alice', 'Team Rocket', 'Captain Sparkle'])(
    'passes the ordinary Nickname %j',
    async (name) => {
      expect(await isToxic(name)).toBe(false);
    },
  );

  it('flags an obviously abusive Nickname', async () => {
    expect(await isToxic('you stupid idiot')).toBe(true);
  });
});
