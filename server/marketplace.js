import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { SKILLS_DIR } from './skills.js';

const REPO = 'anthropics/skills';
const BRANCH = 'main';
const TREE_URL = `https://api.github.com/repos/${REPO}/git/trees/${BRANCH}?recursive=1`;
const RAW_BASE = `https://raw.githubusercontent.com/${REPO}/${BRANCH}`;
const CACHE_TTL = 10 * 60 * 1000;
const SAFE_NAME = /^[a-z0-9][a-z0-9-]*$/;

let cache = { at: 0, catalog: null, filesBySkill: null };

async function ghFetch(url) {
  const res = await fetch(url, {
    headers: { 'user-agent': 'claude-control-panel' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`GitHub ${res.status} for ${url}`);
  return res;
}

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

async function loadCatalog() {
  if (cache.catalog && Date.now() - cache.at < CACHE_TTL) return cache;

  const tree = (await (await ghFetch(TREE_URL)).json()).tree;
  // keep each blob's git SHA so installed copies can be diffed against the repo
  const files = tree
    .filter((t) => t.type === 'blob')
    .map((t) => ({ path: t.path, sha: t.sha }));
  const skillDirs = [...new Set(
    files
      .filter((f) => f.path.startsWith('skills/') && f.path.endsWith('/SKILL.md'))
      .map((f) => f.path.slice(0, -'/SKILL.md'.length))
  )].filter((dir) => SAFE_NAME.test(path.basename(dir)));

  const filesBySkill = new Map(
    skillDirs.map((dir) => [
      path.basename(dir),
      files.filter((f) => f.path.startsWith(dir + '/')),
    ])
  );

  const catalog = await Promise.all(
    skillDirs.map(async (dir) => {
      const id = path.basename(dir);
      let fm = {};
      try {
        fm = parseFrontmatter(await (await ghFetch(`${RAW_BASE}/${dir}/SKILL.md`)).text());
      } catch {
        // listing still useful without a description
      }
      return {
        id,
        name: fm.name || id,
        description: fm.description || '(no description)',
        repo: REPO,
        dir,
        files: filesBySkill.get(id).length,
        url: `https://github.com/${REPO}/tree/${BRANCH}/${dir}`,
      };
    })
  );

  cache = { at: Date.now(), catalog, filesBySkill };
  return cache;
}

async function isInstalled(id) {
  try {
    await fs.stat(path.join(SKILLS_DIR, id));
    return true;
  } catch {
    return false;
  }
}

// git blob sha1: sha1("blob <byteLength>\0" + content) — matches the tree API's SHAs
function gitBlobSha(buf) {
  return crypto
    .createHash('sha1')
    .update(`blob ${buf.length}\0`)
    .update(buf)
    .digest('hex');
}

async function hasUpdate(entry, filesBySkill) {
  const destRoot = path.join(SKILLS_DIR, entry.id);
  for (const f of filesBySkill.get(entry.id)) {
    const rel = f.path.slice(entry.dir.length + 1);
    try {
      const local = await fs.readFile(path.join(destRoot, rel));
      if (gitBlobSha(local) !== f.sha) return true;
    } catch {
      return true; // file missing locally → repo has something we don't
    }
  }
  return false;
}

export async function getMarketplace() {
  let catalog, filesBySkill;
  try {
    ({ catalog, filesBySkill } = await loadCatalog());
  } catch (err) {
    return { available: false, error: err.message, skills: [] };
  }
  const skills = await Promise.all(
    catalog.map(async (s) => {
      const installed = await isInstalled(s.id);
      return {
        ...s,
        installed,
        updateAvailable: installed ? await hasUpdate(s, filesBySkill) : false,
      };
    })
  );
  return { available: true, repo: REPO, skills };
}

export async function installSkill(id, { update = false } = {}) {
  if (!SAFE_NAME.test(id)) {
    throw Object.assign(new Error('Invalid skill id'), { status: 400 });
  }
  const { catalog, filesBySkill } = await loadCatalog();
  const entry = catalog.find((s) => s.id === id);
  if (!entry) throw Object.assign(new Error('Skill not in marketplace catalog'), { status: 404 });
  if (!update && (await isInstalled(id))) {
    throw Object.assign(new Error('Skill already installed'), { status: 409 });
  }

  const destRoot = path.join(SKILLS_DIR, id);
  const targets = [];
  for (const f of filesBySkill.get(id)) {
    const rel = f.path.slice(entry.dir.length + 1);
    const dest = path.resolve(destRoot, rel);
    // path traversal guard: every written file must stay inside the new skill dir
    if (dest !== destRoot && !dest.startsWith(destRoot + path.sep)) continue;
    targets.push({ rel, dest, repoPath: f.path });
  }

  // Download in parallel batches so multi-file skills (some have 60+ files)
  // finish fast instead of one-at-a-time — sequential fetches were slow enough
  // to trip client/proxy timeouts even though the install eventually succeeded.
  const CONCURRENCY = 8;
  const written = [];
  for (let i = 0; i < targets.length; i += CONCURRENCY) {
    const batch = targets.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async ({ rel, dest, repoPath }) => {
        const body = Buffer.from(await (await ghFetch(`${RAW_BASE}/${repoPath}`)).arrayBuffer());
        await fs.mkdir(path.dirname(dest), { recursive: true });
        await fs.writeFile(dest, body);
        written.push(rel);
      })
    );
  }
  return { id, installedTo: destRoot, files: written, updated: update };
}
