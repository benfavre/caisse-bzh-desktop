// caisse.bzh desktop — electron-builder config (same release model as benfavre/caviard:
// GitHub Releases feed read by electron-updater; Windows NSIS, macOS DMG/ZIP, Linux AppImage).
// GitHub exposes absent optional secrets as empty strings; drop them so the builder
// doesn't treat an empty certificate link as a path.
for (const name of ["CSC_LINK", "WIN_CSC_LINK"]) {
  if (!process.env[name]?.trim()) delete process.env[name];
}

module.exports = {
  appId: "bzh.caisse.desktop",
  productName: "caisse.bzh",
  executableName: "caisse-bzh",
  directories: { output: "release", buildResources: "build" },
  files: ["electron/**/*", "package.json", "!**/*.map"],
  asar: true,
  npmRebuild: false,
  extraMetadata: { macAutoUpdates: !!process.env.CSC_LINK },
  artifactName: "caisse-bzh-${version}-${os}-${arch}.${ext}",
  publish: [{ provider: "github", owner: "benfavre", repo: "caisse-bzh-desktop", releaseType: "draft" }],
  electronUpdaterCompatibility: ">=2.16",
  linux: { target: ["AppImage"], category: "Office", icon: "build/icon.png", executableName: "caisse-bzh" },
  win: { target: ["nsis"], icon: "build/icon.png", executableName: "caisse.bzh" },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    deleteAppDataOnUninstall: false,
    shortcutName: "caisse.bzh",
  },
  mac: {
    target: ["dmg", "zip"],
    category: "public.app-category.business",
    icon: "build/icon.png",
    identity: process.env.CSC_LINK ? undefined : "-",
    notarize: !!(process.env.APPLE_ID && process.env.APPLE_APP_SPECIFIC_PASSWORD && process.env.APPLE_TEAM_ID),
    hardenedRuntime: !!process.env.CSC_LINK,
    entitlements: "build/entitlements.mac.plist",
    entitlementsInherit: "build/entitlements.mac.plist",
  },
};
