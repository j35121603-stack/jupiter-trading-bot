#!/usr/bin/env node
/**
 * JUPITER BOT v9 - Advanced Learning Trading Bot
 * Enhanced learning from every trade with pattern recognition
 * Self-improving strategy based on historical data
 */

const { Connection, Keypair } = require('@solana/web3.js');
const axios = require('axios');
const fs = require('fs');

const PRIVATE_KEY = [251,29,114,181,142,96,158,60,191,29,28,215,45,235,164,89,18,76,7,86,18,196,204,45,107,2,180,123,32,26,120,179,163,137,111,217,115,32,78,114,232,19,195,235,243,114,134,190,86,39,89,168,10,43,167,105,138,213,206,226,68,208,102,225];
const SOLANA_RPC = 'https://api.mainnet-beta.solana.com';

const TELEGRAM_BOT_TOKEN = "8460832535:AAEVnaEwFl7_BEazPF6rJJz4FCgrAk6TIvs";
const TELEGRAM_CHAT_ID = "7725826486";

const WALLET_ADDRESS = '54FksWWGjGWAwEv9UnijnbhAKgtYMRvLz3H2bHsyDqTU';

// Enhanced learning configuration
const LEARNING = {
  MIN_TRADES_ADJUST: 3,      // Trades before big adjustments
  PATTERN_WINDOW: 10,         // Recent trades to analyze
  CONFIDENCE_THRESHOLD: 0.6, // Win rate needed to trust a coin
  MAX_CONFIDENCE: 0.85,      // Cap confidence to avoid overfitting
  
  // Risk adjustments
  STREAK_PENALTY: 0.5,       // Reduce position size on losing streak
  STREAK_RECOVERY: 1.5,      // Increase on winning streak
  
  // Strategy modifiers
  MOMENTUM_WEIGHT: 0.3,      // Weight for momentum in scoring
  VOLUME_WEIGHT: 0.2,        // Weight for volume
  PERFORMANCE_WEIGHT: 0.5,    // Weight for historical performance
};

const DEFAULT_CONFIG = {
  INITIAL_CAPITAL: 1000,
  MAX_TRADE_SIZE_PCT: 0.10,
  MAX_DAILY_TRADES: 10,
  MIN_MARKET_CAP: 50000,
  TAKE_PROFIT: 0.10,
  STOP_LOSS: 0.05,
  MAX_OPEN_POSITIONS: 4,
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
};

const SOL_MINT = 'So11111111111111111111111111111111111111112';

let wallet, connection;
let lastTradeTime = 0;
let currentMode = 'practice'; // practice, live, or stop

// Get current mode from dashboard
function getMode() {
  try {
    const modeData = JSON.parse(fs.readFileSync('./bot-mode.json', 'utf8'));
    return modeData.mode || 'practice';
  } catch (e) {
    return 'practice';
  }
}

// Bot state with enhanced learning
let state = {
  capital: 994.91,  // Start from where v8 left off
  trades: [],
  positions: [],
  dailyTrades: 0,
  wonTrades: 0,
  lostTrades: 0,
  startedAt: Date.now(),
  
  // Enhanced learnings
  learnings: {
    // Basic stats
    totalTrades: 1,
    consecutiveWins: 0,
    consecutiveLosses: 1,
    lastTradeResult: 'loss',
    
    // Performance by coin
    coinPerformance: {
      'POPCAT': { wins: 0, losses: 1, totalPnl: -5.09, avgHoldingTime: 0 }
    },
    
    // Performance by hour
    hourPerformance: {
      '18': { wins: 0, losses: 1, winRate: 0 }
    },
    
    // Performance by momentum range
    momentumPerformance: {
      'high_positive': { wins: 0, losses: 1 },  // >10% 24h
      'medium_positive': { wins: 0, losses: 0 }, // 3-10%
      'low_positive': { wins: 0, losses: 0 },    // 0-3%
      'negative': { wins: 0, losses: 0 }        // <0%
    },
    
    // Performance by market condition
    marketCondition: {
      'bull': { wins: 0, losses: 0 },
      'bear': { wins: 0, losses: 0 },
      'sideways': { wins: 0, losses: 0 }
    },
    
    // Adaptive parameters
    optimalTP: 0.10,
    optimalSL: 0.05,
    positionSizeMultiplier: 1.0,
    
    // Confidence scores (0-1)
    confidence: {
      coinSelection: 0.3,
      timing: 0.3,
      momentumThreshold: 0.3
    },
    
    // Patterns identified
    patterns: [],
    
    // Worst performing - avoid
    avoidCoins: [],
    preferredCoins: []
  }
};

function log(msg, type = 'INFO') {
  const colors = { 
    INFO: '\x1b[36m', BUY: '\x1b[32m', SELL: '\x1b[33m', 
    ERROR: '\x1b[31m', SUCCESS: '\x1b[32m', 
    SCAN: '\x1b[35m', LEARN: '\x1b[33m', ADAPT: '\x1b[32m',
    PATTERN: '\x1b[34m'
  };
  console.log(`${colors[type]||''}[${new Date().toLocaleTimeString()}] ${msg}\x1b[0m`);
}

async function sendTelegram(msg) {
  try {
    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, { 
      chat_id: TELEGRAM_CHAT_ID, 
      text: '🧠 v9 LEARNING: ' + msg, 
      parse_mode: 'HTML' 
    });
  } catch (e) {}
}

// Get prices from CoinGecko
async function getPrices() {
  const prices = {};
  const cgIds = ['solana', 'wif', 'bonk', 'pepe', 'popcat', 'hyped', 'pengu', 'book-of-ethereum', 'toncoin', 'cat-in-a-dogs-world'];
  
  try {
    const res = await axios.get(`https://api.coingecko.com/api/v3/simple/price?ids=${cgIds.join(',')}&vs_currencies=usd&include_24hr_change=true`, { timeout: 15000 });
    
    const cgMap = {
      'solana': 'SOL', 'wif': 'WIF', 'bonk': 'BONK', 'pepe': 'PEPE', 
      'popcat': 'POPCAT', 'hyped': 'HYPE', 'pengu': 'PENGU',
      'book-of-ethereum': 'BOOK', 'toncoin': 'TON', 'cat-in-a-dogs-world': 'MEW'
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
    log('Price fetch error: ' + e.message, 'ERROR');
  }
  
  return prices;
}

// Analyze market condition
function getMarketCondition(prices) {
  const changes = Object.values(prices).map(p => p.change24h).filter(c => c !== undefined);
  if (changes.length === 0) return 'sideways';
  
  const avgChange = changes.reduce((a, b) => a + b, 0) / changes.length;
  
  if (avgChange > 3) return 'bull';
  if (avgChange < -3) return 'bear';
  return 'sideways';
}

// Enhanced opportunity scanning with learning
async function scanOpportunities() {
  const prices = await getPrices();
  const opportunities = [];
  const market = getMarketCondition(prices);
  const learnings = state.learnings;
  
  log(`📊 Market: ${market.toUpperCase()} | Conf: ${(learnings.confidence.coinSelection * 100).toFixed(0)}%`, 'SCAN');
  
  for (const [symbol, data] of Object.entries(prices)) {
    if (!data.price || data.price < 0.0001) continue;
    if (learnings.avoidCoins.includes(symbol)) continue;
    
    const change24h = data.change24h || 0;
    let score = 0;
    
    // 1. Historical performance (learned)
    const coinStats = learnings.coinPerformance[symbol];
    if (coinStats && coinStats.wins + coinStats.losses >= 1) {
      const winRate = coinStats.wins / (coinStats.wins + coinStats.losses);
      if (winRate >= LEARNING.CONFIDENCE_THRESHOLD) {
        score += LEARNING.PERFORMANCE_WEIGHT * 4;  // Boost good performers
        log(`   ✓ ${symbol} has good history: ${(winRate*100).toFixed(0)}%`, 'SCAN');
      } else if (winRate < 0.3) {
        continue; // Skip poor performers
      }
    }
    
    // 2. Momentum scoring (with learning)
    let momentumCategory;
    if (change24h > 10) momentumCategory = 'high_positive';
    else if (change24h > 3) momentumCategory = 'medium_positive';
    else if (change24h > 0) momentumCategory = 'low_positive';
    else momentumCategory = 'negative';
    
    const momStats = learnings.momentumPerformance[momentumCategory];
    if (momStats && momStats.wins + momStats.losses >= 1) {
      const momWR = momStats.wins / (momStats.wins + momStats.losses);
      score += LEARNING.MOMENTUM_WEIGHT * (momWR - 0.5) * 6;
    } else {
      // Default: prefer moderate momentum
      if (change24h > 3 && change24h < 15) score += 2;
      else if (change24h > 10) score += 1; // Too hot might be late
    }
    
    // 3. Hour performance (learned)
    const currentHour = new Date().getHours();
    const hourStats = learnings.hourPerformance[currentHour];
    if (hourStats && hourStats.wins + hourStats.losses >= 1) {
      const hourWR = hourStats.wins / (hourStats.wins + hourStats.losses);
      score += (hourWR - 0.5) * 2;
    }
    
    // 4. Market condition alignment
    const marketStats = learnings.marketCondition[market];
    if (marketStats && marketStats.wins + marketStats.losses >= 1) {
      const marketWR = marketStats.wins / (marketStats.wins + marketStats.losses);
      score += (marketWR - 0.5);
    }
    
    // 5. Preferred coins boost
    if (learnings.preferredCoins.includes(symbol)) {
      score += 2;
    }
    
    if (score < 1) continue;
    
    opportunities.push({
      symbol,
      name: symbol,
      mint: data.mint,
      price: data.price,
      change24h,
      momentumCategory,
      market,
      score
    });
  }
  
  // Sort by learned score
  opportunities.sort((a, b) => b.score - a.score);
  
  // Log top opportunities
  log(`📊 Found ${opportunities.length} opportunities`, 'SCAN');
  for (const opp of opportunities.slice(0, 4)) {
    const coinStats = learnings.coinPerformance[opp.symbol];
    const wr = coinStats ? (coinStats.wins / (coinStats.wins + coinStats.losses) * 100).toFixed(0) + '%' : 'new';
    log(`   ${opp.symbol} | $${opp.price?.toFixed(4)} | ${opp.change24h?.toFixed(1)}% | Score: ${opp.score.toFixed(1)} | WR: ${wr}`, 'SCAN');
  }
  
  return opportunities;
}

// Learn from completed trade - enhanced version
function learnFromTrade(trade) {
  const learnings = state.learnings;
  const { symbol, pnl, pnlPct, exitHour, entryMomentum, exitPrice, entryPrice: entry } = trade;
  
  const isWin = pnl > 0;
  learnings.totalTrades++;
  
  // Update streaks
  if (isWin) {
    learnings.consecutiveWins++;
    learnings.consecutiveLosses = 0;
    learnings.lastTradeResult = 'win';
  } else {
    learnings.consecutiveLosses++;
    learnings.consecutiveWins = 0;
    learnings.lastTradeResult = 'loss';
  }
  
  // 1. Learn coin performance
  if (!learnings.coinPerformance[symbol]) {
    learnings.coinPerformance[symbol] = { wins: 0, losses: 0, totalPnl: 0, avgHoldingTime: 0 };
  }
  const coinStats = learnings.coinPerformance[symbol];
  if (isWin) coinStats.wins++;
  else coinStats.losses++;
  coinStats.totalPnl += pnl;
  coinStats.winRate = coinStats.wins / (coinStats.wins + coinStats.losses);
  
  // Update avoid/preferred lists
  if (coinStats.winRate >= LEARNING.CONFIDENCE_THRESHOLD && coinStats.wins + coinStats.losses >= 3) {
    if (!learnings.preferredCoins.includes(symbol)) {
      learnings.preferredCoins.push(symbol);
      learnings.avoidCoins = learnings.avoidCoins.filter(c => c !== symbol);
      log(`⭐ Added ${symbol} to preferred coins`, 'PATTERN');
    }
  } else if (coinStats.winRate < 0.3 && coinStats.wins + coinStats.losses >= 3) {
    if (!learnings.avoidCoins.includes(symbol)) {
      learnings.avoidCoins.push(symbol);
      learnings.preferredCoins = learnings.preferredCoins.filter(c => c !== symbol);
      log(`⛔ Added ${symbol} to avoid list`, 'PATTERN');
    }
  }
  
  // 2. Learn hour performance
  const hourKey = exitHour.toString();
  if (!learnings.hourPerformance[hourKey]) {
    learnings.hourPerformance[hourKey] = { wins: 0, losses: 0 };
  }
  if (isWin) learnings.hourPerformance[hourKey].wins++;
  else learnings.hourPerformance[hourKey].losses++;
  learnings.hourPerformance[hourKey].winRate = 
    learnings.hourPerformance[hourKey].wins / (learnings.hourPerformance[hourKey].wins + learnings.hourPerformance[hourKey].losses);
  
  // 3. Learn momentum performance
  let momCategory;
  if (entryMomentum > 10) momCategory = 'high_positive';
  else if (entryMomentum > 3) momCategory = 'medium_positive';
  else if (entryMomentum > 0) momCategory = 'low_positive';
  else momCategory = 'negative';
  
  if (!learnings.momentumPerformance[momCategory]) {
    learnings.momentumPerformance[momCategory] = { wins: 0, losses: 0 };
  }
  if (isWin) learnings.momentumPerformance[momCategory].wins++;
  else learnings.momentumPerformance[momCategory].losses++;
  
  // 4. Adapt TP/SL based on results
  if (learnings.totalTrades >= LEARNING.MIN_TRADES_ADJUST) {
    const recentTrades = state.trades.slice(-LEARNING.PATTERN_WINDOW);
    const wins = recentTrades.filter(t => t.pnl > 0);
    const losses = recentTrades.filter(t => t.pnl < 0);
    
    // If hitting SL too often, tighten it
    const slHits = losses.length;
    const tpHits = wins.length;
    
    if (slHits > tpHits * 1.5) {
      learnings.optimalSL = Math.max(0.03, learnings.optimalSL * 0.85);
      learnings.positionSizeMultiplier *= 0.9; // Reduce risk
      log(`📉 Tightened SL to ${(learnings.optimalSL*100).toFixed(1)}%, reducing size`, 'ADAPT');
    }
    
    // If hitting TP, consider raising it
    if (tpHits > slHits * 1.5) {
      learnings.optimalTP = Math.min(0.20, learnings.optimalTP * 1.1);
      learnings.positionSizeMultiplier = Math.min(1.5, learnings.positionSizeMultiplier * 1.05);
      log(`📈 Raised TP to ${(learnings.optimalTP*100).toFixed(1)}%, increasing size`, 'ADAPT');
    }
  }
  
  // 5. Adjust for streaks
  if (learnings.consecutiveLosses >= 3) {
    learnings.positionSizeMultiplier = Math.max(0.5, LEARNING.STREAK_PENALTY);
    learnings.optimalSL = Math.max(0.03, learnings.optimalSL * 0.8); // Tighter stops
    log(`⚠️ Losing streak detected - conservative mode`, 'ADAPT');
  } else if (learnings.consecutiveWins >= 3) {
    learnings.positionSizeMultiplier = Math.min(1.5, LEARNING.STREAK_RECOVERY);
    log(`🔥 Winning streak - aggressive mode`, 'ADAPT');
  }
  
  // 6. Update confidence scores
  const totalSamples = learnings.totalTrades;
  learnings.confidence.coinSelection = Math.min(LEARNING.MAX_CONFIDENCE, totalSamples / 20);
  learnings.confidence.timing = Math.min(LEARNING.MAX_CONFIDENCE, Object.keys(learnings.hourPerformance).filter(k => learnings.hourPerformance[k].wins + learnings.hourPerformance[k].losses >= 2).length / 10);
  
  // Log summary
  log(`🧠 LEARNED: ${symbol} | WR: ${(coinStats.winRate*100).toFixed(0)}% | TP: ${(learnings.optimalTP*100).toFixed(0)}% | SL: ${(learnings.optimalSL*100).toFixed(0)}% | Size: ${(learnings.positionSizeMultiplier*100).toFixed(0)}%`, 'LEARN');
  
  // Identify patterns
  identifyPatterns();
}

// Identify trading patterns
function identifyPatterns() {
  const learnings = state.learnings;
  const patterns = [];
  
  // Pattern: Best time to trade
  const bestHour = Object.entries(learnings.hourPerformance)
    .filter(([_, s]) => s.wins + s.losses >= 2)
    .sort((a, b) => (b[1].winRate || 0) - (a[1].winRate || 0))[0];
  
  if (bestHour) {
    patterns.push(`Best trading hour: ${bestHour[0]}:00 (${(bestHour[1].winRate*100).toFixed(0)}% WR)`);
  }
  
  // Pattern: Best momentum range
  const bestMomentum = Object.entries(learnings.momentumPerformance)
    .filter(([_, s]) => s.wins + s.losses >= 1)
    .sort((a, b) => (b[1].wins / (b[1].wins + b[1].losses) || 0) - (a[1].wins / (a[1].wins + a[1].losses) || 0))[0];
  
  if (bestMomentum) {
    patterns.push(`Best momentum: ${bestMomentum[0]} (${bestMomentum[1].wins}W-${bestMomentum[1].losses}L)`);
  }
  
  learnings.patterns = patterns.slice(0, 5);
  
  if (patterns.length > 0) {
    log(`📋 PATTERNS: ${patterns.join(' | ')}`, 'PATTERN');
  }
}

// Get current adaptive config
function getAdaptiveConfig() {
  const config = { ...DEFAULT_CONFIG };
  const learnings = state.learnings;
  
  config.TAKE_PROFIT = learnings.optimalTP;
  config.STOP_LOSS = learnings.optimalSL;
  config.MAX_TRADE_SIZE_PCT = 0.10 * learnings.positionSizeMultiplier;
  
  // Cap at reasonable values
  config.MAX_TRADE_SIZE_PCT = Math.min(0.15, Math.max(0.03, config.MAX_TRADE_SIZE_PCT));
  
  return config;
}

// Execute buy with learning
async function executeBuy(coin) {
  const now = Date.now();
  const config = getAdaptiveConfig();
  const learnings = state.learnings;
  
  // Check mode
  currentMode = getMode();
  if (currentMode === 'stop') {
    return; // Trading paused
  }
  
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
  
  // Skip if confidence too low and it's a new coin
  const coinStats = learnings.coinPerformance[coin.symbol];
  if (!coinStats && learnings.confidence.coinSelection < 0.3) {
    log(`⏭️ Skipping ${coin.symbol} - low confidence for new coin`, 'INFO');
    return;
  }
  
  const tradeSize = state.capital * config.MAX_TRADE_SIZE_PCT;
  
  log(`🟢 BUY ${coin.symbol} | $${tradeSize.toFixed(2)} | TP: ${(config.TAKE_PROFIT*100).toFixed(0)}% | SL: ${(config.STOP_LOSS*100).toFixed(0)}% | Conf: ${(learnings.confidence.coinSelection*100).toFixed(0)}%`, 'BUY');
  
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
    config: { tp: config.TAKE_PROFIT, sl: config.STOP_LOSS, sizeMult: learnings.positionSizeMultiplier }
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
    const winRate = ((state.wonTrades / (state.wonTrades + state.lostTrades)) * 100).toFixed(0);
    log(`💰 Capital: $${state.capital.toFixed(2)} | Win Rate: ${winRate}% | ${learnings.patterns.join(' | ')}`, 'INFO');
    saveState();
  }
}

function saveState() {
  fs.writeFileSync('./state-learning.json', JSON.stringify(state, null, 2));
}

function loadState() {
  try {
    const data = fs.readFileSync('./state-learning.json', 'utf8');
    const loaded = JSON.parse(data);
    state = { ...state, ...loaded };
    log(`Loaded: $${state.capital.toFixed(2)} | ${state.wonTrades}W-${state.lostTrades}L | ${state.learnings.totalTrades} learned`, 'INFO');
  } catch (e) {
    log('Starting fresh with enhanced learning', 'INFO');
  }
}

async function main() {
  log('🧠 JUPITER BOT v9 - ADVANCED LEARNING', 'INFO');
  
  wallet = Keypair.fromSecretKey(new Uint8Array(PRIVATE_KEY));
  connection = new Connection(SOLANA_RPC);
  
  loadState();
  
  await sendTelegram(`🧠 Bot v9 Started!\nCapital: $${state.capital.toFixed(2)}\nLearning: ${state.learnings.totalTrades} trades\nAdjusting based on past performance`);
  
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
  
  // Print learning status
  setInterval(() => {
    const l = state.learnings;
    currentMode = getMode();
    const modeLabel = currentMode === 'stop' ? '⏹️ STOPPED' : currentMode === 'live' ? '🔴 LIVE' : '🟡 PRACTICE';
    log(`📊 Status: ${modeLabel} | $${state.capital.toFixed(2)} | ${l.totalTrades} trades | TP: ${(l.optimalTP*100).toFixed(0)}% | SL: ${(l.optimalSL*100).toFixed(0)}%`, 'INFO');
  }, 300000);
  
  log(`Bot running. Capital: $${state.capital.toFixed(2)}`, 'INFO');
}

main();
