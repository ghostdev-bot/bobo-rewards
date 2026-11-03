#!/usr/bin/env node
// Builds site/data/forecast.json: the inputs for the Forecast panels on the GRR / STORMIE / SOL tabs.
// Per reward source it records, per UTC day:
//   paid  = holder rewards actually paid out (sum of DistributeFeeToHolders event totals of the coin's vault)
//   vol   = trading volume of the coin in its quote asset (pump.fun bonding-curve TradeEvent + PumpSwap Buy/SellEvent)
//   fee   = creator fee charged on those trades (coin_creator_fee / creator_fee from the same events) = what holders get
// and derives the empirical rate rewards / volume. USD history: GeckoTerminal daily OHLCV of the BOBO/SOL pool.
// Live market values (price, market cap, 24h volume) come from DexScreener at build time.
// Incremental: .cache/forecast-state.json (outside the site). Pass --full to rebuild.
import path from 'path';
import { fileURLToPath } from 'url';
import { SOL, BOBO, GRR, STORMIE, PUMP, gtfaAll, distEvents, allKeys, b58dec, b58enc, readJson, writeJson, rpc, credits } from './lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STATE = path.join(ROOT, '.cache/forecast-state.json');
const OUT = path.join(ROOT, 'site/data/forecast.json');
const AMM = 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA';
const NATIVE = '11111111111111111111111111111111';
const D_BUY = [103, 244, 82, 31, 44, 245, 119, 119], D_SELL = [62, 47, 55, 10, 165, 3, 220, 42], D_TRADE = [189, 219, 127, 211, 78, 230, 97, 238];
const BOBO_START = Date.UTC(2026, 8, 13) / 1000; // day of BOBO's first holder-rewards payout (2026-09-13 UTC)

const SRC = [
  { key: 'sol', sym: 'BOBO', mint: BOBO, pay: 'SOL', payDec: 9, quote: SOL, vault: '3aBa3DQdupVLbdEUWSRUCZ3dtQyQG1myLawx5CkniH8K', pool: '31ZmTzEufRDBGKsJ7NicCkEKxtPQgAEMQvdbCuUfE6GX', scan: '31ZmTzEufRDBGKsJ7NicCkEKxtPQgAEMQvdbCuUfE6GX', fromTime: BOBO_START, baseDec: 6 },
  { key: 'grr', sym: 'GRR', mint: GRR, pay: 'BOBO', payDec: 6, quote: BOBO, vault: '7soPKhkpy6qwLUKT293LavdyBak3s1aETp7rowAbKHZv', pool: 'BhTN1D5mf7FkDfmVJoAypTmsrCGeMkEHejvjDzBnQNV6', scan: GRR, fromTime: null, baseDec: 6 },
  { key: 'stormie', sym: 'STORMIE', mint: STORMIE, pay: 'BOBO', payDec: 6, quote: BOBO, vault: 'CaXHYNgfRVqmVbBRJrYEuuyJvCQNU47Q2Q6U1HvwHHKz', pool: 'GaK5yYzBuUdGF4jZeULounvLHLD65GLNu1G4cYSkE5e1', scan: STORMIE, fromTime: null, baseDec: 6 },
];
// pump.fun PumpSwap creator-fee schedule for SOL-paired canonical pools (https://pump.fun/docs/fees): [market cap in SOL from, creator fee bps]
const SOL_TIERS = [[0, 30], [420, 95], [1470, 90], [2460, 85], [3440, 80], [4420, 75], [9820, 70], [14740, 65], [19650, 60], [24560, 55], [29470, 50], [34380, 45], [39300, 40], [44210, 35], [49120, 30], [54030, 27.5], [58940, 25], [63860, 22.5], [68770, 20], [73681, 17.5], [78590, 15], [83500, 12.5], [88400, 10], [93330, 7.5], [98240, 5]];

const full = process.argv.includes('--full');
const st = (!full && readJson(STATE, null)) || { v: 1, src: {} };
const day = ts => new Date(ts * 1000).toISOString().slice(0, 10);
const sw = (d, disc) => disc.every((x, i) => d[8 + i] === x);

function tradeEvents(tx, s) {
  const keys = allKeys(tx), out = [];
  for (const g of tx.meta?.innerInstructions || []) for (const ix of g.instructions) {
    const pid = keys[ix.programIdIndex]; if (pid !== AMM && pid !== PUMP) continue;
    let d; try { d = b58dec(ix.data); } catch { continue; }
    if (d.length < 24) continue;
    const dv = new DataView(d.buffer, d.byteOffset), o = 16, u = i => Number(dv.getBigUint64(o + i, true));
    if (pid === AMM && (sw(d, D_BUY) || sw(d, D_SELL)) && d.length >= o + 352) {
      if (b58enc(d.slice(o + 112, o + 144)) !== s.pool) continue;
      out.push({ ts: Number(dv.getBigInt64(o, true)), vol: u(56), fee: u(344), bps: u(336), baseRes: u(40), quoteRes: u(48) });
    } else if (pid === PUMP && sw(d, D_TRADE) && d.length >= o + 225) {
      if (b58enc(d.slice(o, o + 32)) !== s.mint) continue;
      let vol = u(32);
      try { // custom-quote curves report the trade size in quote_amount (after the variable-length fields)
        let p = o + 258; const sl = dv.getUint32(p, true); p += 4 + sl + 1 + 32; const n = dv.getUint32(p, true); p += 4 + n * 34;
        const qm = b58enc(d.slice(p, p + 32)); const qa = Number(dv.getBigUint64(p + 32, true));
        if (qm !== NATIVE && qm !== SOL && qa > 0) vol = qa;
      } catch {}
      out.push({ ts: Number(dv.getBigInt64(o + 81, true)), vol, fee: u(209), bps: u(201), curve: true });
    }
  }
  return out;
}

for (const s of SRC) {
  const S = st.src[s.key] ||= { paid: {}, trades: {}, vaultSlot: null, tradeSlot: null, last: null };
  let n = 0, max = S.vaultSlot;
  for await (const tx of gtfaAll(s.vault, { afterSlot: S.vaultSlot, label: s.sym + ' vault' })) {
    n++; if (max == null || tx.slot > max) max = tx.slot;
    for (const e of distEvents(tx)) {
      if (e.mint !== s.mint) continue;
      const r = S.paid[day(e.ts)] ||= [0, 0]; r[0] += Number(e.total); r[1]++;
    }
  }
  S.vaultSlot = max; writeJson(STATE, st);
  let m = 0; max = S.tradeSlot;
  for await (const tx of gtfaAll(s.scan, { afterSlot: S.tradeSlot, fromTime: s.fromTime, label: s.sym + ' trades' })) {
    m++; if (max == null || tx.slot > max) max = tx.slot;
    for (const e of tradeEvents(tx, s)) {
      const r = S.trades[day(e.ts)] ||= [0, 0, 0, 0]; r[0] += e.vol; r[1] += e.fee; r[2]++; if (e.fee > 0) r[3] += e.vol; // [vol, fee, trades, vol charged a fee]
      if (!e.curve && e.bps > 0 && (!S.last || e.ts >= S.last.ts)) S.last = { ts: e.ts, bps: e.bps, baseRes: e.baseRes, quoteRes: e.quoteRes };
    }
  }
  S.tradeSlot = max; writeJson(STATE, st);
  console.error(`${s.sym}: +${n} vault txs, +${m} trade txs`);
}

// ---- prices ----
async function getJson(url) { for (let t = 0; t < 4; t++) { try { const r = await fetch(url, { headers: { accept: 'application/json' } }); if (r.ok) return await r.json(); } catch {} await new Promise(r => setTimeout(r, 2500 * (t + 1))); } return null; }
const gtUsd = await getJson(`https://api.geckoterminal.com/api/v2/networks/solana/pools/${SRC[0].pool}/ohlcv/day?limit=200&currency=usd&token=base`);
await new Promise(r => setTimeout(r, 2500));
const gtSol = await getJson(`https://api.geckoterminal.com/api/v2/networks/solana/pools/${SRC[0].pool}/ohlcv/day?limit=200&currency=token&token=base`);
const boboUsdDay = {}, solUsdDay = {}, boboVolUsdGt = {};
for (const c of gtUsd?.data?.attributes?.ohlcv_list || []) { boboUsdDay[day(c[0])] = c[4]; boboVolUsdGt[day(c[0])] = c[5]; }
for (const c of gtSol?.data?.attributes?.ohlcv_list || []) { const d = day(c[0]); if (boboUsdDay[d] && c[4]) solUsdDay[d] = boboUsdDay[d] / c[4]; }
const live = {};
const ds = await getJson('https://api.dexscreener.com/tokens/v1/solana/' + SRC.map(s => s.mint).join(','));
for (const p of ds || []) {
  const m = p.baseToken?.address, src = SRC.find(s => s.mint === m && s.pool === p.pairAddress); if (!src) continue;
  live[src.key] = { priceUsd: Number(p.priceUsd) || null, priceNative: Number(p.priceNative) || null, mcUsd: p.marketCap || p.fdv || null, vol24Usd: p.volume?.h24 ?? null, liqUsd: p.liquidity?.usd ?? null };
}
const boboUsd = live.sol?.priceUsd || null, solUsd = boboUsd && live.sol?.priceNative ? boboUsd / live.sol.priceNative : null;
const supplies = {};
for (const s of SRC) { try { supplies[s.key] = Number((await rpc('getTokenSupply', [s.mint])).value.uiAmount); } catch { supplies[s.key] = null; } }

// ---- eligible supply: rewards are pro rata to holdings among eligible holders. Measured, not assumed:
// over the last 2 days of payouts, implied eligible supply = wallet balance x window total / wallet's share, median of the top receivers.
async function eligible(s) {
  const from = Math.floor(Date.now() / 1000) - 2 * 86400, gains = {}; let total = 0;
  for await (const tx of gtfaAll(s.vault, { fromTime: from, label: s.sym + ' elig' })) {
    const evs = distEvents(tx).filter(e => e.mint === s.mint); if (!evs.length) continue;
    total += evs.reduce((a, e) => a + Number(e.total), 0);
    const m = tx.meta;
    if (s.quote === SOL) { allKeys(tx).forEach((k, i) => { const d = m.postBalances[i] - m.preBalances[i] + (i === 0 ? m.fee : 0); if (d > 0 && k !== s.vault) gains[k] = (gains[k] || 0) + d; }); }
    else { const bal = a => { const o = {}; for (const b of a || []) if (b.mint === s.quote && b.owner) o[b.owner] = (o[b.owner] || 0) + Number(b.uiTokenAmount.amount); return o; };
      const pre = bal(m.preTokenBalances), post = bal(m.postTokenBalances); for (const [o, v] of Object.entries(post)) { const d = v - (pre[o] || 0); if (d > 0 && o !== s.vault) gains[o] = (gains[o] || 0) + d; } }
  }
  const top = Object.entries(gains).sort((a, b) => b[1] - a[1]).slice(0, 10), imp = [];
  for (const [w, g] of top) {
    try { const a = await rpc('getTokenAccountsByOwner', [w, { mint: s.mint }, { encoding: 'jsonParsed' }]);
      const b = a.value.reduce((x, y) => x + Number(y.account.data.parsed.info.tokenAmount.uiAmount), 0); if (b > 0) imp.push(b * total / g); } catch {}
  }
  imp.sort((a, b) => a - b);
  return imp.length >= 3 ? { supply: Math.round(imp[Math.floor(imp.length / 2)]), samples: imp.length, wallets: Object.keys(gains).length, from } : null;
}
const elig = {};
for (const s of SRC) { try { elig[s.key] = await eligible(s); } catch (e) { console.error('eligible', s.sym, e.message); elig[s.key] = null; } }

// ---- stats ----
const today = day(Math.floor(Date.now() / 1000));
const dayList = (n) => { const out = []; for (let i = n; i >= 1; i--) out.push(day(Math.floor(Date.now() / 1000) - i * 86400)); return out; }; // last n FULL UTC days
const sum = a => a.reduce((x, y) => x + y, 0);
const pct = (a, p) => { const b = [...a].sort((x, y) => x - y); if (!b.length) return null; const i = (b.length - 1) * p, lo = Math.floor(i); return b[lo] + (b[Math.ceil(i)] - b[lo]) * (i - lo); };
function pearson(x, y) { const n = x.length; if (n < 3) return null; const mx = sum(x) / n, my = sum(y) / n; let a = 0, b = 0, c = 0; for (let i = 0; i < n; i++) { a += (x[i] - mx) * (y[i] - my); b += (x[i] - mx) ** 2; c += (y[i] - my) ** 2; } return b && c ? a / Math.sqrt(b * c) : null; }
const r4 = x => x == null || !isFinite(x) ? null : Math.round(x * 1e4) / 1e4, r8 = x => x == null || !isFinite(x) ? null : Number(x.toPrecision(6));

const out = { generatedAt: Math.floor(Date.now() / 1000), today, prices: { boboUsd, solUsd }, solFeeTiers: SOL_TIERS, src: {} };
for (const s of SRC) {
  const S = st.src[s.key], qDec = s.quote === SOL ? 9 : 6, pDec = s.payDec;
  const quoteUsd = d => s.quote === SOL ? solUsdDay[d] : boboUsdDay[d];
  const all = [...new Set([...Object.keys(S.paid), ...Object.keys(S.trades)])].sort().filter(d => d < today);
  const rows = all.map(d => { const t = S.trades[d] || [0, 0, 0, 0], p = S.paid[d] || [0, 0]; const vol = t[0] / 10 ** qDec, q = quoteUsd(d);
    return { d, paid: r8(p[0] / 10 ** pDec), payouts: p[1], vol: r8(vol), fee: r8(t[1] / 10 ** qDec), trades: t[2], volCharged: r8(t[3] / 10 ** qDec), volUsd: q ? Math.round(vol * q) : null, quoteUsd: q ? r8(q) : null }; });
  const by = Object.fromEntries(rows.map(r => [r.d, r]));
  const win = n => dayList(n).map(d => by[d] || { d, paid: 0, vol: 0, fee: 0, volCharged: 0, volUsd: 0, trades: 0 });
  const agg = n => { const w = win(n), paid = sum(w.map(r => r.paid)), vol = sum(w.map(r => r.vol)), fee = sum(w.map(r => r.fee)), volUsd = sum(w.map(r => r.volUsd || 0)), vc = sum(w.map(r => r.volCharged));
    return { days: n, paid: r8(paid), vol: r8(vol), fee: r8(fee), volUsd: Math.round(volUsd), paidPerDay: r8(paid / n), volUsdPerDay: Math.round(volUsd / n), feeRate: r8(fee / vol), rewardRate: r8(paid / vol), payoutToFee: r4(paid / fee), chargedShare: r4(vc / vol), rewardPerUsdVol: r8(paid / volUsd) }; };
  // weekly windows over the last 8 full weeks: reward / volume ratio spread
  const weeks = []; const w56 = win(56);
  for (let i = 0; i < 8; i++) { const w = w56.slice(i * 7, i * 7 + 7); const v = sum(w.map(r => r.vol)), p = sum(w.map(r => r.paid)); if (v > 0) weeks.push({ from: w[0].d, to: w[6].d, vol: r8(v), paid: r8(p), rate: r8(p / v) }); }
  const w30 = win(30);
  const L = S.last; const priceQ = L ? (L.quoteRes / 10 ** qDec) / (L.baseRes / 10 ** s.baseDec) : null;
  out.src[s.key] = { key: s.key, sym: s.sym, mint: s.mint, pay: s.pay, quote: s.quote === SOL ? 'SOL' : 'BOBO', vault: s.vault, pool: s.pool,
    supply: supplies[s.key], poolBase: L ? r8(L.baseRes / 10 ** s.baseDec) : null, priceInQuote: r8(priceQ), mcInQuote: r8(priceQ && supplies[s.key] ? priceQ * supplies[s.key] : null),
    eligible: elig[s.key] || (supplies[s.key] && L ? { supply: Math.round(supplies[s.key] - L.baseRes / 10 ** s.baseDec), estimated: 'supply minus pool reserve' } : null),
    creatorBpsNow: L ? L.bps : null, live: live[s.key] || null,
    d7: agg(7), d30: agg(30), weeks: weeks.reverse(),
    corr30: { paidVsFee: r4(pearson(w30.map(r => r.fee), w30.map(r => r.paid))), paidVsVol: r4(pearson(w30.map(r => r.vol), w30.map(r => r.paid))) },
    lifetime: { from: all[0] || null, paid: r8(sum(rows.map(r => r.paid))), vol: r8(sum(rows.map(r => r.vol))), fee: r8(sum(rows.map(r => r.fee))) },
    days: rows.slice(-60) };
}
out.method = 'Rewards on pump.fun holder-rewards coins are the creator fee charged on every trade of the coin (bonding curve and PumpSwap), collected in the quote asset and paid out pro rata to holders. ' +
  'paid = DistributeFeeToHolders totals per UTC day; vol and fee = sums over every trade event of the coin; rate = paid / vol over the window.';
writeJson(OUT, out);
console.log(JSON.stringify({ generatedAt: out.generatedAt, prices: out.prices, src: Object.fromEntries(Object.entries(out.src).map(([k, v]) => [k, { bps: v.creatorBpsNow, eligible: v.eligible, mcInQuote: v.mcInQuote, supply: v.supply, poolBase: v.poolBase, d7: v.d7, d30: v.d30, weeks: v.weeks.map(w => w.rate), corr: v.corr30, live: v.live }])), credits }, null, 1));
