import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

test(
  'handles DoH requests in the Workers runtime',
  { timeout: 30_000 },
  async (t) => {
    const settings = {
      CLOUDFLARE_CF_FETCH_ENABLED: 'false',
      WRANGLER_LOG_PATH: join(tmpdir(), `doh-runtime-${process.pid}.log`),
      WRANGLER_SEND_METRICS: 'false',
    };
    const previousSettings = Object.fromEntries(
      Object.keys(settings).map((name) => [name, process.env[name]]),
    );
    Object.assign(process.env, settings);
    const originalFetch = globalThis.fetch;
    let server;
    t.after(async () => {
      try {
        await server?.close();
      } finally {
        globalThis.fetch = originalFetch;
        for (const [name, value] of Object.entries(previousSettings)) {
          if (value === undefined) {
            delete process.env[name];
          } else {
            process.env[name] = value;
          }
        }
      }
    });

    const { createTestHarness } = await import('wrangler');
    server = createTestHarness({
      workers: [
        {
          configPath: new URL('../wrangler.toml', import.meta.url),
          vars: { DOH_ENDPOINT: 'resolver.test/dns-query' },
        },
      ],
    });
    let outbound;
    let calls = 0;
    let originStatus = 200;
    const originBytes = Buffer.from([0, 255, 7]);

    globalThis.fetch = async (url, request) => {
      const target = new URL(url);
      if (!['worker.test', 'resolver.test'].includes(target.hostname)) {
        throw new Error(`Unexpected outbound request: ${url}`);
      }
      calls++;
      outbound = {
        url: target.href,
        method: request.method,
        headers: new Headers(request.headers),
        bytes: Buffer.from(await request.arrayBuffer()),
      };
      return new Response(originBytes, {
        status: originStatus,
        headers: {
          'content-type': 'application/dns-message',
          'cache-control': 'max-age=60',
        },
      });
    };
    await server.listen();

    await t.test(
      'converts a streamed POST and preserves the origin response',
      async () => {
        calls = 0;
        const response = await server.fetch('http://worker.test/dns-query', {
          method: 'POST',
          headers: {
            'content-type': 'application/dns-message',
            'x-client': 'do-not-forward',
          },
          body: new ReadableStream({
            start(controller) {
              controller.enqueue(Uint8Array.from([0]));
              controller.enqueue(Uint8Array.from([255]));
              controller.close();
            },
          }),
          duplex: 'half',
        });

        assert.equal(calls, 1);
        assert.equal(outbound.method, 'GET');
        assert.equal(outbound.url, 'https://resolver.test/dns-query?dns=AP8');
        assert.equal(outbound.headers.get('accept'), 'application/dns-message');
        assert.equal(outbound.headers.get('x-client'), null);
        assert.equal(outbound.bytes.length, 0);
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('cache-control'), 'max-age=60');
        assert.deepEqual(
          Buffer.from(await response.arrayBuffer()),
          originBytes,
        );
      },
    );

    await t.test(
      'forwards an oversized POST and preserves an HTTP error response',
      async () => {
        calls = 0;
        originStatus = 503;
        const bytes = Buffer.alloc(12_001, 123);
        const response = await server.fetch('http://worker.test/dns-query', {
          method: 'POST',
          headers: {
            'content-type': 'application/dns-message',
            'x-client': 'preserve-me',
          },
          body: new ReadableStream({
            start(controller) {
              controller.enqueue(bytes.subarray(0, 6_000));
              controller.enqueue(bytes.subarray(6_000));
              controller.close();
            },
          }),
          duplex: 'half',
        });

        assert.equal(calls, 1);
        assert.equal(outbound.method, 'POST');
        assert.equal(outbound.url, 'http://worker.test/dns-query');
        assert.equal(outbound.headers.get('x-client'), 'preserve-me');
        assert.deepEqual(outbound.bytes, bytes);
        assert.equal(response.status, 503);
        assert.equal(response.headers.get('cache-control'), 'max-age=60');
        assert.deepEqual(
          Buffer.from(await response.arrayBuffer()),
          originBytes,
        );
      },
    );
  },
);
