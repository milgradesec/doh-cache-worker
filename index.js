addEventListener("fetch", event => {
    try {
        const request = event.request
        if (request.method.toUpperCase() === "POST")
            return event.respondWith(handleRequest(event))
        return event.respondWith(fetch(request))
    } catch (e) {
        return event.respondWith(new Response("Error thrown " + e.message))
    }
})

function base64Encode(byteArray) {
    return btoa(Array.from(new Uint8Array(byteArray)).map(val => {
        return String.fromCharCode(val);
    }).join('')).replace(/\+/g, '-').replace(/\//g, '_').replace(/\=/g, '');
}

async function handleRequest(event) {
    const request = event.request
    const cache = caches.default

    // Base64 encode POST request body.
    const body = await request.arrayBuffer()
    const encodedBody = base64Encode(body);

    // Create a GET request with encoded body as dns param.
    const url = new URL("https://dns.paesa.es/dns-query");
    url.searchParams.append("dns", encodedBody)

    const newRequestInit = {
        method: "GET",
        body: null,
    };

    const attrs = new Request(request, newRequestInit);
    const newRequest = new Request(url.href, attrs);

    // Check if response is cached at edge.
    const cacheKey = url.toString()
    let response = await cache.match(cacheKey)
    if (!response) {
        response = await fetch(newRequest)
        event.waitUntil(cache.put(cacheKey, response.clone()))
    }
    return response
}