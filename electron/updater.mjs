// updater.mjs — electron-updater state machine (from benfavre/caviard, adapted for a till).
// POS rule: an update NEVER restarts the app by itself. It downloads in the
// background and installs when the app is closed (end of service) or when the
// user explicitly chooses « Redémarrer et installer ». A till left on day and
// night would never quit, so a ready update also installs at night once the
// computer has been idle for a while (see nightlyInstallDue).
import { EventEmitter } from "node:events";
export class UpdateController extends EventEmitter {
  constructor(
    updater,
    {
      enabled = true,
      reason = "",
      canInstall = () => true,
      onInstall = () => {},
    } = {},
  ) {
    super();
    this.updater = updater;
    this.enabled = enabled;
    this.canInstall = canInstall;
    this.onInstall = onInstall;
    this.state = {
      phase: enabled ? "idle" : "disabled",
      version: null,
      percent: 0,
      message: reason,
    };
    updater.autoDownload = enabled;
    // Main-process recovery checks own installation; quitting alone must never
    // install an update over pending work. Store builds disable self-updates.
    updater.autoInstallOnAppQuit = false;
    updater.allowDowngrade = false;
    updater.allowPrerelease = false;
    const listen = (event, handler) => {
      const listener = (...args) => { if (this.enabled) handler(...args); };
      updater.on(event, listener);
      this.listeners.push([event, listener]);
    };
    this.listeners = [];
    listen("checking-for-update", () =>
      this.set({ phase: "checking", message: "" }),
    );
    listen("update-available", (info) =>
      this.set({
        phase: "downloading",
        version: info.version,
        percent: 0,
        message: "",
      }),
    );
    listen("download-progress", (info) =>
      this.set({
        phase: "downloading",
        percent: Math.max(0, Math.min(100, Number(info.percent) || 0)),
      }),
    );
    listen("update-downloaded", (info) =>
      this.set({
        phase: "ready",
        version: info.version,
        percent: 100,
        message: "",
      }),
    );
    listen("update-not-available", () =>
      this.set({ phase: "current", message: "" }),
    );
    listen("error", () =>
      this.set({
        phase: "error",
        message:
          "Impossible de vérifier ou de télécharger la mise à jour. Réessayez plus tard.",
      }),
    );
  }
  set(next) {
    this.state = { ...this.state, ...next };
    this.emit("state", this.snapshot());
  }
  snapshot() {
    return { ...this.state };
  }
  async check() {
    if (
      !this.enabled ||
      ["downloading", "ready", "installing"].includes(this.state.phase)
    )
      return this.snapshot();
    if (this.pending) return this.pending;
    this.set({ phase: "checking", message: "" });
    this.pending = (async () => {
      try {
        const result = await this.updater.checkForUpdates();
        result?.downloadPromise?.catch(() => {});
      } catch {
        this.set({
          phase: "error",
          message:
            "Impossible de vérifier les mises à jour. Vérifiez votre connexion.",
        });
      } finally {
        this.pending = null;
      }
      return this.snapshot();
    })();
    return this.pending;
  }
  // silent: true for the unattended night install (no installer window on a
  // kiosk till); the explicit « Redémarrer et installer » keeps the visible one.
  install({ silent = false } = {}) {
    if (!this.enabled || this.state.phase !== "ready") return { ok: false, reason: "not-ready" };
    if (!this.canInstall())
      return {
        ok: false,
        reason: "unsaved",
        message: "Ouvrez la caisse, terminez le service et vérifiez les commandes en attente avant de redémarrer.",
      };
    this.set({ phase: "installing" });
    this.onInstall();
    this.updater.quitAndInstall(silent, true);
    return { ok: true };
  }
  // Unsigned macOS builds cannot install updates: they only learn that a newer
  // version exists and point to the download page.
  setManual(version) {
    this.set({ phase: "available", version, percent: 0, message: "Téléchargez la version " + version + " sur caisse.bzh/telecharger." });
  }
  start() {
    if (!this.enabled) return;
    this.startTimer = setTimeout(() => this.check(), 15000);
    this.interval = setInterval(() => this.check(), 4 * 60 * 60 * 1000);
    this.startTimer.unref?.();
    this.interval.unref?.();
  }
  dispose() {
    clearTimeout(this.startTimer);
    clearInterval(this.interval);
    for (const [event, handler] of this.listeners)
      this.updater.off(event, handler);
    this.removeAllListeners();
  }
}

// Unattended install window: between 3:00 and 5:00 (local time) and no keyboard,
// mouse or touch input on the computer for 30 minutes — nobody is serving.
export const NIGHT_START = 3;
export const NIGHT_END = 5;
export const NIGHT_IDLE_SECONDS = 30 * 60;
export function nightlyInstallDue(date, idleSeconds) {
  const h = date.getHours();
  return h >= NIGHT_START && h < NIGHT_END && Number(idleSeconds) >= NIGHT_IDLE_SECONDS;
}

// true when release tag `latest` (e.g. "v1.3.0" or "1.3.0") is newer than `current`.
export function isNewerVersion(latest, current) {
  const parse = (v) => {
    const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(v || "").trim());
    return m ? m.slice(1).map(Number) : null;
  };
  const a = parse(latest), b = parse(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}
