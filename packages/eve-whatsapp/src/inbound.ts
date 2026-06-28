// Turn a verified Cloud API webhook body into normalized inbound messages, and
// own the continuation-token format (one session per sender↔business-number).

import type { InboundDispatch, InboundMessage, WebhookEnvelope, WebhookMessage } from "./types.js";

/** Channel id used for the auth `authenticator` field and token namespace. */
export const WHATSAPP_AUTHENTICATOR = "whatsapp";

/**
 * Normalize a WhatsApp number to E.164 with a leading `+`. The Cloud API reports
 * `from`/`wa_id` as bare international digits (e.g. `573001112233`); downstream
 * identity lookups key on `+`-prefixed phones, so add it when missing.
 */
export function toE164(waId: string): string {
  const trimmed = waId.trim();
  return trimmed.startsWith("+") ? trimmed : `+${trimmed}`;
}

/**
 * Channel-local continuation token. The channel owns this format; eve prepends
 * the channel name. Keyed by business number + sender so each pair is one
 * durable session.
 */
export function whatsappContinuationToken(phoneNumberId: string, from: string): string {
  return `${phoneNumberId}:${from}`;
}

/**
 * Recover `{ phoneNumberId, to }` from a continuation token as seen by an event
 * handler. Tolerates an optional leading `whatsapp:` namespace by reading the
 * last two colon-separated segments.
 */
export function parseContinuationToken(token: string): { phoneNumberId: string; to: string } | null {
  const parts = token.split(":");
  if (parts.length < 2) return null;
  const to = parts[parts.length - 1]!;
  const phoneNumberId = parts[parts.length - 2]!;
  if (!to || !phoneNumberId) return null;
  return { phoneNumberId, to };
}

/** Pull the best-effort text out of a single webhook message. */
function extractText(m: WebhookMessage): string {
  switch (m.type) {
    case "text":
      return m.text?.body ?? "";
    case "image":
      return m.image?.caption ?? "";
    case "video":
      return m.video?.caption ?? "";
    case "document":
      return m.document?.caption ?? m.document?.filename ?? "";
    case "button":
      return m.button?.text ?? m.button?.payload ?? "";
    case "interactive": {
      const reply = m.interactive?.button_reply ?? m.interactive?.list_reply;
      return reply?.title ?? reply?.id ?? "";
    }
    default:
      return m.text?.body ?? "";
  }
}

/**
 * Parse a verified webhook body into normalized inbound messages. Ignores status
 * callbacks and anything without a usable sender. Never throws on a shape it does
 * not recognize — returns an empty array so the route can still 200.
 */
export function parseInboundMessages(body: unknown): InboundMessage[] {
  if (typeof body !== "object" || body === null) return [];
  const envelope = body as WebhookEnvelope;
  const out: InboundMessage[] = [];

  for (const entry of envelope.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      if (!value?.messages?.length) continue; // statuses-only or empty change
      const phoneNumberId = value.metadata?.phone_number_id;
      if (!phoneNumberId) continue;

      // contacts[] parallels messages[] for profile names; index-align best-effort.
      const profileByWaId = new Map<string, string>();
      for (const c of value.contacts ?? []) {
        if (c.wa_id && c.profile?.name) profileByWaId.set(c.wa_id, c.profile.name);
      }

      for (const m of value.messages) {
        if (!m.from) continue;
        out.push({
          from: toE164(m.from),
          phoneNumberId,
          type: m.type ?? "unknown",
          text: extractText(m),
          profileName: profileByWaId.get(m.from),
          messageId: m.id ?? "",
        });
      }
    }
  }
  return out;
}

/**
 * Default inbound dispatch: phone-as-principal auth (identity comes from the
 * verified webhook, never message content) and one session per
 * sender↔business-number pair. Returns `null` for empty messages.
 */
export function defaultDispatch(msg: InboundMessage): InboundDispatch | null {
  if (!msg.text.trim()) return null;
  return {
    message: msg.text,
    auth: {
      authenticator: WHATSAPP_AUTHENTICATOR,
      principalType: "user",
      principalId: msg.from,
      attributes: msg.profileName ? { profileName: msg.profileName } : {},
    },
    continuationToken: whatsappContinuationToken(msg.phoneNumberId, msg.from),
  };
}
