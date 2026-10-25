// The Game state machine (PLAN §7; PRD §5.4–5.8). Pure: no I/O, and `now` is passed in.
import type { Option, Question, Quiz } from './quiz.js';
import { rank, scoreAnswer } from './scoring.js';

/** Milliseconds since the epoch, always from the server's clock (FR-6.5). */
export type Instant = number;

export type Phase = 'LOBBY' | 'QUESTION_OPEN' | 'REVEAL' | 'FINISHED';

export interface Player {
  playerId: string;
  /** As typed, trimmed (FR-5.2). */
  nickname: string;
  /** Uniqueness key: lowercase, repeated spaces collapsed (FR-5.2). */
  nicknameKey: string;
  score: number;
  /** Removed by the Host (FR-5.6). Kept, so their device can't rejoin. */
  removed: boolean;
}

export interface Answer {
  playerId: string;
  optionId: string;
  /** When the server received it (FR-6.5). */
  receivedAt: Instant;
}

export interface Game {
  gameId: string;
  hostId: string;
  joinCode: string;
  quiz: Quiz;
  phase: Phase;
  players: Player[];
  /** Index of the current Question; -1 in the Lobby. */
  questionIndex: number;
  questionOpenedAt: Instant | null;
  deadline: Instant | null;
  /** Answers to the current Question. */
  answers: Answer[];
  lastActivityAt: Instant;
}

export type GameCommand =
  | { type: 'Join'; playerId: string; nickname: { display: string; key: string } }
  | { type: 'Start' }
  | { type: 'SubmitAnswer'; playerId: string; questionIndex: number; optionId: string }
  | { type: 'Close' }
  | { type: 'Next' }
  | { type: 'RemovePlayer'; playerId: string }
  | { type: 'Abandon' };

export type GameEvent =
  | { type: 'PLAYER_JOINED'; playerId: string; nickname: string; playerCount: number }
  | { type: 'PLAYER_REMOVED'; playerId: string; playerCount: number }
  | {
      type: 'QUESTION_OPENED';
      questionIndex: number;
      questionCount: number;
      text: string;
      options: Option[];
      timeLimitSeconds: number;
      deadline: Instant;
    }
  | { type: 'ANSWER_COUNT'; answered: number; total: number }
  | {
      type: 'QUESTION_REVEALED';
      questionIndex: number;
      correctOptionId: string;
      results: RevealResult[];
    }
  | {
      type: 'QUESTION_REVEALED_HOST';
      questionIndex: number;
      correctOptionId: string;
      results: RevealResult[];
      /** How many Players chose each Option, for the Host only (FR-6.7). */
      optionCounts: Record<string, number>;
    }
  | { type: 'GAME_FINISHED'; abandoned: boolean; leaderboard: LeaderboardEntry[] };

export interface LeaderboardEntry {
  playerId: string;
  nickname: string;
  score: number;
  rank: number;
}

/** One Player's line at Reveal, in Leaderboard order (FR-6.7). */
export interface RevealResult {
  playerId: string;
  nickname: string;
  /** Points earned on this Question. */
  points: number;
  score: number;
  rank: number;
}

export type GameError =
  | 'NICKNAME_TAKEN'
  | 'GAME_FULL'
  | 'GAME_STARTED'
  | 'DEADLINE_NOT_REACHED'
  | 'DEADLINE_PASSED'
  | 'ALREADY_ANSWERED'
  | 'NOT_A_PLAYER'
  | 'WRONG_QUESTION'
  | 'INVALID_OPTION'
  | 'WRONG_PHASE'
  | 'PLAYER_REMOVED'
  | 'NOT_IDLE'
  | 'NO_PLAYERS';

/** How long a Game must be idle before it's abandoned (FR-8.4). */
export const ABANDON_AFTER_MS = 24 * 60 * 60 * 1000;

/** The most Players a Game may have (FR-4.6). */
export const MAX_PLAYERS = 50;

export type Decision =
  { ok: true; game: Game; events: GameEvent[] } | { ok: false; error: GameError };

export function createGame(input: {
  gameId: string;
  hostId: string;
  joinCode: string;
  quiz: Quiz;
  now: Instant;
}): Game {
  return {
    gameId: input.gameId,
    hostId: input.hostId,
    joinCode: input.joinCode,
    quiz: input.quiz,
    phase: 'LOBBY',
    players: [],
    questionIndex: -1,
    questionOpenedAt: null,
    deadline: null,
    answers: [],
    lastActivityAt: input.now,
  };
}

/** The phases each command is allowed in. Join reports its own error (GAME_STARTED, FR-4.5). */
const ALLOWED_PHASES: Record<Exclude<GameCommand['type'], 'Join'>, Phase[]> = {
  Start: ['LOBBY'],
  SubmitAnswer: ['QUESTION_OPEN'],
  Close: ['QUESTION_OPEN'],
  Next: ['REVEAL'],
  RemovePlayer: ['LOBBY', 'QUESTION_OPEN', 'REVEAL'],
  Abandon: ['LOBBY', 'QUESTION_OPEN', 'REVEAL'],
};

export function decide(game: Game, command: GameCommand, now: Instant): Decision {
  if (command.type !== 'Join' && !ALLOWED_PHASES[command.type].includes(game.phase)) {
    return { ok: false, error: 'WRONG_PHASE' };
  }
  switch (command.type) {
    case 'Join':
      return join(game, command, now);
    case 'Start':
      if (activePlayers(game).length === 0) return { ok: false, error: 'NO_PLAYERS' };
      return openQuestion(game, 0, now);
    case 'SubmitAnswer':
      return submitAnswer(game, command, now);
    case 'Next':
      if (game.questionIndex + 1 >= game.quiz.questions.length) return finish(game, now, false);
      return openQuestion(game, game.questionIndex + 1, now);
    case 'Abandon':
      if (now - game.lastActivityAt < ABANDON_AFTER_MS) return { ok: false, error: 'NOT_IDLE' };
      return finish(game, now, true);
    case 'RemovePlayer':
      return removePlayer(game, command.playerId, now);
    case 'Close':
      if (now < (game.deadline as Instant)) return { ok: false, error: 'DEADLINE_NOT_REACHED' };
      return reveal(game, now);
  }
}

function reveal(game: Game, now: Instant): Decision {
  const { pointsByPlayer, optionCounts } = scoreCurrentQuestion(game);
  const players = game.players.map((p) => ({
    ...p,
    score: p.score + (pointsByPlayer.get(p.playerId) ?? 0),
  }));
  const revealed: Game = { ...game, phase: 'REVEAL', players, lastActivityAt: now };
  const results = revealResults(revealed);

  const base = {
    questionIndex: game.questionIndex,
    correctOptionId: currentQuestion(game).correctOptionId,
  };
  return {
    ok: true,
    game: revealed,
    events: [
      { type: 'QUESTION_REVEALED', ...base, results },
      { type: 'QUESTION_REVEALED_HOST', ...base, results, optionCounts },
    ],
  };
}

/**
 * The Reveal results for a Game in its REVEAL phase, whose Scores already include the current
 * Question. Exported so a reconnecting client sees exactly what was shown live (FR-8.1).
 */
export function revealResults(game: Game): RevealResult[] {
  const { pointsByPlayer } = scoreCurrentQuestion(game);
  return rank(activePlayers(game)).map((p) => ({
    playerId: p.playerId,
    nickname: p.nickname,
    points: pointsByPlayer.get(p.playerId) ?? 0,
    score: p.score,
    rank: p.rank,
  }));
}

/** How many remaining Players have answered the current Question (FR-6.3). */
export function answeredCount(game: Game): { answered: number; total: number } {
  return { answered: activeAnswers(game).length, total: activePlayers(game).length };
}

/** How many Players chose each Option of the current Question; for the Host only (FR-6.7). */
export function optionCounts(game: Game): Record<string, number> {
  return scoreCurrentQuestion(game).optionCounts;
}

/** Points per Player and Answer counts per Option for the current Question (FR-6.7, FR-7.1). */
function scoreCurrentQuestion(game: Game): {
  pointsByPlayer: Map<string, number>;
  optionCounts: Record<string, number>;
} {
  const question = currentQuestion(game);
  const openedAt = game.questionOpenedAt as Instant;
  const timeLimitMs = (game.deadline as Instant) - openedAt;

  const pointsByPlayer = new Map<string, number>();
  const optionCounts: Record<string, number> = {};
  for (const option of question.options) optionCounts[option.optionId] = 0;
  for (const a of activeAnswers(game)) {
    optionCounts[a.optionId] = (optionCounts[a.optionId] ?? 0) + 1;
    const correct = a.optionId === question.correctOptionId;
    pointsByPlayer.set(a.playerId, scoreAnswer(correct, a.receivedAt - openedAt, timeLimitMs));
  }
  return { pointsByPlayer, optionCounts };
}

function finish(game: Game, now: Instant, abandoned: boolean): Decision {
  return {
    ok: true,
    game: { ...game, phase: 'FINISHED', lastActivityAt: now },
    events: [{ type: 'GAME_FINISHED', abandoned, leaderboard: leaderboard(game) }],
  };
}

/** The Players still in the Game, ranked by Score (FR-7.4). Removed Players are left off. */
export function leaderboard(game: Game): LeaderboardEntry[] {
  return rank(activePlayers(game)).map((p) => ({
    playerId: p.playerId,
    nickname: p.nickname,
    score: p.score,
    rank: p.rank,
  }));
}

function removePlayer(game: Game, playerId: string, now: Instant): Decision {
  const players = game.players.map((p) => (p.playerId === playerId ? { ...p, removed: true } : p));
  const removed: Game = { ...game, players, lastActivityAt: now };
  const event: GameEvent = {
    type: 'PLAYER_REMOVED',
    playerId,
    playerCount: activePlayers(removed).length,
  };
  return closeIfEveryoneAnswered(removed, [event], now);
}

function activePlayers(game: Game): Player[] {
  return game.players.filter((p) => !p.removed);
}

/** Answers to the current Question from Players who haven't been removed. */
function activeAnswers(game: Game): Answer[] {
  const active = new Set(activePlayers(game).map((p) => p.playerId));
  return game.answers.filter((a) => active.has(a.playerId));
}

function currentQuestion(game: Game): Question {
  return game.quiz.questions[game.questionIndex] as Question;
}

function submitAnswer(
  game: Game,
  command: Extract<GameCommand, { type: 'SubmitAnswer' }>,
  now: Instant,
): Decision {
  const player = game.players.find((p) => p.playerId === command.playerId);
  if (!player) return { ok: false, error: 'NOT_A_PLAYER' };
  if (player.removed) return { ok: false, error: 'PLAYER_REMOVED' };
  if (command.questionIndex !== game.questionIndex) return { ok: false, error: 'WRONG_QUESTION' };
  if (!currentQuestion(game).options.some((o) => o.optionId === command.optionId)) {
    return { ok: false, error: 'INVALID_OPTION' };
  }
  if (now > (game.deadline as Instant)) return { ok: false, error: 'DEADLINE_PASSED' };
  if (game.answers.some((a) => a.playerId === command.playerId)) {
    return { ok: false, error: 'ALREADY_ANSWERED' };
  }
  const answers = [
    ...game.answers,
    { playerId: command.playerId, optionId: command.optionId, receivedAt: now },
  ];
  const answered: Game = { ...game, answers, lastActivityAt: now };
  const count: GameEvent = {
    type: 'ANSWER_COUNT',
    answered: activeAnswers(answered).length,
    total: activePlayers(answered).length,
  };
  return closeIfEveryoneAnswered(answered, [count], now);
}

/** Closes the Question early once every remaining Player has answered (FR-6.6). */
function closeIfEveryoneAnswered(game: Game, events: GameEvent[], now: Instant): Decision {
  const everyoneAnswered = activeAnswers(game).length === activePlayers(game).length;
  if (game.phase !== 'QUESTION_OPEN' || !everyoneAnswered) return { ok: true, game, events };
  const revealed = reveal(game, now);
  return revealed.ok
    ? { ok: true, game: revealed.game, events: [...events, ...revealed.events] }
    : revealed;
}

function join(game: Game, command: Extract<GameCommand, { type: 'Join' }>, now: Instant): Decision {
  if (game.phase !== 'LOBBY') return { ok: false, error: 'GAME_STARTED' };
  if (game.players.some((p) => p.playerId === command.playerId && p.removed)) {
    return { ok: false, error: 'PLAYER_REMOVED' };
  }
  if (game.players.length >= MAX_PLAYERS) return { ok: false, error: 'GAME_FULL' };
  if (game.players.some((p) => p.nicknameKey === command.nickname.key)) {
    return { ok: false, error: 'NICKNAME_TAKEN' };
  }
  const player: Player = {
    playerId: command.playerId,
    nickname: command.nickname.display,
    nicknameKey: command.nickname.key,
    score: 0,
    removed: false,
  };
  const players = [...game.players, player];
  return {
    ok: true,
    game: { ...game, players, lastActivityAt: now },
    events: [
      {
        type: 'PLAYER_JOINED',
        playerId: player.playerId,
        nickname: player.nickname,
        playerCount: players.length,
      },
    ],
  };
}

function openQuestion(game: Game, questionIndex: number, now: Instant): Decision {
  const question = game.quiz.questions[questionIndex] as Question;
  const timeLimitSeconds = question.timeLimitSeconds ?? game.quiz.defaultTimeLimitSeconds;
  const deadline = now + timeLimitSeconds * 1000;
  return {
    ok: true,
    game: {
      ...game,
      phase: 'QUESTION_OPEN',
      questionIndex,
      questionOpenedAt: now,
      deadline,
      answers: [],
      lastActivityAt: now,
    },
    events: [
      {
        type: 'QUESTION_OPENED',
        questionIndex,
        questionCount: game.quiz.questions.length,
        text: question.text,
        options: question.options,
        timeLimitSeconds,
        deadline,
      },
    ],
  };
}
