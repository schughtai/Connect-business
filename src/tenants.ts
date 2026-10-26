import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

export interface Tenant {
  id: string;
  name: string;
  whatsappPhoneNumberId: string;
  whatsappAccessToken: string;
  systemPrompt: string | null;
}

export interface NewTenant {
  name: string;
  whatsappPhoneNumberId: string;
  whatsappAccessToken: string;
  systemPrompt?: string | null;
}

interface TenantRow {
  id: string;
  name: string;
  whatsapp_phone_number_id: string;
  whatsapp_access_token: string;
  system_prompt: string | null;
}

function toTenant(row: TenantRow): Tenant {
  return {
    id: row.id,
    name: row.name,
    whatsappPhoneNumberId: row.whatsapp_phone_number_id,
    whatsappAccessToken: row.whatsapp_access_token,
    systemPrompt: row.system_prompt,
  };
}

export class TenantRepository {
  constructor(private readonly db: DatabaseSync) {}

  create(input: NewTenant): Tenant {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO tenants (id, name, whatsapp_phone_number_id, whatsapp_access_token, system_prompt)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.name,
        input.whatsappPhoneNumberId,
        input.whatsappAccessToken,
        input.systemPrompt ?? null,
      );
    return this.getById(id)!;
  }

  getById(id: string): Tenant | undefined {
    const row = this.db.prepare('SELECT * FROM tenants WHERE id = ?').get(id) as TenantRow | undefined;
    return row && toTenant(row);
  }

  findByPhoneNumberId(phoneNumberId: string): Tenant | undefined {
    const row = this.db
      .prepare('SELECT * FROM tenants WHERE whatsapp_phone_number_id = ?')
      .get(phoneNumberId) as TenantRow | undefined;
    return row && toTenant(row);
  }

  list(): Tenant[] {
    const rows = this.db.prepare('SELECT * FROM tenants ORDER BY name').all() as unknown as TenantRow[];
    return rows.map(toTenant);
  }
}
