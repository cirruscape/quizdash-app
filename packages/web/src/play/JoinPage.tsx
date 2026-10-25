// Joining a Game with a Join Code and a Nickname (FR-4.5, FR-5.x). The code can come from a
// join link: /play?code=ABC234.
import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { api, messageFor } from '../api.js';
import { ErrorNote, Page } from '../components.js';
import { loadSession, saveSession } from './session.js';

export function JoinPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [joinCode, setJoinCode] = useState((params.get('code') ?? '').toUpperCase());
  const [nickname, setNickname] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function join(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ gameId: string; playerId: string; playerToken: string }>(
        'POST',
        '/api/join',
        { body: { joinCode: joinCode.trim().toUpperCase(), nickname } },
      );
      saveSession({ gameId: res.gameId, playerId: res.playerId, token: res.playerToken, nickname });
      navigate('/play/game');
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setBusy(false);
    }
  }

  const existing = loadSession();

  return (
    <Page title="Join a game">
      {existing && (
        <div className="banner">
          <p>You’re in a game as {existing.nickname}.</p>
          <button
            type="button"
            className="button button--primary"
            onClick={() => navigate('/play/game')}
          >
            Return to it
          </button>
        </div>
      )}
      <form className="stack" onSubmit={join}>
        <label>
          Join code
          <input
            className="input input--code"
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
            maxLength={6}
            autoComplete="off"
            autoCapitalize="characters"
            inputMode="text"
            required
          />
        </label>
        <label>
          Nickname
          <input
            className="input"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            maxLength={16}
            autoComplete="nickname"
            required
          />
        </label>
        <ErrorNote message={error} />
        <button className="button button--primary" disabled={busy}>
          {busy ? 'Joining…' : 'Join'}
        </button>
      </form>
    </Page>
  );
}
