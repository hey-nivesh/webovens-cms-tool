import path from 'path';
import dns from 'dns';
import type { Core } from '@strapi/strapi';

// Force Node.js to prefer IPv4 over IPv6 when resolving hostnames.
// Render.com and many cloud platforms do not support IPv6 routing by default,
// which causes connection attempts to Supabase IPv6 addresses to fail with ENETUNREACH.
if (typeof dns.setDefaultResultOrder === 'function') {
  dns.setDefaultResultOrder('ipv4first');
}

const config = ({ env }: Core.Config.Shared.ConfigParams): Core.Config.Database => {
  const client = env('DATABASE_CLIENT', 'sqlite');

  const connections = {
    mysql: {
      connection: {
        host: env('DATABASE_HOST', 'localhost'),
        port: env.int('DATABASE_PORT', 3306),
        database: env('DATABASE_NAME', 'strapi'),
        user: env('DATABASE_USERNAME', 'strapi'),
        password: env('DATABASE_PASSWORD', 'strapi'),
        ssl: env.bool('DATABASE_SSL', false) && {
          key: env('DATABASE_SSL_KEY', undefined),
          cert: env('DATABASE_SSL_CERT', undefined),
          ca: env('DATABASE_SSL_CA', undefined),
          capath: env('DATABASE_SSL_CAPATH', undefined),
          cipher: env('DATABASE_SSL_CIPHER', undefined),
          rejectUnauthorized: env.bool('DATABASE_SSL_REJECT_UNAUTHORIZED', true),
        },
      },
      pool: { min: env.int('DATABASE_POOL_MIN', 2), max: env.int('DATABASE_POOL_MAX', 10) },
    },
    postgres: {
      connection: env('DATABASE_URL')
        // ── Use connection string only (Supabase recommended) ──────────────
        // Do NOT mix connectionString with individual host/user/password —
        // the pg driver gives individual params priority and ignores the URL,
        // which breaks Supabase pooler auth.
        ? {
            connectionString: env('DATABASE_URL'),
            ssl: { rejectUnauthorized: false },
            lookup: (hostname: string, options: any, callback: any) => {
              dns.lookup(hostname, { family: 4 }, callback);
            },
          }
        // ── Fallback: individual params ─────────────────────────────────────
        : {
            host: env('DATABASE_HOST', 'localhost'),
            port: env.int('DATABASE_PORT', 5432),
            database: env('DATABASE_NAME', 'strapi'),
            user: env('DATABASE_USERNAME', 'strapi'),
            password: env('DATABASE_PASSWORD', 'strapi'),
            ssl: env.bool('DATABASE_SSL', false)
              ? { rejectUnauthorized: false }
              : false,
            schema: env('DATABASE_SCHEMA', 'public'),
            lookup: (hostname: string, options: any, callback: any) => {
              dns.lookup(hostname, { family: 4 }, callback);
            },
          },
      // Keep pool small — Supabase free tier allows ~15 concurrent connections
      pool: { min: env.int('DATABASE_POOL_MIN', 2), max: env.int('DATABASE_POOL_MAX', 5) },
    },
    sqlite: {
      connection: {
        filename: path.join(__dirname, '..', '..', env('DATABASE_FILENAME', '.tmp/data.db')),
      },
      useNullAsDefault: true,
    },
  };

  return {
    connection: {
      client,
      ...connections[client],
      acquireConnectionTimeout: env.int('DATABASE_CONNECTION_TIMEOUT', 60000),
    },
  };
};

export default config;
