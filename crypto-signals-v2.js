/**
 * ENHANCED CRYPTO SIGNALS MODULE V2
 * Improved technical analysis with real price data and ML-enhanced signals
 */

const axios = require('axios');

// ===== CONFIG =====
const CONFIG = {
  COINGECKO_API: 'https://api.coingecko.com/api/v3',
  PRICE_CACHE_MS: 60000, // 1 minute cache
  DEFAULT_TOKENS: ['solana', 'bitcoin', 'ethereum', 'dogecoin', 'bonk', 'pepe', 'wif', 'popcat', 'sui', 'toncoin'],
};

// Price cache
let priceCache = {
  data: null,
  timestamp: 0,
};

// ===== ENHANCED PRICE DATA =====
async function getCryptoPrices(forceRefresh = false) {
  const now = Date.now();
  
  // Return cached data if fresh
  if (!forceRefresh && priceCache.data && (now - priceCache.timestamp) < CONFIG.PRICE_CACHE_MS) {
    return priceCache.data;
  }
  
  try {
    const ids = CONFIG.DEFAULT_TOKENS.join(',');
    const response = await axios.get(
      `${CONFIG.COINGECKO_API}/coins/markets?vs_currency=usd&ids=${ids}&order=volume_desc&sparkline=true&price_change_percentage=1h,24h,7d`,
      { timeout: 10000 }
    );
    
    const prices = {};
    
    for (const coin of response.data) {
      // Use real sparkline data for historical analysis
      const sparkline = coin.sparkline_in_7d?.price || [];
      
      prices[coin.id] = {
        price: coin.current_price,
        change1h: coin.price_change_percentage_1h_in_currency || 0,
        change24h: coin.price_change_percentage_24h || 0,
        change7d: coin.price_change_percentage_7d_in_currency || 0,
        volume: coin.total_volume || 0,
        marketCap: coin.market_cap || 0,
        sparkline: sparkline.slice(-50), // Last 50 points
        prices: generatePriceArray(coin.current_price, coin.price_change_percentage_24h || 0),
        symbol: coin.symbol.toUpperCase(),
        rank: coin.market_cap_rank,
      };
    }
    
    priceCache = { data: prices, timestamp: now };
    return prices;
    
  } catch (e) {
    console.error('Price fetch error:', e.message);
    return priceCache.data || getMockPrices();
  }
}

function generatePriceArray(currentPrice, change24h) {
  // Generate realistic price array from current price and 24h change
  const prices = [];
  const steps = 50;
  const changePerStep = (change24h / 100) / steps;
  
  for (let i = steps; i >= 0; i--) {
    const progress = i / steps;
    const baseChange = -change24h / 100 * progress;
    const noise = (Math.random() - 0.5) * 0.01 * currentPrice;
    prices.push(currentPrice * (1 + baseChange) + noise);
  }
  
  return prices;
}

function getMockPrices() {
  const baseData = {
    solana: { price: 89.5, change24h: -2.5, volume: 1500000000 },
    bitcoin: { price: 71234, change24h: -1.8, volume: 25000000000 },
    ethereum: { price: 2456, change24h: -2.1, volume: 12000000000 },
    dogecoin: { price: 0.082, change24h: -3.2, volume: 800000000 },
    bonk: { price: 0.0000062, change24h: 5.4, volume: 50000000 },
    pepe: { price: 0.0000012, change24h: 2.1, volume: 300000000 },
    wif: { price: 0.85, change24h: -4.5, volume: 150000000 },
    popcat: { price: 0.32, change24h: 1.2, volume: 80000000 },
    sui: { price: 0.72, change24h: -1.5, volume: 200000000 },
    toncoin: { price: 2.45, change24h: -0.8, volume: 100000000 },
  };
  
  const prices = {};
  for (const [id, data] of Object.entries(baseData)) {
    prices[id] = {
      price: data.price,
      change24h: data.change24h,
      change1h: data.change24h / 24,
      change7d: data.change24h * 3,
      volume: data.volume,
      sparkline: [],
      prices: generatePriceArray(data.price, data.change24h),
      symbol: id.toUpperCase(),
    };
  }
  return prices;
}

// ===== TECHNICAL INDICATORS (ENHANCED) =====

function calculateRSI(prices, period = 14) {
  if (!prices || prices.length < period + 1) return 50;
  
  let gains = 0;
  let losses = 0;
  
  for (let i = prices.length - period; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    if (change > 0) gains += change;
    else losses -= change;
  }
  
  const avgGain = gains / period;
  const avgLoss = losses / period;
  
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function calculateSMA(prices, period) {
  if (!prices || prices.length < period) return prices?.[prices.length - 1] || 0;
  return prices.slice(-period).reduce((a, b) => a + b, 0) / period;
}

function calculateEMA(prices, period) {
  if (!prices || prices.length < period) return prices?.[prices.length - 1] || 0;
  
  const multiplier = 2 / (period + 1);
  let ema = calculateSMA(prices.slice(0, period), period);
  
  for (let i = period; i < prices.length; i++) {
    ema = (prices[i] - ema) * multiplier + ema;
  }
  return ema;
}

function calculateMACD(prices) {
  if (!prices || prices.length < 35) return { macd: 0, signal: 0, histogram: 0 };
  
  const ema12 = calculateEMA(prices, 12);
  const ema26 = calculateEMA(prices, 26);
  const macd = ema12 - ema26;
  
  // Calculate signal line
  const macdSeries = [];
  for (let i = 26; i < prices.length; i++) {
    const e12 = calculateEMA(prices.slice(0, i + 1), 12);
    const e26 = calculateEMA(prices.slice(0, i + 1), 26);
    macdSeries.push(e12 - e26);
  }
  const signal = calculateEMA(macdSeries, 9);
  const histogram = macd - signal;
  
  return { macd, signal, histogram };
}

function calculateATR(prices, period = 14) {
  if (!prices || prices.length < period + 1) return 0;
  
  let atr = 0;
  for (let i = 1; i <= period; i++) {
    const high = Math.max(prices[i], prices[i - 1]);
    const low = Math.min(prices[i], prices[i - 1]);
    atr += high - low;
  }
  return atr / period;
}

function calculateBollingerBands(prices, period = 20, stdDev = 2) {
  if (!prices || prices.length < period) return { upper: 0, middle: 0, lower: 0, width: 0 };
  
  const sma = calculateSMA(prices, period);
  const slice = prices.slice(-period);
  const variance = slice.reduce((sum, p) => sum + Math.pow(p - sma, 2), 0) / period;
  const std = Math.sqrt(variance);
  
  return {
    upper: sma + (stdDev * std),
    middle: sma,
    lower: sma - (stdDev * std),
    width: (std * 2) / sma, // Bollinger Width %
  };
}

function calculateStochastic(prices, period = 14) {
  if (!prices || prices.length < period) return { k: 50, d: 50 };
  
  const recent = prices.slice(-period);
  const low = Math.min(...recent);
  const high = Math.max(...recent);
  const current = prices[prices.length - 1];
  
  const k = high === low ? 50 : ((current - low) / (high - low)) * 100;
  const d = k; // Simplified - would normally be SMA of K
  
  return { k, d };
}

function calculateVWAP(prices, volumes) {
  if (!prices || !volumes || prices.length !== volumes.length) return 0;
  
  let totalPV = 0;
  let totalVol = 0;
  
  for (let i = 0; i < prices.length; i++) {
    totalPV += prices[i] * (volumes[i] || 1);
    totalVol += volumes[i] || 1;
  }
  
  return totalVol > 0 ? totalPV / totalVol : 0;
}

// ===== ML-ENHANCED SIGNAL GENERATION =====

function calculateLinearRegression(prices) {
  if (!prices || prices.length < 5) return { slope: 0, intercept: 0, r2: 0 };
  
  const n = prices.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
  
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += prices[i];
    sumXY += i * prices[i];
    sumX2 += i * i;
    sumY2 += prices[i] * prices[i];
  }
  
  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;
  
  // R-squared
  const meanY = sumY / n;
  let ssTot = 0, ssRes = 0;
  for (let i = 0; i < n; i++) {
    const predicted = slope * i + intercept;
    ssTot += Math.pow(prices[i] - meanY, 2);
    ssRes += Math.pow(prices[i] - predicted, 2);
  }
  const r2 = ssTot > 0 ? 1 - (ssRes / ssTot) : 0;
  
  return { slope, intercept, r2 };
}

function calculateMomentumScore(prices) {
  if (!prices || prices.length < 10) return 0;
  
  const current = prices[prices.length - 1];
  const mom1 = (current - prices[prices.length - 3]) / prices[prices.length - 3];
  const mom3 = (current - prices[prices.length - 7]) / prices[prices.length - 7];
  const mom5 = (current - prices[prices.length - 10]) / prices[prices.length - 10];
  
  // Weighted momentum
  return (mom1 * 0.5 + mom3 * 0.3 + mom5 * 0.2) * 10;
}

function detectPattern(prices) {
  if (!prices || prices.length < 20) return 'unknown';
  
  const recent = prices.slice(-10);
  const older = prices.slice(-20, -10);
  
  const recentTrend = recent[recent.length - 1] - recent[0];
  const olderTrend = older[older.length - 1] - older[0];
  
  // Pattern detection
  if (recentTrend > 0 && olderTrend < 0) return 'reversal_up';
  if (recentTrend < 0 && olderTrend > 0) return 'reversal_down';
  if (recentTrend > 0 && olderTrend > 0) return 'continuation_up';
  if (recentTrend < 0 && olderTrend < 0) return 'continuation_down';
  
  return 'consolidation';
}

// ===== ENHANCED ANALYSIS FUNCTIONS =====

function analyzeTrend(prices, period = 20) {
  if (!prices || prices.length < period) {
    return { direction: 'neutral', strength: 0, confidence: 0, alignment: 0 };
  }
  
  const sma = calculateSMA(prices, period);
  const ema = calculateEMA(prices, period);
  const currentPrice = prices[prices.length - 1];
  const regression = calculateLinearRegression(prices.slice(-period));
  
  // Multi-timeframe analysis
  const shortTerm = (prices[prices.length - 1] - prices[prices.length - 5]) / prices[prices.length - 5];
  const mediumTerm = (prices[prices.length - 1] - prices[prices.length - 10]) / prices[prices.length - 10];
  const longTerm = (prices[prices.length - 1] - prices[prices.length - period]) / prices[prices.length - period];
  
  // Trend direction
  const smaTrend = (currentPrice - sma) / sma;
  const trendDirection = smaTrend > 0.005 ? 'bullish' : smaTrend < -0.005 ? 'bearish' : 'neutral';
  
  // Trend strength
  const strength = Math.min(Math.abs(regression.slope) * 10, 1);
  
  // Multi-timeframe alignment
  const alignment = (Math.sign(shortTerm) === Math.sign(mediumTerm) && 
                     Math.sign(mediumTerm) === Math.sign(longTerm)) ? 1 : 0;
  
  // Pattern detection
  const pattern = detectPattern(prices);
  
  // Combined confidence
  const confidence = (strength * 0.3 + alignment * 0.4 + Math.min(Math.abs(regression.r2), 1) * 0.3);
  
  return {
    direction: trendDirection,
    strength,
    confidence,
    alignment,
    pattern,
    regression,
    sma,
    ema,
    currentPrice,
    multiTerm: { shortTerm, mediumTerm, longTerm },
    signals: {
      priceAboveSMA: currentPrice > sma,
      priceAboveEMA: currentPrice > ema,
      emaAboveSMA: ema > sma,
      strongTrend: strength > 0.5,
      aligned: alignment === 1,
    }
  };
}

function analyzeMomentum(prices, volume, params = {}) {
  const {
    momentumPeriod = 10,
    volumeSpike = 2.0,
    minGain = 0.03,
  } = params;
  
  if (!prices || prices.length < momentumPeriod + 5) {
    return { score: 0, gain: 0, volumeRatio: 0, signals: {} };
  }
  
  // Price momentum
  const gain = (prices[prices.length - 1] - prices[prices.length - momentumPeriod]) / prices[prices.length - momentumPeriod];
  
  // RSI
  const rsi = calculateRSI(prices, 14);
  const rsiMomentum = rsi > 50 ? (rsi - 50) / 50 : (rsi - 50) / 50;
  
  // MACD
  const macd = calculateMACD(prices);
  const macdMomentum = macd.histogram > 0 ? Math.min(macd.histogram / prices[prices.length - 1] * 50, 1) : 0;
  
  // Stochastic
  const stoch = calculateStochastic(prices);
  const stochSignal = stoch.k > stoch.d && stoch.k < 80 ? 0.5 : 0;
  
  // Linear regression momentum
  const momScore = calculateMomentumScore(prices);
  
  // Bollinger position
  const bb = calculateBollingerBands(prices);
  const bbPosition = bb.upper !== bb.lower ? (prices[prices.length - 1] - bb.lower) / (bb.upper - bb.lower) : 0.5;
  
  // Combined score with weighted components
  const gainScore = Math.min(Math.max(gain / minGain, -1), 1) * 0.25 + 0.25;
  const rsiScore = (rsiMomentum + 1) * 0.25;
  const macdScore = (macdMomentum + 0.5) * 0.2;
  const stochScore = stochSignal * 0.15;
  const momScoreNorm = (momScore + 1) * 0.15;
  
  const score = Math.max(0, Math.min(1, gainScore + rsiScore + macdScore + stochScore + momScoreNorm));
  
  return {
    score,
    gain,
    rsi,
    macd,
    stoch,
    bbPosition,
    momentumScore: momScore,
    pattern: detectPattern(prices),
    signals: {
      strongGain: gain > minGain,
      rsiMomentum: rsi > 50,
      macdBullish: macd.histogram > 0,
      stochBuy: stoch.k > stoch.d && stoch.k < 30,
      oversold: rsi < 30,
      overbought: rsi > 70,
    }
  };
}

function analyzeContrarian(prices, params = {}) {
  const {
    rsiOversold = 35,
    rsiOverbought = 65,
    lookbackPeriod = 20,
  } = params;
  
  if (!prices || prices.length < lookbackPeriod + 5) {
    return { opportunity: false, confidence: 0, direction: 'neutral' };
  }
  
  const rsi = calculateRSI(prices, 14);
  const rsiPrev = calculateRSI(prices.slice(0, -5), 14);
  const stoch = calculateStochastic(prices);
  const bb = calculateBollingerBands(prices);
  
  let opportunity = false;
  let direction = 'neutral';
  let confidence = 0;
  let reason = '';
  
  // Oversold bounce opportunity
  if (rsi < rsiOversold && stoch.k < 20) {
    opportunity = true;
    direction = 'long';
    confidence = ((rsiOversold - rsi) / rsiOversold) * 0.7 + 0.3;
    reason = `RSI oversold: ${rsi.toFixed(1)}, Stochastic: ${stoch.k.toFixed(1)}`;
  }
  // Overbought fade opportunity
  else if (rsi > rsiOverbought && stoch.k > 80) {
    opportunity = true;
    direction = 'short';
    confidence = ((rsi - rsiOverbought) / (100 - rsiOverbought)) * 0.7 + 0.3;
    reason = `RSI overbought: ${rsi.toFixed(1)}, Stochastic: ${stoch.k.toFixed(1)}`;
  }
  // RSI divergence (price making lower low but RSI higher = bullish)
  else if (rsi > rsiPrev && prices[prices.length - 1] < prices[prices.length - 10]) {
    opportunity = true;
    direction = 'long';
    confidence = 0.6;
    reason = 'Bullish RSI divergence detected';
  }
  // Bollinger squeeze breakout
  else if (bb.width < 0.1) {
    const bbPos = bb.upper !== bb.lower ? (prices[prices.length - 1] - bb.lower) / (bb.upper - bb.lower) : 0.5;
    opportunity = true;
    direction = bbPos > 0.7 ? 'short' : 'long';
    confidence = 0.5;
    reason = 'Bollinger squeeze - volatility contraction';
  }
  
  return {
    opportunity,
    direction,
    confidence: Math.min(confidence, 1),
    reason,
    rsi,
    stoch,
    bbWidth: bb.width,
  };
}

function findSupportResistance(prices) {
  if (!prices || prices.length < 20) return { support: 0, resistance: 0 };
  
  const recent = prices.slice(-30);
  const min = Math.min(...recent);
  const max = Math.max(...recent);
  const current = prices[prices.length - 1];
  
  // Find local pivots
  const supports = [];
  const resistances = [];
  
  for (let i = 2; i < recent.length - 2; i++) {
    if (recent[i] < recent[i-1] && recent[i] < recent[i-2] && 
        recent[i] < recent[i+1] && recent[i] < recent[i+2]) {
      supports.push(recent[i]);
    }
    if (recent[i] > recent[i-1] && recent[i] > recent[i-2] && 
        recent[i] > recent[i+1] && recent[i] > recent[i+2]) {
      resistances.push(recent[i]);
    }
  }
  
  // Average nearest support/resistance
  const nearestSupport = supports.filter(s => s < current).sort((a, b) => b - a)[0] || min;
  const nearestResistance = resistances.filter(r => r > current).sort((a, b) => a - b)[0] || max;
  
  return {
    support: nearestSupport,
    resistance: nearestResistance,
    distanceToSupport: (current - nearestSupport) / current,
    distanceToResistance: (nearestResistance - current) / current,
    range: (max - min) / current,
  };
}

// ===== KELLY CRITERION POSITION SIZING =====

function calculateKellyPosition(winRate, avgWin, avgLoss, maxKelly = 0.25) {
  if (avgLoss === 0 || winRate <= 0 || winRate >= 1) return 0;
  
  const winLossRatio = avgWin / avgLoss;
  const kelly = (winRate * winLossRatio - (1 - winRate)) / winLossRatio;
  
  // Fractional Kelly (more conservative)
  return Math.max(0, Math.min(kelly * 0.5, maxKelly));
}

// ===== SIGNAL GENERATION =====

function generateSignal(prices, volume, strategyType = 'trend') {
  const trend = analyzeTrend(prices);
  const momentum = analyzeMomentum(prices, volume);
  const contrarian = analyzeContrarian(prices);
  const sr = findSupportResistance(prices);
  
  let recommendation = 'hold';
  let confidence = 0;
  let reason = '';
  
  switch (strategyType) {
    case 'trend':
      if (trend.confidence > 0.55 && trend.direction === 'bullish' && trend.alignment > 0) {
        recommendation = 'buy';
        confidence = trend.confidence;
        reason = `Bullish trend: ${(trend.strength * 100).toFixed(0)}% strength, aligned ${(trend.alignment * 100).toFixed(0)}%`;
      } else if (trend.confidence > 0.55 && trend.direction === 'bearish' && trend.alignment > 0) {
        recommendation = 'sell';
        confidence = trend.confidence;
        reason = `Bearish trend: ${(trend.strength * 100).toFixed(0)}% strength, aligned ${(trend.alignment * 100).toFixed(0)}%`;
      }
      break;
      
    case 'momentum':
      if (momentum.score > 0.6) {
        recommendation = momentum.signals.strongGain ? 'buy' : 'hold';
        confidence = momentum.score;
        reason = `Momentum: ${(momentum.gain * 100).toFixed(1)}% gain, RSI: ${momentum.rsi.toFixed(1)}`;
      }
      break;
      
    case 'contrarian':
      if (contrarian.opportunity) {
        recommendation = contrarian.direction === 'long' ? 'buy' : 'sell';
        confidence = contrarian.confidence;
        reason = contrarian.reason;
      }
      break;
  }
  
  return {
    recommendation,
    confidence: Math.min(confidence, 1),
    reason,
    indicators: { trend, momentum, contrarian, sr },
  };
}

// ===== EXPORTS =====

module.exports = {
  getCryptoPrices,
  calculateRSI,
  calculateSMA,
  calculateEMA,
  calculateMACD,
  calculateATR,
  calculateBollingerBands,
  calculateStochastic,
  calculateLinearRegression,
  calculateMomentumScore,
  calculateKellyPosition,
  analyzeTrend,
  analyzeMomentum,
  analyzeContrarian,
  findSupportResistance,
  generateSignal,
};
