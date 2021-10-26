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

function base64Encode(buf) {
    let string = '';
    (new Uint8Array(buf)).forEach(
        (byte) => { string += String.fromCharCode(byte) }
    )
    return escape(btoa(string))
}

function arrayBufferToBase64(buffer) {
    var binary = '';
    var bytes = new Uint8Array(buffer);
    var len = bytes.byteLength;
    for (var i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

async function handleRequest(event) {
    const request = event.request
    const cache = caches.default

    const body = await request.arrayBuffer()
    const encodedBody = base64Encode(body);

    const url = new URL("https://dns.paesa.es/dns-query");
    url.searchParams.append("dns", encodedBody) // "q80BAAABAAAAAAAAA3d3dwdleGFtcGxlA2NvbQAAAQAB"

    const cacheKey = url.toString()
    console.log(url.toString())

    // Best practice is to always use the original request to construct the new request
    // to clone all the attributes. Applying the URL also requires a constructor
    // since once a Request has been constructed, its URL is immutable.
    const newRequestInit = {
        method: "GET",
        body: null,
    };

    const attrs = new Request(request, newRequestInit);
    const newRequest = new Request(url.href, attrs);

    // Find the cache key in the cache
    let response = await cache.match(cacheKey)
    if (!response) {
        response = await fetch(newRequest)
        event.waitUntil(cache.put(cacheKey, response.clone()))
    }
    return response
}