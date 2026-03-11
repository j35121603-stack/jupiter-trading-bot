# Deploy to Cloud (FREE)

## Option 1: Render.com (Easiest)

1. Go to https://render.com and sign up
2. Click "New Web Service"
3. Connect your GitHub and select this repository
4. Settings:
   - Build Command: `npm install`
   - Start Command: `node orchestrator.js`
5. Add environment variable:
   - Key: `SOLANA_RPC` 
   - Value: `https://api.mainnet-beta.solana.com`
6. Click "Deploy"

## Option 2: Railway

1. Go to https://railway.app and sign up
2. Click "New Project" → "Deploy from GitHub repo"
3. Select the repository with crypto-bot
4. Add environment variables in Railway dashboard
5. Deploy

## Option 3: Fly.io

1. Install flyctl: `brew install flyctl`
2. Run: `fly launch`
3. Select your repo
4. Deploy: `fly deploy`

---

## Quick Deploy (Render)

Just upload these files to GitHub and connect to Render:
- orchestrator.js
- jupiter-swap.js
- crypto-signals-v2.js
- crypto-signals.js
- orchestrator-state.json
- package.json
