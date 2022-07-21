export default {
    async fetch(request, env) {
        // Only need to handle POST requests.
        if (request.method != "POST") {
            return new Response("Bad request", { status: 400 })
        }
        return handleRequest(request, env)
    },
};

/**
 * Handle request.
 * 
 * @param {Request} request 
 * @param {*} env 
 */
async function handleRequest(request, env) {
    // Base64 encode request body.
    const body = await request.arrayBuffer()
    const encodedBody = base64Encode(body);

    // Create a request URL with encoded body as query parameter.
    const url = new URL(`https://${env.DOH_ENDPOINT}`);
    url.searchParams.append("dns", encodedBody)

    // Create a GET request from the original POST request. 
    const getRequest = new Request(url.href, {
        method: "GET",
        body: null,
    });

    // Fetch response from origin server.
    return await fetch(getRequest, {
        cf: {
            cacheEverything: true,
        },
    })
}

/**
 * Encodes with base64.
 * 
 * @param {ArrayBuffer} byteArray
 */
function base64Encode(byteArray) {
    return btoa(Array.from(new Uint8Array(byteArray)).map(val => {
        return String.fromCharCode(val);
    }).join('')).replace(/\+/g, '-').replace(/\//g, '_').replace(/\=/g, '');
}
