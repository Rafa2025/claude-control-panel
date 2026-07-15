// Dev-only verification: drives headless Chrome over CDP (no extra deps,
// uses Node's built-in WebSocket) to screenshot the app after real waits,
// so rAF-driven Framer Motion animations actually run.
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
    } catch { /* chrome still starting */ }
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
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
};
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const id = ++seq;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });

const evalJs = async (expression) =>
  (await send('Runtime.evaluate', { expression, returnByValue: true })).result?.result?.value;

const shot = async (name) => {
  const { result } = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`/tmp/${name}.png`, Buffer.from(result.data, 'base64'));
  console.log(`saved /tmp/${name}.png`);
};

await send('Page.enable');
await send('Runtime.enable');
await send('Page.navigate', { url: 'http://localhost:5173' });
await sleep(3000);
await shot('ccp-1-skills');

// sample animated opacity of first cards
console.log('card opacities:', await evalJs(
  `[...document.querySelectorAll('.skill-card')].slice(0,3).map(e => getComputedStyle(e).opacity).join(',')`
));

// open the editor for the first editable skill
await evalJs(`[...document.querySelectorAll('.btn-mini')][0]?.click()`);
await sleep(1200);
await shot('ccp-2-editor');
await evalJs(`document.querySelector('.editor-actions .btn')?.click()`); // cancel
await sleep(400);

// switch to agent view
await evalJs(`[...document.querySelectorAll('.nav-btn')].find(b => b.textContent.includes('AGENT'))?.click()`);
await sleep(3500);
await shot('ccp-3-agents');

// animation check: does the pulsing ring / edge animation change over time?
const a1 = await evalJs(
  `(() => { const r = document.querySelector('.status-ring'); return r ? getComputedStyle(r).boxShadow : 'none'; })()`
);
await sleep(400);
const a2 = await evalJs(
  `(() => { const r = document.querySelector('.status-ring'); return r ? getComputedStyle(r).boxShadow : 'none'; })()`
);
console.log('ring animating:', a1 !== a2, '|', a1, '→', a2);
console.log('edge pulses:', await evalJs(`document.querySelectorAll('.edge-pulse').length`));
console.log('nodes:', await evalJs(`document.querySelectorAll('.node').length`));

// click a node → log side panel
await evalJs(`[...document.querySelectorAll('.node')].find(n => !n.classList.contains('node-core'))?.click()`);
await sleep(2500);
await shot('ccp-4-logpanel');
console.log('log panel open:', await evalJs(`!!document.querySelector('.log-panel')`));

ws.close();
chrome.kill();
