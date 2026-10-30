const DISABLED_VALUES = new Set(["false", "0", "no", "off"]);

// Preview API instances must not compete with the active importers, bot, or
// image/data processors. Omission preserves the existing production behavior.
export function areBackgroundJobsEnabled(env = process.env) {
  return !DISABLED_VALUES.has(
    String(env.BACKGROUND_JOBS_ENABLED ?? "true").trim().toLowerCase()
  );
}
