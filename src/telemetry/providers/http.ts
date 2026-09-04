import * as https from 'https';

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;

export class HttpStatusError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpStatusError';
  }
}

export interface JsonRequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
  maxBytes?: number;
}

export function requestJson(
  url: string,
  options: JsonRequestOptions = {},
): Promise<any> {
  const method = options.method ?? 'POST';
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;

  let payload: Buffer | null = null;
  if (options.body !== undefined) {
    if (Buffer.isBuffer(options.body)) {
      payload = options.body;
    } else if (typeof options.body === 'string') {
      payload = Buffer.from(options.body, 'utf8');
    } else {
      payload = Buffer.from(JSON.stringify(options.body), 'utf8');
    }
  }

  const headers: Record<string, string> = { ...(options.headers ?? {}) };
  if (payload && !Object.keys(headers).some((key) => key.toLowerCase() === 'content-length')) {
    headers['Content-Length'] = String(payload.length);
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const finishReject = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    const req = https.request(url, { method, headers }, (res) => {
      const chunks: Buffer[] = [];
      let received = 0;

      res.on('data', (chunk: Buffer | string) => {
        if (settled) return;
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        received += buffer.length;
        if (received > maxBytes) {
          req.destroy();
          finishReject(new Error('HTTPS response exceeded size limit'));
          return;
        }
        chunks.push(buffer);
      });

      res.on('end', () => {
        if (settled) return;
        const statusCode = res.statusCode ?? 0;
        const text = Buffer.concat(chunks).toString('utf8');
        if (statusCode < 200 || statusCode >= 300) {
          finishReject(new HttpStatusError(statusCode, `HTTPS request returned HTTP ${statusCode}`));
          return;
        }

        if (!text.trim()) {
          settled = true;
          resolve({});
          return;
        }

        try {
          const value = JSON.parse(text);
          settled = true;
          resolve(value);
        } catch {
          finishReject(new Error('HTTPS response was not valid JSON'));
        }
      });

      res.on('error', (error) => finishReject(error));
    });

    req.setTimeout(timeoutMs, () => {
      req.destroy();
      finishReject(new Error('HTTPS request timed out'));
    });
    req.on('error', (error) => finishReject(error));

    if (payload) req.write(payload);
    req.end();
  });
}
