// Fail closed when the renderer is gone or its last report is stale. Pending
// records survive ordinary exit, but an updater must not interrupt recovery.
export function recoveryReport(input, now = Date.now()) {
  if (!input || typeof input !== "object" || !Number.isSafeInteger(input.pending) || input.pending < 0 ||
      !Number.isSafeInteger(input.openTickets) || input.openTickets < 0 ||
      ["uncertain", "storageError", "busy", "shiftOpen"].some(key => typeof input[key] !== "boolean")) return null;
  return { pending: input.pending, openTickets: input.openTickets, uncertain: input.uncertain, storageError: input.storageError, busy: input.busy, shiftOpen: input.shiftOpen, at: now };
}
export function updateSafe(report, now = Date.now()) {
  return !!report && now >= report.at && now - report.at < 30000 && report.pending === 0 && report.openTickets === 0 &&
    !report.uncertain && !report.storageError && !report.busy && !report.shiftOpen;
}
