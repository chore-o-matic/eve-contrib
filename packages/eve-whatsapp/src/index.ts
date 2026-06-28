// @chore-o-matic/eve-whatsapp — WhatsApp Cloud API channel for eve agents.
//
// Usage in a host agent (agent/channels/whatsapp.ts):
//
//   import { whatsappChannel } from "@chore-o-matic/eve-whatsapp";
//   export default whatsappChannel(); // reads WHATSAPP_* from the environment
//
// The file stem (`whatsapp`) becomes the channel id and mount path
// (/eve/v1/whatsapp), which is also the Meta webhook callback URL.

export { whatsappChannel } from "./channel.js";
export {
  defaultDispatch,
  parseContinuationToken,
  parseInboundMessages,
  toE164,
  whatsappContinuationToken,
  WHATSAPP_AUTHENTICATOR,
} from "./inbound.js";
export {
  extractContacts,
  hasVCard,
  parseVCard,
  splitText,
  WhatsAppClient,
  type WhatsAppContact,
  type WhatsAppSendResponse,
} from "./outbound.js";
export { handleSubscription, verifySignature } from "./verify.js";
export type {
  InboundDispatch,
  InboundMessage,
  ResolvedCredentials,
  SendAuth,
  WhatsAppChannelConfig,
  WhatsAppCredentials,
} from "./types.js";
