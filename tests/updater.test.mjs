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
test("night install: silent, only between 3:00 and 5:00 after 30 idle minutes", async () => {
  const { nightlyInstallDue } = await import("../electron/updater.mjs");
  const at = (h, m = 0) => new Date(2026, 9, 1, h, m);
  assert.ok(nightlyInstallDue(at(3, 10), 1800));
  assert.ok(nightlyInstallDue(at(4, 59), 7200));
  assert.equal(nightlyInstallDue(at(3, 10), 600), false, "someone used the till recently");
  assert.equal(nightlyInstallDue(at(2, 59), 7200), false);
  assert.equal(nightlyInstallDue(at(5, 0), 7200), false);
  assert.equal(nightlyInstallDue(at(14, 0), 7200), false, "never during the day");
  const updater = new EventEmitter();
  let args = null;
  updater.quitAndInstall = (...a) => { args = a; };
  const c = new UpdateController(updater);
  updater.emit("update-downloaded", { version: "1.2.0" });
  assert.equal(c.install({ silent: true }).ok, true);
  assert.deepEqual(args, [true, true], "no installer window, app reopens");
  c.dispose();
});
test("unsigned macOS: newer release detected, pointed to the download page", async () => {
  const { isNewerVersion } = await import("../electron/updater.mjs");
  assert.ok(isNewerVersion("v1.3.0", "1.2.0"));
  assert.ok(isNewerVersion("1.10.0", "1.9.9"), "numeric, not lexical");
  assert.equal(isNewerVersion("v1.2.0", "1.2.0"), false);
  assert.equal(isNewerVersion("v1.1.9", "1.2.0"), false);
  assert.equal(isNewerVersion("v2.0.0-beta.1", "1.2.0"), false, "prereleases ignored");
  assert.equal(isNewerVersion("", "1.2.0"), false);
  const c = new UpdateController(new EventEmitter(), { enabled: false, reason: "unsigned" });
  c.setManual("1.3.0");
  assert.equal(c.snapshot().phase, "available");
  assert.equal(c.snapshot().version, "1.3.0");
  assert.equal(c.install().reason, "not-ready", "never installs itself");
  c.dispose();
});
