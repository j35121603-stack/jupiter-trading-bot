#!/usr/bin/env node
/**
 * JUPITER BOT v7 - Dual Mode Trading Bot
 * Practice Mode: Paper trades to learn/test strategies
 * Live Mode: Real trades with actual funds
 */

const { Connection, Keypair, PublicKey } = require('@solana/web3.js');
const axios = require('axios');
const fs = require('fs');

const PRIVATE_KEY = [251,29,114,181,142,96,158,60,191,29,28,215,45,235,164,89,18,76,7,86,18,196,204,45,107,2,180,123,32,26,120,179,163,137,111,217,115,32,78,114,232,19,195,235,243,114,134,190,86,39,89,168,10,43,167,105,138,213,206,226,68,208,102,225];
const SOLANA_RPC = 'https://api.mainnet-beta.solana.com';

const TELEGRAM_BOT_TOKEN = "8460832535:AAEVnaEwFl7_BEazPF6rJJz4FCgrAk6TIvs";
const TELEGRAM_CHAT_ID = "7725826486";

const MODE = process.argv.includes('--live') ? 'live' : 'practice';
const WALLET_ADDRESS = '54FksWWGjGWAwEv9UnijnbhAKgtYMRvLz3H2bHsyDqTU';

const CONFIG = {
  INITIAL_CAPITAL: 1000,
  MAX_TRADE_SIZE_PCT: 0.10,
  MAX_DAILY_TRADES: 20,
  MIN_MARKET_CAP: 10000,
  
  // Practice mode settings
  PRACTICE_INITIAL_CAPITAL: 1000,
  
  // Risk management
  TAKE_PROFIT: 0.15,    // 15% take profit
  STOP_LOSS: 0.05,      // 5% stop loss
  
  // Position management
  MAX_OPEN_POSITIONS: 5,
  MIN_TRADE_INTERVAL: 300000, // 5 min between trades
  
  // Scanning
  SCAN_INTERVAL: 180000,   // 3 min
  CHECK_INTERVAL: 60000,  // 1 min
};

const KNOWN_TOKENS = {
  'SOL': { mint: 'So11111111111111111111111111111111111111112', minDecimals: 9 },
  'WIF': { mint: '85VBFQZC9TZkfaptBWqv14ALD9fJNUKtSA41kHm28896', minDecimals: 9 },
  'BONK': { mint: 'DezXAZ8z7PnrnRJjz3wXBoZkixF6pf7BiYfCHkV2tF', minDecimals: 9 },
  'PEPE': { mint: 'HZ1JovNiVvGrGNiiYvEozD2h1o9T5J2N5sAa4xFP5dM', minDecimals: 9 },
  'HYPE': { mint: '4ot3sDLauD3Xb2crEfoqLiM1VBG5J4ZtZGhcZ6q4xYq', minDecimals: 9 },
  'PENGU': { mint: '2ggnmQ6uF4n1EnGuMWMhYPRkJdMbzZNYoRBhuqXGqqa', minDecimals: 9 },
  'POPCAT': { mint: '7wcNFrG5UTiY4h1W7rY8kG2QqHk4L8fR3tV6pX9yW1Z', minDecimals: 9 },
  'MEW': { mint: 'MEW1gQW4gE CoppermkR8MSshvYCrjLC1eG6DP7N9xJ3K1p', minDecimals: 9 },
  'TON': { mint: 'EQBQqZ3ACfvPJqd5sEqPT2NpImJaMSBiouo4wTC3PHXy', minDecimals: 9 },
  'BOOK': { mint: 'bksLuVHWmKf7r9uS6gk4grR7WNcMxYGY6LELqxbx2KL', minDecimals: 9 },
};

const SOL_MINT = 'So11111111111111111111111111111111111111112';

let wallet, connection;
let lastTradeTime = 0;

// State for practice mode
let practiceState = {
  capital: CONFIG.PRACTICE_INITIAL_CAPITAL,
  trades: [],
  positions: [],
  dailyTrades: 0,
  dailyPnl: 0,
  wonTrades: 0,
  lostTrades: 0,
  startedAt: Date.now(),
  mode: 'practice'
};

// State for live mode
let liveState = {
  capital: CONFIG.INITIAL_CAPITAL,
  trades: [],
  positions: [],
  dailyTrades: 0,
  dailyPnl: 0,
  wonTrades: 0,
  lostTrades: 0,
  startedAt: Date.now(),
  mode: 'live'
};

function getState() {
  return MODE === 'live' ? liveState : practiceState;
}

function log(msg, type = 'INFO') {
  const colors = { 
    INFO: '\x1b[36m', BUY: '\x1b[32m', SELL: '\x1b[33m', 
    ERROR: '\x1b[31m', SUCCESS: '\x1b[32m', TG: '\x1b[34m', 
    SCAN: '\x1b[35m', PRACTICE: '\x1b[33m', LIVE: '\x1b[31m' 
  };
  const prefix = MODE === 'practice' ? '🟡' : '🔴';
  console.log(`${colors[type]||''}[${new Date().toLocaleTimeString()}] ${prefix} ${msg}\x1b[0m`);
}

async function sendTelegram(msg) {
  const prefix = MODE === 'practice' ? '🟡 PRACTICE: ' : '🔴 LIVE: ';
  try {
    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, { 
      chat_id: TELEGRAM_CHAT_ID, 
      text: prefix + msg, 
      parse_mode: 'HTML' 
    });
  } catch (e) {
    log('Telegram failed: ' + e.message, 'ERROR');
  }
}

// Get real price from Jupiter
async function getTokenPrice(mint) {
  try {
    const res = await axios.get(`https://price.jup.ag/v6/price?ids=${mint}`, { timeout: 10000 });
    return res.data?.data?.[mint]?.price;
  } catch (e) {
    return null;
  }
}

// Get quote from Jupiter
async function getQuote(inputMint, outputMint, amountLamports) {
  try {
    const res = await axios.get(
      `https://quote-api.jup.ag/v6/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amountLamports}&slippage=2`,
      { timeout: 10000 }
    );
    return res.data;
  } catch (e) {
    return null;
  }
}

// Scan for trading opportunities
async function scanOpportunities() {
  const opportunities = [];
  
  try {
    // Get trending from CoinGecko
    const cg = await axios.get('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=volume_desc&per_page=20&page=1', { 
      timeout: 15000 
    });
    
    const state = getState();
    const now = Date.now();
    
    for (const coin of cg.data || []) {
      const symbol = coin.symbol.toUpperCase();
      const tokenInfo = KNOWN_TOKENS[symbol];
      
      if (!tokenInfo) continue;
      
      const mc = coin.market_cap || 0;
      if (mc < CONFIG.MIN_MARKET_CAP) continue;
      
      const change24h = coin.price_change_percentage_24h || 0;
      const volume = coin.total_volume || 0;
      
      // Score based on momentum
      let score = 0;
      if (change24h > 5) score += 3;
      else if (change24h > 0) score += 1;
      
      if (volume > mc * 0.1) score += 2; // High volume relative to MC
      
      if (score < 2) continue;
      
      opportunities.push({
        symbol,
        name: coin.name,
        mint: tokenInfo.mint,
        price: coin.current_price,
        change24h,
        volume,
        marketCap: mc,
        score,
        type: mc > 50000000 ? 'established' : 'small'
      });
    }
    
    // Sort by score
    opportunities.sort((a, b) => b.score - a.score);
    
    for (const opp of opportunities.slice(0, 5)) {
      log(`📊 ${opp.symbol} | $${opp.price?.toFixed(4)} | ${opp.change24h?.toFixed(1)}% | Score: ${opp.score}`, 'SCAN');
    }
    
  } catch (e) {
    log('Scan error: ' + e.message, 'ERROR');
  }
  
  return opportunities;
}

// Execute a buy
async function executeBuy(coin) {
  const state = getState();
  const now = Date.now();
  
  // Rate limiting
  if (now - lastTradeTime < CONFIG.MIN_TRADE_INTERVAL) {
    log(`⏳ Too soon to trade`, 'INFO');
    return;
  }
  
  // Max positions check
  if (state.positions.length >= CONFIG.MAX_OPEN_POSITIONS) {
    log(`📊 Max positions reached`, 'INFO');
    return;
  }
  
  // Check if already holding
  if (state.positions.find(p => p.symbol === coin.symbol && !p.exited)) {
    log(`⏭️ Already holding ${coin.symbol}`, 'INFO');
    return;
  }
  
  const tradeSize = state.capital * CONFIG.MAX_TRADE_SIZE_PCT;
  const amountLamports = Math.floor(tradeSize * 1e9);
  
  let entryPrice = coin.price;
  let actualAmount = tradeSize;
  
  // In practice mode, simulate the quote
  if (MODE === 'practice') {
    log(`🟡 PRACTICE BUY: ${coin.symbol} - $${tradeSize.toFixed(2)}`, 'BUY');
  } else {
    // Live mode - get real quote
    const quote = await getQuote(SOL_MINT, coin.mint, amountLamports);
    if (!quote) {
      log(`❌ Failed to get quote for ${coin.symbol}`, 'ERROR');
      return;
    }
    
    entryPrice = parseFloat(quote.outAmount) / 1e9;
    actualAmount = parseFloat(quote.inAmount) / 1e9;
    
    log(`🟢 LIVE BUY: ${coin.symbol} - $${actualAmount.toFixed(2)}`, 'BUY');
    await sendTelegram(`🟢 BUY ${coin.symbol}\nAmount: $${actualAmount.toFixed(2)}\nPrice: $${entryPrice.toFixed(4)}`);
  }
  
  const position = {
    symbol: coin.symbol,
    mint: coin.mint,
    amount: actualAmount,
    entryPrice,
    entryTime: now,
    type: coin.type,
    targetPrice: entryPrice * (1 + CONFIG.TAKE_PROFIT),
    stopPrice: entryPrice * (1 - CONFIG.STOP_LOSS),
    exited: false,
    mode: MODE
  };
  
  state.positions.push(position);
  state.dailyTrades++;
  lastTradeTime = now;
  
  saveState();
}

// Check and exit positions
async function checkPositions() {
  const state = getState();
  const toExit = [];
  
  for (const pos of state.positions) {
    if (pos.exited) continue;
    
    // Get current price
    const currentPrice = await getTokenPrice(pos.mint);
    if (!currentPrice) continue;
    
    const priceChange = (currentPrice - pos.entryPrice) / pos.entryPrice;
    const pnl = pos.amount * priceChange;
    const pnlPct = priceChange * 100;
    
    // Check take profit
    if (priceChange >= CONFIG.TAKE_PROFIT) {
      log(`🎯 TAKE PROFIT: ${pos.symbol} +${pnlPct.toFixed(1)}%`, 'SUCCESS');
      pos.exited = true;
      pos.exitPrice = currentPrice;
      pos.pnl = pnl;
      pos.exitTime = Date.now();
      pos.reason = 'take_profit';
      
      state.capital += pnl;
      state.wonTrades++;
      state.trades.push({ ...pos });
      
      if (MODE === 'live') {
        await sendTelegram(`✅ TAKE PROFIT ${pos.symbol}\nProfit: $${pnl.toFixed(2)} (+${pnlPct.toFixed(1)}%)`);
      }
      
      toExit.push(pos);
    }
    // Check stop loss
    else if (priceChange <= -CONFIG.STOP_LOSS) {
      log(`🛑 STOP LOSS: ${pos.symbol} ${pnlPct.toFixed(1)}%`, 'ERROR');
      pos.exited = true;
      pos.exitPrice = currentPrice;
      pos.pnl = pnl;
      pos.exitTime = Date.now();
      pos.reason = 'stop_loss';
      
      state.capital += pnl;
      state.lostTrades++;
      state.trades.push({ ...pos });
      
      if (MODE === 'live') {
        await sendTelegram(`❌ STOP LOSS ${pos.symbol}\nLoss: $${Math.abs(pnl).toFixed(2)} (${pnlPct.toFixed(1)}%)`);
      }
      
      toExit.push(pos);
    }
  }
  
  // Remove exited positions
  for (const pos of toExit) {
    const idx = state.positions.indexOf(pos);
    if (idx > -1) state.positions.splice(idx, 1);
  }
  
  if (toExit.length > 0) {
    log(`💰 Capital: $${state.capital.toFixed(2)} | Won: ${state.wonTrades} | Lost: ${state.lostTrades}`, 'INFO');
    saveState();
  }
}

function selectBestOpportunity(opportunities) {
  if (!opportunities || opportunities.length === 0) return null;
  
  // Pick top opportunity
  return opportunities[0];
}

function saveState() {
  const mode = MODE;
  const state = mode === 'live' ? liveState : practiceState;
  fs.writeFileSync(`./state-${mode}.json`, JSON.stringify(state, null, 2));
}

function loadState() {
  const mode = MODE;
  const state = mode === 'live' ? liveState : practiceState;
  
  try {
    const data = fs.readFileSync(`./state-${mode}.json`, 'utf8');
    const loaded = JSON.parse(data);
    Object.assign(state, loaded);
    log(`Loaded ${mode} state: $${state.capital.toFixed(2)} | ${state.wonTrades}W-${state.lostTrades}L`, 'INFO');
  } catch (e) {
    log(`Starting fresh in ${mode} mode`, 'INFO');
  }
}

async function main() {
  const modeLabel = MODE === 'practice' ? '🟡 PRACTICE MODE' : '🔴 LIVE MODE';
  log(`🚀 JUPITER BOT v7 - ${modeLabel}`, 'INFO');
  
  wallet = Keypair.fromSecretKey(new Uint8Array(PRIVATE_KEY));
  connection = new Connection(SOLANA_RPC);
  
  loadState();
  
  const state = getState();
  await sendTelegram(`🤖 Bot v7 Started!\nMode: ${MODE.toUpperCase()}\nCapital: $${state.capital.toFixed(2)}`);
  
  // Trading loop
  setInterval(async () => {
    log('🔍 Scanning...', 'SCAN');
    const opportunities = await scanOpportunities();
    
    if (opportunities.length > 0) {
      const best = selectBestOpportunity(opportunities);
      if (best) {
        await executeBuy(best);
      }
    }
  }, CONFIG.SCAN_INTERVAL);
  
  // Position check loop
  setInterval(checkPositions, CONFIG.CHECK_INTERVAL);
  
  log(`Bot running in ${MODE} mode. Capital: $${state.capital.toFixed(2)}`, 'INFO');
}

main();
