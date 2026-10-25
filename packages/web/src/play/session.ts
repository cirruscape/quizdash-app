// The Player's device remembers its Player token, so a reload or a dropped connection silently
// rejoins as the same Player (FR-8.1). Kept in localStorage, which can be unavailable.
export interface PlayerSession {
  gameId: string;
  playerId: string;
  token: string;
  nickname: string;
}

const KEY = 'quizapp.playerSession';

export function loadSession(): PlayerSession | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as PlayerSession) : null;
  } catch {
    return null;
  }
}

export function saveSession(session: PlayerSession): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(session));
  } catch {
    // Private browsing etc.: the Game still works, but a reload loses the seat.
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
