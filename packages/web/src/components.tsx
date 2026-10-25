// Small shared pieces of the Host and Player screens.
import type { ReactNode } from 'react';
import type { LeaderboardEntry, Option } from './types.js';

export function Page({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <main className="page">
      {title && <h1>{title}</h1>}
      {children}
    </main>
  );
}

export function Countdown({ ms }: { ms: number | null }) {
  if (ms === null) return null;
  const seconds = Math.ceil(ms / 1000);
  return (
    <div className={`countdown${seconds <= 5 ? ' countdown--urgent' : ''}`} aria-live="polite">
      {seconds}
    </div>
  );
}

export function QuestionHeader({
  index,
  count,
  text,
}: {
  index: number;
  count: number;
  text: string;
}) {
  return (
    <header className="question">
      <p className="question__count">
        Question {index + 1} of {count}
      </p>
      <h2 className="question__text">{text}</h2>
    </header>
  );
}

/** Option tiles. `onPick` makes them buttons; otherwise they just show state. */
export function Options(props: {
  options: Option[];
  chosen?: string | null;
  correct?: string | null;
  counts?: Record<string, number> | null;
  onPick?: (optionId: string) => void;
  disabled?: boolean;
}) {
  return (
    <ul className="options">
      {props.options.map((o, i) => {
        const classes = [
          'option',
          `option--${i}`,
          props.chosen === o.optionId ? 'option--chosen' : '',
          props.correct === o.optionId ? 'option--correct' : '',
          props.correct && props.correct !== o.optionId ? 'option--wrong' : '',
        ].join(' ');
        const label = (
          <>
            <span className="option__text">{o.text}</span>
            {props.counts && <span className="option__count">{props.counts[o.optionId] ?? 0}</span>}
          </>
        );
        return (
          <li key={o.optionId}>
            {props.onPick ? (
              <button
                type="button"
                className={classes}
                disabled={props.disabled}
                onClick={() => props.onPick?.(o.optionId)}
              >
                {label}
              </button>
            ) : (
              <div className={classes}>{label}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function Leaderboard({
  entries,
  highlight,
}: {
  entries: LeaderboardEntry[];
  highlight?: string;
}) {
  if (entries.length === 0) return <p className="muted">No players.</p>;
  return (
    <ol className="leaderboard">
      {entries.map((e) => (
        <li key={e.playerId} className={e.playerId === highlight ? 'leaderboard__me' : undefined}>
          <span className="leaderboard__rank">{e.rank}</span>
          <span className="leaderboard__name">{e.nickname}</span>
          <span className="leaderboard__score">{e.score}</span>
        </li>
      ))}
    </ol>
  );
}

export function ErrorNote({ message }: { message: string | null }) {
  return message ? (
    <p className="error" role="alert">
      {message}
    </p>
  ) : null;
}
