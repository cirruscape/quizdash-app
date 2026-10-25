// The Host's home: resume an unfinished Game from any device (FR-8.3), or start one from a Ready
// Quiz (FR-4.1). Quiz generation (M3) will add "New Quiz" here.
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { api, messageFor } from '../api.js';
import { ErrorNote, Page } from '../components.js';
import type { QuizSummary } from '../types.js';
import { hostToken } from './auth.js';

export function HostHome() {
  const navigate = useNavigate();
  const [quizzes, setQuizzes] = useState<QuizSummary[] | null>(null);
  const [activeGameId, setActiveGameId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const token = await hostToken();
        const [list, active] = await Promise.all([
          api<QuizSummary[]>('GET', '/api/quizzes', { token }),
          api<{ gameId: string | null }>('GET', '/api/games/active', { token }),
        ]);
        setQuizzes(list);
        setActiveGameId(active.gameId);
      } catch (err) {
        setError(messageFor(err));
      }
    })();
  }, []);

  async function startGame(quizId: string) {
    setStarting(quizId);
    setError(null);
    try {
      const { gameId } = await api<{ gameId: string }>('POST', '/api/games', {
        token: await hostToken(),
        body: { quizId },
      });
      navigate(`/host/games/${gameId}`);
    } catch (err) {
      setError(messageFor(err));
      setStarting(null);
    }
  }

  return (
    <Page title="Your quizzes">
      {activeGameId && (
        <div className="banner">
          <p>You have a game in progress.</p>
          <Link className="button button--primary" to={`/host/games/${activeGameId}`}>
            Resume it
          </Link>
        </div>
      )}
      <ErrorNote message={error} />
      {quizzes === null ? (
        <p className="muted">Loading…</p>
      ) : quizzes.length === 0 ? (
        <p className="muted">
          No Ready quizzes yet. Quiz generation is coming soon; for now, ask for the sample quiz to
          be added to your account.
        </p>
      ) : (
        <ul className="cards">
          {quizzes.map((q) => (
            <li key={q.quizId} className="card">
              <div>
                <h2 className="card__title">{q.topic ?? q.quizId}</h2>
                <p className="muted">{q.questionCount} questions</p>
              </div>
              <button
                type="button"
                className="button button--primary"
                disabled={activeGameId !== null || starting !== null}
                onClick={() => void startGame(q.quizId)}
              >
                {starting === q.quizId ? 'Starting…' : 'Start a game'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Page>
  );
}
