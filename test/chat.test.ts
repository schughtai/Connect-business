import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ChatService } from '../src/chat.js';
import { ConversationRepository } from '../src/conversations.js';
import { openDatabase } from '../src/db.js';
import { MenuRepository } from '../src/menu.js';
import { TenantRepository } from '../src/tenants.js';
import { recordingSender, response, scriptedLlm, textBlock, toolUseBlock } from './helpers.js';

function setup(script: ReturnType<typeof response>[]) {
  const db = openDatabase(':memory:');
  const tenants = new TenantRepository(db);
  const menu = new MenuRepository(db);
  const conversations = new ConversationRepository(db);

  const luigis = tenants.create({
    name: "Luigi's",
    whatsappPhoneNumberId: '111',
    whatsappAccessToken: 'token-luigis',
  });
  const sushi = tenants.create({
    name: 'Sushi Bar',
    whatsappPhoneNumberId: '222',
    whatsappAccessToken: 'token-sushi',
  });
  menu.add(luigis.id, {
    name: 'Margherita Pizza',
    category: 'Pizza',
    description: 'Tomato, mozzarella, basil',
    priceCents: 1200,
  });
  menu.add(sushi.id, { name: 'Salmon Roll', category: 'Sushi', priceCents: 900 });

  const llm = scriptedLlm(script);
  const { sender, sent } = recordingSender();
  const chat = new ChatService({ conversations, menu, llm: llm.llm, sender, model: 'test-model' });
  return { chat, conversations, luigis, sushi, llm, sent };
}

const inbound = (overrides: Record<string, unknown> = {}) => ({
  phoneNumberId: '111',
  from: '15550001',
  waMessageId: 'wamid.1',
  type: 'text',
  text: 'Do you have pizza?',
  ...overrides,
});

describe('ChatService', () => {
  it('answers from the tenant menu via a tool call and replies with the tenant credentials', async () => {
    const { chat, luigis, llm, sent } = setup([
      response('tool_use', [toolUseBlock('tool_1', 'search_menu', { query: 'pizza' })]),
      response('end_turn', [textBlock('Yes! Margherita Pizza is 12.00 USD.')]),
    ]);

    const message = inbound();
    await chat.handleMessage(luigis, message as any);

    assert.equal(sent.length, 1);
    assert.equal(sent[0].body, 'Yes! Margherita Pizza is 12.00 USD.');
    assert.equal(sent[0].to, '15550001');
    assert.deepEqual(sent[0].credentials, { phoneNumberId: '111', accessToken: 'token-luigis' });

    const toolResult = llm.requests[1].messages.at(-1)!.content as any[];
    assert.match(toolResult[0].content, /Margherita Pizza/);
    assert.match(toolResult[0].content, /12\.00 USD/);
  });

  it('never returns another tenant\'s menu items', async () => {
    const { chat, luigis, llm } = setup([
      response('tool_use', [toolUseBlock('tool_1', 'search_menu', { query: 'salmon' })]),
      response('end_turn', [textBlock("Sorry, we don't have salmon.")]),
    ]);

    await chat.handleMessage(luigis, inbound({ text: 'salmon?' }) as any);

    const toolResult = llm.requests[1].messages.at(-1)!.content as any[];
    assert.equal(toolResult[0].content, JSON.stringify({ items: [] }));
  });

  it('ignores a retried webhook for a message it has already processed', async () => {
    const { chat, luigis, llm, sent } = setup([response('end_turn', [textBlock('Hi!')])]);

    await chat.handleMessage(luigis, inbound() as any);
    await chat.handleMessage(luigis, inbound() as any);

    assert.equal(llm.requests.length, 1);
    assert.equal(sent.length, 1);
  });

  it('replies with a notice for non-text messages without calling the model', async () => {
    const { chat, luigis, llm, sent } = setup([]);

    await chat.handleMessage(luigis, inbound({ type: 'audio', text: undefined }) as any);

    assert.equal(llm.requests.length, 0);
    assert.equal(sent.length, 1);
    assert.match(sent[0].body, /text messages/);
  });

  it('sends a fallback reply and keeps only the customer turn when the model fails', async () => {
    const { chat, luigis, conversations, sent } = setup([]);

    await chat.handleMessage(luigis, inbound({ text: 'hello' }) as any);

    assert.equal(sent.length, 1);
    assert.match(sent[0].body, /something went wrong/);
    assert.deepEqual(conversations.recentTurns(luigis.id, '15550001', 10), [
      { role: 'user', content: 'hello' },
    ]);
  });

  it('sends earlier turns of the same customer conversation back to the model', async () => {
    const { chat, luigis, llm } = setup([
      response('end_turn', [textBlock('We have pizza.')]),
      response('end_turn', [textBlock('It is 12.00 USD.')]),
    ]);

    await chat.handleMessage(luigis, inbound({ waMessageId: 'wamid.1', text: 'pizza?' }) as any);
    await chat.handleMessage(luigis, inbound({ waMessageId: 'wamid.2', text: 'price?' }) as any);

    const roles = llm.requests[1].messages.map((message) => message.role);
    assert.deepEqual(roles, ['user', 'assistant', 'user']);
  });
});
