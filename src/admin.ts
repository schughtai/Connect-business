import { timingSafeEqual } from 'node:crypto';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import type { MenuRepository } from './menu.js';
import type { Tenant, TenantRepository } from './tenants.js';

export interface AdminDeps {
  tenants: TenantRepository;
  menu: MenuRepository;
  adminApiKey: string;
}

const tenantInput = z.object({
  name: z.string().min(1),
  whatsappPhoneNumberId: z.string().min(1),
  whatsappAccessToken: z.string().min(1),
  systemPrompt: z.string().max(4000).nullish(),
});

const menuItemInput = z.object({
  name: z.string().min(1),
  category: z.string().min(1),
  description: z.string().max(1000).optional(),
  priceCents: z.number().int().nonnegative(),
  currency: z.string().length(3).optional(),
});

const menuItemPatch = z.object({
  name: z.string().min(1).optional(),
  category: z.string().min(1).optional(),
  description: z.string().max(1000).optional(),
  priceCents: z.number().int().nonnegative().optional(),
  available: z.boolean().optional(),
});

// Access tokens are never returned by the API.
function publicTenant(tenant: Tenant) {
  return {
    id: tenant.id,
    name: tenant.name,
    whatsappPhoneNumberId: tenant.whatsappPhoneNumberId,
    systemPrompt: tenant.systemPrompt,
  };
}

function isAuthorized(header: string | undefined, adminApiKey: string): boolean {
  const expected = Buffer.from(`Bearer ${adminApiKey}`);
  const received = Buffer.from(header ?? '');
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export function createAdminRouter(deps: AdminDeps): Router {
  const router = Router();

  router.use((req: Request, res: Response, next: NextFunction) => {
    if (!isAuthorized(req.get('authorization'), deps.adminApiKey)) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    next();
  });

  router.post('/tenants', (req, res) => {
    const parsed = tenantInput.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_request', issues: parsed.error.issues });
      return;
    }
    if (deps.tenants.findByPhoneNumberId(parsed.data.whatsappPhoneNumberId)) {
      res.status(409).json({ error: 'phone_number_already_registered' });
      return;
    }
    const tenant = deps.tenants.create({ ...parsed.data, systemPrompt: parsed.data.systemPrompt ?? null });
    res.status(201).json(publicTenant(tenant));
  });

  router.get('/tenants', (_req, res) => {
    res.json({ tenants: deps.tenants.list().map(publicTenant) });
  });

  // Accepts one item or an array of items for bulk catalog import.
  router.post('/tenants/:tenantId/menu-items', (req, res) => {
    if (!deps.tenants.getById(req.params.tenantId)) {
      res.status(404).json({ error: 'tenant_not_found' });
      return;
    }
    const body = Array.isArray(req.body) ? req.body : [req.body];
    const parsed = z.array(menuItemInput).min(1).max(500).safeParse(body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_request', issues: parsed.error.issues });
      return;
    }
    const items = parsed.data.map((item) => deps.menu.add(req.params.tenantId, item));
    res.status(201).json({ items: Array.isArray(req.body) ? items : items[0] });
  });

  router.get('/tenants/:tenantId/menu-items', (req, res) => {
    if (!deps.tenants.getById(req.params.tenantId)) {
      res.status(404).json({ error: 'tenant_not_found' });
      return;
    }
    const category = typeof req.query.category === 'string' ? req.query.category : undefined;
    res.json({ items: deps.menu.list(req.params.tenantId, category) });
  });

  router.patch('/tenants/:tenantId/menu-items/:itemId', (req, res) => {
    const parsed = menuItemPatch.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_request', issues: parsed.error.issues });
      return;
    }
    const item = deps.menu.update(req.params.tenantId, req.params.itemId, parsed.data);
    if (!item) {
      res.status(404).json({ error: 'menu_item_not_found' });
      return;
    }
    res.json(item);
  });

  return router;
}
