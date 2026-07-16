import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { listSkills } from './skills.js';

const pexecFile = promisify(execFile);

// Run ruflo from a neutral, dedicated dir — NOT the panel workspace. In the
// panel's own dir, `ruflo agent list` auto-resumes the background daemon (which
// spawns headless Claude sessions and burns tokens continuously). A cwd with no
// .claude-flow workspace keeps our read-only observation from starting anything.
const RUFLO_CWD = path.join(os.tmpdir(), 'ccp-ruflo-cwd');
let rufloCwdReady = fs.mkdir(RUFLO_CWD, { recursive: true }).catch(() => {});

const HISTORY_FILE = path.join(os.homedir(), 'claude-control-panel', 'data', 'agent-history.jsonl');
const HISTORY_MAX_AGE = 2 * 60 * 60 * 1000; // keep last 2 hours of snapshots
const SNAPSHOT_MIN_INTERVAL = 5000; // one write per poll cycle even with multiple clients
let lastSnapshotAt = 0;

// Read-only allowlist. Nothing here spawns agents, kills processes, or mutates state.
const RUFLO_COMMANDS = {
  agentList: ['agent', 'list', '--json'],
  swarmStatus: ['swarm', 'status', '--json'],
  agentStatus: (id) => ['agent', 'status', id],
  agentLogs: (id) => ['agent', 'logs', id],
};

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/;

async function runRuflo(args, timeout = 15000) {
  await rufloCwdReady;
  // --no-install: never trigger a network install from the dashboard.
  // cwd: RUFLO_CWD so ruflo can't auto-start the daemon in the panel workspace.
  const { stdout, stderr } = await pexecFile('npx', ['--no-install', 'ruflo', ...args], {
    timeout,
    maxBuffer: 4 * 1024 * 1024,
    cwd: RUFLO_CWD,
  });
  return stdout + (stderr ? '\n' + stderr : '');
}

// CLI output mixes log lines with (sometimes) JSON — extract the first JSON blob if present.
function extractJson(text) {
  const start = text.search(/[[{]/);
  if (start === -1) return null;
  for (let end = text.length; end > start; end--) {
    try {
      return JSON.parse(text.slice(start, end));
    } catch {
      /* keep shrinking */
    }
  }
  return null;
}

function normalizeAgent(raw) {
  const status = String(raw.status ?? raw.state ?? 'idle').toLowerCase();
  return {
    id: String(raw.id ?? raw.agentId ?? raw.name ?? 'unknown'),
    name: String(raw.name ?? raw.id ?? 'agent'),
    role: String(raw.type ?? raw.role ?? raw.agentType ?? 'agent'),
    status: ['running', 'active', 'busy'].includes(status)
      ? 'running'
      : ['done', 'completed', 'complete'].includes(status)
        ? 'done'
        : ['error', 'failed', 'crashed'].includes(status)
          ? 'error'
          : 'idle',
    parentId: raw.parentId ?? raw.parent ?? raw.spawnedBy ?? null,
    task: raw.task ?? raw.currentTask ?? raw.description ?? null,
    source: 'ruflo',
  };
}

async function getRufloAgents() {
  const out = await runRuflo(RUFLO_COMMANDS.agentList);
  const json = extractJson(out);
  const list = Array.isArray(json) ? json : Array.isArray(json?.agents) ? json.agents : [];
  return list.map(normalizeAgent);
}

async function getSwarmStatus() {
  try {
    const out = await runRuflo(RUFLO_COMMANDS.swarmStatus);
    if (/no active swarm/i.test(out)) return { active: false };
    const json = extractJson(out);
    return json ? { active: true, ...json } : { active: false, raw: out.trim().slice(0, 500) };
  } catch {
    return { active: false };
  }
}

// Supplement: read-only scan of the process table for claude/ruflo sessions,
// so the tree reflects local Claude Code activity even outside the swarm.
async function getProcessAgents() {
  try {
    const { stdout } = await pexecFile('ps', ['-eo', 'pid,ppid,etime,args', '--no-headers'], {
      timeout: 5000,
      maxBuffer: 4 * 1024 * 1024,
    });
    const rows = stdout
      .split('\n')
      .map((l) => l.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s+(.+)$/))
      .filter(Boolean)
      .map(([, pid, ppid, etime, args]) => ({ pid, ppid, etime, args }))
      .filter(
        (p) =>
          /(?:^|\/)(claude|ruflo|claude-flow)(\s|$)/.test(p.args) &&
          !/(ps -eo|grep)/.test(p.args)
      );
    const pids = new Set(rows.map((r) => r.pid));
    return rows.map((p) => ({
      id: `pid:${p.pid}`,
      name: p.args.includes('ruflo') || p.args.includes('claude-flow')
        ? `ruflo (pid ${p.pid})`
        : `claude session (pid ${p.pid})`,
      role: 'local process',
      status: 'running',
      parentId: pids.has(p.ppid) ? `pid:${p.ppid}` : null,
      task: `${p.args.slice(0, 120)} · up ${p.etime}`,
      source: 'process',
    }));
  } catch {
    return [];
  }
}

// Snapshot each poll result (throttled) so the UI can replay the tree over time.
async function recordSnapshot(snapshot) {
  const now = Date.now();
  if (now - lastSnapshotAt < SNAPSHOT_MIN_INTERVAL) return;
  lastSnapshotAt = now;
  try {
    let lines = [];
    try {
      lines = (await fs.readFile(HISTORY_FILE, 'utf8')).split('\n').filter(Boolean);
    } catch { /* first write */ }
    const cutoff = now - HISTORY_MAX_AGE;
    const kept = lines.filter((l) => {
      try {
        return JSON.parse(l).timestamp >= cutoff;
      } catch {
        return false;
      }
    });
    kept.push(JSON.stringify({ timestamp: now, tree: snapshot }));
    await fs.mkdir(path.dirname(HISTORY_FILE), { recursive: true });
    await fs.writeFile(HISTORY_FILE, kept.join('\n') + '\n');
  } catch { /* history is best-effort; never break the live poll */ }
}

export async function getAgentHistory(since) {
  const from = Number(since) || 0;
  try {
    const lines = (await fs.readFile(HISTORY_FILE, 'utf8')).split('\n').filter(Boolean);
    const out = [];
    for (const l of lines) {
      try {
        const snap = JSON.parse(l);
        if (snap.timestamp >= from) out.push(snap);
      } catch { /* skip corrupt line */ }
    }
    return out;
  } catch {
    return [];
  }
}

export async function getAgentTree() {
  let detected = true;
  let agents = [];
  try {
    agents = await getRufloAgents();
  } catch {
    detected = false;
  }
  const [swarm, processes] = await Promise.all([
    detected ? getSwarmStatus() : Promise.resolve({ active: false }),
    getProcessAgents(),
  ]);
  const result = { detected, swarm, agents: [...agents, ...processes], fetchedAt: Date.now() };
  recordSnapshot(result); // fire-and-forget; hooked into the existing poll, no new loop
  return result;
}

// Best-effort skill usage: count mentions of known skill ids in ruflo agent logs.
// If logs carry no reliable skill references, this returns an empty map — never fabricated counts.
let usageCache = { at: 0, map: {} };

export async function getSkillUsage() {
  if (Date.now() - usageCache.at < 60_000) return usageCache.map;
  const map = {};
  try {
    const [agents, skills] = await Promise.all([getRufloAgents(), listSkills()]);
    const ids = skills.map((s) => s.id).filter((id) => id.length >= 3);
    const rufloAgents = agents.filter((a) => a.source === 'ruflo').slice(0, 10);
    for (const agent of rufloAgents) {
      if (!SAFE_ID.test(agent.id)) continue;
      const logs = await runRuflo(RUFLO_COMMANDS.agentLogs(agent.id)).catch(() => '');
      if (!logs) continue;
      for (const id of ids) {
        // word-ish boundary match so "do" doesn't hit inside random words
        const count = (logs.match(new RegExp(`(?<![\\w-])${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`, 'g')) || []).length;
        if (count > 0) map[id] = (map[id] || 0) + count;
      }
    }
  } catch { /* empty map on any failure */ }
  usageCache = { at: Date.now(), map };
  return map;
}

// Claude Code persists each session's activity (messages, thinking, tool calls,
// results) as JSONL under ~/.claude/projects/<project>/<session-id>.jsonl. For a
// local Claude Code process we can read the transcript matching its --resume id
// and render a live activity feed — the real "what is this agent doing" view.
// Read-only; the session id is UUID-validated and the resolved path must stay
// under PROJECTS_DIR (no traversal).
const PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function extractSessionId(cmdline) {
  const m = cmdline.match(/--(?:resume|session-id|session)[ =]([0-9a-f-]{36})/i);
  return m && UUID_RE.test(m[1]) ? m[1] : null;
}

async function findTranscript(sessionId) {
  if (!UUID_RE.test(sessionId)) return null;
  let subdirs;
  try {
    subdirs = await fs.readdir(PROJECTS_DIR);
  } catch {
    return null;
  }
  for (const sub of subdirs) {
    const file = path.join(PROJECTS_DIR, sub, `${sessionId}.jsonl`);
    // resolved path must stay inside PROJECTS_DIR
    if (!path.resolve(file).startsWith(PROJECTS_DIR + path.sep)) continue;
    if (await fs.stat(file).then((s) => s.isFile()).catch(() => false)) return file;
  }
  return null;
}

async function tailBytes(file, maxBytes) {
  const fh = await fs.open(file, 'r');
  try {
    const { size } = await fh.stat();
    const start = Math.max(0, size - maxBytes);
    const buf = Buffer.alloc(size - start);
    await fh.read(buf, 0, buf.length, start);
    return buf.toString('utf8');
  } finally {
    await fh.close();
  }
}

function summarizeToolInput(name, input) {
  if (!input || typeof input !== 'object') return '';
  const first = input.command ?? input.file_path ?? input.path ?? input.pattern ??
    input.query ?? input.url ?? input.description ?? input.prompt;
  const s = typeof first === 'string' ? first : JSON.stringify(input);
  return s.replace(/\s+/g, ' ').slice(0, 160);
}

function clip(s, n) {
  return String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
}

// Parse the transcript tail into a compact, human-readable activity feed.
function renderActivity(text, limit = 30) {
  const lines = text.split('\n');
  const events = [];
  for (const line of lines) {
    let d;
    try { d = JSON.parse(line); } catch { continue; }
    const ts = d.timestamp ? new Date(d.timestamp).toLocaleTimeString() : '';
    const msg = d.message;
    if (!msg || typeof msg !== 'object') continue;
    const content = msg.content;
    if (typeof content === 'string' && d.type === 'user') {
      if (content.trim()) events.push(`${ts}  👤 you: ${clip(content, 200)}`);
      continue;
    }
    if (!Array.isArray(content)) continue;
    for (const b of content) {
      if (b.type === 'thinking' && b.thinking?.trim()) {
        events.push(`${ts}  💭 thinking: ${clip(b.thinking, 220)}`);
      } else if (b.type === 'text' && b.text?.trim()) {
        const who = d.type === 'assistant' ? '🗨  claude' : '👤 you';
        events.push(`${ts}  ${who}: ${clip(b.text, 240)}`);
      } else if (b.type === 'tool_use') {
        events.push(`${ts}  🔧 ${b.name}(${summarizeToolInput(b.name, b.input)})`);
      } else if (b.type === 'tool_result') {
        const c = b.content;
        const s = typeof c === 'string' ? c : Array.isArray(c)
          ? c.map((x) => x?.text ?? '').join(' ') : JSON.stringify(c);
        if (s.trim()) events.push(`${ts}     ↳ ${clip(s, 160)}`);
      }
    }
  }
  return events.slice(-limit);
}

async function getSessionActivity(cmdline) {
  const sessionId = extractSessionId(cmdline);
  if (!sessionId) return null;
  const file = await findTranscript(sessionId);
  if (!file) return null;
  try {
    const text = await tailBytes(file, 128 * 1024);
    const events = renderActivity(text);
    if (!events.length) return null;
    return { sessionId, events };
  } catch {
    return null;
  }
}

// OS processes have no ruflo logs, but we can surface real `ps` detail so the
// panel is informative instead of a dead end. Read-only process observation,
// same source as the tree scan — touches no files.
async function getProcessDetail(pid) {
  if (!/^\d+$/.test(pid)) return { detail: 'Invalid process id.', args: '' };
  try {
    const { stdout } = await pexecFile(
      'ps',
      ['-p', pid, '-o', 'pid=,ppid=,stat=,%cpu=,%mem=,etime=,lstart=,args='],
      { timeout: 5000, maxBuffer: 1024 * 1024 }
    );
    const line = stdout.trim();
    if (!line) return { detail: `Process ${pid} is no longer running.`, args: '' };
    const m = line.match(/^(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\w{3}\s+\w{3}\s+\d+\s+[\d:]+\s+\d+)\s+(.+)$/);
    if (!m) return { detail: line, args: '' };
    const [, p, ppid, stat, cpu, mem, etime, started, args] = m;
    const STATE = { R: 'running', S: 'sleeping', D: 'waiting (uninterruptible)', T: 'stopped', Z: 'zombie', I: 'idle' };
    const state = STATE[stat[0]] || stat;
    const detail = [
      `  PID          ${p}`,
      `  Parent PID   ${ppid}`,
      `  State        ${state} (${stat})`,
      `  CPU          ${cpu}%`,
      `  Memory       ${mem}%`,
      `  Uptime       ${etime}`,
      `  Started      ${started}`,
      '',
      '  Command',
      `    ${args}`,
    ].join('\n');
    return { detail, args };
  } catch {
    return { detail: `Process ${pid} is no longer running or could not be inspected.`, args: '' };
  }
}

export async function getAgentLogs(id) {
  if (!SAFE_ID.test(id)) {
    throw Object.assign(new Error('Invalid agent id'), { status: 400 });
  }
  if (id.startsWith('pid:')) {
    const { detail, args } = await getProcessDetail(id.slice('pid:'.length));
    const activity = args ? await getSessionActivity(args) : null;
    if (activity) {
      const feed = activity.events.join('\n');
      return {
        id,
        logs:
          `● Live Claude Code session activity  (session ${activity.sessionId.slice(0, 8)})\n` +
          `${'─'.repeat(60)}\n${feed}\n${'─'.repeat(60)}\n\n` +
          `Process detail\n${detail}`,
      };
    }
    return {
      id,
      logs:
        `This node is a local OS process (not a ruflo swarm agent). No linked\n` +
        `Claude Code session transcript was found, so only process detail is shown:\n\n${detail}`,
    };
  }
  try {
    const [logs, status] = await Promise.all([
      runRuflo(RUFLO_COMMANDS.agentLogs(id)).catch(() => ''),
      runRuflo(RUFLO_COMMANDS.agentStatus(id)).catch(() => ''),
    ]);
    const text = [status.trim(), logs.trim()].filter(Boolean).join('\n\n');
    return { id, logs: text || 'No log output for this agent.' };
  } catch (err) {
    return { id, logs: `Failed to fetch logs: ${err.message}` };
  }
}
