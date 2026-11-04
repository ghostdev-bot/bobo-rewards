// Race to listing: every BOBO-quoted pair racing to $50K market cap, with live updates,
// plus an automatic tab for each pair that crosses $50K. Read-only; no wallet, no transactions.
// Live sources (free, CORS-friendly): Solana public RPC (bonding curves, read straight from chain)
// and DexScreener (BOBO price, graduated/DEX pools). Falls back to data/race.json if both fail.
(function () {
  'use strict';
  var BOBO = '4nV5gNwwP68zUDat26ySChREqVaQaLudfJBkSgEzpump';
  var TARGET = 50000, INIT_RT = 793100000;
  var PUBLIC_RPCS = ['https://solana-rpc.publicnode.com'];
  var HELIUS = (window.BR_CONFIG && window.BR_CONFIG.heliusRpc) || '';
  var HOLDER_RPCS = (HELIUS ? [HELIUS] : []).concat(PUBLIC_RPCS); // holders: Helius (domain-locked browser key) only when a graduated tab is open
  var LIVE_CURVES = 40;
  var FAST = 45000, SLOW = 90000, SHOW = 25;

  var S = { snap: null, grad: {}, liveGrad: lsGet('raceGrad', {}), rows: new Map(), boboUsd: null, live: false, lastLive: 0, lastErr: '', showAll: false, q: '', timer: null, ready: false, holders: {} };

  // ---------- utils ----------
  function lsGet(k, d) { try { var v = localStorage.getItem('br:' + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem('br:' + k, JSON.stringify(v)); } catch (e) {} }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function $(id) { return document.getElementById(id); }
  function usd(n) {
    if (n == null || !isFinite(n)) return '—';
    var a = Math.abs(n);
    if (a >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
    if (a >= 1e4) return '$' + (n / 1e3).toFixed(1) + 'K';
    if (a >= 1) return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 });
    if (a === 0) return '$0';
    if (a >= 0.01) return '$' + n.toFixed(3);
    return '$' + n.toPrecision(3);
  }
  function pct(n) { return n == null || !isFinite(n) ? '—' : (n > 0 ? '+' : '') + n.toFixed(Math.abs(n) >= 100 ? 0 : 1) + '%'; }
  function tzName() { try { return new Date().toLocaleTimeString('en-US', { timeZoneName: 'short' }).split(' ').pop(); } catch (e) { return ''; } }
  function fmtTime(ts) { return ts ? new Date(ts * 1000).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' ' + tzName() : '—'; }
  function ago(ms) { var s = Math.max(0, Math.round((Date.now() - ms) / 1000)); return s < 60 ? s + 's ago' : s < 3600 ? Math.round(s / 60) + 'm ago' : Math.round(s / 3600) + 'h ago'; }
  function short(a) { return a ? a.slice(0, 4) + '…' + a.slice(-4) : ''; }
  function slug(r) { return (String(r.sym || '').toLowerCase().replace(/[^a-z0-9]/g, '') || 'token'); }
  function b64(s) { var bin = atob(s), u = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }
  function u64(u, o) { return Number(new DataView(u.buffer, u.byteOffset).getBigUint64(o, true)); }
  function avatar(r, big) {
    var cls = big ? ' big' : '';
    return r.img && /^https:\/\//.test(r.img) ? '<img class="rimg' + cls + '" src="' + esc(r.img) + '" alt="" loading="lazy" referrerpolicy="no-referrer">' : '<span class="ava' + cls + '">' + esc((r.sym || '?').replace(/^\$/, '')[0] || '?') + '</span>';
  }
  function timeout(ms) { return typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(ms) : undefined; }
  async function getJson(url) { var r = await fetch(url, { signal: timeout(15000) }); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }
  async function rpc(method, params, onlyFirst, rpcs) {
    var list = rpcs || PUBLIC_RPCS, last; if (onlyFirst) list = list.slice(0, 1);
    for (var i = 0; i < list.length; i++) {
      try {
        var r = await fetch(list[i], { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: method, params: params }), signal: timeout(20000) });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        var j = await r.json(); if (j.error) throw new Error(j.error.message || 'rpc error');
        return j.result;
      } catch (e) { last = e; }
    }
    throw last;
  }

  // ---------- data ----------
  function computeCurve(r, c) {
    r.vt = c.vt; r.vq = c.vq; r.rt = c.rt; r.rq = c.rq; r.complete = c.complete;
    r.curvePct = c.complete ? 100 : Math.max(0, Math.min(100, (1 - c.rt / 1e6 / INIT_RT) * 100));
    if (c.complete || !c.vt || !S.boboUsd) return;
    r.priceBobo = c.vq / c.vt; r.priceUsd = r.priceBobo * S.boboUsd; r.mc = r.priceUsd * (r.supply || 1e9);
    r.liq = c.rq / 1e6 * S.boboUsd; r.src = 'onchain-curve'; r.dex = 'pumpfun'; r.pair = r.curve;
  }
  function parseCurve(data) {
    var u = b64(data);
    return { vt: u64(u, 0), vq: u64(u, 8), rt: u64(u, 16), rq: u64(u, 24), supply: u64(u, 32), complete: u[40] === 1, holderReward: u.length > 116 ? u[116] === 1 : false };
  }
  async function tickBobo() {
    // BOBO price plus DEX-listed pairs (graduated PumpSwap pools, Meteora, ...), 30 mints per call
    var dexMints = []; S.rows.forEach(function (r) { if (r.stage !== 'curve' || r.complete) dexMints.push(r.mint); });
    var all = [BOBO].concat(dexMints), best = {};
    for (var i = 0; i < all.length; i += 30) {
      var arr = await getJson('https://api.dexscreener.com/tokens/v1/solana/' + all.slice(i, i + 30).join(','));
      (arr || []).forEach(function (p) {
        var m = p.baseToken && p.baseToken.address; if (!m) return;
        if (m === BOBO && p.quoteToken.address === BOBO) return;
        var liq = (p.liquidity && p.liquidity.usd) || 0;
        if (!best[m] || ((p.marketCap ? 1 : 0) * 1e12 + liq) > ((best[m].marketCap ? 1 : 0) * 1e12 + ((best[m].liquidity && best[m].liquidity.usd) || 0))) best[m] = p;
      });
    }
    if (best[BOBO] && best[BOBO].priceUsd) { S.boboUsd = Number(best[BOBO].priceUsd); S.boboMc = best[BOBO].marketCap; }
    dexMints.forEach(function (m) {
      var p = best[m], r = S.rows.get(m); if (!p || !r || !p.marketCap) return;
      r.mc = p.marketCap; r.priceUsd = Number(p.priceUsd) || r.priceUsd; r.liq = p.liquidity ? p.liquidity.usd : r.liq;
      r.vol24 = p.volume ? p.volume.h24 : r.vol24; if (p.priceChange && p.priceChange.h24 != null) { r.chg24 = p.priceChange.h24; r.chgSrc = null; }
      r.dex = p.dexId; r.pair = p.pairAddress; r.src = 'dexscreener'; r.dsIndexed = true;
      if (p.info && p.info.imageUrl && !r.img) r.img = p.info.imageUrl;
    });
    return !!S.boboUsd;
  }
  async function tickCurves() {
    // Live reserves straight from the bonding curves, for the pairs that matter (the leaders and anything new).
    // publicnode is the browser-friendly free RPC here (api.mainnet-beta refuses browser origins); it allows
    // 10 accounts per getMultipleAccounts call, so 4 small calls cover the top 40.
    var list = []; S.rows.forEach(function (r) { if (r.curve && !r.complete) list.push(r); });
    list.sort(function (a, b) { return (b.isNew ? 1 : 0) - (a.isNew ? 1 : 0) || (b.mc || 0) - (a.mc || 0); });
    list = list.slice(0, LIVE_CURVES);
    var ok = 0;
    for (var i = 0; i < list.length; i += 10) {
      var chunk = list.slice(i, i + 10);
      var v = await rpc('getMultipleAccounts', [chunk.map(function (r) { return r.curve; }), { encoding: 'base64', dataSlice: { offset: 8, length: 117 } }], false, PUBLIC_RPCS);
      v.value.forEach(function (a, k) { if (a) { computeCurve(chunk[k], parseCurve(a.data[0])); ok++; } });
    }
    S.curveLive = ok;
  }
  async function tickNewPairs() {
    // New BOBO pairs show up on DexScreener's BOBO pair list within minutes of their first trades.
    var arr = await getJson('https://api.dexscreener.com/token-pairs/v1/solana/' + BOBO);
    (arr || []).forEach(function (p) {
      if (!p.quoteToken || p.quoteToken.address !== BOBO || !p.baseToken || p.baseToken.address === BOBO) return;
      var m = p.baseToken.address, r = S.rows.get(m);
      if (!r) {
        r = { mint: m, sym: p.baseToken.symbol, name: p.baseToken.name, img: p.info && p.info.imageUrl, supply: 1e9, isNew: true,
          curve: p.dexId === 'pumpfun' ? p.pairAddress : null, stage: p.dexId === 'pumpfun' ? 'curve' : p.dexId, pair: p.pairAddress, dex: p.dexId, dsIndexed: true,
          createdAt: p.pairCreatedAt ? Math.floor(p.pairCreatedAt / 1000) : null };
        S.rows.set(m, r);
      }
      if (r.isNew && S.boboUsd && p.priceNative && r.src !== 'onchain-curve') {
        r.priceBobo = Number(p.priceNative); r.priceUsd = r.priceBobo * S.boboUsd; r.mc = p.marketCap || r.priceUsd * (r.supply || 1e9); r.src = 'dexscreener-native';
      }
    });
  }
  async function tickPools() {
    // PumpSwap pools DexScreener has not indexed: price from the pool's two token accounts
    var list = [], rows = [];
    S.rows.forEach(function (r) { if (r.poolTa && !r.dsIndexed) { list.push(r.poolTa[0], r.poolTa[1]); rows.push(r); } });
    if (!list.length || !S.boboUsd) return;
    var v = { value: [] };
    for (var i = 0; i < list.length; i += 10) { var part = await rpc('getMultipleAccounts', [list.slice(i, i + 10), { encoding: 'jsonParsed' }]); v.value = v.value.concat(part.value); }
    rows.forEach(function (r, k) {
      var b = v.value[2 * k], q = v.value[2 * k + 1];
      var bb = b && Number(b.data.parsed.info.tokenAmount.uiAmount), qq = q && Number(q.data.parsed.info.tokenAmount.uiAmount);
      if (!bb) return;
      r.priceBobo = qq / bb; r.priceUsd = r.priceBobo * S.boboUsd; r.mc = r.priceUsd * (r.supply || 1e9); r.liq = 2 * qq * S.boboUsd; r.src = 'onchain-pool';
    });
  }
  var ticking = false;
  async function tick() {
    if (ticking) return; ticking = true;
    var ok = 0, errs = [];
    try { if (await tickBobo()) ok++; } catch (e) { errs.push('DexScreener'); }
    try { await tickNewPairs(); } catch (e) {}
    try { await tickCurves(); ok++; } catch (e) { errs.push('Solana RPC'); }
    try { await tickPools(); } catch (e) {}
    ticking = false;
    if (ok) { S.live = true; S.lastLive = Date.now(); }
    S.lastErr = errs.join(' + ');
    checkGraduation();
    renderAll();
    schedule();
  }
  function schedule() {
    clearTimeout(S.timer);
    if (document.hidden) return;
    var onRace = /^#\/(race|listed\/)/.test(location.hash);
    S.timer = setTimeout(tick, onRace ? FAST : SLOW);
  }
  document.addEventListener('visibilitychange', function () { if (!document.hidden && S.ready) { if (Date.now() - S.lastLive > FAST) tick(); else schedule(); } });

  // ---------- graduation ----------
  function checkGraduation() {
    var changed = false;
    S.rows.forEach(function (r) {
      if (r.mc == null || r.mc < TARGET || S.grad[r.mint] || S.liveGrad[r.mint]) return;
      S.liveGrad[r.mint] = { sym: r.sym, name: r.name, crossedAt: Math.floor(Date.now() / 1000), mcAtCross: Math.round(r.mc), pair: r.pair, how: 'live' };
      changed = true;
    });
    if (changed) { lsSet('raceGrad', S.liveGrad); buildGradTabs(); }
  }
  function gradList() {
    var out = [], seen = {};
    function add(m, g) { if (seen[m]) return; seen[m] = 1; var r = S.rows.get(m) || { mint: m, sym: g.sym, name: g.name, pair: g.pair }; out.push({ mint: m, g: g, r: r }); }
    Object.keys(S.grad).forEach(function (m) { add(m, S.grad[m]); });
    Object.keys(S.liveGrad).forEach(function (m) { add(m, S.liveGrad[m]); });
    out.sort(function (a, b) { return (a.g.crossedAt || 0) - (b.g.crossedAt || 0); });
    var used = {};
    out.forEach(function (x) { var s = slug(x.r); if (used[s]) s += '-' + x.mint.slice(0, 4).toLowerCase(); used[s] = 1; x.slug = s; x.hash = x.g.existingTab || x.r.existingTab || ('#/listed/' + s); x.pane = 'g-' + x.mint.slice(0, 8); x.own = !(x.g.existingTab || x.r.existingTab); });
    return out;
  }
  function buildGradTabs() {
    var bar = document.querySelector('.tabs [role=tablist]'), raceTab = document.querySelector('.tab[data-tab=race]');
    if (!bar || !raceTab) return;
    var after = raceTab, added = false;
    gradList().forEach(function (x) {
      if (!x.own) return;
      var tab = document.querySelector('.tab[data-tab="' + x.pane + '"]');
      if (!tab) {
        tab = document.createElement('a'); tab.className = 'tab gtab'; tab.setAttribute('role', 'tab'); tab.dataset.tab = x.pane;
        tab.innerHTML = '🏁 $' + esc(String(x.r.sym || x.g.sym).replace(/^\$/, ''));
        after.insertAdjacentElement('afterend', tab); added = true;
        var pane = document.createElement('main'); pane.className = 'wrap pane hidden'; pane.dataset.pane = x.pane;
        pane.innerHTML = '<section class="sec gsec" id="' + x.pane + '-root"></section>';
        var last = document.querySelectorAll('main.pane'); last[last.length - 1].insertAdjacentElement('afterend', pane);
      }
      tab.href = x.hash; after = tab;
    });
    if (added) window.dispatchEvent(new HashChangeEvent('hashchange'));
  }

  // ---------- render: race ----------
  function sortedRows() {
    var arr = []; S.rows.forEach(function (r) { arr.push(r); });
    arr.sort(function (a, b) { return (b.mc || 0) - (a.mc || 0); });
    return arr;
  }
  function chartUrl(r) { return 'https://dexscreener.com/solana/' + encodeURIComponent(r.pair || r.mint); }
  function statusHtml() {
    if (S.live && !S.lastErr) return '<span class="live"><i></i>Live</span> updated ' + ago(S.lastLive) + ' · refreshes every ' + (FAST / 1000) + 's';
    if (S.live) return '<span class="live warn"><i></i>Partly live</span> updated ' + ago(S.lastLive) + ' · ' + esc(S.lastErr) + ' unavailable, those numbers are from the snapshot';
    return '<span class="live off"><i></i>Snapshot</span> live sources unavailable right now, showing the ' + fmtTime(S.snap && S.snap.generatedAt) + ' snapshot';
  }
  function renderRace() {
    var root = $('raceRoot'); if (!root || !S.snap) return;
    var rows = sortedRows(), racing = rows.filter(function (r) { return !(S.grad[r.mint] || S.liveGrad[r.mint]); });
    var lead = racing[0], gl = gradList();
    var nCurve = rows.filter(function (r) { return r.curve && !r.complete; }).length;
    $('raceCards').innerHTML =
      '<div class="card hl"><div class="k">Target</div><div class="v">$50K MC</div><div class="s">a pair that gets there gets its own tab</div></div>' +
      '<div class="card"><div class="k">Closest to $50K</div><div class="v">' + (lead ? '$' + esc(lead.sym) : '—') + '</div><div class="s">' + (lead ? usd(lead.mc) + ' · ' + Math.min(100, (lead.mc || 0) / TARGET * 100).toFixed(1) + '% of the way' : '') + '</div></div>' +
      '<div class="card"><div class="k">BOBO pairs tracked</div><div class="v">' + rows.length + '</div><div class="s">' + nCurve + ' on the bonding curve · ' + (rows.length - nCurve) + ' on a DEX</div></div>' +
      '<div class="card"><div class="k">Graduated</div><div class="v">' + gl.length + '</div><div class="s">' + (gl.length ? gl.map(function (x) { return '<a href="' + esc(x.hash) + '">$' + esc(x.r.sym || x.g.sym) + '</a>'; }).join(' · ') : 'none yet') + '</div></div>';
    $('raceStatus').innerHTML = statusHtml() + (S.boboUsd ? ' · BOBO ' + usd(S.boboUsd) : '');
    var q = S.q.trim().toLowerCase();
    var list = q ? rows.filter(function (r) { return (r.sym + ' ' + r.name + ' ' + r.mint).toLowerCase().indexOf(q) >= 0; }) : rows;
    var shown = S.showAll || q ? list : list.slice(0, SHOW);
    $('raceRows').innerHTML = shown.map(function (r) {
      var rank = rows.indexOf(r) + 1, p = Math.min(100, (r.mc || 0) / TARGET * 100), g = S.grad[r.mint] || S.liveGrad[r.mint];
      var gx = g && gl.filter(function (x) { return x.mint === r.mint; })[0];
      var stage = r.complete || r.stage === 'pumpswap' ? 'PumpSwap' : r.curve ? 'curve ' + (r.curvePct || 0).toFixed(0) + '%' : esc(r.dex || r.stage || 'DEX');
      var badge = g ? '<a class="gbadge" href="' + esc(gx ? gx.hash : '#/race') + '">🏁 hit $50K</a>' : r.isNew ? '<span class="nbadge">new</span>' : '';
      var chg = r.chg24 == null ? '—' : '<span class="' + (r.chg24 >= 0 ? 'up' : 'down') + '">' + pct(r.chg24) + '</span>' + (r.chgSrc === 'snapshot' ? '<sup title="vs our snapshot ~24h ago">*</sup>' : '');
      var bar = '<div class="rbar' + (p >= 100 ? ' done' : '') + '"><i data-w="' + p.toFixed(2) + '"></i></div><div class="rmc"><b>' + usd(r.mc) + '</b><span class="muted">' + p.toFixed(1) + '% of $50K</span></div>';
      return '<tr' + (g ? ' class="grad"' : '') + '><td class="r muted">' + rank + '</td>' +
        '<td class="rtok"><span class="tcell">' + avatar(r) + '<span class="rn"><span><b>$' + esc(r.sym) + '</b> ' + badge + '</span><small>' + esc(r.name) + ' · ' + stage + '</small></span></span>' + bar + '</td>' +
        '<td class="rprog">' + bar + '</td>' +
        '<td class="r">' + usd(r.priceUsd) + '</td><td class="r">' + (r.vol24 == null ? '<span class="muted">—</span>' : usd(r.vol24)) + '</td><td class="r">' + usd(r.liq) + '</td><td class="r">' + chg + '</td>' +
        '<td><a href="' + esc(chartUrl(r)) + '" target="_blank" rel="noopener">Chart ↗</a></td></tr>';
    }).join('') || '<tr><td colspan="8" class="muted">No pairs match.</td></tr>';
    Array.prototype.forEach.call($('raceRows').querySelectorAll('i[data-w]'), function (el) { el.style.width = el.dataset.w + '%'; }); // CSSOM, allowed by the CSP
    var more = $('raceMore');
    more.classList.toggle('hidden', !!q || list.length <= SHOW);
    more.textContent = S.showAll ? 'Show top ' + SHOW + ' only' : 'Show all ' + list.length + ' pairs';
  }
  function setupRacePane() {
    var root = $('raceRoot'); if (!root || root.dataset.wired) return; root.dataset.wired = 1;
    $('raceMore').addEventListener('click', function () { S.showAll = !S.showAll; renderRace(); });
    $('raceQ').addEventListener('input', function (e) { S.q = e.target.value; renderRace(); });
  }

  // ---------- render: graduated tab ----------
  function renderGrad(x) {
    var root = $(x.pane + '-root'); if (!root) return;
    var r = S.rows.get(x.mint) || x.r, g = x.g, sym = esc(r.sym || g.sym);
    var embed = r.dsIndexed || r.src === 'dexscreener' ? '<div class="gchart"><iframe title="$' + sym + ' chart on DexScreener" loading="lazy" referrerpolicy="no-referrer" sandbox="allow-scripts allow-same-origin allow-popups" src="https://dexscreener.com/solana/' + encodeURIComponent(r.pair || x.mint) + '?embed=1&loadChartSettings=0&trades=0&tabs=0&info=0&chartLeftToolbar=0&chartTheme=dark&theme=dark&chartStyle=1&chartType=usd&interval=15"></iframe></div>'
      : '<div class="note">DexScreener has not indexed this pool yet, so there is no chart to embed. <a href="' + esc(chartUrl(r)) + '" target="_blank" rel="noopener">Open on DexScreener ↗</a></div>';
    var stage = r.complete || r.stage === 'pumpswap' ? 'PumpSwap pool (bonding curve complete)' : r.curve ? 'pump.fun bonding curve, ' + (r.curvePct || 0).toFixed(1) + '% sold' : esc(r.dex || 'DEX') + ' pool';
    var head = '<div class="secHead"><div class="ghead">' + avatar(r, true) + '<div><h2>$' + sym + ' <span class="gbadge">🏁 hit $50K MC</span></h2><p class="muted">' + esc(r.name || g.name) + ' · a BOBO pair · ' + stage + '</p></div></div></div>';
    var cards = '<div class="cards">' +
      '<div class="card hl"><div class="k">Market cap</div><div class="v">' + usd(r.mc) + '</div><div class="s">' + (r.mc != null ? ((r.mc / TARGET) * 100).toFixed(0) + '% of the $50K mark' : '') + '</div></div>' +
      '<div class="card"><div class="k">Price</div><div class="v">' + usd(r.priceUsd) + '</div><div class="s">' + (r.priceBobo ? r.priceBobo.toPrecision(3) + ' BOBO' : '') + '</div></div>' +
      '<div class="card"><div class="k">24h change</div><div class="v ' + (r.chg24 >= 0 ? 'up' : 'down') + '">' + pct(r.chg24) + '</div><div class="s">24h volume ' + usd(r.vol24) + '</div></div>' +
      '<div class="card"><div class="k">Liquidity</div><div class="v">' + usd(r.liq) + '</div><div class="s">' + (r.curve && !r.complete ? 'BOBO in the curve' : 'pool liquidity') + '</div></div>' +
      '<div class="card"><div class="k">Crossed $50K</div><div class="v sm2">' + fmtTime(g.crossedAt) + '</div><div class="s">' + (g.how === 'live' ? 'seen live in this browser, recorded at the next refresh' : g.baseline ? 'already above $50K when tracking began' : 'recorded by the refresh at ' + usd(g.mcAtCross) + ' MC') + '</div></div>' +
      '</div>';
    var links = '<p class="glinks"><a href="' + esc(chartUrl(r)) + '" target="_blank" rel="noopener">DexScreener ↗</a>' +
      '<a href="https://pump.fun/coin/' + encodeURIComponent(x.mint) + '" target="_blank" rel="noopener">pump.fun ↗</a>' +
      '<a href="https://solscan.io/token/' + encodeURIComponent(x.mint) + '" target="_blank" rel="noopener">Token on Solscan ↗</a>' +
      (r.pair ? '<a href="https://solscan.io/account/' + encodeURIComponent(r.pair) + '" target="_blank" rel="noopener">Pool on Solscan ↗</a>' : '') + '</p>' +
      '<div class="gaddr muted sm">Mint <code>' + esc(x.mint) + '</code>' + (r.pair ? ' · Pool <code>' + esc(r.pair) + '</code>' : '') + ' · Quote: BOBO</div>';
    var rew = r.holderReward ? '<div class="note">$' + sym + ' is a pump.fun holder-rewards coin quoted in BOBO, so its holders are paid in <b>BOBO</b>. Paste a wallet on the <a href="#/">Rewards tab</a> to see what it received.</div>' : '';
    var h = S.holders[x.mint];
    var hold = '<h3 class="gh3">Top holders</h3><div class="tblWrap"><table class="tbl"><thead><tr><th class="r">#</th><th>Wallet</th><th class="r">$' + sym + '</th><th class="r">% of supply</th></tr></thead><tbody>' +
      (h && h.rows ? h.rows.map(function (o, i) { return '<tr><td class="r">' + (i + 1) + '</td><td><a class="mono" href="https://solscan.io/account/' + esc(o.owner) + '" target="_blank" rel="noopener" title="' + esc(o.owner) + '">' + esc(short(o.owner)) + '</a>' + (o.label ? ' <span class="muted sm">' + esc(o.label) + '</span>' : (r.holderReward ? '<a class="x" href="#/w/' + esc(o.owner) + '">rewards ›</a>' : '')) + '</td><td class="r">' + Math.round(o.amt).toLocaleString('en-US') + '</td><td class="r">' + (o.amt / (r.supply || 1e9) * 100).toFixed(2) + '%</td></tr>'; }).join('')
        : '<tr><td colspan="4" class="muted">' + (h && h.err ? 'Could not load holders right now.' : 'Loading…') + '</td></tr>') + '</tbody></table></div>' + (h && h.snapAt ? '<p class="muted sm">Holders snapshot from ' + fmtTime(h.snapAt) + ' (live holder lookup unavailable).</p>' : '');
    root.innerHTML = head + '<p class="muted sm">' + statusHtml() + ' · <a href="#/race">← back to the race</a></p>' + cards + rew + embed + links + hold;
    if (!h || (Date.now() - h.at > 300000 && !h.loading)) loadHolders(x.mint, r);
  }
  async function loadHolders(mint, r) {
    var h = S.holders[mint] = S.holders[mint] || {}; h.loading = true;
    try {
      var big = await rpc('getTokenLargestAccounts', [mint], false, HOLDER_RPCS);
      var accts = (big.value || []).slice(0, 20);
      var info = await rpc('getMultipleAccounts', [accts.map(function (a) { return a.address; }), { encoding: 'jsonParsed' }], false, HOLDER_RPCS);
      var known = {}; if (r.curve) known[r.curve] = 'bonding curve'; if (r.pool) known[r.pool] = 'PumpSwap pool'; if (r.pair) known[r.pair] = known[r.pair] || 'pool';
      h.rows = accts.map(function (a, i) { var o = info.value[i] && info.value[i].data.parsed.info.owner; return { owner: o || a.address, amt: Number(a.uiAmount || 0), label: known[o] || '' }; });
      h.err = false;
    } catch (e) {
      var gg = S.grad[mint]; // fall back to the holders snapshot the refresh script saved
      if (gg && gg.holders) { h.rows = gg.holders.map(function (o) { return { owner: o.owner, amt: o.amt, label: o.label || '' }; }); h.snapAt = gg.holdersAt; h.err = false; } else h.err = true;
    }
    h.loading = false; h.at = Date.now();
    var x = gradList().filter(function (y) { return y.mint === mint; })[0];
    if (x && curPane() === x.pane) renderGrad(x);
  }
  function curPane() { var el = document.querySelector('main.pane:not(.hidden)'); return el && el.dataset.pane; }
  function renderAll() {
    var p = curPane();
    if (p === 'race') renderRace();
    else { var x = gradList().filter(function (y) { return y.pane === p; })[0]; if (x) renderGrad(x); }
  }

  // ---------- routing hooks used by app.js ----------
  window.BR_EXT = {
    route: function (h) {
      if (h === '#/race') return 'race';
      var m = /^#\/listed\/([a-z0-9-]+)$/.exec(h);
      if (m) { var x = gradList().filter(function (y) { return y.own && y.slug === m[1]; })[0]; return x ? x.pane : 'race'; }
      return null;
    },
    render: function (pane) {
      if (pane === 'race') { setupRacePane(); renderRace(); if (S.ready && Date.now() - S.lastLive > FAST) tick(); return true; }
      var x = gradList().filter(function (y) { return y.pane === pane; })[0];
      if (x) { renderGrad(x); return true; }
      return false;
    },
  };

  // ---------- boot ----------
  (async function boot() {
    try {
      var j = await Promise.all([getJson('data/race.json'), getJson('data/race-graduated.json').catch(function () { return { graduated: {} }; })]);
      S.snap = j[0]; S.grad = (j[1] && j[1].graduated) || {}; S.boboUsd = S.snap.boboUsd;
      S.snap.pairs.forEach(function (r) { S.rows.set(r.mint, Object.assign({}, r)); });
      Object.keys(S.liveGrad).forEach(function (m) { if (S.grad[m]) delete S.liveGrad[m]; }); lsSet('raceGrad', S.liveGrad);
    } catch (e) {
      S.snap = { generatedAt: 0, pairs: [] };
    }
    S.ready = true;
    buildGradTabs();
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    tick();
  })();
})();
