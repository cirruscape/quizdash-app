// The Player's view of a live Game (FR-6.x), rendered only from the Player snapshot (ADR 0002).
// Reloading or reconnecting just resumes from the stored Player token (FR-8.1).
import { useState } from 'react';
import { Link, Navigate } from 'react-router';
import { api, ApiError, messageFor } from '../api.js';
import { Countdown, ErrorNote, Leaderboard, Options, Page, QuestionHeader } from '../components.js';
import { useCountdown } from '../sync/use-countdown.js';
import { useLiveSnapshot } from '../sync/use-live-snapshot.js';
import { runningDeadline, type PlayerSnapshot } from '../types.js';
import { clearSession, loadSession } from './session.js';

export function PlayerGame() {
  const session = loadSession();
  if (!session) return <Navigate to="/play" replace />;
  return <LivePlayerGame session={session} />;
}

function LivePlayerGame({ session }: { session: NonNullable<ReturnType<typeof loadSession>> }) {
  const live = useLiveSnapshot({
    key: session.gameId,
    fetchSnapshot: async () => {
      const s = await api<PlayerSnapshot>('GET', '/api/play', { token: session.token });
      return { ...s, deadline: runningDeadline(s) };
    },
    channels: [`/game/${session.gameId}/players`],
    token: async () => session.token,
  });
  const remaining = useCountdown(live.snapshot ? runningDeadline(live.snapshot) : null, live.clock);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (live.error instanceof ApiError && live.error.code === 'PLAYER_REMOVED') {
    return (
      <Page title="You were removed">
        <p>The host removed you from this game.</p>
        <Link className="button" to="/play" onClick={clearSession}>
          Join another game
        </Link>
      </Page>
    );
  }
  if (live.error instanceof ApiError && live.error.status === 401) {
    clearSession();
    return <Navigate to="/play" replace />;
  }

  const s = live.snapshot;
  if (!s) {
    return (
      <Page>
        {live.error ? <ErrorNote message={messageFor(live.error)} /> : <p>Connecting…</p>}
      </Page>
    );
  }

  async function answer(optionId: string) {
    if (!s?.question) return;
    setSending(true);
    setError(null);
    try {
      await api('POST', '/api/play/answers', {
        token: session.token,
        body: { questionIndex: s.question.questionIndex, optionId },
      });
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setSending(false);
      live.refresh();
    }
  }

  const me = (
    <p className="me">
      {s.me.nickname} · {s.me.score} points
    </p>
  );

  switch (s.phase) {
    case 'LOBBY':
      return (
        <Page title="You’re in!">
          {me}
          <p className="muted">Waiting for the host to start the game…</p>
        </Page>
      );

    case 'QUESTION_OPEN': {
      const q = s.question!;
      const answered = q.myAnswer !== null;
      return (
        <Page>
          <Countdown ms={remaining} />
          <QuestionHeader index={q.questionIndex} count={q.questionCount} text={q.text} />
          <Options
            options={q.options}
            chosen={q.myAnswer}
            {...(!answered && remaining !== 0 ? { onPick: answer } : {})}
            disabled={sending}
          />
          {answered && <p className="muted">Answer locked in. Waiting for the others…</p>}
          {!answered && remaining === 0 && <p className="muted">Time’s up!</p>}
          <ErrorNote message={error} />
          {me}
        </Page>
      );
    }

    case 'REVEAL': {
      const q = s.question!;
      const r = s.reveal!;
      const right = q.myAnswer === r.correctOptionId;
      return (
        <Page>
          <QuestionHeader index={q.questionIndex} count={q.questionCount} text={q.text} />
          <Options options={q.options} chosen={q.myAnswer} correct={r.correctOptionId} />
          <div className={`result ${right ? 'result--right' : 'result--wrong'}`}>
            <p className="result__headline">
              {q.myAnswer === null ? 'No answer' : right ? 'Correct!' : 'Not this time'}
            </p>
            <p>
              +{r.myPoints} points · you’re #{r.myRank}
            </p>
          </div>
          {me}
        </Page>
      );
    }

    case 'FINISHED':
      return (
        <Page title="Final leaderboard">
          <Leaderboard entries={s.leaderboard ?? []} highlight={s.me.playerId} />
          <Link className="button" to="/play" onClick={clearSession}>
            Join another game
          </Link>
        </Page>
      );
  }
}
