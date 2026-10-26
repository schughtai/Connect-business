import { openDatabase } from '../src/db.js';
import { MenuRepository } from '../src/menu.js';
import { TenantRepository } from '../src/tenants.js';

// Creates one demo tenant wired to a WhatsApp test number, with a sample menu.
// Run with: npm run seed (set SEED_WHATSAPP_PHONE_NUMBER_ID and SEED_WHATSAPP_ACCESS_TOKEN).
const phoneNumberId = process.env.SEED_WHATSAPP_PHONE_NUMBER_ID;
const accessToken = process.env.SEED_WHATSAPP_ACCESS_TOKEN;
if (!phoneNumberId || !accessToken) {
  throw new Error('Set SEED_WHATSAPP_PHONE_NUMBER_ID and SEED_WHATSAPP_ACCESS_TOKEN');
}

const db = openDatabase(process.env.DATABASE_PATH ?? './data/app.sqlite');
const tenants = new TenantRepository(db);
const menu = new MenuRepository(db);

const tenant =
  tenants.findByPhoneNumberId(phoneNumberId) ??
  tenants.create({
    name: 'Demo Pizzeria',
    whatsappPhoneNumberId: phoneNumberId,
    whatsappAccessToken: accessToken,
    systemPrompt: 'Mention that delivery is available within 5 km.',
  });

if (menu.list(tenant.id).length === 0) {
  menu.add(tenant.id, { name: 'Margherita Pizza', category: 'Pizza', description: 'Tomato, mozzarella, fresh basil', priceCents: 1200 });
  menu.add(tenant.id, { name: 'Pepperoni Pizza', category: 'Pizza', description: 'Tomato, mozzarella, pepperoni', priceCents: 1400 });
  menu.add(tenant.id, { name: 'Vegan Veggie Pizza', category: 'Pizza', description: 'Tomato, peppers, onion, olives, dairy-free cheese', priceCents: 1350 });
  menu.add(tenant.id, { name: 'Caesar Salad', category: 'Salads', description: 'Romaine, parmesan, croutons, caesar dressing', priceCents: 850 });
  menu.add(tenant.id, { name: 'Tiramisu', category: 'Desserts', description: 'Espresso-soaked ladyfingers with mascarpone', priceCents: 650 });
}

console.log(`Seeded tenant ${tenant.name} (${tenant.id}) with ${menu.list(tenant.id).length} menu items`);
