export default async (request, context) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }

  try {
    const body = await request.json();
    const { targetUrl, method = 'GET', body: bodyData } = body;

    if (!targetUrl) {
      return new Response(JSON.stringify({ error: 'targetUrl required' }), {
        status: 400,
        headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
      });
    }

    const fetchOpts = { method };
    if (bodyData) {
      fetchOpts.body = typeof bodyData === 'string' ? bodyData : JSON.stringify(bodyData);
      fetchOpts.headers = { 'Content-Type': 'application/json' };
    }

    const res = await fetch(targetUrl, fetchOpts);
    const text = await res.text();

    return new Response(JSON.stringify({ status: res.status, contents: text }), {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Content-Type': 'application/json',
      },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
    });
  }
};
