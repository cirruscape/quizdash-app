// Routes domain events to AppSync Events channels (PLAN §6). The Host subscribes to both
// channels; Players subscribe only to the players channel, so Host-only data stays off it.
import type { GameEvent, Instant } from '@quizapp/domain';

export interface EventEnvelope {
  type: GameEvent['type'];
  gameId: string;
  /** The Game's version after this change; a gap tells a client to re-fetch its snapshot. */
  version: number;
  serverNow: Instant;
  payload: Record<string, unknown>;
}

export interface ChannelMessage {
  channel: string;
  event: EventEnvelope;
}

export type Publish = (messages: ChannelMessage[]) => Promise<void>;

type Audience = 'players' | 'host';

const AUDIENCES: Record<GameEvent['type'], Audience[]> = {
  PLAYER_JOINED: ['host'],
  PLAYER_REMOVED: ['host', 'players'],
  QUESTION_OPENED: ['players'],
  ANSWER_COUNT: ['host'],
  QUESTION_REVEALED: ['players'],
  QUESTION_REVEALED_HOST: ['host'],
  GAME_FINISHED: ['players'],
};

export function channelFor(gameId: string, audience: Audience): string {
  return `/game/${gameId}/${audience}`;
}

export function routeEvents(
  gameId: string,
  version: number,
  serverNow: Instant,
  events: GameEvent[],
): ChannelMessage[] {
  return events.flatMap(({ type, ...payload }) =>
    AUDIENCES[type].map((audience) => ({
      channel: channelFor(gameId, audience),
      event: { type, gameId, version, serverNow, payload },
    })),
  );
}
