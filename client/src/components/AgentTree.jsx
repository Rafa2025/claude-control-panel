import React, { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const NODE_W = 176;
const NODE_H = 72;
const H_GAP = 36;
const V_GAP = 96;

// Tidy tree layout: x from cumulative leaf counts, y from depth.
function layout(agents) {
  const byId = new Map(agents.map((a) => [a.id, a]));
  const children = new Map();
  const roots = [];
  for (const a of agents) {
    if (a.parentId && byId.has(a.parentId) && a.parentId !== a.id) {
      if (!children.has(a.parentId)) children.set(a.parentId, []);
      children.get(a.parentId).push(a.id);
    } else {
      roots.push(a.id);
    }
  }
  const CORE = '__core__';
  children.set(CORE, roots);

  const leaves = new Map();
  const countLeaves = (id) => {
    const kids = children.get(id) || [];
    const n = kids.length ? kids.reduce((s, k) => s + countLeaves(k), 0) : 1;
    leaves.set(id, n);
    return n;
  };
  countLeaves(CORE);

  const pos = new Map();
  const place = (id, depth, offset) => {
    const span = leaves.get(id) * (NODE_W + H_GAP);
    pos.set(id, {
      x: offset + span / 2 - NODE_W / 2,
      y: depth * (NODE_H + V_GAP),
    });
    let cursor = offset;
    for (const kid of children.get(id) || []) {
      place(kid, depth + 1, cursor);
      cursor += leaves.get(kid) * (NODE_W + H_GAP);
    }
  };
  place(CORE, 0, 0);

  const edges = [];
  for (const [parent, kids] of children) {
    for (const kid of kids) edges.push({ from: parent, to: kid });
  }
  const width = leaves.get(CORE) * (NODE_W + H_GAP);
  const depthMax = Math.max(...[...pos.values()].map((p) => p.y));
  return { pos, edges, width, height: depthMax + NODE_H + 20, CORE };
}

function edgePath(from, to) {
  const x1 = from.x + NODE_W / 2;
  const y1 = from.y + NODE_H;
  const x2 = to.x + NODE_W / 2;
  const y2 = to.y;
  const my = (y1 + y2) / 2;
  return `M ${x1} ${y1} C ${x1} ${my}, ${x2} ${my}, ${x2} ${y2}`;
}

export default function AgentTree({ agents, swarm, selected, onSelect }) {
  const { pos, edges, width, height, CORE } = useMemo(() => layout(agents), [agents]);
  const byId = new Map(agents.map((a) => [a.id, a]));
  const coreLabel = swarm?.active ? 'Swarm core' : 'Control core';

  return (
    <div className="tree-scroll">
      <div className="tree-canvas" style={{ width, height }}>
        <svg className="tree-svg" width={width} height={height}>
          <defs>
            <filter id="edge-glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="3" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          {edges.map(({ from, to }) => {
            const p1 = pos.get(from);
            const p2 = pos.get(to);
            if (!p1 || !p2) return null;
            const running = byId.get(to)?.status === 'running';
            const d = edgePath(p1, p2);
            return (
              <g key={`${from}->${to}`}>
                <path className={`edge ${running ? 'edge-active' : ''}`} d={d} filter="url(#edge-glow)" />
                {running && (
                  <circle className="edge-pulse" r="4">
                    <animateMotion dur="1.6s" repeatCount="indefinite" path={d} />
                  </circle>
                )}
              </g>
            );
          })}
        </svg>

        {/* synthetic root */}
        <div className="node node-core glass" style={{ left: pos.get(CORE).x, top: pos.get(CORE).y }}>
          <span className="node-name">{coreLabel}</span>
          <span className="node-role">{swarm?.active ? 'swarm online' : 'local observer'}</span>
        </div>

        <AnimatePresence>
          {agents.map((a) => {
            const p = pos.get(a.id);
            if (!p) return null;
            return (
              <motion.button
                key={a.id}
                className={`node status-${a.status} ${selected === a.id ? 'node-selected' : ''}`}
                style={{ left: p.x, top: p.y }}
                initial={{ opacity: 0, scale: 0.6 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.6 }}
                transition={{ type: 'spring', stiffness: 260, damping: 22 }}
                onClick={() => onSelect(a.id)}
              >
                <span className={`status-ring ring-${a.status}`} />
                <span className="node-name">{a.name}</span>
                <span className="node-role">{a.role}</span>
                <span className={`node-status text-${a.status}`}>{a.status.toUpperCase()}</span>
              </motion.button>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
}
