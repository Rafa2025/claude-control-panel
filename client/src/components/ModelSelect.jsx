import React from 'react';

// CLI aliases — the claude CLI resolves each to the current model of that tier.
export const MODELS = [
  { value: 'haiku', label: 'Haiku · fast & cheap' },
  { value: 'sonnet', label: 'Sonnet · balanced' },
  { value: 'opus', label: 'Opus · most capable' },
];

export default function ModelSelect({ value, onChange, disabled }) {
  return (
    <label className="model-select-wrap" title="Model used for this AI call — larger models spend more quota">
      <span className="model-select-label">Model</span>
      <select
        className="model-select"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      >
        {MODELS.map((m) => (
          <option key={m.value} value={m.value}>{m.label}</option>
        ))}
      </select>
    </label>
  );
}
