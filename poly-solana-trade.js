/**
 * Poly Trading Bot - Using Solana Wallet
 */

const bs58 = require('bs58');
const { Keypair, Connection, PublicKey } = require('@solana/web3.js');
const { default: axios } = require('axios');

// Solana wallet from earlier
const PRIVATE_KEY_ARRAY = [251,29,114,181,142,96,158,60,191,29,28,215,45,235,164,89,18,76,7,86,18,196,204,45,107,2,180,123,32,26,120,179,163,137,111,217,115,32,78,114,232,19,195,235,243,114,134,190,86,39,89,168,10,43,167,105,138,213,206,226,68,208,102,225];
const wallet = Keypair.fromSecretKey(new Uint8Array(PRIVATE_KEY_ARRAY));

console.log('Solana Wallet:', wallet.publicKey.toBase58());

const POLY_API = 'https://gamma-api.polymarket.com';

async function getMarkets() {
  try {
    const res = await axios.get(`${POLY_API}/markets?closed=false&limit=10`);
    return res.data.map(m => ({
      id: m.id,
      question: m.question,
      prices: JSON.parse(m.outcomePrices || '[]'),
      volume: parseFloat(m.volume || 0)
    })).filter(m => m.volume > 50000);
  } catch(e) {
    console.log('Error:', e.message);
    return [];
  }
}

async function main() {
  console.log('Checking markets...');
  const markets = await getMarkets();
  
  if (markets.length > 0) {
    console.log('\\nTop markets:');
    markets.slice(0, 5).forEach(m => {
      console.log(`- ${m.question.substring(0, 40)}... YES: ${(m.prices[0]*100).toFixed(0)}% Vol: $${Math.round(m.volume/1000)}K`);
    });
  }
}

main();
