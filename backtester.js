/**
 * BACKTESTING FRAMEWORK V1
 * Historical simulation and strategy evaluation
 */

const fs = require('fs');
const path = require('path');

class Backtester {
  constructor(config = {}) {
    this.initialCapital = config.initialCapital || 10000;
    this.commission = config.commission || 0.001; // 0.1% fee
    this.slippage = config.slippage || 0.001; // 0.1% slippage
    
    this.trades = [];
    this.equityCurve = [];
    this.metrics = {};
  }
  
  // Simulate a trade
  executeTrade(direction, entryPrice, size, params = {}) {
    const { stopLoss, takeProfit, stopLossPct = 0.08, takeProfitPct = 0.20 } = params;
    
    // Apply slippage to entry
    const slippageFactor = direction === 'long' ? (1 + this.slippage) : (1 - this.slippage);
    const adjustedEntry = entryPrice * slippageFactor;
    
    // Calculate position value
    const positionValue = size;
    const commissionCost = positionValue * this.commission;
    
    // Simulate price path (simplified - in real backtest, use historical data)
    const exitPrice = this.simulatePricePath(entryPrice, direction, stopLossPct, takeProfitPct);
    
    // Apply slippage to exit
    const exitSlippageFactor = direction === 'long' ? (1 - this.slippage) : (1 + this.slippage);
    const adjustedExit = exitPrice * exitSlippageFactor;
    
    // Calculate PnL
    const pnl = direction === 'long' 
      ? (adjustedExit - adjustedEntry) * (size / entryPrice)
      : (adjustedEntry - adjustedExit) * (size / entryPrice);
    
    const netPnl = pnl - commissionCost;
    
    return {
      direction,
      entryPrice: adjustedEntry,
      exitPrice: adjustedExit,
      size,
      pnl: netPnl,
      pnlPct: netPnl / size * 100,
      commission: commissionCost,
      exitReason: this.determineExitReason(entryPrice, exitPrice, direction, stopLossPct, takeProfitPct),
    };
  }
  
  // Simplified price path simulation
  simulatePricePath(entryPrice, direction, stopLossPct, takeProfitPct) {
    // Random walk with slight upward bias (historical market tendency)
    const numSteps = 100;
    const volatility = 0.02; // 2% per 100 steps
    let price = entryPrice;
    
    for (let i = 0; i < numSteps; i++) {
      const change = (Math.random() - 0.48) * volatility; // Slight upward bias
      price *= (1 + change);
      
      // Check stop loss
      const lossPct = direction === 'long' 
        ? (entryPrice - price) / entryPrice
        : (price - entryPrice) / entryPrice;
      
      if (lossPct >= stopLossPct) {
        return direction === 'long' ? entryPrice * (1 - stopLossPct) : entryPrice * (1 + stopLossPct);
      }
      
      // Check take profit
      const profitPct = direction === 'long'
        ? (price - entryPrice) / entryPrice
        : (entryPrice - price) / entryPrice;
      
      if (profitPct >= takeProfitPct) {
        return direction === 'long' ? entryPrice * (1 + takeProfitPct) : entryPrice * (1 - takeProfitPct);
      }
    }
    
    // Exit at end of path
    return price;
  }
  
  determineExitReason(entryPrice, exitPrice, direction, stopLossPct, takeProfitPct) {
    const changePct = direction === 'long'
      ? (exitPrice - entryPrice) / entryPrice
      : (entryPrice - exitPrice) / entryPrice;
    
    if (changePct >= takeProfitPct - 0.01) return 'take_profit';
    if (changePct <= -(stopLossPct - 0.01)) return 'stop_loss';
    return 'time_exit';
  }
  
  // Run backtest on historical signals
  backtestSignals(signals, prices) {
    this.trades = [];
    let capital = this.initialCapital;
    let position = null;
    
    for (let i = 0; i < signals.length; i++) {
      const signal = signals[i];
      const price = prices[i];
      
      if (!price || !signal.signal) continue;
      
      if (signal.action === 'buy' && !position && signal.confidence > 0.5) {
        // Enter position
        const positionSize = capital * 0.1; // 10% position
        position = {
          entryPrice: price,
          size: positionSize,
          direction: 'long',
          entryTime: i,
        };
        capital -= positionSize;
        
      } else if ((signal.action === 'sell' || signal.action === 'close') && position) {
        // Close position
        const trade = this.executeTrade(position.direction, position.entryPrice, position.size);
        this.trades.push(trade);
        capital += position.size + trade.pnl;
        position = null;
      }
    }
    
    // Close any open position at the end
    if (position && prices.length > 0) {
      const trade = this.executeTrade(position.direction, position.entryPrice, position.size);
      this.trades.push(trade);
      capital += position.size + trade.pnl;
    }
    
    return this.calculateMetrics(signals.length);
  }
  
  // Run backtest on signal generator function
  backtestSignalGenerator(signalGenerator, priceData, params = {}) {
    const { 
      minConfidence = 0.5, 
      maxPositionSize = 0.1,
      stopLossPct = 0.08,
      takeProfitPct = 0.20,
    } = params;
    
    this.trades = [];
    let capital = this.initialCapital;
    let position = null;
    
    // Iterate through price data
    for (let i = 20; i < priceData.length; i++) {
      const historicalPrices = priceData.slice(0, i + 1);
      const signal = signalGenerator(historicalPrices);
      
      if (!signal) continue;
      
      const currentPrice = priceData[i];
      
      // Check if we should close existing position
      if (position) {
        const pnlPct = position.direction === 'long'
          ? (currentPrice - position.entryPrice) / position.entryPrice
          : (position.entryPrice - currentPrice) / position.entryPrice;
        
        // Check stop loss / take profit
        if (pnlPct >= takeProfitPct || pnlPct <= -stopLossPct) {
          const exitPrice = pnlPct >= takeProfitPct 
            ? position.entryPrice * (1 + takeProfitPct)
            : position.entryPrice * (1 - stopLossPct);
          
          const trade = this.executeTrade(position.direction, position.entryPrice, position.size, {
            stopLossPct,
            takeProfitPct,
          });
          
          this.trades.push(trade);
          capital += position.size + trade.pnl;
          position = null;
        }
      }
      
      // Check if we should open new position
      if (!position && signal.confidence >= minConfidence) {
        const positionSize = capital * maxPositionSize;
        position = {
          entryPrice: currentPrice,
          size: positionSize,
          direction: signal.action === 'buy' ? 'long' : 'short',
          signal: signal.reason,
          confidence: signal.confidence,
        };
        capital -= positionSize;
      }
    }
    
    // Close final position
    if (position && priceData.length > 0) {
      const trade = this.executeTrade(position.direction, position.entryPrice, position.size, {
        stopLossPct,
        takeProfitPct,
      });
      this.trades.push(trade);
      capital += position.size + trade.pnl;
    }
    
    return this.calculateMetrics(priceData.length);
  }
  
  calculateMetrics(totalBars) {
    if (this.trades.length === 0) {
      this.metrics = {
        totalTrades: 0,
        winRate: '0.0%',
        avgWin: 0,
        avgLoss: 0,
        profitFactor: '0.00',
        maxDrawdown: '0.0%',
        sharpeRatio: '0.00',
        finalCapital: this.initialCapital,
        returnPct: '0.0%',
        profit: 0,
      };
      return this.metrics;
    }
    
    const wins = this.trades.filter(t => t.pnl > 0);
    const losses = this.trades.filter(t => t.pnl <= 0);
    
    const winCount = wins.length;
    const lossCount = losses.length;
    const winRate = this.trades.length > 0 ? winCount / this.trades.length * 100 : 0;
    
    const avgWin = winCount > 0 ? wins.reduce((a, b) => a + b.pnl, 0) / winCount : 0;
    const avgLoss = lossCount > 0 ? Math.abs(losses.reduce((a, b) => a + b.pnl, 0) / lossCount) : 1;
    
    const totalWins = wins.reduce((a, b) => a + b.pnl, 0);
    const totalLosses = Math.abs(losses.reduce((a, b) => a + b.pnl, 0));
    const profitFactor = totalLosses > 0 ? totalWins / totalLosses : totalWins > 0 ? Infinity : 0;
    
    // Calculate equity curve and drawdown
    let equity = this.initialCapital;
    let peakEquity = equity;
    let maxDrawdown = 0;
    
    for (const trade of this.trades) {
      equity += trade.pnl;
      if (equity > peakEquity) peakEquity = equity;
      const drawdown = (peakEquity - equity) / peakEquity;
      if (drawdown > maxDrawdown) maxDrawdown = drawdown;
    }
    
    // Sharpe ratio (simplified) - handle empty trades
    const returns = this.trades.length > 0 ? this.trades.map(t => t.pnl / this.initialCapital) : [0];
    const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
    const stdReturn = Math.sqrt(returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length);
    const sharpeRatio = stdReturn > 0 ? (avgReturn / stdReturn) * Math.sqrt(252) : 0;
    
    const finalCapital = equity;
    const returnPct = (finalCapital - this.initialCapital) / this.initialCapital * 100;
    
    this.metrics = {
      totalTrades: this.trades.length,
      winRate: winRate.toFixed(1) + '%',
      avgWin,
      avgLoss,
      profitFactor: profitFactor === Infinity ? '∞' : profitFactor.toFixed(2),
      maxDrawdown: (maxDrawdown * 100).toFixed(1) + '%',
      sharpeRatio: sharpeRatio.toFixed(2),
      finalCapital,
      returnPct: returnPct.toFixed(1) + '%',
      profit: finalCapital - this.initialCapital,
    };
    
    return this.metrics;
  }
  
  printResults(strategyName = 'Strategy') {
    console.log(`\n${'='.repeat(50)}`);
    console.log(`📊 BACKTEST RESULTS: ${strategyName}`);
    console.log(`${'='.repeat(50)}`);
    console.log(`   Total Trades:     ${this.metrics.totalTrades}`);
    console.log(`   Win Rate:         ${this.metrics.winRate}`);
    console.log(`   Avg Win:          $${this.metrics.avgWin.toFixed(2)}`);
    console.log(`   Avg Loss:         $${this.metrics.avgLoss.toFixed(2)}`);
    console.log(`   Profit Factor:    ${this.metrics.profitFactor}`);
    console.log(`   Max Drawdown:     ${this.metrics.maxDrawdown}`);
    console.log(`   Sharpe Ratio:     ${this.metrics.sharpeRatio}`);
    console.log(`   Final Capital:    $${this.metrics.finalCapital.toFixed(2)}`);
    console.log(`   Return:           ${this.metrics.returnPct}`);
    console.log(`   Profit:           $${this.metrics.profit.toFixed(2)}`);
    console.log(`${'='.repeat(50)}\n`);
  }
  
  // Compare multiple strategies
  compareStrategies(strategies, priceData) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`📈 STRATEGY COMPARISON`);
    console.log(`${'='.repeat(60)}`);
    console.log(`| Strategy          | Trades | Win Rate | Profit  | Return | Sharpe |`);
    console.log(`|-------------------|--------|----------|---------|--------|--------|`);
    
    const results = [];
    
    for (const { name, signalGenerator, params } of strategies) {
      const backtester = new Backtester({ initialCapital: this.initialCapital });
      const metrics = backtester.backtestSignalGenerator(signalGenerator, priceData, params);
      
      results.push({ name, metrics });
      
      console.log(`| ${name.padEnd(17)} | ${String(metrics.totalTrades).padEnd(6)} | ${metrics.winRate.padEnd(8)} | $${metrics.profit.toFixed(0).padEnd(5)} | ${metrics.returnPct.padEnd(6)} | ${metrics.sharpeRatio.padEnd(6)} |`);
    }
    
    console.log(`${'='.repeat(60)}\n`);
    
    // Sort by profit
    results.sort((a, b) => b.metrics.profit - a.metrics.profit);
    
    return results;
  }
  
  // Optimize parameters
  optimizeParameters(signalGenerator, priceData, paramRanges) {
    const results = [];
    
    // Grid search
    const keys = Object.keys(paramRanges);
    
    function* generateCombinations() {
      const lengths = keys.map(k => paramRanges[k].length);
      
      function* indexGenerator(i = 0) {
        if (i === keys.length) {
          yield {};
          return;
        }
        
        for (const value of paramRanges[keys[i]]) {
          for (const combo of indexGenerator(i + 1)) {
            yield { [keys[i]]: value, ...combo };
          }
        }
      }
      
      yield* indexGenerator();
    }
    
    console.log('🔍 Running parameter optimization...');
    
    for (const params of generateCombinations()) {
      if (Object.keys(params).length === 0) continue;
      
      const backtester = new Backtester({ initialCapital: this.initialCapital });
      const metrics = backtester.backtestSignalGenerator(signalGenerator, priceData, params);
      
      results.push({ params, metrics });
    }
    
    // Sort by profit
    results.sort((a, b) => b.metrics.profit - a.metrics.profit);
    
    console.log(`\n✅ Top 5 Parameter Sets:`);
    for (let i = 0; i < Math.min(5, results.length); i++) {
      const r = results[i];
      console.log(`   ${i + 1}. ${JSON.stringify(r.params)} => Profit: $${r.metrics.profit.toFixed(2)}, Win: ${r.metrics.winRate}`);
    }
    
    return results;
  }
}

// ===== STRATEGY TEMPLATES =====

function trendFollowingStrategy(prices) {
  if (!prices || prices.length < 20) return null;
  
  // Simple moving average crossover
  const smaShort = prices.slice(-10).reduce((a, b) => a + b, 0) / 10;
  const smaLong = prices.slice(-20).reduce((a, b) => a + b, 0) / 20;
  
  const currentPrice = prices[prices.length - 1];
  const prevShort = prices.slice(-11, -1).reduce((a, b) => a + b, 0) / 10;
  const prevLong = prices.slice(-21, -1).reduce((a, b) => a + b, 0) / 20;
  
  // Golden cross (bullish)
  if (smaShort > smaLong && prevShort <= prevLong) {
    const strength = (smaShort - smaLong) / smaLong;
    return {
      action: 'buy',
      confidence: Math.min(strength * 50 + 0.5, 0.95),
      reason: 'Golden cross',
    };
  }
  
  // Death cross (bearish)
  if (smaShort < smaLong && prevShort >= prevLong) {
    const strength = (smaLong - smaShort) / smaLong;
    return {
      action: 'sell',
      confidence: Math.min(strength * 50 + 0.5, 0.95),
      reason: 'Death cross',
    };
  }
  
  return null;
}

function meanReversionStrategy(prices) {
  if (!prices || prices.length < 20) return null;
  
  const sma = prices.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const currentPrice = prices[prices.length - 1];
  const deviation = (currentPrice - sma) / sma;
  
  // Price significantly below SMA - oversold
  if (deviation < -0.05) {
    return {
      action: 'buy',
      confidence: Math.min(Math.abs(deviation) * 10, 0.9),
      reason: `Oversold: ${(deviation * 100).toFixed(1)}% below SMA`,
    };
  }
  
  // Price significantly above SMA - overbought
  if (deviation > 0.05) {
    return {
      action: 'sell',
      confidence: Math.min(Math.abs(deviation) * 10, 0.9),
      reason: `Overbought: ${(deviation * 100).toFixed(1)}% above SMA`,
    };
  }
  
  return null;
}

// ===== EXPORTS =====

module.exports = {
  Backtester,
  trendFollowingStrategy,
  meanReversionStrategy,
};
