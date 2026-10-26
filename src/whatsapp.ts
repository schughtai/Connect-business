import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

export interface InboundMessage {
  phoneNumberId: string;
  from: string;
  waMessageId: string;
  type: string;
  text?: string;
}

export interface SenderCredentials {
  phoneNumberId: string;
  accessToken: string;
}

export interface WhatsAppSender {
  sendText(credentials: SenderCredentials, to: string, body: string): Promise<void>;
}

// WhatsApp caps a text message at 4096 characters.
const MAX_TEXT_LENGTH = 4000;

// Meta signs each webhook body with the app secret: X-Hub-Signature-256: sha256=<hex>.
export function verifySignature(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  appSecret: string,
): boolean {
  if (!signatureHeader?.startsWith('sha256=')) {
    return false;
  }
  const expected = createHmac('sha256', appSecret).update(rawBody).digest();
  const received = Buffer.from(signatureHeader.slice('sha256='.length), 'hex');
  return received.length === expected.length && timingSafeEqual(received, expected);
}

const webhookSchema = z.object({
  entry: z
    .array(
      z.object({
        changes: z
          .array(
            z.object({
              value: z.object({
                metadata: z.object({ phone_number_id: z.string() }),
                messages: z
                  .array(
                    z.object({
                      from: z.string(),
                      id: z.string(),
                      type: z.string(),
                      text: z.object({ body: z.string() }).optional(),
                    }),
                  )
                  .optional(),
              }),
            }),
          )
          .default([]),
      }),
    )
    .default([]),
});

// Flattens a webhook payload into inbound customer messages. Status callbacks
// (delivered, read, ...) carry no `messages` and are dropped here.
export function parseInboundMessages(payload: unknown): InboundMessage[] {
  const parsed = webhookSchema.safeParse(payload);
  if (!parsed.success) {
    return [];
  }

  const messages: InboundMessage[] = [];
  for (const entry of parsed.data.entry) {
    for (const change of entry.changes) {
      const { metadata, messages: incoming = [] } = change.value;
      for (const message of incoming) {
        messages.push({
          phoneNumberId: metadata.phone_number_id,
          from: message.from,
          waMessageId: message.id,
          type: message.type,
          text: message.text?.body,
        });
      }
    }
  }
  return messages;
}

export interface WhatsAppSenderOptions {
  graphVersion: string;
  fetchImpl?: typeof fetch;
}

export function createWhatsAppSender(options: WhatsAppSenderOptions): WhatsAppSender {
  const fetchImpl = options.fetchImpl ?? fetch;
  return {
    async sendText({ phoneNumberId, accessToken }, to, body) {
      const url = `https://graph.facebook.com/${options.graphVersion}/${phoneNumberId}/messages`;
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to,
          type: 'text',
          text: { body: body.slice(0, MAX_TEXT_LENGTH), preview_url: false },
        }),
      });
      if (!response.ok) {
        const detail = await response.text();
        throw new Error(`WhatsApp send failed with ${response.status}: ${detail}`);
      }
    },
  };
}
