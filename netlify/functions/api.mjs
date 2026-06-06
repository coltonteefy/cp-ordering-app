import { Readable } from 'node:stream';
import Busboy from 'busboy';
import { extractText } from 'unpdf';

const COA_BASE_URL = 'https://coas.freedomdiagnosticstesting.com';
const WOO_BASE_URL = String(process.env.WOO_BASE_URL || '').replace(/\/$/, '');
const WOO_CONSUMER_KEY = process.env.WOO_CONSUMER_KEY || '';
const WOO_CONSUMER_SECRET = process.env.WOO_CONSUMER_SECRET || '';
const WOO_ORDER_STATUSES_RAW = String(process.env.WOO_ORDER_STATUSES || 'processing,completed,on-hold').trim();
const WOO_ORDER_STATUSES = WOO_ORDER_STATUSES_RAW
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const WOO_FETCH_CONCURRENCY = Math.max(1, Number.parseInt(process.env.WOO_FETCH_CONCURRENCY || '4', 10) || 4);
const WOO_REQUEST_TIMEOUT_MS = Math.max(5000, Number.parseInt(process.env.WOO_REQUEST_TIMEOUT_MS || '30000', 10) || 30000);

const SEARCH_CODE_RE = /Coff\d+/i;
const LOT_RE = /CP[A-Z0-9]{6,}/;
const PURITY_RE = /\d{1,3}\.\d+%/;

const parseMoney = (value) => {
  const parsed = Number.parseFloat(value ?? '0');
  return Number.isFinite(parsed) ? parsed : 0;
};

const inferCategoryFromName = (name) => (/\bkit\b/i.test(String(name || '')) ? 'Kits' : 'Singles');

const getDateKey = (value = new Date()) => {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return new Date().toISOString().slice(0, 10);
  return parsed.toISOString().slice(0, 10);
};

const buildWooUrl = (path, params = {}) => {
  if (!WOO_BASE_URL || !WOO_CONSUMER_KEY || !WOO_CONSUMER_SECRET) {
    throw new Error('WooCommerce credentials missing. Set WOO_BASE_URL, WOO_CONSUMER_KEY, and WOO_CONSUMER_SECRET as Netlify env vars.');
  }

  const url = new URL(`/wp-json/wc/v3/${path}`, WOO_BASE_URL);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  });
  url.searchParams.set('consumer_key', WOO_CONSUMER_KEY);
  url.searchParams.set('consumer_secret', WOO_CONSUMER_SECRET);
  return url.toString();
};

const buildWooAnalyticsUrl = (path, params = {}) => {
  if (!WOO_BASE_URL || !WOO_CONSUMER_KEY || !WOO_CONSUMER_SECRET) {
    throw new Error('WooCommerce credentials missing. Set WOO_BASE_URL, WOO_CONSUMER_KEY, and WOO_CONSUMER_SECRET as Netlify env vars.');
  }

  const url = new URL(`/wp-json/wc-analytics/${path}`, WOO_BASE_URL);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  });
  url.searchParams.set('consumer_key', WOO_CONSUMER_KEY);
  url.searchParams.set('consumer_secret', WOO_CONSUMER_SECRET);
  return url.toString();
};

const fetchWooAnalyticsSummaryForRange = async (startDateKey, endDateKey) => {
  try {
    const after = `${startDateKey}T00:00:00`;
    const before = `${endDateKey}T23:59:59`;
    const params = {
      after,
      before,
      interval: 'day',
    };

    if (WOO_ORDER_STATUSES.length && !WOO_ORDER_STATUSES.includes('any')) {
      params.status_is = WOO_ORDER_STATUSES.join(',');
    }

    const url = buildWooAnalyticsUrl('reports/orders/stats', params);
    const response = await fetch(url, {
      signal: AbortSignal.timeout(WOO_REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      return null;
    }

    const payload = await response.json();
    const totals = payload?.totals || {};

    const netSales = parseMoney(
      totals.net_revenue
      ?? totals.net_sales
      ?? totals.total_sales
      ?? totals.sales
    );

    const orderCount = Number.parseInt(
      totals.orders_count
      ?? totals.total_orders
      ?? totals.orders,
      10
    );

    return {
      orderCount: Number.isFinite(orderCount) ? orderCount : null,
      netSales: Number.isFinite(netSales) ? netSales : null,
      totals,
    };
  } catch {
    return null;
  }
};

const fetchWooOrdersPage = async (params, page, attempt = 0) => {
  const url = buildWooUrl('orders', {
    ...params,
    page,
  });

  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(WOO_REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Woo API request failed (${response.status}): ${body || 'No response body'}`);
    }

    const rows = await response.json();
    if (!Array.isArray(rows)) {
      throw new Error('Woo API returned unexpected payload for orders endpoint.');
    }

    const totalPages = Number.parseInt(response.headers.get('x-wp-totalpages') || '1', 10) || 1;
    return { rows, totalPages };
  } catch (error) {
    if (attempt < 1) {
      return fetchWooOrdersPage(params, page, attempt + 1);
    }
    throw error;
  }
};

const fetchWooOrdersForRange = async (startDateKey, endDateKey) => {
  const after = `${startDateKey}T00:00:00`;
  const before = `${endDateKey}T23:59:59`;
  const collected = [];
  const requestParams = {
    after,
    before,
    per_page: 100,
    orderby: 'date',
    order: 'asc',
  };

  if (WOO_ORDER_STATUSES.length && !WOO_ORDER_STATUSES.includes('any')) {
    requestParams.status = WOO_ORDER_STATUSES.join(',');
  }

  const firstPage = await fetchWooOrdersPage(requestParams, 1);
  collected.push(...firstPage.rows);

  const allRemainingPages = [];
  for (let page = 2; page <= firstPage.totalPages; page += 1) {
    allRemainingPages.push(page);
  }

  for (let i = 0; i < allRemainingPages.length; i += WOO_FETCH_CONCURRENCY) {
    const batch = allRemainingPages.slice(i, i + WOO_FETCH_CONCURRENCY);
    const results = await Promise.all(batch.map((page) => fetchWooOrdersPage(requestParams, page)));
    results.forEach((result) => {
      collected.push(...result.rows);
    });
  }

  return collected;
};

const buildDailyWooReport = (orders, startDateKey, endDateKey, analyticsSummary = null) => {
  const productMap = new Map();
  const couponMap = new Map();
  const orderStatusCounts = new Map();

  orders.forEach((order) => {
    const orderId = order?.id;
    const status = String(order?.status || 'unknown').trim() || 'unknown';
    const lineItems = Array.isArray(order?.line_items) ? order.line_items : [];
    const couponLines = Array.isArray(order?.coupon_lines) ? order.coupon_lines : [];

    orderStatusCounts.set(status, (orderStatusCounts.get(status) || 0) + 1);

    lineItems.forEach((item) => {
      const productName = String(item?.name || '').trim();
      if (!productName) return;

      const quantity = Number.parseInt(item?.quantity, 10) || 0;
      if (quantity <= 0) return;

      const lineTotal = parseMoney(item?.total);
      const key = `${item?.product_id || productName.toLowerCase()}::${productName.toLowerCase()}`;

      if (!productMap.has(key)) {
        productMap.set(key, {
          'Product title': productName,
          Category: inferCategoryFromName(productName),
          'Items sold': 0,
          Orders: 0,
          'Net sales': 0,
          SKU: String(item?.sku || '').trim(),
          _orderIds: new Set(),
        });
      }

      const product = productMap.get(key);
      product['Items sold'] += quantity;
      product['Net sales'] += lineTotal;
      if (orderId !== undefined && orderId !== null) {
        product._orderIds.add(orderId);
      }
    });

    couponLines.forEach((coupon) => {
      const code = String(coupon?.code || '').trim();
      if (!code) return;
      const key = code.toLowerCase();

      if (!couponMap.has(key)) {
        couponMap.set(key, {
          code,
          orderCount: 0,
          totalDiscount: 0,
          _orderIds: new Set(),
        });
      }

      const item = couponMap.get(key);
      if (orderId !== undefined && orderId !== null) {
        item._orderIds.add(orderId);
      }
      item.totalDiscount += parseMoney(coupon?.discount) + parseMoney(coupon?.discount_tax);
    });
  });

  const rows = Array.from(productMap.values()).map((product) => ({
    'Product title': product['Product title'],
    Category: product.Category,
    'Items sold': product['Items sold'],
    Orders: product._orderIds.size,
    'Net sales': Number(product['Net sales'].toFixed(2)),
    SKU: product.SKU,
  }));

  const couponUsage = Array.from(couponMap.values())
    .map((coupon) => ({
      code: coupon.code,
      orderCount: coupon._orderIds.size,
      totalDiscount: Number(coupon.totalDiscount.toFixed(2)),
    }))
    .sort((a, b) => b.totalDiscount - a.totalDiscount);

  const lineItemNetSales = rows.reduce((sum, row) => sum + parseMoney(row['Net sales']), 0);
  const dashboardNetSales = analyticsSummary?.netSales ?? lineItemNetSales;
  const dashboardOrderCount = analyticsSummary?.orderCount ?? orders.length;

  return {
    date: startDateKey === endDateKey ? startDateKey : `${startDateKey} to ${endDateKey}`,
    startDate: startDateKey,
    endDate: endDateKey,
    orderCount: dashboardOrderCount,
    pulledStatuses: WOO_ORDER_STATUSES.length ? WOO_ORDER_STATUSES : ['any'],
    orderStatusCounts: Object.fromEntries(orderStatusCounts.entries()),
    totalNetSales: Number(dashboardNetSales.toFixed(2)),
    lineItemNetSales: Number(lineItemNetSales.toFixed(2)),
    metricsSource: analyticsSummary ? 'wc-analytics' : 'orders-v3',
    analyticsTotals: analyticsSummary?.totals || null,
    rows: rows.sort((a, b) => parseMoney(b['Net sales']) - parseMoney(a['Net sales'])),
    couponUsage,
  };
};

function parseFields(text, filename) {
  const searchCodeMatch = text.match(SEARCH_CODE_RE);
  const lotMatch = text.match(LOT_RE);

  let product = null;
  if (lotMatch) {
    const afterLot = text.slice(lotMatch.index + lotMatch[0].length);
    const purityMatch = afterLot.match(PURITY_RE);
    if (purityMatch) {
      product = afterLot.slice(0, purityMatch.index).trim().replace(/\s+/g, ' ');
    }
  }

  const coaLink = `${COA_BASE_URL}/${encodeURIComponent(filename)}`;

  return {
    searchCode: searchCodeMatch ? searchCodeMatch[0] : null,
    lot: lotMatch ? lotMatch[0] : null,
    product: product || null,
    coaLink,
  };
}

const parseMultipartForm = (event) => new Promise((resolve, reject) => {
  const headers = Object.fromEntries(
    Object.entries(event.headers || {}).map(([key, value]) => [key.toLowerCase(), value])
  );

  const busboy = Busboy({ headers });
  const files = [];

  busboy.on('file', (fieldname, file, info) => {
    const chunks = [];
    file.on('data', (chunk) => chunks.push(chunk));
    file.on('end', () => {
      files.push({
        fieldname,
        filename: info?.filename || 'upload.pdf',
        mimeType: info?.mimeType || 'application/pdf',
        buffer: Buffer.concat(chunks),
      });
    });
  });

  busboy.on('finish', () => resolve({ files }));
  busboy.on('error', reject);

  const bodyBuffer = Buffer.from(event.body || '', event.isBase64Encoded ? 'base64' : 'utf8');
  Readable.from(bodyBuffer).pipe(busboy);
});

const jsonResponse = (statusCode, payload) => ({
  statusCode,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  },
  body: JSON.stringify(payload),
});

export const handler = async (event) => {
  try {
    const pathname = new URL(event.rawUrl || `https://local${event.path || '/'}`).pathname;
    const isOptions = event.httpMethod === 'OPTIONS';

    if (isOptions) {
      return {
        statusCode: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        },
        body: '',
      };
    }

    if (pathname.endsWith('/health')) {
      return jsonResponse(200, { ok: true });
    }

    if (pathname.endsWith('/woo/daily-report')) {
      const query = event.queryStringParameters || {};
      const queryDate = query.date || '';
      const queryStartDate = query.startDate || queryDate;
      const queryEndDate = query.endDate || queryDate;
      const startDate = getDateKey(queryStartDate || new Date());
      const endDate = getDateKey(queryEndDate || startDate);
      const normalized = startDate <= endDate
        ? { startDate, endDate }
        : { startDate: endDate, endDate: startDate };

      const [orders, analyticsSummary] = await Promise.all([
        fetchWooOrdersForRange(normalized.startDate, normalized.endDate),
        fetchWooAnalyticsSummaryForRange(normalized.startDate, normalized.endDate),
      ]);

      return jsonResponse(200, buildDailyWooReport(orders, normalized.startDate, normalized.endDate, analyticsSummary));
    }

    if (pathname.endsWith('/parse-pdf')) {
      const { files } = await parseMultipartForm(event);

      if (!files.length) {
        return jsonResponse(400, { error: 'No files uploaded.' });
      }

      const results = await Promise.all(
        files.map(async (file) => {
          try {
            const fileBytes = new Uint8Array(
              file.buffer.buffer,
              file.buffer.byteOffset,
              file.buffer.byteLength
            );
            const pdf = await extractText(fileBytes, { mergePages: true });
            const text = Array.isArray(pdf.text) ? pdf.text.join('\n') : pdf.text ?? '';
            const fields = parseFields(text, file.filename);
            return { filename: file.filename, ...fields, error: null };
          } catch (err) {
            return {
              filename: file.filename,
              searchCode: null,
              lot: null,
              product: null,
              coaLink: `${COA_BASE_URL}/${encodeURIComponent(file.filename)}`,
              error: err.message || 'Failed to parse PDF.',
            };
          }
        })
      );

      return jsonResponse(200, { results });
    }

    return jsonResponse(404, { error: 'Not found.' });
  } catch (error) {
    return jsonResponse(500, {
      error: error?.message || 'Unhandled server error.',
    });
  }
};
