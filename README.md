# ⚡ doh-cache ⚡

👷 `doh-cache` is a Cloudflare Worker to make DNS over HTTPS requests cacheable at edge.

🚀 Running in production at **<https://dns.paesa.es/dns-query>**

## How it Works

`doh-cache` accepts DNS-over-HTTPS (DoH) **POST** request, rewrites them as equivalent **GET** requests, and then uses Cloudflare’s **Cache API** to store the results at the edge.

On a cache hit, responses are served from the nearest Cloudflare data center, dramatically reducing latency. On a miss, the worker fetches from the upstream DoH resolver, caches the response, and returns it to the client.

## License

MIT License
