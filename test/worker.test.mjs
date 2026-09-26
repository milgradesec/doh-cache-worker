import assert from 'node:assert/strict';
import test from 'node:test';
import worker from '../src/index.ts';

function post(bytes, headers = {}) {
  return new Request('https://dns.paesa.es/dns-query', {
    method: 'POST',
    headers: {
      'content-type': 'application/dns-message',
      ...headers,
    },
    body: bytes,
  });
}

async function dispatch(request, origin, endpoint = 'dns.paesa.es/dns-query') {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = origin;
  try {
    return await worker.fetch(request, { DOH_ENDPOINT: endpoint });
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test('converts the RFC 8484 POST example to its exact GET representation', async () => {
  const bytes = Buffer.from(
    '00000100000100000000000003777777076578616d706c6503636f6d0000010001',
    'hex',
  );
  const originResponse = new Response(bytes, {
    headers: { 'content-type': 'application/dns-message' },
  });
  let outbound;
  let options;
  const response = await dispatch(post(bytes), (request, init) => {
    outbound = request;
    options = init;
    return Promise.resolve(originResponse);
  });

  assert.strictEqual(response, originResponse);
  assert.equal(outbound.method, 'GET');
  assert.equal(outbound.body, null);
  assert.equal(outbound.headers.get('accept'), 'application/dns-message');
  assert.equal(
    outbound.url,
    'https://dns.paesa.es/dns-query?dns=AAABAAABAAAAAAAAA3d3dwdleGFtcGxlA2NvbQAAAQAB',
  );
  assert.deepEqual(options, { cf: { cacheEverything: true } });
});

test('preserves arbitrary bytes in base64url without padding', async () => {
  const cases = [
    Buffer.alloc(0),
    Buffer.from([0]),
    Buffer.from([255, 254]),
    Buffer.from(Array.from({ length: 256 }, (_, index) => index)),
  ];
  let seed = 0x12345678;
  for (let index = 0; index < 120; index++) {
    const length = (index * 97) % 12_001;
    const bytes = Buffer.alloc(length);
    for (let offset = 0; offset < length; offset++) {
      seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
      bytes[offset] = seed >>> 24;
    }
    cases.push(bytes);
  }

  for (const bytes of cases) {
    let outbound;
    await dispatch(post(bytes), (request) => {
      outbound = request;
      return Promise.resolve(new Response());
    });
    const encoded = new URL(outbound.url).searchParams.get('dns');
    assert.equal(outbound.method, 'GET');
    assert.equal(encoded, bytes.toString('base64url'));
    assert.deepEqual(Buffer.from(encoded, 'base64url'), bytes);
    assert.ok(outbound.url.length <= 16 * 1024);
  }
});

test('keeps the largest cacheable body within the URL limit', async () => {
  let outbound;
  await dispatch(post(Buffer.alloc(12_000, 255)), (request) => {
    outbound = request;
    return Promise.resolve(new Response());
  });
  assert.equal(outbound.method, 'GET');
  assert.ok(outbound.url.length <= 16 * 1024);
});

test('forwards an oversized POST without changing its bytes', async () => {
  const bytes = Buffer.alloc(12_001, 255);
  let outbound;
  let options;
  await dispatch(post(bytes), async (request, init) => {
    outbound = request;
    options = init;
    assert.deepEqual(Buffer.from(await request.arrayBuffer()), bytes);
    return new Response();
  });
  assert.equal(outbound.method, 'POST');
  assert.equal(options, undefined);
});

test('forwards a streamed POST after crossing the cacheable size limit', async () => {
  const bytes = Buffer.alloc(12_001, 123);
  const request = new Request('https://dns.paesa.es/dns-query', {
    method: 'POST',
    headers: { 'content-type': 'application/dns-message' },
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(bytes.subarray(0, 6_000));
        controller.enqueue(bytes.subarray(6_000));
        controller.close();
      },
    }),
    duplex: 'half',
  });
  let outbound;
  await dispatch(request, async (forwarded) => {
    outbound = forwarded;
    assert.deepEqual(Buffer.from(await forwarded.arrayBuffer()), bytes);
    return new Response();
  });
  assert.strictEqual(outbound, request);
});

test('uses Content-Length to forward an oversized POST immediately', async () => {
  const request = post(Buffer.from([1]), { 'content-length': '12001' });
  let outbound;
  await dispatch(request, (forwarded) => {
    outbound = forwarded;
    return Promise.resolve(new Response());
  });
  assert.strictEqual(outbound, request);
});

test('forwards a POST when the configured endpoint makes the URL too long', async () => {
  let outbound;
  await dispatch(
    post(Buffer.from([1])),
    (request) => {
      outbound = request;
      return Promise.resolve(new Response());
    },
    `example.com/${'x'.repeat(16_360)}`,
  );
  assert.equal(outbound.method, 'POST');
});

test('forwards POSTs whose HTTP semantics cannot be safely normalized', async () => {
  const cases = [
    post(Buffer.from([1]), { 'content-type': 'application/json' }),
    post(Buffer.from([1]), { accept: 'application/dns-json' }),
    post(Buffer.from([1]), { authorization: 'Bearer secret' }),
    post(Buffer.from([1]), { cookie: 'session=1' }),
    post(Buffer.from([1]), { 'cache-control': 'no-cache' }),
    post(Buffer.from([1]), { pragma: 'no-cache' }),
    new Request('https://dns.paesa.es/dns-query?cd=1', {
      method: 'POST',
      headers: { 'content-type': 'application/dns-message' },
      body: Buffer.from([1]),
    }),
  ];
  for (const request of cases) {
    let outbound;
    await dispatch(request, (forwarded) => {
      outbound = forwarded;
      return Promise.resolve(new Response());
    });
    assert.strictEqual(outbound, request);
    assert.equal(outbound.method, 'POST');
  }
});

test('reassembles streamed POST chunks before encoding', async () => {
  const request = new Request('https://dns.paesa.es/dns-query', {
    method: 'POST',
    headers: { 'content-type': 'application/dns-message' },
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(Uint8Array.from([0, 255]));
        controller.enqueue(Uint8Array.from([254, 1, 2]));
        controller.close();
      },
    }),
    duplex: 'half',
  });
  let outbound;
  await dispatch(request, (forwarded) => {
    outbound = forwarded;
    return Promise.resolve(new Response());
  });
  assert.equal(
    new URL(outbound.url).searchParams.get('dns'),
    Buffer.from([0, 255, 254, 1, 2]).toString('base64url'),
  );
});

test('forwards non-POST requests and returns 502 on upstream failure', async () => {
  const request = new Request('https://dns.paesa.es/dns-query?dns=AA');
  const originResponse = new Response('ok');
  let outbound;
  const response = await dispatch(request, (forwarded) => {
    outbound = forwarded;
    return Promise.resolve(originResponse);
  });
  assert.strictEqual(outbound, request);
  assert.strictEqual(response, originResponse);

  const failed = await dispatch(post(Buffer.from([1])), () => {
    throw new Error('origin unavailable');
  });
  assert.equal(failed.status, 502);
  assert.equal(await failed.text(), '');
});
