'use strict';

// Phone layout: the LP Store screen. Ranking is a port of js/lpstore.js (evaluateDirectSellOffer,
// evaluateBpcOffer, loadAndRankLPStore): an item offer is worth its Jita sell price after sales tax
// and broker fee (or, with "Instant sell", the highest Jita buy order after sales tax only), minus the
// store's ISK and the required items at Jita sell; a blueprint offer also
// pays for building its copy at your station with the site's own tree builder. The last store, the
// favorites and the "find an item in every store" index are shared with the desktop page
// (eve_lpstore_last_corp, eve_lpstore_favorites, eve_lpstore_item_search_cache).
//
// Two deliberate differences: fees are read the phone's way (0% counts as 0%), and a blueprint
// offer is built with everything bought, not with whatever build choices the Calculator last had
// (the desktop page picks those up from the Calculator's saved session).
(() => {
  const MB = window.MB;
  const { $, esc, compact, qty, dur, ICON, LS, toast, MINUS, iconHTML } = MB;

  // Every NPC corporation with an LP store, from js/lpstore.js LP_STORE_CORPS (faction and colour).
  // [faction, colour] and [corpId, name, faction index]; regenerate from js/lpstore.js if CCP adds a store.
  const FACTIONS = [["Amarr Empire","#e0c168"],["Ammatar Mandate","#d4a05c"],["Angel Cartel","#e05a5a"],["Blood Raider Covenant","#a03030"],["Caldari State","#5b9bd5"],["CONCORD Assembly","#8fa3b3"],["EverMore","#b8c4cc"],["Gallente Federation","#6fbf73"],["Guristas Pirates","#e8c14a"],["Khanid Kingdom","#8a5a9e"],["Minmatar Republic","#c85a4a"],["Mordu's Legion Command","#5a7a8a"],["ORE","#d98c3a"],["Sansha's Nation","#c04ac0"],["Serpentis","#4ac084"],["Servant Sisters of EVE","#3ac8b8"],["The Society of Conscious Thought","#4ac8e0"],["The Syndicate","#7a6a8a"],["Thukker Tribe","#a06a3a"],["Triglavian Collective","#3ec87a"]];
  const CORP_ROWS = [[1000179,"24th Imperial Crusade",0],[1000073,"Amarr Certified News",0],[1000079,"Amarr Civil Service",0],[1000063,"Amarr Constructions",0],[1000084,"Amarr Navy",0],[1000083,"Amarr Trade Registry",0],[1000090,"Ardishapur Family",0],[1000064,"Carthum Conglomerate",0],[1000092,"Civic Court",0],[1000085,"Court Chamberlain",0],[1000069,"Ducia Foundry",0],[1000086,"Emperor Family",0],[1000076,"Further Foodstuffs",0],[1000165,"Hedion University",0],[1000070,"HZO Refinery",0],[1000166,"Imperial Academy",0],[1000065,"Imperial Armaments",0],[1000078,"Imperial Chancellor",0],[1000072,"Imperial Shipment",0],[1000283,"Imperial War Reserves",0],[1000071,"Inherent Implants",0],[1000074,"Joint Harvesting",0],[1000087,"Kador Family",0],[1000089,"Kor-Azor Family",0],[1000081,"Ministry of Assessment",0],[1000082,"Ministry of Internal Order",0],[1000080,"Ministry of War",0],[1000068,"Noble Appliances",0],[1000075,"Nurtura",0],[1000077,"Royal Amarr Institute",0],[1000088,"Sarum Family",0],[1000091,"Tash-Murkon Family",0],[1000093,"Theology Council",0],[1000066,"Viziam",0],[1000067,"Zoar and Sons",0],[1000126,"Ammatar Consulate",1],[1000123,"Ammatar Fleet",1],[1000154,"Nefantar Miner Association",1],[1000124,"Archangels",2],[1000138,"Dominations",2],[1000136,"Guardian Angels",2],[1000436,"Malakim Zealots",2],[1000133,"Salvation Angels",2],[1000134,"Blood Raiders",3],[1000033,"Caldari Business Tribunal",4],[1000026,"Caldari Constructions",4],[1000028,"Caldari Funds Unlimited",4],[1000035,"Caldari Navy",4],[1000009,"Caldari Provisions",4],[1000015,"Caldari Steel",4],[1000002,"CBD Corporation",4],[1000024,"CBD Sell Division",4],[1000031,"Chief Executive Panel",4],[1000043,"Corporate Police Force",4],[1000006,"Deep Core Mining Inc.",4],[1000018,"Echelon Entertainment",4],[1000023,"Expert Distribution",4],[1000027,"Expert Housing",4],[1000039,"Home Guard",4],[1000034,"House of Records",4],[1000005,"Hyasyoda Corporation",4],[1000036,"Internal Security",4],[1000019,"Ishukone Corporation",4],[1000038,"Ishukone Watch",4],[1000010,"Kaalakiota Corporation",4],[1000020,"Lai Dai Corporation",4],[1000037,"Lai Dai Protection Service",4],[1000032,"Mercantile Club",4],[1000008,"Minedrill",4],[1000030,"Modern Finances",4],[1000017,"Nugoeihuvi Corporation",4],[1000040,"Peace and Order Unit",4],[1000014,"Perkone",4],[1000007,"Poksu Mineral Group",4],[1000003,"Prompt Delivery",4],[1000022,"Propel Dynamics",4],[1000013,"Rapid Assembly",4],[1000044,"School of Applied Knowledge",4],[1000045,"Science and Trade Institute",4],[1000041,"Spacelane Patrol",4],[1000029,"State and Region Bank",4],[1000284,"State Military Stockpile",4],[1000180,"State Protectorate",4],[1000167,"State War Academy",4],[1000025,"Sukuuvestaa Corporation",4],[1000012,"Top Down",4],[1000011,"Wiyrkomi Corporation",4],[1000042,"Wiyrkomi Peace Corps",4],[1000004,"Ytiri",4],[1000016,"Zainou",4],[1000125,"CONCORD",5],[1000137,"DED",5],[1000096,"Inner Zone Shipping",6],[1000419,"Paragon",6],[1000021,"Zero-G Research Firm",6],[1000111,"Aliastra",7],[1000103,"Allotek Industries",7],[1000098,"Astral Mining Inc.",7],[1000112,"Bank of Luminaire",7],[1000169,"Center for Advanced Studies",7],[1000108,"Chemal Tech",7],[1000099,"Combined Harvest",7],[1000101,"CreoDron",7],[1000109,"Duvolle Laboratories",7],[1000106,"Egonics Inc.",7],[1000119,"Federal Administration",7],[1000181,"Federal Defense Union",7],[1000095,"Federal Freight",7],[1000121,"Federal Intelligence Office",7],[1000168,"Federal Navy Academy",7],[1000285,"Federal Strategic Materiel",7],[1000122,"Federation Customs",7],[1000120,"Federation Navy",7],[1000110,"FedMart",7],[1000114,"Garoun Investment Bank",7],[1000105,"Impetus",7],[1000097,"Material Acquisition",7],[1000113,"Pend Insurance",7],[1000104,"Poteque Pharmaceuticals",7],[1000116,"President",7],[1000100,"Quafe Company",7],[1000102,"Roden Shipyards",7],[1000117,"Senate",7],[1000118,"Supreme Court",7],[1000107,"The Scope",7],[1000094,"TransStellar Shipping",7],[1000115,"University of Caille",7],[1000437,"Commando Guri",8],[1000127,"Guristas",8],[1000141,"Guristas Production",8],[1000151,"Khanid Innovation",9],[1000152,"Khanid Transport",9],[1000153,"Khanid Works",9],[1000156,"Royal Khanid Navy",9],[1000057,"Boundless Creation",10],[1000049,"Brutor Tribe",10],[1000056,"Core Complexion Inc.",10],[1000058,"Eifyr and Co.",10],[1000061,"Freedom Extension",10],[1000047,"Krusual Tribe",10],[1000055,"Minmatar Mining Corporation",10],[1000060,"Native Freshfood",10],[1000172,"Pator Tech School",10],[1000051,"Republic Fleet",10],[1000286,"Republic Fleet Ordnance",10],[1000052,"Republic Justice Department",10],[1000170,"Republic Military School",10],[1000050,"Republic Parliament",10],[1000054,"Republic Security Services",10],[1000171,"Republic University",10],[1000046,"Sebiestor Tribe",10],[1000059,"Six Kin Development",10],[1000062,"The Leisure Group",10],[1000182,"Tribal Liberation Force",10],[1000053,"Urban Management",10],[1000048,"Vherokior Tribe",10],[1000128,"Mordu's Legion",11],[1000277,"Frostline Laboratories",12],[1000276,"ORE Technologies",12],[1000270,"Outer Ring Development",12],[1000129,"Outer Ring Excavations",12],[1000271,"Outer Ring Prospecting",12],[1000161,"True Creations",13],[1000162,"True Power",13],[1000135,"Serpentis Corporation",14],[1000157,"Serpentis Inquest",14],[1000139,"Food Relief",15],[1000130,"Sisters of EVE",15],[1000159,"The Sanctuary",15],[1000140,"Genolution",16],[1000131,"Society of Conscious Thought",16],[1000144,"Intaki Bank",17],[1000145,"Intaki Commerce",17],[1000146,"Intaki Space Police",17],[1000147,"Intaki Syndicate",17],[1000160,"Thukker Mix",18],[1000163,"Trust Partners",18],[1000293,"Perun Clade",19],[1000294,"Svarog Clade",19],[1000298,"The Convocation of Triglav",19],[1000292,"Veles Clade",19]];
  const CORPS = CORP_ROWS.map(([id, name, f]) => ({ id, name, faction: FACTIONS[f][0], color: FACTIONS[f][1] }));
  const CORP_BY_ID = new Map(CORPS.map(c => [c.id, c]));

  const LPS = {
    corp: parseInt(LS.raw('eve_lpstore_last_corp'), 10) || null, view: 'store',
    q: '', type: 'all', cat: 'all', sort: 'rate', open: null, shown: 40,
    findQ: '', findOpen: null, market: null, range: 90, chartView: 'chart'
  };
  if (LPS.corp && !CORP_BY_ID.has(LPS.corp)) LPS.corp = null;

  /* =====================  Names, prices, categories  ===================== */
  const resolvedNames = {};
  const lpName = id => (window.EVE_ITEMS && window.EVE_ITEMS[id]) || resolvedNames[id] || `Item ${id}`;
  // Names eve_db.js doesn't have (some SKINs, vanity items) from ESI, like js/lpstore.js.
  async function resolveNames(ids) {
    const missing = [...new Set(ids)].filter(id => !(window.EVE_ITEMS && window.EVE_ITEMS[id]) && !resolvedNames[id]);
    for (let i = 0; i < missing.length; i += 500) {
      try {
        const res = await fetch('https://esi.evetech.net/latest/universe/names/?datasource=tranquility', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(missing.slice(i, i + 500)) });
        if (res.ok) (await res.json() || []).forEach(e => { resolvedNames[e.id] = e.name; });
      } catch (e) { /* the id stays as "Item N" */ }
    }
  }
  const sellOf = id => ((window.priceCache[id] || {}).sell || 0);
  // How the item you get is valued: 'sell' = list it yourself at the Jita sell price (sales tax and
  // broker fee); 'instant' = sell into the highest Jita buy order (sales tax only, no waiting, less
  // ISK per item). Same setting and key as the desktop LP Store. What you pay (required items,
  // materials) is unaffected.
  const SELL_KEY = 'eve_lp_sell_mode';
  let sellMode = LS.raw(SELL_KEY) === 'instant' ? 'instant' : 'sell';
  const outPrice = id => { const p = window.priceCache[id] || {}; return (sellMode === 'instant' ? p.buy : p.sell) || 0; };
  const netFactor = () => { const f = MB.feeFrac(); return sellMode === 'instant' ? 1 - f.salesTax : 1 - f.salesTax - f.brokerFee; };
  // Re-values one ranked offer for the current mode from prices already in memory.
  function reprice(o) {
    o.revenue = outPrice(o.pt) * o.qty * netFactor();
    o.profit = o.revenue - o.cost;
    o.rate = o.lp > 0 ? o.profit / o.lp : null;
  }
  const reqCostOf = offer => (offer.required_items || []).reduce((s, r) => s + sellOf(r.type_id) * r.quantity, 0);
  const isBpcOffer = offer => { const r = window.recipeMap && window.recipeMap[offer.type_id]; return !!(r && parseInt(r.blueprintTypeID, 10) === parseInt(offer.type_id, 10)); };
  const CAT_LABELS = { 6: 'Ships', 7: 'Modules', 8: 'Ammo', 16: 'Skillbooks', 18: 'Drones', 20: 'Implants', 91: 'SKINs' };
  const catKey = o => { const c = window.EVE_CATEGORIES ? window.EVE_CATEGORIES[o.pt] : undefined; return CAT_LABELS[c] ? String(c) : 'other'; };
  const catName = k => (k === 'other' ? 'Other' : k === 'fav' ? 'Favorites' : CAT_LABELS[k]);

  // Favorites, keyed "corpId:offerId" (offer ids repeat across stores), shared with the desktop.
  const favs = new Set((LS.get('eve_lpstore_favorites', []) || []).filter(v => typeof v === 'string' && v.includes(':')));
  const favKey = (corpId, offerId) => `${corpId}:${offerId}`;
  const saveFavs = () => LS.set('eve_lpstore_favorites', [...favs]);

  // Your LP, read by the site's asset refresh (js/esi.js) into eve_char_lp_balances.
  function balances() {
    if (!MB.isLoggedIn()) return null;
    const b = LS.get('eve_char_lp_balances', null);
    return b && typeof b === 'object' ? b : null;
  }
  const myLp = corpId => { const b = balances(); return b && b.byCorpId ? Number(b.byCorpId[corpId]) || 0 : null; };

  /* =====================  Ranking a store (js/lpstore.js)  ===================== */
  const offersCache = {};
  async function fetchOffers(corpId) {
    if (offersCache[corpId]) return offersCache[corpId];
    const res = await fetch(`https://esi.evetech.net/latest/loyalty/stores/${corpId}/offers/?datasource=tranquility`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`EVE answered ${res.status}`);
    const offers = await res.json();
    offersCache[corpId] = Array.isArray(offers) ? offers : [];
    return offersCache[corpId];
  }
  const ranked = {}; // corpId -> { sig, rows }
  let ranking = null; // { corpId, promise }
  let rankError = null;
  const rankSig = () => JSON.stringify([MB.readFees(), MB.liveStation(), MB.prefs.priceMode, !!MB.eivLoaded, MB.implantPct(), LS.raw('eve_char_skills') ? 1 : 0, MB.prefs.simV]);

  async function rankStore(corpId) {
    const offers = await fetchOffers(corpId);
    const flat = new Set();
    offers.forEach(o => { flat.add(o.type_id); (o.required_items || []).forEach(r => flat.add(r.type_id)); });
    await Promise.all([window.fetchMarketPrices([...flat]), resolveNames([...flat])]);
    return MB.treeLock(async () => {
      const saved = { b: window.buildSelfOverrides, me: window.customMEOverrides, te: window.customTEOverrides, m: window.customBuyModes };
      try {
        window.buildSelfOverrides = {}; window.customMEOverrides = {}; window.customTEOverrides = {}; window.customBuyModes = {};
        MB.syncShim();
        MB.setStationGlobals();
        const fees = MB.feeFrac();
        const st = window.getActiveStructureType();
        // Build every blueprint offer's copy once, then price everything they need in one go.
        const trees = new Map();
        const ids = new Set();
        await Promise.all(offers.filter(isBpcOffer).map(async offer => {
          try {
            const recipe = window.recipeMap[offer.type_id];
            const pt = parseInt(recipe.productTypeID, 10);
            window.recipeTreeRootProductTypeId = pt;
            let root;
            try { root = await window.buildRecursiveRecipeTree(parseInt(offer.type_id, 10), lpName(offer.type_id), offer.quantity, 0, 6, new Set(), null, 1); }
            finally { window.recipeTreeRootProductTypeId = null; }
            if (!root) return;
            root.runsNeeded = offer.quantity;
            root.qtyNeeded = offer.quantity * (recipe.productQtyPerRun || 1);
            window.scaleTreeQuantities(root, (st.meBonus || 0) / 100);
            window.collectAllTypeIds(root, ids);
            ids.add(pt);
            trees.set(offer, { root, pt });
          } catch (e) { console.warn('[Phone LP] Could not build', offer.type_id, e); }
        }));
        if (ids.size) await window.fetchMarketPrices([...ids]);
        const net = netFactor();
        return offers.map(offer => {
          const reqCost = reqCostOf(offer);
          const base = { id: offer.offer_id, offer, lp: offer.lp_cost, isk: offer.isk_cost, reqCost, req: offer.required_items || [] };
          if (!isBpcOffer(offer)) {
            const revenue = outPrice(offer.type_id) * offer.quantity * net;
            const profit = revenue - (offer.isk_cost + reqCost);
            return { ...base, bpc: false, pt: offer.type_id, name: lpName(offer.type_id), qty: offer.quantity, revenue, cost: offer.isk_cost + reqCost, matCost: 0, jobFee: 0, profit, rate: offer.lp_cost > 0 ? profit / offer.lp_cost : null, secs: 0, runs: 0, est: !!(window.priceCache[offer.type_id] || {}).isEstimated };
          }
          const t = trees.get(offer);
          if (!t) return null;
          const matCost = window.calculateTreeNodeCost(t.root);
          window.calculateNodeEIV(t.root);
          const jobFee = window.calculateNodeJobFee(t.root, fees.facilityTax, fees.sccSurcharge, (st.costBonus || 0) / 100);
          const revenue = outPrice(t.pt) * t.root.qtyNeeded * net;
          const cost = offer.isk_cost + reqCost + matCost + jobFee;
          const profit = revenue - cost;
          return { ...base, bpc: true, bp: offer.type_id, pt: t.pt, name: lpName(t.pt), qty: t.root.qtyNeeded, runs: offer.quantity, revenue, cost, matCost, jobFee, profit, rate: offer.lp_cost > 0 ? profit / offer.lp_cost : null, secs: window.calculateTotalBuildSeconds(t.root), est: !!(window.priceCache[t.pt] || {}).isEstimated };
        }).filter(Boolean);
      } finally {
        window.recipeTreeRootProductTypeId = null;
        window.buildSelfOverrides = saved.b; window.customMEOverrides = saved.me; window.customTEOverrides = saved.te; window.customBuyModes = saved.m;
      }
    });
  }
  function ensureRanked(corpId) {
    const sig = rankSig();
    if (ranked[corpId] && ranked[corpId].sig === sig) return;
    if (ranking && ranking.corpId === corpId && ranking.sig === sig) return;
    rankError = null;
    const job = { corpId, sig };
    job.promise = rankStore(corpId).then(rows => {
      rows.forEach(reprice); // in case the sell mode changed while this was working
      ranked[corpId] = { sig, rows };
    }).catch(e => {
      console.error('[Phone LP] Could not load store', corpId, e);
      if (LPS.corp === corpId) rankError = `Couldn’t load this store’s offers (${e.message || e}). Check your connection and try again.`;
    }).finally(() => {
      if (ranking === job) ranking = null;
      if (MB.screen() === 'lp') render();
      MB.refillSheet('lpowned', 'corps');
    });
    ranking = job;
  }
  const rowsOf = corpId => (ranked[corpId] ? ranked[corpId].rows : null);
  const bestRate = corpId => (rowsOf(corpId) || []).reduce((m, o) => (o.rate != null && o.rate > m ? o.rate : m), -Infinity);

  /* =====================  This store  ===================== */
  const initials = name => name.split(/\s+/).filter(w => /[A-Za-z0-9]/.test(w[0] || '')).slice(0, 2).map(w => w[0]).join('').toUpperCase();
  // The corporation's logo, with its initials on the faction colour underneath if the logo is missing.
  const corpDot = (c, sm) => `<span class="corp-dot${sm ? ' sm' : ''}" style="background:${c.color}" aria-hidden="true">${esc(initials(c.name))}<img src="https://images.evetech.net/corporations/${c.id}/logo?size=64" alt="" loading="lazy" onerror="this.remove()"></span>`;
  const offerIcon = o => (o.bpc ? iconHTML(o.bp, '', 'bpc') : iconHTML(o.pt));

  function offerCardHTML(o) {
    const open = LPS.open === o.id;
    const id = 'off-' + o.id;
    const fav = favs.has(favKey(LPS.corp, o.id));
    const bpcTag = o.bpc ? `<span class="spill bpc">Blueprint · ${o.runs} run${o.runs === 1 ? '' : 's'}</span>` : '';
    const costText = `${qty(o.lp)} LP${o.isk ? ` + ${compact(o.isk)}` : ''}${o.req.length ? ` + ${o.req.length} item${o.req.length === 1 ? '' : 's'}` : ''}`;
    return `<li class="offer">
      <button class="offer-head" type="button" data-offer="${o.id}" aria-expanded="${open}" aria-controls="${id}">
        ${offerIcon(o)}
        <span><span class="o-name">${fav ? `<span class="o-fav" aria-label="Favorite">${ICON.star}</span>` : ''}${esc(o.name)}${o.qty > 1 && !o.bpc ? ` ×${qty(o.qty)}` : ''}</span><span class="o-meta">${bpcTag}${costText}</span></span>
        <span class="o-right"><span class="o-rate ${o.rate == null || o.rate >= 0 ? 'pos' : 'neg'}">${o.rate == null ? '—' : qty(o.rate)}</span><span class="o-unit">ISK / LP</span></span>
      </button>
      <div class="offer-body" id="${id}"${open ? '' : ' hidden'}>
        <ul class="brk">
          <li><span>${sellMode === 'instant' ? 'Sold to buy orders, after sales tax' : 'Sells for, after tax and fees'}${o.est ? ' <span class="spill src">estimate</span>' : ''}</span><span class="v">${compact(o.revenue)}</span></li>
          ${o.isk ? `<li><span>ISK paid to the store</span><span class="v">${MINUS}${compact(o.isk)}</span></li>` : ''}
          ${o.req.map(r => `<li><span>${esc(lpName(r.type_id))} ×${qty(r.quantity)}</span><span class="v">${MINUS}${compact(sellOf(r.type_id) * r.quantity)}</span></li>`).join('')}
          ${o.bpc ? `<li><span>Build materials, ${o.runs} run${o.runs === 1 ? '' : 's'}</span><span class="v">${MINUS}${compact(o.matCost)}</span></li><li><span>Job fees</span><span class="v">${MINUS}${compact(o.jobFee)}</span></li>` : ''}
          <li><span>Profit for ${qty(o.lp)} LP</span><span class="v ${o.profit >= 0 ? 'pos' : 'neg'}">${compact(o.profit, true)}</span></li>
        </ul>
        ${o.bpc && o.secs ? `<p class="note" style="margin:-4px 2px 10px">Building it takes ${dur(o.secs)} at ${esc(MB.activeStation().name)}.</p>` : ''}
        <div class="job-actions">
          <button class="btn" type="button" data-lpact="market" data-pt="${o.pt}">${ICON.chart}Price history</button>
          <button class="btn" type="button" data-lpact="fav" data-id="${o.id}" aria-pressed="${fav}">${ICON.star}${fav ? 'Favorited' : 'Favorite'}</button>
          ${o.bpc && window.recipeMap[o.bp] ? `<button class="btn primary wide" type="button" data-lpact="build" data-id="${o.id}">${ICON.factory}Build it in the Calculator</button>` : `<button class="btn wide" type="button" data-lpact="copy" data-name="${esc(o.name)}">${ICON.copy}Copy name for EVE's search</button>`}
        </div>
      </div>
    </li>`;
  }
  function visibleOffers() {
    const q = LPS.q.trim().toLowerCase();
    return (rowsOf(LPS.corp) || [])
      .filter(o => (LPS.type === 'all' || (LPS.type === 'bpc') === o.bpc)
        && (LPS.cat === 'all' || (LPS.cat === 'fav' ? favs.has(favKey(LPS.corp, o.id)) : catKey(o) === LPS.cat))
        && (!q || o.name.toLowerCase().includes(q)))
      .sort((a, b) => (LPS.sort === 'rate' ? (b.rate ?? -1e18) - (a.rate ?? -1e18) : LPS.sort === 'profit' ? b.profit - a.profit : a.lp - b.lp));
  }
  function listHTML() {
    const list = visibleOffers();
    const shown = list.slice(0, LPS.shown);
    return `<div class="section-head"><h3>Offers</h3><span class="count">${list.length} offer${list.length === 1 ? '' : 's'}</span></div>
      ${shown.length
        ? `<ol class="offers">${shown.map(offerCardHTML).join('')}</ol>${list.length > shown.length ? `<div style="height:10px"></div><button class="btn" type="button" data-lpmore>Show ${Math.min(40, list.length - shown.length)} more</button>` : ''}`
        : '<div class="empty"><b>No offers match</b>Try another filter or search.</div>'}`;
  }
  function storeHTML() {
    if (!LPS.corp) {
      return `<div class="empty"><b>Pick an LP store</b>Every offer is ranked by the ISK you make per LP spent.</div><button class="btn primary" type="button" data-lpact="corps">${ICON.search}Choose a store</button>`;
    }
    if (rankError && !rowsOf(LPS.corp)) return `<div class="errbox"><p>${esc(rankError)}</p><button class="linkbtn" type="button" data-lpact="retry">Try again</button></div>`;
    const all = rowsOf(LPS.corp);
    if (!all) return `<div class="loading-row"><span class="spin" aria-hidden="true"></span>Ranking every offer in this store…</div>`;
    const cats = {};
    all.forEach(o => { const k = catKey(o); cats[k] = (cats[k] || 0) + 1; });
    const catKeys = Object.keys(cats).sort((a, b) => cats[b] - cats[a]);
    const favCount = all.filter(o => favs.has(favKey(LPS.corp, o.id))).length;
    const chip = (attr, val, cur, label) => `<button class="chip" type="button" data-${attr}="${val}" aria-pressed="${cur === val}">${label}</button>`;
    return `${ranking && ranking.corpId === LPS.corp ? '<p class="note" style="margin:0 2px 10px"><span class="spin" aria-hidden="true"></span> Updating…</p>' : ''}
      <div class="searchbox">${ICON.search}<input type="text" id="lp-q" placeholder="Search this store" autocomplete="off" value="${esc(LPS.q)}" aria-label="Search this store"></div>
      <div class="chiprow" role="group" aria-label="Sort offers"><span class="lbl">Sort</span>${chip('lpsort', 'rate', LPS.sort, 'ISK per LP')}${chip('lpsort', 'profit', LPS.sort, 'Profit')}${chip('lpsort', 'lp', LPS.sort, 'Cheapest LP')}</div>
      <div class="chiprow" role="group" aria-label="Offer type">${chip('lptype', 'all', LPS.type, 'All')}${chip('lptype', 'items', LPS.type, 'Items')}${chip('lptype', 'bpc', LPS.type, 'Blueprints')}</div>
      <div class="chiprow" role="group" aria-label="Category">${chip('lpcat', 'all', LPS.cat, `All ${all.length}`)}${favCount ? chip('lpcat', 'fav', LPS.cat, `${ICON.star}Favorites ${favCount}`) : ''}${catKeys.map(k => chip('lpcat', k, LPS.cat, `${catName(k)} ${cats[k]}`)).join('')}</div>
      <div id="lp-list">${listHTML()}</div>
      <p class="note">${sellMode === 'instant'
        ? 'ISK per LP counts selling straight into the highest Jita buy order (no broker fee, sales tax still applies; a big stack can fill below that price), minus the store\'s ISK and the required items at Jita sell.'
        : 'ISK per LP counts the Jita sell price after sales tax and broker fee, minus the store\'s ISK and the required items at Jita sell.'} Blueprint offers also count building the copy at your station, with everything in it bought.</p>`;
  }

  /* =====================  Find an item in every store  ===================== */
  // js/lpstore.js buildLPItemSearchIndex, with the same 6-hour cache in the same format, so the
  // desktop page and the phone share one download of every store.
  const INDEX_KEY = 'eve_lpstore_item_search_cache';
  const INDEX_SCHEMA = 2;
  const INDEX_TTL = 6 * 60 * 60 * 1000;
  const IDX = { entries: null, building: false, done: 0 };
  function readIndexCache() {
    const parsed = LS.get(INDEX_KEY, null);
    if (!parsed || !Array.isArray(parsed.entries) || parsed.schemaVersion !== INDEX_SCHEMA || Date.now() - parsed.builtAt > INDEX_TTL) return null;
    Object.entries(parsed.names || {}).forEach(([id, n]) => { if (!resolvedNames[id]) resolvedNames[id] = n; });
    Object.entries(parsed.prices || {}).forEach(([id, p]) => { if (!window.priceCache[id]) window.priceCache[id] = { sell: p[0], buy: p[1] }; });
    return parsed.entries.map(([corpId, offerId, outputTypeId, outputQty, isBpc, iskCost, lpCost, req, blueprintTypeId, bpcRuns]) => ({ corpId, offerId, outputTypeId, outputQty, isBpc: !!isBpc, iskCost, lpCost, requiredItems: req.map(([t, q]) => ({ type_id: t, quantity: q })), blueprintTypeId: blueprintTypeId || null, bpcRuns: bpcRuns || null }));
  }
  function writeIndexCache(entries) {
    const ids = new Set();
    const compactEntries = entries.map(e => {
      ids.add(e.outputTypeId);
      if (e.blueprintTypeId) ids.add(e.blueprintTypeId);
      const req = e.requiredItems.map(r => { ids.add(r.type_id); return [r.type_id, r.quantity]; });
      return [e.corpId, e.offerId, e.outputTypeId, e.outputQty, e.isBpc ? 1 : 0, e.iskCost, e.lpCost, req, e.blueprintTypeId || null, e.bpcRuns || null];
    });
    const names = {}, prices = {};
    ids.forEach(id => { names[id] = lpName(id); const p = window.priceCache[id]; if (p) prices[id] = [p.sell || 0, p.buy || 0]; });
    try { localStorage.setItem(INDEX_KEY, JSON.stringify({ schemaVersion: INDEX_SCHEMA, builtAt: Date.now(), entries: compactEntries, names, prices })); } catch (e) { console.warn('[Phone LP] Could not save the store index:', e); }
  }
  // Est. ISK per LP, the desktop's way: for a blueprint offer this is the finished item's value
  // without the cost of building it, so it reads high. Opening the offer gives the real number.
  function estimate(e) {
    const revenue = outPrice(e.outputTypeId) * e.outputQty * netFactor();
    const req = e.requiredItems.reduce((s, r) => s + sellOf(r.type_id) * r.quantity, 0);
    const profit = revenue - e.iskCost - req;
    return e.lpCost > 0 ? profit / e.lpCost : null;
  }
  async function buildIndex() {
    if (IDX.entries || IDX.building) return;
    const cached = readIndexCache();
    if (cached) { IDX.entries = cached; refreshFind(); return; }
    IDX.building = true;
    IDX.done = 0;
    refreshFind();
    const entries = [];
    let next = 0;
    const worker = async () => {
      while (next < CORPS.length) {
        const corp = CORPS[next++];
        try {
          (await fetchOffers(corp.id)).forEach(offer => {
            const bpc = isBpcOffer(offer);
            const recipe = bpc ? window.recipeMap[offer.type_id] : null;
            entries.push({
              corpId: corp.id, offerId: offer.offer_id,
              outputTypeId: bpc && recipe ? parseInt(recipe.productTypeID, 10) : offer.type_id,
              outputQty: bpc && recipe ? offer.quantity * (recipe.productQtyPerRun || 1) : offer.quantity,
              isBpc: bpc, blueprintTypeId: bpc ? offer.type_id : null, bpcRuns: bpc ? offer.quantity : null,
              iskCost: offer.isk_cost, lpCost: offer.lp_cost, requiredItems: offer.required_items || []
            });
          });
        } catch (e) { console.warn('[Phone LP] Store index: skipped', corp.id, e); }
        IDX.done++;
        if (IDX.done % 6 === 0) refreshFind();
      }
    };
    await Promise.all(Array.from({ length: 15 }, worker));
    const ids = new Set();
    entries.forEach(e => { ids.add(e.outputTypeId); e.requiredItems.forEach(r => ids.add(r.type_id)); });
    await resolveNames([...ids]);
    await window.fetchMarketPrices([...ids]);
    IDX.entries = entries;
    IDX.building = false;
    writeIndexCache(entries);
    refreshFind();
  }
  function findGroups(q) {
    const ql = q.trim().toLowerCase();
    const groups = new Map();
    IDX.entries.forEach(e => {
      const name = lpName(e.outputTypeId);
      if (!name.toLowerCase().includes(ql)) return;
      const key = e.outputTypeId + ':' + (e.isBpc ? 1 : 0);
      if (!groups.has(key)) groups.set(key, { key, pt: e.outputTypeId, bp: e.blueprintTypeId, bpc: e.isBpc, name, entries: [] });
      groups.get(key).entries.push(e);
    });
    return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
  }
  function findResultsHTML() {
    if (IDX.building || !IDX.entries) return `<div class="loading-row"><span class="spin" aria-hidden="true"></span>Checking every LP store… ${IDX.done} of ${CORPS.length}</div>`;
    const ql = LPS.findQ.trim().toLowerCase();
    if (ql.length < 2) return `<p class="note">Type at least 2 letters, like “Gyrostabilizer” or “Snake”. Covers all ${CORPS.length} stores.</p>`;
    const all = findGroups(ql);
    if (!all.length) return '<div class="empty"><b>No LP store sells that</b>Try part of the name.</div>';
    const hits = all.slice(0, 25);
    return `<ol class="offers">${hits.map(g => {
      const open = LPS.findOpen === g.key;
      const rows = g.entries.map(e => { const have = myLp(e.corpId); return { e, have, enough: have !== null && have >= e.lpCost, rate: estimate(e) }; })
        .sort((a, b) => (a.enough !== b.enough ? (a.enough ? -1 : 1) : a.rate !== null && b.rate !== null ? b.rate - a.rate : a.rate !== null ? -1 : b.rate !== null ? 1 : a.e.lpCost - b.e.lpCost));
      const cheapest = Math.min(...g.entries.map(e => e.lpCost));
      return `<li class="offer">
        <button class="offer-head" type="button" data-find="${g.key}" aria-expanded="${open}">
          ${g.bpc ? iconHTML(g.bp, '', 'bpc') : iconHTML(g.pt)}
          <span><span class="o-name">${esc(g.name)}</span><span class="o-meta">${g.bpc ? '<span class="spill bpc">Blueprint</span>' : ''}${rows.length} store${rows.length === 1 ? '' : 's'} · from ${qty(cheapest)} LP</span></span>
          <span class="o-right">${ICON.chev}</span>
        </button>
        <div class="offer-body"${open ? '' : ' hidden'}>
          <ul class="rs-list">${rows.map(({ e, have, enough, rate }) => {
            const c = CORP_BY_ID.get(e.corpId);
            return `<li><button type="button" data-jump="${e.corpId}" data-joffer="${e.offerId}">${corpDot(c, true)}<span class="rs-body"><b>${esc(c.name)}</b><small>${qty(e.lpCost)} LP${e.iskCost ? ` + ${compact(e.iskCost)} ISK` : ''}${e.requiredItems.length ? ` + ${e.requiredItems.length} item${e.requiredItems.length === 1 ? '' : 's'}` : ''}${e.isBpc ? ` · ${e.bpcRuns || 1} run${(e.bpcRuns || 1) === 1 ? '' : 's'}` : e.outputQty > 1 ? ` · ×${qty(e.outputQty)}` : ''} · est. ${rate === null ? '—' : qty(rate)} ISK/LP</small></span>${have === null ? '' : enough ? `<span class="spill ok">${ICON.check}Enough LP</span>` : `<span class="spill planned">${compact(e.lpCost - have)} short</span>`}</button></li>`;
          }).join('')}</ul>
        </div>
      </li>`;
    }).join('')}</ol>${all.length > hits.length ? `<p class="note">Showing the first 25 of ${all.length}. Keep typing to narrow it down.</p>` : ''}
      <p class="note">Est. ISK per LP is a quick estimate: for blueprints it leaves out the cost of building. Open the store for the real ranking.</p>`;
  }
  function refreshFind() {
    if (MB.screen() !== 'lp' || LPS.view !== 'find') return;
    const el = $('#lpf-results');
    if (el) el.innerHTML = findResultsHTML(); else render();
  }
  async function jumpTo(corpId, offerId) {
    Object.assign(LPS, { corp: corpId, view: 'store', q: '', type: 'all', cat: 'all', open: offerId, shown: 40 });
    LS.set('eve_lpstore_last_corp', String(corpId));
    MB.closeSheet();
    ensureRanked(corpId);
    render();
    $('#screen-lp').scrollTop = 0;
    if (ranking && ranking.corpId === corpId) await ranking.promise;
    // Make sure the opened offer is on screen, however far down the ranking it is.
    const i = visibleOffers().findIndex(o => o.id === offerId);
    if (i >= LPS.shown) { LPS.shown = i + 1; if (MB.screen() === 'lp') render(); }
    const el = document.querySelector(`[data-offer="${offerId}"]`);
    if (el) el.scrollIntoView({ block: 'center' });
  }

  /* =====================  Screen  ===================== */
  function ownedHTML() {
    if (!MB.isLoggedIn()) return `<div class="login-card">${ICON.lock}<p>Log in to see how much LP you have in each store.</p><button class="btn primary" type="button" data-lpact="login">Log in</button></div>`;
    const b = balances();
    if (!b) return '<p class="note" style="margin:0 2px 12px">Your LP loads with your assets. Refresh them from the account menu if this stays empty.</p>';
    if (b.missingScope) return `<div class="login-card">${ICON.lock}<p>Your login is from before LP balances were added. Log in again once to allow them.</p><button class="btn primary" type="button" data-lpact="login">Log in</button></div>`;
    if (!LPS.corp) return `<div class="owned">${ICON.star}<span>See where your LP is.</span><button class="linkbtn" type="button" data-lpact="owned">All my LP</button></div>`;
    const bal = myLp(LPS.corp) || 0;
    const best = bestRate(LPS.corp);
    return `<div class="owned">${ICON.star}<span>You have <b>${qty(bal)} LP</b> here${bal && Number.isFinite(best) ? `. The best offer pays ${qty(best)} ISK/LP` : ''}.</span><button class="linkbtn" type="button" data-lpact="owned">All my LP</button></div>`;
  }
  function render() {
    const corp = LPS.corp ? CORP_BY_ID.get(LPS.corp) : null;
    if (corp && LPS.view === 'store') ensureRanked(corp.id);
    const rows = corp ? rowsOf(corp.id) : null;
    $('#screen-lp').innerHTML = `
      <button class="corpbtn" type="button" data-lpact="corps" aria-haspopup="dialog" aria-label="${corp ? `${esc(corp.name)} LP store. Change store` : 'Choose an LP store'}">
        ${corp ? corpDot(corp) : `<span class="corp-dot" style="background:var(--panel-2);color:var(--soft)" aria-hidden="true">${ICON.search}</span>`}
        <span class="p-text"><span class="p-name">${corp ? esc(corp.name) : 'Choose an LP store'}</span><span class="p-sub">${corp ? `${esc(corp.faction)}${rows ? ` · ${rows.length} offers` : ''} · tap to change` : `${CORPS.length} stores to pick from`}</span></span>
        ${ICON.down}
      </button>
      ${ownedHTML()}
      <div class="segtabs two" role="tablist" aria-label="LP Store views">
        <button type="button" role="tab" data-lpview="store" aria-selected="${LPS.view === 'store'}">This store</button>
        <button type="button" role="tab" data-lpview="find" aria-selected="${LPS.view === 'find'}">Find an item</button>
      </div>
      <div class="ctlrow" style="margin-top:-2px">
        <span class="nlabel" id="lp-sellmode-lbl" style="letter-spacing:0.06em">Value the item as</span>
        <span class="segctl" role="group" aria-labelledby="lp-sellmode-lbl">
          <button type="button" data-lpsell="sell" aria-pressed="${sellMode === 'sell'}">${ICON.order}Sell order</button>
          <button type="button" data-lpsell="instant" aria-pressed="${sellMode === 'instant'}">${ICON.bolt}Instant sell</button>
        </span>
      </div>
      <section role="tabpanel">${LPS.view === 'store' ? storeHTML() : `<div class="searchbox">${ICON.search}<input type="text" id="lpf-q" placeholder="Find an item in every LP store" autocomplete="off" value="${esc(LPS.findQ)}" aria-label="Find an item in every LP store"></div><div id="lpf-results">${findResultsHTML()}</div>`}</section>`;
    if (LPS.view === 'find' && !IDX.entries && !IDX.building) buildIndex();
  }
  const offerById = id => (rowsOf(LPS.corp) || []).find(o => o.id === id);

  const scr = $('#screen-lp');
  scr.addEventListener('input', e => {
    if (e.target.id === 'lp-q') { LPS.q = e.target.value; LPS.shown = 40; $('#lp-list').innerHTML = listHTML(); }
    if (e.target.id === 'lpf-q') { LPS.findQ = e.target.value; LPS.findOpen = null; $('#lpf-results').innerHTML = findResultsHTML(); }
  });
  scr.addEventListener('click', async e => {
    const t = e.target;
    let el;
    if ((el = t.closest('[data-lpview]'))) { LPS.view = el.dataset.lpview; render(); return; }
    if ((el = t.closest('[data-lpsell]'))) {
      const m = el.dataset.lpsell;
      if (m === sellMode) return;
      sellMode = m;
      LS.set(SELL_KEY, m);
      Object.values(ranked).forEach(r => r.rows.forEach(reprice));
      MB.refillSheet('corps', 'lpowned');
      render();
      const again = scr.querySelector(`[data-lpsell="${m}"]`);
      if (again) again.focus();
      toast(m === 'instant' ? 'Valuing items as an instant sale to Jita buy orders: no broker fee, usually less ISK' : 'Valuing items as sell orders you list yourself');
      return;
    }
    if ((el = t.closest('[data-lpsort]'))) { LPS.sort = el.dataset.lpsort; LPS.shown = 40; render(); return; }
    if ((el = t.closest('[data-lptype]'))) { LPS.type = el.dataset.lptype; LPS.shown = 40; render(); return; }
    if ((el = t.closest('[data-lpcat]'))) { LPS.cat = el.dataset.lpcat; LPS.shown = 40; render(); return; }
    if ((el = t.closest('[data-lpmore]'))) { LPS.shown += 40; $('#lp-list').innerHTML = listHTML(); return; }
    if ((el = t.closest('[data-offer]'))) {
      const id = Number(el.dataset.offer);
      LPS.open = LPS.open === id ? null : id;
      $('#lp-list').innerHTML = listHTML();
      const again = scr.querySelector(`[data-offer="${id}"]`);
      if (again) again.focus();
      return;
    }
    if ((el = t.closest('[data-find]'))) { LPS.findOpen = LPS.findOpen === el.dataset.find ? null : el.dataset.find; $('#lpf-results').innerHTML = findResultsHTML(); return; }
    if ((el = t.closest('[data-jump]'))) { jumpTo(Number(el.dataset.jump), Number(el.dataset.joffer)); return; }
    if (!(el = t.closest('[data-lpact]'))) return;
    const act = el.dataset.lpact;
    if (act === 'corps') { MB.openSheet('corps', el); return; }
    if (act === 'login') { MB.openSheet('account', el); return; }
    if (act === 'owned') { MB.openSheet('lpowned', el); return; }
    if (act === 'retry') { rankError = null; delete ranked[LPS.corp]; delete offersCache[LPS.corp]; render(); return; }
    if (act === 'market') { LPS.market = Number(el.dataset.pt); MB.openSheet('market', el); return; }
    if (act === 'copy') { const ok = await MB.copyText(el.dataset.name); toast(ok ? `Copied “${el.dataset.name}” for EVE's search` : 'Copy was blocked by the browser'); return; }
    if (act === 'fav') {
      const k = favKey(LPS.corp, Number(el.dataset.id));
      if (favs.has(k)) favs.delete(k); else favs.add(k);
      saveFavs();
      render();
      return;
    }
    if (act === 'build') {
      const o = offerById(Number(el.dataset.id));
      if (!o) return;
      const corp = CORP_BY_ID.get(LPS.corp);
      MB.calc.openFromLP({ bp: Number(o.bp), pt: o.pt, runs: o.runs, corp: corp.name, lp: o.lp, isk: o.isk, reqCost: o.reqCost });
      toast(`${o.name}, ${o.runs} run${o.runs === 1 ? '' : 's'}, opened in the Calculator`);
    }
  });

  /* =====================  Sheets: store picker, your LP, price history  ===================== */
  let corpQuery = '';
  function corpsListHTML() {
    const ql = corpQuery.trim().toLowerCase();
    const hits = CORPS.filter(c => !ql || c.name.toLowerCase().includes(ql) || c.faction.toLowerCase().includes(ql));
    if (!hits.length) return '<p class="note">No LP store by that name.</p>';
    const factions = [...new Set(hits.map(c => c.faction))];
    return factions.map(f => `<div class="card-title">${esc(f)}</div><ul class="itemlist">${hits.filter(c => c.faction === f).map(c => {
      const bal = myLp(c.id);
      const rows = rowsOf(c.id);
      return `<li><button type="button" data-corp="${c.id}" aria-current="${c.id === LPS.corp}">${corpDot(c)}<span><b>${esc(c.name)}</b><small>${rows ? `${rows.length} offers` : 'tap to rank its offers'}${bal ? ` · you have ${compact(bal)} LP` : ''}</small></span><span class="r">${rows && Number.isFinite(bestRate(c.id)) ? `${qty(bestRate(c.id))}<br><small>best ISK/LP</small>` : ''}</span></button></li>`;
    }).join('')}</ul>`).join('');
  }
  MB.SHEETS.corps = {
    title: () => 'Choose an LP store',
    html: () => `<div class="searchbox">${ICON.search}<input type="text" id="f-corpq" placeholder="Search ${CORPS.length} stores or factions" autocomplete="off" value="${esc(corpQuery)}" aria-label="Search LP stores"></div><div id="corp-results">${corpsListHTML()}</div>`,
    input(e) { if (e.target.id === 'f-corpq') { corpQuery = e.target.value; $('#corp-results').innerHTML = corpsListHTML(); } },
    click(e) {
      const el = e.target.closest('[data-corp]');
      if (!el) return;
      const id = Number(el.dataset.corp);
      Object.assign(LPS, { corp: id, q: '', type: 'all', cat: 'all', open: null, shown: 40, view: 'store' });
      LS.set('eve_lpstore_last_corp', String(id));
      MB.closeSheet();
      render();
      $('#screen-lp').scrollTop = 0;
    }
  };
  MB.SHEETS.lpowned = {
    title: () => 'Your LP',
    html() {
      const b = balances();
      const list = b && b.byCorpId ? Object.entries(b.byCorpId).map(([id, lp]) => [Number(id), Number(lp) || 0]).filter(([, lp]) => lp > 0).sort((x, y) => y[1] - x[1]) : [];
      const c0 = MB.activeChar();
      if (!list.length) return `<p class="note">${esc(c0 ? c0.charName : 'This character')} doesn't have LP with any corporation yet.</p>`;
      return `<p class="sheet-lead">${esc(c0 ? c0.charName : '')}${b.fetchedAt ? ` · updated ${MB.ago(b.fetchedAt)}` : ''}</p><ul class="itemlist">${list.map(([id, bal]) => {
        const c = CORP_BY_ID.get(id) || { id, name: `Corporation ${id}`, faction: '', color: '#666' };
        const best = bestRate(id);
        return `<li><button type="button" data-ownjump="${id}"${CORP_BY_ID.has(id) ? '' : ' disabled'}>${corpDot(c)}<span><b>${esc(c.name)}</b><small>${Number.isFinite(best) ? `best offer ${qty(best)} ISK/LP` : CORP_BY_ID.has(id) ? 'tap to rank its offers' : 'no LP store'}</small></span><span class="r"><b>${compact(bal)}</b><br><small>LP</small></span></button></li>`;
      }).join('')}</ul>`;
    },
    click(e) {
      const el = e.target.closest('[data-ownjump]');
      if (!el || el.disabled) return;
      const id = Number(el.dataset.ownjump);
      Object.assign(LPS, { corp: id, q: '', type: 'all', cat: 'all', open: null, shown: 40, view: 'store' });
      LS.set('eve_lpstore_last_corp', String(id));
      MB.closeSheet();
      render();
    }
  };

  // Price history from EVE's market API for your home market's region (Jita's is The Forge).
  const HIST = { region: null, regionName: null, rows: {}, loading: null };
  async function loadHistory(pt) {
    if (!HIST.region) {
      const station = LS.raw('eve_home_station_id') || '60003760';
      const r = await window.resolveStationRegion(station).catch(() => null);
      HIST.region = (r && r.regionId) || 10000002;
      HIST.regionName = await window.fetchRegionName(HIST.region).catch(() => null);
    }
    const rows = await window.fetchMarketHistoryRaw(HIST.region, pt);
    HIST.rows[pt] = (rows || []).slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)).map(r => [r.date, r.average, r.lowest, r.highest, r.volume]);
  }
  function chartSVG(days) {
    const W = 340, H = 198, L = 44, R = 6, T = 8, PH = 118, VT = T + PH + 16, VH = 42;
    const n = days.length;
    const xs = i => L + (n === 1 ? 0 : (i / (n - 1)) * (W - L - R));
    const lo = Math.min(...days.map(d => d[2])), hi = Math.max(...days.map(d => d[3]));
    const pad = (hi - lo) * 0.06 || hi * 0.05 || 1;
    const y0 = lo - pad, y1 = hi + pad;
    const y = v => T + PH - ((v - y0) / (y1 - y0)) * PH;
    const vmax = Math.max(...days.map(d => d[4])) || 1;
    const band = days.map((d, i) => `${xs(i).toFixed(1)},${y(d[3]).toFixed(1)}`).concat(days.map((d, i) => [i, d]).reverse().map(([i, d]) => `${xs(i).toFixed(1)},${y(d[2]).toFixed(1)}`)).join(' ');
    const line = days.map((d, i) => `${i ? 'L' : 'M'}${xs(i).toFixed(1)},${y(d[1]).toFixed(1)}`).join('');
    const bw = Math.max(1, (W - L - R) / n - 1);
    const bars = days.map((d, i) => { const h = (d[4] / vmax) * VH; return `<rect x="${(xs(i) - bw / 2).toFixed(1)}" y="${(VT + VH - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}"/>`; }).join('');
    const ticks = [y1 - pad, (y0 + y1) / 2, y0 + pad].map(v => `<line x1="${L}" x2="${W - R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/><text x="${L - 4}" y="${(y(v) + 3).toFixed(1)}" text-anchor="end">${compact(v)}</text>`).join('');
    return `<svg class="chart" id="lp-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Average daily price and volume over ${n} days">
      <g class="grid">${ticks}</g>
      <polygon class="band" points="${band}"/>
      <path class="line" d="${line}"/>
      <g class="vol">${bars}</g>
      <text x="${L}" y="${H - 1}">${days[0][0]}</text><text x="${W - R}" y="${H - 1}" text-anchor="end">${days[n - 1][0]}</text>
      <line class="cross" id="lp-cross" x1="0" x2="0" y1="${T}" y2="${VT + VH}" visibility="hidden"/>
    </svg>`;
  }
  // The days inside the chosen range, by calendar (EVE only lists days with trades).
  function inRange(all) {
    if (!all.length) return all;
    const cutoff = new Date(all[all.length - 1][0] + 'T00:00:00Z').getTime() - LPS.range * 86400000;
    const days = all.filter(d => new Date(d[0] + 'T00:00:00Z').getTime() > cutoff);
    return days.length ? days : all.slice(-1);
  }
  const dayText = d => `${d[0]} · avg ${compact(d[1])} (low ${compact(d[2])}, high ${compact(d[3])}) · ${qty(d[4])} traded`;
  MB.SHEETS.market = {
    title: () => lpName(LPS.market),
    open() {
      const pt = LPS.market;
      if (HIST.rows[pt]) return;
      HIST.loading = pt;
      loadHistory(pt).catch(e => { console.warn('[Phone LP] History failed:', e); HIST.rows[pt] = []; }).finally(() => { HIST.loading = null; if (MB.sheetKind() === 'market' && LPS.market === pt) MB.fillSheet(); });
    },
    html() {
      const all = HIST.rows[LPS.market];
      if (!all) return '<div class="loading-row"><span class="spin" aria-hidden="true"></span>Loading price history…</div>';
      if (!all.length) return '<p class="note">No trades on record for this item at your home market.</p>';
      const days = inRange(all);
      const first = days[0][1], last = days[days.length - 1][1];
      const change = first ? ((last - first) / first) * 100 : 0;
      const avgVol = days.reduce((s, d) => s + d[4], 0) / days.length;
      const pill = (v, l) => `<button class="chip" type="button" data-range="${v}" aria-pressed="${LPS.range === v}">${l}</button>`;
      return `<div class="minis" style="margin-bottom:10px">
          <div class="mini"><b>${compact(last)}</b><span>latest average</span></div>
          <div class="mini"><b class="${change >= 0 ? 'pos' : 'neg'}">${change >= 0 ? '+' : MINUS}${Math.abs(change).toFixed(1)}%</b><span>since ${days[0][0].slice(0, 4) === days[days.length - 1][0].slice(0, 4) ? days[0][0].slice(5) : days[0][0]}</span></div>
          <div class="mini"><b>${compact(avgVol)}</b><span>per trading day</span></div>
        </div>
        <div class="chiprow" role="group" aria-label="Time range">${pill(30, '1M')}${pill(90, '3M')}${pill(180, '6M')}${pill(365, '1Y')}<span style="flex:1"></span><button class="chip" type="button" data-chartview="${LPS.chartView === 'chart' ? 'table' : 'chart'}">${LPS.chartView === 'chart' ? 'Table' : 'Chart'}</button></div>
        ${LPS.chartView === 'chart'
          ? `<div class="chartwrap">${chartSVG(days)}</div><div class="chart-read" id="lp-read" aria-live="polite">${dayText(days[days.length - 1])}</div>`
          : `<div class="tablewrap"><table class="htable"><thead><tr><th>Date</th><th>Average</th><th>Low</th><th>High</th><th>Traded</th></tr></thead><tbody>${days.slice().reverse().slice(0, 60).map(d => `<tr><td>${d[0].slice(5)}</td><td>${compact(d[1])}</td><td>${compact(d[2])}</td><td>${compact(d[3])}</td><td>${qty(d[4])}</td></tr>`).join('')}</tbody></table></div>`}
        <p class="note">${days.length} day${days.length === 1 ? '' : 's'} with trades${HIST.regionName ? ` in ${esc(HIST.regionName)}` : ''}, from EVE's market API.${LPS.chartView === 'chart' ? ' Drag across the chart to read a day.' : ''}</p>`;
    },
    after() {
      const svg = $('#lp-chart');
      if (!svg) return;
      const days = inRange(HIST.rows[LPS.market] || []);
      const read = ev => {
        const box = svg.getBoundingClientRect();
        if (!box.width || !days.length) return;
        const x = ((ev.clientX - box.left) / box.width) * 340;
        const i = Math.max(0, Math.min(days.length - 1, Math.round(((x - 44) / (340 - 44 - 6)) * (days.length - 1))));
        const cross = $('#lp-cross');
        const cx = 44 + (days.length === 1 ? 0 : (i / (days.length - 1)) * (340 - 44 - 6));
        cross.setAttribute('x1', cx);
        cross.setAttribute('x2', cx);
        cross.setAttribute('visibility', 'visible');
        $('#lp-read').textContent = dayText(days[i]);
      };
      svg.addEventListener('pointerdown', read);
      svg.addEventListener('pointermove', read);
    },
    click(e) {
      let el;
      if ((el = e.target.closest('[data-range]'))) { LPS.range = Number(el.dataset.range); MB.fillSheet(); return; }
      if ((el = e.target.closest('[data-chartview]'))) { LPS.chartView = el.dataset.chartview; MB.fillSheet(); }
    }
  };

  window.addEventListener('mb:eiv-ready', () => { if (MB.screen() === 'lp') render(); });
  MB.lp = { state: LPS, ranked, rankStore };
  MB.screens.lp = {
    title: 'LP Store',
    // render() reranks the open store when a station, fee or price setting has changed.
    render
  };
})();
