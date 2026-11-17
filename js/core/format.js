// Shared formatting and colors so every view labels things the same way.
export const ERA_COLOR = { "Foundations": "#e3a83c", "Prototypes / Specialists": "#c8321f", "Post-Malibu": "#5fd8ff" };
export const ERA_SHORT = { "Foundations": "Foundations", "Prototypes / Specialists": "Prototypes", "Post-Malibu": "Post-Malibu" };

export const fmtUsd = v =>
  v == null ? "–" : v === 0 ? "$0" : v >= 1e9 ? `$${+(v / 1e9).toFixed(1)}B` : `$${Math.round(v / 1e6)}M`;

export const fmtInt = v => (v == null ? "–" : v.toLocaleString("en-US"));
