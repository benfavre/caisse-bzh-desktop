// preload.cjs — the only bridge between https://caisse.bzh and the desktop shell.
// Sandboxed; exposes a narrow API. The main process re-checks the calling page.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("caisseDesktop", {
  info: () => ipcRenderer.invoke("desktop:info"),
  // Print the current page (the till's receipt / Z sheet uses print CSS).
  print: () => ipcRenderer.invoke("print:page"),
  printers: () => ipcRenderer.invoke("print:printers"),
  setPrinter: (name) => ipcRenderer.invoke("print:set-printer", String(name || "")),
  printTest: () => ipcRenderer.invoke("print:test"),
  // { autostart?, keepAwake?, kiosk?, startPage? } — re-validated in main.
  setOptions: (patch) => ipcRenderer.invoke("desktop:set", {
    autostart: typeof patch?.autostart === "boolean" ? patch.autostart : undefined,
    keepAwake: typeof patch?.keepAwake === "boolean" ? patch.keepAwake : undefined,
    kiosk: typeof patch?.kiosk === "boolean" ? patch.kiosk : undefined,
    startPage: typeof patch?.startPage === "string" ? patch.startPage : undefined,
  }),
  updateState: () => ipcRenderer.invoke("updates:state"),
  checkUpdates: () => ipcRenderer.invoke("updates:check"),
  installUpdate: () => ipcRenderer.invoke("updates:install"),
  onUpdate: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("updates:state", listener);
    return () => ipcRenderer.removeListener("updates:state", listener);
  },
});
