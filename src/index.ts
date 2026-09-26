export interface Env {
  DOH_ENDPOINT: string;
}

const MAX_CACHEABLE_BODY_BYTES = 12_000;
const MAX_URL_LENGTH = 16 * 1024;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      if (request.method === 'POST') {
        return await handleRequest(request, env);
      }
      if (request.method === 'GET') {
        const url = new URL(request.url);
        url.protocol = 'https:';
        url.hostname = env.DOH_ENDPOINT;
        return await fetch(new Request(url.href, request));
      }
      return new Response(null, { status: 405 });
    } catch {
      return new Response(null, { status: 502 });
    }
  },
};

async function handleRequest(request: Request, env: Env): Promise<Response> {
  const contentType = request.headers.get('content-type')?.trim().toLowerCase();
  const accept = request.headers.get('accept')?.trim().toLowerCase();
  if (
    contentType !== 'application/dns-message' ||
    (accept !== undefined &&
      accept !== 'application/dns-message' &&
      accept !== '*/*') ||
    new URL(request.url).search !== '' ||
    request.headers.has('authorization') ||
    request.headers.has('cookie') ||
    request.headers.has('cache-control') ||
    request.headers.has('pragma')
  ) {
    return fetch(request);
  }

  const contentLength = Number(request.headers.get('content-length'));
  if (contentLength > MAX_CACHEABLE_BODY_BYTES) {
    return fetch(request);
  }

  const body = await readCacheableBody(request);
  if (body === null) {
    return fetch(request);
  }

  const encodedBody = base64Encode(body);

  const url = new URL(`https://${env.DOH_ENDPOINT}`);
  url.searchParams.set('dns', encodedBody);
  if (url.href.length > MAX_URL_LENGTH) {
    return fetch(request);
  }

  const getRequest = new Request(url.href, {
    method: 'GET',
    headers: { Accept: 'application/dns-message' },
  });

  return fetch(getRequest, {
    cf: {
      cacheEverything: true,
    },
  });
}

async function readCacheableBody(request: Request): Promise<Uint8Array | null> {
  const body = request.clone().body;
  if (body === null) {
    return new Uint8Array();
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    length += value.byteLength;
    if (length > MAX_CACHEABLE_BODY_BYTES) {
      // The tee's cancellation settles after the original body is consumed.
      void reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function base64Encode(buffer: Uint8Array): string {
  const binaryString = buffer.reduce(
    (str, byte) => str + String.fromCharCode(byte),
    '',
  );
  const encoded = btoa(binaryString)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');

  return encoded;
}
