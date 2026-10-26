import Anthropic from '@anthropic-ai/sdk';
import { createApp } from './app.js';
import { ChatService } from './chat.js';
import { loadConfig } from './config.js';
import { ConversationRepository } from './conversations.js';
import { openDatabase } from './db.js';
import { MenuRepository } from './menu.js';
import { TenantRepository } from './tenants.js';
import { createWhatsAppSender } from './whatsapp.js';

const config = loadConfig();
const db = openDatabase(config.databasePath);

const tenants = new TenantRepository(db);
const menu = new MenuRepository(db);
const conversations = new ConversationRepository(db);

const chat = new ChatService({
  conversations,
  menu,
  llm: new Anthropic({ apiKey: config.anthropic.apiKey }),
  sender: createWhatsAppSender({ graphVersion: config.whatsapp.graphVersion }),
  model: config.anthropic.model,
});

const app = createApp({
  tenants,
  menu,
  chat,
  adminApiKey: config.adminApiKey,
  whatsapp: {
    verifyToken: config.whatsapp.verifyToken,
    appSecret: config.whatsapp.appSecret,
  },
});

app.listen(config.port, () => {
  console.log(`Listening on port ${config.port}`);
});
