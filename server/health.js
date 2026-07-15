import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const pexecFile = promisify(execFile);
// Read-only expiry check requested by the user; only the expiresAt field is
// ever read out of this file — token values are never touched or returned.
const CREDENTIALS_FILE = path.join(os.homedir(), '.claude', '.credentials.json');

let cache = { at: 0, result: null };

async function checkRuflo() {
  try {
    await pexecFile('npx', ['--no-install', 'ruflo', 'agent', 'list'], {
      timeout: 12000,
      maxBuffer: 1024 * 1024,
    });
    return 'ok';
  } catch {
    return 'error';
  }
}

async function checkCredentials() {
  try {
    const creds = JSON.parse(await fs.readFile(CREDENTIALS_FILE, 'utf8'));
    const expiresAt = creds?.claudeAiOauth?.expiresAt;
    if (typeof expiresAt !== 'number') return 'unknown';
    return expiresAt > Date.now() ? 'ok' : 'expired';
  } catch {
    return 'unknown';
  }
}

async function checkVite() {
  try {
    const res = await fetch('http://127.0.0.1:5173/', { signal: AbortSignal.timeout(3000) });
    return res.ok ? 'ok' : 'error';
  } catch {
    return 'error';
  }
}

export async function getHealth() {
  // 25s cache so the UI's 30s poll never stacks ruflo CLI invocations
  if (cache.result && Date.now() - cache.at < 25_000) return cache.result;
  const [ruflo, credentials, vite] = await Promise.all([
    checkRuflo(),
    checkCredentials(),
    checkVite(),
  ]);
  // "ports" = this API answered (implicit by responding) + vite actually serving
  const result = { ruflo, credentials, ports: vite };
  cache = { at: Date.now(), result };
  return result;
}
