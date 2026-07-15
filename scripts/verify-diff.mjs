// Dev-only: verify the editor's diff confirmation renders. Edits the textarea
// in-browser and opens the review step, but never clicks CONFIRM — no file is written.
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

await send('Page.enable');
await send('Page.navigate', { url: 'http://localhost:5173' });
await sleep(3000);

await evalJs(`[...document.querySelectorAll('.btn-mini')][0]?.click()`);
await sleep(1200);

// simulate a real user edit through React's onChange
await evalJs(`(() => {
  const ta = document.querySelector('.editor-textarea');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
  setter.call(ta, ta.value + '\\n<!-- test edit -->');
  ta.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
await sleep(300);
await evalJs(`document.querySelector('.btn-primary')?.click()`); // REVIEW & SAVE
await sleep(600);

const { result } = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync('/tmp/ccp-5-diff.png', Buffer.from(result.data, 'base64'));
console.log('diff lines (+/-):', await evalJs(
  `JSON.stringify({add: document.querySelectorAll('.diff-add').length, del: document.querySelectorAll('.diff-del').length, confirmBtn: !!document.querySelector('.btn-danger')})`
));

ws.close();
chrome.kill();
