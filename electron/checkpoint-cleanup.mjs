import { opendir, lstat, readFile, unlink, open } from 'node:fs/promises';
import path from 'node:path';
import { readCheckpoint, withCheckpointLock } from './recovery-checkpoint.mjs';
import { checkpointRoot, orphanCheckpointReference, verifyCheckpointParts } from './checkpoint-fragments.mjs';

// One directory iterator per collector. No full directory listing, age-based
// deletion, or persistent metadata required. A restart begins a fresh pass.
export async function collectCheckpointBatch(directory, scope, scan = {}) {
  return withCheckpointLock(directory, async () => {
    let examined = 0, retired = 0, cleanupPending = false;
    try {
      const { checkpoint: parent } = await readCheckpoint(directory, { scope });
      checkpointRoot(parent);
      if (parent.scope !== scope) throw new Error('Recovery scope changed');
      const proof = JSON.stringify(parent);
      if (scan.proof !== proof) {
        const refs = await verifyCheckpointParts(parent, async key => (await readCheckpoint(directory, { scope: key })).checkpoint);
        scan.retained = new Set(refs.map(ref => ref.scope)); scan.proof = proof;
      }
      scan.reader ||= await opendir(directory);
      for (; examined < 8; examined++) {
        const entry = await scan.reader.read();
        if (!entry) { await scan.reader.close(); scan.reader = null; break; }
        if (!entry.isFile() || !/^[a-f0-9]{64}\.json$/.test(entry.name)) continue;
        const key = entry.name.slice(0, -5);
        if (key === scope || scan.retained.has(key)) continue;
        try {
          const file = path.join(directory, entry.name), info = await lstat(file);
          if (!info.isFile() || info.size > 4000000) { cleanupPending = true; continue; }
          const part = JSON.parse(await readFile(file, 'utf8'));
          if (part.scope !== key || !orphanCheckpointReference(parent, part)) continue;
          await unlink(file); retired++;
        } catch (error) { if (error.code !== 'ENOENT') cleanupPending = true; }
      }
      if (retired && process.platform !== 'win32') {
        try { const handle = await open(directory, 'r'); try { await handle.sync(); } finally { await handle.close(); } } catch { cleanupPending = true; }
      }
      return { ok: true, more: !!scan.reader, examined, retired, cleanupPending };
    } catch (error) {
      if (scan.reader) { await scan.reader.close().catch(() => {}); scan.reader = null; }
      throw error;
    }
  });
}

export class CheckpointCollector {
  constructor(directory, report = () => {}) { this.directory = directory; this.report = report; this.pending = new Set(); this.active = null; this.timer = null; this.closed = false; }
  schedule(scope) {
    if (this.closed || !/^[a-f0-9]{64}$/.test(scope || '')) return;
    if (this.active?.scope === scope) { this.active.again = true; return; }
    this.pending.add(scope); this.wake();
  }
  wake() {
    if (this.closed || this.running || this.timer || !this.active && !this.pending.size) return;
    this.timer = setTimeout(() => { this.timer = null; this.tick(); }, 1000); this.timer.unref?.();
  }
  async tick() {
    if (this.closed) return;
    if (!this.active) { const scope = this.pending.values().next().value; if (!scope) return; this.pending.delete(scope); this.active = { scope, scan: {} }; }
    this.running = true;
    try {
      const result = await collectCheckpointBatch(this.directory, this.active.scope, this.active.scan);
      if (result.cleanupPending) this.report('Some checkpoint cleanup candidates were preserved');
      if (!result.more) { if (this.active.again) this.pending.add(this.active.scope); this.active = null; }
    } catch { this.active = null; this.report('Checkpoint cleanup deferred; committed backup preserved'); }
    if (this.closed && this.active?.scan.reader) { await this.active.scan.reader.close().catch(() => {}); this.active = null; }
    this.running = false;
    this.wake();
  }
  close() { this.closed = true; clearTimeout(this.timer); this.timer = null; this.pending.clear(); if (!this.running && this.active?.scan.reader) this.active.scan.reader.close().catch(() => {}); }
}
