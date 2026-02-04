'use strict';

/**
 * Nostr event kinds we care about
 */
const KINDS = {
  // Core
  TEXT_NOTE: 1,
  DM_ENCRYPTED: 4,       // NIP-04 encrypted DM
  REACTION: 7,
  
  // DVM (NIP-90)
  DVM_REQUEST_BASE: 5000, // 5000-5999
  DVM_RESULT_BASE: 6000,  // 6000-6999
  DVM_FEEDBACK: 7000,

  // Zaps (NIP-57)
  ZAP_RECEIPT: 9735,
  ZAP_REQUEST: 9734,

  // Trust (ai.wot)
  LABEL: 1985,            // NIP-32

  // Gift wrap DM (NIP-17)
  GIFT_WRAP: 1059,
  SEAL: 13,

  // Agent discovery
  AGENT_SERVICE: 38990,   // agent-discovery kind

  // Marketplace (agent-escrow)
  TASK: 30950,
  BID: 950,
  DELIVERY: 951,
  RESOLUTION: 952,

  // Clawstr (NIP-22)
  COMMENT: 1111
};

/**
 * Build subscription filters for a pubkey
 *
 * @param {string} pubkey - Hex pubkey to watch
 * @param {Object} channels - Which notification channels to enable
 * @param {number} [since] - Unix timestamp, only events after this
 */
function buildFilters(pubkey, channels = {}, since = null) {
  const {
    mentions = true,
    dms = true,
    dvmRequests = true,
    dvmResults = true,
    zaps = true,
    reactions = true,
    trust = true,
    marketplace = true
  } = channels;

  const filters = [];
  const sinceObj = since ? { since } : {};

  // Mentions: kind 1 events that tag our pubkey
  if (mentions) {
    filters.push({
      kinds: [KINDS.TEXT_NOTE, KINDS.COMMENT],
      '#p': [pubkey],
      ...sinceObj
    });
  }

  // DMs: kind 4 events addressed to us
  if (dms) {
    filters.push({
      kinds: [KINDS.DM_ENCRYPTED],
      '#p': [pubkey],
      ...sinceObj
    });
    // Also gift-wrapped DMs (NIP-17)
    filters.push({
      kinds: [KINDS.GIFT_WRAP],
      '#p': [pubkey],
      ...sinceObj
    });
  }

  // DVM requests: kind 5xxx tagged to us (we're a DVM provider)
  if (dvmRequests) {
    const dvmRequestKinds = [];
    for (let k = 5000; k < 5100; k++) dvmRequestKinds.push(k);
    filters.push({
      kinds: dvmRequestKinds,
      '#p': [pubkey],
      ...sinceObj
    });
  }

  // DVM results: kind 6xxx tagged to us (we requested something)
  if (dvmResults) {
    const dvmResultKinds = [];
    for (let k = 6000; k < 6100; k++) dvmResultKinds.push(k);
    filters.push({
      kinds: dvmResultKinds,
      '#p': [pubkey],
      ...sinceObj
    });
  }

  // Zaps: receipts tagged to our pubkey
  if (zaps) {
    filters.push({
      kinds: [KINDS.ZAP_RECEIPT],
      '#p': [pubkey],
      ...sinceObj
    });
  }

  // Reactions: to our events (tagged with our pubkey)
  if (reactions) {
    filters.push({
      kinds: [KINDS.REACTION],
      '#p': [pubkey],
      ...sinceObj
    });
  }

  // Trust: ai.wot attestations about us
  if (trust) {
    filters.push({
      kinds: [KINDS.LABEL],
      '#p': [pubkey],
      '#L': ['ai.wot'],
      ...sinceObj
    });
  }

  // Marketplace: tasks tagged to us, bids on our tasks, deliveries, resolutions
  if (marketplace) {
    filters.push({
      kinds: [KINDS.BID, KINDS.DELIVERY, KINDS.RESOLUTION],
      '#p': [pubkey],
      ...sinceObj
    });
  }

  return filters;
}

/**
 * Classify an event into a notification type
 */
function classifyEvent(event, myPubkey) {
  const kind = event.kind;

  // DMs
  if (kind === KINDS.DM_ENCRYPTED || kind === KINDS.GIFT_WRAP) {
    return { type: 'dm', priority: 'high' };
  }

  // DVM requests (someone wants us to do work)
  if (kind >= 5000 && kind < 6000) {
    return { type: 'dvm_request', priority: 'high', dvmKind: kind };
  }

  // DVM results (response to our request)
  if (kind >= 6000 && kind < 7000) {
    return { type: 'dvm_result', priority: 'medium', dvmKind: kind - 1000 };
  }

  // DVM feedback
  if (kind === KINDS.DVM_FEEDBACK) {
    return { type: 'dvm_feedback', priority: 'low' };
  }

  // Zaps
  if (kind === KINDS.ZAP_RECEIPT) {
    return { type: 'zap', priority: 'medium' };
  }

  // Trust attestations
  if (kind === KINDS.LABEL) {
    const isAboutMe = event.tags.some(t => t[0] === 'p' && t[1] === myPubkey);
    if (isAboutMe) {
      return { type: 'trust', priority: 'medium' };
    }
    return { type: 'trust_network', priority: 'low' };
  }

  // Marketplace
  if (kind === KINDS.BID) return { type: 'marketplace_bid', priority: 'high' };
  if (kind === KINDS.DELIVERY) return { type: 'marketplace_delivery', priority: 'high' };
  if (kind === KINDS.RESOLUTION) return { type: 'marketplace_resolution', priority: 'high' };

  // Reactions
  if (kind === KINDS.REACTION) {
    return { type: 'reaction', priority: 'low' };
  }

  // Mentions (text notes / comments that tag us)
  if (kind === KINDS.TEXT_NOTE || kind === KINDS.COMMENT) {
    return { type: 'mention', priority: 'medium' };
  }

  return { type: 'unknown', priority: 'low' };
}

module.exports = { KINDS, buildFilters, classifyEvent };
