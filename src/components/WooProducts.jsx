import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../firebaseConfig';
import './WooProducts.css';

const CACHE_DOC = doc(db, 'c&pCache', 'wooProducts');
const MASS_RE = /(\d+(?:\.\d+)?)\s*(mcg|mg|ml|g|iu)/i;
const TYPE_RE = /[\s\-–(]*(kit|single|bundle)([\s)]*)$/i;

function extractMass(name, categories = []) {
  const m = name.match(MASS_RE);
  if (m) return `${m[1]}${m[2].toLowerCase()}`;
  if (categories.some((c) => /amino/i.test(c))) return '20ml';
  return '';
}

function extractType(name) {
  const m = name.match(TYPE_RE);
  if (!m) return '';
  const t = m[1].toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function cleanName(name) {
  return name.replace(TYPE_RE, '').trim();
}

export default function WooProducts() {
  const [products, setProducts] = useState([]);
  const [overrides, setOverrides] = useState({});
  const [lastPulledNewIds, setLastPulledNewIds] = useState([]);
  const [lastSync, setLastSync] = useState(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [sortKey, setSortKey] = useState('name');
  const [sortDir, setSortDir] = useState('asc');
  const [copied, setCopied] = useState(false);
  const [editCell, setEditCell] = useState(null); // { id, field }
  const [editVal, setEditVal] = useState('');
  const [priceChanges, setPriceChanges] = useState(new Set());
  const editRef = useRef(null);

  useEffect(() => {
    getDoc(CACHE_DOC)
      .then((snap) => {
        if (snap.exists()) {
          const data = snap.data();
          setProducts(data.products || []);
          setOverrides(data.overrides || {});
          setLastPulledNewIds(Array.isArray(data.lastPulledNewIds) ? data.lastPulledNewIds.map((id) => String(id)) : []);
          setPriceChanges(new Set(Array.isArray(data.priceChanges) ? data.priceChanges.map((id) => String(id)) : []));
          setLastSync(data.lastSync?.toDate?.() || null);
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const handleSync = useCallback(async () => {
    setSyncing(true);
    setError(null);
    try {
      const r = await fetch('/api/woo/products');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const response = await r.json();
      const { products: data } = response;
      const now = new Date();

      console.log('\n========== FULL RESPONSE FROM API ==========');
      console.log('Complete response object:', response);
      console.log('Products array length:', data?.length || 0);
      if (data?.length > 0) {
        console.log('ALL products data:', JSON.stringify(data, null, 2));
        console.log('Sample product from WooCommerce:', data[0]);
        // Look for CP-3 RT in WooCommerce data
        const cp3rt = data.find(p => p.name?.includes('CP-3 RT') || p.name?.includes('CP-3') && p.name?.includes('10mg'));
        if (cp3rt) {
          console.log('🎯 Found CP-3 RT in WooCommerce:', cp3rt);
        } else {
          console.log('❌ CP-3 RT NOT found in WooCommerce data');
          console.log('WooCommerce product names containing "CP-3":', data.filter(p => p.name?.includes('CP-3')).map(p => p.name));
        }
      }

      // Track changes for highlighting
      const incomingById = new Map(Array.isArray(data) ? data.map((p) => [String(p.id), p]) : []);
      const incomingByName = new Map(Array.isArray(data) ? data.map((p) => [cleanName(p.name), p]) : []);
      const priceChanges = new Set();

      console.log('Local products count:', products.length);
      console.log('Incoming by ID map size:', incomingById.size);
      console.log('Incoming by Name map size:', incomingByName.size);

      // Update existing products (price + image) and track new ones
      const updatedProducts = products.map((existing) => {
        // Priority 1: match by stored WooCommerce ID
        let incoming = null;
        let matchType = 'none';
        if (existing.wooId) {
          incoming = incomingById.get(String(existing.wooId));
          if (incoming) matchType = 'by wooId';
        }

        // Priority 2: match by local ID (backwards compatibility)
        if (!incoming) {
          incoming = incomingById.get(String(existing.id));
          if (incoming) matchType = 'by ID';
        }

        // Priority 3: match by product name
        if (!incoming && existing.name) {
          incoming = incomingByName.get(cleanName(existing.name));
          if (incoming) matchType = 'by name';
        }

        if (matchType === 'by name' && existing.name && incoming?.regularPrice) {
          console.log(`Matched "${existing.name}" by name. Old price: ${existing.regularPrice}, New price: ${incoming.regularPrice}`);
        }

        if (!incoming) return existing;

        // Check if price changed
        const oldPrice = String(existing.regularPrice ?? '').trim();
        const newPrice = String(incoming.regularPrice ?? '').trim();

        if (existing.name?.includes('CP-3 RT 10mg')) {
          console.log(`🔍 CP-3 RT 10mg Kit PRICE DATA FROM WOOCOMMERCE:`);
          console.log(`   regularPrice: "${incoming.regularPrice}"`);
          console.log(`   salePrice: "${incoming.salePrice}"`);
          console.log(`   Local old price: "${oldPrice}"`);
          console.log(`   Using: "${newPrice}"`);
          console.log(`   Full incoming object:`, JSON.stringify(incoming, null, 2));
        }

        if (oldPrice !== newPrice && oldPrice && newPrice) {
          priceChanges.add(String(existing.id));
        }

        // Update price, image URL, and store WooCommerce ID for future matching
        // Use incoming prices as-is (even if empty/null) — we matched from WooCommerce so this is the source of truth
        return {
          ...existing,
          wooId: existing.wooId || incoming.id,
          regularPrice: incoming.regularPrice === undefined ? existing.regularPrice : incoming.regularPrice,
          salePrice: incoming.salePrice === undefined ? existing.salePrice : incoming.salePrice,
          imageUrl: incoming.imageUrl || existing.imageUrl || '',
          lastPriceSync: now.toISOString(),
        };
      });

      // Append truly new products
      const existingIds = new Set(products.map((p) => String(p.id)));
      const newProducts = Array.isArray(data) ? data.filter((p) => !existingIds.has(String(p.id))) : [];
      const mergedProducts = newProducts.length ? [...updatedProducts, ...newProducts] : updatedProducts;
      const newIds = newProducts.map((p) => String(p.id));

      // Mark both new and price-changed products for highlighting
      const highlightIds = Array.from(new Set([...lastPulledNewIds, ...newIds, ...priceChanges]));
      highlightIds.forEach((id) => {
        if (!lastPulledNewIds.includes(id)) {
          priceChanges.add(id);
        }
      });

      // merge: true preserves overrides across syncs
      await setDoc(
        CACHE_DOC,
        {
          products: mergedProducts,
          lastPulledNewIds: Array.from(new Set([...lastPulledNewIds, ...newIds])),
          priceChanges: Array.from(priceChanges),
          lastSync: now,
        },
        { merge: true }
      );
      // Update state with merged products (prices from WooCommerce)
      setProducts(mergedProducts);
      setLastPulledNewIds(Array.from(new Set([...lastPulledNewIds, ...newIds])));
      setLastSync(now);

      // Force reload from Firestore to ensure UI is current
      setTimeout(() => {
        getDoc(CACHE_DOC)
          .then((snap) => {
            if (snap.exists()) {
              const data = snap.data();
              console.log('🔄 Reloaded from Firestore - products count:', data.products?.length || 0);
              if (data.products) {
                setProducts(data.products);
              }
            }
          })
          .catch((e) => console.error('Error reloading:', e));
      }, 500);

      // Debug: check what we're saving
      console.log('Sample product after update:', mergedProducts[0]);
      const productsWithImages = mergedProducts.filter(p => p.imageUrl);
      console.log('Products with imageUrl:', productsWithImages.length, 'out of', mergedProducts.length);
    } catch (e) {
      setError(e.message);
    } finally {
      setSyncing(false);
    }
  }, [products, lastPulledNewIds]);

  const clearHighlights = useCallback(async () => {
    setLastPulledNewIds([]);
    setPriceChanges(new Set());
    await setDoc(CACHE_DOC, { lastPulledNewIds: [], priceChanges: [] }, { merge: true });
  }, []);

  const getVal = useCallback((p, field) => {
    const ov = overrides[p.id];
    if (ov && ov[field] !== undefined) return ov[field];
    if (field === 'name') return cleanName(p.name || '');
    if (field === 'regularPrice') return p.regularPrice || '';
    if (field === 'mass') return extractMass(p.name, p.categories);
    if (field === 'category') return p.categories.join(', ');
    return '';
  }, [overrides]);

  const startEdit = (p, field) => {
    setEditCell({ id: p.id, field });
    setEditVal(getVal(p, field));
    setTimeout(() => editRef.current?.select(), 0);
  };

  const commitEdit = useCallback(async (p) => {
    if (!editCell) return;
    const { id, field } = editCell;
    const newOverrides = {
      ...overrides,
      [id]: { ...(overrides[id] || {}), [field]: editVal.trim() },
    };
    setOverrides(newOverrides);
    setEditCell(null);
    await setDoc(CACHE_DOC, { overrides: newOverrides }, { merge: true });
  }, [editCell, editVal, overrides]);

  const cancelEdit = () => setEditCell(null);

  const categories = useMemo(() => {
    const set = new Set();
    products.forEach((p) => p.categories.forEach((c) => set.add(c)));
    Object.values(overrides).forEach((ov) => {
      if (ov?.category) set.add(String(ov.category).trim());
    });
    return ['', ...Array.from(set).sort()];
  }, [products, overrides]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return products.filter((p) => {
      const effectiveName = String(getVal(p, 'name') || '').toLowerCase();
      const effectiveCategory = String(getVal(p, 'category') || '');
      const matchSearch = !q || effectiveName.includes(q);
      const matchCat = !categoryFilter || effectiveCategory === categoryFilter || p.categories.includes(categoryFilter);
      return matchSearch && matchCat;
    });
  }, [products, search, categoryFilter, getVal]);

  const grouped = useMemo(() => {
    const sortFn = (a, b) => {
      let av = getVal(a, sortKey);
      let bv = getVal(b, sortKey);
      if (sortKey === 'regularPrice') {
        av = parseFloat(av) || 0;
        bv = parseFloat(bv) || 0;
        return sortDir === 'asc' ? av - bv : bv - av;
      }
      av = String(av).toLowerCase();
      bv = String(bv).toLowerCase();
      return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
    };
    const map = new Map();
    filtered.forEach((p) => {
      const cat = getVal(p, 'category') || p.categories[0] || 'Uncategorized';
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat).push(p);
    });
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([cat, items]) => [cat, [...items].sort(sortFn)]);
  }, [filtered, sortKey, sortDir, getVal]);

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
  };

  const SortIcon = ({ col }) => {
    if (sortKey !== col) return <span className="woo-sort-icon">↕</span>;
    return <span className="woo-sort-icon active">{sortDir === 'asc' ? '↑' : '↓'}</span>;
  };

  const fmtPrice = (val) => val ? `$${parseFloat(val).toFixed(2)}` : '—';
  const fmtSync = (d) => d ? d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : null;

  const handleCopy = useCallback(() => {
    const header = ['Name', 'Mass', 'Category', 'Price', 'URL'].join('\t');
    const rows = grouped.flatMap(([, items]) =>
      items.map((p) => [
        getVal(p, 'name'),
        getVal(p, 'mass'),
        getVal(p, 'category'),
        fmtPrice(getVal(p, 'regularPrice')),
        p.permalink || '',
      ].join('\t'))
    );
    navigator.clipboard.writeText([header, ...rows].join('\n')).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [grouped, getVal]);

  const renderEditableCell = (p, field, className, options = null) => {
    const isEditing = editCell?.id === p.id && editCell?.field === field;
    const val = getVal(p, field);
    if (isEditing) {
      if (options) {
        return (
          <td key={field} className={className}>
            <select
              ref={editRef}
              className="woo-cell-select"
              value={editVal}
              onChange={(e) => { setEditVal(e.target.value); }}
              onBlur={() => commitEdit(p)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitEdit(p);
                if (e.key === 'Escape') cancelEdit();
              }}
            >
              {options.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </td>
        );
      }
      return (
        <td key={field} className={className}>
          <input
            ref={editRef}
            className="woo-cell-input"
            value={editVal}
            onChange={(e) => setEditVal(e.target.value)}
            onBlur={() => commitEdit(p)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitEdit(p);
              if (e.key === 'Escape') cancelEdit();
            }}
          />
        </td>
      );
    }
    return (
      <td
        key={field}
        className={`${className} woo-editable`}
        onClick={() => startEdit(p, field)}
        title="Click to edit"
      >
        {val || <span className="woo-cell-empty">—</span>}
      </td>
    );
  };

  if (loading) return (
    <div className="woo-products-wrap">
      <div className="woo-products-loading">Loading products…</div>
    </div>
  );

  return (
    <div className="woo-products-wrap">
      <div className="woo-products-header">
        <div className="woo-products-title">
          <h2>Products</h2>
          {products.length > 0 && (
            <span className="woo-products-count">{filtered.length} of {products.length}</span>
          )}
          {lastPulledNewIds.length > 0 && (
            <span className="woo-new-count">{lastPulledNewIds.length} new</span>
          )}
        </div>
        <div className="woo-products-filters">
          {products.length > 0 && (
            <>
              <input
                className="woo-search"
                type="text"
                placeholder="Search products…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <select
                className="woo-cat-select"
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
              >
                {categories.map((c) => (
                  <option key={c} value={c}>{c || 'All categories'}</option>
                ))}
              </select>
              <button className={`woo-copy-btn${copied ? ' copied' : ''}`} onClick={handleCopy}>
                {copied ? 'Copied!' : 'Copy for Sheets'}
              </button>
            </>
          )}
          {lastPulledNewIds.length > 0 && (
            <button className="woo-clear-new-btn" onClick={clearHighlights}>
              Clear Highlights
            </button>
          )}
          <button className="woo-sync-btn" onClick={handleSync} disabled={syncing}>
            {syncing ? 'Syncing…' : 'Pull New from WooCommerce'}
          </button>
        </div>
      </div>

      {error && <div className="woo-products-error">{error}</div>}

      {lastSync && (
        <div className="woo-last-sync">Last synced: {fmtSync(lastSync)}</div>
      )}

      {products.length === 0 && !error ? (
        <div className="woo-products-empty-state">
          No products yet. Click <strong>Sync from WooCommerce</strong> to pull your product catalog.
        </div>
      ) : (
        <div className="woo-table-wrap">
          <table className="woo-table">
            <thead>
              <tr>
                <th className="woo-th-name" onClick={() => toggleSort('name')}>
                  Name <SortIcon col="name" />
                </th>
                <th className="woo-th-mass">Mass</th>
                <th className="woo-th-cat">Category</th>
                <th className="woo-th-price" onClick={() => toggleSort('regularPrice')}>
                  Price <SortIcon col="regularPrice" />
                </th>
                <th className="woo-th-wooid">Woo ID</th>
                <th className="woo-th-image">Image URL</th>
                <th className="woo-th-link">URL</th>
              </tr>
            </thead>
            <tbody>
              {grouped.length === 0 ? (
                <tr>
                  <td colSpan={7} className="woo-empty">No products found.</td>
                </tr>
              ) : grouped.map(([cat, items]) => (
                <>
                  <tr key={`cat-${cat}`} className="woo-group-row">
                    <td colSpan={7} className="woo-group-label">{cat}</td>
                  </tr>
                  {items.map((p) => {
                    const isNew = lastPulledNewIds.includes(String(p.id));
                    const isPriceChanged = priceChanges.has(String(p.id));
                    const isEditingName = editCell?.id === p.id && editCell?.field === 'name';
                    const nameVal = getVal(p, 'name');
                    return (
                      <tr key={p.id} className={`woo-row${isNew ? ' woo-row-new' : ''}${isPriceChanged ? ' woo-row-price-changed' : ''}`}>
                        <td
                          className="woo-td-name woo-editable"
                          onClick={() => startEdit(p, 'name')}
                          title="Click to edit"
                        >
                          <div className="woo-name-with-badge">
                            {isEditingName ? (
                              <input
                                ref={editRef}
                                className="woo-cell-input"
                                value={editVal}
                                onChange={(e) => setEditVal(e.target.value)}
                                onBlur={() => commitEdit(p)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') commitEdit(p);
                                  if (e.key === 'Escape') cancelEdit();
                                }}
                              />
                            ) : (
                              <>
                                <span>{nameVal || <span className="woo-cell-empty">—</span>}</span>
                                {isPriceChanged && <span className="woo-price-changed-badge">↑ PRICE</span>}
                              </>
                            )}
                          </div>
                        </td>
                        {renderEditableCell(p, 'mass', 'woo-td-mass')}
                        {renderEditableCell(p, 'category', 'woo-td-cat', categories.filter(Boolean))}
                        {renderEditableCell(p, 'regularPrice', 'woo-td-price')}
                        <td className="woo-td-wooid">
                          {p.wooId ? <span className="woo-id-value">{p.wooId}</span> : <span className="woo-no-id">—</span>}
                        </td>
                        <td className="woo-td-image">
                          {p.imageUrl ? (
                            <a href={p.imageUrl} target="_blank" rel="noreferrer" className="woo-image-url" title="View image">
                              {p.imageUrl.substring(0, 40)}...
                            </a>
                          ) : (
                            <span className="woo-no-image">—</span>
                          )}
                        </td>
                        <td className="woo-td-link">
                          {p.permalink && (
                            <a href={p.permalink} target="_blank" rel="noreferrer" className="woo-permalink">
                              {p.permalink}
                            </a>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
