import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

const FILE = path.join(os.homedir(), 'claude-control-panel', 'data', 'advisor-history.json');

async function readAll() {
  try {
    const v = JSON.parse(await fs.readFile(FILE, 'utf8'));
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

async function writeAll(entries) {
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(entries, null, 2) + '\n');
}

export async function appendEntry({ request, recommendedSkills, draftPrompt }) {
  const entries = await readAll();
  const entry = {
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    request: String(request).slice(0, 4000),
    recommendedSkills,
    draftPrompt,
  };
  entries.push(entry);
  await writeAll(entries);
  return entry;
}

export async function listEntries() {
  return (await readAll()).sort((a, b) => b.timestamp - a.timestamp);
}

export async function deleteEntry(id) {
  const entries = await readAll();
  const next = entries.filter((e) => e.id !== id);
  if (next.length === entries.length) {
    throw Object.assign(new Error('History entry not found'), { status: 404 });
  }
  await writeAll(next);
  return { deleted: id };
}
