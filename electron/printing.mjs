// printing.mjs — receipt printing settings for the till.
// With a chosen printer, tickets print SILENTLY (no dialog mid-service) on that
// device; without one, the system print dialog is shown as in the browser.
import { readFile, writeFile, rename } from "node:fs/promises";

export const DEFAULT_SETTINGS = Object.freeze({ printer: "", kiosk: false });

export async function loadSettings(file) {
  try {
    const raw = JSON.parse(await readFile(file, "utf8"));
    return {
      printer: typeof raw.printer === "string" ? raw.printer.slice(0, 200) : "",
      kiosk: raw.kiosk === true,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

// Atomic write (temp file + rename) so a crash never leaves a corrupt file.
export async function saveSettings(file, settings) {
  const clean = { printer: String(settings.printer || "").slice(0, 200), kiosk: settings.kiosk === true };
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
