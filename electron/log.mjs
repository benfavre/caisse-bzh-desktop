// log.mjs — a small append-only log in the user data folder (updates, crashes),
// capped so it never grows without bound. Used for support: menu Aide ›
// « Ouvrir le journal de l'application ».
import { appendFileSync, statSync, renameSync, mkdirSync } from "node:fs";
import path from "node:path";

const MAX = 512 * 1024;

export function createLogger(dir) {
  const file = path.join(dir, "caisse-bzh.log");
  try { mkdirSync(dir, { recursive: true }); } catch {}
  const write = (level, args) => {
    const line = new Date().toISOString() + " " + level + " " + args.map((a) => (a instanceof Error ? a.stack || a.message : typeof a === "string" ? a : JSON.stringify(a))).join(" ") + "\n";
    try {
      if (statSync(file, { throwIfNoEntry: false })?.size > MAX) renameSync(file, file + ".1");
      appendFileSync(file, line);
    } catch {}
  };
  return {
    file,
    info: (...a) => write("INFO", a),
    warn: (...a) => write("WARN", a),
    error: (...a) => write("ERROR", a),
    debug: () => {},
  };
}
