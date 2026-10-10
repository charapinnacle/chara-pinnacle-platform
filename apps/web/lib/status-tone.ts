export const statusTones = ["success", "warning", "danger", "info", "neutral"] as const;

// The semantic status of a thing, which StatusBadge turns into colours. Each domain keeps its own map from its states to a tone.
export type StatusTone = (typeof statusTones)[number];
