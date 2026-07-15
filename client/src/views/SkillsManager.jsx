import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '../api.js';
import ModelSelect from '../components/ModelSelect.jsx';

const SKILL_TEMPLATE = `---
name: my-skill
description: What this skill does and when Claude should use it (include trigger phrases).
---

# My skill

Step-by-step instructions for Claude when this skill is active.

## Example

Show one concrete input → output example here.
`;

function NewSkillModal({ onClose, onCreated }) {
  const [mode, setMode] = useState('manual'); // 'manual' | 'ai'
  const [name, setName] = useState('');
  const [content, setContent] = useState(SKILL_TEMPLATE);
  const [description, setDescription] = useState('');
  const [model, setModel] = useState('haiku');
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState(null);
  const [generatedBy, setGeneratedBy] = useState(null);

  const nameOk = /^[a-z0-9][a-z0-9-]{1,63}$/.test(name);

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.generateSkill(description, model);
      setName(r.name);
      setContent(r.content);
      setGeneratedBy(r.model);
      setMode('manual'); // land in the review/edit form — nothing written yet
    } catch (e) {
      setError(e.message);
    }
    setBusy(false);
  };

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.createSkill(name, content);
      onCreated(r);
    } catch (e) {
      setError(e.message);
      setBusy(false);
      setConfirming(false);
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
        className="editor glass"
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
      >
        <div className="editor-head">
          <h2>New skill</h2>
          <div className="mode-tabs">
            <button
              className={`btn btn-mini ${mode === 'manual' ? 'mode-active' : ''}`}
              onClick={() => setMode('manual')}
              disabled={busy}
            >
              Write manually
            </button>
            <button
              className={`btn btn-mini ${mode === 'ai' ? 'mode-active' : ''}`}
              onClick={() => setMode('ai')}
              disabled={busy}
            >
              Generate with AI
            </button>
          </div>
        </div>
        {error && <p className="error-text">⚠ {error}</p>}

        {mode === 'ai' ? (
          <>
            <p className="muted new-skill-hint">
              Describe the skill you want — what it should do and when Claude should use it.
              The draft lands in the editor for your review; nothing is saved until you confirm.
            </p>
            <textarea
              className="editor-textarea advisor-textarea"
              placeholder="e.g. a skill that reviews my React components for accessibility problems…"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={busy}
              spellCheck={false}
            />
            <div className="editor-actions advisor-actions">
              <ModelSelect value={model} onChange={setModel} disabled={busy} />
              <div className="editor-actions-right">
                <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
                <button className="btn btn-primary" onClick={generate} disabled={busy || !description.trim()}>
                  {busy ? <span className="scout-spinner inline-spinner" /> : null}
                  {busy ? ' Generating…' : 'Generate draft'}
                </button>
              </div>
            </div>
          </>
        ) : confirming ? (
          <>
            <p className="confirm-warning">
              ⚠ This will create <span className="mono">~/.claude/skills/{name}/SKILL.md</span> on disk.
            </p>
            <pre className="diff new-skill-preview">{content}</pre>
            <div className="editor-actions">
              <button className="btn" onClick={() => setConfirming(false)} disabled={busy}>Back</button>
              <button className="btn btn-primary" onClick={create} disabled={busy}>
                {busy ? 'Creating…' : 'Confirm create'}
              </button>
            </div>
          </>
        ) : (
          <>
            <label className="new-skill-name">
              <span className="muted">Skill name (kebab-case)</span>
              <input
                className="search-input advisor-answer"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="my-new-skill"
                disabled={busy}
                spellCheck={false}
              />
              {name && !nameOk && (
                <span className="error-text name-hint">lowercase letters, digits and dashes only</span>
              )}
            </label>
            {generatedBy && (
              <p className="muted new-skill-hint">Draft generated with {generatedBy} — review and edit before saving.</p>
            )}
            <textarea
              className="editor-textarea"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              disabled={busy}
              spellCheck={false}
            />
            <div className="editor-actions">
              <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
              <button
                className="btn btn-primary"
                onClick={() => setConfirming(true)}
                disabled={busy || !nameOk || !content.trim()}
              >
                Review & create
              </button>
            </div>
          </>
        )}
      </motion.div>
    </motion.div>
  );
}

// Simple line diff (LCS) for the save-confirmation view.
function lineDiff(a, b) {
  const A = a.split('\n');
  const B = b.split('\n');
  const dp = Array.from({ length: A.length + 1 }, () => new Array(B.length + 1).fill(0));
  for (let i = A.length - 1; i >= 0; i--)
    for (let j = B.length - 1; j >= 0; j--)
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = [];
  let i = 0, j = 0;
  while (i < A.length && j < B.length) {
    if (A[i] === B[j]) { out.push({ t: ' ', line: A[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ t: '-', line: A[i] }); i++; }
    else { out.push({ t: '+', line: B[j] }); j++; }
  }
  while (i < A.length) out.push({ t: '-', line: A[i++] });
  while (j < B.length) out.push({ t: '+', line: B[j++] });
  return out;
}

function DiffView({ original, edited }) {
  const diff = lineDiff(original, edited).filter((d, idx, arr) => {
    if (d.t !== ' ') return true;
    // keep 2 lines of context around changes
    return arr.slice(Math.max(0, idx - 2), idx + 3).some((x) => x.t !== ' ');
  });
  if (!diff.some((d) => d.t !== ' ')) return <p className="muted">No changes.</p>;
  return (
    <pre className="diff">
      {diff.map((d, i) => (
        <div key={i} className={d.t === '+' ? 'diff-add' : d.t === '-' ? 'diff-del' : 'diff-ctx'}>
          {d.t} {d.line}
        </div>
      ))}
    </pre>
  );
}

function Editor({ skill, onClose, onSaved }) {
  const [original, setOriginal] = useState(null);
  const [text, setText] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.readSkill(skill.id)
      .then(({ content }) => { setOriginal(content); setText(content); })
      .catch((e) => setError(e.message));
  }, [skill.id]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.writeSkill(skill.id, text);
      onSaved();
    } catch (e) {
      setError(e.message);
      setSaving(false);
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
        className="editor glass"
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
      >
        <div className="editor-head">
          <h2>Edit · {skill.name}</h2>
          <span className="muted mono">{skill.file}</span>
        </div>
        {error && <p className="error-text">⚠ {error}</p>}
        {original === null && !error ? (
          <p className="muted">Loading…</p>
        ) : confirming ? (
          <>
            <p className="confirm-warning">
              ⚠ You are about to overwrite the skill file on disk. Review the changes:
            </p>
            <DiffView original={original} edited={text} />
            <div className="editor-actions">
              <button className="btn" onClick={() => setConfirming(false)}>Back to editor</button>
              <button className="btn btn-danger" disabled={saving || text === original} onClick={save}>
                {saving ? 'Writing…' : 'Confirm write to disk'}
              </button>
            </div>
          </>
        ) : (
          <>
            <textarea
              className="editor-textarea"
              value={text}
              onChange={(e) => setText(e.target.value)}
              spellCheck={false}
            />
            <div className="editor-actions">
              <button className="btn" onClick={onClose}>Cancel</button>
              <button
                className="btn btn-primary"
                disabled={text === original}
                onClick={() => setConfirming(true)}
              >
                Review & save
              </button>
            </div>
          </>
        )}
      </motion.div>
    </motion.div>
  );
}

function DeleteConfirm({ skill, onClose, onDeleted }) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const match = typed === skill.id;

  const del = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.deleteSkill(skill.id);
      onDeleted();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };

  return (
    <motion.div className="editor-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.div
        className="editor glass delete-modal"
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
      >
        <div className="editor-head">
          <h2>Delete skill</h2>
        </div>
        <p className="confirm-warning">
          ⚠ This permanently deletes <span className="mono">~/.claude/skills/{skill.id}/</span> from
          disk. This cannot be undone from the dashboard.
        </p>
        <p className="muted delete-hint">
          Type the skill name <span className="mono delete-name">{skill.id}</span> to confirm:
        </p>
        <input
          className="search-input advisor-answer"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder={skill.id}
          disabled={busy}
          spellCheck={false}
          autoFocus
        />
        {error && <p className="error-text">⚠ {error}</p>}
        <div className="editor-actions">
          <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn btn-danger" onClick={del} disabled={busy || !match}>
            {busy ? 'Deleting…' : 'Delete permanently'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

export default function SkillsManager() {
  const [skills, setSkills] = useState(null);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(null);
  const [flash, setFlash] = useState(null);
  const [query, setQuery] = useState('');
  const [usage, setUsage] = useState({});
  const [conflicts, setConflicts] = useState([]);
  const [conflictsOpen, setConflictsOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState(null);

  const load = () => {
    api.listSkills()
      .then(({ skills }) => setSkills(skills))
      .catch((e) => setError(e.message));
    api.skillUsage().then((r) => setUsage(r.usage || {})).catch(() => {});
    api.skillConflicts().then((r) => setConflicts(r.conflicts || [])).catch(() => {});
  };
  useEffect(load, []);

  const toggle = async (skill) => {
    // optimistic UI, revert on failure. The server physically moves the skill
    // dir in/out of skills-disabled/, so reload afterward to reflect truth.
    setSkills((s) => s.map((x) => (x.id === skill.id ? { ...x, enabled: !x.enabled } : x)));
    try {
      await api.setSkillState(skill.id, !skill.enabled);
      load();
    } catch (e) {
      setSkills((s) => s.map((x) => (x.id === skill.id ? { ...x, enabled: skill.enabled } : x)));
      setError(e.message);
    }
  };

  if (error && !skills) return <div className="panel glass error-text">⚠ {error}</div>;
  if (!skills) return <div className="panel glass muted">Scanning skill banks…</div>;

  const q = query.trim().toLowerCase();
  const visible = q
    ? skills.filter((s) =>
        [s.name, s.description, s.source, s.id].join(' ').toLowerCase().includes(q)
      )
    : skills;

  return (
    <div className="skills-view">
      <div className="view-head">
        <h2 className="view-title">
          Skills{' '}
          <span className="count-chip">{q ? `${visible.length}/${skills.length}` : skills.length}</span>
        </h2>
        <div className="search-box">
          <span className="search-icon">⌕</span>
          <input
            className="search-input"
            type="search"
            placeholder="Search skills…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            spellCheck={false}
          />
        </div>
        <button className="btn btn-primary" onClick={() => setCreating(true)}>
          + New skill
        </button>
        {flash && <span className="flash-msg">{flash}</span>}
        {error && <span className="error-text">⚠ {error}</span>}
      </div>
      {conflicts.length > 0 && (
        <div className="collapse-panel glass conflicts-panel">
          <button className="collapse-head" onClick={() => setConflictsOpen(!conflictsOpen)}>
            <span className="collapse-title">
              Possible conflicts <span className="count-chip">{conflicts.length}</span>
            </span>
            <span className="muted mono">{conflictsOpen ? 'collapse' : 'expand'}</span>
          </button>
          {conflictsOpen && (
            <div className="conflicts-list">
              {conflicts.map((c) => (
                <div key={`${c.a}|${c.b}`} className="conflict-row">
                  <span className="conflict-pair mono">
                    {c.a} <span className="muted">×</span> {c.b}
                  </span>
                  <span className="badge">{Math.round(c.score * 100)}% overlap</span>
                  <span className="conflict-terms muted">{c.overlap.join(', ')}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {visible.length === 0 && (
        <div className="panel glass muted">No skills match “{query}”.</div>
      )}
      <div className="skills-grid">
        {visible.map((s) => (
          <motion.div
            key={s.id}
            className={`skill-card glass ${s.enabled ? 'on' : 'off'}`}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <div className="skill-top">
              <span className="skill-name">{s.name}</span>
              <button
                className={`toggle ${s.enabled ? 'toggle-on' : ''}`}
                title={
                  s.enabled
                    ? 'Disable — moves out of ~/.claude/skills so Claude stops loading it'
                    : 'Enable — moves back into ~/.claude/skills'
                }
                onClick={() => toggle(s)}
              >
                <span className="toggle-knob" />
              </button>
            </div>
            <p className="skill-desc">{s.description}</p>
            <div className="skill-meta">
              <span className={`badge badge-${s.source}`}>{s.source}</span>
              <span className={`badge ${s.enabled ? 'badge-active' : 'badge-inactive'}`}>
                {s.enabled ? 'Enabled' : 'Disabled'}
              </span>
              {usage[s.id] > 0 && (
                <span className="badge badge-usage" title="Mentions in current ruflo agent logs">
                  used {usage[s.id]}x
                </span>
              )}
              {s.editable && (
                <button className="btn btn-mini" onClick={() => setEditing(s)}>
                  Edit
                </button>
              )}
              {s.editable && (
                <button
                  className="btn btn-mini btn-danger delete-btn"
                  title="Delete this skill"
                  onClick={() => setDeleting(s)}
                >
                  Delete
                </button>
              )}
            </div>
          </motion.div>
        ))}
      </div>
      <AnimatePresence>
        {editing && (
          <Editor
            skill={editing}
            onClose={() => setEditing(null)}
            onSaved={() => {
              setEditing(null);
              setFlash(`✓ ${editing.name} written to disk`);
              setTimeout(() => setFlash(null), 4000);
              load();
            }}
          />
        )}
        {creating && (
          <NewSkillModal
            onClose={() => setCreating(false)}
            onCreated={(r) => {
              setCreating(false);
              setFlash(`✓ ${r.id} created`);
              setTimeout(() => setFlash(null), 4000);
              load();
            }}
          />
        )}
        {deleting && (
          <DeleteConfirm
            skill={deleting}
            onClose={() => setDeleting(null)}
            onDeleted={() => {
              setFlash(`✓ ${deleting.id} deleted`);
              setDeleting(null);
              setTimeout(() => setFlash(null), 4000);
              load();
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
