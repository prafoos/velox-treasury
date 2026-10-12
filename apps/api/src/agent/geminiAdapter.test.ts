import { describe, expect, it, vi } from 'vitest';

import { createGeminiAdapter, GeminiAdapter } from './geminiAdapter.js';

describe('GeminiAdapter', () => {
  const dummyApiKey = 'test-gemini-api-key-1234567890abcdef';

  // 1. Gemini request is created correctly.
  it('creates the Gemini request correctly with endpoint, method, headers, and body', async () => {
    let capturedUrl = '';
    let capturedOptions: RequestInit | undefined;

    const mockFetch = vi.fn(async (url: string | URL | Request, options?: RequestInit) => {
      capturedUrl = url.toString();
      capturedOptions = options;
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: 'Hello, Velox Treasury.' }],
                role: 'model',
              },
              finishReason: 'STOP',
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });

    const adapter = new GeminiAdapter({
      apiKey: dummyApiKey,
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    const res = await adapter.generateText({
      systemPrompt: 'System instructions.',
      prompt: 'User prompt.',
      generationConfig: {
        temperature: 0.2,
      },
    });

    expect(capturedUrl).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent',
    );
    expect(capturedOptions?.method).toBe('POST');
    expect((capturedOptions?.headers as Record<string, string>)?.['Content-Type']).toBe('application/json');

    const body = JSON.parse(capturedOptions?.body as string);
    expect(body.contents).toEqual([
      {
        role: 'user',
        parts: [{ text: 'User prompt.' }],
      },
    ]);
    expect(body.systemInstruction).toEqual({
      parts: [{ text: 'System instructions.' }],
    });
    expect(body.generationConfig).toEqual({
      temperature: 0.2,
    });
    expect(res.text).toBe('Hello, Velox Treasury.');
  });

  it('forwards a fixed decoding seed to Gemini generationConfig', async () => {
    let capturedOptions: RequestInit | undefined;
    const mockFetch = vi.fn(async (_url: string | URL | Request, options?: RequestInit) => {
      capturedOptions = options;
      return new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: 'ok' }], role: 'model' } }],
      }), { status: 200 });
    });
    const adapter = new GeminiAdapter({
      apiKey: dummyApiKey,
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    await adapter.generateText({
      prompt: 'Use this evidence consistently.',
      generationConfig: { temperature: 0.1, seed: 42 },
    });

    const body = JSON.parse(capturedOptions?.body as string);
    expect(body.generationConfig).toMatchObject({ temperature: 0.1, seed: 42 });
  });

  // 2. Correct model is used: gemini-3.5-flash-lite.
  it('uses gemini-3.5-flash-lite by default and respects configured model', async () => {
    let capturedUrl = '';

    const mockFetch = vi.fn(async (url: string | URL | Request) => {
      capturedUrl = url.toString();
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: { parts: [{ text: 'response' }], role: 'model' },
            },
          ],
        }),
        { status: 200 },
      );
    });

    const defaultAdapter = new GeminiAdapter({
      apiKey: dummyApiKey,
      fetchFn: mockFetch as unknown as typeof fetch,
    });
    expect(defaultAdapter.model).toBe('gemini-3.5-flash-lite');

    await defaultAdapter.generateText({ prompt: 'test' });
    expect(capturedUrl).toContain('/models/gemini-3.5-flash-lite:generateContent');

    const customAdapter = new GeminiAdapter({
      apiKey: dummyApiKey,
      model: 'gemini-3.5-flash',
      fetchFn: mockFetch as unknown as typeof fetch,
    });
    expect(customAdapter.model).toBe('gemini-3.5-flash');
  });

  // 3. API key is read server-side from GEMINI_API_KEY.
  it('reads API key server-side from process.env.GEMINI_API_KEY when not explicitly passed', async () => {
    const originalKey = process.env.GEMINI_API_KEY;
    try {
      process.env.GEMINI_API_KEY = 'env-api-key-xyz-987';
      const adapter = new GeminiAdapter({
        fetchFn: vi.fn() as unknown as typeof fetch,
      });
      expect(adapter.providerName).toBe('gemini');
    } finally {
      process.env.GEMINI_API_KEY = originalKey;
    }
  });

  // 4. API key is sent only as authentication header.
  it('sends the API key only as x-goog-api-key header and not in URL or payload', async () => {
    let capturedUrl = '';
    let capturedOptions: RequestInit | undefined;

    const mockFetch = vi.fn(async (url: string | URL | Request, options?: RequestInit) => {
      capturedUrl = url.toString();
      capturedOptions = options;
      return new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: 'ok' }], role: 'model' } }],
        }),
        { status: 200 },
      );
    });

    const adapter = new GeminiAdapter({
      apiKey: dummyApiKey,
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    await adapter.generateText({ prompt: 'test' });

    // Must be in authentication header
    expect((capturedOptions?.headers as Record<string, string>)?.['x-goog-api-key']).toBe(dummyApiKey);

    // Must NOT be in URL
    expect(capturedUrl).not.toContain(dummyApiKey);
    expect(capturedUrl).not.toContain('key=');

    // Must NOT be in payload
    expect(capturedOptions?.body as string).not.toContain(dummyApiKey);
  });

  // 5. API key is never included in logs/errors.
  it('never leaks the API key in error messages or logs', async () => {
    const secretKey = 'secret-api-key-must-never-be-leaked';
    const mockFetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          error: {
            code: 403,
            message: `Forbidden: API key ${secretKey} is invalid.`,
          },
        }),
        { status: 403 },
      );
    });

    const adapter = new GeminiAdapter({
      apiKey: secretKey,
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    await expect(adapter.generateText({ prompt: 'test' })).rejects.toThrowError();

    try {
      await adapter.generateText({ prompt: 'test' });
      throw new Error('Expected Gemini request to fail.');
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      const message = (err as Error).message;
      expect(message).not.toContain(secretKey);
      expect(message).toContain('[REDACTED]');
    }
  });

  // 6. Successful structured response is parsed.
  it('parses a successful structured JSON response', async () => {
    const mockData = {
      recommendationId: 'rec-001',
      action: 'ALLOCATE_TO_APPROVED_STRATEGY',
      amount: '5000000',
    };

    const mockFetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: JSON.stringify(mockData) }],
                role: 'model',
              },
              finishReason: 'STOP',
            },
          ],
        }),
        { status: 200 },
      );
    });

    const adapter = createGeminiAdapter({
      apiKey: dummyApiKey,
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    const result = await adapter.generateStructuredJson<typeof mockData>({
      prompt: 'Suggest allocation',
    });

    expect(result.data).toEqual(mockData);
    expect(result.response.model).toBe('gemini-3.5-flash-lite');
  });

  // 7. Malformed response fails closed.
  it('fails closed on malformed or non-JSON structured responses', async () => {
    const mockFetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: 'This is not valid JSON at all.' }],
                role: 'model',
              },
            },
          ],
        }),
        { status: 200 },
      );
    });

    const adapter = new GeminiAdapter({
      apiKey: dummyApiKey,
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    await expect(adapter.generateStructuredJson({ prompt: 'test' })).rejects.toThrow(
      /not valid JSON/i,
    );
  });

  // 8. Provider HTTP 4xx fails closed.
  it('fails closed on provider HTTP 4xx error without retrying indefinitely', async () => {
    const mockFetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          error: {
            code: 400,
            message: 'Bad Request: Invalid argument.',
          },
        }),
        { status: 400, statusText: 'Bad Request' },
      );
    });

    const adapter = new GeminiAdapter({
      apiKey: dummyApiKey,
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    await expect(adapter.generateText({ prompt: 'test' })).rejects.toThrow(/HTTP 400/i);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  // 9. Provider HTTP 5xx fails closed.
  it('fails closed on provider HTTP 5xx error', async () => {
    const mockFetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          error: {
            code: 500,
            message: 'Internal server error',
          },
        }),
        { status: 500, statusText: 'Internal Server Error' },
      );
    });

    const adapter = new GeminiAdapter({
      apiKey: dummyApiKey,
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    await expect(adapter.generateText({ prompt: 'test' })).rejects.toThrow(/HTTP 500/i);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  // 10. Timeout fails closed.
  it('fails closed on timeout via bounded AbortSignal', async () => {
    const mockFetch = vi.fn(async (_url: string | URL | Request, options?: RequestInit) => {
      return new Promise<Response>((_, reject) => {
        options?.signal?.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        });
      });
    });

    const adapter = new GeminiAdapter({
      apiKey: dummyApiKey,
      timeoutMs: 50,
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    await expect(adapter.generateText({ prompt: 'test' })).rejects.toThrow(/timed out/i);
  });

  // 11. Missing GEMINI_API_KEY fails closed.
  it('fails closed immediately when GEMINI_API_KEY is missing or empty', () => {
    const originalKey = process.env.GEMINI_API_KEY;
    try {
      delete process.env.GEMINI_API_KEY;
      expect(() => new GeminiAdapter({ apiKey: '' })).toThrow(/GEMINI_API_KEY is required/i);
      expect(() => new GeminiAdapter({})).toThrow(/GEMINI_API_KEY is required/i);
    } finally {
      process.env.GEMINI_API_KEY = originalKey;
    }
  });
});
