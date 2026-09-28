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
  assert.deepEqual(await loadSettings(f), { printer: "", kiosk: false });
  await saveSettings(f, { printer: "EPSON_TM_T20", kiosk: true, junk: 1 });
  assert.deepEqual(await loadSettings(f), { printer: "EPSON_TM_T20", kiosk: true });
  await writeFile(f, "{not json");
  assert.deepEqual(await loadSettings(f), { printer: "", kiosk: false });
});
