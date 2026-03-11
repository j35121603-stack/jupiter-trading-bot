/**
 * Poly Live Trading - Using viem
 */

const { ClobClient } = require("@polymarket/clob-client");
const { createWalletClient, http } = require("viem");
const { privateKeyToAccount } = require("viem/accounts");

const PRIVATE_KEY = "0x07591b6ea9f6a69211d9e643f6785b3bc5c4252a507539147634e4f065fa1cf3";

async function main() {
  console.log('🔑 Setting up Poly client...');
  
  try {
    // Create account from private key
    const account = privateKeyToAccount(PRIVATE_KEY);
    console.log('Wallet address:', account.address);
    
    // Create viem wallet client with Polygon
    const polygonMainnet = {
      id: 137,
      name: 'Polygon',
      network: 'polygon',
      nativeCurrency: { name: 'MATIC', symbol: 'MATIC', decimals: 18 },
      rpcUrls: { default: { http: ['https://polygon-rpc.com'] } }
    };
    
    const wc = createWalletClient({
      account,
      chain: polygonMainnet,
      transport: http()
    });
    
    // Create CLOB client with viem wallet
    const client = new ClobClient(
      "https://clob.polymarket.com",
      137, // Polygon chain ID
      wc
    );
    
    console.log('Client created, trying to get credentials...');
    
    // Try to create or derive API key
    const credentials = await client.createOrDeriveApiKey();
    
    console.log('✅ Credentials obtained!');
    console.log('API Key:', credentials.apiKey);
    console.log('Secret:', credentials.secret);
    console.log('Passphrase:', credentials.passphrase);
    
    // Save credentials
    const fs = require('fs');
    fs.writeFileSync('poly-credentials.json', JSON.stringify(credentials));
    console.log('Credentials saved!');
    
  } catch (e) {
    console.log('❌ Error:', e.message);
  }
}

main();
