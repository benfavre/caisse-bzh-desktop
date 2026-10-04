// A retry belongs to the currently displayed native offline page. Navigation
// invalidates both its timer and any reply already queued by the network layer.
export class OfflineRetry {
  constructor({ isWaiting, online, request, recover, timers = globalThis }) {
    Object.assign(this, { isWaiting, online, request, recover, timers });
    this.active = false; this.generation = 0; this.pending = null;
    this.interval = null; this.deadline = null;
  }
  start() {
    this.stop();
    if (!this.isWaiting()) return;
    this.active = true;
    const generation = this.generation;
    this.interval = this.timers.setInterval(() => { if (this.generation === generation) this.tick(); }, 15000);
  }
  stop() {
    this.active = false; this.generation++;
    if (this.interval !== null) this.timers.clearInterval(this.interval);
    if (this.deadline !== null) this.timers.clearTimeout(this.deadline);
    this.interval = this.deadline = null;
    const pending = this.pending; this.pending = null;
    try { pending?.abort(); } catch {}
  }
  finish(request) {
    if (this.pending !== request) return;
    this.pending = null;
    if (this.deadline !== null) this.timers.clearTimeout(this.deadline);
    this.deadline = null;
  }
  tick() {
    if (!this.active) return;
    if (!this.isWaiting()) { this.stop(); return; }
    if (!this.online() || this.pending) return;
    const generation = this.generation;
    let request;
    try {
      request = this.request(); this.pending = request;
      const current = () => this.active && this.generation === generation && this.pending === request;
      request.on('response', response => {
        response.on('data', () => {});
        response.on('error', () => this.finish(request));
        response.on('end', () => this.finish(request));
        if (!current()) return;
        if (!this.isWaiting()) { this.stop(); return; }
        if (response.statusCode >= 200 && response.statusCode < 500) {
          this.finish(request); this.stop();
          try { Promise.resolve(this.recover()).catch(() => {}); } catch {}
        }
      });
      request.on('error', () => this.finish(request));
      request.on('abort', () => this.finish(request));
      this.deadline = this.timers.setTimeout(() => {
        if (!current()) return;
        this.finish(request);
        try { request.abort(); } catch {}
      }, 10000);
      request.end();
    } catch {
      this.finish(request);
      try { request?.abort(); } catch {}
    }
  }
}
