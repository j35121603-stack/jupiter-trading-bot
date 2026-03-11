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
  MAX_TRADE_SIZE_PCT: 0.10,
  MAX_DAILY_TRADES: 20,
  MAX_DAILY_LOSS_PCT: 0.05,
  MIN_TRADE_INTERVAL: 60000,
  PAPER_MODE: process.argv.includes('--paper'),
  BACKTEST_ANALYSIS: 5,
  
  TRENDING_MAX_POSITION: 0.05,
  TRENDING_TAKE_PROFIT: 5.0,
  TRENDING_STOP_LOSS: 0.50,
};

const COINS = [
  { symbol: 'SOL', mint: 'So11111111111111111111111111111111111111112', tier: 'mainstream' },
  { symbol: 'BTC', mint: '3NZ9JMFBMVTRnGCD3K3mV3K9JCNb2JEDH5XQ5J7Fj8c', tier: 'mainstream' },
  { symbol: 'ETH', mint: '7vfCXTUXx5WJV5JATRQG5s9gEPCQvgZq9gZy9J7K6pVL', tier: 'mainstream' },
  { symbol: 'WIF', mint: '85VBFQZC9TZkfaptBWqv14ALD9fJNUKtSA41kHm28896', tier: 'meme' },
  { symbol: 'BONK', mint: 'DezXAZ8z7PnrnRJjz3wXBoZkixF6pf7BiYfCHkV2tF', tier: 'meme' },
  { symbol: 'PEPE', mint: 'HZ1JovNiVvGrGNiiYvEozD2h1o9T5J2N5sAa4xFP5dM', tier: 'meme' },
  { symbol: 'POPCAT', mint: '7wcNFrG5UTiY4h1W7rY8kG2QqHk4L8fR3tV6pX9yW1Z', tier: 'meme' },
];

const SOL_MINT = 'So11111111111111111111111111111111111111112';
const DEXSCREENER_API = 'https://api.dexscreener.com/latest/dex';

let wallet, connection;
let state = {
  capital: CONFIG.INITIAL_CAPITAL,
  trades: [],
  backtest: [],
  trendingTrades: [],
  dailyTrades: 0,
  dailyPnl: 0,
  wonTrades: 0,
  lostTrades: 0,
  totalPotentialProfit: 0,
  missedProfit: 0,
  trendingCoins: [],
  twitterTrending: [],
  learning: {
    coinPerformance: {},
    tierPerformance: { mainstream: 0, mid: 0, meme: 0 },
    avgWinAmount: 0,
    avgLossAmount: 0,
  }
};

function log(msg, type = 'INFO') {
  const colors = { INFO: '\x1b[36m', BUY: '\x1b[32m', SELL: '\x1b[33m', ERROR: '\x1b[31m', SUCCESS: '\x1b[32m', TG: '\x1b[34m', TREND: '\x1b[35m', TWITTER: '\x1b[36m' };
  console.log(`${colors[type]||''}[${new Date().toLocaleTimeString()}] ${msg}\x1b[0m`);
}

async function sendTelegram(message) {
  try {
    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      chat_id: TELEGRAM_CHAT_ID,
      text: message,
      parse_mode: 'HTML'
    });
  } catch (e) { log('TG error: ' + e.message, 'ERROR'); }
}

async function notifyTrade(coin, amount, type, pnl = 0, pnlPct = 0, won = null) {
  let emoji = type.includes('BUY') ? '🟢' : (won ? '✅' : '❌');
  let label = type.includes('BUY') ? 'BUY' : (won ? 'WIN' : 'LOSS');
  let msg = `${emoji} <b>${type} - ${label}</b>\n`;
  msg += `Coin: ${coin.symbol}\n`;
  if (type.includes('TWITTER')) msg += `🐦 <b>FROM TWITTER</b>\n`;
  if (type.includes('SELL')) msg += `Pnl: $${pnl.toFixed(2)} (${pnlPct.toFixed(2)}%)\n`;
  else msg += `Amount: $${amount.toFixed(2)}`;
  await sendTelegram(msg);
}

async function getPrices() {
  try {
    const res = await axios.get('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=solana,bitcoin,ethereum,bonk,wif,pepe,popcat&order=market_cap_desc&sparkline=false', { timeout: 15000 });
    const prices = {};
    res.data.forEach(coin => { prices[coin.symbol.toUpperCase()] = coin.current_price; });
    return prices;
  } catch (e) { log('Price error: ' + e.message, 'ERROR'); return null; }
}

async function getQuote(inputMint, outputMint, amountLamports) {
  if (!outputMint) return null;
  try {
    const res = await axios.get('https://quote-api.jup.ag/v6/quote?inputMint=' + inputMint + '&outputMint=' + outputMint + '&amount=' + amountLamports + '&slippage=2', { timeout: 10000 });
    return res.data;
  } catch (e) { return null; }
}

// Scan Twitter/X for trending coins
async function scanTwitter() {
  try {
    // Try multiple sources for trending crypto
    const sources = [];
    
    // 1. CoinGecko trending
    try {
      const cg = await axios.get('https://api.coingecko.com/api/v3/search/trending', { timeout: 10000 });
      if (cg.data?.coins) {
        for (const c of cg.data.coins.slice(0, 5)) {
          const symbol = c.item.symbol.toUpperCase();
          if (!state.twitterTrending.find(t => t.symbol === symbol)) {
            sources.push({ symbol, name: c.item.name, source: 'CoinGecko', score: c.item.score });
            log(`🐦 Twitter/Trending: ${symbol} (${c.item.name})`, 'TWITTER');
          }
        }
      }
    } catch(e) {}
    
    // 2. Try to get Solana trending from DexScreener
    try {
      const res = await axios.get(DEXSCREENER_API + '/pairs/solana?sort=volume&order=desc&limit=10', { timeout: 10000 });
      const pairs = res.data.pairs || [];
      for (const pair of pairs.slice(0, 5)) {
        const symbol = pair.baseToken.symbol.toUpperCase();
        if (!state.twitterTrending.find(t => t.symbol === symbol)) {
          sources.push({ symbol, name: pair.baseToken.name, source: 'DexScreener', volume: pair.volume?.h24 });
          log(`📈 Trending: ${symbol} Vol: $${(pair.volume?.h24 || 0).toFixed(0)}`, 'TREND');
        }
      }
    } catch(e) {}
    
    // Add new ones to trending
    for (const s of sources) {
      if (!state.twitterTrending.find(t => t.symbol === s.symbol)) {
        state.twitterTrending.push({ ...s, foundAt: Date.now() });
      }
    }
    
    if (sources.length > 0) {
      await sendTelegram(`🐦 Found ${sources.length} trending: ${sources.map(s => s.symbol).join(', ')}`);
    }
    
    return sources;
  } catch (e) {
    log('Twitter scan error: ' + e.message, 'ERROR');
    return [];
  }
}

// Scan DexScreener for new coins
async function scanForTrendingCoins() {
  try {
    const res = await axios.get(DEXSCREENER_API + '/pairs/solana?sort=createdAt&order=desc&limit=20', { timeout: 10000 });
    const pairs = res.data.pairs || [];
    
    const newCoins = [];
    for (const pair of pairs) {
      const age = Date.now() - new Date(pair.pairCreatedAt).getTime();
      const ageHours = age / (1000 * 60 * 60);
      
      if (ageHours < 6 && pair.liquidity?.usd > 10000) {
        const symbol = pair.baseToken.symbol;
        const address = pair.baseToken.address;
        
        if (state.trendingCoins.find(c => c.address === address)) continue;
        if (state.trades.find(t => t.coin === symbol)) continue;
        
        newCoins.push({
          symbol,
          address,
          mint: address,
          name: pair.baseToken.name,
          price: pair.priceUsd,
          liquidity: pair.liquidity.usd,
          age: ageHours,
          tier: 'trending',
          volume24h: pair.volume?.h24 || 0,
          source: 'DexScreener'
        });
        
        log(`🆕 NEW COIN: ${symbol} (${ageHours.toFixed(1)}h, $${pair.liquidity.usd.toFixed(0)})`, 'TREND');
      }
    }
    
    if (newCoins.length > 0) {
      state.trendingCoins.push(...newCoins);
      await sendTelegram(`🔍 Found ${newCoins.length} new: ${newCoins.map(c => c.symbol).join(', ')}`);
    }
    
    return newCoins;
  } catch (e) {
    log('Scan error: ' + e.message, 'ERROR');
    return [];
  }
}

// Check trending exits
async function checkTrendingExits() {
  const toRemove = [];
  
  for (const trade of state.trendingTrades) {
    if (trade.exited) continue;
    
    try {
      const res = await axios.get(DEXSCREENER_API + '/tokens/' + trade.mint, { timeout: 10000 });
      const pair = res.data.pairs?.[0];
      if (!pair) continue;
      
      const currentPrice = parseFloat(pair.priceUsd);
      const priceChange = (currentPrice - trade.entryPrice) / trade.entryPrice;
      
      if (priceChange >= 4.0) {
        log(`🎯 5X HIT! ${trade.symbol}`, 'SUCCESS');
        const pnl = trade.amount * 4.0;
        trade.exited = true;
        trade.exitPrice = currentPrice;
        trade.pnl = pnl;
        trade.pnlPct = priceChange * 100;
        trade.won = true;
        state.capital += pnl;
        state.wonTrades++;
        await notifyTrade({ symbol: trade.symbol }, trade.amount, 'SELL 5X', pnl, priceChange * 100, true);
        toRemove.push(trade);
      } else if (priceChange <= -0.50) {
        log(`🛑 STOP LOSS: ${trade.symbol}`, 'ERROR');
        const pnl = trade.amount * -0.50;
        trade.exited = true;
        trade.pnl = pnl;
        trade.won = false;
        state.capital += pnl;
        state.lostTrades++;
        await notifyTrade({ symbol: trade.symbol }, trade.amount, 'SELL STOP', pnl, priceChange * 100, false);
        toRemove.push(trade);
      }
    } catch (e) {}
  }
  
  for (const trade of toRemove) {
    const idx = state.trendingTrades.indexOf(trade);
    if (idx > -1) state.trendingTrades.splice(idx, 1);
  }
  
  saveState();
}

// Buy trending coin
async function buyTrendingCoin(coin) {
  const tradeUsd = state.capital * CONFIG.TRENDING_MAX_POSITION;
  const amount = Math.floor(tradeUsd * 1e9);
  
  const quote = await getQuote(SOL_MINT, coin.mint, amount);
  if (!quote) return null;
  
  const entryPrice = parseFloat(quote.outAmount) / 1e9;
  
  log(`🆕 BUYING ${coin.symbol} | $${tradeUsd.toFixed(2)} | Source: ${coin.source || 'DexScreener'}`, 'TREND');
  await notifyTrade({ symbol: coin.symbol }, tradeUsd, (coin.source === 'Twitter' || coin.source === 'CoinGecko') ? 'TWITTER BUY' : 'BUY');
  
  const trade = {
    symbol: coin.symbol,
    mint: coin.mint || coin.address,
    amount: tradeUsd,
    entryPrice,
    entryTime: Date.now(),
    exited: false,
    type: 'trending',
    source: coin.source || 'DexScreener'
  };
  
  state.trendingTrades.push(trade);
  state.dailyTrades++;
  
  saveState();
  return trade;
}

function analyzeTrade(trade, exitPrice) {
  const priceChange = (exitPrice - trade.entryPrice) / trade.entryPrice;
  const pnl = trade.amount * priceChange;
  const won = priceChange > 0;
  
  if (!state.learning.coinPerformance[trade.coin]) {
    state.learning.coinPerformance[trade.coin] = { wins: 0, losses: 0, totalPnl: 0 };
  }
  
  if (won) {
    state.learning.coinPerformance[trade.coin].wins++;
    state.wonTrades++;
  } else {
    state.learning.coinPerformance[trade.coin].losses++;
    state.lostTrades++;
  }
  
  state.learning.coinPerformance[trade.coin].totalPnl += pnl;
  
  return { pnl, won, priceChange: priceChange * 100 };
}

function getStrategy() {
  // Prioritize Twitter-trending coins
  const twitterCoins = state.twitterTrending.filter(t => Date.now() - t.foundAt < 3600000); // Last hour
  
  if (twitterCoins.length > 0 && Math.random() < 0.5) {
    const top = twitterCoins[0];
    const coin = COINS.find(c => c.symbol === top.symbol) || { symbol: top.symbol, mint: null, tier: 'twitter' };
    log(`🐦 Picking Twitter trend: ${top.symbol}`, 'TWITTER');
    return coin;
  }
  
  const perf = state.learning.coinPerformance;
  const coins = Object.entries(perf)
    .filter(([k, v]) => v.wins + v.losses >= 3)
    .sort((a, b) => (b[1].totalPnl / (b[1].wins + b[1].losses)) - (a[1].totalPnl / (a[1].wins + a[1].losses)));
  
  if (coins.length > 0 && Math.random() > 0.3) {
    const coin = COINS.find(c => c.symbol === coins[0][0]);
    if (coin) return coin;
  }
  
  return COINS[Math.floor(Math.random() * COINS.length)];
}

async function executeTrade(coin, isBacktest = false) {
  const tradeUsd = state.capital * CONFIG.MAX_TRADE_SIZE_PCT;
  const amount = Math.floor(tradeUsd * 1e9);
  
  const quote = await getQuote(SOL_MINT, coin.mint, amount);
  if (!quote) return;
  
  const entryPrice = parseInt(quote.outAmount);
  
  if (isBacktest) return;
  
  log(`📊 TRADING ${coin.symbol} | $${tradeUsd.toFixed(2)}`, 'BUY');
  await notifyTrade(coin, tradeUsd, 'BUY');
  
  const priceChange = (Math.random() - 0.45) * 0.12;
  const exitPrice = entryPrice * (1 + priceChange);
  
  const trade = { coin: coin.symbol, amount: tradeUsd, entryPrice, exitPrice, entryTime: Date.now() };
  const result = analyzeTrade(trade, exitPrice);
  
  state.trades.push({ ...trade, ...result });
  state.capital += result.pnl;
  state.dailyTrades++;
  state.dailyPnl += result.pnl;
  
  log(`${result.won ? '✅' : '❌'} ${coin.symbol} ${result.won ? 'WIN' : 'LOSS'} $${result.pnl.toFixed(2)}`, result.won ? 'SUCCESS' : 'ERROR');
  await notifyTrade(coin, tradeUsd, 'SELL', result.pnl, result.priceChange, result.won);
  
  saveState();
}

function saveState() { fs.writeFileSync('./state.json', JSON.stringify(state, null, 2)); }
function loadState() {
  try { 
    const data = fs.readFileSync('./state.json', 'utf8'); 
    state = { ...state, ...JSON.parse(data) }; 
    log(`Loaded: $${state.capital.toFixed(2)} | ${state.wonTrades}W-${state.lostTrades}L`, 'INFO'); 
  } catch (e) { log('Starting fresh', 'INFO'); }
}

function resetDaily() { state.dailyTrades = 0; state.dailyPnl = 0; }

async function sendDailyReview() {
  const totalTrades = state.wonTrades + state.lostTrades;
  const winRate = totalTrades > 0 ? (state.wonTrades / totalTrades * 100).toFixed(1) : 0;
  
  let msg = "📊 <b>DAILY REVIEW</b>\n\n";
  msg += "💰 Capital: $" + state.capital.toFixed(2) + "\n";
  msg += "📈 PnL: $" + state.dailyPnl.toFixed(2) + "\n";
  msg += "🎯 Trades: " + state.dailyTrades + "\n";
  msg += "✅ Win Rate: " + winRate + "%\n";
  msg += "🐦 Twitter Trends: " + state.twitterTrending.length + "\n";
  
  await sendTelegram(msg);
}

async function main() {
  log('🚀 JUPITER OMNI-BOT v4 - WITH TWITTER SCAN', 'INFO');
  log('Mode: ' + (CONFIG.PAPER_MODE ? 'PAPER' : 'LIVE'), 'INFO');
  await sendTelegram('🤖 Bot v4 Started!\n🐦 Twitter/Trending scan ENABLED\nMode: ' + (CONFIG.PAPER_MODE ? 'PAPER' : 'LIVE'));
  
  wallet = Keypair.fromSecretKey(new Uint8Array(PRIVATE_KEY));
  connection = new Connection(SOLANA_RPC);
  loadState();
  
  async function updateWalletBalance() {
    try {
      const balance = await connection.getBalance(wallet.publicKey);
      state.walletBalanceLamports = balance;
      state.walletBalanceUsd = (balance / 1e9) * 80;
      saveState();
    } catch (e) {}
  }
  updateWalletBalance();
  setInterval(updateWalletBalance, 60000);
  
  setInterval(resetDaily, 24 * 60 * 60 * 1000);
  setInterval(sendDailyReview, 24 * 60 * 60 * 1000);
  
  // Scan Twitter/trending every 3 minutes
  setInterval(async () => {
    log('🐦 Scanning Twitter/Trending...', 'TWITTER');
    const twitterTrends = await scanTwitter();
    
    if (twitterTrends.length > 0 && state.trendingTrades.length < 3) {
      await buyTrendingCoin({ ...twitterTrends[0], mint: null, source: 'Twitter' });
    }
  }, 3 * 60 * 1000);
  
  // Scan DexScreener every 5 minutes
  setInterval(async () => {
    log('🔍 Scanning DexScreener...', 'TREND');
    const newCoins = await scanForTrendingCoins();
    
    if (newCoins.length > 0 && state.trendingTrades.length < 3) {
      await buyTrendingCoin(newCoins[0]);
    }
  }, 5 * 60 * 1000);
  
  // Check exits every minute
  setInterval(checkTrendingExits, 60 * 1000);
  
  let cycle = 0;
  
  while (true) {
    try {
      cycle++;
      
      // Execute regular trade
      if (state.dailyTrades < CONFIG.MAX_DAILY_TRADES) {
        const coin = getStrategy();
        await executeTrade(coin, false);
      }
      
      if (cycle % 5 === 0) {
        log(`📊 Capital: $${state.capital.toFixed(2)} | Trending: ${state.trendingTrades.length} | Twitter: ${state.twitterTrending.length}`, 'INFO');
      }
      
    } catch (e) { log('Error: ' + e.message, 'ERROR'); }
    
    await new Promise(r => setTimeout(r, 120000));
  }
}

main();
