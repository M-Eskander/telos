import { ApiError } from './errors.js';
import { demoApi, demoDownload } from './demo.js';

export { ApiError };
export const DEMO = !!import.meta.env.VITE_DEMO;
const BASE = import.meta.env.VITE_API_ORIGIN || '';

let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };

// Handles both { ok } and { success } envelopes and the bare { error } 500.
export async function api(path, { method = 'GET', body, form } = {}) {
  if (DEMO) {
    try { return await demoApi(path, { method, body, form }); }
    catch (e) { if (e.status === 401 && !path.startsWith('/auth/login')) onUnauthorized(); throw e; }
  }
  const opts = { method, credentials: 'include', headers: {} };
  if (form) opts.body = form; // browser sets the multipart boundary
  else if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  let res;
  try { res = await fetch(`${BASE}/api${path}`, opts); }
  catch { throw new ApiError(0, 'Cannot reach the server. Check your connection and try again.'); }
  let data = null;
  try { data = await res.json(); } catch { /* non-JSON body */ }
  const failed = !res.ok || data?.ok === false || data?.success === false;
  if (failed) {
    let message = data?.message || data?.error || `Request failed (${res.status}).`;
    if (res.status === 429) {
      const wait = res.headers.get('Retry-After');
      message = `Too many requests. Try again ${wait ? `in ${wait} seconds` : 'shortly'}.`;
    }
    if (res.status === 401 && !path.startsWith('/auth/login')) onUnauthorized();
    throw new ApiError(res.status, message, data?.code);
  }
  return data;
}

export async function downloadContract(contract) {
  let blob;
  if (DEMO) blob = demoDownload(contract);
  else {
    const res = await fetch(`${BASE}/api/admin/contracts/${contract.id}/file`, { credentials: 'include' });
    if (!res.ok) throw new ApiError(res.status, 'Could not download this contract.');
    blob = await res.blob();
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = contract.original_name || `contract-${contract.id}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export const list = (r, ...keys) => {
  for (const k of [...keys, 'data']) if (Array.isArray(r?.[k])) return r[k];
  return [];
};
