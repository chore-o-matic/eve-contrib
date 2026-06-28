# @chore-o-matic/eve-whatsapp

A reusable [eve](https://eve.dev) channel that connects an agent to **WhatsApp** via
**Meta's WhatsApp Cloud API** (Facebook Graph API). It receives webhooks, starts/resumes an
eve session per sender, and delivers replies — text and native, tappable contact cards —
back over the Graph API.

It mirrors how eve ships its own channels (`telegramChannel`, `twilioChannel`): a one-line
factory you re-export from `agent/channels/<name>.ts`.

## Install

```bash
npm install @chore-o-matic/eve-whatsapp
```

`eve` is a **peer dependency** (`^0.16`) — the channel binds to your app's eve instance, so
there is exactly one copy of eve. No other runtime dependencies.

## Use

```ts
// agent/channels/whatsapp.ts
import { whatsappChannel } from "@chore-o-matic/eve-whatsapp";

export default whatsappChannel(); // reads WHATSAPP_* from the environment
```

The file stem (`whatsapp.ts`) becomes the **channel id**. The webhook mounts at
**`/eve/v1/whatsapp`** by default — that URL is both your route and the Meta webhook callback
URL. Override it with the `route` option if you need a different path.

### Configuration

Every credential falls back to an environment variable, so `whatsappChannel()` with no args
is the common case. Override via `credentials`, or change behavior with the other options:

```ts
whatsappChannel({
  credentials: { phoneNumberId: "...", accessToken: "..." }, // else from env
  route: "/eve/v1/whatsapp", // default; the GET+POST mount and Meta callback URL
  handoffFormat: "contacts", // "contacts" (default) | "vcard"
  onMessage: (msg) => ({ message: msg.text, auth: {/* ... */}, continuationToken: "..." }),
});
```

| Env var                    | Purpose                                                       |
| -------------------------- | ------------------------------------------------------------ |
| `WHATSAPP_ACCESS_TOKEN`    | Permanent system-user token (outbound sends)                 |
| `WHATSAPP_PHONE_NUMBER_ID` | Business phone number id (outbound endpoint)                  |
| `WHATSAPP_APP_SECRET`      | Meta app secret — verifies `X-Hub-Signature-256` on inbound  |
| `WHATSAPP_VERIFY_TOKEN`    | String you choose for the webhook subscription handshake     |
| `WHATSAPP_API_VERSION`     | Graph API version (optional; defaults to `v21.0`)            |

- **`handoffFormat: "contacts"`** (default) promotes a `BEGIN:VCARD…END:VCARD` block in the
  agent's reply into a native, tappable WhatsApp contact card; surrounding text is sent
  separately. `"vcard"` leaves the card inline as text. No agent changes needed either way.
- **`onMessage`** overrides inbound dispatch (auth, continuation token, filtering). The
  default uses the verified sender phone as the principal id and one session per
  sender↔business-number pair.

## How it works

- **`GET /`** — Meta's webhook subscription handshake; echoes `hub.challenge` when
  `hub.verify_token` matches `WHATSAPP_VERIFY_TOKEN`.
- **`POST /`** — verifies `X-Hub-Signature-256` (HMAC-SHA256 of the raw body, constant-time)
  **before** parsing, extracts messages from the Cloud API envelope, and starts/resumes a
  session via `send()`. Returns `200` immediately; replies are delivered from the
  `message.completed` event so Meta's ~5s webhook budget isn't blocked.
- **Identity** is taken from the verified webhook (`from`), never message content. The phone
  is normalized to E.164 (`+`-prefixed) and exposed to your tools at
  `ctx.session.auth.initiator.principalId`.

## Meta setup (one-time)

1. Create a Meta app, add the **WhatsApp** product, and get a business phone number id and a
   permanent system-user access token.
2. Deploy your agent so `/eve/v1/whatsapp` is publicly reachable.
3. In the Meta App dashboard → **WhatsApp → Configuration**:
   - **Callback URL**: `https://<your-deployment>/eve/v1/whatsapp`
   - **Verify token**: the value of `WHATSAPP_VERIFY_TOKEN`
   - Subscribe to the **`messages`** field.

eve does not register the webhook for you (same as the built-in Telegram channel).

## Development

```bash
npm run build      # tsc -> dist/
npm test           # hermetic unit tests (test/, offline; runs against dist/)
npm run typecheck
```

The package ships compiled JS + `.d.ts` (eve's CLI compiles the host app, not
`node_modules`, so the library is pre-built).

### End-to-end test (opt-in, real API)

`npm run test:e2e` hits the **real** WhatsApp Cloud API with a token. It is kept out of
`npm test` so the default suite stays offline.

1. Copy `.env.example` to **`.env.local`** (gitignored) in this package directory and set
   at least `WHATSAPP_ACCESS_TOKEN` and `WHATSAPP_PHONE_NUMBER_ID`.
2. Run `npm run test:e2e`.

```bash
cp .env.example .env.local   # then fill in the token
npm run test:e2e
```

- **Auth check (always):** a read-only Graph call that proves the token + phone number id
  are valid. Sends nothing, charges nothing.
- **Real send (opt-in):** set `WHATSAPP_E2E_RECIPIENT` to an E.164 number to actually send a
  message via the shipped `WhatsAppClient.sendText`. The recipient must be within the
  24-hour customer-service window or Meta returns a re-engagement error.

Without credentials the suite skips with a note pointing at `.env.local`.
