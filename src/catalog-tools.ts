import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { formatPrice, type MenuItem, type MenuRepository } from './menu.js';

export const CATALOG_TOOLS: Anthropic.Tool[] = [
  {
    name: 'search_menu',
    description:
      'Search the menu for available items matching a customer request (dish names, ingredients, dietary needs, or a category). Use this whenever the customer asks about items, prices, or what is on offer.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Keywords from the customer request, for example "vegan pasta" or "spicy chicken".',
        },
        category: {
          type: 'string',
          description: 'Optional menu category to restrict the search to. Use list_categories to find valid values.',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'list_categories',
    description: 'List the menu categories that currently have available items.',
    input_schema: { type: 'object', properties: {} },
  },
];

const searchInput = z.object({
  query: z.string(),
  category: z.string().optional(),
});

function describeItem(item: MenuItem) {
  return {
    name: item.name,
    category: item.category,
    description: item.description,
    price: formatPrice(item.priceCents, item.currency),
  };
}

// Builds the tool executor for one tenant. The tenant id is fixed here, never
// taken from the model's tool input, so one tenant cannot read another's menu.
export function createCatalogToolExecutor(menu: MenuRepository, tenantId: string) {
  return async (name: string, input: unknown): Promise<string> => {
    switch (name) {
      case 'search_menu': {
        const args = searchInput.parse(input);
        const items = menu.search(tenantId, { query: args.query, category: args.category });
        return JSON.stringify({ items: items.map(describeItem) });
      }
      case 'list_categories':
        return JSON.stringify({ categories: menu.categories(tenantId) });
      default:
        throw new Error(`Unknown tool ${name}`);
    }
  };
}
