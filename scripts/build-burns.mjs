#!/usr/bin/env node
// Builds site/data/burns.json: every SPL Burn / BurnChecked of the $BOBO mint, plus BOBO sent to
// the BoboBurn address (an unspendable vanity address, so BOBO there is out of circulation forever).
// Source: Helius getTransactionsForAddress on the BOBO mint (every Burn instruction must list the
// mint account), oldest first, and on the BoboBurn wallet (tokenAccounts: balanceChanged).
// Cross-check: initial supply (first MintTo) - current getTokenSupply must equal the summed burns.
// Incremental + resumable: state in .cache/burns-state.json (outside the site). --full rebuilds.
import path from 'path';
import { fileURLToPath } from 'url';
import { BOBO, BOBOBURN, GRR, STORMIE, rpc, allKeys, b58dec, distEvents, sig, readJson, writeJson, credits } from './lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STATE = path.join(ROOT, '.cache/burns-state.json');
const OUT = path.join(ROOT, 'site/data/burns.json');
const TOKEN_PROGS = new Set(['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PE4dWS5UGSmBXFEQRBG']);
const INCINERATOR = '1nc1nerator11111111111111111111111111111111';
const DEC = 6;
const full = process.argv.includes('--full');
const st = (!full && readJson(STATE, null)) || { v: 1, mint: { token: null, newestSlot: null, done: false, scanned: 0 }, burnAddr: { newestSlot: null, scanned: 0 }, initial: null, burns: [], inflows: [] };
const seen = new Set(st.burns.map(b => b.sig + ':' + b.i));
const seenIn = new Set(st.inflows.map(b => b.sig));

function scanBurns(tx) {
  const keys = allKeys(tx), m = tx.meta, s = sig(tx);
  const owners = {}; for (const b of [...(m.preTokenBalances || []), ...(m.postTokenBalances || [])]) if (b.owner) owners[b.accountIndex] = b.owner;
  const ixs = [...tx.transaction.message.instructions.map(ix => ({ ix })), ...(m.innerInstructions || []).flatMap(g => g.instructions.map(ix => ({ ix })))];
  let i = 0;
  for (const { ix } of ixs) {
    i++;
    if (!TOKEN_PROGS.has(keys[ix.programIdIndex])) continue;
    let d; try { d = b58dec(ix.data); } catch { continue; }
    if (d[0] === 7 && keys[ix.accounts[0]] === BOBO && st.initial == null) { // MintTo (first one = initial supply)
      st.initial = new DataView(d.buffer, d.byteOffset).getBigUint64(1, true).toString();
    }
    if (!(d[0] === 8 || d[0] === 15) || d.length < 9) continue;
    if (keys[ix.accounts[1]] !== BOBO) continue;
    const key = s + ':' + i; if (seen.has(key)) continue; seen.add(key);
    const amount = new DataView(d.buffer, d.byteOffset).getBigUint64(1, true);
    const acct = ix.accounts[0], auth = keys[ix.accounts[2]];
    st.burns.push({ sig: s, i, ts: tx.blockTime, slot: tx.slot, raw: amount.toString(), owner: owners[acct] || auth, auth });
  }
}
function scanInflow(tx) {
  const m = tx.meta, s = sig(tx);
  if (seenIn.has(s)) return;
  const bal = arr => { const o = new Map(); for (const b of arr || []) if (b.mint === BOBO && b.owner) o.set(b.owner, (o.get(b.owner) || 0n) + BigInt(b.uiTokenAmount.amount)); return o; };
  const pre = bal(m.preTokenBalances), post = bal(m.postTokenBalances);
  const d = (post.get(BOBOBURN) || 0n) - (pre.get(BOBOBURN) || 0n);
  if (d === 0n) return;
  const ev = distEvents(tx).find(e => e.quote === BOBO);
  let kind = 'transfer', from = null;
  if (ev) kind = ev.mint === GRR ? 'GRR holder rewards' : ev.mint === STORMIE ? 'STORMIE holder rewards' : 'other BOBO-pair holder rewards';
  else { let best = 0n; for (const [o, v] of pre) { const x = v - (post.get(o) || 0n); if (x > best && o !== BOBOBURN) { best = x; from = o; } } }
  seenIn.add(s);
  st.inflows.push({ sig: s, ts: tx.blockTime, raw: d.toString(), kind, from });
}

async function scan(address, part, filters, fn, label) {
  let token = part.token || null, pages = 0;
  do {
    const p = { transactionDetails: 'full', limit: 1000, encoding: 'json', maxSupportedTransactionVersion: 1, sortOrder: 'asc', filters: { status: 'succeeded', ...filters } };
    if (token) p.paginationToken = token; else if (part.newestSlot != null) p.filters.slot = { gt: part.newestSlot };
    const r = await rpc('getTransactionsForAddress', [address, p]);
    const d = r?.data || []; pages++;
    for (const tx of d) { fn(tx); part.scanned++; if (part.newestSlot == null || tx.slot > part.newestSlot) part.newestSlot = tx.slot; if (!part.firstTs) part.firstTs = tx.blockTime; }
    token = d.length ? r.paginationToken : null;
    part.token = token;
    if (pages % 10 === 0 || !token) { writeJson(STATE, st); process.stderr.write(`${label}: page ${pages}, ${part.scanned} txs total, last ${d.length ? new Date(d.at(-1).blockTime * 1000).toISOString() : '-'}\n`); }
  } while (token);
  part.done = true; writeJson(STATE, st);
}

await scan(BOBO, st.mint, {}, scanBurns, 'BOBO mint');
await scan(BOBOBURN, st.burnAddr, { tokenAccounts: 'balanceChanged' }, scanInflow, 'BoboBurn');

const supply = await rpc('getTokenSupply', [BOBO]);
const accts = async o => ((await rpc('getTokenAccountsByOwner', [o, { mint: BOBO }, { encoding: 'jsonParsed' }]))?.value || []).reduce((s, a) => s + BigInt(a.account.data.parsed.info.tokenAmount.amount), 0n);
const burnBal = await accts(BOBOBURN), incBal = await accts(INCINERATOR);
const ui = r => Number(BigInt(r)) / 10 ** DEC;
const burns = st.burns.slice().sort((a, b) => a.slot - b.slot || a.i - b.i);
const sumBurn = burns.reduce((s, b) => s + BigInt(b.raw), 0n);
const initial = st.initial ? BigInt(st.initial) : null;
const byOwner = {}; for (const b of burns) { const r = byOwner[b.owner] ||= { w: b.owner, raw: 0n, n: 0, last: 0 }; r.raw += BigInt(b.raw); r.n++; r.last = Math.max(r.last, b.ts); }
const inflow = {}; for (const x of st.inflows) { const r = inflow[x.kind] ||= { raw: 0n, n: 0 }; r.raw += BigInt(x.raw); r.n++; }
const out = {
  generatedAt: Math.floor(Date.now() / 1000),
  mint: BOBO, decimals: DEC,
  range: { from: st.mint.firstTs, to: Math.max(...burns.map(b => b.ts), 0) || null, txsScanned: st.mint.scanned, newestSlot: st.mint.newestSlot },
  supply: { initial: initial != null ? ui(initial) : null, current: ui(supply.value.amount), burnedBySupply: initial != null ? ui(initial - BigInt(supply.value.amount)) : null },
  burned: { amount: ui(sumBurn), count: burns.length, burners: Object.keys(byOwner).length, matchesSupply: initial != null && initial - BigInt(supply.value.amount) === sumBurn },
  burnAddress: { address: BOBOBURN, balance: ui(burnBal), inflowTxs: st.inflows.length, byKind: Object.fromEntries(Object.entries(inflow).map(([k, v]) => [k, { amount: ui(v.raw), n: v.n }])), txsScanned: st.burnAddr.scanned },
  incinerator: { address: INCINERATOR, balance: ui(incBal) },
  topBurners: Object.values(byOwner).sort((a, b) => (b.raw > a.raw ? 1 : b.raw < a.raw ? -1 : 0)).slice(0, 25).map(r => ({ w: r.w, amount: ui(r.raw), n: r.n, last: r.last })),
  burns: burns.reverse().slice(0, 5000).map(b => ({ ts: b.ts, amount: ui(b.raw), w: b.owner, sig: b.sig })),
};
writeJson(OUT, out);
const big = burns.slice().sort((a, b) => (BigInt(b.raw) > BigInt(a.raw) ? 1 : -1)).slice(0, 3).map(b => ({ amount: ui(b.raw), w: b.owner, ts: b.ts, sig: b.sig }));
console.log(JSON.stringify({ supply: out.supply, burned: out.burned, burnAddress: out.burnAddress, top3biggest: big, credits }));
