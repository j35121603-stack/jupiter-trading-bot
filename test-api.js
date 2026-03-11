const axios = require('axios');
const https = require('https');
const dns = require('dns');
const { URL } = require('url');

// Force DNS to use Google DNS
dns.setServers(['8.8.8.8', '8.8.4.4']);

const WALLET_ADDRESS = '54FksWWGjGWAwEv9UnijnbhAKgtYMRvLz3H2bHsyDqTU';
const JUPITER_API = 'https://quote-api.jup.ag/v6';

const CONFIG = {
  PAPER_MODE: process.argv.includes('--paper'),
  INITIAL_CAPITAL: 1000,
  MAX_RISK_PER_TRADE: 0.02,
  MAX_DAILY_TRADES: 15,
  DAILY_LOSS_LIMIT: 0.05,
  MIN_PROFIT_THRESHOLD: 0.005,
};

let state = {
  capital: CONFIG.INITIAL_CAPITAL,
  trades: [],
  dailyTrades: 0,
  dailyPnl: 0,
};

const MEME_COINS = [
  { symbol: 'WIF', mint: '85VBFQZC9TZkfaptBWqv14ALD9fJNUKtSA41kHm28896' },
  { symbol: 'BONK', mint: 'DezXAZ8z7PnrnRJjz3wXBoZkixF6pf7BiYfCHkV2tF' },
  { symbol: 'PEPE', mint: 'HZ1JovNiVvGrGNiiYvEozD2h1o9T5J2N5sAa4xFP5dM' },
  { symbol: 'POPCAT', mint: '7wcNFrG5UTiY4h1W7rY8kG2QqHk4L8fR3tV6pX9yW1Z' },
];

const fs = require('fs');

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

async function getQuote(inputMint, outputMint, amount) {
  try {
    const res = await axios.get(`${JUPITER_API}/quote`, {
      params: { inputMint, outputMint, amount, slippage: 0.5 },
      timeout: 15000
    });
    return res.data;
  } catch (e) {
    log(`Quote error: ${e.message}`);
    return null;
  }
}

async function testAPI() {
  log('Testing Jupiter API...');
  const quote = await getQuote(
    'So11111111111111111111111111111111111111112',
    'DezXAZ8z7PnrnRJjz3wXBoZkixF6pf7BiYfCHkV2tF',
    '1000000000'
  );
  if (quote) {
    log('✅ Jupiter API working! Found quote for BONK');
    log(`   Output: ${quote.outAmount} lamports`);
  } else {
    log('❌ Jupiter API not responding');
  }
}

testAPI();
