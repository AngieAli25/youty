// api.js — fetch wrapper for the youty Django Ninja backend.
// JSON in/out, Bearer auth via pluggable token provider, 401 hook with
// single retry (used by staffAuth for refresh-and-retry).

export const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

export class ApiError extends Error {
  constructor(status, message, data) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

/* ---- pluggable auth ---- */
let tokenProvider = null;      // () => string | null
let onUnauthorized = null;     // async () => boolean  (true = token renewed, retry the request)

export function setTokenProvider(fn) { tokenProvider = fn; }
export function setOnUnauthorized(fn) { onUnauthorized = fn; }

/* ---- query-string helper ----
 * URL-encodes every param. Objects/arrays are JSON.stringify'd — needed for
 * `items=<JSON>` availability params, e.g.:
 *   api.get('/api/agenda/availability', { params: { date, items: [{ service_id: 1, operator_id: null }] } })
 * null/undefined params are skipped. */
export function qs(params) {
  if (!params) return '';
  const sp = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v === null || v === undefined) return;
    sp.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  });
  const s = sp.toString();
  return s ? '?' + s : '';
}

/* ---- media helper — uploaded files come back as relative URLs ---- */
export function mediaUrl(path) {
  if (!path) return path;
  if (/^(https?:)?\/\//.test(path) || path.startsWith('data:')) return path;
  return API_URL + (path.startsWith('/') ? '' : '/') + path;
}

async function parseBody(res) {
  const text = await res.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text; }
}

async function request(method, path, opts = {}) {
  const { params, body, form, headers = {}, auth = true, _retried = false, signal } = opts;
  const url = API_URL + path + qs(params);

  const h = { ...headers };
  let payload;
  if (form !== undefined) {
    payload = form; // FormData — browser sets Content-Type with boundary
  } else if (body !== undefined) {
    h['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  if (auth && tokenProvider) {
    const token = tokenProvider();
    if (token) h['Authorization'] = 'Bearer ' + token;
  }

  const res = await fetch(url, { method, headers: h, body: payload, signal });

  if (res.ok) return parseBody(res);

  // 401 → let the auth layer try to recover (staff: refresh once, then retry)
  if (res.status === 401 && auth && !_retried && onUnauthorized) {
    let recovered = false;
    try { recovered = await onUnauthorized(); } catch { recovered = false; }
    if (recovered) return request(method, path, { ...opts, _retried: true });
  }

  const data = await parseBody(res);
  const message =
    (data && typeof data === 'object' && (data.detail || data.message)) ||
    (typeof data === 'string' && data) ||
    res.statusText ||
    `HTTP ${res.status}`;
  throw new ApiError(res.status, typeof message === 'string' ? message : JSON.stringify(message), data);
}

export const api = {
  get: (path, opts) => request('GET', path, opts),
  post: (path, body, opts) => request('POST', path, { ...opts, body }),
  put: (path, body, opts) => request('PUT', path, { ...opts, body }),
  del: (path, opts) => request('DELETE', path, opts),
  /** Multipart POST. `form` can be a FormData or a plain object of fields (File values allowed). */
  postForm: (path, form, opts) => {
    let fd = form;
    if (!(form instanceof FormData)) {
      fd = new FormData();
      Object.entries(form || {}).forEach(([k, v]) => {
        if (v !== null && v !== undefined) fd.append(k, v);
      });
    }
    return request('POST', path, { ...opts, form: fd });
  },
};
