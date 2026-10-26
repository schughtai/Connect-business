import express, { type Request, type Response } from 'express';
import { createAdminRouter, type AdminDeps } from './admin.js';
import type { ChatService } from './chat.js';
import type { TenantRepository } from './tenants.js';
import { parseInboundMessages, verifySignature } from './whatsapp.js';

export interface AppDeps extends AdminDeps {
  chat: ChatService;
  whatsapp: {
    verifyToken: string;
    appSecret: string;
  };
}

export function createApp(deps: AppDeps): express.Express {
  const app = express();

  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  // Meta's one-time subscription check: echo hub.challenge when the token matches.
  app.get('/webhooks/whatsapp', (req: Request, res: Response) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token === deps.whatsapp.verifyToken && typeof challenge === 'string') {
      res.status(200).type('text/plain').send(challenge);
      return;
    }
    res.sendStatus(403);
  });

  // The raw body is needed to verify Meta's signature before it is parsed.
  app.post(
    '/webhooks/whatsapp',
    express.raw({ type: '*/*', limit: '1mb' }),
    (req: Request, res: Response) => {
      const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      if (!verifySignature(rawBody, req.get('x-hub-signature-256'), deps.whatsapp.appSecret)) {
        res.sendStatus(401);
        return;
      }

      let payload: unknown;
      try {
        payload = JSON.parse(rawBody.toString('utf8'));
      } catch {
        res.sendStatus(400);
        return;
      }

      // Acknowledge first: Meta retries webhooks that are slow to return 200.
      res.sendStatus(200);
      void processInbound(deps.tenants, deps.chat, payload);
    },
  );

  app.use('/admin', express.json({ limit: '1mb' }), createAdminRouter(deps));

  return app;
}

async function processInbound(tenants: TenantRepository, chat: ChatService, payload: unknown) {
  for (const message of parseInboundMessages(payload)) {
    const tenant = tenants.findByPhoneNumberId(message.phoneNumberId);
    if (!tenant) {
      console.warn(`No tenant registered for WhatsApp number ${message.phoneNumberId}`);
      continue;
    }
    try {
      await chat.handleMessage(tenant, message);
    } catch (error) {
      console.error(`Failed to handle message ${message.waMessageId}:`, error);
    }
  }
}
