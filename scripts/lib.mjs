// Shared helpers for the box-side build scripts. Reads the Helius RPC URL from the environment
// (HELIUS_RPC) or from a local secrets file that is never part of the site or the repo.
import fs from 'fs';

export const PUMP = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
export const DISTRIBUTOR = 'HckQ93Xqjjo8mwt5pNPWvyCTZXQZ858rvzmm7ZRrZg9t';
export const SOL = 'So11111111111111111111111111111111111111112';
export const BOBO = '4nV5gNwwP68zUDat26ySChREqVaQaLudfJBkSgEzpump';
export const GRR = 'DBEjiLMt9USaM3SdC9YtNcKGnXLdFhzokwnykH4Wpump';
export const STORMIE = 'HqyTxEqk7qmLu2Gnx46eEZwQhzCf2yVqRompLaKYpump';
export const BOBOBURN = 'BoboBurn11111111111111111111111111111111111';
export const EV_DISC = [227, 190, 215, 206, 176, 180, 165, 132]; // DistributeFeeToHoldersEvent

function rpcUrl() {
  if (process.env.HELIUS_RPC) return process.env.HELIUS_RPC;
  const f = process.env.HELIUS_SECRETS || '/home/box/secrets/helius.json';
  return JSON.parse(fs.readFileSync(f, 'utf8')).rpc;
}
const URL_ = rpcUrl();
// The key is domain-restricted in the Helius dashboard; send the site's own origin.
const ORIGIN = process.env.HELIUS_ORIGIN || 'https://boborewards.surge.sh';
export let credits = 0;
const sleep = ms => new Promise(r => setTimeout(r, ms));
let lastCall = 0;
export async function rpc(method, params, tries = 8) {
  let last;
  for (let t = 0; t < tries; t++) {
    const wait = lastCall + 130 - Date.now(); if (wait > 0) await sleep(wait); lastCall = Date.now();
    try {
      const r = await fetch(URL_, { method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
      if (r.status === 429 || r.status >= 500) throw new Error('HTTP ' + r.status);
      if (r.status === 401 || r.status === 403) throw Object.assign(new Error('HTTP ' + r.status + ' (key rejected)'), { fatal: true });
      const j = await r.json();
      if (j.error) throw new Error(j.error.message || JSON.stringify(j.error));
      return j.result;
    } catch (e) { last = e; if (e.fatal) break; await sleep(1000 * (t + 1)); }
  }
  throw last;
}
// getTransactionsForAddress, full transactions, oldest first, optionally only slots > afterSlot.
export async function* gtfaAll(address, { afterSlot = null, label = address.slice(0, 6) } = {}) {
  let token = null, pages = 0, n = 0;
  do {
    const p = { transactionDetails: 'full', limit: 1000, encoding: 'json', maxSupportedTransactionVersion: 1, sortOrder: 'asc', filters: { status: 'succeeded' } };
    if (afterSlot != null) p.filters.slot = { gt: afterSlot };
    if (token) p.paginationToken = token;
    const r = await rpc('getTransactionsForAddress', [address, p]);
    const d = r?.data || []; pages++; n += d.length; credits += Math.max(10, Math.ceil(d.length / 100) * 10);
    if (pages % 10 === 0 || !r?.paginationToken) process.stderr.write(`${label}: page ${pages}, ${n} txs, ~${credits} credits\n`);
    for (const tx of d) yield tx;
    token = d.length ? r.paginationToken : null;
  } while (token);
}

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export function b58dec(s) {
  const out = [];
  for (const ch of s) { let c = B58.indexOf(ch); if (c < 0) throw new Error('bad base58'); for (let j = 0; j < out.length; j++) { c += out[j] * 58; out[j] = c & 255; c >>= 8; } while (c) { out.push(c & 255); c >>= 8; } }
  for (const ch of s) { if (ch === '1') out.push(0); else break; }
  return Uint8Array.from(out.reverse());
}
export function b58enc(bytes) {
  const d = [];
  for (const b of bytes) { let c = b; for (let j = 0; j < d.length; j++) { c += d[j] << 8; d[j] = c % 58; c = (c / 58) | 0; } while (c) { d.push(c % 58); c = (c / 58) | 0; } }
  let s = ''; for (const b of bytes) { if (b === 0) s += '1'; else break; }
  for (let i = d.length - 1; i >= 0; i--) s += B58[d[i]];
  return s;
}
export function allKeys(tx) {
  const m = tx.transaction.message, la = tx.meta?.loadedAddresses || {};
  return [...m.accountKeys, ...(la.writable || []), ...(la.readonly || [])];
}
const startsWith = (b, disc, off = 0) => disc.every((x, i) => b[off + i] === x);
export function distEvents(tx) {
  const keys = allKeys(tx), out = [];
  for (const g of tx.meta?.innerInstructions || []) for (const ix of g.instructions) {
    if (keys[ix.programIdIndex] !== PUMP) continue;
    let d; try { d = b58dec(ix.data); } catch { continue; }
    if (d.length < 104 || !startsWith(d, EV_DISC, 8)) continue;
    const dv = new DataView(d.buffer, d.byteOffset);
    out.push({ ts: Number(dv.getBigInt64(16, true)), mint: b58enc(d.slice(24, 56)), quote: b58enc(d.slice(56, 88)), recipients: Number(dv.getBigUint64(88, true)), total: dv.getBigUint64(96, true) });
  }
  return out;
}
export const sig = tx => tx.transaction.signatures[0];
export function readJson(f, d) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } }
export function writeJson(f, v) { fs.mkdirSync(f.replace(/\/[^/]+$/, ''), { recursive: true }); fs.writeFileSync(f + '.tmp', JSON.stringify(v)); fs.renameSync(f + '.tmp', f); }
