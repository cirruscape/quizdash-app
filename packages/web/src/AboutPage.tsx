// About Trivolt: what it is, who's behind it, and how to get in touch. Laid out like a
// company About page, in Cirruscape's style (https://cirruscape.com).
import { Link } from 'react-router';

const FEATURES = [
  {
    icon: '🎯',
    title: 'Live play',
    text: 'Up to 50 players join on their phones with a six-character code. Every question is timed, and faster correct answers score more.',
  },
  {
    icon: '✨',
    title: 'AI-generated quizzes',
    text: 'A host names a topic and a difficulty, and AI writes and checks the questions. The host reviews every one before it goes live.',
  },
  {
    icon: '☁️',
    title: 'Built in The Cloud',
    text: 'Fully serverless on AWS, using Cloud Native best practices: scalable and highly available, with nothing to run when no one is playing.',
  },
];

/** Cirruscape's logo: its orange cloud mark beside the gradient name, as on cirruscape.com. */
function CirruscapeLogo() {
  return (
    <span className="cirruscape-logo">
      <span className="cirruscape-logo__mark" aria-hidden="true">
        ☁
      </span>
      <span className="cirruscape-logo__name">Cirruscape</span>
    </span>
  );
}

export function AboutPage() {
  return (
    <main className="landing">
      <section className="hero">
        <div className="container">
          <span className="hero__badge">About</span>
          <h1>
            Live trivia, written by AI, <span className="hero__accent">built in The Cloud</span>
          </h1>
          <p className="hero__lead">
            Trivolt is a project demonstrating the design and implementation of a live, AI-powered
            trivia game in The Cloud, using Cloud Native and serverless best practices.
          </p>
          <div className="hero__actions">
            <Link className="cta cta--primary" to="/play">
              Join a game
            </Link>
            <a className="cta cta--secondary" href="https://cirruscape.com">
              Visit Cirruscape
            </a>
          </div>
        </div>
      </section>

      <section className="section" aria-labelledby="about-what">
        <div className="container">
          <h2 id="about-what" className="section__title">
            What Trivolt does
          </h2>
          <p className="section__subtitle">
            A quiz night that runs itself: one host, a room full of phones, and questions on any
            topic.
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

      <section className="section section--alt" aria-labelledby="about-people">
        <div className="container">
          <h2 id="about-people" className="section__title">
            The people behind it
          </h2>
          <p className="section__subtitle">
            An independent project, designed and built by Cirruscape.
          </p>
          <div className="tiles tiles--two">
            <article className="tile">
              <div className="about-person">
                <div className="about-person__avatar" aria-hidden="true">
                  BC
                </div>
                <div>
                  <h3>Bryce Cummock</h3>
                  <p className="about-person__role">Contributor · AWS Community Builder</p>
                </div>
              </div>
              <p>
                Over 25 years of Architecture, DevOps and Development experience in both start-ups
                and large organisations within New Zealand, UK and Europe. Ideas included here are
                his own.
              </p>
            </article>

            <article className="tile tile--brand">
              <a
                className="tile__logo"
                href="https://cirruscape.com"
                aria-label="Cirruscape (cirruscape.com)"
              >
                <CirruscapeLogo />
              </a>
              <p>
                Practical, hands-on AWS learning, from your first S3 bucket to production-grade
                serverless architectures. Built for curious engineers who learn by doing.
              </p>
              <a className="tile__more" href="https://cirruscape.com">
                Visit cirruscape.com <span aria-hidden="true">→</span>
              </a>
            </article>
          </div>
        </div>
      </section>

      <section className="closing" aria-labelledby="about-contact">
        <div className="container">
          <h2 id="about-contact">Get in touch</h2>
          <p>For further information, please get in touch:</p>
          <a className="cta cta--primary" href="mailto:bryce@cirruscape.com">
            bryce@cirruscape.com
          </a>
        </div>
      </section>
    </main>
  );
}
