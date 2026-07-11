export const handler = async (event) => {
  try {
    const { targetUrl, method, body } = JSON.parse(event.body || '{}');

    if (!targetUrl) {
      return {
        statusCode: 400,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: 'targetUrl required' }),
      };
    }

    const opts = { method: method || 'GET' };
    if (body) opts.body = typeof body === 'string' ? body : JSON.stringify(body);
    if (opts.body) opts.headers = { 'Content-Type': 'application/json' };

    const res = await fetch(targetUrl, opts);
    const text = await res.text();

    return {
      statusCode: res.status,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: res.status, contents: text }),
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: error.message }),
    };
  }
};
