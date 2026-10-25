// AppSync Events Lambda authoriser (PLAN §6, ADR 0002).
// Players may connect, and may subscribe only to their own Game's players channel.
// Nobody is ever authorised to publish through this authoriser: publishing is IAM-only.
// Not yet handled: Host Cognito tokens (M2) and the removed-Player check (M4).
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { verifyPlayerToken } from './player-token.js';

export interface EventsAuthoriserEvent {
  authorizationToken: string;
  requestContext: {
    apiId: string;
    accountId: string;
    requestId: string;
    operation: 'EVENT_CONNECT' | 'EVENT_SUBSCRIBE' | 'EVENT_PUBLISH';
    channelNamespaceName: string | null;
    channel: string | null;
  };
  requestHeaders: Record<string, string>;
}

export interface EventsAuthoriserResult {
  isAuthorized: boolean;
  ttlOverride?: number;
  handlerContext?: Record<string, string>;
}

/** How long AppSync may cache an allow decision. Short, so Player removal takes effect quickly. */
const ALLOW_TTL_SECONDS = 60;

const DENY: EventsAuthoriserResult = { isAuthorized: false, ttlOverride: 0 };

export function playersChannel(gameId: string): string {
  return `/game/${gameId}/players`;
}

export function authorise(
  event: EventsAuthoriserEvent,
  key: string,
  nowSeconds: number,
): EventsAuthoriserResult {
  const claims = verifyPlayerToken(event.authorizationToken, key, nowSeconds);
  if (!claims) return DENY;

  const allow: EventsAuthoriserResult = {
    isAuthorized: true,
    ttlOverride: ALLOW_TTL_SECONDS,
    handlerContext: { gameId: claims.gameId, playerId: claims.playerId },
  };

  switch (event.requestContext.operation) {
    case 'EVENT_CONNECT':
      return allow;
    case 'EVENT_SUBSCRIBE':
      return normaliseChannel(event.requestContext.channel) === playersChannel(claims.gameId)
        ? allow
        : DENY;
    default:
      return DENY;
  }
}

/** AppSync may send channels with or without leading/trailing slashes. */
function normaliseChannel(channel: string | null): string | null {
  if (channel === null) return null;
  return `/${channel.replace(/^\/+|\/+$/g, '')}`;
}

const secrets = new SecretsManagerClient({});
let keyPromise: Promise<string> | undefined;

function signingKey(): Promise<string> {
  keyPromise ??= secrets
    .send(new GetSecretValueCommand({ SecretId: process.env.PLAYER_TOKEN_SECRET_ARN }))
    .then((res) => {
      if (!res.SecretString) throw new Error('Player token secret is empty');
      return res.SecretString;
    })
    .catch((err: unknown) => {
      keyPromise = undefined;
      throw err;
    });
  return keyPromise;
}

export const handler = async (event: EventsAuthoriserEvent): Promise<EventsAuthoriserResult> =>
  authorise(event, await signingKey(), Math.floor(Date.now() / 1000));
