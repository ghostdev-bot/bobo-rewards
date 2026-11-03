#!/usr/bin/env node
// Tops up site/data/vaults.json (Overview tab: lifetime distributed, rounds, wallets/round, last payout)
// with every DistributeFeeToHolders event newer than the snapshot's newestSlot for each vault.
// Incremental (only slots > newestSlot are fetched), so a normal 6h run costs ~10-40 Helius credits.
// Output format is unchanged, so site/js/app.js reads it as before.
import path from 'path';
import { fileURLToPath } from 'url';
import { gtfaAll, distEvents, readJson, writeJson, credits } from './lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'site/data/vaults.json');
const VAULTS = {
  '4nV5gNwwP68zUDat26ySChREqVaQaLudfJBkSgEzpump': '3aBa3DQdupVLbdEUWSRUCZ3dtQyQG1myLawx5CkniH8K', // BOBO
  'DBEjiLMt9USaM3SdC9YtNcKGnXLdFhzokwnykH4Wpump': '7soPKhkpy6qwLUKT293LavdyBak3s1aETp7rowAbKHZv', // GRR
  'HqyTxEqk7qmLu2Gnx46eEZwQhzCf2yVqRompLaKYpump': 'CaXHYNgfRVqmVbBRJrYEuuyJvCQNU47Q2Q6U1HvwHHKz', // STORMIE
  'CVpbSiehxxcFJFJ9jDcZ5ECHMcMomUM7GW99CdmQpump': '76zYsLQq5uGNnLmr5JbdMoo4SWLS1sz52QNm5bK5azd5', // GRRL
};
const snap = readJson(OUT, null);
if (!snap?.vaults) { console.error('vaults.json missing; run research/snapshot.mjs for a full rebuild'); process.exit(1); }
for (const [mint, vault] of Object.entries(VAULTS)) {
  const v = snap.vaults[mint]; if (!v) continue;
  let total = BigInt(v.total), n = 0, newTs = [], max = v.newestSlot;
  for await (const tx of gtfaAll(vault, { afterSlot: v.newestSlot, label: v.sym + ' vault' })) {
    n++; if (tx.slot > max) max = tx.slot;
    for (const e of distEvents(tx)) {
      if (e.mint !== mint) continue;
      total += e.total; v.distTxs++; v.recipientsSum += e.recipients; newTs.push(e.ts);
    }
  }
  newTs.sort((a, b) => a - b);
  let prev = v.last ?? -1e12;
  for (const t of newTs) { if (t - prev > 600) v.rounds++; prev = t; }
  if (newTs.length) { v.last = Math.max(v.last || 0, newTs.at(-1)); v.first = v.first ?? newTs[0]; }
  v.total = total.toString(); v.newestSlot = max; v.txsScanned += n;
  console.error(`${v.sym}: +${n} txs, +${newTs.length} payouts, rounds ${v.rounds}, last ${v.last ? new Date(v.last * 1000).toISOString() : '-'}`);
}
snap.generatedAt = Math.floor(Date.now() / 1000);
writeJson(OUT, snap);
console.error(`vaults.json updated, ~${credits} Helius credits`);
