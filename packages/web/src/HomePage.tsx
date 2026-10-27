// The home page: what Trivolt is, a quick way in for Players (enter a Join Code) and for Hosts.
// Laid out like the About page, in Cirruscape's style.
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';

const STEPS = [
  {
    title: 'Pick a topic',
    text: 'The host signs in, names a topic and a difficulty, and AI writes and checks the questions. The host reviews every one before approving the quiz.',
  },
  {
    title: 'Share the code',
    text: 'Players join from any phone with the six-character Join Code and a nickname. There’s no app to install and no account to create.',
  },
  {
    title: 'Play live',
    text: 'Every question is timed, and faster correct answers score more. The leaderboard updates after each question, live on every screen.',
  },
];

const FEATURES = [
  {
    icon: '👥',
    title: 'Built for the room',
    text: 'Up to 50 players in a game: a party, a classroom, or a team meeting.',
  },
  {
    icon: '⏱️',
    title: 'Fair, fast scoring',
    text: 'The server keeps time for everyone, so no phone gets an advantage from its clock.',
  },
  {
    icon: '📜',
    title: 'Game history',
    text: 'Hosts can look back at past games: every question, how the room answered, and who won.',
  },
];

export function HomePage() {
  const navigate = useNavigate();
  const [code, setCode] = useState('');

  function join(e: FormEvent) {
    e.preventDefault();
    const joinCode = code.trim().toUpperCase();
    navigate(joinCode ? `/play?code=${encodeURIComponent(joinCode)}` : '/play');
  }

  return (
    <main className="landing">
      <section className="hero">
        <div className="container hero__layout">
          <div>
            <span className="hero__badge">Live multiplayer trivia</span>
            <h1>
              Create a quiz from <span className="hero__accent">any chosen topic</span>
            </h1>
            <p className="hero__lead">
              Trivolt writes the questions with AI. Your players join on their phones, race the
              clock, and climb the leaderboard in real time.
            </p>
            <div className="hero__actions">
              <Link className="cta cta--primary" to="/host">
                Host a game
              </Link>
              <Link className="cta cta--secondary" to="/about">
                Learn more
              </Link>
            </div>
          </div>

          <form className="joinpanel" onSubmit={join} aria-labelledby="joinpanel-title">
            <h2 id="joinpanel-title">Join a game</h2>
            <p>Enter the code on the host’s screen.</p>
            <label className="joinpanel__label">
              <span className="visually-hidden">Join Code</span>
              <input
                className="input input--code joinpanel__input"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="ABC234"
                maxLength={6}
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                inputMode="text"
              />
            </label>
            <button className="cta cta--primary joinpanel__button" type="submit">
              Join
            </button>
          </form>
        </div>
      </section>

      <section className="section" aria-labelledby="home-how">
        <div className="container">
          <h2 id="home-how" className="section__title">
            How it works
          </h2>
          <p className="section__subtitle">From a topic to a full leaderboard in three steps.</p>
          <ol className="tiles steps">
            {STEPS.map((s, i) => (
              <li key={s.title} className="tile">
                <span className="steps__number" aria-hidden="true">
                  {i + 1}
                </span>
                <h3>{s.title}</h3>
                <p>{s.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="section section--alt" aria-labelledby="home-why">
        <div className="container">
          <h2 id="home-why" className="section__title">
            Why Trivolt
          </h2>
          <p className="section__subtitle">
            Everything a quiz night needs, with nothing to set up.
          </p>
          <ul className="tiles">
            {FEATURES.map((f) => (
              <li key={f.title} className="tile">
                <span className="tile__icon" aria-hidden="true">
                  {f.icon}
                </span>
                <h3>{f.title}</h3>
                <p>{f.text}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="closing" aria-labelledby="home-ready">
        <div className="container">
          <h2 id="home-ready">Ready to host?</h2>
          <p>Sign in, pick a topic, and your first quiz is a few minutes away.</p>
          <Link className="cta cta--primary" to="/host">
            Host a game
          </Link>
        </div>
      </section>
    </main>
  );
}
