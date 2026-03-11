/**
 * ENHANCED POLYMARKET SIGNALS MODULE V2
 * Improved prediction market analysis with sentiment and volume analysis
 */

const axios = require('axios');

const POLY_API = 'https://gamma-api.polymarket.com';
const DATA_API = 'https://data-api.polymarket.com';

// Cache
let marketCache = {
  data: [],
  timestamp: 0,
};
const CACHE_MS = 30000; // 30 second cache

// ===== MARKET DATA FETCHING =====

async function getPolyMarkets(params = {}) {
  const now = Date.now();
  
  // Return cached data
  if (marketCache.data.length > 0 && (now - marketCache.timestamp) < CACHE_MS) {
    return marketCache.data;
  }
  
  try {
    const query = new URLSearchParams({
      closed: 'false',
      limit: params.limit || '100',
      ...params,
    });
    
    const response = await fetch(`${POLY_API}/markets?${query}`);
    const rawMarkets = await response.json();
    
    const markets = rawMarkets.map(market => {
      const prices = JSON.parse(market.outcomePrices || '[]');
      return {
        id: market.id,
        question: market.question,
        description: market.description,
        yesPrice: parseFloat(prices[0]) || 0.5,
        noPrice: parseFloat(prices[1]) || 0.5,
        volume: parseFloat(market.volume || 0),
        liquidity: parseFloat(market.liquidity || 0),
        endDate: market.endDate,
        createdAt: market.createdAt,
        category: market.category || 'unknown',
        groupItemTitle: market.groupItemTitle || '',
      };
    });
    
    marketCache = { data: markets, timestamp: now };
    return markets;
    
  } catch (e) {
    console.error('Poly market fetch error:', e.message);
    return marketCache.data.length > 0 ? marketCache.data : [];
  }
}

async function getMarketPrices(conditionId) {
  try {
    const response = await fetch(`${DATA_API}/prices?conditionId=${conditionId}`);
    return await response.json();
  } catch (e) {
    return [];
  }
}

async function getMarketHistory(conditionId) {
  try {
    const response = await fetch(`${DATA_API}/markets/history?conditionId=${conditionId}`);
    return await response.json();
  } catch (e) {
    return [];
  }
}

// ===== ANALYSIS FUNCTIONS =====

function analyzePolyMomentum(market, params = {}) {
  const {
    volumeThreshold = 10000,
    minProbability = 0.55,
  } = params;
  
  const volumeScore = Math.min(market.volume / (volumeThreshold * 10), 1) * 0.4;
  const probabilityScore = market.yesPrice >= minProbability ? 
    ((market.yesPrice - minProbability) / (1 - minProbability)) * 0.3 : 0;
  const liquidityScore = Math.min(market.liquidity / 100000, 1) * 0.3;
  
  const totalScore = Math.min(volumeScore + probabilityScore + liquidityScore, 1);
  const direction = market.yesPrice > 0.5 ? 'yes' : 'no';
  
  return {
    score: totalScore,
    direction,
    volumeScore,
    probabilityScore,
    liquidityScore,
    reason: totalScore > 0.4 ? 
      `Vol: $${(market.volume/1000).toFixed(1)}K, Prob: ${(market.yesPrice*100).toFixed(0)}%` : 
      'No strong momentum',
  };
}

function analyzePolyContrarian(market, params = {}) {
  const {
    minVolume = 5000,
  } = params;
  
  const extremeYes = market.yesPrice > 0.85;
  const extremeNo = market.noPrice > 0.85;
  const moderateVolume = market.volume > minVolume;
  
  let opportunity = false;
  let direction = null;
  let confidence = 0;
  let reason = '';
  
  if (extremeYes && moderateVolume) {
    // Yes is overpriced - fade it
    opportunity = true;
    direction = 'no';
    confidence = Math.min((market.yesPrice - 0.5) * 1.5, 1);
    reason = `Yes at ${(market.yesPrice*100).toFixed(0)}% seems overpriced`;
  } else if (extremeNo && moderateVolume) {
    // No is overpriced - fade it
    opportunity = true;
    direction = 'yes';
    confidence = Math.min((market.noPrice - 0.5) * 1.5, 1);
    reason = `No at ${(market.noPrice*100).toFixed(0)}% seems overpriced`;
  } else if (market.yesPrice > 0.55 && market.yesPrice < 0.75 && moderateVolume) {
    // Sweet spot - moderate conviction with volume
    opportunity = true;
    direction = 'yes';
    confidence = 0.4 + (market.volume / 100000) * 0.3;
    reason = 'Moderate yes price with volume support';
  } else if (market.noPrice > 0.55 && market.noPrice < 0.75 && moderateVolume) {
    opportunity = true;
    direction = 'no';
    confidence = 0.4 + (market.volume / 100000) * 0.3;
    reason = 'Moderate no price with volume support';
  }
  
  return {
    opportunity,
    direction,
    confidence: Math.min(confidence, 1),
    reason,
    indicators: { extremeYes, extremeNo, moderateVolume },
  };
}

function analyzePolyValue(market, params = {}) {
  // Find undervalued markets - where probability doesn't match true odds
  const { minVolume = 10000 } = params;
  
  if (market.volume < minVolume) {
    return { opportunity: false, confidence: 0 };
  }
  
  // The "no" side should be valued at roughly 1 - yesPrice in efficient markets
  // But sometimes there's value on the underdog
  
  const spread = Math.abs(market.yesPrice + market.noPrice - 1);
  const isInefficient = spread > 0.05; // More than 5% inefficiency
  
  if (isInefficient) {
    // If yes + no < 1, there's arbitrage opportunity
    // If yes + no > 1, also inefficiency
    const direction = market.yesPrice < market.noPrice ? 'yes' : 'no';
    const confidence = Math.min(spread * 5, 0.8);
    
    return {
      opportunity: true,
      direction,
      confidence,
      reason: `Spread inefficiency: ${(spread*100).toFixed(1)}%`,
    };
  }
  
  return { opportunity: false, confidence: 0 };
}

function analyzePolySentiment(market) {
  // Simple sentiment based on price positioning
  const sentimentScore = market.yesPrice * 2 - 1; // -1 (all no) to +1 (all yes)
  
  let sentiment = 'neutral';
  if (sentimentScore > 0.3) sentiment = 'bullish';
  else if (sentimentScore < -0.3) sentiment = 'bearish';
  
  return {
    sentiment,
    sentimentScore,
    conviction: Math.abs(sentimentScore),
  };
}

function analyzeTimeToExpiry(market) {
  if (!market.endDate) return { daysLeft: null, expired: false, urgency: 'unknown' };
  
  const endDate = new Date(market.endDate);
  const now = new Date();
  const daysLeft = (endDate - now) / (1000 * 60 * 60 * 24);
  
  let urgency = 'low';
  if (daysLeft <= 0) urgency = 'expired';
  else if (daysLeft < 1) urgency = 'critical';
  else if (daysLeft < 3) urgency = 'high';
  else if (daysLeft < 7) urgency = 'medium';
  
  return {
    daysLeft: Math.max(0, daysLeft),
    expired: daysLeft <= 0,
    urgency,
    safe: daysLeft > 7,
  };
}

function analyzeVolumeProfile(market) {
  const volume = market.volume || 0;
  const liquidity = market.liquidity || 0;
  
  const volumeLevel = volume > 100000 ? 'high' : volume > 10000 ? 'medium' : 'low';
  const liquidityLevel = liquidity > 100000 ? 'high' : liquidity > 10000 ? 'medium' : 'low';
  
  return {
    volumeLevel,
    liquidityLevel,
    volumeToLiquidity: liquidity > 0 ? volume / liquidity : 0,
    isTradeable: volume > 5000 && liquidity > 10000,
    volumeScore: Math.min(volume / 50000, 1),
    liquidityScore: Math.min(liquidity / 100000, 1),
  };
}

function rankMarkets(markets, criteria = 'volume') {
  return markets
    .map(m => ({
      ...m,
      score: criteria === 'volume' ? m.volume : 
             criteria === 'liquidity' ? m.liquidity :
             criteria === 'value' ? (Math.abs(0.5 - m.yesPrice) * m.volume) :
             criteria === 'efficiency' ? (1 - Math.abs(m.yesPrice + m.noPrice - 1)) * m.volume :
             m.volume * m.liquidity,
    }))
    .sort((a, b) => b.score - a.score);
}

function findValueMarkets(markets, params = {}) {
  const { minVolume = 10000, maxPrice = 0.4 } = params;
  
  // Find markets where one side is undervalued
  return markets
    .filter(m => m.volume > minVolume)
    .map(m => {
      // Value on "no" side if yes is overpriced
      const noValue = m.noPrice < maxPrice && m.yesPrice > (1 - maxPrice);
      // Value on "yes" side
      const yesValue = m.yesPrice < maxPrice && m.noPrice > (1 - maxPrice);
      
      let valueDirection = null;
      let valueScore = 0;
      
      if (noValue) {
        valueDirection = 'no';
        valueScore = ((1 - maxPrice) - m.noPrice) * m.volume / 10000;
      } else if (yesValue) {
        valueDirection = 'yes';
        valueScore = ((1 - maxPrice) - m.yesPrice) * m.volume / 10000;
      }
      
      return {
        ...m,
        valueDirection,
        valueScore,
        valueOpportunity: valueDirection !== null,
      };
    })
    .filter(m => m.valueOpportunity)
    .sort((a, b) => b.valueScore - a.valueScore);
}

// ===== SIGNAL GENERATION =====

function generatePolySignal(market, strategyType = 'combined') {
  const momentum = analyzePolyMomentum(market);
  const contrarian = analyzePolyContrarian(market);
  const value = analyzePolyValue(market);
  const sentiment = analyzePolySentiment(market);
  const volumeProfile = analyzeVolumeProfile(market);
  const timeToExpiry = analyzeTimeToExpiry(market);
  
  let recommendation = 'skip';
  let confidence = 0;
  let reason = '';
  
  // Skip expired markets
  if (timeToExpiry.expired) {
    return { recommendation, confidence: 0, reason: 'Market expired', market: market.question };
  }
  
  // Skip low volume
  if (!volumeProfile.isTradeable) {
    return { recommendation, confidence: 0, reason: 'Low volume', market: market.question };
  }
  
  switch (strategyType) {
    case 'momentum':
      if (momentum.score > 0.45) {
        recommendation = momentum.direction;
        confidence = momentum.score;
        reason = momentum.reason;
      }
      break;
      
    case 'contrarian':
      if (contrarian.opportunity) {
        recommendation = contrarian.direction;
        confidence = contrarian.confidence;
        reason = contrarian.reason;
      }
      break;
      
    case 'value':
      if (value.opportunity) {
        recommendation = value.direction;
        confidence = value.confidence;
        reason = value.reason;
      }
      break;
      
    case 'combined':
    default:
      // Score all strategies and pick best
      const strategies = [
        { type: 'momentum', score: momentum.score, direction: momentum.direction, reason: momentum.reason },
        { type: 'contrarian', score: contrarian.opportunity ? contrarian.confidence : 0, direction: contrarian.direction, reason: contrarian.reason },
        { type: 'value', score: value.opportunity ? value.confidence : 0, direction: value.direction, reason: value.reason },
      ].filter(s => s.score > 0.3);
      
      if (strategies.length > 0) {
        // Sort by score
        strategies.sort((a, b) => b.score - a.score);
        recommendation = strategies[0].direction;
        confidence = strategies[0].score;
        reason = `${strategies[0].type}: ${strategies[0].reason}`;
      }
      break;
  }
  
  return {
    market: market.question,
    marketId: market.id,
    recommendation,
    confidence: Math.min(confidence, 1),
    reason,
    details: {
      momentum,
      contrarian,
      value,
      sentiment,
      volumeProfile,
      timeToExpiry,
    },
  };
}

function findBestPolyMarkets(markets, options = {}) {
  const { 
    minVolume = 10000, 
    maxResults = 5,
    strategy = 'combined',
    excludeCategories = ['crypto'],
  } = options;
  
  // Filter by volume and category
  const filtered = markets
    .filter(m => m.volume > minVolume)
    .filter(m => !excludeCategories.includes(m.category?.toLowerCase()));
  
  // Generate signals
  const signals = filtered.map(m => ({
    market: m,
    signal: generatePolySignal(m, strategy),
  }));
  
  // Filter for actionable signals
  const actionable = signals
    .filter(s => s.signal.recommendation !== 'skip')
    .sort((a, b) => b.signal.confidence - a.signal.confidence);
  
  return actionable.slice(0, maxResults);
}

// ===== EXPORTS =====

module.exports = {
  getPolyMarkets,
  getMarketPrices,
  getMarketHistory,
  analyzePolyMomentum,
  analyzePolyContrarian,
  analyzePolyValue,
  analyzePolySentiment,
  analyzeTimeToExpiry,
  analyzeVolumeProfile,
  generatePolySignal,
  findBestPolyMarkets,
  findValueMarkets,
  rankMarkets,
};
