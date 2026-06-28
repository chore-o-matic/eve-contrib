// Outbound delivery over the Graph API: text (split at WhatsApp's 4096 limit)
// and native, tappable contact cards. The contact card is derived from a vCard
// block the agent already emits, so no agent changes are needed.

import type { ResolvedCredentials } from "./types.js";

const MAX_TEXT_LEN = 4096;
const GRAPH_HOST = "https://graph.facebook.com";

/** Minimal client over the WhatsApp Cloud API `/messages` endpoint. */
export class WhatsAppClient {
  constructor(
    private readonly accessToken: string,
    private readonly apiVersion: string,
  ) {}

  private endpoint(phoneNumberId: string): string {
    return `${GRAPH_HOST}/${this.apiVersion}/${phoneNumberId}/messages`;
  }

  private async post(phoneNumberId: string, payload: Record<string, unknown>): Promise<WhatsAppSendResponse> {
    const res = await fetch(this.endpoint(phoneNumberId), {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ messaging_product: "whatsapp", ...payload }),
    });
    const detail = await res.text().catch(() => "");
    if (!res.ok) {
      throw new Error(`WhatsApp send failed (${res.status}): ${detail}`);
    }
    // A 2xx means "accepted/queued", NOT "delivered" — final delivery status
    // arrives later on the `statuses` webhook. The returned message id lets
    // callers correlate that webhook.
    try {
      return JSON.parse(detail) as WhatsAppSendResponse;
    } catch {
      return {};
    }
  }

  /**
   * Send text, splitting into multiple messages at the 4096-char limit. Returns
   * the API response for the last chunk. Note: free-form text only delivers
   * inside the recipient's 24-hour customer-service window; use
   * {@link sendTemplate} to (re)open a conversation with a cold recipient.
   */
  async sendText(phoneNumberId: string, to: string, body: string): Promise<WhatsAppSendResponse> {
    let last: WhatsAppSendResponse = {};
    for (const chunk of splitText(body)) {
      last = await this.post(phoneNumberId, {
        to,
        type: "text",
        text: { preview_url: false, body: chunk },
      });
    }
    return last;
  }

  /** Send a native contacts message. */
  async sendContacts(phoneNumberId: string, to: string, contacts: WhatsAppContact[]): Promise<WhatsAppSendResponse> {
    return this.post(phoneNumberId, { to, type: "contacts", contacts });
  }

  /**
   * Send an approved template message. This is the only way to reach a recipient
   * outside their 24-hour window (the canonical first-contact / delivery probe;
   * `hello_world` / `en_US` exists by default on every WhatsApp account).
   */
  async sendTemplate(
    phoneNumberId: string,
    to: string,
    name: string,
    languageCode = "en_US",
    components?: unknown[],
  ): Promise<WhatsAppSendResponse> {
    return this.post(phoneNumberId, {
      to,
      type: "template",
      template: {
        name,
        language: { code: languageCode },
        ...(components ? { components } : {}),
      },
    });
  }
}

/** Parsed `/messages` response. A 2xx here is "accepted", not "delivered". */
export interface WhatsAppSendResponse {
  messaging_product?: string;
  contacts?: { input?: string; wa_id?: string }[];
  messages?: { id?: string; message_status?: string }[];
  [key: string]: unknown;
}

/** Build a client from resolved credentials, or `null` if no access token. */
export function makeClient(creds: ResolvedCredentials): WhatsAppClient | null {
  if (!creds.accessToken) return null;
  return new WhatsAppClient(creds.accessToken, creds.apiVersion);
}

/** Split text into <=4096-char chunks, preferring to break on newlines. */
export function splitText(body: string): string[] {
  if (body.length <= MAX_TEXT_LEN) return [body];
  const chunks: string[] = [];
  let rest = body;
  while (rest.length > MAX_TEXT_LEN) {
    let cut = rest.lastIndexOf("\n", MAX_TEXT_LEN);
    if (cut <= 0) cut = MAX_TEXT_LEN;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n/, "");
  }
  if (rest) chunks.push(rest);
  return chunks;
}

// --- vCard → native WhatsApp contact ------------------------------------------

/** WhatsApp Cloud API contact object (the subset we emit). */
export interface WhatsAppContact {
  name: { formatted_name: string; first_name: string };
  phones?: { phone: string; type?: string }[];
  urls?: { url: string; type?: string }[];
}

const VCARD_RE = /BEGIN:VCARD[\s\S]*?END:VCARD/i;

/** Does the reply contain a vCard block worth promoting to a native card? */
export function hasVCard(text: string): boolean {
  return VCARD_RE.test(text);
}

/**
 * Split a reply into `{ before, contacts, after }`: surrounding prose plus the
 * parsed contact card from a single vCard block. Returns `null` when there is no
 * vCard so callers fall back to plain text.
 */
export function extractContacts(text: string): { before: string; after: string; contacts: WhatsAppContact[] } | null {
  const match = VCARD_RE.exec(text);
  if (!match) return null;
  const contact = parseVCard(match[0]);
  if (!contact) return null;
  return {
    before: text.slice(0, match.index).trim(),
    after: text.slice(match.index + match[0].length).trim(),
    contacts: [contact],
  };
}

/** Parse the FN / TEL / URL lines of a vCard into a WhatsApp contact object. */
export function parseVCard(vcard: string): WhatsAppContact | null {
  let name: string | undefined;
  const phones: { phone: string; type?: string }[] = [];
  const urls: { url: string; type?: string }[] = [];

  for (const rawLine of vcard.split(/\r?\n/)) {
    const line = rawLine.trim();
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const key = line.slice(0, idx).toUpperCase();
    const val = line.slice(idx + 1).trim();
    if (!val) continue;

    if (key === "FN") name = val;
    else if (key.startsWith("TEL")) phones.push({ phone: val, type: "CELL" });
    else if (key.startsWith("URL")) urls.push({ url: val });
  }

  if (!name) return null;
  const contact: WhatsAppContact = {
    name: { formatted_name: name, first_name: name.split(/\s+/)[0] ?? name },
  };
  if (phones.length) contact.phones = phones;
  if (urls.length) contact.urls = urls;
  return contact;
}
