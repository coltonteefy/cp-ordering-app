import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  setDoc,
  writeBatch,
} from 'firebase/firestore';
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

const PRODUCT_COLLECTION_NAME = 'c&pProductList';
const PRINT_HISTORY_COLLECTION_NAME = 'c&pSKUPrintHistory';
const DRAFT_STORAGE_KEY = 'skuPoDraft';
const MAX_PRINT_HISTORY_ITEMS = 30;
const TRACKING_CARRIERS = ['UPS', 'USPS', 'FedEx', 'DHL', 'Other'];
const EMPTY_LOT_PICKER = {
  itemId: '',
  itemDescription: '',
  selectedLot: '',
  options: [],
};

const normalizeLookupKey = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

const buildLookupKeyVariants = (value) => {
  const base = normalizeLookupKey(value);
  if (!base) return [];

  const variants = [base];
  const hasWhitespace = /\s/.test(base);

  if (!hasWhitespace) {
    if (base.startsWith('cp-')) {
      variants.push(base.slice(3));
    } else {
      variants.push(`cp-${base}`);
    }

    const compact = base.replace(/[^a-z0-9]/g, '');
    if (compact && compact !== base) variants.push(compact);
    if (compact.startsWith('cp')) variants.push(compact.slice(2));
  }

  return [...new Set(variants.filter(Boolean))];
};

const toCompactKey = (value) =>
  normalizeLookupKey(value).replace(/[^a-z0-9]/g, '');

const uniqueLots = (lots) => {
  const seen = new Set();
  const deduped = [];
  lots.forEach((lot) => {
    const normalized = String(lot || '').trim();
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    deduped.push(normalized);
  });
  return deduped;
};

const mergeLotEntries = (entries) => {
  const merged = new Map();

  entries.forEach((entry) => {
    const lot = String(entry?.lot || '').trim();
    if (!lot) return;

    const normalizedEntry = {
      lot,
      kits: Number(entry?.kits) || 0,
      vendor: String(entry?.vendor || '').trim(),
      capColor: String(entry?.capColor || '').trim(),
      capShade: String(entry?.capShade || '').trim(),
      note: String(entry?.note || '').trim(),
      isCurrent: Boolean(entry?.isCurrent),
    };

    if (!merged.has(lot)) {
      merged.set(lot, normalizedEntry);
      return;
    }

    const previous = merged.get(lot);
    merged.set(lot, {
      lot,
      kits: Math.max(previous.kits || 0, normalizedEntry.kits || 0),
      vendor: previous.vendor || normalizedEntry.vendor,
      capColor: previous.capColor || normalizedEntry.capColor,
      capShade: previous.capShade || normalizedEntry.capShade,
      note: previous.note || normalizedEntry.note,
      isCurrent: previous.isCurrent || normalizedEntry.isCurrent,
    });
  });

  return [...merged.values()];
};

const getLotsFromProductDoc = (rawData) => {
  const coaList = Array.isArray(rawData?.coaList) ? rawData.coaList : [];
  const currentCoa = rawData?.currentCoa || {};
  const currentLot = String(currentCoa?.lot || '').trim();

  const normalizedEntries = coaList.map((entry) => ({
    lot: entry?.lot,
    kits: entry?.kits,
    vendor: entry?.vendor,
    capColor: entry?.capColor,
    capShade: entry?.capShade,
    note: entry?.note,
    isCurrent: currentLot ? String(entry?.lot || '').trim() === currentLot : false,
  }));

  if (currentLot) {
    normalizedEntries.unshift({
      lot: currentLot,
      kits: currentCoa?.kits,
      vendor: currentCoa?.vendor,
      capColor: currentCoa?.capColor,
      capShade: currentCoa?.capShade,
      note: currentCoa?.note,
      isCurrent: true,
    });
  }

  return mergeLotEntries(normalizedEntries);
};

const buildProductDescription = (rawData) => {
  const product = String(rawData?.product || '').trim();
  const strength = String(rawData?.strength || '').trim();

  if (product && strength) {
    const productLower = product.toLowerCase();
    const strengthLower = strength.toLowerCase();
    return productLower.includes(strengthLower) ? product : `${product} ${strength}`;
  }

  return product || strength || String(rawData?.id || '').trim();
};

const normalizeProductFromDoc = (docId, rawData) => {
  const id = String(rawData?.id || docId).trim();
  const description = buildProductDescription(rawData);

  return {
    id,
    label: description,
    products: [{ productName: description }],
  };
};

const createOrderItem = (product, skuId, fallbackLabel) => ({
  id: `${skuId}-${product.productName || fallbackLabel}-${Math.random().toString(36).slice(2, 8)}`,
  skuCode: skuId,
  lot: '',
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
const createPrintHistoryEntry = (draft, user) => ({
  id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  poNumber: draft.poNumber,
  orderDate: draft.orderDate,
  printedAt: new Date().toISOString(),
  printedBy: user?.email || 'Unknown',
  trackingCarrier: '',
  trackingNumber: '',
  items: draft.items.map((item) => ({
    skuCode: item.skuCode,
    lot: item.lot || '',
    description: item.description,
    quantityKits: item.quantityKits ?? 0,
  })),
});

const normalizeTrackingNumber = (value) => String(value || '').trim();
const normalizeTrackingCarrier = (value) => String(value || '').trim();
const buildTrackingUrl = (carrier, trackingNumber) => {
  const normalizedCarrier = normalizeTrackingCarrier(carrier);
  const normalizedTracking = normalizeTrackingNumber(trackingNumber);

  if (!normalizedTracking) return '';

  const encodedTracking = encodeURIComponent(normalizedTracking);

  switch (normalizedCarrier) {
    case 'UPS':
      return `https://www.ups.com/track?tracknum=${encodedTracking}`;
    case 'USPS':
      return `https://tools.usps.com/go/TrackConfirmAction?qtc_tLabels1=${encodedTracking}`;
    case 'FedEx':
      return `https://www.fedex.com/fedextrack/?trknbr=${encodedTracking}`;
    case 'DHL':
      return `https://www.dhl.com/us-en/home/tracking.html?tracking-id=${encodedTracking}`;
    default:
      return '';
  }
};

const normalizePrintHistoryFromDoc = (docId, rawData) => ({
  id: docId,
  poNumber: rawData?.poNumber || '',
  orderDate: rawData?.orderDate || '',
  printedAt: rawData?.printedAt || '',
  printedBy: rawData?.printedBy || '',
  trackingCarrier: normalizeTrackingCarrier(rawData?.trackingCarrier),
  trackingNumber: normalizeTrackingNumber(rawData?.trackingNumber),
  items: Array.isArray(rawData?.items)
    ? rawData.items.map((item) => ({
        skuCode: item?.skuCode || '',
        lot: item?.lot || '',
        description: item?.description || '',
        quantityKits: Number(item?.quantityKits) || 0,
      }))
    : [],
});

const SkuPoPage = ({ onSuccess, onError, user }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [draft, setDraft] = useState(() => {
    try {
      const saved = localStorage.getItem(DRAFT_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        parsed.items = Array.isArray(parsed.items)
          ? parsed.items.map((item) => ({ ...item, lot: item?.lot || '' }))
          : [];
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
  const [printHistory, setPrintHistory] = useState([]);
  const [trackingEditor, setTrackingEditor] = useState({
    entryId: '',
    trackingCarrier: TRACKING_CARRIERS[0],
    trackingNumber: '',
  });
  const [lotPicker, setLotPicker] = useState(EMPTY_LOT_PICKER);
  const [printConfirmOpen, setPrintConfirmOpen] = useState(false);
  const [pendingPrintHistoryEntry, setPendingPrintHistoryEntry] = useState(null);
    // Auto-save draft to localStorage on every change
    useEffect(() => {
      if (draft) {
        localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
      } else {
        localStorage.removeItem(DRAFT_STORAGE_KEY);
      }
    }, [draft]);

    // Keep orderDate in sync with today unless user has changed it
    useEffect(() => {
      if (!draft) return;
      const today = todayValue();
      if (!draft._userSetOrderDate && draft.orderDate !== today) {
        setDraft((d) => d ? { ...d, orderDate: today } : d);
      }
    }, [draft]);
  const [skuCatalog, setSkuCatalog] = useState([]);
  const [lotCatalogByProduct, setLotCatalogByProduct] = useState({});
  const [lotCatalogRecords, setLotCatalogRecords] = useState([]);

  useEffect(() => {
    if (!lotPicker.itemId) return undefined;

    const handleEscape = (event) => {
      if (event.key === 'Escape') {
        setLotPicker(EMPTY_LOT_PICKER);
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, [lotPicker.itemId]);

  useEffect(() => {
    let isActive = true;

    const loadSkuCatalog = async () => {
      const productCollectionRef = collection(db, PRODUCT_COLLECTION_NAME);
      const snapshot = await getDocs(productCollectionRef);
      const liveProducts = snapshot.docs
        .map((productDoc) => normalizeProductFromDoc(productDoc.id, productDoc.data()))
        .filter((product) => Boolean(product.id) && Boolean(product.label))
        .sort(sortBySkuSuffix);

      if (isActive) {
        setSkuCatalog(liveProducts);
      }
    };

    loadSkuCatalog().catch(() => {
      if (isActive) {
        setSkuCatalog([]);
      }
      onError?.('Unable to load product list from Firebase.', 'Error');
    });

    return () => {
      isActive = false;
    };
  }, [onError]);

  useEffect(() => {
    let isActive = true;

    const loadLotCatalog = async () => {
      const productCollectionRef = collection(db, PRODUCT_COLLECTION_NAME);
      const snapshot = await getDocs(productCollectionRef);
      const lotMap = {};
      const records = [];

      snapshot.forEach((productDoc) => {
        const data = productDoc.data();
        const lots = getLotsFromProductDoc(data);
        const productName = String(data?.product || '').trim();
        const strength = String(data?.strength || '').trim();
        const productWithStrength = [productName, strength].filter(Boolean).join(' ').trim();
        const keyCandidates = [
          productDoc.id,
          data?.id,
          productName,
          productWithStrength,
        ]
          .flatMap((value) => buildLookupKeyVariants(value))
          .filter(Boolean);

        keyCandidates.forEach((key) => {
          lotMap[key] = mergeLotEntries([...(lotMap[key] || []), ...lots]);
        });

        records.push({
          lots,
          keyVariants: keyCandidates,
          productCompact: toCompactKey(productName),
          strengthCompact: toCompactKey(strength),
          combinedCompact: toCompactKey(productWithStrength),
        });
      });

      if (isActive) {
        setLotCatalogByProduct(lotMap);
        setLotCatalogRecords(records);
      }
    };

    loadLotCatalog().catch(() => {
      if (isActive) {
        setLotCatalogByProduct({});
        setLotCatalogRecords([]);
      }
      onError?.('Unable to load lot IDs for products.', 'Error');
    });

    return () => {
      isActive = false;
    };
  }, [onError]);

  useEffect(() => {
    let isActive = true;

    const loadPrintHistory = async () => {
      const historyCollectionRef = collection(db, PRINT_HISTORY_COLLECTION_NAME);
      const historyQuery = query(
        historyCollectionRef,
        orderBy('printedAt', 'desc'),
        limit(MAX_PRINT_HISTORY_ITEMS)
      );
      const snapshot = await getDocs(historyQuery);
      const historyItems = snapshot.docs.map((historyDoc) =>
        normalizePrintHistoryFromDoc(historyDoc.id, historyDoc.data())
      );

      if (isActive) {
        setPrintHistory(historyItems);
      }
    };

    loadPrintHistory().catch(() => {
      if (isActive) {
        setPrintHistory([]);
      }
      onError?.('Unable to load shared print history.', 'Error');
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
        return `${index + 1}\t${item.lot || ''}\t${item.description}\t${item.quantityKits ?? 0}`;
      })
      .join('\n');

    return [
      `SKU PO: ${draft.poNumber}`,
      'Line\tLOT\tDescription\tQuantity KIT',
      itemLines,
      '',
      `${formatShortDate(draft.orderDate)}\t\t\t\t`,
    ].join('\n');
  }, [draft]);

  const getLotsForItem = (item) => {
    const keyCandidates = [
      item?.skuCode,
      item?.description,
    ]
      .flatMap((value) => buildLookupKeyVariants(value))
      .filter(Boolean);

    const compactDescription = toCompactKey(item?.description);
    const compactSku = toCompactKey(item?.skuCode);

    const directLots = keyCandidates.flatMap((key) => lotCatalogByProduct[key] || []);
    const fuzzyLots = lotCatalogRecords.flatMap((record) => {
      const skuMatched = compactSku
        ? record.keyVariants.some((variant) => toCompactKey(variant) === compactSku)
        : false;
      const descriptionMatched = compactDescription
        ? (
          (record.combinedCompact && compactDescription.includes(record.combinedCompact)) ||
          (record.productCompact && compactDescription.includes(record.productCompact) &&
            (!record.strengthCompact || compactDescription.includes(record.strengthCompact)))
        )
        : false;

      return skuMatched || descriptionMatched ? record.lots : [];
    });

    const mergedLots = [...directLots, ...fuzzyLots];
    return mergeLotEntries(mergedLots);
  };

  const openLotPicker = (item) => {
    setLotPicker({
      itemId: item.id,
      itemDescription: item.description,
      selectedLot: item.lot || '',
      options: getLotsForItem(item),
    });
  };

  const closeLotPicker = () => {
    setLotPicker(EMPTY_LOT_PICKER);
  };

  const chooseLot = (lotValue) => {
    updateItem(lotPicker.itemId, 'lot', lotValue);
    closeLotPicker();
  };

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

  const printLabel = async () => {
    if (!draft) return;

    const historyEntry = createPrintHistoryEntry(draft, user);
    window.print();

    setPendingPrintHistoryEntry(historyEntry);
    setPrintConfirmOpen(true);
  };

  const cancelPrintSave = () => {
    setPrintConfirmOpen(false);
    setPendingPrintHistoryEntry(null);
    onSuccess?.('Label not saved to history.');
  };

  const confirmPrintSave = async () => {
    if (!pendingPrintHistoryEntry) {
      setPrintConfirmOpen(false);
      return;
    }

    try {
      await setDoc(
        doc(db, PRINT_HISTORY_COLLECTION_NAME, pendingPrintHistoryEntry.id),
        pendingPrintHistoryEntry
      );
      setPrintHistory((currentHistory) =>
        [pendingPrintHistoryEntry, ...currentHistory].slice(0, MAX_PRINT_HISTORY_ITEMS)
      );
      onSuccess?.('Label saved to shared history.');
    } catch {
      onError?.('Unable to save to shared history.', 'Error');
    } finally {
      setPrintConfirmOpen(false);
      setPendingPrintHistoryEntry(null);
    }
  };

  const clearPrintHistory = async () => {
    if (printHistory.length === 0) return;

    try {
      const batch = writeBatch(db);
      printHistory.forEach((entry) => {
        batch.delete(doc(db, PRINT_HISTORY_COLLECTION_NAME, entry.id));
      });
      await batch.commit();
      setPrintHistory([]);
      onSuccess?.('Print history cleared.');
    } catch {
      onError?.('Unable to clear shared print history.', 'Error');
    }
  };

  const removeHistoryEntry = async (entryId) => {
    try {
      await deleteDoc(doc(db, PRINT_HISTORY_COLLECTION_NAME, entryId));
      setPrintHistory((currentHistory) =>
        currentHistory.filter((entry) => entry.id !== entryId)
      );
      onSuccess?.('History item deleted.');
    } catch {
      onError?.('Unable to delete shared history item.', 'Error');
    }
  };

  const updateEntryTrackingLocally = (entryId, values) => {
    setPrintHistory((currentHistory) =>
      currentHistory.map((entry) =>
        entry.id === entryId
          ? {
              ...entry,
              ...values,
            }
          : entry
      )
    );
  };

  const openTrackingEditor = (entry) => {
    setTrackingEditor({
      entryId: entry.id,
      trackingCarrier: normalizeTrackingCarrier(entry.trackingCarrier) || TRACKING_CARRIERS[0],
      trackingNumber: normalizeTrackingNumber(entry.trackingNumber),
    });
  };

  const closeTrackingEditor = () => {
    setTrackingEditor({
      entryId: '',
      trackingCarrier: TRACKING_CARRIERS[0],
      trackingNumber: '',
    });
  };

  const saveHistoryTracking = async (entryId, rawTrackingNumber, rawTrackingCarrier) => {
    const trackingNumber = normalizeTrackingNumber(rawTrackingNumber);
    const trackingCarrier = trackingNumber
      ? normalizeTrackingCarrier(rawTrackingCarrier) || TRACKING_CARRIERS[0]
      : '';

    updateEntryTrackingLocally(entryId, { trackingNumber, trackingCarrier });

    try {
      await setDoc(
        doc(db, PRINT_HISTORY_COLLECTION_NAME, entryId),
        { trackingNumber, trackingCarrier },
        { merge: true }
      );
      onSuccess?.('Package tracking saved.');
      return true;
    } catch {
      onError?.('Unable to save package tracking.', 'Error');
      return false;
    }
  };

  return (
    <section className="sku-po-page">
      <header className="sku-po-header">
        <div>
          <p className="sku-po-eyebrow">Restock Intake</p>
          <h1>Package Slip</h1>
          <p className="sku-po-intro">
            Click a product to add it into the PO list. Click the same product again to remove it.
          </p>
        </div>
        <div className="sku-po-header-card">
          <span className="sku-po-header-label">Loaded Products</span>
          <strong>{skuCatalog.length}</strong>
          <span className="sku-po-header-subtitle">Ready to build PO drafts</span>
        </div>
      </header>

      <div className="sku-po-layout">
        <aside className="sku-po-catalog">
          <div className="sku-po-search-wrap">
            <label htmlFor="sku-search">Find Product</label>
            <input
              id="sku-search"
              type="text"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Search by product ID or name"
            />
          </div>

          <div className="sku-po-list-meta">
            <span>{filteredSkus.length} shown</span>
            <span>{draft?.items.length || 0} in PO</span>
          </div>

          <div className="sku-po-list" role="list" aria-label="Product catalog">
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
              <h2>Click a Product to start</h2>
              <p>Use the product list to add items to the PO. Click the same product again if you want to remove it.</p>
            </div>
          ) : (
            <>
              <div className="sku-po-draft-header">
                <div>
                  <p className="sku-po-draft-badge">PO Draft</p>
                  <h2>{draft.items.length} Item{draft.items.length === 1 ? '' : 's'} in PO</h2>
                  <p>Manage the list directly from the product selector on the left.</p>
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
                    <col className="sku-po-col-lot" />
                    <col className="sku-po-col-description" />
                    <col className="sku-po-col-kit" />
                  </colgroup>
                  <thead>
                    <tr>
                      <th>Line</th>
                      <th>LOT</th>
                      <th>Description</th>
                      <th>Quantity KIT</th>
                    </tr>
                  </thead>
                  <tbody>
                    {draft.items.map((item, index) => {
                      const lotOptions = getLotsForItem(item);
                      const selectedLot = lotOptions.find((lot) => lot.lot === item.lot);
                      return (
                        <tr key={item.id}>
                          <td className="sku-po-line-cell">{index + 1}</td>
                          <td>
                            <button
                              type="button"
                              className="sku-po-lot-picker-btn"
                              onClick={() => openLotPicker(item)}
                            >
                              <strong>{item.lot || 'Select lot'}</strong>
                              <span>
                                {selectedLot
                                  ? `${selectedLot.capColor || selectedLot.capShade || 'No cap color'}`
                                  : `${lotOptions.length} available`}
                              </span>
                            </button>
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
                      );
                    })}
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
                      <col className="sku-po-print-col-lot" />
                      <col className="sku-po-print-col-description" />
                      <col className="sku-po-print-col-kit" />
                    </colgroup>
                    <thead>
                      <tr>
                        <th>Line</th>
                        <th>LOT</th>
                        <th>Description</th>
                        <th>Quantity KIT</th>
                      </tr>
                    </thead>
                    <tbody>
                      {draft.items.map((item, index) => {
                        const selectedLot = getLotsForItem(item).find((option) => option.lot === item.lot);
                        const capColor = selectedLot?.capColor || selectedLot?.capShade || '-';

                        return (
                          <tr key={`${item.id}-print`}>
                            <td>{index + 1}</td>
                            <td>
                              <div className="sku-po-print-lot-wrap">
                                <span>{item.lot || '-'}</span>
                                <small>{capColor}</small>
                              </div>
                            </td>
                            <td>{item.description}</td>
                            <td>{item.quantityKits ?? 0}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <div className="sku-po-print-meta-bar bottom">
                    <span>Order Date:</span>
                    <strong>{formatShortDate(draft.orderDate)}</strong>
                    <span className="sku-po-print-brand">Coffee and Peppers</span>
                  </div>
                </div>
              </div>

              {lotPicker.itemId && createPortal(
                <div className="sku-po-lot-modal-backdrop" onClick={closeLotPicker}>
                  <div className="sku-po-lot-modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
                    <div className="sku-po-lot-modal-header">
                      <div>
                        <h3>Select LOT</h3>
                        <p>{lotPicker.itemDescription}</p>
                      </div>
                      <button type="button" className="sku-po-secondary-btn" onClick={closeLotPicker}>Close</button>
                    </div>

                    {lotPicker.options.length === 0 ? (
                      <p className="sku-po-lot-modal-empty">No lots found for this product.</p>
                    ) : (
                      <div className="sku-po-lot-modal-list">
                        {lotPicker.options.map((option) => (
                          <button
                            key={`${lotPicker.itemId}-${option.lot}`}
                            type="button"
                            className={`sku-po-lot-option ${lotPicker.selectedLot === option.lot ? 'active' : ''}`}
                            onClick={() => chooseLot(option.lot)}
                          >
                            <div className="sku-po-lot-option-top">
                              <strong>{option.lot}</strong>
                              {option.isCurrent && <span className="sku-po-lot-current-badge">Current</span>}
                            </div>
                            <div className="sku-po-lot-option-meta">
                              <span>{option.kits} kits</span>
                              <span>{option.vendor || 'No vendor'}</span>
                              <span className={`sku-po-capchip${option.capColor || option.capShade ? '' : ' empty'}`}>
                                <span
                                  className="sku-po-capchip-swatch"
                                  style={{ backgroundColor: option.capShade || option.capColor || '#e7dfd3' }}
                                />
                                <span className="sku-po-capchip-text">
                                  {option.capColor || option.capShade || 'No cap color'}
                                </span>
                              </span>
                            </div>
                            {option.note && <p>{option.note}</p>}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>,
                document.body
              )}

              {printConfirmOpen && createPortal(
                <div className="sku-po-print-confirm-backdrop" onClick={cancelPrintSave}>
                  <div
                    className="sku-po-print-confirm-modal"
                    role="dialog"
                    aria-modal="true"
                    aria-label="Confirm print save"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <h3>Save this print to history?</h3>
                    <p>
                      Save only if this label printed correctly.
                    </p>
                    <div className="sku-po-print-confirm-actions">
                      <button type="button" className="sku-po-secondary-btn" onClick={cancelPrintSave}>
                        Do Not Save
                      </button>
                      <button type="button" className="sku-po-primary-btn" onClick={confirmPrintSave}>
                        Save to History
                      </button>
                    </div>
                  </div>
                </div>,
                document.body
              )}

            </>
          )}

          <section className="sku-po-history-section" aria-label="Print history">
            <div className="sku-po-section-heading compact">
              <div>
                <h3>Print History</h3>
                <p>After printing, confirm success to save that snapshot here.</p>
              </div>
            </div>

            {printHistory.length === 0 ? (
              <p className="sku-po-history-empty">No printed lists yet.</p>
            ) : (
              <div className="sku-po-history-list">
                {printHistory.map((entry) => (
                  <article key={entry.id} className="sku-po-history-item">
                    <div className="sku-po-history-item-top">
                      <div className="sku-po-history-item-title">
                        <strong>{formatDateTime(entry.printedAt)}</strong>
                        {entry.printedBy && <span className="sku-po-history-printed-by">{entry.printedBy}</span>}
                        <span>Order Date {formatShortDate(entry.orderDate)} | {entry.items.length} Item{entry.items.length === 1 ? '' : 's'}</span>
                      </div>
                      <div className="sku-po-history-item-controls">
                        <button
                          type="button"
                          className="sku-po-secondary-btn sku-po-history-track-btn"
                          onClick={() => openTrackingEditor(entry)}
                        >
                          {entry.trackingNumber ? 'Edit Tracking' : 'Add Tracking'}
                        </button>
                        <button
                          type="button"
                          className="sku-po-remove-btn sku-po-history-remove-btn"
                          onClick={() => removeHistoryEntry(entry.id)}
                          aria-label={`Delete history entry printed ${formatDateTime(entry.printedAt)}`}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                    <div className="sku-po-history-tracking-summary">
                      <span>Package Tracking</span>
                      {entry.trackingNumber ? (
                        (() => {
                          const trackingLabel = `${entry.trackingCarrier ? `${entry.trackingCarrier}: ` : ''}${entry.trackingNumber}`;
                          const trackingUrl = buildTrackingUrl(entry.trackingCarrier, entry.trackingNumber);

                          if (trackingUrl) {
                            return (
                              <a
                                href={trackingUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="sku-po-history-tracking-link"
                                aria-label={`Track package via ${entry.trackingCarrier || 'carrier'}`}
                              >
                                {trackingLabel}
                              </a>
                            );
                          }

                          return <strong>{trackingLabel}</strong>;
                        })()
                      ) : (
                        <em>Not added yet</em>
                      )}
                    </div>
                    {trackingEditor.entryId === entry.id && (
                      <div className="sku-po-history-tracking-editor">
                        <label>
                          <span>Carrier</span>
                          <select
                            value={trackingEditor.trackingCarrier}
                            onChange={(event) =>
                              setTrackingEditor((current) => ({
                                ...current,
                                trackingCarrier: event.target.value,
                              }))
                            }
                          >
                            {TRACKING_CARRIERS.map((carrier) => (
                              <option key={carrier} value={carrier}>{carrier}</option>
                            ))}
                          </select>
                        </label>
                        <label>
                          <span>Tracking Number</span>
                          <input
                            type="text"
                            value={trackingEditor.trackingNumber}
                            onChange={(event) =>
                              setTrackingEditor((current) => ({
                                ...current,
                                trackingNumber: event.target.value,
                              }))
                            }
                            placeholder="Enter tracking number"
                          />
                        </label>
                        <div className="sku-po-history-tracking-actions">
                          <button
                            type="button"
                            className="sku-po-primary-btn"
                            onClick={async () => {
                              const saved = await saveHistoryTracking(
                                entry.id,
                                trackingEditor.trackingNumber,
                                trackingEditor.trackingCarrier
                              );
                              if (saved) closeTrackingEditor();
                            }}
                          >
                            Save Tracking
                          </button>
                          <button
                            type="button"
                            className="sku-po-secondary-btn"
                            onClick={closeTrackingEditor}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                    <ul className="sku-po-history-lines">
                      {entry.items.map((item, index) => (
                        <li key={`${entry.id}-${item.skuCode || item.description}-${index}`}>
                          <span>{index + 1}. {item.description}</span>
                          <strong>{item.lot ? `${item.lot} | ` : ''}{item.quantityKits ?? 0} KIT</strong>
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
