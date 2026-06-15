import express from 'express';
import multer from 'multer';
import { extractText } from 'unpdf';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 3031;
app.use(express.json());

const ALLOWED_ORIGINS = String(process.env.ALLOWED_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const isOriginAllowed = (origin) => {
  if (!origin) return true;
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return true;
  return ALLOWED_ORIGINS.includes(origin);
};

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (isOriginAllowed(origin)) {
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
  } else {
    res.status(403).json({ error: `Origin not allowed: ${origin}` });
    return;
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
});

// Store files in memory as Buffer
const upload = multer({ storage: multer.memoryStorage() });

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

const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID || '';
const PAYPAL_CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET || '';
const PAYPAL_MODE = (process.env.PAYPAL_MODE || 'sandbox').toLowerCase();
const PAYPAL_BASE_URL = PAYPAL_MODE === 'live'
  ? 'https://api-m.paypal.com'
  : 'https://api-m.sandbox.paypal.com';

const SEARCH_CODE_RE = /Coff\d+/i;
const LOT_RE = /CP[A-Z0-9]{6,}/;
const PURITY_RE = /\d{1,3}\.\d+%/;

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
    throw new Error('WooCommerce credentials missing. Set WOO_BASE_URL, WOO_CONSUMER_KEY, and WOO_CONSUMER_SECRET on the server.');
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
    throw new Error('WooCommerce credentials missing. Set WOO_BASE_URL, WOO_CONSUMER_KEY, and WOO_CONSUMER_SECRET on the server.');
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

const normalizeDateRange = (startInput, endInput) => {
  const startDate = getDateKey(startInput || new Date());
  const endDate = getDateKey(endInput || startDate);

  if (startDate <= endDate) {
    return { startDate, endDate };
  }

  return { startDate: endDate, endDate: startDate };
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
          _orderTotals: new Map(),
        });
      }

      const item = couponMap.get(key);
      if (orderId !== undefined && orderId !== null) {
        item._orderIds.add(orderId);
        if (!item._orderTotals.has(orderId)) {
          item._orderTotals.set(orderId, parseMoney(order?.total));
        }
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
    .map((coupon) => {
      const netSales = Array.from(coupon._orderTotals.values()).reduce((s, v) => s + v, 0);
      return {
        code: coupon.code,
        orderCount: coupon._orderIds.size,
        totalDiscount: Number(coupon.totalDiscount.toFixed(2)),
        netSales: Number(netSales.toFixed(2)),
      };
    })
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

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/api/woo/daily-report', async (req, res) => {
  try {
    const queryDate = req.query?.date || '';
    const queryStartDate = req.query?.startDate || queryDate;
    const queryEndDate = req.query?.endDate || queryDate;
    const { startDate, endDate } = normalizeDateRange(queryStartDate, queryEndDate);
    const [orders, analyticsSummary] = await Promise.all([
      fetchWooOrdersForRange(startDate, endDate),
      fetchWooAnalyticsSummaryForRange(startDate, endDate),
    ]);
    const report = buildDailyWooReport(orders, startDate, endDate, analyticsSummary);
    res.json(report);
  } catch (error) {
    res.status(500).json({
      error: error?.message || 'Failed to fetch Woo daily report.',
    });
  }
});

app.get('/api/woo/coupons', async (req, res) => {
  try {
    const collected = [];
    let page = 1;
    let totalPages = 1;

    do {
      const url = buildWooUrl('coupons', { per_page: 100, page });
      const response = await fetch(url, { signal: AbortSignal.timeout(WOO_REQUEST_TIMEOUT_MS) });
      if (!response.ok) {
        const body = await response.text();
        return res.status(response.status).json({ error: `Woo coupons API failed (${response.status}): ${body}` });
      }
      const rows = await response.json();
      if (!Array.isArray(rows)) break;
      collected.push(...rows);
      totalPages = Number.parseInt(response.headers.get('x-wp-totalpages') || '1', 10) || 1;
      page += 1;
    } while (page <= totalPages);

    res.json(collected.map((c) => ({
      id: c.id,
      code: String(c.code || '').toLowerCase().trim(),
      description: c.description || '',
      discountType: c.discount_type || '',
      amount: c.amount || '0',
      emailRestrictions: Array.isArray(c.email_restrictions) ? c.email_restrictions : [],
    })));
  } catch (error) {
    res.status(500).json({ error: error?.message || 'Failed to fetch coupons.' });
  }
});

app.get('/api/woo/products', async (_req, res) => {
  try {
    const allProducts = [];
    let page = 1;
    const perPage = 100;
    while (true) {
      const url = buildWooUrl('products', {
        per_page: perPage,
        page,
        status: 'publish',
        _fields: 'id,name,regular_price,sale_price,categories,permalink',
      });
      const response = await fetch(url, { signal: AbortSignal.timeout(WOO_REQUEST_TIMEOUT_MS) });
      if (!response.ok) {
        const body = await response.text();
        return res.status(response.status).json({ error: `WooCommerce products error: ${body}` });
      }
      const batch = await response.json();
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
      const total = parseInt(response.headers.get('x-wp-totalpages') || '1', 10) || 1;
      if (page >= total) break;
      page++;
    }
    res.json({ products: allProducts });
  } catch (error) {
    res.status(500).json({ error: error?.message || 'Failed to fetch products.' });
  }
});

app.post('/api/parse-pdf', upload.array('files'), async (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'No files uploaded.' });
  }

  const results = await Promise.all(
    req.files.map(async (file) => {
      try {
        const fileBytes = new Uint8Array(
          file.buffer.buffer,
          file.buffer.byteOffset,
          file.buffer.byteLength
        );
        const pdf = await extractText(fileBytes, { mergePages: true });
        const text = Array.isArray(pdf.text) ? pdf.text.join('\n') : pdf.text ?? '';
        const fields = parseFields(text, file.originalname);
        return { filename: file.originalname, ...fields, error: null };
      } catch (err) {
        return {
          filename: file.originalname,
          searchCode: null,
          lot: null,
          product: null,
          coaLink: `${COA_BASE_URL}/${encodeURIComponent(file.originalname)}`,
          error: err.message || 'Failed to parse PDF.',
        };
      }
    })
  );

  res.json({ results });
});

const getPayPalAccessToken = async () => {
  if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) {
    throw new Error('PayPal credentials missing. Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET in .env.');
  }
  const credentials = Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`).toString('base64');
  const response = await fetch(`${PAYPAL_BASE_URL}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`PayPal auth failed (${response.status}): ${body}`);
  }
  const data = await response.json();
  return data.access_token;
};

app.post('/api/paypal/payout', async (req, res) => {
  try {
    const { payments, startDate, endDate } = req.body || {};
    if (!Array.isArray(payments) || payments.length === 0) {
      return res.status(400).json({ error: 'No payments provided.' });
    }

    const invalidRecipient = payments.find((p) => !p.paypalEmail || !p.amount || Number(p.amount) <= 0);
    if (invalidRecipient) {
      return res.status(400).json({ error: `Invalid payment entry for ${invalidRecipient.name || 'unknown'}: paypalEmail and a positive amount are required.` });
    }

    const accessToken = await getPayPalAccessToken();
    const batchId = `aff-${Date.now()}`;
    const period = startDate === endDate ? startDate : `${startDate} to ${endDate}`;

    const payload = {
      sender_batch_header: {
        sender_batch_id: batchId,
        email_subject: 'Your affiliate commission has arrived',
        email_message: `Your affiliate commission for ${period} has been sent. Thank you!`,
      },
      items: payments.map((p, i) => ({
        recipient_type: 'EMAIL',
        amount: { value: Number(p.amount).toFixed(2), currency: 'USD' },
        receiver: p.paypalEmail,
        note: `Commission for ${period}${p.couponCodes?.length ? ` — codes: ${p.couponCodes.join(', ')}` : ''}`,
        sender_item_id: `${batchId}-${i}`,
      })),
    };

    const response = await fetch(`${PAYPAL_BASE_URL}/v1/payments/payouts`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30000),
    });

    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({
        error: data?.message || 'PayPal payout request failed.',
        details: data,
      });
    }

    res.json({
      success: true,
      batchId: data.batch_header?.payout_batch_id || batchId,
      status: data.batch_header?.batch_status || 'PENDING',
    });
  } catch (error) {
    res.status(500).json({ error: error?.message || 'Payout failed.' });
  }
});

const SEVENTEEN_TRACK_API_KEY = process.env.SEVENTEEN_TRACK_API_KEY || '';

// Map carrier names → 17track carrier codes (outbound)
const CARRIER_CODES = {
  FedEx: 100003,
  UPS: 100002,
  USPS: 21051,
  DHL: 100016,
};

// Map 17track carrier codes → our carrier names (inbound)
const CARRIER_CODE_NAMES = {
  100003: 'FedEx',
  100002: 'UPS',
  21051:  'USPS',
  100016: 'DHL',
};

app.post('/api/17track/sync', async (req, res) => {
  try {
    if (!SEVENTEEN_TRACK_API_KEY) {
      return res.status(500).json({ error: '17track API key not configured.' });
    }
    const { trackingItems } = req.body || {};
    if (!Array.isArray(trackingItems) || trackingItems.length === 0) {
      return res.status(400).json({ error: 'No tracking numbers provided.' });
    }

    // Use locally-detected carrier as a hint so 17track can register ambiguous formats
    // (e.g. FedEx 87... numbers that fail without a hint). The response carrier field
    // is still used for correction — the hint only aids registration, not detection.
    const registerPayload = trackingItems.map(({ number, carrier }) => {
      const entry = { number };
      const code = CARRIER_CODES[carrier];
      if (code) entry.carrier = code;
      return entry;
    });

    // Register numbers — 17track queues a fetch from the carrier
    const regRes = await fetch('https://api.17track.net/track/v2.2/register', {
      method: 'POST',
      headers: { '17token': SEVENTEEN_TRACK_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(registerPayload),
      signal: AbortSignal.timeout(15000),
    });
    const regData = await regRes.json();
    console.log('[17track] register response:', JSON.stringify(regData?.data || regData, null, 2));

    // Brief wait so 17track can fetch fresh data for newly-registered numbers
    await new Promise((r) => setTimeout(r, 3000));

    // Query tracking info
    const infoRes = await fetch('https://api.17track.net/track/v2.2/gettrackinfo', {
      method: 'POST',
      headers: { '17token': SEVENTEEN_TRACK_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(registerPayload),
      signal: AbortSignal.timeout(15000),
    });

    if (!infoRes.ok) {
      const text = await infoRes.text();
      return res.status(infoRes.status).json({ error: `17track API error: ${text}` });
    }

    const data = await infoRes.json();
    console.log('[17track] gettrackinfo response:', JSON.stringify(data?.data, null, 2));
    const accepted = data?.data?.accepted || [];
    const rejected = (data?.data?.rejected || []).map((r) => ({
      number: r.number,
      reason: r.error?.message || 'No data available',
    }));

    const isAscii = (s) => /^[\x00-\x7F]*$/.test(s);

    const results = accepted.map((item) => {
      const latestStatus = item.track_info?.latest_status?.status || '';
      const subStatus = item.track_info?.latest_status?.sub_status || '';
      const isDelivered = latestStatus === 'Delivered';
      const latestEvent = item.track_info?.latest_event;
      const rawDesc = latestEvent?.description || '';
      const KNOWN_STATUSES = new Set(['Delivered','InTransit','OutForDelivery','InfoReceived','FailedAttempt','Exception','Expired','NotFound']);
      const latestDesc = KNOWN_STATUSES.has(latestStatus) ? latestStatus : (rawDesc && isAscii(rawDesc) ? rawDesc : latestStatus);
      const detectedCarrier = CARRIER_CODE_NAMES[item.carrier] || null;

      const addr = item.track_info?.shipping_info?.recipient_address;
      const destination = addr
        ? [addr.city, addr.state, addr.country].filter(Boolean).join(', ')
        : null;

      const rawLocation = latestEvent?.location || '';
      const currentLocation = rawLocation && isAscii(rawLocation) ? rawLocation : null;

      const lastUpdated = latestEvent?.time_iso || null;
      const deliveryDate = isDelivered ? (lastUpdated || null) : null;

      const timeMetrics = item.track_info?.time_metrics;
      const estFrom = timeMetrics?.estimated_delivery_date?.from || null;
      const estTo = timeMetrics?.estimated_delivery_date?.to || null;
      const estimatedDelivery = !isDelivered ? (estTo || estFrom || null) : null;

      return {
        number: item.number,
        isDelivered,
        status: latestStatus,
        subStatus,
        latestDesc,
        detectedCarrier,
        destination,
        currentLocation,
        lastUpdated,
        deliveryDate,
        estimatedDelivery,
      };
    });

    res.json({ results, rejected });
  } catch (error) {
    res.status(500).json({ error: error?.message || '17track sync failed.' });
  }
});

app.listen(PORT, () => {
  console.log(`API server running at http://localhost:${PORT}`);
  console.log(`Allowed browser origins: ${ALLOWED_ORIGINS.join(', ') || '(none)'}`);
});
