'use strict';

const { EventEmitter } = require('events');
const { Relay, useWebSocketImplementation } = require('nostr-tools/relay');
const { buildFilters, classifyEvent } = require('./filters.cjs');

// Use ws in Node.js
try {
  const WebSocket = require('ws');
  useWebSocketImplementation(WebSocket);
} catch (e) {
  // Browser environment
}

/**
 * Create an inbox that streams Nostr notifications
 *
 * @param {Object} opts
 * @param {string} opts.pubkey - Your hex pubkey
 * @param {string[]} [opts.relays] - Relay URLs
 * @param {Object} [opts.channels] - Which notification types to enable
 * @param {number} [opts.since] - Unix timestamp, only events after this
 * @param {boolean} [opts.dedup] - Deduplicate events by ID (default: true)
 * @param {Function} [opts.onEvent] - Callback for each event (alternative to EventEmitter)
 * @param {Function} [opts.onError] - Error callback
 * @param {number} [opts.reconnectMs] - Reconnect delay on disconnect (default: 5000)
 * @param {number} [opts.connectTimeoutMs] - Connection timeout (default: 10000)
 */
function createInbox(opts) {
  const {
    pubkey,
    relays: relayUrls = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net'],
    channels = {},
    since = null,
    dedup = true,
    onEvent = null,
    onError = null,
    reconnectMs = 5000,
    connectTimeoutMs = 10000
  } = opts;

  if (!pubkey) throw new Error('pubkey is required');

  const emitter = new EventEmitter();
  const seen = new Set();      // Event ID dedup
  const connectedRelays = [];  // Active relay connections
  let running = false;
  let latestTimestamp = since || Math.floor(Date.now() / 1000) - 60; // default: last minute

  /**
   * Process an incoming event
   */
  function handleEvent(event) {
    // Dedup
    if (dedup && seen.has(event.id)) return;
    if (dedup) {
      seen.add(event.id);
      // Prevent memory leak — keep last 10k IDs
      if (seen.size > 10000) {
        const arr = Array.from(seen);
        for (let i = 0; i < 5000; i++) seen.delete(arr[i]);
      }
    }

    // Track latest timestamp for reconnection
    if (event.created_at > latestTimestamp) {
      latestTimestamp = event.created_at;
    }

    // Classify
    const classification = classifyEvent(event, pubkey);

    const notification = {
      id: event.id,
      type: classification.type,
      priority: classification.priority,
      from: event.pubkey,
      content: event.content,
      kind: event.kind,
      tags: event.tags,
      createdAt: event.created_at * 1000,
      raw: event,
      ...classification
    };

    // Emit
    emitter.emit('notification', notification);
    emitter.emit(classification.type, notification);
    if (classification.priority === 'high') {
      emitter.emit('urgent', notification);
    }

    // Callback
    if (onEvent) {
      try { onEvent(notification); } catch (e) { /* user error */ }
    }
  }

  /**
   * Connect to a single relay with auto-reconnect
   */
  async function connectRelay(url) {
    try {
      const relay = await Promise.race([
        Relay.connect(url),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), connectTimeoutMs))
      ]);

      const filters = buildFilters(pubkey, channels, latestTimestamp);

      relay.subscribe(filters, {
        onevent: handleEvent,
        oneose() {
          // Initial sync complete for this relay
          emitter.emit('synced', { relay: url });
        }
      });

      connectedRelays.push({ url, relay });
      emitter.emit('connected', { relay: url });

      return relay;
    } catch (err) {
      const error = { relay: url, error: err.message };
      emitter.emit('error', error);
      if (onError) onError(error);

      // Schedule reconnect
      if (running) {
        setTimeout(() => connectRelay(url), reconnectMs);
      }
      return null;
    }
  }

  /**
   * Start the inbox — connect to all relays and begin streaming
   */
  async function start() {
    if (running) return;
    running = true;

    emitter.emit('starting', { relays: relayUrls });

    await Promise.allSettled(relayUrls.map(connectRelay));

    emitter.emit('started', {
      connected: connectedRelays.length,
      total: relayUrls.length
    });

    return emitter;
  }

  /**
   * Stop the inbox — close all connections
   */
  function stop() {
    running = false;
    for (const { relay } of connectedRelays) {
      try { relay.close(); } catch (e) { /* ignore */ }
    }
    connectedRelays.length = 0;
    emitter.emit('stopped');
  }

  /**
   * Get current status
   */
  function status() {
    return {
      running,
      relays: {
        connected: connectedRelays.length,
        total: relayUrls.length,
        urls: connectedRelays.map(r => r.url)
      },
      seen: seen.size,
      latestTimestamp,
      channels
    };
  }

  /**
   * Wait for the next event of a specific type (promise-based)
   */
  function waitFor(type, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        emitter.off(type, handler);
        reject(new Error(`Timeout waiting for ${type}`));
      }, timeoutMs);

      function handler(notification) {
        clearTimeout(timer);
        resolve(notification);
      }

      emitter.once(type, handler);
    });
  }

  /**
   * Collect events for a duration, then return them
   */
  function collect(durationMs = 5000, filter = null) {
    return new Promise((resolve) => {
      const events = [];

      function handler(notification) {
        if (!filter || filter(notification)) {
          events.push(notification);
        }
      }

      emitter.on('notification', handler);

      setTimeout(() => {
        emitter.off('notification', handler);
        resolve(events);
      }, durationMs);
    });
  }

  return {
    // Lifecycle
    start,
    stop,
    status,

    // EventEmitter interface
    on: emitter.on.bind(emitter),
    off: emitter.off.bind(emitter),
    once: emitter.once.bind(emitter),

    // Utilities
    waitFor,
    collect,

    // Direct access
    emitter
  };
}

module.exports = { createInbox };
