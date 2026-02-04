'use strict';

const { createInbox } = require('./inbox.cjs');
const { poll } = require('./poller.cjs');
const { KINDS, buildFilters, classifyEvent } = require('./filters.cjs');

module.exports = {
  // Main API
  createInbox,
  poll,

  // Utilities
  KINDS,
  buildFilters,
  classifyEvent
};
