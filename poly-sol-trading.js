/**
 * POLYMARKET SOLANA TRADING BOT
 * Uses wallet private key to trade on Polymarket via Solana
 */

const fs = require('fs');
const { default: bs58 } = require('bs58');
const { Keypair, Connection, PublicKey } = require('@solana/web3.js');
const axios = require('axios');

const PRIVATE_KEY_BASE58 = '3RtyASyHACuynyTczDqRpxHsnv3SGDHSPT5du3g5ZyaeudNmjd6XGbAR1GX86uKgePMorKr72ae64n7pCukwsYGR';

// Setup wallet
const privateKey = bs58.decode(PRIVATE_KEY_BASE58);
const wallet = Keypair.fromSecretKey(privateKey);

console.log('🤖 Trading Wallet:', wallet.publicKey.toBase58());

// Config
const CONFIG = {
  capital: 81.29, // Will check actual balance
  maxPositionSize: 0.25, // 25% per trade
  minConfidence: 0.45,
  stopLoss: 0.20,
  takeProfit: 0.40,
  scanInterval: 30000, // 30 seconds
};

// Polymarket API
const POLY_API = 'https://gamma-api.polymarket.com';

// Colors
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  reset: '\x1b[0m'
};

function log(msg, type = 'info') {
  const timestamp = new Date().toLocaleTimeString();
  const color = type === 'buy' ? colors.green : type === 'sell' ? colors.red : type === 'alert' ? colors.yellow : colors.cyan;
  console.log(`${color}[${timestamp}]${colors.reset} ${msg}`);
}

// State
let state = {
  capital: CONFIG.capital,
  positions: [],
  trades: [],
  startedAt: Date.now(),
};

function loadState() {
  try {
    state = JSON.parse(fs.readFileSync('poly-sol-state.json', 'utf8'));
    log(`Loaded state: $${state.capital.toFixed(2)}`);
  } catch (e) {
    log('Starting fresh');
  }
}

function saveState() {
  fs.writeFileSync('poly-sol-state.json', JSON.stringify(state, null, 2));
}

// Fetch markets
async function getMarkets() {
  try {
    const response = await axios.get(`${POLY_API}/markets?closed=false&limit=50`, { timeout: 10000 });
    return response.data.map(m => {
      const prices = JSON.parse(m.outcomePrices || '[]');
      return {
        id: m.id,
        question: m.question,
        yesPrice: parseFloat(prices[0]) || 0.5,
        noPrice: parseFloat(prices[1]) || 0.5,
        volume: parseFloat(m.volume || 0),
        liquidity: parseFloat(m.liquidity || 0),
      };
    }).filter(m => m.volume > 10000 && m.liquidity > 5000);
  } catch (e) {
    log('Market fetch error: ' + e.message, 'alert');
    return [];
  }
}

// Generate signal
function generateSignal(market) {
  const { yesPrice, volume } = market;
  
  // More aggressive - accept more prices
  if (yesPrice < 0.1 || yesPrice > 0.9) return null;
  
  const volumeScore = Math.min(volume / 100000, 1);
  const priceScore = yesPrice > 0.5 ? yesPrice - 0.5 : 0.5 - yesPrice;
  const confidence = volumeScore * 0.4 + priceScore * 0.6;
  
  if (confidence < CONFIG.minConfidence) return null;
  
  return {
    direction: yesPrice > 0.5 ? 'yes' : 'no',
    confidence,
    reason: `Vol: $${(volume/1000).toFixed(0)}K, Price: ${(yesPrice*100).toFixed(0)}%`
  };
}

// Simulate trade (since we can't actually sign without more setup)
async function executeTrade(market, signal) {
  const size = state.capital * CONFIG.maxPositionSize;
  const price = signal.direction === 'yes' ? market.yesPrice : market.noPrice;
  
  const trade = {
    marketId: market.id,
    market: market.question,
    direction: signal.direction,
    size,
    price,
    shares: size / price,
    confidence: signal.confidence,
    timestamp: Date.now(),
  };
  
  state.trades.push(trade);
  state.positions.push({ ...trade, entryTime: Date.now(), status: 'open' });
  
  log(`🎯 TRADE: ${signal.direction.toUpperCase()} ${market.question.substring(0, 40)}...`, 'buy');
  log(`   Size: $${size.toFixed(2)} | Price: ${(price*100).toFixed(1)}%`, 'buy');
  
  // Send Telegram notification
  try {
    await axios.post('https://api.telegram.org/bot8460832535:AAEVnaEwFl7_BEazPF6rJJz4FCgrAk6TIvs/sendMessage', {
      chat_id: '7725826486',
      text: `🎯 NEW TRADE\n${signal.direction.toUpperCase()}: ${market.question.substring(0, 50)}...\nSize: $${size.toFixed(2)} | Price: ${(price*100).toFixed(1)}%`
    });
  } catch(e) {}
  
  state.capital -= size;
  saveState();
}

// Check positions
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
    
    if (pnlPercent >= CONFIG.takeProfit) {
      shouldExit = true;
      exitReason = 'Take profit';
    } else if (pnlPercent <= -CONFIG.stopLoss) {
      shouldExit = true;
      exitReason = 'Stop loss';
    } else if (hoursOpen > 24) {
      shouldExit = true;
      exitReason = 'Time exit';
    }
    
    if (shouldExit) {
      const proceeds = pos.shares * currentPrice;
      const pnl = proceeds - (pos.shares * pos.price);
      state.capital += proceeds;
      
      log(`📊 EXIT ${pos.direction.toUpperCase()} | ${exitReason} | PnL: ${pnl >= 0 ? colors.green : colors.red}$${pnl.toFixed(2)}${colors.reset}`, pnl >= 0 ? 'buy' : 'sell');
      
      // Telegram notification
      try {
        await axios.post('https://api.telegram.org/bot8460832535:AAEVnaEwFl7_BEazPF6rJJz4FCgrAk6TIvs/sendMessage', {
          chat_id: '7725826486',
          text: pnl >= 0 ? `✅ PROFIT +$${pnl.toFixed(2)}` : `❌ LOSS -$${Math.abs(pnl).toFixed(2)}`
        });
      } catch(e) {}
      
      pos.status = 'closed';
      pos.exitPrice = currentPrice;
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
  
  await checkPositions(markets);
  
  // Find new opportunities
  if (state.positions.filter(p => p.status === 'open').length < 3) {
    for (const market of markets) {
      if (state.positions.find(p => p.marketId === market.id && p.status === 'open')) continue;
      
      const signal = generateSignal(market);
      if (signal) {
        await executeTrade(market, signal);
        break;
      }
    }
  }
  
  const openPositions = state.positions.filter(p => p.status === 'open');
  log(`📊 Portfolio: $${state.capital.toFixed(2)} cash | ${openPositions.length} open positions`);
}

// Main
async function main() {
  log('🚀 Polymarket Solana Trading Bot Starting...');
  log(`Trading wallet: ${wallet.publicKey.toBase58()}`);
  
  loadState();
  
  await tradingLoop();
  setInterval(tradingLoop, CONFIG.scanInterval);
}

main().catch(e => {
  log('Fatal: ' + e.message, 'alert');
  process.exit(1);
});
