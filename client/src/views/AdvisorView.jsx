import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '../api.js';
import ModelSelect from '../components/ModelSelect.jsx';

function CopyButton({ text, label = 'Copy' }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="btn btn-mini"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          // headless / permission fallback
          const ta = document.createElement('textarea');
          ta.value = text;
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          ta.remove();
        }
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      {copied ? 'Copied ✓' : label}
    </button>
  );
}

function HistoryPanel({ refreshKey, onLoad, onRerun }) {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState([]);

  // Braces matter: returning the promise from useEffect makes React treat it
  // as a cleanup function and crash on unmount.
  const load = () => {
    api.advisorHistory().then((r) => setEntries(r.entries)).catch(() => {});
  };
  useEffect(load, [refreshKey]);

  return (
    <div className="collapse-panel glass">
      <button className="collapse-head" onClick={() => setOpen(!open)}>
        <span className="collapse-title">History <span className="count-chip">{entries.length}</span></span>
        <span className="muted mono">{open ? 'collapse' : 'expand'}</span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            style={{ overflow: 'hidden' }}
          >
            {entries.length === 0 && <p className="muted history-empty">No saved prompts yet.</p>}
            {entries.map((e) => (
              <div key={e.id} className="history-row">
                <button className="history-load" title="Load into view" onClick={() => onLoad(e)}>
                  <span className="history-req">{e.request.slice(0, 90)}{e.request.length > 90 ? '…' : ''}</span>
                  <span className="muted mono">{new Date(e.timestamp).toLocaleString()}</span>
                </button>
                <button className="btn btn-mini" onClick={() => onRerun(e.request)}>Re-run</button>
                <button
                  className="btn btn-mini btn-danger"
                  onClick={async () => { await api.advisorHistoryDelete(e.id).catch(() => {}); load(); }}
                >
                  ✕
                </button>
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function AdvisorView() {
  const [request, setRequest] = useState('');
  const [model, setModel] = useState('haiku');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null); // {needsClarification, questions, recommendedSkills, draftPrompt}
  const [answers, setAnswers] = useState([]);
  const [historyKey, setHistoryKey] = useState(0);
  const [exportCmd, setExportCmd] = useState(null);

  const run = async (fn, ...args) => {
    setBusy(true);
    setError(null);
    setExportCmd(null);
    try {
      const r = await fn(...args);
      setResult(r);
      if (r.needsClarification) setAnswers(r.questions.map((q) => ({ question: q, answer: '' })));
      if (r.historyEntry) setHistoryKey((k) => k + 1);
    } catch (e) {
      setError(e.message);
    }
    setBusy(false);
  };

  const analyze = (text) => {
    setResult(null);
    run(api.advisorAnalyze, text ?? request, model);
  };
  const finalize = () => run(api.advisorFinalize, request, answers, model);

  const sendToClaudeCode = async () => {
    setError(null);
    try {
      const r = await api.advisorExport(result.draftPrompt);
      setExportCmd(r.command);
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <div className="advisor-view">
      <div className="view-head">
        <h2 className="view-title">AI Advisor</h2>
        <span className="muted scout-note">
          Describe what you want to do, get skill recommendations and a ready-to-paste
          prompt. Uses your Claude Code with the model you pick — each run spends quota.
        </span>
      </div>

      <div className="advisor-input glass">
        <textarea
          className="editor-textarea advisor-textarea"
          placeholder="What do you want to build or do? e.g. 'refactor my auth module and add tests'…"
          value={request}
          onChange={(e) => setRequest(e.target.value)}
          disabled={busy}
          spellCheck={false}
        />
        <div className="editor-actions advisor-actions">
          <ModelSelect value={model} onChange={setModel} disabled={busy} />
          <button className="btn btn-primary" onClick={() => analyze()} disabled={busy || !request.trim()}>
            {busy ? <span className="scout-spinner inline-spinner" /> : null}
            {busy ? ' Consulting…' : 'Analyze request'}
          </button>
        </div>
      </div>

      {error && <p className="error-text">⚠ {error}</p>}

      <AnimatePresence>
        {result?.needsClarification && (
          <motion.div
            className="advisor-questions glass"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
          >
            <h3 className="collapse-title">Clarifying questions</h3>
            {answers.map((a, i) => (
              <label key={i} className="advisor-q">
                <span className="advisor-q-text">{a.question}</span>
                <input
                  className="search-input advisor-answer"
                  value={a.answer}
                  onChange={(e) =>
                    setAnswers(answers.map((x, j) => (j === i ? { ...x, answer: e.target.value } : x)))
                  }
                  disabled={busy}
                  spellCheck={false}
                />
              </label>
            ))}
            <div className="editor-actions">
              <button
                className="btn btn-primary"
                onClick={finalize}
                disabled={busy || answers.some((a) => !a.answer.trim())}
              >
                {busy ? 'Finalizing…' : 'Finalize prompt'}
              </button>
            </div>
          </motion.div>
        )}

        {result && !result.needsClarification && result.draftPrompt && (
          <motion.div
            className="advisor-result glass"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
          >
            {result.recommendedSkills.length > 0 && (
              <div className="advisor-chips">
                <span className="muted mono">Recommended skills: </span>
                {result.recommendedSkills.map((s) => (
                  <span key={s} className="badge badge-personal">{s}</span>
                ))}
              </div>
            )}
            <pre className="log-body advisor-draft">{result.draftPrompt}</pre>
            <div className="editor-actions">
              <CopyButton text={result.draftPrompt} label="Copy prompt" />
              <button className="btn btn-primary" onClick={sendToClaudeCode}>
                Send to Claude Code
              </button>
            </div>
            {exportCmd && (
              <div className="export-row">
                <input className="search-input export-cmd mono" readOnly value={exportCmd} />
                <CopyButton text={exportCmd} label="Copy command" />
                <span className="muted mono export-note">run this in your terminal</span>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <HistoryPanel
        refreshKey={historyKey}
        onLoad={(e) => {
          setRequest(e.request);
          setResult({
            needsClarification: false,
            questions: [],
            recommendedSkills: e.recommendedSkills || [],
            draftPrompt: e.draftPrompt,
          });
          setExportCmd(null);
        }}
        onRerun={(req) => {
          setRequest(req);
          analyze(req);
        }}
      />
    </div>
  );
}
