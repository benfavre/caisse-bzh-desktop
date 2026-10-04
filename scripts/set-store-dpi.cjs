// Keep Electron's existing manifest and declare modern Windows per-monitor DPI.
// Only the Store build uses this hook. Windows SDK mt.exe is required.
const { execFileSync } = require("node:child_process");
const { existsSync, readdirSync, readFileSync, writeFileSync, rmSync } = require("node:fs");
const path = require("node:path");

module.exports = async ({ appOutDir, electronPlatformName }) => {
  if (electronPlatformName !== "win32") throw new Error("Store DPI hook requires Windows.");
  const sdk = path.join(process.env["ProgramFiles(x86)"], "Windows Kits", "10", "bin");
  const versions = readdirSync(sdk).filter(v => /^\d+(\.\d+)+$/.test(v)).sort((a, b) => b.localeCompare(a, "en", { numeric: true }));
  const tool = versions.map(v => path.join(sdk, v, "x64", "mt.exe")).find(existsSync);
  if (!tool) throw new Error("Install the Windows SDK manifest tool (mt.exe) before building the Store package.");
  const executable = path.join(appOutDir, "caisse.bzh.exe");
  const manifest = path.join(appOutDir, ".store-executable-manifest.xml");
  const run = args => execFileSync(tool, ["-nologo", ...args], { stdio: "pipe" });
  try {
    run([`-inputresource:${executable};#1`, `-out:${manifest}`]);
    let xml = readFileSync(manifest, "utf8");
    if (!xml.includes("<dpiAwareness")) {
      if (!xml.includes("</asmv3:application>")) throw new Error("Unexpected Electron executable manifest layout.");
      xml = xml.replace("</asmv3:application>", '<asmv3:windowsSettings><dpiAwareness xmlns="http://schemas.microsoft.com/SMI/2016/WindowsSettings">PerMonitorV2, PerMonitor</dpiAwareness></asmv3:windowsSettings></asmv3:application>');
      writeFileSync(manifest, xml);
      run(["-manifest", manifest, `-outputresource:${executable};#1`]);
    }
    console.log("Store executable: modern per-monitor DPI manifest applied.");
  } finally {
    rmSync(manifest, { force: true });
  }
};
