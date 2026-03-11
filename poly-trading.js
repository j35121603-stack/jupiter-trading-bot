/**
 * POLYMARKET TRADING MODULE
 * 
 * Programmatic trading for Polymarket prediction markets
 * Built on Polygon network
 * 
 * Usage:
 *   const { PolyTrader } = require('./poly-trading.js');
 *   const trader = new PolyTrader(privateKey);
 *   await trader.placeOrder(marketAddress, outcome, amount);
 */

const { ethers } = require('ethers');

// Polymarket Contract Addresses (Polygon Mainnet)
const CONTRACTS = {
  // ERC20 Token (USDC)
  USDC: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
  
  // CLOBProxy - Main trading contract
  CLOBProxy: '0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E',
  
  // Conditional Token contract
  ConditionalToken: '0x4D97BB6a2541d0eB5d4E4A4A2d8B3d5F3E9d7c8',
};

// Polygon RPC
const RPC_URL = 'https://polygon-rpc.com';

// ABI for CLOB (Central Limit Order Book)
const CLOB_ABI = [
  'function buy(address token, uint256 amount, uint256 maxCost) returns (uint256)',
  'function sell(address token, uint256 amount, uint256 minProceeds) returns (uint256)',
  'function createOrder(address token, uint256 amount, uint256 price) returns (uint256)',
  'function cancelOrder(uint256 orderId) returns (bool)',
  'function getOrder(uint256 orderId) view returns (tuple(address trader, address token, uint256 amount, uint256 price, bool isBuy, uint256 timestamp))',
  'function getBestPrice(address token, bool isBuy) view returns (uint256)',
  'function getWETH() view returns (address)',
];

const TOKEN_ABI = [
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function balanceOf(address account) view returns (uint256)',
];

class PolyTrader {
  constructor(privateKey) {
    if (!privateKey || privateKey === 'YOUR_PRIVATE_KEY_HERE') {
      throw new Error('Invalid private key. Please provide a valid Polygon private key.');
    }
    
    this.provider = new ethers.JsonRpcProvider(RPC_URL);
    
    // Handle private key format
    if (privateKey.startsWith('0x')) {
      this.wallet = new ethers.Wallet(privateKey, this.provider);
    } else {
      this.wallet = new ethers.Wallet(privateKey, this.provider);
    }
    
    this.clob = new ethers.Contract(CONTRACTS.CLOBProxy, CLOB_ABI, this.wallet);
    this.usdc = new ethers.Contract(CONTRACTS.USDC, TOKEN_ABI, this.wallet);
    
    console.log(`🔗 Connected to Polymarket with wallet: ${this.wallet.address}`);
  }
  
  async getBalance() {
    const balance = await this.usdc.balanceOf(this.wallet.address);
    return ethers.formatUnits(balance, 6); // USDC has 6 decimals
  }
  
  async getETHBalance() {
    const balance = await this.provider.getBalance(this.wallet.address);
    return ethers.formatEther(balance);
  }
  
  async approveUSDC(amount) {
    const amountWei = ethers.parseUnits(amount.toString(), 6);
    const tx = await this.usdc.approve(CONTRACTS.CLOBProxy, amountWei);
    await tx.wait();
    console.log('✅ USDC approved for trading');
    return tx.hash;
  }
  
  async checkAllowance() {
    const allowance = await this.usdc.allowance(this.wallet.address, CONTRACTS.CLOBProxy);
    return ethers.formatUnits(allowance, 6);
  }
  
  async getMarketPrices(marketAddress) {
    // Get best bid/ask for a market
    const bestBid = await this.clob.getBestPrice(marketAddress, false); // sell = bid
    const bestAsk = await this.clob.getBestPrice(marketAddress, true);  // buy = ask
    
    return {
      bid: ethers.formatUnits(bestBid, 8),  // Conditional tokens have 8 decimals
      ask: ethers.formatUnits(bestAsk, 8),
    };
  }
  
  async buyYes(marketAddress, amount, maxCost = null) {
    // amount is in dollars (USDC)
    const amountWei = ethers.parseUnits(amount.toString(), 6);
    
    // If no max cost specified, allow 10% slippage
    if (!maxCost) {
      maxCost = amountWei * 110n / 100n;
    }
    
    try {
      const tx = await this.clob.buy(marketAddress, amountWei, maxCost, {
        gasLimit: 500000
      });
      
      console.log(`📝 Buy order submitted: ${tx.hash}`);
      const receipt = await tx.wait();
      console.log(`✅ Buy order executed!`);
      
      return { hash: tx.hash, receipt };
    } catch (error) {
      console.error('❌ Buy order failed:', error.message);
      throw error;
    }
  }
  
  async sellYes(marketAddress, amount, minProceeds = null) {
    const amountWei = ethers.parseUnits(amount.toString(), 6);
    
    if (!minProceeds) {
      minProceeds = amountWei * 90n / 100n; // 10% slippage
    }
    
    try {
      const tx = await this.clob.sell(marketAddress, amountWei, minProceeds, {
        gasLimit: 500000
      });
      
      console.log(`📝 Sell order submitted: ${tx.hash}`);
      const receipt = await tx.wait();
      console.log(`✅ Sell order executed!`);
      
      return { hash: tx.hash, receipt };
    } catch (error) {
      console.error('❌ Sell order failed:', error.message);
      throw error;
    }
  }
  
  // Convenience method for placing a bet
  async placeBet(marketAddress, outcome, amount, price = null) {
    // outcome: 'yes' or 'no'
    // amount: dollar amount to spend
    // price: (optional) max price you're willing to pay
    
    if (outcome.toLowerCase() === 'yes') {
      return this.buyYes(marketAddress, amount, price ? ethers.parseUnits(price.toString(), 6) : null);
    } else {
      // For 'no', we need the token address for 'no' outcome
      console.log('⚠️ "No" trades require the specific no-token address');
      throw new Error('No outcome trading not yet implemented');
    }
  }
  
  // Get full market info
  async getMarketInfo(marketAddress) {
    // This would need additional contract calls to get full market data
    // For now, return basic info
    return {
      address: marketAddress,
      trader: this.wallet.address,
    };
  }
}

// Alternative: Use Polymarket's API for order placement (simpler but less control)
class PolyAPITrader {
  constructor(apiKey = null) {
    this.apiKey = apiKey;
    this.baseUrl = 'https://gamma-api.polymarket.com';
  }
  
  async getMarkets(params = {}) {
    const query = new URLSearchParams(params);
    const response = await fetch(`${this.baseUrl}/markets?${query}`);
    return response.json();
  }
  
  async getMarketPrices(conditionId) {
    const response = await fetch(`https://data-api.polymarket.com/prices?conditionId=${conditionId}`);
    return response.json();
  }
  
  async getOrderBook(marketAddress) {
    const response = await fetch(`https://data-api.polymarket.com/orderbook?conditionId=${marketAddress}`);
    return response.json();
  }
}

module.exports = { PolyTrader, PolyAPITrader, CONTRACTS };
