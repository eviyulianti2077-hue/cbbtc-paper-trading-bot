[![make.fun Competition](https://make.fun/badge/btc-race-24h-20261123-0511.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511)
[![make.fun Rank](https://make.fun/badge/btc-race-24h-20261123-0511/eviyulianti2077-hue/cbbtc-paper-trading-bot/rank.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511)
[![make.fun Reward](https://make.fun/badge/btc-race-24h-20261123-0511/eviyulianti2077-hue/cbbtc-paper-trading-bot/reward.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511)

[Race a BTC trading bot live for 24 hours on make.fun](https://make.fun/bounty/btc-race-24h-20261123-0511)

# Base cbBTC Quantitative Paper Trading Bot (make.fun Bounty)

An automated Node.js paper trading agent built to trade **Coinbase Wrapped BTC (`cbBTC/USDC`)** on the **Base** network using **1-minute on-chain price feeds**. Engineered specifically for the **make.fun** bounty competition with a core objective of maximizing **Net PnL (%)** over a 24-hour evaluation window.

---

## 1. Architecture & Quantitative Strategy

Rather than relying on off-chain centralized exchange (CEX) feeds, this agent pulls real-time on-chain liquidity pricing directly from the deepest `cbBTC/USDC` pool on Base (e.g., Uniswap V3 / Aerodrome) via **DexScreener** and historical OHLCV candles from **GeckoTerminal**.

### Signal Execution Logic (1-Minute Timeframe)
1. **Zero-Cold-Start Indicator Warmup:** Upon initialization, the bot fetches the last 30 1-minute historical candles so moving averages and momentum oscillators are immediately active from the very first tick.
2. **Entry Signal (BUY):**
  - **Bullish SMA Crossover:** `SMA-5` (5-minute) crosses above `SMA-15` (15-minute), capturing short-term upward momentum.
  - **Overbought Protection Filter:** `RSI-14 < 72` prevents buying into exhausted local tops prone to immediate mean-reversion pullbacks.
3. **Exit Signal (SELL):**
  - **Take Profit (+3.0%):** Automatically locks in gains once unrealized return hits `+3.0%` from the entry price.
  - **Stop Loss (-1.5%):** Strictly caps downside risk at `-1.5%`, enforcing a disciplined `1:2` Risk-to-Reward ratio.
  - **Trend Reversal Exit:** Exits positions early if `SMA-5` crosses back below `SMA-15` before hitting the stop-loss threshold.

---

## 2. Risk Management & Simulation Realism

- **Deepest Liquidity Pool Selection:** Automatically filters for the official Base `cbBTC` (`0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf`) and `USDC` (`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`) pair with the highest USD liquidity to prevent false triggers from low-liquidity wick manipulation.
- **DEX Swap Fee Simulation (0.05%):** Every simulated BUY and SELL order deducts a realistic `0.05%` swap fee (matching standard Uniswap V3 Base pool tiers) so reported **Net PnL (%)** reflects true net execution performance.
- **Fault-Tolerant Polling Loop:** Wrapped in structured error handling with 10-second HTTP request timeouts, ensuring continuous 24-hour uptime without crashing during transient RPC or API rate limits.
- **Automated JSON Audit Trail (`trade_history.json`):** Every 1-minute tick logs portfolio equity, execution prices, simulated DEX fees, win rate, and cumulative Net PnL into `trade_history.json` for transparent judge verification.

---

## 3. Setup & Execution Guide

### Prerequisites
- **Node.js** (`v18.0.0` or higher) installed on your machine.
- Stable internet connection for the 24-hour evaluation period.

### Running the Bot
1. Place `package.json`, `main.ts`, and `README.md` inside a dedicated project directory.
2. Open your terminal in the project directory and install dependencies:
   ```bash
   npm install
