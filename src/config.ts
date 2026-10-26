export interface Config {
  port: number;
  databasePath: string;
  adminApiKey: string;
  whatsapp: {
    verifyToken: string;
    appSecret: string;
    graphVersion: string;
  };
  anthropic: {
    apiKey: string;
    model: string;
  };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: Number(env.PORT ?? 3000),
    databasePath: env.DATABASE_PATH ?? './data/app.sqlite',
    adminApiKey: required(env, 'ADMIN_API_KEY'),
    whatsapp: {
      verifyToken: required(env, 'WHATSAPP_VERIFY_TOKEN'),
      appSecret: required(env, 'WHATSAPP_APP_SECRET'),
      graphVersion: env.WHATSAPP_GRAPH_VERSION ?? 'v21.0',
    },
    anthropic: {
      apiKey: required(env, 'ANTHROPIC_API_KEY'),
      model: env.ANTHROPIC_MODEL ?? 'claude-sonnet-5-5',
    },
  };
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}
