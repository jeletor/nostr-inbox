#!/usr/bin/env node
'use strict';

const { createInbox, poll, KINDS } = require('./index.cjs');

const PRIORITY_COLORS = {
  high: '\x1b[31m',    // red
  medium: '\x1b[33m',  // yellow
  low: '\x1b[90m'      // gray
};
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

function usage() {
  console.log(`nostr-inbox — Unified Nostr notification stream for AI agents

Usage:
  nostr-inbox watch [options]    Stream notifications in real-time
  nostr-inbox poll [options]     One-shot check (fetch and exit)
  nostr-inbox help               Show this help

Options:
  --pubkey <hex>          Your Nostr pubkey (hex)
  --relays <urls>         Comma-separated relay URLs
  --since <timestamp>     Only events after this Unix timestamp
  --since-ago <seconds>   Events from N seconds ago (default: 3600)
  --channels <types>      Comma-separated: mentions,dms,dvmRequests,dvmResults,zaps,reactions,trust,marketplace
  --json                  Output raw JSON (one per line)
  --quiet                 Only show urgent notifications

Environment:
  NOSTR_PUBKEY           Your pubkey (hex)
  NOSTR_RELAYS           Comma-separated relay URLs
`);
}

function parseArgs(args) {
  const result = { _: [] };
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      const val = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : true;
      result[key] = val;
    } else {
      result._.push(args[i]);
    }
  }
  return result;
}

function parseChannels(str) {
  if (!str) return {};
  const channels = {};
  // Start with all disabled, enable only specified
  const allOff = {
    mentions: false, dms: false, dvmRequests: false, dvmResults: false,
    zaps: false, reactions: false, trust: false, marketplace: false
  };
  for (const ch of str.split(',')) {
    allOff[ch.trim()] = true;
  }
  return allOff;
}

function formatNotification(n) {
  const color = PRIORITY_COLORS[n.priority] || '';
  const time = new Date(n.createdAt).toISOString().slice(11, 19);
  const from = n.from.slice(0, 12) + '...';
  const content = n.content ? n.content.slice(0, 120).replace(/\n/g, ' ') : '';

  const typeIcons = {
    mention: '💬',
    dm: '✉️',
    dvm_request: '⚙️',
    dvm_result: '📦',
    dvm_feedback: '📝',
    zap: '⚡',
    reaction: '❤️',
    trust: '🛡️',
    trust_network: '🌐',
    marketplace_bid: '💰',
    marketplace_delivery: '📋',
    marketplace_resolution: '✅',
    unknown: '❓'
  };

  const icon = typeIcons[n.type] || '❓';
  return `${color}[${time}] ${icon} ${BOLD}${n.type}${RESET}${color} from ${from}${RESET}  ${content}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0] || 'help';

  if (command === 'help' || args.help) {
    usage();
    return;
  }

  const pubkey = args.pubkey || process.env.NOSTR_PUBKEY;
  if (!pubkey) {
    console.error('Error: --pubkey or NOSTR_PUBKEY required');
    process.exit(1);
  }

  const relays = (args.relays || process.env.NOSTR_RELAYS || 'wss://relay.damus.io,wss://nos.lol,wss://relay.primal.net').split(',');
  const channels = args.channels ? parseChannels(args.channels) : {};
  const json = args.json === true;
  const quiet = args.quiet === true;

  if (command === 'poll') {
    const sinceAgo = args['since-ago'] ? parseInt(args['since-ago'], 10) : 3600;
    const since = args.since ? parseInt(args.since, 10) : Math.floor(Date.now() / 1000) - sinceAgo;

    const result = await poll({ pubkey, relays, channels, since });

    if (json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`\n📬 ${result.total} notifications (${result.urgent} urgent) since ${new Date(since * 1000).toISOString()}\n`);

      if (result.total === 0) {
        console.log('  Nothing new.');
        return;
      }

      // Group display
      for (const [type, items] of Object.entries(result.byType)) {
        console.log(`  ${type} (${items.length}):`);
        for (const n of items.slice(0, 10)) {
          console.log(`    ${formatNotification(n)}`);
        }
        if (items.length > 10) console.log(`    ... and ${items.length - 10} more`);
        console.log();
      }
    }
    return;
  }

  if (command === 'watch') {
    const sinceAgo = args['since-ago'] ? parseInt(args['since-ago'], 10) : 60;
    const since = args.since ? parseInt(args.since, 10) : Math.floor(Date.now() / 1000) - sinceAgo;

    const inbox = createInbox({
      pubkey,
      relays,
      channels,
      since
    });

    inbox.on('connected', ({ relay }) => {
      if (!json) console.log(`  ✓ Connected to ${relay}`);
    });

    inbox.on('started', ({ connected, total }) => {
      if (!json) console.log(`\n📬 Watching ${connected}/${total} relays. Ctrl+C to stop.\n`);
    });

    inbox.on('notification', (n) => {
      if (quiet && n.priority !== 'high') return;
      if (json) {
        console.log(JSON.stringify(n));
      } else {
        console.log(formatNotification(n));
      }
    });

    inbox.on('error', ({ relay, error }) => {
      if (!json) console.error(`  ✗ ${relay}: ${error}`);
    });

    await inbox.start();

    // Graceful shutdown
    process.on('SIGINT', () => {
      inbox.stop();
      console.log('\n👋 Stopped.');
      process.exit(0);
    });

    // Keep alive
    await new Promise(() => {});
  }

  console.error(`Unknown command: ${command}`);
  usage();
  process.exit(1);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
