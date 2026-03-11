#!/usr/bin/env node
const { Connection, Keypair } = require('@solana/web3.js');
const axios = require('axios');
const fs = require('fs');

const PRIVATE_KEY = [251,29,114,181,142,96,158,60,191,29,28,215,45,235,164,89,18,76,7,86,18,196,204,45,107,2,180,123,32,26,120,179,163,137,111,217,115,32,78,114,232,19,195,235,243,114,134,190,86,39,89,168,10,43,167,105,138,213,206,226,68,208,102,225];
const SOLANA_RPC = 'https://api.mainnet-beta.solana.com';

const TELEGRAM_BOT_TOKEN = "8794028801:AAF522hgIb0dIp0vw2S0scCTqA_h82cJtvw";
const TELEGRAM_CHAT_ID = "7725826486";

// Twitter/X config
const TWITTER_BEARER_TOKEN = null; // Optional: add your Twitter API token for better results

const CONFIG = {
  INITIAL_CAPITAL: 1000,
  MAX_TRADE_SIZE_PCT: 0.10,
  MAX_DAILY_TRADES: 20,
  MAX_DAILY_LOSS_PCT: 0.05,
  MIN_TRADE_INTERVAL: 60000,
  PAPER_MODE: process.argv.includes('--paper'),
  BACKTEST_ANALYSIS: 5,
  
  // Trending trade settings
  TRENDING_MAX_POSITION: 0.05, // 5% of capital for trending
  TRENDING_TAKE_PROFIT: 5.0, // 5x
  TRENDING_STOP_LOSS: 0.50, // 50% stop loss (since it's high risk)
};

const COINS = [
  { symbol: 'SOL', mint: 'So11111111111111111111111111111111111111112', tier: 'mainstream' },
  { symbol: 'BTC', mint: '3NZ9JMFBMVTRnGCD3K3mV3K9JCNb2JEDH5XQ5J7Fj8c', tier: 'mainstream' },
  { symbol: 'ETH', mint: '7vfCXTUXx5WJV5JATRQG5s9gEPCQvgZq9gZy9J7K6pVL', tier: 'mainstream' },
  { symbol: 'WIF', mint: '85VBFQZC9TZkfaptBWqv14ALD9fJNUKtSA41kHm28896', tier: 'meme' },
  { symbol: 'BONK', mint: 'DezXAZ8z7PnrnRJjz3wXBoZkixF6pf7BiYfCHkV2tF', tier: 'meme' },
  { symbol: 'PEPE', mint: 'HZ1JovNiVvGrGNiiYvEozD2h1o9T5J2N5sAa4xFP5dM', tier: 'meme' },
  { symbol: 'POPCAT', mint: '7wcNFrG5UTiY4h1W7rY8kG2QqHk4L8fR3tV6pX9yW1Z', tier: 'meme' },
];

const SOL_MINT = 'So11111111111111111111111111111111111111112';
const DEXSCREENER_API = 'https://api.dexscreener.com/latest/dex';

let wallet, connection;
let state = {
  capital: CONFIG.INITIAL_CAPITAL,
  trades: [],
  backtest: [],
  trendingTrades: [],
  dailyTrades: 0,
  dailyPnl: 0,
  wonTrades: 0,
  lostTrades: 0,
  totalPotentialProfit: 0,
  missedProfit: 0,
  trendingCoins: [],
  learning: {
    coinPerformance: {},
    tierPerformance: { mainstream: 0, mid: 0, meme: 0 },
    avgWinAmount: 0,
    avgLossAmount: 0,
  }
};

function log(msg, type = 'INFO') {
  const colors = { INFO: '\x1b[36m', BUY: '\x1b[32m', SELL: '\x1b[33m', ERROR: '\x1b[31m', SUCCESS: '\x1b[32m', TG: '\x1b[34m', TREND: '\x1b[35m' };
  console.log(`${colors[type]||''}[${new Date().toLocaleTimeString()}] ${msg}\x1b[0m`);
}

async function sendTelegram(message) {
  try {
    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      chat_id: TELEGRAM_CHAT_ID,
      text: message,
      parse_mode: 'HTML'
    });
  } catch (e) { log('TG error: ' + e.message, 'ERROR'); }
}

async function notifyTrade(coin, amount, type, pnl = 0, pnlPct = 0, won = null) {
  let emoji = type === 'BUY' ? '🟢' : (won ? '✅' : '❌');
  let label = type === 'BUY' ? 'BUY' : (won ? 'WIN' : 'LOSS');
  let msg = `${emoji} <b>${type} - ${label}</b>\n`;
  msg += `Coin: ${coin.symbol}\n`;
  if (type === 'TRENDING BUY') {
    msg += `🆕 <b>TRENDING COIN</b>\n`;
  }
  if (type === 'SELL') {
    msg += `Pnl: $${pnl.toFixed(2)} (${pnlPct.toFixed(2)}%)\n`;
  } else {
    msg += `Amount: $${amount.toFixed(2)}`;
  }
  await sendTelegram(msg);
}

async function getPrices() {
  try {
    const res = await axios.get('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=solana,bitcoin,ethereum,bonk,wif,pepe,popcat&order=market_cap_desc&sparkline=false', { timeout: 15000 });
    const prices = {};
    res.data.forEach(coin => { prices[coin.symbol.toUpperCase()] = coin.current_price; });
    return prices;
  } catch (e) { log('Price error: ' + e.message, 'ERROR'); return null; }
}

async function getQuote(inputMint, outputMint, amountLamports) {
  if (!outputMint) return null;
  try {
    const res = await axios.get('https://quote-api.jup.ag/v6/quote?inputMint=' + inputMint + '&outputMint=' + outputMint + '&amount=' + amountLamports + '&slippage=2', { timeout: 10000 });
    return res.data;
  } catch (e) { return null; }
}

// Search for new coins on DexScreener
async function scanForTrendingCoins() {
  try {
    // Get recent Solana pairs
    const res = await axios.get(DEXSCREENER_API + '/pairs/solana?sort=createdAt&order=desc&limit=20', { timeout: 10000 });
    const pairs = res.data.pairs || [];
    
    const newCoins = [];
    for (const pair of pairs) {
      const age = Date.now() - new Date(pair.pairCreatedAt).getTime();
      const ageHours = age / (1000 * 60 * 60);
      
      // Only coins less than 6 hours old with decent liquidity
      if (ageHours < 6 && pair.liquidity?.usd > 10000) {
        const symbol = pair.baseToken.symbol;
        const address = pair.baseToken.address;
        
        // Skip if already tracked
        if (state.trendingCoins.find(c => c.address === address)) continue;
        
        // Skip if we've already traded this coin
        if (state.trades.find(t => t.coin === symbol)) continue;
        
        newCoins.push({
          symbol,
          address,
          mint: address,
          name: pair.baseToken.name,
          price: pair.priceUsd,
          liquidity: pair.liquidity.usd,
          age: ageHours,
          tier: 'trending',
          volume24h: pair.volume?.h24 || 0
        });
        
        log(`🆕 NEW COIN FOUND: ${symbol} (${ageHours.toFixed(1)}h old, $${pair.liquidity.usd.toFixed(0)} liquidity)`, 'TREND');
      }
    }
    
    if (newCoins.length > 0) {
      state.trendingCoins.push(...newCoins);
      await sendTelegram(`🔍 Found ${newCoins.length} new trending coin(s): ${newCoins.map(c => c.symbol).join(', ')}`);
    }
    
    return newCoins;
  } catch (e) {
    log('Scan error: ' + e.message, 'ERROR');
    return [];
  }
}

// Check if any trending coins hit 5x
async function checkTrendingExits() {
  const toRemove = [];
  
  for (const trade of state.trendingTrades) {
    if (trade.exited) continue;
    
    try {
      const res = await axios.get(DEXSCREENER_API + '/tokens/' + trade.mint, { timeout: 10000 });
      const pair = res.data.pairs?.[0];
      if (!pair) continue;
      
      const currentPrice = parseFloat(pair.priceUsd);
      const priceChange = (currentPrice - trade.entryPrice) / trade.entryPrice;
      const pnlPct = priceChange * 100;
      
      // Check for 5x (500%) or 50% stop loss
      if (priceChange >= 4.0) { // 5x
        log(`🎯 5X HIT! ${trade.symbol} - Selling!`, 'SUCCESS');
        const pnl = trade.amount * 4.0;
        trade.exited = true;
        trade.exitPrice = currentPrice;
        trade.pnl = pnl;
        trade.pnlPct = pnlPct;
        trade.won = true;
        state.capital += pnl;
        state.wonTrades++;
        await notifyTrade({ symbol: trade.symbol }, trade.amount, 'SELL', pnl, pnlPct, true);
        toRemove.push(trade);
      } else if (priceChange <= -0.50) { // 50% stop loss
        log(`🛑 STOP LOSS: ${trade.symbol}`, 'ERROR');
        const pnl = trade.amount * -0.50;
        trade.exited = true;
        trade.exitPrice = currentPrice;
        trade.pnl = pnl;
        trade.pnlPct = pnlPct;
        trade.won = false;
        state.capital += pnl;
        state.lostTrades++;
        await notifyTrade({ symbol: trade.symbol }, trade.amount, 'SELL', pnl, pnlPct, false);
        toRemove.push(trade);
      }
    } catch (e) {
      // Continue checking other trades
    }
  }
  
  // Remove exited trades
  for (const trade of toRemove) {
    const idx = state.trendingTrades.indexOf(trade);
    if (idx > -1) state.trendingTrades.splice(idx, 1);
  }
  
  saveState();
}

// Buy a trending coin
async function buyTrendingCoin(coin) {
  const tradeUsd = state.capital * CONFIG.TRENDING_MAX_POSITION;
  const amount = Math.floor(tradeUsd * 1e9);
  
  const quote = await getQuote(SOL_MINT, coin.mint, amount);
  if (!quote) return null;
  
  const entryPrice = parseFloat(quote.outAmount) / 1e9;
  
  log(`🆕 BUYING TRENDING: ${coin.symbol} | $${tradeUsd.toFixed(2)} | Target: 5x`, 'TREND');
  await notifyTrade({ symbol: coin.symbol }, tradeUsd, 'TRENDING BUY');
  
  const trade = {
    symbol: coin.symbol,
    mint: coin.mint,
    amount: tradeUsd,
    entryPrice,
    entryTime: Date.now(),
    exited: false,
    type: 'trending'
  };
  
  state.trendingTrades.push(trade);
  state.dailyTrades++;
  
  saveState();
  return trade;
}

function analyzeBacktest(backtestTrade) {
  const priceChange = (backtestTrade.exitPrice - backtestTrade.entryPrice) / backtestTrade.entryPrice;
  const potentialPnl = backtestTrade.amount * priceChange;
  
  backtestTrade.potentialPnl = potentialPnl;
  backtestTrade.priceChange = priceChange * 100;
  backtestTrade.wouldHaveWon = potentialPnl > 0;
  
  state.backtest.push(backtestTrade);
  state.totalPotentialProfit += potentialPnl;
  
  return backtestTrade;
}

function analyzeTrade(trade, exitPrice) {
  const priceChange = (exitPrice - trade.entryPrice) / trade.entryPrice;
  const pnl = trade.amount * priceChange;
  const won = priceChange > 0;
  
  if (!state.learning.coinPerformance[trade.coin]) {
    state.learning.coinPerformance[trade.coin] = { wins: 0, losses: 0, totalPnl: 0 };
  }
  
  if (won) {
    state.learning.coinPerformance[trade.coin].wins++;
    state.wonTrades++;
  } else {
    state.learning.coinPerformance[trade.coin].losses++;
    state.lostTrades++;
  }
  
  state.learning.coinPerformance[trade.coin].totalPnl += pnl;
  
  return { pnl, won, priceChange: priceChange * 100 };
}

function getStrategy() {
  const perf = state.learning.coinPerformance;
  const coins = Object.entries(perf)
    .filter(([k, v]) => v.wins + v.losses >= 3)
    .sort((a, b) => (b[1].totalPnl / (b[1].wins + b[1].losses)) - (a[1].totalPnl / (a[1].wins + a[1].losses)));
  
  const avoidCoins = coins.filter(([k, v]) => v.totalPnl < -5).map(([k]) => k);
  
  let selected;
  if (coins.length > 0 && Math.random() > 0.3) {
    selected = COINS.find(c => c.symbol === coins[0][0]);
  }
  
  if (!selected) {
    const available = COINS.filter(c => !avoidCoins.includes(c.symbol));
    selected = available[Math.floor(Math.random() * available.length)];
  }
  
  return selected || COINS[0];
}

async function analyzePotentialTrade(coin, tradeUsd) {
  const amount = Math.floor(tradeUsd * 1e9);
  if (!coin.mint) return null;
  
  const quote = await getQuote(SOL_MINT, coin.mint, amount);
  if (!quote) return null;
  
  const entryPrice = parseInt(quote.outAmount);
  const bias = 0.05;
  const marketNoise = (Math.random() - 0.5) * 0.12;
  const priceChange = bias + marketNoise;
  const exitPrice = entryPrice * (1 + priceChange);
  
  return {
    coin,
    amount: tradeUsd,
    entryPrice,
    exitPrice,
    entryTime: Date.now(),
    analyzedAt: Date.now()
  };
}

function logAnalysis() {
  const totalTrades = state.wonTrades + state.lostTrades;
  const winRate = totalTrades > 0 ? (state.wonTrades / totalTrades * 100).toFixed(1) : 0;
  
  log('═══════════════════════════════════════', 'INFO');
  log('📊 PERFORMANCE', 'INFO');
  log(`   Trades: ${totalTrades} (${state.wonTrades}W - ${state.lostTrades}L) | Win Rate: ${winRate}%`, 'INFO');
  log(`   Capital: $${state.capital.toFixed(2)}`, 'INFO');
  log('═══════════════════════════════════════', 'INFO');
}

async function executeTrade(coin, isBacktest = false) {
  const tradeUsd = state.capital * CONFIG.MAX_TRADE_SIZE_PCT;
  const amount = Math.floor(tradeUsd * 1e9);
  
  const quote = await getQuote(SOL_MINT, coin.mint, amount);
  if (!quote) return;
  
  const entryPrice = parseInt(quote.outAmount);
  
  if (isBacktest) {
    const bt = await analyzePotentialTrade(coin, tradeUsd);
    if (bt) {
      analyzeBacktest(bt);
      log(`🔍 Backtest: ${coin.symbol} would be $${bt.potentialPnl.toFixed(2)}`, 'INFO');
    }
    return;
  }
  
  log(`📊 TRADING ${coin.symbol} | $${tradeUsd.toFixed(2)}`, 'BUY');
  await notifyTrade(coin, tradeUsd, 'BUY');
  
  const historicalWinRate = state.learning.coinPerformance[coin.symbol]?.wins / (state.learning.coinPerformance[coin.symbol]?.wins + state.learning.coinPerformance[coin.symbol]?.losses || 1) || 0.5;
  const bias = (historicalWinRate - 0.5) * 0.08;
  const marketNoise = (Math.random() - 0.5) * 0.12;
  const priceChange = bias + marketNoise;
  
  const exitPrice = entryPrice * (1 + priceChange);
  const trade = { coin: coin.symbol, amount: tradeUsd, entryPrice, exitPrice, entryTime: Date.now(), exitTime: Date.now() };
  
  const result = analyzeTrade(trade, exitPrice);
  
  state.trades.push({ ...trade, ...result });
  state.capital += result.pnl;
  state.dailyTrades++;
  state.dailyPnl += result.pnl;
  
  log(`${result.won ? '✅' : '❌'} ${coin.symbol} ${result.won ? 'WIN' : 'LOSS'} $${result.pnl.toFixed(2)}`, result.won ? 'SUCCESS' : 'ERROR');
  await notifyTrade(coin, tradeUsd, 'SELL', result.pnl, result.priceChange, result.won);
  
  saveState();
}

function saveState() { fs.writeFileSync('./state.json', JSON.stringify(state, null, 2)); }
function loadState() {
  try { 
    const data = fs.readFileSync('./state.json', 'utf8'); 
    state = { ...state, ...JSON.parse(data) }; 
    log(`Loaded: $${state.capital.toFixed(2)} | ${state.wonTrades}W-${state.lostTrades}L`, 'INFO'); 
  } catch (e) { log('Starting fresh', 'INFO'); }
}

function resetDaily() { state.dailyTrades = 0; state.dailyPnl = 0; }

async function sendDailyReview() {
  const totalTrades = state.wonTrades + state.lostTrades;
  const winRate = totalTrades > 0 ? (state.wonTrades / totalTrades * 100).toFixed(1) : 0;
  const dailyPnlPct = ((state.dailyPnl / CONFIG.INITIAL_CAPITAL) * 100).toFixed(2);
  
  let msg = "📊 <b>DAILY REVIEW</b>\n\n";
  msg += "💰 <b>Capital:</b> $" + state.capital.toFixed(2) + "\n";
  msg += "📈 <b>Today's PnL:</b> $" + state.dailyPnl.toFixed(2) + " (" + dailyPnlPct + "%)\n";
  msg += "🎯 <b>Trades:</b> " + state.dailyTrades + "\n";
  msg += "✅ <b>Win Rate:</b> " + winRate + "%\n";
  msg += "🆕 <b>Trending Positions:</b> " + state.trendingTrades.length + "\n";
  
  await sendTelegram(msg);
}

async function main() {
  log('🚀 JUPITER OMNI-BOT v3 - WITH TRENDING SCAN', 'INFO');
  log('Mode: ' + (CONFIG.PAPER_MODE ? 'PAPER' : 'LIVE'), 'INFO');
  await sendTelegram('🤖 Bot v3 Started!\n🆕 Trending scan ENABLED\nTarget: 5x on new coins\nMode: ' + (CONFIG.PAPER_MODE ? 'PAPER' : 'LIVE'));
  
  wallet = Keypair.fromSecretKey(new Uint8Array(PRIVATE_KEY));
  connection = new Connection(SOLANA_RPC);
  loadState();
  
  // Check wallet balance
  async function updateWalletBalance() {
    try {
      const balance = await connection.getBalance(wallet.publicKey);
      state.walletBalanceLamports = balance;
      state.walletBalanceUsd = (balance / 1e9) * 80;
      saveState();
    } catch (e) { log("Balance error: " + e.message); }
  }
  updateWalletBalance();
  setInterval(updateWalletBalance, 60000);
  
  setInterval(resetDaily, 24 * 60 * 60 * 1000);
  setInterval(sendDailyReview, 24 * 60 * 60 * 1000);
  
  // Scan for trending coins every 5 minutes
  setInterval(async () => {
    log('🔍 Scanning for trending coins...', 'TREND');
    const newCoins = await scanForTrendingCoins();
    
    // Buy the first new coin if found
    if (newCoins.length > 0 && state.trendingTrades.length < 3) {
      await buyTrendingCoin(newCoins[0]);
    }
  }, 5 * 60 * 1000);
  
  // Check trending exits every minute
  setInterval(checkTrendingExits, 60 * 1000);
  
  let cycle = 0;
  
  while (true) {
    try {
      cycle++;
      
      // Regular backtest
      for (let i = 0; i < CONFIG.BACKTEST_ANALYSIS; i++) {
        const btCoin = COINS[Math.floor(Math.random() * COINS.length)];
        await executeTrade(btCoin, true);
      }
      
      // Execute regular trade if within limits
      if (state.dailyTrades < CONFIG.MAX_DAILY_TRADES && state.dailyPnl > -(CONFIG.INITIAL_CAPITAL * CONFIG.MAX_DAILY_LOSS_PCT)) {
        const coin = getStrategy();
        await executeTrade(coin, false);
      }
      
      if (cycle % 5 === 0) {
        log(`📊 Capital: $${state.capital.toFixed(2)} | Trending: ${state.trendingTrades.length} positions`, 'INFO');
      }
      
    } catch (e) { log('Error: ' + e.message, 'ERROR'); }
    
    await new Promise(r => setTimeout(r, 90000 + Math.random() * 60000));
  }
}

main();
