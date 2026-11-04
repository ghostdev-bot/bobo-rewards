#!/usr/bin/env node
// Race to listing: discovers every BOBO pair and snapshots its market cap into site/data/race.json,
// and records $50k crossings (sticky) in site/data/race-graduated.json.
//
// A "BOBO pair" = a token whose pool is quoted in BOBO (same definition the GRR/STORMIE tabs use):
//   1. pump.fun bonding curves with quote_mint = BOBO (on-chain getProgramAccounts, memcmp @83)
//   2. PumpSwap pools with quote_mint = BOBO (on-chain getProgramAccounts, memcmp @75), i.e. graduated curves
//   3. any other DexScreener pool whose quote token is BOBO (e.g. Meteora)
// Free sources only: Solana public RPC (api.mainnet-beta) + DexScreener. Helius is a fallback for the two
// getProgramAccounts calls only (~20 credits) if the public RPC refuses. No transactions, read-only.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { readJson, writeJson, b58enc } from './lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'site/data/race.json');
const GRAD = path.join(ROOT, 'site/data/race-graduated.json');
const STATE = path.join(ROOT, '.cache/race-state.json');
const BOBO = '4nV5gNwwP68zUDat26ySChREqVaQaLudfJBkSgEzpump';
const PUMP = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
const PAMM = 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA';
const T22 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb', TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TARGET = 50000;
// Tokens that already have their own tab: they still race, but graduate by linking to the existing tab.
const EXISTING = { DBEjiLMt9USaM3SdC9YtNcKGnXLdFhzokwnykH4Wpump: '#/leaders/grr', HqyTxEqk7qmLu2Gnx46eEZwQhzCf2yVqRompLaKYpump: '#/leaders/stormie' };
const PUB = 'https://api.mainnet-beta.solana.com';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.error('[race]', ...a);

let lastPub = 0;
async function pub(method, params, tries = 5) {
  let last;
  for (let t = 0; t < tries; t++) {
    const w = lastPub + 250 - Date.now(); if (w > 0) await sleep(w); lastPub = Date.now();
    try {
      const r = await fetch(PUB, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(30000) });
      if (r.status === 429 || r.status >= 500) throw new Error('HTTP ' + r.status);
      const j = await r.json(); if (j.error) throw new Error(j.error.message);
      return j.result;
    } catch (e) { last = e; await sleep(800 * (t + 1)); }
  }
  throw last;
}
async function gpa(program, params) {
  try { return await pub('getProgramAccounts', [program, params]); }
  catch (e) {
    log('public gPA failed (' + e.message + '), falling back to Helius');
    const { rpc } = await import('./lib.mjs');
    return rpc('getProgramAccounts', [program, params], 3);
  }
}
async function ds(url) {
  for (let t = 0; t < 4; t++) {
    try { const r = await fetch(url, { signal: AbortSignal.timeout(20000) }); if (r.ok) return r.json(); if (r.status !== 429) return null; } catch {}
    await sleep(1500 * (t + 1));
  }
  return null;
}
const u64 = (b, o) => Number(b.readBigUInt64LE(o));

const state = readJson(STATE, { curveMint: {}, meta: {}, hist: {} });
const prevGrad = readJson(GRAD, { rule: '', graduated: {} });
const prevOut = readJson(OUT, null);
const now = Math.floor(Date.now() / 1000);

// ---- 1. on-chain: pump.fun curves quoted in BOBO
const curveRaw = await gpa(PUMP, { encoding: 'base64', dataSlice: { offset: 8, length: 117 }, filters: [{ memcmp: { offset: 83, bytes: BOBO } }] });
const curves = curveRaw.map(a => {
  const b = Buffer.from(a.account.data[0], 'base64');
  return { curve: a.pubkey, vt: u64(b, 0), vq: u64(b, 8), rt: u64(b, 16), rq: u64(b, 24), supply: u64(b, 32), complete: b[40] === 1, holderReward: b[116] === 1 };
});
log('curves quoted in BOBO:', curves.length);
// ---- 2. on-chain: PumpSwap pools quoted in BOBO
const poolRaw = await gpa(PAMM, { encoding: 'base64', dataSlice: { offset: 43, length: 160 }, filters: [{ memcmp: { offset: 75, bytes: BOBO } }] });
const pools = poolRaw.map(a => { const b = Buffer.from(a.account.data[0], 'base64'); return { pool: a.pubkey, mint: b58enc(b.subarray(0, 32)), baseTa: b58enc(b.subarray(96, 128)), quoteTa: b58enc(b.subarray(128, 160)) }; });
log('pumpswap pools quoted in BOBO:', pools.length);

// ---- resolve curve -> mint (cached forever; only new curves cost calls)
let resolved = 0;
for (const c of curves) {
  if (state.curveMint[c.curve]) continue;
  for (const prog of [T22, TOKEN]) {
    try {
      const r = await pub('getTokenAccountsByOwner', [c.curve, { programId: prog }, { encoding: 'jsonParsed' }]);
      const m = (r?.value || []).map(v => v.account.data.parsed.info.mint).find(m => m !== BOBO);
      if (m) { state.curveMint[c.curve] = m; resolved++; break; }
    } catch (e) { log('resolve', c.curve, e.message); }
  }
}
log('resolved new curve mints:', resolved);
for (const c of curves) c.mint = state.curveMint[c.curve];

// ---- 3. DexScreener: BOBO price + every BOBO-quoted pool (any dex)
const dsPairs = new Map();
for (const url of [`https://api.dexscreener.com/token-pairs/v1/solana/${BOBO}`, `https://api.dexscreener.com/latest/dex/search?q=${BOBO}`]) {
  const j = await ds(url); const arr = Array.isArray(j) ? j : j?.pairs || [];
  for (const p of arr) if (p.chainId === 'solana') dsPairs.set(p.pairAddress, p);
}
const boboPairs = [...dsPairs.values()].filter(p => p.baseToken.address === BOBO);
const boboMain = boboPairs.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0];
const boboUsd = Number(boboMain?.priceUsd) || prevOut?.boboUsd;
if (!boboUsd) throw new Error('no BOBO price');
log('BOBO $' + boboUsd);

// candidate mints
const entries = new Map(); // mint -> entry
const ent = mint => { if (!entries.has(mint)) entries.set(mint, { mint }); return entries.get(mint); };
for (const c of curves) if (c.mint) Object.assign(ent(c.mint), { curve: c.curve, complete: c.complete, holderReward: c.holderReward, supply: c.supply / 1e6, _c: c });
for (const p of pools) Object.assign(ent(p.mint), { pool: p.pool, _p: p });
for (const p of dsPairs.values()) if (p.quoteToken.address === BOBO) ent(p.baseToken.address);

// DexScreener per-token data (batches of 30 mints)
const mints = [...entries.keys()];
const dsTok = new Map();

for (let i = 0; i < mints.length; i += 30) {
  const arr = await ds(`https://api.dexscreener.com/tokens/v1/solana/${mints.slice(i, i + 30).join(',')}`) || [];
  for (const p of arr) { if (p.chainId !== 'solana') continue; const m = p.baseToken.address; if (!dsTok.has(m)) dsTok.set(m, []); dsTok.get(m).push(p); }
  await sleep(250);
}

// on-chain metadata (Token-2022 metadata extension) + supply for mints we have not seen yet
const needMeta = mints.filter(m => !state.meta[m]);
for (let i = 0; i < needMeta.length; i += 100) {
  try {
    const r = await pub('getMultipleAccounts', [needMeta.slice(i, i + 100), { encoding: 'jsonParsed' }]);
    r.value.forEach((a, k) => {
      const info = a?.data?.parsed?.info; if (!info) return;
      const md = (info.extensions || []).find(e => e.extension === 'tokenMetadata')?.state || {};
      state.meta[needMeta[i + k]] = { name: md.name || '', sym: md.symbol || '', dec: info.decimals, supply: Number(info.supply) / 10 ** info.decimals, prog: a.owner };
    });
  } catch (e) { log('meta', e.message); }
}
// pool reserves for PumpSwap pools (works whether or not DexScreener indexed them)
const taList = pools.flatMap(p => [p.baseTa, p.quoteTa]);
const taBal = {};
for (let i = 0; i < taList.length; i += 100) {
  try { const r = await pub('getMultipleAccounts', [taList.slice(i, i + 100), { encoding: 'jsonParsed' }]); r.value.forEach((a, k) => { taBal[taList[i + k]] = Number(a?.data?.parsed?.info?.tokenAmount?.uiAmount || 0); }); } catch (e) { log('pool reserves', e.message); }
}

const INIT_RT = 793100000; // pump.fun curves start with 793.1M real tokens for sale
const out = [];
for (const e of entries.values()) {
  const meta = state.meta[e.mint] || {};
  const dp = (dsTok.get(e.mint) || []).filter(p => p.quoteToken.address === BOBO || p.dexId !== 'pumpfun');
  const best = dp.filter(p => p.marketCap).sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0];
  const anyDs = best || (dsTok.get(e.mint) || [])[0] || [...dsPairs.values()].find(p => p.baseToken.address === e.mint);
  const r = {
    mint: e.mint, sym: anyDs?.baseToken.symbol || meta.sym || e.mint.slice(0, 4), name: anyDs?.baseToken.name || meta.name || '',
    img: anyDs?.info?.imageUrl || null, supply: e.supply || meta.supply || 1e9,
    curve: e.curve || null, pool: e.pool || null, poolTa: e._p ? [e._p.baseTa, e._p.quoteTa] : null, complete: !!e.complete, holderReward: !!e.holderReward,
    stage: e.pool || e.complete ? 'pumpswap' : e.curve ? 'curve' : (anyDs?.dexId || 'dex'),
    pair: e.pool || e.curve || anyDs?.pairAddress || null, dex: null,
    priceBobo: null, priceUsd: null, mc: null, liq: null, vol24: null, chg24: null, txns24: null, createdAt: anyDs?.pairCreatedAt ? Math.floor(anyDs.pairCreatedAt / 1000) : null, src: null,
  };
  if (best) {
    Object.assign(r, { dex: best.dexId, pair: best.pairAddress, priceBobo: best.quoteToken.address === BOBO ? Number(best.priceNative) : null, priceUsd: Number(best.priceUsd) || null, mc: best.marketCap, liq: best.liquidity?.usd ?? null, vol24: best.volume?.h24 ?? null, chg24: best.priceChange?.h24 ?? null, src: 'dexscreener' });
  } else if (e._p && taBal[e._p.baseTa]) {
    const pb = taBal[e._p.quoteTa] / taBal[e._p.baseTa];
    Object.assign(r, { dex: 'pumpswap', pair: e.pool, priceBobo: pb, priceUsd: pb * boboUsd, mc: pb * boboUsd * r.supply, liq: 2 * taBal[e._p.quoteTa] * boboUsd, src: 'onchain-pool' });
  } else if (e._c && !e._c.complete && e._c.vt) {
    const pb = e._c.vq / e._c.vt;
    Object.assign(r, { dex: 'pumpfun', pair: e.curve, priceBobo: pb, priceUsd: pb * boboUsd, mc: pb * boboUsd * r.supply, liq: e._c.rq / 1e6 * boboUsd, src: 'onchain-curve' });
  } else if (anyDs?.priceNative && anyDs.quoteToken.address === BOBO) {
    const pb = Number(anyDs.priceNative);
    Object.assign(r, { dex: anyDs.dexId, pair: anyDs.pairAddress, priceBobo: pb, priceUsd: pb * boboUsd, mc: pb * boboUsd * r.supply, src: 'dexscreener-native' });
  }
  if (e._c && !e._c.complete) r.curvePct = Math.max(0, Math.min(100, (1 - e._c.rt / 1e6 / INIT_RT) * 100));
  if (e._c?.complete) r.curvePct = 100;
  const tx = anyDs?.txns?.h24; if (tx) r.txns24 = (tx.buys || 0) + (tx.sells || 0);
  if (r.vol24 == null && best == null && anyDs?.volume) r.vol24 = null; // DexScreener reports 0 volume for BOBO-quoted curves; leave unknown
  // 24h change fallback from our own 6-hourly history
  const h = (state.hist[e.mint] || []).filter(([t]) => now - t < 40 * 3600);
  if (r.mc != null) h.push([now, Math.round(r.mc)]);
  state.hist[e.mint] = h.slice(-10);
  if (r.chg24 == null && r.mc != null) { const old = h.filter(([t]) => now - t >= 18 * 3600)[0]; if (old && old[1]) { r.chg24 = (r.mc / old[1] - 1) * 100; r.chgSrc = 'snapshot'; } }
  r.existingTab = EXISTING[r.mint] || null;
  r.dsIndexed = dsTok.has(r.mint) || [...dsPairs.values()].some(p => p.baseToken.address === r.mint) || undefined;
  out.push(r);
}
out.sort((a, b) => (b.mc || 0) - (a.mc || 0));

// ---- graduation: sticky record of the first time a pair is seen at/above $50k
const grad = prevGrad.graduated || {};
for (const r of out) {
  if (r.mc == null || r.mc < TARGET || grad[r.mint]) continue;
  grad[r.mint] = { sym: r.sym, name: r.name, crossedAt: now, baseline: !fs.existsSync(GRAD) || undefined, mcAtCross: Math.round(r.mc), pair: r.pair, dex: r.dex, existingTab: r.existingTab, how: 'refresh' };
  log('GRADUATED', r.sym, Math.round(r.mc));
}
for (const r of out) if (grad[r.mint]) r.graduated = true;
// top-20 holders snapshot for graduated pairs that get their own tab (fallback when the browser can't look them up live)
for (const [m, g] of Object.entries(grad)) {
  if (g.existingTab) continue;
  try {
    const big = (await pub('getTokenLargestAccounts', [m])).value.slice(0, 20);
    const info = await pub('getMultipleAccounts', [big.map(a => a.address), { encoding: 'jsonParsed' }]);
    const r = out.find(x => x.mint === m) || {};
    const lbl = { [r.curve]: 'bonding curve', [r.pool]: 'PumpSwap pool', [r.pair]: 'pool' };
    g.holders = big.map((a, i) => { const o = info.value[i]?.data?.parsed?.info?.owner || a.address; return { owner: o, amt: Number(a.uiAmount || 0), label: lbl[o] || undefined }; });
    g.holdersAt = now;
  } catch (e) { log('holders', g.sym, e.message); }
}
writeJson(GRAD, { rule: 'Sticky: a pair graduates the first time its market cap is seen at or above $50,000 (by this 6-hourly refresh, or live in a browser, which shows the tab right away). Once recorded it keeps its tab even if the market cap later dips.', target: TARGET, updatedAt: now, graduated: grad });
writeJson(OUT, { generatedAt: now, target: TARGET, bobo: BOBO, boboUsd, boboMc: boboMain?.marketCap ?? null, counts: { curves: curves.length, pools: pools.length, dexOther: out.filter(r => !r.curve && !r.pool).length, total: out.length },
  excluded: boboPairs.filter(p => p.baseToken.address === BOBO).map(p => ({ pair: p.pairAddress, dex: p.dexId, quote: p.quoteToken.symbol, why: 'BOBO is the base token (BOBO market, not a token launched against BOBO)' })),
  pairs: out });
writeJson(STATE, state);
log(`race.json: ${out.length} pairs (${curves.length} curves, ${pools.length} pumpswap pools), ${Object.keys(grad).length} graduated`);
