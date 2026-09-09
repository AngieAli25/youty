export function decisionIsActive(access, now = Date.now()) {
  return access?.operational_access === true && Date.parse(access.valid_until) > now
    && Date.parse(access.checked_at) + 60_000 > now
    && (!access.expires_at || Date.parse(access.expires_at) > now);
}

/** Own the absolute decision deadline; network latency never restarts its TTL. */
export function createAccessMonitor({ fetchAccess, onChange, purchaseUrl = '', now = Date.now,
  setTimer = setTimeout, clearTimer = clearTimeout, requestTimeoutMs = 5_000 }) {
  let stopped = false;
  let inFlight = null;
  let timer = null;
  let requestTimer = null;
  let requestGeneration = 0;
  let controller = null;
  let access = { status: 'unavailable', operational_access: false, purchase_url: purchaseUrl };
  const publish = (next) => { access = next; onChange(next); };
  const expire = () => publish({ ...access, status: 'unavailable', operational_access: false });
  const schedule = (delay) => {
    clearTimer(timer);
    timer = setTimer(() => { expire(); refresh(); }, delay);
  };
  const refresh = () => {
    if (stopped || inFlight) return inFlight;
    const generation = ++requestGeneration;
    const started = now();
    controller = new AbortController();
    const signal = controller.signal;
    const timeout = new Promise((_, reject) => {
      requestTimer = setTimer(() => {
        controller.abort();
        reject(new Error('Portal access verification timed out'));
      }, requestTimeoutMs);
    });
    // The race disposes late results even if a custom transport ignores abort.
    inFlight = Promise.race([Promise.resolve().then(() => fetchAccess(signal)), timeout]).then((next) => {
      if (stopped || generation !== requestGeneration) return;
      const checked = Date.parse(next.checked_at);
      const deadline = Math.min(Date.parse(next.valid_until), checked + 60_000,
        next.operational_access && next.expires_at ? Date.parse(next.expires_at) : Infinity);
      const remaining = deadline - now();
      if (typeof next.operational_access !== 'boolean' || !Number.isFinite(deadline)
        || checked > now() + 5_000 || (next.operational_access && remaining <= 0)) {
        throw new Error('Invalid portal access decision');
      }
      publish({ ...next, purchase_url: next.purchase_url || access.purchase_url });
      schedule(remaining > 0 ? Math.max(1, Math.min(60_000, remaining)) : 60_000);
    }).catch(() => {
      if (stopped || generation !== requestGeneration) return;
      expire();
      schedule(Math.max(1, started + 60_000 - now()));
    }).finally(() => {
      if (generation === requestGeneration) {
        clearTimer(requestTimer);
        inFlight = null;
      }
    });
    return inFlight;
  };
  publish(access);
  refresh();
  return {
    refresh,
    resume: () => { if (!stopped) { expire(); refresh(); } },
    stop: () => { stopped = true; requestGeneration++; controller?.abort(); clearTimer(timer); clearTimer(requestTimer); },
  };
}
