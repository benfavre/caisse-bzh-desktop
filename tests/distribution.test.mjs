import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { desktopDistribution } from "../electron/distribution.mjs";
import { UpdateController } from "../electron/updater.mjs";
import { recoveryReport, updateSafe } from "../electron/recovery.mjs";

const installed = { isPackaged: true, updatesConfigured: true };

test("Store installs and unpacked Store payloads never request or install NSIS updates", async () => {
  for (const marker of [{ windowsStore: true }, { storeBuild: true }]) {
    const distribution = desktopDistribution({ platform: "win32", ...installed, ...marker });
    assert.equal(distribution.store, true);
    assert.equal(distribution.autostartSupported, false, "registry autostart must not target an immutable package path");
    assert.match(distribution.updates.reason, /Microsoft Store/);
    const updater = new EventEmitter();
    updater.checkForUpdates = () => assert.fail("Store install contacted the GitHub updater");
    updater.quitAndInstall = () => assert.fail("Store install tried to install an NSIS update");
    const controller = new UpdateController(updater, distribution.updates);
    controller.start();
    await controller.check();
    assert.equal(controller.snapshot().phase, "disabled");
    assert.equal(controller.install().ok, false);
    assert.equal(controller.startTimer, undefined);
    assert.equal(updater.autoDownload, false);
    assert.equal(updater.autoInstallOnAppQuit, false);
    updater.emit("update-downloaded", { version: "99.0.0" });
    assert.equal(controller.snapshot().phase, "disabled");
    assert.equal(controller.install().ok, false, "a stray updater event cannot enable Store self-installation");
    controller.dispose();
  }
});

test("direct desktop update and autostart support stay unchanged", () => {
  for (const context of [
    { platform: "win32" },
    { platform: "darwin", macAutoUpdates: true },
    { platform: "linux", appImage: true },
  ]) {
    const d = desktopDistribution({ ...installed, ...context });
    assert.equal(d.store, false);
    assert.equal(d.updates.enabled, true);
    assert.equal(d.autostartSupported, true);
  }
  const unsignedMac = desktopDistribution({ ...installed, platform: "darwin" });
  assert.equal(unsignedMac.updates.enabled, false);
  assert.equal(unsignedMac.manualMacUpdates, true);
  const unpackedLinux = desktopDistribution({ ...installed, platform: "linux" });
  assert.equal(unpackedLinux.updates.enabled, false);
  assert.equal(unpackedLinux.autostartSupported, false);
});

test("distribution selection preserves pending-work guards and never installs merely on quit", () => {
  const idle = { pending: 0, openTickets: 0, uncertain: false, storageError: false, busy: false, shiftOpen: false };
  for (const context of [{ platform: "win32" }, { platform: "darwin", macAutoUpdates: true }, { platform: "linux", appImage: true }, { platform: "win32", storeBuild: true }]) {
    const distribution = desktopDistribution({ ...installed, ...context }), updater = new EventEmitter();
    let report = null, installs = 0;
    updater.quitAndInstall = () => { installs++; };
    const controller = new UpdateController(updater, { ...distribution.updates, canInstall: () => updateSafe(report, 1000) });
    updater.emit("update-downloaded", { version: "9.0.0" });
    assert.equal(updater.autoInstallOnAppQuit, false);
    for (const state of [null, { ...idle, pending: 1 }, { ...idle, openTickets: 1 }, { ...idle, uncertain: true }, { ...idle, shiftOpen: true }]) {
      report = state && recoveryReport(state, 999);
      assert.equal(controller.install().ok, false);
      assert.equal(installs, 0);
    }
    report = recoveryReport(idle, 999);
    assert.equal(controller.install().ok, !distribution.store);
    assert.equal(installs, distribution.store ? 0 : 1);
    controller.dispose();
  }
});
