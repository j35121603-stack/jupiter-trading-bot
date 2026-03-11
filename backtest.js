/**
 * Multi-Strategy Backtesting Bot
 * Tests different trading strategies against historical data
 * 
 * Run: node backtest.js
 */

const fs = require('fs');

// Configuration
const CONFIG = {
  initialCapital: 1000,
  tradeSize: 0.1, // 10% per trade
  stopLoss: 0.03, // 3%
  takeProfit: 0.05, // 5%
};

// Historical price data (simulated 5-min candles)
const priceHistory = [];

// Generate sample data or load real data
async function loadHistoricalData() {
  // In production, you'd fetch from an API
  // For now, generate realistic-looking data
  const data = [];
  let price = 100;
  const now = Date.now();
  
  for (let i = 0; i < 1000; i++) {
    const change = (Math.random() - 0.5) * 2; // -1 to 1
    price = price * (1 + change * 0.01);
    
    data.push({
      timestamp: now - (1000 - i) * 5 * 60 * 1000,
      open: price,
      high: price * (1 + Math.random() * 0.02),
      low: price * (1 - Math.random() * 0.02),
      close: price * (1 + change * 0.005),
      volume: Math.random() * 1000000
    });
  }
  
  return data;
}

// ============= STRATEGIES =============

// Strategy 1: RSI Oversold/Overbought
function strategyRSI(prices, period = 14) {
  if (prices.length < period + 1) return null;
  
  let gains = 0, losses = 0;
  for (let i = prices.length - period; i < prices.length; i++) {
    const change = prices[i].close - prices[i - 1].close;
    if (change > 0) gains += change;
    else losses -= change;
  }
  
  const avgGain = gains / period;
  const avgLoss = losses / period;
  const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  const rsi = 100 - (100 / (1 + rs));
  
  const currentPrice = prices[prices.length - 1].close;
  
  if (rsi < 30) return { action: 'BUY', reason: `RSI oversold: ${rsi.toFixed(1)}`, confidence: (30 - rsi) / 30 };
  if (rsi > 70) return { action: 'SELL', reason: `RSI overbought: ${rsi.toFixed(1)}`, confidence: (rsi - 70) / 30 };
  
  return null;
}

// Strategy 2: Moving Average Crossover
function strategyMACross(prices, fast = 5, slow = 20) {
  if (prices.length < slow) return null;
  
  const fastMA = prices.slice(-fast).reduce((s, p) => s + p.close, 0) / fast;
  const slowMA = prices.slice(-slow).reduce((s, p) => s + p.close, 0) / slow;
  
  const prevFastMA = prices.slice(-fast - 1, -1).reduce((s, p) => s + p.close, 0) / fast;
  const prevSlowMA = prices.slice(-slow - 1, -slow - 1).reduce((s, p) => s + p.close, 0) / slow;
  
  // Golden Cross (BUY signal)
  if (fastMA > slowMA && prevFastMA <= prevSlowMA) {
    return { action: 'BUY', reason: `Golden Cross: MA${fast} crossed above MA${slow}`, confidence: 0.8 };
  }
  
  // Death Cross (SELL signal)
  if (fastMA < slowMA && prevFastMA >= prevSlowMA) {
    return { action: 'SELL', reason: `Death Cross: MA${fast} crossed below MA${slow}`, confidence: 0.8 };
  }
  
  return null;
}

// Strategy 3: MACD
function strategyMACD(prices, fast = 12, slow = 26, signal = 9) {
  if (prices.length < slow + signal) return null;
  
  const ema = (arr, period) => {
    const k = 2 / (period + 1);
    let ema = arr[0].close;
    for (let i = 1; i < arr.length; i++) {
      ema = arr[i].close * k + ema * (1 - k);
    }
    return ema;
  };
  
  const fastEMA = ema(prices.slice(-fast), fast);
  const slowEMA = ema(prices.slice(-slow), slow);
  const macdLine = fastEMA - slowEMA;
  
  // Simplified signal line (just using 0 as baseline)
  if (macdLine > 0 && macdLine > macdLine * 0.1) {
    return { action: 'BUY', reason: `MACD bullish: ${macdLine.toFixed(4)}`, confidence: Math.min(macdLine * 10, 0.9) };
  }
  if (macdLine < 0 && macdLine < macdLine * 0.1) {
    return { action: 'SELL', reason: `MACD bearish: ${macdLine.toFixed(4)}`, confidence: Math.min(Math.abs(macdLine) * 10, 0.9) };
  }
  
  return null;
}

// Strategy 4: Bollinger Bands
function strategyBollinger(prices, period = 20, stdDev = 2) {
  if (prices.length < period) return null;
  
  const recent = prices.slice(-period);
  const sma = recent.reduce((s, p) => s + p.close, 0) / period;
  const squaredDiffs = recent.map(p => Math.pow(p.close - sma, 2));
  const std = Math.sqrt(squaredDiffs.reduce((s, v) => s + v, 0) / period);
  
  const upperBand = sma + (stdDev * std);
  const lowerBand = sma - (stdDev * std);
  
  const currentPrice = prices[prices.length - 1].close;
  
  if (currentPrice < lowerBand) {
    return { action: 'BUY', reason: 'Price below lower Bollinger Band', confidence: 0.7 };
  }
  if (currentPrice > upperBand) {
    return { action: 'SELL', reason: 'Price above upper Bollinger Band', confidence: 0.7 };
  }
  
  return null;
}

// Strategy 5: Stochastic Oscillator
function strategyStochastic(prices, period = 14) {
  if (prices.length < period) return null;
  
  const recent = prices.slice(-period);
  const high = Math.max(...recent.map(p => p.high));
  const low = Math.min(...recent.map(p => p.low));
  const current = recent[recent.length - 1].close;
  
  const stochastic = ((current - low) / (high - low)) * 100;
  
  if (stochastic < 20) {
    return { action: 'BUY', reason: `Stochastic oversold: ${stochastic.toFixed(1)}`, confidence: (20 - stochastic) / 20 };
  }
  if (stochastic > 80) {
    return { action: 'SELL', reason: `Stochastic overbought: ${stochastic.toFixed(1)}`, confidence: (stochastic - 80) / 20 };
  }
  
  return null;
}

// Strategy 6: Volume-Price Trend
function strategyVPT(prices) {
  if (prices.length < 2) return null;
  
  const current = prices[prices.length - 1];
  const prev = prices[prices.length - 2];
  
  const change = (current.close - prev.close) / prev.close;
  const vptChange = current.volume * change;
  
  const vpt = prices.slice(-20).reduce((s, p, i) => {
    if (i === 0) return 0;
    const c = (p.close - prices[i-1].close) / prices[i-1].close;
    return s + p.volume * c;
  }, 0);
  
  if (vpt > 0 && change > 0) {
    return { action: 'BUY', reason: 'Volume confirms price increase', confidence: 0.6 };
  }
  if (vpt < 0 && change < 0) {
    return { action: 'SELL', reason: 'Volume confirms price decrease', confidence: 0.6 };
  }
  
  return null;
}

// ============= BACKTEST ENGINE =============

const strategies = {
  'RSI': strategyRSI,
  'MA_Cross': strategyMACross,
  'MACD': strategyMACD,
  'Bollinger': strategyBollinger,
  'Stochastic': strategyStochastic,
  'VPT': strategyVPT
};

function runBacktest(data, strategyName, params = {}) {
  let capital = CONFIG.initialCapital;
  let position = null;
  let trades = [];
  let wins = 0;
  let losses = 0;
  
  console.log(`\n${'='.repeat(50)}`);
  console.log(`Testing Strategy: ${strategyName}`);
  console.log(`${'='.repeat(50)}`);
  
  for (let i = 30; i < data.length; i++) {
    const prices = data.slice(0, i + 1);
    const strategy = strategies[strategyName];
    
    if (!strategy) {
      console.log(`Unknown strategy: ${strategyName}`);
      return;
    }
    
    const signal = strategy(prices, params);
    
    // Check stop loss / take profit for existing position
    if (position) {
      const currentPrice = data[i].close;
      const pnl = position.direction === 'BUY'
        ? (currentPrice - position.entryPrice) / position.entryPrice
        : (position.entryPrice - currentPrice) / position.entryPrice;
      
      if (pnl >= CONFIG.takeProfit || pnl <= -CONFIG.stopLoss) {
        // Close position
        const profit = position.size * pnl * position.entryPrice;
        capital += profit;
        
        if (pnl > 0) {
          wins++;
          trades.push({ ...position, exitPrice: currentPrice, pnl: profit, result: 'WIN' });
        } else {
          losses++;
          trades.push({ ...position, exitPrice: currentPrice, pnl: profit, result: 'LOSS' });
        }
        
        position = null;
      }
    }
    
    // Enter new position if signal and no current position
    if (!position && signal && signal.confidence > 0.5) {
      const tradeSize = capital * CONFIG.tradeSize;
      const price = data[i].close;
      
      position = {
        entryPrice: price,
        size: tradeSize / price,
        direction: signal.action,
        entryTime: data[i].timestamp,
        reason: signal.reason
      };
    }
  }
  
  // Close any remaining position
  if (position) {
    const lastPrice = data[data.length - 1].close;
    const pnl = position.direction === 'BUY'
      ? (lastPrice - position.entryPrice) / position.entryPrice
      : (position.entryPrice - lastPrice) / position.entryPrice;
    
    capital += position.size * pnl * position.entryPrice;
    
    if (pnl > 0) wins++;
    else losses++;
  }
  
  // Results
  const totalTrades = wins + losses;
  const winRate = totalTrades > 0 ? (wins / totalTrades * 100) : 0;
  const totalReturn = ((capital - CONFIG.initialCapital) / CONFIG.initialCapital * 100);
  
  console.log(`\n📊 RESULTS:`);
  console.log(`   Total Trades: ${totalTrades}`);
  console.log(`   Wins: ${wins} | Losses: ${losses}`);
  console.log(`   Win Rate: ${winRate.toFixed(1)}%`);
  console.log(`   Final Capital: $${capital.toFixed(2)}`);
  console.log(`   Total Return: ${totalReturn.toFixed(2)}%`);
  
  return {
    strategy: strategyName,
    trades: totalTrades,
    wins,
    losses,
    winRate,
    capital,
    return: totalReturn
  };
}

// ============= MAIN =============

async function main() {
  console.log('🔬 MULTI-STRATEGY BACKTESTING');
  console.log(`Initial Capital: $${CONFIG.initialCapital}`);
  console.log(`Trade Size: ${CONFIG.tradeSize * 100}%`);
  console.log(`Stop Loss: ${CONFIG.stopLoss * 100}% | Take Profit: ${CONFIG.takeProfit * 100}%`);
  
  // Generate sample data
  console.log('\n📈 Generating historical data...');
  const data = await loadHistoricalData();
  console.log(`Generated ${data.length} candles`);
  
  // Test each strategy
  const results = [];
  
  for (const strategyName of Object.keys(strategies)) {
    const result = runBacktest(data, strategyName);
    if (result) results.push(result);
  }
  
  // Summary
  console.log(`\n${'='.repeat(50)}`);
  console.log('📋 FINAL RANKING');
  console.log(`${'='.repeat(50)}\n`);
  
  results.sort((a, b) => b.return - a.return);
  
  results.forEach((r, i) => {
    console.log(`${i + 1}. ${r.strategy.padEnd(15)} | Win: ${r.winRate.toFixed(1).padStart(5)}% | Return: ${r.return.toFixed(2).padStart(8)}% | Trades: ${r.trades}`);
  });
  
  console.log(`\n🏆 Best Strategy: ${results[0].strategy} with ${results[0].return.toFixed(2)}% return`);
}

main().catch(console.error);
