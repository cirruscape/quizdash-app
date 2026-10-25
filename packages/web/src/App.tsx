import { lazy, Suspense } from 'react';
import { Link, Route, Routes } from 'react-router';
import { Page } from './components.js';
import { JoinPage } from './play/JoinPage.js';
import { PlayerGame } from './play/PlayerGame.js';

// The Host area (with Amplify's sign-in UI) loads only when needed, so Players' phones never
// download it.
const HostApp = lazy(() => import('./host/HostApp.js').then((m) => ({ default: m.HostApp })));

// Three areas (PRD §6): Host authoring and Game control under /host, Player play under /play.
export function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/play" element={<JoinPage />} />
      <Route path="/play/game" element={<PlayerGame />} />
      <Route
        path="/host/*"
        element={
          <Suspense fallback={<Page>Loading…</Page>}>
            <HostApp />
          </Suspense>
        }
      />
      <Route path="*" element={<Home />} />
    </Routes>
  );
}

function Home() {
  return (
    <Page title="Quiz App">
      <p className="muted">Live trivia: the host runs the game, everyone plays on their phone.</p>
      <div className="stack">
        <Link className="button button--primary" to="/play">
          Join a game
        </Link>
        <Link className="button" to="/host">
          Host a game
        </Link>
      </div>
    </Page>
  );
}
