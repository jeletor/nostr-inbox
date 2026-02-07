# nostr-inbox

Unified Nostr notification stream for AI agents. Mentions, DMs, DVM requests, zaps, trust attestations, marketplace events — one event loop instead of polling five things.

## Install

```bash
npm install nostr-inbox
```

## Quick Start

### Streaming (long-running)

```javascript
const { createInbox } = require('nostr-inbox');

const inbox = createInbox({
  pubkey: 'your-hex-pubkey',
  relays: ['wss://relay.damus.io', 'wss://nos.lol']
});

inbox.on('notification', (n) => {
  console.log(`[${n.type}] from ${n.from.slice(0, 12)}... — ${n.content}`);
});

// High-priority only (DMs, DVM requests, marketplace bids)
inbox.on('urgent', (n) => {
  console.log(`🔴 URGENT: ${n.type} from ${n.from.slice(0, 12)}...`);
});

// Type-specific handlers
inbox.on('zap', (n) => console.log(`⚡ Zapped!`));
inbox.on('dvm_request', (n) => console.log(`⚙️ DVM job incoming`));
inbox.on('trust', (n) => console.log(`🛡️ New trust attestation`));

await inbox.start();
```

### Polling (one-shot)

```javascript
const { poll } = require('nostr-inbox');

const result = await poll({
  pubkey: 'your-hex-pubkey',
  since: Math.floor(Date.now() / 1000) - 3600 // last hour
});

console.log(`${result.total} notifications (${result.urgent} urgent)`);

for (const [type, items] of Object.entries(result.byType)) {
  console.log(`  ${type}: ${items.length}`);
}
```

## CLI

```bash
# Watch real-time notifications
nostr-inbox watch --pubkey <hex>

# One-shot poll (last hour)
nostr-inbox poll --pubkey <hex>

# Filter by channel
nostr-inbox watch --pubkey <hex> --channels mentions,dms,zaps

# JSON output (for piping)
nostr-inbox poll --pubkey <hex> --json

# Only urgent notifications
nostr-inbox watch --pubkey <hex> --quiet
```

## Notification Types

| Type | Kind(s) | Priority | Description |
|------|---------|----------|-------------|
| `mention` | 1, 1111 | medium | Text notes / Clawstr comments tagging you |
| `dm` | 4, 1059 | **high** | Encrypted DMs (NIP-04 + NIP-17 gift wrap) |
| `dvm_request` | 5000-5099 | **high** | Someone wants you to do work (NIP-90) |
| `dvm_result` | 6000-6099 | medium | Response to your DVM request |
| `dvm_feedback` | 7000 | low | DVM processing status |
| `zap` | 9735 | medium | Lightning zap receipt |
| `reaction` | 7 | low | Likes / reactions |
| `trust` | 1985 | medium | ai.wot attestation about you |
| `trust_network` | 1985 | low | ai.wot attestation about others |
| `marketplace_bid` | 950 | **high** | Bid on your task (agent-escrow) |
| `marketplace_delivery` | 951 | **high** | Work submitted for your task |
| `marketplace_resolution` | 952 | **high** | Task approved / disputed |

## Channels

Enable/disable notification types:

```javascript
const inbox = createInbox({
  pubkey: '...',
  channels: {
    mentions: true,      // Text note mentions
    dms: true,           // Encrypted DMs
    dvmRequests: true,   // DVM work requests
    dvmResults: true,    // DVM results
    zaps: true,          // Lightning zaps
    reactions: false,    // Likes (noisy, disable if you want)
    trust: true,         // ai.wot attestations
    marketplace: true    // agent-escrow events
  }
});
```

## Webhooks

Push notifications to an HTTP endpoint instead of polling:

```javascript
const { createInbox, createWebhook } = require('nostr-inbox');

const inbox = createInbox({ pubkey: '...' });

// Create webhook — notifications will POST to this URL
const webhook = createWebhook({
  url: 'https://your-server.com/nostr-webhook',
  secret: 'your-hmac-secret',  // Signs payloads
  events: ['dm', 'dvm_request', 'marketplace_bid'],  // Filter types
  urgentOnly: false,
  batchMs: 5000,  // Batch notifications (0 = immediate)
  retries: 2
});

// Attach to inbox
webhook.attach(inbox);
await inbox.start();
```

### Webhook Payload

```json
{
  "event": "notification",
  "timestamp": 1707300000000,
  "notification": {
    "id": "event-id",
    "type": "dm",
    "priority": "high",
    "from": "sender-pubkey",
    "content": "...",
    "kind": 4,
    "createdAt": 1707300000000
  }
}
```

Batched payload (when `batchMs > 0`):
```json
{
  "event": "batch",
  "timestamp": 1707300000000,
  "count": 3,
  "notifications": [...]
}
```

### Verify Webhook Signatures

```javascript
const { verifySignature } = require('nostr-inbox');

app.post('/nostr-webhook', (req, res) => {
  const sig = req.headers['x-signature-256'];
  const payload = JSON.stringify(req.body);
  
  if (!verifySignature(payload, sig, process.env.WEBHOOK_SECRET)) {
    return res.status(401).send('Invalid signature');
  }
  
  // Process notification
  console.log(req.body.notification);
  res.send('ok');
});
```

## API

### `createInbox(opts)` → `inbox`

Creates a streaming inbox.

**Options:**
- `pubkey` (string, required) — Your hex pubkey
- `relays` (string[]) — Relay URLs (default: damus, nos.lol, primal)
- `channels` (object) — Enable/disable notification types
- `since` (number) — Unix timestamp, only events after this
- `dedup` (boolean) — Deduplicate events (default: true)
- `reconnectMs` (number) — Reconnect delay (default: 5000)

**Methods:**
- `inbox.start()` — Connect and begin streaming
- `inbox.stop()` — Disconnect
- `inbox.status()` — Get connection status
- `inbox.waitFor(type, timeoutMs)` — Promise that resolves on next event of type
- `inbox.collect(durationMs, filter)` — Collect events for a duration

**Events:**
- `notification` — Every notification
- `urgent` — High-priority only
- `<type>` — Type-specific (e.g., `zap`, `dm`, `dvm_request`)
- `connected` / `started` / `stopped` — Lifecycle
- `error` — Connection errors

### `poll(opts)` → `{ total, urgent, notifications, byType }`

One-shot fetch. Same options as `createInbox` plus `timeoutMs`.

## Interop

Built for the agent economy stack:
- [agent-escrow](https://github.com/jeletor/agent-escrow) — Marketplace events (bids, deliveries, resolutions)
- [ai-wot](https://github.com/jeletor/ai-wot) — Trust attestation notifications
- [agent-discovery](https://github.com/jeletor/agent-discovery) — Service announcements
- [lightning-agent](https://github.com/jeletor/lightning-agent) — Zap handling

## License

MIT
