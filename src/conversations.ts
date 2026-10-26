import type { DatabaseSync } from 'node:sqlite';

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

// Stores each customer's WhatsApp conversation, scoped to the tenant they wrote to.
export class ConversationRepository {
  constructor(private readonly db: DatabaseSync) {}

  // Returns false when this WhatsApp message was already recorded (webhook retry).
  recordInbound(
    tenantId: string,
    customerWaId: string,
    waMessageId: string,
    content: string,
  ): boolean {
    const result = this.db
      .prepare(
        `INSERT INTO messages (tenant_id, customer_wa_id, role, content, wa_message_id)
         VALUES (?, ?, 'user', ?, ?)
         ON CONFLICT (wa_message_id) DO NOTHING`,
      )
      .run(tenantId, customerWaId, content, waMessageId);
    return result.changes === 1;
  }

  recordReply(tenantId: string, customerWaId: string, content: string): void {
    this.db
      .prepare(
        `INSERT INTO messages (tenant_id, customer_wa_id, role, content) VALUES (?, ?, 'assistant', ?)`,
      )
      .run(tenantId, customerWaId, content);
  }

  // Most recent turns in chronological order, with consecutive same-role turns
  // merged so the history can be sent to the model as-is.
  recentTurns(tenantId: string, customerWaId: string, limit: number): ChatTurn[] {
    const rows = this.db
      .prepare(
        `SELECT role, content FROM messages
          WHERE tenant_id = ? AND customer_wa_id = ?
          ORDER BY id DESC LIMIT ?`,
      )
      .all(tenantId, customerWaId, limit) as unknown as ChatTurn[];

    const turns: ChatTurn[] = [];
    for (const row of rows.reverse()) {
      const last = turns.at(-1);
      if (last && last.role === row.role) {
        last.content += `\n\n${row.content}`;
      } else {
        turns.push({ role: row.role, content: row.content });
      }
    }
    // The model requires the conversation to open with a user turn.
    while (turns[0]?.role === 'assistant') {
      turns.shift();
    }
    return turns;
  }
}
