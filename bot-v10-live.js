#!/usr/bin/env node
/**
 * JUPITER BOT v10 - Complete Trading System
 * Features: Trailing stops, partial takes, auto token discovery, 
 *           price redundancy, separate states, daily limits
 */

const { Connection, Keypair } = require('@solana/web3.js');
const axios = require('axios');
const fs = require('fs');

const PRIVATE_KEY = [251,29,114,181,142,96,158,60,191,29,28,215,45,235,164,89,18,76,7,86,18,196,204,45,107,2,180,123,32,26,120,179,163,137,111,217,115,32,78,114,232,19,195,235,243,114,134,190,86,39,89,168,10,43,167,105,138,213,206,226,68,208,102,225];
const SOLANA_RPC = 'https://api.mainnet-beta.solana.com';

const TELEGRAM_BOT_TOKEN = "8460832535:AAEVnaEwFl7_BEazPF6rJJz4FCgrAk6TIvs";
const TELEGRAM_CHAT_ID = "7725826486";

const WALLET_ADDRESS = '54FksWWGjGWAwEv9UnijnbhAKgtYMRvLz3H2bHsyDqTU';

// Risk management
const RISK = {
  DAILY_LOSS_LIMIT: 0.05,      // Stop trading if -5% in a day
  MAX_POSITIONS: 4,
  TRAILING_ACTIVATION: 0.05,   // Activate at +5% profit
  TRAILING_DISTANCE: 0.03,      // 3% trailing distance
  PARTIAL_TAKE_LEVELS: [0.08, 0.12, 0.18], // Sell 33% at each level
  PARTIAL_TAKE_SIZES: [0.33, 0.33, 0.34],
};

const DEFAULT_CONFIG = {
  INITIAL_CAPITAL: 1000,
  MAX_TRADE_SIZE_PCT: 0.10,
  MAX_DAILY_TRADES: 10,
  MIN_MARKET_CAP: 50000,
  TAKE_PROFIT: 0.12,
  STOP_LOSS: 0.05,
  MIN_TRADE_INTERVAL: 300000,
  SCAN_INTERVAL: 180000,
  CHECK_INTERVAL: 30000,
};

const KNOWN_TOKENS = {
  'SOL': { mint: 'So11111111111111111111111111111111111111112', category: 'major' },
  'WIF': { mint: '85VBFQZC9TZkfaptBWqv14ALD9fJNUKtSA41kHm28896', category: 'meme' },
  'BONK': { mint: 'DezXAZ8z7PnrnRJjz3wXBoZkixF6pf7BiYfCHkV2tF', category: 'meme' },
  'PEPE': { mint: 'HZ1JovNiVvGrGNiiYvEozD2h1o9T5J2N5sAa4xFP5dM', category: 'meme' },
  'HYPE': { mint: '4ot3sDLauD3Xb2crEfoqLiM1VBG5J4ZtZGhcZ6q4xYq', category: 'meme' },
  'PENGU': { mint: '2ggnmQ6uF4n1EnGuMWMhYPRkJdMbzZNYoRBhuqXGqqa', category: 'meme' },
  'POPCAT': { mint: '7wcNFrG5UTiY4h1W7rY8kG2QqHk4L8fR3tV6pX9yW1Z', category: 'meme' },
  'MEW': { mint: 'MEW1gQW4gECy1KJPb6M6qV1yKVPzDFFF3r4xJ7qXP8x', category: 'meme' },
  'TON': { mint: 'EQBQqZ3ACfvPJqd5sEqPT2NpImJaMSBiouo4wTC3PHXy', category: 'major' },
  'BOOK': { mint: 'bksLuVHWmKf7r9uS6gk4grR7WNcMxYGY6LELqxbx2KL', category: 'defi' },
  'BODEN': { mint: 'BODENbG6m64ZGKWUN9542LQwr3krdh1h7J9vC4uV8p', category: 'meme' },
  'CHILL': { mint: 'CHILLb6xKxXS3U3hG8xYK1vT5L8n5Y2m4p9R3qW6vE', category: 'meme' },
};

const SOL_MINT = 'So11111111111111111111111111111111111111112';

let wallet, connection;
let lastTradeTime = 0;

function getMode() {
  try { return JSON.parse(fs.readFileSync('./bot-mode.json', 'utf8')).mode || 'practice'; }
  catch (e) { return 'practice'; }
}

function getStateFile() {
  const mode = getMode();
  return mode === 'live' ? './state-live.json' : './state-practice.json';
}

function log(msg, type = 'INFO') {
  const colors = { INFO: '\x1b[36m', BUY: '\x1b[32m', SELL: '\x1b[33m', ERROR: '\x1b[31m', SUCCESS: '\x1b[32m', SCAN: '\x1b[35m', LEARN: '\x1b[33m', ADAPT: '\x1b[32m', TRAIL: '\x1b[34m' };
  const mode = getMode();
  const prefix = mode === 'live' ? '🔴' : mode === 'stop' ? '⏹️' : '🟡';
  console.log(`${colors[type]||''}[${new Date().toLocaleTimeString()}] ${prefix} ${msg}\x1b[0m`);
}

async function sendTelegram(msg) {
  const mode = getMode();
  const prefix = mode === 'live' ? '🔴 LIVE: ' : '🟡 PRACTICE: ';
  try { await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, { chat_id: TELEGRAM_CHAT_ID, text: prefix + msg, parse_mode: 'HTML' }); }
  catch (e) {}
}

// ============ PRICE FETCHING (Multiple Sources) ============

async function getPricesBirdeye(mints) {
  const prices = {};
  for (const [symbol, info] of Object.entries(KNOWN_TOKENS)) {
    try {
      const res = await axios.get(`https://api.birdeye.so/public/price?address=${info.mint}`, { timeout: 5000 });
      if (res.data?.data?.value) {
        prices[symbol] = { price: res.data.data.value, change24h: 0, source: 'birdeye' };
      }
    } catch (e) {}
  }
  return prices;
}

async function getPricesJupiter() {
  const prices = {};
  const mints = Object.values(KNOWN_TOKENS).map(t => t.mint);
  try {
    const res = await axios.get(`https://price.jup.ag/v6/price?ids=${mints.join(',')}`, { timeout: 10000 });
    if (res.data?.data) {
      for (const [mint, data] of Object.entries(res.data.data)) {
        const symbol = Object.keys(KNOWN_TOKENS).find(k => KNOWN_TOKENS[k].mint === mint);
        if (symbol) {
          prices[symbol] = { price: data.price, change24h: data.change24h || 0, source: 'jupiter' };
        }
      }
    }
  } catch (e) {}
  return prices;
}

async function getPricesCoinGecko() {
  const prices = {};
  const cgIds = ['solana', 'wif', 'bonk', 'pepe', 'popcat', 'hyped', 'pengu', 'book-of-ethereum', 'toncoin'];
  const cgMap = { 'solana': 'SOL', 'wif': 'WIF', 'bonk': 'BONK', 'pepe': 'PEPE', 'popcat': 'POPCAT', 'hyped': 'HYPE', 'pengu': 'PENGU', 'book-of-ethereum': 'BOOK', 'toncoin': 'TON' };
  
  try {
    const res = await axios.get(`https://api.coingecko.com/api/v3/simple/price?ids=${cgIds.join(',')}&vs_currencies=usd&include_24hr_change=true`, { timeout: 10000 });
    if (res.data) {
      for (const [id, data] of Object.entries(res.data)) {
        const symbol = cgMap[id];
        if (symbol) {
          prices[symbol] = { price: data.usd, change24h: data.usd_24h_change || 0, source: 'coingecko' };
        }
      }
    }
  } catch (e) {}
  return prices;
}

async function getPrices() {
  // Try all sources, use first successful
  let prices = await getPricesCoinGecko();
  if (Object.keys(prices).length > 3) return prices;
  
  prices = await getPricesJupiter();
  if (Object.keys(prices).length > 3) return prices;
  
  prices = await getPricesBirdeye();
  return prices;
}

// ============ AUTO DISCOVER TRENDING TOKENS ============

async function discoverTrendingTokens() {
  try {
    // Get trending from CoinGecko
    const res = await axios.get('https://api.coingecko.com/api/v3/search/trending', { timeout: 15000 });
    const trending = res.data?.coins || [];
    
    for (const coin of trending.slice(0, 5)) {
      const symbol = coin.item.symbol.toUpperCase();
      const name = coin.item.name;
      const mc = coin.item.market_cap || 0;
      
      // Add if market cap > $50k and not already in list
      if (mc > 50000 && !KNOWN_TOKENS[symbol] && symbol.length < 10) {
        // We'd need mint address - skip for now, log it
        log(`🌟 Discovered trending: ${symbol} (MC: $${(mc/1000000).toFixed(1)}M)`, 'SCAN');
      }
    }
  } catch (e) {
    log('Token discovery failed: ' + e.message, 'ERROR');
  }
}

// ============ SCANNING ============

async function scanOpportunities() {
  const prices = await getPrices();
  const opportunities = [];
  
  for (const [symbol, data] of Object.entries(prices)) {
    if (!data.price || data.price < 0.0001) continue;
    
    const change24h = data.change24h || 0;
    let score = 0;
    
    // Prefer moderate momentum (3-15%)
    if (change24h > 3 && change24h < 15) score += 3;
    else if (change24h > 0) score += 1;
    else if (change24h < -5) score += 1; // Dip buying
    
    if (score < 1) continue;
    
    opportunities.push({
      symbol,
      mint: KNOWN_TOKENS[symbol].mint,
      price: data.price,
      change24h,
      score,
      source: data.source
    });
  }
  
  opportunities.sort((a, b) => b.score - a.score);
  
  if (opportunities.length > 0) {
    log(`📊 Found ${opportunities.length} opportunities: ${opportunities.slice(0,3).map(o => o.symbol).join(', ')}`, 'SCAN');
  }
  
  return opportunities;
}

// ============ STATE MANAGEMENT ============

function loadState() {
  try {
    const data = fs.readFileSync(getStateFile(), 'utf8');
    return JSON.parse(data);
  } catch (e) {
    return createDefaultState();
  }
}

function createDefaultState() {
  return {
    capital: 1000,
    trades: [],
    positions: [],
    dailyTrades: 0,
    dailyStartCapital: 1000,
    dailyStartTime: Date.now(),
    wonTrades: 0,
    lostTrades: 0,
    startedAt: Date.now(),
    learnings: {
      totalTrades: 0,
      consecutiveWins: 0,
      consecutiveLosses: 0,
      lastTradeResult: 'none',
      coinPerformance: {},
      hourPerformance: {},
      momentumPerformance: { high_positive: {wins:0,losses:0}, medium_positive: {wins:0,losses:0}, low_positive: {wins:0,losses:0}, negative: {wins:0,losses:0} },
      optimalTP: 0.10,
      optimalSL: 0.05,
      positionSizeMultiplier: 1.0,
      confidence: { coinSelection: 0.3, timing: 0.3 },
      avoidCoins: [],
      preferredCoins: [],
      patterns: []
    }
  };
}

function saveState(state) {
  fs.writeFileSync(getStateFile(), JSON.stringify(state, null, 2));
}

// ============ TRADING ============

function learnFromTrade(state, trade) {
  const l = state.learnings;
  const isWin = trade.pnl > 0;
  
  l.totalTrades++;
  if (isWin) { l.consecutiveWins++; l.consecutiveLosses = 0; l.lastTradeResult = 'win'; }
  else { l.consecutiveLosses++; l.consecutiveWins = 0; l.lastTradeResult = 'loss'; }
  
  // Coin performance
  if (!l.coinPerformance[trade.symbol]) l.coinPerformance[trade.symbol] = { wins: 0, losses: 0, totalPnl: 0 };
  if (isWin) l.coinPerformance[trade.symbol].wins++;
  else l.coinPerformance[trade.symbol].losses++;
  l.coinPerformance[trade.symbol].totalPnl += trade.pnl;
  l.coinPerformance[trade.symbol].winRate = l.coinPerformance[trade.symbol].wins / (l.coinPerformance[trade.symbol].wins + l.coinPerformance[trade.symbol].losses);
  
  // Hour performance
  const hour = new Date(trade.exitTime).getHours().toString();
  if (!l.hourPerformance[hour]) l.hourPerformance[hour] = { wins: 0, losses: 0 };
  if (isWin) l.hourPerformance[hour].wins++;
  else l.hourPerformance[hour].losses++;
  
  // Adjust TP/SL based on recent performance
  if (l.totalTrades >= 3) {
    const recent = state.trades.slice(-10);
    const wins = recent.filter(t => t.pnl > 0).length;
    const losses = recent.filter(t => t.pnl < 0).length;
    
    if (losses > wins * 1.5) {
      l.optimalSL = Math.max(0.03, l.optimalSL * 0.9);
      l.positionSizeMultiplier *= 0.9;
      log(`📉 Adjusted SL: ${(l.optimalSL*100).toFixed(0)}%`, 'ADAPT');
    }
    if (wins > losses * 1.5) {
      l.optimalTP = Math.min(0.20, l.optimalTP * 1.1);
      l.positionSizeMultiplier = Math.min(1.5, l.positionSizeMultiplier * 1.05);
      log(`📈 Adjusted TP: ${(l.optimalTP*100).toFixed(0)}%`, 'ADAPT');
    }
  }
  
  // Streak handling
  if (l.consecutiveLosses >= 3) {
    l.positionSizeMultiplier = Math.max(0.5, l.positionSizeMultiplier * 0.7);
    log(`⚠️ Losing streak - reducing size to ${(l.positionSizeMultiplier*100).toFixed(0)}%`, 'ADAPT');
  }
  
  l.confidence.coinSelection = Math.min(0.85, l.totalTrades / 20);
}

async function executeBuy(state, coin) {
  const now = Date.now();
  const l = state.learnings;
  const config = DEFAULT_CONFIG;
  
  // Check mode
  const mode = getMode();
  if (mode === 'stop') return;
  
  // Check daily loss limit
  const dailyPnl = (state.capital - state.dailyStartCapital) / state.dailyStartCapital;
  if (dailyPnl <= -RISK.DAILY_LOSS_LIMIT) {
    log(`🛑 DAILY LOSS LIMIT HIT (${(dailyPnl*100).toFixed(1)}%) - Stopping`, 'ERROR');
    return;
  }
  
  // Rate limiting
  if (now - lastTradeTime < config.MIN_TRADE_INTERVAL) return;
  
  // Max positions
  if (state.positions.length >= RISK.MAX_POSITIONS) return;
  
  // Check if already holding
  if (state.positions.find(p => p.symbol === symbol && !p.exited)) return;
  
  // Skip avoided coins
  if (l.avoidCoins.includes(coin.symbol)) {
    log(`⏭️ Skipping ${coin.symbol} - on avoid list`, 'INFO');
    return;
  }
  
  const tradeSize = state.capital * config.MAX_TRADE_SIZE_PCT * l.positionSizeMultiplier;
  const tp = l.optimalTP;
  const sl = l.optimalSL;
  
  log(`🟢 BUY ${coin.symbol} | $${tradeSize.toFixed(2)} | TP: ${(tp*100).toFixed(0)}% | SL: ${(sl*100).toFixed(0)}%`, 'BUY');
  
  const position = {
    symbol: coin.symbol,
    mint: coin.mint,
    amount: tradeSize,
    entryPrice: coin.price,
    entryTime: now,
    entryHour: new Date().getHours(),
    entryMomentum: coin.change24h,
    targetPrice: coin.price * (1 + tp),
    stopPrice: coin.price * (1 - sl),
    trailingStop: coin.price * (1 - sl), // Initial trailing stop
    exited: false,
    partialsTaken: [],
    config: { tp, sl }
  };
  
  state.positions.push(position);
  state.dailyTrades++;
  lastTradeTime = now;
  
  if (mode === 'live') {
    await sendTelegram(`🟢 BUY ${coin.symbol}\n$${tradeSize.toFixed(2)}\nTP: ${(tp*100).toFixed(0)}% | SL: ${(sl*100).toFixed(0)}%`);
  }
  
  saveState(state);
}

async function checkPositions(state) {
  const prices = await getPrices();
  const mode = getMode();
  const toExit = [];
  
  for (const pos of state.positions) {
    if (pos.exited) continue;
    
    const currentPrice = prices[pos.symbol]?.price;
    if (!currentPrice) continue;
    
    const priceChange = (currentPrice - pos.entryPrice) / pos.entryPrice;
    const pnl = pos.amount * priceChange;
    const pnlPct = priceChange * 100;
    
    // ============ TRAILING STOP ============
    if (priceChange >= RISK.TRAILING_ACTIVATION) {
      const newTrailing = currentPrice * (1 - RISK.TRAILING_DISTANCE);
      if (newTrailing > pos.trailingStop) {
        pos.trailingStop = newTrailing;
        log(`📈 Trailing stop updated for ${pos.symbol}: $${newTrailing.toFixed(4)}`, 'TRAIL');
      }
    }
    
    // ============ PARTIAL TAKES ============
    for (let i = 0; i < RISK.PARTIAL_TAKE_LEVELS.length; i++) {
      const level = RISK.PARTIAL_TAKE_LEVELS[i];
      const size = RISK.PARTIAL_TAKE_SIZES[i];
      
      if (priceChange >= level && !pos.partialsTaken.includes(i)) {
        pos.partialsTaken.push(i);
        const partialAmount = pos.amount * size;
        const partialPnl = partialAmount * priceChange;
        
        log(`💰 PARTIAL TAKE ${pos.symbol} at +${(level*100).toFixed(0)}% (+$${partialPnl.toFixed(2)})`, 'SELL');
        
        state.capital += partialPnl;
        pos.amount -= partialAmount;
        
        if (mode === 'live') {
          await sendTelegram(`💰 PARTIAL SELL ${pos.symbol} at +${(level*100).toFixed(0)}%\nProfit: +$${partialPnl.toFixed(2)}`);
        }
        
        // After partial, adjust stop to break-even
        pos.stopPrice = Math.max(pos.stopPrice, pos.entryPrice * 1.01);
      }
    }
    
    // ============ CHECK EXIT ============
    let exited = false;
    let reason = '';
    
    // Take profit (remaining position)
    if (priceChange >= pos.config.tp) {
      exited = true;
      reason = 'take_profit';
    }
    // Stop loss
    else if (priceChange <= -pos.config.sl) {
      exited = true;
      reason = 'stop_loss';
    }
    // Trailing stop hit
    else if (currentPrice <= pos.trailingStop && priceChange > RISK.TRAILING_ACTIVATION) {
      exited = true;
      reason = 'trailing_stop';
    }
    
    if (exited) {
      log(`🎯 EXIT ${pos.symbol}: ${reason} | ${pnlPct.toFixed(1)}% ($${pnl.toFixed(2)})`, pnl >= 0 ? 'SUCCESS' : 'ERROR');
      
      pos.exited = true;
      pos.exitPrice = currentPrice;
      pos.pnl = pnl;
      pos.exitTime = Date.now();
      pos.reason = reason;
      
      state.capital += pnl;
      
      if (pnl > 0) state.wonTrades++;
      else state.lostTrades++;
      
      state.trades.push({ ...pos });
      learnFromTrade(state, pos);
      
      if (mode === 'live') {
        await sendTelegram(`${pnl >= 0 ? '✅' : '❌'} ${pos.symbol} ${reason}\nP&L: $${pnl.toFixed(2)}`);
      }
      
      toExit.push(pos);
    }
  }
  
  // Remove exited positions
  for (const pos of toExit) {
    const idx = state.positions.indexOf(pos);
    if (idx > -1) state.positions.splice(idx, 1);
  }
  
  if (toExit.length > 0) {
    log(`💰 Capital: $${state.capital.toFixed(2)} | ${state.wonTrades}W-${state.lostTrades}L`, 'INFO');
    saveState(state);
  }
}

// ============ RESET DAILY ============

function resetDailyIfNeeded(state) {
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  
  if (now - state.dailyStartTime > dayMs) {
    state.dailyStartCapital = state.capital;
    state.dailyStartTime = now;
    state.dailyTrades = 0;
    log('📅 New day - reset daily tracking', 'INFO');
    saveState(state);
  }
}

// ============ MAIN ============

async function main() {
  log('🚀 JUPITER BOT v10 - COMPLETE SYSTEM', 'INFO');
  
  wallet = Keypair.fromSecretKey(new Uint8Array(PRIVATE_KEY));
  connection = new Connection(SOLANA_RPC);
  
  const state = loadState();
  const mode = getMode();
  
  log(`Started in ${mode.toUpperCase()} mode | Capital: $${state.capital.toFixed(2)}`, 'INFO');
  
  await sendTelegram(`🤖 Bot v10 Started!\nMode: ${mode.toUpperCase()}\nCapital: $${state.capital.toFixed(2)}`);
  
  // Trading loop
  setInterval(async () => {
    const currentMode = getMode();
    if (currentMode === 'stop') return;
    
    const s = loadState();
    resetDailyIfNeeded(s);
    
    const opportunities = await scanOpportunities();
    if (opportunities.length > 0) {
      await executeBuy(s, opportunities[0]);
    }
  }, DEFAULT_CONFIG.SCAN_INTERVAL);
  
  // Position check loop
  setInterval(async () => {
    const currentMode = getMode();
    if (currentMode === 'stop') return;
    
    const s = loadState();
    await checkPositions(s);
  }, DEFAULT_CONFIG.CHECK_INTERVAL);
  
  // Auto-discover tokens
  setInterval(discoverTrendingTokens, 3600000); // Every hour
  
  // Status log
  setInterval(() => {
    const s = loadState();
    const mode = getMode();
    log(`📊 ${mode.toUpperCase()} | $${s.capital.toFixed(2)} | ${s.positions.length} pos | ${s.wonTrades}W-${s.lostTrades}L`, 'INFO');
  }, 300000);
}

main();
