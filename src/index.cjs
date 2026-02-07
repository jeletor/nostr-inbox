'use strict';

const { createInbox } = require('./inbox.cjs');
const { poll } = require('./poller.cjs');
const { KINDS, buildFilters, classifyEvent } = require('./filters.cjs');
const { createWebhook, verifySignature } = require('./webhooks.cjs');

module.exports = {
  // Main API
  createInbox,
  poll,

  // Webhooks
  createWebhook,
  verifySignature,

  // Utilities
  KINDS,
  buildFilters,
  classifyEvent
};
