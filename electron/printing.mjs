// printing.mjs — settings of the till (printer, kiosk, start-up, screen, zoom,
// window) and receipt printing options.
// With a chosen printer, tickets print SILENTLY (no dialog mid-service) on that
// device; without one, the system print dialog is shown as in the browser.
import { readFile, writeFile, rename } from "node:fs/promises";

export const DEFAULT_SETTINGS = Object.freeze({
  printer: "",
  kiosk: false,
  autostart: false,
  keepAwake: true,
  zoom: 1,
  startPage: "caisse",
  bounds: null,
  lastVersion: "",
});

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null);

function cleanBounds(b) {
  if (!b || typeof b !== "object") return null;
  const x = num(b.x), y = num(b.y), width = num(b.width), height = num(b.height);
  if (x === null || y === null || width === null || height === null) return null;
  if (width < 400 || height < 300 || width > 10000 || height > 10000) return null;
  return { x, y, width, height, maximized: b.maximized === true };
}

export function cleanSettings(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const zoom = typeof r.zoom === "number" && Number.isFinite(r.zoom) ? Math.min(3, Math.max(0.5, r.zoom)) : 1;
  return {
    printer: typeof r.printer === "string" ? r.printer.slice(0, 200) : "",
    kiosk: r.kiosk === true,
    autostart: r.autostart === true,
    keepAwake: r.keepAwake !== false,
    zoom: Math.round(zoom * 100) / 100,
    startPage: ["caisse", "cuisine", "tableau"].includes(r.startPage) ? r.startPage : "caisse",
    bounds: cleanBounds(r.bounds),
    lastVersion: typeof r.lastVersion === "string" && /^[0-9A-Za-z.+-]{1,40}$/.test(r.lastVersion) ? r.lastVersion : "",
  };
}

export async function loadSettings(file) {
  try {
    return cleanSettings(JSON.parse(await readFile(file, "utf8")));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

// Atomic write (temp file + rename) so a crash never leaves a corrupt file.
export async function saveSettings(file, settings) {
  const clean = cleanSettings(settings);
  await writeFile(file + ".tmp", JSON.stringify(clean, null, 2));
  await rename(file + ".tmp", file);
  return clean;
}

// Options for webContents.print(). Receipts are narrow: no margins, backgrounds on.
export function printOptions(settings, printers = []) {
  const wanted = String(settings?.printer || "");
  const exists = wanted && printers.some((p) => p && p.name === wanted);
  return exists
    ? { silent: true, deviceName: wanted, printBackground: true, margins: { marginType: "none" } }
    : { silent: false, printBackground: true };
}

// Saved window bounds are reused only if they still overlap a connected screen
// (a till moved from a 2-screen setup must not open off-screen).
export function visibleBounds(bounds, workAreas = []) {
  if (!bounds) return null;
  const overlaps = workAreas.some((a) => {
    const w = Math.min(bounds.x + bounds.width, a.x + a.width) - Math.max(bounds.x, a.x);
    const h = Math.min(bounds.y + bounds.height, a.y + a.height) - Math.max(bounds.y, a.y);
    return w >= 200 && h >= 150;
  });
  return overlaps ? bounds : null;
}

// Linux autostart entry (XDG). Windows/macOS use app.setLoginItemSettings.
export function autostartDesktopEntry(execPath) {
  const exec = '"' + String(execPath).replace(/(["`$\\])/g, "\\$1") + '"';
  return [
    "[Desktop Entry]",
    "Type=Application",
    "Name=caisse.bzh",
    "Comment=La caisse qui suit tout votre service",
    "Exec=" + exec,
    "X-GNOME-Autostart-enabled=true",
    "Terminal=false",
    "",
  ].join("\n");
}
