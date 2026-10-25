import { describe, expect, it } from 'vitest';
import { authorise, type AuthoriserDeps, type EventsAuthoriserEvent } from './events-authoriser.js';
import { signPlayerToken } from './player-token.js';

const KEY = 'test-key';
const NOW = 1_800_000_000;
const token = signPlayerToken({ gameId: 'g1', playerId: 'p1', exp: NOW + 3600 }, KEY);
const HOST_TOKEN = 'cognito.host.token';

const deps: AuthoriserDeps = {
  playerKey: KEY,
  nowSeconds: NOW,
  // Stands in for Cognito verification: only HOST_TOKEN is a valid Host, h1.
  verifyHost: async (t) => (t === HOST_TOKEN ? 'h1' : null),
  // Game g1 belongs to h1; g2 to someone else.
  gameOwner: async (gameId) => ({ g1: 'h1', g2: 'h2' })[gameId] ?? null,
};

function event(
  operation: EventsAuthoriserEvent['requestContext']['operation'],
  channel: string | null,
  authorizationToken = token,
): EventsAuthoriserEvent {
  return {
    authorizationToken,
    requestContext: {
      apiId: 'api',
      accountId: '111122223333',
      requestId: 'req',
      operation,
      channelNamespaceName: channel === null ? null : 'game',
      channel,
    },
    requestHeaders: {},
  };
}

const allowed = async (e: EventsAuthoriserEvent) => (await authorise(e, deps)).isAuthorized;

describe('events authoriser: Players', () => {
  it('allows a valid Player to connect', async () => {
    expect(await authorise(event('EVENT_CONNECT', null), deps)).toMatchObject({
      isAuthorized: true,
      handlerContext: { gameId: 'g1', playerId: 'p1' },
    });
  });

  it.each(['/game/g1/players', 'game/g1/players', '/game/g1/players/'])(
    'allows subscribing to the Player’s own players channel (%s)',
    async (channel) => {
      expect(await allowed(event('EVENT_SUBSCRIBE', channel))).toBe(true);
    },
  );

  it.each(['/game/g2/players', '/game/g1/host', '/game/g1/*', '/game/*', '/game/g1'])(
    'denies subscribing to %s',
    async (channel) => {
      expect(await allowed(event('EVENT_SUBSCRIBE', channel))).toBe(false);
    },
  );

  it('never allows publishing, even to the Player’s own channel', async () => {
    expect(await allowed(event('EVENT_PUBLISH', '/game/g1/players'))).toBe(false);
  });

  it('denies an invalid token for every operation', async () => {
    for (const op of ['EVENT_CONNECT', 'EVENT_SUBSCRIBE'] as const) {
      expect(await allowed(event(op, '/game/g1/players', 'garbage'))).toBe(false);
    }
  });

  it('does not cache denials', async () => {
    expect((await authorise(event('EVENT_SUBSCRIBE', '/game/g2/players'), deps)).ttlOverride).toBe(
      0,
    );
  });
});

describe('events authoriser: AppSync request shapes', () => {
  it('handles a connect that omits the channel field entirely, as AppSync sends it', async () => {
    const connect = event('EVENT_CONNECT', null);
    delete (connect.requestContext as { channel?: unknown }).channel;
    delete (connect.requestContext as { channelNamespaceName?: unknown }).channelNamespaceName;
    expect(await allowed(connect)).toBe(true);
    expect(await allowed({ ...connect, authorizationToken: HOST_TOKEN })).toBe(true);
  });
});

describe('events authoriser: Hosts', () => {
  it('lets a Host connect, and subscribe to both channels of their own Game', async () => {
    expect(await allowed(event('EVENT_CONNECT', null, HOST_TOKEN))).toBe(true);
    expect(await allowed(event('EVENT_SUBSCRIBE', '/game/g1/host', HOST_TOKEN))).toBe(true);
    expect(await allowed(event('EVENT_SUBSCRIBE', '/game/g1/players', HOST_TOKEN))).toBe(true);
  });

  it("refuses a Host another Host's Game, unknown Games, wildcards and publishing", async () => {
    for (const channel of ['/game/g2/host', '/game/g2/players', '/game/g9/host', '/game/*']) {
      expect(await allowed(event('EVENT_SUBSCRIBE', channel, HOST_TOKEN))).toBe(false);
    }
    expect(await allowed(event('EVENT_PUBLISH', '/game/g1/host', HOST_TOKEN))).toBe(false);
  });
});
