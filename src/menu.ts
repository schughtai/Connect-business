import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

export interface MenuItem {
  id: string;
  tenantId: string;
  name: string;
  category: string;
  description: string;
  priceCents: number;
  currency: string;
  available: boolean;
}

export interface NewMenuItem {
  name: string;
  category: string;
  description?: string;
  priceCents: number;
  currency?: string;
}

export interface MenuItemPatch {
  name?: string;
  category?: string;
  description?: string;
  priceCents?: number;
  available?: boolean;
}

export interface SearchOptions {
  query: string;
  category?: string;
  limit?: number;
}

interface MenuItemRow {
  id: string;
  tenant_id: string;
  name: string;
  category: string;
  description: string;
  price_cents: number;
  currency: string;
  available: number;
}

function toMenuItem(row: MenuItemRow): MenuItem {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    category: row.category,
    description: row.description,
    priceCents: row.price_cents,
    currency: row.currency,
    available: row.available === 1,
  };
}

// Escapes LIKE wildcards so customer input is matched literally.
function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

export class MenuRepository {
  constructor(private readonly db: DatabaseSync) {}

  add(tenantId: string, item: NewMenuItem): MenuItem {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO menu_items (id, tenant_id, name, category, description, price_cents, currency)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        tenantId,
        item.name,
        item.category,
        item.description ?? '',
        item.priceCents,
        (item.currency ?? 'USD').toUpperCase(),
      );
    return this.getById(tenantId, id)!;
  }

  getById(tenantId: string, itemId: string): MenuItem | undefined {
    const row = this.db
      .prepare('SELECT * FROM menu_items WHERE id = ? AND tenant_id = ?')
      .get(itemId, tenantId) as MenuItemRow | undefined;
    return row && toMenuItem(row);
  }

  update(tenantId: string, itemId: string, patch: MenuItemPatch): MenuItem | undefined {
    const existing = this.getById(tenantId, itemId);
    if (!existing) {
      return undefined;
    }
    const next = { ...existing, ...patch };
    this.db
      .prepare(
        `UPDATE menu_items
            SET name = ?, category = ?, description = ?, price_cents = ?, available = ?
          WHERE id = ? AND tenant_id = ?`,
      )
      .run(
        next.name,
        next.category,
        next.description,
        next.priceCents,
        next.available ? 1 : 0,
        itemId,
        tenantId,
      );
    return this.getById(tenantId, itemId);
  }

  list(tenantId: string, category?: string): MenuItem[] {
    const rows = category
      ? this.db
          .prepare(
            `SELECT * FROM menu_items WHERE tenant_id = ? AND lower(category) = lower(?)
             ORDER BY category, name`,
          )
          .all(tenantId, category)
      : this.db
          .prepare('SELECT * FROM menu_items WHERE tenant_id = ? ORDER BY category, name')
          .all(tenantId);
    return (rows as unknown as MenuItemRow[]).map(toMenuItem);
  }

  // Matches available items whose name, description or category contains any
  // word of the query. An empty query returns the available menu.
  search(tenantId: string, options: SearchOptions): MenuItem[] {
    const terms = options.query
      .toLowerCase()
      .split(/\s+/)
      .filter((term) => term.length > 0);
    const limit = options.limit ?? 20;

    const params: (string | number)[] = [tenantId];
    let sql = 'SELECT * FROM menu_items WHERE tenant_id = ? AND available = 1';

    if (terms.length > 0) {
      const clauses = terms.map(
        () =>
          `(lower(name) LIKE ? ESCAPE '\\' OR lower(description) LIKE ? ESCAPE '\\' OR lower(category) LIKE ? ESCAPE '\\')`,
      );
      sql += ` AND (${clauses.join(' OR ')})`;
      for (const term of terms) {
        const pattern = likePattern(term);
        params.push(pattern, pattern, pattern);
      }
    }

    if (options.category) {
      sql += ' AND lower(category) = lower(?)';
      params.push(options.category);
    }

    sql += ' ORDER BY category, name LIMIT ?';
    params.push(limit);

    const rows = this.db.prepare(sql).all(...params);
    return (rows as unknown as MenuItemRow[]).map(toMenuItem);
  }

  categories(tenantId: string): string[] {
    const rows = this.db
      .prepare(
        'SELECT DISTINCT category FROM menu_items WHERE tenant_id = ? AND available = 1 ORDER BY category',
      )
      .all(tenantId) as unknown as { category: string }[];
    return rows.map((row) => row.category);
  }
}

export function formatPrice(priceCents: number, currency: string): string {
  return `${(priceCents / 100).toFixed(2)} ${currency}`;
}
