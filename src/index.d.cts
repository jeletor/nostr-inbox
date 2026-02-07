// Type definitions for nostr-inbox

import { EventEmitter } from 'events';

export interface NostrEvent {
  id: string;
  pubkey: string;
  kind: number;
  created_at: number;
  tags: string[][];
  content: string;
  sig: string;
}

export type NotificationType =
  | 'mention' | 'dm' | 'dvm_request' | 'dvm_result' | 'dvm_feedback'
  | 'zap' | 'reaction' | 'trust' | 'trust_network'
  | 'marketplace_bid' | 'marketplace_delivery' | 'marketplace_resolution'
  | 'unknown';

export type Priority = 'high' | 'medium' | 'low';

export interface Notification {
  id: string;
  type: NotificationType;
  priority: Priority;
  from: string;
  content: string;
  kind: number;
  tags: string[][];
  createdAt: number;
  raw: NostrEvent;
  dvmKind?: number;
}

export interface Channels {
  mentions?: boolean;
  dms?: boolean;
  dvmRequests?: boolean;
  dvmResults?: boolean;
  zaps?: boolean;
  reactions?: boolean;
  trust?: boolean;
  marketplace?: boolean;
  dvmKinds?: number[];
}

export interface InboxOptions {
  pubkey: string;
  relays?: string[];
  channels?: Channels;
  since?: number;
  dedup?: boolean;
  onEvent?: (notification: Notification) => void;
  onError?: (error: { relay: string; error: string }) => void;
  reconnectMs?: number;
  connectTimeoutMs?: number;
}

export interface InboxStatus {
  running: boolean;
  relays: {
    connected: number;
    total: number;
    urls: string[];
  };
  seen: number;
  latestTimestamp: number;
  channels: Channels;
}

export interface Inbox {
  start(): Promise<EventEmitter>;
  stop(): void;
  status(): InboxStatus;
  on(event: 'notification', handler: (n: Notification) => void): void;
  on(event: 'urgent', handler: (n: Notification) => void): void;
  on(event: NotificationType, handler: (n: Notification) => void): void;
  on(event: 'connected', handler: (info: { relay: string }) => void): void;
  on(event: 'started', handler: (info: { connected: number; total: number }) => void): void;
  on(event: 'stopped', handler: () => void): void;
  on(event: 'synced', handler: (info: { relay: string }) => void): void;
  on(event: 'error', handler: (error: { relay: string; error: string }) => void): void;
  off(event: string, handler: Function): void;
  once(event: string, handler: Function): void;
  waitFor(type: NotificationType, timeoutMs?: number): Promise<Notification>;
  collect(durationMs?: number, filter?: (n: Notification) => boolean): Promise<Notification[]>;
  emitter: EventEmitter;
}

export interface PollOptions {
  pubkey: string;
  relays?: string[];
  channels?: Channels;
  since?: number;
  timeoutMs?: number;
}

export interface PollResult {
  total: number;
  urgent: number;
  notifications: Notification[];
  byType: Record<NotificationType, Notification[]>;
  since: number;
  queriedAt: number;
}

export interface Classification {
  type: NotificationType;
  priority: Priority;
  dvmKind?: number;
}

export function createInbox(opts: InboxOptions): Inbox;
export function poll(opts: PollOptions): Promise<PollResult>;
export function buildFilters(pubkey: string, channels?: Channels, since?: number): object[];
export function classifyEvent(event: NostrEvent, myPubkey: string): Classification;

// Webhooks
export interface WebhookOptions {
  url: string;
  secret?: string;
  events?: NotificationType[];
  urgentOnly?: boolean;
  batchMs?: number;
  maxBatchSize?: number;
  timeoutMs?: number;
  retries?: number;
  onError?: (error: Error, payload: any) => void;
  onSuccess?: (result: { status: number; body: string; payload: any }) => void;
}

export interface Webhook {
  send(notification: Notification): Promise<void>;
  handler(notification: Notification): void;
  close(): Promise<void>;
  attach(inbox: Inbox): Webhook;
  detach(inbox: Inbox): Webhook;
}

export function createWebhook(opts: WebhookOptions): Webhook;
export function verifySignature(payload: string, signature: string, secret: string): boolean;

export const KINDS: {
  TEXT_NOTE: 1;
  DM_ENCRYPTED: 4;
  REACTION: 7;
  DVM_REQUEST_BASE: 5000;
  DVM_RESULT_BASE: 6000;
  DVM_FEEDBACK: 7000;
  ZAP_RECEIPT: 9735;
  ZAP_REQUEST: 9734;
  LABEL: 1985;
  GIFT_WRAP: 1059;
  SEAL: 13;
  AGENT_SERVICE: 38990;
  TASK: 30950;
  BID: 950;
  DELIVERY: 951;
  RESOLUTION: 952;
  COMMENT: 1111;
};
