import assert from 'node:assert/strict';
import test from 'node:test';
import fc from 'fast-check';
import worker from '../src/index.ts';

const cacheableBytes = fc.uint8Array({ maxLength: 12_000, size: 'max' });
const oversizedBytes = fc.uint8Array({
  minLength: 12_001,
  maxLength: 12_288,
  size: 'max',
});
const smallBytes = fc.uint8Array({ maxLength: 64, size: 'max' });
const streamCuts = fc.array(fc.integer({ min: 0, max: 12_000 }), {
  maxLength: 7,
  size: 'max',
});
const headerValue = fc
  .array(fc.constantFrom('a', 'b', '0', '1', ' ', '=', ';', '-', '_'), {
    maxLength: 24,
  })
  .map((characters) => characters.join(''));

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

function streamedPost(bytes, cuts) {
  return new Request('https://dns.paesa.es/dns-query', {
    method: 'POST',
    headers: { 'content-type': 'application/dns-message' },
    body: new ReadableStream({
      start(controller) {
        let offset = 0;
        for (const cut of [...cuts].sort((left, right) => left - right)) {
          const end = Math.min(cut, bytes.length);
          controller.enqueue(bytes.subarray(offset, end));
          offset = end;
        }
        controller.enqueue(bytes.subarray(offset));
        controller.close();
      },
    }),
    duplex: 'half',
  });
}

function mediaTypeVariants(value) {
  return fc
    .tuple(
      fc.array(fc.boolean(), {
        minLength: value.length,
        maxLength: value.length,
      }),
      fc.constantFrom('', ' ', '\t'),
      fc.constantFrom('', ' ', '\t'),
    )
    .map(([uppercase, leading, trailing]) => {
      const letters = [...value].map((letter, index) =>
        uppercase[index] ? letter.toUpperCase() : letter,
      );
      return leading + letters.join('') + trailing;
    });
}

function endpointWithUrlLength(bytes, length) {
  const url = new URL('https://example.com/');
  url.searchParams.set('dns', Buffer.from(bytes).toString('base64url'));
  return `example.com/${'x'.repeat(length - url.href.length)}`;
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

async function assertConverted(
  request,
  bytes,
  endpoint = 'dns.paesa.es/dns-query',
) {
  const originResponse = new Response('origin response');
  let calls = 0;
  let outbound;
  let options;
  const response = await dispatch(
    request,
    (forwarded, init) => {
      calls++;
      outbound = forwarded;
      options = init;
      return Promise.resolve(originResponse);
    },
    endpoint,
  );

  assert.equal(calls, 1);
  assert.strictEqual(response, originResponse);
  assert.equal(outbound.method, 'GET');
  assert.equal(outbound.body, null);
  assert.deepEqual(
    [...outbound.headers],
    [['accept', 'application/dns-message']],
  );
  assert.deepEqual(options, { cf: { cacheEverything: true } });

  const encoded = new URL(outbound.url).searchParams.get('dns');
  assert.match(encoded, /^[A-Za-z0-9_-]*$/);
  assert.equal(encoded, Buffer.from(bytes).toString('base64url'));
  assert.deepEqual(Buffer.from(encoded, 'base64url'), Buffer.from(bytes));
  const expectedUrl = new URL(`https://${endpoint}`);
  expectedUrl.searchParams.set('dns', Buffer.from(bytes).toString('base64url'));
  assert.equal(outbound.url, expectedUrl.href);
  assert.ok(outbound.url.length <= 16 * 1024);
}

async function assertForwarded(
  request,
  bytes,
  endpoint = 'dns.paesa.es/dns-query',
) {
  const originResponse = new Response('origin response');
  let calls = 0;
  let outbound;
  let options;
  let forwardedBytes;
  const response = await dispatch(
    request,
    async (forwarded, init) => {
      calls++;
      outbound = forwarded;
      options = init;
      forwardedBytes = Buffer.from(await forwarded.arrayBuffer());
      return originResponse;
    },
    endpoint,
  );

  assert.equal(calls, 1);
  assert.strictEqual(response, originResponse);
  assert.strictEqual(outbound, request);
  assert.equal(options, undefined);
  assert.deepEqual(forwardedBytes, Buffer.from(bytes));
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

test('preserves binary boundary vectors in base64url without padding', async () => {
  const cases = [
    Buffer.alloc(0),
    Buffer.from([0]),
    Buffer.from([255, 254]),
    Buffer.from(Array.from({ length: 256 }, (_, index) => index)),
    Buffer.alloc(11_999, 255),
    Buffer.alloc(12_000, 255),
  ];

  for (const bytes of cases) {
    await assertConverted(post(bytes), bytes);
  }
  await assertConverted(post(undefined), Buffer.alloc(0));
});

test('preserves arbitrary bytes in base64url without padding', async () => {
  await fc.assert(
    fc.asyncProperty(cacheableBytes, async (bytes) => {
      await assertConverted(post(bytes), bytes);
    }),
    { numRuns: 100 },
  );
});

test('forwards an oversized POST without changing its bytes', async () => {
  const bytes = Buffer.alloc(12_001, 255);
  await assertForwarded(post(bytes), bytes);
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
  await assertForwarded(request, bytes);
});

test('uses Content-Length to forward an oversized POST immediately', async () => {
  const bytes = Buffer.from([1]);
  let controller;
  const request = new Request('https://dns.paesa.es/dns-query', {
    method: 'POST',
    headers: {
      'content-type': 'application/dns-message',
      'content-length': '12001',
    },
    body: new ReadableStream({
      start(streamController) {
        controller = streamController;
      },
    }),
    duplex: 'half',
  });
  const originResponse = new Response('origin response');
  let calls = 0;
  let outbound;
  let forwardedBytes;
  const timer = setTimeout(() => {
    controller.error(
      new Error('origin was not reached before reading the body'),
    );
  }, 2_000);
  try {
    const response = await dispatch(request, async (forwarded) => {
      calls++;
      outbound = forwarded;
      controller.enqueue(bytes);
      controller.close();
      forwardedBytes = Buffer.from(await forwarded.arrayBuffer());
      return originResponse;
    });
    assert.equal(calls, 1);
    assert.strictEqual(outbound, request);
    assert.strictEqual(response, originResponse);
    assert.deepEqual(forwardedBytes, bytes);
  } finally {
    clearTimeout(timer);
    controller.error(new Error('test complete'));
    await request.body.cancel().catch(() => {});
  }
});

test('forwards a lazily produced oversized stream before buffering all of it', async () => {
  const chunk = Buffer.alloc(6_000, 123);
  const totalChunks = 100;
  let producedChunks = 0;
  let controller;
  const request = new Request('https://dns.paesa.es/dns-query', {
    method: 'POST',
    headers: { 'content-type': 'application/dns-message' },
    body: new ReadableStream({
      start(streamController) {
        controller = streamController;
      },
      pull(streamController) {
        producedChunks++;
        streamController.enqueue(chunk);
        if (producedChunks === totalChunks) {
          streamController.close();
        }
      },
    }),
    duplex: 'half',
  });
  const originResponse = new Response('origin response');
  let calls = 0;
  let outbound;
  let producedChunksAtOrigin;
  let forwardedBytes;
  const timer = setTimeout(() => {
    controller.error(new Error('oversized stream did not reach the origin'));
  }, 2_000);
  try {
    const response = await dispatch(request, async (forwarded) => {
      calls++;
      outbound = forwarded;
      producedChunksAtOrigin = producedChunks;
      forwardedBytes = Buffer.from(await forwarded.arrayBuffer());
      return originResponse;
    });
    assert.equal(calls, 1);
    assert.strictEqual(outbound, request);
    assert.strictEqual(response, originResponse);
    assert.ok(
      producedChunksAtOrigin < totalChunks,
      `all ${producedChunksAtOrigin} chunks were buffered before forwarding`,
    );
    assert.deepEqual(
      forwardedBytes,
      Buffer.alloc(chunk.length * totalChunks, 123),
    );
  } finally {
    clearTimeout(timer);
    controller.error(new Error('test complete'));
    await request.body.cancel().catch(() => {});
  }
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

test('forwards the original POST when Content-Type is missing', async () => {
  const bytes = Buffer.from([0, 255]);
  const request = new Request('https://dns.paesa.es/dns-query', {
    method: 'POST',
    body: bytes,
  });
  assert.equal(request.headers.has('content-type'), false);
  await assertForwarded(request, bytes);
});

test('forwards requests excluded by headers without reading errored bodies', async () => {
  for (const headers of [
    { 'content-type': 'application/json' },
    { accept: 'application/dns-json' },
    { authorization: '' },
    { cookie: '' },
    { 'cache-control': '' },
    { pragma: '' },
    { 'content-length': '12001' },
  ]) {
    const request = new Request('https://dns.paesa.es/dns-query', {
      method: 'POST',
      headers: { 'content-type': 'application/dns-message', ...headers },
      body: new ReadableStream({
        start(controller) {
          controller.error(new Error('body must not be inspected'));
        },
      }),
      duplex: 'half',
    });
    const originResponse = new Response('origin response');
    let calls = 0;
    let outbound;
    let options;
    const response = await dispatch(request, (forwarded, init) => {
      calls++;
      outbound = forwarded;
      options = init;
      return Promise.resolve(originResponse);
    });
    assert.equal(calls, 1);
    assert.strictEqual(outbound, request);
    assert.strictEqual(response, originResponse);
    assert.equal(options, undefined);
    assert.equal(request.bodyUsed, false);
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

test('returns an empty 502 when a GET or HEAD origin asynchronously rejects', async () => {
  for (const method of ['GET', 'HEAD']) {
    const request = new Request('https://dns.paesa.es/dns-query', { method });
    let calls = 0;
    let outbound;
    const response = await dispatch(request, async (forwarded) => {
      calls++;
      outbound = forwarded;
      await Promise.resolve();
      throw new Error('origin unavailable');
    });
    assert.equal(calls, 1);
    assert.strictEqual(outbound, request);
    assert.equal(response.status, 502);
    assert.equal(await response.text(), '');
  }
});

test('returns an empty 502 on a body read error without an origin request', async () => {
  const request = new Request('https://dns.paesa.es/dns-query', {
    method: 'POST',
    headers: { 'content-type': 'application/dns-message' },
    body: new ReadableStream({
      start(controller) {
        controller.error(new Error('body read failed'));
      },
    }),
    duplex: 'half',
  });
  let calls = 0;
  const response = await dispatch(request, () => {
    calls++;
    return Promise.resolve(new Response('unexpected origin request'));
  });
  assert.equal(calls, 0);
  assert.equal(response.status, 502);
  assert.equal(await response.text(), '');
});

test('preserves origin statuses, bodies, and headers after conversion or forwarding', async () => {
  for (const status of [204, 304, 404, 429, 500, 503]) {
    for (const converted of [true, false]) {
      const request = post(
        Buffer.from([0, 255]),
        converted ? {} : { cookie: '' },
      );
      const bytes =
        status === 204 || status === 304 ? null : Buffer.from([0, 255]);
      const headers = {
        'cache-control': 'private, max-age=60',
        'content-type': 'application/dns-message',
        'x-origin': 'unchanged',
      };
      const originResponse = new Response(bytes, { status, headers });
      let calls = 0;
      let outbound;
      const response = await dispatch(request, (forwarded) => {
        calls++;
        outbound = forwarded;
        return Promise.resolve(originResponse);
      });
      assert.equal(calls, 1);
      assert.equal(outbound.method, converted ? 'GET' : 'POST');
      if (!converted) {
        assert.strictEqual(outbound, request);
      }
      assert.strictEqual(response, originResponse);
      assert.equal(response.status, status);
      assert.deepEqual([...response.headers], [...new Headers(headers)]);
      assert.deepEqual(
        Buffer.from(await response.arrayBuffer()),
        bytes ?? Buffer.alloc(0),
      );
    }
  }
});

test('preserves streamed boundary bytes across repeated cuts', async () => {
  const cases = [
    [Buffer.alloc(0), [0, 0]],
    [Buffer.from([0, 255, 1]), [0, 2, 2]],
    [Buffer.alloc(12_000, 255), [0, 0, 6_000, 12_000, 12_000]],
    [Buffer.alloc(12_001, 255), [12_000]],
    [Buffer.alloc(12_288, 255), [0, 12_000]],
  ];
  for (const [bytes, cuts] of cases) {
    const request = streamedPost(bytes, cuts);
    if (bytes.length <= 12_000) {
      await assertConverted(request, bytes);
    } else {
      await assertForwarded(request, bytes);
    }
  }
});

test('reassembles arbitrary streamed chunks before encoding', async () => {
  await fc.assert(
    fc.asyncProperty(cacheableBytes, streamCuts, async (bytes, cuts) => {
      await assertConverted(streamedPost(bytes, cuts), bytes);
    }),
    { numRuns: 100 },
  );
});

test('forwards arbitrary oversized bodies and their streamed partitions', async () => {
  await fc.assert(
    fc.asyncProperty(oversizedBytes, streamCuts, async (bytes, cuts) => {
      await assertForwarded(post(bytes), bytes);
      await assertForwarded(streamedPost(bytes, cuts), bytes);
    }),
    { numRuns: 100 },
  );
});

test('uses actual body size unless Content-Length rules out conversion', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.oneof(cacheableBytes, oversizedBytes),
      async (bytes) => {
        const cases = [
          {},
          { 'content-length': String(bytes.length) },
          { 'content-length': '0' },
          { 'content-length': '12000' },
          { 'content-length': 'not-a-number' },
          { 'content-length': '-1' },
          { 'content-length': '' },
        ];
        for (const headers of cases) {
          const request = post(bytes, headers);
          if (bytes.length <= 12_000) {
            await assertConverted(request, bytes);
          } else {
            await assertForwarded(request, bytes);
          }
        }
        await assertForwarded(
          post(bytes, { 'content-length': String(bytes.length + 12_001) }),
          bytes,
        );
      },
    ),
    { numRuns: 100 },
  );
});

test('enforces the exact URL length boundary', async () => {
  const bytes = Buffer.from([0, 255]);
  for (const length of [16_383, 16_384, 16_385]) {
    const endpoint = endpointWithUrlLength(bytes, length);
    const expected = new URL(`https://${endpoint}`);
    expected.searchParams.set('dns', bytes.toString('base64url'));
    assert.equal(expected.href.length, length);
    const request = post(bytes);
    if (length <= 16_384) {
      await assertConverted(request, bytes, endpoint);
    } else {
      await assertForwarded(request, bytes, endpoint);
    }
  }
});

test('respects the URL limit for generated endpoint paths', async () => {
  await fc.assert(
    fc.asyncProperty(
      smallBytes,
      fc.integer({ min: 16_370, max: 16_400 }),
      async (bytes, length) => {
        const endpoint = endpointWithUrlLength(bytes, length);
        const request = post(bytes);
        if (length <= 16_384) {
          await assertConverted(request, bytes, endpoint);
        } else {
          await assertForwarded(request, bytes, endpoint);
        }
      },
    ),
    { numRuns: 100 },
  );
});

test('normalizes compatible media types with arbitrary case and whitespace', async () => {
  await fc.assert(
    fc.asyncProperty(
      smallBytes,
      mediaTypeVariants('application/dns-message'),
      fc.option(
        fc.oneof(
          mediaTypeVariants('application/dns-message'),
          mediaTypeVariants('*/*'),
        ),
        { nil: undefined },
      ),
      async (bytes, contentType, accept) => {
        const headers = { 'content-type': contentType };
        if (accept !== undefined) {
          headers.accept = accept;
        }
        await assertConverted(post(bytes, headers), bytes);
      },
    ),
    { numRuns: 100 },
  );
});

test('forwards excluded headers including empty values', async () => {
  await fc.assert(
    fc.asyncProperty(smallBytes, headerValue, async (bytes, value) => {
      for (const name of [
        'authorization',
        'cookie',
        'cache-control',
        'pragma',
      ]) {
        await assertForwarded(post(bytes, { [name]: '' }), bytes);
        await assertForwarded(post(bytes, { [name]: value }), bytes);
      }
    }),
    { numRuns: 100 },
  );
});

test('forwards incompatible media types and nonempty queries', async () => {
  await fc.assert(
    fc.asyncProperty(smallBytes, headerValue, async (bytes, value) => {
      for (const contentType of [
        'application/json',
        'application/dns-message; charset=utf-8',
        '',
      ]) {
        await assertForwarded(
          post(bytes, { 'content-type': contentType }),
          bytes,
        );
      }
      for (const accept of [
        'application/dns-json',
        'application/dns-message, */*',
        '',
      ]) {
        await assertForwarded(post(bytes, { accept }), bytes);
      }
      const request = new Request(
        `https://dns.paesa.es/dns-query?q=${encodeURIComponent(value)}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/dns-message' },
          body: bytes,
        },
      );
      await assertForwarded(request, bytes);
    }),
    { numRuns: 100 },
  );
});

test('forwards arbitrary bytes for every supported non-POST method', async () => {
  await fc.assert(
    fc.asyncProperty(smallBytes, async (bytes) => {
      for (const method of [
        'GET',
        'HEAD',
        'PUT',
        'PATCH',
        'DELETE',
        'OPTIONS',
      ]) {
        const body = method === 'GET' || method === 'HEAD' ? undefined : bytes;
        const request = new Request('https://dns.paesa.es/dns-query', {
          method,
          headers: { 'content-type': 'application/dns-message' },
          body,
        });
        await assertForwarded(request, body ?? Buffer.alloc(0));
      }
    }),
    { numRuns: 100 },
  );
});

test('returns an empty 502 on synchronous and asynchronous origin failures', async () => {
  await fc.assert(
    fc.asyncProperty(smallBytes, async (bytes) => {
      for (const headers of [{}, { cookie: '' }]) {
        for (const asynchronous of [false, true]) {
          const originalFetch = globalThis.fetch;
          let calls = 0;
          const response = await dispatch(post(bytes, headers), () => {
            calls++;
            const error = new Error('origin unavailable');
            if (asynchronous) {
              return Promise.reject(error);
            }
            throw error;
          });
          assert.equal(calls, 1);
          assert.equal(response.status, 502);
          assert.equal(await response.text(), '');
          assert.strictEqual(globalThis.fetch, originalFetch);
        }
      }
    }),
    { numRuns: 100 },
  );
});
