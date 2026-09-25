'use strict';

// Phone layout: the Invention screen. The maths is a port of js/invention.js recalculateInventionImpl
// (success chance, attempts needed, datacores + decryptor + invention job fee per attempt, then the
// resulting copy built with the site's own tree builder and priced like the desktop), and the job
// queue uses js/invention-queue.js itself (loaded unchanged), so plans and EVE-matched attempts are
// shared with the desktop Invention page. The item, copies wanted, base chance and skill levels are
// shared too (eve_invention_state).
//
// One deliberate difference: fees are read the phone's way, so a fee set to 0% counts as 0%. (The
// desktop reads 0 as "use the default".)
(() => {
  const MB = window.MB;
  const { $, esc, compact, full, qty, dur, ICON, LS, toast, prefs, iconHTML } = MB;

  // js/invention.js DECRYPTORS (EVE University's figures).
  const DECRYPTORS = [
    { name: 'No Decryptor', probMod: 0, runsMod: 0, meMod: 0, teMod: 0 },
    { name: 'Accelerant Decryptor', probMod: 20, runsMod: 1, meMod: 2, teMod: 10 },
    { name: 'Attainment Decryptor', probMod: 80, runsMod: 4, meMod: -1, teMod: 4 },
    { name: 'Augmentation Decryptor', probMod: -40, runsMod: 9, meMod: -2, teMod: 2 },
    { name: 'Optimized Attainment Decryptor', probMod: 90, runsMod: 2, meMod: 1, teMod: -2 },
    { name: 'Optimized Augmentation Decryptor', probMod: -10, runsMod: 7, meMod: 2, teMod: 0 },
    { name: 'Parity Decryptor', probMod: 50, runsMod: 3, meMod: 1, teMod: -2 },
    { name: 'Process Decryptor', probMod: 10, runsMod: 0, meMod: 3, teMod: 6 },
    { name: 'Symmetry Decryptor', probMod: 0, runsMod: 2, meMod: 1, teMod: 8 }
  ];
  const decId = name => { const e = window.IDX && window.IDX[name.toLowerCase()]; return e ? e.id : null; };
  const STATE_KEY = 'eve_invention_state';

  // Tech II item -> the Tech I recipe it's invented from (js/invention.js getInventionT2ToT1Map).
  let t2Map = null;
  function t2ToT1() {
    if (t2Map) return t2Map;
    if (!window.recipeMap || !Object.keys(window.recipeMap).length) return {}; // not built yet (MB.start)
    t2Map = {};
    const seen = new Set();
    for (const recipe of Object.values(window.recipeMap || {})) {
      if (!recipe || seen.has(recipe.blueprintTypeID)) continue;
      seen.add(recipe.blueprintTypeID);
      if (recipe.inventionMaterials && recipe.inventionMaterials.length && recipe.inventionProducts && recipe.inventionProducts.length) {
        recipe.inventionProducts.forEach(p => { if (p && p.typeId) t2Map[p.typeId] = recipe; });
      }
    }
    return t2Map;
  }
  // For EVE jobs the queue finds that weren't planned here (js/invention-queue.js calls this).
  if (typeof window.getInventionMaterialsForT1Blueprint !== 'function') {
    window.getInventionMaterialsForT1Blueprint = bpId => {
      const r = Object.values(t2ToT1()).find(x => x && x.blueprintTypeID === bpId);
      return r ? (r.inventionMaterials || []).map(m => ({ typeId: m.typeId, name: m.name, qty: m.qty })) : [];
    };
  }
  // js/invention.js getInventionBaseChance: from the item's group, editable because group names
  // can't cover every case.
  function autoBaseChance(t2) {
    const g = ((window.EVE_GROUP_NAMES && window.EVE_GROUP_NAMES[t2]) || '').toLowerCase();
    const cat = window.EVE_CATEGORIES && window.EVE_CATEGORIES[t2];
    if (g.includes('freighter')) return 18;
    if (g.includes('battleship')) return 22;
    if (g.includes('cruiser') || g.includes('battlecruiser') || g.includes('mining barge') || g.includes('hauler') || g.includes('industrial')) return 26;
    if (g.includes('frigate') || g.includes('destroyer')) return 30;
    if (cat === 6) return 26;
    return 34;
  }
  const isEncryption = sk => /encryption/i.test(sk.name || '');
  const t2Name = id => MB.nameOf(id);
  const t1BpName = r => (window.EVE_ITEMS && window.EVE_ITEMS[r.blueprintTypeID]) || `${r.productName || 'T1 item'} Blueprint`;

  /* =====================  State  ===================== */
  const I = {
    typeId: null, target: 1, baseChance: 34, skills: {},
    tab: 'compare', sort: 'profitPerRun', open: null, matDec: null,
    rows: null, computing: false, error: null, token: 0, sig: '', timer: null, lastSync: 0, syncing: false
  };
  const trained = id => { const s = MB.rawSkills(); return (s && s.allSkills && s.allSkills[id] !== undefined) ? Number(s.allSkills[id]) || 0 : 0; };
  // Read once the site's recipe data exists (after MB.start builds it).
  let stateLoaded = false;
  function loadState() {
    if (stateLoaded || !Object.keys(t2ToT1()).length) return;
    stateLoaded = true;
    const s = LS.get(STATE_KEY, null);
    if (!s || !s.typeId || !t2ToT1()[s.typeId]) return;
    I.typeId = Number(s.typeId);
    const t1 = t2ToT1()[I.typeId];
    const bc = parseFloat(s.baseChance);
    I.baseChance = Number.isFinite(bc) && bc >= 0 ? bc : autoBaseChance(I.typeId);
    const tg = parseInt(s.targetBPCs !== undefined ? s.targetBPCs : s.bpcRuns, 10);
    I.target = tg >= 1 ? tg : 1;
    I.skills = {};
    (t1.inventionSkills || []).forEach(sk => { I.skills[sk.skillId] = trained(sk.skillId); });
    if (Array.isArray(s.skillLevels)) s.skillLevels.forEach(x => { if (I.skills[x.skillId] !== undefined) I.skills[x.skillId] = Math.min(5, Math.max(0, parseInt(x.value, 10) || 0)); });
  }
  function saveState() {
    if (!I.typeId) return;
    LS.set(STATE_KEY, {
      typeId: I.typeId, name: t2Name(I.typeId), baseChance: String(I.baseChance), targetBPCs: String(I.target), priceMode: prefs.priceMode,
      skillLevels: Object.entries(I.skills).map(([skillId, value]) => ({ skillId: String(skillId), value: String(value) }))
    });
  }
  function selectItem(t2) {
    loadState(); // keeps the saved copies wanted, even if this screen hasn't been opened yet
    const t1 = t2ToT1()[t2];
    if (!t1) { toast('No invention data for that item'); return; }
    I.typeId = t2;
    I.baseChance = autoBaseChance(t2);
    I.skills = {};
    (t1.inventionSkills || []).forEach(sk => { I.skills[sk.skillId] = trained(sk.skillId); });
    I.rows = null; I.open = null; I.matDec = null; I.error = null;
    const recent = (prefs.invRecent || []).filter(id => id !== t2);
    recent.unshift(t2);
    prefs.invRecent = recent.slice(0, 8);
    MB.savePrefs();
    saveState();
    I.tab = 'compare';
    render();
    schedule(0);
  }

  /* =====================  The maths (js/invention.js)  ===================== */
  function skillSums() {
    const t1 = t2ToT1()[I.typeId];
    let sci = 0, enc = 0;
    (t1.inventionSkills || []).forEach(sk => { const lv = I.skills[sk.skillId] || 0; if (isEncryption(sk)) enc = lv; else sci += lv; });
    return { sci, enc };
  }
  const chanceFactor = () => { const { sci, enc } = skillSums(); return 1 + sci / 30 + enc / 40; };
  // Datacores and decryptors, priced the way the Calculator's "Material cost" setting says (a buy
  // order adds the broker fee), like js/invention.js getInventionInputPrice.
  function inputPrice(typeId) {
    const p = (window.priceCache && window.priceCache[typeId]) || { sell: 0, buy: 0 };
    if (prefs.priceMode === 'buy') return (p.buy || 0) * (1 + MB.feeFrac().brokerFee);
    return p.sell || 0;
  }
  // Everything that changes the answer; a change reruns the maths.
  function signature() {
    if (!I.typeId) return '';
    return JSON.stringify([I.typeId, I.target, I.baseChance, I.skills, prefs.priceMode, prefs.simV, MB.readFees(), MB.liveStation(), LS.raw('eve_char_skills'), MB.implantPct(), !!MB.eivLoaded, LS.raw('eve_owned_bpo_index_v1') ? 1 : 0]);
  }
  function schedule(delay = 350) {
    clearTimeout(I.timer);
    I.timer = setTimeout(() => { I.timer = null; compute(); }, delay);
  }
  async function compute() {
    if (!I.typeId) return;
    const token = ++I.token;
    I.sig = signature();
    I.computing = true;
    I.error = null;
    if (MB.screen() === 'inv') render();
    try {
      const rows = await computeRows();
      if (token !== I.token) return;
      I.rows = rows;
    } catch (e) {
      if (token !== I.token) return;
      console.error('[Phone Invention] Could not work this out:', e);
      I.error = 'Couldn’t work this item out. Check your connection and try again.';
    }
    I.computing = false;
    if (MB.screen() === 'inv') render();
  }
  async function computeRows() {
    const t2 = I.typeId;
    const t1 = t2ToT1()[t2];
    const t2Recipe = window.recipeMap && window.recipeMap[t2];
    const t2Bp = t2Recipe ? t2Recipe.blueprintTypeID : null;
    const target = I.target;
    const { sci, enc } = skillSums();
    const datacores = t1.inventionMaterials || [];
    const group = ((window.EVE_GROUP_NAMES && window.EVE_GROUP_NAMES[t2]) || '').toLowerCase();
    const baseRuns = (window.EVE_CATEGORIES && window.EVE_CATEGORIES[t2] === 6) || group.includes('rig') ? 1 : 10;
    await window.fetchMarketPrices([...datacores.map(m => m.typeId), ...DECRYPTORS.map(d => decId(d.name)).filter(Boolean), t2]);

    MB.syncShim();
    MB.setStationGlobals();
    const fees = MB.feeFrac();
    const st = window.getActiveStructureType();
    const roleBonus = (st.costBonus || 0) / 100;
    // One attempt's length: Industry/Advanced Industry, the structure and an invention rig; the
    // decryptor doesn't change it (js/invention.js perAttemptInventionSeconds).
    const baseInvTime = t1.inventionTime;
    const perAttemptSec = baseInvTime ? window.calculateAdjustedJobSeconds(baseInvTime, 0, 1, true, t1.productTypeID, [], true) : 0;
    const invSCI = window.activeInventionSCI !== undefined ? window.activeInventionSCI : 0.02;
    const attemptEIV = datacores.reduce((s, m) => s + (window.eivCache && window.eivCache[m.typeId] ? window.eivCache[m.typeId] * m.qty : 0), 0);
    const feePerAttempt = attemptEIV * (invSCI * (1 - roleBonus) * (1 - window.getEffectiveInventionRigBonus('cost') / 100) + fees.facilityTax + fees.sccSurcharge);

    // The resulting copy, built for each ME/TE/run count a decryptor gives: everything in it bought,
    // like the desktop page (a borrowed, empty set of build choices).
    const builds = {};
    if (t2Bp) {
      await MB.treeLock(async () => {
        const saved = { b: window.buildSelfOverrides, me: window.customMEOverrides, te: window.customTEOverrides, m: window.customBuyModes };
        try {
          window.buildSelfOverrides = {};
          window.customBuyModes = {};
          for (const dec of DECRYPTORS) {
            const runs = Math.max(1, baseRuns + dec.runsMod), me = 2 + dec.meMod, te = 4 + dec.teMod;
            const key = `${me}:${te}:${runs}`;
            if (builds[key]) continue;
            window.customMEOverrides = { [t2Bp]: me };
            window.customTEOverrides = { [t2Bp]: te };
            window.recipeTreeRootProductTypeId = t2;
            let root;
            try { root = await window.buildRecursiveRecipeTree(parseInt(t2Bp, 10), t2Name(t2) + ' Blueprint', runs, 0, 6, new Set(), null); }
            finally { window.recipeTreeRootProductTypeId = null; }
            if (!root) continue;
            root.runsNeeded = runs;
            root.qtyNeeded = runs * (root.batchYield || 1);
            window.scaleTreeQuantities(root, (st.meBonus || 0) / 100);
            const ids = new Set();
            window.collectAllTypeIds(root, ids);
            await window.fetchMarketPrices([...ids]);
            const materialCost = window.calculateTreeNodeCost(root);
            window.calculateNodeEIV(root);
            const jobFee = window.calculateNodeJobFee(root, fees.facilityTax, fees.sccSurcharge, roleBonus);
            const sell = (window.priceCache[t2] || { sell: 0 }).sell || 0;
            builds[key] = {
              unitCost: materialCost + jobFee, materialCost, jobFee, qty: root.qtyNeeded, sell,
              unitSell: sell * root.qtyNeeded * (1 - fees.salesTax - fees.brokerFee),
              unitSec: window.calculateTotalBuildSeconds(root)
            };
          }
        } finally {
          window.buildSelfOverrides = saved.b; window.customMEOverrides = saved.me; window.customTEOverrides = saved.te; window.customBuyModes = saved.m;
        }
      });
    }

    return DECRYPTORS.map(dec => {
      const successChance = Math.min(100, I.baseChance * (1 + sci / 30 + enc / 40) * (1 + dec.probMod / 100));
      const resultRuns = Math.max(1, baseRuns + dec.runsMod), resultME = 2 + dec.meMod, resultTE = 4 + dec.teMod;
      const did = dec.name !== 'No Decryptor' ? decId(dec.name) : null;
      const requiredRuns = successChance > 0 ? Math.ceil(target / (successChance / 100)) : Infinity;
      // Materials at full value, win or lose, stock or not (what an attempt really costs).
      const mats = datacores.map(m => ({ typeId: m.typeId, name: m.name, need: m.qty * requiredRuns, unit: inputPrice(m.typeId) }));
      if (did) mats.push({ typeId: did, name: dec.name, need: requiredRuns, unit: inputPrice(did) });
      let totalInventionCost = Infinity, matsTotal = 0, feesTotal = 0;
      if (Number.isFinite(requiredRuns)) {
        matsTotal = mats.reduce((s, m) => s + m.need * m.unit, 0);
        feesTotal = feePerAttempt * requiredRuns;
        totalInventionCost = matsTotal + feesTotal;
      }
      const b = builds[`${resultME}:${resultTE}:${resultRuns}`] || null;
      const totalManufacturingCost = target * (b ? b.unitCost : 0);
      const totalRevenue = target * (b ? b.unitSell : 0);
      const totalProfit = Number.isFinite(totalInventionCost) ? totalRevenue - totalManufacturingCost - totalInventionCost : -Infinity;
      const totalBuildSeconds = target * (b ? b.unitSec : 0);
      const totalInventionSeconds = !baseInvTime ? null : Number.isFinite(requiredRuns) ? requiredRuns * perAttemptSec : Infinity;
      const totalTimeSeconds = totalInventionSeconds === null ? null : Number.isFinite(totalInventionSeconds) ? totalInventionSeconds + totalBuildSeconds : Infinity;
      const iskPerHour = totalBuildSeconds > 0 && Number.isFinite(totalProfit) ? totalProfit / (totalBuildSeconds / 3600) : null;
      const produced = target * resultRuns;
      const profitPerRun = Number.isFinite(totalProfit) && produced > 0 ? totalProfit / produced : Number.isFinite(totalProfit) ? totalProfit : -Infinity;
      return { dec, did, successChance, resultRuns, resultME, resultTE, requiredRuns, mats, matsTotal, feesTotal, totalInventionCost, totalManufacturingCost, totalRevenue, totalProfit, totalBuildSeconds, totalInventionSeconds, totalTimeSeconds, iskPerHour, profitPerRun, build: b, t2Bp, perAttemptSec };
    });
  }

  /* =====================  Rendering  ===================== */
  const fin = x => x !== null && x !== undefined && Number.isFinite(x);
  const money = (x, signed) => (fin(x) ? compact(x, signed) : '—');
  const sortVal = (r, k) => (fin(r[k]) ? r[k] : -Infinity);
  const sorted = () => [...(I.rows || [])].sort((a, b) => sortVal(b, I.sort) - sortVal(a, I.sort));
  const bestRow = () => [...(I.rows || [])].sort((a, b) => sortVal(b, 'profitPerRun') - sortVal(a, 'profitPerRun'))[0];
  const resultText = r => `${r.resultRuns} run${r.resultRuns === 1 ? '' : 's'} · ME ${r.resultME} · TE ${r.resultTE}`;
  const SORT_LABEL = { profitPerRun: 'profit per run', iskPerHour: 'ISK per hour', successChance: 'success chance' };
  const copiesText = () => `${I.target} successful cop${I.target === 1 ? 'y' : 'ies'}`;
  const decIcon = r => iconHTML(r.did);
  function numField(key, v, min, label, width) {
    const w = width || Math.max(36, String(v).length * 9 + 12);
    return `<span class="stepper sm"><button type="button" data-step="${key}" data-d="-1" aria-label="Lower ${esc(label)}"${v <= min ? ' disabled' : ''}>−</button><input type="text" inputmode="numeric" data-inum="${key}" value="${v}" style="width:${w}px" aria-label="${esc(label)}"><button type="button" data-step="${key}" data-d="1" aria-label="Raise ${esc(label)}">+</button></span>`;
  }

  function headerHTML() {
    if (!I.typeId) {
      return `<button class="product product-btn" type="button" data-iact="pick" aria-haspopup="dialog"><span class="ic ic-none" aria-hidden="true">${ICON.bp}</span><span class="p-text"><span class="p-name">Choose a Tech II item</span><span class="p-sub">What you want to invent, like Hobgoblin II or Wolf</span></span>${ICON.down}</button>`;
    }
    const t1 = t2ToT1()[I.typeId];
    return `<button class="product product-btn" type="button" data-iact="pick" aria-haspopup="dialog" aria-label="${esc(t2Name(I.typeId))}. Change item">${iconHTML(I.typeId)}<span class="p-text"><span class="p-name">${esc(t2Name(I.typeId))}</span><span class="p-sub">Invented from ${esc(t1BpName(t1))} (copy) · base ${I.baseChance}%</span></span>${ICON.down}</button>`;
  }
  function emptyHTML() {
    const recent = (prefs.invRecent || []).filter(id => t2ToT1()[id]);
    return `<div class="empty"><b>Pick what to invent</b>Search the Tech II item you want to make. Its Tech I blueprint copy, datacores and every decryptor are worked out for you.</div>
      <button class="btn primary" type="button" data-iact="pick">${ICON.search}Choose an item</button>
      ${recent.length ? `<div class="card-title">Recent</div><ul class="itemlist">${recent.map(invItemRow).join('')}</ul>` : ''}`;
  }
  function busyHTML() {
    return `<div class="loading-row"><span class="spin" aria-hidden="true"></span>Working out all ${DECRYPTORS.length} decryptors…</div>`;
  }

  function renderCompare() {
    if (I.error) return `<div class="errbox">${esc(I.error)} <button class="linkbtn" type="button" data-iact="retry">Try again</button></div>`;
    if (!I.rows) return busyHTML();
    const rows = sorted();
    const b = rows[0];
    const pos = fin(b.profitPerRun) && b.profitPerRun >= 0;
    return `${I.computing ? '<p class="note" style="margin:0 2px 10px"><span class="spin" aria-hidden="true"></span> Updating…</p>' : ''}
      <div class="best${pos ? '' : ' is-neg'}">
        <div class="best-top">${decIcon(b)}<div><div class="best-label">Best by ${SORT_LABEL[I.sort]}</div><div class="best-name">${esc(b.dec.name)}</div></div></div>
        <div class="best-profit ${pos ? 'pos' : 'neg'}">${money(b.profitPerRun, true)}</div>
        <div class="best-caption">profit per run built · each successful copy is ${resultText(b)}</div>
        <div class="minis">
          <div class="mini"><b>${b.successChance.toFixed(1)}%</b><span>success</span></div>
          <div class="mini"><b>${fin(b.requiredRuns) ? qty(b.requiredRuns) : '—'}</b><span>attempts</span></div>
          <div class="mini"><b class="${fin(b.iskPerHour) && b.iskPerHour < 0 ? 'neg' : ''}">${money(b.iskPerHour)}</b><span>ISK / hour</span></div>
        </div>
      </div>
      <div class="sortbar" role="group" aria-label="Sort decryptors">
        <span class="lbl">Sort by</span>
        ${Object.entries(SORT_LABEL).map(([k, l]) => `<button class="chip small" type="button" data-isort="${k}" aria-pressed="${I.sort === k}">${l[0].toUpperCase() + l.slice(1)}</button>`).join('')}
      </div>
      <ol class="decs">${rows.map(r => {
        const open = I.open === r.dec.name;
        const id = 'dec-' + r.dec.name.replace(/\W+/g, '-');
        const p = fin(r.profitPerRun) && r.profitPerRun >= 0;
        return `<li class="dec">
          <button class="dec-head" type="button" data-idec="${esc(r.dec.name)}" aria-expanded="${open}" aria-controls="${id}">
            ${decIcon(r)}
            <span><span class="dec-name">${esc(r.dec.name)}</span><br><span class="dec-meta">${r.successChance.toFixed(1)}% · ${resultText(r)}</span></span>
            <span class="dec-right"><span class="dec-profit ${p ? 'pos' : 'neg'}">${money(r.profitPerRun, true)}</span><br><span class="dec-rate">per run · ${money(r.iskPerHour)}/h</span></span>
          </button>
          <div class="dec-body" id="${id}"${open ? '' : ' hidden'}>
            <dl class="facts">
              <div><dt>Attempts needed</dt><dd>${fin(r.requiredRuns) ? qty(r.requiredRuns) : '—'}</dd></div>
              <div><dt>Total time</dt><dd>${fin(r.totalTimeSeconds) ? dur(r.totalTimeSeconds) : '—'}</dd></div>
              <div><dt>Invention cost</dt><dd>${money(r.totalInventionCost)}</dd></div>
              <div><dt>Build cost</dt><dd>${money(r.totalManufacturingCost)}</dd></div>
              <div><dt>Sells for</dt><dd>${money(r.totalRevenue)}</dd></div>
              <div><dt>Total profit</dt><dd class="${fin(r.totalProfit) && r.totalProfit >= 0 ? 'pos' : 'neg'}">${money(r.totalProfit, true)}</dd></div>
            </dl>
            <button class="btn" type="button" data-imats="${esc(r.dec.name)}">${ICON.list}See materials for this decryptor</button>
            <div class="addrow" style="margin-top:8px">
              <button class="btn" type="button" data-ibuild="${esc(r.dec.name)}"${r.t2Bp ? '' : ' disabled'}>${ICON.factory}Build it</button>
              <button class="btn" type="button" data-iqueue="${esc(r.dec.name)}">${ICON.plus}Add to queue</button>
            </div>
          </div>
        </li>`;
      }).join('')}</ol>
      <p class="note">Invention cost covers every attempt, successful or not: datacores, the decryptor and the job fee. Build cost is making ${copiesText()} into items, with the job fee. The items are valued at Jita sell after sales tax and broker fee. The Tech I copy itself isn't counted.</p>`;
  }

  function stationCardHTML() {
    const st = MB.activeStation();
    const r = I.rows && I.rows[0];
    return `<div class="card-title">Where you invent and build</div>
      <div class="card">
        <div class="kv"><span class="k">${esc(st.name)}<small>${MB.stationMeta(st)}</small></span><button class="btn" style="width:auto;height:40px" type="button" data-iact="stations">Change</button></div>
        <div class="kv"><span class="k">Time per attempt<small>your skills, the structure and any invention rig</small></span><span class="v">${r && r.perAttemptSec ? dur(r.perAttemptSec) : '—'}</span></div>
      </div>`;
  }
  function renderSetup() {
    const t1 = t2ToT1()[I.typeId];
    const skills = t1.inventionSkills || [];
    const f = chanceFactor();
    const sheet = MB.hasSkillSheet();
    const differs = sheet && skills.some(sk => (I.skills[sk.skillId] || 0) !== trained(sk.skillId));
    const auto = autoBaseChance(I.typeId);
    const datacores = t1.inventionMaterials || [];
    return `<div class="card-title">Goal</div>
      <div class="card">
        <div class="kv"><span class="k">Successful copies wanted</span>${numField('target', I.target, 1, 'copies wanted')}</div>
        <div class="kv"><label class="k" for="i-base">Base chance<small>${I.baseChance === auto ? 'usual for this kind of item' : `usually ${auto}% for this kind of item`}</small></label><span class="suffix feein"><input type="text" inputmode="decimal" id="i-base" value="${I.baseChance}" autocomplete="off"><span>%</span></span></div>
        <div class="kv"><span class="k">Chance before decryptor<small>base × your skills</small></span><span class="v">${Math.min(100, I.baseChance * f).toFixed(1)}%</span></div>
      </div>
      <div class="card-title">Your skills${differs ? '<button class="linkbtn" style="margin-left:auto;padding:0" type="button" data-iact="myskills">Use my skills</button>' : ''}</div>
      ${MB.isLoggedIn() ? '' : `<div class="login-card">${ICON.lock}<p>Log in to fill these in from your character. You can also set them by hand.</p><button class="btn primary" type="button" data-iact="login">Log in</button></div>`}
      <div class="card">
        ${skills.length ? skills.map(sk => `<div class="kv"><span class="k">${esc(sk.name || `Skill ${sk.skillId}`)}<small>${isEncryption(sk) ? 'encryption skill' : 'science skill'}${sheet ? ` · you have ${trained(sk.skillId)}` : ''}</small></span>${MB.stepper('skill:' + sk.skillId, I.skills[sk.skillId] || 0, 0, 5, sk.name || 'skill')}</div>`).join('') : '<p class="note" style="padding:10px 0">No skill data for this blueprint.</p>'}
      </div>
      <div class="card-title">Datacores per attempt</div>
      <div class="card">
        ${datacores.map(d => `<div class="kv">${iconHTML(d.typeId)}<span class="k">${esc(String(d.name || MB.nameOf(d.typeId)).replace('Datacore - ', ''))}<small>${d.qty} × ${compact(inputPrice(d.typeId))} · ${prefs.priceMode === 'buy' ? 'buy order' : 'Jita sell'}</small></span><span class="v">${compact(d.qty * inputPrice(d.typeId))}</span></div>`).join('')}
        <div class="kv"><span class="k">Buy datacores and decryptors at<small>same setting as the Calculator</small></span><span class="segctl" role="group" aria-label="Buy at"><button type="button" data-iprice="sell" data-mode="sell" aria-pressed="${prefs.priceMode !== 'buy'}">${ICON.bolt}Sell</button><button type="button" data-iprice="buy" data-mode="buy" aria-pressed="${prefs.priceMode === 'buy'}">${ICON.order}Buy order</button></span></div>
      </div>
      ${stationCardHTML()}`;
  }

  function renderMats() {
    if (I.error) return `<div class="errbox">${esc(I.error)}</div>`;
    if (!I.rows) return busyHTML();
    const byProfit = [...I.rows].sort((a, b) => sortVal(b, 'profitPerRun') - sortVal(a, 'profitPerRun'));
    if (!I.matDec || !I.rows.some(r => r.dec.name === I.matDec)) I.matDec = byProfit[0].dec.name;
    const r = I.rows.find(x => x.dec.name === I.matDec);
    const deduct = prefs.deduct && MB.isLoggedIn();
    const items = r.mats.map(m => { const have = deduct ? MB.stockOf(m.typeId) : 0; return { ...m, have, toBuy: Math.max(0, m.need - have) }; });
    const shortfall = items.filter(x => x.toBuy > 0);
    return `<div class="selectwrap">
        <label for="i-matdec">Decryptor</label>
        <select id="i-matdec">${byProfit.map(x => `<option value="${esc(x.dec.name)}"${x.dec.name === I.matDec ? ' selected' : ''}>${esc(x.dec.name)} (${money(x.profitPerRun, true)} per run)</option>`).join('')}</select>
      </div>
      ${MB.isLoggedIn() ? '' : `<div class="login-card">${ICON.lock}<p>Log in to take datacores and decryptors you own off the list.</p><button class="btn primary" type="button" data-iact="login">Log in</button></div>`}
      ${fin(r.requiredRuns) ? `<div class="card">
        ${items.map(x => `<div class="kv">${iconHTML(x.typeId)}<span class="k">${esc(x.name)}<small>need ${qty(x.need)}${x.have ? ` · have ${qty(x.have)}` : ''} · ${compact(x.unit)} each</small></span><span class="v">${x.toBuy ? 'buy ' + qty(x.toBuy) : '<span class="have full">In stock</span>'}<small>${compact(x.need * x.unit)}</small></span></div>`).join('')}
        <div class="kv"><span class="k">Materials<small>full value, stock not subtracted</small></span><span class="v">${compact(r.matsTotal)}</span></div>
        ${r.feesTotal > 0.5 ? `<div class="kv"><span class="k">Invention job fees<small>${qty(r.requiredRuns)} attempts</small></span><span class="v">${compact(r.feesTotal)}</span></div>` : ''}
        <div class="kv total"><span class="k">Invention cost</span><span class="v">${full(r.totalInventionCost)} ISK</span></div>
      </div>
      <button class="btn primary" type="button" data-iact="copymats"${shortfall.length ? '' : ' disabled'}>${ICON.copy}Copy Multibuy · ${shortfall.length} item${shortfall.length === 1 ? '' : 's'}</button>
      <p class="note">Covers ${qty(r.requiredRuns)} attempts, enough on average for ${copiesText()} at ${r.successChance.toFixed(1)}%.${deduct ? ' Copies only what you still need to buy.' : ''}</p>` : '<p class="note">This decryptor can’t succeed at the current chance.</p>'}`;
  }

  /* ---------- Queue (js/invention-queue.js data) ---------- */
  const Q = window;
  const loadQueue = () => (typeof Q.loadInventionQueue === 'function' ? Q.loadInventionQueue().filter(Boolean) : []);
  const saveQueue = q => { if (typeof Q.saveInventionQueue === 'function') Q.saveInventionQueue(q); else LS.set('eve_invention_queue_v1', q); };
  const remainingAttempts = b => {
    const left = Math.max(0, b.targetBPCs - Q.inventionBatchSuccesses(b));
    if (!left) return 0;
    if (!b.successChance || b.successChance <= 0) return null;
    return Math.ceil(left / (b.successChance / 100));
  };
  const STATUS_PILL = { complete: 'ready', in_progress: 'building', needs_more: 'warnp', planned: 'planned' };
  function batchHTML(b) {
    const disp = Q.inventionBatchDisplayStatus(b);
    const best = Q.inventionBatchBestResult(b);
    const successes = Q.inventionBatchSuccesses(b);
    const done = Q.inventionBatchRunsDone(b);
    const left = Q.inventionBatchRunsNeeded(b);
    const running = b.attempts.filter(a => a.status === 'in_progress' && a.endDate);
    let timer = '';
    if (running.length) {
      const soon = running.reduce((a, c) => (new Date(a.endDate).getTime() < new Date(c.endDate).getTime() ? a : c));
      const sec = (new Date(soon.endDate).getTime() - Date.now()) / 1000;
      timer = `<span class="sub">${sec > 0 ? `${dur(sec)} left` : 'ready to deliver'}${running.length > 1 ? ` · ${running.length} running` : ''}</span>`;
    }
    const result = best ? `${best.runs} run${best.runs === 1 ? '' : 's'} · ME ${best.me} · TE ${best.te}${best.isReal ? ' · confirmed' : ''}` : 'ME/TE unknown';
    return `<li class="job inv-batch">
      <div class="job-head">
        ${iconHTML(b.t2ProductTypeId || b.t2BlueprintTypeId)}
        <span class="main"><span class="nm">${esc(b.t2ProductName)}${b.autoImported ? ' <span class="count">(found in EVE)</span>' : ''}</span><span class="sub">${esc(b.decryptorName || 'Decryptor unknown')} · ${esc(result)}</span>${timer}</span>
        <span class="spill ${STATUS_PILL[disp.key] || 'planned'}">${esc(disp.label)}</span>
      </div>
      <div class="inv-batch-body"><dl class="facts">
        <div><dt>${left !== null ? 'Attempts to start' : 'Attempts started'}</dt><dd>${qty(left !== null ? left : done)}</dd></div>
        <div><dt>Successful copies</dt><dd>${successes} / ${b.targetBPCs}</dd></div>
      </dl>
      <div class="addrow" style="margin-top:8px">
        <button class="btn" type="button" data-qbuild="${esc(b.id)}"${best && b.t2BlueprintTypeId ? '' : ' disabled'}>${ICON.factory}Build it</button>
        <button class="btn" type="button" data-qrm="${esc(b.id)}" style="flex:0 0 48px" aria-label="Remove ${esc(b.t2ProductName)} from the queue">${ICON.trash}</button>
      </div></div>
    </li>`;
  }
  function queueBomRows() {
    const open = loadQueue().filter(b => b.status === 'planned' || b.status === 'active');
    const totals = new Map();
    let skipped = 0;
    open.forEach(b => {
      const n = remainingAttempts(b);
      if (n === null) { skipped++; return; }
      if (!n) return;
      (b.invMaterials || []).forEach(m => { const e = totals.get(m.typeId) || { typeId: m.typeId, name: m.name, need: 0 }; e.need += (m.qty || 0) * n; totals.set(m.typeId, e); });
      if (b.decryptorTypeId) { const e = totals.get(b.decryptorTypeId) || { typeId: b.decryptorTypeId, name: b.decryptorName, need: 0 }; e.need += n; totals.set(b.decryptorTypeId, e); }
    });
    const deduct = prefs.deduct && MB.isLoggedIn();
    const rows = [...totals.values()].map(e => { const have = deduct ? MB.stockOf(e.typeId) : 0; const toBuy = Math.max(0, e.need - have); return { ...e, have, toBuy, unit: inputPrice(e.typeId), cost: toBuy * inputPrice(e.typeId) }; }).sort((a, b) => b.cost - a.cost);
    return { rows, skipped };
  }
  function renderQueue() {
    const queue = loadQueue();
    const rank = s => (s === 'complete' ? 2 : s === 'active' ? 0 : 1);
    const all = [...queue].sort((a, b) => rank(a.status) - rank(b.status) || String(b.addedAt || '').localeCompare(String(a.addedAt || '')));
    const started = all.filter(b => b.status === 'active' || b.status === 'complete');
    const planned = all.filter(b => b.status === 'planned');
    const { rows, skipped } = queueBomRows();
    const missing = rows.filter(r => r.toBuy > 0);
    const total = rows.reduce((s, r) => s + r.cost, 0);
    if (rows.some(r => !window.priceCache[r.typeId])) window.fetchMarketPrices(rows.map(r => r.typeId)).then(() => { if (MB.screen() === 'inv' && I.tab === 'queue') render(); });
    return `${MB.isLoggedIn()
        ? `<div class="card"><div class="kv"><span class="k">Your invention jobs in EVE<small>${I.syncing ? 'checking…' : I.lastSync ? `checked ${MB.ago(I.lastSync)}` : 'not checked yet'}</small></span><button class="btn" style="width:auto;height:40px" type="button" data-iact="sync"${I.syncing ? ' disabled' : ''}>${I.syncing ? '<span class="spin" aria-hidden="true"></span>' : ICON.sync}Sync</button></div></div>`
        : `<div class="login-card">${ICON.lock}<p>Log in to match your real invention jobs in EVE to these plans.</p><button class="btn primary" type="button" data-iact="login">Log in</button></div>`}
      ${queue.length ? '' : '<div class="empty"><b>Nothing queued</b>Open a decryptor under Compare and tap “Add to queue” to plan it here.</div>'}
      ${started.length ? `<div class="card-title">Started <span class="count">${started.length}</span></div><ul class="jobs">${started.map(batchHTML).join('')}</ul>` : ''}
      ${planned.length ? `<div class="card-title">Planned <span class="count">${planned.length}</span></div><ul class="jobs">${planned.map(batchHTML).join('')}</ul>` : ''}
      ${rows.length ? `<div class="card-title">To buy for what's left</div>
        <div class="card">
          ${rows.map(r => `<div class="kv">${iconHTML(r.typeId)}<span class="k">${esc(r.name)}<small>need ${qty(r.need)}${r.have ? ` · have ${qty(r.have)}` : ''} · ${compact(r.unit)} each</small></span><span class="v">${r.toBuy ? 'buy ' + qty(r.toBuy) : '<span class="have full">In stock</span>'}${r.toBuy ? `<small>${compact(r.cost)}</small>` : ''}</span></div>`).join('')}
          <div class="kv total"><span class="k">Still to buy</span><span class="v">${full(total)} ISK</span></div>
        </div>
        <button class="btn primary" type="button" data-iact="copyqueue"${missing.length ? '' : ' disabled'}>${ICON.copy}Copy Multibuy · ${missing.length} item${missing.length === 1 ? '' : 's'}</button>
        ${skipped ? `<p class="note">${skipped} plan${skipped === 1 ? ' isn’t' : 's aren’t'} included: found in EVE without a known success chance.</p>` : ''}` : ''}`;
  }

  function render() {
    loadState();
    const scr = $('#screen-inv');
    const tabs = [['setup', 'Setup'], ['compare', 'Compare'], ['mats', 'Materials'], ['queue', 'Queue']];
    const openCount = loadQueue().filter(b => b.status !== 'complete' && b.status !== 'abandoned').length;
    const showTabs = !!I.typeId || openCount || loadQueue().length;
    if (!I.typeId && I.tab !== 'queue') I.tab = loadQueue().length ? 'queue' : I.tab;
    let body;
    if (!I.typeId && I.tab !== 'queue') body = emptyHTML();
    else if (I.tab === 'setup') body = renderSetup();
    else if (I.tab === 'mats') body = renderMats();
    else if (I.tab === 'queue') body = renderQueue();
    else body = renderCompare();
    scr.innerHTML = `${headerHTML()}
      ${showTabs ? `<div class="segtabs four" role="tablist" aria-label="Invention views">${tabs.map(([k, l]) => `<button type="button" role="tab" data-itab="${k}" aria-selected="${I.tab === k}"${!I.typeId && k !== 'queue' ? ' disabled' : ''}>${l}${k === 'queue' && openCount ? ` <span class="tabcount">${openCount}</span>` : ''}</button>`).join('')}</div>` : ''}
      <section role="tabpanel">${body}</section>`;
  }

  /* =====================  Actions  ===================== */
  const rowNamed = name => (I.rows || []).find(r => r.dec.name === name);
  function queueRow(r) {
    const t1 = t2ToT1()[I.typeId];
    if (typeof Q.addInventionQueueBatch !== 'function') { toast('The invention queue didn’t load. Reload the page'); return; }
    Q.addInventionQueueBatch({
      t2BlueprintTypeId: r.t2Bp, t2ProductTypeId: I.typeId, t2ProductName: t2Name(I.typeId),
      t1BlueprintTypeId: t1.blueprintTypeID, t1BlueprintName: t1BpName(t1),
      decryptorName: r.dec.name, decryptorTypeId: r.did,
      resultME: r.resultME, resultTE: r.resultTE, resultRuns: r.resultRuns,
      targetBPCs: I.target, successChance: r.successChance,
      plannedRuns: fin(r.requiredRuns) ? r.requiredRuns : null,
      estimatedCost: fin(r.totalInventionCost) ? r.totalInventionCost : null,
      invMaterials: (t1.inventionMaterials || []).map(m => ({ typeId: m.typeId, name: m.name, qty: m.qty }))
    });
    toast(`${t2Name(I.typeId)} (${r.dec.name}) added to the invention queue`, { label: 'View', run: () => { I.tab = 'queue'; render(); } });
    render();
  }
  async function syncEve(silent) {
    if (!MB.isLoggedIn() || I.syncing || typeof Q.syncInventionQueueWithEve !== 'function') return;
    I.syncing = true;
    if (!silent && MB.screen() === 'inv') render();
    try { await Q.syncInventionQueueWithEve(!!silent); } catch (e) { console.warn('[Phone Invention] Sync failed:', e); if (!silent) toast('Couldn’t reach EVE. Try again in a moment'); }
    I.syncing = false;
    I.lastSync = Date.now();
    if (MB.screen() === 'inv') render();
  }
  function setNum(key, v) {
    if (!Number.isFinite(v)) return;
    if (key === 'target') { I.target = Math.min(9999, Math.max(1, Math.round(v))); saveState(); render(); schedule(); }
  }

  const scr = $('#screen-inv');
  scr.addEventListener('click', async e => {
    const t = e.target;
    let el;
    if ((el = t.closest('[data-itab]'))) { if (el.disabled) return; I.tab = el.dataset.itab; render(); scr.scrollTop = 0; if (I.tab === 'queue' && Date.now() - I.lastSync > 300000) syncEve(true); return; }
    if ((el = t.closest('[data-isort]'))) { I.sort = el.dataset.isort; render(); const again = scr.querySelector(`[data-isort="${I.sort}"]`); if (again) again.focus(); return; }
    if ((el = t.closest('[data-idec]'))) { const n = el.dataset.idec; I.open = I.open === n ? null : n; render(); const again = scr.querySelector(`[data-idec="${CSS.escape(n)}"]`); if (again) again.focus(); return; }
    if ((el = t.closest('[data-imats]'))) { I.matDec = el.dataset.imats; I.tab = 'mats'; render(); scr.scrollTop = 0; return; }
    if ((el = t.closest('[data-ibuild]'))) {
      const r = rowNamed(el.dataset.ibuild);
      if (r && r.t2Bp) MB.calc.openBlueprint({ bp: Number(r.t2Bp), runs: r.resultRuns, me: r.resultME, te: r.resultTE });
      return;
    }
    if ((el = t.closest('[data-iqueue]'))) { const r = rowNamed(el.dataset.iqueue); if (r) queueRow(r); return; }
    if ((el = t.closest('[data-qbuild]'))) {
      const b = loadQueue().find(x => x.id === el.dataset.qbuild);
      const best = b && Q.inventionBatchBestResult(b);
      if (b && best && b.t2BlueprintTypeId) MB.calc.openBlueprint({ bp: Number(b.t2BlueprintTypeId), runs: best.runs, me: best.me, te: best.te });
      return;
    }
    if ((el = t.closest('[data-qrm]'))) {
      const q = loadQueue();
      const i = q.findIndex(x => x.id === el.dataset.qrm);
      if (i === -1) return;
      const [b] = q.splice(i, 1);
      saveQueue(q);
      render();
      toast(`Removed ${b.t2ProductName} from the queue`, { label: 'Undo', run: () => { const now = loadQueue(); now.splice(Math.min(i, now.length), 0, b); saveQueue(now); render(); } });
      return;
    }
    if ((el = t.closest('[data-step]'))) {
      if (el.disabled) return;
      const key = el.dataset.step, d = Number(el.dataset.d);
      if (key === 'target') setNum('target', I.target + d);
      else if (key.startsWith('skill:')) {
        const id = key.slice(6);
        I.skills[id] = Math.min(5, Math.max(0, (I.skills[id] || 0) + d));
        saveState();
        render();
        schedule();
      }
      const again = scr.querySelector(`[data-step="${key}"][data-d="${d}"]`);
      if (again && !again.disabled) again.focus();
      return;
    }
    if ((el = t.closest('[data-iprice]'))) { prefs.priceMode = el.dataset.iprice; MB.savePrefs(); MB.syncShim(); saveState(); render(); schedule(0); return; }
    if ((el = t.closest('[data-item-inv]'))) { selectItem(Number(el.dataset.itemInv)); return; }
    if (!(el = t.closest('[data-iact]'))) return;
    if (el.disabled) return;
    const act = el.dataset.iact;
    if (act === 'pick') { MB.openSheet('invitems', el); return; }
    if (act === 'retry') { compute(); return; }
    if (act === 'login') { MB.openSheet('account', el); return; }
    if (act === 'stations') { MB.openSheet('stations', el); return; }
    if (act === 'sync') { syncEve(false); return; }
    if (act === 'myskills') {
      const t1 = t2ToT1()[I.typeId];
      (t1.inventionSkills || []).forEach(sk => { I.skills[sk.skillId] = trained(sk.skillId); });
      saveState();
      render();
      schedule(0);
      return;
    }
    if (act === 'copymats') {
      const r = rowNamed(I.matDec);
      if (!r) return;
      const deduct = prefs.deduct && MB.isLoggedIn();
      const lines = r.mats.map(m => ({ name: m.name, n: Math.max(0, m.need - (deduct ? MB.stockOf(m.typeId) : 0)) })).filter(x => x.n > 0).map(x => `${x.name} x${x.n}`);
      if (!lines.length) { toast('Nothing to buy, your stock covers it'); return; }
      const ok = await MB.copyText(lines.join('\n'));
      toast(ok ? `Copied ${lines.length} item${lines.length === 1 ? '' : 's'} for EVE's Multibuy` : 'Copy was blocked by the browser');
      return;
    }
    if (act === 'copyqueue') {
      const lines = queueBomRows().rows.filter(r => r.toBuy > 0).map(r => `${r.name} x${r.toBuy}`);
      if (!lines.length) { toast('Nothing to buy, your stock covers it'); return; }
      const ok = await MB.copyText(lines.join('\n'));
      toast(ok ? `Copied ${lines.length} item${lines.length === 1 ? '' : 's'} for EVE's Multibuy` : 'Copy was blocked by the browser');
    }
  });
  scr.addEventListener('change', e => {
    const t = e.target;
    if (t.id === 'i-matdec') { I.matDec = t.value; render(); const s = $('#i-matdec'); if (s) s.focus(); return; }
    if (t.id === 'i-base') {
      const v = MB.readPct(t, I.baseChance);
      if (v === null) return;
      I.baseChance = v;
      saveState();
      render();
      schedule(0);
      return;
    }
    if (t.dataset.inum) {
      const v = parseFloat(String(t.value).replace(/[,\s]/g, ''));
      if (Number.isFinite(v)) setNum(t.dataset.inum, v); else t.value = I.target;
    }
  });
  scr.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.target.id === 'i-base' || e.target.dataset.inum)) e.target.blur(); });

  /* =====================  Item picker  ===================== */
  let invQuery = '';
  function invItemRow(t2) {
    const t1 = t2ToT1()[t2];
    return `<li><button type="button" data-item-inv="${t2}" aria-current="${I.typeId === t2}">${iconHTML(t2)}<span><b>${esc(t2Name(t2))}</b><small>from ${esc(t1BpName(t1).replace(/ Blueprint$/i, ''))}</small></span><span class="r">${autoBaseChance(t2)}%</span></button></li>`;
  }
  function invResultsHTML(q) {
    const ql = String(q || '').toLowerCase().trim();
    if (ql.length < 2) {
      const recent = (prefs.invRecent || []).filter(id => t2ToT1()[id]);
      return recent.length ? `<li class="listhead">Recent</li>${recent.map(invItemRow).join('')}` : '<li class="note" style="padding:10px">Type at least two letters of the Tech II item you want, like “hobgoblin” or “wolf”.</li>';
    }
    const exact = [], starts = [], contains = [];
    for (const id of Object.keys(t2ToT1())) {
      const t2 = Number(id);
      const n = String(t2Name(t2)).toLowerCase();
      if (n === ql) exact.push(t2); else if (n.startsWith(ql)) starts.push(t2); else if (n.includes(ql)) contains.push(t2);
    }
    const byName = (a, b) => String(t2Name(a)).localeCompare(String(t2Name(b)));
    const hits = [...exact, ...starts.sort(byName), ...contains.sort(byName)].slice(0, 30);
    if (!hits.length) return `<li class="note" style="padding:10px">No Tech II item you can invent matches “${esc(ql)}”. Search what you want to make (Wolf), not what it's invented from (Rifter).</li>`;
    return hits.map(invItemRow).join('');
  }
  MB.SHEETS.invitems = {
    title: () => 'What do you want to invent?',
    html: () => `<div class="searchbox">${ICON.search}<input type="text" id="f-invq" placeholder="Search Tech II items" autocomplete="off" value="${esc(invQuery)}" aria-label="Search Tech II items"></div>
      <ul class="itemlist" id="inv-results">${invResultsHTML(invQuery)}</ul>`,
    input(e) { if (e.target.id === 'f-invq') { invQuery = e.target.value; $('#inv-results').innerHTML = invResultsHTML(invQuery); } },
    click(e) { const el = e.target.closest('[data-item-inv]'); if (el) { MB.closeSheet(); selectItem(Number(el.dataset.itemInv)); } }
  };

  /* =====================  Screen  ===================== */
  // Rerun only when something that changes the answer has changed (a station, fees, skills, prices).
  function refreshIfChanged() { if (I.typeId && signature() !== I.sig) schedule(); }
  window.addEventListener('mb:eiv-ready', refreshIfChanged);
  // The desktop Invention page (another tab) queued or synced something.
  window.addEventListener('storage', e => { if (e.key === 'eve_invention_queue_v1' && MB.screen() === 'inv') render(); });
  // Running attempts count down while the queue is on screen.
  setInterval(() => { if (MB.screen() === 'inv' && I.tab === 'queue' && loadQueue().some(b => b.attempts.some(a => a.status === 'in_progress'))) render(); }, 30000);

  MB.inv = { state: I, selectItem, compute };
  MB.screens.inv = {
    title: 'Invention',
    render,
    enter() {
      loadState();
      render();
      if (I.typeId && (!I.rows || signature() !== I.sig)) schedule(0);
      if (MB.isLoggedIn() && Date.now() - I.lastSync > 300000) syncEve(true);
    },
    always() { if (MB.screen() === 'inv') refreshIfChanged(); }
  };
})();
