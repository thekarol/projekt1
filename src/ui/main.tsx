// Entry point of the bundle. The only UI file that knows which repository implementation is used.

import { createRoot } from 'react-dom/client';
import baseline from '../../tests/vectors/pricing-baseline.json';
import scenarios from '../../tests/vectors/pricing-scenarios.json';
import { MemoryRepository } from '../data/memory.ts';
import seed from '../data/seed/skybike.json';
import { Shell } from './app.tsx';
import { AppProvider } from './store.tsx';
import './ui.css';

const host = document.querySelector<HTMLElement>('[data-rental-app]');
if (host) {
  host.classList.add('rental-app');
  const repo = new MemoryRepository(seed as any);
  createRoot(host).render(
    <AppProvider repo={repo} assets={host.dataset.assets ?? 'assets/'} vectors={{ baseline, scenarios }}>
      <Shell />
    </AppProvider>,
  );
}
