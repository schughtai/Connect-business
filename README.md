# Connect Business: WhatsApp LLM chatbot (MVP)

A multi-tenant backend. Customers message a business's WhatsApp number. Meta's WhatsApp
Cloud API forwards each message to this server, which asks Claude to answer. Claude looks
up items in that business's menu catalog with tools, then the reply goes back over WhatsApp.

```
Customer ──WhatsApp──▶ Meta Cloud API ──webhook──▶ /webhooks/whatsapp
                                                     │ route by phone_number_id → tenant
                                                     ▼
                                              ChatService (per-tenant history, dedupe)
                                                     │
                                       Claude + tools: search_menu, list_categories
                                                     │ tenant id fixed server-side
                                                     ▼
Customer ◀──WhatsApp──── Cloud API /messages ◀── reply
```

## How multi-tenancy works

- Each tenant is one business with its own WhatsApp number (`whatsapp_phone_number_id`),
  its own Cloud API access token, optional persona text, and its own menu.
- All numbers point at one webhook URL. Meta includes the receiving `phone_number_id` in
  every event, which selects the tenant.
- Every database query is scoped by `tenant_id`. The tenant used for a tool call comes
  from the server's conversation context, never from the model's output.
- Customer conversation history is keyed by `(tenant, customer WhatsApp id)`.

## Run it locally

Requires Node.js 22.13 or newer (uses the built-in `node:sqlite`).

```bash
npm install
cp .env.example .env        # fill in the values
export $(grep -v '^#' .env | xargs)
npm run seed                # optional: demo tenant + menu (needs SEED_* values)
npm run dev
npm test
```

Endpoints:

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/webhooks/whatsapp` | Meta subscription challenge (`hub.verify_token`) |
| POST | `/webhooks/whatsapp` | Inbound messages (signature checked with `WHATSAPP_APP_SECRET`) |
| POST | `/admin/tenants` | Register a tenant (`name`, `whatsappPhoneNumberId`, `whatsappAccessToken`, `systemPrompt?`) |
| GET | `/admin/tenants` | List tenants (tokens are never returned) |
| POST | `/admin/tenants/:tenantId/menu-items` | Add one item, or an array for a bulk import |
| GET | `/admin/tenants/:tenantId/menu-items?category=` | List a tenant's items |
| PATCH | `/admin/tenants/:tenantId/menu-items/:itemId` | Change price, name, category, description, or `available` |

All `/admin` calls need `Authorization: Bearer $ADMIN_API_KEY`.

Example: add a tenant and a menu item.

```bash
curl -X POST localhost:3000/admin/tenants \
  -H "Authorization: Bearer $ADMIN_API_KEY" -H "Content-Type: application/json" \
  -d '{"name":"Luigi'\''s","whatsappPhoneNumberId":"123456789","whatsappAccessToken":"EAA..."}'

curl -X POST localhost:3000/admin/tenants/<tenantId>/menu-items \
  -H "Authorization: Bearer $ADMIN_API_KEY" -H "Content-Type: application/json" \
  -d '{"name":"Margherita Pizza","category":"Pizza","description":"Tomato, mozzarella","priceCents":1200,"currency":"USD"}'
```

## Connecting WhatsApp

1. In the Meta developer dashboard, create a WhatsApp Business app and add each business's
   number. Copy each number's **Phone number ID** and a system-user **access token** into
   the tenant record.
2. Set the webhook callback URL to `https://<your-host>/webhooks/whatsapp`. Use
   `WHATSAPP_VERIFY_TOKEN` as the verify token and subscribe to the `messages` field.
3. Set `WHATSAPP_APP_SECRET` to the app secret so incoming webhooks can be verified.

The server must be reachable over public HTTPS for Meta to deliver webhooks.
For local testing, tunnel the port (for example with `ngrok`).

## Design notes and MVP limits

- **Storage:** SQLite via `node:sqlite` (WAL mode). It is a single file and needs no
  server. Swap in Postgres when you need several instances.
- **Async processing:** the webhook returns 200 immediately and processes the message in
  the background. Meta retries deliveries that are slow to acknowledge, and the message id
  is stored so retries are ignored. Background work is not durable: a crash mid-reply can
  lose that reply. A queue is the next step.
- **Secrets:** tenant access tokens are stored in plaintext in the database. Encrypt them
  at rest before production.
- **Ordering:** two messages from the same customer processed at the same moment can
  interleave. Acceptable for an MVP; serialize per conversation later.
- **Scope:** the bot can search and describe the menu. It does not take or place orders,
  does not take payments, and does not handle media messages (it replies with a notice).
- **Model:** set `ANTHROPIC_MODEL` to change the Claude model.
- **Graph API version:** `WHATSAPP_GRAPH_VERSION` defaults to `v21.0`. Update it to a
  current Meta version before going live.

## Layout

```
src/
  index.ts          entrypoint: wires dependencies and starts the server
  app.ts            Express app: webhook routes and /admin mount
  admin.ts          tenant and menu admin API
  chat.ts           per-message flow: dedupe, history, LLM reply, send
  assistant.ts      Claude tool-use loop
  catalog-tools.ts  tool definitions; executor scoped to one tenant
  whatsapp.ts       signature check, payload parsing, Cloud API sender
  tenants.ts        tenant repository
  menu.ts           menu catalog repository and search
  conversations.ts  message history repository
  db.ts             SQLite connection and schema
test/               node:test suites (run with `npm test`)
scripts/seed.ts     demo tenant and menu
```
