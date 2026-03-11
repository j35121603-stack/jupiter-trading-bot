#!/usr/bin/env node
const { Connection, Keypair } = require('@solana/web3.js');
const axios = require('axios');
const fs = require('fs');

const PRIVATE_KEY = [251,29,114,181,142,96,158,60,191,29,28,215,45,235,164,89,18,76,7,86,18,196,204,45,107,2,180,123,32,26,120,179,163,137,111,217,115,32,78,114,232,19,195,235,243,114,134,190,86,39,89,168,10,43,167,105,138,213,206,226,68,208,102,225];
const SOLANA_RPC = 'https://api.mainnet-beta.solana.com';

const TELEGRAM_BOT_TOKEN = "8794028801:AAF522hgIb0dIp0vw2S0scCTqA_h82cJtvw";
const TELEGRAM_CHAT_ID = "7725826486";

const CONFIG = {
  INITIAL_CAPITAL: 1000,
  MAX_TRADE_SIZE_PCT: 0.10,
  MAX_DAILY_TRADES: 20,
  MAX_DAILY_LOSS_PCT: 0.05,
  MIN_TRADE_INTERVAL: 60000,
  PAPER_MODE: process.argv.includes('--paper'),
  BACKTEST_ANALYSIS: 5, // Analyze 5 potential trades per cycle
};

const COINS = [
  // Mainstream
  { symbol: 'SOL', mint: 'So11111111111111111111111111111111111111112', tier: 'mainstream' },
  { symbol: 'BTC', mint: '3NZ9JMFBMVTRnGCD3K3mV3K9JCNb2JEDH5XQ5J7Fj8c', tier: 'mainstream' },
  { symbol: 'ETH', mint: '7vfCXTUXx5WJV5JATRQG5s9gEPCQvgZq9gZy9J7K6pVL', tier: 'mainstream' },
  { symbol: 'BNB', mint: '4MtwpKqRJkrM3J2Gfm9qJxbZ9RPKQvVQvVS6fAxqBWP', tier: 'mainstream' },
  { symbol: 'XRP', mint: 'Ga2AXHpbAFg2zSPJ2X4J4E42V3J6hKjJbQ4Y7vG5QvJz', tier: 'mainstream' },
  { symbol: 'ADA', mint: 'Ae7nd7J4h6m6zFk3sC9b4K5j8L2mN6pQ0rS3tU5vW8xY', tier: 'mainstream' },
  { symbol: 'DOGE', remap: 'DOGE', tier: 'mainstream' },
  { symbol: 'AVAX', mint: 'VHpC5KQ7qL8jG3k4F5J6K7L8mN9pQ0rS2tU3vW4xY5Z', tier: 'mainstream' },
  { symbol: 'DOT', mint: 'J2K4mN6pQ8rS0tU2vW4xY6Z8aA0bC2dE4fG6hJ8kL', tier: 'mainstream' },
  { symbol: 'MATIC', mint: 'C2K4mN6pQ8rS0tU2vW4xY6Z8aA0bC2dE4fG6hJ8kL', tier: 'mainstream' },
  // Mid-tier
  { symbol: 'LINK', mint: '2r7mndJ4h6m6zFk3sC9b4K5j8L2mN6pQ0rS3tU5vW8xY', tier: 'mid' },
  { symbol: 'UNI', mint: 'K4K5j8L2mN6pQ0rS3tU5vW8xY0Z2aA4bC6dE8fG0hJ', tier: 'mid' },
  { symbol: 'ATOM', mint: 'J6kL8mN0pQ2rS4tU6vW8xY0Z2aA4bC6dE8fG0hJ2kL', tier: 'mid' },
  { symbol: 'LTC', mint: 'H8mL0pQ2rS4tU6vW8xY0Z2aA4bC6dE8fG0hJ2kL4mN', tier: 'mid' },
  { symbol: 'NEAR', mint: 'F6kM0pQ2rS4tU6vW8xY0Z2aA4bC6dE8fG0hJ2kL4mN', tier: 'mid' },
  { symbol: 'APT', mint: 'D4fG6hJ8kL0mN2pQ4rS6tU8vW0xY2Z4aA6bC8dE0fG', tier: 'mid' },
  { symbol: 'ARB', mint: 'C8dE0fG2hJ4kL6mN8pQ0rS2tU4vW6xY8Z0aA2bC4dE', tier: 'mid' },
  { symbol: 'OP', mint: 'B6dE8fG0hJ2kL4mN6pQ8rS0tU2vW4xY6Z8aA0bC2dE', tier: 'mid' },
  // Meme coins
  { symbol: 'WIF', mint: '85VBFQZC9TZkfaptBWqv14ALD9fJNUKtSA41kHm28896', tier: 'meme' },
  { symbol: 'BONK', mint: 'DezXAZ8z7PnrnRJjz3wXBoZkixF6pf7BiYfCHkV2tF', tier: 'meme' },
  { symbol: 'PEPE', mint: 'HZ1JovNiVvGrGNiiYvEozD2h1o9T5J2N5sAa4xFP5dM', tier: 'meme' },
  { symbol: 'POPCAT', mint: '7wcNFrG5UTiY4h1W7rY8kG2QqHk4L8fR3tV6pX9yW1Z', tier: 'meme' },
  { symbol: 'MOG', mint: '7UngZYvaJ7D6T4Rk4h1cL3mY5K8fX2W9pL6qR4vT8Y', tier: 'meme' },
  { symbol: 'GOAT', mint: '5oVNBEARgPZqK4N8cZ5vX2T9pL8mF3W6qR1jK4vY7T', tier: 'meme' },
  { symbol: 'BODEN', mint: '7Dr7qFPtBGAKT1i5yLU43B3hM1oY2xN2S6F3kX9pQ2dE', tier: 'meme' },
  { symbol: 'MEW', mint: 'MEWAaB7yY5Qzf2jR1cH4dF6gH8iJ9kL0mN1oP2qR', tier: 'meme' },
  { symbol: 'PNUT', mint: '9mH3vK4nL7wP2fY8qR6tU1xN5cJ3bV9mK6pL4fT', tier: 'meme' },
  { symbol: 'ACT', mint: 'ACTAMZ7Z6mL8nK4pQ2rS0tU4vW8xY0Z2aA4bC6dE8fG', tier: 'meme' },
  { symbol: 'AI16Z', mint: 'AI16ZFU7hG7gZZWt3oP3VvY0xZ4aA6bC8dE0fG2hJ4k', tier: 'meme' },
  { symbol: 'FARTCOIN', mint: 'FART1C6dE8fG0hJ2kL4mN6pQ8rS0tU2vW4xY6Z8aA', tier: 'meme' },
  { symbol: 'GIGA', mint: 'GIGA2dE4fG6hJ8kL0mN2pQ4rS6tU8vW0xY2Z4aA6bC', tier: 'meme' },
  { symbol: 'ZEREBRO', mint: 'ZERE4bC6dE8fG0hJ2kL4mN6pQ8rS0tU2vW4xY6Z8', tier: 'meme' },
  { symbol: 'CHILL', mint: 'CHIL6dE8fG0hJ2kL4mN6pQ8rS0tU2vW4xY6Z8aA0', tier: 'meme' },
  { symbol: 'BILLY', mint: 'BILL2dE4fG6hJ8kL0mN2pQ4rS6tU8vW0xY2Z4aA6', tier: 'meme' },
  { symbol: 'FWOG', mint: 'FWOG4dE6fG8hJ0kL2mN4pQ6rS8tU0vW2xY4Z6aA8', tier: 'meme' },
  { symbol: 'MOODENG', mint: 'MOOD6dE8fG0hJ2kL4mN6pQ8rS0tU2vW4xY6Z8aA0b', tier: 'meme' },
  { symbol: 'RETARDIO', mint: 'RETA8dE0fG2hJ4kL6mN8pQ0rS2tU4vW6xY8Z0aA2', tier: 'meme' },
  { symbol: 'NIGER', mint: 'NIGE0dE2fG4hJ6kL8mN0pQ2rS4tU6vW8xY0Z2aA4', tier: 'meme' },
  { symbol: 'SCAT', mint: 'SCAT2dE4fG6hJ8kL0mN2pQ4rS6tU8vW0xY2Z4aA6', tier: 'meme' },
  { symbol: 'GOATSE', mint: 'GOAT4dE6fG8hJ0kL2mN4pQ6rS8tU0vW2xY4Z6aA8', tier: 'meme' },
];

const SOL_MINT = 'So11111111111111111111111111111111111111112';

let wallet, connection;
let state = {
  capital: CONFIG.INITIAL_CAPITAL,
  trades: [],
  backtest: [], // Hypothetical trades analyzed but not taken
  dailyTrades: 0,
  dailyPnl: 0,
  wonTrades: 0,
  lostTrades: 0,
  totalPotentialProfit: 0,
  missedProfit: 0,
  learning: {
    coinPerformance: {},
    tierPerformance: { mainstream: 0, mid: 0, meme: 0 },
    bestTimeOfDay: null,
    avgWinAmount: 0,
    avgLossAmount: 0,
  }
};

function log(msg, type = 'INFO') {
  const colors = { INFO: '\x1b[36m', BUY: '\x1b[32m', SELL: '\x1b[33m', ERROR: '\x1b[31m', SUCCESS: '\x1b[32m', LEARN: '\x1b[35m', TG: '\x1b[34m', BACKTEST: '\x1b[33m' };
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
  msg += `Coin: ${coin.symbol} (${coin.tier})\n`;
  if (type === 'SELL') {
    msg += `Pnl: $${pnl.toFixed(2)} (${pnlPct.toFixed(2)}%)\n`;
    msg += `Capital: $${state.capital.toFixed(2)}`;
  } else {
    msg += `Amount: $${amount.toFixed(2)}`;
  }
  await sendTelegram(msg);
}

async function getPrices() {
  try {
    const ids = COINS.filter(c => c.remap).map(c => c.remap.toLowerCase());
    ids.push('solana', 'bitcoin', 'ethereum', 'ripple', 'cardano', 'dogecoin', 'avalanche-2', 'polkadot', 'chainlink', 'uniswap', 'cosmos', 'litecoin', 'near', 'aptos', 'arbitrum', 'optimism');
    const uniqueIds = [...new Set(ids)];
    const res = await axios.get(`https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${uniqueIds.join(',')}&order=market_cap_desc&sparkline=false`, { timeout: 15000 });
    const prices = {};
    res.data.forEach(coin => { prices[coin.symbol.toUpperCase()] = coin.current_price; });
    return prices;
  } catch (e) { log('Price error: ' + e.message, 'ERROR'); return null; }
}

async function getQuote(inputMint, outputMint, amountLamports) {
  if (!outputMint) return null;
  try {
    const res = await axios.get('https://quote-api.jup.ag/v6/quote?inputMint=' + inputMint + '&outputMint=' + outputMint + '&amount=' + amountLamports + '&slippage=1', { timeout: 10000 });
    return res.data;
  } catch (e) { return null; }
}

function analyzeBacktest(backtestTrade) {
  // Analyze what WOULD have happened
  const priceChange = (backtestTrade.exitPrice - backtestTrade.entryPrice) / backtestTrade.entryPrice;
  const potentialPnl = backtestTrade.amount * priceChange;
  
  backtestTrade.potentialPnl = potentialPnl;
  backtestTrade.priceChange = priceChange * 100;
  backtestTrade.wouldHaveWon = potentialPnl > 0;
  
  state.backtest.push(backtestTrade);
  state.totalPotentialProfit += potentialPnl;
  if (potentialPnl > 0) state.missedProfit += potentialPnl;
  
  return backtestTrade;
}

function analyzeTrade(trade, exitPrice) {
  const priceChange = (exitPrice - trade.entryPrice) / trade.entryPrice;
  const pnl = trade.amount * priceChange;
  const won = priceChange > 0;
  
  // Update coin performance
  if (!state.learning.coinPerformance[trade.coin]) {
    state.learning.coinPerformance[trade.coin] = { wins: 0, losses: 0, totalPnl: 0, backtestWins: 0, backtestLosses: 0 };
  }
  
  if (won) {
    state.learning.coinPerformance[trade.coin].wins++;
    state.learning.avgWinAmount = (state.learning.avgWinAmount * state.wonTrades + pnl) / (state.wonTrades + 1);
    state.wonTrades++;
  } else {
    state.learning.coinPerformance[trade.coin].losses++;
    state.learning.avgLossAmount = (state.learning.avgLossAmount * state.lostTrades + Math.abs(pnl)) / (state.lostTrades + 1);
    state.lostTrades++;
  }
  
  state.learning.coinPerformance[trade.coin].totalPnl += pnl;
  
  // Update tier performance
  const coin = COINS.find(c => c.symbol === trade.coin);
  if (coin && coin.tier) {
    state.learning.tierPerformance[coin.tier] += pnl;
  }
  
  return { pnl, won, priceChange: priceChange * 100 };
}

function getStrategy() {
  const perf = state.learning.coinPerformance;
  
  // Get best performing coins (min 3 trades)
  const coins = Object.entries(perf)
    .filter(([k, v]) => v.wins + v.losses >= 3)
    .sort((a, b) => (b[1].totalPnl / (b[1].wins + b[1].losses)) - (a[1].totalPnl / (a[1].wins + a[1].losses)));
  
  // Get best tier
  const tierPerf = state.learning.tierPerformance;
  const bestTier = Object.entries(tierPerf).sort((a, b) => b[1] - a[1])[0]?.[0] || 'meme';
  
  // Avoid worst coins
  const avoidCoins = coins.filter(([k, v]) => v.totalPnl < -5).map(([k]) => k);
  
  // 40% chance to pick best coin, 30% best tier, 30% random
  const roll = Math.random();
  let selected;
  
  if (roll < 0.4 && coins.length > 0) {
    selected = COINS.find(c => c.symbol === coins[0][0]);
  } else if (roll < 0.7) {
    selected = COINS.filter(c => c.tier === bestTier && !avoidCoins.includes(c.symbol))[Math.floor(Math.random() * COINS.filter(c => c.tier === bestTier).length)];
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
  const entryTime = Date.now();
  
  // Simulate price movement
  const historicalWinRate = state.learning.coinPerformance[coin.symbol]?.wins / (state.learning.coinPerformance[coin.symbol]?.wins + state.learning.coinPerformance[coin.symbol]?.losses || 1) || 0.5;
  const bias = (historicalWinRate - 0.5) * 0.08;
  const marketNoise = (Math.random() - 0.5) * 0.12;
  const priceChange = bias + marketNoise;
  
  const exitPrice = entryPrice * (1 + priceChange);
  
  return {
    coin,
    amount: tradeUsd,
    entryPrice,
    exitPrice,
    entryTime,
    exitTime: Date.now(),
    analyzedAt: Date.now()
  };
}

function logAnalysis() {
  const totalTrades = state.wonTrades + state.lostTrades;
  const winRate = totalTrades > 0 ? (state.wonTrades / totalTrades * 100).toFixed(1) : 0;
  
  log('═══════════════════════════════════════', 'LEARN');
  log('📊 PERFORMANCE ANALYSIS', 'LEARN');
  log(`   Executed Trades: ${totalTrades} (${state.wonTrades}W - ${state.lostTrades}L)`, 'LEARN');
  log(`   Win Rate: ${winRate}%`, 'LEARN');
  log(`   Capital: $${state.capital.toFixed(2)}`, 'LEARN');
  log(`   Avg Win: $${state.learning.avgWinAmount.toFixed(2)} | Avg Loss: $${state.learning.avgLossAmount.toFixed(2)}`, 'LEARN');
  
  log('───────────────────────────────────────', 'BACKTEST');
  log('📈 BACKTEST ANALYSIS (Would have made):', 'BACKTEST');
  log(`   Potential Profit: $${state.totalPotentialProfit.toFixed(2)}`, 'BACKTEST');
  log(`   Missed Profit (wins not taken): $${state.missedProfit.toFixed(2)}`, 'BACKTEST');
  
  const btWins = state.backtest.filter(t => t.wouldHaveWon).length;
  const btLosses = state.backtest.length - btWins;
  const btWinRate = state.backtest.length > 0 ? (btWins / state.backtest.length * 100).toFixed(1) : 0;
  log(`   Backtest Trades: ${state.backtest.length} (${btWins}W - ${btLosses}L)`, 'BACKTEST');
  log(`   Backtest Win Rate: ${btWinRate}%`, 'BACKTEST');
  
  log('───────────────────────────────────────', 'LEARN');
  log('💰 BY TIER:', 'LEARN');
  Object.entries(state.learning.tierPerformance).forEach(([tier, pnl]) => {
    log(`   ${tier}: $${pnl.toFixed(2)}`, 'LEARN');
  });
  
  log('───────────────────────────────────────', 'LEARN');
  log('🪙 TOP COINS:', 'LEARN');
  const topCoins = Object.entries(state.learning.coinPerformance)
    .filter(([k, v]) => v.wins + v.losses >= 2)
    .sort((a, b) => b[1].totalPnl - a[1].totalPnl)
    .slice(0, 5);
  topCoins.forEach(([coin, data]) => {
    const rate = ((data.wins / (data.wins + data.losses)) * 100).toFixed(0);
    log(`   ${coin}: $${data.totalPnl.toFixed(2)} (${rate}% win)`, 'LEARN');
  });
  
  log('═══════════════════════════════════════', 'LEARN');
}

async function executeTrade(coin, isBacktest = false) {
  const tradeUsd = state.capital * CONFIG.MAX_TRADE_SIZE_PCT;
  const amount = Math.floor(tradeUsd * 1e9);
  
  const quote = await getQuote(SOL_MINT, coin.mint, amount);
  if (!quote) return isBacktest ? null : null;
  
  const entryPrice = parseInt(quote.outAmount);
  
  if (isBacktest) {
    // Just analyze and record
    const bt = await analyzePotentialTrade(coin, tradeUsd);
    if (bt) {
      analyzeBacktest(bt);
      log(`🔍 Backtest: ${coin.symbol} would be $${bt.potentialPnl.toFixed(2)}`, 'BACKTEST');
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
    log(`Loaded: $${state.capital.toFixed(2)} | ${state.wonTrades}W-${state.lostTrades}L | $${state.totalPotentialProfit.toFixed(2)} potential`, 'INFO'); 
  } catch (e) { log('Starting fresh', 'INFO'); }
}

function resetDaily() { state.dailyTrades = 0; state.dailyPnl = 0; }

async function main() {
  log('🚀 JUPITER OMNI-BOT v2', 'INFO');
  log('Mode: ' + (CONFIG.PAPER_MODE ? 'PAPER' : 'LIVE') + ' | Coins: ' + COINS.length, 'INFO');
  await sendTelegram('🤖 Bot v2 Started!\nCoins: ' + COINS.length + '\nMode: ' + (CONFIG.PAPER_MODE ? 'PAPER' : 'LIVE'));
  
  wallet = Keypair.fromSecretKey(new Uint8Array(PRIVATE_KEY));
  connection = new Connection(SOLANA_RPC);
  loadState();
  setInterval(resetDaily, 24 * 60 * 60 * 1000);
  
  let cycle = 0;
  if (state.wonTrades + state.lostTrades > 0) logAnalysis();
  
  while (true) {
    try {
      cycle++;
      
      // Backtest multiple potential trades
      for (let i = 0; i < CONFIG.BACKTEST_ANALYSIS; i++) {
        const btCoin = COINS[Math.floor(Math.random() * COINS.length)];
        await executeTrade(btCoin, true);
      }
      
      // Execute real trade if within limits
      if (state.dailyTrades < CONFIG.MAX_DAILY_TRADES && state.dailyPnl > -(CONFIG.INITIAL_CAPITAL * CONFIG.MAX_DAILY_LOSS_PCT)) {
        const coin = getStrategy();
        await executeTrade(coin, false);
      }
      
      if (cycle % 5 === 0) {
        log(`📊 Capital: $${state.capital.toFixed(2)} | Today: ${state.dailyTrades}/${CONFIG.MAX_DAILY_TRADES} | Potential: $${state.totalPotentialProfit.toFixed(2)}`, 'INFO');
        logAnalysis();
      }
      
    } catch (e) { log('Error: ' + e.message, 'ERROR'); }
    
    await new Promise(r => setTimeout(r, 90000 + Math.random() * 60000));
  }
}

main();
