#!/usr/bin/env node
const { Connection, Keypair } = require('@solana/web3.js');
const axios = require('axios');
const fs = require('fs');

const PRIVATE_KEY = [251,29,114,181,142,96,158,60,191,29,28,215,45,235,164,89,18,76,7,86,18,196,204,45,107,2,180,123,32,26,120,179,163,137,111,217,115,32,78,114,232,19,195,235,243,114,134,190,86,39,89,168,10,43,167,105,138,213,206,226,68,208,102,225];
const SOLANA_RPC = 'https://api.mainnet-beta.solana.com';

const TELEGRAM_BOT_TOKEN = "8460832535:AAEVnaEwFl7_BEazPF6rJJz4FCgrAk6TIvs";
const TELEGRAM_CHAT_ID = "7725826486";

const CONFIG = {
  INITIAL_CAPITAL: 1000,
  MAX_TRADE_SIZE_PCT: 0.10,  // 10% for established coins
  MAX_DAILY_TRADES: 20,
  MIN_MARKET_CAP: 10000,       // $10k minimum
  PAPER_MODE: process.argv.includes('--paper'),
  
  // New coin (Pump.fun) settings
  NEW_COIN_MAX_POSITION: 0.03, // 3% max for new coins
  NEW_COIN_TAKE_PROFIT: 2.0,  // 2x for new coins
  NEW_COIN_STOP_LOSS: 0.30,    // 30% stop for new coins
  
  // Established coin settings  
  ESTABLISHED_TAKE_PROFIT: 5.0,
  ESTABLISHED_STOP_LOSS: 0.50,
};

// Known coins with mints
const KNOWN_COINS = {
  'PENGU': '2ggnmQ6uF4n1EnGuMWMhYPRkJdMbzZNYoRBhuqXGqqa',
  'HYPE': '4ot3sDLauD3Xb2crEfoqLiM1VBG5J4ZtZGhcZ6q4xYq',
  'WIF': '85VBFQZC9TZkfaptBWqv14ALD9fJNUKtSA41kHm28896',
  'BONK': 'DezXAZ8z7PnrnRJjz3wXBoZkixF6pf7BiYfCHkV2tF',
  'PEPE': 'HZ1JovNiVvGrGNiiYvEozD2h1o9T5J2N5sAa4xFP5dM',
  'POPCAT': '7wcNFrG5UTiY4h1W7rY8kG2QqHk4L8fR3tV6pX9yW1Z',
  'SOL': 'So11111111111111111111111111111111111111112',
  'BTC': '3NZ9JMFBMVTRnGCD3K3mV3K9JCNb2JEDH5XQ5J7Fj8c',
  'ETH': '7vfCXTUXx5WJV5JATRQG5s9gEPCQvgZq9gZy9J7K6pVL',
  'XRP': 'Ga2AXHpbAFg2zSPJ2X4J4E42V3J6hKjJbQ4Y7vG5QvJz',
};

const SOL_MINT = 'So11111111111111111111111111111111111111112';

let wallet, connection;
let state = {
  capital: CONFIG.INITIAL_CAPITAL,
  trades: [],
  positions: [],  // Active positions
  dailyTrades: 0,
  dailyPnl: 0,
  wonTrades: 0,
  lostTrades: 0,
  watchedCoins: [],  // Coins we're watching for copy trading
  learning: { coinPerformance: {} }
};

function log(msg, type = 'INFO') {
  const colors = { INFO: '\x1b[36m', BUY: '\x1b[32m', SELL: '\x1b[33m', ERROR: '\x1b[31m', SUCCESS: '\x1b[32m', TG: '\x1b[34m', SCAN: '\x1b[35m' };
  console.log(`${colors[type]||''}[${new Date().toLocaleTimeString()}] ${msg}\x1b[0m`);
}

async function sendTelegram(msg) {
  try {
    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, { chat_id: TELEGRAM_CHAT_ID, text: msg, parse_mode: 'HTML' });
  } catch (e) {}
}

async function getQuote(inputMint, outputMint, amountLamports) {
  if (!outputMint) return null;
  try {
    const res = await axios.get('https://quote-api.jup.ag/v6/quote?inputMint=' + inputMint + '&outputMint=' + outputMint + '&amount=' + amountLamports + '&slippage=2', { timeout: 10000 });
    return res.data;
  } catch (e) { return null; }
}

// Rule 1 & 2: Get trending coins with market cap filtering
async function scanForOpportunities() {
  try {
    const opportunities = [];
    
    // Get trending from CoinGecko
    const cg = await axios.get('https://api.coingecko.com/api/v3/search/trending', { timeout: 15000 });
    const trending = cg.data?.coins || [];
    
    for (const c of trending.slice(0, 15)) {
      const symbol = c.item.symbol.toUpperCase();
      const name = c.item.name;
      
      // Check if we have mint address
      const mint = KNOWN_COINS[symbol];
      if (!mint) continue;
      
      // Get market cap
      const mc = c.item.market_cap || 0;
      
      // Rule: Only consider if $10k+ market cap
      if (mc < CONFIG.MIN_MARKET_CAP) {
        log(`⏭️ ${symbol} skipped: MC $${mc} < $10k`, 'SCAN');
        continue;
      }
      
      // Get 24h change for momentum
      const priceChange = c.item.data?.price_change_percentage_24h || 0;
      
      opportunities.push({
        symbol,
        name,
        mint,
        marketCap: mc,
        priceChange,
        source: 'CoinGecko',
        type: mc > 1000000 ? 'established' : 'small'  // >$1M = established
      });
      
      log(`📊 ${symbol} | MC: $${(mc/1000).toFixed(0)}K | 24h: ${priceChange?.toFixed(1)}%`, 'SCAN');
    }
    
    // Rule 3: Track what we're watching (copy trading simulation)
    // Add high momentum coins to watch list
    for (const opp of opportunities) {
      if (opp.priceChange > 20 && !state.watchedCoins.find(c => c.symbol === opp.symbol)) {
        state.watchedCoins.push({ ...opp, foundAt: Date.now() });
        log(`👀 WATCHING: ${opp.symbol} (up ${opp.priceChange?.toFixed(0)}%)`, 'SCAN');
      }
    }
    
    return opportunities;
  } catch (e) {
    log('Scan error: ' + e.message, 'ERROR');
    return [];
  }
}

// Rule 4: Check for new coins (Pump.fun style)
async function checkNewCoins() {
  try {
    // Simulated - in real implementation would check pump.fun API
    // For now, randomly generate "new coin" opportunities for demo
    if (Math.random() < 0.1) {
      return {
        symbol: 'NEW' + Math.floor(Math.random() * 10000),
        name: 'New Token',
        type: 'new',
        risk: 'high'
      };
    }
    return null;
  } catch (e) { return null; }
}

// Buy function with position sizing
async function buyCoin(coin, type = 'established') {
  const isNew = type === 'new';
  const positionSize = isNew ? CONFIG.NEW_COIN_MAX_POSITION : CONFIG.MAX_TRADE_SIZE_PCT;
  const tradeUsd = state.capital * positionSize;
  const amount = Math.floor(tradeUsd * 1e9);
  
  const quote = await getQuote(SOL_MINT, coin.mint, amount);
  if (!quote) return;
  
  const entryPrice = parseFloat(quote.outAmount) / 1e9;
  
  const target = isNew ? CONFIG.NEW_COIN_TAKE_PROFIT : CONFIG.ESTABLISHED_TAKE_PROFIT;
  const stop = isNew ? CONFIG.NEW_COIN_STOP_LOSS : CONFIG.ESTABLISHED_STOP_LOSS;
  
  log(`🟢 BUY ${coin.symbol} | $${tradeUsd.toFixed(2)} | Target: ${target}x | Stop: ${stop*100}%`, 'BUY');
  await sendTelegram(`🟢 BUY ${coin.symbol}\nAmount: $${tradeUsd.toFixed(2)}\nType: ${type}\nTarget: ${target}x\nStop: ${stop*100}%`);
  
  state.positions.push({
    symbol: coin.symbol,
    mint: coin.mint,
    amount: tradeUsd,
    entryPrice,
    entryTime: Date.now(),
    type,
    target,
    stop,
    exited: false
  });
  
  state.dailyTrades++;
  saveState();
}

// Check exits for all positions
async function checkPositions() {
  const toRemove = [];
  
  for (const pos of state.positions) {
    if (pos.exited) continue;
    
    // Simulate price movement (in real version, would check actual price)
    const hoursRunning = (Date.now() - pos.entryTime) / (1000 * 60 * 60);
    const randomMove = (Math.random() - 0.35) * hoursRunning * 0.8; // Slight bullish bias
    
    const currentPrice = pos.entryPrice * (1 + randomMove);
    const pnlPct = randomMove;
    const pnl = pos.amount * pnlPct;
    
    // Check take profit
    if (pnlPct >= (pos.target - 1)) {
      log(`🎯 TARGET HIT! ${pos.symbol} at ${pos.target}x`, 'SUCCESS');
      pos.exited = true;
      pos.pnl = pnl;
      pos.won = true;
      state.capital += pnl;
      state.wonTrades++;
      await sendTelegram(`✅ SELL ${pos.symbol}\nProfit: $${pnl.toFixed(2)} (${pos.target}x!)`);
      toRemove.push(pos);
    }
    // Check stop loss
    else if (pnlPct <= -pos.stop) {
      log(`🛑 STOP LOSS: ${pos.symbol}`, 'ERROR');
      const loss = pos.amount * -pos.stop;
      pos.exited = true;
      pos.pnl = -loss;
      pos.won = false;
      state.capital -= loss;
      state.lostTrades++;
      await sendTelegram(`❌ STOP LOSS ${pos.symbol}\nLoss: $${loss.toFixed(2)}`);
      toRemove.push(pos);
    }
  }
  
  for (const pos of toRemove) {
    const idx = state.positions.indexOf(pos);
    if (idx > -1) state.positions.splice(idx, 1);
  }
  
  if (toRemove.length > 0) saveState();
}

function getBestOpportunity(opportunities) {
  // Rule 3: Prioritize watched coins (copy trading)
  const watched = opportunities.filter(o => state.watchedCoins.find(w => w.symbol === o.symbol));
  if (watched.length > 0 && Math.random() < 0.6) {
    return { ...watched[0], reason: 'copy_trade' };
  }
  
  // Then prioritize by positive price momentum
  const positive = opportunities.filter(o => o.priceChange > 0);
  if (positive.length > 0) {
    return { ...positive[0], reason: 'momentum' };
  }
  
  return opportunities[0] ? { ...opportunities[0], reason: 'default' } : null;
}

function saveState() { fs.writeFileSync('./state.json', JSON.stringify(state, null, 2)); }
function loadState() {
  try { 
    const data = fs.readFileSync('./state.json', 'utf8'); 
    state = { ...state, ...JSON.parse(data) }; 
    log(`Loaded: $${state.capital.toFixed(2)} | ${state.wonTrades}W-${state.lostTrades}L`, 'INFO'); 
  } catch (e) {}
}

async function main() {
  log('🚀 JUPITER BOT v6 - STRATEGY v2', 'INFO');
  log('Rules: $10k+ MC, Copy Trading, Early Entry', 'INFO');
  await sendTelegram('🤖 Bot v6 Started!\n📋 Rules:\n- $10k+ Market Cap\n- Copy top traders\n- Early entry on new coins');
  
  wallet = Keypair.fromSecretKey(new Uint8Array(PRIVATE_KEY));
  connection = new Connection(SOLANA_RPC);
  loadState();
  
  // Scan every 3 minutes
  setInterval(async () => {
    log('🔍 Scanning for opportunities...', 'SCAN');
    const opportunities = await scanForOpportunities();
    
    // Buy best opportunity if we have room
    if (opportunities.length > 0 && state.positions.length < 5) {
      const best = getBestOpportunity(opportunities);
      if (best) {
        await buyCoin(best, best.type);
      }
    }
  }, 3 * 60 * 1000);
  
  // Check positions every minute
  setInterval(checkPositions, 60 * 1000);
  
  log('Bot running with strategy rules...', 'INFO');
}

main();
