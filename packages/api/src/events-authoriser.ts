// AppSync Events Lambda authoriser (PLAN §6, ADR 0002). Nobody publishes through it:
// publishing is IAM-only, for the backend.
//   Players (Player token): may connect, and subscribe only to /game/{theirGame}/players.
//   Hosts (Cognito token):  may connect, and subscribe to both channels of Games they own.
// Not yet handled: the removed-Player check (M4).
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { playerTokenKey } from './aws/signing-key.js';
import { verifyPlayerToken } from './player-token.js';
import { DynamoRepository } from './repository/dynamo-repository.js';

export interface EventsAuthoriserEvent {
  authorizationToken: string;
  requestContext: {
    apiId: string;
    accountId: string;
    requestId: string;
    operation: 'EVENT_CONNECT' | 'EVENT_SUBSCRIBE' | 'EVENT_PUBLISH';
    /** Absent (not null) on EVENT_CONNECT, despite what the docs suggest. */
    channelNamespaceName?: string | null;
    channel?: string | null;
  };
  requestHeaders: Record<string, string>;
}

export interface EventsAuthoriserResult {
  isAuthorized: boolean;
  ttlOverride?: number;
  handlerContext?: Record<string, string>;
}

export interface AuthoriserDeps {
  playerKey: string;
  nowSeconds: number;
  /** The Host's ID if the token is a valid Cognito token for our user pool, else null. */
  verifyHost: (token: string) => Promise<string | null>;
  /** The Host who owns a Game, or null if there's no such Game. */
  gameOwner: (gameId: string) => Promise<string | null>;
}

/** How long AppSync may cache an allow decision. Short, so Player removal takes effect quickly. */
const ALLOW_TTL_SECONDS = 60;

const DENY: EventsAuthoriserResult = { isAuthorized: false, ttlOverride: 0 };

const CHANNEL = /^\/game\/(?<gameId>[A-Za-z0-9-]{1,50})\/(?<audience>players|host)$/;

export function playersChannel(gameId: string): string {
  return `/game/${gameId}/players`;
}

export async function authorise(
  event: EventsAuthoriserEvent,
  deps: AuthoriserDeps,
): Promise<EventsAuthoriserResult> {
  const { operation } = event.requestContext;
  if (operation === 'EVENT_PUBLISH') return DENY;
  const channel = normaliseChannel(event.requestContext.channel);

  const player = verifyPlayerToken(event.authorizationToken, deps.playerKey, deps.nowSeconds);
  if (player) {
    const allow = {
      isAuthorized: true,
      ttlOverride: ALLOW_TTL_SECONDS,
      handlerContext: { gameId: player.gameId, playerId: player.playerId },
    };
    if (operation === 'EVENT_CONNECT') return allow;
    return channel === playersChannel(player.gameId) ? allow : DENY;
  }

  const hostId = await deps.verifyHost(event.authorizationToken);
  if (!hostId) return DENY;
  const allow = { isAuthorized: true, ttlOverride: ALLOW_TTL_SECONDS, handlerContext: { hostId } };
  if (operation === 'EVENT_CONNECT') return allow;
  const gameId = CHANNEL.exec(channel ?? '')?.groups?.gameId;
  if (!gameId) return DENY;
  return (await deps.gameOwner(gameId)) === hostId ? allow : DENY;
}

/** AppSync may send channels with or without leading/trailing slashes. */
function normaliseChannel(channel: string | null | undefined): string | null {
  if (channel === null || channel === undefined) return null;
  return `/${channel.replace(/^\/+|\/+$/g, '')}`;
}

// Created on first use: a Player-only request never needs Cognito or DynamoDB configuration
// (so this bundle also still works in the Spike B stack, which only sets the secret).
let hostVerifier: { verify(token: string): Promise<{ sub: string }> } | undefined;
let repo: DynamoRepository | undefined;

export const handler = async (event: EventsAuthoriserEvent): Promise<EventsAuthoriserResult> =>
  authorise(event, {
    playerKey: await playerTokenKey(),
    nowSeconds: Math.floor(Date.now() / 1000),
    verifyHost: async (token) => {
      try {
        hostVerifier ??= CognitoJwtVerifier.create({
          userPoolId: process.env.USER_POOL_ID as string,
          clientId: process.env.USER_POOL_CLIENT_ID as string,
          tokenUse: null, // ID or access token
        });
        return (await hostVerifier.verify(token)).sub;
      } catch {
        return null; // invalid token, or Host auth not configured here
      }
    },
    gameOwner: async (gameId) => {
      repo ??= new DynamoRepository(process.env.TABLE_NAME as string);
      return (await repo.getGame(gameId))?.game.hostId ?? null;
    },
  });
