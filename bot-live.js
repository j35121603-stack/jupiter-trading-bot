#!/usr/bin/env node
/**
 * LIVE BOT v10 - With start/stop control
 */

const { Connection, Keypair, PublicKey } = require('@solana/web3.js');
const axios = require('axios');
const fs = require('fs');

const PRIVATE_KEY = [251,29,114,181,142,96,158,60,191,29,28,215,45,235,164,89,18,76,7,86,18,196,204,45,107,2,180,123,32,26,120,179,163,137,111,217,115,32,78,114,232,19,195,235,243,114,134,190,86,39,89,168,10,43,167,105,138,213,206,226,68,208,102,225];
const SOLANA_RPC = 'https://api.mainnet-beta.solana.com';

const TELEGRAM_BOT_TOKEN = "8460832535:AAEVnaEwFl7_BEazPF6rJJz4FCgrAk6TIvs";
const TELEGRAM_CHAT_ID = "7725826486";

const STATE_FILE = './state-live.json';
const WALLET = 'C1P1GbekVtaLUnVNA6CpX2oLeJ45GFkd1t5xbixBvRgc';

const RISK = {
  DAILY_LOSS_LIMIT: 0.05,
  MAX_POSITIONS: 4,
  TRAILING_ACTIVATION: 0.05,
  TRAILING_DISTANCE: 0.03,
  PARTIAL_TAKE_LEVELS: [0.08, 0.12, 0.18],
  PARTIAL_TAKE_SIZES: [0.33, 0.33, 0.34],
};

const CONFIG = {
  INITIAL_CAPITAL: 1000,
  MAX_TRADE_SIZE_PCT: 0.10,
  MIN_TRADE_INTERVAL: 300000,
  SCAN_INTERVAL: 180000,
  CHECK_INTERVAL: 30000,
};

const KNOWN_TOKENS = {
  'SOL': { mint: 'So11111111111111111111111111111111111111112' },
  'WIF': { mint: '85VBFQZC9TZkfaptBWqv14ALD9fJNUKtSA41kHm28896' },
  'BONK': { mint: 'DezXAZ8z7PnrnRJjz3wXBoZkixF6pf7BiYfCHkV2tF' },
  'PEPE': { mint: 'HZ1JovNiVvGrGNiiYvEozD2h1o9T5J2N5sAa4xFP5dM' },
  'HYPE': { mint: '4ot3sDLauD3Xb2crEfoqLiM1VBG5J4ZtZGhcZ6q4xYq' },
  'PENGU': { mint: '2ggnmQ6uF4n1EnGuMWMhYPRkJdMbzZNYoRBhuqXGqqa' },
  'POPCAT': { mint: '7wcNFrG5UTiY4h1W7rY8kG2QqHk4L8fR3tV6pX9yW1Z' },
  'MEW': { mint: 'MEW1gQW4gECy1KJPb6M6qV1yKVPzDFFF3r4xJ7qXP8x' },
  'TON': { mint: 'EQBQqZ3ACfvPJqd5sEqPT2NpImJaMSBiouo4wTC3PHXy' },
  'BOOK': { mint: 'bksLuVHWmKf7r9uS6gk4grR7WNcMxYGY6LELqxbx2KL' },
};

let lastTradeTime = 0;
let connection;

function isRunning() {
  try { return JSON.parse(fs.readFileSync('./bot-live-running.json', 'utf8')).running; }
  catch (e) { return false; }
}

function log(msg, type = 'INFO') {
  const colors = { INFO: '\x1b[36m', BUY: '\x1b[32m', SELL: '\x1b[33m', ERROR: '\x1b[31m', SUCCESS: '\x1b[32m', SCAN: '\x1b[35m', ADAPT: '\x1b[32m' };
  console.log(`${colors[type]||''}[${new Date().toLocaleTimeString()}] 🔴 ${msg}\x1b[0m`);
}

async function sendTelegram(msg) {
  try { await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, { chat_id: TELEGRAM_CHAT_ID, text: '🔴 LIVE: ' + msg, parse_mode: 'HTML' }); } catch (e) {}
}

async function getWalletBalance() {
  try {
    const balance = await connection.getBalance(new PublicKey(WALLET));
    const sol = balance / 1e9;
    let price = 90;
    try { const res = await axios.get('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd', { timeout: 5000 }); price = res.data?.solana?.usd || 90; } catch (e) {}
    return sol * price;
  } catch (e) { return 1000; }
}

async function getPrices() {
  const prices = {};
  const cgIds = ['solana', 'wif', 'bonk', 'pepe', 'popcat', 'hyped', 'pengu', 'book-of-ethereum', 'toncoin'];
  const cgMap = { 'solana': 'SOL', 'wif': 'WIF', 'bonk': 'BONK', 'pepe': 'PEPE', 'popcat': 'POPCAT', 'hyped': 'HYPE', 'pengu': 'PENGU', 'book-of-ethereum': 'BOOK', 'toncoin': 'TON' };
  try {
    const res = await axios.get(`https://api.coingecko.com/api/v3/simple/price?ids=${cgIds.join(',')}&vs_currencies=usd&include_24hr_change=true`, { timeout: 10000 });
    if (res.data) {
      for (const [id, data] of Object.entries(res.data)) {
        const symbol = cgMap[id];
        if (symbol) prices[symbol] = { price: data.usd, change24h: data.usd_24h_change || 0 };
      }
    }
  } catch (e) {}
  return prices;
}

async function scanOpportunities() {
  const prices = await getPrices();
  const opportunities = [];
  for (const [symbol, data] of Object.entries(prices)) {
    if (!data.price || data.price < 0.0001) continue;
    const change24h = data.change24h || 0;
    let score = (change24h > 3 && change24h < 15) ? 3 : (change24h > 0 ? 1 : 0);
    if (score < 1) continue;
    opportunities.push({ symbol, mint: KNOWN_TOKENS[symbol].mint, price: data.price, change24h, score });
  }
  opportunities.sort((a, b) => b.score - a.score);
  if (opportunities.length > 0) log(`📊 Found: ${opportunities.slice(0,3).map(o => o.symbol).join(', ')}`, 'SCAN');
  return opportunities;
}

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); }
  catch (e) { return { capital: 1000, trades: [], positions: [], dailyTrades: 0, dailyStartCapital: 1000, dailyStartTime: Date.now(), wonTrades: 0, lostTrades: 0, learnings: { totalTrades: 0, consecutiveWins: 0, consecutiveLosses: 0, coinPerformance: {}, hourPerformance: {}, optimalTP: 0.10, optimalSL: 0.05, positionSizeMultiplier: 1.0, confidence: { coinSelection: 0.3 }, avoidCoins: [], preferredCoins: [] } }; }
}

function saveState(state) { fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2)); }

function learnFromTrade(state, trade) {
  const l = state.learnings;
  const isWin = trade.pnl > 0;
  l.totalTrades++;
  if (isWin) { l.consecutiveWins++; l.consecutiveLosses = 0; }
  else { l.consecutiveLosses++; l.consecutiveWins = 0; }
  if (!l.coinPerformance[trade.symbol]) l.coinPerformance[trade.symbol] = { wins: 0, losses: 0, totalPnl: 0 };
  if (isWin) l.coinPerformance[trade.symbol].wins++; else l.coinPerformance[trade.symbol].losses++;
  l.coinPerformance[trade.symbol].totalPnl += trade.pnl;
  l.coinPerformance[trade.symbol].winRate = l.coinPerformance[trade.symbol].wins / (l.coinPerformance[trade.symbol].wins + l.coinPerformance[trade.symbol].losses);
  if (l.totalTrades >= 3) {
    const recent = state.trades.slice(-10);
    const wins = recent.filter(t => t.pnl > 0).length;
    const losses = recent.filter(t => t.pnl < 0).length;
    if (losses > wins * 1.5) { l.optimalSL = Math.max(0.03, l.optimalSL * 0.9); l.positionSizeMultiplier *= 0.9; }
    if (wins > losses * 1.5) { l.optimalTP = Math.min(0.20, l.optimalTP * 1.1); l.positionSizeMultiplier = Math.min(1.5, l.positionSizeMultiplier * 1.05); }
  }
  l.confidence.coinSelection = Math.min(0.85, l.totalTrades / 20);
}

async function executeBuy(state, coin) {
  const now = Date.now();
  const l = state.learnings;
  if ((state.capital - state.dailyStartCapital) / state.dailyStartCapital <= -RISK.DAILY_LOSS_LIMIT) return;
  if (now - lastTradeTime < CONFIG.MIN_TRADE_INTERVAL) return;
  if (state.positions.length >= RISK.MAX_POSITIONS) return;
  if (state.positions.find(p => p.symbol === coin.symbol && !p.exited)) return;
  
  const tradeSize = state.capital * CONFIG.MAX_TRADE_SIZE_PCT * l.positionSizeMultiplier;
  const tp = l.optimalTP, sl = l.optimalSL;
  log(`🟢 BUY ${coin.symbol} | $${tradeSize.toFixed(2)} | TP: ${(tp*100).toFixed(0)}%`, 'BUY');
  await sendTelegram(`🟢 BUY ${coin.symbol}\n$${tradeSize.toFixed(2)}\nTP: ${(tp*100).toFixed(0)}% | SL: ${(sl*100).toFixed(0)}%`);
  
  state.positions.push({
    symbol: coin.symbol, mint: coin.mint, amount: tradeSize, entryPrice: coin.price, entryTime: now,
    entryHour: new Date().getHours(), entryMomentum: coin.change24h,
    targetPrice: coin.price * (1 + tp), stopPrice: coin.price * (1 - sl), trailingStop: coin.price * (1 - sl),
    exited: false, partialsTaken: [], config: { tp, sl }
  });
  state.dailyTrades++;
  lastTradeTime = now;
  saveState(state);
}

async function checkPositions(state) {
  const prices = await getPrices();
  const toExit = [];
  for (const pos of state.positions) {
    if (pos.exited) continue;
    const currentPrice = prices[pos.symbol]?.price;
    if (!currentPrice) continue;
    const priceChange = (currentPrice - pos.entryPrice) / pos.entryPrice;
    const pnl = pos.amount * priceChange;
    if (priceChange >= RISK.TRAILING_ACTIVATION) {
      const newTrailing = currentPrice * (1 - RISK.TRAILING_DISTANCE);
      if (newTrailing > pos.trailingStop) pos.trailingStop = newTrailing;
    }
    for (let i = 0; i < RISK.PARTIAL_TAKE_LEVELS.length; i++) {
      if (priceChange >= RISK.PARTIAL_TAKE_LEVELS[i] && !pos.partialsTaken.includes(i)) {
        pos.partialsTaken.push(i);
        const partialAmount = pos.amount * RISK.PARTIAL_TAKE_SIZES[i];
        state.capital += partialAmount * priceChange;
        pos.amount -= partialAmount;
        log(`💰 Partial take ${pos.symbol}`, 'SELL');
        await sendTelegram(`💰 PARTIAL SELL ${pos.symbol} at +${(RISK.PARTIAL_TAKE_LEVELS[i]*100).toFixed(0)}%`);
      }
    }
    let exited = false, reason = '';
    if (priceChange >= pos.config.tp) { exited = true; reason = 'take_profit'; }
    else if (priceChange <= -pos.config.sl) { exited = true; reason = 'stop_loss'; }
    else if (currentPrice <= pos.trailingStop && priceChange > RISK.TRAILING_ACTIVATION) { exited = true; reason = 'trailing_stop'; }
    if (exited) {
      log(`🎯 EXIT ${pos.symbol}: ${reason} | ${(priceChange*100).toFixed(1)}%`, pnl >= 0 ? 'SUCCESS' : 'ERROR');
      await sendTelegram(`${pnl >= 0 ? '✅' : '❌'} ${pos.symbol} ${reason}\nP&L: $${pnl.toFixed(2)}`);
      pos.exited = true; pos.exitPrice = currentPrice; pos.pnl = pnl; pos.exitTime = Date.now(); pos.reason = reason;
      state.capital += pnl;
      if (pnl > 0) state.wonTrades++; else state.lostTrades++;
      state.trades.push({ ...pos });
      learnFromTrade(state, pos);
      toExit.push(pos);
    }
  }
  for (const pos of toExit) state.positions.splice(state.positions.indexOf(pos), 1);
  if (toExit.length > 0) { log(`💰 Capital: $${state.capital.toFixed(2)}`, 'INFO'); saveState(state); }
}

async function main() {
  log('🚀 LIVE BOT v10', 'INFO');
  connection = new Connection(SOLANA_RPC);
  
  const state = loadState();
  const balance = await getWalletBalance();
  log(`Wallet balance: $${balance.toFixed(2)}`, 'INFO');
  
  setInterval(async () => {
    if (!isRunning()) return;
    const s = loadState();
    s.capital = await getWalletBalance();
    const opportunities = await scanOpportunities();
    if (opportunities.length > 0) await executeBuy(s, opportunities[0]);
  }, CONFIG.SCAN_INTERVAL);
  
  setInterval(async () => {
    if (!isRunning()) return;
    const s = loadState();
    s.capital = await getWalletBalance();
    await checkPositions(s);
  }, CONFIG.CHECK_INTERVAL);
  
  setInterval(async () => { 
    if (!isRunning()) return;
    const s = loadState(); 
    s.capital = await getWalletBalance();
    log(`📊 Live: $${s.capital.toFixed(2)} | ${s.wonTrades}W-${s.lostTrades}L`, 'INFO'); 
  }, 300000);
}

main();
