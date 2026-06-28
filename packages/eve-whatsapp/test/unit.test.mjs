// Unit tests for the pure pieces: signature verification, envelope parsing,
// token round-tripping, text splitting, and vCard -> contact conversion.
// Run against the built dist/ output: `npm run build && npm test`.

import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";

import {
  extractContacts,
  parseContinuationToken,
  parseInboundMessages,
  parseVCard,
  splitText,
  toE164,
  verifySignature,
  whatsappContinuationToken,
} from "../dist/index.js";

const APP_SECRET = "test-secret";
const sign = (raw) => "sha256=" + createHmac("sha256", APP_SECRET).update(raw, "utf8").digest("hex");

test("verifySignature accepts a correct signature and rejects tampering", () => {
  const raw = JSON.stringify({ hello: "world" });
  assert.equal(verifySignature(raw, sign(raw), APP_SECRET), true);
  assert.equal(verifySignature(raw + "x", sign(raw), APP_SECRET), false);
  assert.equal(verifySignature(raw, "sha256=deadbeef", APP_SECRET), false);
  assert.equal(verifySignature(raw, sign(raw), undefined), false);
  assert.equal(verifySignature(raw, null, APP_SECRET), false);
});

test("toE164 adds a leading + only when missing", () => {
  assert.equal(toE164("573001112233"), "+573001112233");
  assert.equal(toE164("+573001112233"), "+573001112233");
});

test("continuation token round-trips and tolerates a namespace prefix", () => {
  const token = whatsappContinuationToken("123456789", "+573001112233");
  assert.deepEqual(parseContinuationToken(token), {
    phoneNumberId: "123456789",
    to: "+573001112233",
  });
  assert.deepEqual(parseContinuationToken(`whatsapp:${token}`), {
    phoneNumberId: "123456789",
    to: "+573001112233",
  });
  assert.equal(parseContinuationToken("nope"), null);
});

test("parseInboundMessages extracts a text message with normalized phone", () => {
  const body = {
    object: "whatsapp_business_account",
    entry: [
      {
        changes: [
          {
            field: "messages",
            value: {
              metadata: { phone_number_id: "PNID" },
              contacts: [{ wa_id: "573001112233", profile: { name: "Santi" } }],
              messages: [{ from: "573001112233", id: "wamid.1", type: "text", text: { body: "hola" } }],
            },
          },
        ],
      },
    ],
  };
  const msgs = parseInboundMessages(body);
  assert.equal(msgs.length, 1);
  assert.equal(msgs[0].from, "+573001112233");
  assert.equal(msgs[0].phoneNumberId, "PNID");
  assert.equal(msgs[0].text, "hola");
  assert.equal(msgs[0].profileName, "Santi");
});

test("parseInboundMessages ignores status callbacks and bad shapes", () => {
  assert.deepEqual(parseInboundMessages({ entry: [{ changes: [{ value: { statuses: [{}] } }] }] }), []);
  assert.deepEqual(parseInboundMessages({}), []);
  assert.deepEqual(parseInboundMessages(null), []);
});

test("splitText keeps short text whole and breaks long text under the limit", () => {
  assert.deepEqual(splitText("short"), ["short"]);
  const long = "a".repeat(5000);
  const chunks = splitText(long);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((c) => c.length <= 4096));
  assert.equal(chunks.join(""), long);
});

test("parseVCard and extractContacts promote a vCard block to a native contact", () => {
  const vcard = ["BEGIN:VCARD", "VERSION:3.0", "FN:Pedro Gardener", "TEL;TYPE=CELL:+573009998877", "END:VCARD"].join(
    "\n",
  );
  const contact = parseVCard(vcard);
  assert.equal(contact.name.formatted_name, "Pedro Gardener");
  assert.equal(contact.name.first_name, "Pedro");
  assert.deepEqual(contact.phones, [{ phone: "+573009998877", type: "CELL" }]);

  const reply = `Aquí tienes el contacto:\n${vcard}\n¡Saludos!`;
  const parts = extractContacts(reply);
  assert.equal(parts.before, "Aquí tienes el contacto:");
  assert.equal(parts.after, "¡Saludos!");
  assert.equal(parts.contacts.length, 1);
  assert.equal(extractContacts("no card here"), null);
});
