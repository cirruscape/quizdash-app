// The HTTP layer (seam S2): routes requests to the game service, validates bodies with the
// shared zod contracts, and maps service errors to status codes. Independent of the Lambda
// event shape; lambda.ts adapts API Gateway events to HttpRequest.
import {
  AnswerRequest,
  CreateGameRequest,
  CreateQuizRequest,
  JoinRequest,
  SetTimeLimitRequest,
} from '@quizapp/contracts';
import type { z } from 'zod';
import type { GameService, HostCommand, PlayerIdentity, Result } from '../service/game-service.js';
import type { QuizService } from '../service/quiz-service.js';

export interface HttpRequest {
  method: string;
  path: string;
  headers: Record<string, string | undefined>;
  body: string | null;
  /** The signed-in Host's ID, from the Cognito JWT that API Gateway verified. */
  hostId?: string;
}

export interface HttpResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

export interface HttpDeps {
  service: GameService;
  quizzes: QuizService;
  /** Verifies a Player token, returning who it belongs to, or null. */
  verifyPlayer: (token: string) => PlayerIdentity | null;
}

interface Caller {
  request: HttpRequest;
  params: Record<string, string>;
  deps: HttpDeps;
  /** Set on 'host' routes. */
  hostId: string;
  /** Set on 'player' routes. */
  player: PlayerIdentity;
}

interface Route {
  method: string;
  pattern: RegExp;
  auth: 'public' | 'host' | 'player';
  handle: (caller: Caller) => Promise<HttpResponse>;
}

const ID = '[A-Za-z0-9_-]{1,128}';

const HOST_COMMANDS: Record<string, HostCommand> = {
  start: { type: 'Start' },
  close: { type: 'Close' },
  next: { type: 'Next' },
};

/** A command's reply: just the phase the Game is now in; details arrive as events. */
function phaseOf(result: Result<{ phase: string }>): Result<{ phase: string }> {
  return result.ok ? { ok: true, value: { phase: result.value.phase } } : result;
}

const ROUTES: Route[] = [
  {
    method: 'POST',
    pattern: /^\/api\/join$/,
    auth: 'public',
    handle: async ({ request, deps }) => {
      const body = parseBody(request, JoinRequest);
      if (!body) return error(400, 'INVALID_REQUEST');
      return reply(201, await deps.service.joinGame(body.joinCode, body.nickname));
    },
  },
  {
    method: 'POST',
    pattern: /^\/api\/games$/,
    auth: 'host',
    handle: async ({ request, deps, hostId }) => {
      const body = parseBody(request, CreateGameRequest);
      if (!body) return error(400, 'INVALID_REQUEST');
      return reply(201, await deps.service.createGame(hostId, body.quizId));
    },
  },
  {
    method: 'GET',
    pattern: /^\/api\/quizzes$/,
    auth: 'host',
    handle: async ({ deps, hostId }) => reply(200, await deps.quizzes.listQuizzes(hostId)),
  },
  {
    method: 'POST',
    pattern: /^\/api\/quizzes$/,
    auth: 'host',
    handle: async ({ request, deps, hostId }) => {
      const body = parseBody(request, CreateQuizRequest);
      if (!body) return error(400, 'INVALID_REQUEST');
      // 202: the Quiz is generated in the background; the client polls it (FR-2.2).
      return reply(202, await deps.quizzes.createQuiz(hostId, body));
    },
  },
  {
    method: 'GET',
    pattern: new RegExp(`^/api/quizzes/(?<quizId>${ID})$`),
    auth: 'host',
    handle: async ({ params, deps, hostId }) =>
      reply(200, await deps.quizzes.getQuiz(hostId, params.quizId as string)),
  },
  {
    method: 'DELETE',
    pattern: new RegExp(`^/api/quizzes/(?<quizId>${ID})$`),
    auth: 'host',
    handle: async ({ params, deps, hostId }) =>
      reply(200, await deps.quizzes.deleteQuiz(hostId, params.quizId as string)),
  },
  {
    method: 'POST',
    pattern: new RegExp(`^/api/quizzes/(?<quizId>${ID})/approve$`),
    auth: 'host',
    handle: async ({ params, deps, hostId }) =>
      reply(200, await deps.quizzes.approveQuiz(hostId, params.quizId as string)),
  },
  {
    method: 'DELETE',
    pattern: new RegExp(`^/api/quizzes/(?<quizId>${ID})/questions/(?<questionId>${ID})$`),
    auth: 'host',
    handle: async ({ params, deps, hostId }) =>
      reply(
        200,
        await deps.quizzes.discardQuestion(
          hostId,
          params.quizId as string,
          params.questionId as string,
        ),
      ),
  },
  {
    method: 'PATCH',
    pattern: new RegExp(`^/api/quizzes/(?<quizId>${ID})/questions/(?<questionId>${ID})$`),
    auth: 'host',
    handle: async ({ request, params, deps, hostId }) => {
      const body = parseBody(request, SetTimeLimitRequest);
      if (!body) return error(400, 'INVALID_REQUEST');
      return reply(
        200,
        await deps.quizzes.setTimeLimit(
          hostId,
          params.quizId as string,
          params.questionId as string,
          body.timeLimitSeconds,
        ),
      );
    },
  },
  {
    method: 'POST',
    pattern: new RegExp(
      `^/api/quizzes/(?<quizId>${ID})/questions/(?<questionId>${ID})/regenerate$`,
    ),
    auth: 'host',
    handle: async ({ params, deps, hostId }) =>
      reply(
        202,
        await deps.quizzes.regenerateQuestion(
          hostId,
          params.quizId as string,
          params.questionId as string,
        ),
      ),
  },
  {
    method: 'GET',
    pattern: /^\/api\/history$/,
    auth: 'host',
    handle: async ({ deps, hostId }) => reply(200, await deps.service.listHistory(hostId)),
  },
  {
    method: 'GET',
    pattern: new RegExp(`^/api/history/(?<gameId>${ID})$`),
    auth: 'host',
    handle: async ({ params, deps, hostId }) =>
      reply(200, await deps.service.getHistory(hostId, params.gameId as string)),
  },
  {
    method: 'GET',
    pattern: /^\/api\/games\/active$/,
    auth: 'host',
    handle: async ({ deps, hostId }) => {
      const result = await deps.service.activeGame(hostId);
      return reply(200, result.ok ? { ok: true, value: result.value ?? { gameId: null } } : result);
    },
  },
  {
    method: 'GET',
    pattern: new RegExp(`^/api/games/(?<gameId>${ID})$`),
    auth: 'host',
    handle: async ({ params, deps, hostId }) =>
      reply(200, await deps.service.hostSnapshot(hostId, params.gameId as string)),
  },
  {
    method: 'POST',
    pattern: new RegExp(`^/api/games/(?<gameId>${ID})/(?<command>start|close|next)$`),
    auth: 'host',
    handle: async ({ params, deps, hostId }) => {
      const command = HOST_COMMANDS[params.command as string] as HostCommand;
      return reply(
        200,
        phaseOf(await deps.service.hostCommand(hostId, params.gameId as string, command)),
      );
    },
  },
  {
    method: 'DELETE',
    pattern: new RegExp(`^/api/games/(?<gameId>${ID})/players/(?<playerId>${ID})$`),
    auth: 'host',
    handle: async ({ params, deps, hostId }) => {
      const command: HostCommand = { type: 'RemovePlayer', playerId: params.playerId as string };
      return reply(
        200,
        phaseOf(await deps.service.hostCommand(hostId, params.gameId as string, command)),
      );
    },
  },
  {
    method: 'GET',
    pattern: /^\/api\/play$/,
    auth: 'player',
    handle: async ({ deps, player }) => reply(200, await deps.service.playerSnapshot(player)),
  },
  {
    method: 'POST',
    pattern: /^\/api\/play\/answers$/,
    auth: 'player',
    handle: async ({ request, deps, player }) => {
      const body = parseBody(request, AnswerRequest);
      if (!body) return error(400, 'INVALID_REQUEST');
      return reply(
        200,
        phaseOf(await deps.service.submitAnswer(player, body.questionIndex, body.optionId)),
      );
    },
  },
];

/** The Player identity in an `Authorization: Bearer <token>` header, if it verifies. */
function playerFrom(request: HttpRequest, deps: HttpDeps): PlayerIdentity | null {
  const header = request.headers.authorization ?? request.headers.Authorization;
  const match = /^Bearer (\S+)$/.exec(header ?? '');
  return match ? deps.verifyPlayer(match[1] as string) : null;
}

export async function handleHttp(request: HttpRequest, deps: HttpDeps): Promise<HttpResponse> {
  for (const route of ROUTES) {
    if (route.method !== request.method) continue;
    const match = route.pattern.exec(request.path);
    if (!match) continue;
    if (route.auth === 'host' && !request.hostId) return error(401, 'UNAUTHENTICATED');
    const player = route.auth === 'player' ? playerFrom(request, deps) : null;
    if (route.auth === 'player' && !player) return error(401, 'UNAUTHENTICATED');
    return route.handle({
      request,
      params: match.groups ?? {},
      deps,
      hostId: request.hostId ?? '',
      player: player ?? { gameId: '', playerId: '' },
    });
  }
  return error(404, 'NOT_FOUND');
}

/**
 * Status codes for service errors. Anything unlisted is a refusal because of the Game's current
 * state (409): already taken, already started, wrong phase, past the deadline, and so on.
 */
const STATUS: Record<string, number> = {
  GAME_NOT_FOUND: 404,
  QUIZ_NOT_FOUND: 404,
  HISTORY_NOT_FOUND: 404,
  QUESTION_NOT_FOUND: 404,
  INVALID_TOPIC: 400,
  INVALID_DIFFICULTY: 400,
  INVALID_QUESTION_COUNT: 400,
  INVALID_TIME_LIMIT: 400,
  QUOTA_EXCEEDED: 429,
  NICKNAME_FORMAT: 400,
  INVALID_OPTION: 400,
  NOT_YOUR_GAME: 403,
  NOT_A_PLAYER: 403,
  PLAYER_REMOVED: 403,
  // Transient: the client may retry.
  TOO_MANY_CONFLICTS: 503,
  JOIN_CODE_UNAVAILABLE: 503,
};

function reply<T>(successStatus: number, result: Result<T>): HttpResponse {
  return result.ok
    ? respond(successStatus, result.value)
    : error(STATUS[result.error] ?? 409, result.error);
}

function parseBody<T>(request: HttpRequest, schema: z.ZodType<T>): T | null {
  if (request.body === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(request.body);
  } catch {
    return null;
  }
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function respond(statusCode: number, body: unknown): HttpResponse {
  return {
    statusCode,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function error(statusCode: number, code: string): HttpResponse {
  return respond(statusCode, { error: code });
}
