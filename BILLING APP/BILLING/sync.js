/* Latesto cloud sync (Firebase Auth + Firestore).
   - Every customer / order / service / inventory item is its own document, so devices only exchange what changed.
   - Works offline: changes are queued by Firestore and uploaded when the internet returns.
   - If Firebase can't be loaded (first visit while offline) the app keeps working locally. */
(function () {
  'use strict';
  const COLS = ['customers', 'orders', 'services', 'inventory'];
  const INIT_KEY = 'latesto_cloud_init';
  const $ = (s, r = document) => r.querySelector(s);
  const App = () => window.LatestoApp;

  const fb = window.firebase;
  const cfg = window.LATESTO_FIREBASE;
  let auth = null, db = null, user = null, colRef = null, unsub = null;
  let ready = false;      // first reconcile with the cloud done
  let applying = false;   // true while merging cloud data into the app
  let remote = {};        // docId -> last known cloud document data
  let synced = {};        // docId -> JSON string last known to be in the cloud (or queued to go there)
  let pushing = 0;

  /* ---------- status pill + sign out ---------- */
  function setStatus(kind, text) {
    const el = $('#sync-status'); if (!el) return;
    el.className = 'sync-pill ' + kind;
    el.textContent = text;
  }
  function refreshStatus() {
    if (!fb) return setStatus('off', 'Local only');
    if (!user) return setStatus('off', 'Signed out');
    if (!navigator.onLine) return setStatus('wait', 'Offline – will sync');
    if (!ready) return setStatus('wait', 'Connecting…');
    setStatus(pushing > 0 ? 'wait' : 'ok', pushing > 0 ? 'Syncing…' : '☁ Synced');
  }
  window.addEventListener('online', refreshStatus);
  window.addEventListener('offline', refreshStatus);

  function addTopbarBits() {
    const bar = $('.top-actions'); if (!bar || $('#sync-status')) return;
    const pill = document.createElement('span'); pill.id = 'sync-status'; pill.className = 'sync-pill off';
    const out = document.createElement('button'); out.id = 'signout-btn'; out.className = 'btn'; out.textContent = 'Sign out'; out.hidden = true;
    out.onclick = () => { if (confirm('Sign out of Latesto on this device?')) auth.signOut(); };
    bar.insertBefore(pill, bar.firstChild); bar.appendChild(out);
  }

  /* ---------- login screen ---------- */
  function showLogin(msg) {
    let o = $('#login-overlay');
    if (!o) {
      o = document.createElement('div'); o.id = 'login-overlay';
      o.innerHTML = '<div class="login-box"><div class="brand"><b>LATESTO</b><span>DRYCLEANERS</span></div>' +
        '<h2>Sign in</h2><p class="muted">Use the shop login to see the same orders on every device.</p>' +
        '<input type="email" id="lg-email" placeholder="Email" autocomplete="username">' +
        '<input type="password" id="lg-pass" placeholder="Password" autocomplete="current-password">' +
        '<div id="lg-msg" class="lg-msg"></div>' +
        '<button class="btn primary" id="lg-go">Sign in</button></div>';
      document.body.appendChild(o);
      const go = async () => {
        const email = $('#lg-email').value.trim(), pass = $('#lg-pass').value;
        if (!email || !pass) return showLogin('Enter email and password');
        $('#lg-go').disabled = true; $('#lg-msg').textContent = 'Signing in…';
        try { await auth.signInWithEmailAndPassword(email, pass); }
        catch (e) { showLogin(friendly(e)); }
        $('#lg-go').disabled = false;
      };
      $('#lg-go').onclick = go;
      o.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    }
    o.hidden = false;
    if (msg != null) $('#lg-msg').textContent = msg;
  }
  function hideLogin() { const o = $('#login-overlay'); if (o) o.hidden = true; }
  function friendly(e) {
    const c = (e && e.code) || '';
    if (/invalid-credential|wrong-password|user-not-found|invalid-login/.test(c)) return 'Wrong email or password';
    if (/network/.test(c)) return 'No internet. Connect and try again';
    if (/too-many/.test(c)) return 'Too many attempts. Wait a few minutes and try again';
    if (/api-key/.test(c)) return 'Firebase API key is wrong. Check firebase-config.js';
    if (/operation-not-allowed/.test(c)) return 'Email/Password sign-in is not enabled in Firebase';
    return 'Could not sign in (' + (c || (e && e.message) || 'unknown error') + ')';
  }

  /* ---------- helpers ---------- */
  const kindOf = (k) => k.slice(0, k.indexOf('_'));
  const idOf = (k) => k.slice(k.indexOf('_') + 1);
  function snapshotOf(st) {
    const m = {};
    COLS.forEach((c) => (st[c] || []).forEach((it) => { if (it && it.id) m[c + '_' + it.id] = JSON.stringify(it); }));
    m.settings_main = JSON.stringify(st.settings || {});
    m.counter_main = JSON.stringify(st.nextOrderNo || 1001);
    return m;
  }
  function replaceInPlace(oldObj, newObj) {
    Object.keys(oldObj).forEach((k) => delete oldObj[k]);
    Object.assign(oldObj, newObj);
  }
  function bumpCounter(st, n) {
    const maxNo = (st.orders || []).reduce((m, o) => Math.max(m, Number(o.number) || 0), 0);
    st.nextOrderNo = Math.max(Number(st.nextOrderNo) || 1001, Number(n) || 0, maxNo + 1);
  }

  /* ---------- upload local changes ---------- */
  function onSave() {
    if (!ready || applying || !user) return;
    pushDiff();
  }
  function pushDiff() {
    const st = App().getState();
    const cur = snapshotOf(st);
    const ops = [];
    Object.keys(cur).forEach((k) => {
      if (synced[k] !== cur[k]) { ops.push([k, { data: cur[k], deleted: false, u: Date.now() }]); synced[k] = cur[k]; }
    });
    Object.keys(synced).forEach((k) => {
      if (!(k in cur)) { ops.push([k, { data: null, deleted: true, u: Date.now() }]); delete synced[k]; }
    });
    for (let i = 0; i < ops.length; i += 400) {
      const batch = db.batch();
      ops.slice(i, i + 400).forEach(([k, d]) => batch.set(colRef.doc(k), d));
      pushing++; refreshStatus();
      batch.commit().then(() => { pushing--; refreshStatus(); })
        .catch((e) => { pushing--; console.warn('Upload failed', e); setStatus('err', 'Sync error'); });
    }
  }

  /* ---------- first merge after sign in ---------- */
  function firstReconcile(snap) {
    const st = App().getState();
    remote = {};
    snap.forEach((d) => { remote[d.id] = d.data(); });
    const live = Object.keys(remote).filter((k) => !remote[k].deleted);
    const inited = localStorage.getItem(INIT_KEY) === user.uid;
    applying = true;

    if (!inited && live.some((k) => COLS.includes(kindOf(k)))) {
      // this device is joining cloud data that already exists
      const pristine = !(st.customers || []).length && !(st.orders || []).length;
      ['services', 'inventory'].forEach((c) => {
        const cloudNames = new Set(live.filter((k) => kindOf(k) === c).map((k) => String(JSON.parse(remote[k].data).name || '').toLowerCase()));
        st[c] = pristine ? [] : (st[c] || []).filter((it) => !cloudNames.has(String(it.name || '').toLowerCase()) || (remote[c + '_' + it.id] && !remote[c + '_' + it.id].deleted));
      });
    }

    COLS.forEach((c) => {
      const local = st[c] || [];
      const out = [], done = new Set();
      local.forEach((it) => {
        const k = c + '_' + it.id, r = remote[k];
        if (!r) { out.push(it); return; }          // only on this device: will be uploaded
        if (r.deleted) return;                     // deleted on another device
        const parsed = JSON.parse(r.data);
        replaceInPlace(it, parsed); out.push(it); done.add(k);
      });
      live.filter((k) => kindOf(k) === c && !done.has(k))
        .sort((a, b) => (remote[a].u || 0) - (remote[b].u || 0))
        .forEach((k) => out.push(JSON.parse(remote[k].data)));
      st[c] = out;
    });

    if (remote.settings_main && !remote.settings_main.deleted) st.settings = Object.assign({}, st.settings, JSON.parse(remote.settings_main.data));
    bumpCounter(st, remote.counter_main && !remote.counter_main.deleted ? JSON.parse(remote.counter_main.data) : 0);

    // what the cloud already has
    synced = {};
    COLS.forEach((c) => st[c].forEach((it) => {
      const k = c + '_' + it.id, r = remote[k];
      if (r && !r.deleted) synced[k] = JSON.stringify(it);
    }));
    if (remote.settings_main && !remote.settings_main.deleted) synced.settings_main = JSON.stringify(st.settings);
    if (remote.counter_main && !remote.counter_main.deleted) synced.counter_main = remote.counter_main.data;

    localStorage.setItem(INIT_KEY, user.uid);
    ready = true;
    App().refresh();
    applying = false;
    pushDiff();           // uploads anything that exists only on this device
    refreshStatus();
  }

  /* ---------- live updates from other devices ---------- */
  function applyChanges(snap) {
    const st = App().getState();
    let changed = false;
    applying = true;
    snap.docChanges().forEach((ch) => {
      if (ch.type === 'removed' || ch.doc.metadata.hasPendingWrites) return;   // our own writes
      const k = ch.doc.id, r = ch.doc.data();
      remote[k] = r;
      const kind = kindOf(k), id = idOf(k);
      if (kind === 'settings') {
        if (!r.deleted) { st.settings = Object.assign({}, st.settings, JSON.parse(r.data)); synced[k] = JSON.stringify(st.settings); changed = true; }
      } else if (kind === 'counter') {
        if (!r.deleted) { bumpCounter(st, JSON.parse(r.data)); synced[k] = r.data; changed = true; }
      } else if (COLS.includes(kind)) {
        const arr = st[kind] || (st[kind] = []);
        const i = arr.findIndex((x) => x.id === id);
        if (r.deleted) { if (i >= 0) arr.splice(i, 1); delete synced[k]; changed = true; }
        else {
          const parsed = JSON.parse(r.data);
          if (i >= 0) replaceInPlace(arr[i], parsed); else arr.push(parsed);
          synced[k] = JSON.stringify(parsed); changed = true;
        }
      }
    });
    if (changed) App().refresh();
    applying = false;
  }

  /* ---------- start / stop ---------- */
  function start(u) {
    user = u; ready = false; remote = {}; synced = {};
    colRef = db.collection('shops').doc(u.uid).collection('items');
    const outBtn = $('#signout-btn'); if (outBtn) outBtn.hidden = false;
    refreshStatus();
    unsub = colRef.onSnapshot((snap) => {
      if (!ready) {
        const inited = localStorage.getItem(INIT_KEY) === u.uid;
        // first time on this device: wait for the real cloud data, not an empty cache
        if (snap.metadata.fromCache && !inited) { refreshStatus(); return; }
        firstReconcile(snap);
      } else applyChanges(snap);
    }, (err) => { console.warn('Sync listener error', err); setStatus('err', 'Sync error'); });
  }
  function stop() {
    if (unsub) { unsub(); unsub = null; }
    user = null; ready = false; colRef = null;
    const outBtn = $('#signout-btn'); if (outBtn) outBtn.hidden = true;
  }

  /* ---------- init ---------- */
  function init() {
    addTopbarBits();
    if (!fb || !cfg) { refreshStatus(); return; }     // Firebase not loaded: local-only mode
    try {
      fb.initializeApp(cfg);
      auth = fb.auth();
      db = fb.firestore();
      db.enablePersistence({ synchronizeTabs: true }).catch(() => { /* private mode etc: still works online */ });
    } catch (e) { console.warn('Firebase failed to start', e); refreshStatus(); return; }
    window.LatestoSync = { onSave };
    showLogin('');                                     // hidden again as soon as a saved login is found
    auth.onAuthStateChanged((u) => {
      if (u) { hideLogin(); start(u); }
      else { stop(); showLogin(navigator.onLine ? '' : 'You are offline. Connect to the internet to sign in.'); refreshStatus(); }
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
