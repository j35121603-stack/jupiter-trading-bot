/**
 * TEST SCRIPT FOR ENHANCED MODULES
 * Run with: node test-modules.js
 */

const { getCryptoPrices } = require('./crypto-signals-v2.js');
const { getPolyMarkets, analyzePolyMomentum, analyzePolyContrarian, findBestPolyMarkets } = require('./poly-signals-v2.js');
const { Backtester, trendFollowingStrategy, meanReversionStrategy } = require('./backtester.js');

async function testCryptoSignals() {
  console.log('\n' + '='.repeat(50));
  console.log('🧪 TESTING CRYPTO SIGNALS V2');
  console.log('='.repeat(50));
  
  try {
    const prices = await getCryptoPrices();
    
    console.log('\n📊 Market Data:');
    for (const [symbol, data] of Object.entries(prices)) {
      console.log(`   ${symbol.toUpperCase()}: $${data.price.toFixed(4)} (${data.change24h >= 0 ? '🟢' : '🔴'} ${data.change24h.toFixed(1)}%)`);
    }
    
    // Test analysis functions
    const { analyzeTrend, analyzeMomentum, analyzeContrarian } = require('./crypto-signals-v2.js');
    
    console.log('\n📈 Technical Analysis (SOL):');
    const solData = prices.solana;
    const trend = analyzeTrend(solData.prices);
    const momentum = analyzeMomentum(solData.prices, solData.volume);
    const contrarian = analyzeContrarian(solData.prices);
    
    console.log(`   Trend: ${trend.direction} (strength: ${(trend.strength * 100).toFixed(0)}%, alignment: ${(trend.alignment * 100).toFixed(0)}%)`);
    console.log(`   Momentum Score: ${(momentum.score * 100).toFixed(0)}% (gain: ${(momentum.gain * 100).toFixed(1)}%)`);
    console.log(`   Contrarian: ${contrarian.opportunity ? contrarian.direction + ' - ' + contrarian.reason : 'No opportunity'}`);
    
    console.log('\n✅ Crypto Signals: PASSED');
    
  } catch (e) {
    console.error('❌ Crypto Signals Error:', e.message);
  }
}

async function testPolySignals() {
  console.log('\n' + '='.repeat(50));
  console.log('🧪 TESTING POLYMARKET SIGNALS V2');
  console.log('='.repeat(50));
  
  try {
    const markets = await getPolyMarkets({ limit: '50' });
    
    console.log(`\n📊 Fetched ${markets.length} markets`);
    
    if (markets.length > 0) {
      // Test analysis on first market
      const market = markets[0];
      const momentum = analyzePolyMomentum(market);
      const contrarian = analyzePolyContrarian(market);
      
      console.log(`\n📈 Analysis (${market.question.substring(0, 50)}...):`);
      console.log(`   Yes: ${(market.yesPrice * 100).toFixed(1)}% | No: ${(market.noPrice * 100).toFixed(1)}%`);
      console.log(`   Volume: $${(market.volume / 1000).toFixed(1)}K`);
      console.log(`   Momentum Score: ${(momentum.score * 100).toFixed(0)}% (${momentum.direction})`);
      console.log(`   Contrarian: ${contrarian.opportunity ? contrarian.direction + ' - ' + contrarian.reason : 'No opportunity'}`);
      
      // Find best opportunities
      const best = findBestPolyMarkets(markets, { minVolume: 10000, maxResults: 3 });
      console.log(`\n🎯 Top Opportunities:`);
      best.forEach((b, i) => {
        console.log(`   ${i + 1}. ${b.signal.recommendation.toUpperCase()} ${b.market.question.substring(0, 40)}... (${(b.signal.confidence * 100).toFixed(0)}%)`);
      });
    }
    
    console.log('\n✅ Polymarket Signals: PASSED');
    
  } catch (e) {
    console.error('❌ Polymarket Signals Error:', e.message);
  }
}

function testBacktester() {
  console.log('\n' + '='.repeat(50));
  console.log('🧪 TESTING BACKTESTER');
  console.log('='.repeat(50));
  
  try {
    // Generate synthetic price data
    const priceData = [];
    let price = 100;
    
    for (let i = 0; i < 200; i++) {
      // Random walk with trend
      const change = (Math.random() - 0.48) * 2; // Slight upward bias
      price *= (1 + change / 100);
      priceData.push(price);
    }
    
    console.log(`\n📊 Generated ${priceData.length} price points`);
    console.log(`   Start: $${priceData[0].toFixed(2)} | End: $${priceData[priceData.length - 1].toFixed(2)}`);
    
    // Test trend following
    const trendBacktest = new Backtester({ initialCapital: 10000 });
    const trendMetrics = trendBacktest.backtestSignalGenerator(trendFollowingStrategy, priceData);
    trendBacktest.printResults('Trend Following');
    
    // Test mean reversion
    const mrBacktest = new Backtester({ initialCapital: 10000 });
    const mrMetrics = mrBacktest.backtestSignalGenerator(meanReversionStrategy, priceData);
    mrBacktest.printResults('Mean Reversion');
    
    // Compare strategies
    console.log('\n📈 Strategy Comparison:');
    const comparison = new Backtester({ initialCapital: 10000 });
    comparison.compareStrategies([
      { name: 'Trend Follow', signalGenerator: trendFollowingStrategy, params: {} },
      { name: 'Mean Revert', signalGenerator: meanReversionStrategy, params: {} },
    ], priceData);
    
    console.log('\n✅ Backtester: PASSED');
    
  } catch (e) {
    console.error('❌ Backtester Error:', e.message);
  }
}

async function runAllTests() {
  console.log('\n' + '🧪'.repeat(25));
  console.log('🚀 RUNNING ALL TESTS');
  console.log('🧪'.repeat(25));
  
  await testCryptoSignals();
  await testPolySignals();
  testBacktester();
  
  console.log('\n' + '='.repeat(50));
  console.log('✅ ALL TESTS COMPLETED');
  console.log('='.repeat(50) + '\n');
}

// Run tests
runAllTests();
