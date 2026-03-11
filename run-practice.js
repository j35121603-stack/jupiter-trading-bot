#!/usr/bin/env node
/**
 * PRACTICE BOT - Always runs in practice mode
 * Uses state-practice.json
 */

const fs = require('fs');
const path = require('path');

// Force practice mode
process.argv.push('--practice');

const originalWrite = fs.writeFileSync;
const originalRead = fs.readFileSync;

// Override to always use practice state
const stateFile = path.join(__dirname, 'state-practice.json');

fs.readFileSync = function(file, encoding) {
  if (file.includes('bot-mode.json')) {
    return JSON.stringify({ mode: 'practice', updatedAt: Date.now() });
  }
  return originalRead.apply(fs, arguments);
};

fs.writeFileSync = function(file, data, encoding) {
  if (file.includes('state-') || file.includes('state.json')) {
    return originalWrite(stateFile, data, encoding);
  }
  return originalWrite.apply(fs, arguments);
};

// Now load and run the main bot
require('./bot-v10.js');
