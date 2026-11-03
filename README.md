# 🐻 Bobo Rewards (unofficial)

An unofficial community tool. Paste a Solana wallet to see the pump.fun holder rewards it received from **$BOBO** (paid in SOL) and from BOBO pairs like $GRR and $STORMIE (paid in BOBO), read straight from on-chain data.

**Live:** https://boborewards.surge.sh

## How it works
- It reads the wallet's transaction history and keeps only transactions where the pump.fun program runs `DistributeFeeToHolders`. The coin is the instruction's mint account, and the amount is the wallet's SOL or token balance change in that transaction.
- Data comes from an archive RPC (optional, see below), with publicnode and Solana Tracker as free fallbacks, plus Jupiter lite-api (holdings, SOL price) and DexScreener (prices, market cap, logos).
- Results are cached in the browser. No backend, no wallet connection, no fees.

## Tabs
- **Rewards**: paste a wallet to see its holder rewards (above).
- **GRR Leaders** (`#/leaders/grr`): wallets ranked by BOBO received from $GRR holder-reward distributions.
- **STORMIE Leaders** (`#/leaders/stormie`): wallets ranked by BOBO received from $STORMIE holder-reward distributions.
- The old `#/leaders/bobo` link redirects to GRR Leaders.
- **SOL Leaders** (`#/leaders/sol`): wallets that received the most SOL from $BOBO holder rewards.
- **Burn Tracker** (`#/burns`): every SPL `Burn`/`BurnChecked` of the BOBO mint, top burners, and the BoboBurn address balance.

The leaderboards and burn tracker read precomputed snapshots (`site/data/leaderboard.json`, `site/data/burns.json`) built with the scripts in `scripts/` (Node 20, no dependencies). They scan the full on-chain history through Helius `getTransactionsForAddress` and cache their progress in `.cache/` (git-ignored), so reruns only fetch new transactions:

```bash
HELIUS_RPC="https://mainnet.helius-rpc.com/?api-key=YOUR_KEY" node scripts/build-leaderboard.mjs
HELIUS_RPC="https://mainnet.helius-rpc.com/?api-key=YOUR_KEY" node scripts/build-burns.mjs
```
If your key is restricted to a domain, set `HELIUS_ORIGIN` to that origin. The burn script cross-checks its total against the mint's supply change. The pages show the covered time range and when the snapshot was built.

## Run
```bash
cd site && python3 -m http.server 8765   # then open http://localhost:8765/
```

## Configuration
`site/js/config.js` sets `window.BR_CONFIG.heliusRpc`. It is empty in this repo. At deploy time, fill it with a browser RPC URL (for example a Helius URL restricted to your domain in the Helius dashboard), or have users enter one in ⚙ settings. Don't commit a real key.

Without an archive RPC, the free public RPCs only cover roughly the last 1.5 days.

## Limits
USD values use today's price, not the price at payout time. Not affiliated with pump.fun or the BOBO team. Not financial advice.

## License
MIT

## Locked wallet supply

`scripts/locked.mjs` (run inside `build-burns.mjs`) reads every BOBO token account each refresh and counts an owner as locked only if it is the Solana incinerator, the System Program address, a hand-picked vanity burn address (name + 20+ trailing `1`s) whose full history shows it never signed or sent BOBO, or a token-lock escrow (Streamflow / Jupiter Lock / Bonfida, shown as time-locked). Pools, bonding curves, multisigs, staking programs and regular wallets (exchanges included) are never counted; the biggest such holders are listed on the page as "checked, not counted". Deep link: `#/burns/locked`.
