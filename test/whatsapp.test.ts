import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { describe, it } from 'node:test';
import { createWhatsAppSender, parseInboundMessages, verifySignature } from '../src/whatsapp.js';

const SECRET = 'app-secret';

const messagePayload = {
  object: 'whatsapp_business_account',
  entry: [
    {
      id: 'waba-1',
      changes: [
        {
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            metadata: { display_phone_number: '15551234567', phone_number_id: '111' },
            messages: [
              { from: '15550001', id: 'wamid.1', timestamp: '1', type: 'text', text: { body: 'hi' } },
            ],
          },
        },
      ],
    },
  ],
};

describe('verifySignature', () => {
  it('accepts a body signed with the app secret', () => {
    const body = Buffer.from(JSON.stringify(messagePayload));
    const header = `sha256=${createHmac('sha256', SECRET).update(body).digest('hex')}`;
    assert.equal(verifySignature(body, header, SECRET), true);
  });

  it('rejects a tampered body, a wrong secret, or a missing header', () => {
    const body = Buffer.from(JSON.stringify(messagePayload));
    const header = `sha256=${createHmac('sha256', SECRET).update(body).digest('hex')}`;
    assert.equal(verifySignature(Buffer.from('{}'), header, SECRET), false);
    assert.equal(verifySignature(body, header, 'other-secret'), false);
    assert.equal(verifySignature(body, undefined, SECRET), false);
  });
});

describe('parseInboundMessages', () => {
  it('extracts customer messages with the receiving phone number id', () => {
    assert.deepEqual(parseInboundMessages(messagePayload), [
      { phoneNumberId: '111', from: '15550001', waMessageId: 'wamid.1', type: 'text', text: 'hi' },
    ]);
  });

  it('ignores delivery status callbacks', () => {
    const statusPayload = {
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: '111' },
                statuses: [{ id: 'wamid.9', status: 'delivered' }],
              },
            },
          ],
        },
      ],
    };
    assert.deepEqual(parseInboundMessages(statusPayload), []);
  });
});

describe('createWhatsAppSender', () => {
  it('posts a text message through the Cloud API with the tenant token', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response('{}', { status: 200 });
    }) as typeof fetch;

    const sender = createWhatsAppSender({ graphVersion: 'v21.0', fetchImpl });
    await sender.sendText({ phoneNumberId: '111', accessToken: 'token-x' }, '15550001', 'Hello');

    assert.equal(calls[0].url, 'https://graph.facebook.com/v21.0/111/messages');
    assert.equal((calls[0].init.headers as Record<string, string>).Authorization, 'Bearer token-x');
    const body = JSON.parse(calls[0].init.body as string);
    assert.equal(body.messaging_product, 'whatsapp');
    assert.equal(body.to, '15550001');
    assert.equal(body.text.body, 'Hello');
  });

  it('throws when the Cloud API rejects the message', async () => {
    const fetchImpl = (async () => new Response('bad token', { status: 401 })) as typeof fetch;
    const sender = createWhatsAppSender({ graphVersion: 'v21.0', fetchImpl });
    await assert.rejects(
      sender.sendText({ phoneNumberId: '111', accessToken: 'bad' }, '15550001', 'Hello'),
      /WhatsApp send failed with 401/,
    );
  });
});
