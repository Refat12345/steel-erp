/** @type {import('pm2').Ecosystem} */
module.exports = {
  apps: [
    {
      name: "steel-erp",
      script: "node_modules/.bin/next",
      args: "start",
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "512M",
      // Env file values (DATABASE_URL, NEXTAUTH_SECRET, CLEANUP_SECRET, …)
      // are loaded by Next.js itself via @next/env at `next start`. We only
      // pin the always-true production knobs here.
      env: {
        NODE_ENV: "production",
        PORT: 3000,
      },
    },
  ],
};
