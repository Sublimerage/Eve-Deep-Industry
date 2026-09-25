'use strict';

// Phone layout: the Ledger screen. Reads and writes the desktop Ledger's own saved queue and history
// (eve_ledger_jobs / eve_ledger_history) in exactly the same format, so a job added, started, split,
// combined or marked built on one shows up the same on the other. The rules here are ports of
// js/ledger.js (the desktop Ledger can't be loaded on this page, it's built around its own layout):
// stock allocation, prerequisite clusters, starting some of a job's runs, combining duplicates, run and
// station changes, "+ Build" for a material, and matching/importing your real EVE jobs.
(() => {
  const MB = window.MB;
  const { $, $$, esc, MINUS, compact, qty, dur, ICON, LS, toast, prefs } = MB;

  const L = { tab: 'queue', filter: 'all', open: new Set(), edit: new Map(), busy: new Set(), lastSync: 0, syncing: false };
  const collapsed = new Set(LS.get('eve_collapsed_job_clusters', []));
  const loadJobs = () => { const a = LS.get('eve_ledger_jobs', []); return Array.isArray(a) ? a.filter(Boolean) : []; };
  const saveJobs = jobs => LS.set('eve_ledger_jobs', jobs);
  const loadHistory = () => { const a = LS.get('eve_ledger_history', []); return Array.isArray(a) ? a.filter(Boolean) : []; };
  const saveHistory = h => LS.set('eve_ledger_history', h);
  // Time + random, like the desktop, but never an id already in the queue or history.
  function newId() {
    const taken = new Set([...loadJobs(), ...loadHistory()].map(j => j.id).concat([...issued]));
    let id = Date.now() + Math.floor(Math.random() * 1000);
    while (taken.has(id)) id++;
    issued.add(id);
    return id;
  }
  const issued = new Set();

  const isReady = j => !!(j.isStarted && j.startedAt && (Date.now() - j.startedAt) / 1000 >= (j.totalBuildSeconds || 0));
  const stateOf = j => (!j.isStarted ? 'planned' : isReady(j) ? 'ready' : 'building');
  const displayName = j => (window.TYPE_ID_TO_NAME && window.TYPE_ID_TO_NAME[j.productTypeId]) || String(j.name || '').replace(/ Blueprint$/i, '').replace(/ Reaction Formula$/i, '').replace(/ Formula$/i, '').trim();
  const runsText = j => ((j.jobCount || 1) > 1 ? `${qty(j.jobCount)} jobs × ${qty(j.runsPerJob || 1)} run${(j.runsPerJob || 1) === 1 ? '' : 's'}` : `${qty(j.runsNeeded)} run${j.runsNeeded === 1 ? '' : 's'}`);

  /* =====================  Stations on jobs (js/ledger.js)  ===================== */
  function liveSnapshot() {
    const s = MB.liveStation();
    return { systemId: s.systemId || null, systemName: s.systemName || null, facilityKey: s.facilityKey, rig1: s.rig1 || '', rig2: s.rig2 || '', rig3: s.rig3 || '' };
  }
  function stationLabel(snapshot) {
    if (!snapshot) return 'Unknown';
    const presets = MB.presets();
    const match = Object.keys(presets).find(name => {
      const p = presets[name];
      return p && p.systemId === snapshot.systemId && p.facilityKey === snapshot.facilityKey && (p.rig1 || '') === (snapshot.rig1 || '') && (p.rig2 || '') === (snapshot.rig2 || '') && (p.rig3 || '') === (snapshot.rig3 || '');
    });
    if (match) return match;
    const st = MB.STRUCT[snapshot.facilityKey];
    const n = [snapshot.rig1, snapshot.rig2, snapshot.rig3].filter(Boolean).length;
    return `${st ? st.shortLabel : snapshot.facilityKey || '?'}${snapshot.systemName ? ' in ' + MB.systemName(snapshot.systemId, snapshot.systemName) : ''}${n ? `, ${n} rig${n === 1 ? '' : 's'}` : ''}`;
  }
  const jobStation = j => (j.autoImported ? 'From EVE' : stationLabel(j.productionSnapshot || liveSnapshot()));
  function jobMeTe(j) {
    if (j.meLevel !== undefined || j.teLevel !== undefined) return { me: j.meLevel || 0, te: j.teLevel || 0 };
    const s = j.buildConfigSnapshot || {};
    return {
      me: s.customMEOverrides && s.customMEOverrides[j.typeId] !== undefined ? s.customMEOverrides[j.typeId] : 0,
      te: s.customTEOverrides && s.customTEOverrides[j.typeId] !== undefined ? s.customTEOverrides[j.typeId] : 0
    };
  }

  /* =====================  Stock (js/ledger.js renderJournalPage)  ===================== */
  function reflected(job) {
    const cur = window.getEsiAssetsExpiry ? window.getEsiAssetsExpiry() : null;
    if (cur === null) return false;
    const base = job.assetsExpiryAtStart !== undefined && job.assetsExpiryAtStart !== null ? job.assetsExpiryAtStart : job.startedAt;
    return base !== undefined && base !== null && cur > base;
  }
  function applyMats(job, pool, deduct, fromPool = true) {
    return (Array.isArray(job.materials) ? job.materials : []).filter(Boolean).map(mat => {
      const avail = deduct ? pool[mat.typeId] || 0 : 0;
      const used = Math.min(mat.qtyNeeded, avail);
      if (fromPool && deduct && pool[mat.typeId] !== undefined) pool[mat.typeId] = Math.max(0, pool[mat.typeId] - used);
      const missing = Math.max(0, mat.qtyNeeded - used);
      return { mat, used, missing, done: missing === 0 };
    });
  }
  function stillNeeded(jobs) {
    const supply = {}, demand = {};
    jobs.forEach(j => { if (j.productTypeId !== undefined) supply[j.productTypeId] = (supply[j.productTypeId] || 0) + (j.qtyNeeded || 0); });
    jobs.forEach(j => { if (!j.isStarted && Array.isArray(j.materials)) j.materials.forEach(m => { if (m && m.typeId) demand[m.typeId] = (demand[m.typeId] || 0) + (m.qtyNeeded || 0); }); });
    const out = {};
    Object.keys(demand).forEach(t => { const n = Math.max(0, demand[t] - (supply[t] || 0)); if (n > 0) out[t] = n; });
    return out;
  }
  // Started jobs claim stock first (they already happened), then the consolidated shopping list is
  // netted, then pending jobs claim what's left in queue order. Same order as the desktop.
  function allocate(jobs) {
    const deduct = prefs.deduct && MB.isLoggedIn();
    const pool = { ...(window.userStockMap || {}) };
    const info = new Map();
    jobs.filter(j => j.isStarted).forEach(j => info.set(j.id, applyMats(j, pool, deduct, !reflected(j))));
    const needed = stillNeeded(jobs);
    const bom = {};
    jobs.forEach(j => {
      if (j.isStarted || !Array.isArray(j.materials)) return;
      j.materials.forEach(m => {
        if (!m || !m.typeId || !needed[m.typeId] || bom[m.typeId]) return;
        bom[m.typeId] = { typeId: m.typeId, name: m.name, need: needed[m.typeId], unit: m.unitPrice || 0, strategy: m.strategy || 'sell' };
      });
    });
    const items = Object.values(bom).map(it => {
      const stock = deduct ? pool[it.typeId] || 0 : 0;
      const toBuy = Math.max(0, it.need - stock);
      const vol = (window.EVE_VOLUMES && window.EVE_VOLUMES[it.typeId]) || 0;
      return { ...it, have: stock, toBuy, cost: it.unit * toBuy, vol: vol * toBuy, cat: window.getItemCategory(it.typeId, it.name) };
    }).sort((a, b) => (b.toBuy > 0) - (a.toBuy > 0) || b.cost - a.cost);
    jobs.filter(j => !j.isStarted).forEach(j => info.set(j.id, applyMats(j, pool, deduct)));
    return { info, items };
  }
  // How much more of its own product a prerequisite needs to cover its own parent(s).
  function parentsOf(job, jobs) {
    if (Array.isArray(job.sharedParentIds) && job.sharedParentIds.length) return jobs.filter(j => job.sharedParentIds.includes(j.id));
    if (job.parentJobId !== undefined && job.parentJobId !== null) { const p = jobs.find(j => j.id === job.parentJobId); return p ? [p] : []; }
    if (job.parentJobName) return jobs.filter(j => j.id !== job.id && j.name === job.parentJobName);
    return [];
  }
  function shortfall(job, jobs) {
    if (!job.isSubBuild || job.isStarted || job.autoImported || job.productTypeId === undefined) return 0;
    const parents = parentsOf(job, jobs);
    if (!parents.length) return 0;
    let demand = 0;
    parents.forEach(p => (p.materials || []).forEach(m => { if (m && m.typeId === job.productTypeId) demand += m.qtyNeeded || 0; }));
    const stock = prefs.deduct && MB.isLoggedIn() ? (window.userStockMap || {})[job.productTypeId] || 0 : 0;
    return Math.max(0, Math.max(0, demand - stock) - (job.qtyNeeded || 0));
  }
  const yieldOf = typeId => ((window.getBatchYield ? window.getBatchYield(window.recipeMap && window.recipeMap[typeId], false) : 1) || 1);

  /* =====================  Rebuilding a job (js/ledger.js rebuildTreeForSnapshot)  ===================== */
  // Rebuilds a job's tree at its own station and build choices with the site's tree builder, and
  // always puts every borrowed global back afterwards.
  const rebuild = (...args) => MB.treeLock(() => rebuildNow(...args));
  async function rebuildNow(bpId, name, runs, productTypeId, snapshot, buildConfig, jobCount = 1) {
    const keys = ['eve_active_facility_key', 'eve_rig_slot_1', 'eve_rig_slot_2', 'eve_rig_slot_3'];
    const prevLS = keys.map(k => LS.raw(k));
    const prev = { sec: window.activeSystemSecurity, mfg: window.activeMfgSCI, react: window.activeReactSCI, inv: window.activeInventionSCI, b: window.buildSelfOverrides, m: window.customBuyModes, me: window.customMEOverrides, te: window.customTEOverrides };
    try {
      if (buildConfig) {
        window.buildSelfOverrides = { ...(buildConfig.buildSelfOverrides || {}) };
        window.customBuyModes = { ...(buildConfig.customBuyModes || {}) };
        window.customMEOverrides = { ...(buildConfig.customMEOverrides || {}) };
        window.customTEOverrides = { ...(buildConfig.customTEOverrides || {}) };
      }
      LS.set('eve_active_facility_key', snapshot.facilityKey || 'sotiyo');
      LS.set('eve_rig_slot_1', snapshot.rig1 || '');
      LS.set('eve_rig_slot_2', snapshot.rig2 || '');
      LS.set('eve_rig_slot_3', snapshot.rig3 || '');
      if (snapshot.systemId) {
        await MB.loadSecurity(snapshot.systemId);
        const info = MB.sysInfo(snapshot.systemId);
        window.activeMfgSCI = info.mfg; window.activeReactSCI = info.react; window.activeInventionSCI = info.inv; window.activeSystemSecurity = info.sec;
      }
      MB.syncShim();
      window.recipeTreeRootProductTypeId = productTypeId;
      let root;
      try { root = await window.buildRecursiveRecipeTree(bpId, name, runs, 0, 6, new Set(), null, jobCount); }
      finally { window.recipeTreeRootProductTypeId = null; }
      if (!root) throw new Error('Could not resolve a recipe tree.');
      root.runsNeeded = runs;
      root.qtyNeeded = runs * (root.batchYield || 1);
      root.jobCount = Math.max(1, jobCount || 1);
      window.scaleTreeQuantities(root, (window.getActiveStructureType().meBonus || 0) / 100);
      const ids = new Set();
      window.collectAllTypeIds(root, ids);
      await window.fetchMarketPrices([...ids]);
      window.calculateNodeEIV(root);
      return { root, calculatedCost: window.calculateTreeNodeCost(root), materials: window.extractJobMaterialsForNode(root), totalBuildSeconds: window.calculateTotalBuildSeconds(root) };
    } finally {
      keys.forEach((k, i) => { if (prevLS[i] === null) LS.remove(k); else LS.set(k, prevLS[i]); });
      window.activeSystemSecurity = prev.sec; window.activeMfgSCI = prev.mfg; window.activeReactSCI = prev.react; window.activeInventionSCI = prev.inv;
      window.buildSelfOverrides = prev.b; window.customBuyModes = prev.m; window.customMEOverrides = prev.me; window.customTEOverrides = prev.te;
    }
  }
  async function cascadeToChildren(parent, oldMaterials, jobs) {
    const kids = jobs.filter(j => j.isSubBuild && !j.isStarted && !j.autoImported && j.productTypeId &&
      (j.parentJobId !== undefined && j.parentJobId !== null ? j.parentJobId === parent.id : j.parentJobName === parent.name));
    const newMaterials = Array.isArray(parent.materials) ? parent.materials : [];
    for (const child of kids) {
      const oldMat = oldMaterials.find(m => m && m.typeId === child.productTypeId);
      const newMat = newMaterials.find(m => m && m.typeId === child.productTypeId);
      if (!oldMat || !newMat || !(oldMat.qtyNeeded > 0) || !(newMat.qtyNeeded > 0)) continue;
      if (Math.abs(newMat.qtyNeeded - oldMat.qtyNeeded) < 1e-6) continue;
      const runs = Math.max(1, Math.ceil(((child.qtyNeeded || 0) * newMat.qtyNeeded / oldMat.qtyNeeded) / yieldOf(child.typeId)));
      if (runs === child.runsNeeded) continue;
      const oldChild = Array.isArray(child.materials) ? child.materials : [];
      try {
        const r = await rebuild(child.typeId, child.name + ' Blueprint', runs, child.productTypeId, child.productionSnapshot || parent.productionSnapshot || liveSnapshot(), child.buildConfigSnapshot || parent.buildConfigSnapshot);
        child.runsNeeded = runs;
        child.qtyNeeded = r.root.qtyNeeded;
        child.calculatedCost = r.calculatedCost;
        child.materials = r.materials;
        child.totalBuildSeconds = r.totalBuildSeconds;
        await cascadeToChildren(child, oldChild, jobs);
      } catch (e) { console.warn('[Phone Ledger] Could not resize prerequisite', child.id, e); }
    }
  }

  /* =====================  Job actions  ===================== */
  async function withJob(id, label, fn) {
    if (L.busy.has(id)) return;
    L.busy.add(id);
    render();
    try { await fn(); }
    catch (e) { console.warn('[Phone Ledger]', label, e); toast(`Couldn't ${label}. Nothing was changed.`); }
    finally { L.busy.delete(id); render(); }
  }
  // Changes a planned job's jobs x runs with a real rebuild, then resizes its prerequisites.
  function setRuns(id, jobCount, runsPerJob) {
    return withJob(id, 'change the runs', async () => {
      const jobs = loadJobs();
      const job = jobs.find(j => j.id === id);
      if (!job || job.isStarted || job.autoImported) return;
      const runs = jobCount * runsPerJob;
      if (runs === job.runsNeeded && jobCount === (job.jobCount || 1)) return;
      const old = Array.isArray(job.materials) ? job.materials : [];
      const r = await rebuild(job.typeId, job.name + ' Blueprint', runs, job.productTypeId, job.productionSnapshot || liveSnapshot(), job.buildConfigSnapshot, jobCount);
      Object.assign(job, { runsNeeded: runs, jobCount, runsPerJob, qtyNeeded: r.root.qtyNeeded, calculatedCost: r.calculatedCost, materials: r.materials, totalBuildSeconds: r.totalBuildSeconds });
      if (job.netProfit !== undefined) job.netProfit = (job.unitSellPrice || 0) * job.qtyNeeded - job.calculatedCost;
      await cascadeToChildren(job, old, jobs);
      saveJobs(jobs);
      L.edit.delete(id);
      toast(`${displayName(job)} now ${runsText(job)}`);
    });
  }
  function setStation(id, presetName) {
    return withJob(id, 'change the station', async () => {
      const jobs = loadJobs();
      const job = jobs.find(j => j.id === id);
      const preset = MB.presets()[presetName];
      if (!job || job.autoImported || !preset) return;
      const r = await rebuild(job.typeId, job.name + ' Blueprint', job.runsNeeded, job.productTypeId, preset, job.buildConfigSnapshot, job.jobCount || 1);
      Object.assign(job, { calculatedCost: r.calculatedCost, qtyNeeded: r.root.qtyNeeded, materials: r.materials, totalBuildSeconds: r.totalBuildSeconds });
      if (job.netProfit !== undefined) job.netProfit = (job.unitSellPrice || 0) * job.qtyNeeded - job.calculatedCost;
      job.productionSnapshot = { systemId: preset.systemId || null, systemName: preset.systemName || null, facilityKey: preset.facilityKey || 'sotiyo', rig1: preset.rig1 || '', rig2: preset.rig2 || '', rig3: preset.rig3 || '' };
      saveJobs(jobs);
      toast(`${displayName(job)} now planned at “${presetName}”`);
    });
  }
  function topUp(id) {
    return withJob(id, 'top up this job', async () => {
      const jobs = loadJobs();
      const job = jobs.find(j => j.id === id);
      if (!job) return;
      const missing = shortfall(job, jobs);
      if (missing <= 0) return;
      const add = Math.ceil(missing / yieldOf(job.typeId));
      const jobCount = job.jobCount || 1;
      const runs = (job.runsNeeded || 0) + add;
      const old = Array.isArray(job.materials) ? job.materials : [];
      const r = await rebuild(job.typeId, job.name + ' Blueprint', runs, job.productTypeId, job.productionSnapshot || liveSnapshot(), job.buildConfigSnapshot, jobCount);
      Object.assign(job, { runsNeeded: runs, runsPerJob: Math.ceil(runs / jobCount), qtyNeeded: r.root.qtyNeeded, calculatedCost: r.calculatedCost, materials: r.materials, totalBuildSeconds: r.totalBuildSeconds });
      if (job.netProfit !== undefined) job.netProfit = (job.unitSellPrice || 0) * job.qtyNeeded - job.calculatedCost;
      await cascadeToChildren(job, old, jobs);
      saveJobs(jobs);
      toast(`${displayName(job)} now covers the missing ${qty(missing)}: ${runs} runs`);
    });
  }
  // Turns a material you're short of into its own prerequisite job, at the parent's station and choices.
  function buildMaterial(id, typeId, missingQty) {
    return withJob(id, 'queue that material', async () => {
      const jobs = loadJobs();
      const parent = jobs.find(j => j.id === id);
      const mat = parent && (parent.materials || []).find(m => m && m.typeId === typeId);
      if (!mat) return;
      if (jobs.some(j => j.productTypeId === typeId)) { toast(`${mat.name} is already queued as its own job`); return; }
      const target = missingQty != null ? Number(missingQty) : mat.qtyNeeded;
      if (target <= 0) return;
      const bpId = window.findBlueprintTypeIdForProduct(typeId) || window.resolveBlueprintIdFromProductName(mat.name);
      if (!bpId) { toast(`No blueprint found for ${mat.name}`); return; }
      const runs = Math.max(1, Math.ceil(target / yieldOf(bpId)));
      const snapshot = parent.productionSnapshot || liveSnapshot();
      const r = await rebuild(bpId, mat.name + ' Blueprint', runs, typeId, snapshot, parent.buildConfigSnapshot);
      const job = {
        id: newId(), typeId: bpId, productTypeId: typeId, name: r.root.productName || mat.name, runsNeeded: runs, qtyNeeded: r.root.qtyNeeded,
        calculatedCost: r.calculatedCost, totalBuildSeconds: r.totalBuildSeconds, materials: r.materials, isSubBuild: true,
        parentJobId: id, parentJobName: parent.name, productionSnapshot: snapshot, buildConfigSnapshot: parent.buildConfigSnapshot,
        scope: parent.scope, ownerCharId: parent.ownerCharId, corpId: parent.corpId, addedAt: new Date().toISOString()
      };
      const idx = jobs.findIndex(j => j.id === id);
      if (idx === -1) jobs.push(job); else jobs.splice(idx, 0, job);
      saveJobs(jobs);
      toast(`Added ${job.name} (${runs} run${runs === 1 ? '' : 's'}) to build first`);
    });
  }
  // js/ledger.js startJobRuns: all runs, or split into a started part and a still-planned part.
  function startJob(id, startRunsWanted) {
    const jobs = loadJobs();
    const i = jobs.findIndex(j => j.id === id);
    if (i === -1) return;
    const job = jobs[i];
    const total = job.runsNeeded || 1;
    const start = Math.max(1, Math.min(Number.isFinite(startRunsWanted) ? startRunsWanted : total, total));
    const stamp = window.getEsiAssetsExpiry ? window.getEsiAssetsExpiry() : null;
    if (start >= total) {
      Object.assign(job, { startedAt: Date.now(), isStarted: true, assetsExpiryAtStart: stamp });
      saveJobs(jobs);
      toast(`${displayName(job)} started, ${dur(job.totalBuildSeconds || 0)} to build`);
      render();
      return;
    }
    const ratio = start / total, restRatio = (total - start) / total;
    const started = [], rest = [];
    (job.materials || []).forEach(m => {
      const sq = Math.min(m.qtyNeeded, Math.ceil(m.qtyNeeded * ratio));
      const rq = Math.max(0, m.qtyNeeded - sq);
      const ss = Math.min(m.stockQty || 0, sq), rs = (m.stockQty || 0) - ss;
      started.push({ ...m, qtyNeeded: sq, stockQty: ss, netQtyNeeded: Math.max(0, sq - ss), lineCost: (m.unitPrice || 0) * Math.max(0, sq - ss) });
      rest.push({ ...m, qtyNeeded: rq, stockQty: rs, netQtyNeeded: Math.max(0, rq - rs), lineCost: (m.unitPrice || 0) * Math.max(0, rq - rs) });
    });
    const a = { ...job, id: newId(), runsNeeded: start, qtyNeeded: Math.round((job.qtyNeeded || 0) * ratio), calculatedCost: (job.calculatedCost || 0) * ratio, netProfit: job.netProfit !== undefined ? job.netProfit * ratio : undefined, totalBuildSeconds: (job.totalBuildSeconds || 0) * ratio, materials: started, startedAt: Date.now(), isStarted: true, assetsExpiryAtStart: stamp, splitFromId: job.id };
    const b = { ...job, id: newId(), runsNeeded: total - start, qtyNeeded: Math.round((job.qtyNeeded || 0) * restRatio), calculatedCost: (job.calculatedCost || 0) * restRatio, netProfit: job.netProfit !== undefined ? job.netProfit * restRatio : undefined, totalBuildSeconds: (job.totalBuildSeconds || 0) * restRatio, materials: rest, startedAt: undefined, isStarted: false, splitFromId: job.id };
    jobs.splice(i, 1, a, b);
    saveJobs(jobs);
    toast(`Started ${start} of ${total} runs of ${displayName(job)}. The other ${total - start} stay planned.`);
    render();
  }
  function historyRecord(job) {
    return {
      id: job.id, typeId: job.typeId, productTypeId: job.productTypeId, name: job.name, runsNeeded: job.runsNeeded, qtyNeeded: job.qtyNeeded,
      calculatedCost: job.calculatedCost, netProfit: job.netProfit, isSubBuild: job.isSubBuild, parentJobId: job.parentJobId, parentJobName: job.parentJobName,
      autoImported: job.autoImported, materials: job.materials, eveJobId: job.eveJobId, baseTime: job.baseTime, totalBuildSeconds: job.totalBuildSeconds,
      productionSnapshot: job.productionSnapshot, buildConfigSnapshot: job.buildConfigSnapshot, scope: job.scope, ownerCharId: job.ownerCharId, corpId: job.corpId,
      completedAt: new Date().toISOString()
    };
  }
  function markBuilt(ids) {
    const jobs = loadJobs();
    const history = loadHistory();
    const done = jobs.filter(j => ids.includes(j.id));
    done.forEach(j => history.unshift(historyRecord(j)));
    saveHistory(history);
    saveJobs(jobs.filter(j => !ids.includes(j.id)));
    done.forEach(j => L.open.delete(j.id));
    return done;
  }
  // js/ledger.js deleteJobFromQueue: the job and every prerequisite under it, with Undo.
  function removeJob(id) {
    let jobs = loadJobs();
    const job = jobs.find(j => j.id === id);
    if (!job) return;
    const gone = new Set([id]);
    let more = true;
    while (more) {
      more = false;
      jobs.forEach(j => {
        if (gone.has(j.id) || !j.isSubBuild) return;
        const under = j.parentJobId !== undefined && j.parentJobId !== null ? gone.has(j.parentJobId) : [...gone].some(g => (jobs.find(x => x.id === g) || {}).name === j.parentJobName);
        if (under) { gone.add(j.id); more = true; }
      });
    }
    const removed = jobs.map((j, i) => ({ j, i })).filter(({ j }) => gone.has(j.id));
    const scrubbed = [];
    jobs.forEach(j => {
      if (gone.has(j.id) || !Array.isArray(j.sharedParentIds) || !j.sharedParentIds.length) return;
      const left = j.sharedParentIds.filter(p => !gone.has(p));
      if (left.length === j.sharedParentIds.length) return;
      scrubbed.push({ id: j.id, shared: j.sharedParentIds, pid: j.parentJobId, pname: j.parentJobName });
      if (left.length >= 2) j.sharedParentIds = left;
      else if (left.length === 1) { const sole = jobs.find(x => x.id === left[0]); j.parentJobId = left[0]; j.parentJobName = sole ? sole.name : j.parentJobName; delete j.sharedParentIds; }
      else j.sharedParentIds = [];
    });
    jobs = jobs.filter(j => !gone.has(j.id));
    saveJobs(jobs);
    render();
    const n = removed.length - 1;
    toast(n ? `Removed ${displayName(job)} and ${n} part${n === 1 ? '' : 's'} to build first` : `Removed ${displayName(job)}`, {
      label: 'Undo',
      run: () => {
        const now = loadJobs();
        removed.forEach(({ j, i }) => now.splice(Math.min(i, now.length), 0, j));
        scrubbed.forEach(s => { const x = now.find(y => y.id === s.id); if (x) { x.sharedParentIds = s.shared; x.parentJobId = s.pid; x.parentJobName = s.pname; } });
        saveJobs(now);
        render();
      }
    });
  }

  /* ---------- Combining duplicates (js/ledger.js combineDuplicateJobs) ---------- */
  function mergeJobs(group) {
    const mats = {};
    group.forEach(j => (j.materials || []).forEach(m => {
      if (!m) return;
      if (!mats[m.typeId]) mats[m.typeId] = { ...m, qtyNeeded: 0, stockQty: 0, netQtyNeeded: 0, lineCost: 0 };
      mats[m.typeId].qtyNeeded += m.qtyNeeded || 0;
      mats[m.typeId].stockQty += m.stockQty || 0;
      mats[m.typeId].netQtyNeeded += m.netQtyNeeded || 0;
      mats[m.typeId].lineCost += m.lineCost || 0;
    }));
    const first = group[0];
    const runs = group.reduce((s, j) => s + (j.runsNeeded || 0), 0);
    const sizes = new Set(group.filter(j => (j.jobCount || 1) > 1 && (j.runsPerJob || 0) > 0).map(j => j.runsPerJob));
    let multi = {};
    if (sizes.size === 1) { const rpj = [...sizes][0]; multi = { jobCount: Math.max(1, Math.round(runs / rpj)), runsPerJob: rpj }; }
    else if (sizes.size > 1) multi = { jobCount: 1, runsPerJob: undefined };
    return {
      ...first, runsNeeded: runs,
      qtyNeeded: group.reduce((s, j) => s + (j.qtyNeeded || 0), 0),
      calculatedCost: group.reduce((s, j) => s + (j.calculatedCost || 0), 0),
      netProfit: group.every(j => j.netProfit !== undefined) ? group.reduce((s, j) => s + j.netProfit, 0) : undefined,
      totalBuildSeconds: group.reduce((s, j) => s + (j.totalBuildSeconds || 0), 0),
      materials: Object.values(mats),
      addedAt: group.reduce((e, j) => (j.addedAt && j.addedAt < e ? j.addedAt : e), first.addedAt),
      ...multi
    };
  }
  function repoint(queue, absorbed, survivor) {
    if (!absorbed.size) return;
    queue.forEach(j => { if (j.isSubBuild && j.parentJobId != null && absorbed.has(j.parentJobId)) { j.parentJobId = survivor.id; j.parentJobName = survivor.name; } });
  }
  function mergePass(jobs, keyOf, after) {
    const groups = {}, order = [];
    jobs.forEach(j => {
      const key = keyOf(j);
      if (key === null) { order.push({ key: null, j }); return; }
      (groups[key] = groups[key] || []).push(j);
      order.push({ key, j });
    });
    const merged = {};
    let gone = 0;
    Object.entries(groups).forEach(([k, g]) => { if (g.length > 1) { gone += g.length - 1; merged[k] = after(mergeJobs(g), g); } });
    if (!gone) return { jobs, gone: 0 };
    const out = [], emitted = new Set();
    order.forEach(({ key, j }) => {
      if (key === null || !merged[key]) { out.push(j); return; }
      if (!emitted.has(key)) { out.push(merged[key]); emitted.add(key); }
    });
    Object.entries(groups).forEach(([k, g]) => {
      if (g.length < 2) return;
      const absorbed = new Set(g.map(j => j.id));
      absorbed.delete(merged[k].id);
      repoint(out, absorbed, merged[k]);
    });
    return { jobs: out, gone };
  }
  const perJobKey = j => ((j.jobCount || 1) > 1 ? (j.runsPerJob || '') : '');
  const tightKey = j => {
    if (j.isStarted) return null;
    const parent = j.isSubBuild ? (j.parentJobId != null ? `id:${j.parentJobId}` : `name:${j.parentJobName || ''}`) : '';
    const mt = jobMeTe(j);
    return [j.productTypeId || j.typeId, j.isSubBuild ? 'sub' : 'final', parent, j.sellStrategy || '', mt.me, mt.te, j.scope || '', j.ownerCharId || '', j.corpId || '', perJobKey(j)].join('|');
  };
  const poolKey = j => {
    if (j.isStarted || !j.isSubBuild) return null;
    const mt = jobMeTe(j);
    return [j.productTypeId || j.typeId, j.sellStrategy || '', mt.me, mt.te, j.scope || '', j.ownerCharId || '', j.corpId || '', perJobKey(j)].join('|');
  };
  function combine() {
    let jobs = loadJobs();
    let total = 0;
    for (let round = 0; round < 12; round++) {
      let tight = 0, r;
      while ((r = mergePass(jobs, tightKey, m => m)).gone > 0) { jobs = r.jobs; tight += r.gone; }
      const pooled = mergePass(jobs, poolKey, (m, g) => {
        const ids = new Set();
        g.forEach(j => { if (Array.isArray(j.sharedParentIds) && j.sharedParentIds.length) j.sharedParentIds.forEach(x => ids.add(x)); else if (j.parentJobId != null) ids.add(j.parentJobId); });
        m.parentJobId = null; m.parentJobName = null; m.sharedParentIds = [...ids];
        return m;
      });
      jobs = pooled.jobs;
      total += tight + pooled.gone;
      if (!tight && !pooled.gone) break;
    }
    saveJobs(jobs);
    render();
    toast(total ? `Combined ${total} duplicate job${total === 1 ? '' : 's'}` : 'Nothing to combine. Jobs only combine when item, ME/TE, what they\'re for, sell setting and character all match, and neither has started.');
  }

  /* ---------- Your real EVE jobs (js/ledger.js syncWithEveIndustryJobs) ---------- */
  const importJob = (rj, bpMeTe) => MB.treeLock(() => importJobNow(rj, bpMeTe));
  async function importJobNow(rj, bpMeTe) {
    const bpId = rj.blueprint_type_id, pt = rj.product_type_id, runs = rj.runs;
    const info = bpMeTe[rj.blueprint_id] || { me: 0, te: 0 };
    const prev = { me: window.customMEOverrides, te: window.customTEOverrides, b: window.buildSelfOverrides, m: window.customBuyModes };
    try {
      window.customMEOverrides = { [bpId]: info.me };
      window.customTEOverrides = { [bpId]: info.te };
      window.buildSelfOverrides = {};
      window.customBuyModes = {};
      MB.syncShim();
      MB.setStationGlobals();
      window.recipeTreeRootProductTypeId = pt;
      const name = MB.nameOf(pt);
      const isReaction = rj.activity_id === 9 || rj.activity_id === 11;
      let root;
      try { root = await window.buildRecursiveRecipeTree(bpId, name + (isReaction ? ' Reaction Formula' : ' Blueprint'), runs, 0, 6, new Set(), null); }
      finally { window.recipeTreeRootProductTypeId = null; }
      if (!root) return null;
      root.runsNeeded = runs;
      root.qtyNeeded = runs * (root.batchYield || 1);
      window.scaleTreeQuantities(root, (window.getActiveStructureType().meBonus || 0) / 100);
      const ids = new Set();
      window.collectAllTypeIds(root, ids);
      await window.fetchMarketPrices([...ids]);
      window.calculateNodeEIV(root);
      const total = window.calculateTreeNodeCost(root) + (rj.cost || 0);
      const sell = (window.priceCache[pt] || { sell: 0 }).sell;
      const rec = MB.activeChar() || {};
      const scope = rj._source === 'corp' ? 'corp' : 'personal';
      return {
        id: newId(), typeId: bpId, productTypeId: pt, name, runsNeeded: runs, qtyNeeded: root.qtyNeeded, calculatedCost: total,
        totalBuildSeconds: Math.max(0, (new Date(rj.end_date).getTime() - new Date(rj.start_date).getTime()) / 1000),
        netProfit: sell * root.qtyNeeded - total, sellStrategy: 'market-sell', unitSellPrice: sell, materials: window.extractJobMaterialsForNode(root),
        isStarted: true, assetsExpiryAtStart: window.getEsiAssetsExpiry ? window.getEsiAssetsExpiry() : null, startedAt: new Date(rj.start_date).getTime(),
        eveJobId: rj.job_id, autoImported: true, meLevel: info.me, teLevel: info.te, scope,
        ownerCharId: rj.installer_id !== undefined ? String(rj.installer_id) : rec.charId || null, corpId: scope === 'corp' ? rec.corpId : undefined,
        addedAt: new Date().toISOString()
      };
    } catch (e) {
      console.warn('[Phone Ledger] Import failed for EVE job', rj.job_id, e);
      return null;
    } finally {
      window.customMEOverrides = prev.me; window.customTEOverrides = prev.te; window.buildSelfOverrides = prev.b; window.customBuyModes = prev.m;
    }
  }
  async function syncEve(silent) {
    if (!MB.isLoggedIn() || L.syncing) return;
    L.syncing = true;
    if (!silent) render();
    try {
      const [charJobs, corpJobs, charBps, corpBps] = await Promise.all([window.fetchActiveIndustryJobs(), window.fetchActiveCorpIndustryJobs(), window.fetchCharacterBlueprints(), window.fetchCorpBlueprints()]);
      if (!charJobs && (!corpJobs || !corpJobs.length)) {
        if (!silent) toast('Could not read your EVE jobs. If you logged in a long time ago, log out and in again to grant job access.');
        return;
      }
      (charJobs || []).forEach(j => { if (j) j._source = 'personal'; });
      (corpJobs || []).forEach(j => { if (j) j._source = 'corp'; });
      const seen = new Set();
      const real = [...(charJobs || []), ...(corpJobs || [])].filter(j => j && !seen.has(j.job_id) && seen.add(j.job_id))
        .filter(j => j.status === 'active' && (j.activity_id === 1 || j.activity_id === 9 || j.activity_id === 11));
      const bpMeTe = {};
      [...(charBps || []), ...(corpBps || [])].forEach(bp => { if (bp && bp.item_id !== undefined) bpMeTe[bp.item_id] = { me: bp.material_efficiency || 0, te: bp.time_efficiency || 0 }; });
      const me = MB.activeChar();
      if (window.getRegisteredCharactersInActiveCorp) {
        const mates = window.getRegisteredCharactersInActiveCorp().filter(c => me && c.charId !== me.charId);
        const lists = await Promise.all(mates.map(c => window.fetchCharacterBlueprints(c.charId, c.accessToken)));
        lists.forEach(bps => (bps || []).forEach(bp => { if (bp && bp.item_id !== undefined && bpMeTe[bp.item_id] === undefined) bpMeTe[bp.item_id] = { me: bp.material_efficiency || 0, te: bp.time_efficiency || 0 }; }));
      }
      let jobs = loadJobs();
      const startIds = new Set(jobs.map(j => j.id));
      const history = loadHistory();
      jobs.forEach(job => {
        if (!job.isStarted || job.eveJobId === undefined || job.scope) return;
        const rj = real.find(r => r.job_id === job.eveJobId);
        if (!rj) return;
        job.scope = rj._source === 'corp' ? 'corp' : 'personal';
        job.corpId = rj._source === 'corp' && me ? me.corpId : undefined;
        if (rj.installer_id !== undefined) job.ownerCharId = String(rj.installer_id);
      });
      const tracked = new Set([...jobs.filter(j => j.isStarted && j.eveJobId !== undefined).map(j => j.eveJobId), ...history.filter(r => r.eveJobId !== undefined).map(r => r.eveJobId)]);
      const untracked = real.filter(r => !tracked.has(r.job_id));
      const used = new Set();
      let matched = 0, imported = 0;
      untracked.forEach(rj => {
        const bp = bpMeTe[rj.blueprint_id] || { me: 0, te: 0 };
        const cand = jobs.filter(j => {
          if (j.isStarted || (j.productTypeId || j.typeId) !== rj.product_type_id || j.runsNeeded < rj.runs) return false;
          const mt = jobMeTe(j);
          return mt.me === bp.me && mt.te === bp.te;
        }).sort((a, b) => a.runsNeeded - b.runsNeeded)[0];
        if (!cand) return;
        used.add(rj.job_id);
        matched++;
        const idx = jobs.findIndex(j => j.id === cand.id);
        const startedAt = new Date(rj.start_date).getTime();
        const secs = Math.max(0, (new Date(rj.end_date).getTime() - startedAt) / 1000);
        cand.scope = rj._source === 'corp' ? 'corp' : 'personal';
        cand.corpId = rj._source === 'corp' && me ? me.corpId : undefined;
        if (rj.installer_id !== undefined) cand.ownerCharId = String(rj.installer_id);
        const stamp = window.getEsiAssetsExpiry ? window.getEsiAssetsExpiry() : null;
        if (rj.runs >= cand.runsNeeded) {
          Object.assign(jobs[idx], { isStarted: true, assetsExpiryAtStart: stamp, startedAt, totalBuildSeconds: secs, eveJobId: rj.job_id });
          return;
        }
        const total = cand.runsNeeded, start = rj.runs, ratio = start / total, rest = total - start, restRatio = rest / total;
        const perJob = cand.runsPerJob || cand.runsNeeded;
        const sm = [], rm = [];
        (cand.materials || []).forEach(m => {
          const sq = Math.min(m.qtyNeeded, Math.ceil(m.qtyNeeded * ratio)), rq = Math.max(0, m.qtyNeeded - sq);
          const ss = Math.min(m.stockQty || 0, sq), rs = (m.stockQty || 0) - ss;
          sm.push({ ...m, qtyNeeded: sq, stockQty: ss, netQtyNeeded: Math.max(0, sq - ss), lineCost: (m.unitPrice || 0) * Math.max(0, sq - ss) });
          rm.push({ ...m, qtyNeeded: rq, stockQty: rs, netQtyNeeded: Math.max(0, rq - rs), lineCost: (m.unitPrice || 0) * Math.max(0, rq - rs) });
        });
        jobs.splice(idx, 1,
          { ...cand, id: newId(), runsNeeded: start, jobCount: perJob > 0 ? Math.max(1, Math.round(start / perJob)) : 1, runsPerJob: perJob, qtyNeeded: Math.round((cand.qtyNeeded || 0) * ratio), calculatedCost: (cand.calculatedCost || 0) * ratio, netProfit: cand.netProfit !== undefined ? cand.netProfit * ratio : undefined, totalBuildSeconds: secs, materials: sm, startedAt, isStarted: true, assetsExpiryAtStart: stamp, eveJobId: rj.job_id, splitFromId: cand.id },
          { ...cand, id: newId(), runsNeeded: rest, jobCount: perJob > 0 ? Math.max(0, Math.round(rest / perJob)) : 0, runsPerJob: perJob, qtyNeeded: Math.round((cand.qtyNeeded || 0) * restRatio), calculatedCost: (cand.calculatedCost || 0) * restRatio, netProfit: cand.netProfit !== undefined ? cand.netProfit * restRatio : undefined, totalBuildSeconds: (cand.totalBuildSeconds || 0) * restRatio, materials: rm, startedAt: undefined, isStarted: false, splitFromId: cand.id });
      });
      for (const rj of untracked) {
        if (used.has(rj.job_id)) continue;
        const job = await importJob(rj, bpMeTe);
        if (job) { jobs.push(job); imported++; }
      }
      // Keep anything added while EVE was being asked (e.g. from the Calculator in another tab).
      loadJobs().forEach(j => { if (!startIds.has(j.id) && !jobs.some(x => x.id === j.id)) jobs.push(j); });
      saveJobs(jobs);
      L.lastSync = Date.now();
      if (!silent) toast(matched || imported ? `Synced with EVE: ${matched} planned job${matched === 1 ? '' : 's'} matched, ${imported} imported` : 'Up to date with EVE. No new jobs to match or import.');
    } catch (e) {
      console.warn('[Phone Ledger] Sync failed:', e);
      if (!silent) toast('Could not sync with EVE. Check your connection and try again.');
    } finally {
      L.syncing = false;
      render();
    }
  }

  /* ---------- Notifications ---------- */
  const notifyOn = () => LS.raw('eve_job_notifications') === 'true' && typeof Notification !== 'undefined' && Notification.permission === 'granted';
  async function toggleNotify() {
    if (typeof Notification === 'undefined') { toast('This browser can\'t show notifications'); return; }
    if (notifyOn()) { LS.set('eve_job_notifications', 'false'); render(); toast('Job-ready notifications off'); return; }
    const p = await Notification.requestPermission();
    LS.set('eve_job_notifications', p === 'granted' ? 'true' : 'false');
    render();
    toast(p === 'granted' ? 'You\'ll get a notification when a job is ready' : 'Notifications weren\'t allowed');
  }
  const seenReady = new Set(loadJobs().filter(isReady).map(j => j.id));
  function tick() {
    loadJobs().forEach(j => {
      if (!isReady(j) || seenReady.has(j.id)) return;
      seenReady.add(j.id);
      if (notifyOn()) { try { const n = new Notification('Job ready to collect', { body: `${displayName(j)} has finished building.`, tag: 'eve-job-ready-' + j.id }); n.onclick = () => { window.focus(); n.close(); }; } catch (e) { /* ignore */ } }
    });
    updateBadge();
    if (MB.screen() === 'ledger' && L.tab === 'queue' && !document.activeElement.closest('#screen-ledger input, #screen-ledger select')) render();
  }
  setInterval(tick, 20000);

  function updateBadge() {
    const b = $('#ledger-badge');
    const jobs = loadJobs();
    b.hidden = !jobs.length;
    b.textContent = jobs.length;
    b.classList.toggle('ready', jobs.some(isReady));
  }
  MB.updateLedgerBadge = updateBadge;

  /* =====================  Rendering  ===================== */
  function clusters(jobs) {
    const byId = new Map(jobs.map(j => [j.id, j]));
    const firstByName = new Map();
    jobs.forEach(j => { if (!firstByName.has(j.name)) firstByName.set(j.name, j); });
    const kids = new Map(), roots = [];
    jobs.forEach(j => {
      let pid = null;
      if (j.isSubBuild && j.parentJobId != null && byId.has(j.parentJobId)) pid = j.parentJobId;
      else if (j.isSubBuild && !j.parentJobId && j.parentJobName && firstByName.has(j.parentJobName)) pid = firstByName.get(j.parentJobName).id;
      if (pid !== null && pid !== j.id) { if (!kids.has(pid)) kids.set(pid, []); kids.get(pid).push(j); } else roots.push(j);
    });
    return { roots, kids };
  }
  const f = () => MB.feeFrac();
  function jobCardHTML(job, all, info, kidsOf, depth) {
    const state = stateOf(job);
    const open = L.open.has(job.id);
    const busy = L.busy.has(job.id);
    const kids = kidsOf.get(job.id) || [];
    const secs = job.totalBuildSeconds || 0;
    const left = job.isStarted ? Math.max(0, secs - (Date.now() - job.startedAt) / 1000) : secs;
    const pct = job.isStarted && secs > 0 ? Math.min(100, Math.max(2, (1 - left / secs) * 100)) : 0;
    const label = state === 'planned' ? 'Planned' : state === 'building' ? 'Building' : 'Ready';
    const right = state === 'planned' ? (secs ? `${dur(secs)} build` : 'no time data') : state === 'building' ? `${dur(left)} left` : 'Done';
    const pAmount = job.netProfit;
    const money = job.isSubBuild || pAmount === undefined
      ? `<span class="job-profit">${compact(job.calculatedCost || 0)}</span>`
      : `<span class="job-profit ${pAmount >= 0 ? 'pos' : 'neg'}">${compact(pAmount, true)}</span>`;
    const tags = [
      job.autoImported ? '<span class="spill src">From EVE</span>' : '',
      job.isSubBuild ? `<span class="spill planned" title="Part for ${esc(job.sharedParentIds && job.sharedParentIds.length > 1 ? `${job.sharedParentIds.length} jobs` : job.parentJobName || 'another job')}">${ICON.box}part${job.sharedParentIds && job.sharedParentIds.length > 1 ? ` ×${job.sharedParentIds.length}` : ''}</span>` : ''
    ].join('');
    const owner = job.ownerCharId ? `<img class="owner" src="${MB.portrait(job.ownerCharId, 32)}" alt="" title="${esc(job.scope === 'corp' ? 'Corp job' : 'Planned for a character')}" onerror="this.remove()">` : '';
    const id = 'job-' + job.id;
    const kidsHTML = kids.length && !collapsed.has(job.id) ? `<ul class="job-kids">${kids.map(k => jobCardHTML(k, all, info, kidsOf, depth + 1)).join('')}</ul>` : '';
    return `<li class="job${state === 'ready' ? ' is-ready' : ''}${job.isSubBuild ? ' is-part' : ''}">
      <button class="job-head" type="button" data-job="${job.id}" aria-expanded="${open}" aria-controls="${id}">
        ${MB.iconHTML(job.productTypeId || job.typeId)}
        <span><span class="job-name">${esc(displayName(job))}${owner}</span><span class="job-meta"><span class="spill ${state}">${label}</span>${runsText(job)} · ${esc(jobStation(job))}${tags}</span></span>
        <span class="job-right">${busy ? '<span class="spin" aria-hidden="true"></span>' : money}<span class="dec-rate">${right}</span></span>
      </button>
      ${state === 'building' ? `<div class="bar" role="progressbar" aria-label="${esc(displayName(job))} progress" aria-valuenow="${Math.round(pct)}" aria-valuemin="0" aria-valuemax="100"><span style="width:${pct}%"></span></div>` : ''}
      <div class="job-body" id="${id}"${open ? '' : ' hidden'}>${open ? jobBodyHTML(job, all, info) : ''}</div>
      ${kids.length ? `<button class="kidtoggle" type="button" data-kids="${job.id}" aria-expanded="${!collapsed.has(job.id)}">${collapsed.has(job.id) ? ICON.chev : ICON.down}${kids.length} part${kids.length === 1 ? '' : 's'} to build first</button>` : ''}
      ${kidsHTML}
    </li>`;
  }
  function jobBodyHTML(job, all, info) {
    const state = stateOf(job);
    const busy = L.busy.has(job.id);
    const mt = jobMeTe(job);
    const q = job.qtyNeeded || 0;
    const fr = f();
    const breakEven = q > 0 ? (job.sellStrategy === 'custom-contract' ? ((job.calculatedCost || 0) + 10000) / (q * (1 - fr.contractTax - fr.contractBroker)) : (job.calculatedCost || 0) / (q * (1 - fr.salesTax - fr.brokerFee))) : 0;
    const secs = job.totalBuildSeconds || 0;
    const perHour = job.netProfit !== undefined && secs > 0 ? job.netProfit / (secs / 3600) : null;
    const facts = `<dl class="facts">
        <div><dt>Build cost</dt><dd>${compact(job.calculatedCost || 0)}</dd></div>
        <div><dt>${job.isSubBuild ? 'Makes' : 'Profit'}</dt><dd>${job.isSubBuild ? `${qty(q)} units` : job.netProfit !== undefined ? `<span class="${job.netProfit >= 0 ? 'pos' : 'neg'}">${compact(job.netProfit, true)}</span>` : '—'}</dd></div>
        <div><dt>Build time</dt><dd>${secs ? dur(secs) : 'no data'}</dd></div>
        <div><dt>${job.isSubBuild ? 'ME · TE' : 'Break-even'}</dt><dd>${job.isSubBuild ? `${mt.me} · ${mt.te}` : q ? `${compact(breakEven)} each` : '—'}</dd></div>
        ${perHour !== null ? `<div><dt>ISK/hour</dt><dd>${compact(perHour, true)}</dd></div>` : ''}
        ${!job.isSubBuild ? `<div><dt>ME · TE</dt><dd>${mt.me} · ${mt.te}</dd></div>` : ''}
      </dl>`;
    const list = info.get(job.id) || [];
    const need = shortfall(job, all);
    const topUpRuns = need > 0 ? Math.ceil(need / yieldOf(job.typeId)) : 0;
    const mats = list.length ? `<div class="card-title" style="margin-top:4px">Materials</div><ul class="matlist">${list.map(({ mat, missing, done }) => {
      const queued = done ? null : all.find(j => j.productTypeId === mat.typeId);
      const canBuild = !done && !queued && !job.isStarted && (window.findBlueprintTypeIdForProduct(mat.typeId) || window.resolveBlueprintIdFromProductName(mat.name));
      const act = done ? '' : queued ? `<span class="mat-tag">${queued.isStarted ? 'building' : `${ICON.check}queued`}</span>` : canBuild ? `<button class="minibtn wide" type="button" data-jact="buildmat" data-id="${job.id}" data-type="${mat.typeId}" data-missing="${missing}"${busy ? ' disabled' : ''}>+ Build</button>` : '';
      return `<li class="${done ? 'done' : ''}">${MB.iconHTML(mat.typeId, 'sm')}<span class="n">${esc(mat.name)}</span><span class="v">${done ? `${ICON.check}${qty(mat.qtyNeeded)}` : `×${qty(mat.qtyNeeded)}${missing < mat.qtyNeeded ? ` · short ${qty(missing)}` : ''}`}</span>${act}</li>`;
    }).join('')}</ul>` : '<p class="note">No materials recorded for this job.</p>';
    let controls = '';
    if (state === 'planned') {
      // A single job's runs are its total; only a real multi-job plan has a per-job size.
      const e = L.edit.get(job.id) || { jobs: job.jobCount || 1, runs: (job.jobCount || 1) > 1 ? (job.runsPerJob || Math.ceil(job.runsNeeded / job.jobCount)) : job.runsNeeded, start: job.runsNeeded };
      L.edit.set(job.id, e);
      const presets = Object.keys(MB.presets()).sort();
      controls = `
        ${!job.autoImported ? `<div class="row-edit"><span class="k">Jobs × runs</span>${MB.stepper('jj:' + job.id, e.jobs, 1, 1000, 'jobs')}<span class="times">×</span>${MB.stepper('jr:' + job.id, e.runs, 1, 100000, 'runs per job')}</div>
        ${e.jobs * e.runs !== job.runsNeeded || e.jobs !== (job.jobCount || 1) ? `<button class="btn" type="button" data-jact="runs" data-id="${job.id}"${busy ? ' disabled' : ''}>${ICON.refresh}Recalculate for ${e.jobs > 1 ? `${e.jobs} × ${e.runs}` : e.runs} run${e.jobs * e.runs === 1 ? '' : 's'}</button>` : ''}
        <div class="row-edit"><label class="k" for="jst-${job.id}">Station</label><select id="jst-${job.id}" data-jst="${job.id}"${presets.length && !busy ? '' : ' disabled'}><option value="" selected>${esc(jobStation(job))}</option>${presets.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('')}</select></div>` : ''}
        ${topUpRuns ? `<button class="btn" type="button" data-jact="topup" data-id="${job.id}"${busy ? ' disabled' : ''}>${ICON.plus}Add ${topUpRuns} run${topUpRuns === 1 ? '' : 's'} to cover what's still needed</button>` : ''}
        ${job.runsNeeded > 1 ? `<div class="row-edit"><span class="k">Runs to start</span>${MB.stepper('js:' + job.id, Math.min(e.start, job.runsNeeded), 1, job.runsNeeded, 'runs to start')}</div>` : ''}`;
    }
    const actions = state === 'planned'
      ? `<button class="btn primary" type="button" data-jact="start" data-id="${job.id}"${busy ? ' disabled' : ''}>${ICON.play}Start${job.runsNeeded > 1 && (L.edit.get(job.id) || {}).start < job.runsNeeded ? ` ${(L.edit.get(job.id) || {}).start} run${(L.edit.get(job.id) || {}).start === 1 ? '' : 's'}` : ' job'}</button>
         <button class="btn" type="button" data-jact="copy" data-id="${job.id}">${ICON.copy}Multibuy</button>
         <button class="btn wide" type="button" data-jact="delete" data-id="${job.id}">${ICON.trash}Remove from queue</button>`
      : `<button class="btn ${state === 'ready' ? 'primary' : ''}" type="button" data-jact="built" data-id="${job.id}">${ICON.check}Mark built</button>
         <button class="btn" type="button" data-jact="delete" data-id="${job.id}">${ICON.trash}Remove</button>`;
    return `${facts}${controls}${mats}<div class="job-actions">${actions}</div>`;
  }

  function summaryHTML(jobs) {
    const counts = { planned: 0, building: 0, ready: 0 };
    jobs.forEach(j => counts[stateOf(j)]++);
    const profit = jobs.reduce((s, j) => s + (j.netProfit || 0), 0);
    const missing = jobs.some(j => j.netProfit === undefined && !j.isSubBuild);
    return `<section class="ledger-sum" aria-label="Queue summary">
        <div class="ls-top">
          <div><div class="lbl">Queue profit${missing ? ' *' : ''}</div><div class="big ${profit >= 0 ? 'pos' : 'neg'}">${compact(profit, true)}</div></div>
          <div class="ls-side">${counts.planned} planned · ${counts.building} building<br>${counts.ready} ready to collect</div>
        </div>
        <div class="ls-actions">
          ${counts.ready ? `<button class="chip primary" type="button" data-jact="collect">${ICON.check}Collect ${counts.ready} ready</button>` : ''}
          ${MB.isLoggedIn() ? `<button class="chip" type="button" data-jact="sync"${L.syncing ? ' disabled' : ''}>${L.syncing ? '<span class="spin" aria-hidden="true"></span>Syncing…' : `${ICON.sync}Sync with EVE`}</button>` : `<button class="chip" type="button" data-jact="login">${ICON.lock}Log in to sync EVE jobs</button>`}
          <button class="chip" type="button" data-jact="combine">${ICON.merge}Combine duplicates</button>
          <button class="chip" type="button" data-jact="notify" aria-pressed="${notifyOn()}">${ICON.bell}${notifyOn() ? 'Notifying' : 'Notify when ready'}</button>
        </div>
      </section>`;
  }
  function queueHTML(jobs, info) {
    if (!jobs.length) return `<p class="empty"><b>Nothing queued</b>Add a build from the Calculator and it shows up here.</p><button class="btn primary" type="button" data-jact="calc">${ICON.plus}Go to the Calculator</button>`;
    const filters = [['all', 'All'], ['planned', 'Planned'], ['building', 'Building'], ['ready', 'Ready']];
    const shown = L.filter === 'all' ? jobs : jobs.filter(j => stateOf(j) === L.filter);
    const { roots, kids } = clusters(shown);
    return `<div class="chiprow" role="group" aria-label="Show jobs">${filters.map(([k, l]) => `<button class="chip" type="button" data-jf="${k}" aria-pressed="${L.filter === k}">${l}${k === 'all' ? '' : ` <span class="chip-n">${jobs.filter(j => stateOf(j) === k).length}</span>`}</button>`).join('')}</div>
      ${roots.length ? `<ul class="jobs">${roots.map(j => jobCardHTML(j, jobs, info, kids, 0)).join('')}</ul>` : '<p class="empty"><b>No jobs here</b>Nothing matches this filter.</p>'}
      <p class="note">Parts to build first are their own jobs, listed under the job they're for. Start and mark them built on their own.</p>`;
  }
  function stockCardHTML() {
    if (!MB.isLoggedIn()) return `<div class="login-card">${ICON.lock}<p>Log in to take what you already own off this list.</p><button class="btn primary" type="button" data-jact="login">Log in</button></div>`;
    const locs = MB.stockLocations();
    return `<div class="card">
        <div class="kv"><span class="k">Take what I own off the list<small>stock used by started jobs is already counted</small></span><button class="switch" type="button" role="switch" data-jact="deduct" aria-checked="${prefs.deduct}" aria-label="Take what I own off the list"></button></div>
        <div class="kv"><span class="k">Count stock from</span><span class="pillset"><button class="chip small" type="button" data-jact="personal" aria-pressed="${prefs.stockPersonal}">Personal</button><button class="chip small" type="button" data-jact="corp" aria-pressed="${prefs.stockCorp}">Corp</button></span></div>
        <div class="kv"><label class="k" for="lg-loc">Location</label><span style="flex:1.4;min-width:0"><select id="lg-loc">${locs.map(([v, l]) => `<option value="${esc(v)}"${v === prefs.stockLoc ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></span></div>
      </div>`;
  }
  function shopHTML(items) {
    const toBuy = items.filter(x => x.toBuy > 0);
    const still = toBuy.reduce((s, x) => s + x.cost, 0);
    const vol = toBuy.reduce((s, x) => s + x.vol, 0);
    return `${stockCardHTML()}
      <div class="shop-sum">
        <div><div class="lbl">Still to buy</div><div class="big">${compact(still)}</div></div>
        <div class="side">${toBuy.length} item${toBuy.length === 1 ? '' : 's'} for every planned job${items.length - toBuy.length ? `<br>${items.length - toBuy.length} covered by stock` : ''}${vol ? `<br>${vol.toLocaleString('en-US', { maximumFractionDigits: 0 })} m³` : ''}</div>
      </div>
      ${items.length ? `<ul class="shop">${items.map(x => `<li class="shop-row${x.toBuy ? '' : ' done'}">${MB.iconHTML(x.typeId)}
          <div class="main"><span class="nm">${esc(x.name)}</span><span class="sub">need ${qty(x.need)}${x.have ? ` · have ${qty(x.have)}` : ''} · ${compact(x.unit)} each · ${x.strategy === 'buy' ? 'Jita buy' : 'Jita sell'}</span></div>
          <div class="right"><span class="cost">${x.toBuy ? compact(x.cost) : '—'}</span><span class="buyqty">${x.toBuy ? 'buy ' + qty(x.toBuy) : 'in stock'}</span></div></li>`).join('')}</ul>
        <div style="height:12px"></div>
        <button class="btn primary" type="button" data-jact="copyall"${toBuy.length ? '' : ' disabled'}>${ICON.copy}Copy Multibuy · ${toBuy.length} item${toBuy.length === 1 ? '' : 's'}</button>`
        : '<p class="empty"><b>Nothing to buy</b>Planned jobs have everything they need, or there are no planned jobs.</p>'}
      <p class="note">Everything your planned jobs still need, after what other queued jobs build and what you have in stock.</p>`;
  }
  function historyHTML() {
    const h = loadHistory();
    if (!h.length) return '<p class="empty"><b>No history yet</b>Jobs you mark as built are listed here.</p>';
    const total = h.reduce((s, r) => s + (r.netProfit || 0), 0);
    const fr = f();
    return `<div class="shop-sum"><div><div class="lbl">Profit from ${h.length} build${h.length === 1 ? '' : 's'}</div><div class="big ${total >= 0 ? 'pos' : 'neg'}">${compact(total, true)}</div></div></div>
      <ul class="hist">${h.map(r => {
        const q = r.qtyNeeded || 0;
        const be = q > 0 ? (r.calculatedCost || 0) / (q * (1 - fr.salesTax - fr.brokerFee)) : 0;
        const when = r.completedAt ? new Date(r.completedAt) : null;
        return `<li>${MB.iconHTML(r.productTypeId || r.typeId)}
          <div><span class="nm">${esc(displayName(r))}</span><span class="when">${when ? MB.ago(when.getTime()) : ''} · ${qty(r.runsNeeded)} run${r.runsNeeded === 1 ? '' : 's'} · ${qty(q)} made${r.isSubBuild ? ' · part' : ''}</span><span class="when">cost ${compact(r.calculatedCost || 0)}${!r.isSubBuild && q ? ` · break-even ${compact(be)} each` : ''}${r.netProfit !== undefined && !r.isSubBuild ? ` · <span class="${r.netProfit >= 0 ? 'pos' : 'neg'}">${compact(r.netProfit, true)}</span>` : ''}</span></div>
          <div class="acts"><button class="iconbtn" type="button" data-hact="requeue" data-id="${r.id}" aria-label="Queue ${esc(displayName(r))} again">${ICON.refresh}</button><button class="iconbtn" type="button" data-hact="delete" data-id="${r.id}" aria-label="Remove ${esc(displayName(r))} from history">${ICON.trash}</button></div>
        </li>`;
      }).join('')}</ul>
      <button class="btn" type="button" data-hact="clear">${ICON.trash}Clear history</button>`;
  }

  function render() {
    updateBadge();
    if (MB.screen() !== 'ledger') return;
    const el = $('#screen-ledger');
    const jobs = loadJobs();
    const { info, items } = allocate(jobs);
    el.innerHTML = `${summaryHTML(jobs)}
      <div class="segtabs" role="tablist" aria-label="Ledger views">
        <button type="button" role="tab" data-lt="queue" aria-selected="${L.tab === 'queue'}">Queue</button>
        <button type="button" role="tab" data-lt="shop" aria-selected="${L.tab === 'shop'}">To buy${items.filter(x => x.toBuy > 0).length ? ` <span class="tabcount">${items.filter(x => x.toBuy > 0).length}</span>` : ''}</button>
        <button type="button" role="tab" data-lt="history" aria-selected="${L.tab === 'history'}">History</button>
      </div>
      <section role="tabpanel">${L.tab === 'queue' ? queueHTML(jobs, info) : L.tab === 'shop' ? shopHTML(items) : historyHTML()}</section>`;
  }
  MB.screens.ledger = {
    title: 'Ledger',
    render,
    enter() {
      render();
      if (MB.isLoggedIn() && Date.now() - L.lastSync > 5 * 60e3) syncEve(true);
    },
    always: updateBadge
  };

  /* =====================  Events  ===================== */
  $('#screen-ledger').addEventListener('click', async e => {
    const t = e.target;
    let el;
    if ((el = t.closest('[data-lt]'))) { L.tab = el.dataset.lt; render(); return; }
    if ((el = t.closest('[data-jf]'))) { L.filter = el.dataset.jf; render(); return; }
    if ((el = t.closest('[data-kids]'))) {
      const id = Number(el.dataset.kids);
      collapsed.has(id) ? collapsed.delete(id) : collapsed.add(id);
      LS.set('eve_collapsed_job_clusters', [...collapsed]);
      render();
      return;
    }
    if ((el = t.closest('[data-job]'))) { const id = Number(el.dataset.job); L.open.has(id) ? L.open.delete(id) : L.open.add(id); render(); return; }
    if ((el = t.closest('[data-step]'))) {
      if (el.disabled) return;
      const [kind, idStr] = el.dataset.step.split(':');
      const id = Number(idStr);
      const job = loadJobs().find(j => j.id === id);
      const ed = L.edit.get(id);
      if (!job || !ed) return;
      const d = Number(el.dataset.d);
      if (kind === 'jj') ed.jobs = Math.min(1000, Math.max(1, ed.jobs + d));
      if (kind === 'jr') ed.runs = Math.min(100000, Math.max(1, ed.runs + d));
      if (kind === 'js') ed.start = Math.min(job.runsNeeded, Math.max(1, ed.start + d));
      render();
      const again = $(`#screen-ledger [data-step="${el.dataset.step}"][data-d="${d}"]`);
      if (again && !again.disabled) again.focus();
      return;
    }
    if ((el = t.closest('[data-hact]'))) {
      const act = el.dataset.hact;
      const h = loadHistory();
      if (act === 'clear') {
        saveHistory([]);
        render();
        toast(`Cleared ${h.length} history record${h.length === 1 ? '' : 's'}`, { label: 'Undo', run: () => { saveHistory(h); render(); } });
        return;
      }
      const i = h.findIndex(r => String(r.id) === el.dataset.id);
      if (i === -1) return;
      const r = h[i];
      if (act === 'requeue') {
        const jobs = loadJobs();
        jobs.push({ id: newId(), typeId: r.typeId, productTypeId: r.productTypeId, name: r.name, runsNeeded: r.runsNeeded, qtyNeeded: r.qtyNeeded, calculatedCost: r.calculatedCost, materials: r.materials || [], baseTime: r.baseTime, totalBuildSeconds: r.totalBuildSeconds, productionSnapshot: r.productionSnapshot, buildConfigSnapshot: r.buildConfigSnapshot, scope: r.scope, ownerCharId: r.ownerCharId, corpId: r.corpId, addedAt: new Date().toISOString() });
        saveJobs(jobs);
        render();
        toast(`${displayName(r)} queued again`);
      } else {
        h.splice(i, 1);
        saveHistory(h);
        render();
        toast(`Removed ${displayName(r)} from history`, { label: 'Undo', run: () => { const now = loadHistory(); now.splice(i, 0, r); saveHistory(now); render(); } });
      }
      return;
    }
    if (!(el = t.closest('[data-jact]'))) return;
    if (el.disabled) return;
    const act = el.dataset.jact;
    const id = el.dataset.id ? Number(el.dataset.id) : null;
    if (act === 'calc') { MB.goScreen('calc'); return; }
    if (act === 'login') { MB.openSheet('account', el); return; }
    if (act === 'sync') { syncEve(false); return; }
    if (act === 'combine') { combine(); return; }
    if (act === 'notify') { toggleNotify(); return; }
    if (act === 'deduct') { prefs.deduct = !prefs.deduct; MB.savePrefs(); MB.syncShim(); render(); return; }
    if (act === 'personal' || act === 'corp') { const k = act === 'personal' ? 'stockPersonal' : 'stockCorp'; prefs[k] = !prefs[k]; MB.savePrefs(); MB.rebuildStock(); render(); return; }
    if (act === 'collect') {
      const done = markBuilt(loadJobs().filter(isReady).map(j => j.id));
      render();
      toast(`Marked ${done.length} job${done.length === 1 ? '' : 's'} built and moved ${done.length === 1 ? 'it' : 'them'} to History`);
      return;
    }
    if (act === 'built') {
      const [job] = markBuilt([id]);
      render();
      if (job) toast(`${displayName(job)} marked built and moved to History`);
      return;
    }
    if (act === 'delete') { removeJob(id); return; }
    if (act === 'start') { const ed = L.edit.get(id); startJob(id, ed ? ed.start : NaN); L.edit.delete(id); return; }
    if (act === 'runs') { const ed = L.edit.get(id); if (ed) setRuns(id, ed.jobs, ed.runs); return; }
    if (act === 'topup') { topUp(id); return; }
    if (act === 'buildmat') { buildMaterial(id, Number(el.dataset.type), Number(el.dataset.missing)); return; }
    if (act === 'copy' || act === 'copyall') {
      let lines;
      if (act === 'copy') {
        const jobs = loadJobs();
        const ordered = [...jobs.filter(j => j.isStarted), ...jobs.filter(j => !j.isStarted)];
        const pool = { ...(window.userStockMap || {}) };
        const deduct = prefs.deduct && MB.isLoggedIn();
        let mine = [];
        for (const j of ordered) {
          const res = applyMats(j, pool, deduct, !(j.isStarted && reflected(j)));
          if (j.id === id) { mine = res; break; }
        }
        lines = mine.filter(x => x.mat.strategy !== 'lp' && x.missing > 0).map(x => `${x.mat.name} x${x.missing}`);
      } else {
        lines = allocate(loadJobs()).items.filter(x => x.toBuy > 0).map(x => `${x.name} x${Math.round(x.toBuy)}`);
      }
      if (!lines.length) { toast('Nothing left to buy for this'); return; }
      const ok = await MB.copyText(lines.join('\n'));
      toast(ok ? `Copied ${lines.length} item${lines.length === 1 ? '' : 's'} for EVE's Multibuy` : 'Copy was blocked by the browser');
    }
  });
  $('#screen-ledger').addEventListener('change', e => {
    if (e.target.id === 'lg-loc') { prefs.stockLoc = e.target.value; MB.savePrefs(); MB.rebuildStock(); render(); return; }
    const id = e.target.dataset.jst;
    if (id && e.target.value) setStation(Number(id), e.target.value);
  });
  // Another tab (the desktop Ledger, or a Calculator tab) changed the queue.
  window.addEventListener('storage', e => { if (e.key === 'eve_ledger_jobs' || e.key === 'eve_ledger_history') render(); });

  MB.ledger = { render, syncEve, updateBadge };
})();
