// A ticking countdown to a server-clock deadline (FR-6.3, FR-6.5).
import { useEffect, useState } from 'react';
import { remainingMs, type ClockSample } from './snapshot-sync.js';

export function useCountdown(deadline: number | null, clock: ClockSample | null): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (deadline === null) return;
    const timer = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(timer);
  }, [deadline]);
  if (deadline === null || clock === null) return null;
  return remainingMs(deadline, clock, now);
}
