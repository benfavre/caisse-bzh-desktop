import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadSettings, saveSettings, printOptions } from "../electron/printing.mjs";

test("silent printing only on a chosen printer that exists", () => {
  const printers = [{ name: "EPSON_TM_T20" }, { name: "Office" }];
  assert.deepEqual(printOptions({ printer: "EPSON_TM_T20" }, printers).silent, true);
  assert.equal(printOptions({ printer: "EPSON_TM_T20" }, printers).deviceName, "EPSON_TM_T20");
  assert.equal(printOptions({ printer: "" }, printers).silent, false);
  assert.equal(printOptions({ printer: "Unplugged" }, printers).silent, false, "a removed printer falls back to the dialog");
});
test("settings persist and a corrupt file falls back to defaults", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "cbzh-"));
  const f = path.join(dir, "settings.json");
  assert.equal((await loadSettings(f)).printer, "");
  await saveSettings(f, { printer: "EPSON_TM_T20", kiosk: true, junk: 1 });
  assert.deepEqual([(await loadSettings(f)).printer, (await loadSettings(f)).kiosk], ["EPSON_TM_T20", true]);
  await writeFile(f, "{not json");
  assert.equal((await loadSettings(f)).printer, "");
});
test("new settings are validated and default safely", async () => {
  const { cleanSettings } = await import("../electron/printing.mjs");
  const c = cleanSettings({ keepAwake: "no", zoom: 99, autostart: 1, lastVersion: "1.0.0; rm -rf /", bounds: { x: 0, y: 0, width: 50, height: 50 } });
  assert.equal(c.keepAwake, true, "screen kept awake unless explicitly disabled");
  assert.equal(c.zoom, 3);
  assert.equal(c.autostart, false);
  assert.equal(c.lastVersion, "");
  assert.equal(c.bounds, null, "absurd window size ignored");
  assert.deepEqual(cleanSettings({ bounds: { x: 10, y: 20, width: 1200, height: 800, maximized: true } }).bounds, { x: 10, y: 20, width: 1200, height: 800, maximized: true });
});
test("saved window reopens only on a connected screen", async () => {
  const { visibleBounds } = await import("../electron/printing.mjs");
  const b = { x: 2000, y: 100, width: 1200, height: 800, maximized: false };
  assert.equal(visibleBounds(b, [{ x: 0, y: 0, width: 1920, height: 1080 }]), null, "second screen unplugged");
  assert.deepEqual(visibleBounds(b, [{ x: 0, y: 0, width: 1920, height: 1080 }, { x: 1920, y: 0, width: 1920, height: 1080 }]), b);
});
test("linux autostart entry quotes the AppImage path", async () => {
  const { autostartDesktopEntry } = await import("../electron/printing.mjs");
  const e = autostartDesktopEntry('/home/a b/caisse "x" $HOME.AppImage');
  assert.match(e, /^Exec="\/home\/a b\/caisse \\"x\\" \\\$HOME\.AppImage"$/m);
  assert.match(e, /^Type=Application$/m);
});
test("start page setting is validated", async () => {
  const { cleanSettings } = await import("../electron/printing.mjs");
  assert.equal(cleanSettings({}).startPage, "caisse");
  assert.equal(cleanSettings({ startPage: "cuisine" }).startPage, "cuisine");
  assert.equal(cleanSettings({ startPage: "../evil" }).startPage, "caisse");
});
