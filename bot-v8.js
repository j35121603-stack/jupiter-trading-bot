#!/usr/bin/env node
/**
 * JUPITER BOT v8 - Learning Trading Bot
 * Continuously learns from trades to improve strategy
 * Uses real-time prices, simulates trades, learns from mistakes
 */

const { Connection, Keypair } = require('@solana/web3.js');
const axios = require('axios');
const fs = require('fs');

const PRIVATE_KEY = [251,29,114,181,142,96,158,60,191,29,28,215,45,235,164,89,18,76,7,86,18,196,204,45,107,2,180,123,32,26,120,179,163,137,111,217,115,32,78,114,232,19,195,235,243,114,134,190,86,39,89,168,10,43,167,105,138,213,206,226,68,208,102,225];
const SOLANA_RPC = 'https://api.mainnet-beta.solana.com';

const TELEGRAM_BOT_TOKEN = "8460832535:AAEVnaEwFl7_BEazPF6rJJz4FCgrAk6TIvs";
const TELEGRAM_CHAT_ID = "7725826486";

const WALLET_ADDRESS = '54FksWWGjGWAwEv9UnijnbhAKgtYMRvLz3H2bHsyDqTU';

// Learning configuration
const LEARNING_CONFIG = {
  DECAY_FACTOR: 0.95,        // Older trades weighted less
  MIN_SAMPLES: 5,            // Min trades before adjusting
  ADAPTIVE_TP: true,         // Dynamically adjust take profit
  ADAPTIVE_SL: true,         // Dynamically adjust stop loss
  LEARN_COINS: true,         // Learn which coins perform best
  LEARN_TIMING: true,        // Learn best time of day
  LEARN_MOMENTUM: true,      // Learn best momentum thresholds
};

const DEFAULT_CONFIG = {
  INITIAL_CAPITAL: 1000,
  MAX_TRADE_SIZE_PCT: 0.10,
  MAX_DAILY_TRADES: 15,
  MIN_MARKET_CAP: 50000,
  TAKE_PROFIT: 0.12,
  STOP_LOSS: 0.05,
  MAX_OPEN_POSITIONS: 5,
  MIN_TRADE_INTERVAL: 180000,
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
  'MOODENG': { mint: 'MoodENGe1Zc4j1cF6q6vY9x2bK3wL8hR7fP6dE4sA' },
  'AI16Z': { mint: 'AI16Z泡沫A1Zc4j1cF6q6vY9x2bK3wL8hR7fP6dE4sA' },
};

const SOL_MINT = 'So11111111111111111111111111111111111111112';

let wallet, connection;
let lastTradeTime = 0;

// Bot state
let state = {
  capital: DEFAULT_CONFIG.INITIAL_CAPITAL,
  trades: [],
  positions: [],
  dailyTrades: 0,
  dailyPnl: 0,
  wonTrades: 0,
  lostTrades: 0,
  startedAt: Date.now(),
  
  // Learning data
  learnings: {
    coinPerformance: {},      // Win rate by coin
    hourPerformance: {},     // Win rate by hour of day
    momentumThresholds: {},  // Best momentum by coin
    optimalTP: DEFAULT_CONFIG.TAKE_PROFIT,
    optimalSL: DEFAULT_CONFIG.STOP_LOSS,
    totalTrades: 0,
    consecutiveWins: 0,
    consecutiveLosses: 0,
  }
};

function log(msg, type = 'INFO') {
  const colors = { 
    INFO: '\x1b[36m', BUY: '\x1b[32m', SELL: '\x1b[33m', 
    ERROR: '\x1b[31m', SUCCESS: '\x1b[32m', TG: '\x1b[34m', 
    SCAN: '\x1b[35m', LEARN: '\x1b[33m', ADAPT: '\x1b[32m' 
  };
  console.log(`${colors[type]||''}[${new Date().toLocaleTimeString()}] ${msg}\x1b[0m`);
}

async function sendTelegram(msg) {
  try {
    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, { 
      chat_id: TELEGRAM_CHAT_ID, 
      text: '🧠 LEARNING BOT: ' + msg, 
      parse_mode: 'HTML' 
    });
  } catch (e) {}
}

// Get real prices from multiple sources
async function getPrices() {
  const prices = {};
  
  // Try CoinGecko first (more reliable)
  const symbols = Object.keys(KNOWN_TOKENS);
  const cgIds = ['solana', 'wif', 'bonk', 'pepe', 'hyped', 'pengu', 'popcat', 'mewcoin', 'toncoin', 'book-of-ethereum'];
  
  try {
    const res = await axios.get(`https://api.coingecko.com/api/v3/simple/price?ids=${cgIds.join(',')}&vs_currencies=usd&include_24hr_change=true`, { timeout: 15000 });
    
    const cgMap = {
      'solana': 'SOL', 'wif': 'WIF', 'bonk': 'BONK', 'pepe': 'PEPE', 
      'hyped': 'HYPE', 'pengu': 'PENGU', 'popcat': 'POPCAT',
      'mewcoin': 'MEW', 'toncoin': 'TON', 'book-of-ethereum': 'BOOK'
    };
    
    if (res.data) {
      for (const [id, data] of Object.entries(res.data)) {
        const symbol = cgMap[id];
        if (symbol && KNOWN_TOKENS[symbol]) {
          prices[symbol] = {
            price: data.usd,
            mint: KNOWN_TOKENS[symbol].mint,
            change24h: data.usd_24h_change || 0
          };
        }
      }
    }
  } catch (e) {
    log('CoinGecko fetch failed: ' + e.message, 'ERROR');
  }
  
  return prices;
}

// Scan for opportunities with learning
async function scanOpportunities() {
  const opportunities = [];
  const prices = await getPrices();
  
  for (const [symbol, data] of Object.entries(prices)) {
    if (!data.price || data.price < 0.0001) continue;
    
    const change24h = data.change24h || 0;
    let score = 0;
    
    // Learning: Boost score for historically good coins
    const coinWinRate = state.learnings.coinPerformance[symbol]?.winRate || 0.5;
    score += (coinWinRate - 0.5) * 4;
    
    // Learning: Boost during historically good hours
    const currentHour = new Date().getHours();
    const hourWinRate = state.learnings.hourPerformance[currentHour]?.winRate || 0.5;
    score += (hourWinRate - 0.5) * 2;
    
    // Momentum scoring
    if (change24h > 5) score += 3;
    else if (change24h > 2) score += 2;
    else if (change24h > 0) score += 1;
    else if (change24h < -5) score += 1; // Dip buying
    
    if (score < 1) continue;
    
    opportunities.push({
      symbol,
      name: symbol,
      mint: data.mint,
      price: data.price,
      change24h,
      score,
      type: 'scalp'
    });
  }
  
  // Sort by learned score
  opportunities.sort((a, b) => b.score - a.score);
  
  log(`📊 Found ${opportunities.length} opportunities`, 'SCAN');
  for (const opp of opportunities.slice(0, 5)) {
    log(`   ${opp.symbol} | $${opp.price?.toFixed(4)} | ${opp.change24h?.toFixed(1)}% | Score: ${opp.score.toFixed(1)}`, 'SCAN');
  }
  
  return opportunities;
}

// Learn from completed trade
function learnFromTrade(trade) {
  const { symbol, pnl, pnlPct, exitHour, entryMomentum } = trade;
  state.learnings.totalTrades++;
  
  // Learn coin performance
  if (!state.learnings.coinPerformance[symbol]) {
    state.learnings.coinPerformance[symbol] = { wins: 0, losses: 0, totalPnl: 0 };
  }
  const coinStats = state.learnings.coinPerformance[symbol];
  
  if (pnl > 0) {
    coinStats.wins++;
    state.learnings.consecutiveWins++;
    state.learnings.consecutiveLosses = 0;
  } else {
    coinStats.losses++;
    state.learnings.consecutiveLosses++;
    state.learnings.consecutiveWins = 0;
  }
  coinStats.totalPnl += pnl;
  coinStats.winRate = coinStats.wins / (coinStats.wins + coinStats.losses);
  
  // Learn hour performance
  if (!state.learnings.hourPerformance[exitHour]) {
    state.learnings.hourPerformance[exitHour] = { wins: 0, losses: 0 };
  }
  const hourStats = state.learnings.hourPerformance[exitHour];
  if (pnl > 0) hourStats.wins++;
  else hourStats.losses++;
  hourStats.winRate = hourStats.wins / (hourStats.wins + hourStats.losses);
  
  // Adapt TP/SL based on performance
  if (LEARNING_CONFIG.ADAPTIVE_TP && state.learnings.totalTrades >= LEARNING_CONFIG.MIN_SAMPLES) {
    const recentTrades = state.trades.slice(-10);
    const avgWinPct = recentTrades.filter(t => t.pnl > 0).reduce((sum, t) => sum + t.pnlPct, 0) / Math.max(recentTrades.filter(t => t.pnl > 0).length, 1);
    
    // Adjust TP if we're hitting it often vs timing out
    const hitTP = recentTrades.filter(t => t.reason === 'take_profit').length;
    const hitSL = recentTrades.filter(t => t.reason === 'stop_loss').length;
    
    if (hitSL > hitTP * 2) {
      // Too many stops - tighten stop loss
      state.learnings.optimalSL = Math.max(0.02, state.learnings.optimalSL * 0.9);
      log(`📉 Adapted SL down to ${(state.learnings.optimalSL * 100).toFixed(1)}%`, 'ADAPT');
    }
    if (hitTP > hitSL * 2 && recentTrades.length > 5) {
      // Hitting TP often - could aim higher
      state.learnings.optimalTP = Math.min(0.25, state.learnings.optimalTP * 1.1);
      log(`📈 Adapted TP up to ${(state.learnings.optimalTP * 100).toFixed(1)}%`, 'ADAPT');
    }
  }
  
  log(`🧠 Learned: ${symbol} WR: ${(coinStats.winRate * 100).toFixed(0)}% | Hour ${exitHour} WR: ${(hourStats.winRate * 100).toFixed(0)}%`, 'LEARN');
}

// Get adaptive config based on learnings
function getAdaptiveConfig() {
  const config = { ...DEFAULT_CONFIG };
  
  if (LEARNING_CONFIG.ADAPTIVE_TP) {
    config.TAKE_PROFIT = state.learnings.optimalTP;
  }
  if (LEARNING_CONFIG.ADAPTIVE_SL) {
    config.STOP_LOSS = state.learnings.optimalSL;
  }
  
  return config;
}

// Execute simulated buy
async function executeBuy(coin) {
  const now = Date.now();
  const config = getAdaptiveConfig();
  
  // Rate limiting
  if (now - lastTradeTime < config.MIN_TRADE_INTERVAL) {
    return;
  }
  
  // Max positions
  if (state.positions.length >= config.MAX_OPEN_POSITIONS) {
    return;
  }
  
  // Check if already holding
  if (state.positions.find(p => p.symbol === coin.symbol && !p.exited)) {
    return;
  }
  
  const tradeSize = state.capital * config.MAX_TRADE_SIZE_PCT;
  
  log(`🟢 BUY ${coin.symbol} - $${tradeSize.toFixed(2)} | TP: ${(config.TAKE_PROFIT*100).toFixed(0)}% | SL: ${(config.STOP_LOSS*100).toFixed(0)}%`, 'BUY');
  
  const position = {
    symbol: coin.symbol,
    mint: coin.mint,
    amount: tradeSize,
    entryPrice: coin.price,
    entryTime: now,
    entryHour: new Date().getHours(),
    entryMomentum: coin.change24h,
    targetPrice: coin.price * (1 + config.TAKE_PROFIT),
    stopPrice: coin.price * (1 - config.STOP_LOSS),
    exited: false,
    config: { tp: config.TAKE_PROFIT, sl: config.STOP_LOSS }
  };
  
  state.positions.push(position);
  state.dailyTrades++;
  lastTradeTime = now;
  
  saveState();
}

// Check and exit positions
async function checkPositions() {
  const prices = await getPrices();
  const config = getAdaptiveConfig();
  const toExit = [];
  
  for (const pos of state.positions) {
    if (pos.exited) continue;
    
    const currentPrice = prices[pos.symbol]?.price;
    if (!currentPrice) continue;
    
    const priceChange = (currentPrice - pos.entryPrice) / pos.entryPrice;
    const pnl = pos.amount * priceChange;
    const pnlPct = priceChange * 100;
    
    // Check take profit
    if (priceChange >= config.TAKE_PROFIT) {
      log(`🎯 TAKE PROFIT: ${pos.symbol} +${pnlPct.toFixed(1)}% ($${pnl.toFixed(2)})`, 'SUCCESS');
      pos.exited = true;
      pos.exitPrice = currentPrice;
      pos.pnl = pnl;
      pos.pnlPct = pnlPct;
      pos.exitTime = Date.now();
      pos.exitHour = new Date().getHours();
      pos.reason = 'take_profit';
      
      state.capital += pnl;
      state.wonTrades++;
      state.trades.push({ ...pos });
      
      learnFromTrade(pos);
      toExit.push(pos);
    }
    // Check stop loss
    else if (priceChange <= -config.STOP_LOSS) {
      log(`🛑 STOP LOSS: ${pos.symbol} ${pnlPct.toFixed(1)}% ($${pnl.toFixed(2)})`, 'ERROR');
      pos.exited = true;
      pos.exitPrice = currentPrice;
      pos.pnl = pnl;
      pos.pnlPct = pnlPct;
      pos.exitTime = Date.now();
      pos.exitHour = new Date().getHours();
      pos.reason = 'stop_loss';
      
      state.capital += pnl;
      state.lostTrades++;
      state.trades.push({ ...pos });
      
      learnFromTrade(pos);
      toExit.push(pos);
    }
  }
  
  for (const pos of toExit) {
    const idx = state.positions.indexOf(pos);
    if (idx > -1) state.positions.splice(idx, 1);
  }
  
  if (toExit.length > 0) {
    log(`💰 Capital: $${state.capital.toFixed(2)} | Win Rate: ${((state.wonTrades / (state.wonTrades + state.lostTrades)) * 100).toFixed(0)}%`, 'INFO');
    saveState();
  }
}

// Print learning summary
function printLearnings() {
  log('🧠 LEARNING SUMMARY', 'LEARN');
  log(`   Total Trades: ${state.learnings.totalTrades}`, 'LEARN');
  log(`   Adaptive TP: ${(state.learnings.optimalTP * 100).toFixed(1)}%`, 'LEARN');
  log(`   Adaptive SL: ${(state.learnings.optimalSL * 100).toFixed(1)}%`, 'LEARN');
  
  const topCoins = Object.entries(state.learnings.coinPerformance)
    .sort((a, b) => (b[1].winRate || 0) - (a[1].winRate || 0))
    .slice(0, 3);
  
  if (topCoins.length > 0) {
    log('   Top Coins:', 'LEARN');
    for (const [sym, stats] of topCoins) {
      log(`     ${sym}: ${(stats.winRate * 100).toFixed(0)}% WR (${stats.wins}W-${stats.losses}L)`, 'LEARN');
    }
  }
}

function saveState() {
  fs.writeFileSync('./state-learning.json', JSON.stringify(state, null, 2));
}

function loadState() {
  try {
    const data = fs.readFileSync('./state-learning.json', 'utf8');
    state = { ...state, ...JSON.parse(data) };
    log(`Loaded: $${state.capital.toFixed(2)} | ${state.wonTrades}W-${state.lostTrades}L | ${state.learnings.totalTrades} learned`, 'INFO');
  } catch (e) {
    log('Starting fresh with learning', 'INFO');
  }
}

async function main() {
  log('🧠 JUPITER BOT v8 - LEARNING MODE', 'INFO');
  
  wallet = Keypair.fromSecretKey(new Uint8Array(PRIVATE_KEY));
  connection = new Connection(SOLANA_RPC);
  
  loadState();
  
  await sendTelegram(`🧠 Bot v8 Started!\nCapital: $${state.capital.toFixed(2)}\nLearning: ${state.learnings.totalTrades} trades`);
  
  // Trading loop
  setInterval(async () => {
    const opportunities = await scanOpportunities();
    
    if (opportunities.length > 0) {
      const best = opportunities[0];
      await executeBuy(best);
    }
  }, DEFAULT_CONFIG.SCAN_INTERVAL);
  
  // Position check loop
  setInterval(checkPositions, DEFAULT_CONFIG.CHECK_INTERVAL);
  
  // Learning summary every hour
  setInterval(printLearnings, 3600000);
  
  printLearnings();
  log(`Bot running. Capital: $${state.capital.toFixed(2)}`, 'INFO');
}

main();
