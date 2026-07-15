import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '../api.js';
import ModelSelect from '../components/ModelSelect.jsx';

function InstallConfirm({ skill, isUpdate, onClose, onInstalled }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const install = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = isUpdate ? await api.installUpdate(skill.id) : await api.installSkill(skill.id);
      onInstalled(r);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };

  return (
    <motion.div
      className="editor-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <motion.div
        className="editor glass install-modal"
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
      >
        <div className="editor-head">
          <h2>{isUpdate ? 'Update' : 'Install'} · {skill.name}</h2>
          <span className="muted mono">{skill.url}</span>
        </div>
        <p className="confirm-warning">
          ⚠ This downloads {skill.files} file{skill.files === 1 ? '' : 's'} from{' '}
          <span className="mono">{skill.repo}</span> into{' '}
          <span className="mono">~/.claude/skills/{skill.id}/</span>
          {isUpdate ? ', OVERWRITING your installed copy (local edits will be lost)' : ''}. Review
          the source on GitHub before installing third-party content.
        </p>
        <p className="install-desc">{skill.description}</p>
        {error && <p className="error-text">⚠ {error}</p>}
        <div className="editor-actions">
          <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn btn-primary" onClick={install} disabled={busy}>
            {busy ? 'Downloading…' : isUpdate ? 'Confirm update' : 'Confirm install'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function AiScout() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [topic, setTopic] = useState('');
  const [model, setModel] = useState('haiku');
  const timer = React.useRef(null);

  const load = async () => {
    try {
      const d = await api.suggestions();
      setData(d);
      setError(null);
      // poll while a scan is in flight
      if (d.status === 'running') timer.current = setTimeout(load, 4000);
    } catch (e) {
      setError(e.message);
    }
  };

  useEffect(() => {
    load();
    return () => clearTimeout(timer.current);
  }, []);

  const scan = async () => {
    try {
      await api.startScan(topic, model);
      load();
    } catch (e) {
      setError(e.message);
    }
  };

  const running = data?.status === 'running';

  return (
    <div className="scout glass">
      <div className="scout-head">
        <h3 className="scout-title">
          AI Scout
          {running && <span className="scout-spinner" />}
        </h3>
        <span className="muted scout-note">
          Uses your Claude Code + web search — each scan spends quota.
          {data?.scannedAt &&
            ` Last scan${data.topic ? ` (“${data.topic}”)` : ''}${data.model ? ` on ${data.model}` : ''}: ${new Date(data.scannedAt).toLocaleString()}.`}
        </span>
        <ModelSelect value={model} onChange={setModel} disabled={running} />
        <div className="search-box scout-topic">
          <span className="search-icon">◎</span>
          <input
            className="search-input"
            type="text"
            placeholder="Topic — e.g. pdf, testing, git…"
            value={topic}
            maxLength={60}
            onChange={(e) => setTopic(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !running) scan(); }}
            disabled={running}
            spellCheck={false}
          />
        </div>
        <button className="btn btn-primary" onClick={scan} disabled={running}>
          {running
            ? `Scanning${data?.topic ? ` “${data.topic}”` : ''}…`
            : topic.trim()
              ? `Scan “${topic.trim()}”`
              : 'Scan for new skills'}
        </button>
      </div>
      {error && <p className="error-text">⚠ {error}</p>}
      {data?.error && !running && <p className="error-text">⚠ Last scan failed: {data.error}</p>}
      {data?.suggestions?.length > 0 && (
        <div className="scout-grid">
          {data.suggestions.map((s, i) => (
            <motion.div
              key={s.url + i}
              className="scout-card"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
            >
              <span className="skill-name">{s.name}</span>
              <p className="skill-desc">{s.description}</p>
              {s.reason && <p className="scout-reason">◈ {s.reason}</p>}
              <a className="btn btn-mini source-link" href={s.url} target="_blank" rel="noreferrer">
                View source
              </a>
            </motion.div>
          ))}
        </div>
      )}
      {data && !running && !data.suggestions?.length && !data.error && (
        <p className="muted">No suggestions yet — run a scan to let the scout hunt for skills.</p>
      )}
    </div>
  );
}

export default function Marketplace() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');
  const [installing, setInstalling] = useState(null);
  const [flash, setFlash] = useState(null);

  const load = () => {
    api.marketplace()
      .then(setData)
      .catch((e) => setError(e.message));
  };
  useEffect(load, []);

  if (error && !data) return <div className="panel glass error-text">⚠ {error}</div>;
  if (!data) return <div className="panel glass muted">Contacting skill registry…</div>;

  if (!data.available) {
    return (
      <div className="panel glass offline-panel">
        <p className="error-text">◌ marketplace offline</p>
        <p className="muted">
          Could not reach the skill registry ({data.error}). Check your connection — the
          catalog will load next time you open this tab.
        </p>
      </div>
    );
  }

  const q = query.trim().toLowerCase();
  const visible = q
    ? data.skills.filter((s) =>
        [s.name, s.description, s.id].join(' ').toLowerCase().includes(q)
      )
    : data.skills;

  return (
    <div className="skills-view">
      <div className="view-head">
        <h2 className="view-title">
          Marketplace{' '}
          <span className="count-chip">
            {q ? `${visible.length}/${data.skills.length}` : data.skills.length}
          </span>
        </h2>
        <span className="badge badge-personal mono">source: {data.repo}</span>
        <div className="search-box">
          <span className="search-icon">⌕</span>
          <input
            className="search-input"
            type="search"
            placeholder="Search registry…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            spellCheck={false}
          />
        </div>
        {flash && <span className="flash-msg">{flash}</span>}
      </div>
      <AiScout />
      {visible.length === 0 && (
        <div className="panel glass muted">No marketplace skills match “{query}”.</div>
      )}
      <div className="skills-grid">
        {visible.map((s) => (
          <motion.div
            key={s.id}
            className="skill-card glass on"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <div className="skill-top">
              <span className="skill-name">{s.name}</span>
              {s.installed && s.updateAvailable ? (
                <button
                  className="btn btn-mini btn-update"
                  onClick={() => setInstalling({ ...s, isUpdate: true })}
                >
                  Update available
                </button>
              ) : s.installed ? (
                <span className="badge badge-active">Installed</span>
              ) : (
                <button className="btn btn-mini btn-primary" onClick={() => setInstalling(s)}>
                  Install
                </button>
              )}
            </div>
            <p className="skill-desc">{s.description}</p>
            <div className="skill-meta">
              <span className="badge badge-project">{s.files} files</span>
              <a className="btn btn-mini source-link" href={s.url} target="_blank" rel="noreferrer">
                Source
              </a>
            </div>
          </motion.div>
        ))}
      </div>
      <AnimatePresence>
        {installing && (
          <InstallConfirm
            skill={installing}
            isUpdate={Boolean(installing.isUpdate)}
            onClose={() => setInstalling(null)}
            onInstalled={(r) => {
              setInstalling(null);
              setFlash(`✓ ${r.id} ${r.updated ? 'updated' : 'installed'} (${r.files.length} files)`);
              setTimeout(() => setFlash(null), 5000);
              load();
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
