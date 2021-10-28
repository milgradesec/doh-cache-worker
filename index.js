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

async function handleRequest(event) {
    const request = event.request

    // Base64 encode POST request body.
    const body = await request.arrayBuffer()
    const encodedBody = base64Encode(body);

    // Create a request URL with encoded body as query parameter.
    const url = new URL("https://dns.paesa.es/dns-query");
    url.searchParams.append("dns", encodedBody)

    // Check if response is cached at edge.
    // const cacheKey = url.toString()
    const cacheKey = new Request(url.toString(), request);
    const cache = caches.default
    console.log("Cache key => " + cacheKey)

    let response = await cache.match(cacheKey)
    if (!response) {
        console.log("Response served from origin.")

        // Create a GET request from the original POST request. 
        const newRequestInit = {
            method: "GET",
            body: null,
        };
        const attrs = new Request(request, newRequestInit);
        const newRequest = new Request(url.href, attrs);

        // Fetch response from origin.
        response = await fetch(newRequest)
        response = new Response(response.body, response);

        // Store the fetched response in cache.
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