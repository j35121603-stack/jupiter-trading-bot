#!/bin/bash

# Jupiter Meme Bot - Quick Install Script
# Run this on your local machine (not in this environment)

echo "🚀 Installing Jupiter Meme Trading Bot..."
echo ""

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js not found. Install from https://nodejs.org"
    exit 1
fi

echo "✅ Node.js found: $(node --version)"

# Create bot directory
mkdir -p ~/jupiter-bot
cd ~/jupiter-bot

# Copy files
echo "📦 Installing dependencies..."
npm install @solana/web3.js axios bs58 2>&1

echo ""
echo "✅ Installation complete!"
echo ""
echo "NEXT STEPS:"
echo "1. Edit bot.js and add your private key"
echo "2. Run: node bot.js --paper  (to test)"
echo "3. Run: node bot.js  (to go live)"
echo ""
