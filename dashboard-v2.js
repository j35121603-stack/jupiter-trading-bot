const express = require('express');
const fs = require('fs');
const axios = require('axios');

const app = express();
const PORT = 3000;

// Load state from learning bot
function loadLearningState() {
  try {
    return JSON.parse(fs.readFileSync('./state-learning.json', 'utf8'));
  } catch (e) { return null; }
}

// Load practice state
function loadPracticeState() {
  try {
    return JSON.parse(fs.readFileSync('./state-practice.json', 'utf8'));
  } catch (e) { return null; }
}

// Get current prices for display
async function getPrices() {
  const prices = {};
  const cgIds = ['solana', 'wif', 'bonk', 'pepe', 'popcat'];
  
  try {
    const res = await axios.get(`https://api.coingecko.com/api/v3/simple/price?ids=${cgIds.join(',')}&vs_currencies=usd&include_24hr_change=true`, { timeout: 10000 });
    
    const cgMap = { 'solana': 'SOL', 'wif': 'WIF', 'bonk': 'BONK', 'pepe': 'PEPE', 'popcat': 'POPCAT' };
    
    if (res.data) {
      for (const [id, data] of Object.entries(res.data)) {
        const symbol = cgMap[id];
        if (symbol) {
          prices[symbol] = { price: data.usd, change24h: data.usd_24h_change || 0 };
        }
      }
    }
  } catch (e) {}
  
  return prices;
}

function formatDate(ts) {
  return new Date(ts).toLocaleString();
}

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString();
}

app.get('/', async (req, res) => {
  const state = loadLearningState();
  const practice = loadPracticeState();
  const prices = await getPrices();
  
  const s = state || {
    capital: 1000,
    trades: [],
    positions: [],
    dailyTrades: 0,
    wonTrades: 0,
    lostTrades: 0,
    learnings: { totalTrades: 0, optimalTP: 0.12, optimalSL: 0.05, coinPerformance: {}, hourPerformance: {} }
  };
  
  const p = practice || {
    capital: 1000,
    trades: [],
    positions: [],
    wonTrades: 0,
    lostTrades: 0
  };
  
  const winRate = (s.wonTrades + s.lostTrades) > 0 
    ? ((s.wonTrades / (s.wonTrades + s.lostTrades)) * 100).toFixed(1) 
    : 0;
  
  const pWinRate = (p.wonTrades + p.lostTrades) > 0 
    ? ((p.wonTrades / (p.wonTrades + p.lostTrades)) * 100).toFixed(1) 
    : 0;
  
  // Calculate current P&L for open positions
  let unrealizedPnl = 0;
  for (const pos of (s.positions || [])) {
    const currentPrice = prices[pos.symbol]?.price;
    if (currentPrice) {
      const pnl = (currentPrice - pos.entryPrice) / pos.entryPrice * pos.amount;
      unrealizedPnl += pnl;
    }
  }
  
  // Get top performing coins
  const topCoins = Object.entries(s.learnings?.coinPerformance || {})
    .sort((a, b) => (b[1].winRate || 0) - (a[1].winRate || 0))
    .slice(0, 5);
  
  // Get best trading hours
  const topHours = Object.entries(s.learnings?.hourPerformance || {})
    .sort((a, b) => (b[1].winRate || 0) - (a[1].winRate || 0))
    .slice(0, 3);
  
  const html = `
<!DOCTYPE html>
<html>
<head>
  <title>🧠 Jupiter Learning Bot Dashboard</title>
  <meta http-equiv="refresh" content="10">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0d1117; color: #e6edf3; padding: 20px; }
    h1 { color: #58a6ff; margin-bottom: 5px; }
    h2 { color: #8b949e; margin: 20px 0 10px; border-bottom: 1px solid #30363d; padding-bottom: 5px; font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px; }
    h3 { color: #a371f7; margin: 12px 0 8px; font-size: 13px; }
    .subtitle { color: #6e7681; font-size: 12px; margin-bottom: 20px; }
    
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-bottom: 20px; }
    .card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 14px; }
    .card .label { color: #8b949e; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; }
    .card .value { font-size: 22px; font-weight: bold; margin-top: 4px; }
    .card .sub { font-size: 11px; color: #6e7681; margin-top: 2px; }
    
    .positive { color: #3fb950; }
    .negative { color: #f85149; }
    .neutral { color: #8b949e; }
    
    table { width: 100%; border-collapse: collapse; margin-bottom: 12px; font-size: 12px; }
    th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #30363d; }
    th { color: #6e7681; font-weight: 500; font-size: 10px; text-transform: uppercase; }
    
    .section { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 15px; margin-bottom: 20px; }
    
    .mode-badge { display: inline-block; padding: 4px 10px; border-radius: 12px; font-size: 11px; font-weight: 600; }
    .mode-live { background: #f8514920; color: #f85149; border: 1px solid #f85149; }
    .mode-practice { background: #d2992220; color: #d29922; border: 1px solid #d29922; }
    .mode-learning { background: #a371f720; color: #a371f7; border: 1px solid #a371f7; }
    
    .stat-row { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid #21262d; }
    .stat-row:last-child { border-bottom: none; }
    
    .coin-row { display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid #21262d; }
    .coin-row:last-child { border-bottom: none; }
    .coin-symbol { font-weight: 600; }
    .coin-winrate { font-size: 12px; }
    
    .progress-bar { height: 6px; background: #21262d; border-radius: 3px; overflow: hidden; margin-top: 4px; }
    .progress-fill { height: 100%; border-radius: 3px; transition: width 0.3s; }
    
    .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
    @media (max-width: 800px) { .two-col { grid-template-columns: 1fr; } }
    
    .position-card { background: #21262d; border-radius: 6px; padding: 10px; margin-bottom: 8px; }
    .position-header { display: flex; justify-content: space-between; align-items: center; }
    .position-price { font-size: 11px; color: #8b949e; }
    .position-pnl { font-weight: 600; }
    
    @keyframes pulse { 0% { opacity: 1; } 50% { opacity: 0.6; } 100% { opacity: 1; } }
    .live-dot { display: inline-block; width: 8px; height: 8px; background: #3fb950; border-radius: 50%; margin-right: 6px; animation: pulse 2s infinite; }
  </style>
</head>
<body>
  <h1>🧠 Jupiter Learning Bot <span class="live-dot"></span><span style="font-size:12px;color:#6e7681">v8</span></h1>
  <p class="subtitle">Autonomous trading with continuous learning</p>
  
  <!-- LIVE Trading Stats -->
  <div class="section">
    <h2>🔴 Live Trading</h2>
    <div class="grid">
      <div class="card">
        <div class="label">Capital</div>
        <div class="value">$${s.capital.toFixed(2)}</div>
        <div class="sub">${s.positions.length} open positions</div>
      </div>
      <div class="card">
        <div class="label">Unrealized P&L</div>
        <div class="value ${unrealizedPnl >= 0 ? 'positive' : 'negative'}">${unrealizedPnl >= 0 ? '+' : ''}$${unrealizedPnl.toFixed(2)}</div>
        <div class="sub">From open positions</div>
      </div>
      <div class="card">
        <div class="label">Win Rate</div>
        <div class="value">${winRate}%</div>
        <div class="sub">${s.wonTrades}W - ${s.lostTrades}L</div>
      </div>
      <div class="card">
        <div class="label">Total Trades</div>
        <div class="value">${s.learnings?.totalTrades || 0}</div>
        <div class="sub">learned from</div>
      </div>
    </div>
  </div>
  
  <!-- Learning Stats -->
  <div class="section">
    <h2>🧠 Adaptive Learning</h2>
    <div class="grid">
      <div class="card">
        <div class="label">Take Profit</div>
        <div class="value positive">${((s.learnings?.optimalTP || 0.12) * 100).toFixed(0)}%</div>
        <div class="sub">adaptive</div>
      </div>
      <div class="card">
        <div class="label">Stop Loss</div>
        <div class="value negative">${((s.learnings?.optimalSL || 0.05) * 100).toFixed(0)}%</div>
        <div class="sub">adaptive</div>
      </div>
      <div class="card">
        <div class="label">Consecutive Wins</div>
        <div class="value positive">${s.learnings?.consecutiveWins || 0}</div>
      </div>
      <div class="card">
        <div class="label">Consecutive Losses</div>
        <div class="value negative">${s.learnings?.consecutiveLosses || 0}</div>
      </div>
    </div>
  </div>
  
  <div class="two-col">
    <!-- Coin Performance -->
    <div class="section">
      <h2>📊 Coin Performance</h2>
      ${topCoins.length > 0 ? topCoins.map(([sym, stats]) => `
        <div class="coin-row">
          <span class="coin-symbol">${sym}</span>
          <span class="coin-winrate ${(stats.winRate || 0) > 0.5 ? 'positive' : 'negative'}">${((stats.winRate || 0) * 100).toFixed(0)}%</span>
        </div>
      `).join('') : '<p style="color:#6e7681;font-size:12px">No data yet - trading in progress</p>'}
    </div>
    
    <!-- Best Trading Hours -->
    <div class="section">
      <h2>⏰ Best Trading Hours</h2>
      ${topHours.length > 0 ? topHours.map(([hour, stats]) => `
        <div class="coin-row">
          <span class="coin-symbol">${hour}:00</span>
          <span class="coin-winrate ${(stats.winRate || 0) > 0.5 ? 'positive' : 'negative'}">${((stats.winRate || 0) * 100).toFixed(0)}%</span>
        </div>
      `).join('') : '<p style="color:#6e7681;font-size:12px">No data yet</p>'}
    </div>
  </div>
  
  <!-- Open Positions -->
  <div class="section">
    <h2>📈 Open Positions (${s.positions?.length || 0})</h2>
    ${(s.positions || []).length > 0 ? s.positions.map(pos => {
      const currentPrice = prices[pos.symbol]?.price;
      const pnl = currentPrice ? ((currentPrice - pos.entryPrice) / pos.entryPrice * pos.amount) : 0;
      const pnlPct = currentPrice ? ((currentPrice - pos.entryPrice) / pos.entryPrice * 100) : 0;
      return `
      <div class="position-card">
        <div class="position-header">
          <span class="coin-symbol">${pos.symbol}</span>
          <span class="position-pnl ${pnl >= 0 ? 'positive' : 'negative'}">${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)} (${pnlPct.toFixed(1)}%)</span>
        </div>
        <div class="position-price">
          Entry: $${pos.entryPrice?.toFixed(4)} → Current: $${(currentPrice || pos.entryPrice)?.toFixed(4)} | 
          Target: $${pos.targetPrice?.toFixed(4)} | Stop: $${pos.stopPrice?.toFixed(4)}
        </div>
      </div>
      `;
    }).join('') : '<p style="color:#6e7681;font-size:12px">No open positions</p>'}
  </div>
  
  <!-- Recent Trades -->
  <div class="section">
    <h2>✅ Recent Trades</h2>
    <table>
      <tr><th>Time</th><th>Coin</th><th>Entry</th><th>Exit</th><th>P&L</th><th>Result</th></tr>
      ${(s.trades || []).slice(-10).reverse().map(t => `
        <tr>
          <td>${formatTime(t.entryTime)}</td>
          <td style="font-weight:600">${t.symbol}</td>
          <td>$${t.entryPrice?.toFixed(4)}</td>
          <td>$${t.exitPrice?.toFixed(4)}</td>
          <td class="${(t.pnl || 0) >= 0 ? 'positive' : 'negative'}">${(t.pnl || 0) >= 0 ? '+' : ''}$${(t.pnl || 0).toFixed(2)}</td>
          <td class="${(t.pnl || 0) >= 0 ? 'positive' : 'negative'}">${(t.pnl || 0) >= 0 ? 'WIN' : 'LOSS'}</td>
        </tr>
      `).join('') || '<tr><td colspan="6" style="text-align:center;color:#6e7681">No trades yet</td></tr>'}
    </table>
  </div>
  
  <!-- Practice Mode Stats -->
  <div class="section" style="border-color: #d2992240;">
    <h2 style="color: #d29922;">🟡 Practice Mode</h2>
    <div class="grid">
      <div class="card">
        <div class="label">Practice Capital</div>
        <div class="value">$${p.capital.toFixed(2)}</div>
      </div>
      <div class="card">
        <div class="label">Win Rate</div>
        <div class="value">${pWinRate}%</div>
        <div class="sub">${p.wonTrades}W - ${p.lostTrades}L</div>
      </div>
      <div class="card">
        <div class="label">Open Positions</div>
        <div class="value">${p.positions?.length || 0}</div>
      </div>
    </div>
  </div>
  
  <!-- Market Overview -->
  <div class="section">
    <h2>📰 Market Prices</h2>
    <div class="grid">
      ${Object.entries(prices).map(([sym, data]) => `
        <div class="card" style="padding:10px">
          <div class="label">${sym}</div>
          <div class="value" style="font-size:16px">$${data.price?.toFixed(4)}</div>
          <div class="sub ${data.change24h >= 0 ? 'positive' : 'negative'}">${data.change24h >= 0 ? '+' : ''}${data.change24h?.toFixed(1)}%</div>
        </div>
      `).join('') || '<p style="color:#6e7681">Loading prices...</p>'}
    </div>
  </div>
  
  <p style="color: #484f58; text-align: center; margin-top: 20px; font-size: 11px;">Auto-refreshes every 10 seconds | Bot running on port</p>
</body>
</html>
  `;
  
  res.send(html);
});

app.listen(PORT, () => {
  console.log(`🧠 Learning Dashboard running at http://localhost:${PORT}`);
});
