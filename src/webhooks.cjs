'use strict';

const https = require('https');
const http = require('http');
const { URL } = require('url');

/**
 * Create a webhook dispatcher for nostr-inbox notifications
 * 
 * @param {Object} opts
 * @param {string} opts.url - Webhook endpoint URL
 * @param {string} [opts.secret] - HMAC secret for signing payloads
 * @param {string[]} [opts.events] - Event types to send (default: all)
 * @param {boolean} [opts.urgentOnly] - Only send urgent notifications
 * @param {number} [opts.batchMs] - Batch notifications for this many ms (0 = immediate)
 * @param {number} [opts.maxBatchSize] - Max notifications per batch
 * @param {number} [opts.timeoutMs] - Request timeout
 * @param {number} [opts.retries] - Number of retries on failure
 * @param {Function} [opts.onError] - Error callback
 * @param {Function} [opts.onSuccess] - Success callback
 */
function createWebhook(opts) {
  const {
    url,
    secret = null,
    events = null,  // null = all events
    urgentOnly = false,
    batchMs = 0,
    maxBatchSize = 100,
    timeoutMs = 10000,
    retries = 2,
    onError = null,
    onSuccess = null
  } = opts;

  if (!url) throw new Error('url is required');

  const parsedUrl = new URL(url);
  const isHttps = parsedUrl.protocol === 'https:';
  const httpModule = isHttps ? https : http;

  let batch = [];
  let batchTimer = null;

  /**
   * Sign payload with HMAC-SHA256
   */
  function sign(payload) {
    if (!secret) return null;
    const crypto = require('crypto');
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(payload);
    return hmac.digest('hex');
  }

  /**
   * Send HTTP request with retries
   */
  async function sendRequest(payload, attempt = 1) {
    return new Promise((resolve, reject) => {
      const payloadStr = JSON.stringify(payload);
      const signature = sign(payloadStr);

      const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (isHttps ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payloadStr),
          'User-Agent': 'nostr-inbox/0.2.0',
          'X-Nostr-Inbox-Event': payload.event || 'notification'
        },
        timeout: timeoutMs
      };

      if (signature) {
        options.headers['X-Signature-256'] = `sha256=${signature}`;
      }

      const req = httpModule.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            if (onSuccess) onSuccess({ status: res.statusCode, body: data, payload });
            resolve({ status: res.statusCode, body: data });
          } else if (attempt <= retries) {
            // Retry with exponential backoff
            setTimeout(() => {
              sendRequest(payload, attempt + 1).then(resolve).catch(reject);
            }, Math.pow(2, attempt) * 1000);
          } else {
            const err = new Error(`Webhook failed: ${res.statusCode}`);
            if (onError) onError(err, payload);
            reject(err);
          }
        });
      });

      req.on('error', (err) => {
        if (attempt <= retries) {
          setTimeout(() => {
            sendRequest(payload, attempt + 1).then(resolve).catch(reject);
          }, Math.pow(2, attempt) * 1000);
        } else {
          if (onError) onError(err, payload);
          reject(err);
        }
      });

      req.on('timeout', () => {
        req.destroy();
        if (attempt <= retries) {
          setTimeout(() => {
            sendRequest(payload, attempt + 1).then(resolve).catch(reject);
          }, Math.pow(2, attempt) * 1000);
        } else {
          const err = new Error('Webhook timeout');
          if (onError) onError(err, payload);
          reject(err);
        }
      });

      req.write(payloadStr);
      req.end();
    });
  }

  /**
   * Flush the batch
   */
  async function flushBatch() {
    if (batch.length === 0) return;

    const toSend = batch.splice(0, maxBatchSize);
    batchTimer = null;

    const payload = {
      event: 'batch',
      timestamp: Date.now(),
      count: toSend.length,
      notifications: toSend
    };

    try {
      await sendRequest(payload);
    } catch (e) {
      // Error already handled in sendRequest
    }
  }

  /**
   * Send a notification (or add to batch)
   */
  async function send(notification) {
    // Filter by event type
    if (events && !events.includes(notification.type)) return;

    // Filter urgent only
    if (urgentOnly && notification.priority !== 'high') return;

    // Batching
    if (batchMs > 0) {
      batch.push(notification);

      if (batch.length >= maxBatchSize) {
        if (batchTimer) clearTimeout(batchTimer);
        await flushBatch();
      } else if (!batchTimer) {
        batchTimer = setTimeout(flushBatch, batchMs);
      }
      return;
    }

    // Immediate send
    const payload = {
      event: 'notification',
      timestamp: Date.now(),
      notification
    };

    try {
      await sendRequest(payload);
    } catch (e) {
      // Error already handled
    }
  }

  /**
   * Create handler function for inbox events
   */
  function handler(notification) {
    send(notification).catch(() => {});
  }

  /**
   * Flush any pending batch and clean up
   */
  async function close() {
    if (batchTimer) {
      clearTimeout(batchTimer);
      batchTimer = null;
    }
    if (batch.length > 0) {
      await flushBatch();
    }
  }

  return {
    send,
    handler,
    close,
    
    // For direct integration with createInbox
    attach(inbox) {
      inbox.on('notification', handler);
      return this;
    },

    detach(inbox) {
      inbox.off('notification', handler);
      return this;
    }
  };
}

/**
 * Helper to verify incoming webhook signatures
 */
function verifySignature(payload, signature, secret) {
  if (!signature || !secret) return false;
  
  const crypto = require('crypto');
  const expected = `sha256=${crypto.createHmac('sha256', secret).update(payload).digest('hex')}`;
  
  // Constant-time comparison
  if (signature.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

module.exports = {
  createWebhook,
  verifySignature
};
