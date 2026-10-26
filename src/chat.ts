import { generateReply, type LlmClient } from './assistant.js';
import { CATALOG_TOOLS, createCatalogToolExecutor } from './catalog-tools.js';
import type { ConversationRepository } from './conversations.js';
import type { MenuRepository } from './menu.js';
import type { InboundMessage, WhatsAppSender } from './whatsapp.js';
import type { Tenant } from './tenants.js';

const HISTORY_TURNS = 20;
const UNSUPPORTED_REPLY = 'Sorry, I can only read text messages right now. Please type your question.';
const ERROR_REPLY = 'Sorry, something went wrong on our side. Please try again in a moment.';

export interface ChatServiceDeps {
  conversations: ConversationRepository;
  menu: MenuRepository;
  llm: LlmClient;
  sender: WhatsAppSender;
  model: string;
}

export class ChatService {
  constructor(private readonly deps: ChatServiceDeps) {}

  async handleMessage(tenant: Tenant, message: InboundMessage): Promise<void> {
    const { conversations, menu, llm, sender, model } = this.deps;
    const credentials = {
      phoneNumberId: tenant.whatsappPhoneNumberId,
      accessToken: tenant.whatsappAccessToken,
    };

    if (message.type !== 'text' || message.text === undefined) {
      await sender.sendText(credentials, message.from, UNSUPPORTED_REPLY);
      return;
    }

    const isNew = conversations.recordInbound(
      tenant.id,
      message.from,
      message.waMessageId,
      message.text,
    );
    if (!isNew) {
      return;
    }

    const history = conversations.recentTurns(tenant.id, message.from, HISTORY_TURNS);
    let reply: string;
    try {
      reply = await generateReply(llm, {
        model,
        system: buildSystemPrompt(tenant),
        history,
        tools: CATALOG_TOOLS,
        executeTool: createCatalogToolExecutor(menu, tenant.id),
      });
      conversations.recordReply(tenant.id, message.from, reply);
    } catch (error) {
      console.error(`LLM reply failed for tenant ${tenant.id}:`, error);
      reply = ERROR_REPLY;
    }

    await sender.sendText(credentials, message.from, reply);
  }
}

function buildSystemPrompt(tenant: Tenant): string {
  return [
    `You are the WhatsApp assistant for ${tenant.name}.`,
    'Help customers find items on the menu and answer their questions about them.',
    'Always look up items and prices with the tools. Never invent items, prices or availability.',
    'If nothing matches, say so and suggest the closest options from the menu.',
    'Keep replies short and conversational, in plain text with no markdown, suitable for WhatsApp.',
    tenant.systemPrompt ?? '',
  ]
    .filter((line) => line.length > 0)
    .join('\n');
}
