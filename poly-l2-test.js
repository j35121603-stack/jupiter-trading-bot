/**
 * Poly Direct Trading - Using L2 Auth
 */

const axios = require('axios');

const API_KEY = "A4BZQh_15LTmgaP6oSyQ5cAxDTarAiF_hHrPo71C31Q=";
const SECRET = "A4BZQh_15LTmgaP6oSyQ5cAxDTarAiF_hHrPo71C31Q=";
const PASSPHRASE = "ec9f7ec991d633e491f00d10fbbc21f7a17c0d0378ac5f139c4369a627c8fb73";
const ADDRESS = "0x4F16F640010D63Da6FAb14EA4A161b4C22B26078";

async function getBalance() {
  const timestamp = Math.floor(Date.now() / 1000);
  const nonce = 0;
  
  const crypto = require('crypto');
  const message = `${timestamp}${nonce}${ADDRESS}`;
  const signature = crypto.createHmac('sha256', SECRET).update(message).digest('base64');
  
  try {
    const response = await axios.get(`https://data-api.polymarket.com/positions?user=${ADDRESS}`, {
      headers: {
        'POLY_ADDRESS': ADDRESS,
        'POLY_API_KEY': API_KEY,
        'POLY_PASSPHRASE': PASSPHRASE,
        'POLY_SIGNATURE': signature,
        'POLY_TIMESTAMP': timestamp.toString(),
        'POLY_NONCE': nonce.toString()
      }
    });
    console.log('Balance:', JSON.stringify(response.data).slice(0, 500));
  } catch(e) {
    console.log('Error:', e.response?.data || e.message);
  }
}

getBalance();
