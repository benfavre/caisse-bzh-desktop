import { test } from "node:test";
import assert from "node:assert/strict";
import { recoveryReport, updateSafe } from "../electron/recovery.mjs";
const idle = { pending: 0, openTickets: 0, uncertain: false, storageError: false, busy: false, shiftOpen: false };
test("updates require a fresh report from a fully idle register", () => {
  assert.equal(updateSafe(null), false);
  assert.equal(updateSafe(recoveryReport(idle, 100), 101), true);
  assert.equal(updateSafe(recoveryReport(idle, 100), 30100), false);
  for (const key of ["pending", "openTickets", "uncertain", "storageError", "busy", "shiftOpen"]) {
    const value = ["pending", "openTickets"].includes(key) ? 1 : true;
    assert.equal(updateSafe(recoveryReport({ ...idle, [key]: value }, 100), 101), false, key);
  }
});
test("malformed recovery reports never authorize an update", () => {
  for (const input of [null, {}, { ...idle, pending: -1 }, { ...idle, busy: "false" }, { ...idle, openTickets: Infinity }]) {
    assert.equal(recoveryReport(input), null);
  }
});
