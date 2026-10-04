import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

function load(overrides) {
  return spawnSync(process.execPath, ["-e", `
    const c = require('./electron-builder.store.cjs');
    console.log(JSON.stringify({appx:c.appx, publish:c.publish, extraMetadata:c.extraMetadata, win:c.win}));
  `], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    encoding: "utf8",
    env: { ...process.env, STORE_PREPARATION: "false", STORE_IDENTITY_NAME: "", STORE_PUBLISHER: "", REQUIRE_MAC_SIGNING: "false", CSC_LINK: "", ...overrides },
  });
}

test("a final Store build cannot silently use a placeholder identity", () => {
  const missing = load({});
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /require STORE_IDENTITY_NAME and STORE_PUBLISHER/);
  const provisional = load({ STORE_IDENTITY_NAME: "Webdesign29.CaisseBZH.Preparation", STORE_PUBLISHER: "CN=Webdesign29-Preparation" });
  assert.notEqual(provisional.status, 0);
  assert.match(provisional.stderr, /provisional identity/);
});

test("preparation builds are separated from public desktop update releases", () => {
  const result = load({ STORE_PREPARATION: "true" });
  assert.equal(result.status, 0, result.stderr);
  const c = JSON.parse(result.stdout);
  assert.equal(c.appx.identityName, "Webdesign29.CaisseBZH.Preparation");
  assert.equal(c.publish, null);
  assert.equal(c.extraMetadata.windowsStoreBuild, true);
  assert.equal(c.appx.electronUpdaterAware, false);
  assert.equal(c.appx.setBuildNumber, false);
  assert.equal(c.appx.addAutoLaunchExtension, false);
});

test("final builds preserve the exact Partner Center identity and publisher", () => {
  const identityName = "12345Webdesign29.CaisseBZH";
  const publisher = "CN=12345678-1234-1234-1234-123456789abc";
  const result = load({ STORE_IDENTITY_NAME: identityName, STORE_PUBLISHER: publisher });
  assert.equal(result.status, 0, result.stderr);
  const { appx } = JSON.parse(result.stdout);
  assert.equal(appx.identityName, identityName);
  assert.equal(appx.publisher, publisher);
  assert.equal(appx.applicationId, "CaisseBZH");
});
