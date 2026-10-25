import { describe, expect, it } from 'vitest';
import { signPlayerToken, verifyPlayerToken } from './player-token.js';

const KEY = 'test-key';
const NOW = 1_800_000_000;
const claims = { gameId: 'g1', playerId: 'p1', exp: NOW + 60 };

describe('player tokens', () => {
  it('round-trips valid claims', () => {
    expect(verifyPlayerToken(signPlayerToken(claims, KEY), KEY, NOW)).toEqual(claims);
  });

  it('rejects a token signed with a different key', () => {
    expect(verifyPlayerToken(signPlayerToken(claims, 'other-key'), KEY, NOW)).toBeNull();
  });

  it('rejects an expired token', () => {
    expect(verifyPlayerToken(signPlayerToken(claims, KEY), KEY, claims.exp)).toBeNull();
  });

  it('rejects a tampered payload', () => {
    const [header, , signature] = signPlayerToken(claims, KEY).split('.');
    const forged = Buffer.from(JSON.stringify({ ...claims, gameId: 'g2' })).toString('base64url');
    expect(verifyPlayerToken(`${header}.${forged}.${signature}`, KEY, NOW)).toBeNull();
  });

  it.each(['', 'abc', 'a.b', 'a.b.c.d', 'not.a.jwt'])('rejects malformed token %j', (token) => {
    expect(verifyPlayerToken(token, KEY, NOW)).toBeNull();
  });
});
