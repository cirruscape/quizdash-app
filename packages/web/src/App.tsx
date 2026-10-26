import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router';
import { AboutPage } from './AboutPage.js';
import { Page } from './components.js';
import { HomePage } from './HomePage.js';
import { Layout } from './layout.js';
import { JoinPage } from './play/JoinPage.js';
import { PlayerGame } from './play/PlayerGame.js';

// The Host area (with Amplify's sign-in UI) loads only when needed, so Players' phones never
// download it.
const HostApp = lazy(() => import('./host/HostApp.js').then((m) => ({ default: m.HostApp })));

// Three areas (PRD §6): Host authoring and Game control under /host, Player play under /play.
// Every page shares the site header and footer.
export function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/about" element={<AboutPage />} />
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
        <Route path="*" element={<HomePage />} />
      </Routes>
    </Layout>
  );
}
