// The Host's Game History (FR-9.1–9.3): past Games, newest first, and each one in detail.
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { api, messageFor } from '../api.js';
import { ErrorNote, Leaderboard, Options, Page } from '../components.js';
import type { HistoryRecord, HistorySummary } from '../types.js';
import { hostToken } from './auth.js';

const when = (ms: number) =>
  new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

function useHostFetch<T>(path: string): { data: T | null; error: string | null } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void (async () => {
      try {
        setData(await api<T>('GET', path, { token: await hostToken() }));
      } catch (err) {
        setError(messageFor(err));
      }
    })();
  }, [path]);
  return { data, error };
}

export function HostHistoryList() {
  const { data, error } = useHostFetch<HistorySummary[]>('/api/history');
  return (
    <Page title="Past games">
      <Link className="link" to="/host">
        ← Your quizzes
      </Link>
      <ErrorNote message={error} />
      {data === null ? (
        !error && <p className="muted">Loading…</p>
      ) : data.length === 0 ? (
        <p className="muted">No finished games yet.</p>
      ) : (
        <ul className="cards">
          {data.map((g) => (
            <li key={g.gameId}>
              <Link className="card card--link" to={`/host/history/${g.gameId}`}>
                <div>
                  <h2 className="card__title">{g.topic ?? 'Quiz'}</h2>
                  <p className="muted">
                    {when(g.finishedAt)} · {g.playerCount}{' '}
                    {g.playerCount === 1 ? 'player' : 'players'}
                    {g.abandoned ? ' · abandoned' : ''}
                  </p>
                </div>
                {g.winner && <p className="card__winner">🏆 {g.winner}</p>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Page>
  );
}

export function HostHistoryDetail() {
  const { gameId = '' } = useParams();
  const { data, error } = useHostFetch<HistoryRecord>(`/api/history/${gameId}`);
  return (
    <Page title={data?.topic ?? 'Past game'}>
      <Link className="link" to="/host/history">
        ← Past games
      </Link>
      <ErrorNote message={error} />
      {data && (
        <>
          <p className="muted">
            {when(data.finishedAt)}
            {data.abandoned ? ' · abandoned before the end' : ''}
          </p>
          <h2>Final leaderboard</h2>
          <Leaderboard entries={data.leaderboard} />
          <h2>Questions</h2>
          {data.questions.map((q, i) => (
            <section key={i} className="stack">
              <p className="question__count">Question {i + 1}</p>
              <p className="question__text">{q.text}</p>
              <Options options={q.options} correct={q.correctOptionId} counts={q.optionCounts} />
            </section>
          ))}
        </>
      )}
    </Page>
  );
}
