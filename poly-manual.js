/**
 * Poly Bot - Manual Trade System
 * Bot analyzes and suggests trades, user executes
 */

const fs = require('fs');
const axios = require('axios');

const POLY_API = 'https://gamma-api.polymarket.com';
const TELEGRAM_BOT_TOKEN = "8460832535:AAEVnaEwFl7_BEazPF6rJJz4FCgrAk6TIvs";
const TELEGRAM_CHAT_ID = "7725826486";

const CONFIG = {
  minConfidence: 0.5,
  maxPositionSize: 20,
};

// State
let state = {
  trades: [],
  startedAt: Date.now(),
};

function loadState() {
  try {
    state = JSON.parse(fs.readFileSync('poly-manual-state.json', 'utf8'));
  } catch (e) {}
}

function saveState() {
  fs.writeFileSync('poly-manual-state.json', JSON.stringify(state, null, 2));
}

async function sendTelegram(msg) {
  try {
    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      chat_id: TELEGRAM_CHAT_ID,
      text: msg,
      parse_mode: 'HTML'
    });
  } catch(e) {}
}

async function getMarkets() {
  try {
    const response = await axios.get(`${POLY_API}/markets?closed=false&limit=50`, { timeout: 10000 });
    return response.data.map(m => {
      const prices = JSON.parse(m.outcomePrices || '[]');
      return {
        id: m.id,
        question: m.question,
        yesPrice: parseFloat(prices[0]) || 0.5,
        noPrice: parseFloat(prices[1]) || 0.5,
        volume: parseFloat(m.volume || 0),
      };
    }).filter(m => m.volume > 50000);
  } catch (e) {
    return [];
  }
}

function generateSignal(market) {
  const { yesPrice, volume } = market;
  if (yesPrice < 0.35 || yesPrice > 0.70) return null;
  const confidence = Math.abs(yesPrice - 0.5) * 2;
  if (confidence < CONFIG.minConfidence) return null;
  return {
    direction: yesPrice > 0.5 ? 'YES' : 'NO',
    confidence,
    reason: `$${Math.round(volume/1000)}K vol`
  };
}

async function tradingLoop() {
  console.log('🔍 Scanning markets...');
  
  const markets = await getMarkets();
  if (markets.length === 0) return;
  
  // Find best opportunity
  for (const market of markets) {
    const signal = generateSignal(market);
    if (signal) {
      const tradeMsg = `🎯 <b>TRADE OPPORTUNITY</b>\n\n${signal.direction} ${market.question.substring(0, 60)}...\n\nPrice: ${(market.yesPrice*100).toFixed(0)}%\nConfidence: ${(signal.confidence*100).toFixed(0)}%\nVolume: $${Math.round(market.volume/1000)}K\n\nLink: https://polymarket.com/market/${market.id}`;
      
      console.log(`Found: ${signal.direction} ${market.question.substring(0, 40)}`);
      await sendTelegram(tradeMsg);
      break;
    }
  }
}

async function main() {
  console.log('🎯 Poly Manual Trade Bot Starting...');
  loadState();
  
  await tradingLoop();
  setInterval(tradingLoop, 60000); // Every minute
}

main();
