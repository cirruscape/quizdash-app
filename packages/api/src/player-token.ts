// Player tokens (PLAN §5): HS256 JWTs binding a device to one Player in one Game.
// Hand-rolled on node:crypto because we only ever need this one algorithm.
import { createHmac, timingSafeEqual } from 'node:crypto';

export interface PlayerTokenClaims {
  gameId: string;
  playerId: string;
  /** Expiry, in seconds since the epoch. */
  exp: number;
}

const HEADER = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));

export function signPlayerToken(claims: PlayerTokenClaims, key: string): string {
  const body = `${HEADER}.${base64url(JSON.stringify(claims))}`;
  return `${body}.${sign(body, key)}`;
}

/** Returns the claims if the token is well-formed, correctly signed and unexpired; otherwise null. */
export function verifyPlayerToken(
  token: string,
  key: string,
  nowSeconds: number,
): PlayerTokenClaims | null {
  const [header, payload, signature, ...rest] = token.split('.');
  if (!header || !payload || !signature || rest.length > 0 || header !== HEADER) return null;

  const expected = Buffer.from(sign(`${header}.${payload}`, key));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;

  const claims = parseClaims(payload);
  if (!claims || claims.exp <= nowSeconds) return null;
  return claims;
}

function parseClaims(payload: string): PlayerTokenClaims | null {
  try {
    const value: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (typeof value !== 'object' || value === null) return null;
    const { gameId, playerId, exp } = value as Record<string, unknown>;
    if (typeof gameId !== 'string' || typeof playerId !== 'string' || typeof exp !== 'number') {
      return null;
    }
    return { gameId, playerId, exp };
  } catch {
    return null;
  }
}

function sign(data: string, key: string): string {
  return createHmac('sha256', key).update(data).digest('base64url');
}

function base64url(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64url');
}
