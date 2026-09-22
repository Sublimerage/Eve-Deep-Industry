'use strict';

// Decodes unpadded Base64URL JWT payloads securely
function decodeJwt(token) {
  try {
    if (!token) return null;
    const parts = token.split('.');
    if (parts.length < 2) return null;
    const base64Url = parts[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const pad = base64.length % 4;
    const paddedBase64 = pad ? base64 + '='.repeat(4 - pad) : base64;
    return JSON.parse(atob(paddedBase64));
  } catch (e) {
    console.error('JWT Decode failed:', e);
    return null;
  }
}

// Fast O(1) Helper to look up exact item type name
function getItemTypeName(typeId) {
  if (!typeId) return '';
  if (window.TYPE_ID_TO_NAME && window.TYPE_ID_TO_NAME[typeId]) {
    return window.TYPE_ID_TO_NAME[typeId];
  }
  if (window.EVE_ITEMS && window.EVE_ITEMS[typeId]) {
    return window.EVE_ITEMS[typeId];
  }
  return '';
}

// Detects if an asset location flag belongs to ship slots or cargo
function isShipLocationFlag(flag) {
  if (!flag) return false;
  const f = flag.toLowerCase();
  return f.includes('cargo') || f.includes('dronebay') || f.includes('shiphangar') || 
         f.includes('fleethangar') || f.includes('subsystem') || f.includes('fighter') || 
         f.includes('highslot') || f.includes('medslot') || f.includes('lowslot') || 
         f.includes('rigslot') || f.includes('specialized') || f.includes('fuelbay') ||
         f.includes('autofit') || f.includes('corpsebay');
}

// Returns true if the item is an actual inventory container
function isContainerAsset(typeId) {
  const typeName = getItemTypeName(typeId);
  if (!typeName) return false;
  const t = typeName.toLowerCase();
  const isContainer = t.includes('container') || t.includes('canister') || t.includes('vault') || 
                      t.includes('freight') || t.includes('plastic wrap') || t.includes('audit log') || 
                      t.includes('box') || t.includes('crate') || t.includes('chest') || t.includes('can') ||
                      t.includes('hangar array') || t.includes('silo') || t.includes('storage') || t.includes('depot');
  const isShip = t.includes('frigate') || t.includes('destroyer') || t.includes('cruiser') ||
                 t.includes('battlecruiser') || t.includes('battleship') || t.includes('dreadnought') ||
                 t.includes('carrier') || t.includes('titan') || t.includes('corvette') ||
                 t.includes('industrial') || t.includes('freighter') || t.includes('barge') ||
                 t.includes('exhumer') || t.includes('shuttle') || t.includes('interdictor') ||
                 t.includes('covert ops') || t.includes('logistics') || t.includes('ship') ||
                 t.includes('transport') || t.includes('ibis') || t.includes('reaper') ||
                 t.includes('velator') || t.includes('impairor') || t.includes('taipan') ||
                 t.includes('venture') || t.includes('orca') || t.includes('rorqual');
  return isContainer && !isShip;
}

// Walks an item's location chain up through any nested containers to find its real root station/
// structure, and the first container (if any) it's sitting in - same logic already used to build
// the asset hierarchy, but reusable for anything with a location_id (e.g. a blueprint), not just
// during the asset refresh flow itself.
function resolveItemLocationHierarchy(locationId, itemIdToAssetMap) {
  let currentLoc = locationId;
  let depth = 0;
  let containerId = null;
  while (itemIdToAssetMap[currentLoc] && depth < 10) {
    const parentAsset = itemIdToAssetMap[currentLoc];
    if (isContainerAsset(parentAsset.type_id) && !containerId) {
      containerId = currentLoc;
    }
    currentLoc = parentAsset.location_id;
    depth++;
  }
  return { rootLocationId: currentLoc, containerId: containerId };
}
window.resolveItemLocationHierarchy = resolveItemLocationHierarchy;

function buildItemIdToAssetMap() {
  const map = {};
  (window.rawAssetItems || []).forEach(ast => {
    if (ast.item_id) map[ast.item_id] = ast;
  });
  return map;
}
window.buildItemIdToAssetMap = buildItemIdToAssetMap;


// Checks for Rookie Ships and all EVE ship hulls
function isShipType(typeId) {
  const rookieShipIds = new Set([
    601, 606, 608, 596, 33079, 33081, 33083, 33085,
    621, 622, 12005, 587, 24698, 644, 642, 643, 12015, 11987, 11989
  ]);
  if (typeId && rookieShipIds.has(typeId)) return true;
  const typeName = getItemTypeName(typeId);
  if (!typeName) return false;
  const t = typeName.toLowerCase();
  if (isContainerAsset(typeId)) return false;
  const shipTerms = [
    'frigate', 'destroyer', 'cruiser', 'battlecruiser', 'battleship', 'dreadnought',
    'carrier', 'supercarrier', 'titan', 'corvette', 'industrial', 'freighter',
    'mining barge', 'exhumer', 'shuttle', 'interdictor', 'covert ops', 'stealth bomber',
    'logistics', 'assault', 'recon', 'command ship', 'heavy assault', 'blockade runner',
    'deep space', 'jump freighter', 'tactical destroyer', 'strategic cruiser',
    'ibis', 'reaper', 'velator', 'impairor', 'taipan', 'hematite', 'violator', 'echo',
    'venture', 'procurer', 'retriever', 'covetor', 'orca', 'rorqual', 'bowhead',
    'heron', 'magnate', 'imicus', 'probe', 'condor', 'slicer', 'executioner', 'tormentor',
    'punisher', 'kestrel', 'merlin', 'tristan', 'inquisitor', 'navitas', 'bantam', 'ship'
  ];
  return shipTerms.some(term => t.includes(term));
}

// --- Multi-character session store -----------------------------------------------------------
// Every logged-in character's token bundle lives in ONE localStorage key, keyed by character id -
// this replaces the old scheme (a single flat esi_access_token/esi_char_id/etc. set, overwritten by
// every new login) so several characters can stay logged in simultaneously with instant switching
// between them, rather than requiring a fresh SSO login every time. eve_esi_active_char_id is a
// separate pointer at which one is currently "active" (whose data the rest of the app reads/renders).
function loadCharacterStore() {
  try {
    const raw = localStorage.getItem('eve_esi_characters');
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}
function saveCharacterStore(store) {
  localStorage.setItem('eve_esi_characters', JSON.stringify(store));
}
function getActiveCharId() {
  return localStorage.getItem('eve_esi_active_char_id') || null;
}
window.getActiveCharId = getActiveCharId;
function getCharacterRecord(charId) {
  if (!charId) return null;
  return loadCharacterStore()[charId] || null;
}
window.getCharacterRecord = getCharacterRecord;
function getActiveCharacterRecord() {
  return getCharacterRecord(getActiveCharId());
}
window.getActiveCharacterRecord = getActiveCharacterRecord;
// The one function nearly every existing "read esi_access_token from localStorage" call site swaps
// in for that flat read - resolves to whichever character is currently active.
function getActiveCharacterToken() {
  const record = getActiveCharacterRecord();
  return record ? record.accessToken : null;
}
window.getActiveCharacterToken = getActiveCharacterToken;
function upsertCharacter(tokenData) {
  const store = loadCharacterStore();
  store[tokenData.charId] = { ...(store[tokenData.charId] || {}), ...tokenData };
  saveCharacterStore(store);
}
function updateCharacterFields(charId, fields) {
  const store = loadCharacterStore();
  if (!store[charId]) return;
  store[charId] = { ...store[charId], ...fields };
  saveCharacterStore(store);
}

// One-time migration from the old single-character flat keys into the new multi-character store -
// runs harmlessly every load (no-ops once eve_esi_characters exists) so a user already logged in
// when this feature ships is never forced to re-authenticate.
function migrateSingleCharacterStorage() {
  if (localStorage.getItem('eve_esi_characters')) return;
  const charId = localStorage.getItem('esi_char_id');
  const accessToken = localStorage.getItem('esi_access_token');
  if (!charId || !accessToken) return; // nothing to migrate
  const store = {};
  store[charId] = {
    charId,
    charName: localStorage.getItem('esi_char_name') || '',
    accessToken,
    refreshToken: localStorage.getItem('esi_refresh_token') || '',
    tokenExpiry: parseInt(localStorage.getItem('esi_token_expiry')) || 0,
    corpId: localStorage.getItem('esi_corp_id') || null,
    corpName: localStorage.getItem('esi_corp_name') || '',
    corpTicker: localStorage.getItem('esi_corp_ticker') || ''
  };
  saveCharacterStore(store);
  localStorage.setItem('eve_esi_active_char_id', charId);
}

// Swaps which character is "active" - re-renders the header instantly, then refetches that
// character's live data (skills/assets/LP balances/stock map) the same way a fresh login already
// does, via fetchUserAndCorpAssets. Identity + the Ledger's job-visibility filter update immediately;
// live data shows the same brief refresh a login always has (see the plan's own note on why this
// wasn't fully namespaced per character - simpler, reuses an already-proven fetch path).
async function setActiveChar(charId) {
  const record = getCharacterRecord(charId);
  if (!record) return;
  localStorage.setItem('eve_esi_active_char_id', charId);
  updateEsiUserUI(record.charName, record.charId, record.corpName, record.corpTicker);
  window.dispatchEvent(new CustomEvent('eve:active-character-changed', { detail: { charId } }));
  let token = record.accessToken;
  const expiry = record.tokenExpiry || 0;
  if (record.refreshToken && Date.now() >= expiry - 30000) {
    const refreshed = await refreshEsiAccessToken(charId);
    if (refreshed) token = refreshed;
  }
  await fetchUserAndCorpAssets(charId, token);
}
window.setActiveChar = setActiveChar;

// Drops one character from the store. If it was the active one, switches to another registered
// character if any remain, otherwise falls back to a full logged-out state (same reset logoutEsiSSO
// used to always do unconditionally).
function removeCharacter(charId) {
  const store = loadCharacterStore();
  delete store[charId];
  saveCharacterStore(store);
  const remainingIds = Object.keys(store);
  if (getActiveCharId() !== charId) {
    renderCharacterSwitcherPopover(); // a non-active character's row changed - refresh the list if open
    return;
  }
  if (remainingIds.length > 0) {
    setActiveChar(remainingIds[0]);
    return;
  }
  localStorage.removeItem('eve_esi_active_char_id');
  localStorage.removeItem('eve_code_verifier');
  localStorage.removeItem('esi_code_verifier');
  localStorage.removeItem('esi_auth_state');
  localStorage.removeItem('eve_char_lp_balances');
  window.rawAssetItems = [];
  window.userStockMap = {};
  window.corpDivisionNames = {};
  const container = document.getElementById('esi-login-container');
  if (container) {
    container.innerHTML = `
      <button onclick="startEsiSSOLogin()" class="btn-glass btn-glass-muted px-3.5 py-2 text-xs flex items-center gap-1.5" title="Login with EVE Online to import your character assets">
        <svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px;"><rect x="5" y="11" width="14" height="9" rx="1.5"/><path d="M8 11V7a4 4 0 018 0v4"/></svg>
        EVE SSO Login
      </button>
    `;
  }
  window.dispatchEvent(new CustomEvent('eve:active-character-changed', { detail: { charId: null } }));
  if (typeof updateStockDisplayCount === 'function') updateStockDisplayCount();
  if (typeof populateLocationDropdown === 'function') populateLocationDropdown();
  if (typeof updateJournalStockCountBadge === 'function') updateJournalStockCountBadge();
  if (typeof populateJournalLocationDropdown === 'function') populateJournalLocationDropdown();
  if (typeof recalculate === 'function') {
    if (typeof window.withRootPanAnchor === 'function') window.withRootPanAnchor(async () => { await recalculate(); });
    else recalculate();
  } else if (typeof renderJournalPage === 'function') {
    renderJournalPage();
  }
}
window.removeCharacter = removeCharacter;

// Unified fetch wrapper that validates active login sessions and handles auth decay.
// suppressLogout: for auxiliary/non-essential calls (corp division names, corp assets, skills) whose
// failure (missing scope, missing corp role, etc.) is a normal, expected outcome for many characters
// and must never be treated as "the whole session is invalid."
// charId: which character's refresh token to use if this call 401s - defaults to the active
// character, but a background call made on behalf of a SPECIFIC registered character (e.g. the
// multi-character blueprint merge in syncWithEveIndustryJobs) should pass that character's own id so
// a failed refresh/logout only ever affects THAT character, not whichever one happens to be active.
async function fetchWithAuth(url, options = {}, token, suppressLogout = false, charId = null) {
  if (!options.headers) options.headers = {};
  options.headers['Authorization'] = `Bearer ${token}`;
  try {
    let res = await fetch(url, options);
    if (res.status === 401) {
      // The access token may have simply expired since it was handed to this function - try one
      // silent refresh-and-retry before giving up, instead of immediately logging the character out.
      const refreshed = await refreshEsiAccessToken(charId);
      if (refreshed) {
        options.headers['Authorization'] = `Bearer ${refreshed}`;
        res = await fetch(url, options);
      }
      if (res.status === 401) {
        if (suppressLogout) {
          console.warn("Auxiliary ESI call unauthorized (401/missing scope) - skipping without logging out:", url);
          return null;
        }
        console.warn("SSO Token expired or unauthorized (401), and refresh failed. Executing clean logout.");
        logoutEsiSSO(charId);
        return null;
      }
    }
    return res;
  } catch (err) {
    console.error("fetchWithAuth network error for URL:", url, err);
    throw err;
  }
}

// Exchanges one character's stored refresh_token for a new access token. EVE SSO access tokens
// expire in ~20 minutes; without this, any reload or long session inevitably hits a 401 and gets
// logged out. charId defaults to the active character - see fetchWithAuth's own comment on why a
// caller acting on behalf of a specific non-active character should pass its id explicitly.
//
// Single-flighted per character: syncWithEveIndustryJobs (and similar) fire several ESI calls in
// parallel, and if the access token has already expired by the time they run, ALL of them hit a 401
// at once and each independently called this function - reported directly as a sync that silently
// dropped some data (missing blueprint entries broke ME/TE job-matching) the first time, then worked
// cleanly on an immediate retry. Root cause confirmed from that report's console log: EVE SSO
// rotates the refresh token on every use, so of several simultaneous refresh POSTs using the SAME
// stored refresh_token, only the first to arrive succeeds - the rest get rejected (that token's
// already been spent by the winner) and silently return null (suppressLogout paths), quietly
// starving whichever ESI call lost the race of its data. Caching the in-flight PROMISE (not just a
// boolean) per charId means every concurrent caller during that window awaits the one real network
// call and shares its result, instead of racing separate refresh attempts against each other.
const _refreshTokenInFlight = new Map(); // charId -> Promise<string|null>
async function refreshEsiAccessToken(charId) {
  charId = charId || getActiveCharId();
  if (_refreshTokenInFlight.has(charId)) return _refreshTokenInFlight.get(charId);

  const doRefresh = (async () => {
    const record = getCharacterRecord(charId);
    if (!record || !record.refreshToken) return null;
    try {
      const body = new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: window.HARDCODED_CLIENT_ID,
        refresh_token: record.refreshToken
      });
      const res = await fetch('https://login.eveonline.com/v2/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body
      });
      if (!res.ok) return null;
      const tokenData = await res.json();
      if (!tokenData.access_token) return null;
      const expiresAt = Date.now() + ((parseInt(tokenData.expires_in) || 1200) * 1000);
      updateCharacterFields(charId, {
        accessToken: tokenData.access_token,
        tokenExpiry: expiresAt,
        ...(tokenData.refresh_token ? { refreshToken: tokenData.refresh_token } : {})
      });
      return tokenData.access_token;
    } catch (err) {
      console.warn('ESI token refresh failed:', err);
      return null;
    }
  })();

  _refreshTokenInFlight.set(charId, doRefresh);
  try {
    return await doRefresh;
  } finally {
    _refreshTokenInFlight.delete(charId);
  }
}

// Strict ESI Adjusted Price Fetcher
async function fetchAdjustedPrices() {
  if (typeof updateEivIndicator === 'function') updateEivIndicator('loading');
  const targetUrl = 'https://esi.evetech.net/latest/markets/prices/?datasource=tranquility';
  const tryUrls = [targetUrl, `https://corsproxy.io/?${encodeURIComponent(targetUrl)}`];
  for (const url of tryUrls) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);
      if (res.ok) {
        let data = await res.json();
        if (data && data.contents && typeof data.contents === 'string') {
          try { data = JSON.parse(data.contents); } catch(e){}
        }
        if (Array.isArray(data) && data.length > 0) {
          window.eivCache = {};
          data.forEach(item => {
            if (item.adjusted_price !== undefined && item.adjusted_price !== null) {
              window.eivCache[item.type_id] = parseFloat(item.adjusted_price);
            }
          });
          if (typeof updateEivIndicator === 'function') updateEivIndicator('ready');
          if (window.recipeTreeRoot && typeof recalculate === 'function') {
            if (typeof window.withRootPanAnchor === 'function') window.withRootPanAnchor(async () => { await recalculate(); });
            else recalculate();
          }
          return;
        }
      }
    } catch (e) {
      console.warn('ESI price fetch attempt failed for ' + url, e);
    }
  }
  if (typeof updateEivIndicator === 'function') updateEivIndicator('offline');
}

function getEIV(typeId) {
  if (window.eivCache && window.eivCache[typeId] !== undefined && window.eivCache[typeId] !== null) {
    return window.eivCache[typeId];
  }
  return 0;
}

function calculateNodeEIV(node) {
  if (!node) return;
  if (node.recipe && node.recipe.materials && node.recipe.materials.length > 0) {
    let baseRunEIV = 0;
    node.recipe.materials.forEach(m => {
      baseRunEIV += getEIV(m.typeId) * m.baseQty;
    });
    const batchYield = node.batchYield || 1;
    node.unitEIV = baseRunEIV / batchYield;
    node.jobEIV = baseRunEIV * node.runsNeeded;
  } else {
    node.unitEIV = getEIV(node.displayTypeId || node.typeId);
    node.jobEIV = node.unitEIV * node.qtyNeeded;
  }
  if (node.children && node.children.length > 0) {
    node.children.forEach(child => calculateNodeEIV(child));
  }
}

// Safely generate a folder-normalized absolute redirect URI
function getCleanRedirectUri() {
  const hostname = window.location.hostname.toLowerCase();
  if (hostname === 'sublimerage.github.io') {
    return 'https://sublimerage.github.io/Eve-BP-Calculator/';
  }
  let pathname = window.location.pathname;
  if (pathname.endsWith('.html')) {
    pathname = pathname.substring(0, pathname.lastIndexOf('/') + 1);
  } else if (!pathname.endsWith('/')) {
    pathname += '/';
  }
  return window.location.origin + pathname;
}

// --- EVE ESI SSO LOGIN & ASSETS (PKCE FLOW) ---
function generateRandomString(length) {
  const array = new Uint8Array(length);
  window.crypto.getRandomValues(array);
  return Array.from(array, byte => ('0' + (byte & 0xFF).toString(16)).slice(-2)).join('');
}

async function sha256(plain) {
  const encoder = new TextEncoder();
  const data = encoder.encode(plain);
  return window.crypto.subtle.digest('SHA-256', data);
}

function base64urlEncode(a) {
  let str = "";
  const bytes = new Uint8Array(a);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    str += String.fromCharCode(bytes[i]);
  }
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// intent: 'add' when this is "log in another character" while one is already active (the callback
// upserts the new character into the store rather than treating it as the only one) - omitted/any
// other value for a normal first login. Stashed in sessionStorage (not the URL) since it needs to
// survive the full-page redirect to login.eveonline.com and back.
async function startEsiSSOLogin(intent) {
  sessionStorage.setItem('esi_login_intent', intent === 'add' ? 'add' : 'primary');
  const clientId = window.HARDCODED_CLIENT_ID;
  const verifier = generateRandomString(32);
  localStorage.setItem('esi_code_verifier', verifier);
  const hashed = await sha256(verifier);
  const challenge = base64urlEncode(hashed);
  const redirectUri = getCleanRedirectUri();
  // "invalid_request: redirect URL does not match" comes directly from login.eveonline.com and means
  // this exact string isn't registered as a Callback URL on the app's EVE Developer Application page
  // (https://developers.eveonline.com) for this Client ID. Log it so it can be copied verbatim -
  // including the trailing slash, which EVE matches exactly.
  console.info(`[EVE SSO] Sending redirect_uri: "${redirectUri}" - this exact string must be registered as a Callback URL for Client ID ${clientId} at https://developers.eveonline.com`);
  // esi-characters.read_loyalty.v1 added for the LP Store's "LP Owned" panel - anyone who logged in
  // before this was added has a token without it (missing-scope calls come back 401/403, handled as
  // an expected, non-fatal outcome by fetchLPBalances/fetchWithAuth's suppressLogout - see there);
  // they need to log in again once to grant it, same as any other newly-added scope would require.
  const scope = 'esi-assets.read_assets.v1 esi-assets.read_corporation_assets.v1 esi-universe.read_structures.v1 esi-skills.read_skills.v1 esi-corporations.read_divisions.v1 esi-industry.read_character_jobs.v1 esi-industry.read_corporation_jobs.v1 esi-characters.read_blueprints.v1 esi-corporations.read_blueprints.v1 esi-search.search_structures.v1 esi-characters.read_loyalty.v1';
  const state = generateRandomString(16);
  localStorage.setItem('esi_auth_state', state);
  const authUrl = `https://login.eveonline.com/v2/oauth/authorize/?response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&client_id=${encodeURIComponent(clientId)}&scope=${encodeURIComponent(scope)}&code_challenge=${challenge}&code_challenge_method=S256&state=${state}`;
  window.location.href = authUrl;
}

async function handleEsiSSOCallback() {
  const urlParams = new URLSearchParams(window.location.search);
  const ssoError = urlParams.get('error');
  if (ssoError) {
    // Some SSO failures (e.g. the user declining consent) do redirect back with ?error=... instead of
    // failing directly on login.eveonline.com - surface those instead of failing silently.
    const desc = decodeURIComponent((urlParams.get('error_description') || '').replace(/\+/g, ' '));
    console.error('EVE SSO Error:', ssoError, desc);
    window.history.replaceState({}, document.title, window.location.pathname);
    const statusText = document.getElementById('status-text');
    const statusDot = document.getElementById('status-dot');
    if (statusText) statusText.textContent = `EVE SSO LOGIN FAILED: ${desc || ssoError}`;
    if (statusDot) statusDot.className = 'w-2.5 h-2.5 rounded-full bg-red-500';
    return;
  }
  const code = urlParams.get('code');
  if (!code) {
    migrateSingleCharacterStorage();
    const record = getActiveCharacterRecord();
    if (record) {
      let token = record.accessToken;
      if (record.refreshToken && Date.now() >= (record.tokenExpiry || 0) - 30000) {
        const refreshed = await refreshEsiAccessToken(record.charId);
        if (refreshed) {
          token = refreshed;
        } else {
          // Refresh token is invalid/revoked, so the cached access token is stale too - log out
          // cleanly instead of showing a "logged in" button that will immediately fail on any call.
          logoutEsiSSO(record.charId);
          return;
        }
      }
      updateEsiUserUI(record.charName, record.charId, record.corpName, record.corpTicker);
      await fetchUserAndCorpAssets(record.charId, token);
    }
    return;
  }
  const verifier = localStorage.getItem('esi_code_verifier');
  if (!verifier) return;
  window.history.replaceState({}, document.title, window.location.pathname);
  try {
    const redirectUri = getCleanRedirectUri();
    const clientId = window.HARDCODED_CLIENT_ID;
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId,
      code: code,
      code_verifier: verifier,
      redirect_uri: redirectUri
    });
    const res = await fetch('https://login.eveonline.com/v2/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body
    });
    if (res.ok) {
      const tokenData = await res.json();
      const accessToken = tokenData.access_token;
      const jwtPayload = decodeJwt(accessToken);
      if (jwtPayload) {
        const charId = String(jwtPayload.sub.split(':')[2]).trim();
        const charName = jwtPayload.name;
        const expiresAt = Date.now() + ((parseInt(tokenData.expires_in) || 1200) * 1000);
        migrateSingleCharacterStorage(); // in case an old single-character session is still on flat keys
        upsertCharacter({
          charId, charName, accessToken,
          tokenExpiry: expiresAt,
          ...(tokenData.refresh_token ? { refreshToken: tokenData.refresh_token } : {})
        });
        sessionStorage.removeItem('esi_login_intent');
        // The just-authenticated character always becomes active, whether this was the first login
        // or "add another character" - matches "I just logged in as X" expectations rather than
        // silently registering it in the background (confirmed with the user).
        await setActiveChar(charId);
      }
    } else {
      console.error("SSO Code Exchange Failed:", res.status, await res.text());
      reportSsoLoginFailure(`Login failed (${res.status}). Please try again.`);
    }
  } catch (err) {
    console.error('ESI SSO Token Error:', err);
    reportSsoLoginFailure('Login failed - check your connection and try again.');
  }
}

function reportSsoLoginFailure(message) {
  const statusText = document.getElementById('status-text');
  const statusDot = document.getElementById('status-dot');
  if (statusText) statusText.textContent = 'EVE SSO LOGIN FAILED';
  if (statusDot) statusDot.className = 'w-2.5 h-2.5 rounded-full bg-red-500';
  if (typeof window.showToast === 'function') window.showToast(message, 'error');
}

// The pilot badge now also carries a small switcher caret - opens a popover listing every
// REGISTERED character (not just this one), so switching never needs a fresh SSO login. Built
// entirely here (not in the 4 HTML files) since container.innerHTML replacement already means every
// page picks this up for free - same reasoning the pilot badge itself was originally added with.
function updateEsiUserUI(charName, charId, corpName, corpTicker) {
  const container = document.getElementById('esi-login-container');
  if (!container) return;
  const safeName = window.esc(charName);
  const record = getCharacterRecord(charId);
  const ticker = corpTicker || (record && record.corpTicker) || '';
  const safeTicker = window.esc(ticker);
  const safeCorpName = window.esc(corpName || (record && record.corpName) || '');
  container.innerHTML = `
    <div class="pilot-badge mono" title="${safeName}${safeCorpName ? ' — ' + safeCorpName : ''}">
      <img src="https://images.evetech.net/characters/${charId}/portrait?size=128" alt="${safeName}" class="pilot-portrait" loading="lazy" onerror="this.onerror=null; this.src='https://images.evetech.net/characters/1/portrait?size=128';">
      <div class="pilot-meta">
        <span class="pilot-name">${safeName}</span>
        ${ticker ? `<span class="pilot-corp">[${safeTicker}]</span>` : ''}
      </div>
      <button type="button" onclick="toggleCharacterSwitcherPopover(event)" class="pilot-switch-btn" title="Switch character">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="width:11px;height:11px;"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
      <span class="pilot-dot"></span>
      <button onclick="logoutEsiSSO()" class="pilot-logout" title="Log out this character">
        <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" style="width:12px;height:12px;"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
    <div id="esi-char-switcher-popover" class="pilot-switcher-popover glass-card hidden">
      <div id="esi-char-switcher-list" class="pilot-switcher-list"></div>
      <button type="button" onclick="startEsiSSOLogin('add')" class="pilot-switcher-add">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:12px;height:12px;"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Add Character
      </button>
    </div>
  `;
}

// Rebuilds the switcher popover's character list from the store - called whenever it's opened, and
// whenever a non-active character is added/removed while it's already open.
function renderCharacterSwitcherPopover() {
  const list = document.getElementById('esi-char-switcher-list');
  if (!list) return; // popover isn't in the DOM at all (logged out) - nothing to refresh
  const store = loadCharacterStore();
  const activeId = getActiveCharId();
  const chars = Object.values(store).sort((a, b) => (a.charName || '').localeCompare(b.charName || ''));
  list.innerHTML = chars.length ? chars.map(c => `
    <div class="pilot-switcher-row${c.charId === activeId ? ' pilot-switcher-row-active' : ''}" ${c.charId === activeId ? '' : `onclick="setActiveChar('${c.charId}')"`}>
      <img src="https://images.evetech.net/characters/${c.charId}/portrait?size=64" alt="" class="pilot-switcher-portrait" loading="lazy" onerror="this.onerror=null; this.src='https://images.evetech.net/characters/1/portrait?size=64';">
      <div class="pilot-switcher-meta">
        <span class="pilot-switcher-name">${window.esc(c.charName || 'Unknown')}</span>
        ${c.corpTicker ? `<span class="pilot-switcher-ticker">[${window.esc(c.corpTicker)}]</span>` : ''}
      </div>
      ${c.charId === activeId
        ? '<span class="pilot-switcher-active-dot" title="Currently active"></span>'
        : `<button type="button" onclick="event.stopPropagation(); removeCharacter('${c.charId}');" class="pilot-switcher-remove" title="Log out this character">&times;</button>`}
    </div>
  `).join('') : `<div class="pilot-switcher-empty">No other characters registered.</div>`;
}

function openCharacterSwitcherPopover() {
  renderCharacterSwitcherPopover();
  document.getElementById('esi-char-switcher-popover')?.classList.remove('hidden');
}
function closeCharacterSwitcherPopover() {
  document.getElementById('esi-char-switcher-popover')?.classList.add('hidden');
}
function toggleCharacterSwitcherPopover(e) {
  if (e) e.stopPropagation();
  const popover = document.getElementById('esi-char-switcher-popover');
  if (!popover) return;
  if (popover.classList.contains('hidden')) openCharacterSwitcherPopover();
  else closeCharacterSwitcherPopover();
}
window.toggleCharacterSwitcherPopover = toggleCharacterSwitcherPopover;

// Click-outside-to-close - composedPath() captured at dispatch time (not container.contains(e.target)),
// same reasoning js/lpstore.js's own corp-popover listener already documents: a re-render triggered by
// the same click (e.g. setActiveChar rebuilding this exact container) can detach the original target
// from the DOM before a plain .contains() check would run, making it always return false.
document.addEventListener('click', (e) => {
  const popover = document.getElementById('esi-char-switcher-popover');
  if (!popover || popover.classList.contains('hidden')) return;
  const container = document.getElementById('esi-login-container');
  const path = typeof e.composedPath === 'function' ? e.composedPath() : [e.target];
  if (!container || !path.includes(container)) closeCharacterSwitcherPopover();
});

// Logs out ONE character - defaults to the active one (the pilot badge's own logout button, and
// fetchWithAuth's unrecoverable-401 path, both rely on this default). See removeCharacter for the
// actual store mutation + "switch to another registered character if any remain" logic.
function logoutEsiSSO(charId) {
  removeCharacter(charId || getActiveCharId());
}

async function refreshLiveAssets() {
  const charId = getActiveCharId();
  const token = getActiveCharacterToken();
  if (!charId || !token) {
    startEsiSSOLogin();
    return;
  }
  const statusText = document.getElementById('status-text');
  const statusDot = document.getElementById('status-dot');
  if (statusText) statusText.textContent = 'REFRESHING LIVE ESI ASSETS...';
  if (statusDot) statusDot.className = 'w-2.5 h-2.5 rounded-full bg-amber-400';
  window.resolvedLocationNames = {};
  window.userStockMap = {};
  const ok = await fetchUserAndCorpAssets(charId, token);
  if (statusDot) statusDot.className = `w-2.5 h-2.5 rounded-full ${ok ? 'bg-green-400' : 'bg-red-400'}`;
  if (statusText) statusText.textContent = ok ? 'ASSETS REFRESHED' : 'ASSET REFRESH FAILED';
  if (!ok && typeof window.showToast === 'function') {
    window.showToast('Failed to refresh assets - check your connection, or your login may have expired.', 'error');
  }
}

// Builds a { [blueprintTypeId]: {me, te} } index of the BEST-researched BPO (a true blueprint
// original - ESI quantity === -1, never a BPC, which is consumed on use and whose runs might
// already be earmarked for something else) the active character or their corp owns, across every
// station. This is what lets clicking "Build" on a component default its Job ME/TE to what you'd
// ACTUALLY build it at instead of an unresearched 0%/0% guess - see getBestOwnedBpoMeTe's callers
// in js/tree.js (fresh nodes) and js/app.js's syncTreeOverrides (existing nodes, every recalculate).
// Character + corp blueprints merged the same way js/ledger.js's own blueprintMeTeMap already does
// for matching a real EVE job back to the blueprint that ran it - reusing the same two fetchers.
async function refreshOwnedBpoIndex() {
  const charId = getActiveCharId();
  const token = getActiveCharacterToken();
  if (!charId || !token) return;
  try {
    const [charBps, corpBps] = await Promise.all([fetchCharacterBlueprints(), fetchCorpBlueprints()]);
    const index = {};
    [...(charBps || []), ...(corpBps || [])].forEach(bp => {
      if (bp.quantity !== -1) return; // BPOs only - see the comment above on why BPCs don't count
      const me = bp.material_efficiency || 0;
      const te = bp.time_efficiency || 0;
      const existing = index[bp.type_id];
      if (!existing || me > existing.me || (me === existing.me && te > existing.te)) {
        index[bp.type_id] = { me, te };
      }
    });
    window.ownedBpoMeTeIndex = index;
    localStorage.setItem('eve_owned_bpo_index_v1', JSON.stringify({ index, fetchedAt: Date.now() }));
  } catch (e) {
    console.warn('Owned BPO index refresh failed:', e);
  }
}
window.refreshOwnedBpoIndex = refreshOwnedBpoIndex;

// Instant repaint on page load, before the live re-fetch above lands - same "show the cached
// answer immediately, then refresh in the background" pattern the rest of this app already uses
// for prices/assets, rather than a fresh manufacturable node defaulting to 0/0 for a few seconds
// while ESI is still being asked.
function restoreOwnedBpoIndexFromCache() {
  try {
    const raw = localStorage.getItem('eve_owned_bpo_index_v1');
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (parsed && parsed.index) window.ownedBpoMeTeIndex = parsed.index;
  } catch (e) { /* ignore - falls back to 0/0 same as never having fetched */ }
}
window.restoreOwnedBpoIndexFromCache = restoreOwnedBpoIndexFromCache;

// The single canonical read - null (not 0/0) when nothing owned or not logged in, so callers can
// tell "genuinely defaults to 0/0" apart from "owns a 0%/0% unresearched BPO" if they ever need to.
function getBestOwnedBpoMeTe(blueprintTypeId) {
  return (window.ownedBpoMeTeIndex && window.ownedBpoMeTeIndex[blueprintTypeId]) || null;
}
window.getBestOwnedBpoMeTe = getBestOwnedBpoMeTe;

async function fetchUserAndCorpAssets(charId, accessToken) {
  let assetsFetchOk = false;
  // Set the moment ANY page request outright fails mid-pagination (401 even after a refresh retry,
  // network error, etc.) - distinct from the loop's OTHER exit path (an empty page, meaning
  // pagination finished normally). Without this, a token that expired between page 1 and page 2
  // still left assetsFetchOk=true (page 1 alone set it), so a partial asset list silently reported
  // "ASSETS REFRESHED" success with genuinely incomplete stock data - exactly what made "stock
  // numbers are wrong and clicking Refresh Assets again doesn't fix it" possible even though the
  // very next click usually has a valid token again by then and would have picked up the rest.
  let assetsPaginationFailed = false;
  try {
    window.rawAssetItems = [];
    // Guards against the same physical item being counted twice - reported directly as a real,
    // randomly-varying stock count (1, then 2, then 3, on repeated refreshes) for an item confirmed
    // to genuinely be at 0. Most likely tied to fetching a character/corp's asset pages concurrently
    // (see fetchAssetPages below) instead of one at a time in strict order: ESI's own pagination
    // isn't guaranteed to hand back perfectly stable page boundaries across several near-simultaneous
    // requests the way one strictly sequential walk naturally was, so the same item can land on more
    // than one page. item_id is unique per physical item/stack across all of EVE (never shared
    // between a character's and a corp's own assets either), so it's a safe, simple key to dedupe on
    // regardless of the exact mechanism behind a duplicate - this protects against that whole class
    // of bug rather than needing to prove the precise cause first.
    const seenAssetItemIds = new Set();
    let corpId = null;
    // Fired in parallel, not awaited - blueprint ownership has nothing to do with the asset walk
    // below and shouldn't hold up "ASSETS REFRESHED" landing.
    refreshOwnedBpoIndex().catch(e => console.warn('Owned BPO index refresh failed:', e));
    const charRes = await fetch(`https://esi.evetech.net/latest/characters/${charId}/?datasource=tranquility`);
    if (charRes.ok) {
      const charData = await charRes.json();
      corpId = charData.corporation_id;
      if (corpId) updateCharacterFields(charId, { corpId: String(corpId) });
      // Public endpoint, no auth needed - just the corp name/ticker for the header's pilot badge.
      // Fired off without blocking the asset fetch below; updates the badge in place once it lands.
      if (corpId) {
        fetch(`https://esi.evetech.net/latest/corporations/${corpId}/?datasource=tranquility`)
          .then(r => r.ok ? r.json() : null)
          .then(corpData => {
            if (!corpData || !corpData.ticker) return;
            updateCharacterFields(charId, { corpName: corpData.name || '', corpTicker: corpData.ticker });
            // Only re-render the badge if this fetch is still for the ACTIVE character - it's fired
            // off async and the user may have switched characters (or logged this one out) by the
            // time it resolves.
            if (getActiveCharId() === charId) updateEsiUserUI(getCharacterRecord(charId).charName, charId, corpData.name, corpData.ticker);
          })
          .catch(e => console.warn('[ESI] Corp info fetch failed:', e));
      }
    }
    // Corp divisions, skills, and loyalty points are three independent ESI calls - none of them
    // reads anything the other two write - but used to run one after another regardless, each
    // paying its own full round-trip latency in sequence before the asset pagination below could
    // even start. On a real connection that's easily 1-2+ seconds of pure waiting with nothing
    // else happening, and since this whole function fires automatically on every page load for a
    // logged-in character (handleEsiSSOCallback), that delay could still be running in the
    // background the first time you interact with the page - reported directly as "the first
    // click after a refresh lags 2-3 seconds, every click after that is instant" (this function
    // only ever runs once per load; every later call today, per-toggle recalculates, isn't waiting
    // on it). Running them together cuts this to whichever single one is slowest, not the sum of
    // all three.
    const divisionsPromise = (async () => {
      if (!(corpId && accessToken)) return;
      try {
        const divRes = await fetchWithAuth(`https://esi.evetech.net/latest/corporations/${corpId}/divisions/?datasource=tranquility`, {}, accessToken, true);
        if (divRes && divRes.ok) {
          const divData = await divRes.json();
          if (divData && Array.isArray(divData.hangar)) {
            divData.hangar.forEach(d => {
              if (d.division && d.name) {
                window.corpDivisionNames[d.division] = d.name.toUpperCase();
              }
            });
          }
        }
      } catch (e) { console.warn('[ESI] Corp division names fetch failed - hangar divisions will show as generic names:', e); }
    })();

    const skillsPromise = (async () => {
      try {
        const skillsRes = await fetchWithAuth(`https://esi.evetech.net/latest/characters/${charId}/skills/?datasource=tranquility`, {}, accessToken, true);
        if (skillsRes && skillsRes.ok) {
          const skillsData = await skillsRes.json();
          if (skillsData && Array.isArray(skillsData.skills)) {
            let indLevel = 0;
            let advIndLevel = 0;
            const allSkills = {};
            skillsData.skills.forEach(sk => {
              const level = sk.active_skill_level !== undefined ? sk.active_skill_level : (sk.trained_skill_level || 0);
              allSkills[sk.skill_id] = level;
              if (sk.skill_id === 3380) indLevel = level;
              if (sk.skill_id === 3388) advIndLevel = level;
            });
            // Store the FULL skill sheet too, not just Industry/Advanced Industry - many blueprints
            // (T2, T3, faction, Triglavian) require specific science/engineering skills that ALSO grant
            // their own 1%/level manufacturing time reduction for items requiring that skill, on top of
            // the generic Industry/Advanced Industry bonuses. Matching those needs the player's actual
            // trained level in every such skill, not just the two generic ones.
            localStorage.setItem('eve_char_skills', JSON.stringify({ industry: indLevel, advIndustry: advIndLevel, allSkills: allSkills }));
          }
        }
      } catch (e) {
        console.warn('ESI Skills fetch failed:', e);
      }
    })();

    // suppressLogout:true - most characters logged in before esi-characters.read_loyalty.v1 was
    // added won't have it on their existing token yet (a 401/403 here is the normal, expected
    // outcome for them, not a broken session) until they log in again once to grant it.
    const loyaltyPromise = (async () => {
      try {
        const lpRes = await fetchWithAuth(`https://esi.evetech.net/latest/characters/${charId}/loyalty/points/?datasource=tranquility`, { cache: 'no-store' }, accessToken, true);
        if (lpRes && lpRes.ok) {
          const lpData = await lpRes.json();
          if (Array.isArray(lpData)) {
            const byCorpId = {};
            lpData.forEach(entry => { byCorpId[entry.corporation_id] = entry.loyalty_points; });
            localStorage.setItem('eve_char_lp_balances', JSON.stringify({ fetchedAt: Date.now(), byCorpId }));
          }
        } else if (lpRes) {
          // A real response, just not ok (401/403 = missing scope on an older token) - record that
          // explicitly rather than leaving a stale/absent value, so the LP Store's "LP Owned" panel
          // can tell "we asked and were refused" apart from "never asked yet" and prompt a re-login.
          localStorage.setItem('eve_char_lp_balances', JSON.stringify({ fetchedAt: Date.now(), missingScope: true }));
        }
      } catch (e) {
        console.warn('ESI Loyalty points fetch failed:', e);
      }
    })();

    // Character attributes (Charisma/Intelligence/Memory/Perception/Willpower) - same scope as the
    // skills fetch above (esi-skills.read_skills.v1 covers both endpoints), so this needed no new
    // OAuth consent screen for anyone already logged in. ESI's own returned values here are the
    // character's CURRENT effective attributes - implants and any attribute remap already baked in,
    // confirmed directly (not just assumed) against how EVEMon's own source has to SUBTRACT implant
    // bonuses back out of this same raw value to recover a "base" figure - proof the raw ESI number
    // already includes them. That's what makes the Skills tab's training-time estimate able to
    // honestly say "given your current attribute remap and implants" without a second endpoint/scope
    // just to read implants separately.
    const attributesPromise = (async () => {
      try {
        const attrRes = await fetchWithAuth(`https://esi.evetech.net/latest/characters/${charId}/attributes/?datasource=tranquility`, {}, accessToken, true);
        if (attrRes && attrRes.ok) {
          const attrData = await attrRes.json();
          if (attrData && typeof attrData.intelligence === 'number') {
            localStorage.setItem('eve_char_attributes', JSON.stringify({
              charisma: attrData.charisma, intelligence: attrData.intelligence, memory: attrData.memory,
              perception: attrData.perception, willpower: attrData.willpower, fetchedAt: Date.now()
            }));
          }
        }
      } catch (e) {
        console.warn('ESI Attributes fetch failed:', e);
      }
    })();

    await Promise.all([divisionsPromise, skillsPromise, loyaltyPromise, attributesPromise]);

    // Character assets and corp assets are two completely independent paginated walks - different
    // endpoint, different data, neither reads what the other writes (each only ever pushes its own
    // owner_type-tagged entries into the shared window.rawAssetItems array, which is safe to do
    // concurrently in JS's single-threaded model). These used to run one fully to completion before
    // the other even started; for an active character/corp with several pages of assets each, that
    // doubled the total pagination wait for no reason. Running them together overlaps that wait
    // instead of stacking it - see the divisions/skills/loyalty comment above for the fuller "why"
    // this whole function's total latency matters (it's what was making the first click after a
    // page load feel laggy).
    // no-store below - same reasoning as the industry-jobs fetch further down: without it, clicking
    // "Refresh Assets" again within the browser's own HTTP cache window for this exact URL+page can
    // be answered straight from that cache with zero network request, silently replaying the same
    // stale item locations/quantities instead of even asking ESI again - exactly what makes newly
    // hauled cargo (or anything else that moved) look like it never arrived. This can't do anything
    // about ESI's OWN server-side cache on this endpoint (CCP's, not this app's, and unavoidable by
    // any client - typically on the order of an hour) - a fresh haul can still take a while to show
    // up no matter what - but it guarantees a manual refresh always at least ASKS ESI fresh.
    //
    // Fetches page 1, then uses the X-Pages header ESI returns on every paginated response (confirmed
    // live - a real fetch() against a public ESI endpoint exposes it as a readable header) to fetch
    // every remaining page directly and in parallel - instead of walking one page at a time and only
    // discovering the end by probing one page past it, which is what used to make this loop pay for
    // BOTH a wasted request (that final page always comes back 404, since ESI's asset endpoints
    // signal "past the last page" that way instead of an empty array - harmless, but still a real
    // round trip) AND full sequential latency for anyone with several pages of assets (page 2 never
    // even started until page 1 finished, and so on). Falls back to that exact old probe-until-empty-
    // or-404 walk if X-Pages is ever missing for some reason, so a change here can only ever match or
    // beat the old behavior, never regress it.
    async function fetchAssetPages(urlBase, token, suppressLogout, ownerType, markFetchOk) {
      const applyPage = (data) => {
        if (!Array.isArray(data)) return;
        data.forEach(ast => {
          // is_blueprint_copy is present (true OR false) only on blueprint-type assets, absent on
          // everything else - excluding it here stops a BPO/BPC from ever being counted as stock of
          // the item it produces (they're always distinct type_ids, but a blueprint sitting in a
          // hangar is never "stock" of the manufactured item either way). Reported directly, and
          // confirmed against a real raw asset entry: a CORP-owned blueprint sitting in a corp hangar
          // division came back from ESI with is_blueprint_copy genuinely absent from the response,
          // the same as a real "not a blueprint" item - it slipped straight through this check and
          // got counted as 1 unit of physical stock of the item it actually just builds, showing up
          // as phantom stock nobody could ever find, for exactly one specific typeId, exactly as
          // reported. Rather than chase why ESI's response was missing that field for this one asset,
          // this app already has every real blueprint's own typeId from its own recipe data - a
          // second, independent check that doesn't depend on that ESI field being present at all, so
          // this class of asset can never slip through regardless of whatever else might cause the
          // same field to go missing on some other item.
          const looksLikeBlueprintViaRecipeData = !!(window.recipeMap && window.recipeMap[ast.type_id]
            && parseInt(window.recipeMap[ast.type_id].blueprintTypeID) === ast.type_id);
          if (ast.type_id && ast.quantity && ast.is_blueprint_copy === undefined && !looksLikeBlueprintViaRecipeData) {
            if (seenAssetItemIds.has(ast.item_id)) return; // already counted from another page - see seenAssetItemIds' own comment above
            seenAssetItemIds.add(ast.item_id);
            window.rawAssetItems.push({
              item_id: ast.item_id,
              type_id: ast.type_id,
              quantity: ast.quantity,
              location_id: ast.location_id,
              location_flag: ast.location_flag,
              owner_type: ownerType
            });
          }
        });
      };

      const firstRes = await fetchWithAuth(`${urlBase}&page=1`, { cache: 'no-store' }, token, suppressLogout);
      if (!(firstRes && firstRes.ok)) {
        // Page 1 itself failing is always a real problem - there's no "past the last page" reading
        // of a 404 (or anything else) on the very first page, unlike page 2+ below.
        assetsPaginationFailed = true;
        return;
      }
      if (markFetchOk) assetsFetchOk = true;
      recordEsiAssetsExpiry(firstRes);
      applyPage(await firstRes.json());

      const xPagesHeader = firstRes.headers && firstRes.headers.get ? firstRes.headers.get('X-Pages') : null;
      const totalPages = xPagesHeader ? parseInt(xPagesHeader, 10) : NaN;

      if (Number.isFinite(totalPages) && totalPages > 1) {
        const remainingPages = [];
        for (let p = 2; p <= totalPages; p++) remainingPages.push(p);
        await Promise.all(remainingPages.map(async (p) => {
          const res = await fetchWithAuth(`${urlBase}&page=${p}`, { cache: 'no-store' }, token, suppressLogout);
          if (res && res.ok) {
            recordEsiAssetsExpiry(res);
            applyPage(await res.json());
          } else {
            // ESI itself just told us (via X-Pages) this page exists - failing to actually load it
            // is a real problem, not the normal "probed past the end" case the fallback walk below
            // has to account for.
            assetsPaginationFailed = true;
          }
        }));
      } else if (!xPagesHeader) {
        let page = 2;
        let hasMore = true;
        while (hasMore) {
          const res = await fetchWithAuth(`${urlBase}&page=${page}`, { cache: 'no-store' }, token, suppressLogout);
          if (res && res.ok) {
            recordEsiAssetsExpiry(res);
            const data = await res.json();
            if (Array.isArray(data) && data.length > 0) {
              applyPage(data);
              page++;
            } else {
              hasMore = false;
            }
          } else {
            hasMore = false;
            // ESI's asset endpoints signal "past the last page" with a 404 instead of an empty array
            // (unlike most other paginated ESI endpoints) - a 404 here just means the previous page
            // was the last one, the normal, expected way this fallback walk ends.
            if (!(res && res.status === 404)) assetsPaginationFailed = true;
          }
        }
      }
    }

    const charAssetsPromise = (async () => {
      await fetchAssetPages(
        `https://esi.evetech.net/latest/characters/${charId}/assets/?datasource=tranquility`,
        accessToken, false, 'char', true
      );
    })();

    const corpAssetsPromise = (async () => {
      if (!(corpId && accessToken)) return;
      await fetchAssetPages(
        `https://esi.evetech.net/latest/corporations/${corpId}/assets/?datasource=tranquility`,
        accessToken, true, 'corp', false
      );
    })();

    await Promise.all([charAssetsPromise, corpAssetsPromise]);

    const itemIdToAssetMap = {};
    window.rawAssetItems.forEach(ast => {
      if (ast.item_id) itemIdToAssetMap[ast.item_id] = ast;
    });
    const charContainerIds = [];
    const corpContainerIds = [];
    window.rawAssetItems.forEach(ast => {
      let currentLoc = ast.location_id;
      let depth = 0;
      let containerId = null;
      while (itemIdToAssetMap[currentLoc] && depth < 10) {
        const parentAsset = itemIdToAssetMap[currentLoc];
        if (isContainerAsset(parentAsset.type_id)) {
          if (!containerId) {
            containerId = currentLoc;
            if (ast.owner_type === 'char' && !charContainerIds.includes(containerId)) {
              charContainerIds.push(containerId);
            } else if (ast.owner_type === 'corp' && !corpContainerIds.includes(containerId)) {
              corpContainerIds.push(containerId);
            }
          }
        }
        currentLoc = parentAsset.location_id;
        depth++;
      }
      ast.root_location_id = currentLoc;
      ast.container_id = containerId;
    });
    if (charContainerIds.length > 0) {
      for (let i = 0; i < charContainerIds.length; i += 500) {
        const chunk = charContainerIds.slice(i, i + 500);
        try {
          const nameRes = await fetchWithAuth(`https://esi.evetech.net/latest/characters/${charId}/assets/names/?datasource=tranquility`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(chunk)
          }, accessToken, true);
          if (nameRes && nameRes.ok) {
            const customNames = await nameRes.json();
            if (Array.isArray(customNames)) {
              customNames.forEach(cn => {
                if (cn.item_id && cn.name && cn.name !== 'None' && cn.name.trim() !== '') {
                  window.resolvedLocationNames[cn.item_id] = cn.name.toUpperCase();
                }
              });
            }
          }
        } catch (e) { console.warn('[ESI] Personal container custom-name fetch failed - those containers will show a generic name instead:', e); }
      }
    }
    if (corpId && corpContainerIds.length > 0 && accessToken) {
      for (let i = 0; i < corpContainerIds.length; i += 500) {
        const chunk = corpContainerIds.slice(i, i + 500);
        try {
          const nameRes = await fetchWithAuth(`https://esi.evetech.net/latest/corporations/${corpId}/assets/names/?datasource=tranquility`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(chunk)
          }, accessToken, true);
          if (nameRes && nameRes.ok) {
            const customNames = await nameRes.json();
            if (Array.isArray(customNames)) {
              customNames.forEach(cn => {
                if (cn.item_id && cn.name && cn.name !== 'None' && cn.name.trim() !== '') {
                  window.resolvedLocationNames[cn.item_id] = cn.name.toUpperCase();
                }
              });
            }
          }
        } catch (e) { console.warn('[ESI] Corp container custom-name fetch failed - those containers will show a generic name instead:', e); }
      }
    }
    // Persisted here - BEFORE resolveAndPopulateLocationFilter, not after - because that call chain
    // (via applyJournalStockFilter -> renderJournalPage) ends in loadJournalState(), which unconditionally
    // reloads window.rawAssetItems FROM localStorage's 'eve_raw_assets' key. The Calculator page (app.js's
    // recalculate()) already persists this same set of caches after every render, so it never noticed -
    // but the Ledger page never loads app.js, and nothing here was writing this key at all. The result:
    // the FIRST render right after a refresh looked correct (built from the still-fresh in-memory data,
    // moments before loadJournalState overwrote it), but the very next thing that rebuilt stock - toggling
    // Deduct Stock, changing the location/Personal/Corp filters - rebuilt it from whatever stale (often
    // empty, or a leftover snapshot from a completely different session) data 'eve_raw_assets' actually
    // held, silently corrupting the persisted stock map from then on - a page reload doesn't fix it either,
    // since reloading hits the exact same stale key. Writing it here, before that chain ever runs, means
    // loadJournalState reads back the SAME data that was just fetched, not something older.
    try {
      localStorage.setItem('eve_raw_assets', JSON.stringify(window.rawAssetItems || []));
      localStorage.setItem('eve_resolved_location_names', JSON.stringify(window.resolvedLocationNames || {}));
      localStorage.setItem('eve_corp_division_names', JSON.stringify(window.corpDivisionNames || {}));
    } catch (e) { console.warn('[ESI] Failed to persist fetched assets to localStorage - stock will look correct this session but may revert to stale data on next reload:', e); }

    await resolveAndPopulateLocationFilter(accessToken);
    // Only a CLEAN pagination run (no page request outright failed) counts as a real sync - see
    // assetsPaginationFailed's own comment above. Whatever partial data came in in is still saved
    // below (better than discarding real, if incomplete, stock info), but "last synced" only advances
    // and the caller only hears success on a run that actually finished, not one that quietly stopped
    // partway through and would otherwise have looked identical to a complete refresh.
    const fullySucceeded = assetsFetchOk && !assetsPaginationFailed;
    if (assetsFetchOk) {
      // Re-persisted now that resolveAndPopulateLocationFilter has filled in resolved location names
      // (and, via applyJournalStockFilter, the freshly-rebuilt userStockMap) that weren't available yet
      // at the write above.
      try {
        localStorage.setItem('eve_resolved_location_names', JSON.stringify(window.resolvedLocationNames || {}));
        localStorage.setItem('eve_corp_division_names', JSON.stringify(window.corpDivisionNames || {}));
        localStorage.setItem('eve_user_stock_map', JSON.stringify(window.userStockMap || {}));
      } catch (e) { console.warn('[ESI] Failed to persist resolved location/stock data to localStorage:', e); }
      if (fullySucceeded) {
        localStorage.setItem('eve_assets_last_synced', String(Date.now()));
        // Shared choke point for both the manual Refresh button AND the automatic re-fetch that
        // happens on every page load when already logged in - so the "Last synced" text on the
        // ledger's Stock & Location panel stays honest regardless of which path populated the data.
        if (typeof window.updateStockLastSyncedDisplay === 'function') window.updateStockLastSyncedDisplay();
      }
    }
    // Shared choke point every caller (the manual Refresh button, switching active character, and
    // the automatic re-fetch on page load when already logged in) funnels through, fired only once
    // window.userStockMap itself is actually final - unlike 'eve:active-character-changed' (fired at
    // the START of a character switch, before any fetch has even begun), this is safe for a listener
    // that needs the real, current stock data, not just "something changed." Pages whose own
    // recalculation this file already knows how to call directly (Calculator/Invention, via
    // applyStockLocationFilter's own tail end) don't need this - it's for pages like the Shopping
    // List, which esi.js has no direct knowledge of.
    window.dispatchEvent(new CustomEvent('eve:assets-refreshed'));
    return fullySucceeded;
  } catch (err) {
    console.warn('Assets fetch error:', err);
    return false;
  }
}

// Resolves a list of location IDs (NPC stations/systems via bulk /universe/names/, player-owned
// Upwell structures via the authenticated per-structure endpoint) into window.resolvedLocationNames.
// Reusable by anything needing real location names - not just the asset/stock flow.
async function resolveLocationIds(locationIds, accessToken = null) {
  const uniqueIds = Array.from(new Set((locationIds || []).filter(id => id && id !== 99999999)));
  if (uniqueIds.length === 0) return;

  const missingIds = uniqueIds.filter(id => !window.resolvedLocationNames[id]);
  const standardUniverseIds = missingIds.filter(id => id < 1000000000);
  if (standardUniverseIds.length > 0) {
    const chunks = [];
    for (let i = 0; i < standardUniverseIds.length; i += 500) {
      chunks.push(standardUniverseIds.slice(i, i + 500));
    }
    for (const chunk of chunks) {
      try {
        const res = await fetch('https://esi.evetech.net/latest/universe/names/?datasource=tranquility', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(chunk)
        });
        if (res.ok) {
          const nameData = await res.json();
          if (Array.isArray(nameData)) {
            nameData.forEach(item => {
              window.resolvedLocationNames[item.id] = item.name.toUpperCase();
            });
          }
        }
      } catch (e) { console.warn('[ESI] Bulk location name lookup failed - those locations will show a raw ID instead:', e); }
    }
  }

  const token = accessToken || getActiveCharacterToken();
  const unresolvedStructureIds = uniqueIds.filter(id => id > 1000000000000 && !window.resolvedLocationNames[id]);
  if (unresolvedStructureIds.length > 0 && token) {
    await Promise.all(unresolvedStructureIds.map(async (structId) => {
      try {
        const res = await fetchWithAuth(`https://esi.evetech.net/latest/universe/structures/${structId}/?datasource=tranquility`, {}, token, true);
        if (res && res.ok) {
          const structData = await res.json();
          if (structData && structData.name) {
            let sysName = window.systemNameCache[structData.solar_system_id] || '';
            if (!sysName && structData.solar_system_id) {
              try {
                const sysRes = await fetch(`https://esi.evetech.net/latest/universe/systems/${structData.solar_system_id}/?datasource=tranquility`);
                if (sysRes.ok) {
                  const sysData = await sysRes.json();
                  sysName = sysData.name.toUpperCase();
                  window.systemNameCache[structData.solar_system_id] = sysName;
                }
              } catch (e) { console.warn('[ESI] System name lookup for a structure failed - its name will show without the "(SYSTEM)" suffix:', e); }
            }
            const fullName = structData.name.toUpperCase();
            window.resolvedLocationNames[structId] = sysName ? `${fullName} (${sysName})` : fullName;
          }
        } else if (res && res.status === 403) {
          window.resolvedLocationNames[structId] = `UPWELL STRUCTURE (${structId.toString().slice(-6)}) [PRIVATE]`;
        }
      } catch (e) { console.warn(`[ESI] Structure ${structId} name lookup failed - it will show as a raw ID instead:`, e); }
    }));
  }
}
window.resolveLocationIds = resolveLocationIds;

async function resolveAndPopulateLocationFilter(accessToken = null) {
  const uniqueRootLocIds = Array.from(new Set(window.rawAssetItems.map(a => a.root_location_id || a.location_id).filter(id => id && id !== 99999999)));
  const uniqueContainerIds = Array.from(new Set(window.rawAssetItems.map(a => a.container_id).filter(id => id)));
  await resolveLocationIds(uniqueRootLocIds, accessToken);
  window.rawAssetItems.forEach(item => {
    const id = item.root_location_id || item.location_id;
    if (!window.resolvedLocationNames[id]) {
      if (id === 99999999) {
        window.resolvedLocationNames[id] = 'CLIPBOARD / MANUAL IMPORT';
      } else if (window.systemNameCache[id]) {
        window.resolvedLocationNames[id] = window.systemNameCache[id];
      } else if (id >= 30000000 && id < 34000000) {
        window.resolvedLocationNames[id] = `SOLAR SYSTEM #${id}`;
      } else if (id >= 60000000 && id < 64000000) {
        window.resolvedLocationNames[id] = `NPC STATION #${id}`;
      } else if (id > 1000000000000) {
        window.resolvedLocationNames[id] = `UPWELL STRUCTURE (${id.toString().slice(-6)})`;
      } else {
        window.resolvedLocationNames[id] = `CONTAINER / HANGAR #${id}`;
      }
    }
  });
  uniqueContainerIds.forEach(containerId => {
    if (!window.resolvedLocationNames[containerId]) {
      const containerItem = window.rawAssetItems.find(a => a.item_id === containerId);
      if (containerItem) {
        const typeName = getItemTypeName(containerItem.type_id) || 'Container';
        window.resolvedLocationNames[containerId] = `${typeName.toUpperCase()} (#${containerId.toString().slice(-5)})`;
      } else {
        window.resolvedLocationNames[containerId] = `CONTAINER (#${containerId.toString().slice(-5)})`;
      }
    }
  });
  populateLocationDropdown();
  // Ledger's own applyJournalStockFilter() must win when both exist - esi.js's own
  // applyStockLocationFilter() is a plain top-level function declaration, so it's ALWAYS in scope
  // on every page (esi.js loads everywhere), even though it was written for index.html/
  // invention.html. Checking it first meant a fresh asset fetch on ledger.html silently never
  // called the ledger's own re-render (applyJournalStockFilter -> renderJournalPage) - the stock
  // data itself was correct, but the Consolidated BOM panel never reflected it. Confirmed bug:
  // the "Refresh Assets" button appeared to do nothing on the ledger page.
  if (typeof applyJournalStockFilter === 'function') {
    applyJournalStockFilter();
  } else if (typeof applyStockLocationFilter === 'function') {
    applyStockLocationFilter();
  }
}

function populateLocationDropdown() {
  const filterSelect = document.getElementById('stock-location-filter');
  if (!filterSelect) return;
  const currentSystemName = (document.getElementById('system-search')?.value || 'JITA').toUpperCase();
  const currentValue = filterSelect.value || 'all';
  filterSelect.innerHTML = `
    <option value="all" style="color: #38bdf8; background-color: #0c1318; font-weight: bold;">All Locations (Combined Assets)</option>
    <option value="industry_system" style="color: #38bdf8; background-color: #0c1318; font-weight: bold;">Current System Only (${currentSystemName})</option>
  `;
  const sagNameMap = {
    'CorpSAG1': window.corpDivisionNames[1] || 'DIVISION 1',
    'CorpSAG2': window.corpDivisionNames[2] || 'DIVISION 2',
    'CorpSAG3': window.corpDivisionNames[3] || 'DIVISION 3',
    'CorpSAG4': window.corpDivisionNames[4] || 'DIVISION 4',
    'CorpSAG5': window.corpDivisionNames[5] || 'DIVISION 5',
    'CorpSAG6': window.corpDivisionNames[6] || 'DIVISION 6',
    'CorpSAG7': window.corpDivisionNames[7] || 'DIVISION 7',
    'CorpDeliveries': 'CORP DELIVERIES'
  };
  const locCounts = {};
  window.rawAssetItems.forEach(item => {
    const locId = item.root_location_id || item.location_id;
    const locName = window.resolvedLocationNames[locId] || `Location #${locId}`;
    if (!locCounts[locId]) {
      locCounts[locId] = { name: locName, count: 0, corpDivisions: {}, containers: {} };
    }
    locCounts[locId].count += item.quantity;
    if (item.owner_type === 'corp' && item.location_flag && item.location_flag.startsWith('Corp')) {
      const sagFlag = item.location_flag;
      if (!locCounts[locId].corpDivisions[sagFlag]) {
        locCounts[locId].corpDivisions[sagFlag] = { name: sagNameMap[sagFlag] || sagFlag, count: 0 };
      }
      locCounts[locId].corpDivisions[sagFlag].count += item.quantity;
    }
    if (item.container_id) {
      const cId = item.container_id;
      const cName = window.resolvedLocationNames[cId] || `Container #${cId}`;
      if (!locCounts[locId].containers[cId]) {
        locCounts[locId].containers[cId] = { name: cName, count: 0 };
      }
      locCounts[locId].containers[cId].count += item.quantity;
    }
  });
  for (const [locId, data] of Object.entries(locCounts)) {
    const mainOpt = document.createElement('option');
    mainOpt.value = `loc_${locId}`;
    const numericLocId = parseInt(locId);
    const isUpwellStructure = numericLocId > 1000000000000;
    // Native <option> can't hold an inline SVG - the orange/green text color already distinguishes
    // Upwell structures from NPC stations, so no leading glyph is needed.
    if (isUpwellStructure) {
      mainOpt.style.color = '#f97316';
      mainOpt.style.backgroundColor = '#0c1318';
      mainOpt.style.fontWeight = 'bold';
      mainOpt.textContent = `${data.name} (${data.count.toLocaleString()} items)`;
    } else {
      mainOpt.style.color = '#4caf6f';
      mainOpt.style.backgroundColor = '#0c1318';
      mainOpt.style.fontWeight = 'bold';
      mainOpt.textContent = `${data.name} (${data.count.toLocaleString()} items)`;
    }
    filterSelect.appendChild(mainOpt);
    for (const [sagFlag, sagData] of Object.entries(data.corpDivisions)) {
      const sagOpt = document.createElement('option');
      sagOpt.value = `corpsag_${locId}_${sagFlag}`;
      sagOpt.style.color = '#c084fc';
      sagOpt.style.backgroundColor = '#070b0f';
      sagOpt.style.fontWeight = 'bold';
      sagOpt.textContent = `  └─ Corp: ${sagData.name} (${sagData.count.toLocaleString()} items)`;
      filterSelect.appendChild(sagOpt);
    }
    for (const [cId, cData] of Object.entries(data.containers)) {
      const containerOpt = document.createElement('option');
      containerOpt.value = `container_${cId}`;
      containerOpt.style.color = '#f8fafc';
      containerOpt.style.backgroundColor = '#070b0f';
      containerOpt.textContent = `  └─ Container: ${cData.name} (${cData.count.toLocaleString()} items)`;
      filterSelect.appendChild(containerOpt);
    }
  }
  if (filterSelect.querySelector(`option[value="${currentValue}"]`)) {
    filterSelect.value = currentValue;
  } else {
    filterSelect.value = 'all';
  }
}

function filterLocationDropdownOptions() {
  const query = (document.getElementById('location-filter-search')?.value || '').trim().toUpperCase();
  const filterSelect = document.getElementById('stock-location-filter');
  const feedbackBadge = document.getElementById('location-search-feedback');
  if (!filterSelect) return;
  const options = filterSelect.querySelectorAll('option');
  let visibleCount = 0;
  options.forEach(opt => {
    if (opt.value === 'all' || opt.value === 'industry_system') {
      opt.style.display = '';
    } else {
      if (!query || opt.textContent.toUpperCase().includes(query)) {
        opt.style.display = '';
        visibleCount++;
      } else {
        opt.style.display = 'none';
      }
    }
  });
  if (feedbackBadge) {
    if (query) {
      feedbackBadge.textContent = `Found: ${visibleCount.toLocaleString()}`;
      feedbackBadge.classList.remove('hidden');
    } else {
      feedbackBadge.textContent = '';
      feedbackBadge.classList.add('hidden');
    }
  }
  if (typeof window.openCustomSelect === 'function') window.openCustomSelect('stock-location-filter');
}

function updateStockDisplayCount() {
  const el = document.getElementById('stock-count-display');
  if (!el) return;
  const totalItems = Object.values(window.userStockMap || {}).reduce((acc, q) => acc + q, 0);
  el.textContent = `${totalItems.toLocaleString()} items`;
}

function applyStockLocationFilter() {
  const filterVal = document.getElementById('stock-location-filter')?.value || 'all';
  const activeSystemName = (document.getElementById('system-search')?.value || 'JITA').toUpperCase();
  const useChar = document.getElementById('use-char-assets')?.checked ?? true;
  const useCorp = document.getElementById('use-corp-assets')?.checked ?? true;
  window.userStockMap = {};
  window.rawAssetItems.forEach(item => {
    if (item.owner_type === 'char' && !useChar) return;
    if (item.owner_type === 'corp' && !useCorp) return;
    let include = false;
    const rootLocId = item.root_location_id || item.location_id;
    const itemLocName = window.resolvedLocationNames[rootLocId] || '';
    if (filterVal === 'all') {
      include = true;
    } else if (filterVal === 'industry_system') {
      include = itemLocName.includes(activeSystemName);
    } else if (filterVal.startsWith('loc_')) {
      const targetLocId = parseInt(filterVal.replace('loc_', ''));
      include = rootLocId === targetLocId;
    } else if (filterVal.startsWith('corpsag_')) {
      const parts = filterVal.split('_');
      const targetLocId = parseInt(parts[1]);
      const targetSag = parts[2];
      include = (rootLocId === targetLocId) && (item.location_flag === targetSag);
    } else if (filterVal.startsWith('container_')) {
      const targetContainerId = parseInt(filterVal.replace('container_', ''));
      include = item.container_id === targetContainerId;
    }
    if (include) {
      window.userStockMap[item.type_id] = (window.userStockMap[item.type_id] || 0) + item.quantity;
    }
  });
  // Recomputed every time userStockMap itself changes, so it's never more than one filter-change/
  // asset-refresh stale - see computeStockAfterLedgerClaims' own comment (js/config.js) for why this
  // exists: without it, this page has no idea materials already claimed by the Ledger's own queued/
  // started jobs aren't actually free to use, and shows "you have enough" for stock that's really
  // already spoken for.
  window.stockAfterLedgerClaims = (typeof window.computeStockAfterLedgerClaims === 'function')
    ? window.computeStockAfterLedgerClaims(window.userStockMap)
    : { ...window.userStockMap };
  updateStockDisplayCount();
  // This same function backs both pages that use it directly (index.html's own checkbox/select
  // onchange handlers, which already worked) - each page's actual recalculation entry point has a
  // different name, so both are tried; only one will ever exist on a given page. Wrapped in
  // withRootPanAnchor when available (Calculator/LP Store's diagram pages) - see
  // toggleDeductStockButton's own comment (js/config.js) for why this is conditional.
  if (typeof window.recalculate === 'function') {
    if (typeof window.withRootPanAnchor === 'function') {
      window.withRootPanAnchor(async () => { await window.recalculate(); });
    } else {
      window.recalculate();
    }
  }
  else if (typeof window.recalculateInvention === 'function') window.recalculateInvention();
}

let _pasteModalOpenerEl = null;
function openPasteModal() {
  _pasteModalOpenerEl = document.activeElement;
  const modal = document.getElementById('paste-modal');
  if (modal) modal.classList.remove('hidden');
}

function closePasteModal() {
  const modal = document.getElementById('paste-modal');
  if (modal) modal.classList.add('hidden');
  if (_pasteModalOpenerEl && typeof _pasteModalOpenerEl.focus === 'function') _pasteModalOpenerEl.focus();
  _pasteModalOpenerEl = null;
}

// Wrapped in withRootPanAnchor when available - see toggleDeductStockButton's own comment
// (js/config.js) for why this is conditional (shared across pages, some without a diagram).
function clearUserStock() {
  const rawAssetItemsSnapshot = window.rawAssetItems.slice();
  const userStockMapSnapshot = { ...window.userStockMap };
  window.rawAssetItems = window.rawAssetItems.filter(item => item.location_id !== 99999999);
  window.userStockMap = {};
  updateStockDisplayCount();
  populateLocationDropdown();
  if (typeof recalculate === 'function') {
    if (typeof window.withRootPanAnchor === 'function') window.withRootPanAnchor(async () => { await recalculate(); });
    else recalculate();
  }
  closePasteModal();
  if (typeof window.showToast === 'function') {
    window.showToast('Cleared all tracked stock.', 'info', { action: { label: 'Undo', onClick: () => {
      window.rawAssetItems = rawAssetItemsSnapshot;
      window.userStockMap = userStockMapSnapshot;
      updateStockDisplayCount();
      populateLocationDropdown();
      if (typeof recalculate === 'function') {
        if (typeof window.withRootPanAnchor === 'function') window.withRootPanAnchor(async () => { await recalculate(); });
        else recalculate();
      }
    } } });
  }
}

function processPastedStock() {
  const input = document.getElementById('paste-stock-input');
  if (!input) return;
  const text = input.value.trim();
  if (!text) return;
  const lines = text.split('\n');
  lines.forEach(line => {
    const trimmed = line.trim();
    if (!trimmed) return;
    const parts = trimmed.split('\t');
    let nameCandidate = '';
    let qtyCandidate = 1;
    if (parts.length >= 2) {
      nameCandidate = parts[0].trim();
      const cleanedQty = parts[1].replace(/,/g, '').replace(/\./g, '').trim();
      const parsedQty = parseInt(cleanedQty, 10);
      if (!isNaN(parsedQty) && parsedQty > 0) qtyCandidate = parsedQty;
    } else {
      const match = trimmed.match(/^(.+?)\s+([0-9,.]+)\s*$/);
      if (match) {
        nameCandidate = match[1].trim();
        const parsedQty = parseInt(match[2].replace(/,/g, '').replace(/\./g, ''), 10);
        if (!isNaN(parsedQty) && parsedQty > 0) qtyCandidate = parsedQty;
      } else {
        nameCandidate = trimmed;
      }
    }
    if (nameCandidate) {
      const q = nameCandidate.toLowerCase();
      let matchedItem = window.IDX[q];
      if (!matchedItem && window.EVE_ITEMS) {
        for (const [idStr, name] of Object.entries(window.EVE_ITEMS)) {
          if (name.toLowerCase() === q) {
            matchedItem = { id: parseInt(idStr), name: name };
            break;
          }
        }
      }
      if (matchedItem) {
        window.rawAssetItems.push({
          type_id: matchedItem.id,
          quantity: qtyCandidate,
          location_id: 99999999,
          root_location_id: 99999999,
          owner_type: 'char'
        });
      }
    }
  });
  window.resolvedLocationNames[99999999] = 'CLIPBOARD / MANUAL IMPORT';
  input.value = '';
  closePasteModal();
  populateLocationDropdown();
  applyStockLocationFilter();
}

async function selectSolarSystem(systemId, systemName) {
  const searchInputEl = document.getElementById('system-search');
  if (searchInputEl) searchInputEl.value = systemName.toUpperCase();
  const resultsEl = document.getElementById('system-results');
  if (resultsEl) resultsEl.classList.add('hidden');
  try {
    localStorage.setItem('eve_selected_system', JSON.stringify({ id: systemId, name: systemName.toUpperCase() }));
  } catch (e) { console.warn('[ESI] Failed to save the selected system - it will reset to the default on next reload:', e); }
  await fetchSystemSCIById(systemId, systemName);
}

async function loadSavedSystem() {
  try {
    const saved = localStorage.getItem('eve_selected_system');
    if (saved) {
      const obj = JSON.parse(saved);
      if (obj && obj.id && obj.name) {
        const searchInputEl = document.getElementById('system-search');
        if (searchInputEl) searchInputEl.value = obj.name.toUpperCase();
        await fetchSystemSCIById(obj.id, obj.name);
        return;
      }
    }
  } catch (e) { console.warn('[ESI] Failed to restore the last saved system - falling back to JITA:', e); }
  await resolveSystemSCI('JITA');
}

async function resolveSystemSCI(systemName) {
  if (!systemName || systemName.trim().length < 2) return;
  const q = systemName.trim().toLowerCase();
  if (window.SYSTEM_IDX[q]) {
    await selectSolarSystem(window.SYSTEM_IDX[q].id, window.SYSTEM_IDX[q].name);
  } else {
    const matches = await fetchEsiSystemSearch(q);
    if (matches && matches.length > 0) {
      await selectSolarSystem(matches[0].id, matches[0].name);
    }
  }
}

// System -> region name, resolved via the constellation the system sits in. A system's region never
// changes, so this is cached permanently for the page session (keyed by constellation id, since that
// is what the /universe/systems/ response hands us). Non-fatal - the readout just omits the region
// line if this can't resolve.
let _constellationRegionCache = {};
async function resolveRegionNameForConstellation(constellationId) {
  if (!constellationId) return null;
  if (_constellationRegionCache[constellationId] !== undefined) return _constellationRegionCache[constellationId];
  try {
    const cRes = await fetch(`https://esi.evetech.net/latest/universe/constellations/${constellationId}/?datasource=tranquility`);
    if (!cRes.ok) { _constellationRegionCache[constellationId] = null; return null; }
    const cData = await cRes.json();
    const name = typeof fetchRegionName === 'function' ? await fetchRegionName(cData.region_id) : null;
    _constellationRegionCache[constellationId] = name || null;
    return _constellationRegionCache[constellationId];
  } catch (e) {
    _constellationRegionCache[constellationId] = null;
    return null;
  }
}

// Small helper so the EIV health dot in the System readout can be updated from fetchAdjustedPrices()
// (which knows the load state) without that function needing to know the readout's markup.
function updateEivIndicator(state) {
  const wrap = document.getElementById('sysinfo-eiv');
  const text = document.getElementById('sysinfo-eiv-text');
  if (!wrap) return;
  wrap.classList.remove('is-loading', 'is-ready', 'is-offline');
  if (state === 'ready') { wrap.classList.add('is-ready'); if (text) text.textContent = 'EIV ready'; }
  else if (state === 'offline') { wrap.classList.add('is-offline'); if (text) text.textContent = 'EIV offline'; }
  else { wrap.classList.add('is-loading'); if (text) text.textContent = 'EIV loading'; }
}
window.updateEivIndicator = updateEivIndicator;

// Paints the System dossier in the Structure flyout (index.html #system-readout). Pure DOM render
// off already-fetched values - all elements are guarded, so this is a no-op on pages that don't have
// the readout (Ledger/Invention).
function renderSystemReadout({ systemName, mfgSCI, reactSCI, inventionSCI, security, regionName }) {
  const pct = (v) => `${(v * 100).toFixed(2)}%`;
  const nameEl = document.getElementById('sysinfo-name');
  if (nameEl) nameEl.textContent = (systemName || '—').toUpperCase();

  const secEl = document.getElementById('sysinfo-sec');
  if (secEl) {
    secEl.classList.remove('is-high', 'is-low', 'is-null');
    if (typeof security === 'number') {
      const rounded = Math.round(security * 10) / 10;
      let band = 'is-null', word = 'NULL';
      if (rounded >= 0.5) { band = 'is-high'; word = 'HIGH'; }
      else if (rounded > 0.0) { band = 'is-low'; word = 'LOW'; }
      secEl.classList.add(band);
      secEl.textContent = `${rounded.toFixed(1)} · ${word}`;
    } else {
      secEl.textContent = '—';
    }
  }

  const regionEl = document.getElementById('sysinfo-region');
  if (regionEl) {
    if (regionName) { regionEl.textContent = regionName; regionEl.hidden = false; }
    else { regionEl.hidden = true; }
  }

  const mfgEl = document.getElementById('sysinfo-sci-mfg');
  if (mfgEl) mfgEl.textContent = pct(mfgSCI);
  const reactEl = document.getElementById('sysinfo-sci-react');
  if (reactEl) reactEl.textContent = pct(reactSCI);
  const invEl = document.getElementById('sysinfo-sci-inv');
  if (invEl) invEl.textContent = pct(inventionSCI);

  const rigEl = document.getElementById('sysinfo-rigmult');
  if (rigEl) {
    const mult = typeof window.getSecurityMultiplier === 'function' ? window.getSecurityMultiplier() : 1.0;
    const zone = mult >= 2.1 ? 'null/WH' : (mult >= 1.9 ? 'lowsec' : 'highsec');
    rigEl.textContent = `Rig ×${mult.toFixed(1)} · ${zone}`;
  }
}
window.renderSystemReadout = renderSystemReadout;

async function fetchSystemSCIById(systemId, systemName) {
  try {
    const sysRes = await fetch('https://esi.evetech.net/latest/industry/systems/?datasource=tranquility');
    if (!sysRes.ok) return;
    const sysData = await sysRes.json();
    const sysEntry = sysData.find(s => s.solar_system_id === systemId);
    let mfgSCI = 0.01, reactSCI = 0.01, inventionSCI = 0.02;
    if (sysEntry && sysEntry.cost_indices) {
      sysEntry.cost_indices.forEach(ci => {
        if (ci.activity === 'manufacturing') mfgSCI = ci.cost_index;
        if (ci.activity === 'reaction') reactSCI = ci.cost_index;
        if (ci.activity === 'invention') inventionSCI = ci.cost_index;
      });
    }
    window.activeMfgSCI = mfgSCI;
    window.activeReactSCI = reactSCI;
    window.activeInventionSCI = inventionSCI;

    // Security status drives the rig bonus multiplier (highsec x1.0, lowsec x1.9, null/WH x2.1).
    let constellationId = null;
    try {
      const secRes = await fetch(`https://esi.evetech.net/latest/universe/systems/${systemId}/?datasource=tranquility`);
      if (secRes.ok) {
        const secData = await secRes.json();
        window.activeSystemSecurity = typeof secData.security_status === 'number' ? secData.security_status : null;
        constellationId = secData.constellation_id || null;
      }
    } catch (secErr) {
      window.activeSystemSecurity = null;
      console.warn('System security status fetch error:', secErr);
    }

    const regionName = await resolveRegionNameForConstellation(constellationId);
    renderSystemReadout({ systemName, mfgSCI, reactSCI, inventionSCI, security: window.activeSystemSecurity, regionName });
    // Awaited (not fire-and-forget) so this function's own promise doesn't resolve until the
    // recalculation triggered by the system change is actually done. This matters beyond just this
    // page: loadProductionPreset (js/app.js) awaits selectSolarSystem (which awaits this) and then
    // fires its OWN recalculate() once facility/tax/rig settings are updated - without this await,
    // that produced two overlapping, unordered recalculate passes. Harmless on most pages, but on
    // the LP Store page (js/lpstore.js) both passes accumulate into the same global
    // window.__lpSpentThisRecalc, which the wrapped recalculate() resets to 0 at the start of each
    // call - two interleaved passes could stomp each other's total and leave whichever one's DOM
    // update landed last showing a stale/wrong ISK-per-LP, exactly the sort of thing a single
    // later recalculate (e.g. toggling a component's buy mode) would then "fix" by simply not
    // racing anything. Awaiting here serializes the two calls instead.
    if (typeof recalculate === 'function') await recalculate();
  } catch (err) {
    console.warn('System SCI fetch error:', err);
  }
}

// --- Market/Station Resolution ---
// Resolves a station name to its type/system/region IDs via ESI, entirely at runtime - this works
// for any station (major trade hub or a specific lowsec/null station the user knows), without
// hardcoding numeric IDs that would need independent verification to trust.
async function resolveStationByName(stationName) {
  try {
    const res = await fetch('https://esi.evetech.net/latest/universe/ids/?datasource=tranquility', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([stationName])
    });
    if (!res.ok) return null;
    const data = await res.json();
    const station = data.stations && data.stations[0];
    if (!station) return null;
    return { stationId: station.id, stationName: station.name };
  } catch (e) {
    console.warn('Station name resolution failed:', e);
    return null;
  }
}
window.resolveStationByName = resolveStationByName;

// Searches for stations matching a partial name (for the search-as-you-type UI), using ESI's public
// search endpoint.
// CCP removed the standalone public /search/ endpoint around mid-2022 (confirmed via EVE Online
// forum reports of it returning 404) - the only working search endpoint now is the authenticated,
// character-scoped one. This means search now requires being logged in via EVE SSO; without a
// character/token, there's no way to search ESI at all anymore (a real API constraint, not a choice
// made here). Returns {} (empty categories) on any failure so callers can treat "not logged in" and
// "no results" the same way.
async function esiCharacterSearch(searchTerm, categories) {
  const charId = getActiveCharId();
  const accessToken = getActiveCharacterToken();
  if (!charId || !accessToken) {
    console.warn('[ESISearch] No results possible - ESI search requires being logged in via EVE SSO (the old public /search/ endpoint was removed by CCP).');
    return { __notLoggedIn: true };
  }
  try {
    const url = `https://esi.evetech.net/latest/characters/${charId}/search/?categories=${encodeURIComponent(categories)}&search=${encodeURIComponent(searchTerm)}&datasource=tranquility&strict=false`;
    console.info(`[ESISearch] Requesting: ${url}`);
    const res = await fetchWithAuth(url, {}, accessToken, true);
    if (!res) {
      console.warn('[ESISearch] fetchWithAuth returned no response object at all (network-level failure).');
      return {};
    }
    const bodyText = await res.text();
    console.info(`[ESISearch] Response status: ${res.status} ${res.statusText}. Body: ${bodyText}`);
    if (!res.ok) return {};
    return JSON.parse(bodyText);
  } catch (e) {
    console.warn('[ESISearch] Character search failed:', e);
    return {};
  }
}
window.esiCharacterSearch = esiCharacterSearch;

async function searchStationsByName(query) {
  if (!query || query.length < 3) return [];
  const data = await esiCharacterSearch(query, 'station');
  if (data.__notLoggedIn) return null; // distinct from [] - "couldn't search" vs "searched, found nothing"
  const stationIds = (data.station || []).slice(0, 15);
  if (stationIds.length === 0) return [];
  try {
    const namesRes = await fetch('https://esi.evetech.net/latest/universe/names/?datasource=tranquility', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(stationIds)
    });
    if (!namesRes.ok) return [];
    const namesData = await namesRes.json();
    return namesData.map(s => ({ stationId: s.id, stationName: s.name }));
  } catch (e) {
    console.warn('Station name resolution failed:', e);
    return [];
  }
}
window.searchStationsByName = searchStationsByName;

// Resolves a station's region id (needed for market history/volume) by walking station -> system ->
// constellation -> region. Only needed once per newly-tracked market since the result is cached.
async function resolveStationRegion(stationId) {
  try {
    const stationRes = await fetch(`https://esi.evetech.net/latest/universe/stations/${stationId}/?datasource=tranquility`);
    if (!stationRes.ok) return null;
    const stationData = await stationRes.json();
    const systemId = stationData.system_id;
    if (!systemId) return null;

    const systemRes = await fetch(`https://esi.evetech.net/latest/universe/systems/${systemId}/?datasource=tranquility`);
    if (!systemRes.ok) return null;
    const systemData = await systemRes.json();
    const constellationId = systemData.constellation_id;
    if (!constellationId) return null;

    const constRes = await fetch(`https://esi.evetech.net/latest/universe/constellations/${constellationId}/?datasource=tranquility`);
    if (!constRes.ok) return null;
    const constData = await constRes.json();
    return { regionId: constData.region_id, systemId: systemId };
  } catch (e) {
    console.warn('Station region resolution failed:', e);
    return null;
  }
}
window.resolveStationRegion = resolveStationRegion;

// Real daily trade volume (not just what's currently listed) comes from ESI market history, averaged
// over the most recent several days - this is the actual liquidity signal, distinct from Fuzzwork's
// order-book aggregates which only show what's currently for sale, not how fast it moves.
async function fetchAverageDailyVolume(regionId, typeId) {
  try {
    const res = await fetch(`https://esi.evetech.net/latest/markets/${regionId}/history/?datasource=tranquility&type_id=${typeId}`);
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) return null;
    const recent = data.slice(-7); // last 7 days of trading
    const totalVolume = recent.reduce((sum, day) => sum + (day.volume || 0), 0);
    return Math.round(totalVolume / recent.length);
  } catch (e) {
    console.warn('Market history fetch failed:', e);
    return null;
  }
}
window.fetchAverageDailyVolume = fetchAverageDailyVolume;

// Raw ESI market history (one row per trading day: date, average, highest, lowest, order_count,
// volume - up to ~a year back), cached per region+type so the LP Store's Market Economics drawer
// (js/lpstore.js) can slice different date ranges and compute its own stats client-side without a
// fresh fetch every time the range toggle changes. Deliberately separate from
// fetchAverageDailyVolume above (which throws away everything but a 7-day average, uncached) -
// that function stays as-is for its existing Compare Markets caller.
let _marketHistoryRawCache = {};
async function fetchMarketHistoryRaw(regionId, typeId) {
  const key = `${regionId}:${typeId}`;
  if (_marketHistoryRawCache[key] !== undefined) return _marketHistoryRawCache[key];
  try {
    const res = await fetch(`https://esi.evetech.net/latest/markets/${regionId}/history/?datasource=tranquility&type_id=${typeId}`);
    if (!res.ok) { _marketHistoryRawCache[key] = null; return null; }
    const data = await res.json();
    const rows = Array.isArray(data) ? data : null;
    _marketHistoryRawCache[key] = rows;
    return rows;
  } catch (e) {
    console.warn('Market history fetch failed:', e);
    _marketHistoryRawCache[key] = null;
    return null;
  }
}
window.fetchMarketHistoryRaw = fetchMarketHistoryRaw;

// A real region name ("The Forge") for the Market Economics drawer's own "which market is this"
// label - not guessed/hardcoded, since a player's Home Market can be set to any station.
let _regionNameCache = {};
async function fetchRegionName(regionId) {
  if (_regionNameCache[regionId] !== undefined) return _regionNameCache[regionId];
  try {
    const res = await fetch(`https://esi.evetech.net/latest/universe/regions/${regionId}/?datasource=tranquility`);
    if (!res.ok) { _regionNameCache[regionId] = null; return null; }
    const data = await res.json();
    _regionNameCache[regionId] = data.name || null;
    return _regionNameCache[regionId];
  } catch (e) {
    _regionNameCache[regionId] = null;
    return null;
  }
}
window.fetchRegionName = fetchRegionName;

// Fetches price + liquidity for one item across every tracked market in parallel, for the Compare
// Markets panel. Price comes from Fuzzwork (per-station), volume from ESI history (per-region) -
// deliberately returned side by side rather than collapsed into a single "best" score, since the
// cheapest price and the most liquid market are often not the same place.
async function fetchMarketComparison(typeId) {
  const markets = typeof window.getTrackedMarkets === 'function' ? window.getTrackedMarkets() : [];
  const results = await Promise.all(markets.map(async (market) => {
    let sell = 0, buy = 0, avgVolume = null;
    try {
      const priceUrl = `https://market.fuzzwork.co.uk/aggregates/?station=${market.stationId}&types=${typeId}`;
      const priceRes = await fetch(priceUrl);
      if (priceRes.ok) {
        const priceData = await priceRes.json();
        const entry = priceData[String(typeId)];
        if (entry) {
          sell = entry.sell ? parseFloat(entry.sell.min) || 0 : 0;
          buy = entry.buy ? parseFloat(entry.buy.max) || 0 : 0;
        }
      }
    } catch (e) { /* leave as 0 */ }

    if (market.regionId) {
      avgVolume = await fetchAverageDailyVolume(market.regionId, typeId);
    }

    return { stationName: market.stationName, stationId: market.stationId, sell, buy, avgVolume };
  }));
  return results;
}
window.fetchMarketComparison = fetchMarketComparison;

// Tracks the earliest moment ESI says FRESH industry-jobs data will actually exist, parsed from the
// standard HTTP `Expires` response header CCP's own server-side cache sits behind (confirmed present
// on these endpoints; `Expires` is one of the handful of response headers a browser always exposes to
// fetch() cross-origin, no Access-Control-Expose-Headers needed - unlike ESI's custom X-* headers,
// which it does explicitly list). Reading and respecting this - rather than guessing a fixed poll
// interval - is exactly what ESI's own best-practices guidance recommends: asking again before this
// timestamp can't possibly return anything newer (the cache hasn't turned over on CCP's side yet, no
// matter how this tool asks), while waiting meaningfully past it costs real freshness for no reason.
// Reported directly: a freshly-installed corp job took a long time to appear, and "a long wait is not
// good at all... needs to be a lot quicker" - keyed per endpoint kind ('char-industry'/'corp-industry')
// since character and corp jobs each have their own independent cache window on CCP's side. Consumed
// by js/ledger.js's background re-sync timer to schedule the next automatic check exactly when fresh
// data can exist, instead of a blind fixed delay.
window.esiIndustryJobsExpiry = window.esiIndustryJobsExpiry || {};
function recordEsiIndustryJobsExpiry(kind, res) {
  const header = res && res.headers && res.headers.get ? res.headers.get('expires') : null;
  if (!header) return;
  const ts = Date.parse(header);
  if (!isNaN(ts)) window.esiIndustryJobsExpiry[kind] = ts;
}

// Same Expires-header idea as recordEsiIndustryJobsExpiry above, but for the assets endpoints - and,
// unlike that one, stored in localStorage rather than a plain window.* variable, specifically so every
// open tab (the Ledger, the Calculator, any page) reads the exact SAME answer to "has a fresh assets
// snapshot arrived yet?" A first version of this lived in each tab's own private memory - two tabs
// could independently reach a DIFFERENT answer for the exact same real job, so js/ledger.js's stock
// math and js/config.js's own copy of it would silently disagree about how much was left (reported
// directly, and confirmed by testing two separate tabs against identical data). getEsiAssetsExpiry()
// always re-reads localStorage live (never caches the value in a variable), so a refresh done in one
// tab is picked up by any other tab's very next render - no cross-tab messaging needed. Consumed by
// js/ledger.js's applyJobMaterialsToStock and js/config.js's computeStockAfterLedgerClaims to decide
// whether a started job's consumption is already reflected in the current stock figure, or still needs
// manually subtracting to compensate for ESI's own cache lag - see either of those for the full
// reasoning on why that distinction matters. Recording only the LATEST (max) Expires ever observed - a
// stale response landing out of order (e.g. an in-flight request that started before a newer one
// finished) should never move this backward.
function getEsiAssetsExpiry() {
  const raw = localStorage.getItem('eve_esi_assets_expiry');
  const ts = raw ? parseInt(raw, 10) : NaN;
  return isNaN(ts) ? null : ts;
}
function recordEsiAssetsExpiry(res) {
  const header = res && res.headers && res.headers.get ? res.headers.get('expires') : null;
  if (!header) return;
  const ts = Date.parse(header);
  if (isNaN(ts)) return;
  const current = getEsiAssetsExpiry();
  if (current === null || ts > current) localStorage.setItem('eve_esi_assets_expiry', String(ts));
}
window.getEsiAssetsExpiry = getEsiAssetsExpiry;
window.recordEsiAssetsExpiry = recordEsiAssetsExpiry;

// Fetches the character's real active/recent industry jobs from ESI - used to auto-detect when a
// job queued in the ledger has actually been started in-game, using the REAL start time and duration
// EVE calculated, rather than this app's own estimate.
async function fetchActiveIndustryJobs() {
  const charId = getActiveCharId();
  const accessToken = getActiveCharacterToken();
  if (!charId || !accessToken) return null; // not logged in
  try {
    // no-store - without it, a second click of "Sync EVE Jobs" within the browser's own HTTP cache
    // window for this exact URL can be answered straight from that cache with zero network request,
    // silently replaying the same stale response instead of even asking ESI again. This can't do
    // anything about ESI's OWN server-side cache on this endpoint (CCP's, not this app's, and
    // unavoidable by any client) - a freshly-started job can still take a few minutes to appear no
    // matter what - but it guarantees a manual sync always at least ASKS ESI fresh.
    const res = await fetchWithAuth(`https://esi.evetech.net/latest/characters/${charId}/industry/jobs/?datasource=tranquility`, { cache: 'no-store' }, accessToken, true, charId);
    if (!res || !res.ok) return null;
    recordEsiIndustryJobsExpiry('char-industry', res);
    return await res.json();
  } catch (e) {
    console.warn('Industry jobs fetch failed:', e);
    return null;
  }
}
window.fetchActiveIndustryJobs = fetchActiveIndustryJobs;

// Fetches ALL industry jobs installed by ANY member of the character's corporation - requires the
// Factory Manager role in-game, and a corp ID cached from a prior asset refresh. Returns an empty
// array (not null) on any failure so callers can safely merge it with character jobs regardless of
// whether corp access is available - a character without Factory Manager simply contributes nothing
// here rather than breaking the whole sync.
async function fetchActiveCorpIndustryJobs() {
  const activeRecord = getActiveCharacterRecord();
  const corpId = activeRecord && activeRecord.corpId;
  const accessToken = activeRecord && activeRecord.accessToken;
  if (!corpId || !accessToken) return [];
  try {
    const res = await fetchWithAuth(`https://esi.evetech.net/latest/corporations/${corpId}/industry/jobs/?datasource=tranquility`, { cache: 'no-store' }, accessToken, true, activeRecord.charId);
    if (!res || !res.ok) return [];
    recordEsiIndustryJobsExpiry('corp-industry', res);
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch (e) {
    console.warn('Corp industry jobs fetch failed (likely missing Factory Manager role):', e);
    return [];
  }
}
window.fetchActiveCorpIndustryJobs = fetchActiveCorpIndustryJobs;

// include_completed=true variants of the two functions above - needed to see a job AFTER it leaves
// the active list. This is the only way to learn whether an INVENTION job actually succeeded:
// ESI's job object carries a `successful_runs` field, confirmed via the ESI schema docs, described
// as "Number of successful runs for this job. Equal to runs unless this is an invention job" - so
// for invention specifically it's the real win/lose signal (0 = failed, >0 = succeeded), available
// once the job's status becomes 'delivered'. Used by js/invention-queue.js, not the manufacturing
// Ledger (which only cares whether a job is currently active).
async function fetchCompletedIndustryJobs() {
  const charId = getActiveCharId();
  const accessToken = getActiveCharacterToken();
  if (!charId || !accessToken) return null; // not logged in
  try {
    const res = await fetchWithAuth(`https://esi.evetech.net/latest/characters/${charId}/industry/jobs/?datasource=tranquility&include_completed=true`, { cache: 'no-store' }, accessToken, true, charId);
    if (!res || !res.ok) return null;
    return await res.json();
  } catch (e) {
    console.warn('Completed industry jobs fetch failed:', e);
    return null;
  }
}
window.fetchCompletedIndustryJobs = fetchCompletedIndustryJobs;

async function fetchCompletedCorpIndustryJobs() {
  const activeRecord = getActiveCharacterRecord();
  const corpId = activeRecord && activeRecord.corpId;
  const accessToken = activeRecord && activeRecord.accessToken;
  if (!corpId || !accessToken) return [];
  try {
    const res = await fetchWithAuth(`https://esi.evetech.net/latest/corporations/${corpId}/industry/jobs/?datasource=tranquility&include_completed=true`, { cache: 'no-store' }, accessToken, true, activeRecord.charId);
    if (!res || !res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch (e) {
    console.warn('Completed corp industry jobs fetch failed (likely missing Factory Manager role):', e);
    return [];
  }
}
window.fetchCompletedCorpIndustryJobs = fetchCompletedCorpIndustryJobs;

// Fetches every page of a paginated ESI endpoint. Page 1 is always fetched alone (there's no way to
// know the page count before asking), but once that response's X-Pages header is readable, every
// remaining page is fired in parallel instead of waiting for each one's own round trip before
// starting the next - a character/corp with a large BPO/BPC library can easily run into dozens of
// pages, and doing those sequentially is exactly what made "Sync EVE Jobs" take several minutes for
// well-stocked accounts (reported directly). X-Pages isn't guaranteed to be exposed to browser
// fetch() for every ESI route/CORS configuration, though - if it can't be read here, this falls back
// to the original one-page-at-a-time probing (continuing from page 2) so correctness never depends
// on the optimization actually working.
async function fetchAllEsiPages(urlWithoutPage, accessToken, charId) {
  const results = [];
  const firstRes = await fetchWithAuth(`${urlWithoutPage}&page=1`, {}, accessToken, true, charId);
  if (!firstRes || !firstRes.ok) return results;
  const firstPage = await firstRes.json();
  if (!Array.isArray(firstPage) || firstPage.length === 0) return results;
  results.push(...firstPage);

  const totalPages = parseInt(firstRes.headers.get('x-pages'), 10);
  if (isFinite(totalPages) && totalPages >= 1) {
    if (totalPages > 1) {
      const pageNumbers = [];
      for (let p = 2; p <= totalPages; p++) pageNumbers.push(p);
      const rest = await Promise.all(pageNumbers.map(async (p) => {
        try {
          const res = await fetchWithAuth(`${urlWithoutPage}&page=${p}`, {}, accessToken, true, charId);
          if (!res || !res.ok) return [];
          const data = await res.json();
          return Array.isArray(data) ? data : [];
        } catch (e) { return []; }
      }));
      rest.forEach(page => results.push(...page));
    }
    return results;
  }

  // X-Pages wasn't readable for this endpoint/browser - fall back to sequential probing from page 2.
  let page = 2;
  let hasMore = true;
  while (hasMore) {
    const res = await fetchWithAuth(`${urlWithoutPage}&page=${page}`, {}, accessToken, true, charId);
    if (!res || !res.ok) break;
    const data = await res.json();
    if (Array.isArray(data) && data.length > 0) {
      results.push(...data);
      page++;
    } else {
      hasMore = false;
    }
  }
  return results;
}
window.fetchAllEsiPages = fetchAllEsiPages;

// EVE's own small, stable integer IDs for the 5 character attributes, as used inside a skill's own
// dogma data (see fetchSkillTrainingInfo below) - confirmed directly against ESI's own
// /dogma/attributes/{id}/ endpoint for each of 164-168, not guessed. These never change (they're as
// old as EVE's skill system itself), so a plain hardcoded map is safe rather than another live call.
const EVE_ATTRIBUTE_ID_TO_NAME = { 164: 'charisma', 165: 'intelligence', 166: 'memory', 167: 'perception', 168: 'willpower' };

// A skill's training-time rank and which 2 of the 5 attributes govern its training speed - permanent,
// same-for-everyone data (never tied to a specific character), so cached forever once fetched, same
// idea as the system->region cache elsewhere in this app. Pulled from /universe/types/{id}/'s own
// dogma_attributes array: attribute_id 275 (skillTimeConstant) is the rank multiplier CCP's own SP
// formula uses (SP for level L = 250 * rank * sqrt(32)^(L-1), confirmed directly against
// /dogma/attributes/275/'s own description text); 180/181 (primaryAttribute/secondaryAttribute) are
// themselves attribute_ids pointing back into the 164-168 table above, not raw values. Public
// endpoint - no auth/token needed, works even for a logged-out visitor looking at what a skill would
// need.
let _skillTrainingInfoCache = null;
function loadSkillTrainingInfoCache() {
  if (_skillTrainingInfoCache) return _skillTrainingInfoCache;
  _skillTrainingInfoCache = window.safeParseJSON(localStorage.getItem('eve_skill_training_info_v1'), {});
  return _skillTrainingInfoCache;
}
async function fetchSkillTrainingInfo(skillTypeId) {
  const cache = loadSkillTrainingInfoCache();
  if (cache[skillTypeId]) return cache[skillTypeId];
  try {
    const res = await fetch(`https://esi.evetech.net/latest/universe/types/${skillTypeId}/?datasource=tranquility`, { cache: 'no-store' });
    if (!res.ok) return null;
    const data = await res.json();
    const attrs = Array.isArray(data.dogma_attributes) ? data.dogma_attributes : [];
    const find = id => { const a = attrs.find(x => x.attribute_id === id); return a ? a.value : null; };
    const rank = find(275);
    const primaryId = find(180);
    const secondaryId = find(181);
    if (!rank || !primaryId || !secondaryId) return null;
    const info = { rank, primaryAttr: EVE_ATTRIBUTE_ID_TO_NAME[primaryId] || null, secondaryAttr: EVE_ATTRIBUTE_ID_TO_NAME[secondaryId] || null };
    if (!info.primaryAttr || !info.secondaryAttr) return null;
    cache[skillTypeId] = info;
    localStorage.setItem('eve_skill_training_info_v1', JSON.stringify(cache));
    return info;
  } catch (e) {
    console.warn(`Skill training info fetch failed for skill ${skillTypeId}:`, e);
    return null;
  }
}
window.fetchSkillTrainingInfo = fetchSkillTrainingInfo;

// A ship's PACKAGED volume (how much cargo space the hull takes up unfitted/unassembled in a
// hangar or hauler) is a completely different, much smaller number than its plain "volume" (the
// hull's actual flying/in-space size) - eve_db.js's EVE_VOLUMES only carries that plain SDE
// "volume" field, which is correct for ordinary modules/ammo/minerals (they have no packaged
// variant at all) but wildly wrong for a ship sitting in a shopping list, which is always bought
// and hauled packaged. Permanent cache, same pattern as fetchSkillTrainingInfo above - a hull's
// packaged volume never changes.
let _packagedVolumeCache = null;
function loadPackagedVolumeCache() {
  if (_packagedVolumeCache) return _packagedVolumeCache;
  _packagedVolumeCache = window.safeParseJSON(localStorage.getItem('eve_packaged_volume_cache_v1'), {});
  return _packagedVolumeCache;
}
async function fetchPackagedVolume(typeId) {
  const cache = loadPackagedVolumeCache();
  if (cache[typeId] !== undefined) return cache[typeId];
  try {
    const res = await fetch(`https://esi.evetech.net/latest/universe/types/${typeId}/?datasource=tranquility`, { cache: 'no-store' });
    if (!res.ok) return 0;
    const data = await res.json();
    const vol = data.packaged_volume || data.volume || 0;
    cache[typeId] = vol;
    localStorage.setItem('eve_packaged_volume_cache_v1', JSON.stringify(cache));
    return vol;
  } catch (e) {
    console.warn(`Packaged volume fetch failed for type ${typeId}:`, e);
    return 0;
  }
}
window.fetchPackagedVolume = fetchPackagedVolume;

// SP needed to reach skillLevel (1-5) for a skill of this rank - CCP's own formula, confirmed
// directly via /dogma/attributes/275/'s description text: "Skill points required to train a skill =
// 250 * skillTimeConstant * sqrt(32)^(skillLevel - 1)".
function skillPointsForLevel(rank, level) {
  if (level <= 0) return 0;
  return 250 * rank * Math.pow(Math.sqrt(32), level - 1);
}
window.skillPointsForLevel = skillPointsForLevel;

// Minutes to train a skill from its currently-trained level up to targetLevel, given the character's
// own effective attributes (already implant/remap-inclusive - see attributesPromise's own comment
// above). Assumes Omega training speed (primary + secondary/2 SP/min) - Alpha clones train at exactly
// half this rate, but ESI has no simple "is this character Alpha or Omega" field to check, and Omega
// is the overwhelmingly common case for anyone actively using a build calculator like this one.
// Simplifying assumption, stated plainly here rather than silently: treats the character as having
// exactly the floor SP for their currently trained level (no partial credit for SP already invested
// into a skill mid-training) - ESI's own skillpoints_in_skill field is documented by CCP's own ESI
// team as unreliable for this (only updates when the skill queue itself changes), and getting a truly
// accurate in-progress figure needs a second endpoint/scope (skillqueue) this app doesn't otherwise
// need. Returns null if the target is already met.
function estimateSkillTrainingMinutes(rank, currentLevel, targetLevel, charAttributes, primaryAttr, secondaryAttr) {
  if (targetLevel <= currentLevel) return null;
  const spNeeded = skillPointsForLevel(rank, targetLevel) - skillPointsForLevel(rank, currentLevel);
  const primaryVal = (charAttributes && charAttributes[primaryAttr]) || 17;
  const secondaryVal = (charAttributes && charAttributes[secondaryAttr]) || 17;
  const spPerMinute = primaryVal + (secondaryVal / 2);
  if (spPerMinute <= 0) return null;
  return spNeeded / spPerMinute;
}
window.estimateSkillTrainingMinutes = estimateSkillTrainingMinutes;

// Fetches the character's owned blueprints (with real ME/TE research levels) from ESI. A job's
// blueprint_id references a specific blueprint item instance - this is the only place its actual
// researched ME/TE lives, since the industry jobs endpoint itself doesn't carry that data.
// overrideCharId/overrideToken: lets a caller fetch a SPECIFIC registered character's blueprints
// (not just the active one) - used by the Ledger's multi-character blueprintMeTeMap merge, which
// loops over every character sharing the active one's corp to see personally-owned blueprints a
// corp-mate might have used for a job, invisible via just the active character's own token. Defaults
// to the active character so every existing call site (which passes neither) is unaffected.
async function fetchCharacterBlueprints(overrideCharId, overrideToken) {
  const charId = overrideCharId || getActiveCharId();
  const accessToken = overrideToken || getActiveCharacterToken();
  if (!charId || !accessToken) return [];
  try {
    return await fetchAllEsiPages(`https://esi.evetech.net/latest/characters/${charId}/blueprints/?datasource=tranquility`, accessToken, charId);
  } catch (e) {
    console.warn('Character blueprints fetch failed:', e);
    return [];
  }
}
window.fetchCharacterBlueprints = fetchCharacterBlueprints;

async function fetchCorpBlueprints() {
  const activeRecord = getActiveCharacterRecord();
  const corpId = activeRecord && activeRecord.corpId;
  const accessToken = activeRecord && activeRecord.accessToken;
  if (!corpId || !accessToken) return [];
  try {
    return await fetchAllEsiPages(`https://esi.evetech.net/latest/corporations/${corpId}/blueprints/?datasource=tranquility`, accessToken, activeRecord.charId);
  } catch (e) {
    console.warn('Corp blueprints fetch failed (likely missing role):', e);
    return [];
  }
}
window.fetchCorpBlueprints = fetchCorpBlueprints;

// Every character in the store sharing the active character's corp id - used to widen blueprint
// visibility for ME/TE matching (see fetchCharacterBlueprints's own comment) without needing a full
// simultaneous multi-character job sync.
function getRegisteredCharactersInActiveCorp() {
  const activeRecord = getActiveCharacterRecord();
  if (!activeRecord || !activeRecord.corpId) return [];
  return Object.values(loadCharacterStore()).filter(c => c.corpId === activeRecord.corpId);
}
window.getRegisteredCharactersInActiveCorp = getRegisteredCharactersInActiveCorp;

async function fetchMarketPrices(typeIds) {
  const homeStationId = localStorage.getItem('eve_home_station_id') || '60003760'; // defaults to Jita IV - Moon 4
  const missing = typeIds.filter(id => !window.priceCache[id]);
  if (!missing.length) return;
  const chunks = [];
  for (let i = 0; i < missing.length; i += 30) {
    chunks.push(missing.slice(i, i + 30));
  }
  await Promise.all(chunks.map(async (chunk) => {
    const targetUrl = `https://market.fuzzwork.co.uk/aggregates/?station=${homeStationId}&types=${chunk.join(',')}`;
    const tryUrls = [targetUrl, `https://corsproxy.io/?${encodeURIComponent(targetUrl)}`];
    for (const url of tryUrls) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2000);
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);
        if (res.ok) {
          const data = await res.json();
          if (data && typeof data === 'object') {
            let foundPrices = false;
            for (const id of chunk) {
              const entry = data[String(id)];
              if (entry && (entry.sell || entry.buy)) {
                window.priceCache[id] = {
                  sell: entry.sell ? parseFloat(entry.sell.min) || 0 : 0,
                  buy: entry.buy ? parseFloat(entry.buy.max) || 0 : 0
                };
                foundPrices = true;
              }
            }
            if (foundPrices) break;
          }
        }
      } catch (err) {}
    }
    chunk.forEach(id => {
      if (!window.priceCache[id] || (!window.priceCache[id].sell && !window.priceCache[id].buy)) {
        // No real market order data available (fetch failed, or the item just has none at this
        // station) - EIV is a rough estimate, not a real order, so it's flagged as such here and
        // that flag is surfaced wherever this price gets displayed (see js/config.js formatPriceValue).
        const eivVal = getEIV(id);
        window.priceCache[id] = { sell: eivVal, buy: eivVal * 0.9, isEstimated: true };
      }
    });
  }));
}

// Explicit window bindings
window.decodeJwt = decodeJwt;
window.getItemTypeName = getItemTypeName;
window.isShipLocationFlag = isShipLocationFlag;
window.isContainerAsset = isContainerAsset;
window.isShipType = isShipType;
window.fetchWithAuth = fetchWithAuth;
window.fetchAdjustedPrices = fetchAdjustedPrices;
window.getEIV = getEIV;
window.calculateNodeEIV = calculateNodeEIV;
window.getCleanRedirectUri = getCleanRedirectUri;
window.startEsiSSOLogin = startEsiSSOLogin;
window.handleEsiSSOCallback = handleEsiSSOCallback;
window.updateEsiUserUI = updateEsiUserUI;
window.logoutEsiSSO = logoutEsiSSO;
window.refreshLiveAssets = refreshLiveAssets;
window.fetchUserAndCorpAssets = fetchUserAndCorpAssets;
window.resolveAndPopulateLocationFilter = resolveAndPopulateLocationFilter;
window.populateLocationDropdown = populateLocationDropdown;
window.filterLocationDropdownOptions = filterLocationDropdownOptions;
window.updateStockDisplayCount = updateStockDisplayCount;
window.applyStockLocationFilter = applyStockLocationFilter;
window.openPasteModal = openPasteModal;
window.closePasteModal = closePasteModal;
window.clearUserStock = clearUserStock;
window.processPastedStock = processPastedStock;
window.selectSolarSystem = selectSolarSystem;
window.loadSavedSystem = loadSavedSystem;
window.resolveSystemSCI = resolveSystemSCI;
window.fetchSystemSCIById = fetchSystemSCIById;
window.fetchMarketPrices = fetchMarketPrices;