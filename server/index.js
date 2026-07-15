import express from 'express';
import {
  listSkills,
  setSkillState,
  readSkillContent,
  writeSkillContent,
  findConflicts,
  createSkill,
  deleteSkill,
} from './skills.js';
import { generateSkill } from './skillgen.js';
import { getAgentTree, getAgentLogs, getAgentHistory, getSkillUsage } from './agents.js';
import { getMarketplace, installSkill } from './marketplace.js';
import { startScan, getSuggestions, dismissSuggestion } from './suggester.js';
import { analyze, finalize, exportPrompt } from './advisor.js';
import { appendEntry, listEntries, deleteEntry } from './history.js';
import { getUsage } from './usage.js';
import { getHealth } from './health.js';

const app = express();
const PORT = 4310;

app.use(express.json({ limit: '2mb' }));

const wrap = (fn) => (req, res) =>
  fn(req, res).catch((err) => {
    res.status(err.status || 500).json({ error: err.message });
  });

app.get('/api/skills', wrap(async (_req, res) => {
  res.json({ skills: await listSkills() });
}));

app.get('/api/skills/usage', wrap(async (_req, res) => {
  res.json({ usage: await getSkillUsage() });
}));

app.get('/api/skills/conflicts', wrap(async (_req, res) => {
  res.json({ conflicts: await findConflicts() });
}));

app.post('/api/skills/generate', wrap(async (req, res) => {
  res.json(await generateSkill(req.body?.description, req.body?.model));
}));

app.post('/api/skills/create', wrap(async (req, res) => {
  res.json(await createSkill(req.body?.id, req.body?.content));
}));

app.put('/api/skills/:id/state', wrap(async (req, res) => {
  res.json(await setSkillState(req.params.id, req.body?.enabled));
}));

app.delete('/api/skills/:id', wrap(async (req, res) => {
  res.json(await deleteSkill(req.params.id));
}));

app.get('/api/skills/:id/content', wrap(async (req, res) => {
  res.json(await readSkillContent(req.params.id));
}));

app.put('/api/skills/:id/content', wrap(async (req, res) => {
  res.json(await writeSkillContent(req.params.id, req.body?.content));
}));

app.get('/api/marketplace', wrap(async (_req, res) => {
  res.json(await getMarketplace());
}));

app.post('/api/marketplace/:id/install', wrap(async (req, res) => {
  res.json(await installSkill(req.params.id, { update: Boolean(req.body?.update) }));
}));

// --- AI Advisor ---
app.post('/api/advisor/analyze', wrap(async (req, res) => {
  const result = await analyze(req.body?.request, req.body?.model);
  if (!result.needsClarification && result.draftPrompt) {
    result.historyEntry = await appendEntry({
      request: req.body.request,
      recommendedSkills: result.recommendedSkills,
      draftPrompt: result.draftPrompt,
    });
  }
  res.json(result);
}));

app.post('/api/advisor/finalize', wrap(async (req, res) => {
  const result = await finalize(req.body?.request, req.body?.answers, req.body?.model);
  if (result.draftPrompt) {
    result.historyEntry = await appendEntry({
      request: req.body.request,
      recommendedSkills: result.recommendedSkills,
      draftPrompt: result.draftPrompt,
    });
  }
  res.json(result);
}));

app.post('/api/advisor/export', wrap(async (req, res) => {
  res.json(await exportPrompt(req.body?.draftPrompt));
}));

app.get('/api/advisor/history', wrap(async (_req, res) => {
  res.json({ entries: await listEntries() });
}));

app.delete('/api/advisor/history/:id', wrap(async (req, res) => {
  res.json(await deleteEntry(req.params.id));
}));

// --- session meta ---
app.get('/api/usage', wrap(async (_req, res) => {
  res.json(getUsage());
}));

app.get('/api/health', wrap(async (_req, res) => {
  res.json(await getHealth());
}));

app.get('/api/suggestions', wrap(async (_req, res) => {
  res.json(await getSuggestions());
}));

app.post('/api/suggestions/scan', wrap(async (req, res) => {
  res.json(await startScan(req.body?.topic, req.body?.model));
}));

app.post('/api/suggestions/dismiss', wrap(async (req, res) => {
  res.json(await dismissSuggestion(req.body?.url));
}));

app.get('/api/agents', wrap(async (_req, res) => {
  res.json(await getAgentTree());
}));

app.get('/api/agents/history', wrap(async (req, res) => {
  res.json({ snapshots: await getAgentHistory(req.query.since) });
}));

app.get('/api/agents/:id/logs', wrap(async (req, res) => {
  res.json(await getAgentLogs(req.params.id));
}));

app.listen(PORT, '127.0.0.1', () => {
  console.log(`[server] Claude Control Panel API on http://127.0.0.1:${PORT}`);
});
