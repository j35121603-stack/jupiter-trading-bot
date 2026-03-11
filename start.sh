#!/bin/bash
# Trading Bot Launcher
# Run both orchestrator and dashboard

echo "🤖 Starting Trading Bot..."
echo "================================"

cd /Users/jeffery/.openclaw/workspace/crypto-bot

# Start the orchestrator in background
node orchestrator.js &
ORCH_PID=$!

echo "Orchestrator started (PID: $ORCH_PID)"

# Start the dashboard in background  
node dashboard.js &
DASH_PID=$!

echo "Dashboard started (PID: $DASH_PID)"
echo ""
echo "📊 Dashboard: http://localhost:3456"
echo ""
echo "Press Ctrl+C to stop both"

# Wait for any signal
trap "kill $ORCH_PID $DASH_PID 2>/dev/null; exit" INT TERM

wait
