// End-to-end test against the REAL WhatsApp Cloud API. Opt-in — it is NOT part
// of `npm test` (which stays hermetic/offline). It needs a real token, so it
// lives outside test/ and runs only via:
//
//   npm run test:e2e        (reads packages/eve-whatsapp/.env.local)
//
// Put your credentials in  packages/eve-whatsapp/.env.local  (see .env.example):
//
//   WHATSAPP_ACCESS_TOKEN=...        (required) permanent system-user token
//   WHATSAPP_PHONE_NUMBER_ID=...     (required) business phone number id
//   WHATSAPP_API_VERSION=v21.0       (optional) defaults to v21.0
//   WHATSAPP_E2E_RECIPIENT=...       (optional) E.164 number to actually message
//   WHATSAPP_E2E_TEMPLATE=hello_world      (optional) template name to send
//   WHATSAPP_E2E_TEMPLATE_LANG=en_US       (optional) template language
//   WHATSAPP_E2E_FREE_TEXT=1               (optional) ALSO send a free-text message
//
// IMPORTANT — why a passing test may not arrive on the phone:
//   * A 2xx from /messages means "accepted/queued", NOT "delivered". Final
//     delivery status only comes back on the async `statuses` webhook, which this
//     one-shot script cannot observe — so we log the accepted message id instead.
//   * Free-form TEXT only delivers inside the recipient's 24-hour window (i.e.
//     they messaged your business number recently). To reach a cold number you
//     must send an approved TEMPLATE — hence the default probe below uses
//     `hello_world`, which exists on every account.
//   * On Meta's free TEST number, the recipient must be added & verified in the
//     dashboard first.
//   * Number format matters. Argentina mobiles need the `9`: +54 9 11 …
//     (e.g. +5491157294589, not +541157294589). Mexico historically needed `1`.

import assert from "node:assert/strict";
import { test } from "node:test";

import { WhatsAppClient } from "../dist/index.js";

const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
const apiVersion = process.env.WHATSAPP_API_VERSION ?? "v21.0";
const recipient = process.env.WHATSAPP_E2E_RECIPIENT;
const templateName = process.env.WHATSAPP_E2E_TEMPLATE ?? "hello_world";
const templateLang = process.env.WHATSAPP_E2E_TEMPLATE_LANG ?? "en_US";
const alsoFreeText = process.env.WHATSAPP_E2E_FREE_TEXT === "1";

const missingCreds = !accessToken || !phoneNumberId;
const credsSkip = missingCreds
  ? "set WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID in packages/eve-whatsapp/.env.local"
  : false;

const messageId = (res) => res?.messages?.[0]?.id ?? "(none)";
const messageStatus = (res) => res?.messages?.[0]?.message_status ?? "accepted";

// Core check: prove the token + phone number id authenticate against the real
// Graph API. Read-only — sends no message, charges nothing.
test("Cloud API token + phone number id authenticate (read-only)", { skip: credsSkip }, async () => {
  const url = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}?fields=display_phone_number,verified_name,quality_rating`;
  const res = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` } });
  const body = await res.json().catch(() => ({}));

  assert.equal(res.ok, true, `Graph API returned ${res.status}: ${JSON.stringify(body)}`);
  assert.ok(body.display_phone_number, `expected display_phone_number; got ${JSON.stringify(body)}`);
  console.log(
    `  ✓ authenticated as "${body.verified_name ?? "?"}" (${body.display_phone_number}), quality=${body.quality_rating ?? "?"}`,
  );
});

// Delivery probe: send an approved TEMPLATE. This is what actually arrives on a
// cold recipient. Logs the accepted message id so you can correlate the eventual
// `statuses` webhook.
test("delivers a template message to the recipient", {
  skip: missingCreds ? "missing credentials" : !recipient ? "set WHATSAPP_E2E_RECIPIENT to send a message" : false,
}, async () => {
  const client = new WhatsAppClient(accessToken, apiVersion);
  const res = await client.sendTemplate(phoneNumberId, recipient, templateName, templateLang);
  const id = messageId(res);
  console.log(`  ✓ template "${templateName}" (${templateLang}) accepted for ${recipient}`);
  console.log(`    message id: ${id}  status: ${messageStatus(res)}`);
  console.log(`    NOTE: "accepted" != "delivered". If it does not arrive, check:`);
  console.log(`      - number format (e.g. Argentina needs +54 9 …)`);
  console.log(`      - recipient is on the test-number allowlist (if using a test number)`);
  console.log(`      - the template name/language exist and are approved`);
  assert.notEqual(id, "(none)", `no message id returned: ${JSON.stringify(res)}`);
});

// Optional: free-text send. Only delivers inside the 24-hour window; outside it,
// the API still returns a message id but the message is never delivered.
test("sends a free-text message (only delivers within the 24h window)", {
  skip: missingCreds
    ? "missing credentials"
    : !recipient
      ? "set WHATSAPP_E2E_RECIPIENT to send a message"
      : !alsoFreeText
        ? "set WHATSAPP_E2E_FREE_TEXT=1 to also send free text"
        : false,
}, async () => {
  const client = new WhatsAppClient(accessToken, apiVersion);
  const res = await client.sendText(phoneNumberId, recipient, "Tito e2e ✅ — automated test message, please ignore.");
  console.log(`  ✓ free text accepted for ${recipient} (message id: ${messageId(res)})`);
  console.log(`    reminder: this only ARRIVES if the recipient messaged you in the last 24h.`);
});
