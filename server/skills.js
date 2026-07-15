import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const HOME = os.homedir();
export const SKILLS_DIR = path.join(HOME, '.claude', 'skills');
// Disabling a skill moves its directory here, out of the path Claude Code scans,
// so the toggle actually takes effect in real sessions (not just cosmetically).
export const DISABLED_DIR = path.join(HOME, '.claude', 'skills-disabled');
export const HOME_CLAUDE_MD = path.join(HOME, 'CLAUDE.md');
const DATA_DIR = path.join(HOME, 'claude-control-panel', 'data');
const STATE_FILE = path.join(DATA_DIR, 'skills-state.json');

// Every filesystem path this module touches must live under one of these.
const ALLOWED_ROOTS = [SKILLS_DIR, DISABLED_DIR, HOME_CLAUDE_MD, path.join(HOME, 'claude-control-panel')];

function assertInScope(p) {
  const resolved = path.resolve(p);
  const ok = ALLOWED_ROOTS.some(
    (root) => resolved === root || resolved.startsWith(root + path.sep)
  );
  if (!ok) throw Object.assign(new Error(`Path out of scope: ${resolved}`), { status: 403 });
  return resolved;
}

async function readStateFile() {
  try {
    return JSON.parse(await fs.readFile(STATE_FILE, 'utf8'));
  } catch {
    return {};
  }
}

async function writeStateFile(state) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2) + '\n');
}

// Minimal YAML frontmatter parse: only top-level "key: value" lines.
function parseFrontmatter(content) {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const out = {};
  const lines = m[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const kv = lines[i].match(/^([A-Za-z_-]+):\s*(.+)$/);
    if (!kv) continue;
    let value = kv[2].trim();
    if (/^[|>]-?$/.test(value)) {
      // YAML block scalar: gather the following indented lines
      const block = [];
      while (i + 1 < lines.length && (/^\s+\S/.test(lines[i + 1]) || lines[i + 1] === '')) {
        block.push(lines[++i].trim());
      }
      value = block.join(' ').trim();
    }
    out[kv[1]] = value.replace(/^(["'])(.*)\1$/, '$2');
  }
  return out;
}

function firstParagraph(content) {
  const body = content.replace(/^---\r?\n[\s\S]*?\r?\n---/, '').trim();
  const para = body.split(/\r?\n\r?\n/).find((p) => p.trim() && !p.trim().startsWith('#'));
  return para ? para.replace(/\s+/g, ' ').slice(0, 200) : '';
}

async function findSkillFile(dir) {
  const entries = await fs.readdir(dir);
  for (const name of ['SKILL.md', 'skill.md', 'README.md']) {
    if (entries.includes(name)) return path.join(dir, name);
  }
  const anyMd = entries.find((e) => e.endsWith('.md'));
  return anyMd ? path.join(dir, anyMd) : null;
}

async function scanSkillsDir(baseDir, { disabled = false } = {}) {
  let dirs = [];
  try {
    // Many skill dirs are symlinks (e.g. into ~/.agents/skills), so follow them via stat.
    const entries = await fs.readdir(baseDir);
    for (const name of entries) {
      try {
        if ((await fs.stat(path.join(baseDir, name))).isDirectory()) dirs.push(name);
      } catch {
        // broken symlink — skip
      }
    }
  } catch {
    return [];
  }
  const skills = [];
  for (const dir of dirs.sort()) {
    const file = await findSkillFile(path.join(baseDir, dir));
    if (!file) continue;
    let fm = {}, desc = '';
    try {
      const content = await fs.readFile(file, 'utf8');
      fm = parseFrontmatter(content);
      desc = fm.description || firstParagraph(content);
    } catch {
      // unreadable file: still list the skill by directory name
    }
    skills.push({
      id: dir,
      name: fm.name || dir,
      description: desc || '(no description)',
      source: 'personal',
      file,
      editable: true,
      disabled,
    });
  }
  return skills;
}

// Best-effort: pull /slash-command style skill references out of a CLAUDE.md.
async function scanClaudeMd(file, sourceLabel, knownIds) {
  let content;
  try {
    content = await fs.readFile(file, 'utf8');
  } catch {
    return [];
  }
  const refs = new Set();
  // Require a hyphen in slash refs so path mentions like `/src` or `/tests` don't match.
  for (const m of content.matchAll(/(?:^|[\s`(])\/([a-z][a-z0-9]*(?:-[a-z0-9]+)+)/g)) refs.add(m[1]);
  // Also match bare names of known skills mentioned in backticks, e.g. `security-review`
  for (const m of content.matchAll(/`([a-z][a-z0-9-]{2,})`/g)) {
    if (knownIds.has(m[1])) refs.add(m[1]);
  }
  return [...refs]
    .filter((r) => !knownIds.has(r)) // known skills already listed from the skills dir
    .sort()
    .map((r) => ({
      id: `claudemd:${r}`,
      name: r,
      description: `Referenced in ${path.basename(path.dirname(file)) || '~'}/CLAUDE.md (no skill directory found)`,
      source: sourceLabel,
      file: null,
      editable: false,
    }));
}

export async function listSkills() {
  const enabledSkills = await scanSkillsDir(SKILLS_DIR, { disabled: false });
  const disabledSkills = await scanSkillsDir(DISABLED_DIR, { disabled: true });
  const dirSkills = [...enabledSkills, ...disabledSkills].sort((a, b) => a.id.localeCompare(b.id));
  const knownIds = new Set(dirSkills.map((s) => s.id));
  const mdSkills = await scanClaudeMd(HOME_CLAUDE_MD, 'project', knownIds);
  return [...dirSkills, ...mdSkills].map((s) => ({
    ...s,
    // Location is truth: a skill under skills-disabled/ is disabled. For
    // claude.md refs (no dir), fall back to the cosmetic state file.
    enabled: s.disabled === undefined ? true : !s.disabled,
  }));
}

const VALID_ID = /^[a-z0-9][a-z0-9-]{1,63}$/;

export async function setSkillState(id, enabled) {
  if (!VALID_ID.test(id)) {
    throw Object.assign(new Error('Invalid skill id'), { status: 400 });
  }
  const from = assertInScope(path.join(enabled ? DISABLED_DIR : SKILLS_DIR, id));
  const to = assertInScope(path.join(enabled ? SKILLS_DIR : DISABLED_DIR, id));

  const alreadyThere = await fs.stat(to).then(() => true).catch(() => false);
  const sourceExists = await fs.lstat(from).then(() => true).catch(() => false);

  if (!sourceExists) {
    // Nothing to move — either already in the target state, or not a real dir skill.
    if (alreadyThere) return { id, enabled, moved: false };
    throw Object.assign(new Error('Skill directory not found'), { status: 404 });
  }
  if (alreadyThere) {
    throw Object.assign(new Error(`A skill named "${id}" already exists in the target location`), { status: 409 });
  }

  await fs.mkdir(path.dirname(to), { recursive: true });
  // rename moves a symlink as a symlink (not its target) — correct for the many
  // symlinked skills that point into ~/.agents/skills.
  await fs.rename(from, to);

  // Keep the legacy state file roughly in sync for anything still reading it.
  const state = await readStateFile();
  state[id] = enabled;
  await writeStateFile(state);
  return { id, enabled, moved: true };
}

// Find a skill's dir across both enabled and disabled locations.
function skillDirCandidates(id) {
  return [path.join(SKILLS_DIR, id), path.join(DISABLED_DIR, id)];
}

async function resolveSkillFile(id) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(id)) {
    throw Object.assign(new Error('Invalid skill id'), { status: 400 });
  }
  for (const dir of skillDirCandidates(id)) {
    const inScope = assertInScope(dir);
    const exists = await fs.stat(inScope).then(() => true).catch(() => false);
    if (!exists) continue;
    const file = await findSkillFile(inScope);
    if (file) return assertInScope(file);
  }
  throw Object.assign(new Error('Skill file not found'), { status: 404 });
}

export async function readSkillContent(id) {
  const file = await resolveSkillFile(id);
  return { id, file, content: await fs.readFile(file, 'utf8') };
}

const STOPWORDS = new Set(
  'this that with when your from into only also more most them then they what which while about have has had use used using user users skill skills claude code file files task tasks work works make makes create creates need needs want wants like each every other some such where these those will would should could been being does'.split(' ')
);

function descriptionTokens(text) {
  return new Set(
    String(text)
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 4 && !STOPWORDS.has(w))
  );
}

// Flags skill pairs whose description keyword sets overlap heavily (possible trigger
// collisions). Calibrated against this machine's real corpus: clearly-related pairs
// (reasoningbank-agentdb × reasoningbank-intelligence, do × make-plan, the github-*
// family) score 0.22–0.35 Jaccard while unrelated pairs sit below ~0.2, so flag at
// >= 0.22 with at least 4 shared terms to keep out short-description noise. Read-only.
const CONFLICT_THRESHOLD = 0.22;
const CONFLICT_MIN_SHARED = 4;

export async function findConflicts() {
  const skills = (await listSkills()).filter((s) => s.source === 'personal');
  const tokenized = skills.map((s) => ({ id: s.id, name: s.name, tokens: descriptionTokens(s.description) }));
  const conflicts = [];
  for (let i = 0; i < tokenized.length; i++) {
    for (let j = i + 1; j < tokenized.length; j++) {
      const a = tokenized[i], b = tokenized[j];
      if (a.tokens.size < 3 || b.tokens.size < 3) continue;
      const shared = [...a.tokens].filter((t) => b.tokens.has(t));
      const union = new Set([...a.tokens, ...b.tokens]).size;
      const score = shared.length / union;
      if (score >= CONFLICT_THRESHOLD && shared.length >= CONFLICT_MIN_SHARED) {
        conflicts.push({
          a: a.id,
          b: b.id,
          score: Number(score.toFixed(2)),
          overlap: shared.sort().slice(0, 12),
        });
      }
    }
  }
  return conflicts.sort((x, y) => y.score - x.score);
}

export async function writeSkillContent(id, content) {
  if (typeof content !== 'string') {
    throw Object.assign(new Error('content must be a string'), { status: 400 });
  }
  const file = await resolveSkillFile(id);
  await fs.writeFile(file, content);
  return { id, file, bytes: Buffer.byteLength(content) };
}

// Creates a brand-new skill dir with a single SKILL.md. Only called after the
// UI's explicit confirmation step; refuses to touch an existing skill.
export async function createSkill(id, content) {
  if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(id)) {
    throw Object.assign(
      new Error('Skill name must be kebab-case: lowercase letters, digits and dashes (2–64 chars)'),
      { status: 400 }
    );
  }
  if (typeof content !== 'string' || !content.trim()) {
    throw Object.assign(new Error('content must be a non-empty string'), { status: 400 });
  }
  // Guard against collision with an enabled OR a disabled skill of the same name.
  for (const candidate of skillDirCandidates(id)) {
    const exists = await fs.stat(assertInScope(candidate)).then(() => true).catch(() => false);
    if (exists) {
      const where = candidate.startsWith(DISABLED_DIR) ? ' (currently disabled)' : '';
      throw Object.assign(new Error(`A skill named "${id}" already exists${where}`), { status: 409 });
    }
  }
  const dir = assertInScope(path.join(SKILLS_DIR, id));
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, 'SKILL.md');
  await fs.writeFile(file, content);
  return { id, file, bytes: Buffer.byteLength(content) };
}

// Permanently removes a skill directory (enabled or disabled). Scope-locked and
// only reached through the UI's type-to-confirm step. rm of a symlinked skill
// removes the link, never the ~/.agents/skills target it points to.
export async function deleteSkill(id) {
  if (!VALID_ID.test(id)) {
    throw Object.assign(new Error('Invalid skill id'), { status: 400 });
  }
  for (const candidate of skillDirCandidates(id)) {
    const dir = assertInScope(candidate);
    const stat = await fs.lstat(dir).catch(() => null);
    if (!stat) continue;
    if (stat.isSymbolicLink()) {
      await fs.unlink(dir); // drop just the link
    } else {
      await fs.rm(dir, { recursive: true, force: true });
    }
    // scrub any leftover state-file entry
    const state = await readStateFile();
    if (id in state) {
      delete state[id];
      await writeStateFile(state);
    }
    return { id, deleted: true, wasSymlink: stat.isSymbolicLink() };
  }
  throw Object.assign(new Error('Skill not found'), { status: 404 });
}
