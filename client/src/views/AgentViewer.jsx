import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '../api.js';
import AgentTree from '../components/AgentTree.jsx';

const POLL_MS = 7000;

function LogPanel({ agent, onClose }) {
  const [logs, setLogs] = useState(null);

  useEffect(() => {
    let alive = true;
    setLogs(null);
    api.agentLogs(agent.id)
      .then((r) => alive && setLogs(r.logs))
      .catch((e) => alive && setLogs(`Failed to fetch logs: ${e.message}`));
    return () => { alive = false; };
  }, [agent.id]);

  return (
    <motion.aside
      className="log-panel glass"
      initial={{ x: 60, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 60, opacity: 0 }}
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
    >
      <div className="log-head">
        <h3>{agent.name}</h3>
        <button className="btn btn-mini" onClick={onClose}>✕</button>
      </div>
      <div className="log-meta">
        <span className={`badge badge-${agent.source}`}>{agent.source}</span>
        <span className={`badge text-${agent.status}`}>{agent.status.toUpperCase()}</span>
        <span className="muted mono">{agent.role}</span>
      </div>
      {agent.task && (
        <p className="log-task">
          <span className="muted">Current task: </span>{agent.task}
        </p>
      )}
      <pre className="log-body">{logs === null ? 'Fetching logs…' : logs}</pre>
    </motion.aside>
  );
}

export default function AgentViewer() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);
  const [snapshots, setSnapshots] = useState([]);
  const [replayIndex, setReplayIndex] = useState(null); // null = live mode
  const timer = useRef(null);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const d = await api.agents();
        if (alive) { setData(d); setError(null); }
        const h = await api.agentHistory(Date.now() - 2 * 60 * 60 * 1000);
        if (alive) setSnapshots(h.snapshots);
      } catch (e) {
        if (alive) setError(e.message);
      }
      if (alive) timer.current = setTimeout(poll, POLL_MS);
    };
    poll();
    return () => { alive = false; clearTimeout(timer.current); };
  }, []);

  const replaying = replayIndex !== null && snapshots[replayIndex];
  const shown = replaying ? snapshots[replayIndex].tree : data;

  if (!data && !error) return <div className="panel glass muted">Establishing uplink…</div>;
  if (error && !data) return <div className="panel glass error-text">⚠ Backend unreachable: {error}</div>;

  const selectedAgent = (replaying ? [] : data.agents).find((a) => a.id === selected) || null;

  return (
    <div className="agents-view">
      <div className="view-head">
        <h2 className="view-title">
          Agents{' '}
          <span className="count-chip">{data.agents.length}</span>
        </h2>
        <span className={`badge ${data.detected ? 'badge-active' : 'badge-inactive'}`}>
          {data.detected ? 'claude-flow linked' : 'claude-flow not detected'}
        </span>
        <span className={`badge ${data.swarm?.active ? 'badge-active' : ''}`}>
          {data.swarm?.active ? 'Swarm active' : 'No active swarm'}
        </span>
        {replaying && (
          <span className="badge badge-replay">
            Replay · {new Date(snapshots[replayIndex].timestamp).toLocaleTimeString()}
          </span>
        )}
        <span className="muted mono poll-note">
          {replaying ? '⏸ live polling display paused' : `⟳ auto-refresh ${POLL_MS / 1000}s`}
          {error ? ` · last poll failed: ${error}` : ''}
        </span>
      </div>

      {!data.detected && data.agents.length === 0 ? (
        <div className="panel glass offline-panel">
          <p className="error-text">◌ claude-flow not detected</p>
          <p className="muted">
            The ruflo CLI did not respond. Install it or start a swarm, and this view will pick
            it up on the next refresh.
          </p>
        </div>
      ) : data.agents.length === 0 ? (
        <div className="panel glass offline-panel">
          <p className="muted">No agents currently registered. The core is standing by — spawn
          agents via ruflo or Claude Code and they will appear here.</p>
          <AgentTree agents={[]} swarm={data.swarm} selected={null} onSelect={() => {}} />
        </div>
      ) : (
        <>
          <div className={`tree-wrap ${replaying ? 'tree-replay' : ''}`}>
            <AgentTree
              agents={shown.agents}
              swarm={shown.swarm}
              selected={selected}
              onSelect={(id) => setSelected(id === selected ? null : id)}
            />
            <AnimatePresence>
              {selectedAgent && (
                <LogPanel agent={selectedAgent} onClose={() => setSelected(null)} />
              )}
            </AnimatePresence>
          </div>
          {snapshots.length > 1 && (
            <div className="replay-bar glass">
              <span className="mono replay-label">
                {replaying ? '◂◂ Replay' : '● Live'}
              </span>
              <input
                type="range"
                className="replay-slider"
                min={0}
                max={snapshots.length - 1}
                value={replayIndex ?? snapshots.length - 1}
                onChange={(e) => { setReplayIndex(Number(e.target.value)); setSelected(null); }}
              />
              <span className="muted mono replay-time">
                {new Date(
                  (replaying ? snapshots[replayIndex] : snapshots[snapshots.length - 1]).timestamp
                ).toLocaleTimeString()}
              </span>
              {replaying && (
                <button className="btn btn-mini btn-primary" onClick={() => setReplayIndex(null)}>
                  Back to live
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
