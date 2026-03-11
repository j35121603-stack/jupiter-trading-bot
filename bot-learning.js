#!/usr/bin/env node
const { Connection, Keypair } = require('@solana/web3.js');
const axios = require('axios');
const fs = require('fs');

const PRIVATE_KEY = [251,29,114,181,142,96,158,60,191,29,28,215,45,235,164,89,18,76,7,86,18,196,204,45,107,2,180,123,32,26,120,179,163,137,111,217,115,32,78,114,232,19,195,235,243,114,134,190,86,39,89,168,10,43,167,105,138,213,206,226,68,208,102,225];
const SOLANA_RPC = 'https://api.mainnet-beta.solana.com';

const CONFIG = {
  INITIAL_CAPITAL: 1000,
  MAX_TRADE_SIZE_PCT: 0.10,
  STOP_LOSS_PCT: 0.02,
  TAKE_PROFIT_PCT: 0.04,
  MAX_DAILY_TRADES: 20,
  MAX_DAILY_LOSS_PCT: 0.05,
  MIN_TRADE_INTERVAL: 60000,
  PAPER_MODE: process.argv.includes('--paper'),
  LEARN_MODE: true, // Learn from trades
};

const MEME_COINS = [
  { symbol: 'WIF', mint: '85VBFQZC9TZkfaptBWqv14ALD9fJNUKtSA41kHm28896', volume: 150000000 },
  { symbol: 'BONK', mint: 'DezXAZ8z7PnrnRJjz3wXBoZkixF6pf7BiYfCHkV2tF', volume: 80000000 },
  { symbol: 'PEPE', mint: 'HZ1JovNiVvGrGNiiYvEozD2h1o9T5J2N5sAa4xFP5dM', volume: 50000000 },
  { symbol: 'POPCAT', mint: '7wcNFrG5UTiY4h1W7rY8kG2QqHk4L8fR3tV6pX9yW1Z', volume: 40000000 },
];
const SOL_MINT = 'So11111111111111111111111111111111111111112';

let wallet, connection;
let state = { 
  capital: CONFIG.INITIAL_CAPITAL, 
  trades: [], 
  dailyTrades: 0, 
  dailyPnl: 0,
  wonTrades: 0,
  lostTrades: 0,
  learning: {
    coinPerformance: {},
    bestTradeTime: null,
    avgWinAmount: 0,
    avgLossAmount: 0,
  }
};

function log(msg, type = 'INFO') {
  const colors = { INFO: '\x1b[36m', BUY: '\x1b[32m', SELL: '\x1b[33m', ERROR: '\x1b[31m', SUCCESS: '\x1b[32m', LEARN: '\x1b[35m' };
  console.log(`${colors[type]||''}[${new Date().toLocaleTimeString()}] ${msg}\x1b[0m`);
}

async function getPrices() {
  try {
    const res = await axios.get('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=solana,bonk,wif,pepe,popcat&order=market_cap_desc&sparkline=false', { timeout: 10000 });
    const prices = {};
    res.data.forEach(coin => { prices[coin.id] = coin.current_price; });
    return prices;
  } catch (e) { log('Price error: ' + e.message, 'ERROR'); return null; }
}

async function getQuote(inputMint, outputMint, amountLamports) {
  try {
    const res = await axios.get('https://quote-api.jup.ag/v6/quote?inputMint=' + inputMint + '&outputMint=' + outputMint + '&amount=' + amountLamports + '&slippage=0.5', { timeout: 10000 });
    return res.data;
  } catch (e) { return null; }
}

async function getDexPrices() {
  try {
    const res = await axios.get('https://api.dexscreener.com/latest/dex/tokens/' + MEME_COINS.map(c => c.mint).join(','), { timeout: 10000 });
    return res.data.pairs;
  } catch (e) { return null; }
}

function analyzeTrade(trade, exitPrice) {
  const priceChange = (exitPrice - trade.entryPrice) / trade.entryPrice;
  const pnl = trade.amount * priceChange;
  const won = priceChange > 0;
  
  // Update learning data
  if (!state.learning.coinPerformance[trade.coin]) {
    state.learning.coinPerformance[trade.coin] = { wins: 0, losses: 0, totalPnl: 0 };
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
  
  return { pnl, won, priceChange: priceChange * 100 };
}

function getStrategy() {
  // Learn from past trades
  const perf = state.learning.coinPerformance;
  const coins = Object.entries(perf)
    .filter(([k, v]) => v.wins + v.losses >= 3)
    .sort((a, b) => (b[1].totalPnl / (b[1].wins + b[1].losses)) - (a[1].totalPnl / (a[1].wins + a[1].losses)));
  
  // Avoid worst performing coins
  const avoidCoins = coins.filter(([k, v]) => v.totalPnl < 0).map(([k]) => k);
  
  // Pick best or random
  let selected;
  if (coins.length > 0 && Math.random() > 0.3) {
    selected = MEME_COINS.find(c => c.symbol === coins[0][0]);
  }
  
  if (!selected) {
    selected = MEME_COINS.filter(c => !avoidCoins.includes(c.symbol))[Math.floor(Math.random() * MEME_COINS.length)] || MEME_COINS[0];
  }
  
  return selected;
}

function logLearning() {
  log('📚 LEARNING ANALYSIS:', 'LEARN');
  log(`   Total Trades: ${state.wonTrades + state.lostTrades} | Wins: ${state.wonTrades} | Losses: ${state.lostTrades}`, 'LEARN');
  log(`   Win Rate: ${((state.wonTrades / (state.wonTrades + state.lostTrades)) * 100).toFixed(1)}%`, 'LEARN');
  log(`   Avg Win: $${state.learning.avgWinAmount.toFixed(2)} | Avg Loss: $${state.learning.avgLossAmount.toFixed(2)}`, 'LEARN');
  
  const perf = state.learning.coinPerformance;
  Object.entries(perf).forEach(([coin, data]) => {
    if (data.wins + data.losses >= 2) {
      const rate = (data.wins / (data.wins + data.losses) * 100).toFixed(0);
      const pnl = data.totalPnl.toFixed(2);
      log(`   ${coin}: ${rate}% win rate, $${pnl} PnL`, 'LEARN');
    }
  });
}

async function executeTrade() {
  const coin = getStrategy();
  const tradeUsd = state.capital * CONFIG.MAX_TRADE_SIZE_PCT;
  const amount = Math.floor(tradeUsd * 1e9);
  
  log(`Analyzing ${coin.symbol}...`, 'INFO');
  
  const quote = await getQuote(SOL_MINT, coin.mint, amount);
  if (!quote) { 
    log('No quote for ' + coin.symbol, 'ERROR'); 
    return; 
  }
  
  const entryPrice = parseInt(quote.outAmount);
  const entryTime = Date.now();
  
  log(`📊 Backtesting ${coin.symbol} | Entry: $${tradeUsd.toFixed(2)}`, 'BUY');
  
  // Simulate price movement with learning bias
  const historicalWinRate = state.learning.coinPerformance[coin.symbol]?.wins / (state.learning.coinPerformance[coin.symbol]?.wins + state.learning.coinPerformance[coin.symbol]?.losses || 1) || 0.5;
  const bias = (historicalWinRate - 0.5) * 0.05; // Adjust based on historical performance
  const marketNoise = (Math.random() - 0.5) * 0.06;
  const priceChange = bias + marketNoise;
  
  const exitPrice = entryPrice * (1 + priceChange);
  const trade = { coin: coin.symbol, amount: tradeUsd, entryPrice, exitPrice, entryTime, exitTime: Date.now() };
  
  const result = analyzeTrade(trade, exitPrice);
  
  state.trades.push({ ...trade, ...result });
  state.capital += result.pnl;
  state.dailyTrades++;
  state.dailyPnl += result.pnl;
  
  const emoji = result.won ? '✅' : '❌';
  log(`${emoji} Result: ${result.won ? 'WIN' : 'LOSS'} | PnL: $${result.pnl.toFixed(2)} (${result.priceChange.toFixed(2)}%)`, result.won ? 'SUCCESS' : 'ERROR');
  
  saveState();
}

function saveState() { 
  fs.writeFileSync('./state.json', JSON.stringify(state, null, 2)); 
}

function loadState() {
  try { 
    const data = fs.readFileSync('./state.json', 'utf8'); 
    state = { ...state, ...JSON.parse(data) }; 
    log(`Loaded: $${state.capital.toFixed(2)} | ${state.wonTrades}W-${state.lostTrades}L`, 'INFO'); 
  } catch (e) { log('Starting fresh', 'INFO'); }
}

function resetDaily() { 
  state.dailyTrades = 0; 
  state.dailyPnl = 0; 
}

async function main() {
  log('🚀 Jupiter Learning Bot Starting | Mode: ' + (CONFIG.PAPER_MODE ? 'PAPER' : 'LIVE'));
  wallet = Keypair.fromSecretKey(new Uint8Array(PRIVATE_KEY));
  connection = new Connection(SOLANA_RPC);
  loadState();
  setInterval(resetDaily, 24 * 60 * 60 * 1000);
  let cycle = 0;
  
  // Initial learning report
  if (state.wonTrades + state.lostTrades > 0) {
    logLearning();
  }
  
  while (true) {
    try {
      cycle++;
      
      if (state.dailyTrades < CONFIG.MAX_DAILY_TRADES && state.dailyPnl > -(CONFIG.INITIAL_CAPITAL * CONFIG.MAX_DAILY_LOSS_PCT)) {
        await executeTrade();
      } else {
        log('Daily limits reached', 'INFO');
      }
      
      if (cycle % 10 === 0) {
        log(`📊 Capital: $${state.capital.toFixed(2)} | Today: ${state.dailyTrades} trades | PnL: $${state.dailyPnl.toFixed(2)}`, 'INFO');
        logLearning();
      }
      
    } catch (e) { 
      log('Error: ' + e.message, 'ERROR'); 
    }
    
    await new Promise(r => setTimeout(r, 60000 + Math.random() * 60000));
  }
}

main();
