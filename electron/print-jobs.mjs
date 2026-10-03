import { mkdir, open, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

export function printIdentity(document) {
  if (!document || document.version !== 1 || !/^[a-f0-9]{64}$/.test(document.source?.hash || "") ||
      !Number.isSafeInteger(document.source?.seq) || document.source.seq < 1 ||
      !Number.isSafeInteger(document.copyNumber) || document.copyNumber < 0 ||
      !/^[a-zA-Z0-9_-]{1,100}$/.test(document.shopId || "") || typeof document.training !== "boolean") return null;
  const expected = [document.shopId, document.training ? "training" : "live", document.source.seq, document.source.hash, document.copyNumber].join(":");
  return document.id === expected ? expected : null;
}

// Persist a claim before handing anything to the OS spooler. Existing claims,
// including a process killed mid-print, are never submitted a second time.
export async function submitPrint(directory, document, send) {
  const id = printIdentity(document);
  if (!id) return { ok: false, error: "Document indisponible. Ouvrez le ticket dans le journal fiscal." };
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, createHash("sha256").update(id).digest("hex") + ".json");
  let handle;
  try { handle = await open(file, "wx", 0o600); }
  catch (error) {
    if (error.code !== "EEXIST") throw error;
    const previous = await readFile(file, "utf8").then(JSON.parse).catch(() => ({ state: "unknown" }));
    return { ok: false, state: previous.state === "pending" ? "unknown" : previous.state, error: "Document déjà envoyé ou résultat incertain. Vérifiez le papier, puis demandez un duplicata depuis le journal." };
  }
  try {
    await handle.writeFile(JSON.stringify({ id, state: "pending", at: Date.now() })); await handle.sync();
    // The directory entry must survive power loss as well as the file contents.
    if (process.platform !== "win32") { const dir = await open(directory, "r"); try { await dir.sync(); } finally { await dir.close(); } }
    let result;
    try { result = await send(); }
    catch { result = { ok: false, error: "Résultat d’impression inconnu. Vérifiez le papier avant de demander un duplicata." }; }
    const state = result.ok ? "submitted" : "unknown";
    await handle.truncate(0); await handle.write(JSON.stringify({ id, state, at: Date.now() }), 0, "utf8"); await handle.sync();
    return { ...result, state };
  } finally { await handle.close(); }
}
