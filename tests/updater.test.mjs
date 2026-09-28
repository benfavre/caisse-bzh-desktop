import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { UpdateController } from "../electron/updater.mjs";
function setup(options = {}) {
  const updater = new EventEmitter();
  let checks = 0,
    installs = 0;
  updater.checkForUpdates = async () => {
    checks++;
    updater.emit("update-not-available");
  };
  updater.quitAndInstall = (silent, restart) => {
    assert.equal(silent, false);
    assert.equal(restart, true);
    installs++;
  };
  const controller = new UpdateController(updater, options);
  return {
    updater,
    controller,
    checks: () => checks,
    installs: () => installs,
  };
}
test("development builds make no update requests", async () => {
  const s = setup({ enabled: false });
  await s.controller.check();
  s.controller.start();
  assert.equal(s.checks(), 0);
  assert.equal(s.controller.snapshot().phase, "disabled");
  s.controller.dispose();
});
test("no-update result and retry after network failure", async () => {
  const s = setup();
  s.updater.checkForUpdates = async () => {
    throw Error("private URL");
  };
  await s.controller.check();
  assert.equal(s.controller.snapshot().phase, "error");
  assert.ok(!s.controller.snapshot().message.includes("private"));
  s.updater.checkForUpdates = async () =>
    s.updater.emit("update-not-available");
  await s.controller.check();
  assert.equal(s.controller.snapshot().phase, "current");
  s.controller.dispose();
});
test("deduplicates simultaneous checks", async () => {
  const s = setup();
  let resolve;
  s.updater.checkForUpdates = () =>
    new Promise((r) => {
      resolve = r;
    });
  const a = s.controller.check(),
    b = s.controller.check();
  resolve();
  await Promise.all([a, b]);
  assert.equal(s.controller.pending, null);
  s.controller.dispose();
});
test("download progress, busy guard and explicit restart", () => {
  let dirty = true;
  const s = setup({ canInstall: () => !dirty });
  assert.equal(s.updater.autoInstallOnAppQuit, true, "installed at the next quit, never mid-service");
  assert.equal(s.updater.allowDowngrade, false);
  assert.equal(s.controller.install().reason, "not-ready");
  s.updater.emit("update-available", { version: "1.1.0" });
  s.updater.emit("download-progress", { percent: 42 });
  assert.equal(s.controller.snapshot().percent, 42);
  s.updater.emit("update-downloaded", { version: "1.1.0" });
  assert.equal(s.installs(), 0);
  assert.equal(s.controller.install().reason, "unsaved");
  dirty = false;
  assert.equal(s.controller.install().ok, true);
  assert.equal(s.installs(), 1);
  assert.equal(s.controller.install().reason, "not-ready");
  s.controller.dispose();
});
test("checksum/download errors are visible and listeners are cleaned up", () => {
  const s = setup();
  s.updater.emit("error", Error("sha512 mismatch"));
  assert.equal(s.controller.snapshot().phase, "error");
  s.controller.dispose();
  assert.equal(s.updater.listenerCount("error"), 0);
});
