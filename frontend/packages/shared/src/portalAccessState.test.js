import test from 'node:test';
import assert from 'node:assert/strict';
import { createAccessMonitor, decisionIsActive } from './portalAccessState.js';

const epoch = Date.parse('2026-09-09T00:00:00Z');
const grant = (checked = epoch, options = {}) => ({
  operational_access: true, status: 'active', checked_at: new Date(checked).toISOString(),
  valid_until: new Date(checked + 60_000).toISOString(), expires_at: null, ...options,
});
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
function harness(response) {
  let now = epoch, calls = 0, access, timerId = 0;
  const timers = new Map();
  const nextTimer = () => [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
  let fetcher = () => response;
  const monitor = createAccessMonitor({
    fetchAccess: (signal) => { calls++; return fetcher(signal); }, onChange: (next) => { access = next; },
    now: () => now,
    setTimer: (cb, ms) => { const id = ++timerId; timers.set(id, { cb, at: now + ms }); return id; },
    clearTimer: (id) => timers.delete(id),
  });
  return { monitor, get access() { return access; }, get delay() { return nextTimer()?.[1].at - now; }, get calls() { return calls; },
    fetch: (fn) => { fetcher = fn; }, time: (v) => { now = v; },
    tick: () => { const [id, task] = nextTimer(); timers.delete(id); now = task.at; task.cb(); } };
}

test('a grant expires at either hard expiry or the absolute sixty-second check limit', () => {
  const access = grant(epoch, { valid_until: new Date(epoch + 120_000).toISOString() });
  assert.equal(decisionIsActive(access, epoch + 59_999), true);
  assert.equal(decisionIsActive(access, epoch + 60_000), false);
  assert.equal(decisionIsActive({ ...access, expires_at: new Date(epoch).toISOString() }, epoch), false);
});

test('network latency does not restart decision freshness', async () => {
  const h = harness(grant()); h.time(epoch + 3_700); await flush();
  assert.equal(h.delay, 56_300);
  assert.equal(h.access.operational_access, true);
  h.monitor.stop();
});

test('unpaid checks refresh at the shared server deadline and observe purchase', async () => {
  const h = harness(grant(epoch - 40_000, { operational_access: false, status: 'subscription_required' }));
  await flush(); assert.equal(h.delay, 20_000);
  h.fetch(() => grant(epoch + 20_000)); h.tick(); await flush();
  assert.equal(h.access.operational_access, true);
  assert.equal(h.calls, 2); h.monitor.stop();
});

test('expiry disables actions before a hanging refresh; recovery needs no new session', async () => {
  const h = harness(grant(epoch, { expires_at: new Date(epoch + 5_000).toISOString() })); await flush();
  let complete; h.fetch(() => new Promise((resolve) => { complete = resolve; }));
  h.tick(); await flush(); assert.equal(h.access.operational_access, false);
  complete(grant(epoch + 5_000)); await flush(); assert.equal(h.access.operational_access, true);
  h.monitor.stop();
});

test('focus verifies access and failures remain distinct from a missing subscription', async () => {
  const h = harness(grant()); await flush();
  h.fetch(() => Promise.reject(new Error('offline'))); h.monitor.resume(); await flush();
  assert.equal(h.access.status, 'unavailable'); assert.equal(h.access.operational_access, false);
  h.fetch(() => grant()); h.monitor.resume(); await flush(); assert.equal(h.access.operational_access, true);
  h.monitor.stop();
});

test('organization switching discards a slow response from the previous organization', async () => {
  let complete;
  const old = harness(new Promise((resolve) => { complete = resolve; })); await flush();
  old.monitor.stop();
  const next = harness(grant(epoch, { operational_access: false, status: 'subscription_required' })); await flush();
  complete(grant()); await flush();
  assert.equal(old.access.operational_access, false); assert.equal(next.access.operational_access, false);
  next.monitor.stop();
});

test('expired or malformed upstream grants fail closed instead of being cached', async () => {
  for (const response of [grant(epoch - 60_000), grant(epoch, { checked_at: 'invalid' }), grant(epoch, { operational_access: 'true' })]) {
    const h = harness(response); await flush(); assert.equal(h.access.status, 'unavailable');
    assert.equal(h.access.operational_access, false); h.monitor.stop();
  }
});


test('a stalled transport times out, aborts and retries within the next minute', async () => {
  let signal;
  const h = harness();
  h.fetch((input) => { signal = input; return new Promise(() => {}); });
  await flush(); assert.equal(h.calls, 1);
  h.tick(); await flush();
  assert.equal(signal.aborted, true);
  assert.equal(h.access.status, 'unavailable');
  assert.equal(h.access.operational_access, false);
  assert.equal(h.delay, 55_000);
  h.fetch(() => grant(epoch + 60_000)); h.tick(); await flush();
  assert.equal(h.calls, 2);
  assert.equal(h.access.operational_access, true);
  h.monitor.stop();
});

test('retry can recover after timeout and a late old response cannot restore access', async () => {
  let complete;
  const h = harness();
  h.fetch(() => new Promise((resolve) => { complete = resolve; }));
  await flush(); h.tick(); await flush();
  h.fetch(() => grant(epoch + 5_000, { operational_access: false, status: 'subscription_required' }));
  h.monitor.refresh(); await flush();
  assert.equal(h.calls, 2);
  assert.equal(h.access.status, 'subscription_required');
  complete(grant(epoch + 5_000)); await flush();
  assert.equal(h.access.operational_access, false);
  assert.equal(h.access.status, 'subscription_required');
  h.monitor.stop();
});
