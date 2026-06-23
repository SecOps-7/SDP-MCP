#!/usr/bin/env node

'use strict';

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { SDPAPIClientV2 } = require('./sdp-api-client-v2.cjs');
const { listResources, readResource } = require('./mcp-resources.cjs');
const { listPrompts, getPrompt } = require('./mcp-prompts.cjs');
const { makeImplementations: makeRequestImpls, schemas: requestSchemas } = require('./tools/requests.cjs');
const { makeImplementations: makeTechImpls, schemas: techSchemas } = require('./tools/technicians.cjs');
const { makeImplementations: makeMetaImpls, schemas: metaSchemas } = require('./tools/metadata.cjs');
const { makeImplementations: makeAvailImpls, schemas: availSchemas } = require('./tools/availability.cjs');

const app = express();
app.use(cors());
app.use(express.json());

// Diagnostic: log env vars at startup so misconfiguration is immediately visible
console.error('SDP env check:');
console.error(`  SDP_BASE_URL     = ${process.env.SDP_BASE_URL     || '(not set)'}`);
console.error(`  SDP_PORTAL_NAME  = ${process.env.SDP_PORTAL_NAME  || '(not set)'}`);
console.error(`  SDP_CLIENT_ID    = ${process.env.SDP_CLIENT_ID    ? '(set)' : '(not set)'}`);
console.error(`  SDP_REFRESH_TOKEN= ${process.env.SDP_REFRESH_TOKEN? '(set)' : '(not set)'}`);
console.error(`  SDP_DATA_CENTER  = ${process.env.SDP_DATA_CENTER  || 'US (default)'}`);

let sdpClient;
try {
  sdpClient = new SDPAPIClientV2({
    clientId: process.env.SDP_CLIENT_ID,
    clientSecret: process.env.SDP_CLIENT_SECRET,
    portalName: process.env.SDP_PORTAL_NAME,
    dataCenter: process.env.SDP_DATA_CENTER || 'US'
  });
  console.error('SDP API client initialized');
} catch (error) {
  console.error('Failed to initialize SDP client:', error.message);
}

// Wire all tool implementations and schemas
const toolImplementations = sdpClient ? {
  ...makeRequestImpls(sdpClient),
  ...makeTechImpls(sdpClient),
  ...makeMetaImpls(sdpClient),
  ...makeAvailImpls(sdpClient)
} : {};

const tools = [...requestSchemas, ...techSchemas, ...metaSchemas, ...availSchemas];

// Active SSE connections
const connections = new Map();
let sessionCounter = 0;

// Health check — includes OAuth token probe when sdpClient is available
app.get('/health', async (req, res) => {
  const health = {
    status: 'ok',
    service: 'mcp-sse-sdp',
    connections: connections.size,
    sdp_configured: !!sdpClient,
    instance: process.env.SDP_PORTAL_NAME || null,
    base_url: process.env.SDP_BASE_URL || null,
    data_center: process.env.SDP_DATA_CENTER || 'US'
  };

  if (sdpClient) {
    try {
      const conn = await sdpClient.testConnection();
      health.auth_status = conn.success ? 'ok' : 'failed';
      if (!conn.success) health.auth_error = conn.error;
    } catch (e) {
      health.auth_status = 'error';
      health.auth_error = e.message;
    }
  } else {
    health.auth_status = 'not_configured';
  }

  res.json(health);
});

// SSE endpoint
app.get('/sse', (req, res) => {
  console.error('New SSE connection established');

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });

  const sessionId = `session-${Date.now()}-${++sessionCounter}`;
  connections.set(sessionId, res);
  console.error(`Session created: ${sessionId}`);

  res.write(`data: ${JSON.stringify({ type: 'connection', sessionId })}\n\n`);

  const keepAlive = setInterval(() => { res.write(':keepalive\n\n'); }, 30000);

  req.on('close', () => {
    console.error(`Session closed: ${sessionId}`);
    clearInterval(keepAlive);
    connections.delete(sessionId);
  });
});

// JSON-RPC message handler
function handleJsonRpcMessage(message) {
  const { method, params, id } = message;
  const isNotification = id === undefined;

  console.error(`Received ${isNotification ? 'notification' : 'request'}: ${method}`);

  if (isNotification) return null;

  try {
    let result;

    switch (method) {
      case 'initialize':
        result = {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {}, resources: {}, prompts: {} },
          serverInfo: { name: 'service-desk-plus', version: '2.0.0' }
        };
        break;

      case 'tools/list':
        result = { tools };
        break;

      case 'resources/list':
        result = { resources: listResources() };
        break;

      case 'resources/read': {
        const uri = (params || {}).uri;
        const resource = readResource(uri);
        if (!resource) {
          return { jsonrpc: '2.0', error: { code: -32602, message: `Unknown resource URI: ${uri}` }, id };
        }
        result = { contents: [{ uri: resource.uri, mimeType: resource.mimeType, text: resource.text }] };
        break;
      }

      case 'prompts/list':
        result = { prompts: listPrompts() };
        break;

      case 'prompts/get': {
        const { name, arguments: args } = params || {};
        const prompt = getPrompt(name, args || {});
        if (!prompt) {
          return { jsonrpc: '2.0', error: { code: -32602, message: `Unknown prompt: ${name}` }, id };
        }
        result = prompt;
        break;
      }

      case 'tools/call': {
        const { name, arguments: args } = params || {};
        console.error(`Tool: ${name}`);

        if (!sdpClient) {
          throw new Error('SDP client not initialized. Please check OAuth configuration.');
        }

        const impl = toolImplementations[name];
        if (!impl) {
          throw new Error(`Unknown tool: ${name}`);
        }

        return impl(args || {}).then(toolResult => ({
          jsonrpc: '2.0', result: toolResult, id
        })).catch(error => ({
          jsonrpc: '2.0', error: { code: -32603, message: error.message }, id
        }));
      }

      default:
        return { jsonrpc: '2.0', error: { code: -32601, message: `Method not found: ${method}` }, id };
    }

    return { jsonrpc: '2.0', result, id };

  } catch (error) {
    return { jsonrpc: '2.0', error: { code: -32603, message: error.message }, id };
  }
}

// Message endpoint — used by SSE clients
app.post('/messages', async (req, res) => {
  const sessionId = req.query.sessionId || req.headers['x-session-id'];
  const sseConnection = connections.get(sessionId);

  if (!sseConnection) {
    return res.status(404).json({ error: 'Session not found' });
  }

  const response = handleJsonRpcMessage(req.body);

  if (response && response.then) {
    const resolved = await response;
    if (resolved) sseConnection.write(`data: ${JSON.stringify(resolved)}\n\n`);
  } else if (response) {
    sseConnection.write(`data: ${JSON.stringify(response)}\n\n`);
  }

  res.json({ status: 'ok' });
});

// Direct POST to /sse — used by some MCP clients
app.post('/sse', async (req, res) => {
  console.error('Direct SSE POST received');
  const response = handleJsonRpcMessage(req.body);
  if (!response) return res.status(200).end();
  if (response.then) {
    res.json(await response);
  } else {
    res.json(response);
  }
});

const PORT = process.env.PORT || 3456;
app.listen(PORT, '0.0.0.0', () => {
  console.error(`MCP SSE Server running on port ${PORT}`);
  console.error(`SSE:    http://0.0.0.0:${PORT}/sse`);
  console.error(`Health: http://0.0.0.0:${PORT}/health`);
  console.error(`Tools: ${tools.length} registered`);

  if (!sdpClient) {
    console.error('WARNING: SDP client not initialized — check OAuth credentials.');
    return;
  }

  sdpClient.testConnection().then(result => {
    if (result.success) {
      console.error('\n✅ SDP API connection successful');
      console.error(`   Instance : ${result.instance}`);
      console.error(`   URL      : ${result.baseUrl}`);
      console.error(`   Region   : ${result.dataCenter}`);
    } else {
      console.error('\n❌ SDP API connection failed');
      console.error(`   Instance : ${result.instance}`);
      console.error(`   URL      : ${result.baseUrl}`);
      console.error(`   Error    : ${result.error}`);
      console.error('   Check SDP_BASE_URL, SDP_CLIENT_ID, SDP_CLIENT_SECRET, SDP_REFRESH_TOKEN');
    }
  }).catch(err => {
    console.error('\n❌ SDP API connection test error:', err.message);
  });
});
