import { describe, expect, it } from 'vitest';
import { authorise, type EventsAuthoriserEvent } from './events-authoriser.js';
import { signPlayerToken } from './player-token.js';

const KEY = 'test-key';
const NOW = 1_800_000_000;
const token = signPlayerToken({ gameId: 'g1', playerId: 'p1', exp: NOW + 3600 }, KEY);

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

describe('events authoriser', () => {
  it('allows a valid Player to connect', () => {
    expect(authorise(event('EVENT_CONNECT', null), KEY, NOW)).toMatchObject({
      isAuthorized: true,
      handlerContext: { gameId: 'g1', playerId: 'p1' },
    });
  });

  it.each(['/game/g1/players', 'game/g1/players', '/game/g1/players/'])(
    'allows subscribing to the Player’s own players channel (%s)',
    (channel) => {
      expect(authorise(event('EVENT_SUBSCRIBE', channel), KEY, NOW).isAuthorized).toBe(true);
    },
  );

  it.each(['/game/g2/players', '/game/g1/host', '/game/g1/*', '/game/*', '/game/g1'])(
    'denies subscribing to %s',
    (channel) => {
      expect(authorise(event('EVENT_SUBSCRIBE', channel), KEY, NOW).isAuthorized).toBe(false);
    },
  );

  it('never allows publishing, even to the Player’s own channel', () => {
    expect(authorise(event('EVENT_PUBLISH', '/game/g1/players'), KEY, NOW).isAuthorized).toBe(
      false,
    );
  });

  it('denies an invalid token for every operation', () => {
    for (const op of ['EVENT_CONNECT', 'EVENT_SUBSCRIBE'] as const) {
      expect(authorise(event(op, '/game/g1/players', 'garbage'), KEY, NOW).isAuthorized).toBe(
        false,
      );
    }
  });

  it('does not cache denials', () => {
    expect(authorise(event('EVENT_SUBSCRIBE', '/game/g2/players'), KEY, NOW).ttlOverride).toBe(0);
  });
});
