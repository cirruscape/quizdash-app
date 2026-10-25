// React glue for ADR 0002: render from the snapshot only; real-time events and reconnects just
// trigger a re-fetch, and the sync controller's poll and deadline fetch recover lost events.
import { useEffect, useRef, useState } from 'react';
import { connectRealtime } from '../realtime.js';
import { createSnapshotSync, type ClockSample, type SyncSnapshot } from './snapshot-sync.js';

export interface LiveSnapshot<S> {
  snapshot: S | null;
  /** When the snapshot arrived, for countdowns on the server's clock. */
  clock: ClockSample | null;
  error: unknown;
  /** Re-fetch now, e.g. right after this client sent a command. */
  refresh: () => void;
}

export function useLiveSnapshot<S extends SyncSnapshot>(options: {
  /** Changing this key restarts everything (e.g. a different Game). */
  key: string;
  fetchSnapshot: () => Promise<S>;
  channels: string[];
  token: () => Promise<string>;
}): LiveSnapshot<S> {
  const [state, setState] = useState<{ snapshot: S | null; clock: ClockSample | null }>({
    snapshot: null,
    clock: null,
  });
  const [error, setError] = useState<unknown>(null);
  const notify = useRef<(version?: number) => void>(() => {});
  const latest = useRef(options);
  latest.current = options;

  useEffect(() => {
    const sync = createSnapshotSync<S>({
      fetchSnapshot: () => latest.current.fetchSnapshot(),
      onSnapshot: (snapshot) => {
        setError(null);
        setState({ snapshot, clock: { serverNow: snapshot.serverNow, receivedAt: Date.now() } });
      },
      onError: setError,
      pollMs: 4_000,
      deadlineGraceMs: 750,
    });
    notify.current = (version) => sync.notify(version);
    sync.start();
    const disconnect = connectRealtime({
      token: () => latest.current.token(),
      channels: latest.current.channels,
      onSignal: (version) => sync.notify(version),
    });
    return () => {
      sync.stop();
      disconnect();
    };
  }, [options.key]);

  return { ...state, error, refresh: () => notify.current() };
}
