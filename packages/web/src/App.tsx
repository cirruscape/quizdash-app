import { Link, Route, Routes } from 'react-router';

// Three areas (PRD §6): Host authoring and Game control under /host, Player play under /play.
export function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/host/*" element={<h1>Host</h1>} />
      <Route path="/play/*" element={<h1>Join a Game</h1>} />
    </Routes>
  );
}

function Home() {
  return (
    <main>
      <h1>Quiz App</h1>
      <p>
        <Link to="/play">Join a Game</Link> · <Link to="/host">Host sign in</Link>
      </p>
    </main>
  );
}
