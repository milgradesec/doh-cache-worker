// export default {
//     async fetch(request, env, context) {
//       return handleRequest(request, env)
//     },
//   };


addEventListener("fetch", event => {
    const request = event.request

    // Only handle POST requests.
    if (request.method === "POST")
        return event.respondWith(handleRequest(request))
    return event.respondWith(fetch(request))
})

async function handleRequest(request) {
    // Base64 encode request body.
    const body = await request.arrayBuffer()
    const encodedBody = base64Encode(body);

    // Create a request URL with encoded body as query parameter.
    const url = new URL(`https://${DOH_ENDPOINT}`);
    url.searchParams.append("dns", encodedBody)

    // Create a GET request from the original POST request. 
    const newRequest = new Request(url.href, {
        method: "GET",
        body: null,
    });

    // Fetch response from origin server.
    return await fetch(newRequest, {
        cf: {
            cacheEverything: true,
        },
    })
}

function base64Encode(byteArray) {
    return btoa(Array.from(new Uint8Array(byteArray)).map(val => {
        return String.fromCharCode(val);
    }).join('')).replace(/\+/g, '-').replace(/\//g, '_').replace(/\=/g, '');
}
