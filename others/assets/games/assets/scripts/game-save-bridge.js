/* ═══════════════════════════════════════════════════════════════════
   game-save-bridge.js  –  Relic Network Game Save System

   HOW TO USE:
   Add this ONE line at the top of every game HTML file's <head>:
     <script src="/dist/others/assets/scripts/game-save-bridge.js"></script>

   Then set the game ID right after:
     <script>window.__RELIC_GAME_ID__ = "your-game-id";</script>

   DEBUGGING:
   Open DevTools console. Look for [Relic Bridge] logs.
   To force debug mode on any page run:
     localStorage.setItem('debugMode', 'enabled')
     then reload the page

   Run  relicBridgeStatus()  in console at any time for a status report.
   ═══════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';
  /* eslint-disable no-console */

  // ── Debug logger ────────────────────────────────────────────────────
  const DEBUG = localStorage.getItem('debugMode') === 'enabled';

  function log(emoji, msg, data) {
    if (!DEBUG) return;
    if (data !== undefined) {
      console.log('%c[Relic Bridge] ' + emoji + ' ' + msg, 'color:#60a5fa;font-weight:bold', data);
    } else {
      console.log('%c[Relic Bridge] ' + emoji + ' ' + msg, 'color:#60a5fa;font-weight:bold');
    }
  }

  function warn(msg, data) {
    if (data !== undefined) {
      console.warn('[Relic Bridge] ⚠️ ' + msg, data);
    } else {
      console.warn('[Relic Bridge] ⚠️ ' + msg);
    }
  }

  function info(msg, data) {
    if (data !== undefined) {
      console.log('%c[Relic Bridge] ' + msg, 'color:#4ade80;font-weight:bold', data);
    } else {
      console.log('%c[Relic Bridge] ' + msg, 'color:#4ade80;font-weight:bold');
    }
  }

  // ── Config ───────────────────────────────────────────────────────────
  const GAME_ID = window.__RELIC_GAME_ID__ ||
    location.pathname.split('/').pop()
      .replace(/\.html?$/i, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

  const SAVE_DELAY = 3000;
  const MSG_TARGET = '*';

  // ── Startup info (always shown) ──────────────────────────────────────
  info('══════════════════════════════════════');
  info('Game Save Bridge loaded');
  info('Game ID    : ' + GAME_ID);
  info('ID source  : ' + (window.__RELIC_GAME_ID__ ? 'injected ✅' : 'auto-detected from path ⚠️'));
  info('Page URL   : ' + location.href);
  info('In iframe  : ' + (window.self !== window.top ? 'yes ✅' : 'NO ❌ — postMessage wont reach parent'));
  info('Debug mode : ' + (DEBUG ? 'ON' : 'OFF  →  localStorage.setItem("debugMode","enabled") to enable'));
  info('══════════════════════════════════════');

  if (window.self === window.top) {
    warn('This page is NOT inside an iframe. postMessage to window.parent will silently fail.');
    warn('Game saves will not sync until this page loads inside the Relic iframe.');
  }

  // ── State ────────────────────────────────────────────────────────────
  let saveTimer    = null;
  let pendingSave  = false;
  let saveCount    = 0;
  let restoreCount = 0;

  // ── Patch localStorage ───────────────────────────────────────────────
  const _setItem    = localStorage.setItem.bind(localStorage);
  const _removeItem = localStorage.removeItem.bind(localStorage);
  const _clear      = localStorage.clear.bind(localStorage);

  localStorage.setItem = function (key, value) {
    _setItem(key, value);
    log('💾', 'setItem intercepted', { key, value: String(value).slice(0, 80) });
    scheduleSave();
  };

  localStorage.removeItem = function (key) {
    _removeItem(key);
    log('🗑️', 'removeItem intercepted', { key });
    scheduleSave();
  };

  localStorage.clear = function () {
    _clear();
    log('🗑️', 'clear intercepted');
    scheduleSave();
  };

  function scheduleSave() {
    pendingSave = true;
    clearTimeout(saveTimer);
    log('⏳', 'Save scheduled in ' + SAVE_DELAY + 'ms');
    saveTimer = setTimeout(pushToParent, SAVE_DELAY);
  }

  // ── Keys to exclude (Relic's own settings, not game data) ────────────
  const RELIC_KEYS = new Set([
    'selectedTheme', 'TabCloak_Title', 'TabCloak_Favicon',
    'hotkey', 'redirectURL', 'aboutBlank', 'antiTabClose',
    'snowEnabled', 'debugMode', 'relic_recently_played',
    'autoTheme', 'particleEffect'
  ]);

  function collectGameData() {
    const data = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!RELIC_KEYS.has(key)) {
        data[key] = localStorage.getItem(key);
      }
    }
    return data;
  }

  // ── Send data up to the parent ───────────────────────────────────────
  function pushToParent() {
    if (!pendingSave) return;
    pendingSave = false;

    const data     = collectGameData();
    const keyCount = Object.keys(data).length;
    saveCount++;

    if (keyCount === 0) {
      warn('Nothing to save — game has 0 localStorage keys (excluding Relic keys)');
      warn('Relic keys excluded: ' + [...RELIC_KEYS].join(', '));
      return;
    }

    log('📤', 'Pushing save #' + saveCount + ' to parent', {
      gameId: GAME_ID,
      keys: Object.keys(data),
      keyCount,
    });

    try {
      window.parent.postMessage({
        type:   'RELIC_GAME_SAVE',
        gameId: GAME_ID,
        data,
      }, MSG_TARGET);
      log('✅', 'postMessage sent to parent successfully');
    } catch (e) {
      warn('postMessage to parent failed — running standalone (not in iframe)?', e);
    }
  }

  // ── Request saved data from parent on load ───────────────────────────
  function requestSavedData() {
    log('📥', 'Requesting saved data from parent', { gameId: GAME_ID });
    try {
      window.parent.postMessage({
        type:   'RELIC_GAME_LOAD_REQUEST',
        gameId: GAME_ID,
      }, MSG_TARGET);
      log('✅', 'Load request sent to parent');
    } catch (e) {
      warn('postMessage load request failed', e);
    }
  }

  // ── Listen for parent sending back saved data ────────────────────────
  window.addEventListener('message', function (event) {
    log('📨', 'Message received', {
      type:   event.data?.type,
      gameId: event.data?.gameId,
      origin: event.origin,
    });

    if (!event.data || event.data.type !== 'RELIC_GAME_LOAD_RESPONSE') {
      log('⏭️', 'Ignoring message (not RELIC_GAME_LOAD_RESPONSE)', event.data?.type);
      return;
    }

    if (event.data.gameId !== GAME_ID) {
      warn('gameId mismatch — ignoring response', {
        expected: GAME_ID,
        received: event.data.gameId,
      });
      return;
    }

    const savedData = event.data.data;

    if (!savedData || typeof savedData !== 'object') {
      warn('Received empty or invalid save data', savedData);
      return;
    }

    const keys = Object.keys(savedData);
    restoreCount++;

    if (keys.length === 0) {
      info('No saved data found for this game (first time playing on this account?)');
      return;
    }

    // ── Check BEFORE writing whether any data actually differs ────────
    // Must happen before _setItem calls, otherwise comparison is always equal.
    const needsReload = restoreCount === 1 && keys.some(function (key) {
      return localStorage.getItem(key) !== savedData[key];
    });

    info('Restoring ' + keys.length + ' keys for game: ' + GAME_ID);
    log('🔑', 'Keys being restored', keys);

    keys.forEach(function (key) {
      const val = savedData[key];
      log('↩️', 'Restoring key', { key, value: String(val).slice(0, 80) });
      _setItem(key, val); // bypass patch to avoid triggering auto-save
    });

    info('✅ Restore complete — ' + keys.length + ' keys written to localStorage');

    if (needsReload) {
      info('🔄 Reloading page so game picks up restored save...');
      setTimeout(function () { location.reload(); }, 150);
      return;
    }

    // Data was already identical — just notify the game via StorageEvent
    try {
      window.dispatchEvent(new StorageEvent('storage', { key: null }));
      log('📡', 'StorageEvent dispatched to notify game');
    } catch (e) {
      warn('Could not dispatch StorageEvent', e);
    }
  });

  // ── Save on page hide / unload ───────────────────────────────────────
  window.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') {
      log('👁️', 'Page hidden — flushing save immediately');
      pushToParent();
    }
  });

  window.addEventListener('pagehide',     function () { log('🚪', 'pagehide'); pushToParent(); });
  window.addEventListener('beforeunload', function () { log('🚪', 'beforeunload'); pushToParent(); });

  // ── Console debug helper ─────────────────────────────────────────────
  window.relicBridgeStatus = function () {
    const data = collectGameData();
    console.group('%c[Relic Bridge] Status Report', 'color:#60a5fa;font-weight:bold;font-size:14px');
    console.log('Game ID        :', GAME_ID);
    console.log('ID source      :', window.__RELIC_GAME_ID__ ? 'injected ✅' : 'auto-detected ⚠️');
    console.log('In iframe      :', window.self !== window.top ? 'yes ✅' : 'NO ❌');
    console.log('Debug mode     :', DEBUG ? 'ON' : 'OFF');
    console.log('Saves pushed   :', saveCount);
    console.log('Restores done  :', restoreCount);
    console.log('Pending save   :', pendingSave);
    console.log('Game localStorage keys :', Object.keys(data));
    console.log('Game data      :', data);
    console.groupEnd();
  };

  // ── Kick off ─────────────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', requestSavedData);
  } else {
    requestSavedData();
  }

})();