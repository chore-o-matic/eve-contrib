// Webhook trust: the GET subscription handshake and the X-Hub-Signature-256
// HMAC check. Nothing inbound is trusted until the signature verifies.

import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Meta's webhook subscription handshake. Meta sends a `GET` with `hub.mode`,
 * `hub.verify_token`, and `hub.challenge`; echo the challenge as plain text when
 * the mode is `subscribe` and the token matches. Returns the response to send,
 * or a 403 on mismatch.
 */
export function handleSubscription(url: URL, verifyToken: string | undefined): Response {
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (mode === "subscribe" && verifyToken && token === verifyToken && challenge !== null) {
    return new Response(challenge, {
      status: 200,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
  return new Response("Forbidden", { status: 403 });
}

/**
 * Verify the `X-Hub-Signature-256` header against the raw request body using the
 * Meta app secret. The header is `sha256=<hex>`; compare in constant time.
 * Returns `false` (reject) when the secret or header is missing.
 */
export function verifySignature(
  rawBody: string,
  signatureHeader: string | null,
  appSecret: string | undefined,
): boolean {
  if (!appSecret || !signatureHeader) return false;

  const expected = "sha256=" + createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");

  const a = Buffer.from(signatureHeader);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on length mismatch — guard first so a wrong-length
  // signature is a clean reject rather than an exception.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
