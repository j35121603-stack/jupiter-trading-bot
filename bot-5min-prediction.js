/**
 * 5-Minute Crypto Price Prediction Bot
 * Analyzes 5-minute price movements and predicts direction
 * Practice mode until 60% win rate, then goes live
 * 
 * Run: node bot-5min-prediction.js
 */

const API_BASE = 'https://api.coingecko.com/api/v3';
const stateFile = 'state-5min-prediction.json';

// Configuration
const CONFIG = {
  mode: 'practice', // practice | live
  winRateThreshold: 0.60,
  minConfidence: 0.55,
  maxPositionSize: 0.08, // 8% of capital
  stopLoss: 0.05, // 5%
  takeProfit: 0.10, // 10%
  maxPositions: 3,
  scanInterval: 300000, // 5 minutes
};

// Top tokens to trade (using CoinGecko IDs)
const TOKENS = [
  { symbol: 'SOL', name: 'Solana', id: 'solana' },
  { symbol: 'BTC', name: 'Bitcoin', id: 'bitcoin' },
  { symbol: 'ETH', name: 'Ethereum', id: 'ethereum' },
  { symbol: 'PEPE', name: 'Pepe', id: 'pepe' },
  { symbol: 'BONK', name: 'Bonk', id: 'bonk' },
  { symbol: 'WIF', name: 'dogwifhat', id: 'dogwifhat' },
];

// State
let state = {
  capital: 1000,
  trades: [],
  positions: [],
  wonTrades: 0,
  lostTrades: 0,
  dailyTrades: 0,
  startedAt: Date.now(),
};

// Price history for 5-min predictions
const priceHistory = new Map();

// Colors
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  reset: '\x1b[0m'
};

const fs = require('fs');
const logFile = 'bot-5min-prediction.log';

function log(msg, type = 'info') {
  const timestamp = new Date().toLocaleTimeString();
  const color = type === 'buy' ? colors.green : type === 'sell' ? colors.red : type === 'alert' ? colors.yellow : colors.cyan;
  const logMsg = `${timestamp} ${msg}`;
  console.log(`${color}[${timestamp}]${colors.reset} ${msg}`);
  
  // Also write to log file
  fs.appendFileSync(logFile, `${logMsg}\n`);
}

function loadState() {
  try {
    const data = require('fs').readFileSync(stateFile, 'utf8');
    state = JSON.parse(data);
    log(`Loaded state: $${state.capital.toFixed(2)} | Win rate: ${getWinRate()}%`);
  } catch (e) {
    log('Starting fresh');
  }
}

function saveState() {
  require('fs').writeFileSync(stateFile, JSON.stringify(state, null, 2));
}

function getWinRate() {
  const total = state.wonTrades + state.lostTrades;
  if (total === 0) return 0;
  return (state.wonTrades / total * 100).toFixed(1);
}

function getPortfolioValue() {
  const positionValue = state.positions.reduce((sum, p) => sum + p.value, 0);
  return state.capital + positionValue;
}

// Technical indicators for 5-min predictions - ENHANCED VERSION
function calculateIndicators(prices) {
  if (prices.length < 10) return null;
  
  const recent = prices.slice(-10);
  const current = recent[recent.length - 1];
  const prev5 = prices[Math.max(0, prices.length - 5)];
  
  // Simple moving averages
  const sma5 = recent.reduce((a, b) => a + b, 0) / recent.length;
  const sma10 = prices.slice(-10).reduce((a, b) => a + b, 0) / 10;
  const sma20 = prices.slice(-20).reduce((a, b) => a + b, 0) / Math.min(prices.length, 20);
  
  // Exponential moving average
  const ema12 = calculateEMA(prices, 12);
  const ema26 = calculateEMA(prices, 26);
  const macd = ema12 - ema26;
  const signal = calculateEMA([macd, macd, macd, macd, macd, macd, macd, macd, macd], 9);
  const macdHistogram = macd - signal;
  
  // Momentum
  const momentum5 = ((current - prev5) / prev5) * 100;
  const momentum10 = ((current - sma10) / sma10) * 100;
  
  // Bollinger Bands position
  const std = calculateStdDev(prices.slice(-20));
  const upperBB = sma20 + (2 * std);
  const lowerBB = sma20 - (2 * std);
  const bbPosition = (current - lowerBB) / (upperBB - lowerBB);
  
  // RSI (14 periods)
  const rsi = calculateRSI(prices, 14);
  
  // Stochastic
  const stochastic = calculateStochastic(prices, 14);
  
  // Volume-weighted price change (simulated)
  const vwap = current; // Simplified
  
  // Trend strength
  const trendStrength = Math.abs(sma5 - sma20) / sma20 * 100;
  
  // Support/Resistance levels
  const high20 = Math.max(...prices.slice(-20));
  const low20 = Math.min(...prices.slice(-20));
  const supportLevel = low20 + (high20 - low20) * 0.236; // Fibonacci
  const resistanceLevel = high20 - (high20 - low20) * 0.236;
  
  return {
    current,
    sma5,
    sma10,
    sma20,
    ema12,
    ema26,
    macd,
    signal,
    macdHistogram,
    momentum5,
    momentum10,
    rsi,
    stochastic,
    bbPosition,
    trendStrength,
    supportLevel,
    resistanceLevel,
    high20,
    low20,
  };
}

function calculateEMA(prices, period) {
  const k = 2 / (period + 1);
  let ema = prices[0];
  for (let i = 1; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
  }
  return ema;
}

function calculateRSI(prices, period) {
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

function calculateStochastic(prices, period) {
  const recent = prices.slice(-period);
  const high = Math.max(...recent);
  const low = Math.min(...recent);
  const current = recent[recent.length - 1];
  return ((current - low) / (high - low)) * 100;
}

function calculateStdDev(prices) {
  const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
  const squaredDiffs = prices.map(p => Math.pow(p - mean, 2));
  return Math.sqrt(squaredDiffs.reduce((a, b) => a + b, 0) / prices.length);
}

function predictDirection(indicators) {
  if (!indicators) return { direction: 'hold', confidence: 0 };
  
  let score = 0;
  let factors = [];
  
  // RSI signals (oversold/overbought)
  if (indicators.rsi < 30) {
    score += 0.25;
    factors.push('RSI oversold (+0.25)');
  } else if (indicators.rsi > 70) {
    score -= 0.25;
    factors.push('RSI overbought (-0.25)');
  } else if (indicators.rsi < 40) {
    score += 0.1;
    factors.push('RSI slightly oversold (+0.1)');
  } else if (indicators.rsi > 60) {
    score -= 0.1;
    factors.push('RSI slightly overbought (-0.1)');
  }
  
  // Stochastic
  if (indicators.stochastic < 20) {
    score += 0.15;
    factors.push('Stochastic oversold (+0.15)');
  } else if (indicators.stochastic > 80) {
    score -= 0.15;
    factors.push('Stochastic overbought (-0.15)');
  }
  
  // MACD histogram direction
  if (indicators.macdHistogram > 0 && indicators.macd > indicators.signal) {
    score += 0.2;
    factors.push('MACD bullish (+0.2)');
  } else if (indicators.macdHistogram < 0 && indicators.macd < indicators.signal) {
    score -= 0.2;
    factors.push('MACD bearish (-0.2)');
  }
  
  // Price vs SMAs
  if (indicators.current > indicators.sma5 && indicators.sma5 > indicators.sma10) {
    score += 0.15;
    factors.push('Price above rising SMAs (+0.15)');
  } else if (indicators.current < indicators.sma5 && indicators.sma5 < indicators.sma10) {
    score -= 0.15;
    factors.push('Price below falling SMAs (-0.15)');
  }
  
  // Bollinger Bands - price near bottom = buy signal
  if (indicators.bbPosition < 0.2) {
    score += 0.15;
    factors.push('Near lower BB (+0.15)');
  } else if (indicators.bbPosition > 0.8) {
    score -= 0.15;
    factors.push('Near upper BB (-0.15)');
  }
  
  // Momentum alignment
  if (indicators.momentum5 > 0 && indicators.momentum10 > 0) {
    score += 0.1;
    factors.push('Positive momentum (+0.1)');
  } else if (indicators.momentum5 < 0 && indicators.momentum10 < 0) {
    score -= 0.1;
    factors.push('Negative momentum (-0.1)');
  }
  
  // Strong trend
  if (indicators.trendStrength > 2) {
    if (score > 0) score += 0.1;
    if (score < 0) score -= 0.1;
    factors.push('Strong trend confirmed');
  }
  
  // Calculate confidence
  const confidence = Math.min(Math.abs(score), 1);
  
  // Determine direction
  let direction = 'hold';
  if (score > 0.15) direction = 'up';
  else if (score < -0.15) direction = 'down';
  
  return { 
    direction, 
    confidence, 
    score: score.toFixed(2),
    factors: factors.slice(0, 3) // Top 3 factors
  };
}

async function fetchPrices() {
  try {
    const ids = TOKENS.map(t => t.id).join(',');
    const response = await fetch(`${API_BASE}/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`);
    const data = await response.json();
    
    const prices = {};
    for (const token of TOKENS) {
      if (data[token.id]) {
        prices[token.symbol] = data[token.id].usd;
      }
    }
    return prices;
  } catch (e) {
    log(`Price fetch error: ${e.message}`, 'alert');
    return null;
  }
}

async function executeTrade(token, direction, price, confidence) {
  const positionSize = state.capital * CONFIG.maxPositionSize;
  const amount = positionSize / price;
  
  const trade = {
    token: token.symbol,
    direction,
    entryPrice: price,
    amount,
    value: positionSize,
    confidence,
    entryTime: Date.now(),
    status: 'open'
  };
  
  if (CONFIG.mode === 'practice') {
    log(`🎯 [PRACTICE] ${direction.toUpperCase()} ${token.symbol} @ $${price} | Conf: ${(confidence*100).toFixed(0)}%`, 'buy');
  } else {
    log(`🚀 [LIVE] ${direction.toUpperCase()} ${token.symbol} @ $${price} | Conf: ${(confidence*100).toFixed(0)}%`, 'buy');
  }
  
  state.positions.push(trade);
  state.dailyTrades++;
  saveState();
}

function checkPositions(prices) {
  if (!prices) return;
  
  for (const position of state.positions) {
    const currentPrice = prices[position.token];
    if (!currentPrice) continue;
    
    const pnl = position.direction === 'up' 
      ? (currentPrice - position.entryPrice) / position.entryPrice
      : (position.entryPrice - currentPrice) / position.entryPrice;
    
    // Check stop loss
    if (pnl <= -CONFIG.stopLoss) {
      log(`🛑 STOP LOSS: ${position.token} | PnL: ${(pnl*100).toFixed(1)}%`, 'sell');
      state.lostTrades++;
      state.capital += position.value * (1 + pnl);
      state.positions = state.positions.filter(p => p !== position);
      state.dailyTrades++;
      saveState();
      continue;
    }
    
    // Check take profit
    if (pnl >= CONFIG.takeProfit) {
      log(`✅ TAKE PROFIT: ${position.token} | PnL: ${(pnl*100).toFixed(1)}%`, 'buy');
      state.wonTrades++;
      state.capital += position.value * (1 + pnl);
      state.positions = state.positions.filter(p => p !== position);
      state.dailyTrades++;
      saveState();
    }
  }
}

async function scanAndTrade() {
  log('🔍 Scanning 5-min crypto opportunities...');
  
  const prices = await fetchPrices();
  if (!prices) {
    log('Using cached prices');
    return;
  }
  
  // Update price history
  for (const [symbol, price] of Object.entries(prices)) {
    if (!priceHistory.has(symbol)) {
      priceHistory.set(symbol, []);
    }
    const history = priceHistory.get(symbol);
    history.push(price);
    if (history.length > 50) history.shift(); // Keep last ~4 hours of 5-min data
  }
  
  // Check existing positions
  checkPositions(prices);
  
  if (state.positions.length >= CONFIG.maxPositions) {
    log('Max positions reached');
    return;
  }
  
  // Analyze each token
  for (const token of TOKENS) {
    const prices_arr = priceHistory.get(token.symbol);
    if (!prices_arr || prices_arr.length < 5) continue;
    
    const indicators = calculateIndicators(prices_arr);
    const prediction = predictDirection(indicators);
    
    if (prediction.direction !== 'hold' && prediction.confidence >= CONFIG.minConfidence) {
      // Check if we already have a position for this token
      if (state.positions.some(p => p.token === token.symbol)) continue;
      
      const currentPrice = prices[token.symbol];
      log(`${token.symbol}: ${prediction.direction.toUpperCase()} | Conf: ${(prediction.confidence*100).toFixed(0)}% | RSI: ${indicators.rsi.toFixed(0)} | Momentum: ${indicators.momentum.toFixed(2)}%`);
      
      await executeTrade(token, prediction.direction, currentPrice, prediction.confidence);
    }
  }
  
  // Summary
  log(`📊 ${CONFIG.mode.toUpperCase()} | Win Rate: ${getWinRate()}% | Portfolio: $${getPortfolioValue().toFixed(2)} | Positions: ${state.positions.length}`);
  
  // Check for mode switch
  if (CONFIG.mode === 'practice' && getWinRate() >= CONFIG.winRateThreshold * 100) {
    log(`🎉 ${CONFIG.winRateThreshold*100}% WIN RATE REACHED! Ready to go LIVE!`, 'alert');
  }
}

async function main() {
  console.clear();
  log('═══════════════════════════════════════');
  log('  🎯 5-MINUTE CRYPTO PREDICTION BOT');
  log('═══════════════════════════════════════');
  log(`Mode: ${CONFIG.mode.toUpperCase()}`);
  log(`Win Rate Threshold: ${CONFIG.winRateThreshold*100}%`);
  log(`Min Confidence: ${CONFIG.minConfidence*100}%`);
  log('═══════════════════════════════════════');
  
  loadState();
  
  // Initial scan
  await scanAndTrade();
  
  // Set up interval
  setInterval(scanAndTrade, CONFIG.scanInterval);
}

main().catch(console.error);
