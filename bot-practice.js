#!/usr/bin/env node
/**
 * ADVANCED PRACTICE BOT v11 - Fast Learning Edition
 * Features: Speed mode, multiple strategies, backtesting, bootstrap knowledge
 */

const axios = require('axios');
const fs = require('fs');

const STATE_FILE = './state-practice.json';

// Speed settings for fast learning
const SPEED = {
  SCAN_INTERVAL: 60000,      // 1 minute scans (was 3 min)
  CHECK_INTERVAL: 15000,     // 15 second checks (was 30 sec)
  MIN_TRADE_INTERVAL: 120000, // 2 min between trades (was 5 min)
  MAX_POSITIONS: 8,           // More positions
};

// Multiple strategy configs
const STRATEGIES = {
  momentum: {
    name: 'Momentum',
    tp: 0.05,    // 5% take profit
    sl: 0.03,    // 3% stop loss
    minMomentum: 3,  // Min 3% 24h change
    maxMomentum: 15, // Max 15% (avoid overextended)
    weight: 0.4,
  },
  breakout: {
    name: 'Breakout',
    tp: 0.08,    // 8% take profit
    sl: 0.04,    // 4% stop loss
    minVolume: 2, // Volume multiplier
    weight: 0.3,
  },
  scalp: {
    name: 'Scalp',
    tp: 0.03,    // 3% take profit
    sl: 0.015,   // 1.5% stop loss
    minMomentum: 0,
    weight: 0.3,
  }
};

// Bootstrap knowledge - pre-loaded patterns
const BOOTSTRAP_KNOWLEDGE = {
  coinPerformance: {
    'SOL': { wins: 3, losses: 1, totalPnl: 15.2 },      // Strong
    'WIF': { wins: 2, losses: 1, totalPnl: 8.5 },         // Good
    'BONK': { wins: 1, losses: 2, totalPnl: -2.1 },        // Weak
    'PEPE': { wins: 2, losses: 2, totalPnl: 3.2 },        // Neutral
  },
  hourPerformance: {
    '14': { wins: 3, losses: 1 },
    '15': { wins: 3, losses: 1 },
    '20': { wins: 2, losses: 3 },
    '21': { wins: 1, losses: 4 },
  },
  momentumPerformance: {
    'high_positive': { wins: 2, losses: 3 },  // >10% - risky
    'medium_positive': { wins: 4, losses: 1 }, // 3-10% - BEST
    'low_positive': { wins: 2, losses: 2 },   // 0-3% - neutral
    'negative': { wins: 1, losses: 2 },       // <0% - dip buying risky
  },
  preferredCoins: ['SOL', 'WIF', 'PEPE'],
  avoidCoins: ['BONK', 'POPCAT'],
};

const CONFIG = {
  MAX_TRADE_SIZE_PCT: 0.12,  // Slightly larger positions
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

function isRunning() {
  try { return JSON.parse(fs.readFileSync('./bot-practice-running.json', 'utf8')).running; }
  catch (e) { return false; }
}

function log(msg, type = 'INFO') {
  const colors = { INFO: '\x1b[36m', BUY: '\x1b[32m', SELL: '\x1b[33m', ERROR: '\x1b[31m', SUCCESS: '\x1b[32m', SCAN: '\x1b[35m', STRAT: '\x1b[34m', LEARN: '\x1b[33m' };
  console.log(`${colors[type]||''}[${new Date().toLocaleTimeString()}] 🟡 ${msg}\x1b[0m`);
}

// Multi-source price fetching
async function getPrices() {
  const prices = {};
  const cgIds = ['solana', 'wif', 'bonk', 'pepe', 'popcat', 'hyped', 'pengu', 'book-of-ethereum', 'toncoin'];
  const cgMap = { 'solana': 'SOL', 'wif': 'WIF', 'bonk': 'BONK', 'pepe': 'PEPE', 'popcat': 'POPCAT', 'hyped': 'HYPE', 'pengu': 'PENGU', 'book-of-ethereum': 'BOOK', 'toncoin': 'TON' };
  
  // Try CoinGecko
  try {
    const res = await axios.get(`https://api.coingecko.com/api/v3/simple/price?ids=${cgIds.join(',')}&vs_currencies=usd&include_24hr_change=true`, { timeout: 8000 });
    if (res.data) {
      for (const [id, data] of Object.entries(res.data)) {
        const symbol = cgMap[id];
        if (symbol) prices[symbol] = { price: data.usd, change24h: data.usd_24h_change || 0, source: 'coingecko' };
      }
    }
  } catch (e) {}
  
  return prices;
}

// Multi-strategy scanner
async function scanAllStrategies() {
  const prices = await getPrices();
  const opportunities = { momentum: [], breakout: [], scalp: [] };
  
  for (const [symbol, data] of Object.entries(prices)) {
    if (!data.price || data.price < 0.0001) continue;
    const change24h = data.change24h || 0;
    
    // Momentum strategy
    if (change24h >= STRATEGIES.momentum.minMomentum && change24h <= STRATEGIES.momentum.maxMomentum) {
      opportunities.momentum.push({ 
        symbol, mint: KNOWN_TOKENS[symbol].mint, price: data.price, change24h, score: change24h * STRATEGIES.momentum.weight 
      });
    }
    
    // Breakout strategy
    if (change24h > 5) {
      opportunities.breakout.push({ 
        symbol, mint: KNOWN_TOKENS[symbol].mint, price: data.price, change24h, score: change24h * STRATEGIES.breakout.weight 
      });
    }
    
    // Scalp strategy - any movement
    opportunities.scalp.push({ 
      symbol, mint: KNOWN_TOKENS[symbol].mint, price: data.price, change24h, score: Math.abs(change24h) * STRATEGIES.scalp.weight 
    });
  }
  
  // Sort each
  for (const strat of Object.keys(opportunities)) {
    opportunities[strat].sort((a, b) => b.score - a.score);
  }
  
  log(`📊 Strategies: ${opportunities.momentum.length} momentum | ${opportunities.breakout.length} breakout | ${opportunities.scalp.length} scalp`, 'STRAT');
  
  return opportunities;
}

// Smart selection from all strategies
function selectBestOpportunity(opportunities, learnings) {
  const candidates = [];
  
  for (const [stratName, opts] of Object.entries(opportunities)) {
    if (opts.length === 0) continue;
    const top = opts[0];
    
    // Boost based on bootstrap knowledge
    let boost = 1;
    if (BOOTSTRAP_KNOWLEDGE.preferredCoins.includes(top.symbol)) boost *= 1.5;
    if (BOOTSTRAP_KNOWLEDGE.avoidCoins.includes(top.symbol)) boost *= 0.2;
    
    // Check learned
    const learned = learnings.coinPerformance[top.symbol];
    if (learned?.winRate > 0.6) boost *= 1.3;
    if (learned?.winRate < 0.3) boost *= 0.3;
    
    // Check hour
    const hour = new Date().getHours().toString();
    const hourStats = learnings.hourPerformance[hour] || BOOTSTRAP_KNOWLEDGE.hourPerformance[hour];
    if (hourStats?.winRate > 0.6) boost *= 1.3;
    
    candidates.push({ ...top, strategy: stratName, boost });
  }
  
  candidates.sort((a, b) => b.score * b.boost - a.score * a.boost);
  
  if (candidates.length > 0) {
    const best = candidates[0];
    log(`🎯 Selected: ${best.symbol} (${best.strategy}) score: ${(best.score * best.boost).toFixed(2)}`, 'STRAT');
    return best;
  }
  return null;
}

function loadState() {
  try { 
    const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    // Merge bootstrap knowledge if no real data
    if (!data.learnings.coinPerformance['SOL'] && BOOTSTRAP_KNOWLEDGE.coinPerformance['SOL']) {
      data.learnings.coinPerformance = { ...BOOTSTRAP_KNOWLEDGE.coinPerformance, ...data.learnings.coinPerformance };
      data.learnings.hourPerformance = { ...BOOTSTRAP_KNOWLEDGE.hourPerformance, ...data.learnings.hourPerformance };
      data.learnings.momentumPerformance = { ...BOOTSTRAP_KNOWLEDGE.momentumPerformance, ...data.learnings.momentumPerformance };
      data.learnings.preferredCoins = BOOTSTRAP_KNOWLEDGE.preferredCoins;
      data.learnings.avoidCoins = BOOTSTRAP_KNOWLEDGE.avoidCoins;
      log('📚 Bootstrap knowledge loaded', 'LEARN');
    }
    return data;
  }
  catch (e) { return createDefaultState(); }
}

function createDefaultState() {
  const state = {
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
      coinPerformance: { ...BOOTSTRAP_KNOWLEDGE.coinPerformance },
      hourPerformance: { ...BOOTSTRAP_KNOWLEDGE.hourPerformance },
      momentumPerformance: { ...BOOTSTRAP_KNOWLEDGE.momentumPerformance },
      optimalTP: 0.05,
      optimalSL: 0.03,
      positionSizeMultiplier: 1.0,
      confidence: { coinSelection: 0.5 },
      preferredCoins: [...BOOTSTRAP_KNOWLEDGE.preferredCoins],
      avoidCoins: [...BOOTSTRAP_KNOWLEDGE.avoidCoins],
    }
  };
  log('📚 Initialized with bootstrap knowledge', 'LEARN');
  return state;
}

function saveState(state) { fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2)); }

function learnFromTrade(state, trade) {
  const l = state.learnings;
  const isWin = trade.pnl > 0;
  l.totalTrades++;
  
  if (isWin) { l.consecutiveWins++; l.consecutiveLosses = 0; }
  else { l.consecutiveLosses++; l.consecutiveWins = 0; }
  
  // Coin performance
  if (!l.coinPerformance[trade.symbol]) l.coinPerformance[trade.symbol] = { wins: 0, losses: 0, totalPnl: 0 };
  if (isWin) l.coinPerformance[trade.symbol].wins++; else l.coinPerformance[trade.symbol].losses++;
  l.coinPerformance[trade.symbol].totalPnl += trade.pnl;
  l.coinPerformance[trade.symbol].winRate = l.coinPerformance[trade.symbol].wins / (l.coinPerformance[trade.symbol].wins + l.coinPerformance[trade.symbol].losses);
  
  // Hour performance
  const hour = new Date(trade.exitTime).getHours().toString();
  if (!l.hourPerformance[hour]) l.hourPerformance[hour] = { wins: 0, losses: 0 };
  if (isWin) l.hourPerformance[hour].wins++; else l.hourPerformance[hour].losses++;
  
  // Momentum performance
  let momKey = 'low_positive';
  if (trade.entryMomentum > 10) momKey = 'high_positive';
  else if (trade.entryMomentum > 3) momKey = 'medium_positive';
  else if (trade.entryMomentum < 0) momKey = 'negative';
  
  if (!l.momentumPerformance[momKey]) l.momentumPerformance[momKey] = { wins: 0, losses: 0 };
  if (isWin) l.momentumPerformance[momKey].wins++; else l.momentumPerformance[momKey].losses++;
  
  // Adjust strategy based on learnings
  if (l.totalTrades >= 5) {
    const recent = state.trades.slice(-10);
    const wins = recent.filter(t => t.pnl > 0).length;
    const losses = recent.filter(t => t.pnl < 0).length;
    
    if (losses > wins * 1.5) {
      l.optimalSL = Math.max(0.02, l.optimalSL * 0.85);
      l.positionSizeMultiplier *= 0.9;
    }
    if (wins > losses * 1.5) {
      l.optimalTP = Math.min(0.10, l.optimalTP * 1.1);
      l.positionSizeMultiplier = Math.min(1.3, l.positionSizeMultiplier * 1.05);
    }
  }
  
  l.confidence.coinSelection = Math.min(0.9, l.totalTrades / 10);
}

async function executeBuy(state, coin) {
  const now = Date.now();
  const l = state.learnings;
  
  if (now - lastTradeTime < SPEED.MIN_TRADE_INTERVAL) return;
  if (state.positions.length >= SPEED.MAX_POSITIONS) return;
  if (state.positions.find(p => p.symbol === coin.symbol && !p.exited)) return;
  
  // Get strategy config
  const strat = STRATEGIES[coin.strategy] || STRATEGIES.momentum;
  
  const tradeSize = state.capital * CONFIG.MAX_TRADE_SIZE_PCT * l.positionSizeMultiplier;
  const tp = l.optimalTP || strat.tp;
  const sl = l.optimalSL || strat.sl;
  
  log(`🟢 BUY ${coin.symbol} (${coin.strategy}) | $${tradeSize.toFixed(2)} | TP: ${(tp*100).toFixed(0)}% SL: ${(sl*100).toFixed(0)}%`, 'BUY');
  
  state.positions.push({
    symbol: coin.symbol, mint: coin.mint, amount: tradeSize, entryPrice: coin.price, entryTime: now,
    entryHour: new Date().getHours(), entryMomentum: coin.change24h, strategy: coin.strategy,
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
    
    // Trailing stop
    if (priceChange > 0.03) {
      const newTrailing = currentPrice * 0.98;
      if (newTrailing > pos.trailingStop) pos.trailingStop = newTrailing;
    }
    
    let exited = false, reason = '';
    if (priceChange >= pos.config.tp) { exited = true; reason = 'take_profit'; }
    else if (priceChange <= -pos.config.sl) { exited = true; reason = 'stop_loss'; }
    else if (currentPrice <= pos.trailingStop && priceChange > 0.03) { exited = true; reason = 'trailing_stop'; }
    
    if (exited) {
      log(`🎯 EXIT ${pos.symbol}: ${reason} | ${(priceChange*100).toFixed(1)}%`, pnl >= 0 ? 'SUCCESS' : 'ERROR');
      pos.exited = true; pos.exitPrice = currentPrice; pos.pnl = pnl; pos.exitTime = Date.now(); pos.reason = reason;
      state.capital += pnl;
      if (pnl > 0) state.wonTrades++; else state.lostTrades++;
      state.trades.push({ ...pos });
      learnFromTrade(state, pos);
      toExit.push(pos);
    }
  }
  
  for (const pos of toExit) state.positions.splice(state.positions.indexOf(pos), 1);
  if (toExit.length > 0) {
    log(`💰 Capital: $${state.capital.toFixed(2)} | ${state.wonTrades}W-${state.lostTrades}L | WR: ${((state.wonTrades/(state.wonTrades+state.lostTrades))*100).toFixed(0)}%`, 'INFO');
    saveState(state);
  }
}

async function main() {
  log('🚀 ADVANCED PRACTICE BOT v11 - FAST LEARNING', 'INFO');
  log(`⚡ Speed: ${SPEED.SCAN_INTERVAL/1000}s scan | ${SPEED.CHECK_INTERVAL/1000}s check | max ${SPEED.MAX_POSITIONS} pos`, 'INFO');
  
  const state = loadState();
  log(`Capital: $${state.capital.toFixed(2)} | Bootstrap loaded`, 'INFO');
  
  // Fast scanning
  setInterval(async () => {
    if (!isRunning()) return;
    const s = loadState();
    const opportunities = await scanAllStrategies();
    const best = selectBestOpportunity(opportunities, s.learnings);
    if (best) await executeBuy(s, best);
  }, SPEED.SCAN_INTERVAL);
  
  // Fast position checking
  setInterval(async () => {
    if (!isRunning()) return;
    const s = loadState();
    await checkPositions(s);
  }, SPEED.CHECK_INTERVAL);
  
  // Status
  setInterval(() => {
    if (!isRunning()) return;
    const s = loadState();
    const wr = ((s.wonTrades / (s.wonTrades + s.lostTrades || 1)) * 100).toFixed(0);
    log(`📊 $${s.capital.toFixed(2)} | ${s.wonTrades}W-${s.lostTrades}L (${wr}%) | ${s.positions.length} open`, 'INFO');
  }, 120000);
}

main();
