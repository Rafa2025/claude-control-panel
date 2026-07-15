async function request(url, options) {
  const res = await fetch(url, options);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `${res.status} ${res.statusText}`);
  return body;
}

export const api = {
  listSkills: () => request('/api/skills'),
  setSkillState: (id, enabled) =>
    request(`/api/skills/${encodeURIComponent(id)}/state`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled }),
    }),
  readSkill: (id) => request(`/api/skills/${encodeURIComponent(id)}/content`),
  writeSkill: (id, content) =>
    request(`/api/skills/${encodeURIComponent(id)}/content`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content }),
    }),
  marketplace: () => request('/api/marketplace'),
  installSkill: (id) =>
    request(`/api/marketplace/${encodeURIComponent(id)}/install`, { method: 'POST' }),
  suggestions: () => request('/api/suggestions'),
  dismissSuggestion: (url) =>
    request('/api/suggestions/dismiss', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url }),
    }),
  startScan: (topic, model) =>
    request('/api/suggestions/scan', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ topic, model }),
    }),
  agents: () => request('/api/agents'),
  agentLogs: (id) => request(`/api/agents/${encodeURIComponent(id)}/logs`),
  agentHistory: (since) => request(`/api/agents/history?since=${encodeURIComponent(since || 0)}`),
  skillUsage: () => request('/api/skills/usage'),
  generateSkill: (description, model) =>
    request('/api/skills/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ description, model }),
    }),
  createSkill: (id, content) =>
    request('/api/skills/create', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id, content }),
    }),
  deleteSkill: (id) =>
    request(`/api/skills/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  skillConflicts: () => request('/api/skills/conflicts'),
  installUpdate: (id) =>
    request(`/api/marketplace/${encodeURIComponent(id)}/install`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ update: true }),
    }),
  advisorAnalyze: (requestText, model) =>
    request('/api/advisor/analyze', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ request: requestText, model }),
    }),
  advisorFinalize: (requestText, answers, model) =>
    request('/api/advisor/finalize', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ request: requestText, answers, model }),
    }),
  advisorExport: (draftPrompt) =>
    request('/api/advisor/export', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ draftPrompt }),
    }),
  advisorHistory: () => request('/api/advisor/history'),
  advisorHistoryDelete: (id) =>
    request(`/api/advisor/history/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  usage: () => request('/api/usage'),
  health: () => request('/api/health'),
};
