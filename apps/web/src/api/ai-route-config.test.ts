import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('AI Assistant Vercel route', () => {
  it('keeps exact AI API and SPA rewrites in both Vercel configurations', () => {
    const configUrls = [
      new URL('../../vercel.json', import.meta.url),
      new URL('../../../../vercel.json', import.meta.url),
    ];

    for (const configUrl of configUrls) {
      const config = JSON.parse(readFileSync(configUrl, 'utf8')) as {
        readonly rewrites?: readonly { readonly source: string; readonly destination: string }[];
      };
      const rewrites = config.rewrites ?? [];

      expect(rewrites).toContainEqual({
        source: '/api/ai/user',
        destination: '/api/ai-user',
      });
      expect(rewrites).toContainEqual({
        source: '/api/ai/admin',
        destination: '/api/ai-admin',
      });
      expect(rewrites).toContainEqual({
        source: '/ai-assistant',
        destination: '/',
      });
      expect(rewrites.some(({ source }) => source === '/:path*' || source === '/(.*)')).toBe(false);
      expect(rewrites.some(({ source }) => source === '/api/:path*')).toBe(false);
    }
  });
});
