// Pure Game rules: no I/O, no AWS SDK, `now` is always passed in (PLAN §7).
// The state machine, scoring, ranking, Nickname rules and Join Codes arrive in M1.

/** The phases a Game moves through (GLOSSARY: Lobby, Question Open, Reveal, Finished). */
export const PHASES = ['LOBBY', 'QUESTION_OPEN', 'REVEAL', 'FINISHED'] as const;
export type Phase = (typeof PHASES)[number];
