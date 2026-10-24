// The access levels a role can be created with. They come from the server so
// the labels and descriptions have one home, the same way the task rules do.
import { useEffect, useState } from 'react';
import { api } from './api.js';

const CACHE_KEY = 'telos.accessPresets';

let cached = null;
let pending = null;

function readStored() {
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && Array.isArray(parsed.presets) ? parsed : null;
  } catch {
    return null;
  }
}

export async function loadPresets() {
  if (cached) return cached;
  if (!pending) {
    pending = api('/meta/access-presets')
      .then((response) => {
        const presets = response && response.presets ? response : null;
        const stored = readStored();
        if (stored && stored.version === presets.version) {
          cached = stored;
        } else {
          cached = presets;
          try { window.localStorage.setItem(CACHE_KEY, JSON.stringify(presets)); } catch { /* storage unavailable */ }
        }
        pending = null;
        return cached;
      })
      .catch((error) => {
        pending = null;
        const stored = readStored();
        if (stored) {
          cached = stored;
          return cached;
        }
        throw error;
      });
  }
  return pending;
}

export function usePresets() {
  const [presets, setPresets] = useState(cached);
  const [error, setError] = useState(null);
  useEffect(() => {
    let live = true;
    loadPresets()
      .then((value) => live && setPresets(value))
      .catch((reason) => live && setError(reason));
    return () => { live = false; };
  }, []);
  return { presets: presets ? presets.presets : [], error };
}
