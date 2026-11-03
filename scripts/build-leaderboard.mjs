#!/usr/bin/env node
// Builds site/data/leaderboard.json: top receivers of BOBO-family holder rewards.
//  - "sol":  SOL paid to $BOBO holders by $BOBO's pump.fun holder-rewards vault
//  - "bobo": BOBO paid to $GRR and $STORMIE holders by those coins' vaults (both coins are quoted in BOBO)
// Source: every DistributeFeeToHolders tx of each vault (Helius getTransactionsForAddress, oldest first).
// Per-wallet amount = that wallet's positive SOL / BOBO balance change in the distribution tx.
// Incremental: aggregates are cached in .cache/leaderboard-state.json (outside the site), so reruns
// only fetch transactions newer than the last processed slot. Pass --full to rebuild from scratch.
import path from 'path';
import { fileURLToPath } from 'url';
import { SOL, BOBO, GRR, STORMIE, gtfaAll, distEvents, allKeys, sig, readJson, writeJson, credits } from './lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STATE = path.join(ROOT, '.cache/leaderboard-state.json');
const OUT = path.join(ROOT, 'site/data/leaderboard.json');
const TOP = 25;
const VAULTS = [
  { sym: 'BOBO', mint: BOBO, quote: SOL, vault: '3aBa3DQdupVLbdEUWSRUCZ3dtQyQG1myLawx5CkniH8K' },
  { sym: 'GRR', mint: GRR, quote: BOBO, vault: '7soPKhkpy6qwLUKT293LavdyBak3s1aETp7rowAbKHZv' },
  { sym: 'STORMIE', mint: STORMIE, quote: BOBO, vault: 'CaXHYNgfRVqmVbBRJrYEuuyJvCQNU47Q2Q6U1HvwHHKz' },
];
const BY_MINT = Object.fromEntries(VAULTS.map(v => [v.mint, v]));
// Vaults pay out (negative deltas) and are never recipients. The pump.fun distributor wallet is NOT excluded:
// it holds GRR/STORMIE itself and receives rewards like any holder (for SOL it is also the fee payer).
const EXCLUDE = new Set(VAULTS.map(v => v.vault));
const NATIVE = '11111111111111111111111111111111'; // events report SOL as the default pubkey

const full = process.argv.includes('--full');
let st0 = !full && readJson(STATE, null);
if (st0 && Object.values(st0.bobo || {}).some(r => r.length < 5)) { console.error('state lacks per-coin counts; rebuilding'); st0 = null; }
const st = st0 || { v: 1, vaults: {}, sol: {}, bobo: {}, multi: [], check: { sol: [0, 0, 0], bobo: [0, 0, 0] } };
const multiSeen = new Set(st.multi);
const add = (a, b) => (BigInt(a || 0) + b).toString();

function processTx(tx, vaultMint) {
  const evs = distEvents(tx).map(e => e.quote === NATIVE ? { ...e, quote: SOL } : e).filter(e => BY_MINT[e.mint] && BY_MINT[e.mint].quote === e.quote);
  if (!evs.length) return 0;
  const mints = [...new Set(evs.map(e => e.mint))];
  if (mints.length > 1) { const s = sig(tx); if (multiSeen.has(s)) return 0; multiSeen.add(s); }
  else if (mints[0] !== vaultMint) return 0; // belongs to another vault's scan
  const keys = allKeys(tx), m = tx.meta;
  const byQuote = {};
  for (const e of evs) (byQuote[e.quote] ||= []).push(e);
  for (const [quote, es] of Object.entries(byQuote)) {
    const evTotal = es.reduce((s, e) => s + e.total, 0n);
    const gains = new Map();
    if (quote === SOL) {
      // add the tx fee back for the fee payer (index 0), so a holder who also paid the fee is counted in full
      keys.forEach((k, i) => { const d = BigInt(m.postBalances[i]) - BigInt(m.preBalances[i]) + (i === 0 ? BigInt(m.fee) : 0n); if (d > 0n && !EXCLUDE.has(k)) gains.set(k, (gains.get(k) || 0n) + d); });
    } else {
      const bal = arr => { const o = new Map(); for (const b of arr || []) if (b.mint === quote && b.owner) o.set(b.owner, (o.get(b.owner) || 0n) + BigInt(b.uiTokenAmount.amount)); return o; };
      const pre = bal(m.preTokenBalances), post = bal(m.postTokenBalances);
      for (const [o, v] of post) { const d = v - (pre.get(o) || 0n); if (d > 0n && !EXCLUDE.has(o)) gains.set(o, d); }
    }
    const paid = [...gains.values()].reduce((s, x) => s + x, 0n);
    const ck = st.check[quote === SOL ? 'sol' : 'bobo'];
    ck[0]++; if (paid !== evTotal) { ck[1]++; ck[2] = Number(BigInt(ck[2]) + (paid > evTotal ? paid - evTotal : evTotal - paid)); }
    for (const [w, d] of gains) {
      if (quote === SOL) { const r = st.sol[w] ||= ['0', 0]; r[0] = add(r[0], d); r[1]++; }
      else {
        const r = st.bobo[w] ||= ['0', '0', 0, 0, 0];
        // split by each coin's share of the tx's event totals (normally one coin per tx)
        let left = d;
        es.forEach((e, i) => { const part = i === es.length - 1 ? left : d * e.total / (evTotal || 1n); left -= part; if (e.mint === GRR) r[0] = add(r[0], part); else r[1] = add(r[1], part); });
        r[2]++; if (es.some(e => e.mint === GRR)) r[3]++; if (es.some(e => e.mint === STORMIE)) r[4]++;
      }
    }
  }
  for (const e of evs) {
    const v = st.vaults[e.mint] ||= { dist: 0, total: '0', first: null, last: null };
    v.dist++; v.total = add(v.total, e.total); v.first = Math.min(v.first ?? e.ts, e.ts); v.last = Math.max(v.last ?? 0, e.ts);
  }
  return evs.length;
}

for (const v of VAULTS) {
  const vs = st.vaults[v.mint] ||= { dist: 0, total: '0', first: null, last: null };
  let n = 0, max = vs.newestSlot ?? null;
  for await (const tx of gtfaAll(v.vault, { afterSlot: vs.newestSlot ?? null, label: v.sym + ' vault' })) {
    n++; processTx(tx, v.mint); if (max == null || tx.slot > max) max = tx.slot;
  }
  st.vaults[v.mint].newestSlot = max; st.vaults[v.mint].scanned = (st.vaults[v.mint].scanned || 0) + n;
  st.multi = [...multiSeen];
  writeJson(STATE, st); // checkpoint after each vault
  console.error(`${v.sym}: +${n} txs, distributions so far ${st.vaults[v.mint].dist}`);
}

const ui = (raw, dec) => Number(BigInt(raw)) / 10 ** dec;
const solRows = Object.entries(st.sol).map(([w, [r, n]]) => ({ w, sol: ui(r, 9), n })).sort((a, b) => b.sol - a.sol);
const boboRows = Object.entries(st.bobo).map(([w, [g, s, n, ng, ns]]) => ({ w, grr: ui(g, 6), stormie: ui(s, 6), bobo: ui(g, 6) + ui(s, 6), n, ng, ns })).sort((a, b) => b.bobo - a.bobo);
// Per-coin boards (separate GRR / STORMIE tabs): ranked by BOBO received from that coin's distributions only.
const coinBoard = (mint, key, nk) => {
  const rows = boboRows.filter(r => r[key] > 0).sort((a, b) => b[key] - a[key]);
  const v = st.vaults[mint];
  return { coin: BY_MINT[mint].sym, mint, vault: BY_MINT[mint].vault, quote: 'BOBO', distTxs: v.dist, from: v.first, to: v.last,
    eventTotal: ui(v.total, 6), wallets: rows.length, totalPaid: r6(rows.reduce((s, r) => s + r[key], 0)),
    top: rows.slice(0, TOP).map(r => ({ w: r.w, bobo: r6(r[key]), n: r[nk] })) };
};
const meta = mints => {
  const vs = mints.map(m => st.vaults[m]);
  return { coins: mints.map(m => BY_MINT[m].sym), distTxs: vs.reduce((s, v) => s + v.dist, 0), from: Math.min(...vs.map(v => v.first ?? Infinity)), to: Math.max(...vs.map(v => v.last ?? 0)),
    perCoin: Object.fromEntries(mints.map(m => [BY_MINT[m].sym, { distTxs: st.vaults[m].dist, total: ui(st.vaults[m].total, BY_MINT[m].quote === SOL ? 9 : 6), first: st.vaults[m].first, last: st.vaults[m].last, vault: BY_MINT[m].vault }])) };
};
const r6 = x => Math.round(x * 1e6) / 1e6;
const out = {
  generatedAt: Math.floor(Date.now() / 1000),
  method: 'Every DistributeFeeToHolders transaction of each vault since the first payout; amount = wallet balance increase in that tx.',
  sol: { ...meta([BOBO]), quote: 'SOL', wallets: solRows.length, totalPaid: r6(solRows.reduce((s, r) => s + r.sol, 0)), check: st.check.sol,
    top: solRows.slice(0, TOP).map(r => ({ w: r.w, sol: Math.round(r.sol * 1e9) / 1e9, n: r.n })) },
  bobo: { ...meta([GRR, STORMIE]), quote: 'BOBO', wallets: boboRows.length, totalPaid: r6(boboRows.reduce((s, r) => s + r.bobo, 0)), check: st.check.bobo,
    top: boboRows.slice(0, TOP).map(r => ({ w: r.w, bobo: r6(r.bobo), grr: r6(r.grr), stormie: r6(r.stormie), n: r.n })) },
  grr: coinBoard(GRR, 'grr', 'ng'),
  stormie: coinBoard(STORMIE, 'stormie', 'ns'),
};
writeJson(OUT, out);
console.log(JSON.stringify({ generatedAt: out.generatedAt, sol: { distTxs: out.sol.distTxs, wallets: out.sol.wallets, check: out.sol.check, top3: out.sol.top.slice(0, 3) }, bobo: { distTxs: out.bobo.distTxs, wallets: out.bobo.wallets, check: out.bobo.check }, grr: { ...out.grr, top: out.grr.top.slice(0, 3) }, stormie: { ...out.stormie, top: out.stormie.top.slice(0, 3) }, credits }));
