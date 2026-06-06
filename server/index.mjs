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

app.listen(PORT, () => {
  console.log(`API server running at http://localhost:${PORT}`);
  console.log(`Allowed browser origins: ${ALLOWED_ORIGINS.join(', ') || '(none)'}`);
});
