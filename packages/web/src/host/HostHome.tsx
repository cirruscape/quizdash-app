// The Host's home: resume an unfinished Game from any device (FR-8.3), generate a Quiz, review
// Drafts, or start a Game from a Ready Quiz (FR-4.1).
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { api, messageFor } from '../api.js';
import { ErrorNote, Page } from '../components.js';
import type { QuizSummary } from '../types.js';
import { hostToken } from './auth.js';

const STATUS_LABEL: Record<QuizSummary['status'], string> = {
  GENERATING: 'Generating…',
  DRAFT: 'Draft',
  READY: 'Ready',
  FAILED: 'Failed',
};

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
      <Link className="link" to="/host/history">
        Past games →
      </Link>
      {activeGameId && (
        <div className="banner">
          <p>You have a game in progress.</p>
          <Link className="button button--primary" to={`/host/games/${activeGameId}`}>
            Resume it
          </Link>
        </div>
      )}
      <Link className="button button--primary" to="/host/quizzes/new">
        New quiz
      </Link>
      <ErrorNote message={error} />
      {quizzes === null ? (
        <p className="muted">Loading…</p>
      ) : quizzes.length === 0 ? (
        <p className="muted">No quizzes yet. Choose New quiz and give it a topic.</p>
      ) : (
        <ul className="cards">
          {quizzes.map((q) => (
            <li key={q.quizId} className="card">
              <div>
                <h2 className="card__title">{q.topic ?? q.quizId}</h2>
                <p className="muted">
                  <span className={`badge badge--${q.status.toLowerCase()}`}>
                    {STATUS_LABEL[q.status]}
                  </span>{' '}
                  {q.status !== 'GENERATING' &&
                    q.status !== 'FAILED' &&
                    `${q.questionCount} questions`}
                  {q.status === 'FAILED' &&
                    (q.failureReason === 'TOPIC_REFUSED'
                      ? 'This topic couldn’t be used.'
                      : 'Generation failed.')}
                </p>
              </div>
              {q.status === 'READY' ? (
                <button
                  type="button"
                  className="button button--primary"
                  disabled={activeGameId !== null || starting !== null}
                  onClick={() => void startGame(q.quizId)}
                >
                  {starting === q.quizId ? 'Starting…' : 'Start a game'}
                </button>
              ) : (
                <Link className="button" to={`/host/quizzes/${q.quizId}`}>
                  {q.status === 'DRAFT' ? 'Review' : 'Open'}
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
    </Page>
  );
}
