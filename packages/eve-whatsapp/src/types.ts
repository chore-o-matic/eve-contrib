// Public config + the slice of the WhatsApp Cloud API webhook/Graph shapes this
// channel touches. Hand-written narrowing types (no zod) keep the package
// dependency-light: `eve` is the only peer dependency.

/**
 * Configuration for {@link whatsappChannel}. Every credential falls back to an
 * environment variable when omitted, so the common case is `whatsappChannel()`.
 */
export interface WhatsAppChannelConfig {
  /** Cloud API credentials. Each field falls back to the env var noted below. */
  credentials?: WhatsAppCredentials;
  /**
   * Webhook route path, mounted for both `GET` (subscription handshake) and
   * `POST` (inbound messages). This is also the Meta callback URL. Defaults to
   * `/eve/v1/whatsapp`. eve does not auto-prefix custom channel routes, so the
   * path is literal — override it to mount the channel elsewhere.
   */
  route?: string;
  /**
   * Override inbound dispatch (auth, continuation token, filtering). Return the
   * `send()` options for a message, or `null` to ignore it. Defaults to
   * {@link defaultDispatch}: phone-as-principal auth, one session per
   * sender↔business-number pair.
   */
  onMessage?: (msg: InboundMessage) => InboundDispatch | null;
  /**
   * How a provider contact card is delivered. `"contacts"` (default) converts a
   * `BEGIN:VCARD…END:VCARD` block in the reply into a native, tappable WhatsApp
   * contacts message; `"vcard"` leaves it inline as text.
   */
  handoffFormat?: "contacts" | "vcard";
}

export interface WhatsAppCredentials {
  /** Permanent system-user token. Env: `WHATSAPP_ACCESS_TOKEN`. */
  accessToken?: string;
  /** Business phone number id (outbound endpoint). Env: `WHATSAPP_PHONE_NUMBER_ID`. */
  phoneNumberId?: string;
  /** Meta app secret, verifies `X-Hub-Signature-256`. Env: `WHATSAPP_APP_SECRET`. */
  appSecret?: string;
  /** Webhook handshake token we choose. Env: `WHATSAPP_VERIFY_TOKEN`. */
  verifyToken?: string;
  /** Graph API version. Env: `WHATSAPP_API_VERSION`. Defaults to `v21.0`. */
  apiVersion?: string;
}

/** Credentials after env fallback; individual fields may still be undefined. */
export interface ResolvedCredentials {
  accessToken?: string;
  phoneNumberId?: string;
  appSecret?: string;
  verifyToken?: string;
  apiVersion: string;
}

/** What {@link whatsappChannel}'s dispatch hands to eve's `send()`. */
export interface InboundDispatch {
  message: string;
  auth: SendAuth;
  continuationToken: string;
}

/** Flat auth context eve exposes at `ctx.session.auth.initiator`. */
export interface SendAuth {
  authenticator: string;
  principalType: string;
  principalId: string;
  attributes: Record<string, string>;
}

/** A single inbound user message, normalized out of the Cloud API envelope. */
export interface InboundMessage {
  /** Sender's E.164 phone (normalized with a leading `+`). The verified identity. */
  from: string;
  /** Business number that received the message (Cloud API `phone_number_id`). */
  phoneNumberId: string;
  /** Cloud API message type, e.g. `"text"`, `"interactive"`, `"image"`. */
  type: string;
  /** Best-effort text body (text body, caption, or interactive reply title/id). */
  text: string;
  /** WhatsApp profile name, for greeting only — never an identity. */
  profileName?: string;
  /** Provider message id, for logging/idempotency. */
  messageId: string;
}

// --- Cloud API webhook envelope (the parts we read) ---------------------------

export interface WebhookEnvelope {
  object?: string;
  entry?: WebhookEntry[];
}
export interface WebhookEntry {
  id?: string;
  changes?: WebhookChange[];
}
export interface WebhookChange {
  field?: string;
  value?: WebhookValue;
}
export interface WebhookValue {
  messaging_product?: string;
  metadata?: { display_phone_number?: string; phone_number_id?: string };
  contacts?: { profile?: { name?: string }; wa_id?: string }[];
  messages?: WebhookMessage[];
  statuses?: unknown[];
}
export interface WebhookMessage {
  from?: string;
  id?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  image?: { caption?: string };
  video?: { caption?: string };
  document?: { caption?: string; filename?: string };
  button?: { text?: string; payload?: string };
  interactive?: {
    type?: string;
    button_reply?: { id?: string; title?: string };
    list_reply?: { id?: string; title?: string };
  };
}
