import { useState, useRef, useCallback, useEffect } from 'react';
import { collection, doc, setDoc, deleteDoc, onSnapshot, orderBy, query, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebaseConfig';
import './CoaLookup.css';

const COA_COLLECTION = 'c&pCOA';

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
  const fileInputRef = useRef(null);

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
        product: row.product ?? null,
        coaLink: row.coaLink ?? null,
        uploadedAt: serverTimestamp(),
      });
    } catch (err) {
      console.error('COA save failed:', err);
    } finally {
      setSavingIds((prev) => { const s = new Set(prev); s.delete(row.id); return s; });
    }
  };

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

  const filteredSaved = savedCoas.filter((c) => {
    const q = search.toLowerCase();
    return (
      !q ||
      c.searchCode?.toLowerCase().includes(q) ||
      c.lot?.toLowerCase().includes(q) ||
      c.product?.toLowerCase().includes(q) ||
      c.filename?.toLowerCase().includes(q)
    );
  });

  return (
    <div className="coa-lookup-container">
      <div className="coa-lookup-header">
        <h2 className="coa-lookup-title">COA Lookup</h2>
        <p className="coa-lookup-subtitle">
          Upload PDFs to extract Search Code, LOT, and Product details.
        </p>
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

      {rows.length > 0 && (
        <div className="coa-results-section">
          <div className="coa-results-toolbar">
            <span className="coa-results-count">{rows.length} file{rows.length !== 1 ? 's' : ''}</span>
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
                {rows.map((row) => {
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
            <span className="coa-saved-count">{filteredSaved.length}{search ? ` of ${savedCoas.length}` : ''}</span>
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
