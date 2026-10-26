// The API Lambda: adapts API Gateway (HTTP API, payload v2, Cognito JWT authoriser) events to
// the router, with the real dependencies. Environment variables come from infra/api.yaml.
import { randomUUID, webcrypto } from 'node:crypto';
import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { createEventsPublisher } from '../aws/events-publisher.js';
import { playerTokenKey } from '../aws/signing-key.js';
import { handleHttp } from '../http/router.js';
import { signPlayerToken, verifyPlayerToken } from '../player-token.js';
import { DynamoRepository } from '../repository/dynamo-repository.js';
import { createGameService } from '../service/game-service.js';
import { createQuizService } from '../service/quiz-service.js';
import { createJobStarter } from '../aws/quiz-jobs.js';

/** How long a Player token stays valid (PLAN §5). */
const PLAYER_TOKEN_TTL_SECONDS = 48 * 60 * 60;

const repo = new DynamoRepository(required('TABLE_NAME'));
const publish = createEventsPublisher(
  required('EVENTS_HTTP_DOMAIN'),
  process.env.AWS_REGION ?? 'ap-southeast-2',
);

/** Generations per Host per day (FR-2.7). */
const GENERATION_LIMIT = 20;

const quizzes = createQuizService({
  repo,
  now: () => Date.now(),
  newId: randomUUID,
  startJob: createJobStarter(required('WORKER_FUNCTION_NAME')),
  agent: async () => {
    throw new Error('only the worker Lambda calls the agent');
  },
  generationLimit: GENERATION_LIMIT,
});

/** A cryptographically random number in [0, 1), for Join Codes. */
function secureRandom(): number {
  return webcrypto.getRandomValues(new Uint32Array(1))[0]! / 2 ** 32;
}

export const handler = async (
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> => {
  const key = await playerTokenKey();
  const nowSeconds = () => Math.floor(Date.now() / 1000);

  const service = createGameService({
    repo,
    now: () => Date.now(),
    newId: randomUUID,
    random: secureRandom,
    issuePlayerToken: ({ gameId, playerId }) =>
      signPlayerToken({ gameId, playerId, exp: nowSeconds() + PLAYER_TOKEN_TTL_SECONDS }, key),
    publish,
  });

  const hostId = event.requestContext.authorizer?.jwt?.claims?.sub;
  const body =
    event.body === undefined
      ? null
      : event.isBase64Encoded
        ? Buffer.from(event.body, 'base64').toString('utf8')
        : event.body;

  return handleHttp(
    {
      method: event.requestContext.http.method,
      path: event.rawPath,
      headers: event.headers,
      body,
      ...(typeof hostId === 'string' ? { hostId } : {}),
    },
    {
      service,
      quizzes,
      verifyPlayer: (token) => {
        const claims = verifyPlayerToken(token, key, nowSeconds());
        return claims ? { gameId: claims.gameId, playerId: claims.playerId } : null;
      },
    },
  );
};

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}
