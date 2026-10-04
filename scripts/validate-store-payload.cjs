const assert = require("node:assert/strict");
const asar = require("@electron/asar");
const metadata = JSON.parse(asar.extractFile(process.argv[2], "package.json").toString());
assert.equal(metadata.windowsStoreBuild, true, "Store build marker missing");
assert.equal(metadata.macAutoUpdates, false);
assert.equal(metadata.version, require("../package.json").version);
const files = asar.listPackage(process.argv[2]).map(file => file.replaceAll("\\", "/"));
for (const module of ["main.mjs", "distribution.mjs", "updater.mjs", "preload.cjs"]) {
  assert.ok(files.includes(`/electron/${module}`), `Missing runtime module: ${module}`);
}
assert.ok(!files.some(file => /\.(p12|pfx|pem|key|password|jks)$/i.test(file)), "Unexpected credential file in app payload");
console.log("Store payload: runtime, distribution marker and credential exclusion verified.");
