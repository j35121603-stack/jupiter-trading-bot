/**
 * TRADING DASHBOARD
 * Real-time monitoring of trades and P&L
 */

const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3456;
const STATE_FILE = path.join(__dirname, 'orchestrator-state.json');

// Serve static files
app.use(express.static('public'));

// API: Get P&L stats
app.get('/api/pnl', (req, res) => {
  try {
    const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    const weekMs = 7 * dayMs;
    const monthMs = 30 * dayMs;
    
    let dayPnl = 0, weekPnl = 0, monthPnl = 0;
    let dayTrades = 0, weekTrades = 0, monthTrades = 0;
    
    for (const [strategyName, data] of Object.entries(state.strategies)) {
      if (data.trades) {
        for (const trade of data.trades) {
          const age = now - trade.timestamp;
          if (age < dayMs) {
            dayPnl += trade.pnl;
            dayTrades++;
          }
          if (age < weekMs) {
            weekPnl += trade.pnl;
            weekTrades++;
          }
          if (age < monthMs) {
            monthPnl += trade.pnl;
            monthTrades++;
          }
        }
      }
    }
    
    res.json({
      day: { pnl: dayPnl, trades: dayTrades },
      week: { pnl: weekPnl, trades: weekTrades },
      month: { pnl: monthPnl, trades: monthTrades },
      total: state.portfolio.totalPnl || 0
    });
  } catch (e) {
    res.json({ error: e.message });
  }
});

// API: Get all trading data
app.get('/api/status', (req, res) => {
  try {
    const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    res.json({
      portfolio: state.portfolio,
      strategies: state.strategies,
      lastUpdate: new Date().toISOString()
    });
  } catch (e) {
    res.json({ error: e.message });
  }
});

// API: Get trades
app.get('/api/trades', (req, res) => {
  try {
    const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    const allTrades = [];
    
    for (const [strategyName, data] of Object.entries(state.strategies)) {
      if (data.trades && data.trades.length > 0) {
        for (const trade of data.trades) {
          allTrades.push({
            ...trade,
            strategy: strategyName
          });
        }
      }
    }
    
    // Sort by time
    allTrades.sort((a, b) => b.timestamp - a.timestamp);
    
    res.json({ trades: allTrades });
  } catch (e) {
    res.json({ error: e.message });
  }
});

// Dashboard HTML
app.get('/', (req, res) => {
  const html = '<!DOCTYPE html>' +
'<html>' +
'<head>' +
'  <title>Trading Dashboard</title>' +
'  <meta name="viewport" content="width=device-width, initial-scale=1">' +
'  <style>' +
'    * { box-sizing: border-box; margin: 0; padding: 0; }' +
'    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0d1117; color: #e6edf3; padding: 20px; }' +
'    .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 30px; }' +
'    .header h1 { font-size: 24px; color: #58a6ff; }' +
'    .wallet { background: #161b22; padding: 10px 20px; border-radius: 8px; font-size: 14px; }' +
'    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 20px; margin-bottom: 30px; }' +
'    .card { background: #161b22; border-radius: 12px; padding: 20px; border: 1px solid #30363d; }' +
'    .card h3 { font-size: 14px; color: #8b949e; margin-bottom: 10px; text-transform: uppercase; }' +
'    .card .value { font-size: 32px; font-weight: bold; }' +
'    .card .value.green { color: #3fb950; }' +
'    .card .value.red { color: #f85149; }' +
'    .card .sub { font-size: 14px; color: #8b949e; margin-top: 5px; }' +
'    .section { margin-bottom: 30px; }' +
'    .section h2 { font-size: 18px; margin-bottom: 15px; color: #58a6ff; }' +
'    table { width: 100%; border-collapse: collapse; background: #161b22; border-radius: 8px; overflow: hidden; }' +
'    th, td { padding: 12px 15px; text-align: left; border-bottom: 1px solid #30363d; }' +
'    th { background: #21262d; font-size: 12px; text-transform: uppercase; color: #8b949e; }' +
'    tr:hover { background: #21262d; }' +
'    .pnl-positive { color: #3fb950; }' +
'    .pnl-negative { color: #f85149; }' +
'    .refresh { background: #238636; color: white; border: none; padding: 10px 20px; border-radius: 6px; cursor: pointer; font-size: 14px; }' +
'    .refresh:hover { background: #2ea043; }' +
'    .loading { text-align: center; padding: 40px; color: #8b949e; }' +
'    .chart-container { height: 200px; background: #161b22; border-radius: 12px; padding: 20px; margin-bottom: 20px; }' +
'    .bar { height: 30px; background: #238636; border-radius: 4px; margin-bottom: 8px; display: flex; align-items: center; padding: 0 10px; font-size: 12px; color: white; }' +
'    .bar.red { background: #f85149; }' +
'    .bar span { margin-left: auto; }' +
'  </style>' +
'</head>' +
'<body>' +
'  <div class="header">' +
'    <h1>🤖 Trading Bot Dashboard</h1>' +
'    <div class="wallet">💰 Wallet: 4Tr2VVkKPiXg58G2VdzAq1EfFTJQZsTDHgtc6PpWJAq9 | Balance: 3.67 SOL | LIVE TRADING</div>' +
'  </div>' +
'  ' +
'  <div class="grid">' +
'    <div class="card">' +
'      <h3>Today\'s P&L</h3>' +
'      <div class="value green" id="dayPnl">$0.00</div>' +
'      <div class="sub" id="dayTrades">0 trades</div>' +
'    </div>' +
'    <div class="card">' +
'      <h3>This Week</h3>' +
'      <div class="value green" id="weekPnl">$0.00</div>' +
'      <div class="sub" id="weekTrades">0 trades</div>' +
'    </div>' +
'    <div class="card">' +
'      <h3>This Month</h3>' +
'      <div class="value green" id="monthPnl">$0.00</div>' +
'      <div class="sub" id="monthTrades">0 trades</div>' +
'    </div>' +
'    <div class="card">' +
'      <h3>Total P&L</h3>' +
'      <div class="value green" id="totalPnl">$0.00</div>' +
'      <div class="sub">All time</div>' +
'    </div>' +
'  </div>' +
'  ' +
'  <div class="section">' +
'    <h2>📊 P&L by Period</h2>' +
'    <div class="chart-container">' +
'      <div class="bar" id="dayBar">Day: $0 <span>0%</span></div>' +
'      <div class="bar" id="weekBar">Week: $0 <span>0%</span></div>' +
'      <div class="bar" id="monthBar">Month: $0 <span>0%</span></div>' +
'    </div>' +
'  </div>' +
'  ' +
'  <div class="section">' +
'    <h2>📈 Recent Trades</h2>' +
'    <button class="refresh" onclick="loadData()">🔄 Refresh</button>' +
'    <table>' +
'      <thead>' +
'        <tr><th>Time</th><th>Strategy</th><th>Symbol</th><th>Direction</th><th>Size</th><th>P&L</th></tr>' +
'      </thead>' +
'      <tbody id="tradesTable">' +
'        <tr><td colspan="6" class="loading">Loading...</td></tr>' +
'      </tbody>' +
'    </table>' +
'  </div>' +
'  ' +
'  <script>' +
'    async function loadData() {' +
'      try {' +
'        const [pnlRes, tradesRes] = await Promise.all([' +
'          fetch("/api/pnl"),' +
'          fetch("/api/trades")' +
'        ]);' +
'        ' +
'        const pnl = await pnlRes.json();' +
'        const trades = await tradesRes.json();' +
'        ' +
'        const formatPnl = (val) => (val >= 0 ? "$" + val.toFixed(2) : "-$" + Math.abs(val).toFixed(2));' +
'        const formatClass = (val) => val >= 0 ? "green" : "red";' +
'        ' +
'        document.getElementById("dayPnl").textContent = formatPnl(pnl.day.pnl);' +
'        document.getElementById("dayPnl").className = "value " + formatClass(pnl.day.pnl);' +
'        document.getElementById("dayTrades").textContent = pnl.day.trades + " trades";' +
'        ' +
'        document.getElementById("weekPnl").textContent = formatPnl(pnl.week.pnl);' +
'        document.getElementById("weekPnl").className = "value " + formatClass(pnl.week.pnl);' +
'        document.getElementById("weekTrades").textContent = pnl.week.trades + " trades";' +
'        ' +
'        document.getElementById("monthPnl").textContent = formatPnl(pnl.month.pnl);' +
'        document.getElementById("monthPnl").className = "value " + formatClass(pnl.month.pnl);' +
'        document.getElementById("monthTrades").textContent = pnl.month.trades + " trades";' +
'        ' +
'        document.getElementById("totalPnl").textContent = formatPnl(pnl.total);' +
'        document.getElementById("totalPnl").className = "value " + formatClass(pnl.total);' +
'        ' +
'        const maxPnl = Math.max(Math.abs(pnl.day.pnl), Math.abs(pnl.week.pnl), Math.abs(pnl.month.pnl), 100);' +
'        const scale = (val) => Math.min(Math.abs(val) / maxPnl * 100, 100);' +
'        ' +
'        const dayBar = document.getElementById("dayBar");' +
'        dayBar.style.width = scale(pnl.day.pnl) + "%";' +
'        dayBar.innerHTML = "Day: " + formatPnl(pnl.day.pnl) + " <span>" + pnl.day.trades + " trades</span>";' +
'        dayBar.className = "bar " + (pnl.day.pnl < 0 ? "red" : "");' +
'        ' +
'        const weekBar = document.getElementById("weekBar");' +
'        weekBar.style.width = scale(pnl.week.pnl) + "%";' +
'        weekBar.innerHTML = "Week: " + formatPnl(pnl.week.pnl) + " <span>" + pnl.week.trades + " trades</span>";' +
'        weekBar.className = "bar " + (pnl.week.pnl < 0 ? "red" : "");' +
'        ' +
'        const monthBar = document.getElementById("monthBar");' +
'        monthBar.style.width = scale(pnl.month.pnl) + "%";' +
'        monthBar.innerHTML = "Month: " + formatPnl(pnl.month.pnl) + " <span>" + pnl.month.trades + " trades</span>";' +
'        monthBar.className = "bar " + (pnl.month.pnl < 0 ? "red" : "");' +
'        ' +
'        const tbody = document.getElementById("tradesTable");' +
'        if (trades.trades && trades.trades.length > 0) {' +
'          tbody.innerHTML = trades.trades.slice(0, 20).map(t => {' +
'            const time = new Date(t.timestamp).toLocaleString();' +
'            const pnlClass = t.pnl >= 0 ? "pnl-positive" : "pnl-negative";' +
'            return "<tr><td>" + time + "</td><td>" + t.strategy + "</td><td>" + t.symbol + "</td><td>" + (t.direction ? t.direction.toUpperCase() : "N/A") + "</td><td>$" + (t.size ? t.size.toFixed(2) : "0") + "</td><td class=\\"" + pnlClass + "\\">" + (t.pnl >= 0 ? "+" : "") + (t.pnl ? t.pnl.toFixed(2) : "0") + "</td></tr>";' +
'          }).join("");' +
'        } else {' +
'          tbody.innerHTML = "<tr><td colspan=\\"6\\" class=\\"loading\\">No trades yet</td></tr>";' +
'        }' +
'        ' +
'      } catch (e) {' +
'        console.error(e);' +
'      }' +
'    }' +
'    ' +
'    loadData();' +
'    setInterval(loadData, 5000);' +
'  </script>' +
'</body>' +
'</html>';
  
  res.type('html').send(html);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log('📊 Dashboard running at http://localhost:' + PORT);
});

module.exports = app;
