/**
 * Poly Live Trading - Direct API Trade
 */

const axios = require('axios');
const crypto = require('crypto');

const API_KEY = "A4BZQh_15LTmgaP6oSyQ5cAxDTarAiF_hHrPo71C31Q=";
const SECRET = "A4BZQh_15LTmgaP6oSyQ5cAxDTarAiF_hHrPo71C31Q=";
const PASSPHRASE = "ec9f7ec991d633e491f00d10fbbc21f7a17c0d0378ac5f139c4369a627c8fb73";
const ADDRESS = "0x4F16F640010D63Da6FAb14EA4A161b4C22B26078";

// Get market info first
async function getMarkets() {
  try {
    const res = await axios.get('https://gamma-api.polymarket.com/markets?closed=false&limit=5');
    return res.data.map(m => ({
      id: m.id,
      question: m.question,
      tokenId: m.clobTokenIds ? JSON.parse(m.clobTokenIds)[0] : null,
      prices: JSON.parse(m.outcomePrices || '[]'),
      volume: parseFloat(m.volume || 0)
    })).filter(m => m.tokenId && m.volume > 100000);
  } catch(e) {
    console.log('Error:', e.message);
    return [];
  }
}

async function createOrder(tokenId, price, size, side) {
  const timestamp = Math.floor(Date.now() / 1000);
  const nonce = Math.floor(Math.random() * 1000000);
  
  // For order creation, we need L1 signature (private key)
  // This won't work without the private key signing
  
  console.log('Would create order:', { tokenId, price, size, side });
  console.log('Need private key to sign the order');
}

async function getBalances() {
  const timestamp = Math.floor(Date.now() / 1000);
  const nonce = 0;
  
  const message = `${timestamp}${nonce}${ADDRESS}`;
  const signature = crypto.createHmac('sha256', SECRET).update(message).digest('base64');
  
  try {
    const res = await axios.get(`https://data-api.polymarket.com/positions?user=${ADDRESS}`, {
      headers: {
        'POLY_ADDRESS': ADDRESS,
        'POLY_API_KEY': API_KEY,
        'POLY_PASSPHRASE': PASSPHRASE,
        'POLY_SIGNATURE': signature,
        'POLY_TIMESTAMP': timestamp.toString(),
        'POLY_NONCE': nonce.toString()
      }
    });
    console.log('Positions:', JSON.stringify(res.data, null, 2));
  } catch(e) {
    console.log('Error:', e.response?.data || e.message);
  }
}

async function main() {
  console.log('Wallet:', ADDRESS);
  console.log('\\nChecking positions...');
  await getBalances();
  
  console.log('\\nTop markets:');
  const markets = await getMarkets();
  markets.slice(0, 3).forEach(m => {
    console.log(`- ${m.question.substring(0, 40)}... YES: ${(m.prices[0]*100).toFixed(0)}%`);
  });
}

main();
