# Jupiter Meme Coin Trading Bot

## Quick Start

1. **Create a folder** on your computer: `mkdir ~/jupiter-bot && cd ~/jupiter-bot`

2. **Get the bot files** - I can either:
   - Give you a download link
   - You copy the files manually

3. **Install dependencies:**
   ```bash
   npm install @solana/web3.js axios bs58
   ```

4. **Configure:**
   - Open `bot.js` in a text editor
   - Find `const PRIVATE_KEY = null;`
   - Replace `null` with your Phantom private key as a string:
   ```javascript
   const PRIVATE_KEY = "YOUR_PRIVATE_KEY_HERE";
   ```

5. **Test (paper mode):**
   ```bash
   node bot.js --paper
   ```

6. **Go live:**
   ```bash
   node bot.js
   ```

## Bot Features

✅ High-frequency, low-risk trades  
✅ Max 2% risk per trade  
✅ Stop-loss & take-profit  
✅ Auto-learns from trades  
✅ Daily loss limit (5%)  
✅ Runs 24/7  

## Support

The bot will DM you updates in this chat.
