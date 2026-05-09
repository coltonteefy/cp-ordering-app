import { useState, useRef, useCallback } from 'react';
import './CoaLookup.css';

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

export default function CoaLookup() {
  const [rows, setRows] = useState([]);
  const [dragging, setDragging] = useState(false);
  const [copiedRowId, setCopiedRowId] = useState(null);
  const fileInputRef = useRef(null);

  const processFiles = useCallback(async (files) => {
    if (!files || files.length === 0) return;

    const pdfFiles = Array.from(files).filter(
      (f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')
    );
    if (pdfFiles.length === 0) return;

    const newRows = buildInitialRows(pdfFiles);
    setRows((prev) => [...prev, ...newRows]);

    // Upload all files in one request
    const formData = new FormData();
    pdfFiles.forEach((file) => formData.append('files', file));

    try {
      const res = await fetch('/api/parse-pdf', { method: 'POST', body: formData });
      if (!res.ok) {
        const errText = await res.text();
        setRows((prev) =>
          prev.map((row) => {
            const match = newRows.find((r) => r.id === row.id);
            if (!match) return row;
            return { ...row, status: STATUS.ERROR, error: `Server error: ${res.status}` };
          })
        );
        return;
      }
      const data = await res.json();
      const resultMap = Object.fromEntries(
        (data.results || []).map((r) => [r.filename, r])
      );
      setRows((prev) =>
        prev.map((row) => {
          const match = newRows.find((r) => r.id === row.id);
          if (!match) return row;
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
          const match = newRows.find((r) => r.id === row.id);
          if (!match) return row;
          return { ...row, status: STATUS.ERROR, error: err.message || 'Network error.' };
        })
      );
    }
  }, []);

  const handleFiles = (files) => processFiles(files);

  const onFileInputChange = (e) => {
    handleFiles(e.target.files);
    e.target.value = '';
  };

  const onDragOver = (e) => {
    e.preventDefault();
    setDragging(true);
  };

  const onDragLeave = (e) => {
    if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false);
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    handleFiles(e.dataTransfer.files);
  };

  const copyToClipboard = async (text, rowId) => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const temp = document.createElement('textarea');
        temp.value = text;
        temp.setAttribute('readonly', '');
        temp.style.position = 'absolute';
        temp.style.left = '-9999px';
        document.body.appendChild(temp);
        temp.select();
        document.execCommand('copy');
        document.body.removeChild(temp);
      }
      setCopiedRowId(rowId);
      window.setTimeout(() => {
        setCopiedRowId((current) => (current === rowId ? null : current));
      }, 1500);
    } catch {
      setCopiedRowId(null);
    }
  };

  const clearResults = () => {
    setRows([]);
    setCopiedRowId(null);
  };

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
            <button className="coa-clear-btn" onClick={clearResults}>Clear</button>
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
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className={`coa-row coa-row--${row.status}`}>
                    <td className="coa-cell coa-cell--filename" title={row.filename}>
                      {row.filename}
                    </td>
                    <td className="coa-cell">
                      {row.status === STATUS.PROCESSING ? (
                        <span className="coa-processing">Processing…</span>
                      ) : (
                        row.searchCode ?? <span className="coa-empty">—</span>
                      )}
                    </td>
                    <td className="coa-cell">
                      {row.status === STATUS.PROCESSING ? (
                        <span className="coa-processing">Processing…</span>
                      ) : (
                        row.lot ?? <span className="coa-empty">—</span>
                      )}
                    </td>
                    <td className="coa-cell coa-cell--product">
                      {row.status === STATUS.PROCESSING ? (
                        <span className="coa-processing">Processing…</span>
                      ) : (
                        row.product ?? <span className="coa-empty">—</span>
                      )}
                    </td>
                    <td className="coa-cell">
                      {row.status === STATUS.PROCESSING ? (
                        <span className="coa-processing">Processing…</span>
                      ) : row.coaLink ? (
                        <div className="coa-link-actions">
                          <a
                            href={row.coaLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="coa-link"
                          >
                            View COA ↗
                          </a>
                          <button
                            type="button"
                            className="coa-copy-btn"
                            onClick={() => copyToClipboard(row.coaLink, row.id)}
                          >
                            Copy Link
                          </button>
                          {copiedRowId === row.id && (
                            <span className="coa-copy-feedback">Copied</span>
                          )}
                        </div>
                      ) : (
                        <span className="coa-empty">—</span>
                      )}
                    </td>
                    <td className="coa-cell">
                      {row.status === STATUS.PROCESSING && (
                        <span className="coa-badge coa-badge--processing">Processing…</span>
                      )}
                      {row.status === STATUS.DONE && (
                        <span className="coa-badge coa-badge--done">Done</span>
                      )}
                      {row.status === STATUS.ERROR && (
                        <span className="coa-badge coa-badge--error" title={row.error}>
                          Error
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
