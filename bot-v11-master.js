#!/usr/bin/env node
/**
 * JUPITER BOT v11 - MASTER EDITION
 * Advanced features: Whale Tracking, Multi-Signal Entry, Token Discovery,
 *                    Backtesting, Kelly Position Sizing
 */

const { Connection, Keypair, PublicKey } = require('@solana/web3.js');
const axios = require('axios');
const fs = require('fs');

// ===== CONFIG =====
const PRIVATE_KEY = [251,29,114,181,142,96,158,60,191,29,28,215,45,235,164,89,18,76,7,86,18,196,204,45,107,2,180,123,32,26,120,179,163,137,111,217,115,32,78,114,232,19,195,235,243,114,134,190,86,39,89,168,10,43,167,105,138,213,206,226,68,208,102,225];
const SOLANA_RPC = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';
const WALLET_ADDRESS = 'C1P1GbekVtaLUnVNA6CpX2oLeJ45GFkd1t5xbixBvRgc';

// Telegram
const TELEGRAM_BOT_TOKEN = "8460832535:AAEVnaEwFl7_BEazPF6rJJz4FCgrAk6TIvs";
const TELEGRAM_CHAT_ID = "7725826486";

// ===== REVISED CONFIG - FIXED FOR EFFECTIVENESS =====
const RISK = {
  DAILY_LOSS_LIMIT: 0.05,
  MAX_POSITIONS: 3, // Reduced from 5
  TRAILING_ACTIVATION: 0.08, // Wait longer before trailing (8%)
  TRAILING_DISTANCE: 0.04, // 4% trailing distance
  PARTIAL_TAKE_LEVELS: [0.05, 0.10, 0.20], // More conservative takes
  PARTIAL_TAKE_SIZES: [0.40, 0.35, 0.25],
  KELLY_FRACTION: 0.25,
  MIN_CONFIDENCE: 0.45, // Lowered for more trades - bot needs to learn
  MIN_TREND_STRENGTH: 0.02, // Require 2%+ trend move
};

const CONFIG = {
  INITIAL_CAPITAL: 1000,
  MAX_TRADE_SIZE_PCT: 0.08, // Reduced from 0.10
  MAX_DAILY_TRADES: 5, // Increased for more learning opportunities
  MIN_MARKET_CAP: 50000,
  TAKE_PROFIT: 0.20, // Increased from 0.15
  STOP_LOSS: 0.08, // INCREASED from 0.04 - give room for volatility
  MIN_TRADE_INTERVAL: 21600000, // 6 hours between trades (reduced from 24h)
  SCAN_INTERVAL: 300000, // 5 min - reduced from 60s (was too aggressive)
  CHECK_INTERVAL: 30000,
  MIN_LIQUIDITY_USD: 50000, // Increased from 10k
  MIN_VOLUME_24H: 20000,
  // NEW: Trend filter
  REQUIRES_SOL_TREND: true,
  MIN_SOL_MOVE: 0.5, // SOL must move at least 0.5% to trade
  // NEW: Weekend protection
  ALLOW_WEEKEND_TRADING: false,
  // NEW: Trading hours (9am-9pm PST = 17:00-05:00 UTC next day)
  TRADING_START_UTC: 17,
  TRADING_END_UTC: 5,
  // NEW: Position age limit (hours)
  MAX_POSITION_AGE_HOURS: 48,
  // NEW: Panic threshold (exit all if SOL drops this much)
  PANIC_SOL_DROP: -8,
};

// Known whale wallets to track
const WHALE_WALLETS = [
  'GqR7jX4eF7K2R8vN9pQ3wY6xA4kJ0mL3dF5hH8pS2tU', // Example whales
  '7xLk17H4kB7vN2pR9qW4xY3mF6jK0pL8dH5tG2sV9',
  // Add more whale addresses
];

// ===== STATE =====
let connection, wallet;
let lastTradeTime = 0;
let dailyTradeCount = 0;
let dailyLoss = 0;
let lastResetDate = new Date().toDateString();
let priceHistory = {}; // For RSI calculation
let whaleAlertCooldowns = {};

// ===== UTILITIES =====
function getMode() {
  try { return JSON.parse(fs.readFileSync('./bot-mode.json', 'utf8')).mode || 'practice'; }
  catch (e) { return 'practice'; }
}

function getStateFile() {
  return getMode() === 'live' ? './state-live.json' : './state-practice.json';
}

function loadState() {
  try { return JSON.parse(fs.readFileSync(getStateFile(), 'utf8')); }
  catch (e) { return { capital: CONFIG.INITIAL_CAPITAL, positions: [], trades: [], wonTrades: 0, lostTrades: 0, totalPnl: 0 }; }
}

function saveState(state) {
  fs.writeFileSync(getStateFile(), JSON.stringify(state, null, 2));
}

function log(msg, type = 'INFO') {
  const colors = { INFO: '\x1b[36m', BUY: '\x1b[32m', SELL: '\x1b[33m', ERROR: '\x1b[31m', SUCCESS: '\x1b[32m', SCAN: '\x1b[35m', WHALE: '\x1b[34m', SIGNAL: '\x1b[32m' };
  const prefix = getMode() === 'live' ? '🔴' : '🟡';
  console.log(`${colors[type]||''}[${new Date().toLocaleTimeString()}] ${prefix} ${msg}\x1b[0m`);
}

async function sendTelegram(msg) {
  const prefix = getMode() === 'live' ? '🔴 LIVE: ' : '🟡 PRACTICE: ';
  try { await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, { chat_id: TELEGRAM_CHAT_ID, text: prefix + msg, parse_mode: 'HTML' }); }
  catch (e) { log('Telegram failed: ' + e.message, 'ERROR'); }
}

// ===== KELLY CRITERION POSITION SIZING =====
function calculateKellySize(winRate, avgWin, avgLoss) {
  const winLossRatio = avgWin / avgLoss;
  const kelly = (winRate * winLossRatio - (1 - winRate)) / winLossRatio;
  const optimal = Math.max(0, Math.min(kelly * RISK.KELLY_FRACTION, RISK.MAX_TRADE_SIZE_PCT));
  return optimal;
}

function getPositionSize(confidence, state) {
  // Conservative: max 5% of capital per trade in practice mode
  const maxPositionPct = 0.05;
  const baseSize = state.capital * maxPositionPct;
  
  // Adjust based on confidence (0-1), but cap at 5%
  const sizedPosition = baseSize * Math.max(confidence, 0.3);
  
  // Never exceed 10% of capital
  return Math.min(sizedPosition, state.capital * 0.10);
}

// ===== PRICE FETCHING (with cache) =====
let priceCache = { prices: {}, timestamp: 0 };
const PRICE_CACHE_TTL = 60000; // 1 minute cache

async function getPrices() {
  const now = Date.now();
  
  // Return cached prices if fresh
  if (priceCache.prices && now - priceCache.timestamp < PRICE_CACHE_TTL) {
    return priceCache.prices;
  }
  
  const prices = {};
  const tokens = [
    { id: 'solana', sym: 'SOL' },
    { id: 'wif', sym: 'WIF' },
    { id: 'bonk', sym: 'BONK' },
    { id: 'pepe', sym: 'PEPE' },
    { id: 'popcat', sym: 'POPCAT' },
    { id: 'dogecoin', sym: 'DOGE' },
    { id: 'ethereum', sym: 'ETH' },
    { id: 'bitcoin', sym: 'BTC' },
    { id: 'toncoin', sym: 'TON' },
    { id: 'sui', sym: 'SUI' },
  ];
  
  try {
    const ids = tokens.map(t => t.id).join(',');
    const res = await axios.get(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`, { timeout: 8000 });
    if (res.data) {
      for (const t of tokens) {
        if (res.data[t.id]) {
          prices[t.sym] = { 
            price: res.data[t.id].usd, 
            change24h: res.data[t.id].usd_24h_change || 0 
          };
        }
      }
    }
  } catch (e) {
    // Return cached if API fails
    return priceCache.prices || {};
  }
  
  // Update cache
  priceCache = { prices, timestamp: now };
  return prices;
}

// ===== TECHNICAL INDICATORS =====
function calculateRSI(prices, period = 14) {
  if (prices.length < period + 1) return 50;
  
  let gains = 0, losses = 0;
  for (let i = prices.length - period; i < prices.length; i++) {
    const change = prices[i] - prices[i-1];
    if (change > 0) gains += change;
    else losses -= change;
  }
  
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function calculateEMA(prices, period = 20) {
  if (prices.length < period) return prices[prices.length - 1];
  const multiplier = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((a, b) => a + b) / period;
  for (let i = period; i < prices.length; i++) {
    ema = (prices[i] - ema) * multiplier + ema;
  }
  return ema;
}

function calculateATR(prices, period = 14) {
  if (prices.length < period + 1) return prices[prices.length - 1] * 0.02; // Default 2%
  
  let atr = 0;
  const trueRanges = [];
  
  for (let i = 1; i < prices.length; i++) {
    const high = prices[i];
    const low = prices[i - 1];
    const tr = high - low;
    trueRanges.push(tr);
  }
  
  if (trueRanges.length >= period) {
    const recentTR = trueRanges.slice(-period);
    atr = recentTR.reduce((a, b) => a + b, 0) / period;
  } else {
    atr = trueRanges.reduce((a, b) => a + b, 0) / trueRanges.length;
  }
  
  return atr;
}

function calculateMACD(prices) {
  if (prices.length < 26) return { macd: 0, signal: 0, histogram: 0 };
  
  const ema12 = calculateEMA(prices, 12);
  const ema26 = calculateEMA(prices, 26);
  const macd = ema12 - ema26;
  
  // Signal line (EMA 9 of MACD) - simplified
  const signal = macd * 0.9;
  
  return {
    macd,
    signal,
    histogram: macd - signal
  };
}

function calculateVolumeRatio(currentVol, avgVol) {
  return currentVol / avgVol;
}

// Check if trading during active hours (9am-9pm PST = 5pm-5am UTC)
function isActiveTradingHours() {
  const utcHour = new Date().getUTCHours();
  const isWeekend = [0, 6].includes(new Date().getDay());
  
  if (CONFIG.ALLOW_WEEKEND_TRADING === false && isWeekend) {
    log('🛑 Weekend trading disabled', 'INFO');
    return false;
  }
  
  // Handle wraparound (17:00 UTC to 05:00 UTC next day)
  if (CONFIG.TRADING_START_UTC > CONFIG.TRADING_END_UTC) {
    // Active during evening/night (e.g., 17:00-05:00)
    if (utcHour >= CONFIG.TRADING_START_UTC || utcHour < CONFIG.TRADING_END_UTC) {
      return true;
    }
  } else {
    // Active during day
    if (utcHour >= CONFIG.TRADING_START_UTC && utcHour < CONFIG.TRADING_END_UTC) {
      return true;
    }
  }
  
  log(`🕐 Outside trading hours (UTC: ${utcHour})`, 'INFO');
  return false;
}

// Check if position is too old
function isPositionTooOld(entryTime) {
  const hoursOld = (Date.now() - entryTime) / (1000 * 60 * 60);
  return hoursOld > CONFIG.MAX_POSITION_AGE_HOURS;
}

// Check if market is panicking (SOL dropping fast)
async function checkPanic(prices) {
  const solChange = prices['SOL']?.change24h || 0;
  if (solChange <= CONFIG.PANIC_SOL_DROP) {
    log(`🛑 PANIC: SOL down ${solChange.toFixed(1)}% - consider exiting all positions!`, 'ERROR');
    return true;
  }
  return false;
}

// Better exit signal detection
async function shouldExitPosition(pos, prices) {
  const currentPrice = prices[pos.symbol]?.price;
  if (!currentPrice) return false;
  
  const pnlPct = (currentPrice - pos.entryPrice) / pos.entryPrice;
  
  // Get token price history for indicators
  if (!priceHistory[pos.symbol]) priceHistory[pos.symbol] = [];
  const pricesArr = priceHistory[pos.symbol];
  
  // Add current price
  if (pricesArr.length === 0 || pricesArr[pricesArr.length - 1] !== currentPrice) {
    pricesArr.push(currentPrice);
    if (pricesArr.length > 50) pricesArr.shift();
  }
  
  if (pricesArr.length < 10) return false;
  
  const rsi = calculateRSI(pricesArr);
  const macd = calculateMACD(pricesArr);
  
  // Exit signals:
  // 1. RSI overbought (>75) + negative RSI divergence
  // 2. MACD turning bearish
  // 3. Price dropping below EMA
  
  const current = pricesArr[pricesArr.length - 1];
  const ema = calculateEMA(pricesArr, 20);
  
  // If price falls below EMA significantly, exit
  if (current < ema * 0.98) {
    return { exit: true, reason: 'Price below EMA20' };
  }
  
  // If RSI overbought and MACD bearish
  if (rsi > 70 && macd.histogram < 0 && pnlPct > 0) {
    return { exit: true, reason: `RSI overbought (${rsi.toFixed(0)}) + MACD bearish` };
  }
  
  return { exit: false };
}

// Check market correlation - don't hold multiple correlated alts
function checkCorrelation(positions, newSymbol) {
  const corrGroups = {
    'SOL': ['WIF', 'BONK', 'PEPE', 'POPCAT', 'MEW', 'GOAT'],
    'BTC': ['ETH', 'SOL'],
  };
  
  for (const pos of positions) {
    for (const [base, alts] of Object.entries(corrGroups)) {
      if ((newSymbol === base && alts.includes(pos.symbol)) ||
          (pos.symbol === base && alts.includes(newSymbol)) ||
          (alts.includes(newSymbol) && alts.includes(pos.symbol))) {
        return false; // Would be too correlated
      }
    }
  }
  return true;
}

// ===== MULTI-SIGNAL ENTRY - TREND FOLLOWING APPROACH =====
async function analyzeSignal(token, opportunityData = {}, prices = {}, marketTrend = {}) {
  const signals = {
    rsi: 50,
    trend: 0,
    volume: 0,
    score: 0,
    confidence: 0,
    macd: 0,
    atr: 0,
    stopLoss: 0,
  };
  
  // Get price history
  if (!priceHistory[token]) priceHistory[token] = [];
  const pricesArr = priceHistory[token];
  
  // Try to fetch historical candles
  try {
    const days = pricesArr.length < 20 ? 7 : 1;
    const cgId = token.toLowerCase();
    const res = await axios.get(`https://api.coingecko.com/api/v3/coins/${cgId}/ohlc?vs_currency=usd&days=${days}`, { 
      timeout: 10000 
    });
    
    if (res.data && Array.isArray(res.data)) {
      const ohlcPrices = res.data.map(c => c[4]);
      for (const price of ohlcPrices) {
        if (!pricesArr.includes(price)) {
          pricesArr.push(price);
        }
      }
      if (pricesArr.length > 100) {
        priceHistory[token] = pricesArr.slice(-100);
      }
    }
  } catch (e) {}
  
  // Add current price
  try {
    const res = await axios.get(`https://api.coingecko.com/api/v3/simple/price?ids=${token.toLowerCase()}&vs_currencies=usd&include_24hr_change=true`, { timeout: 5000 });
    if (res.data?.[token.toLowerCase()]?.usd) {
      const currentPrice = res.data[token.toLowerCase()].usd;
      if (pricesArr.length === 0 || pricesArr[pricesArr.length - 1] !== currentPrice) {
        pricesArr.push(currentPrice);
        if (pricesArr.length > 100) pricesArr.shift();
      }
    }
  } catch (e) {}
  
  const currentPrice = pricesArr[pricesArr.length - 1];
  if (!currentPrice) return signals;
  
  // ==== REVISED SCORING - TREND FOLLOWING, NOT CONTRARIAN ====
  
  // 1. PRICE MOMENTUM (most important) - price must be rising
  const change24h = opportunityData.change24h || 0;
  if (change24h > 5 && change24h < 25) signals.score += 40; // Strong upward momentum
  else if (change24h > 2 && change24h <= 5) signals.score += 25;
  else if (change24h > 0 && change24h <= 2) signals.score += 10;
  else if (change24h <= 0) {
    // NO POINTS FOR NEGATIVE - trend following!
    signals.score -= 30; 
  }
  
  // 2. RSI - NOT oversold, moderate is fine
  signals.rsi = calculateRSI(pricesArr);
  if (signals.rsi >= 40 && signals.rsi <= 65) signals.score += 25; // Sweet spot
  else if (signals.rsi >= 30 && signals.rsi < 40) signals.score += 10; // Slightly oversold OK if trend is strong
  else if (signals.rsi > 65) signals.score -= 20; // Overbought - risky
  else if (signals.rsi < 30) signals.score -= 40; // Deep oversold = catching falling knife
  
  // 3. EMA TREND - must be above EMA for long
  if (pricesArr.length > 20) {
    const ema = calculateEMA(pricesArr);
    const current = pricesArr[pricesArr.length - 1];
    signals.trend = (current - ema) / ema;
    if (signals.trend > 0.02) signals.score += 30; // Strong above EMA
    else if (signals.trend > 0) signals.score += 15;
    else if (signals.trend < -0.02) signals.score -= 30; // Below EMA = downtrend
    else signals.score -= 10;
  }
  
  // 4. MACD - must be bullish
  const macdData = calculateMACD(pricesArr);
  signals.macd = macdData.histogram;
  if (macdData.histogram > 0.001) signals.score += 20;
  else if (macdData.histogram > 0) signals.score += 10;
  else signals.score -= 20;
  
  // 5. Volume confirmation
  if (opportunityData.volume24h) {
    if (opportunityData.volume24h > 1000000) signals.score += 20;
    else if (opportunityData.volume24h > 500000) signals.score += 15;
    else if (opportunityData.volume24h > 100000) signals.score += 10;
  }
  
  // 6. Liquidity check
  if (opportunityData.liquidity) {
    if (opportunityData.liquidity > 50000000) signals.score += 15;
    else if (opportunityData.liquidity > 10000000) signals.score += 10;
    else if (opportunityData.liquidity > 1000000) signals.score += 5;
    else signals.score -= 20;
  }
  
  // 7. MARKET ALIGNMENT - CRITICAL
  // Only trade if SOL is also moving up
  const solChange = prices['SOL']?.change24h || 0;
  if (solChange > CONFIG.MIN_SOL_MOVE && change24h > 0) {
    signals.score += 25; // Align with market
  } else if (solChange < -CONFIG.MIN_SOL_MOVE) {
    signals.score -= 40; // Fighting the market - NO
  } else if (Math.abs(solChange) < 0.5) {
    signals.score -= 10; // Market is flat
  }
  
  // 8. ATR-based stop loss
  signals.atr = calculateATR(pricesArr);
  const atrValue = isNaN(signals.atr) ? currentPrice * 0.03 : signals.atr;
  signals.stopLoss = currentPrice * (1 - atrValue * 2); // 2x ATR stop = wider
  
  // Base score adjustment
  signals.score += 10;
  
  // Calculate confidence (0-1)
  signals.confidence = Math.min(Math.max(signals.score / 100, 0), 1);
  
  return signals;
}

// ===== WHALE TRACKING =====
async function checkWhaleMovements() {
  const alerts = [];
  const now = Date.now();
  
  // Skip if recently checked (cache for 5 min)
  if (checkWhaleMovements.lastCheck && now - checkWhaleMovements.lastCheck < 300000) {
    return alerts;
  }
  checkWhaleMovements.lastCheck = now;
  
  for (const whale of WHALE_WALLETS) {
    if (whaleAlertCooldowns[whale] && now - whaleAlertCooldowns[whale] < 3600000) continue;
    
    // Skip if whale address looks invalid
    if (!whale || whale.length < 32) continue;
    
    try {
      // Check recent transactions
      const res = await axios.get(`https://api.solscan.io/account/transactions?address=${whale}&limit=5`, { timeout: 5000 });
      
      if (res.data?.data) {
        for (const tx of res.data.data) {
          const amount = tx.solana?.transfer?.amount || 0;
          if (amount > 10) { // >10 SOL
            alerts.push({ whale: whale.slice(0, 8), amount, time: tx.blockTime });
            whaleAlertCooldowns[whale] = now;
          }
        }
      }
    } catch (e) {
      // Whale API unavailable, skip silently
    }
  }
  
  if (alerts.length > 0) {
    log(`🐋 Whale alert: ${alerts.length} large movements detected`, 'WHALE');
    await sendTelegram(`🐋 WHALE ALERT: ${alerts.length} large movements detected`);
  }
  
  return alerts;
}

// ===== TOKEN DISCOVERY - HIGH QUALITY ONLY =====
let lastTokenDiscovery = 0;
let cachedOpportunities = [];
const TOKEN_DISCOVERY_COOLDOWN = 600000; // 10 min cooldown (increased)

async function discoverNewTokens(prices = {}) {
  const now = Date.now();
  
  // Return cached if valid
  if (cachedOpportunities.length > 0 && now - lastTokenDiscovery < TOKEN_DISCOVERY_COOLDOWN) {
    return cachedOpportunities;
  }
  
  // Still in cooldown
  if (now - lastTokenDiscovery < TOKEN_DISCOVERY_COOLDOWN) {
    return [];
  }
  
  lastTokenDiscovery = now;
  
  const opportunities = [];
  
  // Reduced token list - only high quality
  const tokenList = [
    { symbol: 'WIF', id: 'wif' },
    { symbol: 'BONK', id: 'bonk' },
    { symbol: 'PEPE', id: 'pepe' },
    { symbol: 'POPCAT', id: 'popcat' },
    { symbol: 'SOL', id: 'solana' },
    { symbol: 'DOGE', id: 'dogecoin' },
  ];
  
  // FIRST: Check SOL trend - don't trade if SOL isn't moving
  const solPrice = prices['SOL'];
  if (!solPrice || Math.abs(solPrice.change24h || 0) < CONFIG.MIN_SOL_MOVE) {
    log(`🌊 SOL trend weak (${solPrice?.change24h?.toFixed(1)}%), skipping scan`, 'INFO');
    cachedOpportunities = [];
    return [];
  }
  
  try {
    log('📡 Scanning for high-momentum tokens...', 'INFO');
    const ids = tokenList.map(t => t.id).join(',');
    const cgRes = await axios.get(`https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${ids}&order=market_cap_desc&per_page=20&page=1&sparkline=false&price_change_percentage=24h`, { 
      timeout: 10000 
    });
    
    if (cgRes.data) {
      log(`📊 Analyzed ${cgRes.data.length} tokens`, 'INFO');
      for (const token of cgRes.data) {
        const change24h = token.price_change_percentage_24h || 0;
        
        // STRICT FILTERS - only momentum plays
        if (change24h < 2) continue; // Must have 2%+ momentum
        
        const tok = {
          address: token.id,
          symbol: token.symbol.toUpperCase(),
          price: token.current_price,
          liquidity: token.market_cap || 0,
          volume24h: token.total_volume || 0,
          change24h: change24h,
          score: 0,
        };
        
        // Score based on momentum (only positive!)
        if (tok.change24h > 15 && tok.change24h < 40) tok.score += 50;
        else if (tok.change24h > 10 && tok.change24h <= 15) tok.score += 40;
        else if (tok.change24h > 5 && tok.change24h <= 10) tok.score += 30;
        else if (tok.change24h >= 2 && tok.change24h <= 5) tok.score += 20;
        
        // Liquidity requirements
        if (tok.liquidity > 50000000) tok.score += 30;
        else if (tok.liquidity > 10000000) tok.score += 20;
        else if (tok.liquidity > 1000000) tok.score += 10;
        else continue; // Skip low liquidity
        
        // Volume requirements
        if (tok.volume24h > 5000000) tok.score += 20;
        else if (tok.volume24h > 1000000) tok.score += 10;
        
        // Only accept high scores
        if (tok.score >= 60) opportunities.push(tok);
      }
    }
  } catch (e) {
    log('Token API error, using cached', 'INFO');
    lastTokenDiscovery = now; // Retry soon
    return [];
  }
  
  if (opportunities.length > 0) {
    log(`🚀 Found ${opportunities.length} quality opportunities`, 'SCAN');
    opportunities.sort((a, b) => b.score - a.score);
    cachedOpportunities = opportunities.slice(0, 3); // Max 3
    return cachedOpportunities;
  }
  
  cachedOpportunities = [];
  log('📊 No quality opportunities found', 'INFO');
  return [];
}

// ===== BACKTESTING =====
async function backtestStrategy(days = 30) {
  log(`📊 Running backtest for last ${days} days...`, 'INFO');
  
  // This would fetch historical data and simulate trades
  // For now, we'll use a simplified version
  const results = {
    totalTrades: 0,
    winRate: 0,
    avgWin: 0,
    avgLoss: 0,
    profitFactor: 0,
    maxDrawdown: 0,
  };
  
  // Simulated results (would need real historical data)
  const state = loadState();
  if (state.trades?.length > 0) {
    const wins = state.trades.filter(t => t.pnl > 0);
    const losses = state.trades.filter(t => t.pnl < 0);
    results.totalTrades = state.trades.length;
    results.winRate = wins.length / results.totalTrades;
    results.avgWin = wins.reduce((a, t) => a + t.pnl, 0) / wins.length;
    results.avgLoss = Math.abs(losses.reduce((a, t) => a + t.pnl, 0) / losses.length);
    results.profitFactor = results.avgWin / results.avgLoss;
  }
  
  log(`📊 Backtest: ${results.winRate.toFixed(1)}% win rate, ${results.profitFactor.toFixed(2)} profit factor`, 'INFO');
  return results;
}

// ===== TRADING LOGIC =====
async function executeTrade(action, token, amount, price, state, atrStopLoss = null) {
  const mode = getMode();
  if (mode !== 'live') {
    // Paper trade
    if (action === 'buy') {
      // Use ATR-based stop or default
      const stopLoss = atrStopLoss || (price * (1 - CONFIG.STOP_LOSS));
      
      state.positions.push({
        symbol: token,
        entryPrice: price,
        amount: amount,
        entryTime: Date.now(),
        trailingStop: stopLoss,
        takeProfitLevels: RISK.PARTIAL_TAKE_LEVELS.map(l => price * (1 + l)),
        atrStop: atrStopLoss, // Store ATR stop separately
      });
    } else if (action === 'sell') {
      const posIndex = state.positions.findIndex(p => p.symbol === token);
      if (posIndex >= 0) {
        const pos = state.positions[posIndex];
        const pnl = (price - pos.entryPrice) * amount;
        state.trades.push({
          symbol: token,
          pnl: pnl,
          entryPrice: pos.entryPrice,
          exitPrice: price,
          entryTime: pos.entryTime,
          exitTime: Date.now(),
        });
        
        if (pnl > 0) state.wonTrades++;
        else state.lostTrades++;
        state.totalPnl += pnl;
        
        state.positions.splice(posIndex, 1);
      }
    }
    saveState(state);
  }
}

async function checkPositions(state, prices) {
  const now = Date.now();
  
  // Defensive: ensure positions array exists
  if (!state || !state.positions) {
    if (state) state.positions = [];
    return;
  }
  
  // Check panic
  const isPanic = await checkPanic(prices);
  
  for (let i = state.positions.length - 1; i >= 0; i--) {
    const pos = state.positions[i];
    
    // Skip invalid positions
    if (!pos || !pos.symbol || !pos.entryPrice) continue;
    
    const currentPrice = prices[pos.symbol]?.price || pos.entryPrice;
    const pnlPct = (currentPrice - pos.entryPrice) / pos.entryPrice;
    
    // Initialize take profit levels if not present (legacy positions)
    if (!pos.takeProfitLevels || !Array.isArray(pos.takeProfitLevels)) {
      pos.takeProfitLevels = (RISK.PARTIAL_TAKE_LEVELS || [0.05, 0.10, 0.15]).map(l => pos.entryPrice * (1 + l));
      pos.partialsTaken = [];
      pos.trailingStop = pos.entryPrice * (1 - (RISK.TRAILING_ACTIVATION || 0.08));
    }
    
    // ==== POSITION AGE CHECK - Exit if too old without profit ====
    if (isPositionTooOld(pos.entryTime) && pnlPct < 0) {
      log(`⏰ Position age limit: ${pos.symbol} held ${CONFIG.MAX_POSITION_AGE_HOURS}h without profit - exiting`, 'SELL');
      await sendTelegram(`⏰ TIME EXIT: ${pos.symbol} after ${CONFIG.MAX_POSITION_AGE_HOURS}h no profit`);
      await executeTrade('sell', pos.symbol, pos.amount, currentPrice, state);
      continue;
    }
    
    // ==== BETTER EXIT SIGNALS ====
    const exitSignal = await shouldExitPosition(pos, prices);
    if (exitSignal.exit && pnlPct > 0) {
      log(`📊 Exit signal: ${pos.symbol} (${exitSignal.reason}) at +${(pnlPct*100).toFixed(1)}%`, 'SELL');
      await sendTelegram(`📊 EXIT SIGNAL: ${pos.symbol} at +${(pnlPct*100).toFixed(1)}%\nReason: ${exitSignal.reason}`);
      await executeTrade('sell', pos.symbol, pos.amount, currentPrice, state);
      continue;
    }
    
    // ==== Stop loss (ATR-based if available, otherwise fixed) ====
    const useAtrStop = pos.atrStop && pnlPct < 0;
    const stopThreshold = useAtrStop ? ((currentPrice - pos.atrStop) / pos.atrStop) : -CONFIG.STOP_LOSS;
    
    if (pnlPct <= stopThreshold) {
      const stopType = useAtrStop ? 'ATR' : 'Fixed';
      log(`🛑 ${stopType} Stop loss triggered: ${pos.symbol} at ${(pnlPct*100).toFixed(1)}%`, 'SELL');
      await sendTelegram(`🛑 STOP LOSS: ${pos.symbol} at ${(pnlPct*100).toFixed(1)}%`);
      await executeTrade('sell', pos.symbol, pos.amount, currentPrice, state);
      continue;
    }
    
    // ==== Position Scaling (Pyramiding) - DISABLED for safety ====
    // Only add to winning positions, and only once
    // if (!pos.scaled && pnlPct >= 0.03 && pnlPct <= 0.05 && state.positions?.length < RISK.MAX_POSITIONS) { ... }
    
    // Take profit levels (partial)
    if (pos.takeProfitLevels && Array.isArray(pos.takeProfitLevels)) {
      for (let j = 0; j < pos.takeProfitLevels.length; j++) {
        if (!pos.partialsTaken?.includes(j) && currentPrice >= pos.takeProfitLevels[j]) {
          const takeSizes = RISK.PARTIAL_TAKE_SIZES || [0.40, 0.35, 0.25];
          const sellAmount = pos.amount * (takeSizes[j] || 0.40);
          log(`📊 Take profit ${j+1}: ${pos.symbol} at ${(pnlPct*100).toFixed(1)}%`, 'SELL');
          await executeTrade('sell', pos.symbol, sellAmount, currentPrice, state);
          pos.partialsTaken = pos.partialsTaken || [];
          pos.partialsTaken.push(j);
          pos.amount -= sellAmount;
          
          // If all sold, remove position
          if (pos.amount <= 0) {
            state.positions.splice(i, 1);
          }
        }
      }
    }
    
    // Trailing stop
    if (pnlPct >= RISK.TRAILING_ACTIVATION) {
      const newTrailing = currentPrice * (1 - RISK.TRAILING_DISTANCE);
      if (newTrailing > pos.trailingStop) {
        pos.trailingStop = newTrailing;
      }
    }
    
    // Activate trailing stop
    if (pos.trailingStop && pnlPct >= (RISK.TRAILING_ACTIVATION || 0.08) && currentPrice <= pos.trailingStop) {
      log(`🐢 Trailing stop hit: ${pos.symbol}`, 'SELL');
      await executeTrade('sell', pos.symbol, pos.amount, currentPrice, state);
    }
  }
  
  saveState(state);
}

async function scanAndTrade() {
  const mode = getMode();
  if (mode === 'stop') {
    log('Bot stopped', 'INFO');
    return;
  }
  
  log('🔍 Starting scan...', 'INFO');
  
  // NEW: Check trading hours
  if (!isActiveTradingHours()) {
    log('⏰ Outside trading hours - checking positions only', 'INFO');
    const state = loadState();
    const prices = await getPrices();
    await checkPositions(state, prices);
    return;
  }
  
  // Daily reset
  if (new Date().toDateString() !== lastResetDate) {
    dailyTradeCount = 0;
    dailyLoss = 0;
    lastResetDate = new Date().toDateString();
    log('📅 New day - trade counter reset', 'INFO');
  }
  
  // Check loss limit
  if (dailyLoss >= CONFIG.INITIAL_CAPITAL * RISK.DAILY_LOSS_LIMIT) {
    log('🚫 Daily loss limit reached, stopping for today', 'ERROR');
    return;
  }
  
  // STRICT: Check daily trade limit
  if (dailyTradeCount >= CONFIG.MAX_DAILY_TRADES) {
    log(`🚫 Daily trade limit (${CONFIG.MAX_DAILY_TRADES}) reached`, 'INFO');
    // Still check positions but don't enter new trades
  }
  
  const state = loadState();
  if (state.positions?.length >= RISK.MAX_POSITIONS) {
    log('Max positions reached', 'INFO');
    return;
  }
  
  const prices = await getPrices();
  
  // Check SOL trend first - don't trade if market is flat
  const solChange = prices['SOL']?.change24h || 0;
  if (Math.abs(solChange) < CONFIG.MIN_SOL_MOVE) {
    log(`🌊 SOL flat (${solChange.toFixed(1)}%), market conditions poor - skipping`, 'INFO');
    await checkPositions(state, prices);
    return;
  }
  
  // Check existing positions
  await checkPositions(state, prices);
  
  // Calculate portfolio value
  let portfolioValue = state.capital;
  let positionInfo = [];
  
  if (state.positions?.length > 0) {
    for (const pos of state.positions) {
      const currentPrice = prices[pos.symbol]?.price || pos.entryPrice;
      const positionValue = pos.amount * currentPrice;
      const pnlPct = ((currentPrice - pos.entryPrice) / pos.entryPrice) * 100;
      portfolioValue += positionValue;
      positionInfo.push({ symbol: pos.symbol, value: positionValue, pnlPct });
    }
    
    // Build visual chart
    let chart = '📊 Positions:\n';
    const maxBarWidth = 20;
    const maxValue = Math.max(...positionInfo.map(p => p.value));
    
    for (const pos of positionInfo) {
      const barLen = Math.round((pos.value / maxValue) * maxBarWidth);
      const bar = '█'.repeat(barLen);
      const pnlEmoji = pos.pnlPct >= 0 ? '🟢' : '🔴';
      chart += `  ${pos.symbol.padEnd(6)} ${pnlEmoji} ${pos.pnlPct >= 0 ? '+' : ''}${pos.pnlPct.toFixed(1)}% ${bar} $${pos.value.toFixed(0)}\n`;
    }
    
    log(chart.trim(), 'INFO');
    log(`💼 Portfolio: $${portfolioValue.toFixed(2)} | Cash: $${state.capital.toFixed(2)}`, 'INFO');
  } else {
    log(`💼 Cash: $${state.capital.toFixed(2)} | No positions`, 'INFO');
  }
  
  // ===== NEW TRADE ENTRY: STRICT CONDITIONS =====
  
  // 1. Check trade limits
  if (dailyTradeCount >= CONFIG.MAX_DAILY_TRADES) {
    log(`✅ Daily limit reached - no new trades today`, 'INFO');
  } else if (state.positions?.length >= RISK.MAX_POSITIONS) {
    log(`✅ Max positions (${RISK.MAX_POSITIONS}) reached`, 'INFO');
  } else {
    // 2. Check minimum time since last trade
    const timeSinceLastTrade = Date.now() - lastTradeTime;
    if (timeSinceLastTrade < CONFIG.MIN_TRADE_INTERVAL) {
      const minsWaiting = Math.round(timeSinceLastTrade / 60000);
      const minsRequired = Math.round(CONFIG.MIN_TRADE_INTERVAL / 60000);
      log(`⏳ Cooldown: ${minsWaiting}/${minsRequired} min - waiting for next opportunity`, 'INFO');
    } else {
      // 3. Discover opportunities
      const opportunities = await discoverNewTokens(prices);
      
      for (const token of opportunities) {
        // Skip if we already have this position
        if (state.positions?.find(p => p.symbol === token.symbol)) continue;
        
        // Get market trend
        const marketTrend = {
          solPositive: prices['SOL']?.change24h > 0
        };
        
        // Analyze signal
        const signals = await analyzeSignal(token.symbol, token, prices, marketTrend);
        
        log(`📊 ${token.symbol}: conf=${(signals.confidence*100).toFixed(0)}%, RSI=${signals.rsi.toFixed(0)}, score=${signals.score}`, 'INFO');
        
        // STRICT: Only trade if confidence is HIGH
        if (signals.confidence >= RISK.MIN_CONFIDENCE) {
          const positionSize = getPositionSize(signals.confidence, state);
          const solPrice = prices['SOL']?.price || 90;
          const tokenAmount = positionSize / token.price;
          
          log(`🎯 STRONG SIGNAL: ${token.symbol} (confidence: ${(signals.confidence*100).toFixed(0)}%, stop: $${signals.stopLoss.toFixed(6)})`, 'SIGNAL');
          await sendTelegram(`🎯 BUY SIGNAL: ${token.symbol} at $${token.price.toFixed(4)}\nConfidence: ${(signals.confidence*100).toFixed(0)}%\nRSI: ${signals.rsi.toFixed(0)}`);
          
          await executeTrade('buy', token.symbol, tokenAmount, token.price, state, signals.stopLoss);
          const positionValue = tokenAmount * token.price;
          log(`🟢 BUY: ${token.symbol} $${positionValue.toFixed(2)} @ $${token.price.toFixed(6)}`, 'BUY');
          dailyTradeCount++;
          lastTradeTime = Date.now();
          break; // Only one trade per scan
        } else {
          log(`⏭️ ${token.symbol}: Confidence too low (${(signals.confidence*100).toFixed(0)}% < ${(RISK.MIN_CONFIDENCE*100).toFixed(0)}%)`, 'INFO');
        }
      }
    }
  }
}

// ===== MAIN LOOP =====
async function main() {
  try {
    log('🚀 Jupiter Bot v11 - Master Edition starting...', 'INFO');
    
    connection = new Connection(SOLANA_RPC);
    
    // Run backtest on startup
    await backtestStrategy();
    
    // Main trading loop
    setInterval(async () => {
      try {
        await scanAndTrade();
      } catch (e) {
        log('Scan error: ' + e.message, 'ERROR');
      }
    }, CONFIG.SCAN_INTERVAL);
    
    // Run once immediately
    setTimeout(async () => {
      try {
        await scanAndTrade();
      } catch (e) {
        log('Initial scan error: ' + e.message, 'ERROR');
      }
    }, 3000);
    
    // Position check loop (more frequent)
    setInterval(async () => {
      try {
        const state = loadState();
        const prices = await getPrices();
        await checkPositions(state, prices);
      } catch (e) {
        log('Position check error: ' + e.message, 'ERROR');
      }
    }, CONFIG.CHECK_INTERVAL);
    
    log('Bot running. Mode: ' + getMode(), 'INFO');
  } catch (e) {
    log('Fatal error: ' + e.message, 'ERROR');
    process.exit(1);
  }
}

main().catch(e => {
  log('Fatal error: ' + e.message, 'ERROR');
  process.exit(1);
});
