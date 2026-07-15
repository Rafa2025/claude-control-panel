// Dev-only: verify search bar + marketplace UI. Opens the install confirm
// modal but always cancels — nothing is downloaded or written.
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const PORT = 9223;
const chrome = spawn('google-chrome', [
  '--headless=new', '--disable-gpu', '--no-sandbox',
  `--remote-debugging-port=${PORT}`, '--window-size=1400,1000', 'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getTarget() {
  for (let i = 0; i < 20; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* starting */ }
    await sleep(300);
  }
  throw new Error('Chrome CDP not reachable');
}

const ws = new WebSocket(await getTarget());
await new Promise((r) => (ws.onopen = r));
let seq = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
};
const send = (method, params = {}) =>
  new Promise((resolve) => { const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
const evalJs = async (expression) =>
  (await send('Runtime.evaluate', { expression, returnByValue: true })).result?.result?.value;
const shot = async (name) => {
  const { result } = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`/tmp/${name}.png`, Buffer.from(result.data, 'base64'));
};
const typeInSearch = async (text) => evalJs(`(() => {
  const input = document.querySelector('.search-input');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, ${JSON.stringify(text)});
  input.dispatchEvent(new Event('input', { bubbles: true }));
})()`);

await send('Page.enable');
await send('Page.navigate', { url: 'http://localhost:5173' });
await sleep(3000);

// 1. skills search bar
await typeInSearch('swarm');
await sleep(500);
console.log('skills matching "swarm":', await evalJs(`document.querySelectorAll('.skill-card').length`));
await shot('ccp-6-skills-search');

// 2. marketplace tab
await evalJs(`[...document.querySelectorAll('.nav-btn')].find(b => b.textContent.includes('MARKETPLACE'))?.click()`);
await sleep(2500);
console.log('marketplace cards:', await evalJs(`document.querySelectorAll('.skill-card').length`));
console.log('install buttons:', await evalJs(`[...document.querySelectorAll('.btn-mini')].filter(b => b.textContent.includes('INSTALL')).length`));

// 3. marketplace search
await typeInSearch('pdf');
await sleep(500);
console.log('marketplace matching "pdf":', await evalJs(`document.querySelectorAll('.skill-card').length`));
await typeInSearch('');
await sleep(500);
await shot('ccp-7-marketplace');

// 4. install confirm modal → cancel (no download)
await evalJs(`[...document.querySelectorAll('.btn-mini')].find(b => b.textContent.includes('INSTALL'))?.click()`);
await sleep(700);
console.log('confirm modal open:', await evalJs(`!!document.querySelector('.install-modal')`));
await shot('ccp-8-install-confirm');
await evalJs(`[...document.querySelectorAll('.editor-actions .btn')].find(b => b.textContent === 'CANCEL')?.click()`);
await sleep(400);
console.log('modal closed:', await evalJs(`!document.querySelector('.install-modal')`));

ws.close();
chrome.kill();
