/**
 * MULTI-STRATEGY TRADING ORCHESTRATOR
 * Runs multiple trading strategies in parallel with intelligent capital allocation
 * 
 * Usage: node orchestrator.js
 * 
 * Features:
 * - Multiple strategy instances
 * - Capital allocation per strategy
 * - Risk management across portfolio
 * - Performance tracking per strategy
 * - Automatic rebalancing
 */

const fs = require('fs');
const path = require('path');

const ORCHESTRATOR_DIR = __dirname;

// ===== LIVE TRADING CONFIG =====
let jupiter = null;
let LIVE_MODE = false;

async function initLiveTrading() {
  try {
    jupiter = require('./jupiter-swap.js');
    jupiter.init();
    LIVE_MODE = true;
    console.log('✅ Live trading initialized');
    return true;
  } catch (e) {
    console.log('⚠️ Live trading not available:', e.message);
    return false;
  }
}

// ===== CONFIG =====
const GLOBAL_CONFIG = {
  TOTAL_CAPITAL: 367, // Total portfolio capital (~3.67 SOL)
  REBALANCE_INTERVAL: 3600000, // 1 hour
  MAX_STRATEGIES_ACTIVE: 5,
  GLOBAL_STOP_LOSS: 0.15, // 15% portfolio loss = stop everything
  DAILY_LOSS_LIMIT: 0.05, // 5% daily loss = pause trading
  MIN_CONFIDENCE: 0.40,
  TELEGRAM_NOTIFICATIONS: true,
  LOG_LEVEL: 'INFO', // DEBUG, INFO, WARN, ERROR
};

const STRATEGY_TYPES = {
  CRYPTO_TREND: 'crypto_trend',
  CRYPTO_CONTRARIAN: 'crypto_contrarian',
  CRYPTO_MOMENTUM: 'crypto_momentum',
  CRYPTO_DEGENERATE: 'crypto_degenerate', // 5min scalping
  POLY_MOMENTUM: 'poly_momentum',
  POLY_CONTRARIAN: 'poly_contrarian',
  POLY_ARBITRAGE: 'poly_arbitrage',
};

// Strategy configurations - SIZED FOR ~$459 CAPITAL
const STRATEGY_CONFIGS = {
  // CRYPTO STRATEGIES - Using Jupiter
  crypto_trend: {
    name: 'Crypto Trend Follower',
    type: STRATEGY_TYPES.CRYPTO_TREND,
    enabled: true,
    capitalAllocation: 0.30, // 30% of capital (~$137)
    minCapital: 50,
    maxCapital: 500,
    riskLevel: 'medium',
    maxPositionSize: 0.20, // 20% of strategy = ~$27 per trade
    stopLoss: 0.05,
    takeProfit: 0.10,
    confidenceThreshold: 0.45,
    cooldown: 600000, // 10 min (reduced for more trades)
    params: {
      trendPeriod: 20,
      rsiPeriod: 14,
      volumeThreshold: 1.5,
    }
  },
  
  crypto_contrarian: {
    name: 'Crypto Contrarian',
    type: STRATEGY_TYPES.CRYPTO_CONTRARIAN,
    enabled: true,
    capitalAllocation: 0.20, // 20% of capital (~$92)
    minCapital: 30,
    maxCapital: 200,
    riskLevel: 'high',
    maxPositionSize: 0.20,
    stopLoss: 0.08,
    takeProfit: 0.15,
    confidenceThreshold: 0.40,
    cooldown: 600000, // 10 min
    params: {
      rsiOversold: 35,
      rsiOverbought: 65,
      meanReversionPeriod: 20,
    }
  },
  
  crypto_momentum: {
    name: 'Crypto Momentum',
    type: STRATEGY_TYPES.CRYPTO_MOMENTUM,
    enabled: true,
    capitalAllocation: 0.15, // 15% of capital (~$69)
    minCapital: 30,
    maxCapital: 200,
    riskLevel: 'high',
    maxPositionSize: 0.20,
    stopLoss: 0.05,
    takeProfit: 0.12,
    confidenceThreshold: 0.40,
    cooldown: 600000, // 10 min
    params: {
      momentumPeriod: 10,
      volumeSpike: 2.0,
      minGain: 0.03,
    }
  },
  
  // NEW: 5-Minute Degenerate Scalping (Jupiter prediction-style)
  crypto_degenerate: {
    name: '5min Degenerate',
    type: STRATEGY_TYPES.CRYPTO_DEGENERATE,
    enabled: true,
    capitalAllocation: 0.20, // 20% of capital (~$92)
    minCapital: 30,
    maxCapital: 200,
    riskLevel: 'high',
    maxPositionSize: 0.25, // 25% of strategy = ~$23 per trade
    stopLoss: 0.03, // Tight stop - 3%
    takeProfit: 0.05, // Quick 5% targets
    confidenceThreshold: 0.55,
    cooldown: 300000, // 5 minutes between trades
    params: {
      timeframe: '5m',
      minVolume: 1000000,
      momentumPeriod: 5,
      minMomentum: 0.015, // 1.5% min move
    }
  },
  
  // POLYMARKET STRATEGIES - DISABLED (switching to Jupiter only)
  poly_momentum: {
    name: 'Poly Momentum',
    type: STRATEGY_TYPES.POLY_MOMENTUM,
    enabled: false, // DISABLED
    capitalAllocation: 0.00,
    minCapital: 0,
    maxCapital: 0,
    riskLevel: 'medium',
    maxPositionSize: 0,
    stopLoss: 0,
    takeProfit: 0,
    confidenceThreshold: 0.50,
    cooldown: 7200000,
    params: {}
  },
  
  poly_contrarian: {
    name: 'Poly Contrarian',
    type: STRATEGY_TYPES.POLY_CONTRARIAN,
    enabled: false, // DISABLED
    capitalAllocation: 0.00,
    minCapital: 0,
    maxCapital: 0,
    riskLevel: 'high',
    maxPositionSize: 0,
    stopLoss: 0,
    takeProfit: 0,
    confidenceThreshold: 0.50,
    cooldown: 10800000,
    params: {}
  },
};

// ===== STATE MANAGEMENT =====
class OrchestratorState {
  constructor() {
    this.strategies = {};
    this.portfolio = {
      totalCapital: GLOBAL_CONFIG.TOTAL_CAPITAL,
      availableCapital: GLOBAL_CONFIG.TOTAL_CAPITAL,
      usedCapital: 0,
      dailyPnl: 0,
      totalPnl: 0,
      dailyTrades: 0,
      lastResetDate: new Date().toDateString(),
    };
    this.lastRebalance = Date.now();
    this.isRunning = false;
    this.paused = false;
    this.pauseReason = null;
  }
  
  save() {
    const statePath = path.join(ORCHESTRATOR_DIR, 'orchestrator-state.json');
    fs.writeFileSync(statePath, JSON.stringify(this, null, 2));
  }
  
  load() {
    const statePath = path.join(ORCHESTRATOR_DIR, 'orchestrator-state.json');
    try {
      const data = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      Object.assign(this.portfolio, data.portfolio || {});
      this.strategies = data.strategies || {};
      this.lastRebalance = data.lastRebalance || Date.now();
      this.isRunning = data.isRunning || false;
    } catch (e) {
      // Fresh start
    }
  }
}

// ===== STRATEGY BASE CLASS =====
class TradingStrategy {
  constructor(config, state) {
    this.config = config;
    this.state = state;
    this.name = config.name;
    this.type = config.type;
    this.enabled = config.enabled;
    this.lastTradeTime = 0;
    this.positions = [];
    this.trades = [];
    this.signalHistory = [];
    this.wonTrades = 0;
    this.lostTrades = 0;
    this.totalPnl = 0;
    this.dailyPnl = 0;
    this.dailyTrades = 0;
    this.lastResetDate = new Date().toDateString();
  }
  
  getCapital() {
    return GLOBAL_CONFIG.TOTAL_CAPITAL * this.config.capitalAllocation;
  }
  
  canTrade() {
    if (!this.enabled) return { canTrade: false, reason: 'Strategy disabled' };
    if (Date.now() - this.lastTradeTime < this.config.cooldown) {
      return { canTrade: false, reason: 'Cooldown active' };
    }
    return { canTrade: true };
  }
  
  calculatePositionSize(confidence) {
    const capital = this.getCapital();
    const maxSize = capital * this.config.maxPositionSize;
    return Math.min(maxSize * confidence, maxSize);
  }
  
  recordTrade(trade) {
    this.trades.push({
      ...trade,
      timestamp: Date.now(),
    });
    this.lastTradeTime = Date.now();
    this.dailyTrades++;
    
    if (trade.pnl > 0) {
      this.wonTrades++;
      this.totalPnl += trade.pnl;
      this.dailyPnl += trade.pnl;
    } else {
      this.lostTrades++;
      this.totalPnl += trade.pnl;
      this.dailyPnl += trade.pnl;
    }
  }
  
  getStats() {
    const total = this.wonTrades + this.lostTrades;
    return {
      name: this.name,
      type: this.type,
      enabled: this.enabled,
      capital: this.getCapital(),
      totalPnl: this.totalPnl,
      dailyPnl: this.dailyPnl,
      winRate: total > 0 ? (this.wonTrades / total * 100).toFixed(1) + '%' : 'N/A',
      totalTrades: total,
      dailyTrades: this.dailyTrades,
      positions: this.positions.length,
    };
  }
  
  resetDaily() {
    if (this.lastResetDate !== new Date().toDateString()) {
      this.dailyPnl = 0;
      this.dailyTrades = 0;
      this.lastResetDate = new Date().toDateString();
    }
  }
}

// ===== ORCHESTRATOR =====
class TradingOrchestrator {
  constructor() {
    this.state = new OrchestratorState();
    this.strategyInstances = {};
    this.logger = [];
  }
  
  initialize() {
    this.state.load();
    
    // Initialize strategy instances
    for (const [key, config] of Object.entries(STRATEGY_CONFIGS)) {
      if (this.state.strategies[key]) {
        // Restore existing strategy state
        this.strategyInstances[key] = Object.assign(
          new TradingStrategy(config, this.state),
          this.state.strategies[key]
        );
      } else {
        // Create new strategy
        this.strategyInstances[key] = new TradingStrategy(config, this.state);
      }
    }
    
    // Calculate initial capital allocation
    this.rebalanceCapital();
    
    log('🚀 Multi-Strategy Orchestrator initialized');
    log(`📊 Running ${Object.keys(this.strategyInstances).filter(k => this.strategyInstances[k].enabled).length} strategies`);
  }
  
  rebalanceCapital() {
    let totalAllocated = 0;
    
    for (const strategy of Object.values(this.strategyInstances)) {
      if (strategy.enabled) {
        const allocation = GLOBAL_CONFIG.TOTAL_CAPITAL * strategy.config.capitalAllocation;
        totalAllocated += allocation;
      }
    }
    
    this.state.portfolio.availableCapital = GLOBAL_CONFIG.TOTAL_CAPITAL - totalAllocated;
    this.state.portfolio.usedCapital = totalAllocated;
    this.state.lastRebalance = Date.now();
    
    log(`💰 Capital rebalanced: $${totalAllocated.toFixed(2)} allocated, $${this.state.portfolio.availableCapital.toFixed(2)} available`);
  }
  
  async generateSignals() {
    const signals = {};
    
    // Generate signals for each strategy type
    for (const [key, strategy] of Object.entries(this.strategyInstances)) {
      if (!strategy.enabled) continue;
      
      const canTrade = strategy.canTrade();
      if (!canTrade.canTrade) {
        log(`${strategy.name}: ${canTrade.reason}`);
        continue;
      }
      
      // Generate signals based on strategy type
      const signal = await this.callStrategy(key);
      if (signal && signal.confidence >= strategy.config.confidenceThreshold) {
        signals[key] = signal;
      }
    }
    
    return signals;
  }
  
  async callStrategy(key) {
    const strategy = this.strategyInstances[key];
    
    switch (strategy.type) {
      case STRATEGY_TYPES.CRYPTO_TREND:
        return await this.cryptoTrendSignal(strategy);
      case STRATEGY_TYPES.CRYPTO_CONTRARIAN:
        return await this.cryptoContrarianSignal(strategy);
      case STRATEGY_TYPES.CRYPTO_MOMENTUM:
        return await this.cryptoMomentumSignal(strategy);
      case STRATEGY_TYPES.CRYPTO_DEGENERATE:
        return await this.cryptoDegenerateSignal(strategy);
      case STRATEGY_TYPES.POLY_MOMENTUM:
        return await this.polyMomentumSignal(strategy);
      case STRATEGY_TYPES.POLY_CONTRARIAN:
        return await this.polyContrarianSignal(strategy);
      default:
        return null;
    }
  }
  
  // ===== CRYPTO SIGNALS (V2) =====
  async cryptoTrendSignal(strategy) {
    // Trend-following: Buy when price trending up with RSI confirming
    try {
      const { getCryptoPrices, analyzeTrend, analyzeMomentum } = require('./crypto-signals-v2.js');
      const prices = await getCryptoPrices();
      
      // Find best opportunity using V2 signals
      let bestSignal = null;
      for (const [symbol, data] of Object.entries(prices)) {
        const trend = analyzeTrend(data.prices, strategy.config.params.trendPeriod);
        const momentum = analyzeMomentum(data.prices, data.volume, strategy.config.params);
        
        // V2: Use combined confidence from trend + momentum
        if (trend.strength > 0.02 && trend.confidence > 0.3) {
          const confidence = Math.min(trend.confidence * 0.6 + momentum.score * 0.4, 1);
          if (!bestSignal || confidence > bestSignal.confidence) {
            bestSignal = {
              symbol,
              direction: trend.direction === 'bullish' ? 'long' : 'short',
              confidence: confidence,
              entryPrice: data.price,
              reason: `Trend: ${trend.direction}, ${(trend.strength * 100).toFixed(0)}% strength, ${(trend.alignment * 100).toFixed(0)}% aligned`,
              strategy: strategy.name,
            };
          }
        }
      }
      return bestSignal;
    } catch (e) {
      log(`Trend signal error: ${e.message}`, 'ERROR');
      return null;
    }
  }
  
  async cryptoContrarianSignal(strategy) {
    // Contrarian: Buy oversold, sell overbought (V2)
    try {
      const { getCryptoPrices, analyzeContrarian } = require('./crypto-signals-v2.js');
      const prices = await getCryptoPrices();
      const params = strategy.config.params;
      
      let bestSignal = null;
      for (const [symbol, data] of Object.entries(prices)) {
        const contrarian = analyzeContrarian(data.prices, params);
        
        if (contrarian.opportunity && contrarian.confidence > 0.3) {
          if (!bestSignal || contrarian.confidence > bestSignal.confidence) {
            bestSignal = {
              symbol,
              direction: contrarian.direction,
              confidence: contrarian.confidence,
              entryPrice: data.price,
              reason: contrarian.reason,
              strategy: strategy.name,
            };
          }
        }
      }
      return bestSignal;
    } catch (e) {
      log(`Contrarian signal error: ${e.message}`, 'ERROR');
      return null;
    }
  }
  
  async cryptoMomentumSignal(strategy) {
    // Momentum: Buy strong gainers with volume spike (V2)
    try {
      const { getCryptoPrices, analyzeMomentum } = require('./crypto-signals-v2.js');
      const prices = await getCryptoPrices();
      const params = strategy.config.params;
      
      let bestSignal = null;
      for (const [symbol, data] of Object.entries(prices)) {
        const momentum = analyzeMomentum(data.prices, data.volume, params);
        
        // V2: Better momentum scoring with multi-indicator confirmation
        if (momentum.score > 0.5) {
          if (!bestSignal || momentum.score > bestSignal.confidence) {
            bestSignal = {
              symbol,
              direction: 'long',
              confidence: momentum.score,
              entryPrice: data.price,
              reason: `Momentum: ${(momentum.gain * 100).toFixed(1)}% gain, RSI: ${momentum.rsi.toFixed(0)}, Pattern: ${momentum.pattern}`,
              strategy: strategy.name,
            };
          }
        }
      }
      return bestSignal;
    } catch (e) {
      log(`Momentum signal error: ${e.message}`, 'ERROR');
      return null;
    }
  }
  
  // ===== 5-MIN DEGENERATE SCALPING =====
  async cryptoDegenerateSignal(strategy) {
    // High-frequency 5-minute scalping - quick in and out
    try {
      const { getCryptoPrices, analyzeMomentum } = require('./crypto-signals-v2.js');
      const prices = await getCryptoPrices();
      const params = strategy.config.params;
      
      let bestSignal = null;
      
      for (const [symbol, data] of Object.entries(prices)) {
        // Skip if low volume
        if (data.volume < params.minVolume) continue;
        
        // Calculate 5-minute style momentum (short-term)
        const shortPrices = data.prices.slice(-10); // Very short term
        if (shortPrices.length < 5) continue;
        
        const currentPrice = shortPrices[shortPrices.length - 1];
        const earlierPrice = shortPrices[0];
        const momentumPct = (currentPrice - earlierPrice) / earlierPrice;
        
        // Quick RSI check
        const { calculateRSI } = require('./crypto-signals-v2.js');
        const rsi = calculateRSI(data.prices, 7); // Shorter RSI
        
        // Degenerate conditions: strong short-term move with momentum
        const isUpMomentum = momentumPct > params.minMomentum; // Moving up
        const isOversold = rsi < 65 && rsi > 35; // Not overbought
        const hasVolume = data.volume > params.minVolume;
        
        if (isUpMomentum && isOversold && hasVolume) {
          // Calculate confidence based on momentum strength
          const confidence = Math.min(0.55 + (momentumPct * 10), 0.95);
          
          if (!bestSignal || confidence > bestSignal.confidence) {
            bestSignal = {
              symbol,
              direction: 'long',
              confidence: confidence,
              entryPrice: data.price,
              reason: `🔥 5min SCALP: ${(momentumPct * 100).toFixed(1)}% move, RSI: ${rsi.toFixed(0)}, Vol: $${(data.volume/1e6).toFixed(0)}M`,
              strategy: strategy.name,
            };
          }
        }
        
        // Also check for DOWN momentum (short selling not supported easily, skip for now)
      }
      
      return bestSignal;
    } catch (e) {
      log(`Degenerate signal error: ${e.message}`, 'ERROR');
      return null;
    }
  }
  
  // ===== POLYMARKET SIGNALS (V2) =====
  async polyMomentumSignal(strategy) {
    // Momentum: Follow trending markets (V2)
    try {
      const { getPolyMarkets, analyzePolyMomentum } = require('./poly-signals-v2.js');
      const markets = await getPolyMarkets();
      const params = strategy.config.params;
      
      let bestSignal = null;
      for (const market of markets) {
        const momentum = analyzePolyMomentum(market, params);
        
        if (momentum.score > 0.5 && market.volume > params.volumeThreshold) {
          const direction = market.yesPrice > 0.5 ? 'yes' : 'no';
          bestSignal = {
            symbol: market.question,
            marketId: market.id,
            direction,
            confidence: momentum.score,
            entryPrice: direction === 'yes' ? market.yesPrice : market.noPrice,
            reason: `Momentum: ${momentum.reason}, Vol: $${(market.volume/1000).toFixed(1)}K`,
            strategy: strategy.name,
          };
        }
      }
      return bestSignal;
    } catch (e) {
      log(`Poly momentum signal error: ${e.message}`, 'ERROR');
      return null;
    }
  }
  
  async polyContrarianSignal(strategy) {
    // Contrarian: Fade overreaction
    try {
      const { getPolyMarkets, analyzePolyContrarian } = require('./poly-signals-v2.js');
      const markets = await getPolyMarkets();
      const params = strategy.config.params;
      
      let bestSignal = null;
      for (const market of markets) {
        const contrarian = analyzePolyContrarian(market, params);
        
        if (contrarian.opportunity && market.volume > params.minVolume) {
          bestSignal = {
            symbol: market.question,
            marketId: market.id,
            direction: contrarian.direction,
            confidence: contrarian.confidence,
            entryPrice: contrarian.direction === 'yes' ? market.yesPrice : market.noPrice,
            reason: `Contrarian: ${contrarian.reason}`,
            strategy: strategy.name,
          };
        }
      }
      return bestSignal;
    } catch (e) {
      log(`Poly contrarian signal error: ${e.message}`, 'ERROR');
      return null;
    }
  }
  
  async executeTrade(signal) {
    const strategy = this.strategyInstances[Object.keys(this.strategyInstances).find(k => 
      this.strategyInstances[k].name === signal.strategy
    )];
    
    if (!strategy) {
      log(`Unknown strategy: ${signal.strategy}`, 'ERROR');
      return;
    }
    
    const positionSize = strategy.calculatePositionSize(signal.confidence);
    
    const trade = {
      symbol: signal.symbol,
      direction: signal.direction,
      entryPrice: signal.entryPrice,
      size: positionSize,
      confidence: signal.confidence,
      reason: signal.reason,
    };
    
    let result;
    
    // Live trading (if enabled and it's a crypto trade)
    if (LIVE_MODE && signal.marketId === undefined) {
      try {
        log(`🔥 LIVE TRADE EXECUTION: ${signal.direction.toUpperCase()} ${signal.symbol} with $${positionSize}`);
        
        // Execute real swap on Jupiter
        const mint = this.getTokenMint(signal.symbol);
        if (mint && signal.direction === 'long') {
          try {
            const solAmount = positionSize / signal.entryPrice;
            const swapResult = await jupiter.buyToken(mint, solAmount);
            if (swapResult && swapResult.success) {
              log(`   ✅ LIVE SWAP EXECUTED!`);
              log(`   Signature: ${swapResult.signature}`);
              log(`   Input: ${swapResult.inputAmount} SOL -> Output: ${swapResult.outputAmount} tokens`);
              result = { ...trade, exitPrice: signal.entryPrice, pnl: 0, mode: 'LIVE', swapResult };
              log(`   💰 REAL TRADE RECORDED - $${solAmount} SOL used`);
            } else {
              log(`   ❌ JUPITER FAILED - NOT RECORDING TRADE`);
              log(`   ⚠️ Error: ${swapResult?.error || 'API unreachable'}`);
              log(`   📌 Trade was SIMULATED only - no real money used`);
              // DON'T record failed Jupiter trades
              return;
            }
          } catch (swapError) {
            log(`   ⚠️ Swap error: ${swapError.message} - using simulation`);
            result = await this.simulateTrade(trade);
            result.mode = 'live-fallback';
          }
        } else {
          result = await this.simulateTrade(trade);
          result.mode = 'live';
        }
      } catch (e) {
        log(`Live trade error: ${e.message} - falling back to simulation`, 'ERROR');
        result = await this.simulateTrade(trade);
      }
    } else {
      // Practice mode
      result = await this.simulateTrade(trade);
    }
    
    strategy.recordTrade(result);
    
    log(`🎯 ${strategy.name}: ${signal.direction.toUpperCase()} ${signal.symbol} @ $${signal.entryPrice} (${(signal.confidence * 100).toFixed(0)}%)`);
    log(`   Reason: ${signal.reason}`);
    
    // Update portfolio
    this.state.portfolio.dailyPnl += result.pnl;
    this.state.portfolio.totalPnl += result.pnl;
    this.state.portfolio.dailyTrades++;
    
    this.save();
  }
  
  // Get token mint address
  getTokenMint(symbol) {
    const mints = {
      'SOL': 'So11111111111111111111111111111111111111112',
      'BTC': '9n4nbM75f5Ui33ZbPYXn59EwSgE8CGsHtAeTH5YFeJ9E',
      'ETH': '2FPyTwcZLUg1MDrwsyoP4D6s1tM7hZgHYqepWdKKYjM',
      'BONK': 'DezXAZ8z7PnrnRJjz3wXBoZkixF6pf7BiYfCHkV2tF',
      'PEPE': 'HZ1JovNiVvGrGNiiYvEozD2h1o9T5J2N5sAa4xFP5dM',
      'WIF': '85VBFQZC9TZkfaptBWqv14ALD9fJNUKtSA41kHm28896',
      'POPCAT': '7wcNFrG5UTiY4h1W7rY8kG2QqHk4L8fR3tV6pX9yW1Z',
      'SUI': 'SuiatNKZux3fE3w5qV1oJ9d2cYz1Jv3h2v1xT9w5Yq',
      'DOGE': 'Ez2zV24tEEwEbocG66s72hpZ6E8A3mYMSQaR1ckJquW',
      'TONCOIN': 'EQBQ4q3xpQ2yqxMd3SHqY6a1w8cN7H8YvKEx6GHvPp4H',
      'TON': 'EQBQ4q3xpQ2yqxMd3SHqY6a1w8cN7H8YvKEx6GHvPp4H',
    };
    return mints[symbol.toUpperCase()];
  }
  
  async simulateTrade(trade) {
    // Practice mode simulation
    const exitMultiplier = 1 + (Math.random() * 0.4 - 0.15); // -15% to +25%
    const pnl = trade.size * (exitMultiplier - 1);
    
    return {
      ...trade,
      exitPrice: trade.entryPrice * exitMultiplier,
      pnl,
      mode: 'practice',
      exitTime: Date.now(),
    };
  }
  
  checkRiskLimits() {
    const { portfolio } = this.state;
    
    // Check daily loss limit
    if (portfolio.dailyPnl < -GLOBAL_CONFIG.DAILY_LOSS_LIMIT * GLOBAL_CONFIG.TOTAL_CAPITAL) {
      this.pause('Daily loss limit reached');
      return false;
    }
    
    // Check global stop loss
    if (portfolio.totalPnl < -GLOBAL_CONFIG.GLOBAL_STOP_LOSS * GLOBAL_CONFIG.TOTAL_CAPITAL) {
      this.pause('Global stop loss triggered');
      return false;
    }
    
    return true;
  }
  
  pause(reason) {
    this.state.paused = true;
    this.state.pauseReason = reason;
    log(`⚠️ PAUSED: ${reason}`, 'ERROR');
  }
  
  resume() {
    this.state.paused = false;
    this.state.pauseReason = null;
    log('▶️ Resumed trading');
  }
  
  save() {
    // Save strategy states
    for (const [key, strategy] of Object.entries(this.strategyInstances)) {
      this.state.strategies[key] = {
        enabled: strategy.enabled,
        lastTradeTime: strategy.lastTradeTime,
        trades: strategy.trades.slice(-100),
        wonTrades: strategy.wonTrades,
        lostTrades: strategy.lostTrades,
        totalPnl: strategy.totalPnl,
      };
    }
    this.state.save();
  }
  
  getStatus() {
    const status = {
      portfolio: this.state.portfolio,
      global: {
        running: this.state.isRunning,
        paused: this.state.paused,
        pauseReason: this.state.pauseReason,
      },
      strategies: {},
    };
    
    for (const [key, strategy] of Object.entries(this.strategyInstances)) {
      status.strategies[key] = strategy.getStats();
    }
    
    return status;
  }
  
  printStatus() {
    const status = this.getStatus();
    
    console.log('\n' + '='.repeat(60));
    console.log('🎛️  MULTI-STRATEGY ORCHESTRATOR STATUS');
    console.log('='.repeat(60));
    
    console.log(`\n📊 PORTFOLIO:`);
    console.log(`   Total Capital: $${status.portfolio.totalCapital.toFixed(2)}`);
    console.log(`   Total PnL: ${status.portfolio.totalPnl >= 0 ? '🟢' : '🔴'} $${status.portfolio.totalPnl.toFixed(2)}`);
    console.log(`   Daily PnL: ${status.portfolio.dailyPnl >= 0 ? '🟢' : '🔴'} $${status.portfolio.dailyPnl.toFixed(2)}`);
    console.log(`   Trades Today: ${status.portfolio.dailyTrades}`);
    console.log(`   Status: ${status.global.paused ? `PAUSED - ${status.global.pauseReason}` : 'RUNNING'}`);
    
    console.log(`\n📈 STRATEGIES:`);
    for (const [key, stats] of Object.entries(status.strategies)) {
      console.log(`\n   ${stats.enabled ? '✅' : '❌'} ${stats.name}`);
      console.log(`      Capital: $${stats.capital.toFixed(2)} | PnL: ${stats.totalPnl >= 0 ? '🟢' : '🔴'} $${stats.totalPnl.toFixed(2)}`);
      console.log(`      Win Rate: ${stats.winRate} | Trades: ${stats.totalTrades} | Positions: ${stats.positions}`);
    }
    
    console.log('\n' + '='.repeat(60));
  }
  
  async start() {
    this.state.isRunning = true;
    log('▶️ Starting orchestrator...');
    
    // Try to initialize live trading
    await initLiveTrading();
    
    // Main loop
    const mainLoop = async () => {
      if (this.state.paused) {
        setTimeout(mainLoop, 60000);
        return;
      }
      
      // Check risk limits
      if (!this.checkRiskLimits()) {
        setTimeout(mainLoop, 60000);
        return;
      }
      
      // Generate and execute signals
      try {
        const signals = await this.generateSignals();
        
        for (const [key, signal] of Object.entries(signals)) {
          await this.executeTrade(signal);
        }
      } catch (e) {
        log(`Main loop error: ${e.message}`, 'ERROR');
      }
      
      // Save state
      this.save();
      
      // Schedule next loop (every 5 minutes)
      setTimeout(mainLoop, 300000);
    };
    
    mainLoop();
    
    // Rebalance periodically
    setInterval(() => {
      this.rebalanceCapital();
      this.save();
    }, GLOBAL_CONFIG.REBALANCE_INTERVAL);
    
    // Status display every 15 minutes
    setInterval(() => {
      this.printStatus();
    }, 900000);
  }
  
  stop() {
    this.state.isRunning = false;
    this.save();
    log('⏹️ Orchestrator stopped');
  }
}

// ===== LOGGING =====
function log(msg, type = 'INFO') {
  const colors = {
    DEBUG: '\x1b[90m', INFO: '\x1b[36m', WARN: '\x1b[33m', 
    ERROR: '\x1b[31m', SUCCESS: '\x1b[32m'
  };
  const prefix = type === 'ERROR' ? '❌' : type === 'WARN' ? '⚠️' : type === 'SUCCESS' ? '✅' : '📊';
  console.log(`${colors[type] || ''}${prefix} [${new Date().toLocaleTimeString()}] ${msg}\x1b[0m`);
}

// ===== MAIN =====
if (require.main === module) {
  const orchestrator = new TradingOrchestrator();
  orchestrator.initialize();
  
  // Handle shutdown
  process.on('SIGINT', () => {
    orchestrator.stop();
    process.exit();
  });
  
  // Start
  orchestrator.start();
  
  // Initial status display
  setTimeout(() => orchestrator.printStatus(), 5000);
}

module.exports = { TradingOrchestrator, TradingStrategy, STRATEGY_CONFIGS, GLOBAL_CONFIG };
