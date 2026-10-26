import { describe, expect, it } from 'vitest';
import { createGame, decide, type Decision, type Game, type GameCommand } from './game.js';
import { normaliseNickname } from './nickname.js';
import type { Quiz } from './quiz.js';

const T0 = 1_800_000_000_000; // ms

/** A Ready Quiz whose Questions all have Options a–d, with "a" correct, and a 20 s Time Limit. */
function readyQuiz(questionCount = 3): Quiz {
  return {
    quizId: 'quiz1',
    status: 'READY',
    defaultTimeLimitSeconds: 20,
    questions: Array.from({ length: questionCount }, (_, i) => ({
      questionId: `qn${i}`,
      text: `Question ${i}?`,
      options: ['a', 'b', 'c', 'd'].map((id) => ({ optionId: id, text: id.toUpperCase() })),
      correctOptionId: 'a',
    })),
  };
}

function newGame(quiz = readyQuiz()): Game {
  return createGame({ gameId: 'g1', hostId: 'h1', joinCode: 'ABC234', quiz, now: T0 });
}

function nickname(raw: string) {
  const n = normaliseNickname(raw);
  if (!n.ok) throw new Error(`bad test Nickname ${raw}`);
  return n;
}

function join(playerId: string, raw = playerId): GameCommand {
  return { type: 'Join', playerId, nickname: nickname(raw) };
}

/** Applies a command that must succeed, returning the decision. */
function ok(game: Game, command: GameCommand, now = T0): Extract<Decision, { ok: true }> {
  const d = decide(game, command, now);
  if (!d.ok) throw new Error(`expected ${command.type} to succeed, got ${d.error}`);
  return d;
}

describe('decide: the Lobby', () => {
  it('lets a Player join a Game in its Lobby', () => {
    const d = ok(newGame(), join('p1', 'Quiz Whiz'));
    expect(d.events).toEqual([
      { type: 'PLAYER_JOINED', playerId: 'p1', nickname: 'Quiz Whiz', playerCount: 1 },
    ]);
    expect(d.game.phase).toBe('LOBBY');
  });

  it('refuses a Nickname that clashes with one already in the Game', () => {
    const game = ok(newGame(), join('p1', 'Sam  Smith')).game;
    expect(decide(game, join('p2', 'sam smith'), T0)).toEqual({
      ok: false,
      error: 'NICKNAME_TAKEN',
    });
  });

  it('accepts the 50th Player but refuses the 51st', () => {
    let game = newGame();
    for (let i = 1; i <= 49; i++) game = ok(game, join(`p${i}`)).game;
    const fiftieth = ok(game, join('p50'));
    expect(fiftieth.events[0]).toMatchObject({ playerCount: 50 });
    expect(decide(fiftieth.game, join('p51'), T0)).toEqual({ ok: false, error: 'GAME_FULL' });
  });
});

describe('decide: starting', () => {
  it('opens the first Question, with a deadline one Time Limit after the server start time', () => {
    const lobby = ok(newGame(), join('p1')).game;
    const d = ok(lobby, { type: 'Start' }, T0 + 5_000);

    expect(d.game.phase).toBe('QUESTION_OPEN');
    expect(d.events).toEqual([
      {
        type: 'QUESTION_OPENED',
        questionIndex: 0,
        questionCount: 3,
        text: 'Question 0?',
        options: [
          { optionId: 'a', text: 'A' },
          { optionId: 'b', text: 'B' },
          { optionId: 'c', text: 'C' },
          { optionId: 'd', text: 'D' },
        ],
        timeLimitSeconds: 20,
        deadline: T0 + 25_000,
      },
    ]);
    // Players must not learn the answer before Reveal.
    expect(JSON.stringify(d.events)).not.toContain('correct');
  });

  it('refuses to start without at least one Player', () => {
    expect(decide(newGame(), { type: 'Start' }, T0)).toEqual({ ok: false, error: 'NO_PLAYERS' });

    const everyoneRemoved = ok(ok(newGame(), join('p1')).game, {
      type: 'RemovePlayer',
      playerId: 'p1',
    }).game;
    expect(decide(everyoneRemoved, { type: 'Start' }, T0)).toEqual({
      ok: false,
      error: 'NO_PLAYERS',
    });
  });

  it("uses a Question's own Time Limit, when it has one, for the deadline and scoring", () => {
    const quiz = readyQuiz(1);
    quiz.questions[0] = { ...quiz.questions[0]!, timeLimitSeconds: 40 };
    let game = ok(ok(newGame(quiz), join('p1')).game, join('p2')).game;

    const started = ok(game, { type: 'Start' }, T0);
    expect(started.events[0]).toMatchObject({ timeLimitSeconds: 40, deadline: T0 + 40_000 });

    game = ok(started.game, answer('p1', 'a'), T0 + 10_000).game;
    const d = ok(game, answer('p2', 'b'), T0 + 11_000);
    expect(d.events[1]).toMatchObject({ results: [{ playerId: 'p1', points: 875 }, {}] });
  });

  it('refuses new Players once the first Question has opened', () => {
    const started = ok(ok(newGame(), join('p1')).game, { type: 'Start' }).game;
    expect(decide(started, join('late'), T0)).toEqual({ ok: false, error: 'GAME_STARTED' });
  });
});

/** A Game with the given Players whose first Question opened at T0 (deadline T0 + 20 s). */
function openGame(...playerIds: string[]): Game {
  let game = newGame();
  for (const id of playerIds) game = ok(game, join(id)).game;
  return ok(game, { type: 'Start' }, T0).game;
}

function answer(playerId: string, optionId: string, questionIndex = 0): GameCommand {
  return { type: 'SubmitAnswer', playerId, questionIndex, optionId };
}

describe('decide: Answers', () => {
  it('accepts an Answer and updates the answered count, without revealing it', () => {
    const d = ok(openGame('p1', 'p2'), answer('p1', 'b'), T0 + 3_000);
    expect(d.events).toEqual([{ type: 'ANSWER_COUNT', answered: 1, total: 2 }]);
    expect(d.game.phase).toBe('QUESTION_OPEN');
  });

  it('accepts an Answer at exactly the deadline, scoring 500, and refuses one after it', () => {
    const game = openGame('p1', 'p2', 'p3');
    expect(decide(game, answer('p2', 'a'), T0 + 20_001)).toEqual({
      ok: false,
      error: 'DEADLINE_PASSED',
    });

    const atDeadline = ok(game, answer('p1', 'a'), T0 + 20_000).game;
    const d = ok(atDeadline, { type: 'Close' }, T0 + 20_000);
    expect(d.events[0]).toMatchObject({ results: [{ playerId: 'p1', points: 500 }, {}, {}] });
  });

  it('refuses a second Answer from the same Player', () => {
    const game = ok(openGame('p1', 'p2'), answer('p1', 'b'), T0 + 1_000).game;
    expect(decide(game, answer('p1', 'a'), T0 + 2_000)).toEqual({
      ok: false,
      error: 'ALREADY_ANSWERED',
    });
  });

  it.each([
    ['from someone not in the Game', answer('stranger', 'a'), 'NOT_A_PLAYER'],
    ['for a different Question', answer('p1', 'a', 1), 'WRONG_QUESTION'],
    ['naming an Option the Question does not have', answer('p1', 'z'), 'INVALID_OPTION'],
  ] as const)('refuses an Answer %s', (_why, command, error) => {
    expect(decide(openGame('p1', 'p2'), command, T0 + 1_000)).toEqual({ ok: false, error });
  });
});

describe('decide: advancing', () => {
  it('opens the next Question from Reveal, and Scores accumulate across Questions', () => {
    let game = openGame('p1', 'p2');
    game = ok(game, answer('p1', 'a'), T0).game; // Q1: p1 1000
    game = ok(game, answer('p2', 'b'), T0 + 1_000).game; // Q1: p2 0, everyone answered

    const next = ok(game, { type: 'Next' }, T0 + 30_000);
    expect(next.events).toEqual([
      expect.objectContaining({
        type: 'QUESTION_OPENED',
        questionIndex: 1,
        text: 'Question 1?',
        deadline: T0 + 50_000,
      }),
    ]);

    game = ok(next.game, answer('p2', 'a', 1), T0 + 30_000).game; // Q2: p2 1000
    const d = ok(game, answer('p1', 'a', 1), T0 + 40_000); // Q2: p1 750
    expect(d.events[1]).toMatchObject({
      results: [
        { playerId: 'p1', points: 750, score: 1750, rank: 1 },
        { playerId: 'p2', points: 1000, score: 1000, rank: 2 },
      ],
    });
  });
});

describe('decide: finishing', () => {
  it('finishes after the last Question, with the final Leaderboard', () => {
    let game = ok(ok(ok(newGame(readyQuiz(1)), join('p1')).game, join('p2')).game, {
      type: 'Start',
    }).game;
    game = ok(game, answer('p1', 'a'), T0).game; // 1000
    game = ok(game, answer('p2', 'a'), T0 + 20_000).game; // 500, everyone answered

    const d = ok(game, { type: 'Next' }, T0 + 30_000);
    expect(d.game.phase).toBe('FINISHED');
    expect(d.events).toEqual([
      {
        type: 'GAME_FINISHED',
        abandoned: false,
        leaderboard: [
          { playerId: 'p1', nickname: 'p1', score: 1000, rank: 1 },
          { playerId: 'p2', nickname: 'p2', score: 500, rank: 2 },
        ],
      },
    ]);
  });
});

describe('decide: removing Players', () => {
  it('removes a Player in the Lobby', () => {
    const game = ok(ok(newGame(), join('p1')).game, join('p2')).game;
    const d = ok(game, { type: 'RemovePlayer', playerId: 'p2' });
    expect(d.events).toEqual([{ type: 'PLAYER_REMOVED', playerId: 'p2', playerCount: 1 }]);
  });

  it("refuses to let a removed Player's device rejoin, even with a new Nickname", () => {
    const game = ok(ok(newGame(), join('p1')).game, { type: 'RemovePlayer', playerId: 'p1' }).game;
    expect(decide(game, join('p1', 'Fresh Name'), T0)).toEqual({
      ok: false,
      error: 'PLAYER_REMOVED',
    });
  });

  it('closes the Question when removing the only Player who had not answered', () => {
    let game = openGame('p1', 'p2', 'p3');
    game = ok(game, answer('p1', 'a'), T0).game;
    const before = ok(game, answer('p2', 'b'), T0 + 1_000);
    expect(before.events).toEqual([{ type: 'ANSWER_COUNT', answered: 2, total: 3 }]);

    const d = ok(before.game, { type: 'RemovePlayer', playerId: 'p3' }, T0 + 2_000);
    expect(d.game.phase).toBe('REVEAL');
    expect(d.events.map((e) => e.type)).toEqual([
      'PLAYER_REMOVED',
      'QUESTION_REVEALED',
      'QUESTION_REVEALED_HOST',
    ]);
    expect(d.events[1]).toMatchObject({
      results: [{ playerId: 'p1' }, { playerId: 'p2' }],
    });
  });

  it('refuses Answers from a removed Player, and leaves them out of the count', () => {
    const game = ok(openGame('p1', 'p2', 'p3'), { type: 'RemovePlayer', playerId: 'p3' }).game;
    expect(decide(game, answer('p3', 'a'), T0 + 1_000)).toEqual({
      ok: false,
      error: 'PLAYER_REMOVED',
    });
    expect(ok(game, answer('p1', 'a'), T0 + 1_000).events).toEqual([
      { type: 'ANSWER_COUNT', answered: 1, total: 2 },
    ]);
  });

  it('leaves a removed Player off the final Leaderboard, even with points', () => {
    let game = ok(ok(ok(newGame(readyQuiz(1)), join('p1')).game, join('p2')).game, {
      type: 'Start',
    }).game;
    game = ok(game, answer('p2', 'a'), T0).game;
    game = ok(game, answer('p1', 'a'), T0 + 1_000).game; // revealed: p2 has 1000 points
    game = ok(game, { type: 'RemovePlayer', playerId: 'p2' }, T0 + 2_000).game;

    const d = ok(game, { type: 'Next' }, T0 + 3_000);
    expect(d.events[0]).toMatchObject({
      type: 'GAME_FINISHED',
      leaderboard: [{ playerId: 'p1', rank: 1 }],
    });
  });
});

describe('decide: abandonment', () => {
  const DAY = 24 * 60 * 60 * 1000;

  it('finishes a Game idle for 24 hours, keeping the partial Leaderboard', () => {
    const revealed = ok(openGame('p1'), answer('p1', 'a'), T0 + 1_000).game; // p1: 975
    const d = ok(revealed, { type: 'Abandon' }, T0 + 1_000 + DAY);
    expect(d.game.phase).toBe('FINISHED');
    expect(d.events).toEqual([
      {
        type: 'GAME_FINISHED',
        abandoned: true,
        leaderboard: [{ playerId: 'p1', nickname: 'p1', score: 975, rank: 1 }],
      },
    ]);
  });

  it('refuses to abandon a Game that has had activity in the last 24 hours', () => {
    const game = ok(openGame('p1', 'p2'), answer('p1', 'a'), T0 + 1_000).game;
    expect(decide(game, { type: 'Abandon' }, T0 + 1_000 + DAY - 1)).toEqual({
      ok: false,
      error: 'NOT_IDLE',
    });
  });

  it('can abandon a Game that never left the Lobby', () => {
    const lobby = ok(newGame(), join('p1')).game;
    expect(ok(lobby, { type: 'Abandon' }, T0 + DAY).events[0]).toMatchObject({
      type: 'GAME_FINISHED',
      abandoned: true,
    });
  });
});

describe('decide: commands in the wrong phase', () => {
  const lobby = () => ok(newGame(), join('p1')).game;
  const open = () => openGame('p1', 'p2');
  const revealed = () => ok(openGame('p1'), answer('p1', 'a'), T0).game;
  const finished = () => ok(ok(newGame(readyQuiz(1)), join('p1')).game, { type: 'Start' }).game;

  it.each([
    ['Start during a Question', open, { type: 'Start' }],
    ['Start during Reveal', revealed, { type: 'Start' }],
    ['Close in the Lobby', lobby, { type: 'Close' }],
    ['Close during Reveal', revealed, { type: 'Close' }],
    ['Next in the Lobby', lobby, { type: 'Next' }],
    ['Next during a Question', open, { type: 'Next' }],
    ['an Answer in the Lobby', lobby, answer('p1', 'a')],
    ['an Answer during Reveal', revealed, answer('p1', 'a')],
  ] as const)('refuses %s', (_why, game, command) => {
    expect(decide(game(), command, T0 + 30_000)).toEqual({ ok: false, error: 'WRONG_PHASE' });
  });

  it('refuses every command once the Game is Finished', () => {
    let game = finished();
    game = ok(game, answer('p1', 'a'), T0).game;
    game = ok(game, { type: 'Next' }, T0 + 1_000).game;
    expect(game.phase).toBe('FINISHED');
    for (const command of [{ type: 'Start' }, { type: 'Close' }, { type: 'Next' }] as const) {
      expect(decide(game, command, T0 + 2_000)).toEqual({ ok: false, error: 'WRONG_PHASE' });
    }
    expect(decide(game, join('p9'), T0)).toEqual({ ok: false, error: 'GAME_STARTED' });
  });
});

describe('decide: closing and Reveal', () => {
  it('reveals the correct Option, speed-weighted points, ranks and Option counts at the deadline', () => {
    let game = openGame('p1', 'p2', 'p3', 'p4');
    game = ok(game, answer('p1', 'a'), T0).game; // correct, instant: 1000
    game = ok(game, answer('p2', 'a'), T0 + 10_000).game; // correct, half time: 750
    game = ok(game, answer('p3', 'b'), T0 + 2_000).game; // wrong: 0
    // p4 doesn't answer: 0

    const d = ok(game, { type: 'Close' }, T0 + 20_000);

    expect(d.game.phase).toBe('REVEAL');
    const results = [
      { playerId: 'p1', nickname: 'p1', points: 1000, score: 1000, rank: 1 },
      { playerId: 'p2', nickname: 'p2', points: 750, score: 750, rank: 2 },
      { playerId: 'p3', nickname: 'p3', points: 0, score: 0, rank: 3 },
      { playerId: 'p4', nickname: 'p4', points: 0, score: 0, rank: 3 },
    ];
    expect(d.events).toEqual([
      { type: 'QUESTION_REVEALED', questionIndex: 0, correctOptionId: 'a', results },
      {
        type: 'QUESTION_REVEALED_HOST',
        questionIndex: 0,
        correctOptionId: 'a',
        results,
        optionCounts: { a: 2, b: 1, c: 0, d: 0 },
      },
    ]);
  });

  it('refuses to close before the deadline while some Players have not answered', () => {
    const game = ok(openGame('p1', 'p2'), answer('p1', 'a'), T0 + 1_000).game;
    expect(decide(game, { type: 'Close' }, T0 + 19_999)).toEqual({
      ok: false,
      error: 'DEADLINE_NOT_REACHED',
    });
  });

  it('reveals as soon as the last Player answers, before the deadline', () => {
    const game = ok(openGame('p1', 'p2'), answer('p1', 'b'), T0 + 1_000).game;
    const d = ok(game, answer('p2', 'a'), T0 + 4_000);

    expect(d.game.phase).toBe('REVEAL');
    expect(d.events.map((e) => e.type)).toEqual([
      'ANSWER_COUNT',
      'QUESTION_REVEALED',
      'QUESTION_REVEALED_HOST',
    ]);
    expect(d.events[1]).toMatchObject({
      results: [
        { playerId: 'p2', points: 900, rank: 1 },
        { playerId: 'p1', points: 0, rank: 2 },
      ],
    });
  });
});

describe('decide: what History needs', () => {
  it('keeps each revealed Question’s Option counts, through to the end of the Game', () => {
    let game = ok(ok(ok(newGame(readyQuiz(2)), join('p1')).game, join('p2')).game, {
      type: 'Start',
    }).game;
    game = ok(game, answer('p1', 'a'), T0).game;
    game = ok(game, answer('p2', 'b'), T0 + 1_000).game; // Reveal Q1
    expect(game.revealed).toEqual([{ questionIndex: 0, optionCounts: { a: 1, b: 1, c: 0, d: 0 } }]);

    game = ok(game, { type: 'Next' }, T0 + 2_000).game;
    game = ok(game, answer('p1', 'c', 1), T0 + 3_000).game;
    game = ok(game, answer('p2', 'c', 1), T0 + 4_000).game; // Reveal Q2
    game = ok(game, { type: 'Next' }, T0 + 5_000).game; // Finished

    expect(game.phase).toBe('FINISHED');
    expect(game.revealed).toEqual([
      { questionIndex: 0, optionCounts: { a: 1, b: 1, c: 0, d: 0 } },
      { questionIndex: 1, optionCounts: { a: 0, b: 0, c: 2, d: 0 } },
    ]);
  });
});
