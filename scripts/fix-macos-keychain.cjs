// electron-builder 26.15.3 passes the PKCS12 password to set-key-partition-list,
// although create-keychain uses a separate random password. Keep the correction
// scoped to that pinned dependency and fail if its implementation changes.
const fs = require("node:fs");
const path = require("node:path");
const packageFile = require.resolve("app-builder-lib/package.json");
const { version } = require(packageFile);
if (version !== "26.15.3") throw new Error("Review the macOS keychain workaround for app-builder-lib " + version);
const file = path.join(path.dirname(packageFile), "out/codeSign/macCodeSign.js");
let source = fs.readFileSync(file, "utf8");
const replacements = [
  ["return await importCerts(keychainFile, certPaths, cscPasswords);", "return await importCerts(keychainFile, certPaths, cscPasswords, keychainPassword);"],
  ["async function importCerts(keychainFile, paths, keyPasswords) {", "async function importCerts(keychainFile, paths, keyPasswords, keychainPassword) {"],
  ['"-s", "-k", password, keychainFile', '"-s", "-k", keychainPassword, keychainFile'],
];
for (const [before, after] of replacements) {
  if (source.includes(after)) continue;
  if (source.split(before).length !== 2) throw new Error("Unexpected electron-builder keychain implementation");
  source = source.replace(before, after);
}
fs.writeFileSync(file, source);
console.log("Applied macOS keychain password correction to electron-builder " + version);
