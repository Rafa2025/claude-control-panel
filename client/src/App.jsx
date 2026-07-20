import React, { useEffect, useState } from 'react';
import SkillsManager from './views/SkillsManager.jsx';
import AgentViewer from './views/AgentViewer.jsx';
import Marketplace from './views/Marketplace.jsx';
import AdvisorView from './views/AdvisorView.jsx';
import { api } from './api.js';

function TokenCounter() {
  const [usage, setUsage] = useState(null);
  useEffect(() => {
    let alive = true;
    const poll = () =>
      api.usage().then((u) => alive && setUsage(u)).catch(() => {});
    poll();
    const t = setInterval(poll, 15000);
    return () => { alive = false; clearInterval(t); };
  }, []);
  if (!usage || usage.callCount === 0) return null;
  const total = usage.inputTokens + usage.outputTokens;
  return (
    <span
      className="token-counter mono"
      title={`AI calls this server session: ${usage.callCount} (${usage.inputTokens} in / ${usage.outputTokens} out)`}
    >
      ~{total.toLocaleString()} tokens this session
    </span>
  );
}

const HEALTH_LABELS = {
  ruflo: { ok: 'ruflo CLI responding', error: 'ruflo CLI not responding' },
  credentials: {
    ok: 'Claude CLI credentials valid',
    expired: 'Claude CLI credentials EXPIRED — run `claude login`',
    unknown: 'Claude CLI credentials state unknown',
  },
  ports: { ok: 'API + client ports serving', error: 'client port 5173 not responding' },
};

function healthClass(v) {
  if (v === 'ok') return 'dot-ok';
  if (v === 'expired' || v === 'error') return 'dot-error';
  return 'dot-warn';
}

// Short chip label per check + the status word shown when it isn't "ok".
const HEALTH_META = {
  ruflo: { label: 'ruflo' },
  credentials: { label: 'auth' },
  ports: { label: 'server' },
};

function statusWord(v) {
  if (v === 'ok') return 'OK';
  if (v === 'expired') return 'expired';
  if (v === 'error') return 'down';
  return '?';
}

function HealthStrip() {
  const [health, setHealth] = useState(null);
  useEffect(() => {
    let alive = true;
    const poll = () =>
      api.health().then((h) => alive && setHealth(h)).catch(() => alive && setHealth(null));
    poll();
    const t = setInterval(poll, 30000);
    return () => { alive = false; clearInterval(t); };
  }, []);
  if (!health) return null;
  return (
    <span className="health-strip" title="System status — hover a chip for details">
      {['ruflo', 'credentials', 'ports'].map((k) => (
        <span
          key={k}
          className={`health-chip ${healthClass(health[k])}`}
          title={`${HEALTH_META[k].label.toUpperCase()}: ${HEALTH_LABELS[k][health[k]] || health[k]}`}
        >
          <span className="health-dot" />
          <span className="health-label">{HEALTH_META[k].label}</span>
          {health[k] !== 'ok' && <span className="health-status">{statusWord(health[k])}</span>}
        </span>
      ))}
    </span>
  );
}

function ThemeToggle() {
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem('ccp-theme');
    if (saved === 'light' || saved === 'dark') return saved;
    // first visit: follow the OS preference
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('ccp-theme', theme);
  }, [theme]);

  const dark = theme === 'dark';
  return (
    <button
      className="theme-toggle"
      title={dark ? 'Switch to light theme' : 'Switch to dark theme'}
      aria-label="Toggle theme"
      onClick={() => setTheme(dark ? 'light' : 'dark')}
    >
      {dark ? '☀' : '☾'}
    </button>
  );
}

export default function App() {
  const [view, setView] = useState('skills');
  return (
    <div className="app">
      <header className="app-header glass">
        <h1 className="app-title">
          <span className="title-bracket">✳</span> Claude Control Panel
        </h1>
        <div className="nav-meta">
          <TokenCounter />
          <HealthStrip />
          <ThemeToggle />
        </div>
        <nav className="nav">
          <button
            className={`nav-btn ${view === 'skills' ? 'active' : ''}`}
            onClick={() => setView('skills')}
          >
            Skills
          </button>
          <button
            className={`nav-btn ${view === 'market' ? 'active' : ''}`}
            onClick={() => setView('market')}
          >
            Marketplace
          </button>
          <button
            className={`nav-btn ${view === 'advisor' ? 'active' : ''}`}
            onClick={() => setView('advisor')}
          >
            AI Advisor
          </button>
          <button
            className={`nav-btn ${view === 'agents' ? 'active' : ''}`}
            onClick={() => setView('agents')}
          >
            Agents
          </button>
        </nav>
      </header>
      <main className="app-main">
        {view === 'skills' ? (
          <SkillsManager />
        ) : view === 'market' ? (
          <Marketplace />
        ) : view === 'advisor' ? (
          <AdvisorView />
        ) : (
          <AgentViewer />
        )}
      </main>
    </div>
  );
}
