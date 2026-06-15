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
  const editRef = useRef(null);

  useEffect(() => {
    getDoc(CACHE_DOC)
      .then((snap) => {
        if (snap.exists()) {
          const data = snap.data();
          setProducts(data.products || []);
          setOverrides(data.overrides || {});
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
      const { products: data } = await r.json();
      const now = new Date();
      // merge: true preserves overrides across syncs
      await setDoc(CACHE_DOC, { products: data, lastSync: now }, { merge: true });
      setProducts(data || []);
      setLastSync(now);
    } catch (e) {
      setError(e.message);
    } finally {
      setSyncing(false);
    }
  }, []);

  const getVal = useCallback((p, field) => {
    const ov = overrides[p.id];
    if (ov && ov[field] !== undefined) return ov[field];
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
    return ['', ...Array.from(set).sort()];
  }, [products]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return products.filter((p) => {
      const matchSearch = !q || p.name.toLowerCase().includes(q);
      const matchCat = !categoryFilter || p.categories.includes(categoryFilter);
      return matchSearch && matchCat;
    });
  }, [products, search, categoryFilter]);

  const grouped = useMemo(() => {
    const sortFn = (a, b) => {
      let av = a[sortKey] ?? '';
      let bv = b[sortKey] ?? '';
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
      const cat = (overrides[p.id]?.category ?? p.categories[0]) || 'Uncategorized';
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat).push(p);
    });
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([cat, items]) => [cat, [...items].sort(sortFn)]);
  }, [filtered, sortKey, sortDir, overrides]);

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
        cleanName(p.name),
        getVal(p, 'mass'),
        getVal(p, 'category'),
        fmtPrice(p.regularPrice),
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
          <button className="woo-sync-btn" onClick={handleSync} disabled={syncing}>
            {syncing ? 'Syncing…' : 'Sync from WooCommerce'}
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
                <th className="woo-th-link">URL</th>
              </tr>
            </thead>
            <tbody>
              {grouped.length === 0 ? (
                <tr>
                  <td colSpan={5} className="woo-empty">No products found.</td>
                </tr>
              ) : grouped.map(([cat, items]) => (
                <>
                  <tr key={`cat-${cat}`} className="woo-group-row">
                    <td colSpan={5} className="woo-group-label">{cat}</td>
                  </tr>
                  {items.map((p) => (
                    <tr key={p.id} className="woo-row">
                      <td className="woo-td-name">{cleanName(p.name)}</td>
                      {renderEditableCell(p, 'mass', 'woo-td-mass')}
                      {renderEditableCell(p, 'category', 'woo-td-cat', categories.filter(Boolean))}
                      <td className="woo-td-price">{fmtPrice(p.regularPrice)}</td>
                      <td className="woo-td-link">
                        {p.permalink && (
                          <a href={p.permalink} target="_blank" rel="noreferrer" className="woo-permalink">
                            {p.permalink}
                          </a>
                        )}
                      </td>
                    </tr>
                  ))}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
