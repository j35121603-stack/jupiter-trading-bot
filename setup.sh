#!/bin/bash
# Setup script for Jupiter Trading Bot

# Clone the repo
git clone https://github.com/j35121603-stack/jupiter-trading-bot.git
cd jupiter-trading-bot

# Create files manually
cat > package.json << 'PKGEOF'
{
  "name": "jupiter-trading-bot",
  "version": "1.0.0",
  "main": "orchestrator.js",
  "dependencies": {
    "@solana/web3.js": "^1.90.0",
    "axios": "^1.6.0",
    "express": "^5.2.1"
  }
}
PKGEOF

echo "Created package.json"

# Install dependencies
npm install

# Start the bot
echo "Starting bot..."
node orchestrator.js
