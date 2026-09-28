// updater.mjs — electron-updater state machine (from benfavre/caviard, adapted for a till).
// POS rule: an update NEVER restarts the app by itself. It downloads in the
// background and installs when the app is closed (end of service) or when the
// user explicitly chooses « Redémarrer et installer ».
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
    updater.autoDownload = true;
    // Installed at the next normal quit (end of service) — never mid-service.
    updater.autoInstallOnAppQuit = true;
    updater.allowDowngrade = false;
    updater.allowPrerelease = false;
    const listen = (event, handler) => {
      updater.on(event, handler);
      this.listeners.push([event, handler]);
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
  install() {
    if (this.state.phase !== "ready") return { ok: false, reason: "not-ready" };
    if (!this.canInstall())
      return {
        ok: false,
        reason: "unsaved",
        message: "Terminez l'encaissement en cours avant de redémarrer.",
      };
    this.set({ phase: "installing" });
    this.onInstall();
    this.updater.quitAndInstall(false, true);
    return { ok: true };
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
