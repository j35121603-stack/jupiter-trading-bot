/**
 * JUPITER SWAP MODULE - Real Trading Execution
 * Quick integration for live trading on Solana
 */

const { Connection, Keypair, VersionedTransaction } = require('@solana/web3.js');
const axios = require('axios');

// Configuration
const CONFIG = {
  RPC_URL: process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com',
  JUPITER_API: process.env.JUPITER_API || 'https://quote-api.jup.ag/v6',
  SLIPPAGE: 1.0, // 1% slippage
  USE_FALLBACK: true,
};

// Your wallet (NEW - Jupiter)
const PRIVATE_KEY_BASE64 = 'WR1Ak9AKe5QTk5DnqH+s6MzInn7UeF/qjHPlE/sIfEEzc5hpzfRhyGCbfj6ogSwaZXt0VmyL1AXsauP/hi18BA==';
const WALLET_ADDRESS = '4Tr2VVkKPiXg58G2VdzAq1EfFTJQZsTDHgtc6PpWJAq9';

// SOL mint address
const SOL_MINT = 'So11111111111111111111111111111111111111112';

let connection;
let wallet;

// Initialize with fallback RPCs
function init() {
  const rpcUrls = [
    'https://api.mainnet-beta.solana.com',
    'https://solana-mainnet.g.alchemy.com/v2/demo',
    'https://rpc.ankr.com/solana',
    'https://solana-rpc.publicnode.com',
    'https://mainnet.rpc.groupx.dev',
  ];
  
  // Decode base64 private key
  const privateKeyBytes = Buffer.from(PRIVATE_KEY_BASE64, 'base64');
  wallet = Keypair.fromSecretKey(privateKeyBytes);
  
  // Verify wallet address
  if (wallet.publicKey.toBase58() !== WALLET_ADDRESS) {
    console.error('❌ Wallet address mismatch!');
    console.error('   Expected:', WALLET_ADDRESS);
    console.error('   Got:', wallet.publicKey.toBase58());
    return;
  }
  
  // Try each RPC until one works
  for (const rpc of rpcUrls) {
    try {
      connection = new Connection(rpc, 'confirmed');
      console.log('✅ Wallet connected:', WALLET_ADDRESS);
      console.log('🔗 Using RPC:', rpc);
      break;
    } catch (e) {
      console.log('⚠️ RPC failed:', rpc);
    }
  }
}

// Get a quote from Jupiter - Multiple endpoints
async function getQuote(inputMint, outputMint, amountLamports) {
  const jupiterApis = [
    'https://quote-api.jup.ag/v6',
    'https://api.jup.co/v1/quote',
    'https://jupiter-swap.levvy.finance/quote',
  ];
  
  console.log('🔍 Attempting Jupiter quote...');
  
  for (const api of jupiterApis) {
    try {
      const url = `${api}/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amountLamports}&slippage=${CONFIG.SLIPPAGE}`;
      const response = await axios.get(url, { timeout: 15000 });
      if (response.data && response.data.outAmount) {
        console.log('✅ Jupiter API connected:', api);
        return response.data;
      }
    } catch (e) {
      console.log('⚠️ Jupiter API failed:', api);
    }
  }
  
  console.error('❌ All Jupiter APIs failed');
  return null;
}

// Execute a swap
async function executeSwap(inputMint, outputMint, amountLamports) {
  if (!connection || !wallet) init();
  
  try {
    console.log(`\n🔄 Getting quote for swap...`);
    
    // Get quote
    const quote = await getQuote(inputMint, outputMint, amountLamports);
    if (!quote) {
      throw new Error('Failed to get quote');
    }
    
    console.log(`   Input: ${amountLamports / 1e9} SOL`);
    console.log(`   Output: ${quote.outAmount / 1e9} tokens`);
    
    // Get swap transaction
    console.log('📝 Building transaction...');
    const swapUrl = `${CONFIG.JUPITER_API}/swap`;
    const swapResponse = await axios.post(swapUrl, {
      quoteResponse: quote,
      userPublicKey: WALLET_ADDRESS,
      wrapAndUnwrapSol: true,
    });
    
    const swapTransaction = swapResponse.data.swapTransaction;
    
    // Deserialize and sign
    const transaction = VersionedTransaction.deserialize(Buffer.from(swapTransaction, 'base64'));
    transaction.sign([wallet]);
    
    // Execute
    console.log('🚀 Executing on chain...');
    const signature = await connection.sendTransaction(transaction, {
      maxRetries: 3,
    });
    
    console.log('✅ Swap executed!');
    console.log(`   Signature: ${signature}`);
    console.log(`   Explorer: https://solscan.io/tx/${signature}`);
    
    return {
      success: true,
      signature,
      inputAmount: amountLamports / 1e9,
      outputAmount: quote.outAmount / 1e9,
    };
    
  } catch (e) {
    console.error('❌ Swap failed:', e.message);
    return { success: false, error: e.message };
  }
}

// Buy a token with SOL
async function buyToken(tokenMint, solAmount) {
  const amountLamports = Math.floor(solAmount * 1e9);
  return await executeSwap(SOL_MINT, tokenMint, amountLamports);
}

// Sell a token for SOL
async function sellToken(tokenMint, tokenAmount) {
  // Note: Need token account balance - simplified for now
  // This would need to get the actual token balance
  return { success: false, error: 'Sell not implemented - needs token balance check' };
}

// Check wallet balance
async function getBalance() {
  if (!connection) init();
  
  try {
    const bal = await connection.getBalance(wallet.publicKey);
    return bal / 1e9; // Convert lamports to SOL
  } catch (e) {
    console.error('Balance error:', e.message);
    return 0;
  }
}

module.exports = {
  init,
  getQuote,
  executeSwap,
  buyToken,
  sellToken,
  getBalance,
  WALLET_ADDRESS,
  SOL_MINT,
};
