// Bobo Rewards: unofficial, read-only holder-rewards tracker. No build step, no dependencies.
'use strict';

// ---------- constants ----------
const PUMP = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
const DISTRIBUTOR = 'HckQ93Xqjjo8mwt5pNPWvyCTZXQZ858rvzmm7ZRrZg9t';
const SOL = 'So11111111111111111111111111111111111111112';
const ATA_PROG = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
const TOKEN_PROG = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const IX_DISC = [98, 54, 145, 97, 2, 70, 173, 43];        // distribute_fee_to_holders
const EV_DISC = [227, 190, 215, 206, 176, 180, 165, 132]; // DistributeFeeToHoldersEvent
const LOG_DIST = 'Instruction: DistributeFeeToHolders';
const BOBO = '4nV5gNwwP68zUDat26ySChREqVaQaLudfJBkSgEzpump';
const GRR = 'DBEjiLMt9USaM3SdC9YtNcKGnXLdFhzokwnykH4Wpump';
const EXAMPLE = '8UM4uPuDNftQYneFrtAWAsRVT3NwBVWV2T4z16NgxHwQ';
const MIN_ELIGIBLE_USD = 20;

// Curated list. Every value here was checked on-chain (bonding curve flags, vault PDAs) and against DexScreener.
const TOKENS = [
  { sym: 'BOBO', name: 'Bobo', mint: BOBO, quote: SOL, rate: 'creator fee (SOL pair)', vault: '3aBa3DQdupVLbdEUWSRUCZ3dtQyQG1myLawx5CkniH8K',
    note: 'Main coin. Holders are paid in SOL.', links: { site: 'https://bobothebear.io', x: 'https://x.com/bobocouncil' } },
  { sym: 'GRR', name: 'Smol Grr', mint: GRR, quote: BOBO, rate: '3% · paid in BOBO', vault: '7soPKhkpy6qwLUKT293LavdyBak3s1aETp7rowAbKHZv',
    note: 'BOBO pair. 20% of supply is held at the BoboBurn address.', links: { site: 'https://smolgrr.fun/', x: 'https://x.com/smol_grr' } },
  { sym: 'STORMIE', name: "Bobo Dev's Dog", mint: 'HqyTxEqk7qmLu2Gnx46eEZwQhzCf2yVqRompLaKYpump', quote: BOBO, rate: '3% · paid in BOBO', vault: 'CaXHYNgfRVqmVbBRJrYEuuyJvCQNU47Q2Q6U1HvwHHKz',
    note: 'BOBO pair.', links: {} },
  { sym: 'GRRL', name: 'Smol Grrl', mint: 'CVpbSiehxxcFJFJ9jDcZ5ECHMcMomUM7GW99CdmQpump', quote: GRR, rate: 'paid in GRR', vault: '76zYsLQq5uGNnLmr5JbdMoo4SWLS1sz52QNm5bK5azd5',
    note: 'GRR pair (pair of a pair), still on the bonding curve.', links: { x: 'https://x.com/SmolGrrl' } },
];
const TOK = Object.fromEntries(TOKENS.map(t => [t.mint, t]));
const SYM = { [SOL]: 'SOL', [BOBO]: 'BOBO', [GRR]: 'GRR' };
const DEC = { [SOL]: 9 };

const FREE_RPCS = ['https://solana-rpc.publicnode.com', 'https://rpc.solanatracker.io/public'];
// Helius (primary, archive). Browser RPC key, restricted to this site's domains on the Helius side.
const HELIUS = (window.BR_CONFIG && window.BR_CONFIG.heliusRpc) || '';
const REWARDS_EPOCH = 1788220800; // 2026-09-01 UTC; pump.fun holder rewards launched 2026-09-12, nothing to find before

// ---------- tiny utils ----------
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const short = a => a ? a.slice(0, 4) + '…' + a.slice(-4) : '';
const LS = {
  get(k, d) { try { const v = localStorage.getItem('br:' + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('br:' + k, JSON.stringify(v)); } catch { /* quota */ } },
  del(k) { try { localStorage.removeItem('br:' + k); } catch {} },
};

function fmtNum(n, dp) {
  if (n == null || !isFinite(n)) return '—';
  const a = Math.abs(n);
  if (dp == null) dp = a >= 1000 ? 0 : a >= 1 ? 2 : a >= 0.01 ? 4 : 6;
  if (a >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (a >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  return n.toLocaleString('en-US', { maximumFractionDigits: dp, minimumFractionDigits: 0 });
}
function fmtUsd(n) {
  if (n == null || !isFinite(n)) return '—';
  const a = Math.abs(n);
  if (a >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
  if (a >= 1e4) return '$' + (n / 1e3).toFixed(1) + 'K';
  if (a >= 1) return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 });
  if (a >= 0.01) return '$' + n.toFixed(3);
  if (a === 0) return '$0';
  return '$' + n.toPrecision(2);
}
function fmtPrice(n) {
  if (n == null || !isFinite(n)) return '—';
  if (n >= 1) return '$' + n.toFixed(2);
  const s = n.toPrecision(3);
  return '$' + (Number(s) < 1e-6 ? Number(s).toExponential(2) : Number(s).toString());
}
const tz = (() => { try { return new Intl.DateTimeFormat('en-US', { timeZoneName: 'short' }).formatToParts(new Date()).find(p => p.type === 'timeZoneName').value; } catch { return ''; } })();
function fmtTime(ts) {
  if (!ts) return '—';
  return new Date(ts * 1000).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' ' + tz;
}
function ago(ts) {
  if (!ts) return '';
  const s = Date.now() / 1000 - ts;
  if (s < 3600) return Math.max(1, Math.round(s / 60)) + 'm ago';
  if (s < 86400 * 2) return (s / 3600).toFixed(1).replace('.0', '') + 'h ago';
  return Math.round(s / 86400) + 'd ago';
}

// ---------- base58 + PDA (for ATA lookups) ----------
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function b58dec(s) {
  const out = [];
  for (const ch of s) {
    let c = B58.indexOf(ch); if (c < 0) throw new Error('bad base58');
    for (let j = 0; j < out.length; j++) { c += out[j] * 58; out[j] = c & 255; c >>= 8; }
    while (c) { out.push(c & 255); c >>= 8; }
  }
  for (const ch of s) { if (ch === '1') out.push(0); else break; }
  return Uint8Array.from(out.reverse());
}
function b58enc(bytes) {
  const d = [];
  for (const b of bytes) {
    let c = b;
    for (let j = 0; j < d.length; j++) { c += d[j] << 8; d[j] = c % 58; c = (c / 58) | 0; }
    while (c) { d.push(c % 58); c = (c / 58) | 0; }
  }
  let s = ''; for (const b of bytes) { if (b === 0) s += '1'; else break; }
  for (let i = d.length - 1; i >= 0; i--) s += B58[d[i]];
  return s;
}
function isAddress(s) { try { return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s) && b58dec(s).length === 32; } catch { return false; } }

const P = 2n ** 255n - 19n;
const modp = a => ((a % P) + P) % P;
function powm(b, e) { let r = 1n; b = modp(b); while (e > 0n) { if (e & 1n) r = r * b % P; b = b * b % P; e >>= 1n; } return r; }
const D = modp(-121665n * powm(121666n, P - 2n));
function onCurve(bytes) {
  let y = 0n; for (let i = 31; i >= 0; i--) y = (y << 8n) | BigInt(i === 31 ? bytes[i] & 0x7f : bytes[i]);
  if (y >= P) return false;
  const y2 = y * y % P, x2 = modp((y2 - 1n) * powm(D * y2 + 1n, P - 2n));
  return x2 === 0n || powm(x2, (P - 1n) / 2n) === 1n;
}
async function findPda(seeds, programId) {
  const tail = new TextEncoder().encode('ProgramDerivedAddress');
  const prog = b58dec(programId);
  for (let bump = 255; bump >= 0; bump--) {
    const parts = [...seeds, Uint8Array.of(bump), prog, tail];
    const buf = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0; for (const p of parts) { buf.set(p, o); o += p.length; }
    const h = new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
    if (!onCurve(h)) return b58enc(h);
  }
  throw new Error('no pda');
}
const ata = (owner, mint, tokenProgram) => findPda([b58dec(owner), b58dec(tokenProgram), b58dec(mint)], ATA_PROG);

// ---------- RPC with fallback ----------
function rpcList() { const c = LS.get('rpc', ''); return c ? [c, ...FREE_RPCS] : FREE_RPCS.slice(); }
let rid = 1;
async function rpcBatch(calls, { eps = rpcList(), tries = 6 } = {}) {
  let lastErr;
  for (let t = 0; t < tries; t++) {
    const ep = eps[t % eps.length];
    try {
      const body = calls.map(([method, params]) => ({ jsonrpc: '2.0', id: rid++, method, params }));
      const r = await fetch(ep, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (r.status === 429 || r.status >= 500) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      if (!Array.isArray(j)) throw new Error(j?.error?.message || 'bad batch reply');
      const byId = new Map(j.map(x => [x.id, x]));
      return body.map(b => { const x = byId.get(b.id); return x && !x.error ? x.result : (x?.error ? { __err: x.error } : null); });
    } catch (e) { lastErr = e; await sleep(400 * (t + 1)); }
  }
  throw lastErr || new Error('RPC failed');
}
async function rpc(method, params, opt) {
  const [r] = await rpcBatch([[method, params]], opt);
  if (r && r.__err) throw new Error(r.__err.message || 'rpc error');
  return r;
}

// ---------- prices / market data ----------
const market = {}; // mint -> {price, mcap, liq, vol, chg, image, pair, dex}
async function loadMarket(extraMints = []) {
  const mints = [...new Set([...TOKENS.map(t => t.mint), ...extraMints])].filter(m => m !== SOL);
  const chunks = []; for (let i = 0; i < mints.length; i += 30) chunks.push(mints.slice(i, i + 30));
  const solP = fetch('https://lite-api.jup.ag/price/v3?ids=' + SOL).then(r => r.json()).then(j => j[SOL]?.usdPrice).catch(() => null);
  for (const c of chunks) {
    try {
      const pairs = await (await fetch('https://api.dexscreener.com/tokens/v1/solana/' + c.join(','))).json();
      for (const p of pairs || []) {
        const m = p.baseToken?.address; if (!m || !c.includes(m)) continue;
        const cur = market[m];
        const liq = p.liquidity?.usd || 0;
        if (cur && cur._liq > liq) continue;
        market[m] = { _liq: liq, price: p.priceUsd ? Number(p.priceUsd) : null, priceNative: Number(p.priceNative) || null, quoteAddr: p.quoteToken?.address,
          mcap: p.marketCap || p.fdv || null, liq: p.liquidity?.usd ?? null, vol: p.volume?.h24 ?? null, chg: p.priceChange?.h24 ?? null,
          image: p.info?.imageUrl || null, pair: p.pairAddress, dex: p.dexId, url: p.url, sym: p.baseToken.symbol, name: p.baseToken.name };
        if (!SYM[m]) SYM[m] = p.baseToken.symbol;
      }
    } catch (e) { console.warn('dexscreener', e); }
  }
  let sol = await solP;
  if (!sol) { try { const j = await (await fetch('https://api.dexscreener.com/tokens/v1/solana/' + SOL)).json(); sol = Number(j?.[0]?.priceUsd) || null; } catch {} }
  market[SOL] = { price: sol };
  // derive USD for bonding-curve coins quoted in a known token (e.g. GRRL in GRR)
  for (const [m, d] of Object.entries(market)) {
    if (d.price == null && d.priceNative && d.quoteAddr && market[d.quoteAddr]?.price) d.price = d.priceNative * market[d.quoteAddr].price;
  }
}
const priceOf = m => market[m]?.price ?? null;

function avatar(mint, sym) {
  const img = market[mint]?.image;
  return img ? `<img src="${esc(img)}" alt="${esc(sym)} logo" loading="lazy" referrerpolicy="no-referrer">` : `<span class="ava">${esc((sym || '?')[0])}</span>`;
}

// ---------- reward detection ----------
function allKeys(tx) {
  const m = tx.transaction.message, la = tx.meta?.loadedAddresses || {};
  return [...m.accountKeys, ...(la.writable || []), ...(la.readonly || [])];
}
function startsWith(bytes, disc, off = 0) { for (let i = 0; i < disc.length; i++) if (bytes[off + i] !== disc[i]) return false; return true; }
function distIxs(tx) {
  const keys = allKeys(tx), out = [];
  for (const ix of tx.transaction.message.instructions) {
    if (keys[ix.programIdIndex] !== PUMP) continue;
    let d; try { d = b58dec(ix.data); } catch { continue; }
    if (!startsWith(d, IX_DISC)) continue;
    out.push({ mint: keys[ix.accounts[2]], quote: keys[ix.accounts[5]] });
  }
  return out;
}
function isDistTx(tx) { return !!tx?.meta && !tx.meta.err && (tx.meta.logMessages || []).some(l => l.includes(LOG_DIST)); }

// What did `wallet` receive in this distribution tx? -> [{mint, quote, raw, dec}]
function walletPayouts(tx, wallet) {
  if (!isDistTx(tx)) return [];
  const keys = allKeys(tx), ixs = distIxs(tx), out = [];
  const byQuote = {};
  for (const ix of ixs) (byQuote[ix.quote] ||= []).push(ix.mint);
  for (const [quote, mints] of Object.entries(byQuote)) {
    let raw = 0n, dec = 9;
    if (quote === SOL) {
      const i = keys.indexOf(wallet); if (i < 0) continue;
      raw = BigInt(tx.meta.postBalances[i]) - BigInt(tx.meta.preBalances[i]);
    } else {
      const sum = arr => (arr || []).filter(b => b.owner === wallet && b.mint === quote).reduce((s, b) => { dec = b.uiTokenAmount.decimals; return s + BigInt(b.uiTokenAmount.amount); }, 0n);
      raw = sum(tx.meta.postTokenBalances) - sum(tx.meta.preTokenBalances);
    }
    if (raw > 0n) { DEC[quote] = dec; out.push({ mint: [...new Set(mints)].length === 1 ? mints[0] : mints.join(','), quote, raw: raw.toString(), dec }); }
  }
  return out;
}
// Vault-side: decode the DistributeFeeToHoldersEvent (self-CPI) for recipients + total
function distEvents(tx) {
  const keys = allKeys(tx), out = [];
  for (const g of tx.meta?.innerInstructions || []) for (const ix of g.instructions) {
    if (keys[ix.programIdIndex] !== PUMP) continue;
    let d; try { d = b58dec(ix.data); } catch { continue; }
    if (d.length < 104 || !startsWith(d, EV_DISC, 8)) continue;
    const dv = new DataView(d.buffer, d.byteOffset);
    out.push({ ts: Number(dv.getBigInt64(16, true)), mint: b58enc(d.slice(24, 56)), quote: b58enc(d.slice(56, 88)),
      recipients: Number(dv.getBigUint64(88, true)), total: dv.getBigUint64(96, true).toString() });
  }
  return out;
}
const toUi = (raw, dec) => Number(BigInt(raw)) / 10 ** dec;

// fetch many transactions. publicnode allows only one getTransaction per request and Solana Tracker keeps
// only a few hours of blocks, so: custom RPC (batched) -> Solana Tracker (batched) -> publicnode (single, throttled).
let slots = 5; const waiters = [];
async function limited(fn) {
  while (slots <= 0) await new Promise(r => waiters.push(r));
  slots--; try { return await fn(); } finally { slots++; waiters.shift()?.(); }
}
const txCall = s => ['getTransaction', [s, { encoding: 'json', maxSupportedTransactionVersion: 0, commitment: 'confirmed' }]];
async function txBatch(sigs, bt = {}) {
  const got = new Map();
  const pending = () => sigs.filter(s => !got.get(s));
  const take = (list, r) => list.forEach((s, i) => { if (r[i] && !r[i].__err) got.set(s, r[i]); });
  const custom = LS.get('rpc', '');
  if (custom) { try { const l = pending(); take(l, await rpcBatch(l.map(txCall), { eps: [custom], tries: 2 })); } catch {} }
  const recent = Date.now() / 1000 - 4 * 3600; // Solana Tracker only keeps a few hours of blocks
  const l2 = pending().filter(s => (bt[s] || 0) > recent);
  if (l2.length) { try { take(l2, await rpcBatch(l2.map(txCall), { eps: [FREE_RPCS[1]], tries: 2 })); } catch {} }
  await Promise.all(pending().map(s => limited(async () => {
    try { const [r] = await rpcBatch([txCall(s)], { eps: [FREE_RPCS[0]], tries: 4 }); if (r && !r.__err) got.set(s, r); } catch {}
  })));
  return got;
}
async function fetchTxs(sigs, onProgress, bt) {
  const res = new Map(); const B = 10; let done = 0, next = 0;
  const batches = []; for (let i = 0; i < sigs.length; i += B) batches.push(sigs.slice(i, i + B));
  async function worker() {
    while (next < batches.length) {
      const b = batches[next++];
      const got = await txBatch(b, bt);
      b.forEach(s => res.set(s, got.get(s) || null));
      done += b.length; onProgress?.(done, sigs.length);
    }
  }
  await Promise.all([worker(), worker()]);
  return res;
}
async function signatures(address, { max = 1500, before = null } = {}) {
  const out = []; let cursor = before, exhausted = false;
  while (out.length < max) {
    const params = { limit: Math.min(1000, max - out.length) }; if (cursor) params.before = cursor;
    const page = await rpc('getSignaturesForAddress', [address, params]);
    if (!page || !page.length) { exhausted = true; break; }
    out.push(...page); cursor = page[page.length - 1].signature;
    if (page.length < params.limit) { exhausted = true; break; }
  }
  return { sigs: out, exhausted, cursor };
}

// Oldest time the RPC can still serve (sliding window). Cached for 10 min.
let windowCache = null;
async function rpcWindowStart() {
  if (windowCache && Date.now() - windowCache.at < 600000) return windowCache.ts;
  let ts = null;
  try {
    let fb = await rpc('getFirstAvailableBlock', []);
    // the very first blocks are being pruned as we ask, so step forward a little until one answers
    for (const off of [1500, 4000, 8000, 15000, 30000]) {
      if (ts != null) break;
      const [r] = await rpcBatch([['getBlockTime', [fb + off]]], { tries: 2 });
      if (typeof r === 'number') ts = r + 7200; // +2 h margin: pruning differs between the RPC's backend nodes
      else { const m = /First available block: (\d+)/.exec(r?.__err?.message || ''); if (m) fb = Math.max(fb, Number(m[1])); }
    }
  } catch {}
  windowCache = { at: Date.now(), ts };
  return ts;
}

// ---------- balances ----------
async function loadBalances(wallet) {
  const bal = {}; // mint -> ui
  const tasks = [];
  const getBal = HELIUS ? helius('getBalance', [wallet]).catch(() => rpc('getBalance', [wallet])) : rpc('getBalance', [wallet]);
  tasks.push(getBal.then(r => { bal[SOL] = (r?.value ?? r) / 1e9; }).catch(() => {}));
  // Jupiter holdings (all tokens, any account)
  let jupOk = false;
  tasks.push(fetch('https://lite-api.jup.ag/ultra/v1/holdings/' + wallet).then(r => r.ok ? r.json() : null).then(j => {
    if (!j || !j.tokens) return; jupOk = true;
    for (const [m, accs] of Object.entries(j.tokens)) bal[m] = accs.reduce((s, a) => s + Number(a.uiAmount || 0), 0);
  }).catch(() => {}));
  await Promise.all(tasks);
  if (!jupOk && HELIUS) {
    // fallback 1: Helius token accounts (2 credits), both token programs
    try {
      const progs = [TOKEN_PROG, 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'];
      const rs = await Promise.all(progs.map(pid => helius('getTokenAccountsByOwner', [wallet, { programId: pid }, { encoding: 'jsonParsed' }])));
      for (const r of rs) for (const a of r?.value || []) { const i = a.account?.data?.parsed?.info; if (i) bal[i.mint] = (bal[i.mint] || 0) + Number(i.tokenAmount?.uiAmount || 0); }
      jupOk = true;
    } catch (e) { console.warn('helius balances', e); }
  }
  if (!jupOk) {
    // fallback 2: derive associated token accounts for the curated mints and read them
    try {
      const mints = TOKENS.map(t => t.mint);
      const info = await rpc('getMultipleAccounts', [mints, { encoding: 'base64', dataSlice: { offset: 0, length: 0 } }]);
      const progs = (info?.value || []).map(v => v?.owner || TOKEN_PROG);
      const atas = await Promise.all(mints.map((m, i) => ata(wallet, m, progs[i])));
      const accs = await rpc('getMultipleAccounts', [atas, { encoding: 'jsonParsed' }]);
      (accs?.value || []).forEach((a, i) => { const ui = a?.data?.parsed?.info?.tokenAmount?.uiAmount; bal[mints[i]] = ui || 0; });
      bal.__partial = true;
    } catch (e) { console.warn('ata fallback', e); bal.__failed = true; }
  }
  return bal;
}

// ---------- wallet scan ----------
let scanState = null;
function ledgerOf(w) { return LS.get('led:' + w, null) || { since: null, payouts: {}, seen: {} }; }

async function scanWalletWindow(wallet, { more = false } = {}) {
  const deep = LS.get('deep', false);
  const cap = deep ? 5000 : 1500;
  $('#wallet').classList.remove('hidden');
  $('#wAddr').textContent = short(wallet);
  $('#wAddr').title = wallet;
  $('#wLinks').innerHTML = `<a href="https://solscan.io/account/${esc(wallet)}" target="_blank" rel="noopener">Solscan</a> · full address <span class="mono">${esc(wallet)}</span>`;
  if (!more) { $('#sumCards').innerHTML = ''; $('#tokCards').innerHTML = ''; $('#payRows').innerHTML = ''; $('#winNote').textContent = ''; }
  const prog = (t, f) => { $('#prog').classList.remove('hidden'); $('#progTxt').textContent = t; $('#progBar').style.width = Math.round((f || 0) * 100) + '%'; };
  $('#btnMore').classList.add('hidden');
  setBusy(true);
  try {
    prog('Reading balances and prices…', 0.03);
    const [bal, winStart] = await Promise.all([loadBalances(wallet), rpcWindowStart(), Object.keys(market).length ? null : loadMarket()]);
    prog('Listing wallet transactions…', 0.08);
    const before = more && scanState?.wallet === wallet ? scanState.cursor : null;
    const { sigs, exhausted, cursor } = await signatures(wallet, { max: cap, before });
    const led = ledgerOf(wallet);
    if (!led.since) led.since = Math.floor(Date.now() / 1000);
    const okSigs = sigs.filter(s => !s.err);
    const todo = okSigs.filter(s => !led.seen[s.signature]).map(s => s.signature);
    prog(`Checking ${todo.length} transaction${todo.length === 1 ? '' : 's'} for reward payouts…`, 0.12);
    const bt = Object.fromEntries(okSigs.map(s => [s.signature, s.blockTime]));
    const txs = await fetchTxs(todo, (d, n) => prog(`Checking transactions for reward payouts… ${d}/${n}`, 0.12 + 0.85 * d / n), bt);
    let missing = 0;
    for (const s of todo) {
      const tx = txs.get(s);
      if (!tx) { if (!winStart || (bt[s] || 0) > winStart + 600) missing++; continue; } // older than the RPC window: silently skipped
      for (const p of walletPayouts(tx, wallet)) led.payouts[s + ':' + p.mint] = { sig: s, ts: tx.blockTime, ...p };
      led.seen[s] = 1;
    }
    // keep the "seen" set bounded
    const seenKeys = Object.keys(led.seen); if (seenKeys.length > 20000) for (const k of seenKeys.slice(0, seenKeys.length - 20000)) delete led.seen[k];
    LS.set('led:' + wallet, led);
    const prevOldest = more && scanState?.oldest ? scanState.oldest : null;
    const oldestSig = sigs.length ? sigs[sigs.length - 1].blockTime : null;
    const from = exhausted ? (winStart || oldestSig) : Math.max(oldestSig || prevOldest || 0, winStart || 0) || null;
    scanState = { wallet, cursor, exhausted, oldest: from, nSigs: (more ? scanState.nSigs : 0) + sigs.length };
    // unknown mints → market data
    const extra = [...new Set(Object.values(led.payouts).flatMap(p => [p.mint, p.quote]).filter(m => !market[m] && !m.includes(',')))];
    if (extra.length) await loadMarket(extra);
    renderWindow(wallet, bal, led, { from, exhausted, missing });
    prog(exhausted ? `Done. Scanned ${scanState.nSigs} transactions (everything this RPC still has).` : `Scanned the latest ${scanState.nSigs} transactions. Older history exists.`, 1);
    if (!exhausted) $('#btnMore').classList.remove('hidden');
  } catch (e) {
    console.error(e);
    prog('Could not read this wallet right now (public RPC busy or blocked). Try again in a minute, or add your own RPC in ⚙ settings.', 0);
  } finally { setBusy(false); }
}

function renderWindow(wallet, bal, led, { from, exhausted, missing }) {
  const now = Date.now() / 1000;
  const all = Object.values(led.payouts).sort((a, b) => b.ts - a.ts);
  const inWin = all.filter(p => from == null || p.ts >= from);
  const hours = from ? (now - from) / 3600 : null;
  const custom = !!LS.get('rpc', '');
  $('#winNote').innerHTML = from
    ? `Measured window: <b>${esc(fmtTime(from))}</b> → now (about <b>${hours.toFixed(1)} h</b>). ${exhausted && !custom ? 'Free public RPCs only keep roughly the last 1.5 days, so payouts before this are not visible here and <b>lifetime totals are not shown</b>.' : ''}${!exhausted ? ' Older transactions exist: use “Scan more”.' : ''}${missing ? ` ${missing} transaction(s) could not be fetched; refresh to retry.` : ''}`
    : 'No transactions found in the window the RPC keeps.';

  // aggregate by holding mint
  const agg = {};
  const add = (bucket, p) => { const a = (agg[p.mint] ||= { mint: p.mint, quote: p.quote, win: 0, winN: 0, dev: 0, devN: 0, last: 0 }); a[bucket] += toUi(p.raw, p.dec); a[bucket + 'N']++; a.last = Math.max(a.last, p.ts); };
  for (const p of inWin) add('win', p);
  for (const p of all) add('dev', p);

  const byQuote = (list) => list.reduce((m, p) => { m[p.quote] = (m[p.quote] || 0) + toUi(p.raw, p.dec); return m; }, {});
  const qWin = byQuote(inWin), qDev = byQuote(all);
  const usd = q => Object.entries(q).reduce((s, [m, v]) => s + v * (priceOf(m) || 0), 0);
  const perDay = (v) => hours && hours >= 6 ? v / hours * 24 : null;
  const usdWin = usd(qWin);
  const qLine = q => Object.keys(q).length ? Object.entries(q).map(([m, v]) => `${fmtNum(v)} ${esc(SYM[m] || short(m))}`).join(' + ') : '0';

  $('#sumCards').innerHTML = `
    <div class="card hl"><div class="k">SOL received · from $BOBO</div><div class="v">${fmtNum(qWin[SOL] || 0, 4)} SOL</div><div class="s">${fmtUsd((qWin[SOL] || 0) * (priceOf(SOL) || 0))} at today's price · in window</div></div>
    <div class="card hl"><div class="k">BOBO received · from pairs</div><div class="v">${fmtNum(qWin[BOBO] || 0, 2)} BOBO</div><div class="s">${fmtUsd((qWin[BOBO] || 0) * (priceOf(BOBO) || 0))} at today's price · in window</div></div>
    <div class="card"><div class="k">All rewards in window</div><div class="v">${fmtUsd(usdWin)}</div><div class="s">${inWin.length} payout${inWin.length === 1 ? '' : 's'}${perDay(usdWin) != null ? ` · ≈ ${fmtUsd(perDay(usdWin))}/day <span class="est">estimate</span>` : ''}</div></div>
    <div class="card"><div class="k">Tracked on this device</div><div class="v">${fmtUsd(usd(qDev))}</div><div class="s">${qLine(qDev)} · since ${esc(fmtTime(Math.min(led.since, ...(all.length ? [all[all.length - 1].ts] : [led.since]))))}</div></div>`;

  // token cards: curated first, then any other coin that paid this wallet
  const active = m => (bal[m] > 0 || agg[m]?.devN) ? 0 : 1;
  const mints = [...TOKENS.map(t => t.mint), ...Object.keys(agg).filter(m => !TOK[m])].sort((x, y) => active(x) - active(y));
  $('#tokCards').innerHTML = mints.map(m => {
    const t = TOK[m] || { sym: SYM[m] || market[m]?.sym || short(m), name: market[m]?.name || 'Other holder-rewards coin', quote: agg[m]?.quote, rate: 'paid in ' + (SYM[agg[m]?.quote] || '?') };
    const a = agg[m] || { win: 0, winN: 0, dev: 0, devN: 0, last: 0 };
    const b = bal[m] ?? (bal.__failed ? null : 0);
    const bUsd = b != null && priceOf(m) != null ? b * priceOf(m) : null;
    const elig = b == null ? '<span class="tag">balance unknown</span>' : !b ? '<span class="tag">not held</span>'
      : bUsd == null ? '<span class="tag">no price</span>' : bUsd >= MIN_ELIGIBLE_USD ? '<span class="tag ok">above ~$20 minimum</span>' : '<span class="tag no">below ~$20 minimum</span>';
    const q = t.quote, qs = SYM[q] || '?', qp = priceOf(q);
    const pd = a.winN >= 2 ? perDay(a.win) : null;
    const dim = !b && !a.devN ? ' dim' : '';
    return `<div class="tok${dim}"><div class="tokH">${avatar(m, t.sym)}<div><div class="nm">$${esc(t.sym)}<small>${esc(t.name)}</small></div><div class="muted sm">${esc(t.rate)}</div></div>
      <div class="rw">${market[m]?.price != null ? fmtPrice(market[m].price) : ''}<br>${market[m]?.mcap ? 'mcap ' + fmtUsd(market[m].mcap) : ''}</div></div>
      <div class="kv">
        <span>Balance</span><span>${b == null ? '—' : fmtNum(b)} ${esc(t.sym)}${bUsd != null && b ? ` · ${fmtUsd(bUsd)}` : ''}</span>
        <span>Eligibility <span class="est">estimate</span></span><span>${elig}</span>
        <span>Received in window</span><span class="big">${fmtNum(a.win, qs === 'SOL' ? 5 : 2)} ${esc(qs)}</span>
        <span>Value at today's price</span><span>${qp != null ? fmtUsd(a.win * qp) : '—'}</span>
        <span>Payouts in window</span><span>${a.winN}${a.last ? ` · last ${esc(ago(a.last))}` : ''}</span>
        <span>≈ per day <span class="est">estimate</span></span><span>${pd != null ? `${fmtNum(pd, qs === 'SOL' ? 5 : 2)} ${esc(qs)}` : '—'}</span>
        <span>Tracked on this device</span><span>${fmtNum(a.dev, qs === 'SOL' ? 5 : 2)} ${esc(qs)} (${a.devN})</span>
      </div></div>`;
  }).join('');

  // payouts table
  const rows = all.slice(0, 200);
  $('#payCount').textContent = all.length ? `(${all.length} stored${all.length > 200 ? ', latest 200 shown' : ''})` : '';
  $('#payRows').innerHTML = rows.map(p => {
    const sym = TOK[p.mint]?.sym || SYM[p.mint] || short(p.mint), ui = toUi(p.raw, p.dec), qp = priceOf(p.quote);
    return `<tr><td>${esc(fmtTime(p.ts))}</td><td><span class="tcell">${avatar(p.mint, sym)}$${esc(sym)}</span></td>
      <td class="r">${fmtNum(ui, p.quote === SOL ? 6 : 3)} ${esc(SYM[p.quote] || short(p.quote))}</td><td class="r">${qp != null ? fmtUsd(ui * qp) : '—'}</td>
      <td><a href="https://solscan.io/tx/${esc(p.sig)}" target="_blank" rel="noopener">${esc(p.sig.slice(0, 8))}…</a></td></tr>`;
  }).join('');
  $('#payEmpty').textContent = all.length ? '' : 'No holder-reward payouts found for this wallet in the scanned window. Payouts only go to wallets holding roughly $20+ of a holder-rewards coin, and arrive a few times a day.';
}

// ---------- overview: vault distributions ----------
const vaultStats = {};
function renderOverviewWindow() {
  const anyMeasured = Object.keys(vaultStats).length;
  $('#ovRows').innerHTML = TOKENS.map(t => {
    const m = market[t.mint] || {}, v = vaultStats[t.mint];
    const qs = SYM[t.quote];
    const chg = m.chg != null ? `<span class="${m.chg >= 0 ? 'up' : 'down'} sm"> ${m.chg >= 0 ? '+' : ''}${m.chg.toFixed(1)}%</span>` : '';
    const dist = v ? (v.err ? `<span class="muted">${esc(v.err)}</span>` : `${fmtNum(v.total, qs === 'SOL' ? 3 : 0)} ${esc(qs)}<br><span class="muted sm">${fmtUsd(v.total * (priceOf(t.quote) || 0))} today · ${v.rounds} round${v.rounds === 1 ? '' : 's'} · ~${fmtNum(v.avgRecipients, 0)} wallets/round</span>`) : '<span class="muted">—</span>';
    const pd = v && !v.err && v.hours >= 6 && v.rounds >= 2 ? `${fmtNum(v.total / v.hours * 24, qs === 'SOL' ? 3 : 0)} ${esc(qs)}` : '—';
    const links = [m.url && `<a href="${esc(m.url)}" target="_blank" rel="noopener">chart</a>`, `<a href="https://pump.fun/coin/${t.mint}" target="_blank" rel="noopener">pump</a>`, `<a href="https://solscan.io/account/${t.vault}" target="_blank" rel="noopener">vault</a>`, t.links.x && `<a href="${esc(t.links.x)}" target="_blank" rel="noopener">X</a>`].filter(Boolean).join(' · ');
    return `<tr><td><div class="tcell">${avatar(t.mint, t.sym)}<div><b>$${esc(t.sym)}</b> <span class="muted sm">${esc(t.name)}</span><br><span class="sm">${links}</span></div></div></td>
      <td class="r">${fmtPrice(m.price)}${chg}</td><td class="r">${fmtUsd(m.mcap)}${m.liq != null ? `<br><span class="muted sm">liq ${fmtUsd(m.liq)}</span>` : ''}</td><td class="r">${fmtUsd(m.vol)}</td>
      <td>${esc(qs)} <span class="muted sm">${esc(t.rate.includes('%') ? t.rate.split(' ·')[0] : '')}</span></td><td class="r dist">${dist}</td><td class="r">${pd}</td><td>${v && v.last ? esc(fmtTime(v.last)) + `<br><span class="muted sm">${esc(ago(v.last))}</span>` : '—'}</td></tr>`;
  }).join('');
  const w = Object.values(vaultStats).find(v => v.from);
  $('#ovNote').innerHTML = anyMeasured && w
    ? `Measured from on-chain <code>DistributeFeeToHolders</code> events since ${esc(fmtTime(w.from))} (what the RPC keeps). This is not a lifetime total. “≈ per day” extrapolates that window. USD uses today's price. Token images come from each project's DexScreener profile.`
    : 'Click “Measure payouts” to read each coin\'s distributions from chain (takes ~30 s for BOBO). Token images come from each project\'s DexScreener profile.';
}

async function measureVaultsWindow() {
  const btn = $('#btnMeasure'); btn.disabled = true; btn.textContent = 'Measuring…';
  const winStart = await rpcWindowStart();
  for (const t of TOKENS) {
    try {
      const cache = LS.get('v:' + t.mint, {});
      const { sigs, exhausted } = await signatures(t.vault, { max: 3000 });
      const todo = sigs.filter(s => !s.err && !(s.signature in cache)).map(s => s.signature);
      const txs = await fetchTxs(todo, (d, n) => { btn.textContent = `Measuring $${t.sym}… ${d}/${n}`; }, Object.fromEntries(sigs.map(s => [s.signature, s.blockTime])));
      for (const s of todo) { const tx = txs.get(s); if (!tx) continue; const ev = distEvents(tx).filter(e => e.mint === t.mint); cache[s] = ev.length ? ev.map(e => [e.ts, e.total, e.recipients]) : 0; }
      const valid = new Set(sigs.map(s => s.signature));
      for (const k of Object.keys(cache)) if (!valid.has(k)) delete cache[k]; // drop what fell out of the window
      LS.set('v:' + t.mint, cache);
      const evs = Object.values(cache).filter(Boolean).flat().sort((a, b) => a[0] - b[0]);
      const dec = DEC[t.quote] ?? 6;
      let rounds = 0, prev = -1e12, rec = 0, roundRec = [];
      for (const [ts, , r] of evs) { if (ts - prev > 600) { rounds++; roundRec.push(0); } roundRec[roundRec.length - 1] += r; prev = ts; rec += r; }
      const oldest = sigs[sigs.length - 1]?.blockTime || null;
      const from = exhausted ? (winStart || oldest) : Math.max(oldest || 0, winStart || 0) || null;
      vaultStats[t.mint] = { total: evs.reduce((s, e) => s + Number(BigInt(e[1])) / 10 ** dec, 0), rounds, avgRecipients: rounds ? rec / rounds : 0,
        last: evs.length ? evs[evs.length - 1][0] : null, from, hours: from ? (Date.now() / 1000 - from) / 3600 : 0 };
    } catch (e) { console.warn('vault', t.sym, e); vaultStats[t.mint] = { err: 'RPC busy, try again' }; }
    renderOverviewWindow();
  }
  btn.disabled = false; btn.textContent = 'Measure again';
}

// ---------- Helius: lifetime history ----------
// Throttle: at most 8 Helius requests per second (free plan allows 10 RPS).
const hTimes = [];
async function hThrottle() {
  for (;;) {
    const now = Date.now();
    while (hTimes.length && now - hTimes[0] > 1000) hTimes.shift();
    if (hTimes.length < 8) { hTimes.push(now); return; }
    await sleep(1000 - (now - hTimes[0]) + 5);
  }
}
let hCredits = 0; // rough client-side credit counter (per page load)
async function helius(method, params, { tries = 4 } = {}) {
  if (!HELIUS) throw new Error('no helius');
  let last;
  for (let t = 0; t < tries; t++) {
    await hThrottle();
    try {
      const r = await fetch(HELIUS, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: rid++, method, params }) });
      if (r.status === 429 || r.status >= 500) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      if (j.error) { const e = new Error(j.error.message || 'helius error'); e.fatal = r.status === 401 || r.status === 403 || /api key|unauthor|forbidden|credits/i.test(e.message); throw e; }
      return j.result;
    } catch (e) { last = e; if (e.fatal) break; await sleep(700 * (t + 1)); }
  }
  throw last;
}
// getTransactionsForAddress (Helius-only): full transactions, 10 credits per 100 returned.
const PAGE = 500;
async function gtfa(address, filters, token) {
  const p = { transactionDetails: 'full', limit: PAGE, encoding: 'json', maxSupportedTransactionVersion: 1, sortOrder: 'desc', filters: { status: 'succeeded', ...filters } };
  if (token) p.paginationToken = token;
  const r = await helius('getTransactionsForAddress', [address, p]);
  hCredits += Math.max(10, Math.ceil((r?.data?.length || 0) / 100) * 10);
  return { data: r?.data || [], token: r?.paginationToken || null };
}

function hLedger(w) { return LS.get('hled:' + w, null) || { v: 1, newestSlot: null, complete: false, resume: null, oldestTs: null, scanned: 0, payouts: {} }; }
function saveHLedger(w, led) {
  try { localStorage.setItem('br:hled:' + w, JSON.stringify(led)); }
  catch { // storage full: drop other wallets' caches and retry once
    Object.keys(localStorage).filter(k => (k.startsWith('br:hled:') || k.startsWith('br:led:')) && k !== 'br:hled:' + w).forEach(k => localStorage.removeItem(k));
    try { localStorage.setItem('br:hled:' + w, JSON.stringify(led)); } catch {}
  }
}

async function scanWalletLifetime(wallet, { more = false } = {}, prog) {
  const cap = LS.get('deep', false) ? 20000 : 5000; // transactions fetched per scan (≈ 500 / 2,000 credits max)
  const led = hLedger(wallet);
  const creditsAtStart = hCredits;
  let fetched = 0;
  const take = (data) => {
    for (const tx of data) {
      fetched++; led.scanned++;
      if (led.oldestTs == null || tx.blockTime < led.oldestTs) led.oldestTs = tx.blockTime;
      for (const p of walletPayouts(tx, wallet)) led.payouts[tx.transaction.signatures[0] + ':' + p.mint] = { sig: tx.transaction.signatures[0], ts: tx.blockTime, ...p };
    }
  };
  // A) anything new since the last scan (cheap: usually one 10-credit page)
  if (led.newestSlot != null) {
    let tok = null, max = led.newestSlot, pages = 0;
    do {
      prog(`Checking for new payouts since your last scan… (${fetched} new transactions)`, 0.15);
      const r = await gtfa(wallet, { blockTime: { gte: REWARDS_EPOCH }, slot: { gt: led.newestSlot } }, tok);
      take(r.data); for (const tx of r.data) max = Math.max(max, tx.slot);
      tok = r.data.length ? r.token : null; pages++;
    } while (tok && pages < 40);
    led.newestSlot = max; saveHLedger(wallet, led);
  }
  // B) back-fill full history (resumable across scans)
  if (!led.complete) {
    let tok = led.resume;
    while (fetched < cap) {
      prog(`Reading full history… ${led.scanned.toLocaleString()} transactions so far${led.oldestTs ? `, back to ${new Date(led.oldestTs * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}`, Math.min(0.95, 0.2 + 0.75 * fetched / cap));
      const r = await gtfa(wallet, { blockTime: { gte: REWARDS_EPOCH } }, tok);
      if (led.newestSlot == null && r.data.length) led.newestSlot = r.data[0].slot;
      take(r.data);
      tok = r.data.length ? r.token : null;
      led.resume = tok;
      if (!tok) { led.complete = true; break; }
      saveHLedger(wallet, led);
    }
    if (led.newestSlot == null) led.newestSlot = 0;
    saveHLedger(wallet, led);
  }
  return { led, fetched, credits: hCredits - creditsAtStart };
}

async function scanWallet(wallet, { more = false } = {}) {
  if (!HELIUS || LS.get('noHelius', false)) return scanWalletWindow(wallet, { more });
  $('#wallet').classList.remove('hidden');
  $('#wAddr').textContent = short(wallet); $('#wAddr').title = wallet;
  $('#wLinks').innerHTML = `<a href="https://solscan.io/account/${esc(wallet)}" target="_blank" rel="noopener">Solscan</a> · full address <span class="mono">${esc(wallet)}</span>`;
  if (!more) { $('#sumCards').innerHTML = ''; $('#tokCards').innerHTML = ''; $('#payRows').innerHTML = ''; $('#winNote').textContent = ''; }
  const prog = (t, f) => { $('#prog').classList.remove('hidden'); $('#progTxt').textContent = t; $('#progBar').style.width = Math.round((f || 0) * 100) + '%'; };
  $('#btnMore').classList.add('hidden');
  setBusy(true);
  try {
    prog('Reading balances and prices…', 0.05);
    const [bal] = await Promise.all([loadBalances(wallet), Object.keys(market).length ? null : loadMarket()]);
    const { led, fetched, credits } = await scanWalletLifetime(wallet, { more }, prog);
    const extra = [...new Set(Object.values(led.payouts).flatMap(p => [p.mint, p.quote]).filter(m => !market[m] && !m.includes(',')))];
    if (extra.length) await loadMarket(extra);
    scanState = { wallet, mode: 'lifetime' };
    renderLifetime(wallet, bal, led);
    prog(led.complete
      ? `Done. Full history read (${led.scanned.toLocaleString()} transactions${fetched !== led.scanned ? `, ${fetched.toLocaleString()} new this time` : ''}).`
      : `Read ${led.scanned.toLocaleString()} transactions so far, back to ${fmtTime(led.oldestTs)}. Older history remains.`, 1);
    console.info(`[bobo-rewards] Helius credits used by this scan ≈ ${credits}`);
    if (!led.complete) $('#btnMore').classList.remove('hidden');
  } catch (e) {
    console.warn('Helius scan failed, falling back to free RPC window', e);
    setBusy(false);
    return scanWalletWindow(wallet, { more: false });
  } finally { setBusy(false); }
}

function renderLifetime(wallet, bal, led) {
  const now = Date.now() / 1000;
  const all = Object.values(led.payouts).sort((a, b) => b.ts - a.ts);
  const firstTs = all.length ? all[all.length - 1].ts : null;
  const days = firstTs ? Math.max(1, (now - firstTs) / 86400) : null;
  $('#winNote').innerHTML = led.complete
    ? `<b>Lifetime history</b>: every pump.fun holder-rewards payout this wallet has received${firstTs ? `, first one on <b>${esc(fmtTime(firstTs))}</b>` : ''}. Holder rewards went live on pump.fun on Sept 12, 2026.`
    : `<b>Partial history</b>: read back to <b>${esc(fmtTime(led.oldestTs))}</b> so far. Press “Scan more” to keep going back. Totals below cover only what has been read.`;

  const agg = {};
  for (const p of all) { const a = (agg[p.mint] ||= { mint: p.mint, quote: p.quote, tot: 0, n: 0, first: p.ts, last: 0 }); a.tot += toUi(p.raw, p.dec); a.n++; a.first = Math.min(a.first, p.ts); a.last = Math.max(a.last, p.ts); }
  const q = all.reduce((m, p) => { m[p.quote] = (m[p.quote] || 0) + toUi(p.raw, p.dec); return m; }, {});
  const usdAll = Object.entries(q).reduce((s, [m, v]) => s + v * (priceOf(m) || 0), 0);
  const L = led.complete ? 'lifetime' : 'read so far';
  $('#sumCards').innerHTML = `
    <div class="card hl"><div class="k">SOL received · from $BOBO</div><div class="v">${fmtNum(q[SOL] || 0, 4)} SOL</div><div class="s">${fmtUsd((q[SOL] || 0) * (priceOf(SOL) || 0))} at today's price · ${L}</div></div>
    <div class="card hl"><div class="k">BOBO received · from pairs</div><div class="v">${fmtNum(q[BOBO] || 0, 2)} BOBO</div><div class="s">${fmtUsd((q[BOBO] || 0) * (priceOf(BOBO) || 0))} at today's price · ${L}</div></div>
    <div class="card"><div class="k">All rewards · ${L}</div><div class="v">${fmtUsd(usdAll)}</div><div class="s">${all.length.toLocaleString()} payout${all.length === 1 ? '' : 's'} · valued at today's prices</div></div>
    <div class="card"><div class="k">Average per day</div><div class="v">${days ? fmtUsd(usdAll / days) : '—'}</div><div class="s">${firstTs ? `since first payout ${esc(new Date(firstTs * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }))} (${Math.round(days)} days), today's prices` : 'no payouts yet'}</div></div>`;

  const active = m => (bal[m] > 0 || agg[m]?.n) ? 0 : 1;
  const mints = [...TOKENS.map(t => t.mint), ...Object.keys(agg).filter(m => !TOK[m])].sort((x, y) => active(x) - active(y));
  $('#tokCards').innerHTML = mints.map(m => {
    const t = TOK[m] || { sym: SYM[m] || market[m]?.sym || short(m), name: market[m]?.name || 'Other holder-rewards coin', quote: agg[m]?.quote, rate: 'paid in ' + (SYM[agg[m]?.quote] || market[agg[m]?.quote]?.sym || short(agg[m]?.quote)) + (agg[m]?.quote === BOBO ? ' · BOBO pair' : agg[m]?.quote === GRR ? ' · GRR pair' : ' · not a BOBO pair') };
    const a = agg[m] || { tot: 0, n: 0, first: 0, last: 0 };
    const b = bal[m] ?? (bal.__failed ? null : 0);
    const bUsd = b != null && priceOf(m) != null ? b * priceOf(m) : null;
    const elig = b == null ? '<span class="tag">balance unknown</span>' : !b ? '<span class="tag">not held</span>'
      : bUsd == null ? '<span class="tag">no price</span>' : bUsd >= MIN_ELIGIBLE_USD ? '<span class="tag ok">above ~$20 minimum</span>' : '<span class="tag no">below ~$20 minimum</span>';
    const qs = SYM[t.quote] || market[t.quote]?.sym || short(t.quote), qp = priceOf(t.quote), dp = qs === 'SOL' ? 5 : 2;
    const d = a.n ? Math.max(1, (now - a.first) / 86400) : null;
    const dim = !b && !a.n ? ' dim' : '';
    return `<div class="tok${dim}"><div class="tokH">${avatar(m, t.sym)}<div><div class="nm">$${esc(t.sym)}<small>${esc(t.name)}</small></div><div class="muted sm">${esc(t.rate)}</div></div>
      <div class="rw">${market[m]?.price != null ? fmtPrice(market[m].price) : ''}<br>${market[m]?.mcap ? 'mcap ' + fmtUsd(market[m].mcap) : ''}</div></div>
      <div class="kv">
        <span>Balance now</span><span>${b == null ? '—' : fmtNum(b)} ${esc(t.sym)}${bUsd != null && b ? ` · ${fmtUsd(bUsd)}` : ''}</span>
        <span>Eligibility <span class="est">estimate</span></span><span>${elig}</span>
        <span>Received · ${L}</span><span class="big">${fmtNum(a.tot, dp)} ${esc(qs)}</span>
        <span>Value at today's price</span><span>${qp != null ? fmtUsd(a.tot * qp) : '—'}</span>
        <span>Payouts</span><span>${a.n.toLocaleString()}${a.last ? ` · last ${esc(ago(a.last))}` : ''}</span>
        <span>First payout</span><span>${a.n ? esc(fmtTime(a.first)) : '—'}</span>
        <span>Average per day</span><span>${d ? `${fmtNum(a.tot / d, dp)} ${esc(qs)}` : '—'}</span>
      </div></div>`;
  }).join('');
  renderPayouts(all);
  $('#payEmpty').textContent = all.length ? '' : (led.complete ? 'This wallet has never received a pump.fun holder-rewards payout.' : 'No payouts found in the part of the history read so far.');
}

function renderPayouts(all) {
  const rows = all.slice(0, 200);
  $('#payCount').textContent = all.length ? `(${all.length.toLocaleString()} total${all.length > 200 ? ', latest 200 shown' : ''})` : '';
  $('#payRows').innerHTML = rows.map(p => {
    const sym = TOK[p.mint]?.sym || SYM[p.mint] || short(p.mint), ui = toUi(p.raw, p.dec), qp = priceOf(p.quote);
    return `<tr><td>${esc(fmtTime(p.ts))}</td><td><span class="tcell">${avatar(p.mint, sym)}$${esc(sym)}</span></td>
      <td class="r">${fmtNum(ui, p.quote === SOL ? 6 : 3)} ${esc(SYM[p.quote] || market[p.quote]?.sym || short(p.quote))}</td><td class="r">${qp != null ? fmtUsd(ui * qp) : '—'}</td>
      <td><a href="https://solscan.io/tx/${esc(p.sig)}" target="_blank" rel="noopener">${esc(p.sig.slice(0, 8))}…</a></td></tr>`;
  }).join('');
  const btn = $('#btnCsv');
  btn.classList.toggle('hidden', !all.length);
  btn.onclick = () => {
    const lines = [['time_utc', 'coin_held', 'coin_mint', 'reward_asset', 'amount', 'signature'].join(',')]
      .concat(all.map(p => [new Date(p.ts * 1000).toISOString(), TOK[p.mint]?.sym || SYM[p.mint] || '', p.mint, SYM[p.quote] || p.quote, toUi(p.raw, p.dec), p.sig].join(',')));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
    a.download = `bobo-rewards-${(scanState?.wallet || 'wallet').slice(0, 8)}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
}

// ---------- overview: lifetime snapshot + live top-up ----------
let snapshot = null;
const live = {}; // mint -> {total, dist, rec, rounds, last, newestSlot}
async function loadSnapshot() {
  try { snapshot = await (await fetch('data/vaults.json', { cache: 'no-cache' })).json(); } catch { snapshot = null; }
  for (const t of TOKENS) { const c = LS.get('vd:' + t.mint, null); if (c && snapshot?.vaults?.[t.mint] && c.fromSlot === snapshot.vaults[t.mint].newestSlot) live[t.mint] = c; }
}
function vaultLifetime(mint) {
  const s = snapshot?.vaults?.[mint]; if (!s) return null;
  const dec = DEC[s.quote] ?? 6, l = live[mint];
  const total = Number(BigInt(s.total)) / 10 ** dec + (l ? l.total : 0);
  const rounds = s.rounds + (l ? l.rounds : 0), rec = s.recipientsSum + (l ? l.rec : 0);
  const last = Math.max(s.last || 0, l?.last || 0) || null;
  const asOf = l ? l.at : snapshot.generatedAt;
  return { total, rounds, avgRec: rounds ? rec / rounds : 0, first: s.first, last, asOf, days: s.first ? Math.max(1, (asOf - s.first) / 86400) : null };
}
function renderOverview() {
  if (!snapshot) return renderOverviewWindow();
  $('#ovRows').innerHTML = TOKENS.map(t => {
    const m = market[t.mint] || {}, v = vaultLifetime(t.mint), qs = SYM[t.quote], dp = qs === 'SOL' ? 2 : 0;
    const chg = m.chg != null ? `<span class="${m.chg >= 0 ? 'up' : 'down'} sm"> ${m.chg >= 0 ? '+' : ''}${m.chg.toFixed(1)}%</span>` : '';
    const dist = v ? `${fmtNum(v.total, dp)} ${esc(qs)}<span class="muted sm">${fmtUsd(v.total * (priceOf(t.quote) || 0))} today · ${v.rounds.toLocaleString()} round${v.rounds === 1 ? '' : 's'} · ~${fmtNum(v.avgRec, 0)} wallets/round</span>` : '—';
    const pd = v && v.days ? `${fmtNum(v.total / v.days, dp)} ${esc(qs)}` : '—';
    const links = [m.url && `<a href="${esc(m.url)}" target="_blank" rel="noopener">chart</a>`, `<a href="https://pump.fun/coin/${t.mint}" target="_blank" rel="noopener">pump</a>`, `<a href="https://solscan.io/account/${t.vault}" target="_blank" rel="noopener">vault</a>`, t.links.x && `<a href="${esc(t.links.x)}" target="_blank" rel="noopener">X</a>`].filter(Boolean).join(' · ');
    return `<tr><td><div class="tcell">${avatar(t.mint, t.sym)}<div><b>$${esc(t.sym)}</b> <span class="muted sm">${esc(t.name)}</span><br><span class="sm">${links}</span></div></div></td>
      <td class="r">${fmtPrice(m.price)}${chg}</td><td class="r">${fmtUsd(m.mcap)}${m.liq != null ? `<br><span class="muted sm">liq ${fmtUsd(m.liq)}</span>` : ''}</td><td class="r">${fmtUsd(m.vol)}</td>
      <td>${esc(qs)} <span class="muted sm">${esc(t.rate.includes('%') ? t.rate.split(' ·')[0] : '')}</span></td><td class="r dist">${dist}</td><td class="r">${pd}</td><td>${v && v.last ? esc(fmtTime(v.last)) + `<br><span class="muted sm">${esc(ago(v.last))}</span>` : '—'}</td></tr>`;
  }).join('');
  const asOf = Math.min(...TOKENS.map(t => vaultLifetime(t.mint)?.asOf || Infinity));
  $('#ovNote').innerHTML = `Lifetime totals from every on-chain <code>DistributeFeeToHolders</code> event of each coin's holder-rewards vault, counted up to <b>${esc(fmtTime(asOf))}</b>. “Update to now” adds anything newer. Average per day = lifetime total ÷ days since the first payout. USD uses today's price. Token images come from each project's DexScreener profile.`;
}
async function updateVaults() {
  if (!snapshot || !HELIUS) return measureVaultsWindow();
  const btn = $('#btnMeasure'); btn.disabled = true; btn.textContent = 'Updating…';
  for (const t of TOKENS) {
    const s = snapshot.vaults?.[t.mint]; if (!s) continue;
    try {
      const prev = live[t.mint];
      const acc = prev ? { ...prev } : { fromSlot: s.newestSlot, newestSlot: s.newestSlot, total: 0, dist: 0, rec: 0, rounds: 0, last: s.last, at: 0 };
      const dec = DEC[s.quote] ?? 6;
      let tok = null, pages = 0, max = acc.newestSlot; const ts = [];
      do {
        btn.textContent = `Updating $${t.sym}…`;
        const r = await gtfa(t.vault, { slot: { gt: acc.newestSlot } }, tok);
        for (const tx of r.data) { max = Math.max(max, tx.slot); for (const e of distEvents(tx)) if (e.mint === t.mint) { acc.total += Number(BigInt(e.total)) / 10 ** dec; acc.dist++; acc.rec += e.recipients; ts.push(e.ts); } }
        tok = r.data.length ? r.token : null; pages++;
      } while (tok && pages < 8); // ≤ 4,000 txs (≈ 400 credits) per coin per click
      ts.sort((a, b) => a - b); let prevTs = acc.last || -1e12;
      for (const x of ts) { if (x - prevTs > 600) acc.rounds++; prevTs = x; }
      acc.last = Math.max(acc.last || 0, ...ts, 0) || acc.last; acc.newestSlot = max; acc.at = Math.floor(Date.now() / 1000);
      live[t.mint] = acc; LS.set('vd:' + t.mint, acc);
    } catch (e) { console.warn('vault update', t.sym, e); }
    renderOverview();
  }
  btn.disabled = false; btn.textContent = 'Update to now';
}


// ---------- tabs: leaderboards + burn tracker (precomputed JSON built on the box, see scripts/) ----------
const KNOWN = {
  BoboBurn11111111111111111111111111111111111: 'BoboBurn address',
  [DISTRIBUTOR]: 'pump.fun distributor',
};
const etFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
const fmtET = ts => ts ? etFmt.format(new Date(ts * 1000)) + ' ET' : '—';
const etDay = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric' });
const fmtDay = ts => ts ? etDay.format(new Date(ts * 1000)) : '—';
function walletCell(w) {
  const lbl = KNOWN[w] ? `<span class="lbl">${esc(KNOWN[w])}</span>` : '';
  return `<a class="mono" href="https://solscan.io/account/${esc(w)}" target="_blank" rel="noopener" title="${esc(w)}">${esc(short(w))}</a>${lbl}<a class="x" href="#/w/${esc(w)}" title="Open this wallet's rewards">rewards ›</a>`;
}
const rankCell = i => i < 3 ? `<span class="medal g${i + 1}">${i + 1}</span>` : `<span class="rk">${i + 1}</span>`;
const card = (k, v, sub, hl) => `<div class="card${hl ? ' hl' : ''}"><div class="k">${k}</div><div class="v">${v}</div>${sub ? `<div class="s">${sub}</div>` : ''}</div>`;
const dataCache = {};
async function loadData(name) {
  if (!dataCache[name]) dataCache[name] = fetch('data/' + name + '.json', { cache: 'no-cache' }).then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }).catch(e => { delete dataCache[name]; throw e; });
  return dataCache[name];
}
function coverNote(b, gen) {
  return `Covers <b>every</b> holder-reward payout (${b.distTxs.toLocaleString()} distribution transactions) from <b>${esc(fmtET(b.from))}</b> (first payout) to <b>${esc(fmtET(b.to))}</b>. Snapshot built ${esc(fmtET(gen))} (${esc(ago(gen))}); payouts after that are not included yet. Amount = the wallet's SOL/BOBO balance increase in each distribution transaction. USD uses today's price, not the price at payout time.`;
}
function renderCoinBoard(key) {
  return async () => {
    const C = key.toUpperCase();
    let d; try { d = await loadData('leaderboard'); } catch { $(`#lb${C}Rows`).innerHTML = '<tr><td colspan="5" class="muted">Could not load the leaderboard data.</td></tr>'; return; }
    const b = d[key], px = priceOf(BOBO);
    if (!b) { $(`#lb${C}Rows`).innerHTML = '<tr><td colspan="5" class="muted">No data yet.</td></tr>'; return; }
    $(`#lb${C}Cards`).innerHTML = card('BOBO paid out', `${fmtNum(b.totalPaid, 0)} BOBO`, px ? fmtUsd(b.totalPaid * px) + ' today' : '', true)
      + card('Wallets paid', b.wallets.toLocaleString(), `by the $${esc(C)} reward vault`)
      + card('Distributions scanned', b.distTxs.toLocaleString(), 'payout transactions')
      + card('Time range', esc(fmtDay(b.from)), `to ${esc(fmtDay(b.to))}`);
    $(`#lb${C}Note`).innerHTML = coverNote(b, d.generatedAt) + ` Reward vault: <a class="mono" href="https://solscan.io/account/${esc(b.vault)}" target="_blank" rel="noopener">${esc(short(b.vault))}</a>.`
      + (key === 'grr' ? ' The BoboBurn address holds 20% of GRR, so it receives GRR rewards like any holder.' : '');
    $(`#lb${C}Rows`).innerHTML = b.top.map((r, i) => `<tr><td class="r">${rankCell(i)}</td><td class="w">${walletCell(r.w)}</td><td class="r"><b>${fmtNum(r.bobo, 0)}</b></td><td class="r">${px ? fmtUsd(r.bobo * px) : '—'}</td><td class="r">${r.n.toLocaleString()}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">No payouts found.</td></tr>';
  };
}
async function renderLbSol() {
  let d; try { d = await loadData('leaderboard'); } catch { $('#lbSolRows').innerHTML = '<tr><td colspan="5" class="muted">Could not load the leaderboard data.</td></tr>'; return; }
  const b = d.sol, px = priceOf(SOL);
  $('#lbSolCards').innerHTML = card('SOL paid to holders', `${fmtNum(b.totalPaid, 2)} SOL`, px ? fmtUsd(b.totalPaid * px) + ' today' : '', true)
    + card('Payout txs', b.distTxs.toLocaleString(), 'BOBO reward vault')
    + card('Wallets paid', b.wallets.toLocaleString(), `since ${esc(fmtDay(b.from))}`)
    + card('Top 25 share', b.totalPaid ? (b.top.reduce((s, r) => s + r.sol, 0) / b.totalPaid * 100).toFixed(1) + '%' : '—', 'of all SOL paid');
  $('#lbSolNote').innerHTML = coverNote(b, d.generatedAt);
  $('#lbSolRows').innerHTML = b.top.map((r, i) => `<tr><td class="r">${rankCell(i)}</td><td class="w">${walletCell(r.w)}</td><td class="r"><b>${fmtNum(r.sol, 3)}</b> SOL</td><td class="r">${px ? fmtUsd(r.sol * px) : '—'}</td><td class="r">${r.n.toLocaleString()}</td></tr>`).join('');
}
let burnShown = 100;
async function renderBurns() {
  let d; try { d = await loadData('burns'); } catch { $('#burnRows').innerHTML = '<tr><td colspan="5" class="muted">Could not load the burn data.</td></tr>'; return; }
  const px = priceOf(BOBO), init = d.supply.initial || 1e9, bu = d.burned, ba = d.burnAddress;
  const pct = x => (x / init * 100).toFixed(x / init < 0.0001 ? 5 : 3) + '%';
  const lk = d.locked || { wallets: [{ w: ba.address, label: 'BoboBurn address', reason: 'Vanity address with no private key.', amount: ba.balance }], total: ba.balance, checkedNotCounted: [] };
  const out = bu.amount + lk.total;
  $('#burnCards').innerHTML = card('Burned (destroyed)', `${fmtNum(bu.amount, 0)} BOBO`, `${pct(bu.amount)} of supply${px ? ' · ' + fmtUsd(bu.amount * px) : ''}`, true)
    + card('Burn transactions', bu.count.toLocaleString(), `${bu.burners.toLocaleString()} wallet${bu.burners === 1 ? '' : 's'}`)
    + card('Locked (can never move)', `${fmtNum(lk.total, 0)} BOBO`, `${pct(lk.total)} of supply${px ? ' · ' + fmtUsd(lk.total * px) : ''}`)
    + card('Burned + locked', `${fmtNum(out, 0)} BOBO`, `${pct(out)} of supply${px ? ' · ' + fmtUsd(out * px) : ''}`);
  $('#lockCards').innerHTML = card('Locked total', `${fmtNum(lk.total, 0)} BOBO`, `${pct(lk.total)} of supply${px ? ' · ' + fmtUsd(lk.total * px) : ''}`, true)
    + card('Burned + locked combined', `${fmtNum(out, 0)} BOBO`, `${pct(out)} of supply${px ? ' · ' + fmtUsd(out * px) : ''}`)
    + card('Locked wallets', String(lk.wallets.length), `of ${(lk.holdersScanned || 0).toLocaleString()} BOBO holders checked`);
  const full = x => x.toLocaleString('en-US', { maximumFractionDigits: 0 });
  const lockCell = r => `<span class="lbl">${esc(r.label)}${r.kind === 'time-locked' ? ' · time-locked' : ''}</span><br><a class="mono" href="https://solscan.io/account/${esc(r.w)}" target="_blank" rel="noopener">${esc(short(r.w))}</a>`;
  $('#lockRows').innerHTML = (lk.wallets.length ? lk.wallets.map(r => `<tr><td class="w">${lockCell(r)}</td><td class="r"><b>${full(r.amount)}</b></td><td class="r">${pct(r.amount)}</td><td class="r">${px ? fmtUsd(r.amount * px) : '—'}</td><td class="why">${esc(r.reason)}</td></tr>`).join('')
    + `<tr class="tot"><td><b>Total locked</b></td><td class="r"><b>${full(lk.total)}</b></td><td class="r"><b>${pct(lk.total)}</b></td><td class="r">${px ? fmtUsd(lk.total * px) : '—'}</td><td class="muted">Burned + locked: <b>${full(out)} BOBO · ${pct(out)}</b></td></tr>`
    : '<tr><td colspan="5" class="muted">No provably locked wallets found.</td></tr>');
  $('#lockNote').innerHTML = `Checked all ${(lk.tokenAccounts || 0).toLocaleString()} BOBO token accounts (${(lk.holdersScanned || 0).toLocaleString()} holders) at the snapshot (${esc(ago(d.generatedAt))}). ${esc(lk.rules || '')} % is of the ${init.toLocaleString('en-US')} BOBO initial supply.`;
  $('#lockCheckedRows').innerHTML = (lk.checkedNotCounted || []).map(r => `<tr><td class="w"><a class="mono" href="https://solscan.io/account/${esc(r.w)}" target="_blank" rel="noopener">${esc(short(r.w))}</a></td><td class="r">${full(r.amount)}</td><td class="r">${pct(r.amount)}</td><td class="why">${esc(r.why)}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">None.</td></tr>';
  const check = bu.matchesSupply ? `Cross-check passed: initial supply ${init.toLocaleString('en-US')} − current supply ${d.supply.current.toLocaleString('en-US', { maximumFractionDigits: 6 })} = ${fmtNum(d.supply.burnedBySupply, 2)} BOBO, exactly the sum of the burns listed.`
    : `Note: initial − current supply = ${fmtNum(d.supply.burnedBySupply, 2)} BOBO, while the listed burns add to ${fmtNum(bu.amount, 2)} BOBO.`;
  $('#burnNote').innerHTML = `Scanned <b>every</b> successful transaction that touched the BOBO mint (${d.range.txsScanned.toLocaleString()} txs) from the mint's creation on <b>${esc(fmtET(d.range.from))}</b> up to the snapshot at <b>${esc(fmtET(d.generatedAt))}</b> (${esc(ago(d.generatedAt))}). ${check} USD uses today's price.`;
  $('#burnTopRows').innerHTML = d.topBurners.length ? d.topBurners.map((r, i) => `<tr><td class="r">${rankCell(i)}</td><td>${walletCell(r.w)}</td><td class="r"><b>${fmtNum(r.amount, 2)}</b></td><td class="r">${px ? fmtUsd(r.amount * px) : '—'}</td><td class="r">${r.n}</td><td>${esc(fmtET(r.last))}</td></tr>`).join('') : '<tr><td colspan="6" class="muted">No burns found.</td></tr>';
  const rows = d.burns.slice(0, burnShown);
  $('#burnCount').textContent = `(${bu.count.toLocaleString()} total, newest first${d.burns.length < bu.count ? `, latest ${d.burns.length.toLocaleString()} listed` : ''})`;
  $('#burnRows').innerHTML = rows.map(b => `<tr><td>${esc(fmtET(b.ts))}</td><td class="r">${fmtNum(b.amount, 2)}</td><td class="r">${px ? fmtUsd(b.amount * px) : '—'}</td><td>${walletCell(b.w)}</td><td><a href="https://solscan.io/tx/${esc(b.sig)}" target="_blank" rel="noopener">${esc(b.sig.slice(0, 8))}…</a></td></tr>`).join('') || '<tr><td colspan="5" class="muted">No burns found.</td></tr>';
  $('#btnBurnMore').classList.toggle('hidden', d.burns.length <= burnShown);
  const kinds = Object.entries(ba.byKind || {}).map(([k, v]) => `${fmtNum(v.amount, 0)} BOBO via ${esc(k)} (${v.n.toLocaleString()} tx${v.n === 1 ? '' : 's'})`).join(' · ');
  $('#burnAddr').innerHTML = `<p>How BOBO reached the BoboBurn address: ${kinds || 'none found'}.${d.incinerator && !d.incinerator.balance ? ' The Solana incinerator (1nc1nerator…) holds 0 BOBO.' : ''}</p>`;
  if (location.hash === '#/burns/locked' && !renderBurns.jumped) { renderBurns.jumped = true; setTimeout(() => $('#locked').scrollIntoView({ block: 'start' }), 0); }
}
$('#btnBurnMore').addEventListener('click', () => { burnShown += 200; renderBurns(); });

// ---------- rewards forecast (GRR / STORMIE / SOL tabs) ----------
// Estimate only: pool rewards = projected daily volume (in the quote asset) x reward rate measured from past payouts
// (data/forecast.json, built on the box from every trade event and every DistributeFeeToHolders payout). Your share =
// your holding / eligible supply (measured from recent payouts). See the "How this estimate works" box on each tab.
const STORMIE_MINT = 'HqyTxEqk7qmLu2Gnx46eEZwQhzCf2yVqRompLaKYpump';
const FC = { grr: { el: 'fcGRR', mint: GRR, pay: BOBO }, stormie: { el: 'fcSTORMIE', mint: STORMIE_MINT, pay: BOBO }, sol: { el: 'fcSol', mint: BOBO, pay: SOL } };
const FC_H = [[1, '1 day'], [7, '7 days'], [30, '30 days'], [182, '6 months']];
const FC_PRE = [[1, 'Now'], [2, '2x MC'], [5, '5x MC'], [10, '10x MC']];
const fcState = {};
function parseAmt(v) {
  const m = /^\s*\$?\s*([0-9][0-9,]*\.?[0-9]*|\.[0-9]+)\s*([kmb])?\s*$/i.exec(String(v || ''));
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, '')) * ({ k: 1e3, m: 1e6, b: 1e9 }[(m[2] || '').toLowerCase()] || 1);
  return isFinite(n) ? n : null;
}
const fcTier = (mcSol, tiers) => { let b = tiers[0][1]; for (const [t, bps] of tiers) if (mcSol >= t) b = bps; return b; };
const logPos = (v, lo, hi) => Math.round(1000 * Math.log(Math.max(lo, Math.min(hi, v)) / lo) / Math.log(hi / lo));
const logVal = (p, lo, hi) => lo * Math.pow(hi / lo, p / 1000);
const nice = v => { const e = Math.pow(10, Math.floor(Math.log10(v)) - 1); return Math.round(v / e) * e; };
const pctS = (x, dp = 2) => x == null || !isFinite(x) ? '—' : (x * 100).toFixed(dp) + '%';

function fcModel(key, D) {
  const s = D.src[key], c = FC[key], st = fcState[key];
  const px = priceOf(c.pay) || (c.pay === SOL ? D.prices.solUsd : D.prices.boboUsd);
  const solPx = priceOf(SOL) || D.prices.solUsd;
  let rate, tierBps = null;
  if (key === 'sol') { tierBps = fcTier(st.mc / solPx, D.solFeeTiers); rate = tierBps / 1e4 * (s.d30.chargedShare || 1) * (s.d30.payoutToFee || 1); }
  else rate = s.d30.rewardRate;
  const wr = (s.weeks || []).slice(0, 6).map(w => w.rate).filter(x => x > 0);
  const mean = wr.length ? wr.reduce((a, b) => a + b, 0) / wr.length : null;
  const lo = mean ? Math.min(1, Math.min(...wr) / mean) : 0.5, hi = mean ? Math.max(1, Math.max(...wr) / mean) : 1.5;
  const perDay = px ? st.vol / px * rate : null; // pool rewards per day, in the pay token
  const tot = perDay * st.h, elig = s.eligible?.supply || s.supply;
  const share = st.hold > 0 && elig ? Math.min(1, st.hold / elig) : 0;
  const holdUsd = st.hold > 0 && s.supply ? st.hold * st.mc / s.supply : null;
  return { s, px, solPx, rate, tierBps, lo, hi, perDay, tot, elig, share, holdUsd, wr };
}

function fcChart(s, D, key) {
  const days = (s.days || []).slice(-30); if (days.length < 5) return '';
  const rate = s.d30.rewardRate, W = 600, H = 120, P = 4;
  const max = Math.max(...days.map(d => Math.max(d.paid, d.vol * rate))) || 1, bw = (W - 2 * P) / days.length;
  const y = v => H - P - (v / max) * (H - 2 * P);
  const bars = days.map((d, i) => `<rect x="${(P + i * bw + 1).toFixed(1)}" y="${y(d.paid).toFixed(1)}" width="${Math.max(1, bw - 2).toFixed(1)}" height="${(H - P - y(d.paid)).toFixed(1)}" rx="1.5" fill="#b90c2a"><title>${esc(d.d)}: ${fmtNum(d.paid)} ${esc(s.pay)} paid · volume ${fmtUsd(d.volUsd)}</title></rect>`).join('');
  const line = days.map((d, i) => `${i ? 'L' : 'M'}${(P + i * bw + bw / 2).toFixed(1)} ${y(d.vol * rate).toFixed(1)}`).join(' ');
  return `<div class="fcChart"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Daily rewards paid vs. rate times volume, last 30 days">${bars}<path d="${line}" fill="none" stroke="#f6c26b" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>
    <div class="fcLeg"><span><i class="b"></i>${esc(s.pay)} actually paid per day</span><span><i class="l"></i>volume × ${pctS(rate)} (the model)</span><span class="muted">last 30 full days (UTC) · ${esc(days[0].d)} → ${esc(days[days.length - 1].d)}</span></div></div>`;
}

function fcDraw(key, D) {
  const st = fcState[key], c = FC[key], root = document.getElementById(c.el); if (!root || !st) return;
  const m = fcModel(key, D), s = m.s, sym = s.sym, pay = s.pay, dp = pay === 'SOL' ? 3 : 0;
  const q = id => root.querySelector('[data-fc="' + id + '"]');
  if (!q('mc')) return;
  if (document.activeElement !== q('mc')) q('mc').value = fmtUsd(st.mc).replace('$', '');
  if (document.activeElement !== q('vol')) q('vol').value = fmtUsd(st.vol).replace('$', '');
  q('mcR').value = logPos(st.mc, st.mcLo, st.mcHi); q('volR').value = logPos(st.vol, st.volLo, st.volHi);
  root.querySelectorAll('[data-h]').forEach(b => b.classList.toggle('on', Number(b.dataset.h) === st.h));
  root.querySelectorAll('[data-pre]').forEach(b => b.classList.toggle('on', st.pre === Number(b.dataset.pre)));
  const hl = FC_H.find(h => h[0] === st.h)[1];
  const usd = x => m.px ? fmtUsd(x * m.px) : '—';
  const rng = x => `${fmtNum(x * m.lo, dp)} – ${fmtNum(x * m.hi, dp)} ${esc(pay)}`;
  const you = m.tot * m.share;
  q('out').innerHTML =
    card(`All ${esc(sym)} holders · ${esc(hl)}`, `${fmtNum(m.tot, dp)} ${esc(pay)}`, `≈ ${usd(m.tot)} · range ${rng(m.tot)}`, true)
    + card(`Your estimate · ${esc(hl)}`, st.hold > 0 ? `${fmtNum(you, pay === 'SOL' ? 4 : 0)} ${esc(pay)}` : '—',
      st.hold > 0 ? `≈ ${usd(you)} · ${pctS(m.share, m.share < 0.001 ? 4 : 2)} of eligible supply` : 'Enter a holding or wallet below')
    + card('Per day · all holders', `${fmtNum(m.perDay, dp)} ${esc(pay)}`, `≈ ${usd(m.perDay)} at ${fmtUsd(st.vol)}/day volume`)
    + card(`Per 1M ${esc(sym)} held · ${esc(hl)}`, `${fmtNum(m.elig ? m.tot * 1e6 / m.elig : null, pay === 'SOL' ? 4 : 0)} ${esc(pay)}`, `≈ ${m.elig ? usd(m.tot * 1e6 / m.elig) : '—'}`);
  const rateTxt = key === 'sol'
    ? `creator-fee tier at ${fmtNum(st.mc / m.solPx, 0)} SOL market cap: <b>${(m.tierBps / 100).toFixed(m.tierBps % 10 ? 3 : 2)}%</b> → effective <b>${pctS(m.rate, 3)}</b> of volume`
    : `<b>${pctS(m.rate)}</b> of ${esc(sym)} volume (3% creator fee, ~${pctS(s.d30.chargedShare, 0)} of volume charged)`;
  q('rate').innerHTML = `Reward rate used: ${rateTxt}. ${esc(pay)} price ${fmtPrice(m.px)} (today).`;
  q('hold').classList.toggle('bad', st.holdErr);
  q('holdNote').innerHTML = st.holdMsg || (st.hold > 0 ? `${fmtNum(st.hold, 0)} ${esc(sym)} ≈ ${fmtUsd(m.holdUsd)} at this market cap${m.holdUsd != null && m.holdUsd < MIN_ELIGIBLE_USD ? ' · <span class="tag no">below the ~$20 minimum, may receive nothing</span>' : ''}` : `Eligible supply ≈ ${fmtNum(m.elig, 0)} ${esc(sym)} (measured from recent payouts)`);
  q('warn').classList.toggle('hidden', st.h < 30);
}

async function renderForecast(key) {
  const c = FC[key], root = document.getElementById(c.el); if (!root) return;
  let D; try { D = await loadData('forecast'); } catch { root.innerHTML = '<p class="muted">Could not load the forecast data.</p>'; return; }
  const s = D.src[key]; if (!s) { root.innerHTML = '<p class="muted">No forecast data yet.</p>'; return; }
  const live = market[c.mint] || {};
  const liveMc = live.mcap || s.live?.mcUsd, liveVol = live.vol ?? s.live?.vol24Usd ?? s.d7.volUsdPerDay;
  let st = fcState[key];
  if (!st) {
    st = fcState[key] = { mc: liveMc, vol: liveVol, h: 30, pre: 1, hold: 0, holdMsg: '', holdErr: false, baseMc: liveMc, baseVol: liveVol };
    st.mcLo = nice(liveMc / 20); st.mcHi = nice(liveMc * 200); st.volLo = 50; st.volHi = nice(Math.max(liveVol, s.d30.volUsdPerDay, 1000) * 200);
    const sym = s.sym, pay = s.pay, dp = pay === 'SOL' ? 3 : 0;
    const corr = s.corr30?.paidVsVol, weak = corr == null || corr < 0.6;
    const wk = (s.weeks || []).slice(0, 6);
    root.innerHTML = `
      <div class="secHead"><div><h2>Rewards forecast <span class="est">estimate</span></h2>
        <p class="muted">What $${esc(sym)} holders could receive in <b>${esc(pay)}</b> at a market cap and daily trading volume you choose, using the reward rate measured from past payouts. Estimate only: not a guarantee and not financial advice.</p></div></div>
      <div class="fcGrid">
        <div class="fcIn">
          <div class="fcPre" role="group" aria-label="Presets">${FC_PRE.map(([x, l]) => `<button type="button" class="chip" data-pre="${x}">${l}</button>`).join('')}</div>
          <p class="muted sm fcPreNote">Presets multiply today's market cap and scale daily volume by the same factor (same turnover as now).</p>
          <label class="fcF"><span>$${esc(sym)} market cap (USD)</span><input data-fc="mc" type="text" inputmode="decimal" aria-label="Projected market cap in USD"></label>
          <input data-fc="mcR" type="range" min="0" max="1000" aria-label="Projected market cap slider">
          <p class="muted sm">Now ${fmtUsd(liveMc)}${key === 'sol' ? ' · on BOBO the market cap sets pump.fun\'s creator-fee tier' : ' · on GRR/STORMIE the market cap changes your holding\'s value, not the fee rate'}</p>
          <label class="fcF"><span>Daily trading volume (USD)</span><input data-fc="vol" type="text" inputmode="decimal" aria-label="Projected daily volume in USD"></label>
          <input data-fc="volR" type="range" min="0" max="1000" aria-label="Projected daily volume slider">
          <p class="muted sm">Use: <button type="button" class="btn link sm" data-v="${liveVol}">24h ${fmtUsd(liveVol)}</button> · <button type="button" class="btn link sm" data-v="${s.d7.volUsdPerDay}">7d avg ${fmtUsd(s.d7.volUsdPerDay)}</button> · <button type="button" class="btn link sm" data-v="${s.d30.volUsdPerDay}">30d avg ${fmtUsd(s.d30.volUsdPerDay)}</button></p>
          <div class="fcF"><span>Time horizon</span><div class="seg" role="group" aria-label="Time horizon">${FC_H.map(([d, l]) => `<button type="button" data-h="${d}">${l}</button>`).join('')}</div></div>
          <label class="fcF"><span>Your $${esc(sym)} holding</span><span class="fcHold"><input data-fc="hold" type="text" spellcheck="false" placeholder="Amount (e.g. 5m) or wallet address" aria-label="Your holding amount or wallet address"><button type="button" class="btn sm" data-fc="holdGo">Apply</button></span></label>
          <p class="muted sm" data-fc="holdNote"></p>
        </div>
        <div class="fcRes">
          <div class="cards fcCards" data-fc="out"></div>
          <p class="sm fcRate" data-fc="rate"></p>
          <div class="note fcWarn hidden" data-fc="warn"><b>Long horizon:</b> 30-day and especially 6-month numbers are extra uncertain. They assume today's volume, fee rate, holder base and ${esc(pay)} price hold for the whole period, which rarely happens for small-cap coins. Treat them as a what-if, not an expectation.</div>
        </div>
      </div>
      ${fcChart(s, D, key)}
      <details class="fcHow"><summary>How this estimate works</summary>
        <p><b>Formula.</b> Pool rewards per day (${esc(pay)}) = daily volume (USD) ÷ ${esc(pay)} price (USD) × reward rate. Period total = per day × days. Your rewards = pool rewards × your holding ÷ eligible supply. ${key === 'sol'
          ? `Reward rate = pump.fun creator-fee tier at the projected market cap (in SOL, <a href="https://pump.fun/docs/fees" target="_blank" rel="noopener">fee schedule</a>) × share of volume actually charged (${pctS(s.d30.chargedShare, 1)}, last 30d) × payouts ÷ fees (${s.d30.payoutToFee?.toFixed(3)}).`
          : `Reward rate = BOBO paid to holders ÷ ${esc(sym)} volume in BOBO over the last 30 days (${pctS(s.d30.rewardRate)}). ${esc(sym)} is a BOBO pair with a flat 3% creator fee (seen on every fee-charging trade, at every market cap so far); part of the volume comes from routed multi-hop trades that carry no fee, so the effective rate is lower.`}</p>
        <p><b>Measured (last 30 full days, UTC).</b> Volume ${fmtUsd(s.d30.volUsd)} (${fmtUsd(s.d30.volUsdPerDay)}/day) · creator fees ${fmtNum(s.d30.fee, dp)} ${esc(pay)} · paid to holders ${fmtNum(s.d30.paid, dp)} ${esc(pay)} (${fmtNum(s.d30.paidPerDay, dp)}/day) · payouts ÷ fees ${s.d30.payoutToFee?.toFixed(3)} · ${fmtNum(s.d30.rewardPerUsdVol, pay === 'SOL' ? 7 : 3)} ${esc(pay)} paid per $1 of volume.
          Daily correlation of payouts with volume: <b>${corr == null ? '—' : corr.toFixed(2)}</b>${weak ? ' (weak: payouts are batched and lag trades, so daily numbers are noisy; the range matters more)' : ' (strong: payouts track volume closely)'}.</p>
        <p><b>Range.</b> The range uses the lowest and highest weekly reward rate of the last ${wk.length} weeks: ${wk.map(w => pctS(w.rate)).join(' · ') || '—'}.</p>
        <p><b>Eligible supply.</b> ${fmtNum(s.eligible?.supply, 0)} ${esc(sym)} of ${fmtNum(s.supply, 0)} total: measured from the last 2 days of payouts (each wallet's share of payouts matches its share of this amount; the pool and wallets under the ~$20 minimum are not paid).</p>
        <p><b>Assumes:</b> the volume you enter is sustained every day; the fee rate stays as measured (pump.fun can change fees); USD uses today's ${esc(pay)} price; your holding and other holders' balances don't change. Data: every trade event and every <code>DistributeFeeToHolders</code> payout on-chain (Helius), BOBO/SOL daily prices from GeckoTerminal, live market cap and 24h volume from DexScreener. Snapshot built ${esc(fmtET(D.generatedAt))} (${esc(ago(D.generatedAt))}).</p>
      </details>
      <p class="muted sm fcDisc">Estimate based on past payout rates. Not a guarantee of future rewards and not financial advice. Rewards depend on future trading volume, which nobody can predict.</p>`;
    const q = id => root.querySelector('[data-fc="' + id + '"]');
    const redraw = () => fcDraw(key, D);
    root.querySelectorAll('[data-pre]').forEach(b => b.addEventListener('click', () => { const x = Number(b.dataset.pre); st.pre = x; st.mc = st.baseMc * x; st.vol = st.baseVol * x; redraw(); }));
    root.querySelectorAll('[data-h]').forEach(b => b.addEventListener('click', () => { st.h = Number(b.dataset.h); redraw(); }));
    root.querySelectorAll('[data-v]').forEach(b => b.addEventListener('click', () => { st.vol = Number(b.dataset.v); st.pre = null; redraw(); }));
    q('mcR').addEventListener('input', e => { st.mc = nice(logVal(+e.target.value, st.mcLo, st.mcHi)); st.pre = null; redraw(); });
    q('volR').addEventListener('input', e => { st.vol = nice(logVal(+e.target.value, st.volLo, st.volHi)); st.pre = null; redraw(); });
    q('mc').addEventListener('change', e => { const v = parseAmt(e.target.value); if (v > 0) { st.mc = v; st.pre = null; } redraw(); });
    q('vol').addEventListener('change', e => { const v = parseAmt(e.target.value); if (v >= 0) { st.vol = v; st.pre = null; } redraw(); });
    const applyHold = async () => {
      const raw = q('hold').value.trim(); st.holdErr = false; st.holdMsg = '';
      if (!raw) { st.hold = 0; return redraw(); }
      if (isAddress(raw)) {
        st.holdMsg = 'Looking up the wallet…'; redraw();
        try { const bal = await loadBalances(raw); if (bal.__failed) throw new Error('lookup failed');
          st.hold = bal[c.mint] || 0; st.holdMsg = `Wallet <span class="mono">${esc(short(raw))}</span> holds <b>${fmtNum(st.hold, 0)} ${esc(sym)}</b>${st.hold ? '' : ' (nothing to forecast)'}.`;
        } catch { st.holdErr = true; st.holdMsg = 'Could not read that wallet right now. Enter the amount instead.'; }
        return redraw();
      }
      const v = parseAmt(raw); if (v == null) { st.holdErr = true; st.holdMsg = 'Enter an amount like 2500000 or 2.5m, or a Solana wallet address.'; } else st.hold = v;
      redraw();
    };
    q('holdGo').addEventListener('click', applyHold);
    q('hold').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); applyHold(); } });
    if (lastWallet) { q('hold').value = lastWallet; applyHold(); }
  } else if (st.pre === 1 && liveMc && (liveMc !== st.baseMc || liveVol !== st.baseVol)) {
    st.baseMc = st.mc = liveMc; st.baseVol = st.vol = liveVol; // live market data arrived: refresh the "Now" values
  }
  fcDraw(key, D);
  if (/\/forecast$/.test(location.hash) && !renderForecast['jumped' + key]) { renderForecast['jumped' + key] = true; setTimeout(() => root.scrollIntoView({ block: 'start' }), 0); }
}

const withFc = (key, fn) => () => { fn(); renderForecast(key); };
const PANES = { rewards: null, grr: withFc('grr', renderCoinBoard('grr')), stormie: withFc('stormie', renderCoinBoard('stormie')), sol: withFc('sol', renderLbSol), burns: renderBurns };
let curPane = null, lastWallet = null;
function route() {
  if (location.hash === '#/leaders/bobo') history.replaceState(null, '', '#/leaders/grr'); // old combined tab
  const h = location.hash || '#/';
  const hb = h.replace(/\/forecast$/, '');
  const ext = window.BR_EXT ? window.BR_EXT.route(h) : null; // Race to listing + graduated pair tabs (js/race.js)
  const pane = ext ? ext : hb === '#/leaders/grr' ? 'grr' : hb === '#/leaders/stormie' ? 'stormie' : hb === '#/leaders/sol' ? 'sol' : (h === '#/burns' || h === '#/burns/locked') ? 'burns' : 'rewards';
  document.querySelectorAll('[data-pane]').forEach(el => el.classList.toggle('hidden', el.dataset.pane !== pane));
  document.querySelectorAll('.tab').forEach(el => { const on = el.dataset.tab === pane; el.classList.toggle('on', on); el.setAttribute('aria-selected', on); if (on && el.scrollIntoView && el.parentNode.scrollWidth > el.parentNode.clientWidth) el.parentNode.scrollLeft = Math.max(0, el.offsetLeft - 14); });
  const changed = curPane !== pane; curPane = pane;
  if (PANES[pane]) PANES[pane](); else if (ext) window.BR_EXT.render(pane);
  if (pane === 'rewards') {
    const m = /^#\/w\/([1-9A-HJ-NP-Za-km-z]{32,44})$/.exec(h);
    if (m && m[1] !== lastWallet) { lastWallet = m[1]; $('#addr').value = m[1]; go(m[1]); return; }
    const anchor = /^#([a-z]+)$/.exec(h);
    if (anchor && document.getElementById(anchor[1])) { setTimeout(() => document.getElementById(anchor[1]).scrollIntoView({ block: 'start' }), 0); return; }
  }
  if (changed) window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);

// ---------- UI wiring ----------
function setBusy(b) { $('#btnGo').disabled = b; $('#btnRefresh').disabled = b; $('#btnGo').textContent = b ? 'Scanning…' : 'Check rewards'; }
function go(addr) {
  addr = (addr || '').trim();
  if (!isAddress(addr)) { $('#addr').setCustomValidity('That does not look like a Solana address'); $('#addr').reportValidity(); return; }
  $('#addr').setCustomValidity('');
  lastWallet = addr;
  if (location.hash !== '#/w/' + addr) history.replaceState(null, '', '#/w/' + addr);
  scanWallet(addr);
  setTimeout(() => $('#wallet').scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
}
$('#f').addEventListener('submit', e => { e.preventDefault(); go($('#addr').value); });
$('#addr').addEventListener('input', () => $('#addr').setCustomValidity(''));
$('#btnExample').addEventListener('click', () => { $('#addr').value = EXAMPLE; go(EXAMPLE); });
$('#btnRefresh').addEventListener('click', () => scanState && scanWallet(scanState.wallet));
$('#btnMore').addEventListener('click', () => scanState && scanWallet(scanState.wallet, { more: true }));
$('#btnMeasure').addEventListener('click', updateVaults);
$('#btnWallet').addEventListener('click', async () => {
  const p = window.phantom?.solana || window.solflare || window.backpack?.solana || window.solana;
  if (!p?.connect) { $('#progTxt').textContent = ''; alert('No Solana wallet extension found. You can paste your address instead.'); return; }
  try { const r = await p.connect(); const pk = (r?.publicKey || p.publicKey)?.toString(); if (pk) { $('#addr').value = pk; go(pk); } }
  catch { /* user closed the popup */ }
});
const dlg = $('#dlg');
$('#btnSettings').addEventListener('click', () => { $('#rpcIn').value = LS.get('rpc', ''); $('#deepIn').checked = LS.get('deep', false); dlg.showModal(); });
$('#btnSave').addEventListener('click', () => {
  const v = $('#rpcIn').value.trim();
  if (v && !/^https:\/\//.test(v)) { alert('Use an https:// RPC URL'); return; }
  LS.set('rpc', v); LS.set('deep', $('#deepIn').checked); windowCache = null;
});
$('#btnClear').addEventListener('click', () => { Object.keys(localStorage).filter(k => /^br:(led|hled|v|vd):/.test(k)).forEach(k => localStorage.removeItem(k)); });

(async function init() {
  await loadSnapshot();
  if (snapshot) $('#btnMeasure').textContent = 'Update to now';
  renderOverview();
  route();
  await loadMarket();
  renderOverview();
  if (PANES[curPane]) PANES[curPane](); // re-render with live prices
})();
