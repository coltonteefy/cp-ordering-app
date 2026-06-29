import { Readable } from 'node:stream';
import Busboy from 'busboy';
import { extractText } from 'unpdf';
import { initializeApp as initAdminApp, cert, getApps as getAdminApps } from 'firebase-admin/app';
import { getFirestore as getAdminFirestore } from 'firebase-admin/firestore';

const WEBHOOK_SECRET = process.env.SEVENTEEN_TRACK_WEBHOOK_SECRET || '';

function getAdminDb() {
  if (!getAdminApps().length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '';
    if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON env var not set.');
    initAdminApp({ credential: cert(JSON.parse(raw)) });
  }
  return getAdminFirestore();
}

function getTrackingNums(raw) {
  if (!raw) return [];
  return String(raw).replace(/\r/g, '\n').split(/[\n,;|]+/).map(v => v.trim()).filter(v => v.length >= 6);
}

const COA_BASE_URL = 'https://coas.freedomdiagnosticstesting.com';
const SEVENTEEN_TRACK_API_KEY = process.env.SEVENTEEN_TRACK_API_KEY || '';

const CARRIER_CODES = { FedEx: 100003, UPS: 100002, USPS: 21051, DHL: 100016 };
const CARRIER_CODE_NAMES = { 100003: 'FedEx', 100002: 'UPS', 21051: 'USPS', 100016: 'DHL' };
const KNOWN_STATUSES = new Set(['Delivered','InTransit','OutForDelivery','InfoReceived','FailedAttempt','Exception','Expired','NotFound']);
const isAscii = (s) => /^[\x00-\x7F]*$/.test(s);
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
const LOT_RE = /C(?:&P|P)[A-Z0-9]{6,}/;
const PRODUCT_RE = /Product:\s*(.{1,60}?)(?=\s{2,}|\r?\n|\s*(?:Purity|Identity|Appearance|Net\s+(?:Peptide\s+)?Content|Lot)\b|$)/i;
const OLD_FORMAT_PRODUCT_RE = /\d{1,2}\/\d{1,2}\/\d{4}\s+\d{1,2}\/\d{1,2}\/\d{4}\s+(.{2,50}?)(?=\s+(?:N\/A\b|C(?:&?P)[A-Z0-9]{4,})|\s*\r?\n|$)/i;
const PURITY_RE = /\d{1,3}\.\d+%/;

const pendingImports = new Map();
const savedCoaSet = new Set();
let pendingToken = null;

const parseMoney = (value) => {
  const parsed = Number.parseFloat(value ?? '0');
  return Number.isFinite(parsed) ? parsed : 0;
};

const inferCategoryFromName = (name) => (/\bkit\b/i.test(String(name || '')) ? 'Kits' : 'Singles');

const getPaidOrderCount = (orderStatusCounts) => {
  const processingCount = Number(orderStatusCounts?.processing) || 0;
  const completedCount = Number(orderStatusCounts?.completed) || 0;
  return processingCount + completedCount;
};

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
  const fallbackGrossSales = orders.reduce((sum, order) => {
    const lineItems = Array.isArray(order?.line_items) ? order.line_items : [];
    const orderGross = lineItems.reduce((lineSum, item) => lineSum + parseMoney(item?.subtotal), 0);
    return sum + orderGross;
  }, 0);
  const fallbackTotalSales = orders.reduce((sum, order) => sum + parseMoney(order?.total), 0);
  const normalizedAnalyticsTotals = {
    gross_sales: Number((parseMoney(analyticsSummary?.totals?.gross_sales) || fallbackGrossSales).toFixed(2)),
    total_sales: Number((parseMoney(analyticsSummary?.totals?.total_sales) || fallbackTotalSales).toFixed(2)),
    net_revenue: Number((parseMoney(analyticsSummary?.totals?.net_revenue) || lineItemNetSales).toFixed(2)),
  };
  const dashboardNetSales = analyticsSummary?.netSales ?? lineItemNetSales;
  const dashboardOrderCount = analyticsSummary?.orderCount ?? orders.length;
  const paidOrderCount = getPaidOrderCount(Object.fromEntries(orderStatusCounts.entries()));

  return {
    date: startDateKey === endDateKey ? startDateKey : `${startDateKey} to ${endDateKey}`,
    startDate: startDateKey,
    endDate: endDateKey,
    orderCount: dashboardOrderCount,
    paidOrderCount,
    pulledStatuses: WOO_ORDER_STATUSES.length ? WOO_ORDER_STATUSES : ['any'],
    orderStatusCounts: Object.fromEntries(orderStatusCounts.entries()),
    totalNetSales: Number(dashboardNetSales.toFixed(2)),
    lineItemNetSales: Number(lineItemNetSales.toFixed(2)),
    metricsSource: analyticsSummary ? 'wc-analytics' : 'orders-v3',
    analyticsTotals: normalizedAnalyticsTotals,
    rows: rows.sort((a, b) => parseMoney(b['Net sales']) - parseMoney(a['Net sales'])),
    couponUsage,
  };
};

function parseFields(text, filename) {
  const searchCodeMatch = text.match(SEARCH_CODE_RE);

  const lot = (text.match(LOT_RE) || [])[0] || null;

  let product = null;
  if (/\bProduct\s+Lot\b/i.test(text)) {
    const m = text.match(OLD_FORMAT_PRODUCT_RE);
    if (m) product = m[1].trim();
  } else {
    const m = text.match(PRODUCT_RE);
    if (m) product = m[1].trim().replace(/\s+/g, ' ');
  }

  const coaLink = `${COA_BASE_URL}/${encodeURIComponent(filename)}`;

  return {
    searchCode: searchCodeMatch ? searchCodeMatch[0] : null,
    lot: lot || null,
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

    if (pathname.endsWith('/woo/products')) {
      const allProducts = [];
      let page = 1;
      const perPage = 100;
      while (true) {
        const url = buildWooUrl('products', {
          per_page: perPage,
          page,
          status: 'publish',
          _fields: 'id,name,regular_price,sale_price,categories,permalink',
          signal: undefined,
        });
        const res = await fetch(url, { signal: AbortSignal.timeout(WOO_REQUEST_TIMEOUT_MS) });
        if (!res.ok) {
          return jsonResponse(res.status, { error: `WooCommerce products error: ${await res.text()}` });
        }
        const batch = await res.json();
        if (!Array.isArray(batch) || batch.length === 0) break;
        for (const p of batch) {
          allProducts.push({
            id: p.id,
            name: p.name,
            regularPrice: p.regular_price || '',
            salePrice: p.sale_price || '',
            categories: (p.categories || []).map((c) => c.name),
            permalink: p.permalink || '',
          });
        }
        const total = parseInt(res.headers.get('X-WP-TotalPages') || '1', 10);
        if (page >= total) break;
        page++;
      }
      return jsonResponse(200, { products: allProducts });
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

    if (pathname.endsWith('/bulk-import-kovera') && event.httpMethod === 'POST') {
      const { rows } = JSON.parse(event.body || '{}');
      if (!Array.isArray(rows) || rows.length === 0) {
        return jsonResponse(400, { error: 'Provide a non-empty array of rows.' });
      }
      const filtered = rows.filter(r => r.searchCode && !savedCoaSet.has(r.searchCode));
      if (filtered.length === 0) {
        return jsonResponse(200, { token: null, total: 0, skipped: rows.length });
      }
      const results = filtered.map(r => ({
        filename: r.searchCode,
        searchCode: r.searchCode,
        lot: r.lot || null,
        product: r.product || null,
        coaLink: r.coaLink || null,
        error: null,
      }));
      const token = Math.random().toString(36).slice(2);
      pendingImports.set(token, results);
      setTimeout(() => pendingImports.delete(token), 5 * 60 * 1000);
      return jsonResponse(200, { token, total: results.length, skipped: rows.length - filtered.length });
    }

    if (pathname.endsWith('/bulk-import-results') && event.httpMethod === 'GET') {
      const token = pathname.split('/').pop();
      const results = token ? pendingImports.get(token) : null;
      if (!results) {
        return jsonResponse(404, { error: 'Import token not found or expired.' });
      }
      pendingImports.delete(token);
      return jsonResponse(200, { results });
    }

    if (pathname.endsWith('/import-ready') && event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      pendingToken = typeof body.token === 'string' && body.token.trim() ? body.token.trim() : null;
      return jsonResponse(200, { ok: true });
    }

    if (pathname.endsWith('/import-ready') && event.httpMethod === 'GET') {
      const token = pendingToken;
      pendingToken = null;
      return jsonResponse(200, { token });
    }

    if (pathname.endsWith('/bulk-import-coas') && event.httpMethod === 'POST') {
      const { codes } = JSON.parse(event.body || '{}');
      if (!Array.isArray(codes) || codes.length === 0) {
        return jsonResponse(400, { error: 'Provide a non-empty array of COA codes.' });
      }

      const CONCURRENCY = 5;
      const results = [];
      for (let i = 0; i < codes.length; i += CONCURRENCY) {
        const batch = codes.slice(i, i + CONCURRENCY);
        const batchResults = await Promise.all(batch.map(async (code) => {
          const filename = `${code}.pdf`;
          const pdfUrl = `${COA_BASE_URL}/${encodeURIComponent(filename)}`;
          try {
            const pdfRes = await fetch(pdfUrl, { signal: AbortSignal.timeout(15000) });
            if (!pdfRes.ok) throw new Error(`HTTP ${pdfRes.status}`);
            const buf = await pdfRes.arrayBuffer();
            const fileBytes = new Uint8Array(buf);
            const pdf = await extractText(fileBytes, { mergePages: true });
            const text = Array.isArray(pdf.text) ? pdf.text.join('\n') : pdf.text ?? '';
            const fields = parseFields(text, filename);
            return { filename, ...fields, error: null };
          } catch (err) {
            return { filename, searchCode: code, lot: null, product: null, coaLink: pdfUrl, error: err.message };
          }
        }));
        results.push(...batchResults);
      }

      return jsonResponse(200, { results, total: codes.length });
    }

    if (pathname.endsWith('/17track/sync') && event.httpMethod === 'POST') {
      if (!SEVENTEEN_TRACK_API_KEY) {
        return jsonResponse(500, { error: '17track API key not configured.' });
      }
      const body = JSON.parse(event.body || '{}');
      const { trackingItems } = body;
      if (!Array.isArray(trackingItems) || trackingItems.length === 0) {
        return jsonResponse(400, { error: 'No tracking numbers provided.' });
      }

      const CHUNK_SIZE = 40;
      const registerPayload = trackingItems.map(({ number, carrier }) => {
        const entry = { number };
        const code = CARRIER_CODES[carrier];
        if (code) entry.carrier = code;
        return entry;
      });

      const chunks = [];
      for (let i = 0; i < registerPayload.length; i += CHUNK_SIZE) {
        chunks.push(registerPayload.slice(i, i + CHUNK_SIZE));
      }

      const allAccepted = [];
      const allRejected = [];

      for (const chunk of chunks) {
        const regRes = await fetch('https://api.17track.net/track/v2.2/register', {
          method: 'POST',
          headers: { '17token': SEVENTEEN_TRACK_API_KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify(chunk),
          signal: AbortSignal.timeout(10000),
        });
        await regRes.json();

        await new Promise((r) => setTimeout(r, 1000));

        const infoRes = await fetch('https://api.17track.net/track/v2.2/gettrackinfo', {
          method: 'POST',
          headers: { '17token': SEVENTEEN_TRACK_API_KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify(chunk),
          signal: AbortSignal.timeout(10000),
        });

        if (!infoRes.ok) continue;

        const data = await infoRes.json();
        allAccepted.push(...(data?.data?.accepted || []));
        allRejected.push(...(data?.data?.rejected || []).map((r) => ({
          number: r.number,
          reason: r.error?.message || 'No data available',
        })));
      }

      const results = allAccepted.map((item) => {
        const latestStatus = item.track_info?.latest_status?.status || '';
        const subStatus = item.track_info?.latest_status?.sub_status || '';
        const isDelivered = latestStatus === 'Delivered';
        const latestEvent = item.track_info?.latest_event;
        const rawDesc = latestEvent?.description || '';
        const latestDesc = KNOWN_STATUSES.has(latestStatus) ? latestStatus : (rawDesc && isAscii(rawDesc) ? rawDesc : latestStatus);
        const detectedCarrier = CARRIER_CODE_NAMES[item.carrier] || null;
        const addr = item.track_info?.shipping_info?.recipient_address;
        const destination = addr ? [addr.city, addr.state, addr.country].filter(Boolean).join(', ') : null;
        const rawLocation = latestEvent?.location || '';
        const currentLocation = rawLocation && isAscii(rawLocation) ? rawLocation : null;
        const lastUpdated = latestEvent?.time_iso || null;
        const deliveryDate = isDelivered ? (lastUpdated || null) : null;
        const timeMetrics = item.track_info?.time_metrics;
        const estFrom = timeMetrics?.estimated_delivery_date?.from || null;
        const estTo = timeMetrics?.estimated_delivery_date?.to || null;
        const estimatedDelivery = !isDelivered ? (estTo || estFrom || null) : null;
        return { number: item.number, isDelivered, status: latestStatus, subStatus, latestDesc, detectedCarrier, destination, currentLocation, lastUpdated, deliveryDate, estimatedDelivery };
      });

      return jsonResponse(200, { results, rejected: allRejected });
    }

    if (pathname.endsWith('/17track/webhook') && event.httpMethod === 'POST') {
      // Optional shared secret check
      if (WEBHOOK_SECRET) {
        const provided = (event.queryStringParameters || {}).secret || '';
        if (provided !== WEBHOOK_SECRET) return jsonResponse(401, { error: 'Unauthorized.' });
      }

      const body = JSON.parse(event.body || '{}');
      const updates = Array.isArray(body.data) ? body.data : [];
      if (!updates.length) return jsonResponse(200, { ok: true, processed: 0 });

      const adminDb = getAdminDb();
      const snap = await adminDb.collection('c&pProductOrders').get();
      const orders = snap.docs.map(d => ({ id: d.id, ref: d.ref, ...d.data() }));

      let processed = 0;

      for (const update of updates) {
        const trackNum = String(update.number || '').trim();
        if (!trackNum) continue;

        const latestStatus = update.track_info?.latest_status?.status || '';
        const isDelivered = latestStatus === 'Delivered';
        const latestEvent = update.track_info?.latest_event;
        const rawDesc = latestEvent?.description || '';
        const latestDesc = KNOWN_STATUSES.has(latestStatus) ? latestStatus : (rawDesc && isAscii(rawDesc) ? rawDesc : latestStatus);
        const rawLocation = latestEvent?.location || '';
        const currentLocation = rawLocation && isAscii(rawLocation) ? rawLocation : null;
        const lastUpdated = latestEvent?.time_utc || null;
        const timeMetrics = update.track_info?.time_metrics;
        const estFrom = timeMetrics?.estimated_delivery_date?.from || null;
        const estTo = timeMetrics?.estimated_delivery_date?.to || null;
        const estimatedDelivery = !isDelivered ? (estTo || estFrom || null) : null;
        const deliveryDate = isDelivered ? lastUpdated : null;
        const pndPatch = { trackStatus: latestDesc || null, lastUpdated, currentLocation, estimatedDelivery, deliveryDate, rejected: null };

        for (const order of orders) {
          const entries = order.trackingEntries || [];
          let changed = false;

          const updatedEntries = entries.map(entry => {
            const nums = getTrackingNums(entry.number);
            if (!nums.includes(trackNum)) return entry;
            changed = true;
            const pnd = { ...(entry.perNumberData || {}), [trackNum]: { ...(entry.perNumberData?.[trackNum] || {}), ...pndPatch } };
            const pending = isDelivered
              ? [...new Set([...(entry.pendingDeliveryNumbers || []), trackNum])]
              : (entry.pendingDeliveryNumbers || []);
            return { ...entry, perNumberData: pnd, pendingDeliveryNumbers: pending };
          });

          if (changed) {
            await order.ref.update({ trackingEntries: updatedEntries });
            processed++;
          }
        }
      }

      return jsonResponse(200, { ok: true, processed });
    }

    return jsonResponse(404, { error: 'Not found.' });
  } catch (error) {
    return jsonResponse(500, {
      error: error?.message || 'Unhandled server error.',
    });
  }
};
