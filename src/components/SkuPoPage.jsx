import { useEffect, useMemo, useState } from 'react';
import { collection, doc, getDocs, setDoc } from 'firebase/firestore';
import { db } from '../firebaseConfig';
import './SkuPoPage.css';

const SKU_CATALOG = [
  { id: 'CP-MOTSC', label: 'MOTS-C 10mg', products: [{ productName: 'MOTS-C 10mg' }] },
  { id: 'CP-CJCIPA', label: 'CJC-1295 & Ipamorelin 10mg', products: [{ productName: 'CJC-1295 & Ipamorelin 10mg' }] },
  { id: 'CP-GLP3RT10', label: 'GLP3-RT 10mg', products: [{ productName: 'GLP3-RT 10mg' }] },
  { id: 'CP-31', label: 'SS-31 10mg', products: [{ productName: 'SS-31 10mg' }] },
  { id: 'CP-BPC157', label: 'BPC-157 10mg', products: [{ productName: 'BPC-157 10mg' }] },
  { id: 'CP-CAG', label: 'Cagrilitide 5mg', products: [{ productName: 'Cagrilitide 5mg' }] },
  { id: 'CP-GLP2TZ60', label: 'GLP2-TZ 60mg', products: [{ productName: 'GLP2-TZ 60mg' }] },
  { id: 'CP-GLP3RT20', label: 'GLP3-RT 20mg', products: [{ productName: 'GLP3-RT 20mg' }] },
  { id: 'CP-GLP3RT30', label: 'GLP3-RT 30mg', products: [{ productName: 'GLP3-RT 30mg' }] },
  { id: 'CP-GLUT1500', label: 'Glutathione 1500mg', products: [{ productName: 'Glutathione 1500mg' }] },
  { id: 'CP-GLUT500', label: 'Glutathione 500mg', products: [{ productName: 'Glutathione 500mg' }] },
  { id: 'CP-GLUT750', label: 'Glutathione 750mg', products: [{ productName: 'Glutathione 750mg' }] },
  { id: 'CP-MT2', label: 'MT-2 10mg', products: [{ productName: 'MT-2 10mg' }] },
  { id: 'CP-NADPLUS', label: 'NAD+ 500mg', products: [{ productName: 'NAD+ 500mg' }] },
  { id: 'CP-PT141', label: 'PT-141 10mg', products: [{ productName: 'PT-141 10mg' }] },
  { id: 'CP-SELANK', label: 'Selank 10mg', products: [{ productName: 'Selank 10mg' }] },
  { id: 'CP-SEMAX', label: 'Semax 10mg', products: [{ productName: 'Semax 10mg' }] },
  { id: 'CP-TESA', label: 'Tesamorelin 10mg', products: [{ productName: 'Tesamorelin 10mg' }] },
  { id: 'CP-IGF1LR3', label: 'IGF-1 1mg', products: [{ productName: 'IGF-1 1mg' }] },
  { id: 'CP-GLP2TZ40', label: 'GLP2-TZ 40mg', products: [{ productName: 'GLP2-TZ 40mg' }] },
  { id: 'CP-GLP3RT50', label: 'GLP3-RT 50mg', products: [{ productName: 'GLP3-RT 50mg' }] },
  { id: 'CP-IPAMORELIN', label: 'Ipamorelin 5mg', products: [{ productName: 'Ipamorelin 5mg' }] },
  { id: 'CP-AOD', label: 'AOD-9604 5mg', products: [{ productName: 'AOD-9604 5mg' }] },
  { id: 'CP-GLP2TZ10', label: 'GLP2-TZ 10mg', products: [{ productName: 'GLP2-TZ 10mg' }] },
  { id: 'CP-GHK50MG', label: 'GHK-Cu 50mg', products: [{ productName: 'GHK-Cu 50mg' }] },
  { id: 'CP-TB500BPC15720', label: 'TB-500 & BPC-157 20mg', products: [{ productName: 'TB-500 & BPC-157 20mg' }] },
  { id: 'CP-GHK100MG', label: 'GHK-Cu 100mg', products: [{ productName: 'GHK-Cu 100mg' }] },
  { id: 'CP-KLOW', label: 'KLOW 80mg', products: [{ productName: 'KLOW 80mg' }] },
  { id: 'CP-TB500BPC15710', label: 'TB-500 & BPC-157 10mg', products: [{ productName: 'TB-500 & BPC-157 10mg' }] },
  { id: 'CP-KPV', label: 'KPV 10mg', products: [{ productName: 'KPV 10mg' }] },
  { id: 'CP-5AMINO', label: '5-Amino 10mg', products: [{ productName: '5-Amino 10mg' }] },
  { id: 'CP-TB500', label: 'TB-500 10mg', products: [{ productName: 'TB-500 10mg' }] },
  { id: 'CP-GLP2TZ30', label: 'GLP2-TZ 30mg', products: [{ productName: 'GLP2-TZ 30mg' }] },
  { id: 'CP-DSIP', label: 'DSIP 10mg', products: [{ productName: 'DSIP 10mg' }] },
  { id: 'CP-GLOW', label: 'GLOW 70mg', products: [{ productName: 'GLOW 70mg' }] },
  { id: 'CP-THYMOSIN', label: 'Thymosin Alpha-1 5mg', products: [{ productName: 'Thymosin Alpha-1 5mg' }] },
  { id: 'CP-VIP', label: 'VIP 10mg', products: [{ productName: 'VIP 10mg' }] },
];

const sortBySkuSuffix = (leftSku, rightSku) => {
  const leftSuffix = leftSku.id.replace(/^CP-/, '');
  const rightSuffix = rightSku.id.replace(/^CP-/, '');
  return leftSuffix.localeCompare(rightSuffix, undefined, { numeric: true });
};

const SORTED_SKU_CATALOG = [...SKU_CATALOG].sort(sortBySkuSuffix);
const SKU_COLLECTION_NAME = 'c&pSKUIDs';
const DRAFT_STORAGE_KEY = 'skuPoDraft';
const PRINT_HISTORY_STORAGE_KEY = 'skuPoPrintHistory';
const MAX_PRINT_HISTORY_ITEMS = 30;

const normalizeSkuFromDoc = (docId, rawData) => {
  const label = rawData?.label || docId;
  const products = Array.isArray(rawData?.products) && rawData.products.length > 0
    ? rawData.products.map((product) => ({
        productName: product?.productName || label,
      }))
    : [{ productName: label }];

  return {
    id: docId,
    label,
    products,
  };
};

const createOrderItem = (product, skuId, fallbackLabel) => ({
  id: `${skuId}-${product.productName || fallbackLabel}-${Math.random().toString(36).slice(2, 8)}`,
  skuCode: skuId,
  description: product.productName || fallbackLabel,
  quantityKits: 0,
});

const generatePoNumber = (skuId) => {
  const now = new Date();
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  return `${skuId}-PO-${stamp}`;
};

const todayValue = () => new Date().toISOString().slice(0, 10);

const formatShortDate = (value) => {
  if (!value) return '';
  const [year, month, day] = value.split('-');
  if (!year || !month || !day) return value;
  return `${month}/${day}/${year.slice(-2)}`;
};

const formatDateTime = (value) => {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
};

const calculateKitValue = (quantitySingles, singlesPerKit) => {
  const singles = Number(quantitySingles) || 0;
  const unitsPerKit = Number(singlesPerKit) || 0;
  if (unitsPerKit <= 0) return '0';
  return String(Math.floor(singles / unitsPerKit));
};

const buildDraftFromSku = (sku) => ({
  poNumber: generatePoNumber(sku.id),
  orderDate: todayValue(),
  items: sku.products.map((product) => createOrderItem(product, sku.id, sku.label)),
});

const buildItemsFromSku = (sku) => sku.products.map((product) => createOrderItem(product, sku.id, sku.label));
const skuIsInDraft = (draft, skuId) => draft?.items.some((item) => item.skuCode === skuId) || false;
const createPrintHistoryEntry = (draft) => ({
  id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  poNumber: draft.poNumber,
  orderDate: draft.orderDate,
  printedAt: new Date().toISOString(),
  items: draft.items.map((item) => ({
    skuCode: item.skuCode,
    description: item.description,
    quantityKits: item.quantityKits ?? 0,
  })),
});

const SkuPoPage = ({ onSuccess, onError }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [draft, setDraft] = useState(() => {
    try {
      const saved = localStorage.getItem(DRAFT_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        // Always update orderDate to today if not user-modified
        const today = todayValue();
        if (!parsed._userSetOrderDate && parsed.orderDate !== today) {
          parsed.orderDate = today;
        }
        return parsed;
      }
      return null;
    } catch {
      return null;
    }
  });
  const [printHistory, setPrintHistory] = useState(() => {
    try {
      const saved = localStorage.getItem(PRINT_HISTORY_STORAGE_KEY);
      if (!saved) return [];
      const parsed = JSON.parse(saved);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });
    // Auto-save draft to localStorage on every change
    useEffect(() => {
      if (draft) {
        localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
      } else {
        localStorage.removeItem(DRAFT_STORAGE_KEY);
      }
    }, [draft]);

    useEffect(() => {
      localStorage.setItem(PRINT_HISTORY_STORAGE_KEY, JSON.stringify(printHistory));
    }, [printHistory]);

    // Keep orderDate in sync with today unless user has changed it
    useEffect(() => {
      if (!draft) return;
      const today = todayValue();
      if (!draft._userSetOrderDate && draft.orderDate !== today) {
        setDraft((d) => d ? { ...d, orderDate: today } : d);
      }
    }, [draft]);
  const [skuCatalog, setSkuCatalog] = useState(SORTED_SKU_CATALOG);

  useEffect(() => {
    let isActive = true;

    const loadSkuCatalog = async () => {
      const skuCollectionRef = collection(db, SKU_COLLECTION_NAME);
      const snapshot = await getDocs(skuCollectionRef);

      if (snapshot.empty) {
        await Promise.all(
          SORTED_SKU_CATALOG.map((sku) =>
            setDoc(doc(db, SKU_COLLECTION_NAME, sku.id), sku)
          )
        );
        if (isActive) {
          setSkuCatalog(SORTED_SKU_CATALOG);
        }
        return;
      }

      const firebaseSkus = snapshot.docs.map((skuDoc) =>
        normalizeSkuFromDoc(skuDoc.id, skuDoc.data())
      );

      const existingIds = new Set(firebaseSkus.map((sku) => sku.id));
      const missingSkus = SORTED_SKU_CATALOG.filter((sku) => !existingIds.has(sku.id));

      if (missingSkus.length > 0) {
        await Promise.all(
          missingSkus.map((sku) =>
            setDoc(doc(db, SKU_COLLECTION_NAME, sku.id), sku)
          )
        );
      }

      const mergedSkus = [...firebaseSkus, ...missingSkus].sort(sortBySkuSuffix);
      if (isActive) {
        setSkuCatalog(mergedSkus);
      }
    };

    loadSkuCatalog().catch(() => {
      if (isActive) {
        setSkuCatalog(SORTED_SKU_CATALOG);
      }
      onError?.('Unable to load SKU IDs from Firebase. Using local fallback list.', 'Error');
    });

    return () => {
      isActive = false;
    };
  }, [onError]);

  const filteredSkus = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    if (!query) return skuCatalog;
    return skuCatalog.filter((sku) =>
      sku.id.toLowerCase().includes(query) ||
      sku.label.toLowerCase().includes(query) ||
      sku.products.some((product) => product.productName.toLowerCase().includes(query))
    );
  }, [searchTerm, skuCatalog]);

  const summaryText = useMemo(() => {
    if (!draft) return '';

    const itemLines = draft.items
      .map((item, index) => {
        return `${index + 1}\t${item.skuCode}\t${item.description}\t${item.quantityKits ?? 0}`;
      })
      .join('\n');

    return [
      `SKU PO: ${draft.poNumber}`,
      'Line\tSKU / Item Code\tDescription\tQuantity KIT',
      itemLines,
      '',
      `${formatShortDate(draft.orderDate)}\t\t\t\t`,
    ].join('\n');
  }, [draft]);

  const selectSku = (sku) => {
    setDraft((currentDraft) => {
      if (!currentDraft) {
        return buildDraftFromSku(sku);
      }

      if (skuIsInDraft(currentDraft, sku.id)) {
        const remainingItems = currentDraft.items.filter((item) => item.skuCode !== sku.id);
        if (remainingItems.length === 0) return null;
        return {
          ...currentDraft,
          items: remainingItems,
        };
      }

      return {
        ...currentDraft,
        items: [...currentDraft.items, ...buildItemsFromSku(sku)],
      };
    });
  };

  const updateItem = (itemId, field, value) => {
    setDraft((currentDraft) => {
      if (!currentDraft) return currentDraft;
      return {
        ...currentDraft,
        items: currentDraft.items.map((item) =>
          item.id === itemId
            ? {
                ...item,
                [field]: field === 'quantityKits'
                  ? Math.max(0, Number.parseInt(value, 10) || 0)
                  : value,
              }
            : item
        ),
      };
    });
  };

  // Special handler for orderDate to track user intent
  const handleOrderDateChange = (event) => {
    setDraft((d) => d ? { ...d, orderDate: event.target.value, _userSetOrderDate: true } : d);
  };

  const resetDraft = () => {
    setDraft(null);
  };

  const copySummary = async () => {
    if (!summaryText) return;

    try {
      await navigator.clipboard.writeText(summaryText);
      onSuccess?.('SKU PO table copied to clipboard.');
    } catch (error) {
      onError?.('Unable to copy the SKU PO summary.', 'Error');
    }
  };

  const printLabel = () => {
    if (!draft) return;
    const historyEntry = createPrintHistoryEntry(draft);
    setPrintHistory((currentHistory) => [historyEntry, ...currentHistory].slice(0, MAX_PRINT_HISTORY_ITEMS));
    window.print();
    onSuccess?.('Label printed and saved to history.');
  };

  const clearPrintHistory = () => {
    setPrintHistory([]);
    onSuccess?.('Print history cleared.');
  };

  return (
    <section className="sku-po-page">
      <header className="sku-po-header">
        <div>
          <p className="sku-po-eyebrow">Restock Intake</p>
          <h1>SKU PO</h1>
          <p className="sku-po-intro">
            Click a SKU to add it into the PO list. Click the same SKU again to remove it.
          </p>
        </div>
        <div className="sku-po-header-card">
          <span className="sku-po-header-label">Loaded SKUs</span>
          <strong>{skuCatalog.length}</strong>
          <span className="sku-po-header-subtitle">Ready to build PO drafts</span>
        </div>
      </header>

      <div className="sku-po-layout">
        <aside className="sku-po-catalog">
          <div className="sku-po-search-wrap">
            <label htmlFor="sku-search">Find SKU</label>
            <input
              id="sku-search"
              type="text"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Search by SKU or product"
            />
          </div>

          <div className="sku-po-list-meta">
            <span>{filteredSkus.length} shown</span>
            <span>{draft?.items.length || 0} in PO</span>
          </div>

          <div className="sku-po-list" role="list" aria-label="SKU catalog">
            {filteredSkus.map((sku) => (
              <button
                key={sku.id}
                type="button"
                className={`sku-po-list-item ${skuIsInDraft(draft, sku.id) ? 'active' : ''}`}
                onClick={() => selectSku(sku)}
              >
                <strong>{sku.id}</strong>
                <span>{sku.label}</span>
              </button>
            ))}
          </div>
        </aside>

        <div className="sku-po-draft-panel">
          {!draft ? (
            <div className="sku-po-empty-state">
              <h2>Click a SKU to start</h2>
              <p>Use the SKU list to add items to the PO. Click a SKU again if you want to remove it.</p>
            </div>
          ) : (
            <>
              <div className="sku-po-draft-header">
                <div>
                  <p className="sku-po-draft-badge">PO Draft</p>
                  <h2>{draft.items.length} Item{draft.items.length === 1 ? '' : 's'} in PO</h2>
                  <p>Manage the list directly from the SKU selector on the left.</p>
                </div>
                <div className="sku-po-draft-actions">
                  <button type="button" className="sku-po-secondary-btn" onClick={resetDraft}>
                    Reset
                  </button>
                  <button type="button" className="sku-po-secondary-btn" onClick={printLabel}>
                    Print 4x6 Label
                  </button>
                  <button type="button" className="sku-po-primary-btn" onClick={copySummary}>
                    Copy Table
                  </button>
                </div>
              </div>

              <div className="sku-po-table-wrap">
                <table className="sku-po-table-inputs">
                  <colgroup>
                    <col className="sku-po-col-line" />
                    <col className="sku-po-col-sku" />
                    <col className="sku-po-col-description" />
                    <col className="sku-po-col-kit" />
                  </colgroup>
                  <thead>
                    <tr>
                      <th>Line</th>
                      <th>SKU / Item Code</th>
                      <th>Description</th>
                      <th>Quantity KIT</th>
                    </tr>
                  </thead>
                  <tbody>
                    {draft.items.map((item, index) => (
                      <tr key={item.id}>
                        <td className="sku-po-line-cell">{index + 1}</td>
                        <td>
                          <input
                            type="text"
                            value={item.skuCode}
                            onChange={(event) => updateItem(item.id, 'skuCode', event.target.value)}
                          />
                        </td>
                        <td className="sku-po-description-cell">{item.description}</td>
                        <td className="sku-po-total-cell">
                          <input
                            type="number"
                            min="0"
                            value={item.quantityKits ?? 0}
                            onChange={(event) => updateItem(item.id, 'quantityKits', event.target.value)}
                            onFocus={(event) => event.target.select()}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="sku-po-date-input-row">
                  <label>
                    <span>Order Date</span>
                    <input
                      type="date"
                      value={draft.orderDate}
                      onChange={handleOrderDateChange}
                    />
                  </label>
                  <span className="sku-po-date-brand">Coffee and Peppers</span>
                </div>
              </div>

              <div className="sku-po-print-label" aria-hidden="true">
                <div className="sku-po-print-shell">
                  <table className="sku-po-print-table">
                    <colgroup>
                      <col className="sku-po-print-col-line" />
                      <col className="sku-po-print-col-sku" />
                      <col className="sku-po-print-col-description" />
                      <col className="sku-po-print-col-kit" />
                    </colgroup>
                    <thead>
                      <tr>
                        <th>Line</th>
                        <th>SKU / Item Code</th>
                        <th>Description</th>
                        <th>Quantity KIT</th>
                      </tr>
                    </thead>
                    <tbody>
                      {draft.items.map((item, index) => (
                        <tr key={`${item.id}-print`}>
                          <td>{index + 1}</td>
                          <td>{item.skuCode}</td>
                          <td>{item.description}</td>
                          <td>{item.quantityKits ?? 0}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="sku-po-print-meta-bar bottom">
                    <span>Order Date:</span>
                    <strong>{formatShortDate(draft.orderDate)}</strong>
                    <span className="sku-po-print-brand">Coffee and Peppers</span>
                  </div>
                </div>
              </div>

            </>
          )}

          <section className="sku-po-history-section" aria-label="Print history">
            <div className="sku-po-section-heading compact">
              <div>
                <h3>Print History</h3>
                <p>Each time you click Print 4x6 Label, that snapshot is saved here.</p>
              </div>
              {printHistory.length > 0 && (
                <button type="button" className="sku-po-secondary-btn" onClick={clearPrintHistory}>
                  Clear History
                </button>
              )}
            </div>

            {printHistory.length === 0 ? (
              <p className="sku-po-history-empty">No printed lists yet.</p>
            ) : (
              <div className="sku-po-history-list">
                {printHistory.map((entry) => (
                  <article key={entry.id} className="sku-po-history-item">
                    <div className="sku-po-history-item-top">
                      <strong>{entry.poNumber}</strong>
                      <span>{formatDateTime(entry.printedAt)}</span>
                    </div>
                    <p>
                      Order Date {formatShortDate(entry.orderDate)} | {entry.items.length} Item
                      {entry.items.length === 1 ? '' : 's'}
                    </p>
                    <ul className="sku-po-history-lines">
                      {entry.items.map((item, index) => (
                        <li key={`${entry.id}-${item.skuCode}-${index}`}>
                          <span>{index + 1}. {item.skuCode} - {item.description}</span>
                          <strong>{item.quantityKits ?? 0} KIT</strong>
                        </li>
                      ))}
                    </ul>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </section>
  );
};

export default SkuPoPage;
