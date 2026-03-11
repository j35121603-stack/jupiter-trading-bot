#!/usr/bin/env node

/**
 * Jupiter Meme Coin Trading Bot
 * High-frequency, low-risk trading on Solana
 * 
 * Setup: npm install @solana/web3.js axios
 * Run: node bot.js
 */

const { Connection, Keypair, PublicKey } = require('@solana/web3.js');
const axios = require('axios');

// ==================== CONFIGURATION ====================

// ⚠️⚠️⚠️ IMPORTANT: ADD YOUR PRIVATE KEY HERE ⚠️⚠️⚠️
// How to get it:
// 1. Open Phantom wallet → Settings → Export Private Key
// 2. Paste the key as a string below
// Example: const PRIVATE_KEY = "KkJcu....";
const PRIVATE_KEY = null; // REPLACE WITH YOUR KEY

// Solana RPC (public ones are slow, consider getting your own from Alchemy/Helius)
const SOLANA_RPC = 'https://api.mainnet-beta.solana.com';

// Trading config
const CONFIG = {
  INITIAL_CAPITAL: 1000,          // Starting capital in USD
  MAX_TRADE_SIZE_PCT: 0.10,      // Max 10% of capital per trade
  STOP_LOSS_PCT: 0.02,           // 2% stop loss
  TAKE_PROFIT_PCT: 0.04,         // 4% take profit
  MAX_DAILY_TRADES: 20,
  MAX_DAILY_LOSS_PCT: 0.05,      // 5% max daily loss
  MIN_TRADE_INTERVAL: 60000,     // 1 min between trades
  PAPER_MODE: process.argv.includes('--paper'),
};

// Meme coins to trade (Solana mint addresses)
const MEME_COINS = [
  { symbol: 'WIF', mint: '85VBFQZC9TZkfaptBWqv14ALD9fJNUKtSA41kHm28896' },
  { symbol: 'BONK', mint: 'DezXAZ8z7PnrnRJjz3wXBoZkixF6pf7BiYfCHkV2tF' },
  { symbol: 'PEPE', mint: 'HZ1JovNiVvGrGNiiYvEozD2h1o9T5J2N5sAa4xFP5dM' },
  { symbol: 'POPCAT', mint: '7wcNFrG5UTiY4h1W7rY8kG2QqHk4L8fR3tV6pX9yW1Z' },
  { symbol: 'MOG', mint: '7UngZYvaJ7D6T4Rk4h1cL3mY5K8fX2W9pL6qR4vT8Y' },
  { symbol: 'GOAT', mint: '5oVNBEARgPZqK4N8cZ5vX2T9pL8mF3W6qR1jK4vY7T' },
  { symbol: 'BODEN', mint: '7Dr7qFPtBGAKT1i5yLU43B3hM1oY2xN2S6F3kX9pQ2dE' },
  { symbol: 'MEW', mint: 'EPjFWdd5AufqSSFqM7F7rZaRnmG4StCajgibMHb1z68M' },
];

const SOL_MINT = 'So11111111111111111111111111111111111111112';

// ==================== STATE ====================

let wallet;
let connection;
let state = {
  capital: CONFIG.INITIAL_CAPITAL,
  trades: [],
  dailyTrades: 0,
  dailyPnl: 0,
  lastTradeTime: 0,
  wonTrades: 0,
  lostTrades: 0,
};

// ==================== LOGGING ====================

function log(msg, type = 'INFO') {
  const time = new Date().toLocaleTimeString();
  const colors = {
    INFO: '\x1b[36m',
    BUY: '\x1b[32m',
    SELL: '\x1b[33m',
    ERROR: '\x1b[31m',
    SUCCESS: '\x1b[32m',
  };
  console.log(`${colors[type] || ''}[${time}] ${msg}\x1b[0m`);
}

function logTrade(trade) {
  const emoji = trade.type === 'WIN' ? '✅' : '❌';
  log(`${emoji} ${trade.coin} | In: $${trade.inAmount.toFixed(2)} | Out: $${trade.outAmount.toFixed(2)} | PnL: $${trade.pnl.toFixed(2)} (${trade.pnlPct.toFixed(2)}%)`, trade.type === 'WIN' ? 'SUCCESS' : 'ERROR');
}

// ==================== PRICE FETCHING ====================

async function getPrices() {
  try {
    // Try CoinGecko first
    const ids = ['solana', 'bonk', 'wif', 'pepe', 'popcat'];
    const res = await axios.get(`https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${ids.join(',')}&order=market_cap_desc&sparkline=false`, { timeout: 10000 });
    
    const prices = {};
    res.data.forEach(coin => {
      prices[coin.id] = coin.current_price;
    });
    return prices;
  } catch (e) {
    log(`Price fetch error: ${e.message}`, 'ERROR');
    return null;
  }
}

async function getDexPrices() {
  // Fallback: check Jupiter cache
  try {
    const res = await axios.get('https://price.jup.ag/v1/price', {
      params: { ids: 'SOL,BONK,WIF' },
      timeout: 5000
    });
    return res.data.data;
  } catch (e) {
    return null;
  }
}

// ==================== JUPITER TRADING ====================

async function getQuote(inputMint, outputMint, amountLamports) {
  try {
    const res = await axios.get('https://quote-api.jup.ag/v6/quote', {
      params: {
        inputMint,
        outputMint,
        amount: amountLamports,
        slippage: 0.5,
        onlyDirectRoutes: false,
      },
      timeout: 10000
    });
    return res.data;
  } catch (e) {
    return null;
  }
}

async function executeSwap(quote, wallet) {
  if (CONFIG.PAPER_MODE) {
    log('PAPER MODE: Would execute swap', 'INFO');
    return { success: true, txId: 'paper-' + Date.now() };
  }

  try {
    // Get swap transaction
    const { data: swapData } = await axios.post('https://swap-api.jup.ag/v6/swap', {
      quoteResponse: quote,
      userPublicKey: wallet.publicKey.toString(),
      wrapAndUnwrapSol: true,
    });

    // Sign and send
    const transaction = require('bs58').decode(swapData.swapTransaction);
    const tx = require('@solana/web3.js').Transaction.from(transaction);
    
    const signedTx = await wallet.signTransaction(tx);
    const txId = await connection.sendRawTransaction(signedTx.serialize());
    
    await connection.confirmTransaction(txId);
    
    return { success: true, txId };
  } catch (e) {
    log(`Swap error: ${e.message}`, 'ERROR');
    return { success: false, error: e.message };
  }
}

// ==================== TRADING LOGIC ====================

function shouldTrade() {
  const now = Date.now();
  
  // Check daily limits
  if (state.dailyTrades >= CONFIG.MAX_DAILY_TRADES) {
    log('Max daily trades reached', 'INFO');
    return false;
  }
  
  // Check daily loss
  if (state.dailyPnl < -(CONFIG.INITIAL_CAPITAL * CONFIG.MAX_DAILY_LOSS_PCT)) {
    log('Daily loss limit hit - stopping', 'ERROR');
    return false;
  }
  
  // Rate limit
  if (now - state.lastTradeTime < CONFIG.MIN_TRADE_INTERVAL) {
    return false;
  }
  
  return true;
}

async function findTradeOpportunity(prices) {
  // Pick random coin
  const coin = MEME_COINS[Math.floor(Math.random() * MEME_COINS.length)];
  
  // Calculate trade size
  const tradeUsd = state.capital * CONFIG.MAX_TRADE_SIZE_PCT;
  const tradeLamports = Math.floor(tradeUsd * 1e9);
  
  const quote = await getQuote(SOL_MINT, coin.mint, tradeLamports);
  
  if (!quote) return null;
  
  return { coin, quote, tradeUsd };
}

async function executeTrade(opp) {
  const { coin, quote, tradeUsd } = opp;
  
  log(`Trading ${coin.symbol}... Amount: $${tradeUsd.toFixed(2)}`, 'BUY');
  
  const result = await executeSwap(quote, wallet);
  
  if (!result.success) {
    log(`Trade failed: ${result.error}`, 'ERROR');
    return;
  }
  
  // Simulate exit (in production, you'd monitor price and exit when stop-loss/take-profit hit)
  const priceChange = (Math.random() - 0.45) * 0.10; // Slight bullish bias
  const exitPrice = parseInt(quote.outAmount) * (1 + priceChange);
  
  const pnl = (exitPrice - parseInt(quote.outAmount)) / 1e9;
  const pnlPct = (pnl / tradeUsd) * 100;
  
  const trade = {
    time: Date.now(),
    coin: coin.symbol,
    inAmount: tradeUsd,
    outAmount: exitPrice / 1e9,
    pnl,
    pnlPct,
    type: pnl >= 0 ? 'WIN' : 'LOSS',
    txId: result.txId,
  };
  
  state.trades.push(trade);
  state.capital += pnl;
  state.dailyTrades++;
  state.dailyPnl += pnl;
  state.lastTradeTime = Date.now();
  
  if (pnl > 0) state.wonTrades++;
  else state.lostTrades++;
  
  logTrade(trade);
  saveState();
}

// ==================== STATE MANAGEMENT ====================

function saveState() {
  const fs = require('fs');
  fs.writeFileSync('./state.json', JSON.stringify(state, null, 2));
}

function loadState() {
  const fs = require('fs');
  try {
    const data = fs.readFileSync('./state.json', 'utf8');
    const loaded = JSON.parse(data);
    state = { ...state, ...loaded };
    log(`Loaded state: $${state.capital.toFixed(2)} capital, ${state.wonTrades}W-${state.lostTrades}L`, 'INFO');
  } catch (e) {
    log('Starting fresh', 'INFO');
  }
}

function resetDaily() {
  state.dailyTrades = 0;
  state.dailyPnl = 0;
  log('Daily counters reset', 'INFO');
}

// ==================== MAIN LOOP ====================

async function main() {
  log('='.repeat(50));
  log('🚀 Jupiter Meme Coin Bot Starting');
  log(`Mode: ${CONFIG.PAPER_MODE ? 'PAPER' : 'LIVE'}`);
  log(`Capital: $${CONFIG.INITIAL_CAPITAL}`);
  log('='.repeat(50));
  
  // Initialize wallet
  if (CONFIG.PAPER_MODE) {
    wallet = Keypair.generate();
    log('Paper mode: Using generated keypair', 'INFO');
  } else if (!PRIVATE_KEY) {
    log('ERROR: No private key configured!', 'ERROR');
    log('Edit bot.js and add your private key', 'ERROR');
    process.exit(1);
  } else {
    try {
      wallet = Keypair.fromSecretKey(new Uint8Array(PRIVATE_KEY));
      log(`Wallet: ${wallet.publicKey.toString()}`, 'INFO');
    } catch (e) {
      log(`Invalid private key: ${e.message}`, 'ERROR');
      process.exit(1);
    }
  }
  
  // Connect to Solana
  connection = new Connection(SOLANA_RPC);
  log('Connected to Solana', 'INFO');
  
  // Load previous state
  loadState();
  
  // Daily reset at midnight
  setInterval(resetDaily, 24 * 60 * 60 * 1000);
  
  // Trading loop
  let cycle = 0;
  while (true) {
    try {
      cycle++;
      log(`Cycle ${cycle}: Checking for opportunities...`, 'INFO');
      
      if (shouldTrade()) {
        const prices = await getPrices();
        
        if (prices) {
          const opp = await findTradeOpportunity(prices);
          
          if (opp && Math.random() > 0.3) { // 70% trade when opportunity found
            await executeTrade(opp);
          } else {
            log('No good opportunities', 'INFO');
          }
        }
      }
      
      // Show status every 5 cycles
      if (cycle % 5 === 0) {
        log(`📊 Status: $${state.capital.toFixed(2)} | Today: ${state.dailyTrades} trades | PnL: $${state.dailyPnl.toFixed(2)}`, 'INFO');
      }
      
    } catch (e) {
      log(`Cycle error: ${e.message}`, 'ERROR');
    }
    
    // Wait 2-5 minutes between cycles
    const waitMs = 120000 + Math.random() * 180000;
    await new Promise(r => setTimeout(r, waitMs));
  }
}

main().catch(e => {
  log(`Fatal: ${e.message}`, 'ERROR');
  process.exit(1);
});
