/**
 * CRYPTO SIGNALS MODULE
 * Provides technical analysis signals for crypto trading strategies
 * 
 * Used by: orchestrator.js
 */

const axios = require('axios');

// ===== PRICE DATA =====
async function getCryptoPrices() {
  try {
    // Use CoinGecko API (free, no key required)
    const ids = 'solana,bitcoin,ethereum,dogecoin,bonk,pepe,wif,popcat,sui,toncoin';
    const response = await axios.get(
      `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`,
      { timeout: 5000 }
    );
    
    const prices = {};
    
    for (const [id, data] of Object.entries(response.data)) {
      // Generate synthetic price history for analysis
      const currentPrice = data.usd;
      const changePct = (data.usd_24h_change || 0) / 100;
      const priceHistory = [];
      
      // Create 50 price points for analysis (simulating historical data)
      for (let i = 50; i >= 0; i--) {
        const progress = i / 50;
        const variation = (Math.random() - 0.5) * 0.01 * currentPrice;
        priceHistory.push(currentPrice * (1 - changePct * progress) + variation);
      }
      priceHistory.push(currentPrice); // Add current price
      
      prices[id] = {
        price: currentPrice,
        change24h: data.usd_24h_change || 0,
        volume: currentPrice * 1000000 * (Math.abs(data.usd_24h_change || 0) / 10), // Estimated volume
        prices: priceHistory,
        symbol: id.toUpperCase(),
      };
    }
    
    return prices;
  } catch (e) {
    console.error('Price fetch error:', e.message);
    // Return mock data as fallback for testing
    return getMockPrices();
  }
}

function getMockPrices() {
  // Fallback mock data when API fails
  const basePrices = {
    solana: { price: 89.5, change24h: -2.5 },
    bitcoin: { price: 71234, change24h: -1.8 },
    ethereum: { price: 2456, change24h: -2.1 },
    dogecoin: { price: 0.082, change24h: -3.2 },
    bonk: { price: 0.0000062, change24h: 5.4 },
    pepe: { price: 0.0000012, change24h: 2.1 },
    wif: { price: 0.85, change24h: -4.5 },
    popcat: { price: 0.32, change24h: 1.2 },
    sui: { price: 0.72, change24h: -1.5 },
    toncoin: { price: 2.45, change24h: -0.8 },
  };
  
  const prices = {};
  for (const [id, data] of Object.entries(basePrices)) {
    const currentPrice = data.price;
    const changePct = data.change24h / 100;
    const priceHistory = [];
    
    for (let i = 50; i >= 0; i--) {
      const progress = i / 50;
      const variation = (Math.random() - 0.5) * 0.01 * currentPrice;
      priceHistory.push(currentPrice * (1 - changePct * progress) + variation);
    }
    priceHistory.push(currentPrice);
    
    prices[id] = {
      price: currentPrice,
      change24h: data.change24h,
      volume: currentPrice * 1000000,
      prices: priceHistory,
      symbol: id.toUpperCase(),
    };
  }
  
  return prices;
}

// ===== TECHNICAL INDICATORS =====

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
  const rsi = 100 - (100 / (1 + rs));
  
  return rsi;
}

function calculateSMA(prices, period) {
  if (!prices || prices.length < period) return prices ? prices[prices.length - 1] : 0;
  
  const sum = prices.slice(-period).reduce((a, b) => a + b, 0);
  return sum / period;
}

function calculateEMA(prices, period) {
  if (!prices || prices.length < period) return prices ? prices[prices.length - 1] : 0;
  
  const multiplier = 2 / (period + 1);
  let ema = calculateSMA(prices.slice(0, period), period);
  
  for (let i = period; i < prices.length; i++) {
    ema = (prices[i] - ema) * multiplier + ema;
  }
  
  return ema;
}

function calculateMACD(prices) {
  if (!prices || prices.length < 26) return { macd: 0, signal: 0, histogram: 0 };
  
  const ema12 = calculateEMA(prices, 12);
  const ema26 = calculateEMA(prices, 26);
  const macd = ema12 - ema26;
  const signal = calculateEMA([...prices].fill(macd), 9);
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
  if (!prices || prices.length < period) return { upper: 0, middle: 0, lower: 0 };
  
  const sma = calculateSMA(prices, period);
  const slice = prices.slice(-period);
  const variance = slice.reduce((sum, p) => sum + Math.pow(p - sma, 2), 0) / period;
  const std = Math.sqrt(variance);
  
  return {
    upper: sma + (stdDev * std),
    middle: sma,
    lower: sma - (stdDev * std),
  };
}

// ===== ANALYSIS FUNCTIONS =====

function analyzeTrend(prices, period = 20) {
  if (!prices || prices.length < period) {
    return { direction: 'neutral', strength: 0, confidence: 0 };
  }
  
  const sma = calculateSMA(prices, period);
  const ema = calculateEMA(prices, period);
  const currentPrice = prices[prices.length - 1];
  
  // Trend direction
  const smaTrend = (currentPrice - sma) / sma;
  const emaTrend = (currentPrice - ema) / ema;
  const trendDirection = smaTrend > 0 ? 'bullish' : smaTrend < 0 ? 'bearish' : 'neutral';
  
  // Trend strength (0-1)
  const strength = Math.min(Math.abs(smaTrend) * 10, 1);
  
  // Confidence based on multiple timeframes
  const shortTerm = (prices[prices.length - 1] - prices[prices.length - 5]) / prices[prices.length - 5];
  const mediumTerm = (prices[prices.length - 1] - prices[prices.length - 10]) / prices[prices.length - 10];
  const longTerm = (prices[prices.length - 1] - prices[prices.length - 20]) / prices[prices.length - 20];
  
  const alignment = (Math.sign(shortTerm) === Math.sign(mediumTerm) && Math.sign(mediumTerm) === Math.sign(longTerm)) ? 1 : 0;
  const confidence = (strength + alignment) / 2;
  
  return {
    direction: trendDirection,
    strength,
    confidence,
    sma,
    ema,
    currentPrice,
    signals: {
      priceAboveSMA: currentPrice > sma,
      priceAboveEMA: currentPrice > ema,
      emaAboveSMA: ema > sma,
    }
  };
}

function analyzeVolume(volume, avgVolume) {
  const ratio = volume / avgVolume;
  
  return {
    ratio,
    isSpike: ratio > 2.0,
    isDeclining: ratio < 0.5,
    interpretation: ratio > 2.0 ? 'high' : ratio < 0.5 ? 'low' : 'normal',
  };
}

function analyzeMomentum(prices, volume, params = {}) {
  const {
    momentumPeriod = 10,
    volumeSpike = 2.0,
    minGain = 0.03,
  } = params;
  
  if (!prices || prices.length < momentumPeriod) {
    return { score: 0, gain: 0, volumeRatio: 0 };
  }
  
  // Price momentum
  const gain = (prices[prices.length - 1] - prices[prices.length - momentumPeriod]) / prices[prices.length - momentumPeriod];
  
  // Volume analysis
  const recentVolume = volume || 1;
  const avgVolumeEst = volume * 0.8; // Estimate
  const volumeRatio = recentVolume / avgVolumeEst;
  
  // RSI momentum
  const rsi = calculateRSI(prices, 14);
  const rsiMomentum = rsi > 50 ? (rsi - 50) / 50 : 0;
  
  // MACD momentum
  const macd = calculateMACD(prices);
  const macdMomentum = macd.histogram > 0 ? Math.min(macd.histogram / prices[prices.length - 1] * 10, 1) : 0;
  
  // Combined score
  const gainScore = Math.min(gain / minGain, 1);
  const volumeScore = volumeRatio > volumeSpike ? 1 : volumeRatio / volumeSpike;
  
  const score = (gainScore * 0.4) + (volumeScore * 0.3) + (rsiMomentum * 0.2) + (macdMomentum * 0.1);
  
  return {
    score: Math.min(score, 1),
    gain,
    volumeRatio,
    rsi,
    macd,
    signals: {
      strongGain: gain > minGain,
      volumeSpike: volumeRatio > volumeSpike,
      rsiMomentum: rsi > 50,
      macdBullish: macd.histogram > 0,
    }
  };
}

function findSupportResistance(prices) {
  if (!prices || prices.length < 20) return { support: 0, resistance: 0 };
  
  const recent = prices.slice(-20);
  const min = Math.min(...recent);
  const max = Math.max(...recent);
  const current = prices[prices.length - 1];
  
  return {
    support: min,
    resistance: max,
    distanceToSupport: (current - min) / current,
    distanceToResistance: (max - current) / current,
  };
}

// ===== SIGNAL GENERATION =====

function generateSignal(prices, volume, strategyType = 'trend') {
  const signals = {
    trend: analyzeTrend(prices),
    momentum: analyzeMomentum(prices, volume),
    rsi: calculateRSI(prices),
    macd: calculateMACD(prices),
    supportResistance: findSupportResistance(prices),
  };
  
  let recommendation = 'hold';
  let confidence = 0;
  let reason = '';
  
  switch (strategyType) {
    case 'trend':
      if (signals.trend.confidence > 0.6 && signals.trend.direction === 'bullish') {
        recommendation = 'buy';
        confidence = signals.trend.confidence;
        reason = `Bullish trend with ${(signals.trend.strength * 100).toFixed(0)}% strength`;
      } else if (signals.trend.confidence > 0.6 && signals.trend.direction === 'bearish') {
        recommendation = 'sell';
        confidence = signals.trend.confidence;
        reason = `Bearish trend with ${(signals.trend.strength * 100).toFixed(0)}% strength`;
      }
      break;
      
    case 'momentum':
      if (signals.momentum.score > 0.6) {
        recommendation = 'buy';
        confidence = signals.momentum.score;
        reason = `Strong momentum: ${(signals.momentum.gain * 100).toFixed(1)}% gain`;
      }
      break;
      
    case 'contrarian':
      if (signals.rsi < 30) {
        recommendation = 'buy';
        confidence = (30 - signals.rsi) / 30;
        reason = `Oversold: RSI ${signals.rsi.toFixed(1)}`;
      } else if (signals.rsi > 70) {
        recommendation = 'sell';
        confidence = (signals.rsi - 70) / 30;
        reason = `Overbought: RSI ${signals.rsi.toFixed(1)}`;
      }
      break;
  }
  
  return {
    recommendation,
    confidence,
    reason,
    indicators: signals,
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
  analyzeTrend,
  analyzeVolume,
  analyzeMomentum,
  findSupportResistance,
  generateSignal,
};
