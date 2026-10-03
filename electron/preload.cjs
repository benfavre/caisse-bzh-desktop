// preload.cjs — the only bridge between https://caisse.bzh and the desktop shell.
// Sandboxed; exposes a narrow API. The main process re-checks the calling page.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("caisseDesktop", {
  printDocumentKinds: Object.freeze(["sale", "refund", "z", "service"]),
  info: () => ipcRenderer.invoke("desktop:info"),
  checkpointRead: (input) => ipcRenderer.invoke("recovery:checkpointRead", { scope: input?.scope }),
  checkpointWrite: (input) => ipcRenderer.invoke("recovery:checkpointWrite", input),
  journalRead: (input) => ipcRenderer.invoke("recovery:read", { scope: input?.scope, cursor: input?.cursor }),
  journalAppend: (record) => ipcRenderer.invoke("recovery:append", record),
  recoveryState: (state) => ipcRenderer.invoke("recovery:state", {
    pending: state?.pending, openTickets: state?.openTickets, uncertain: state?.uncertain,
    storageError: state?.storageError, busy: state?.busy, shiftOpen: state?.shiftOpen,
  }),
  // Print the current page (the till's receipt / Z sheet uses print CSS).
  print: (document) => ipcRenderer.invoke("print:page", document ? {
    version: document.version, id: document.id, shopId: document.shopId, training: document.training,
    copyNumber: document.copyNumber, source: document.source, kind: document.kind, blocks: document.blocks,
  } : null),
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
