import { useState, useRef, useCallback, useEffect } from 'react';
import { collection, doc, setDoc, deleteDoc, onSnapshot, orderBy, query, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebaseConfig';
import './CoaLookup.css';

const COA_COLLECTION = 'c&pCOA';

const PRODUCT_MAP = {
  'retatrutide': 'CP-3 RT',
  'tirzepatide': 'CP-2 TZ',
};

const normalizeProduct = (product) => {
  if (!product) return product;
  return PRODUCT_MAP[product.toLowerCase().trim()] ?? product;
};

const STATUS = {
  PROCESSING: 'processing',
  DONE: 'done',
  ERROR: 'error',
};

function buildInitialRows(files) {
  return Array.from(files).map((file) => ({
    id: `${file.name}-${file.lastModified}`,
    filename: file.name,
    searchCode: null,
    lot: null,
    product: null,
    coaLink: null,
    status: STATUS.PROCESSING,
    error: null,
  }));
}

function CoaLinkCell({ coaLink, rowId, copiedRowId, onCopy }) {
  if (!coaLink) return <span className="coa-empty">—</span>;
  return (
    <div className="coa-link-actions">
      <a href={coaLink} target="_blank" rel="noopener noreferrer" className="coa-link">
        View COA ↗
      </a>
      <button type="button" className="coa-copy-btn" onClick={() => onCopy(coaLink, rowId)}>
        Copy Link
      </button>
      {copiedRowId === rowId && <span className="coa-copy-feedback">Copied</span>}
    </div>
  );
}

export default function CoaLookup() {
  const [rows, setRows] = useState([]);
  const [dragging, setDragging] = useState(false);
  const [copiedRowId, setCopiedRowId] = useState(null);
  const [savedCoas, setSavedCoas] = useState([]);
  const [search, setSearch] = useState('');
  const [savingIds, setSavingIds] = useState(new Set());
  const [deletingIds, setDeletingIds] = useState(new Set());
  const [importing, setImporting] = useState(false);
  const [sourceFilter, setSourceFilter] = useState('all');
  const [sortBy, setSortBy] = useState('product');
  const [savedCodeSync, setSavedCodeSync] = useState({
    status: 'idle',
    count: 0,
    lastSyncedAt: null,
    error: '',
  });
  const fileInputRef = useRef(null);
  const importInFlightRef = useRef(false);

  useEffect(() => {
    const q = query(collection(db, COA_COLLECTION), orderBy('uploadedAt', 'desc'));
    const unsub = onSnapshot(q, (snap) => {
      setSavedCoas(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    }, (err) => {
      console.error('COA snapshot error:', err);
    });
    return unsub;
  }, []);

  const processFiles = useCallback(async (files) => {
    if (!files || files.length === 0) return;

    const pdfFiles = Array.from(files).filter(
      (f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')
    );
    if (pdfFiles.length === 0) return;

    const newRows = buildInitialRows(pdfFiles);
    setRows((prev) => [...prev, ...newRows]);

    const formData = new FormData();
    pdfFiles.forEach((file) => formData.append('files', file));

    try {
      const res = await fetch('/api/parse-pdf', { method: 'POST', body: formData });
      if (!res.ok) {
        setRows((prev) =>
          prev.map((row) => {
            if (!newRows.find((r) => r.id === row.id)) return row;
            return { ...row, status: STATUS.ERROR, error: `Server error: ${res.status}` };
          })
        );
        return;
      }
      const data = await res.json();
      const resultMap = Object.fromEntries((data.results || []).map((r) => [r.filename, r]));

      setRows((prev) =>
        prev.map((row) => {
          if (!newRows.find((r) => r.id === row.id)) return row;
          const result = resultMap[row.filename];
          if (!result) return { ...row, status: STATUS.ERROR, error: 'No result returned.' };
          if (result.error) return { ...row, status: STATUS.ERROR, error: result.error };
          return {
            ...row,
            searchCode: result.searchCode,
            lot: result.lot,
            product: result.product,
            coaLink: result.coaLink,
            status: STATUS.DONE,
          };
        })
      );
    } catch (err) {
      setRows((prev) =>
        prev.map((row) => {
          if (!newRows.find((r) => r.id === row.id)) return row;
          return { ...row, status: STATUS.ERROR, error: err.message || 'Network error.' };
        })
      );
    }
  }, []);

  const saveRow = async (row) => {
    if (!row.searchCode) return;
    setSavingIds((prev) => new Set(prev).add(row.id));
    try {
      await setDoc(doc(db, COA_COLLECTION, row.searchCode), {
        filename: row.filename,
        searchCode: row.searchCode,
        lot: row.lot ?? null,
        product: normalizeProduct(row.product) ?? null,
        coaLink: row.coaLink ?? null,
        uploadedAt: serverTimestamp(),
      });
    } catch (err) {
      console.error('COA save failed:', err);
    } finally {
      setSavingIds((prev) => { const s = new Set(prev); s.delete(row.id); return s; });
    }
  };

  const importCodes = async (codes) => {
    setImporting(true);
    try {
      const res = await fetch('/api/bulk-import-coas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codes }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.error || `Import failed (${res.status})`);
        return;
      }
      const data = await res.json();
      const importedRows = (data.results || []).map((r) => ({
        id: `import-${r.filename}-${Date.now()}-${Math.random()}`,
        filename: r.filename,
        searchCode: r.searchCode,
        lot: r.lot,
        product: r.product,
        coaLink: r.coaLink,
        status: r.error ? STATUS.ERROR : STATUS.DONE,
        error: r.error || null,
      }));
      setRows((prev) => {
        const existingCodes = new Set(prev.map((r) => r.searchCode).filter(Boolean));
        return [...prev, ...importedRows.filter((r) => !existingCodes.has(r.searchCode))];
      });
    } catch (err) {
      alert(err.message || 'Network error during import.');
    } finally {
      setImporting(false);
    }
  };

  const loadImportToken = useCallback(async (token, options = {}) => {
    const { silent = false } = options;
    if (importInFlightRef.current) return;
    if (typeof token !== 'string' || token.trim() === '') {
      if (!silent) alert('Nothing new to import — all COAs are already saved.');
      return;
    }
    importInFlightRef.current = true;
    setImporting(true);
    try {
      const r = await fetch(`/api/bulk-import-results/${token}`);
      if (!r.ok) {
        if (!silent) {
          const err = await r.json().catch(() => ({}));
          alert(err.error || `Failed to load import results (${r.status}).`);
        }
        return;
      }
      const data = await r.json();
      if (data.error) {
        if (!silent) alert(data.error);
        return;
      }
      const importedRows = (data.results || []).map((r) => ({
        id: `import-${r.filename}-${Math.random()}`,
        filename: r.filename,
        searchCode: r.searchCode,
        lot: r.lot,
        product: r.product,
        coaLink: r.coaLink,
        status: r.error ? STATUS.ERROR : STATUS.DONE,
        error: r.error || null,
      }));
      setRows((prev) => {
        const existingCodes = new Set(prev.map((r) => r.searchCode).filter(Boolean));
        return [...prev, ...importedRows.filter((r) => !existingCodes.has(r.searchCode))];
      });
    } catch (err) {
      if (!silent) alert(err.message || 'Failed to load import results.');
    } finally {
      setImporting(false);
      importInFlightRef.current = false;
    }
  }, []);

  // Poll for a pending import token posted by the Freedom Diagnostics console script
  useEffect(() => {
    const interval = setInterval(async () => {
      if (importInFlightRef.current) return;
      try {
        const r = await fetch('/api/import-ready');
        if (!r.ok) return;
        const data = await r.json();
        if (typeof data.token === 'string' && data.token.trim() !== '') {
          loadImportToken(data.token, { silent: true });
        }
      } catch {}
    }, 2000);
    return () => clearInterval(interval);
  }, [loadImportToken]);

  const saveAll = async (savedCodes) => {
    const unsaved = rows.filter(
      (r) => r.status === STATUS.DONE && r.searchCode && !savedCodes.has(r.searchCode)
    );
    await Promise.all(unsaved.map(saveRow));
  };

  const deleteSaved = async (coaId) => {
    setDeletingIds((prev) => new Set(prev).add(coaId));
    try {
      await deleteDoc(doc(db, COA_COLLECTION, coaId));
    } catch (err) {
      console.error('COA delete failed:', err);
    } finally {
      setDeletingIds((prev) => { const s = new Set(prev); s.delete(coaId); return s; });
    }
  };

  const onFileInputChange = (e) => { processFiles(e.target.files); e.target.value = ''; };
  const onDragOver = (e) => { e.preventDefault(); setDragging(true); };
  const onDragLeave = (e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false); };
  const onDrop = (e) => { e.preventDefault(); setDragging(false); processFiles(e.dataTransfer.files); };

  const copyToClipboard = async (text, rowId) => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const temp = document.createElement('textarea');
        temp.value = text;
        temp.setAttribute('readonly', '');
        temp.style.cssText = 'position:absolute;left:-9999px';
        document.body.appendChild(temp);
        temp.select();
        document.execCommand('copy');
        document.body.removeChild(temp);
      }
      setCopiedRowId(rowId);
      window.setTimeout(() => setCopiedRowId((c) => (c === rowId ? null : c)), 1500);
    } catch {
      setCopiedRowId(null);
    }
  };

  const savedSearchCodes = new Set(savedCoas.map((c) => c.searchCode));

  // Silently fix any records with un-normalized product names
  useEffect(() => {
    const stale = savedCoas.filter(c => c.product && normalizeProduct(c.product) !== c.product);
    stale.forEach(c => {
      setDoc(doc(db, COA_COLLECTION, c.id), { product: normalizeProduct(c.product) }, { merge: true })
        .catch(() => {});
    });
  }, [savedCoas]);

  // Keep local server in sync with saved codes so bulk-import can skip them automatically
  useEffect(() => {
    const codes = savedCoas.map((c) => c.searchCode).filter(Boolean);
    let cancelled = false;
    let retryTimer = null;

    const syncCodes = async (attempt = 0) => {
      if (cancelled) return;
      if (attempt === 0) {
        setSavedCodeSync((prev) => ({ ...prev, status: 'syncing', error: '' }));
      }
      try {
        const response = await fetch('/api/coa-saved-codes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ codes }),
        });
        if (!response.ok) {
          throw new Error(`Sync failed (${response.status})`);
        }
        const data = await response.json().catch(() => ({}));
        if (cancelled) return;
        setSavedCodeSync({
          status: 'ok',
          count: Number(data.count ?? codes.length) || 0,
          lastSyncedAt: Date.now(),
          error: '',
        });
      } catch (err) {
        if (cancelled) return;
        if (attempt < 2) {
          retryTimer = setTimeout(() => {
            syncCodes(attempt + 1);
          }, 800 * (attempt + 1));
          return;
        }
        setSavedCodeSync((prev) => ({
          ...prev,
          status: 'error',
          error: err?.message || 'Failed to sync saved COA codes.',
        }));
      }
    };

    syncCodes();

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [savedCoas]);

  const copyCsv = async (rows) => {
    const headers = ['Search Code', 'Product', 'LOT', 'COA Link'];
    const escape = (v) => `"${(v ?? '').toString().replace(/"/g, '""')}"`;
    const lines = [headers.join('\t'), ...rows.map(r => [r.searchCode, r.product, r.lot, r.coaLink].map(escape).join('\t'))];
    await navigator.clipboard.writeText(lines.join('\n'));
  };

  const coffDate = (searchCode) => {
    const m = searchCode?.match(/Coff(\d{2})(\d{2})(\d{2})/i);
    return m ? parseInt(`20${m[1]}${m[2]}${m[3]}`, 10) : 0;
  };

  const filteredSaved = savedCoas
    .filter((c) => {
      if (sourceFilter === 'freedom' && !c.searchCode?.toLowerCase().startsWith('coff')) return false;
      if (sourceFilter === 'kovera' && !c.searchCode?.toLowerCase().startsWith('kvr')) return false;
      const q = search.toLowerCase();
      return (
        !q ||
        c.searchCode?.toLowerCase().includes(q) ||
        c.lot?.toLowerCase().includes(q) ||
        c.product?.toLowerCase().includes(q) ||
        c.filename?.toLowerCase().includes(q)
      );
    })
    .sort((a, b) => {
      if (sortBy === 'date-desc') return coffDate(b.searchCode) - coffDate(a.searchCode);
      if (sortBy === 'date-asc') return coffDate(a.searchCode) - coffDate(b.searchCode);
      return (a.product ?? '').localeCompare(b.product ?? '');
    });

  return (
    <div className="coa-lookup-container">
      <div className="coa-lookup-header">
        <div className="coa-lookup-title-row">
          <h2 className="coa-lookup-title">COA Lookup</h2>
          <button
            className="coa-import-btn"
            onClick={() => window.open('https://freedomdiagnosticstesting.com/search-for-your-coa-based-on-the-unique-accession-number/', '_blank')}
          >
            Open Freedom Diagnostics ↗
          </button>
          {importing && <span className="coa-importing-badge">Importing…</span>}
        </div>
        <p className="coa-lookup-subtitle">
          Upload PDFs to extract Search Code, LOT, and Product details.
        </p>
        <div className="coa-sync-status-row">
          <span className={`coa-sync-badge coa-sync-badge--${savedCodeSync.status}`}>
            Saved-code sync: {savedCodeSync.status === 'ok' ? 'Ready' : savedCodeSync.status === 'error' ? 'Error' : savedCodeSync.status === 'syncing' ? 'Syncing…' : 'Idle'}
          </span>
          <span className="coa-sync-meta">Tracked saved COAs: {savedCodeSync.count}</span>
          {savedCodeSync.lastSyncedAt && (
            <span className="coa-sync-meta">
              Last sync: {new Date(savedCodeSync.lastSyncedAt).toLocaleTimeString()}
            </span>
          )}
          {savedCodeSync.status === 'error' && savedCodeSync.error && (
            <span className="coa-sync-error">{savedCodeSync.error}</span>
          )}
        </div>
      </div>

      <div
        className={`coa-drop-zone ${dragging ? 'dragging' : ''}`}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onClick={() => fileInputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && fileInputRef.current?.click()}
        aria-label="Drop PDF files here or click to select"
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,application/pdf"
          multiple
          className="coa-file-input"
          onChange={onFileInputChange}
        />
        <div className="coa-drop-icon">📄</div>
        <p className="coa-drop-text">
          Drag &amp; drop PDFs here, or <span className="coa-drop-link">click to select</span>
        </p>
        <p className="coa-drop-hint">Multiple files supported</p>
      </div>

      {rows.some((r) => !savedSearchCodes.has(r.searchCode)) && (
        <div className="coa-results-section">
          <div className="coa-results-toolbar">
            <span className="coa-results-count">
              {rows.filter((r) => !savedSearchCodes.has(r.searchCode)).length} file{rows.filter((r) => !savedSearchCodes.has(r.searchCode)).length !== 1 ? 's' : ''}
            </span>
            <div className="coa-toolbar-actions">
              {rows.some((r) => r.status === STATUS.DONE && r.searchCode && !savedSearchCodes.has(r.searchCode)) && (
                <button className="coa-save-btn" onClick={() => saveAll(savedSearchCodes)}>Save All</button>
              )}
              <button className="coa-clear-btn" onClick={() => { setRows([]); setCopiedRowId(null); }}>Clear</button>
            </div>
          </div>
          <div className="coa-table-wrapper">
            <table className="coa-table">
              <thead>
                <tr>
                  <th>File</th>
                  <th>Search Code</th>
                  <th>LOT</th>
                  <th>Product</th>
                  <th>COA Link</th>
                  <th>Save</th>
                </tr>
              </thead>
              <tbody>
                {rows.filter((row) => !savedSearchCodes.has(row.searchCode)).map((row) => {
                  const alreadySaved = row.searchCode && savedSearchCodes.has(row.searchCode);
                  const isSaving = savingIds.has(row.id);
                  return (
                    <tr key={row.id} className={`coa-row coa-row--${row.status}`}>
                      <td className="coa-cell coa-cell--filename" title={row.filename}>{row.filename}</td>
                      <td className="coa-cell">
                        {row.status === STATUS.PROCESSING ? <span className="coa-processing">Processing…</span> : (row.searchCode ?? <span className="coa-empty">—</span>)}
                      </td>
                      <td className="coa-cell">
                        {row.status === STATUS.PROCESSING ? <span className="coa-processing">Processing…</span> : (row.lot ?? <span className="coa-empty">—</span>)}
                      </td>
                      <td className="coa-cell coa-cell--product">
                        {row.status === STATUS.PROCESSING ? <span className="coa-processing">Processing…</span> : (row.product ?? <span className="coa-empty">—</span>)}
                      </td>
                      <td className="coa-cell">
                        {row.status === STATUS.PROCESSING ? (
                          <span className="coa-processing">Processing…</span>
                        ) : (
                          <CoaLinkCell coaLink={row.coaLink} rowId={row.id} copiedRowId={copiedRowId} onCopy={copyToClipboard} />
                        )}
                      </td>
                      <td className="coa-cell">
                        {row.status === STATUS.PROCESSING && <span className="coa-empty">—</span>}
                        {row.status === STATUS.ERROR && <span className="coa-empty">—</span>}
                        {row.status === STATUS.DONE && alreadySaved && (
                          <span className="coa-badge coa-badge--saved">Already Saved</span>
                        )}
                        {row.status === STATUS.DONE && !alreadySaved && (
                          <button
                            type="button"
                            className="coa-save-btn"
                            disabled={isSaving}
                            onClick={() => saveRow(row)}
                          >
                            {isSaving ? 'Saving…' : 'Save'}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="coa-saved-section">
        <div className="coa-saved-header">
          <div className="coa-saved-title-row">
            <h3 className="coa-saved-title">Saved COAs</h3>
            <span className="coa-saved-count">{filteredSaved.length}{search || sourceFilter !== 'all' ? ` of ${savedCoas.length}` : ''}</span>
            <button
              className="coa-source-btn"
              onClick={async (e) => {
                await copyCsv(filteredSaved);
                const btn = e.currentTarget;
                btn.textContent = 'Copied!';
                setTimeout(() => { btn.textContent = 'Copy CSV'; }, 1500);
              }}
            >
              Copy CSV
            </button>
            <div className="coa-source-filter">
              {['all', 'freedom', 'kovera'].map((s) => (
                <button
                  key={s}
                  className={`coa-source-btn${sourceFilter === s ? ' active' : ''}`}
                  onClick={() => { setSourceFilter(s); if (s !== 'freedom') setSortBy('product'); }}
                >
                  {s === 'all' ? 'All' : s === 'freedom' ? 'Freedom' : 'Kovera'}
                </button>
              ))}
            </div>
            {sourceFilter === 'freedom' && (
              <div className="coa-source-filter">
                {[['product', 'A–Z'], ['date-desc', 'Newest'], ['date-asc', 'Oldest']].map(([val, label]) => (
                  <button
                    key={val}
                    className={`coa-source-btn${sortBy === val ? ' active' : ''}`}
                    onClick={() => setSortBy(val)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <input
            className="coa-search-input"
            type="text"
            placeholder="Search by product, lot, search code…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {savedCoas.length === 0 ? (
          <p className="coa-saved-empty">No COAs saved yet. Upload PDFs above to get started.</p>
        ) : filteredSaved.length === 0 ? (
          <p className="coa-saved-empty">No results match "{search}".</p>
        ) : (
          <div className="coa-table-wrapper">
            <table className="coa-table">
              <thead>
                <tr>
                  <th>Search Code</th>
                  <th>LOT</th>
                  <th>Product</th>
                  <th>COA Link</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filteredSaved.map((coa) => (
                  <tr key={coa.id} className="coa-row">
                    <td className="coa-cell">{coa.searchCode ?? <span className="coa-empty">—</span>}</td>
                    <td className="coa-cell">{coa.lot ?? <span className="coa-empty">—</span>}</td>
                    <td className="coa-cell coa-cell--product">{coa.product ?? <span className="coa-empty">—</span>}</td>
                    <td className="coa-cell">
                      <CoaLinkCell coaLink={coa.coaLink} rowId={coa.id} copiedRowId={copiedRowId} onCopy={copyToClipboard} />
                    </td>
                    <td className="coa-cell coa-cell--action">
                      <button
                        type="button"
                        className="coa-delete-btn"
                        disabled={deletingIds.has(coa.id)}
                        onClick={() => deleteSaved(coa.id)}
                        title="Delete"
                      >
                        {deletingIds.has(coa.id) ? '…' : '✕'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

    </div>
  );
}
