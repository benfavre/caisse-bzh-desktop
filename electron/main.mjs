// main.mjs — caisse.bzh desktop: a secure shell around https://caisse.bzh.
//  • the web app keeps its own logic, offline shell and updates (server-side);
//  • the shell adds what a till needs: silent receipt printing on a chosen
//    printer (with a test ticket), kiosk / fullscreen, start with the computer,
//    screen kept awake, remembered window and zoom, a persistent session, crash
//    recovery, and self-updates that never interrupt a service (installed at
//    quit or on explicit request).
import { app, BrowserWindow, Menu, Notification, clipboard, dialog, ipcMain, net, powerMonitor, powerSaveBlocker, screen, session, shell } from "electron";
import path from "node:path";
import os from "node:os";
import { existsSync } from "node:fs";
import { readFile, writeFile, unlink, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import electronUpdater from "electron-updater";
import { APP_ORIGIN, isInAppUrl, isAppPage, externalUrl, shortcutUrl, permissionAllowed, startUrl } from "./security.mjs";
import { UpdateController, nightlyInstallDue, isNewerVersion } from "./updater.mjs";
import { loadSettings, saveSettings, printOptions, visibleBounds, autostartDesktopEntry, DEFAULT_SETTINGS } from "./printing.mjs";
import { createLogger } from "./log.mjs";
import { desktopDistribution } from "./distribution.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
let win = null;
let controller = null;
let settings = { ...DEFAULT_SETTINGS };
let settingsFile = "";
let retryTimer = null;
let awakeId = null;
let boundsTimer = null;
let crashes = [];
let lastAppUrl = "";
let frozenTimer = null;
let log = { info() {}, warn() {}, error() {}, debug() {}, file: "" };
let distribution = desktopDistribution({ platform: process.platform, windowsStore: process.windowsStore, appImage: !!process.env.APPIMAGE });

// A second launch only brings the running till to the front; it must not go on
// to open its own window, updater or log.
const primary = app.requestSingleInstanceLock();
if (!primary) app.quit();
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

async function update(patch) {
  settings = await saveSettings(settingsFile, { ...settings, ...patch });
  return settings;
}

const CHANGELOG_URL = APP_ORIGIN + "/nouveautes/application-de-bureau";
// Held until clicked or closed: a collected Notification drops its click handler.
const shown = new Set();

function notify(title, body, onClick) {
  try {
    if (!Notification.isSupported()) return;
    const n = new Notification({ title, body, silent: true });
    shown.add(n);
    n.on("click", () => { shown.delete(n); onClick?.(); });
    n.on("close", () => shown.delete(n));
    n.show();
  } catch {}
}

// Where to come back to after a crash, a freeze or a network outage: the page
// the till was on (a kitchen screen stays on Cuisine), else its start page.
const recoverUrl = () => lastAppUrl || startUrl(settings.startPage);

function showOffline() {
  if (!win || win.isDestroyed()) return;
  win.loadFile(path.join(here, "offline.html")).catch(() => {});
  clearInterval(retryTimer);
  // Come back on our own as soon as caisse.bzh answers again.
  retryTimer = setInterval(() => {
    if (!win || win.isDestroyed()) return clearInterval(retryTimer);
    if (!net.isOnline()) return;
    const req = net.request({ method: "HEAD", url: APP_ORIGIN + "/" });
    req.on("response", (res) => {
      res.on("data", () => {});
      res.on("error", () => {});
      if (res.statusCode < 500) {
        clearInterval(retryTimer);
        win?.loadURL(recoverUrl()).catch(() => {});
      }
    });
    req.on("error", () => {});
    req.end();
  }, 15000);
}

// ── keep the till's screen on during service ─────────────────────────────────
function applyKeepAwake() {
  if (settings.keepAwake && awakeId === null) awakeId = powerSaveBlocker.start("prevent-display-sleep");
  if (!settings.keepAwake && awakeId !== null) {
    powerSaveBlocker.stop(awakeId);
    awakeId = null;
  }
}

// ── start with the computer ──────────────────────────────────────────────────
const autostartFile = () => path.join(app.getPath("appData"), "autostart", "caisse-bzh.desktop");
async function applyAutostart() {
  if (!app.isPackaged || distribution.store) return;
  try {
    if (process.platform === "linux") {
      // Only an AppImage has a stable path to relaunch; refreshed at each start
      // since an update may have replaced the file.
      if (settings.autostart && process.env.APPIMAGE) {
        await mkdir(path.dirname(autostartFile()), { recursive: true });
        await writeFile(autostartFile(), autostartDesktopEntry(process.env.APPIMAGE));
      } else await unlink(autostartFile()).catch(() => {});
    } else {
      app.setLoginItemSettings({ openAtLogin: settings.autostart });
    }
  } catch (e) {
    log.warn("autostart", e);
  }
}
const autostartSupported = () => distribution.autostartSupported;

// ── printing ─────────────────────────────────────────────────────────────────
async function printersList() {
  return win ? await win.webContents.getPrintersAsync() : [];
}

async function printTestTicket() {
  const printers = await printersList().catch(() => []);
  const opts = printOptions(settings, printers);
  const w = new BrowserWindow({ show: false, width: 320, height: 600, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  try {
    await w.loadFile(path.join(here, "test-ticket.html"), { query: { printer: opts.silent ? settings.printer : "", v: app.getVersion() } });
    const r = await new Promise((resolve) => w.webContents.print(opts, (ok, reason) => resolve({ ok, reason })));
    if (!r.ok && r.reason && r.reason !== "cancelled") {
      log.warn("test print failed", r.reason);
      dialog.showMessageBox(win, { type: "warning", message: "Le ticket de test n'a pas pu être imprimé.", detail: String(r.reason) + "\n\nVérifiez que l'imprimante est allumée, reliée et qu'il reste du papier." });
    } else if (r.ok && opts.silent) notify("caisse.bzh", "Ticket de test envoyé à " + settings.printer);
    return { ok: !!r.ok, silent: !!opts.silent, error: r.ok ? null : String(r.reason || "") };
  } catch (e) {
    log.warn("test print", e);
    return { ok: false, silent: false, error: String(e?.message || e) };
  } finally {
    if (!w.isDestroyed()) w.destroy();
  }
}

// ── support ──────────────────────────────────────────────────────────────────
function diagnostics() {
  const upd = controller?.snapshot() || {};
  return [
    "caisse.bzh " + app.getVersion() + " (Electron " + process.versions.electron + ")",
    "Système : " + process.platform + " " + os.release() + " " + process.arch + (process.env.APPIMAGE ? " · AppImage" : ""),
    "Imprimante : " + (settings.printer || "boîte d'impression"),
    "Kiosque : " + (settings.kiosk ? "oui" : "non") + " · Démarrage auto : " + (autostartSupported() && settings.autostart ? "oui" : "non") + " · Écran allumé : " + (settings.keepAwake ? "oui" : "non") + " · Zoom : " + Math.round(settings.zoom * 100) + " %" + " · Page au démarrage : " + settings.startPage,
    "Mises à jour : " + (upd.phase || "?") + (upd.version ? " " + upd.version : "") + (upd.message ? " — " + upd.message : ""),
    "Page : " + (win && !win.isDestroyed() ? win.webContents.getURL().split("?")[0] : "-"),
  ].join("\n");
}

async function buildMenu() {
  const printers = await printersList().catch(() => []);
  const upd = controller?.snapshot() || { phase: "disabled" };
  const go = (name) => () => win?.loadURL(shortcutUrl(name));
  const setPrinter = async (name) => {
    await update({ printer: name });
    buildMenu();
  };
  const updLabel =
    distribution.store ? "Mises à jour via Microsoft Store"
    : upd.phase === "downloading" ? "Téléchargement de la version " + (upd.version || "") + " (" + Math.round(upd.percent || 0) + " %)"
    : upd.phase === "checking" ? "Recherche en cours…"
    : upd.phase === "current" ? "caisse.bzh est à jour"
    : upd.phase === "error" ? "Mise à jour indisponible — réessayer"
    : upd.phase === "available" ? "Télécharger la version " + upd.version
    : "Rechercher des mises à jour";
  const template = [
    ...(process.platform === "darwin" ? [{ role: "appMenu" }] : []),
    {
      label: "caisse.bzh",
      submenu: [
        { label: "À propos de caisse.bzh", click: () => dialog.showMessageBox(win, { type: "info", title: "caisse.bzh", message: "caisse.bzh " + app.getVersion(), detail: "La caisse qui suit tout votre service.\nby Inklura — Fait en Bretagne\nhttps://caisse.bzh" }) },
        { type: "separator" },
        { label: updLabel, enabled: upd.phase !== "disabled" && !["downloading", "checking", "ready", "installing"].includes(upd.phase), click: () => (upd.phase === "available" ? shell.openExternal(APP_ORIGIN + "/telecharger") : controller?.check()) },
        {
          label: upd.phase === "ready" ? "Redémarrer et installer la version " + upd.version : "Aucune mise à jour prête",
          enabled: upd.phase === "ready",
          click: async () => {
            const r = await dialog.showMessageBox(win, { type: "question", buttons: ["Redémarrer maintenant", "Plus tard"], defaultId: 1, cancelId: 1, message: "Installer la mise à jour maintenant ?", detail: "Assurez-vous qu'aucun encaissement n'est en cours. Sinon, elle s'installera automatiquement à la fermeture de l'application, ou cette nuit si le poste reste allumé." });
            if (r.response === 0) controller?.install();
          },
        },
        ...(upd.phase === "disabled" && upd.message ? [{ label: upd.message, enabled: false }] : []),
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
        ...printers.map((p) => ({ label: (p.displayName || p.name) + (p.isDefault ? " (par défaut)" : ""), type: "radio", checked: settings.printer === p.name, click: () => setPrinter(p.name) })),
        { type: "separator" },
        { label: "Imprimer un ticket de test", accelerator: "CmdOrCtrl+Shift+P", click: () => printTestTicket() },
        { label: "Actualiser la liste", click: () => buildMenu() },
      ],
    },
    {
      label: "Poste",
      submenu: [
        {
          // In kiosk mode the menu bar is hidden: this shortcut is the way out.
          label: "Mode kiosque (retenu au démarrage)",
          type: "checkbox",
          checked: settings.kiosk,
          accelerator: "CmdOrCtrl+Shift+K",
          click: (item) => setKiosk(item.checked),
        },
        {
          label: "Lancer au démarrage de l'ordinateur",
          type: "checkbox",
          checked: autostartSupported() && settings.autostart,
          enabled: autostartSupported(),
          click: async (item) => {
            await update({ autostart: item.checked });
            applyAutostart();
          },
        },
        {
          label: "Garder l'écran allumé",
          type: "checkbox",
          checked: settings.keepAwake,
          click: async (item) => {
            await update({ keepAwake: item.checked });
            applyKeepAwake();
          },
        },
        {
          label: "Page au démarrage",
          submenu: [["caisse", "Caisse"], ["cuisine", "Cuisine (écran de cuisine)"], ["tableau", "Tableau de bord"]].map(([id, label]) => ({
            label,
            type: "radio",
            checked: settings.startPage === id,
            click: async () => { await update({ startPage: id }); buildMenu(); },
          })),
        },
        { type: "separator" },
        { role: "reload", label: "Recharger" },
        { role: "togglefullscreen", label: "Plein écran" },
        { type: "separator" },
        { label: "Agrandir", accelerator: "CmdOrCtrl+=", click: () => setZoom(settings.zoom + 0.1) },
        { label: "Réduire", accelerator: "CmdOrCtrl+-", click: () => setZoom(settings.zoom - 0.1) },
        { label: "Taille réelle (" + Math.round(settings.zoom * 100) + " %)", accelerator: "CmdOrCtrl+0", click: () => setZoom(1) },
      ],
    },
    {
      label: "Aide",
      submenu: [
        { label: "Centre d'aide", click: go("aide") },
        { label: "Guide de l'application de bureau", click: () => shell.openExternal(APP_ORIGIN + "/docs/application-de-bureau") },
        { label: "Nouveautés de l'application", click: () => shell.openExternal(CHANGELOG_URL) },
        { label: "Nous écrire", click: () => shell.openExternal("mailto:bonjour@caisse.bzh?subject=" + encodeURIComponent("caisse.bzh " + app.getVersion()) + "&body=" + encodeURIComponent("\n\n---\n" + diagnostics())) },
        { type: "separator" },
        { label: "Copier les informations de diagnostic", click: () => { clipboard.writeText(diagnostics()); notify("caisse.bzh", "Informations copiées"); } },
        { label: "Ouvrir le journal de l'application", click: () => log.file && shell.showItemInFolder(log.file) },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function setKiosk(on) {
  await update({ kiosk: on });
  win?.setKiosk(on);
  buildMenu();
}

async function setZoom(z) {
  const zoom = Math.round(Math.min(3, Math.max(0.5, z)) * 10) / 10;
  win?.webContents.setZoomFactor(zoom);
  await update({ zoom });
  buildMenu();
}

// ── window ───────────────────────────────────────────────────────────────────
function saveBoundsSoon() {
  clearTimeout(boundsTimer);
  boundsTimer = setTimeout(() => {
    if (!win || win.isDestroyed() || win.isKiosk() || win.isFullScreen() || win.isMinimized()) return;
    const b = win.getNormalBounds();
    update({ bounds: { ...b, maximized: win.isMaximized() } }).catch(() => {});
  }, 800);
}

function createWindow() {
  const saved = visibleBounds(settings.bounds, screen.getAllDisplays().map((d) => d.workArea));
  win = new BrowserWindow({
    width: saved?.width || 1366,
    height: saved?.height || 860,
    ...(saved ? { x: saved.x, y: saved.y } : {}),
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
  win.once("ready-to-show", () => {
    if (saved?.maximized && !settings.kiosk) win.maximize();
    win.show();
  });
  // The web app can recognise the desktop shell (e.g. to offer silent printing).
  win.webContents.setUserAgent(win.webContents.getUserAgent() + " caisse-bzh-desktop/" + app.getVersion());
  win.webContents.on("did-finish-load", () => win?.webContents.setZoomFactor(settings.zoom));
  for (const ev of ["resize", "move", "maximize", "unmaximize"]) win.on(ev, saveBoundsSoon);

  win.webContents.on("will-navigate", (event, url) => {
    if (url.startsWith("file://")) return;
    if (!isInAppUrl(url)) {
      event.preventDefault();
      const ext = externalUrl(url);
      if (ext) shell.openExternal(ext);
    }
  });
  // will-navigate does not see server redirects (3xx): guard them too.
  win.webContents.on("will-redirect", (event) => {
    if (!event.isMainFrame || isInAppUrl(event.url)) return;
    event.preventDefault();
    log.warn("redirect blocked", event.url.split("?")[0]);
    const ext = externalUrl(event.url);
    if (ext) shell.openExternal(ext);
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
    if (url.startsWith("file://") && url.includes("#retry-")) win.loadURL(recoverUrl()).catch(() => showOffline());
  });
  // A crashed or frozen page must not leave a till on a blank screen: reload
  // (at most 3 times in 5 minutes, then the offline page with its retry button).
  win.webContents.on("render-process-gone", (_e, details) => {
    log.error("renderer gone", details);
    if (details.reason === "clean-exit") return;
    const now = Date.now();
    crashes = crashes.filter((t) => now - t < 5 * 60 * 1000).concat(now);
    if (crashes.length <= 3) win?.loadURL(recoverUrl()).catch(() => showOffline());
    else showOffline();
  });
  // A page frozen for a minute is reloaded where it was: a stuck till is worse
  // than a reload (the order in progress is kept by the page itself).
  win.on("unresponsive", () => {
    log.warn("window unresponsive");
    clearTimeout(frozenTimer);
    frozenTimer = setTimeout(() => {
      if (!win || win.isDestroyed()) return;
      log.error("window frozen for 60 s, reloading");
      win.webContents.forcefullyCrashRenderer();
    }, 60000);
  });
  win.on("responsive", () => clearTimeout(frozenTimer));
  const remember = (url) => {
    if (isAppPage(url) && new URL(url).pathname.startsWith("/app")) lastAppUrl = url;
  };
  win.webContents.on("did-navigate", (_e, url) => remember(url));
  win.webContents.on("did-navigate-in-page", (_e, url, isMainFrame) => isMainFrame && remember(url));
  win.on("page-title-updated", (e) => e.preventDefault());
  win.loadURL(startUrl(settings.startPage)).catch(() => showOffline());
}

app.whenReady().then(async () => {
  if (!primary) return;
  const metadata = JSON.parse(await readFile(path.join(app.getAppPath(), "package.json"), "utf8"));
  distribution = desktopDistribution({
    platform: process.platform,
    windowsStore: process.windowsStore,
    storeBuild: metadata.windowsStoreBuild === true,
    appImage: !!process.env.APPIMAGE,
    macAutoUpdates: metadata.macAutoUpdates === true,
    isPackaged: app.isPackaged,
    updatesConfigured: existsSync(path.join(process.resourcesPath, "app-update.yml")),
  });
  settingsFile = path.join(app.getPath("userData"), "settings.json");
  log = createLogger(path.join(app.getPath("userData"), "logs"));
  settings = await loadSettings(settingsFile);
  log.info("start", app.getVersion(), process.platform, process.arch, process.env.APPIMAGE ? "appimage" : "");
  log.info("distribution", distribution.store ? "microsoft-store" : "direct", "self-updates", distribution.updates.enabled, "autostart", distribution.autostartSupported);

  // « Mis à jour » : first launch of a new version after an update.
  const updatedFrom = settings.lastVersion && settings.lastVersion !== app.getVersion() ? settings.lastVersion : "";
  if (settings.lastVersion !== app.getVersion()) await update({ lastVersion: app.getVersion() });
  if (updatedFrom) {
    log.info("updated", updatedFrom, "->", app.getVersion());
    notify("caisse.bzh est à jour", "Version " + app.getVersion() + " installée (précédente : " + updatedFrom + "). Cliquez pour voir les nouveautés.", () => shell.openExternal(CHANGELOG_URL));
  }

  // The till needs no camera, microphone, geolocation or notifications; only
  // clipboard writes (« Copier » buttons) and fullscreen, for caisse.bzh pages.
  session.defaultSession.setPermissionRequestHandler((contents, permission, cb, details) =>
    cb(permissionAllowed(permission, details?.requestingUrl || contents?.getURL?.() || "")));
  session.defaultSession.setPermissionCheckHandler((_c, permission, origin) => permissionAllowed(permission, origin));

  const { autoUpdater } = electronUpdater;
  autoUpdater.logger = log;
  controller = new UpdateController(autoUpdater, distribution.updates);
  let lastPhase = "";
  controller.on("state", (state) => {
    if (win && !win.isDestroyed()) win.webContents.send("updates:state", state);
    if (state.phase !== lastPhase) log.info("update", state.phase, state.version || "", state.message || "");
    if (state.phase === "ready" && lastPhase !== "ready") notify("Mise à jour prête", "caisse.bzh " + state.version + " s'installera à la fermeture de l'application, ou cette nuit si le poste reste allumé.");
    lastPhase = state.phase;
    buildMenu();
  });

  ipcMain.handle("desktop:info", (event) => {
    trusted(event);
    return {
      version: app.getVersion(),
      platform: process.platform,
      printer: settings.printer || null,
      kiosk: settings.kiosk,
      autostart: autostartSupported() && settings.autostart,
      autostartSupported: autostartSupported(),
      keepAwake: settings.keepAwake,
      startPage: settings.startPage,
      updatedFrom: updatedFrom || null,
    };
  });
  ipcMain.handle("print:printers", async (event) => {
    trusted(event);
    return (await printersList()).map((p) => ({ name: p.name, displayName: p.displayName || p.name, isDefault: !!p.isDefault }));
  });
  ipcMain.handle("print:set-printer", async (event, name) => {
    trusted(event);
    await update({ printer: String(name || "") });
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
  ipcMain.handle("print:test", async (event) => { trusted(event); return await printTestTicket(); });
  ipcMain.handle("desktop:set", async (event, patch) => {
    trusted(event);
    const p = patch && typeof patch === "object" ? patch : {};
    const next = {};
    if (typeof p.autostart === "boolean" && autostartSupported()) next.autostart = p.autostart;
    if (typeof p.keepAwake === "boolean") next.keepAwake = p.keepAwake;
    if (typeof p.kiosk === "boolean") next.kiosk = p.kiosk;
    if (["caisse", "cuisine", "tableau"].includes(p.startPage)) next.startPage = p.startPage;
    await update(next);
    if ("autostart" in next) applyAutostart();
    if ("keepAwake" in next) applyKeepAwake();
    if ("kiosk" in next) win?.setKiosk(next.kiosk);
    buildMenu();
    return { ok: true, autostart: autostartSupported() && settings.autostart, keepAwake: settings.keepAwake, kiosk: settings.kiosk, startPage: settings.startPage };
  });
  ipcMain.handle("updates:state", (event) => { trusted(event); return controller.snapshot(); });
  ipcMain.handle("updates:check", (event) => { trusted(event); return controller.check(); });
  ipcMain.handle("updates:install", (event) => { trusted(event); return controller.install(); });

  applyKeepAwake();
  applyAutostart();
  createWindow();
  await buildMenu();
  controller.start();

  // Unsigned macOS: no self-update, but say when a newer version is out.
  if (distribution.manualMacUpdates) {
    let told = "";
    const checkManual = async () => {
      try {
        const r = await net.fetch("https://api.github.com/repos/benfavre/caisse-bzh-desktop/releases/latest", { headers: { accept: "application/vnd.github+json" } });
        if (!r.ok) return;
        const tag = String((await r.json()).tag_name || "");
        if (!isNewerVersion(tag, app.getVersion())) return;
        const version = tag.replace(/^v/, "");
        controller.setManual(version);
        if (told !== version) notify("Nouvelle version de caisse.bzh", "La version " + version + " est disponible sur caisse.bzh/telecharger.");
        told = version;
      } catch (e) {
        log.warn("manual update check", e);
      }
    };
    setTimeout(checkManual, 15000).unref?.();
    setInterval(checkManual, 4 * 60 * 60 * 1000).unref?.();
  }

  // A till that is never closed still gets its updates: at night, once nobody
  // has touched the computer for 30 minutes, install silently and reopen.
  setInterval(() => {
    if (controller.snapshot().phase !== "ready") return;
    if (!nightlyInstallDue(new Date(), powerMonitor.getSystemIdleTime())) return;
    log.info("night install", controller.snapshot().version);
    controller.install({ silent: true });
  }, 10 * 60 * 1000).unref?.();
});

process.on("uncaughtException", (e) => log.error("uncaught", e));
app.on("window-all-closed", () => app.quit());
app.on("web-contents-created", (_e, contents) => {
  contents.on("will-attach-webview", (event) => event.preventDefault());
});
