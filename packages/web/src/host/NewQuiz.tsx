// Generating a Quiz from a Topic (FR-2.1). Generation continues in the background, so this
// just submits the request and goes to the Quiz's page, which shows its progress.
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { api, messageFor } from '../api.js';
import { ErrorNote, Page } from '../components.js';
import { hostToken } from './auth.js';

export function NewQuiz() {
  const navigate = useNavigate();
  const [topic, setTopic] = useState('');
  const [difficulty, setDifficulty] = useState<'EASY' | 'MEDIUM' | 'HARD'>('MEDIUM');
  const [questionCount, setQuestionCount] = useState(10);
  const [defaultTimeLimitSeconds, setTimeLimit] = useState(20);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { quizId } = await api<{ quizId: string }>('POST', '/api/quizzes', {
        token: await hostToken(),
        body: { topic, difficulty, questionCount, defaultTimeLimitSeconds },
      });
      navigate(`/host/quizzes/${quizId}`);
    } catch (err) {
      setError(messageFor(err));
      setBusy(false);
    }
  }

  return (
    <Page title="New quiz">
      <Link className="link" to="/host">
        ← Your quizzes
      </Link>
      <form className="stack" onSubmit={submit}>
        <label>
          Topic
          <input
            className="input"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="e.g. 90s Britpop"
            minLength={3}
            maxLength={80}
            required
          />
        </label>
        <label>
          Difficulty
          <select
            className="input"
            value={difficulty}
            onChange={(e) => setDifficulty(e.target.value as typeof difficulty)}
          >
            <option value="EASY">Easy</option>
            <option value="MEDIUM">Medium</option>
            <option value="HARD">Hard</option>
          </select>
        </label>
        <label>
          Number of questions (5–20)
          <input
            className="input"
            type="number"
            min={5}
            max={20}
            value={questionCount}
            onChange={(e) => setQuestionCount(Number(e.target.value))}
            required
          />
        </label>
        <label>
          Seconds per question (5–120)
          <input
            className="input"
            type="number"
            min={5}
            max={120}
            value={defaultTimeLimitSeconds}
            onChange={(e) => setTimeLimit(Number(e.target.value))}
            required
          />
        </label>
        <ErrorNote message={error} />
        <button className="button button--primary" disabled={busy}>
          {busy ? 'Starting…' : 'Generate quiz'}
        </button>
        <p className="muted">
          Generation takes up to a minute. You’ll review every question before it can be played.
        </p>
      </form>
    </Page>
  );
}
