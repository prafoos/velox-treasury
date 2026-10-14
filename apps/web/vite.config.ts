import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { defineConfig } from 'vite';

const __dirname = dirname(fileURLToPath(import.meta.url));
const strategyAutomationModulePath = resolve(__dirname, 'api/strategy-automation.ts');
const apiRoutes = new Map([
  ['/api/auth/challenge', resolve(__dirname, 'api/auth/challenge.ts')],
  ['/api/auth/verify', resolve(__dirname, 'api/auth/verify.ts')],
  ['/api/auth/session', resolve(__dirname, 'api/auth/session.ts')],
  ['/api/admin-projection', resolve(__dirname, 'api/admin-projection.ts')],
  ['/api/ai/user', resolve(__dirname, 'api/ai-user.ts')],
  ['/api/ai/admin', resolve(__dirname, 'api/ai-admin.ts')],
  ['/api/chain-read', resolve(__dirname, 'api/chain-read.ts')],
  ['/api/core-state', resolve(__dirname, 'api/core-state.ts')],
  ['/api/strategy-state', resolve(__dirname, 'api/strategy-state.ts')],
  ['/api/strategy-automation', strategyAutomationModulePath],
  ['/api/user-financial', resolve(__dirname, 'api/user-financial.ts')],
]);

export default defineConfig({
  plugins: [
    {
      name: 'local-api-routes',
      configureServer(server) {
        if (process.env.VELOX_SIGNER_DIAGNOSTIC === '1') {
          void server.ssrLoadModule(strategyAutomationModulePath)
            .then((module) => module.runStrategyAutomationSignerDiagnostic())
            .then((result) => {
              server.config.logger.info(
                `Signer address: ${result.signerAddress} | Effective executor: ${result.executorAddress} | ${result.matchesExecutor ? 'MATCH' : 'MISMATCH'} | AUTOMATION_ROLE: ${result.hasAutomationRole} | Block: ${result.blockNumber}`,
              );
            })
            .catch((error: unknown) => {
              const diagnosticFailure = error && typeof error === 'object'
                && 'stage' in error && 'category' in error
                && typeof error.stage === 'string' && typeof error.category === 'string'
                ? ` at ${error.stage} (${error.category})`
                : '';
              server.config.logger.error(
                `Signer diagnostic failed${diagnosticFailure}.`,
              );
            });
        }

        server.middlewares.use(async (req, res, next) => {
          if (!req.url) {
            next();
            return;
          }

          const url = new URL(req.url, 'http://localhost');
          const routeModulePath = apiRoutes.get(url.pathname);
          if (!routeModulePath) {
            next();
            return;
          }

          try {
            const mod = await server.ssrLoadModule(routeModulePath);
            const handler = mod.default ?? mod.handler;
            if (typeof handler !== 'function') {
              next();
              return;
            }

            let body: unknown;
            if (req.method === 'POST') {
              const chunks: Buffer[] = [];
              let size = 0;
              for await (const chunk of req) {
                const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
                size += buffer.length;
                if (size > 8_192) {
                  res.statusCode = 413;
                  res.end();
                  return;
                }
                chunks.push(buffer);
              }
              if (chunks.length > 0) {
                try {
                  body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
                } catch {
                  res.statusCode = 400;
                  res.setHeader('Content-Type', 'application/json');
                  res.end(JSON.stringify({ error: 'Invalid JSON body.' }));
                  return;
                }
              }
            }

            const request = {
              method: req.method ?? 'GET',
              query: Object.fromEntries(url.searchParams.entries()),
              headers: req.headers,
              body,
            };

            const response = {
              statusCode: 200,
              setHeader(name: string, value: string | number | readonly string[]) {
                res.setHeader(name, value as string);
                return this;
              },
              status(code: number) {
                this.statusCode = code;
                return this;
              },
              json(body: unknown) {
                res.statusCode = this.statusCode;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify(body));
                return this;
              },
              end(body?: string | Uint8Array) {
                if (!res.writableEnded) {
                  res.end(body);
                }
                return this;
              },
            };

            await handler(request, response);

            if (!res.writableEnded) {
              res.statusCode = response.statusCode;
              res.end();
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'API route failed', details: message }));
          }
        });
      },
    },
  ],
});
