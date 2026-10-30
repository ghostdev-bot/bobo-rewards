# 🐻 Bobo Rewards (unofficial)

An unofficial community tool. Paste a Solana wallet to see the pump.fun holder rewards it received from **$BOBO** (paid in SOL) and from BOBO pairs like $GRR and $STORMIE (paid in BOBO), read straight from on-chain data.

**Live:** https://boborewards.surge.sh

## How it works
- It reads the wallet's transaction history and keeps only transactions where the pump.fun program runs `DistributeFeeToHolders`. The coin is the instruction's mint account, and the amount is the wallet's SOL or token balance change in that transaction.
- Data comes from an archive RPC (optional, see below), with publicnode and Solana Tracker as free fallbacks, plus Jupiter lite-api (holdings, SOL price) and DexScreener (prices, market cap, logos).
- Results are cached in the browser. No backend, no wallet connection, no fees.

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
