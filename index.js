addEventListener("fetch", event => {
    try {
        const request = event.request
        if (request.method === "POST")
            return event.respondWith(handleRequest(event))
        return event.respondWith(fetch(request))
    } catch (e) {
        return event.respondWith(new Response("Error thrown " + e.message))
    }
})

async function handleRequest(event) {
    const request = event.request
    const cache = caches.default
    
    // Base64 encode request body.
    const body = await request.arrayBuffer()
    const encodedBody = base64Encode(body);

    // Create a request URL with encoded body as query parameter.
    const url = new URL("https://dns.paesa.es/dns-query");
    url.searchParams.append("dns", encodedBody)

    // Create a GET request from the original POST request. 
    const attrs = new Request(request, { method: "GET", body: null, });
    const getRequest = new Request(url.href, attrs);

    // Check if response is cached at edge.
    const cacheUrl = new URL(getRequest.url);
    const cacheKey = new Request(cacheUrl.toString(), getRequest);

    let response = await cache.match(cacheKey)
    if (!response) {
        console.log("Response served from origin.")

        // Fetch response from origin.
        response = await fetch(getRequest)
        response = new Response(response.body, response);

        // Store the fetched response in the cache.
        event.waitUntil(cache.put(cacheKey, response.clone()))
    } else {
        console.log("Response served from cache.")
    }
    return response
}

function base64Encode(byteArray) {
    return btoa(Array.from(new Uint8Array(byteArray)).map(val => {
        return String.fromCharCode(val);
    }).join('')).replace(/\+/g, '-').replace(/\//g, '_').replace(/\=/g, '');
}
