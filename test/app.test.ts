import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import type { Server } from 'node:http';
import { createApp } from '../src/app.js';
import { ChatService } from '../src/chat.js';
import { ConversationRepository } from '../src/conversations.js';
import { openDatabase } from '../src/db.js';
import { MenuRepository } from '../src/menu.js';
import { TenantRepository } from '../src/tenants.js';
import { recordingSender, response, scriptedLlm, textBlock } from './helpers.js';

const APP_SECRET = 'app-secret';
const VERIFY_TOKEN = 'verify-me';
const ADMIN_KEY = 'admin-key';

describe('HTTP app', () => {
  let server: Server;
  let baseUrl: string;
  let sent: ReturnType<typeof recordingSender>['sent'];
  let tenants: TenantRepository;

  before(async () => {
    const db = openDatabase(':memory:');
    tenants = new TenantRepository(db);
    const menu = new MenuRepository(db);
    const recorder = recordingSender();
    sent = recorder.sent;
    const chat = new ChatService({
      conversations: new ConversationRepository(db),
      menu,
      llm: scriptedLlm([response('end_turn', [textBlock('Hello from the bot')])]).llm,
      sender: recorder.sender,
      model: 'test-model',
    });
    const app = createApp({
      tenants,
      menu,
      chat,
      adminApiKey: ADMIN_KEY,
      whatsapp: { verifyToken: VERIFY_TOKEN, appSecret: APP_SECRET },
    });
    server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it('echoes the challenge when the verify token matches', async () => {
    const url = `${baseUrl}/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=123`;
    const response = await fetch(url);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), '123');

    const wrong = await fetch(url.replace(VERIFY_TOKEN, 'nope'));
    assert.equal(wrong.status, 403);
  });

  it('rejects webhook posts without a valid signature', async () => {
    const response = await fetch(`${baseUrl}/webhooks/whatsapp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=00' },
      body: '{"entry":[]}',
    });
    assert.equal(response.status, 401);
  });

  it('acknowledges a signed webhook and replies to the matching tenant', async () => {
    const tenant = tenants.create({
      name: 'Webhook Cafe',
      whatsappPhoneNumberId: '555',
      whatsappAccessToken: 'token-cafe',
    });
    const body = JSON.stringify({
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: '555' },
                messages: [{ from: '15550009', id: 'wamid.77', type: 'text', text: { body: 'hi' } }],
              },
            },
          ],
        },
      ],
    });
    const signature = createHmac('sha256', APP_SECRET).update(body).digest('hex');

    const response = await fetch(`${baseUrl}/webhooks/whatsapp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': `sha256=${signature}` },
      body,
    });
    assert.equal(response.status, 200);

    for (let attempt = 0; attempt < 50 && sent.length === 0; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(sent.length, 1);
    assert.equal(sent[0].credentials.accessToken, tenant.whatsappAccessToken);
    assert.equal(sent[0].to, '15550009');
  });

  it('requires the admin key and never returns access tokens', async () => {
    const unauthorized = await fetch(`${baseUrl}/admin/tenants`);
    assert.equal(unauthorized.status, 401);

    const headers = { authorization: `Bearer ${ADMIN_KEY}`, 'content-type': 'application/json' };
    const created = await fetch(`${baseUrl}/admin/tenants`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'New Place', whatsappPhoneNumberId: '777', whatsappAccessToken: 'secret' }),
    });
    assert.equal(created.status, 201);
    const tenant = await created.json();
    assert.equal(tenant.whatsappAccessToken, undefined);

    const duplicate = await fetch(`${baseUrl}/admin/tenants`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Dup', whatsappPhoneNumberId: '777', whatsappAccessToken: 'x' }),
    });
    assert.equal(duplicate.status, 409);
  });
});
