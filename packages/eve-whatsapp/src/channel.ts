// whatsappChannel(): the eve Channel factory. Mirrors how eve ships its own
// channels (telegramChannel, twilioChannel) — a thin factory over defineChannel
// the host agent re-exports from agent/channels/<name>.ts. The file stem there
// decides the channel id and mount path (whatsapp -> /eve/v1/whatsapp), so this
// factory hardcodes nothing about where it is mounted.

import { defineChannel, GET, POST, type Channel } from "eve/channels";

import { defaultDispatch, parseContinuationToken, parseInboundMessages } from "./inbound.js";
import { extractContacts, hasVCard, makeClient } from "./outbound.js";
import type { ResolvedCredentials, WhatsAppChannelConfig } from "./types.js";
import { handleSubscription, verifySignature } from "./verify.js";

const env = (key: string): string | undefined => {
  const v = process.env[key];
  return v && v.length > 0 ? v : undefined;
};

/** Apply env fallback to the configured credentials. */
function resolveCredentials(config: WhatsAppChannelConfig): ResolvedCredentials {
  const c = config.credentials ?? {};
  return {
    accessToken: c.accessToken ?? env("WHATSAPP_ACCESS_TOKEN"),
    phoneNumberId: c.phoneNumberId ?? env("WHATSAPP_PHONE_NUMBER_ID"),
    appSecret: c.appSecret ?? env("WHATSAPP_APP_SECRET"),
    verifyToken: c.verifyToken ?? env("WHATSAPP_VERIFY_TOKEN"),
    apiVersion: c.apiVersion ?? env("WHATSAPP_API_VERSION") ?? "v21.0",
  };
}

/**
 * WhatsApp Cloud API channel. Receives Meta webhooks, starts/resumes an eve
 * session per sender, and delivers the agent's replies back over the Graph API.
 *
 * Credentials default to the `WHATSAPP_*` environment variables; pass
 * `credentials` to override. See the package README for the Meta webhook
 * registration runbook.
 */
export function whatsappChannel(config: WhatsAppChannelConfig = {}): Channel {
  const creds = resolveCredentials(config);
  const dispatch = config.onMessage ?? defaultDispatch;
  const handoffFormat = config.handoffFormat ?? "contacts";
  // eve does not auto-prefix custom channel routes (built-ins like telegram
  // declare the full path too), so mount the literal callback URL here.
  const route = config.route ?? "/eve/v1/whatsapp";

  return defineChannel({
    kindHint: "whatsapp",
    routes: [
      // Meta webhook subscription handshake.
      GET(route, async (req) => handleSubscription(new URL(req.url), creds.verifyToken)),

      // Inbound messages. Verify the signature over the raw body before parsing.
      POST(route, async (req, { send, waitUntil }) => {
        const raw = await req.text();
        if (!verifySignature(raw, req.headers.get("x-hub-signature-256"), creds.appSecret)) {
          return new Response("Invalid signature", { status: 403 });
        }

        let body: unknown;
        try {
          body = JSON.parse(raw);
        } catch {
          return new Response("Bad Request", { status: 400 });
        }

        // Start/resume a session per inbound message. Do it in the background so
        // Meta gets a fast 200 and stops retrying (its webhook budget is ~5s).
        for (const msg of parseInboundMessages(body)) {
          const opts = dispatch(msg);
          if (!opts) continue;
          waitUntil(
            send(opts.message, { auth: opts.auth, continuationToken: opts.continuationToken }).catch(
              (err: unknown) => console.error("[whatsapp] send failed", err),
            ),
          );
        }
        return new Response("OK", { status: 200 });
      }),
    ],

    events: {
      // Deliver each completed assistant message back to the sender.
      "message.completed": async (data, channel) => {
        const text = data.message;
        if (!text) return;

        const target = parseContinuationToken(channel.continuationToken);
        if (!target) {
          console.error("[whatsapp] could not derive recipient from continuation token");
          return;
        }

        const client = makeClient(creds);
        if (!client) {
          console.error("[whatsapp] WHATSAPP_ACCESS_TOKEN missing; cannot deliver reply");
          return;
        }
        const { phoneNumberId, to } = target;

        try {
          // Promote an inline vCard to a native, tappable contact card.
          if (handoffFormat === "contacts" && hasVCard(text)) {
            const parts = extractContacts(text);
            if (parts) {
              if (parts.before) await client.sendText(phoneNumberId, to, parts.before);
              await client.sendContacts(phoneNumberId, to, parts.contacts);
              if (parts.after) await client.sendText(phoneNumberId, to, parts.after);
              return;
            }
          }
          await client.sendText(phoneNumberId, to, text);
        } catch (err) {
          console.error("[whatsapp] delivery failed", err);
        }
      },
    },
  });
}
