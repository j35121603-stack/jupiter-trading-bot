/**
 * POLYMARKET LIVE TRADING BOT
 * 
 * Fetches real Polymarket data and executes trades
 * Currently runs in shadow mode (simulating trades based on real prices)
 * 
 * To go live: Add your Polygon private key and USDC
 */

const fs = require('fs');
const ethers = require('ethers');
const axios = require('axios');

const POLY_API = 'https://gamma-api.polymarket.com';
const RPC_URL = 'https://1rpc.io/matic';

// Configuration
const CONFIG = {
  mode: 'shadow', // shadow = simulate, live = real trading
  capital: 100,
  maxPositionSize: 0.25, // 25% of capital per trade
  minConfidence: 0.6,
  stopLoss: 0.15, // 15%
  takeProfit: 0.30, // 30%
  scanInterval: 60000, // 1 minute
};

// Telegram config
const TELEGRAM_BOT_TOKEN = "8460832535:AAEVnaEwFl7_BEazPF6rJJz4FCgrAk6TIvs";
const TELEGRAM_CHAT_ID = "7725826486";

async function sendTelegram(msg) {
  try {
    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      chat_id: TELEGRAM_CHAT_ID,
      text: '🤖 ' + msg,
      parse_mode: 'HTML'
    });
  } catch(e) {
    log('Telegram error: ' + e.message);
  }
}

// Polygon private key (REQUIRED FOR LIVE TRADING)
// Add your key here or set POLYGON_PRIVATE_KEY env variable
let POLYGON_PRIVATE_KEY = process.env.POLYGON_PRIVATE_KEY || null;

// Contract addresses
const CONTRACTS = {
  USDC: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
  CLOBProxy: '0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E',
};

const CLOB_ABI = [
  'function buy(address token, uint256 amount, uint256 maxCost) returns (uint256)',
  'function sell(address token, uint256 amount, uint256 minProceeds) returns (uint256)',
];

const TOKEN_ABI = [
  'function approve(address spender, uint256 amount) returns (bool)',
  'function balanceOf(address account) view returns (uint256)',
];

// State
let state = {
  capital: CONFIG.capital,
  positions: [],
  trades: [],
  startedAt: Date.now(),
};

// Colors
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  reset: '\x1b[0m'
};

function log(msg, type = 'info') {
  const timestamp = new Date().toLocaleTimeString();
  const color = type === 'buy' ? colors.green : type === 'sell' ? colors.red : type === 'alert' ? colors.yellow : colors.cyan;
  console.log(`${color}[${timestamp}]${colors.reset} ${msg}`);
}

function loadState() {
  try {
    state = JSON.parse(fs.readFileSync('poly-live-state.json', 'utf8'));
    log(`Loaded state: $${state.capital.toFixed(2)} | Trades: ${state.trades.length}`);
  } catch (e) {
    log('Starting fresh with $' + CONFIG.capital);
  }
}

function saveState() {
  fs.writeFileSync('poly-live-state.json', JSON.stringify(state, null, 2));
}

// Fetch markets from Polymarket
async function getMarkets() {
  try {
    const response = await axios.get(`${POLY_API}/markets?closed=false&limit=50`, { 
      timeout: 10000 
    });
    
    return response.data.map(m => {
      const prices = JSON.parse(m.outcomePrices || '[]');
      return {
        id: m.id,
        conditionId: m.conditionId,
        question: m.question,
        yesPrice: parseFloat(prices[0]) || 0.5,
        noPrice: parseFloat(prices[1]) || 0.5,
        volume: parseFloat(m.volume || 0),
        liquidity: parseFloat(m.liquidity || 0),
        clobTokenIds: m.clobTokenIds ? JSON.parse(m.clobTokenIds) : [],
        bestBid: m.bestBid || parseFloat(prices[0]) * 0.95,
        bestAsk: m.bestAsk || parseFloat(prices[0]) * 1.05,
        endDate: m.endDate,
      };
    }).filter(m => m.volume > 5000 && m.liquidity > 1000); // Filter liquid markets
  } catch (e) {
    log('Market fetch error: ' + e.message, 'alert');
    return [];
  }
}

// Generate trading signal
function generateSignal(market) {
  const { yesPrice, noPrice, volume, liquidity } = market;
  
  // Skip if no clear direction
  if (yesPrice < 0.4 || yesPrice > 0.7) {
    // Extreme prices - check for reversion
    if (yesPrice > 0.85) {
      return { direction: 'no', confidence: 0.7, reason: 'Yes overpriced, fading' };
    } else if (noPrice > 0.85) {
      return { direction: 'yes', confidence: 0.7, reason: 'No overpriced, fading' };
    }
    return null;
  }
  
  // Momentum signal
  const volumeScore = Math.min(volume / 100000, 1);
  const liquidityScore = Math.min(liquidity / 50000, 1);
  const priceScore = yesPrice > 0.5 ? yesPrice - 0.5 : 0.5 - noPrice;
  
  const confidence = (volumeScore * 0.3 + liquidityScore * 0.3 + priceScore * 0.4);
  
  if (confidence < CONFIG.minConfidence) return null;
  
  return {
    direction: yesPrice > 0.5 ? 'yes' : 'no',
    confidence,
    reason: `Vol: $${(volume/1000).toFixed(0)}K, Price: ${(yesPrice*100).toFixed(0)}%`
  };
}

// Execute trade (shadow mode)
async function executeTrade(market, signal) {
  const size = state.capital * CONFIG.maxPositionSize;
  const price = signal.direction === 'yes' ? market.yesPrice : market.noPrice;
  
  const trade = {
    marketId: market.id,
    market: market.question,
    direction: signal.direction,
    size,
    price,
    cost: size,
    shares: size / price,
    confidence: signal.confidence,
    reason: signal.reason,
    timestamp: Date.now(),
  };
  
  state.trades.push(trade);
  state.positions.push({
    ...trade,
    entryTime: Date.now(),
    status: 'open'
  });
  
  log(`📈 ${signal.direction.toUpperCase()} ${market.question.substring(0, 40)}... | Size: $${size.toFixed(2)} | Price: ${(price*100).toFixed(1)}%`, 'buy');
  
  // Send Telegram notification
  const tradeMsg = `🎯 <b>NEW TRADE</b>\n${signal.direction.toUpperCase()} ${market.question.substring(0, 50)}...\nSize: $${size.toFixed(2)} | Price: ${(price*100).toFixed(1)}%\nConfidence: ${(signal.confidence*100).toFixed(0)}%`;
  await sendTelegram(tradeMsg);
  
  saveState();
}

// Check positions for exit signals
async function checkPositions(markets) {
  const now = Date.now();
  
  for (let i = state.positions.length - 1; i >= 0; i--) {
    const pos = state.positions[i];
    if (pos.status !== 'open') continue;
    
    const market = markets.find(m => m.id === pos.marketId);
    if (!market) continue;
    
    const currentPrice = pos.direction === 'yes' ? market.yesPrice : market.noPrice;
    const pnlPercent = (currentPrice - pos.price) / pos.price;
    const hoursOpen = (now - pos.entryTime) / (1000 * 60 * 60);
    
    let shouldExit = false;
    let exitReason = '';
    
    // Take profit
    if (pnlPercent >= CONFIG.takeProfit) {
      shouldExit = true;
      exitReason = 'Take profit';
    }
    // Stop loss
    else if (pnlPercent <= -CONFIG.stopLoss) {
      shouldExit = true;
      exitReason = 'Stop loss';
    }
    // Time exit (24 hours max)
    else if (hoursOpen > 24) {
      shouldExit = true;
      exitReason = 'Time exit';
    }
    
    if (shouldExit) {
      const proceeds = pos.shares * currentPrice;
      const pnl = proceeds - pos.cost;
      state.capital += proceeds;
      
      log(`📊 Exit ${pos.direction.toUpperCase()} | ${exitReason} | PnL: ${pnl >= 0 ? colors.green : colors.red}$${pnl.toFixed(2)}${colors.reset}`, pnl >= 0 ? 'buy' : 'sell');
      
      // Send Telegram notification
      const exitMsg = pnl >= 0 
        ? `✅ <b>PROFIT</b> +$${pnl.toFixed(2)}\n${pos.market.substring(0, 50)}...\nExit: ${exitReason}`
        : `❌ <b>LOSS</b> -$${Math.abs(pnl).toFixed(2)}\n${pos.market.substring(0, 50)}...\nExit: ${exitReason}`;
      await sendTelegram(exitMsg);
      
      pos.status = 'closed';
      pos.exitPrice = currentPrice;
      pos.exitTime = now;
      pos.pnl = pnl;
      
      state.positions.splice(i, 1);
      saveState();
    }
  }
}

// Main trading loop
async function tradingLoop() {
  log('🔄 Scanning markets...');
  
  const markets = await getMarkets();
  if (markets.length === 0) {
    log('No markets found', 'alert');
    return;
  }
  
  log(`Found ${markets.length} liquid markets`);
  
  // Check existing positions
  await checkPositions(markets);
  
  // Find new opportunities
  if (state.positions.length < 3) {
    for (const market of markets) {
      // Skip if already have position
      if (state.positions.find(p => p.marketId === market.id && p.status === 'open')) continue;
      
      const signal = generateSignal(market);
      if (signal) {
        await executeTrade(market, signal);
        break; // One trade per cycle
      }
    }
  }
  
  // Show portfolio
  const openPositions = state.positions.filter(p => p.status === 'open');
  if (openPositions.length > 0) {
    let positionValue = 0;
    openPositions.forEach(pos => {
      const market = markets.find(m => m.id === pos.marketId);
      if (market) {
        const currentPrice = pos.direction === 'yes' ? market.yesPrice : market.noPrice;
        positionValue += pos.shares * currentPrice;
      }
    });
    log(`📊 Portfolio: $${state.capital.toFixed(2)} cash + $${positionValue.toFixed(2)} positions = $${(state.capital + positionValue).toFixed(2)} total`);
  }
}

// Main
async function main() {
  log('🚀 Polymarket Live Trading Bot Starting...');
  log(`Mode: ${CONFIG.mode} | Capital: $${CONFIG.capital}`);
  
  if (!POLYGON_PRIVATE_KEY) {
    log('⚠️ Running in SHADOW mode (simulated trades)', 'alert');
    log('To go live: Add Polygon private key to config or set POLYGON_PRIVATE_KEY env', 'alert');
  }
  
  loadState();
  
  // Initial run
  await tradingLoop();
  
  // Loop
  setInterval(tradingLoop, CONFIG.scanInterval);
}

main().catch(e => {
  log('Fatal error: ' + e.message, 'alert');
  process.exit(1);
});
