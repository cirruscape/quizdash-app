// Keeps a screen in step with the server (ADR 0002): screens render only from snapshots, and
// pushed events are just "something changed" signals, because AppSync Events may drop them.
// A slow poll, and a fetch just after each deadline, recover anything lost.

export interface SyncSnapshot {
  /** The Game's version; only the newest snapshot seen is ever shown. */
  version: number;
  /** The server's clock when the snapshot was made (ms). */
  serverNow: number;
  /** The current Question's deadline on the server's clock (ms), if one is running. */
  deadline: number | null;
}

export interface SyncOptions<S extends SyncSnapshot> {
  fetchSnapshot: () => Promise<S>;
  onSnapshot: (snapshot: S) => void;
  pollMs: number;
  /** How long after a deadline to re-fetch, giving the Host's close time to land. */
  deadlineGraceMs: number;
  onError?: (err: unknown) => void;
}

export interface SnapshotSync {
  start(): void;
  /** A pushed event arrived for `version` (or an unknown version, if omitted). */
  notify(version?: number): void;
  stop(): void;
}

/** When a snapshot arrived, on both clocks, so the device can count down on the server's. */
export interface ClockSample {
  serverNow: number;
  receivedAt: number;
}

/** Time left until a server-clock deadline, measured with the device's clock (FR-6.5). */
export function remainingMs(deadline: number, at: ClockSample, deviceNow: number): number {
  const serverNowEstimate = at.serverNow + (deviceNow - at.receivedAt);
  return Math.max(0, deadline - serverNowEstimate);
}

export function createSnapshotSync<S extends SyncSnapshot>(options: SyncOptions<S>): SnapshotSync {
  let latest = -1;
  let inFlight = false;
  let again = false;
  let stopped = false;
  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  let scheduledDeadline: number | null = null;

  function schedulePoll(): void {
    clearTimeout(pollTimer);
    pollTimer = setTimeout(() => void fetchNow(), options.pollMs);
  }

  function scheduleDeadline(snapshot: S): void {
    if (snapshot.deadline === null || snapshot.deadline === scheduledDeadline) return;
    clearTimeout(deadlineTimer);
    scheduledDeadline = snapshot.deadline;
    const wait = remainingMs(
      snapshot.deadline,
      { serverNow: snapshot.serverNow, receivedAt: Date.now() },
      Date.now(),
    );
    deadlineTimer = setTimeout(() => void fetchNow(), wait + options.deadlineGraceMs);
  }

  async function fetchNow(): Promise<void> {
    if (stopped) return;
    if (inFlight) {
      again = true; // fold into one follow-up fetch
      return;
    }
    inFlight = true;
    try {
      const snapshot = await options.fetchSnapshot();
      if (!stopped && snapshot.version > latest) {
        latest = snapshot.version;
        options.onSnapshot(snapshot);
        scheduleDeadline(snapshot);
      }
    } catch (err) {
      options.onError?.(err); // the next poll retries
    } finally {
      inFlight = false;
      if (!stopped) {
        schedulePoll();
        if (again) {
          again = false;
          void fetchNow();
        }
      }
    }
  }

  return {
    start() {
      void fetchNow();
    },
    notify(version) {
      if (version !== undefined && version <= latest) return;
      void fetchNow();
    },
    stop() {
      stopped = true;
      clearTimeout(pollTimer);
      clearTimeout(deadlineTimer);
    },
  };
}
