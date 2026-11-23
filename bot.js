require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// ============================================================================
// KONFIGURASI UTAMA & PARAMETER STRATEGI KUANTITATIF
// ============================================================================
const CONFIG = {
  // Kontrak resmi cbBTC & USDC di jaringan Base
  CBBTC_ADDRESS: '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf',
  USDC_ADDRESS: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  CHAIN_ID: 'base',

  // Modal & Manajemen Risiko
  INITIAL_CAPITAL_USD: 1000.0,
  POSITION_SIZE_PCT: 0.98,      // Alokasi 98% modal per posisi (2% buffer)
  SIMULATED_SWAP_FEE: 0.0005,   // Simulasi fee pool Uniswap V3 Base (0.05%)
  TAKE_PROFIT_PCT: 0.03,        // +3.0% Take Profit
  STOP_LOSS_PCT: 0.015,         // -1.5% Stop Loss

  // Parameter Indikator (Timeframe 1-Menit)
  POLL_INTERVAL_MS: 60 * 1000,  // Polling setiap 1 menit (60.000 ms)
  FAST_SMA_PERIOD: 5,           // SMA Cepat (5 menit)
  SLOW_SMA_PERIOD: 15,          // SMA Lambat (15 menit)
  RSI_PERIOD: 14,               // RSI 14 periode
  RSI_OVERBOUGHT: 72,           // Hindari entry BUY jika RSI > 72

  // Durasi Evaluasi Kompetisi
  EVALUATION_HOURS: 24,
  LOG_FILE: path.join(__dirname, 'trade_history.json')
};

// ============================================================================
// STATE PORTOFOLIO SIMULASI
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
// FUNGSI UTILITAS & KALKULASI INDIKATOR TEKNIKAL
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
      usdcBalance: Number(state.cashBalance.toFixed(4)),
      cbbtcBalance: Number(state.cbbtcBalance.toFixed(8)),
      inPosition: state.inPosition,
      entryPriceUSD: state.entryPrice
    },
    tradeHistory: state.trades
  };

  try {
    fs.writeFileSync(CONFIG.LOG_FILE, JSON.stringify(report, null, 2));
  } catch (err) {
    console.error('[ERROR] Gagal menyimpan file audit log:', err.message);
  }
}

// ============================================================================
// PENGAMBILAN DATA HARGA ON-CHAIN BASE (DEXSCREENER & GECKOTERMINAL)
// ============================================================================
async function fetchBestBasePoolAndPrice() {
  const url = `https://api.dexscreener.com/latest/dex/tokens/${CONFIG.CBBTC_ADDRESS}`;
  const response = await axios.get(url, { timeout: 10000 });

  if (!response.data || !Array.isArray(response.data.pairs)) {
    throw new Error('Respons API DexScreener tidak valid.');
  }

  // Filter khusus jaringan Base dengan pasangan USDC dan likuiditas tertinggi
  const baseUsdcPairs = response.data.pairs.filter(
    (pair) =>
      pair.chainId === CONFIG.CHAIN_ID &&
      pair.quoteToken &&
      pair.quoteToken.address.toLowerCase() === CONFIG.USDC_ADDRESS.toLowerCase() &&
      pair.liquidity &&
      pair.liquidity.usd > 10000
  );

  if (baseUsdcPairs.length === 0) {
    throw new Error('Pool cbBTC/USDC di jaringan Base tidak ditemukan.');
  }

  // Urutkan berdasarkan likuiditas USD terbesar untuk menghindari manipulasi harga
  baseUsdcPairs.sort((a, b) => b.liquidity.usd - a.liquidity.usd);
  const topPair = baseUsdcPairs[0];

  return {
    pairAddress: topPair.pairAddress,
    dexId: topPair.dexId,
    priceUsd: parseFloat(topPair.priceUsd),
    liquidityUsd: topPair.liquidity.usd
  };
}

async function warmupHistoricalCandles(pairAddress) {
  try {
    console.log('[INIT] Mengambil data historis 1-menit dari GeckoTerminal untuk warmup indikator...');
    const url = `https://api.geckoterminal.com/api/v2/networks/base/pools/${pairAddress}/ohlcv/minute?aggregate=1&limit=30`;
    const res = await axios.get(url, {
      timeout: 10000,
      headers: { Accept: 'application/json' }
    });

    const ohlcvList = res.data?.data?.attributes?.ohlcv_list;
    if (Array.isArray(ohlcvList) && ohlcvList.length > 0) {
      // GeckoTerminal mengembalikan data terbaru di indeks 0; balik urutan ke kronologis
      const chronologicalCloses = ohlcvList
        .slice()
        .reverse()
        .map((candle) => parseFloat(candle[4]));

      state.priceHistory = chronologicalCloses;
      console.log(`[INIT] Berhasil memuat ${state.priceHistory.length} candle historis 1-menit.`);
    }
  } catch (err) {
    console.warn('[WARN] Warmup historis dilewati (akan mengumpulkan data live):', err.message);
  }
}

// ============================================================================
// EKSEKUSI PAPER TRADING (SIMULASI ORDER)
// ============================================================================
function executeBuy(price, reason) {
  if (state.inPosition || state.cashBalance <= 10) return;

  const usdToSpend = state.cashBalance * CONFIG.POSITION_SIZE_PCT;
  const feeUSD = usdToSpend * CONFIG.SIMULATED_SWAP_FEE;
  const netUsdInvested = usdToSpend - feeUSD;
  const boughtCbbtc = netUsdInvested / price;

  state.cashBalance -= usdToSpend;
  state.cbbtcBalance = boughtCbbtc;
  state.entryPrice = price;
  state.inPosition = true;

  const tradeRecord = {
    id: state.trades.length + 1,
    timestamp: new Date().toISOString(),
    action: 'BUY',
    priceUSD: Number(price.toFixed(2)),
    cbbtcAmount: Number(boughtCbbtc.toFixed(8)),
    usdValue: Number(usdToSpend.toFixed(2)),
    feeUSD: Number(feeUSD.toFixed(4)),
    reason
  };

  state.trades.push(tradeRecord);

  console.log('\n============================================================');
  console.log(`[ORDER EXECUTED] 🟢 BUY cbBTC @ ${formatUSD(price)}`);
  console.log(`Alasan         : ${reason}`);
  console.log(`Jumlah cbBTC   : ${boughtCbbtc.toFixed(8)} cbBTC`);
  console.log(`Biaya Simulasi : ${formatUSD(feeUSD)} (0.05% DEX Fee)`);
  console.log('============================================================\n');
}

function executeSell(price, reason) {
  if (!state.inPosition || state.cbbtcBalance <= 0) return;

  const grossUsdReceived = state.cbbtcBalance * price;
  const feeUSD = grossUsdReceived * CONFIG.SIMULATED_SWAP_FEE;
  const netUsdReceived = grossUsdReceived - feeUSD;

  const entryCost = state.cbbtcBalance * state.entryPrice;
  const tradePnLUSD = netUsdReceived - entryCost;
  const tradePnLPct = ((price - state.entryPrice) / state.entryPrice) * 100;

  state.cashBalance += netUsdReceived;
  const soldAmount = state.cbbtcBalance;
  state.cbbtcBalance = 0;
  state.inPosition = false;
  state.totalTrades += 1;
  if (tradePnLUSD > 0) state.winningTrades += 1;

  const tradeRecord = {
    id: state.trades.length + 1,
    timestamp: new Date().toISOString(),
    action: 'SELL',
    priceUSD: Number(price.toFixed(2)),
    cbbtcAmount: Number(soldAmount.toFixed(8)),
    usdValue: Number(netUsdReceived.toFixed(2)),
    feeUSD: Number(feeUSD.toFixed(4)),
    tradePnLUSD: Number(tradePnLUSD.toFixed(2)),
    tradePnLPercent: Number(tradePnLPct.toFixed(2)),
    reason
  };

  state.trades.push(tradeRecord);
  state.entryPrice = 0;

  const badge = tradePnLUSD >= 0 ? '💰 PROFIT' : '🔻 LOSS';
  console.log('\n============================================================');
  console.log(`[ORDER EXECUTED] 🔴 SELL cbBTC @ ${formatUSD(price)} (${badge})`);
  console.log(`Alasan         : ${reason}`);
  console.log(`Trade PnL      : ${formatUSD(tradePnLUSD)} (${tradePnLPct.toFixed(2)}%)`);
  console.log(`Saldo Kas Baru : ${formatUSD(state.cashBalance)}`);
  console.log('============================================================\n');
}

// ============================================================================
// LOOP UTAMA EVALUASI STRATEGI (INTERVAL 1 MENIT)
// ============================================================================
async function runTick() {
  const now = new Date();
  const elapsedMs = Date.now() - state.startTime;
  const elapsedHours = elapsedMs / (1000 * 60 * 60);

  try {
    const market = await fetchBestBasePoolAndPrice();
    const currentPrice = market.priceUsd;
    state.poolAddress = market.pairAddress;
    state.dexName = market.dexId;

    // Simpan harga terbaru (maksimal 100 titik data di memori)
    state.priceHistory.push(currentPrice);
    if (state.priceHistory.length > 100) {
      state.priceHistory.shift();
    }

    // Hitung indikator kuantitatif
    const fastSMA = calculateSMA(state.priceHistory, CONFIG.FAST_SMA_PERIOD);
    const slowSMA = calculateSMA(state.priceHistory, CONFIG.SLOW_SMA_PERIOD);
    const rsi = calculateRSI(state.priceHistory, CONFIG.RSI_PERIOD);

    // Evaluasi Sinyal Trading jika indikator sudah siap
    if (fastSMA !== null && slowSMA !== null) {
      if (state.inPosition) {
        const unrealizedReturn = (currentPrice - state.entryPrice) / state.entryPrice;

        // 1. Cek Take Profit (+3.0%)
        if (unrealizedReturn >= CONFIG.TAKE_PROFIT_PCT) {
          executeSell(
            currentPrice,
            `TAKE PROFIT tercapai (+${(unrealizedReturn * 100).toFixed(2)}%)`
          );
        }
        // 2. Cek Stop Loss (-1.5%)
        else if (unrealizedReturn <= -CONFIG.STOP_LOSS_PCT) {
          executeSell(
            currentPrice,
            `STOP LOSS terpicu (${(unrealizedReturn * 100).toFixed(2)}%)`
          );
        }
        // 3. Cek Bearish Crossover (Fast SMA memotong ke bawah Slow SMA)
        else if (fastSMA < slowSMA) {
          executeSell(
            currentPrice,
            `Bearish SMA Crossover (Fast ${fastSMA.toFixed(2)} < Slow ${slowSMA.toFixed(2)})`
          );
        }
      } else {
        // Sinyal ENTRY BUY: Bullish SMA Crossover + Filter RSI tidak overbought
        const isBullishTrend = fastSMA > slowSMA;
        const isRsiSafe = rsi === null || rsi < CONFIG.RSI_OVERBOUGHT;

        if (isBullishTrend && isRsiSafe) {
          executeBuy(
            currentPrice,
            `Bullish SMA Crossover (Fast ${fastSMA.toFixed(2)} > Slow ${slowSMA.toFixed(2)}) & RSI ${rsi ? rsi.toFixed(1) : 'N/A'}`
          );
        }
      }
    }

    // Kalkulasi Status Portofolio & Net PnL Real-Time
    const totalEquity = state.cashBalance + state.cbbtcBalance * currentPrice;
    const netPnLUSD = totalEquity - CONFIG.INITIAL_CAPITAL_USD;
    const netPnLPct = (netPnLUSD / CONFIG.INITIAL_CAPITAL_USD) * 100;

    // Cetak Status Log Setiap Menit
    const statusTag = state.inPosition ? 'LONG cbBTC' : 'CASH (USDC)';
    const smaInfo =
      fastSMA && slowSMA
        ? `SMA5: ${fastSMA.toFixed(2)} | SMA15: ${slowSMA.toFixed(2)} | RSI: ${rsi ? rsi.toFixed(1) : '--'}`
        : `Warmup Data (${state.priceHistory.length}/${CONFIG.SLOW_SMA_PERIOD})`;

    console.log(
      `[${now.toISOString()}] cbBTC: ${formatUSD(currentPrice)} | ${smaInfo} | Pos: ${statusTag} | Equity: ${formatUSD(totalEquity)} | Net PnL: ${netPnLUSD >= 0 ? '+' : ''}${formatUSD(netPnLUSD)} (${netPnLPct >= 0 ? '+' : ''}${netPnLPct.toFixed(2)}%)`
    );

    // Simpan ke file log JSON
    saveAuditLog(currentPrice);

    // Penanda saat mencapai target evaluasi 24 jam
    if (elapsedHours >= CONFIG.EVALUATION_HOURS && !state.evaluationCompleted) {
      state.evaluationCompleted = true;
      console.log('\n************************************************************');
      console.log('🏁 PERIODE EVALUASI 24 JAM MAKE.FUN SELESAI!');
      console.log(`Modal Awal     : ${formatUSD(CONFIG.INITIAL_CAPITAL_USD)}`);
      console.log(`Nilai Akhir    : ${formatUSD(totalEquity)}`);
      console.log(`Net PnL (%)    : ${netPnLPct >= 0 ? '+' : ''}${netPnLPct.toFixed(2)}%`);
      console.log(`Total Transaksi: ${state.totalTrades} siklus`);
      console.log(`Audit Log      : ${CONFIG.LOG_FILE}`);
      console.log('************************************************************\n');
    }
  } catch (error) {
    console.error(`[${now.toISOString()}] [API ERROR] Gagal mengambil data:`, error.message);
  }
}

// ============================================================================
// INISIALISASI BOT
// ============================================================================
async function startBot() {
  console.log('============================================================');
  console.log('🚀 MEMULAI MAKE.FUN QUANT PAPER TRADING BOT (cbBTC / BASE)');
  console.log(`Modal Simulasi : ${formatUSD(CONFIG.INITIAL_CAPITAL_USD)} USDC`);
  console.log(`Strategi       : SMA(${CONFIG.FAST_SMA_PERIOD}/${CONFIG.SLOW_SMA_PERIOD}) + RSI(${CONFIG.RSI_PERIOD}) | TP: +${CONFIG.TAKE_PROFIT_PCT * 100}% | SL: -${CONFIG.STOP_LOSS_PCT * 100}%`);
  console.log('============================================================');

  try {
    const initialMarket = await fetchBestBasePoolAndPrice();
    console.log(
      `[INIT] Pool Terhubung: ${initialMarket.dexId.toUpperCase()} (${initialMarket.pairAddress}) | Likuiditas: ${formatUSD(initialMarket.liquidityUsd)}`
    );
    await warmupHistoricalCandles(initialMarket.pairAddress);
  } catch (err) {
    console.warn('[INIT WARN] Inisialisasi awal tertunda, mencoba lagi pada tick pertama:', err.message);
  }

  // Jalankan tick pertama langsung, lalu ulangi setiap 60 detik
  await runTick();
  setInterval(runTick, CONFIG.POLL_INTERVAL_MS);
}

startBot();
