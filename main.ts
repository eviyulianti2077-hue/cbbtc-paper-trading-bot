require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// ============================================================================
// MAIN CONFIGURATION & QUANTITATIVE STRATEGY PARAMETERS
// ============================================================================
const CONFIG = {
  // Official cbBTC & USDC contract addresses on Base Network
  CBBTC_ADDRESS: '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf',
  USDC_ADDRESS: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  CHAIN_ID: 'base',

  // Capital & Risk Management
  INITIAL_CAPITAL_USD: 1000.0,
  POSITION_SIZE_PCT: 0.98,      // Allocate 98% capital per trade (2% fee buffer)
  SIMULATED_SWAP_FEE: 0.0005,   // Simulated Base Uniswap V3 pool fee (0.05%)
  TAKE_PROFIT_PCT: 0.03,        // +3.0% Take Profit target
  STOP_LOSS_PCT: 0.015,         // -1.5% Stop Loss limit

  // Technical Indicator Parameters (1-Minute Timeframe)
  POLL_INTERVAL_MS: 60 * 1000,  // Poll every 1 minute (60,000 ms)
  FAST_SMA_PERIOD: 5,           // Fast SMA (5 minutes)
  SLOW_SMA_PERIOD: 15,          // Slow SMA (15 minutes)
  RSI_PERIOD: 14,               // RSI 14-period lookback
  RSI_OVERBOUGHT: 72,           // Avoid BUY entries when RSI > 72

  // Competition Evaluation Window
  EVALUATION_HOURS: 24,
  LOG_FILE: path.join(__dirname, 'trade_history.json')
};

// ============================================================================
// SIMULATED PORTFOLIO STATE
// ============================================================================
const state = {
  startTime: Date.now(),
  poolAddress: null,
  dexName: 'Base DEX',
  cashBalance: CONFIG.INITIAL_CAPITAL_USD,
  cbbtcBalance: 0,
  entryPrice: 0,
  inPosition: false,
  priceHistory: [],
  trades: [],
  totalTrades: 0,
  winningTrades: 0,
  evaluationCompleted: false
};

// ============================================================================
// UTILITY FUNCTIONS & TECHNICAL INDICATOR CALCULATIONS
// ============================================================================
function calculateSMA(prices, period) {
  if (prices.length < period) return null;
  const slice = prices.slice(-period);
  const sum = slice.reduce((acc, val) => acc + val, 0);
  return sum / period;
}

function calculateRSI(prices, period = 14) {
  if (prices.length <= period) return null;
  let gains = 0;
  let losses = 0;

  for (let i = prices.length - period; i < prices.length; i++) {
    const diff = prices[i] - prices[i - 1];
    if (diff >= 0) {
      gains += diff;
    } else {
      losses += Math.abs(diff);
    }
  }

  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;

  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function formatUSD(num) {
  return `$${Number(num).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

function saveAuditLog(currentPrice) {
  const portfolioValue = state.cashBalance + state.cbbtcBalance * currentPrice;
  const netPnLUSD = portfolioValue - CONFIG.INITIAL_CAPITAL_USD;
  const netPnLPct = (netPnLUSD / CONFIG.INITIAL_CAPITAL_USD) * 100;
  const elapsedHours = ((Date.now() - state.startTime) / (1000 * 60 * 60)).toFixed(2);

  const report = {
    competition: 'make.fun Bounty - cbBTC Base Paper Trading',
    lastUpdated: new Date().toISOString(),
    elapsedHours: Number(elapsedHours),
    pool: {
      network: CONFIG.CHAIN_ID,
      dex: state.dexName,
      pairAddress: state.poolAddress
    },
    performance: {
      initialCapitalUSD: CONFIG.INITIAL_CAPITAL_USD,
      currentPortfolioValueUSD: Number(portfolioValue.toFixed(4)),
      netPnLUSD: Number(netPnLUSD.toFixed(4)),
      netPnLPercent: Number(netPnLPct.toFixed(4)),
      totalCompletedRoundTrips: state.totalTrades,
      winRatePercent:
        state.totalTrades > 0
          ? Number(((state.winningTrades / state.totalTrades) * 100).toFixed(2))
          : 0
    },
    currentHoldings: {
      usdcBalance: Number(state.cashBalance.
