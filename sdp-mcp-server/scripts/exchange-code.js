#!/usr/bin/env node

/**
 * Exchange authorization code for tokens
 */

import axios from 'axios';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config({ path: path.join(__dirname, '..', '.env') });

// Configuration
const config = {
  clientId: process.env.SDP_OAUTH_CLIENT_ID || 'YOUR_CLIENT_ID',
  clientSecret: process.env.SDP_OAUTH_CLIENT_SECRET || 'YOUR_CLIENT_SECRET',
  portalName: process.env.SDP_PORTAL_NAME || 'kaltentech',
  dataCenter: process.env.SDP_DATA_CENTER || 'US',
  redirectUri: process.env.SDP_OAUTH_REDIRECT_URI || 'https://localhost:3000/callback'
};

// Authorization code from user
const authCode = '1000.883190caefff5f76c22178700d09bba7.ea926eba6a2dca530aad3d96787d0c16';

// Data center to domain mapping
const dataCenterDomains = {
  US: 'com',
  EU: 'eu',
  IN: 'in',
  AU: 'com.au',
  JP: 'jp',
  UK: 'uk',
  CA: 'ca',
  CN: 'com.cn'
};

const domain = dataCenterDomains[config.dataCenter] || 'com';
const tokenUrl = `https://accounts.zoho.${domain}/oauth/v2/token`;

console.log('🔐 Exchanging Authorization Code for Tokens');
console.log('==========================================\n');
console.log('Configuration:');
console.log(`- Portal: ${config.portalName}`);
console.log(`- Data Center: ${config.dataCenter}`);
console.log(`- Domain: ${domain}`);
console.log(`- Client ID: ${config.clientId.substring(0, 20)}...`);
console.log(`- Auth Code: ${authCode.substring(0, 20)}...`);
console.log('\n');

// Exchange authorization code for tokens
async function exchangeCodeForTokens() {
  try {
    console.log('📡 Exchanging authorization code for tokens...');
    
    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      code: authCode
    });
    
    console.log('Request URL:', tokenUrl);
    console.log('Request params:', params.toString());
    
    const response = await axios.post(tokenUrl, params, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });
    
    console.log('✅ Tokens obtained successfully');
    return response.data;
  } catch (error) {
    console.error('❌ Error exchanging code:', error.response?.data || error.message);
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Headers:', error.response.headers);
    }
    throw error;
  }
}

// Update .env file with refresh token
async function updateEnvFile(refreshToken) {
  const envPath = path.join(__dirname, '..', '.env');
  
  try {
    let envContent = await fs.readFile(envPath, 'utf-8');
    
    // Check if refresh token already exists
    if (envContent.includes('SDP_OAUTH_REFRESH_TOKEN=')) {
      // Update existing token
      envContent = envContent.replace(
        /SDP_OAUTH_REFRESH_TOKEN=.*/,
        `SDP_OAUTH_REFRESH_TOKEN=${refreshToken}`
      );
    } else {
      // Add new token after client secret
      envContent = envContent.replace(
        /(SDP_OAUTH_CLIENT_SECRET=.*)/,
        `$1\nSDP_OAUTH_REFRESH_TOKEN=${refreshToken}`
      );
    }
    
    await fs.writeFile(envPath, envContent);
    console.log('✅ Refresh token saved to .env file');
  } catch (error) {
    console.error('❌ Error updating .env file:', error.message);
    console.log(`\n📝 Please add this to your .env file manually:`);
    console.log(`SDP_OAUTH_REFRESH_TOKEN=${refreshToken}`);
  }
}

// Main function
async function main() {
  try {
    // Exchange code for tokens
    const tokens = await exchangeCodeForTokens();
    
    console.log('\n📋 Token Information:');
    console.log(`- Access Token: ${tokens.access_token.substring(0, 30)}...`);
    console.log(`- Refresh Token: ${tokens.refresh_token.substring(0, 30)}...`);
    console.log(`- Expires In: ${tokens.expires_in} seconds`);
    console.log(`- Token Type: ${tokens.token_type}`);
    console.log(`- Scope: ${tokens.scope}`);
    
    // Save refresh token to .env
    await updateEnvFile(tokens.refresh_token);
    
    console.log('\n✅ OAuth setup completed successfully!');
    console.log('You can now run API tests with: node scripts/test-api-direct.js');
    
  } catch (error) {
    console.error('\n❌ Token exchange failed:', error.message);
    process.exit(1);
  }
}

// Run
main();