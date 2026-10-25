// A browser AppSync Events subscriber (PLAN §6). Events are only signals to re-fetch the snapshot
// (ADR 0002), so this keeps nothing: it reports each event's version, and reconnects with backoff.
import { appConfig } from './config.js';

export interface RealtimeOptions {
  /** Called for every connect, so an expiring Cognito token is refreshed on reconnect. */
  token: () => Promise<string>;
  channels: string[];
  /** A Game event arrived (its version), or the connection was re-established (undefined). */
  onSignal: (version?: number) => void;
}

export function connectRealtime(options: RealtimeOptions): () => void {
  let socket: WebSocket | undefined;
  let closed = false;
  let attempt = 0;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;

  const base64url = (text: string) =>
    btoa(text).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');

  async function open(): Promise<void> {
    const { eventsHttpDomain, eventsRealtimeDomain } = appConfig();
    const token = await options.token();
    const auth = { Authorization: token };
    const header = base64url(JSON.stringify({ host: eventsHttpDomain, ...auth }));
    const ws = new WebSocket(`wss://${eventsRealtimeDomain}/event/realtime`, [
      'aws-appsync-event-ws',
      `header-${header}`,
    ]);
    socket = ws;

    ws.onopen = () => ws.send(JSON.stringify({ type: 'connection_init' }));
    ws.onmessage = (m) => {
      const message = JSON.parse(String(m.data)) as { type: string; event?: unknown };
      if (message.type === 'connection_ack') {
        attempt = 0;
        options.channels.forEach((channel, i) =>
          ws.send(JSON.stringify({ type: 'subscribe', id: `s${i}`, channel, authorization: auth })),
        );
        options.onSignal(); // we may have missed changes while disconnected
      } else if (message.type === 'data') {
        for (const version of versionsIn(message.event)) options.onSignal(version);
      }
    };
    ws.onclose = () => {
      if (closed) return;
      // Back off: 1 s, 2 s, 4 s ... up to 30 s.
      const delay = Math.min(30_000, 1_000 * 2 ** attempt++);
      retryTimer = setTimeout(
        () => void open().catch(() => ws.onclose?.(new CloseEvent('close'))),
        delay,
      );
    };
  }

  void open().catch(() => socket?.onclose?.(new CloseEvent('close')));

  return () => {
    closed = true;
    clearTimeout(retryTimer);
    socket?.close();
  };
}

/** AppSync delivers each event as a JSON string, sometimes in an array. */
function versionsIn(raw: unknown): (number | undefined)[] {
  const items = Array.isArray(raw) ? raw : [raw];
  return items.map((item) => {
    try {
      let value: unknown = item;
      while (typeof value === 'string') value = JSON.parse(value);
      const version = (value as { version?: unknown }).version;
      return typeof version === 'number' ? version : undefined;
    } catch {
      return undefined;
    }
  });
}
