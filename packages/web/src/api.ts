// The HTTP API client. Same origin: CloudFront routes /api/* to the HTTP API (D4).

/** A refusal from the API, carrying its error code (e.g. GAME_FULL). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
    this.name = 'ApiError';
  }
}

export async function api<T>(
  method: string,
  path: string,
  options: { token?: string | null; body?: unknown } = {},
): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: {
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });
  const json = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(res.status, json.error ?? `HTTP_${res.status}`);
  return json as T;
}

/** Plain-language messages for the refusals a person might see. */
const MESSAGES: Record<string, string> = {
  GAME_NOT_FOUND: 'There’s no game with that code. Check it and try again.',
  GAME_STARTED: 'This game has already started.',
  GAME_FULL: 'This game is full.',
  NICKNAME_TAKEN: 'Someone in this game already has that nickname.',
  NICKNAME_FORMAT: 'Use 2–16 letters, numbers or spaces.',
  NICKNAME_REJECTED: 'Please choose a different nickname.',
  PLAYER_REMOVED: 'You were removed from this game.',
  ACTIVE_GAME_EXISTS: 'You already have a game running. Finish it first.',
  NO_PLAYERS: 'Wait for at least one player to join.',
  DEADLINE_PASSED: 'Too late: time was up for that question.',
  TOO_MANY_CONFLICTS: 'The game is busy. Please try again.',
};

export function messageFor(err: unknown): string {
  if (err instanceof ApiError)
    return MESSAGES[err.code] ?? 'Something went wrong. Please try again.';
  return 'Couldn’t reach the server. Check your connection.';
}
