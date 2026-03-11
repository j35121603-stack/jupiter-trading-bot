/**
 * POLYMARKET SIGNALS MODULE
 * Provides prediction market signals for Polymarket trading strategies
 * 
 * Used by: orchestrator.js
 */

const axios = require('axios');

const POLY_API = 'https://gamma-api.polymarket.com';
const DATA_API = 'https://data-api.polymarket.com';

// ===== MARKET DATA FETCHING =====

async function getPolyMarkets(params = {}) {
  try {
    const query = new URLSearchParams({
      closed: 'false',
      limit: params.limit || '50',
      ...params,
    });
    
    const response = await fetch(`${POLY_API}/markets?${query}`);
    const markets = await response.json();
    
    return markets.map(market => {
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
      };
    });
  } catch (e) {
    console.error('Poly market fetch error:', e.message);
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

async function getMarketPrices(conditionId) {
  try {
    const response = await fetch(`${DATA_API}/prices?conditionId=${conditionId}`);
    return await response.json();
  } catch (e) {
    return [];
  }
}

// ===== ANALYSIS FUNCTIONS =====

function analyzePolyMomentum(market, params = {}) {
  const {
    volumeThreshold = 10000,
    momentumPeriod = 6,
    minProbability = 0.55,
  } = params;
  
  const score = 0;
  const reason = '';
  
  // Volume score (0-0.4)
  const volumeScore = Math.min(market.volume / (volumeThreshold * 10), 1) * 0.4;
  
  // Probability score (0-0.3)
  const probabilityScore = market.yesPrice >= minProbability ? 
    ((market.yesPrice - minProbability) / (1 - minProbability)) * 0.3 : 0;
  
  // Liquidity score (0-0.3)
  const liquidityScore = Math.min(market.liquidity / 100000, 1) * 0.3;
  
  const totalScore = volumeScore + probabilityScore + liquidityScore;
  
  // Determine direction
  const direction = market.yesPrice > 0.5 ? 'yes' : 'no';
  
  return {
    score: totalScore,
    direction,
    volumeScore,
    probabilityScore,
    liquidityScore,
    reason: totalScore > 0.5 ? 
      `Vol: $${(market.volume/1000).toFixed(1)}K, Prob: ${(market.yesPrice*100).toFixed(0)}%` : 
      'No strong momentum',
  };
}

function analyzePolyContrarian(market, params = {}) {
  const {
    overreactionThreshold = 0.15,
    minVolume = 5000,
    fadeProbability = 0.70,
  } = params;
  
  // Check for overreaction (price moved too far too fast)
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
    confidence = (market.yesPrice - 0.5) * 1.5;
    reason = `Yes at ${(market.yesPrice*100).toFixed(0)}% seems overpriced`;
  } else if (extremeNo && moderateVolume) {
    // No is overpriced - fade it
    opportunity = true;
    direction = 'yes';
    confidence = (market.noPrice - 0.5) * 1.5;
    reason = `No at ${(market.noPrice*100).toFixed(0)}% seems overpriced`;
  } else if (market.yesPrice > 0.6 && market.yesPrice < 0.7 && moderateVolume) {
    // Middle ground - check for potential move
    opportunity = true;
    direction = 'yes'; // Lean toward yes if volume is good
    confidence = 0.3;
    reason = 'Moderate yes price with decent volume';
  }
  
  return {
    opportunity,
    direction,
    confidence: Math.min(confidence, 1),
    reason,
    indicators: {
      extremeYes,
      extremeNo,
      moderateVolume,
    }
  };
}

function analyzePolyArbitrage(markets) {
  const opportunities = [];
  
  // Find similar markets that might have price discrepancies
  for (let i = 0; i < markets.length; i++) {
    for (let j = i + 1; j < markets.length; j++) {
      const m1 = markets[i];
      const m2 = markets[j];
      
      // Check if questions are related
      const similarity = calculateSimilarity(m1.question, m2.question);
      
      if (similarity > 0.7) {
        // Calculate potential arbitrage
        const priceDiff = Math.abs(m1.yesPrice - m2.yesPrice);
        
        if (priceDiff > 0.1) {
          opportunities.push({
            market1: m1,
            market2: m2,
            priceDiff,
            profit: priceDiff * 100, // % profit
            hedge: priceDiff > 0.5 ? 'yes' : 'no',
          });
        }
      }
    }
  }
  
  return opportunities.sort((a, b) => b.profit - a.profit).slice(0, 5);
}

function calculateSimilarity(str1, str2) {
  const s1 = str1.toLowerCase().replace(/[^a-z0-9]/g, '');
  const s2 = str2.toLowerCase().replace(/[^a-z0-9]/g, '');
  
  if (s1.includes(s2) || s2.includes(s1)) return 0.8;
  
  // Simple Jaccard similarity
  const set1 = new Set(s1.split(''));
  const set2 = new Set(s2.split(''));
  const intersection = [...set1].filter(x => set2.has(x)).length;
  const union = new Set([...set1, ...set2]).size;
  
  return union > 0 ? intersection / union : 0;
}

function analyzeVolumeProfile(market) {
  // Estimate volume profile based on available data
  const volume = market.volume || 0;
  const liquidity = market.liquidity || 0;
  
  return {
    volumeLevel: volume > 100000 ? 'high' : volume > 10000 ? 'medium' : 'low',
    liquidityLevel: liquidity > 100000 ? 'high' : liquidity > 10000 ? 'medium' : 'low',
    volumeToLiquidity: liquidity > 0 ? volume / liquidity : 0,
    isTradeable: volume > 5000 && liquidity > 10000,
  };
}

function analyzeTimeToExpiry(market) {
  if (!market.endDate) return { daysLeft: null, expired: false };
  
  const endDate = new Date(market.endDate);
  const now = new Date();
  const daysLeft = (endDate - now) / (1000 * 60 * 60 * 24);
  
  return {
    daysLeft: Math.max(0, daysLeft),
    expired: daysLeft <= 0,
    urgent: daysLeft < 1,
    safe: daysLeft > 7,
  };
}

// ===== SIGNAL GENERATION =====

function generatePolySignal(market, strategyType = 'momentum') {
  const momentum = analyzePolyMomentum(market);
  const contrarian = analyzePolyContrarian(market);
  const volumeProfile = analyzeVolumeProfile(market);
  const timeToExpiry = analyzeTimeToExpiry(market);
  
  let recommendation = 'skip';
  let confidence = 0;
  let reason = '';
  
  switch (strategyType) {
    case 'momentum':
      if (momentum.score > 0.5 && volumeProfile.isTradeable && !timeToExpiry.expired) {
        recommendation = momentum.direction;
        confidence = momentum.score;
        reason = momentum.reason;
      }
      break;
      
    case 'contrarian':
      if (contrarian.opportunity && volumeProfile.isTradeable && !timeToExpiry.expired) {
        recommendation = contrarian.direction;
        confidence = contrarian.confidence;
        reason = contrarian.reason;
      }
      break;
      
    case 'combined':
      // Use whichever strategy has higher confidence
      if (momentum.score > contrarian.confidence && momentum.score > 0.4) {
        recommendation = momentum.direction;
        confidence = momentum.score;
        reason = `Momentum: ${momentum.reason}`;
      } else if (contrarian.opportunity && contrarian.confidence > 0.4) {
        recommendation = contrarian.direction;
        confidence = contrarian.confidence;
        reason = `Contrarian: ${contrarian.reason}`;
      }
      break;
  }
  
  return {
    market: market.question,
    marketId: market.id,
    recommendation,
    confidence,
    reason,
    details: {
      momentum,
      contrarian,
      volumeProfile,
      timeToExpiry,
    },
  };
}

function rankMarkets(markets, criteria = 'volume') {
  return markets
    .map(m => ({
      ...m,
      score: criteria === 'volume' ? m.volume : 
             criteria === 'liquidity' ? m.liquidity :
             criteria === 'value' ? (m.yesPrice > 0.5 ? 1 - m.yesPrice : m.yesPrice) * m.volume :
             m.volume * m.liquidity,
    }))
    .sort((a, b) => b.score - a.score);
}

function findValueMarkets(markets, threshold = 0.1) {
  // Find markets where the "no" side might be undervalued
  return markets
    .filter(m => m.noPrice > 0.4 && m.noPrice < 0.6 && m.volume > 10000)
    .map(m => ({
      ...m,
      valueScore: (Math.abs(0.5 - m.noPrice) * m.volume) / 100000,
    }))
    .sort((a, b) => b.valueScore - a.valueScore);
}

// ===== EXPORTS =====

module.exports = {
  getPolyMarkets,
  getMarketHistory,
  getMarketPrices,
  analyzePolyMomentum,
  analyzePolyContrarian,
  analyzePolyArbitrage,
  analyzeVolumeProfile,
  analyzeTimeToExpiry,
  generatePolySignal,
  rankMarkets,
  findValueMarkets,
};
