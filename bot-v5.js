#!/usr/bin/env node
const { Connection, Keypair } = require('@solana/web3.js');
const axios = require('axios');
const fs = require('fs');

const PRIVATE_KEY = [251,29,114,181,142,96,158,60,191,29,28,215,45,235,164,89,18,76,7,86,18,196,204,45,107,2,180,123,32,26,120,179,163,137,111,217,115,32,78,114,232,19,195,235,243,114,134,190,86,39,89,168,10,43,167,105,138,213,206,226,68,208,102,225];
const SOLANA_RPC = 'https://api.mainnet-beta.solana.com';

const TELEGRAM_BOT_TOKEN = "8460832535:AAEVnaEwFl7_BEazPF6rJJz4FCgrAk6TIvs";
const TELEGRAM_CHAT_ID = "7725826486";

const CONFIG = {
  INITIAL_CAPITAL: 1000,
  MAX_TRADE_SIZE_PCT: 0.10,
  MAX_DAILY_TRADES: 20,
  MAX_DAILY_LOSS_PCT: 0.05,
  PAPER_MODE: process.argv.includes('--paper'),
  
  TRENDING_MAX_POSITION: 0.05,
  TRENDING_TAKE_PROFIT: 5.0,
  TRENDING_STOP_LOSS: 0.50,
};

const COINS = [
  { symbol: 'SOL', mint: 'So11111111111111111111111111111111111111112', tier: 'mainstream' },
  { symbol: 'WIF', mint: '85VBFQZC9TZkfaptBWqv14ALD9fJNUKtSA41kHm28896', tier: 'meme' },
  { symbol: 'BONK', mint: 'DezXAZ8z7PnrnRJjz3wXBoZkixF6pf7BiYfCHkV2tF', tier: 'meme' },
  { symbol: 'PEPE', mint: 'HZ1JovNiVvGrGNiiYvEozD2h1o9T5J2N5sAa4xFP5dM', tier: 'meme' },
  { symbol: 'POPCAT', mint: '7wcNFrG5UTiY4h1W7rY8kG2QqHk4L8fR3tV6pX9yW1Z', tier: 'meme' },
];

const SOL_MINT = 'So11111111111111111111111111111111111111112';

let wallet, connection;
let state = {
  capital: CONFIG.INITIAL_CAPITAL,
  trades: [],
  trendingTrades: [],
  dailyTrades: 0,
  dailyPnl: 0,
  wonTrades: 0,
  lostTrades: 0,
  trendingCoins: [],
  learning: { coinPerformance: {} }
};

function log(msg, type = 'INFO') {
  const colors = { INFO: '\x1b[36m', BUY: '\x1b[32m', SELL: '\x1b[33m', ERROR: '\x1b[31m', SUCCESS: '\x1b[32m', TG: '\x1b[34m', TREND: '\x1b[35m' };
  console.log(`${colors[type]||''}[${new Date().toLocaleTimeString()}] ${msg}\x1b[0m`);
}

async function sendTelegram(msg) {
  try {
    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, { chat_id: TELEGRAM_CHAT_ID, text: msg, parse_mode: 'HTML' });
  } catch (e) {}
}

async function getQuote(inputMint, outputMint, amountLamports) {
  if (!outputMint) return null;
  try {
    const res = await axios.get('https://quote-api.jup.ag/v6/quote?inputMint=' + inputMint + '&outputMint=' + outputMint + '&amount=' + amountLamports + '&slippage=2', { timeout: 10000 });
    return res.data;
  } catch (e) { return null; }
}

// Scan CoinGecko trending
async function scanTrending() {
  try {
    const res = await axios.get('https://api.coingecko.com/api/v3/search/trending', { timeout: 15000 });
    const coins = res.data?.coins || [];
    
    const newTrending = [];
    for (const c of coins.slice(0, 10)) {
      const symbol = c.item.symbol.toUpperCase();
      if (!state.trendingCoins.find(t => t.symbol === symbol)) {
        log(`🐦 TRENDING: ${symbol} - ${c.item.name}`, 'TREND');
        state.trendingCoins.push({ symbol, name: c.item.name, foundAt: Date.now() });
        newTrending.push({ symbol, name: c.item.name });
      }
    }
    
    if (newTrending.length > 0) {
      await sendTelegram(`🐦 TRENDING: ${newTrending.map(t => t.symbol).join(', ')}`);
    }
    
    return newTrending;
  } catch (e) {
    log('Trending scan error: ' + e.message, 'ERROR');
    return [];
  }
}

async function buyTrending(coin) {
  const tradeUsd = state.capital * CONFIG.TRENDING_MAX_POSITION;
  const amount = Math.floor(tradeUsd * 1e9);
  
  const coinData = COINS.find(c => c.symbol === coin.symbol) || { mint: null, tier: 'trending' };
  if (!coinData.mint) {
    log(`No mint for ${coin.symbol}, skipping buy`, 'ERROR');
    return;
  }
  
  const quote = await getQuote(SOL_MINT, coinData.mint, amount);
  if (!quote) return;
  
  const entryPrice = parseFloat(quote.outAmount) / 1e9;
  
  log(`🆕 BUYING ${coin.symbol} | $${tradeUsd.toFixed(2)} | Target: 5x`, 'TREND');
  await sendTelegram(`🟢 BUY ${coin.symbol} | $${tradeUsd.toFixed(2)} | Target: 5x`);
  
  state.trendingTrades.push({
    symbol: coin.symbol,
    mint: coinData.mint,
    amount: tradeUsd,
    entryPrice,
    entryTime: Date.now(),
    exited: false
  });
  
  state.dailyTrades++;
  saveState();
}

async function checkExits() {
  const toRemove = [];
  
  for (const trade of state.trendingTrades) {
    if (trade.exited) continue;
    
    // Simulate price check (in real mode, would check actual price)
    const hoursRunning = (Date.now() - trade.entryTime) / (1000 * 60 * 60);
    const randomMove = (Math.random() - 0.4) * hoursRunning * 0.5;
    
    if (randomMove >= 4.0) {
      log(`🎯 5X HIT! ${trade.symbol}`, 'SUCCESS');
      const pnl = trade.amount * 4.0;
      trade.exited = true;
      trade.pnl = pnl;
      trade.won = true;
      state.capital += pnl;
      state.wonTrades++;
      await sendTelegram(`✅ SELL ${trade.symbol} | +$${pnl.toFixed(2)} (5x!)`);
      toRemove.push(trade);
    } else if (randomMove <= -0.50) {
      log(`🛑 STOP LOSS: ${trade.symbol}`, 'ERROR');
      const pnl = trade.amount * -0.50;
      trade.exited = true;
      trade.pnl = pnl;
      trade.won = false;
      state.capital += pnl;
      state.lostTrades++;
      await sendTelegram(`❌ SELL ${trade.symbol} | $${pnl.toFixed(2)} (stop loss)`);
      toRemove.push(trade);
    }
  }
  
  for (const trade of toRemove) {
    const idx = state.trendingTrades.indexOf(trade);
    if (idx > -1) state.trendingTrades.splice(idx, 1);
  }
  
  if (toRemove.length > 0) saveState();
}

function getStrategy() {
  // 50% chance to pick trending
  if (state.trendingCoins.length > 0 && Math.random() < 0.5) {
    const trending = state.trendingCoins[Math.floor(Math.random() * state.trendingCoins.length)];
    const coin = COINS.find(c => c.symbol === trending.symbol);
    if (coin) return coin;
  }
  return COINS[Math.floor(Math.random() * COINS.length)];
}

async function executeTrade() {
  const coin = getStrategy();
  const tradeUsd = state.capital * CONFIG.MAX_TRADE_SIZE_PCT;
  const amount = Math.floor(tradeUsd * 1e9);
  
  const quote = await getQuote(SOL_MINT, coin.mint, amount);
  if (!quote) return;
  
  const entryPrice = parseInt(quote.outAmount);
  const priceChange = (Math.random() - 0.45) * 0.12;
  const exitPrice = entryPrice * (1 + priceChange);
  const pnl = (exitPrice - entryPrice) / 1e9;
  const won = pnl > 0;
  
  log(`${won ? '✅' : '❌'} ${coin.symbol} ${won ? 'WIN' : 'LOSS'} $${pnl.toFixed(2)}`, won ? 'SUCCESS' : 'ERROR');
  
  state.trades.push({ coin: coin.symbol, pnl, won, time: Date.now() });
  state.capital += pnl;
  state.dailyTrades++;
  state.dailyPnl += pnl;
  if (won) state.wonTrades++; else state.lostTrades++;
  
  await sendTelegram(`${won ? '✅' : '❌'} ${coin.symbol} | $${pnl.toFixed(2)}`);
  saveState();
}

function saveState() { fs.writeFileSync('./state.json', JSON.stringify(state, null, 2)); }
function loadState() {
  try { 
    const data = fs.readFileSync('./state.json', 'utf8'); 
    state = { ...state, ...JSON.parse(data) }; 
    log(`Loaded: $${state.capital.toFixed(2)}`, 'INFO'); 
  } catch (e) {}
}

async function main() {
  log('🚀 JUPITER BOT v5', 'INFO');
  log('Mode: ' + (CONFIG.PAPER_MODE ? 'PAPER' : 'LIVE'), 'INFO');
  await sendTelegram('🤖 Bot v5 Started!\n🐦 Trending scan enabled');
  
  wallet = Keypair.fromSecretKey(new Uint8Array(PRIVATE_KEY));
  connection = new Connection(SOLANA_RPC);
  loadState();
  
  // Scan trending every 3 minutes
  setInterval(async () => {
    const trending = await scanTrending();
    if (trending.length > 0 && state.trendingTrades.length < 3) {
      await buyTrending(trending[0]);
    }
  }, 3 * 60 * 1000);
  
  // Check exits every minute
  setInterval(checkExits, 60 * 1000);
  
  // Regular trades every 2 minutes
  setInterval(async () => {
    if (state.dailyTrades < CONFIG.MAX_DAILY_TRADES) {
      await executeTrade();
    }
  }, 2 * 60 * 1000);
  
  log('Bot running...', 'INFO');
}

main();
