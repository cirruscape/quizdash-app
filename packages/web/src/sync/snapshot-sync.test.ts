import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSnapshotSync, remainingMs, type SyncSnapshot } from './snapshot-sync.js';

interface Snap extends SyncSnapshot {
  label: string;
}

/** A fake server: each fetch resolves when the test calls respond(). */
function fakeServer() {
  const pending: ((s: Snap) => void)[] = [];
  const rejecters: ((err: Error) => void)[] = [];
  return {
    fetchSnapshot: vi.fn(
      () =>
        new Promise<Snap>((resolve, reject) => {
          pending.push(resolve);
          rejecters.push(reject);
        }),
    ),
    async fail() {
      pending.shift();
      const reject = rejecters.shift();
      if (!reject) throw new Error('no fetch in flight');
      reject(new Error('network down'));
      await vi.advanceTimersByTimeAsync(0);
    },
    async respond(snap: Snap) {
      const resolve = pending.shift();
      rejecters.shift();
      if (!resolve) throw new Error('no fetch in flight');
      resolve(snap);
      await vi.advanceTimersByTimeAsync(0);
    },
  };
}

const snap = (version: number, extra: Partial<Snap> = {}): Snap => ({
  version,
  serverNow: Date.now(),
  deadline: null,
  label: `v${version}`,
  ...extra,
});

describe('snapshot sync', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setup() {
    const server = fakeServer();
    const seen: string[] = [];
    const sync = createSnapshotSync<Snap>({
      fetchSnapshot: server.fetchSnapshot,
      onSnapshot: (s) => seen.push(s.label),
      pollMs: 4_000,
      deadlineGraceMs: 750,
    });
    return { server, seen, sync };
  }

  it('fetches once on start and shows the result', async () => {
    const { server, seen, sync } = setup();
    sync.start();
    expect(server.fetchSnapshot).toHaveBeenCalledTimes(1);
    await server.respond(snap(3));
    expect(seen).toEqual(['v3']);
    sync.stop();
  });

  it('re-fetches on an event, folding a burst of events into one follow-up fetch', async () => {
    const { server, seen, sync } = setup();
    sync.start();
    await server.respond(snap(3));

    sync.notify(4);
    expect(server.fetchSnapshot).toHaveBeenCalledTimes(2);
    sync.notify(5); // arrive while the fetch for 4 is in flight
    sync.notify(6);
    expect(server.fetchSnapshot).toHaveBeenCalledTimes(2);

    await server.respond(snap(4));
    expect(server.fetchSnapshot).toHaveBeenCalledTimes(3); // exactly one follow-up
    await server.respond(snap(6));
    expect(seen).toEqual(['v3', 'v4', 'v6']);
    sync.stop();
  });

  it('ignores events for versions it already has, and out-of-date responses', async () => {
    const { server, seen, sync } = setup();
    sync.start();
    await server.respond(snap(5));

    sync.notify(5);
    sync.notify(4);
    expect(server.fetchSnapshot).toHaveBeenCalledTimes(1);

    sync.notify(6);
    await server.respond(snap(4)); // a slow, stale response
    expect(seen).toEqual(['v5']);
    sync.stop();
  });
});

describe('snapshot sync safety nets', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setup() {
    const server = fakeServer();
    const seen: string[] = [];
    const sync = createSnapshotSync<Snap>({
      fetchSnapshot: server.fetchSnapshot,
      onSnapshot: (s) => seen.push(s.label),
      pollMs: 4_000,
      deadlineGraceMs: 750,
    });
    return { server, seen, sync };
  }

  it('polls when no events arrive, recovering a lost one', async () => {
    const { server, seen, sync } = setup();
    sync.start();
    await server.respond(snap(3));

    await vi.advanceTimersByTimeAsync(3_999);
    expect(server.fetchSnapshot).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(server.fetchSnapshot).toHaveBeenCalledTimes(2);
    await server.respond(snap(4)); // the change whose event was lost
    expect(seen).toEqual(['v3', 'v4']);
    sync.stop();
  });

  it("fetches just after the deadline, on the server's clock, even when the device clock is off", async () => {
    const { server, sync } = setup();
    sync.start();
    // The server's clock runs 10 s ahead of the device's; the deadline is 2 s away.
    const serverNow = Date.now() + 10_000;
    await server.respond(snap(3, { serverNow, deadline: serverNow + 2_000 }));

    await vi.advanceTimersByTimeAsync(2_749);
    expect(server.fetchSnapshot).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); // deadline + 750 ms grace
    expect(server.fetchSnapshot).toHaveBeenCalledTimes(2);
    sync.stop();
  });

  it('keeps going after a failed fetch', async () => {
    const { server, seen, sync } = setup();
    sync.start();
    await server.fail();
    await vi.advanceTimersByTimeAsync(4_000);
    await server.respond(snap(3));
    expect(seen).toEqual(['v3']);
    sync.stop();
  });

  it('does nothing more once stopped', async () => {
    const { server, sync } = setup();
    sync.start();
    await server.respond(snap(3));
    sync.stop();
    sync.notify(4);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(server.fetchSnapshot).toHaveBeenCalledTimes(1);
  });
});

describe('remainingMs', () => {
  it("counts down on the server's clock, whatever the device clock says", () => {
    // Received when the server said 100 000 and the device said 5 000; deadline 120 000.
    const at = { serverNow: 100_000, receivedAt: 5_000 };
    expect(remainingMs(120_000, at, 5_000)).toBe(20_000);
    expect(remainingMs(120_000, at, 12_500)).toBe(12_500);
    expect(remainingMs(120_000, at, 30_000)).toBe(0); // never negative
  });
});
