import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { App } from './App.js';
import { loadConfig } from './config.js';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('missing #root element');

try {
  await loadConfig();
  createRoot(root).render(
    <StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </StrictMode>,
  );
} catch (err) {
  root.textContent = 'Quiz App couldn’t start. Please reload the page.';
  console.error(err);
}
