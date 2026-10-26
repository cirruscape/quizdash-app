// The abandonment sweeper (FR-8.4, D8): runs hourly, finishing every Game idle for 24 hours.
// It uses the same game service as the API, so History, released claims and GAME_FINISHED
// events are handled exactly as for a Game the Host finishes.
import { randomUUID } from 'node:crypto';
import { createEventsPublisher } from '../aws/events-publisher.js';
import { DynamoRepository } from '../repository/dynamo-repository.js';
import { createGameService } from '../service/game-service.js';

const service = createGameService({
  repo: new DynamoRepository(required('TABLE_NAME')),
  now: () => Date.now(),
  newId: randomUUID,
  random: Math.random,
  publish: createEventsPublisher(
    required('EVENTS_HTTP_DOMAIN'),
    process.env.AWS_REGION ?? 'ap-southeast-2',
  ),
  // The sweeper never joins anyone or issues tokens.
  issuePlayerToken: () => {
    throw new Error('the sweeper does not issue Player tokens');
  },
  isBlocked: () => false,
  isToxic: async () => false,
});

export const handler = async (): Promise<{ abandoned: number }> => {
  const result = await service.abandonIdleGames();
  console.log(`abandoned ${result.abandoned} idle Games`);
  return result;
};

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}
