// The header and footer around every page, in Cirruscape's style (https://cirruscape.com):
// AWS navy, with an orange accent.
import type { ReactNode } from 'react';
import { Link } from 'react-router';

export function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="site">
      <header className="site-header">
        <nav className="site-header__inner" aria-label="Site">
          <Link className="site-header__title" to="/">
            Trivolt
          </Link>
        </nav>
      </header>
      <div className="site-main">{children}</div>
      <footer className="site-footer">
        <p>Copyright © 2026 Cirruscape</p>
      </footer>
    </div>
  );
}
