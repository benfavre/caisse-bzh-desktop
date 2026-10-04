// Store packages receive updates from Microsoft, never from the NSIS feed.
// The build marker also protects unpacked Store builds used for validation.
export function desktopDistribution({
  platform,
  windowsStore = false,
  storeBuild = false,
  appImage = false,
  macAutoUpdates = false,
  isPackaged = false,
  updatesConfigured = false,
}) {
  const store = platform === "win32" && (windowsStore || storeBuild);
  const signedMac = platform !== "darwin" || macAutoUpdates;
  const supported = (platform !== "linux" || appImage) && signedMac;
  return {
    store,
    // Electron's registry login item API does not register a package StartupTask.
    autostartSupported: !store && (platform !== "linux" || appImage),
    manualMacUpdates: isPackaged && !signedMac,
    updates: {
      enabled: !store && isPackaged && updatesConfigured && supported,
      reason: store
        ? "Les mises à jour sont gérées par Microsoft Store."
        : !isPackaged
          ? "Les mises à jour sont disponibles dans la version installée."
          : !signedMac
            ? "Version macOS non signée : téléchargez les mises à jour sur caisse.bzh."
            : !supported
              ? "Utilisez la version AppImage pour les mises à jour automatiques."
              : "Les mises à jour ne sont pas configurées pour cette version.",
    },
  };
}
