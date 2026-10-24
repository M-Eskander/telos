// The task derivation rules come from the server, so the browser never keeps
// its own copy of the bands or thresholds. The server remains the only place
// the rules are defined; this module only fetches and caches them.
import { useEffect, useState } from 'react';
import { api } from './api.js';

const CACHE_KEY = 'telos.taskRules';

let cached = null;
let pending = null;

function readStoredRules() {
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && parsed.bands ? parsed : null;
  } catch {
    return null;
  }
}

function storeRules(rules) {
  try { window.localStorage.setItem(CACHE_KEY, JSON.stringify(rules)); } catch { /* storage unavailable */ }
}

// Loads the rules once per session, reusing a cached copy until the server
// says the rules changed.
export async function loadRules() {
  if (cached) return cached;
  if (!pending) {
    pending = api('/meta/task-rules')
      .then((response) => {
        const rules = response && response.rules ? response.rules : response;
        const stored = readStoredRules();
        if (stored && stored.version === rules.version) {
          cached = stored;
        } else {
          cached = rules;
          storeRules(rules);
        }
        pending = null;
        return cached;
      })
      .catch((error) => {
        pending = null;
        // A cached copy is better than nothing while the server is unreachable.
        const stored = readStoredRules();
        if (stored) {
          cached = stored;
          return cached;
        }
        throw error;
      });
  }
  return pending;
}

export function useRules() {
  const [rules, setRules] = useState(cached);
  const [error, setError] = useState(null);
  useEffect(() => {
    let live = true;
    loadRules()
      .then((value) => live && setRules(value))
      .catch((reason) => live && setError(reason));
    return () => { live = false; };
  }, []);
  return { rules, error };
}

// The priority a weight falls into.
export function priorityForWeight(rules, weight) {
  const value = Number(weight);
  if (!rules || !Array.isArray(rules.bands) || !Number.isFinite(value)) return 'low';
  for (const band of rules.bands) {
    if (value <= band.max) return band.priority;
  }
  return rules.bands[rules.bands.length - 1].priority;
}

// The band a weight falls into, for the hint under the weight field.
export function weightBand(rules, weight) {
  const value = Number(weight);
  if (!rules || !Array.isArray(rules.bands) || !Number.isFinite(value)) return null;
  return rules.bands.find((band) => value <= band.max) || rules.bands[rules.bands.length - 1];
}

// The status a progress value produces.
export function statusForProgress(rules, progress) {
  const value = Number(progress);
  if (!rules || !rules.status || !Number.isFinite(value)) return 'todo';
  const { todo, in_progress: running, done } = rules.status;
  if (value <= todo.max) return 'todo';
  if (value >= done.min) return 'done';
  if (value >= running.min && value <= running.max) return 'in_progress';
  return 'todo';
}
