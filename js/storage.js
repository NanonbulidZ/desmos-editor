// ========================================
// Storage Layer - GitHub API + localStorage fallback
// ========================================
const CloudStorage = (function() {
  'use strict';

  const REPO_OWNER = 'NanonbulidZ';
  const REPO_NAME = 'desmos-editor';
  const DATA_FILE = 'admin-data.json';
  const TOKEN_KEY = 'desmos-editor-gh-token';

  function getToken() {
    return localStorage.getItem(TOKEN_KEY) || '';
  }

  function setToken(token) {
    localStorage.setItem(TOKEN_KEY, token.trim());
  }

  function hasToken() {
    return !!getToken();
  }

  // ===== GitHub API helpers =====
  async function ghGet(path) {
    const token = getToken();
    const headers = { 'Accept': 'application/vnd.github.v3+json' };
    if (token) headers['Authorization'] = 'token ' + token;
    const res = await fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}`, { headers });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error('GitHub GET failed: ' + res.status);
    const json = await res.json();
    return {
      content: JSON.parse(atob(json.content)),
      sha: json.sha
    };
  }

  async function ghPut(path, content, sha) {
    const token = getToken();
    if (!token) throw new Error('No GitHub token');
    const headers = {
      'Accept': 'application/vnd.github.v3+json',
      'Authorization': 'token ' + token,
      'Content-Type': 'application/json'
    };
    const body = {
      message: 'Update admin data',
      content: btoa(unescape(encodeURIComponent(JSON.stringify(content, null, 0)))),
      sha: sha || undefined
    };
    const res = await fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}`, {
      method: 'PUT', headers, body: JSON.stringify(body)
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error('GitHub PUT failed: ' + res.status + ' ' + (err.message || ''));
    }
    return await res.json();
  }

  // ===== Local data structure =====
  function getLocalData() {
    try {
      return JSON.parse(localStorage.getItem('desmos-editor-cloud-data') || '{}');
    } catch { return {}; }
  }

  function setLocalData(data) {
    localStorage.setItem('desmos-editor-cloud-data', JSON.stringify(data));
  }

  // ===== Public API =====
  // Merge remote and local data (remote wins for conflicts)
  function mergeData(local, remote) {
    if (!remote || !remote.ts) return local;
    if (!local || !local.ts) return remote;
    // Merge events (concat, dedupe by timestamp)
    const events = [...(local.events || [])];
    (remote.events || []).forEach(re => {
      if (!events.find(le => le.ts === re.ts && le.msg === re.msg)) {
        events.push(re);
      }
    });
    events.sort((a, b) => new Date(a.ts) - new Date(b.ts));
    if (events.length > 500) events.splice(0, events.length - 500);

    // Merge users
    const users = { ...(local.users || {}), ...(remote.users || {}) };

    // Merge equations (remote wins per user)
    const equations = { ...(local.equations || {}), ...(remote.equations || {}) };

    // Merge snapshots (remote wins per user)
    const snapshots = { ...(local.snapshots || {}), ...(remote.snapshots || {}) };

    // Merge stats (take max of each)
    const localStats = local.stats || { visitors: 0, drawings: 0, exports: 0 };
    const remoteStats = remote.stats || { visitors: 0, drawings: 0, exports: 0 };
    const stats = {
      visitors: Math.max(localStats.visitors || 0, remoteStats.visitors || 0),
      drawings: Math.max(localStats.drawings || 0, remoteStats.drawings || 0),
      exports: Math.max(localStats.exports || 0, remoteStats.exports || 0)
    };

    // Merge feedback
    const feedback = [...(local.feedback || [])];
    (remote.feedback || []).forEach(rf => {
      if (!feedback.find(lf => lf.ts === rf.ts)) feedback.push(rf);
    });

    return { events, users, equations, snapshots, stats, feedback, ts: new Date().toISOString() };
  }

  // Save data locally and try to push to GitHub
  async function save(data) {
    data.ts = new Date().toISOString();
    setLocalData(data);

    if (!hasToken()) return { synced: false, reason: 'no-token' };

    try {
      const existing = await ghGet(DATA_FILE);
      const remoteData = existing ? existing.content : {};
      const merged = mergeData(data, remoteData);
      merged.ts = new Date().toISOString();
      setLocalData(merged);
      await ghPut(DATA_FILE, merged, existing ? existing.sha : undefined);
      return { synced: true };
    } catch (e) {
      console.warn('GitHub sync failed:', e.message);
      return { synced: false, reason: e.message };
    }
  }

  // Load data: try GitHub first, fall back to local
  async function load() {
    let local = getLocalData();

    if (hasToken()) {
      try {
        const existing = await ghGet(DATA_FILE);
        if (existing) {
          const merged = mergeData(local, existing.content);
          setLocalData(merged);
          return merged;
        }
      } catch (e) {
        console.warn('GitHub load failed:', e.message);
      }
    }

    return local;
  }

  // Quick sync: push local to GitHub
  async function syncToGitHub() {
    if (!hasToken()) return { synced: false, reason: 'no-token' };
    const local = getLocalData();
    try {
      const existing = await ghGet(DATA_FILE);
      const remoteData = existing ? existing.content : {};
      const merged = mergeData(local, remoteData);
      merged.ts = new Date().toISOString();
      setLocalData(merged);
      await ghPut(DATA_FILE, merged, existing ? existing.sha : undefined);
      return { synced: true };
    } catch (e) {
      return { synced: false, reason: e.message };
    }
  }

  // Convenience: get a specific key
  function getLocal(key, fallback) {
    try {
      const data = getLocalData();
      return data[key] !== undefined ? data[key] : fallback;
    } catch { return fallback; }
  }

  function setLocal(key, value) {
    const data = getLocalData();
    data[key] = value;
    setLocalData(data);
  }

  return { save, load, syncToGitHub, getToken, setToken, hasToken, getLocal, setLocal, getLocalData, setLocalData };
})();
