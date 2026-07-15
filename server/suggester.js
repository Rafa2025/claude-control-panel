import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { listSkills } from './skills.js';
import { getMarketplace } from './marketplace.js';
import { recordUsage } from './usage.js';

const DATA_FILE = path.join(os.homedir(), 'claude-control-panel', 'data', 'suggestions.json');
const SCAN_TIMEOUT = 5 * 60 * 1000;

// in-memory scan state; results persist to DATA_FILE
let scan = { status: 'idle', startedAt: null, error: null };

async function readSaved() {
  try {
    return JSON.parse(await fs.readFile(DATA_FILE, 'utf8'));
  } catch {
    return { suggestions: [], scannedAt: null };
  }
}

async function writeSaved(data) {
  await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
  await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2) + '\n');
}

function extractJsonArray(text) {
  const start = text.indexOf('[');
  if (start === -1) return null;
  for (let end = text.length; end > start; end--) {
    try {
      const v = JSON.parse(text.slice(start, end));
      if (Array.isArray(v)) return v;
    } catch { /* keep shrinking */ }
  }
  return null;
}

function sanitize(items) {
  return items
    .filter((s) => s && typeof s === 'object')
    .map((s) => ({
      name: String(s.name ?? '').slice(0, 80),
      description: String(s.description ?? '').slice(0, 300),
      url: String(s.url ?? ''),
      reason: String(s.reason ?? '').slice(0, 200),
    }))
    .filter((s) => s.name && /^https:\/\//.test(s.url))
    .slice(0, 12);
}

async function buildPrompt(topic) {
  const known = new Set();
  try {
    for (const s of await listSkills()) known.add(s.id);
  } catch { /* scan can still run */ }
  try {
    for (const s of (await getMarketplace()).skills) known.add(s.id);
  } catch { /* ditto */ }
  return [
    'Search the web for open-source Claude Code skills (repos or repo folders containing a SKILL.md with name/description frontmatter). Good starting points: GitHub topic/code search, "awesome claude code" lists.',
    topic
      ? `The user is specifically looking for skills about: "${topic}". Only suggest skills relevant to that topic.`
      : 'Suggest skills a student learning AI tooling would find useful.',
    `Skip anything matching these already-known skill names: ${[...known].sort().join(', ')}.`,
    'Suggest up to 8 skills.',
    'Reply with ONLY a JSON array, no prose, each item: {"name": string, "description": string (from the skill itself if possible), "url": string (https link to the skill source), "reason": string (one short sentence on why it is useful)}.',
  ].join('\n');
}

// Only CLI model aliases we know resolve; anything else falls back to haiku.
export const ALLOWED_MODELS = ['haiku', 'sonnet', 'opus'];

export async function startScan(rawTopic, rawModel) {
  const model = ALLOWED_MODELS.includes(rawModel) ? rawModel : 'haiku';
  const topic = String(rawTopic ?? '')
    .replace(/[\r\n"]+/g, ' ')
    .trim()
    .slice(0, 60);
  if (scan.status === 'running') {
    throw Object.assign(new Error('A scan is already running'), { status: 409 });
  }
  scan = { status: 'running', startedAt: Date.now(), error: null, topic, model };
  const prompt = await buildPrompt(topic);

  // Scrub session-scoped Claude Code vars (ANTHROPIC_BASE_URL etc.): if this
  // server was launched from inside a Claude Code session, they redirect the
  // child CLI to a session-scoped proxy and cause 401s. A clean env makes the
  // CLI authenticate via its own stored credentials, like a normal terminal.
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([k]) => !/^(ANTHROPIC_|CLAUDE_CODE_|CLAUDECODE|CLAUDE_EFFORT|CLAUDE_AGENT_|CLAUDE_FLOW_)/.test(k)
    )
  );

  // headless Claude with web search; runs detached from the request cycle
  execFile(
    'claude',
    ['-p', prompt, '--model', model, '--allowedTools', 'WebSearch', '--output-format', 'json'],
    { timeout: SCAN_TIMEOUT, maxBuffer: 8 * 1024 * 1024, env },
    async (err, stdout) => {
      try {
        if (err && !stdout) throw new Error(err.killed ? 'Scan timed out' : err.message);
        let text = stdout;
        try {
          const wrapper = JSON.parse(stdout);
          recordUsage(wrapper.usage);
          if (wrapper.is_error) {
            throw new Error(`Claude CLI: ${wrapper.result || 'unknown error'} — if this is an auth error, run \`claude login\` in a terminal.`);
          }
          text = wrapper.result ?? stdout; // --output-format json wraps the reply
        } catch (e) {
          if (e.message.startsWith('Claude CLI:')) throw e;
          /* not JSON — treat stdout as raw text */
        }
        const items = extractJsonArray(String(text));
        if (!items) throw new Error('AI reply contained no JSON array');
        const suggestions = sanitize(items);
        await writeSaved({ suggestions, scannedAt: Date.now(), topic, model });
        scan = { status: 'idle', startedAt: null, error: null };
      } catch (e) {
        scan = { status: 'idle', startedAt: null, error: e.message };
      }
    }
  );
  return { started: true };
}

export async function getSuggestions() {
  const saved = await readSaved();
  return {
    status: scan.status,
    startedAt: scan.startedAt,
    error: scan.error,
    topic: scan.status === 'running' ? scan.topic : saved.topic || '',
    model: (scan.status === 'running' ? scan.model : saved.model) || 'haiku',
    scannedAt: saved.scannedAt,
    suggestions: saved.suggestions,
  };
}
