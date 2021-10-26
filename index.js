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

    const body = await request.arrayBuffer()
    const encodedBody = base64Encode(body);

    const url = new URL("https://dns.paesa.es/dns-query");
    url.searchParams.append("dns", encodedBody)

    // Best practice is to always use the original request to construct the new request
    // to clone all the attributes. Applying the URL also requires a constructor
    // since once a Request has been constructed, its URL is immutable.
    const newRequestInit = {
        method: "GET",
        body: null,
    };

    const attrs = new Request(request, newRequestInit);
    const newRequest = new Request(url.href, attrs);

    const cacheKey = url.toString()
    let response = await cache.match(cacheKey)
    if (!response) {
        response = await fetch(newRequest)
        event.waitUntil(cache.put(cacheKey, response.clone()))
    }
    return response
}