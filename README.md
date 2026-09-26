# ⚡ doh-cache ⚡

👷 `doh-cache` is a Cloudflare Worker to make DNS over HTTPS requests cacheable at edge.

🚀 Running in production at **<https://dns.paesa.es/dns-query>**

## How it Works

`doh-cache` accepts DNS-over-HTTPS (DoH) **POST** requests and rewrites
compatible requests as equivalent **GET** requests. It uses Cloudflare's
`fetch()` caching options, with the cache lifetime set by the origin's headers.
Requests that cannot be safely converted or would exceed Cloudflare's URL limit
are forwarded to the origin as POST requests.

On a cache hit, responses are served from the nearest Cloudflare data center.
On a miss, the worker fetches from the upstream DoH resolver and returns its
response. Whether Cloudflare stores that response depends on the origin's
cache headers.

With Node.js 22 or later, run `npm test` and `npx tsc --noEmit` to check the
Worker locally. The
[verification notes](VERIFICATION.md) describe the properties checked and
their limits.

## License

MIT License
