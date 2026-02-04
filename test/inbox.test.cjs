'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { createInbox, poll, KINDS, buildFilters, classifyEvent } = require('../src/index.cjs');

const TEST_PUBKEY = 'dc52438efbf965d35738743daf9f7c718976462b010aa4e5ed24e569825bae94';

// ── Constants ──────────────────────────────────────────

describe('Constants', () => {
  it('exports expected event kinds', () => {
    assert.equal(KINDS.TEXT_NOTE, 1);
    assert.equal(KINDS.DM_ENCRYPTED, 4);
    assert.equal(KINDS.REACTION, 7);
    assert.equal(KINDS.ZAP_RECEIPT, 9735);
    assert.equal(KINDS.LABEL, 1985);
    assert.equal(KINDS.DVM_REQUEST_BASE, 5000);
    assert.equal(KINDS.DVM_RESULT_BASE, 6000);
    assert.equal(KINDS.TASK, 30950);
    assert.equal(KINDS.BID, 950);
    assert.equal(KINDS.COMMENT, 1111);
  });
});

// ── Filter Building ────────────────────────────────────

describe('buildFilters', () => {
  it('builds filters with all channels enabled (default)', () => {
    const filters = buildFilters(TEST_PUBKEY);
    assert.ok(filters.length > 0);
    // Should have filters for mentions, dms, dvm, zaps, reactions, trust, marketplace
    assert.ok(filters.length >= 7);

    // Every filter should reference our pubkey
    for (const f of filters) {
      // Some filters use #p, some might use authors
      assert.ok(f['#p']?.includes(TEST_PUBKEY) || f.authors?.includes(TEST_PUBKEY),
        `Filter should reference our pubkey: ${JSON.stringify(f)}`);
    }
  });

  it('builds filters with only mentions enabled', () => {
    const filters = buildFilters(TEST_PUBKEY, {
      mentions: true,
      dms: false,
      dvmRequests: false,
      dvmResults: false,
      zaps: false,
      reactions: false,
      trust: false,
      marketplace: false
    });
    assert.equal(filters.length, 1);
    assert.ok(filters[0].kinds.includes(KINDS.TEXT_NOTE));
  });

  it('builds filters with since timestamp', () => {
    const since = Math.floor(Date.now() / 1000) - 3600;
    const filters = buildFilters(TEST_PUBKEY, { mentions: true, dms: false, dvmRequests: false, dvmResults: false, zaps: false, reactions: false, trust: false, marketplace: false }, since);
    assert.equal(filters[0].since, since);
  });

  it('includes common DVM request kinds (not 100 kinds)', () => {
    const filters = buildFilters(TEST_PUBKEY, {
      mentions: false, dms: false, dvmRequests: true, dvmResults: false,
      zaps: false, reactions: false, trust: false, marketplace: false
    });
    assert.equal(filters.length, 1);
    assert.ok(filters[0].kinds.includes(5000));
    assert.ok(filters[0].kinds.includes(5050));
    assert.ok(filters[0].kinds.length < 30, 'should not generate 100 kinds');
  });

  it('includes common DVM result kinds', () => {
    const filters = buildFilters(TEST_PUBKEY, {
      mentions: false, dms: false, dvmRequests: false, dvmResults: true,
      zaps: false, reactions: false, trust: false, marketplace: false
    });
    assert.equal(filters.length, 1);
    assert.ok(filters[0].kinds.includes(6000));
    assert.ok(filters[0].kinds.includes(6050));
    assert.ok(filters[0].kinds.length < 30);
  });

  it('accepts custom DVM kinds', () => {
    const filters = buildFilters(TEST_PUBKEY, {
      mentions: false, dms: false, dvmRequests: true, dvmResults: true,
      zaps: false, reactions: false, trust: false, marketplace: false,
      dvmKinds: [5050, 5100]
    });
    assert.equal(filters.length, 2);
    assert.deepEqual(filters[0].kinds, [5050, 5100]);
    assert.deepEqual(filters[1].kinds, [6050, 6100]);
  });

  it('includes marketplace kinds', () => {
    const filters = buildFilters(TEST_PUBKEY, {
      mentions: false, dms: false, dvmRequests: false, dvmResults: false,
      zaps: false, reactions: false, trust: false, marketplace: true
    });
    assert.equal(filters.length, 1);
    assert.ok(filters[0].kinds.includes(KINDS.BID));
    assert.ok(filters[0].kinds.includes(KINDS.DELIVERY));
    assert.ok(filters[0].kinds.includes(KINDS.RESOLUTION));
  });

  it('includes trust filter with ai.wot label', () => {
    const filters = buildFilters(TEST_PUBKEY, {
      mentions: false, dms: false, dvmRequests: false, dvmResults: false,
      zaps: false, reactions: false, trust: true, marketplace: false
    });
    assert.equal(filters.length, 1);
    assert.ok(filters[0].kinds.includes(KINDS.LABEL));
    assert.deepEqual(filters[0]['#L'], ['ai.wot']);
  });
});

// ── Event Classification ───────────────────────────────

describe('classifyEvent', () => {
  const me = TEST_PUBKEY;

  it('classifies text note mentions', () => {
    const result = classifyEvent({ kind: 1, tags: [['p', me]], pubkey: 'abc', content: 'hi' }, me);
    assert.equal(result.type, 'mention');
    assert.equal(result.priority, 'medium');
  });

  it('classifies DMs as high priority', () => {
    const result = classifyEvent({ kind: 4, tags: [['p', me]], pubkey: 'abc', content: '' }, me);
    assert.equal(result.type, 'dm');
    assert.equal(result.priority, 'high');
  });

  it('classifies gift-wrapped DMs', () => {
    const result = classifyEvent({ kind: 1059, tags: [['p', me]], pubkey: 'abc', content: '' }, me);
    assert.equal(result.type, 'dm');
    assert.equal(result.priority, 'high');
  });

  it('classifies DVM requests as high priority', () => {
    const result = classifyEvent({ kind: 5050, tags: [['p', me]], pubkey: 'abc', content: '' }, me);
    assert.equal(result.type, 'dvm_request');
    assert.equal(result.priority, 'high');
    assert.equal(result.dvmKind, 5050);
  });

  it('classifies DVM results as medium priority', () => {
    const result = classifyEvent({ kind: 6050, tags: [['p', me]], pubkey: 'abc', content: '' }, me);
    assert.equal(result.type, 'dvm_result');
    assert.equal(result.priority, 'medium');
    assert.equal(result.dvmKind, 5050); // maps back to request kind
  });

  it('classifies zap receipts', () => {
    const result = classifyEvent({ kind: 9735, tags: [['p', me]], pubkey: 'abc', content: '' }, me);
    assert.equal(result.type, 'zap');
    assert.equal(result.priority, 'medium');
  });

  it('classifies reactions as low priority', () => {
    const result = classifyEvent({ kind: 7, tags: [['p', me]], pubkey: 'abc', content: '❤️' }, me);
    assert.equal(result.type, 'reaction');
    assert.equal(result.priority, 'low');
  });

  it('classifies trust attestations about me', () => {
    const result = classifyEvent({
      kind: 1985, tags: [['p', me], ['L', 'ai.wot']], pubkey: 'abc', content: 'good agent'
    }, me);
    assert.equal(result.type, 'trust');
    assert.equal(result.priority, 'medium');
  });

  it('classifies trust attestations about others', () => {
    const result = classifyEvent({
      kind: 1985, tags: [['p', 'other'], ['L', 'ai.wot']], pubkey: 'abc', content: 'good agent'
    }, me);
    assert.equal(result.type, 'trust_network');
    assert.equal(result.priority, 'low');
  });

  it('classifies marketplace bids as high priority', () => {
    const result = classifyEvent({ kind: 950, tags: [['p', me]], pubkey: 'abc', content: '' }, me);
    assert.equal(result.type, 'marketplace_bid');
    assert.equal(result.priority, 'high');
  });

  it('classifies marketplace deliveries as high priority', () => {
    const result = classifyEvent({ kind: 951, tags: [['p', me]], pubkey: 'abc', content: '' }, me);
    assert.equal(result.type, 'marketplace_delivery');
    assert.equal(result.priority, 'high');
  });

  it('classifies marketplace resolutions', () => {
    const result = classifyEvent({ kind: 952, tags: [['p', me]], pubkey: 'abc', content: '' }, me);
    assert.equal(result.type, 'marketplace_resolution');
    assert.equal(result.priority, 'high');
  });

  it('classifies Clawstr comments (NIP-22)', () => {
    const result = classifyEvent({ kind: 1111, tags: [['p', me]], pubkey: 'abc', content: '' }, me);
    assert.equal(result.type, 'mention');
  });

  it('classifies DVM feedback', () => {
    const result = classifyEvent({ kind: 7000, tags: [], pubkey: 'abc', content: '' }, me);
    assert.equal(result.type, 'dvm_feedback');
    assert.equal(result.priority, 'low');
  });

  it('classifies unknown kinds', () => {
    const result = classifyEvent({ kind: 99999, tags: [], pubkey: 'abc', content: '' }, me);
    assert.equal(result.type, 'unknown');
    assert.equal(result.priority, 'low');
  });
});

// ── Inbox Creation ─────────────────────────────────────

describe('createInbox', () => {
  it('requires pubkey', () => {
    assert.throws(() => createInbox({}), /pubkey is required/);
  });

  it('creates inbox with default options', () => {
    const inbox = createInbox({ pubkey: TEST_PUBKEY });
    assert.ok(inbox.start);
    assert.ok(inbox.stop);
    assert.ok(inbox.status);
    assert.ok(inbox.on);
    assert.ok(inbox.off);
    assert.ok(inbox.once);
    assert.ok(inbox.waitFor);
    assert.ok(inbox.collect);
  });

  it('reports status before starting', () => {
    const inbox = createInbox({ pubkey: TEST_PUBKEY });
    const s = inbox.status();
    assert.equal(s.running, false);
    assert.equal(s.relays.connected, 0);
    assert.equal(s.relays.total, 3); // default 3 relays
  });

  it('accepts custom relay list', () => {
    const inbox = createInbox({
      pubkey: TEST_PUBKEY,
      relays: ['wss://relay.example.com']
    });
    assert.equal(inbox.status().relays.total, 1);
  });

  it('emits events via EventEmitter', (t) => {
    const inbox = createInbox({ pubkey: TEST_PUBKEY });
    let called = false;
    inbox.on('notification', () => { called = true; });
    // Manually trigger for testing
    inbox.emitter.emit('notification', { type: 'test' });
    assert.ok(called);
  });
});

// ── Poll Function ──────────────────────────────────────

describe('poll', () => {
  it('requires pubkey', async () => {
    await assert.rejects(() => poll({}), /pubkey is required/);
  });
});

// ── Priority System ────────────────────────────────────

describe('Priority System', () => {
  const me = TEST_PUBKEY;

  it('high priority: DMs, DVM requests, marketplace events', () => {
    const highKinds = [4, 1059, 5050, 950, 951, 952];
    for (const kind of highKinds) {
      const result = classifyEvent({ kind, tags: [['p', me]], pubkey: 'abc', content: '' }, me);
      assert.equal(result.priority, 'high', `kind ${kind} should be high priority`);
    }
  });

  it('medium priority: mentions, zaps, trust, DVM results', () => {
    const checks = [
      { kind: 1, expected: 'medium' },
      { kind: 9735, expected: 'medium' },
      { kind: 6050, expected: 'medium' },
    ];
    for (const { kind, expected } of checks) {
      const result = classifyEvent({ kind, tags: [['p', me]], pubkey: 'abc', content: '' }, me);
      assert.equal(result.priority, expected, `kind ${kind} should be ${expected} priority`);
    }
  });

  it('low priority: reactions, DVM feedback', () => {
    const lowKinds = [7, 7000];
    for (const kind of lowKinds) {
      const result = classifyEvent({ kind, tags: [], pubkey: 'abc', content: '' }, me);
      assert.equal(result.priority, 'low', `kind ${kind} should be low priority`);
    }
  });
});
