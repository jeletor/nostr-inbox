'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

const { createWebhook, verifySignature } = require('../src/webhooks.cjs');

test('Webhook Creation', async (t) => {
  await t.test('throws on missing url', () => {
    assert.throws(() => createWebhook({}), /url is required/);
  });

  await t.test('creates webhook with url', () => {
    const webhook = createWebhook({ url: 'https://example.com/hook' });
    assert.ok(webhook.send);
    assert.ok(webhook.handler);
    assert.ok(webhook.close);
    assert.ok(webhook.attach);
  });
});

test('Signature Verification', async (t) => {
  await t.test('verifies valid signature', () => {
    const payload = '{"test": "data"}';
    const secret = 'my-secret';
    const crypto = require('crypto');
    const sig = `sha256=${crypto.createHmac('sha256', secret).update(payload).digest('hex')}`;
    
    assert.ok(verifySignature(payload, sig, secret));
  });

  await t.test('rejects invalid signature', () => {
    const payload = '{"test": "data"}';
    const secret = 'my-secret';
    
    assert.ok(!verifySignature(payload, 'sha256=invalid', secret));
  });

  await t.test('rejects when secret is missing', () => {
    assert.ok(!verifySignature('payload', 'sig', null));
  });
});

test('Event Filtering', async (t) => {
  await t.test('filters by event type', async () => {
    let received = [];
    
    // Create a simple HTTP server
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        received.push(JSON.parse(body));
        res.writeHead(200);
        res.end('ok');
      });
    });
    
    await new Promise(resolve => server.listen(0, resolve));
    const port = server.address().port;
    
    const webhook = createWebhook({
      url: `http://localhost:${port}/hook`,
      events: ['mention', 'dm']  // Only these types
    });
    
    // Send various notification types
    await webhook.send({ type: 'mention', content: 'test1' });
    await webhook.send({ type: 'zap', content: 'test2' });  // Should be filtered
    await webhook.send({ type: 'dm', content: 'test3' });
    
    // Wait for requests
    await new Promise(resolve => setTimeout(resolve, 100));
    
    server.close();
    await webhook.close();
    
    // Should only have received mention and dm
    assert.equal(received.length, 2);
    assert.equal(received[0].notification.type, 'mention');
    assert.equal(received[1].notification.type, 'dm');
  });

  await t.test('filters urgentOnly', async () => {
    let received = [];
    
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        received.push(JSON.parse(body));
        res.writeHead(200);
        res.end('ok');
      });
    });
    
    await new Promise(resolve => server.listen(0, resolve));
    const port = server.address().port;
    
    const webhook = createWebhook({
      url: `http://localhost:${port}/hook`,
      urgentOnly: true
    });
    
    await webhook.send({ type: 'mention', priority: 'medium', content: 'test1' });
    await webhook.send({ type: 'dm', priority: 'high', content: 'test2' });
    
    await new Promise(resolve => setTimeout(resolve, 100));
    
    server.close();
    await webhook.close();
    
    assert.equal(received.length, 1);
    assert.equal(received[0].notification.priority, 'high');
  });
});

test('Batching', async (t) => {
  await t.test('batches notifications', async () => {
    let received = [];
    
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        received.push(JSON.parse(body));
        res.writeHead(200);
        res.end('ok');
      });
    });
    
    await new Promise(resolve => server.listen(0, resolve));
    const port = server.address().port;
    
    const webhook = createWebhook({
      url: `http://localhost:${port}/hook`,
      batchMs: 50,
      maxBatchSize: 10
    });
    
    // Send 3 notifications quickly
    await webhook.send({ type: 'a', content: '1' });
    await webhook.send({ type: 'b', content: '2' });
    await webhook.send({ type: 'c', content: '3' });
    
    // Wait for batch to flush
    await new Promise(resolve => setTimeout(resolve, 150));
    
    server.close();
    await webhook.close();
    
    // Should have received one batch
    assert.equal(received.length, 1);
    assert.equal(received[0].event, 'batch');
    assert.equal(received[0].count, 3);
    assert.equal(received[0].notifications.length, 3);
  });
});

test('Signature in Request', async (t) => {
  await t.test('includes signature header when secret provided', async () => {
    let headers = null;
    
    const server = http.createServer((req, res) => {
      headers = req.headers;
      res.writeHead(200);
      res.end('ok');
    });
    
    await new Promise(resolve => server.listen(0, resolve));
    const port = server.address().port;
    
    const webhook = createWebhook({
      url: `http://localhost:${port}/hook`,
      secret: 'test-secret'
    });
    
    await webhook.send({ type: 'test', content: 'data' });
    await new Promise(resolve => setTimeout(resolve, 50));
    
    server.close();
    await webhook.close();
    
    assert.ok(headers['x-signature-256']);
    assert.ok(headers['x-signature-256'].startsWith('sha256='));
  });
});
