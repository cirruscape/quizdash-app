// The game service (seam S1): one function per use case, orchestrating the domain's decide()
// with storage, retries, Player tokens and event routing. HTTP lives in the handlers.
import {
  ABANDON_AFTER_MS,
  createGame as newGame,
  decide,
  generateJoinCode,
  normaliseNickname,
  type Game,
  type GameCommand,
  type Instant,
} from '@quizapp/domain';
import {
  ConflictError,
  type GameRepository,
  type HistoryRecord,
} from '../repository/repository.js';
import { routeEvents, type Publish } from './events.js';
import { historyRecord, historySummary, type HistorySummary } from './history.js';
import {
  hostSnapshot,
  playerSnapshot,
  type HostSnapshot,
  type PlayerSnapshot,
} from './snapshots.js';

export interface ServiceDeps {
  repo: GameRepository;
  now: () => Instant;
  newId: () => string;
  /** Random source in [0, 1), for Join Codes. */
  random: () => number;
  issuePlayerToken: (claims: { gameId: string; playerId: string }) => string;
  publish: Publish;
  /** The Nickname blocklist (FR-5.4). */
  isBlocked: (nickname: string) => boolean;
  /** The toxicity check (FR-5.3): Comprehend in production. */
  isToxic: (nickname: string) => Promise<boolean>;
}

export type ServiceError = string;

/** Commands only the Game's Host may send. */
export type HostCommand = Extract<
  GameCommand,
  { type: 'Start' } | { type: 'Close' } | { type: 'Next' } | { type: 'RemovePlayer' }
>;

export type Result<T> = { ok: true; value: T } | { ok: false; error: ServiceError };

export interface GameService {
  createGame(hostId: string, quizId: string): Promise<Result<{ gameId: string; joinCode: string }>>;
  joinGame(
    joinCode: string,
    nickname: string,
  ): Promise<Result<{ gameId: string; playerId: string; playerToken: string }>>;
  hostCommand(hostId: string, gameId: string, command: HostCommand): Promise<Result<Game>>;
  /** `player` comes from a verified Player token, never from the request body. */
  submitAnswer(
    player: PlayerIdentity,
    questionIndex: number,
    optionId: string,
  ): Promise<Result<Game>>;
  playerSnapshot(player: PlayerIdentity): Promise<Result<PlayerSnapshot>>;
  hostSnapshot(hostId: string, gameId: string): Promise<Result<HostSnapshot>>;
  /**
   * Abandons every Game idle for 24 hours (FR-8.4): run hourly by the sweeper Lambda. Each Game
   * is re-checked by the domain, so one that saw activity since the lookup is left alone.
   */
  abandonIdleGames(): Promise<{ abandoned: number }>;
  /** The Host's unfinished Game, if any, so they can resume it from any device (FR-8.3). */
  activeGame(hostId: string): Promise<Result<{ gameId: string } | null>>;
  /** The Host's Finished Games, newest first (FR-9.1, FR-9.2). */
  listHistory(hostId: string): Promise<Result<HistorySummary[]>>;
  getHistory(hostId: string, gameId: string): Promise<Result<HistoryRecord>>;
}

export interface PlayerIdentity {
  gameId: string;
  playerId: string;
}

/** Enough for 50 Players answering at once (ADR 0006); beyond this, report rather than spin. */
const SAVE_ATTEMPTS = 10;

/** With ~10^9 possible codes, even one collision is rare; five in a row means something's wrong. */
const JOIN_CODE_ATTEMPTS = 5;

export function createGameService(deps: ServiceDeps): GameService {
  const { repo, now, newId, random, issuePlayerToken, publish, isBlocked, isToxic } = deps;

  /**
   * True if a Nickname may be used (FR-5.3, 5.4). The blocklist is checked first because it's
   * instant. If the toxicity check itself fails, the Nickname is allowed (fail-open, agreed in
   * M4): an outage must not stop a party joining, and the Host can still remove a Player.
   */
  async function nicknameAllowed(nickname: string): Promise<boolean> {
    if (isBlocked(nickname)) return false;
    try {
      return !(await isToxic(nickname));
    } catch (err) {
      console.warn('toxicity check failed; allowing the Nickname', err);
      return true;
    }
  }

  /**
   * Loads the Game, decides, and saves against the version read, then publishes the events.
   * A lost race reloads and decides again, because the winner may have changed the outcome
   * (ADR 0006).
   */
  async function apply(
    gameId: string,
    command: GameCommand,
    authorise: (game: Game) => ServiceError | null = () => null,
  ): Promise<Result<Game>> {
    for (let attempt = 0; attempt < SAVE_ATTEMPTS; attempt++) {
      const stored = await repo.getGame(gameId);
      if (!stored) return { ok: false, error: 'GAME_NOT_FOUND' };
      const refusal = authorise(stored.game);
      if (refusal) return { ok: false, error: refusal };
      const at = now();
      const decision = decide(stored.game, command, at);
      if (!decision.ok) return decision;
      let version: number;
      try {
        version = await repo.saveGame(decision.game, stored.version);
      } catch (err) {
        if (err instanceof ConflictError) continue;
        throw err;
      }
      if (decision.game.phase === 'FINISHED' && stored.game.phase !== 'FINISHED') {
        // Record it in History (FR-9.1), then free its Join Code and its Host's active-Game slot
        // (FR-4.2, FR-4.3).
        const abandoned = command.type === 'Abandon';
        await repo.putHistory(historyRecord(decision.game, at, abandoned));
        await repo.releaseJoinCode(decision.game.joinCode);
        await repo.releaseActiveGame(decision.game.hostId, gameId);
      }
      await publish(routeEvents(gameId, version, at, decision.events));
      return { ok: true, value: decision.game };
    }
    return { ok: false, error: 'TOO_MANY_CONFLICTS' };
  }

  /** Tries a few random Join Codes; null if every one is held by another Game (FR-4.3). */
  async function claimFreshJoinCode(gameId: string): Promise<string | null> {
    for (let attempt = 0; attempt < JOIN_CODE_ATTEMPTS; attempt++) {
      const joinCode = generateJoinCode(random);
      if (await repo.claimJoinCode(joinCode, gameId)) return joinCode;
    }
    return null;
  }

  return {
    async createGame(hostId, quizId) {
      const quiz = await repo.getQuiz(hostId, quizId);
      if (!quiz) return { ok: false, error: 'QUIZ_NOT_FOUND' };
      if (quiz.status !== 'READY') return { ok: false, error: 'QUIZ_NOT_READY' };

      const gameId = newId();
      // Claim the Host's one active-Game slot before a Join Code, so a refusal strands nothing.
      if (!(await repo.claimActiveGame(hostId, gameId))) {
        return { ok: false, error: 'ACTIVE_GAME_EXISTS' };
      }
      const joinCode = await claimFreshJoinCode(gameId);
      if (!joinCode) {
        await repo.releaseActiveGame(hostId, gameId);
        return { ok: false, error: 'JOIN_CODE_UNAVAILABLE' };
      }
      await repo.createGame(newGame({ gameId, hostId, joinCode, quiz, now: now() }));
      return { ok: true, value: { gameId, joinCode } };
    },

    async joinGame(joinCode, nickname) {
      const gameId = await repo.findGameIdByJoinCode(joinCode);
      if (!gameId) return { ok: false, error: 'GAME_NOT_FOUND' };
      const normalised = normaliseNickname(nickname);
      if (!normalised.ok) return normalised;
      // The same generic refusal whatever the reason (FR-5.5).
      if (!(await nicknameAllowed(normalised.display))) {
        return { ok: false, error: 'NICKNAME_REJECTED' };
      }

      const playerId = newId();
      const joined = await apply(gameId, { type: 'Join', playerId, nickname: normalised });
      if (!joined.ok) return joined;
      return {
        ok: true,
        value: { gameId, playerId, playerToken: issuePlayerToken({ gameId, playerId }) },
      };
    },

    async hostCommand(hostId, gameId, command) {
      return apply(gameId, command, (game) => (game.hostId === hostId ? null : 'NOT_YOUR_GAME'));
    },

    async submitAnswer({ gameId, playerId }, questionIndex, optionId) {
      return apply(gameId, { type: 'SubmitAnswer', playerId, questionIndex, optionId });
    },

    async playerSnapshot({ gameId, playerId }) {
      const stored = await repo.getGame(gameId);
      if (!stored) return { ok: false, error: 'GAME_NOT_FOUND' };
      const snapshot = playerSnapshot(stored.game, stored.version, playerId, now());
      if (typeof snapshot === 'string') return { ok: false, error: snapshot };
      return { ok: true, value: snapshot };
    },

    async hostSnapshot(hostId, gameId) {
      const stored = await repo.getGame(gameId);
      if (!stored) return { ok: false, error: 'GAME_NOT_FOUND' };
      if (stored.game.hostId !== hostId) return { ok: false, error: 'NOT_YOUR_GAME' };
      return { ok: true, value: hostSnapshot(stored.game, stored.version, now()) };
    },

    async listHistory(hostId) {
      return { ok: true, value: (await repo.listHistory(hostId)).map(historySummary) };
    },

    async getHistory(hostId, gameId) {
      // Another Host's Game reads as "not found", so its existence isn't confirmed (FR-9.2).
      const record = await repo.getHistory(hostId, gameId);
      return record ? { ok: true, value: record } : { ok: false, error: 'HISTORY_NOT_FOUND' };
    },

    async abandonIdleGames() {
      let abandoned = 0;
      for (const gameId of await repo.listIdleGameIds(now() - ABANDON_AFTER_MS)) {
        // Through apply, so History, claims and the GAME_FINISHED event are handled as usual.
        if ((await apply(gameId, { type: 'Abandon' })).ok) abandoned += 1;
      }
      return { abandoned };
    },

    async activeGame(hostId) {
      const gameId = await repo.getActiveGameId(hostId);
      return { ok: true, value: gameId ? { gameId } : null };
    },
  };
}
