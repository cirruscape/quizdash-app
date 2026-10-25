// A minimal AppSync Events WebSocket subscriber, for the smoke test: connect with a token,
// subscribe to channels, and wait for the Game events that arrive.
export interface GameEventEnvelope {
  type: string;
  gameId: string;
  version: number;
  serverNow: number;
  payload: Record<string, unknown>;
}

type Message = { type: string; id?: string; event?: unknown; errors?: unknown };

export class EventsClient {
  private readonly events: GameEventEnvelope[] = [];
  private readonly listeners = new Set<() => void>();
  private nextId = 0;

  private constructor(
    private readonly socket: WebSocket,
    private readonly token: string,
  ) {
    socket.addEventListener('message', (m) => this.onMessage(JSON.parse(String(m.data))));
    // Surface a closed socket to anyone waiting, rather than letting them time out.
    socket.addEventListener('close', (e) =>
      this.onMessage({ type: 'closed', errors: { code: e.code, reason: e.reason } }),
    );
  }

  static async connect(realtimeDomain: string, httpDomain: string, token: string) {
    const header = Buffer.from(JSON.stringify({ host: httpDomain, Authorization: token })).toString(
      'base64url',
    );
    const socket = new WebSocket(`wss://${realtimeDomain}/event/realtime`, [
      'aws-appsync-event-ws',
      `header-${header}`,
    ]);
    const client = new EventsClient(socket, token);
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener('open', () => resolve(), { once: true });
      socket.addEventListener('error', () => reject(new Error('WebSocket connection failed')), {
        once: true,
      });
    });
    socket.send(JSON.stringify({ type: 'connection_init' }));
    const ack = await client.reply(
      (m) => m.type === 'connection_ack' || m.type === 'connection_error' || m.type === 'closed',
      'connection_ack',
    );
    if (ack.type !== 'connection_ack') {
      throw new Error(`connection refused: ${JSON.stringify(ack)}`);
    }
    return client;
  }

  async subscribe(channel: string): Promise<void> {
    const id = `sub${++this.nextId}`;
    this.socket.send(
      JSON.stringify({
        type: 'subscribe',
        id,
        channel,
        authorization: { Authorization: this.token },
      }),
    );
    const res = await this.reply(
      (m) => m.id === id && (m.type === 'subscribe_success' || m.type === 'subscribe_error'),
      `subscribe ${channel}`,
    );
    if (res.type !== 'subscribe_success') {
      throw new Error(`subscribe to ${channel} failed: ${JSON.stringify(res.errors)}`);
    }
  }

  /** Resolves with the first Game event (already received or yet to come) matching `match`. */
  async waitFor(
    match: (e: GameEventEnvelope) => boolean,
    what: string,
    timeoutMs = 15_000,
  ): Promise<GameEventEnvelope> {
    return this.until(() => this.events.find(match), `event: ${what}`, timeoutMs);
  }

  /** Everything received so far, for failure diagnostics. */
  received(): string {
    const events = this.events.map((e) => `${e.type}@v${e.version}`);
    const other = this.pending.map((m) => m.type);
    return `events [${events.join(', ')}], messages [${other.join(', ')}]`;
  }

  close(): void {
    this.socket.close();
  }

  private pending: Message[] = [];

  private onMessage(message: Message): void {
    if (message.type === 'data') {
      for (const e of decodeEvents(message.event)) this.events.push(e);
    } else if (message.type !== 'ka') {
      this.pending.push(message);
    }
    for (const notify of this.listeners) notify();
  }

  private reply(match: (m: Message) => boolean, what: string): Promise<Message> {
    return this.until(() => this.pending.find(match), what, 10_000);
  }

  private until<T>(find: () => T | undefined, what: string, timeoutMs: number): Promise<T> {
    return new Promise((resolve, reject) => {
      const check = () => {
        const found = find();
        if (found === undefined) return;
        cleanup();
        resolve(found);
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`timed out waiting for ${what}`));
      }, timeoutMs);
      const cleanup = () => {
        clearTimeout(timer);
        this.listeners.delete(check);
      };
      this.listeners.add(check);
      check();
    });
  }
}

/** AppSync delivers each event as a JSON string (possibly in an array); unwrap to envelopes. */
function decodeEvents(raw: unknown): GameEventEnvelope[] {
  const items = Array.isArray(raw) ? raw : [raw];
  return items.map((item) => {
    let value: unknown = item;
    while (typeof value === 'string') value = JSON.parse(value);
    return value as GameEventEnvelope;
  });
}
