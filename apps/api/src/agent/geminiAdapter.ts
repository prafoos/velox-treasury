import type {
  GeminiAdapterConfig,
  IModelAdapter,
  ModelRequest,
  ModelResponse,
} from './types.js';

const DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash-lite';
const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const DEFAULT_TIMEOUT_MS = 15_000;

function sanitizeSecret(text: string, secret?: string): string {
  if (!secret || !secret.trim()) return text;
  return text.replaceAll(secret, '[REDACTED]');
}

export class GeminiAdapter implements IModelAdapter {
  readonly providerName = 'gemini';
  readonly model: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof fetch;

  constructor(config: GeminiAdapterConfig = {}) {
    const rawKey = config.apiKey ?? process.env.GEMINI_API_KEY ?? '';
    this.apiKey = rawKey.trim();
    if (!this.apiKey) {
      throw new Error('GEMINI_API_KEY is required for Gemini provider.');
    }

    this.model = (config.model ?? process.env.GEMINI_MODEL ?? DEFAULT_GEMINI_MODEL).trim() || DEFAULT_GEMINI_MODEL;
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchFn = config.fetchFn ?? globalThis.fetch;

    if (typeof this.fetchFn !== 'function') {
      throw new Error('A global fetch implementation is required for GeminiAdapter.');
    }
  }

  async generateText(request: ModelRequest): Promise<ModelResponse> {
    const url = `${this.baseUrl}/models/${encodeURIComponent(this.model)}:generateContent`;
    const timeoutMs = request.timeoutMs ?? this.timeoutMs;
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => {
      controller.abort();
    }, timeoutMs);

    const contents = [
      {
        role: 'user',
        parts: [{ text: request.prompt }],
      },
    ];

    const body: Record<string, unknown> = {
      contents,
    };

    if (request.systemPrompt && request.systemPrompt.trim()) {
      body.systemInstruction = {
        parts: [{ text: request.systemPrompt.trim() }],
      };
    }

    if (request.generationConfig) {
      const cfg: Record<string, unknown> = {};
      if (typeof request.generationConfig.temperature === 'number') {
        cfg.temperature = request.generationConfig.temperature;
      }
      if (typeof request.generationConfig.seed === 'number') {
        cfg.seed = request.generationConfig.seed;
      }
      if (typeof request.generationConfig.maxOutputTokens === 'number') {
        cfg.maxOutputTokens = request.generationConfig.maxOutputTokens;
      }
      if (request.generationConfig.responseMimeType) {
        cfg.responseMimeType = request.generationConfig.responseMimeType;
      }
      if (request.generationConfig.responseSchema) {
        cfg.responseSchema = request.generationConfig.responseSchema;
      }
      if (Object.keys(cfg).length > 0) {
        body.generationConfig = cfg;
      }
    }

    // The API key is sent only in the x-goog-api-key authentication header.
    // It is never embedded in the URL query string or in the request body.
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-goog-api-key': this.apiKey,
    };

    let response: Response;
    try {
      response = await this.fetchFn(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err: unknown) {
      if (controller.signal.aborted) {
        throw new Error(`Gemini request timed out after ${timeoutMs}ms.`);
      }
      const rawMessage = err instanceof Error ? err.message : 'Network error';
      throw new Error(`Gemini provider network error: ${sanitizeSecret(rawMessage, this.apiKey)}`);
    } finally {
      clearTimeout(timeoutHandle);
    }

    if (!response.ok) {
      let detail = '';
      try {
        const errorBody = await response.json();
        const errorPayload = typeof errorBody === 'object' && errorBody !== null
          ? (errorBody as Record<string, unknown>)
          : {};
        const nestedError = typeof errorPayload.error === 'object' && errorPayload.error !== null
          ? (errorPayload.error as Record<string, unknown>)
          : {};
        const nestedMessage = typeof nestedError.message === 'string' ? nestedError.message : undefined;
        detail = nestedMessage ?? JSON.stringify(errorBody);
      } catch {
        detail = await response.text().catch(() => '');
      }
      const sanitizedDetail = sanitizeSecret(detail, this.apiKey);
      throw new Error(
        `Gemini API error (HTTP ${response.status}): ${sanitizedDetail || response.statusText || 'Request failed'}`,
      );
    }

    let responseData: any;
    try {
      responseData = await response.json();
    } catch {
      throw new Error('Gemini response body was not valid JSON.');
    }
    const candidate = responseData?.candidates?.[0];
    if (!candidate) {
      throw new Error('Gemini response contains no candidates.');
    }

    const textPart = candidate.content?.parts?.[0]?.text;
    if (typeof textPart !== 'string') {
      throw new Error('Gemini response contains no text content in candidate parts.');
    }

    return {
      text: textPart,
      model: this.model,
      finishReason: candidate.finishReason,
      rawJson: responseData,
    };
  }

  async generateStructuredJson<T = unknown>(request: ModelRequest): Promise<{ data: T; response: ModelResponse }> {
    const structuredRequest: ModelRequest = {
      ...request,
      generationConfig: {
        ...request.generationConfig,
        responseMimeType: 'application/json',
      },
    };

    const modelResponse = await this.generateText(structuredRequest);

    let parsed: unknown;
    try {
      parsed = JSON.parse(modelResponse.text);
    } catch {
      throw new Error('Gemini structured response is not valid JSON.');
    }

    return {
      data: parsed as T,
      response: modelResponse,
    };
  }
}

export function createGeminiAdapter(config?: GeminiAdapterConfig): GeminiAdapter {
  return new GeminiAdapter(config);
}
