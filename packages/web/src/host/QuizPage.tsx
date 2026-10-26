// One Quiz: its generation progress, the Draft review (FR-3.2), or a Ready Quiz to play.
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api, messageFor } from '../api.js';
import { ErrorNote, Options, Page } from '../components.js';
import type { QuizDetail } from '../types.js';
import { hostToken } from './auth.js';

const POLL_MS = 3_000;

export function QuizPage() {
  const { quizId = '' } = useParams();
  const navigate = useNavigate();
  const [quiz, setQuiz] = useState<QuizDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setQuiz(await api<QuizDetail>('GET', `/api/quizzes/${quizId}`, { token: await hostToken() }));
    } catch (err) {
      setError(messageFor(err));
    }
  }, [quizId]);

  // Poll while the agent is working: generating the Quiz, or regenerating a Question (FR-2.2).
  const working =
    quiz === null ||
    quiz.status === 'GENERATING' ||
    quiz.questions.some((q) => q.status === 'REGENERATING');
  useEffect(() => {
    void load();
    if (!working) return;
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [load, working]);

  async function act(method: string, path: string, body?: unknown) {
    setBusy(true);
    setError(null);
    try {
      await api(method, `/api/quizzes/${quizId}${path}`, { token: await hostToken(), body });
      await load();
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setBusy(false);
    }
  }

  async function startGame() {
    setBusy(true);
    try {
      const { gameId } = await api<{ gameId: string }>('POST', '/api/games', {
        token: await hostToken(),
        body: { quizId },
      });
      navigate(`/host/games/${gameId}`);
    } catch (err) {
      setError(messageFor(err));
      setBusy(false);
    }
  }

  async function remove() {
    await act('DELETE', '');
    navigate('/host');
  }

  const back = (
    <Link className="link" to="/host">
      ← Your quizzes
    </Link>
  );

  if (!quiz) {
    return (
      <Page>
        {back}
        {error ? <ErrorNote message={error} /> : <p className="muted">Loading…</p>}
      </Page>
    );
  }

  const title = quiz.topic ?? 'Quiz';

  if (quiz.status === 'GENERATING') {
    return (
      <Page title={title}>
        {back}
        <div className="banner">
          <p>
            Writing and fact-checking {quiz.requestedCount ?? ''} questions… this takes up to a
            minute.
          </p>
        </div>
      </Page>
    );
  }

  if (quiz.status === 'FAILED') {
    return (
      <Page title={title}>
        {back}
        <p className="error">
          {quiz.failureReason === 'TOPIC_REFUSED'
            ? 'We couldn’t generate a quiz on this topic. Try a different one.'
            : 'Generation failed, please try again.'}
        </p>
        <div className="stack">
          <Link className="button button--primary" to="/host/quizzes/new">
            Try another topic
          </Link>
          <button type="button" className="button" disabled={busy} onClick={() => void remove()}>
            Delete this quiz
          </button>
        </div>
      </Page>
    );
  }

  const draft = quiz.status === 'DRAFT';
  const regenerating = quiz.questions.some((q) => q.status === 'REGENERATING');
  const tooFew = quiz.questions.length < 5;
  const short = quiz.requestedCount !== undefined && quiz.questions.length < quiz.requestedCount;

  return (
    <Page title={title}>
      {back}
      <p className="muted">
        {draft ? 'Draft: review every question, then approve.' : 'Ready to play.'}{' '}
        {quiz.questions.length} questions · {quiz.difficulty?.toLowerCase()} ·{' '}
        {quiz.defaultTimeLimitSeconds}s each
      </p>
      {draft && short && (
        <p className="muted">
          Some questions didn’t pass fact-checking, so there are fewer than you asked for.
        </p>
      )}
      <ErrorNote message={error} />
      <ol className="review">
        {quiz.questions.map((q, i) => (
          <li key={q.questionId} className="card review__item">
            <p className="question__count">Question {i + 1}</p>
            {q.status === 'REGENERATING' ? (
              <p className="muted">Writing a replacement…</p>
            ) : (
              <>
                <p className="question__text">{q.text}</p>
                <Options options={q.options} correct={q.correctOptionId} />
              </>
            )}
            {draft && q.status !== 'REGENERATING' && (
              <div className="review__actions">
                <label className="review__time">
                  Seconds
                  <input
                    className="input"
                    type="number"
                    min={5}
                    max={120}
                    defaultValue={q.timeLimitSeconds ?? quiz.defaultTimeLimitSeconds}
                    onBlur={(e) => {
                      const seconds = Number(e.target.value);
                      const current = q.timeLimitSeconds ?? quiz.defaultTimeLimitSeconds;
                      if (seconds !== current) {
                        void act('PATCH', `/questions/${q.questionId}`, {
                          timeLimitSeconds:
                            seconds === quiz.defaultTimeLimitSeconds ? null : seconds,
                        });
                      }
                    }}
                  />
                </label>
                <button
                  type="button"
                  className="button"
                  disabled={busy}
                  onClick={() => void act('POST', `/questions/${q.questionId}/regenerate`)}
                >
                  Regenerate
                </button>
                <button
                  type="button"
                  className="link link--danger"
                  disabled={busy}
                  onClick={() => void act('DELETE', `/questions/${q.questionId}`)}
                >
                  Discard
                </button>
              </div>
            )}
          </li>
        ))}
      </ol>
      <div className="stack">
        {draft ? (
          <button
            type="button"
            className="button button--primary"
            disabled={busy || regenerating || tooFew}
            onClick={() => void act('POST', '/approve')}
          >
            {tooFew
              ? 'Needs at least 5 questions'
              : regenerating
                ? 'Wait for regenerating…'
                : 'Approve quiz'}
          </button>
        ) : (
          <button
            type="button"
            className="button button--primary"
            disabled={busy}
            onClick={() => void startGame()}
          >
            Start a game
          </button>
        )}
        <button type="button" className="button" disabled={busy} onClick={() => void remove()}>
          Delete quiz
        </button>
      </div>
    </Page>
  );
}
