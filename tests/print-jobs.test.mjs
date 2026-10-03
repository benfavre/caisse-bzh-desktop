import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { submitPrint, printIdentity } from "../electron/print-jobs.mjs";
function document(copyNumber = 0) {
  const source = { seq: 1, hash: "a".repeat(64) };
  return { version: 1, id: ["shop", "live", 1, source.hash, copyNumber].join(":"), shopId: "shop", training: false, source, copyNumber };
}
test("simultaneous submissions and reopening never print the same document twice", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "caisse-print-")); let calls = 0;
  try {
    const send = async () => { calls++; return { ok: true }; };
    const results = await Promise.all([submitPrint(dir, document(), send), submitPrint(dir, document(), send)]);
    assert.equal(results.filter(x => x.ok).length, 1); assert.equal(calls, 1);
    assert.equal((await submitPrint(dir, document(), send)).ok, false); assert.equal(calls, 1);
    assert.equal((await submitPrint(dir, document(1), send)).ok, true); assert.equal(calls, 2);
  } finally { await rm(dir, { recursive: true }); }
});
test("uncertain output remains uncertain and malformed IDs cannot reach the spooler", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "caisse-print-")); let calls = 0;
  try {
    const send = async () => { calls++; throw new Error("lost reply"); };
    assert.equal((await submitPrint(dir, document(), send)).state, "unknown");
    assert.equal((await submitPrint(dir, document(), send)).state, "unknown"); assert.equal(calls, 1);
    assert.equal(printIdentity({ ...document(), shopId: "other" }), null);
    assert.equal((await submitPrint(dir, { ...document(), id: "../../x" }, send)).ok, false); assert.equal(calls, 1);
  } finally { await rm(dir, { recursive: true }); }
});
