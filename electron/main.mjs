// main.mjs — caisse.bzh desktop: a secure shell around https://caisse.bzh.
//  • the web app keeps its own logic, offline shell and updates (server-side);
//  • the shell adds what a till needs: silent receipt printing on a chosen
//    printer, kiosk / fullscreen, a persistent session, and self-updates that
//    never interrupt a service (installed at quit or on explicit request).
import { app, BrowserWindow, Menu, dialog, ipcMain, net, session, shell } from "electron";
import path from "node:path";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import electronUpdater from "electron-updater";
import { START_URL, APP_ORIGIN, isInAppUrl, isAppPage, externalUrl, shortcutUrl } from "./security.mjs";
import { UpdateController } from "./updater.mjs";
import { loadSettings, saveSettings, printOptions } from "./printing.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
let win = null;
let controller = null;
let settings = { printer: "", kiosk: false };
let settingsFile = "";
let retryTimer = null;

if (!app.requestSingleInstanceLock()) app.quit();
app.on("second-instance", () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

function trusted(event) {
  const url = event.senderFrame?.url || "";
  if (!isAppPage(url)) throw new Error("Untrusted caller");
}

function showOffline() {
  if (!win || win.isDestroyed()) return;
  win.loadFile(path.join(here, "offline.html")).catch(() => {});
  clearInterval(retryTimer);
  // Come back on our own as soon as caisse.bzh answers again.
  retryTimer = setInterval(() => {
    if (!net.isOnline()) return;
    const req = net.request({ method: "HEAD", url: APP_ORIGIN + "/" });
    req.on("response", (res) => {
      if (res.statusCode < 500) {
        clearInterval(retryTimer);
        win?.loadURL(START_URL).catch(() => {});
      }
    });
    req.on("error", () => {});
    req.end();
  }, 15000);
}

async function printersList() {
  return win ? await win.webContents.getPrintersAsync() : [];
}

async function buildMenu() {
  const printers = await printersList().catch(() => []);
  const upd = controller?.snapshot() || { phase: "disabled" };
  const go = (name) => () => win?.loadURL(shortcutUrl(name));
  const setPrinter = async (name) => {
    settings = await saveSettings(settingsFile, { ...settings, printer: name });
    buildMenu();
  };
  const template = [
    ...(process.platform === "darwin" ? [{ role: "appMenu" }] : []),
    {
      label: "caisse.bzh",
      submenu: [
        { label: "À propos de caisse.bzh", click: () => dialog.showMessageBox(win, { type: "info", title: "caisse.bzh", message: "caisse.bzh " + app.getVersion(), detail: "La caisse qui suit tout votre service.\nby Inklura — Fait en Bretagne\nhttps://caisse.bzh" }) },
        { type: "separator" },
        { label: "Rechercher des mises à jour", enabled: upd.phase !== "disabled", click: () => controller?.check() },
        {
          label: upd.phase === "ready" ? "Redémarrer et installer la version " + upd.version : "Aucune mise à jour prête",
          enabled: upd.phase === "ready",
          click: async () => {
            const r = await dialog.showMessageBox(win, { type: "question", buttons: ["Redémarrer maintenant", "Plus tard"], defaultId: 1, cancelId: 1, message: "Installer la mise à jour maintenant ?", detail: "Assurez-vous qu'aucun encaissement n'est en cours. Sinon, elle s'installera automatiquement à la fermeture de l'application." });
            if (r.response === 0) controller?.install();
          },
        },
        { type: "separator" },
        { role: "quit", label: "Quitter" },
      ],
    },
    {
      label: "Aller à",
      submenu: [
        { label: "Caisse", accelerator: "CmdOrCtrl+1", click: go("caisse") },
        { label: "Cuisine", accelerator: "CmdOrCtrl+2", click: go("cuisine") },
        { label: "Tableau de bord", accelerator: "CmdOrCtrl+3", click: go("tableau") },
        { label: "Journal fiscal", accelerator: "CmdOrCtrl+4", click: go("fiscal") },
        { type: "separator" },
        { label: "Précédent", accelerator: "Alt+Left", click: () => win?.webContents.navigationHistory?.goBack?.() },
      ],
    },
    {
      label: "Imprimante",
      submenu: [
        { label: "Toujours demander (boîte d'impression)", type: "radio", checked: !settings.printer, click: () => setPrinter("") },
        ...(printers.length ? [{ type: "separator" }] : [{ label: "Aucune imprimante détectée", enabled: false }]),
        ...printers.map((p) => ({ label: p.displayName || p.name, type: "radio", checked: settings.printer === p.name, click: () => setPrinter(p.name) })),
        { type: "separator" },
        { label: "Actualiser la liste", click: () => buildMenu() },
      ],
    },
    {
      label: "Affichage",
      submenu: [
        { role: "reload", label: "Recharger" },
        { role: "togglefullscreen", label: "Plein écran" },
        {
          label: "Mode kiosque au démarrage",
          type: "checkbox",
          checked: settings.kiosk,
          click: async (item) => {
            settings = await saveSettings(settingsFile, { ...settings, kiosk: item.checked });
            win?.setKiosk(item.checked);
          },
        },
        { type: "separator" },
        { role: "zoomIn", label: "Agrandir" },
        { role: "zoomOut", label: "Réduire" },
        { role: "resetZoom", label: "Taille réelle" },
      ],
    },
    {
      label: "Aide",
      submenu: [
        { label: "Centre d'aide", click: go("aide") },
        { label: "Nous écrire", click: () => shell.openExternal("mailto:bonjour@caisse.bzh") },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  win = new BrowserWindow({
    width: 1366,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    title: "caisse.bzh",
    backgroundColor: "#102A43",
    icon: path.join(here, "..", "build", "icon.png"),
    kiosk: settings.kiosk,
    show: false,
    webPreferences: {
      preload: path.join(here, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: false,
      spellcheck: false,
    },
  });
  win.once("ready-to-show", () => win.show());
  // The web app can recognise the desktop shell (e.g. to offer silent printing).
  win.webContents.setUserAgent(win.webContents.getUserAgent() + " caisse-bzh-desktop/" + app.getVersion());

  win.webContents.on("will-navigate", (event, url) => {
    if (url.startsWith("file://")) return;
    if (!isInAppUrl(url)) {
      event.preventDefault();
      const ext = externalUrl(url);
      if (ext) shell.openExternal(ext);
    }
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isInAppUrl(url)) win.loadURL(url);
    else {
      const ext = externalUrl(url);
      if (ext) shell.openExternal(ext);
    }
    return { action: "deny" };
  });
  win.webContents.on("did-fail-load", (_e, code, _desc, url, isMainFrame) => {
    // -3 = aborted (a normal redirect/navigation), ignore it.
    if (isMainFrame && code !== -3 && isInAppUrl(url)) showOffline();
  });
  win.webContents.on("did-navigate-in-page", (_e, url) => {
    if (url.startsWith("file://") && url.includes("#retry-")) win.loadURL(START_URL).catch(() => showOffline());
  });
  win.on("page-title-updated", (e) => e.preventDefault());
  win.loadURL(START_URL).catch(() => showOffline());
}

app.whenReady().then(async () => {
  settingsFile = path.join(app.getPath("userData"), "settings.json");
  settings = await loadSettings(settingsFile);

  // The till needs no camera, microphone, geolocation or notifications.
  session.defaultSession.setPermissionRequestHandler((_c, _p, cb) => cb(false));
  session.defaultSession.setPermissionCheckHandler(() => false);

  const { autoUpdater } = electronUpdater;
  autoUpdater.logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
  const configured = existsSync(path.join(process.resourcesPath, "app-update.yml"));
  const metadata = JSON.parse(await readFile(path.join(app.getAppPath(), "package.json"), "utf8"));
  const signedMac = process.platform !== "darwin" || metadata.macAutoUpdates === true;
  const supported = (process.platform !== "linux" || !!process.env.APPIMAGE) && signedMac;
  const enabled = app.isPackaged && configured && supported;
  controller = new UpdateController(autoUpdater, {
    enabled,
    reason: !app.isPackaged
      ? "Les mises à jour sont disponibles dans la version installée."
      : !signedMac
        ? "Version macOS non signée : téléchargez les mises à jour sur caisse.bzh."
        : !supported
          ? "Utilisez la version AppImage pour les mises à jour automatiques."
          : "Les mises à jour ne sont pas configurées pour cette version.",
  });
  controller.on("state", (state) => {
    if (win && !win.isDestroyed()) win.webContents.send("updates:state", state);
    buildMenu();
  });

  ipcMain.handle("desktop:info", (event) => {
    trusted(event);
    return { version: app.getVersion(), platform: process.platform, printer: settings.printer || null, kiosk: settings.kiosk };
  });
  ipcMain.handle("print:printers", async (event) => {
    trusted(event);
    return (await printersList()).map((p) => ({ name: p.name, displayName: p.displayName || p.name, isDefault: !!p.isDefault }));
  });
  ipcMain.handle("print:set-printer", async (event, name) => {
    trusted(event);
    settings = await saveSettings(settingsFile, { ...settings, printer: String(name || "") });
    buildMenu();
    return { ok: true, printer: settings.printer || null };
  });
  ipcMain.handle("print:page", async (event) => {
    trusted(event);
    const opts = printOptions(settings, await printersList());
    return await new Promise((resolve) => {
      event.sender.print(opts, (success, failureReason) => resolve({ ok: !!success, silent: !!opts.silent, error: success ? null : String(failureReason || "") }));
    });
  });
  ipcMain.handle("updates:state", (event) => { trusted(event); return controller.snapshot(); });
  ipcMain.handle("updates:check", (event) => { trusted(event); return controller.check(); });
  ipcMain.handle("updates:install", (event) => { trusted(event); return controller.install(); });

  createWindow();
  await buildMenu();
  controller.start();
});

app.on("window-all-closed", () => app.quit());
app.on("web-contents-created", (_e, contents) => {
  contents.on("will-attach-webview", (event) => event.preventDefault());
});
