import type { Plugin } from 'vite';
import { loadEnv } from 'vite';
import { resolveApiFile, runHandler, type HandlerModule } from './node-web';

/** Serves api/*.ts under `vite dev` (production uses Vercel functions). */
export function apiDevPlugin(): Plugin {
  return {
    name: 'okuma-api-dev',
    apply: 'serve',
    configureServer(server) {
      // Expose server-side env (.env without VITE_ prefix) to the handlers.
      const env = loadEnv(server.config.mode, server.config.root, '');
      for (const [k, v] of Object.entries(env)) if (process.env[k] === undefined) process.env[k] = v;

      server.middlewares.use(async (req, res, next) => {
        const file = resolveApiFile(server.config.root, req.url ?? '');
        if (!file) return next();
        const mod = (await server.ssrLoadModule(file)) as HandlerModule;
        await runHandler(mod, req, res);
      });
    },
  };
}
