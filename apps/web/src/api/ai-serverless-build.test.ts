import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build, type Plugin } from 'esbuild';
import { describe, expect, it } from 'vitest';

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const dotenvStub: Plugin = {
  name: 'serverless-build-dotenv-stub',
  setup(buildApi) {
    buildApi.onResolve({ filter: /^dotenv(?:\/config)?$/ }, ({ path }) => ({
      path,
      namespace: 'dotenv-stub',
    }));
    buildApi.onLoad({ filter: /.*/, namespace: 'dotenv-stub' }, ({ path }) => ({
      contents: path === 'dotenv/config'
        ? 'export {};'
        : 'export function config() { return { parsed: {} }; } export default { config };',
      loader: 'js',
    }));
  },
};

describe('AI Vercel-compatible Node function output', () => {
  it('builds and imports both Node 24 function artifacts with all local modules resolved', async () => {
    const artifactRoot = mkdtempSync(resolve(webRoot, '.ai-function-build-'));

    try {
      const outputRoot = join(artifactRoot, 'functions');
      const buildResult = await build({
        absWorkingDir: webRoot,
        entryPoints: [
          { in: 'api/ai-user.ts', out: 'api/ai-user.func/index' },
          { in: 'api/ai-admin.ts', out: 'api/ai-admin.func/index' },
        ],
        outdir: outputRoot,
        bundle: true,
        format: 'esm',
        platform: 'node',
        target: 'node24',
        packages: 'external',
        metafile: true,
        plugins: [dotenvStub],
        logLevel: 'silent',
      });

      const bundledSources = Object.keys(buildResult.metafile.inputs).map((path) => path.replaceAll('\\', '/'));
      expect(bundledSources.some((path) => path.endsWith('server/aiRouteHandlers.ts'))).toBe(true);
      expect(bundledSources.some((path) => path.endsWith('server/steakhouseMarketData.ts'))).toBe(true);

      const outputNames = Object.keys(buildResult.metafile.outputs).map((path) => path.replaceAll('\\', '/'));
      expect(outputNames.some((path) => path.endsWith('api/ai-user.func/index.js'))).toBe(true);
      expect(outputNames.some((path) => path.endsWith('api/ai-admin.func/index.js'))).toBe(true);
      expect(outputNames.some((path) => path.includes('/api/_ai'))).toBe(false);

      for (const [outputName, output] of Object.entries(buildResult.metafile.outputs)) {
        const outputPath = isAbsolute(outputName) ? outputName : resolve(webRoot, outputName);
        for (const dependency of output.imports.filter(({ external }) => !external)) {
          expect(existsSync(resolve(dirname(outputPath), dependency.path))).toBe(true);
        }
      }

      for (const functionName of ['ai-user', 'ai-admin']) {
        const functionDirectory = join(outputRoot, 'api', `${functionName}.func`);
        const handlerPath = join(functionDirectory, 'index.js');
        const functionConfig = {
          runtime: 'nodejs24.x',
          handler: 'index.js',
          launcherType: 'Nodejs',
        };
        writeFileSync(join(functionDirectory, '.vc-config.json'), JSON.stringify(functionConfig));

        expect(JSON.parse(readFileSync(join(functionDirectory, '.vc-config.json'), 'utf8'))).toEqual(functionConfig);
        const module = await import(`${pathToFileURL(handlerPath).href}?build-test=${functionName}`);
        expect(module.default).toBeTypeOf('function');
      }
    } finally {
      rmSync(artifactRoot, { recursive: true, force: true });
    }
  }, 30_000);
});
