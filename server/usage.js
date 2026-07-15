// In-memory token accounting for headless `claude -p` calls (AI Scout + AI Advisor).
// Lives for the server process lifetime only — resets on restart by design.
const totals = { inputTokens: 0, outputTokens: 0, callCount: 0 };

// `usage` is the usage object from a --output-format json wrapper.
export function recordUsage(usage) {
  if (!usage || typeof usage !== 'object') return;
  totals.inputTokens +=
    (usage.input_tokens ?? 0) +
    (usage.cache_creation_input_tokens ?? 0) +
    (usage.cache_read_input_tokens ?? 0);
  totals.outputTokens += usage.output_tokens ?? 0;
  totals.callCount += 1;
}

export function getUsage() {
  return { ...totals };
}
