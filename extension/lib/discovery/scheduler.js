// Deep Discovery: per-host request scheduling. One request at a time per host,
// at least `delayMs` between the END of one request and the START of the next
// (so a slow response never shortens the gap), the same gap for retries, an
// overall concurrency cap, Retry-After / exponential back-off, and
// pause / resume / cancel. There is deliberately no way to run a host's
// requests in parallel. Clock and sleep are injectable so tests are
// deterministic. Pure module.

export class CancelledError extends Error { constructor(msg = 'Run cancelled') { super(msg); this.name = 'CancelledError'; } }

const BASE_BACKOFF_MS = 30000;
const MAX_BACKOFF_MS = 10 * 60 * 1000;

export class HostScheduler {
  #now; #sleep; #max; #defaultDelay;
  #queue = []; #active = 0; #activeJobs = new Set(); #hosts = new Map();
  #paused = false; #cancelled = false; #pumping = false; #waiters = [];

  constructor({ now = () => Date.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)), maxConcurrent = 1, defaultDelayMs = 3000 } = {}) {
    this.#now = now; this.#sleep = sleep; this.#max = Math.max(1, maxConcurrent); this.#defaultDelay = defaultDelayMs;
  }

  #host(h) {
    if (!this.#hosts.has(h)) this.#hosts.set(h, { delayMs: this.#defaultDelay, nextAt: 0, cooldownUntil: 0, busy: false, throttles: 0, started: 0, lastEnd: 0 });
    return this.#hosts.get(h);
  }
  setDelay(host, ms) {
    // Never shortened. A longer delay also applies to the very next request (measured from the last one's end).
    const h = this.#host(host); h.delayMs = Math.max(h.delayMs, Math.max(0, ms));
    if (h.lastEnd) h.nextAt = Math.max(h.nextAt, h.lastEnd + h.delayMs);
    return h.delayMs;
  }
  delayFor(host) { return this.#host(host).delayMs; }
  // Milliseconds until the host may be contacted again (0 if now).
  waitingMs(host) { const h = this.#host(host); return Math.max(0, Math.max(h.nextAt, h.cooldownUntil) - this.#now()); }
  get pending() { return this.#queue.length; }
  get active() { return this.#active; }
  get paused() { return this.#paused; }
  get cancelled() { return this.#cancelled; }

  run(host, fn, { signal } = {}) {
    if (this.#cancelled) return Promise.reject(new CancelledError());
    if (signal?.aborted) return Promise.reject(new CancelledError('Aborted'));
    return new Promise((resolve, reject) => {
      const job = { host, fn, resolve, reject, ctrl: null, userSignal: signal, onAbort: null };
      if (signal) {
        job.onAbort = () => {
          const i = this.#queue.indexOf(job);
          if (i >= 0) { this.#queue.splice(i, 1); reject(new CancelledError('Aborted')); this.#notify(); }
          else if (job.ctrl) job.ctrl.abort();
        };
        signal.addEventListener('abort', job.onAbort, { once: true });
      }
      this.#queue.push(job);
      this.#pump();
    });
  }

  pause() { this.#paused = true; }
  resume() { this.#paused = false; this.#notify(); }
  cancel() {
    this.#cancelled = true;
    for (const j of this.#queue.splice(0)) j.reject(new CancelledError());
    for (const j of this.#activeJobs) j.ctrl?.abort();
    this.#notify();
  }

  // Call after a 429 / 503. Returns the cool-down applied and how many in a row.
  reportThrottle(host, retryAfterMs = 0) {
    const h = this.#host(host);
    h.throttles += 1;
    const backoff = Math.min(BASE_BACKOFF_MS * 2 ** (h.throttles - 1), MAX_BACKOFF_MS);
    const cooldownMs = Math.max(retryAfterMs || 0, backoff);
    h.cooldownUntil = Math.max(h.cooldownUntil, this.#now() + cooldownMs);
    return { consecutive: h.throttles, cooldownMs };
  }
  reportSuccess(host) { this.#host(host).throttles = 0; }
  throttles(host) { return this.#host(host).throttles; }

  #waitForChange() { return new Promise((r) => this.#waiters.push(r)); }
  #notify() { const w = this.#waiters; this.#waiters = []; for (const r of w) r(); }

  async #pump() {
    if (this.#pumping) return;
    this.#pumping = true;
    try {
      while (this.#queue.length && !this.#cancelled) {
        if (this.#paused || this.#active >= this.#max) { await this.#waitForChange(); continue; }
        const t = this.#now();
        let job = null; let wait = Infinity;
        for (const j of this.#queue) {
          const h = this.#host(j.host);
          if (h.busy) continue;
          const ready = Math.max(h.nextAt, h.cooldownUntil);
          if (ready <= t) { job = j; break; }
          wait = Math.min(wait, ready - t);
        }
        if (!job) {
          if (wait === Infinity) await this.#waitForChange();
          else await Promise.race([this.#sleep(wait), this.#waitForChange()]);
          continue;
        }
        this.#queue.splice(this.#queue.indexOf(job), 1);
        this.#start(job);
      }
    } finally { this.#pumping = false; }
  }

  #start(job) {
    const h = this.#host(job.host);
    h.busy = true; h.started += 1; this.#active += 1;
    job.ctrl = new AbortController();
    this.#activeJobs.add(job);
    const startedAt = this.#now();
    Promise.resolve()
      .then(() => job.fn({ signal: job.ctrl.signal, startedAt }))
      .then(job.resolve, job.reject)
      .finally(() => {
        h.busy = false; h.lastEnd = this.#now(); h.nextAt = h.lastEnd + h.delayMs; this.#active -= 1; this.#activeJobs.delete(job);
        if (job.userSignal && job.onAbort) job.userSignal.removeEventListener('abort', job.onAbort);
        this.#notify();
        this.#pump();
      });
  }
}

// Retry-After: seconds or an HTTP date. Returns milliseconds (0 if unusable).
export function parseRetryAfter(value, now = Date.now()) {
  if (value === null || value === undefined) return 0;
  const s = String(value).trim();
  if (/^\d+$/.test(s)) return Math.min(Number(s) * 1000, 60 * 60 * 1000);
  const t = Date.parse(s);
  return Number.isNaN(t) ? 0 : Math.min(Math.max(0, t - now), 60 * 60 * 1000);
}
