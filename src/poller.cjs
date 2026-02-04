'use strict';

const { Relay, useWebSocketImplementation } = require('nostr-tools/relay');
const { buildFilters, classifyEvent } = require('./filters.cjs');

// Use ws in Node.js
try {
  const WebSocket = require('ws');
  useWebSocketImplementation(WebSocket);
} catch (e) {}

/**
 * One-shot poll: connect, fetch events since timestamp, disconnect
 *
 * Useful for agents that check periodically rather than streaming.
 *
 * @param {Object} opts
 * @param {string} opts.pubkey - Your hex pubkey
 * @param {string[]} [opts.relays] - Relay URLs
 * @param {Object} [opts.channels] - Which notification types to check
 * @param {number} [opts.since] - Unix timestamp
 * @param {number} [opts.timeoutMs] - Query timeout
 */
async function poll(opts) {
  const {
    pubkey,
    relays: relayUrls = ['wss://relay.damus.io', 'wss://nos.lol'],
    channels = {},
    since = Math.floor(Date.now() / 1000) - 3600, // default: last hour
    timeoutMs = 10000
  } = opts;

  if (!pubkey) throw new Error('pubkey is required');

  const events = new Map();
  const filters = buildFilters(pubkey, channels, since);

  // Connect to relays and collect events
  const relayPromises = relayUrls.map(async (url) => {
    try {
      const relay = await Promise.race([
        Relay.connect(url),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), timeoutMs))
      ]);

      await new Promise((resolve) => {
        const timer = setTimeout(resolve, timeoutMs);
        relay.subscribe(filters, {
          onevent(event) {
            events.set(event.id, event);
          },
          oneose() {
            clearTimeout(timer);
            resolve();
          }
        });
      });

      try { relay.close(); } catch (e) {}
    } catch (e) {
      // Relay unavailable — skip
    }
  });

  await Promise.allSettled(relayPromises);

  // Classify and sort
  const notifications = Array.from(events.values())
    .map(event => {
      const classification = classifyEvent(event, pubkey);
      return {
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
    })
    .sort((a, b) => b.createdAt - a.createdAt);

  // Group by type
  const byType = {};
  for (const n of notifications) {
    if (!byType[n.type]) byType[n.type] = [];
    byType[n.type].push(n);
  }

  // Summary
  const urgent = notifications.filter(n => n.priority === 'high');

  return {
    total: notifications.length,
    urgent: urgent.length,
    notifications,
    byType,
    since,
    queriedAt: Date.now()
  };
}

module.exports = { poll };
