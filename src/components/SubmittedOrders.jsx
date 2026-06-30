import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { collection, onSnapshot, doc, updateDoc, deleteDoc, setDoc, getDocs } from 'firebase/firestore';
import { db } from '../firebaseConfig';
import './SubmittedOrders.css';

const VENDOR_COLORS = {
  TSC: '#8B6914',
  Josh: '#5B7B5D',
  SRY: '#5C7A99',
  ALLEN: '#A0522D',
};

const VENDOR_PALETTE = [
  '#7B5A7B', '#3D7A7A', '#8C7B3A', '#B87333',
  '#6B5B73', '#8B5E3C', '#6B8E6B', '#7A6352',
  '#4E7A6B', '#8B7355'
];

function vendorColor(name, colorMap) {
  if (!name) return VENDOR_PALETTE[0];
  if (colorMap && colorMap[name]) return colorMap[name];
  if (VENDOR_COLORS[name]) return VENDOR_COLORS[name];
  let hash = 5381;
  for (let i = 0; i < name.length; i++) hash = ((hash << 5) + hash) ^ name.charCodeAt(i);
  return VENDOR_PALETTE[Math.abs(hash) % VENDOR_PALETTE.length];
}

// Format product name for display (GLP-2 → T[mass], GLP-3 → R[mass])
function formatProductName(name) {
  if (!name) return '';
  const glp2 = name.match(/^GLP-2[^\d]*(\d+)/i);
  if (glp2) return `T${glp2[1]}`;
  const glp3 = name.match(/^GLP-3[^\d]*(\d+)/i);
  if (glp3) return `R${glp3[1]}`;
  return name;
}

// Utility to copy text to clipboard
function copyToClipboard(text) {
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text);
  } else {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
  }
}

function TrackingAlerts({ problems, onResolve, onBulkResolve }) {
  const [collapsed, setCollapsed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [replacingNums, setReplacingNums] = useState({});
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkText, setBulkText] = useState('');

  const returns = problems.filter((p) => p.isReturn);
  const exceptions = problems.filter((p) => !p.isReturn);

  const copyAll = () => {
    const text = problems.map((p) => `${p.trackingNum}  ${p.label}  (${p.vendor} / ${p.orderId})`).join('\n');
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const startReplace = (key) => setReplacingNums((prev) => ({ ...prev, [key]: '' }));
  const cancelReplace = (key) => setReplacingNums((prev) => { const n = { ...prev }; delete n[key]; return n; });
  const submitReplace = (p, key) => {
    const val = replacingNums[key]?.trim();
    if (!val) return;
    onResolve(p.orderId, p.entryIdx, p.trackingNum, val);
    cancelReplace(key);
  };

  const enterBulk = () => { setBulkMode(true); setBulkText(''); setCollapsed(false); };
  const cancelBulk = () => { setBulkMode(false); setBulkText(''); };

  // Parse lines like "OLD = NEW", "OLD → NEW", "OLD NEW", "OLD -> NEW"
  const parseBulkText = (text) => {
    const map = new Map();
    text.split('\n').forEach((line) => {
      const parts = line.trim().split(/\s*[=→>]+\s*|\s{2,}|\t/);
      if (parts.length >= 2) {
        const oldNum = parts[0].trim();
        const newNum = parts[parts.length - 1].trim();
        if (oldNum && newNum && oldNum !== newNum) map.set(oldNum, newNum);
      }
    });
    return map;
  };

  const parsedMap = parseBulkText(bulkText);
  const matches = problems.filter((p) => parsedMap.has(p.trackingNum));
  const anyFilled = matches.length > 0;

  const saveAll = () => {
    const replacements = matches.map((p) => ({ orderId: p.orderId, entryIdx: p.entryIdx, oldNum: p.trackingNum, newNum: parsedMap.get(p.trackingNum) }));
    if (onBulkResolve) {
      onBulkResolve(replacements);
    } else {
      matches.forEach((p) => onResolve(p.orderId, p.entryIdx, p.trackingNum, parsedMap.get(p.trackingNum)));
    }
    cancelBulk();
  };

  return (
    <div className="tracking-alerts-wrap">
      <div className="tracking-alerts-header" onClick={() => !bulkMode && setCollapsed((c) => !c)}>
        <div className="ta-header-left">
          <span className="ta-icon">⚠</span>
          <span className="ta-title">Tracking Issues</span>
          {returns.length > 0 && <span className="ta-badge ta-badge-return">{returns.length} Returned</span>}
          {exceptions.length > 0 && <span className="ta-badge ta-badge-exception">{exceptions.length} Exception</span>}
        </div>
        <div className="ta-header-right">
          {!bulkMode ? (
            <>
              {onResolve && (
                <button className="ta-bulk-btn" onClick={(e) => { e.stopPropagation(); enterBulk(); }}>
                  Bulk Replace
                </button>
              )}
              <button className={`ta-copy-btn${copied ? ' copied' : ''}`} onClick={(e) => { e.stopPropagation(); copyAll(); }}>
                {copied ? '✓ Copied' : '⎘ Copy All'}
              </button>
              <span className="ta-chevron">{collapsed ? '▸' : '▾'}</span>
            </>
          ) : (
            <>
              <button className="ta-replace-save" disabled={!anyFilled} onClick={(e) => { e.stopPropagation(); saveAll(); }}>
                Save All
              </button>
              <button className="ta-replace-cancel" onClick={(e) => { e.stopPropagation(); cancelBulk(); }}>
                Cancel
              </button>
            </>
          )}
        </div>
      </div>
      {!collapsed && (
        <div className="tracking-alerts-body">
          {bulkMode && (
            <div className="ta-bulk-panel" onClick={(e) => e.stopPropagation()}>
              <textarea
                className="ta-bulk-textarea"
                placeholder={"Paste replacements — one per line:\nEF001489687CN = 382050506119\nEF001494302CN = 382050319812"}
                value={bulkText}
                autoFocus
                onChange={(e) => setBulkText(e.target.value)}
              />
              {bulkText.trim() && parsedMap.size > 0 && (
                <div className="ta-bulk-matches">
                  {Array.from(parsedMap.entries()).map(([oldNum, newNum]) => {
                    const matched = problems.some((p) => p.trackingNum === oldNum);
                    return (
                      <div key={oldNum} className={`ta-bulk-match-row${matched ? '' : ' ta-bulk-match-row--miss'}`}>
                        <span className="ta-bulk-old">{oldNum}</span>
                        <span className="ta-bulk-arrow">→</span>
                        {matched
                          ? <span className="ta-bulk-new">{newNum}</span>
                          : <span className="ta-bulk-no-match">No match</span>
                        }
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
          {problems.map((p, i) => {
            const key = `${p.orderId}:${p.entryIdx}:${p.trackingNum}`;
            const replaceVal = replacingNums[key];
            const isMatched = bulkMode && parsedMap.has(p.trackingNum);
            return (
              <div key={i} className={`ta-row${p.isReturn ? ' ta-row-return' : ' ta-row-exception'}${isMatched ? ' ta-row-matched' : ''}`}>
                <div className="ta-row-main">
                  <span className={`ta-status-pill${p.isReturn ? ' ta-pill-return' : ' ta-pill-exception'}`}>
                    {p.isReturn ? 'Returned' : 'Exception'}
                  </span>
                  <button className="ta-tracking-num" onClick={() => copyToClipboard(p.trackingNum)} title="Click to copy">
                    {p.trackingNum}
                  </button>
                  {p.items.length > 0 && (
                    <span className="ta-items">{p.items.map((it) => `${it.productName || it.product} ${it.productStrength || it.strength}`).join(', ')}</span>
                  )}
                  <span className="ta-vendor">{p.vendor}</span>
                  <span className="ta-order-id">{p.orderId}</span>
                  {onResolve && !bulkMode && replaceVal === undefined && (
                    <button className="ta-replace-btn" onClick={(e) => { e.stopPropagation(); startReplace(key); }}>
                      Replace #
                    </button>
                  )}
                </div>
                {!bulkMode && onResolve && replaceVal !== undefined && (
                  <div className="ta-replace-row" onClick={(e) => e.stopPropagation()}>
                    <input
                      className="ta-replace-input"
                      placeholder="New tracking number"
                      value={replaceVal}
                      autoFocus
                      onChange={(e) => setReplacingNums((prev) => ({ ...prev, [key]: e.target.value }))}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') submitReplace(p, key);
                        if (e.key === 'Escape') cancelReplace(key);
                      }}
                    />
                    <button className="ta-replace-save" disabled={!replaceVal.trim()} onClick={() => submitReplace(p, key)}>
                      Save
                    </button>
                    <button className="ta-replace-cancel" onClick={() => cancelReplace(key)}>Cancel</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const SubmittedOrders = ({ onSuccess, onError, deliveredOnly = false, vendorProfile = null }) => {
  const [copiedOrderId, setCopiedOrderId] = useState(null);
  const [copiedOrderType, setCopiedOrderType] = useState(null); // 'price' or 'no-price'
  const [copiedTrackingNum, setCopiedTrackingNum] = useState(null);
  const [syncingOrderId, setSyncingOrderId] = useState(null);
  const [syncingNum, setSyncingNum] = useState(null);
  const [orders, setOrders] = useState([]);
  const [deliveredOrders, setDeliveredOrders] = useState([]);
  const [editingOrders, setEditingOrders] = useState(new Set());
  const [originalOrders, setOriginalOrders] = useState({});
  const [hasShownError, setHasShownError] = useState(false);
  const [copiedOrderMetaId, setCopiedOrderMetaId] = useState(null);
  const [availableProducts, setAvailableProducts] = useState([]);
  const [vendorProfiles, setVendorProfiles] = useState([]);
  const [addingItemToOrder, setAddingItemToOrder] = useState(null);
  const [editingTrackingCards, setEditingTrackingCards] = useState({});
  const [trackingCardSnapshots, setTrackingCardSnapshots] = useState({});
  const syncedIncomingOnce = useRef(false);
  const trackingTextareaRefs = useRef({});
  const [vendorColorMap, setVendorColorMap] = useState({});
  const [selectedVendorFilter, setSelectedVendorFilter] = useState('all');
  const [selectedDeliveredVendorFilter, setSelectedDeliveredVendorFilter] = useState('all');
  const [selectedOrderId, setSelectedOrderId] = useState(null);
  const [selectedDeliveredOrderId, setSelectedDeliveredOrderId] = useState(null);
  const [orderDetailTab, setOrderDetailTab] = useState(vendorProfile ? 'tracking' : 'items');
  const [showUndeliveredModal, setShowUndeliveredModal] = useState(false);
  const [expandedPaymentPanels, setExpandedPaymentPanels] = useState(new Set());
  const [downPaymentForms, setDownPaymentForms] = useState({});
  const [trackingFillQtys, setTrackingFillQtys] = useState({});
  const [replacingNums, setReplacingNums] = useState({});

  // Load vendor colors from Firestore
  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, 'c&pVendors'),
      (snapshot) => {
        const colors = {};
        const profiles = [];
        snapshot.forEach((snap) => {
          const data = snap.data();
          profiles.push({ id: snap.id, ...data });
          if (data.color) colors[data.name || snap.id] = data.color;
        });
        setVendorColorMap(colors);
        setVendorProfiles(profiles);
      }
    );
    return () => unsubscribe();
  }, []);

  // Listen to pending orders
  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, 'c&pProductOrders'),
      (snapshot) => {
        const ordersData = [];
        snapshot.forEach((snap) => {
          const data = snap.data();
          const itemsWithIds =
            data.items?.map((item) => ({
              ...item,
              warehouse: item.warehouse || data.warehouse || 'US',
              itemId:
                item.itemId ||
                `${snap.id}-${item.productName || ''}-${item.productStrength || ''}-${Math.random()
                  .toString(36)
                  .substr(2, 9)}`
            })) || [];

          ordersData.push({
            id: snap.id,
            ...data,
            items: itemsWithIds,
            status: data.status || 'pending',
            warehouse: data.warehouse || 'US',
            vendor: data.vendor || 'TSC'
          });
        });

        // Backfill vendor on old orders missing it
        ordersData.forEach((order) => {
          if (!order.vendor || order.vendor === 'TSC') {
            const snap = snapshot.docs.find((d) => d.id === order.id);
            if (snap && !snap.data().vendor) {
              updateDoc(doc(db, 'c&pProductOrders', order.id), { vendor: 'TSC' }).catch(() => {});
            }
          }
        });

        ordersData.sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));
        const pendingOnly = ordersData.filter((o) => {
          const status = (o.status || 'pending').toString().toLowerCase();
          const deliveredFlag = status === 'delivered' || !!o.deliveredAt;
          return !deliveredFlag;
        });
        setOrders(pendingOnly);
        setHasShownError(false);

        // Sync aggregate incoming list
        syncIncomingAggregates(pendingOnly);

      },
      (error) => {
        console.error('Error listening to orders:', error);
        if (!hasShownError) {
          onError && onError('Error loading orders: ' + error.message);
          setHasShownError(true);
        }
      }
    );

    return () => unsubscribe();
  }, [hasShownError, onError]);

  // Listen to delivered orders
  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, 'c&pPastInventoryOrders'),
      (snapshot) => {
        const ordersData = [];
        snapshot.forEach((snap) => {
          const data = snap.data();
          ordersData.push({ id: snap.id, ...data, warehouse: data.warehouse || 'US', vendor: data.vendor || 'TSC' });
        });

        // Backfill vendor on old delivered orders missing it
        ordersData.forEach((order) => {
          if (!order.vendor || order.vendor === 'TSC') {
            const snap = snapshot.docs.find((d) => d.id === order.id);
            if (snap && !snap.data().vendor) {
              updateDoc(doc(db, 'c&pPastInventoryOrders', order.id), { vendor: 'TSC' }).catch(() => {});
            }
          }
        });

        ordersData.sort((a, b) => new Date(b.deliveredAt) - new Date(a.deliveredAt));
        setDeliveredOrders(ordersData);
      },
      (error) => {
        console.error('Error listening to delivered orders:', error);
      }
    );

    return () => unsubscribe();
  }, []);

  // Listen to available products
  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, 'c&pProductList'),
      (snapshot) => {
        const productsData = [];
        snapshot.forEach((snap) => {
          productsData.push({ id: snap.id, ...snap.data() });
        });
        productsData.sort((a, b) => a.product.localeCompare(b.product));
        setAvailableProducts(productsData);
      },
      (error) => {
        console.error('Error listening to products:', error);
      }
    );

    return () => unsubscribe();
  }, []);

  // Helpers ---------------------------------------------------
  const syncIncomingAggregates = async (pendingOrders) => {
    try {
      // Build aggregate qty per product/strength from pending orders only
      // Only count items that are NOT marked as delivered
      const aggregates = {};
      pendingOrders.forEach((order) => {
        (order.items || []).forEach((item) => {
          // Skip items that are individually marked as delivered
          const isItemDelivered = item.delivered || item.deliveredAt;
          if (isItemDelivered) return;
          
          const name = item.productName || item.product || '';
          const strength = item.productStrength || item.strength || '';
          const key = `${name}__${strength}`.replace(/\//g, '|');
          const qty = Number(item.quantity) || 0;
          if (!aggregates[key]) aggregates[key] = { name, strength, qty: 0 };
          aggregates[key].qty += qty;
        });
      });

      // Fetch existing docs to remove any no longer present
      const existingSnap = await getDocs(collection(db, 'c&pIncomingProductRecieved'));
      const existingKeys = new Set();
      existingSnap.forEach((d) => existingKeys.add(d.id));

      // Upsert current aggregates, and ensure received doesn't exceed qty
      await Promise.all(
        Object.entries(aggregates).map(([key, data]) => {
          const existingDoc = existingSnap.docs.find(d => d.id === key);
          const existingReceived = existingDoc ? Number(existingDoc.data().received) || 0 : 0;
          // Cap received at the new qty to prevent orphaned received counts
          const received = Math.min(existingReceived, data.qty);
          return setDoc(
            doc(db, 'c&pIncomingProductRecieved', key),
            { name: data.name, strength: data.strength, qty: data.qty, received },
            { merge: true }
          );
        })
      );

      // Remove entries that no longer exist
      const missing = [...existingKeys].filter((k) => !aggregates[k]);
      await Promise.all(missing.map((k) => deleteDoc(doc(db, 'c&pIncomingProductRecieved', k))));
    } catch (err) {
      console.error('Failed to sync incoming aggregates', err);
    }
  };

  const groupOrdersByDate = (ordersList) => {
    const grouped = {};
    ordersList.forEach((order) => {
      const date = new Date(order.submittedAt || order.deliveredAt);
      const key = date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(order);
    });
    return grouped;
  };

  // Ensure existing pending orders get pushed once into incoming aggregates after initial load
  useEffect(() => {
    if (!syncedIncomingOnce.current && orders.length > 0) {
      syncedIncomingOnce.current = true;
      syncIncomingAggregates(orders);
    }
  }, [orders]);

  // Auto-select latest order; if selected order is removed, fall back to latest
  useEffect(() => {
    if (!deliveredOnly && orders.length > 0) {
      const ids = new Set(orders.map(o => o.id));
      if (!selectedOrderId || !ids.has(selectedOrderId)) {
        setSelectedOrderId(orders[0].id);
      }
    }
  }, [orders, deliveredOnly]);

  // Reset tab when switching pending order
  useEffect(() => { setOrderDetailTab(vendorProfile ? 'tracking' : 'items'); }, [selectedOrderId]);

  const deleteOrder = async (order) => {
    try {
      const collectionName = order?.deliveredAt ? 'c&pPastInventoryOrders' : 'c&pProductOrders';
      await deleteDoc(doc(db, collectionName, order.id));
      onSuccess && onSuccess('Order deleted.');
    } catch (error) {
      console.error('Error deleting order:', error);
      onError && onError('Failed to delete order.');
    }
  };

  const toggleEdit = async (orderId) => {
    const next = new Set(editingOrders);
    if (next.has(orderId)) {
      await saveOrderChanges(orderId);
      next.delete(orderId);
      setOriginalOrders((prev) => {
        const copy = { ...prev };
        delete copy[orderId];
        return copy;
      });
    } else {
      next.add(orderId);
      const order = orders.find((o) => o.id === orderId);
      if (order) {
        setOriginalOrders((prev) => ({ ...prev, [orderId]: JSON.parse(JSON.stringify(order)) }));
        if (!order.carrier) {
          updateCarrier(orderId, 'UPS');
        }
      }
    }
    setEditingOrders(next);
  };

  const cancelEdit = (orderId) => {
    const original = originalOrders[orderId];
    if (original) {
      setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...original } : o)));
    }
    const next = new Set(editingOrders);
    next.delete(orderId);
    setEditingOrders(next);
    setOriginalOrders((prev) => {
      const copy = { ...prev };
      delete copy[orderId];
      return copy;
    });
    if (addingItemToOrder === orderId) setAddingItemToOrder(null);
  };

  const updateOrderItems = async (orderId, items) => {
    try {
      const total = items.reduce((sum, item) => sum + item.quantity * item.pricePerKit, 0);
      await updateDoc(doc(db, 'c&pProductOrders', orderId), { items, total });
    } catch (error) {
      console.error('Error updating order:', error);
      onError && onError('Failed to update order: ' + error.message);
    }
  };

  const calculateItemsTotal = (items) =>
    items.reduce((sum, item) => sum + (Number(item.quantity) || 0) * (Number(item.pricePerKit) || 0), 0);

  const normalizeItemWarehouse = (item, fallbackWarehouse = 'US') => ({
    ...item,
    warehouse: (item.warehouse || fallbackWarehouse || 'US').toUpperCase()
  });

  const getDayBucket = (value) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value || 'unknown-day');
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const mergeOrdersByDate = (ordersList, dateField = 'submittedAt') => {
    const groups = new Map();

    ordersList.forEach((order) => {
      const dayKey = getDayBucket(order[dateField] || order.submittedAt || order.deliveredAt);
      if (!groups.has(dayKey)) groups.set(dayKey, []);
      groups.get(dayKey).push(order);
    });

    const merged = [];
    groups.forEach((group, dayKey) => {
      if (group.length === 1) {
        merged.push(group[0]);
        return;
      }

      const primary =
        [...group].sort(
          (a, b) =>
            new Date(b[dateField] || b.submittedAt || b.deliveredAt || 0) -
            new Date(a[dateField] || a.submittedAt || a.deliveredAt || 0)
        )[0];

      const itemMap = new Map();
      group.forEach((order) => {
        (order.items || []).forEach((item) => {
          const normalized = normalizeItemWarehouse(item, order.warehouse || primary.warehouse || 'US');
          itemMap.set(normalized.itemId, normalized);
        });
      });

      const entryMap = new Map();
      group.forEach((order) => {
        (order.trackingEntries || []).forEach((entry) => {
          const key = `${entry.id || ''}::${entry.carrier || ''}::${entry.number || ''}`;
          entryMap.set(key, entry);
        });
      });

      const mergedItems = [...itemMap.values()];
      const mergedTrackingEntries = [...entryMap.values()];

      merged.push({
        ...primary,
        warehouseParentId: dayKey,
        items: mergedItems,
        trackingEntries: mergedTrackingEntries,
        total: calculateItemsTotal(mergedItems)
      });
    });

    return merged.sort(
      (a, b) =>
        new Date(b[dateField] || b.submittedAt || b.deliveredAt || 0) -
        new Date(a[dateField] || a.submittedAt || a.deliveredAt || 0)
    );
  };

  const consolidateOrdersByDate = async (ordersList, collectionName, dateField = 'submittedAt') => {
    const groups = new Map();

    ordersList.forEach((order) => {
      const dayKey = getDayBucket(order[dateField] || order.submittedAt || order.deliveredAt);
      if (!groups.has(dayKey)) groups.set(dayKey, []);
      groups.get(dayKey).push(order);
    });

    for (const [dayKey, group] of groups.entries()) {
      if (group.length <= 1) continue;

      const primary =
        [...group].sort(
          (a, b) =>
            new Date(b[dateField] || b.submittedAt || b.deliveredAt || 0) -
            new Date(a[dateField] || a.submittedAt || a.deliveredAt || 0)
        )[0];

      const mergedOrder = mergeOrdersByDate(group, dateField)[0];
      await setDoc(
        doc(db, collectionName, primary.id),
        {
          ...mergedOrder,
          warehouseParentId: dayKey,
          total: calculateItemsTotal(mergedOrder.items || [])
        },
        { merge: true }
      );

      const nonPrimary = group.filter((o) => o.id !== primary.id);
      await Promise.all(nonPrimary.map((o) => deleteDoc(doc(db, collectionName, o.id))));
    }
  };

  const getMappedWarehousePrice = (item, warehouse) => {
    const productName = item.productName || item.product || '';
    const productStrength = item.productStrength || item.strength || '';
    const matchingProduct = availableProducts.find(
      (p) => p.product === productName && p.strength === productStrength
    );
    const mappedWarehousePrice = matchingProduct?.warehouseCosts?.[warehouse];
    if (typeof mappedWarehousePrice === 'number' && Number.isFinite(mappedWarehousePrice)) {
      return mappedWarehousePrice;
    }
    return item.pricePerKit;
  };

  const getVendorProductPrice = (order, product) => {
    if (!order || !product) return 0;
    const orderVendor = order.vendor || 'TSC';
    const orderWarehouse = (order.warehouse || 'US').toUpperCase();

    if (orderVendor === 'TSC') {
      return Number(product.warehouseCosts?.[orderWarehouse]) || 0;
    }

    const vendorProfile = vendorProfiles.find((v) => v.id === orderVendor);
    const vendorName = vendorProfile?.name || orderVendor;

    const vendorPricingById = product.vendorPricing?.[orderVendor];
    if (vendorPricingById && typeof vendorPricingById.price === 'number') {
      return vendorPricingById.price;
    }

    const vendorPricingByName = product.vendorPricing?.[vendorName];
    if (vendorPricingByName && typeof vendorPricingByName.price === 'number') {
      return vendorPricingByName.price;
    }

    const profileProductKey = `${product.product}__${product.strength}`;
    const profileProduct = vendorProfile?.products?.[profileProductKey];
    if (profileProduct && typeof profileProduct.price === 'number') {
      return profileProduct.price;
    }

    return Number(product.warehouseCosts?.[orderWarehouse]) || 0;
  };

  const getAddableProductsForOrder = (order) => {
    if (!order) return [];
    const orderWarehouse = (order.warehouse || 'US').toUpperCase();

    return availableProducts
      .filter((product) => {
        if ((order.vendor || 'TSC') === 'TSC') {
          return (Number(product.warehouseCosts?.[orderWarehouse]) || 0) > 0;
        }
        return getVendorProductPrice(order, product) > 0;
      })
      .sort((a, b) => {
        const nameDiff = (a.product || '').localeCompare(b.product || '');
        if (nameDiff !== 0) return nameDiff;
        return (a.strength || '').localeCompare(b.strength || '');
      });
  };

  const updateItemWarehouse = async (orderId, itemId, newWarehouse) => {
    const order = orders.find((o) => o.id === orderId);
    if (!order) return;

    const targetWarehouse = (newWarehouse || 'US').toUpperCase();
    const updatedItems = order.items.map((item) => {
      if (item.itemId !== itemId) return item;
      return {
        ...item,
        warehouse: targetWarehouse,
        pricePerKit: getMappedWarehousePrice(item, targetWarehouse)
      };
    });

    const updatedTotal = calculateItemsTotal(updatedItems);
    setOrders((prev) =>
      prev.map((o) => (o.id === orderId ? { ...o, items: updatedItems, total: updatedTotal } : o))
    );

    try {
      await updateDoc(doc(db, 'c&pProductOrders', orderId), {
        items: updatedItems,
        total: updatedTotal
      });
    } catch (error) {
      console.error('Error updating item warehouse:', error);
      onError && onError('Failed to update item warehouse.');
    }
  };

  const updateOrderDate = (orderId, newDate) => {
    setOrders((prev) =>
      prev.map((o) => (o.id === orderId ? { ...o, submittedAt: new Date(newDate).toISOString() } : o))
    );
  };

  const removeItemFromOrder = async (orderId, itemId) => {
    const order = orders.find((o) => o.id === orderId);
    if (!order) return;
    const updatedItems = order.items.filter((item) => item.itemId !== itemId);
    if (!updatedItems.length) {
      await markOrderDelivered(orderId);
    } else {
      await updateOrderItems(orderId, updatedItems);
    }
  };

  const markOrderDelivered = async (orderId) => {
    try {
      const order = orders.find((o) => o.id === orderId);
      if (!order) return;
      
      // Mark all items as delivered
      const updatedItems = order.items.map((item) => ({
        ...item,
        status: 'delivered'
      }));
      
      const deliveredOrderData = {
        ...order,
        items: updatedItems,
        deliveredAt: new Date().toISOString(),
        originalOrderId: orderId,
        status: 'delivered'
      };
      delete deliveredOrderData.id;
      await setDoc(doc(db, 'c&pPastInventoryOrders', orderId), deliveredOrderData);
      await deleteDoc(doc(db, 'c&pProductOrders', orderId));
      const next = new Set(editingOrders);
      next.delete(orderId);
      setEditingOrders(next);
    } catch (error) {
      console.error('Error marking delivered:', error);
      onError && onError('Failed to mark order as delivered. Please try again.');
    }
  };

  const restoreDeliveredOrder = async (orderId) => {
    try {
      const order = deliveredOrders.find((o) => o.id === orderId);
      if (!order) return;

      const restoredItems = (order.items || []).map((item) => {
        const nextItem = { ...item };
        if (nextItem.status === 'delivered') {
          nextItem.status = 'pending';
        }
        delete nextItem.deliveredAt;
        return nextItem;
      });

      const pendingOrderData = {
        ...order,
        items: restoredItems,
        status: 'pending',
        total: calculateItemsTotal(restoredItems),
        restoredFromDeliveredAt: order.deliveredAt || null
      };

      delete pendingOrderData.deliveredAt;
      delete pendingOrderData.originalOrderId;
      delete pendingOrderData.warehouseParentId;
      delete pendingOrderData.id;

      await setDoc(doc(db, 'c&pProductOrders', orderId), pendingOrderData);
      await deleteDoc(doc(db, 'c&pPastInventoryOrders', orderId));
    } catch (error) {
      console.error('Error restoring delivered order:', error);
      onError && onError('Failed to move order back to pending. Please try again.');
    }
  };

  const updateItemStatus = async (orderId, itemId, status) => {
    setOrders((prev) =>
      prev.map((o) => {
        if (o.id !== orderId) return o;
        const updatedItems = o.items.map((item) =>
          item.itemId === itemId ? { ...item, status } : item
        );
        return { ...o, items: updatedItems };
      })
    );

    try {
      const order = orders.find((o) => o.id === orderId);
      if (!order) return;
      const updatedItems = order.items.map((item) =>
        item.itemId === itemId ? { ...item, status } : item
      );
      await updateDoc(doc(db, 'c&pProductOrders', orderId), { items: updatedItems });
    } catch (error) {
      console.error('Error updating item status:', error);
    }
  };

  const updateCarrier = async (orderId, carrier) => {
    try {
      await updateDoc(doc(db, 'c&pProductOrders', orderId), { carrier });
    } catch (error) {
      console.error('Error updating carrier:', error);
    }
  };

  const updateDiscount = async (orderId, discountPercent) => {
    try {
      await updateDoc(doc(db, 'c&pProductOrders', orderId), { discountPercent });
    } catch (error) {
      console.error('Error updating discount:', error);
    }
  };

  const updateOrderStatus = async (orderId, status) => {
    try {
      await updateDoc(doc(db, 'c&pProductOrders', orderId), { status });
    } catch (error) {
      console.error('Error updating order status:', error);
    }
  };

  const trackingCardKey = (orderId, entryIdx) => `${orderId}:${entryIdx}`;

  const isTrackingCardEditing = (orderId, entryIdx) =>
    Boolean(editingTrackingCards[trackingCardKey(orderId, entryIdx)]);

  const getEffectiveTrackingEntries = (ord) => {
    if (ord?.trackingEntries && Array.isArray(ord.trackingEntries) && ord.trackingEntries.length) {
      return ord.trackingEntries;
    }
    if (ord?.trackingNumber && ord?.carrier) {
      return [{ id: 'legacy', carrier: ord.carrier, number: ord.trackingNumber, note: '', status: ord.status || 'pending' }];
    }
    return [];
  };

  const setTrackingCardEditing = (orderId, entryIdx, isEditing) => {
    const key = trackingCardKey(orderId, entryIdx);
    if (isEditing) {
      // Snapshot the entry so Cancel can revert
      const order = orders.find((o) => o.id === orderId);
      const entry = getEffectiveTrackingEntries(order)[entryIdx];
      if (entry) {
        setTrackingCardSnapshots((prev) => ({ ...prev, [key]: JSON.parse(JSON.stringify(entry)) }));
      }
    } else {
      setTrackingCardSnapshots((prev) => { const n = { ...prev }; delete n[key]; return n; });
    }
    setEditingTrackingCards((prev) => {
      const next = { ...prev };
      if (isEditing) {
        next[key] = true;
      } else {
        delete next[key];
      }
      return next;
    });
  };

  const cancelTrackingCardEdit = async (orderId, entryIdx) => {
    const key = trackingCardKey(orderId, entryIdx);
    const snapshot = trackingCardSnapshots[key];
    if (snapshot) {
      setOrders((prev) => prev.map((o) => {
        if (o.id !== orderId) return o;
        const entries = [...getEffectiveTrackingEntries(o)];
        entries[entryIdx] = snapshot;
        return { ...o, trackingEntries: entries };
      }));
      await saveTrackingEntries(orderId, (() => {
        const order = orders.find((o) => o.id === orderId);
        const entries = [...getEffectiveTrackingEntries(order)];
        entries[entryIdx] = snapshot;
        return entries;
      })());
    }
    setTrackingCardEditing(orderId, entryIdx, false);
  };

  const clearTrackingCardEditsForOrder = (orderId) => {
    setEditingTrackingCards((prev) => {
      const next = { ...prev };
      Object.keys(next).forEach((key) => {
        if (key.startsWith(`${orderId}:`)) delete next[key];
      });
      return next;
    });
  };

  const stripUndef = (v) => {
    if (Array.isArray(v)) return v.map(stripUndef);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).filter(([, val]) => val !== undefined).map(([k, val]) => [k, stripUndef(val)]));
    return v;
  };

  const saveTrackingEntries = async (orderId, entries) => {
    try {
      const isDeliveredOrder = deliveredOrders.some((o) => o.id === orderId);
      const collection = isDeliveredOrder ? 'c&pPastInventoryOrders' : 'c&pProductOrders';
      await updateDoc(doc(db, collection, orderId), { trackingEntries: stripUndef(entries) });
    } catch (error) {
      console.error('Error saving tracking entries:', error);
      onError && onError('Failed to update tracking entries.');
    }
  };

  const updateTrackingEntry = async (orderId, entryIdx, patch) => {
    setOrders((prev) =>
      prev.map((o) => {
        if (o.id !== orderId) return o;
        const entries = [...getEffectiveTrackingEntries(o)];
        if (!entries[entryIdx]) return o;
        entries[entryIdx] = { ...entries[entryIdx], ...patch };
        return { ...o, trackingEntries: entries };
      })
    );

    const order = orders.find((o) => o.id === orderId);
    const entries = [...getEffectiveTrackingEntries(order)];
    if (!entries[entryIdx]) return;
    entries[entryIdx] = { ...entries[entryIdx], ...patch };
    await saveTrackingEntries(orderId, entries);
  };

  const addTrackingEntry = async (orderId) => {
    const order = orders.find((o) => o.id === orderId);
    const entries = [
      { id: Date.now().toString(), carrier: order?.carrier || 'UPS', number: '', note: '', status: 'pending' },
      ...getEffectiveTrackingEntries(order),
    ];

    setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, trackingEntries: entries } : o)));
    setTrackingCardEditing(orderId, 0, true);
    await saveTrackingEntries(orderId, entries);
  };

  const syncTrackingStatus = async (orderId) => {
    const order = orders.find((o) => o.id === orderId) || deliveredOrders.find((o) => o.id === orderId);
    if (!order) return;
    const entries = getEffectiveTrackingEntries(order);
    const undeliveredItems = entries.flatMap((e) => {
      const all = getTrackingNumbers(e.number);
      const skip = new Set([...(e.deliveredNumbers || []), ...(e.pendingDeliveryNumbers || [])]);
      return all
        .filter((n) => !skip.has(n))
        .map((n) => ({ number: n, carrier: detectCarrier(n) || e.carrier || 'UPS' }));
    });
    if (!undeliveredItems.length) {
      onSuccess?.('All tracking numbers already marked delivered.');
      return;
    }
    setSyncingOrderId(orderId);
    try {
      const res = await fetch('/api/17track/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trackingItems: undeliveredItems }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Sync failed.');
      const deliveredNums = new Set((data.results || []).filter((r) => r.isDelivered).map((r) => r.number));
      const rejectedByNum = Object.fromEntries((data.rejected || []).map((r) => [r.number, r.reason || 'Not tracked by 17track']));
      const statusByNum = {};
      const carrierByNum = {};
      const infoByNum = {};
      (data.results || []).forEach((r) => {
        if (r.latestDesc || r.status) statusByNum[r.number] = r.latestDesc || r.status;
        if (r.detectedCarrier) carrierByNum[r.number] = r.detectedCarrier;
        infoByNum[r.number] = {
          ...(r.subStatus && { subStatus: r.subStatus }),
          ...(r.destination && { destination: r.destination }),
          ...(r.currentLocation && { currentLocation: r.currentLocation }),
          ...(r.lastUpdated && { lastUpdated: r.lastUpdated }),
          ...(r.deliveryDate && { deliveryDate: r.deliveryDate }),
          ...(r.estimatedDelivery && { estimatedDelivery: r.estimatedDelivery }),
        };
      });

      // Always compute updatedEntries so carrier corrections happen even when
      // 17track rejects all numbers. Detected deliveries go to pendingDeliveryNumbers
      // so the user can confirm before they're checked off.
      const updatedEntries = entries.map((e) => {
        const nums = getTrackingNumbers(e.number);
        const newPending = [...new Set([...(e.pendingDeliveryNumbers || []), ...nums.filter((n) => deliveredNums.has(n))])];
        const updatedPnd = { ...(e.perNumberData || {}) };
        nums.forEach((n) => {
          const patch = {};
          if (statusByNum[n]) patch.trackStatus = statusByNum[n];
          if (infoByNum[n]) Object.assign(patch, infoByNum[n]);
          if (rejectedByNum[n]) patch.rejected = rejectedByNum[n];
          // Clear stale rejection if this number now has a result
          if (statusByNum[n] && updatedPnd[n]?.rejected) patch.rejected = null;
          if (Object.keys(patch).length) updatedPnd[n] = { ...(updatedPnd[n] || {}), ...patch };
        });
        // 17track detection first, local detectCarrier as fallback. Use majority vote.
        const allDetected = nums.map((n) => carrierByNum[n] || detectCarrier(n)).filter(Boolean);
        const freq = allDetected.reduce((m, c) => { m[c] = (m[c] || 0) + 1; return m; }, {});
        const majority = Object.entries(freq).sort((a, b) => b[1] - a[1])[0];
        const newCarrier = majority ? majority[0] : e.carrier;
        return { ...e, carrier: newCarrier, pendingDeliveryNumbers: newPending, perNumberData: updatedPnd };
      });

      const carrierUpdates = updatedEntries.filter((e, i) => e.carrier !== entries[i].carrier).length;
      const newPendingCount = updatedEntries.reduce((s, e) => s + (e.pendingDeliveryNumbers || []).length, 0)
        - entries.reduce((s, e) => s + (e.pendingDeliveryNumbers || []).length, 0);
      const rejectedCount = Object.keys(rejectedByNum).length;
      const anythingChanged = newPendingCount > 0 || rejectedCount > 0 || Object.keys(statusByNum).length > 0 || carrierUpdates > 0;

      if (!anythingChanged) {
        onSuccess?.('Synced — no changes detected.');
        return;
      }

      await saveTrackingEntries(orderId, updatedEntries);
      const isAlreadyDelivered = !orders.find((o) => o.id === orderId);
      if (isAlreadyDelivered) {
        setDeliveredOrders((prev) => prev.map((o) => o.id === orderId ? { ...o, trackingEntries: updatedEntries } : o));
      } else {
        setOrders((prev) => prev.map((o) => o.id === orderId ? { ...o, trackingEntries: updatedEntries } : o));
      }
      const pendingMsg = newPendingCount > 0 ? `${newPendingCount} awaiting confirmation. ` : '';
      const rejectedMsg = rejectedCount > 0 ? `${rejectedCount} not found — see cards. ` : '';
      const carrierMsg = carrierUpdates ? `${carrierUpdates} carrier${carrierUpdates > 1 ? 's' : ''} corrected. ` : '';
      const statusMsg = Object.keys(statusByNum).length ? `Statuses updated.` : '';
      onSuccess?.(`Synced — ${pendingMsg}${rejectedMsg}${carrierMsg}${statusMsg}`.trim());
    } catch (err) {
      onError?.(err.message || 'Sync failed.');
    } finally {
      setSyncingOrderId(null);
    }
  };

  const syncSingleTracking = async (orderId, entryIndex, num) => {
    const order = orders.find((o) => o.id === orderId) || deliveredOrders.find((o) => o.id === orderId);
    if (!order) return;
    setSyncingNum(num);
    try {
      const carrier = detectCarrier(num) || 'UPS';
      const res = await fetch('/api/17track/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trackingItems: [{ number: num, carrier }] }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Sync failed.');

      const result = (data.results || []).find((r) => r.number === num);
      const rejected = (data.rejected || []).find((r) => r.number === num);

      if (!result) {
        const reason = rejected?.reason || 'Not tracked by 17track.';
        // Store the rejection so it's visible on the card
        const entries = getEffectiveTrackingEntries(order);
        const updatedEntries = entries.map((e, i) => {
          if (i !== entryIndex) return e;
          const updatedPnd = { ...(e.perNumberData || {}) };
          updatedPnd[num] = { ...(updatedPnd[num] || {}), rejected: reason };
          return { ...e, perNumberData: updatedPnd };
        });
        await saveTrackingEntries(orderId, updatedEntries);
        const isAlreadyDelivered = !orders.find((o) => o.id === orderId);
        if (isAlreadyDelivered) {
          setDeliveredOrders((prev) => prev.map((o) => o.id === orderId ? { ...o, trackingEntries: updatedEntries } : o));
        } else {
          setOrders((prev) => prev.map((o) => o.id === orderId ? { ...o, trackingEntries: updatedEntries } : o));
        }
        onError?.(reason);
        return;
      }

      const entries = getEffectiveTrackingEntries(order);
      const updatedEntries = entries.map((e, i) => {
        if (i !== entryIndex) return e;
        const newPending = result.isDelivered
          ? [...new Set([...(e.pendingDeliveryNumbers || []), num])]
          : (e.pendingDeliveryNumbers || []);
        const updatedPnd = { ...(e.perNumberData || {}) };
        const patch = { rejected: null }; // clear any prior rejection
        if (result.latestDesc || result.status) patch.trackStatus = result.latestDesc || result.status;
        if (result.subStatus) patch.subStatus = result.subStatus;
        if (result.destination) patch.destination = result.destination;
        if (result.currentLocation) patch.currentLocation = result.currentLocation;
        if (result.lastUpdated) patch.lastUpdated = result.lastUpdated;
        if (result.deliveryDate) patch.deliveryDate = result.deliveryDate;
        if (result.estimatedDelivery) patch.estimatedDelivery = result.estimatedDelivery;
        else patch.estimatedDelivery = null;
        updatedPnd[num] = { ...(updatedPnd[num] || {}), ...patch };
        const newCarrier = result.detectedCarrier || e.carrier;
        return { ...e, carrier: newCarrier, pendingDeliveryNumbers: newPending, perNumberData: updatedPnd };
      });

      await saveTrackingEntries(orderId, updatedEntries);
      const isAlreadyDelivered = !orders.find((o) => o.id === orderId);
      if (isAlreadyDelivered) {
        setDeliveredOrders((prev) => prev.map((o) => o.id === orderId ? { ...o, trackingEntries: updatedEntries } : o));
      } else {
        setOrders((prev) => prev.map((o) => o.id === orderId ? { ...o, trackingEntries: updatedEntries } : o));
      }
      const statusText = result.latestDesc || result.status || '';
      onSuccess?.(result.isDelivered ? `${num} delivered — confirm when received.` : `${num} synced — ${statusText || 'no change'}.`);
    } catch (err) {
      onError?.(err.message || 'Sync failed.');
    } finally {
      setSyncingNum(null);
    }
  };

  const confirmDelivery = async (orderId, entryIndex, num) => {
    const order = orders.find((o) => o.id === orderId) || deliveredOrders.find((o) => o.id === orderId);
    if (!order) return;
    const entries = getEffectiveTrackingEntries(order);
    const updatedEntries = entries.map((e, i) => {
      if (i !== entryIndex) return e;
      const newDelivered = [...new Set([...(e.deliveredNumbers || []), num])];
      const newPending = (e.pendingDeliveryNumbers || []).filter((n) => n !== num);
      const nums = getTrackingNumbers(e.number);
      const allDelivered = nums.length > 0 && nums.every((n) => newDelivered.includes(n));
      const updatedPnd = { ...(e.perNumberData || {}) };
      updatedPnd[num] = { ...(updatedPnd[num] || {}), confirmedAt: new Date().toISOString() };
      return { ...e, deliveredNumbers: newDelivered, pendingDeliveryNumbers: newPending, status: allDelivered ? 'delivered' : e.status, perNumberData: updatedPnd };
    });
    await saveTrackingEntries(orderId, updatedEntries);
    const isAlreadyDelivered = !orders.find((o) => o.id === orderId);
    if (isAlreadyDelivered) {
      setDeliveredOrders((prev) => prev.map((o) => o.id === orderId ? { ...o, trackingEntries: updatedEntries } : o));
    } else {
      setOrders((prev) => prev.map((o) => o.id === orderId ? { ...o, trackingEntries: updatedEntries } : o));
    }
  };

  const dismissPendingDelivery = async (orderId, entryIndex, num) => {
    const order = orders.find((o) => o.id === orderId) || deliveredOrders.find((o) => o.id === orderId);
    if (!order) return;
    const entries = getEffectiveTrackingEntries(order);
    const updatedEntries = entries.map((e, i) => {
      if (i !== entryIndex) return e;
      return { ...e, pendingDeliveryNumbers: (e.pendingDeliveryNumbers || []).filter((n) => n !== num) };
    });
    await saveTrackingEntries(orderId, updatedEntries);
    const isAlreadyDelivered = !orders.find((o) => o.id === orderId);
    if (isAlreadyDelivered) {
      setDeliveredOrders((prev) => prev.map((o) => o.id === orderId ? { ...o, trackingEntries: updatedEntries } : o));
    } else {
      setOrders((prev) => prev.map((o) => o.id === orderId ? { ...o, trackingEntries: updatedEntries } : o));
    }
  };

  const resolveBulkTrackingNumbers = async (replacements) => {
    // Group by orderId so same-order replacements are applied in one pass (avoids stale-state race)
    const byOrder = {};
    for (const r of replacements) {
      if (!byOrder[r.orderId]) byOrder[r.orderId] = [];
      byOrder[r.orderId].push(r);
    }

    const updatedEntriesByOrder = {};
    const numsToSync = []; // { orderId, entryIdx, trimmed }

    for (const [orderId, reps] of Object.entries(byOrder)) {
      const order = orders.find((o) => o.id === orderId);
      if (!order) continue;
      const entries = [...getEffectiveTrackingEntries(order)];

      for (const { entryIdx, oldNum, newNum } of reps) {
        const trimmed = newNum.trim();
        if (!trimmed) continue;
        const entry = entries[entryIdx];
        if (!entry) continue;
        const nums = getTrackingNumbers(entry.number);
        const updatedNums = nums.map((n) => (n === oldNum ? trimmed : n));
        const pnd = { ...(entry.perNumberData || {}) };
        const oldData = pnd[oldNum] || {};
        pnd[trimmed] = Object.fromEntries(Object.entries({ qty: oldData.qty, cost: oldData.cost }).filter(([, v]) => v !== undefined));
        delete pnd[oldNum];
        entries[entryIdx] = {
          ...entry,
          number: updatedNums.join('\n'),
          perNumberData: pnd,
          deliveredNumbers: (entry.deliveredNumbers || []).filter((n) => n !== oldNum),
          pendingDeliveryNumbers: (entry.pendingDeliveryNumbers || []).filter((n) => n !== oldNum),
          replacedNumbers: [...(entry.replacedNumbers || []), { old: oldNum, new: trimmed, replacedAt: new Date().toISOString() }],
        };
        numsToSync.push({ orderId, entryIdx, trimmed });
      }

      updatedEntriesByOrder[orderId] = entries;
    }

    setOrders((prev) => prev.map((o) => updatedEntriesByOrder[o.id] ? { ...o, trackingEntries: updatedEntriesByOrder[o.id] } : o));
    await Promise.all(Object.entries(updatedEntriesByOrder).map(([oid, entries]) => saveTrackingEntries(oid, entries)));

    if (!numsToSync.length) return;

    try {
      const trackingItems = numsToSync.map(({ trimmed }) => ({ number: trimmed, carrier: detectCarrier(trimmed) || 'UPS' }));
      const res = await fetch('/api/17track/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trackingItems }),
      });
      if (!res.ok) {
        onSuccess?.(`Replaced ${numsToSync.length} number${numsToSync.length > 1 ? 's' : ''}. Status pending.`);
        return;
      }
      const data = await res.json();
      const resultsByNum = Object.fromEntries((data.results || []).map((r) => [r.number, r]));

      const syncedEntriesByOrder = {};
      for (const { orderId, entryIdx, trimmed } of numsToSync) {
        const entries = syncedEntriesByOrder[orderId] || [...updatedEntriesByOrder[orderId]];
        syncedEntriesByOrder[orderId] = entries;
        const result = resultsByNum[trimmed];
        if (!result) continue;
        const entry = entries[entryIdx];
        const pnd = { ...(entry.perNumberData || {}) };
        const patch = { rejected: null };
        if (result.latestDesc || result.status) patch.trackStatus = result.latestDesc || result.status;
        if (result.currentLocation) patch.currentLocation = result.currentLocation;
        if (result.lastUpdated) patch.lastUpdated = result.lastUpdated;
        if (result.estimatedDelivery) patch.estimatedDelivery = result.estimatedDelivery;
        if (result.deliveryDate) patch.deliveryDate = result.deliveryDate;
        pnd[trimmed] = { ...(pnd[trimmed] || {}), ...patch };
        entries[entryIdx] = {
          ...entry,
          perNumberData: pnd,
          ...(result.isDelivered && { pendingDeliveryNumbers: [...new Set([...(entry.pendingDeliveryNumbers || []), trimmed])] }),
        };
      }

      if (Object.keys(syncedEntriesByOrder).length) {
        setOrders((prev) => prev.map((o) => syncedEntriesByOrder[o.id] ? { ...o, trackingEntries: syncedEntriesByOrder[o.id] } : o));
        await Promise.all(Object.entries(syncedEntriesByOrder).map(([oid, entries]) => {
          try { return updateDoc(doc(db, 'c&pProductOrders', oid), { trackingEntries: entries }); } catch { return Promise.resolve(); }
        }));
      }
      onSuccess?.(`Replaced ${numsToSync.length} number${numsToSync.length > 1 ? 's' : ''} and synced status.`);
    } catch {
      onSuccess?.(`Replaced ${numsToSync.length} number${numsToSync.length > 1 ? 's' : ''}. Status pending.`);
    }
  };

  const resolveTrackingNumber = async (orderId, entryIdx, oldNum, newNum) => {
    const trimmed = newNum.trim();
    if (!trimmed) return;
    const order = orders.find((o) => o.id === orderId);
    if (!order) return;
    const entries = [...getEffectiveTrackingEntries(order)];
    const entry = entries[entryIdx];
    if (!entry) return;

    const nums = getTrackingNumbers(entry.number);
    const updatedNums = nums.map((n) => (n === oldNum ? trimmed : n));
    const pnd = { ...(entry.perNumberData || {}) };
    const oldData = pnd[oldNum] || {};
    pnd[trimmed] = Object.fromEntries(Object.entries({ qty: oldData.qty, cost: oldData.cost }).filter(([, v]) => v !== undefined));
    delete pnd[oldNum];

    const updatedEntry = {
      ...entry,
      number: updatedNums.join('\n'),
      perNumberData: pnd,
      deliveredNumbers: (entry.deliveredNumbers || []).filter((n) => n !== oldNum),
      pendingDeliveryNumbers: (entry.pendingDeliveryNumbers || []).filter((n) => n !== oldNum),
      replacedNumbers: [...(entry.replacedNumbers || []), { old: oldNum, new: trimmed, replacedAt: new Date().toISOString() }],
    };
    entries[entryIdx] = updatedEntry;

    setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, trackingEntries: entries } : o)));
    await saveTrackingEntries(orderId, entries);
    setReplacingNums((prev) => { const n = { ...prev }; delete n[`${orderId}:${entryIdx}:${oldNum}`]; return n; });

    // Sync using the already-updated entries — avoids stale state overwriting the replacement
    setSyncingNum(trimmed);
    try {
      const carrier = detectCarrier(trimmed) || 'UPS';
      const res = await fetch('/api/17track/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trackingItems: [{ number: trimmed, carrier }] }),
      });
      const data = await res.json();
      if (res.ok) {
        const result = (data.results || []).find((r) => r.number === trimmed);
        if (result) {
          const syncedPnd = { ...pnd };
          const patch = { rejected: null };
          if (result.latestDesc || result.status) patch.trackStatus = result.latestDesc || result.status;
          if (result.currentLocation) patch.currentLocation = result.currentLocation;
          if (result.lastUpdated) patch.lastUpdated = result.lastUpdated;
          if (result.estimatedDelivery) patch.estimatedDelivery = result.estimatedDelivery;
          if (result.deliveryDate) patch.deliveryDate = result.deliveryDate;
          syncedPnd[trimmed] = { ...(syncedPnd[trimmed] || {}), ...patch };
          const syncedEntry = {
            ...updatedEntry,
            perNumberData: syncedPnd,
            ...(result.isDelivered && { pendingDeliveryNumbers: [...new Set([...(updatedEntry.pendingDeliveryNumbers || []), trimmed])] }),
          };
          entries[entryIdx] = syncedEntry;
          // Write directly — avoids triggering the error modal if this secondary save races
          try {
            await updateDoc(doc(db, 'c&pProductOrders', orderId), { trackingEntries: entries });
            setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, trackingEntries: [...entries] } : o)));
          } catch {
            // silent — replacement already saved, webhook will deliver status updates
          }
          onSuccess?.(`Replaced — ${result.latestDesc || result.status || 'tracking started'}.`);
        } else {
          onSuccess?.('Tracking number replaced. No status yet — will update via webhook.');
        }
      }
    } catch {
      // silent — replacement is saved, user can manually sync
    } finally {
      setSyncingNum(null);
    }
  };

  const autoCreateTrackingEntries = async (orderId) => {
    const order = orders.find((o) => o.id === orderId);
    const existing = getEffectiveTrackingEntries(order);
    const newCards = (order.items || []).map((item, i) => ({
      id: (Date.now() + i).toString(),
      carrier: order?.carrier || 'UPS',
      number: '',
      note: '',
      status: 'pending',
      itemIds: [item.itemId],
      cardQty: Number(item.quantity) || 0,
      perNumberData: {},
    }));
    const entries = [...newCards, ...existing];
    setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, trackingEntries: entries } : o)));
    await saveTrackingEntries(orderId, entries);
  };

  const handleTrackingDone = async (orderId, entryIdx) => {
    const order = orders.find((o) => o.id === orderId);
    const entries = [...getEffectiveTrackingEntries(order)];
    const entry = entries[entryIdx];

    // Capture which numbers existed before this edit
    const key = trackingCardKey(orderId, entryIdx);
    const snapshot = trackingCardSnapshots[key];
    const prevNums = new Set(getTrackingNumbers(snapshot?.number || ''));

    // Normalize tracking numbers to one per line
    const nums = getTrackingNumbers(entry.number);
    const normalizedNumber = nums.join('\n');

    // Auto-fill qty from selected items if not already set
    const selectedItemIds = Array.isArray(entry.itemIds) ? entry.itemIds : [];
    const totalSelectedQty = selectedItemIds.reduce((s, itemId) => {
      const item = order.items.find((i) => i.itemId === itemId);
      return s + (Number(item?.quantity) || 0);
    }, 0);

    const pnd = { ...(entry.perNumberData || {}) };
    if (nums.length > 0 && totalSelectedQty > 0) {
      const qtyPerBox = Math.round(totalSelectedQty / nums.length);
      nums.forEach((num) => {
        if (!pnd[num]?.qty) {
          pnd[num] = { ...(pnd[num] || {}), qty: qtyPerBox };
        }
      });
    }

    const detectedCarrier = (!entry.carrier && nums.length > 0) ? detectCarrier(nums[0]) : null;
    entries[entryIdx] = {
      ...entry,
      number: normalizedNumber,
      perNumberData: pnd,
      ...(detectedCarrier ? { carrier: detectedCarrier } : {}),
    };
    setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, trackingEntries: entries } : o)));
    await saveTrackingEntries(orderId, entries);
    setTrackingCardEditing(orderId, entryIdx, false);

    // Auto-sync any tracking numbers that weren't in the entry before
    const newNums = nums.filter((n) => !prevNums.has(n));
    for (const num of newNums) {
      syncSingleTracking(orderId, entryIdx, num);
    }
  };

  const updateAllPerNumberData = async (orderId, entryIdx, pndPatch) => {
    setOrders((prev) =>
      prev.map((o) => {
        if (o.id !== orderId) return o;
        const entries = [...getEffectiveTrackingEntries(o)];
        if (!entries[entryIdx]) return o;
        const entry = entries[entryIdx];
        entries[entryIdx] = { ...entry, perNumberData: { ...(entry.perNumberData || {}), ...pndPatch } };
        return { ...o, trackingEntries: entries };
      })
    );
    const order = orders.find((o) => o.id === orderId);
    const entries = [...getEffectiveTrackingEntries(order)];
    if (!entries[entryIdx]) return;
    const entry = entries[entryIdx];
    entries[entryIdx] = { ...entry, perNumberData: { ...(entry.perNumberData || {}), ...pndPatch } };
    await saveTrackingEntries(orderId, entries);
  };

  const updatePerNumberData = async (orderId, entryIdx, num, patch) => {
    setOrders((prev) =>
      prev.map((o) => {
        if (o.id !== orderId) return o;
        const entries = [...getEffectiveTrackingEntries(o)];
        if (!entries[entryIdx]) return o;
        const entry = entries[entryIdx];
        entries[entryIdx] = {
          ...entry,
          perNumberData: {
            ...(entry.perNumberData || {}),
            [num]: { ...(entry.perNumberData?.[num] || {}), ...patch },
          },
        };
        return { ...o, trackingEntries: entries };
      })
    );
    const order = orders.find((o) => o.id === orderId);
    const entries = [...getEffectiveTrackingEntries(order)];
    if (!entries[entryIdx]) return;
    const entry = entries[entryIdx];
    entries[entryIdx] = {
      ...entry,
      perNumberData: {
        ...(entry.perNumberData || {}),
        [num]: { ...(entry.perNumberData?.[num] || {}), ...patch },
      },
    };
    await saveTrackingEntries(orderId, entries);
  };

  const toggleDeliveredNumber = async (orderId, entryIdx, trackingNumber) => {
    const order = orders.find((o) => o.id === orderId) || deliveredOrders.find((o) => o.id === orderId);
    const isAlreadyDelivered = !orders.find((o) => o.id === orderId);
    const entries = [...getEffectiveTrackingEntries(order)];
    const entry = entries[entryIdx];
    const current = entry.deliveredNumbers || [];
    const updated = current.includes(trackingNumber)
      ? current.filter((n) => n !== trackingNumber)
      : [...current, trackingNumber];
    const allNums = getTrackingNumbers(entry.number);
    const allDelivered = allNums.length > 0 && allNums.every((n) => updated.includes(n));
    entries[entryIdx] = { ...entry, deliveredNumbers: updated, status: allDelivered ? 'delivered' : 'pending' };

    if (isAlreadyDelivered) {
      setDeliveredOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, trackingEntries: entries } : o)));
    } else {
      setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, trackingEntries: entries } : o)));
    }
    await saveTrackingEntries(orderId, entries);
  };

  const removeTrackingEntry = async (orderId, entryIdx) => {
    const order = orders.find((o) => o.id === orderId);
    const entries = [...getEffectiveTrackingEntries(order)].filter((_, i) => i !== entryIdx);

    setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, trackingEntries: entries } : o)));
    clearTrackingCardEditsForOrder(orderId);
    await saveTrackingEntries(orderId, entries);
  };

  const updateTrackingStatus = async (orderId, entryIdx, status) => {
    await updateTrackingEntry(orderId, entryIdx, { status });
  };

  const updateItemQuantity = (orderId, itemId, newQuantity) => {
    setOrders((prev) =>
      prev.map((o) => {
        if (o.id !== orderId) return o;
        const updatedItems = o.items.map((item) =>
          item.itemId === itemId ? { ...item, quantity: Math.max(1, parseInt(newQuantity) || 1) } : item
        );
        const newTotal = updatedItems.reduce((sum, item) => sum + item.quantity * item.pricePerKit, 0);
        updateOrderItems(orderId, updatedItems);
        return { ...o, items: updatedItems, total: newTotal };
      })
    );
  };

  const updateItemPrice = (orderId, itemId, newPrice) => {
    setOrders((prev) =>
      prev.map((o) => {
        if (o.id !== orderId) return o;
        const updatedItems = o.items.map((item) =>
          item.itemId === itemId ? { ...item, pricePerKit: Math.max(0, parseFloat(newPrice) || 0) } : item
        );
        const newTotal = updatedItems.reduce((sum, item) => sum + item.quantity * item.pricePerKit, 0);
        updateOrderItems(orderId, updatedItems);
        return { ...o, items: updatedItems, total: newTotal };
      })
    );
  };

  const saveOrderChanges = async (orderId) => {
    const order = orders.find((o) => o.id === orderId);
    if (!order) return;

    const effectiveTrackingEntries = (ord) => {
      if (ord.trackingEntries && ord.trackingEntries.length) return ord.trackingEntries;
      if (ord.trackingNumber && ord.carrier) {
        return [{ id: 'legacy', carrier: ord.carrier, number: ord.trackingNumber, note: '' }];
      }
      return [];
    };

    try {
      await updateDoc(doc(db, 'c&pProductOrders', orderId), {
        items: order.items,
        total: order.total,
        submittedAt: order.submittedAt,
        warehouse: order.warehouse || 'US',
        notes: order.notes || '',
        trackingEntries: effectiveTrackingEntries(order),
        discountPercent: order.discountPercent || 0
      });
    } catch (error) {
      console.error('Error saving order changes:', error);
      onError && onError('Failed to save changes: ' + error.message);
    }
  };

  const addItemToOrder = async (orderId, productId) => {
    const order = orders.find((o) => o.id === orderId);
    const product = availableProducts.find((p) => p.id === productId);
    if (!order || !product) return;

    const exists = order.items.some(
      (item) => item.productName === product.product && item.productStrength === product.strength
    );
    if (exists) {
      onError && onError('This product is already in the order.');
      setAddingItemToOrder(null);
      return;
    }

    const warehouse = (order.warehouse || 'US').toUpperCase();
    const price = getVendorProductPrice(order, product);
    const newItem = {
      itemId: Date.now().toString(),
      productName: product.product,
      productStrength: product.strength,
      warehouse,
      quantity: 1,
      pricePerKit: price,
      status: 'pending'
    };

    const updatedItems = [...order.items, newItem];
    await updateOrderItems(orderId, updatedItems);
    setAddingItemToOrder(null);
    onSuccess && onSuccess('Product added to order');
  };

  const getTrackingUrl = (carrier, trackingNumber) => {
    switch (carrier) {
      case 'USPS':
        return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${trackingNumber}`;
      case 'UPS':
        return `https://www.ups.com/track?tracknum=${trackingNumber}`;
      case 'FedEx':
        return `https://www.fedex.com/fedextrack/?trknbr=${trackingNumber}`;
      case 'DHL':
        return `https://www.dhl.com/en/express/tracking.html?AWB=${trackingNumber}`;
      case '17track':
        return `https://t.17track.net/en#nums=${trackingNumber}`;
      default:
        return '#';
    }
  };

  const detectCarrier = (trackingNumber) => {
    const n = (trackingNumber || '').trim().toUpperCase();
    if (!n) return null;
    if (/^1Z[A-Z0-9]{16}$/.test(n)) return 'UPS';
    if (/^JD\d{18}$/.test(n)) return 'DHL';
    if (/^[A-Z]{2}\d{9}US$/.test(n)) return 'USPS';
    if (/^(9[40][0-9]{18,20}|9[23][0-9]{18,20})$/.test(n)) return 'USPS';
    if (/^\d{22}$/.test(n) && /^(9[0-9])/.test(n)) return 'USPS';
    if (/^\d{12}$/.test(n) || /^\d{15}$/.test(n) || /^\d{20}$/.test(n) || /^\d{22}$/.test(n)) return 'FedEx';
    if (/^\d{10,11}$/.test(n)) return 'DHL';
    // International formats (e.g. EA123456789CN, LY123456789CN, YT2400...)
    if (/^[A-Z]{2}\d{9}[A-Z]{2}$/.test(n)) return '17track';
    if (/^(YT|SF|JT|LP|CJ|UF|LS|LX|LY|LZ|RA|RR|EE|EI|EU|EA|EB|EC|CP)[0-9A-Z]+$/.test(n)) return '17track';
    return '17track';
  };

  const getTrackingNumbers = (rawNumber) => {
    if (!rawNumber) return [];
    const cleaned = String(rawNumber).replace(/\r/g, '\n').trim();
    if (!cleaned) return [];

    // Split on newlines/commas/semicolons. Require ≥6 chars to exclude corrupted
    // single-character tokens (e.g. data stored char-by-char with newlines).
    const byCommonDelimiters = cleaned
      .replace(/\|/g, '\n')
      .split(/[\n,;]+/)
      .map((value) => value.trim())
      .filter((value) => value.length >= 6);

    if (byCommonDelimiters.length >= 1) return [...new Set(byCommonDelimiters)];

    // Nothing valid found — try collapsing all whitespace to recover a single number
    // (handles data stored as "E\nF\n0\n0\n1..." → "EF001...")
    const collapsed = cleaned.replace(/\s+/g, '');
    return collapsed.length >= 6 ? [collapsed] : [];
  };

  // Payment panel helpers ------------------------------------
  const togglePaymentPanel = (orderId) => {
    setExpandedPaymentPanels((prev) => {
      const next = new Set(prev);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });
  };

  const patchDownPaymentForm = (orderId, patch) => {
    setDownPaymentForms((prev) => ({
      ...prev,
      [orderId]: { amount: '', date: new Date().toISOString().slice(0, 10), method: 'Crypto', note: '', ...(prev[orderId] || {}), ...patch },
    }));
  };

  const addDownPayment = async (orderId) => {
    const form = downPaymentForms[orderId] || {};
    const amount = parseFloat(form.amount);
    if (!amount || amount <= 0) return;
    const order = orders.find((o) => o.id === orderId);
    if (!order) return;
    const newPayment = {
      id: Date.now().toString(),
      amount,
      date: form.date || new Date().toISOString().slice(0, 10),
      method: form.method || 'Crypto',
      paymentType: 'delivered',
      isDownPayment: form.isDownPayment || false,
      note: form.note || '',
    };
    const updatedPayments = [...(order.downPayments || []), newPayment];
    try {
      const firestoreUpdate = { downPayments: updatedPayments };

      // When paying for delivered items (and not flagged as down payment), stamp delivered numbers + items as paid
      if (newPayment.paymentType === 'delivered' && !newPayment.isDownPayment) {
        const entries = getEffectiveTrackingEntries(order);
        // Record exactly what this payment covers so we can reverse it on delete
        const coveredItemIds = (order.items || [])
          .filter((item) => (item.status || 'pending') === 'delivered')
          .map((item) => item.itemId);
        const coveredTrackingNums = [];
        entries.forEach((entry) => (entry.deliveredNumbers || []).forEach((n) => coveredTrackingNums.push(n)));
        newPayment.coveredItemIds = coveredItemIds;
        newPayment.coveredTrackingNums = coveredTrackingNums;
        // Re-build updatedPayments with the enriched payment
        updatedPayments[updatedPayments.length - 1] = newPayment;

        const updatedEntries = entries.map((entry) => {
          const deliveredNums = entry.deliveredNumbers || [];
          if (!deliveredNums.length) return entry;
          const paidSet = new Set([...(entry.paidNumbers || []), ...deliveredNums]);
          return { ...entry, paidNumbers: [...paidSet] };
        });
        const updatedItems = (order.items || []).map((item) =>
          (item.status || 'pending') === 'delivered' ? { ...item, paid: true } : item
        );
        firestoreUpdate.downPayments = updatedPayments;
        firestoreUpdate.trackingEntries = updatedEntries;
        firestoreUpdate.items = updatedItems;
        setOrders((prev) => prev.map((o) =>
          o.id === orderId ? { ...o, downPayments: updatedPayments, trackingEntries: updatedEntries, items: updatedItems } : o
        ));
      } else {
        setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, downPayments: updatedPayments } : o)));
      }

      await updateDoc(doc(db, 'c&pProductOrders', orderId), firestoreUpdate);
      setDownPaymentForms((prev) => ({ ...prev, [orderId]: { amount: '', date: new Date().toISOString().slice(0, 10), method: 'Crypto', note: '' } }));
      onSuccess?.(newPayment.isDownPayment ? 'Down payment logged.' : 'Delivered items payment logged.');
    } catch {
      onError?.('Failed to save payment.');
    }
  };

  const removeDownPayment = async (orderId, paymentId) => {
    const order = orders.find((o) => o.id === orderId);
    if (!order) return;
    const removedPayment = (order.downPayments || []).find((p) => p.id === paymentId);
    const remainingPayments = (order.downPayments || []).filter((p) => p.id !== paymentId);

    const firestoreUpdate = { downPayments: remainingPayments };

    if (removedPayment?.paymentType === 'delivered') {
      // Build the set of tracking nums still covered by other delivered payments
      const stillCoveredNums = new Set(
        remainingPayments.flatMap((p) => p.paymentType === 'delivered' ? (p.coveredTrackingNums || []) : [])
      );
      const stillCoveredItemIds = new Set(
        remainingPayments.flatMap((p) => p.paymentType === 'delivered' ? (p.coveredItemIds || []) : [])
      );

      // Remove paidNumbers that were only covered by the deleted payment
      const entries = getEffectiveTrackingEntries(order);
      const updatedEntries = entries.map((entry) => {
        const paidNums = (entry.paidNumbers || []).filter((n) => stillCoveredNums.has(n));
        return { ...entry, paidNumbers: paidNums };
      });

      // Unpay items no longer covered
      const updatedItems = (order.items || []).map((item) =>
        item.paid && !stillCoveredItemIds.has(item.itemId) ? { ...item, paid: false } : item
      );

      firestoreUpdate.trackingEntries = updatedEntries;
      firestoreUpdate.items = updatedItems;
      setOrders((prev) => prev.map((o) =>
        o.id === orderId ? { ...o, downPayments: remainingPayments, trackingEntries: updatedEntries, items: updatedItems } : o
      ));
    } else {
      setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, downPayments: remainingPayments } : o)));
    }

    try {
      await updateDoc(doc(db, 'c&pProductOrders', orderId), firestoreUpdate);
    } catch {
      onError?.('Failed to remove payment.');
    }
  };

  const resetPaidStatus = async (orderId) => {
    const order = orders.find((o) => o.id === orderId);
    if (!order) return;
    const entries = getEffectiveTrackingEntries(order);
    const updatedEntries = entries.map((entry) => ({ ...entry, paidNumbers: [] }));
    const updatedItems = (order.items || []).map((item) => ({ ...item, paid: false }));
    // Also clear coveredItemIds/coveredTrackingNums from payments
    const updatedPayments = (order.downPayments || []).map((p) =>
      p.paymentType === 'delivered' ? { ...p, coveredItemIds: [], coveredTrackingNums: [] } : p
    );
    try {
      await updateDoc(doc(db, 'c&pProductOrders', orderId), {
        trackingEntries: updatedEntries,
        items: updatedItems,
        downPayments: updatedPayments,
      });
      setOrders((prev) => prev.map((o) =>
        o.id === orderId ? { ...o, trackingEntries: updatedEntries, items: updatedItems, downPayments: updatedPayments } : o
      ));
      onSuccess?.('Paid status reset.');
    } catch {
      onError?.('Failed to reset paid status.');
    }
  };

  // Rendering helpers -----------------------------------------
  const getOrderFinancials = (order) => {
    const computedItemsSubtotal = (order.items || []).reduce(
      (sum, item) => sum + (Number(item.quantity) || 0) * (Number(item.pricePerKit) || 0),
      0
    );
    const itemsSubtotal = computedItemsSubtotal;
    const shippingCost = Math.max(0, Number(order.shippingCost) || 0);
    const baseTotal = itemsSubtotal + shippingCost;
    const discountPercent = Number(order.discountPercent) || 0;
    const finalTotal = baseTotal - baseTotal * (discountPercent / 100);
    return {
      itemsSubtotal,
      shippingCost,
      baseTotal,
      discountPercent,
      finalTotal
    };
  };

  const calculateFinalTotal = (order) => getOrderFinancials(order).finalTotal;

  const renderOrder = (orderRaw) => {
    const order = {
      ...orderRaw,
      trackingEntries: Array.isArray(orderRaw.trackingEntries)
        ? orderRaw.trackingEntries
        : Object.values(orderRaw.trackingEntries || {}),
      items: Array.isArray(orderRaw.items)
        ? orderRaw.items
        : Object.values(orderRaw.items || {}),
      downPayments: Array.isArray(orderRaw.downPayments)
        ? orderRaw.downPayments
        : Object.values(orderRaw.downPayments || {}),
    };
    const isEditing = editingOrders.has(order.id);
    const { itemsSubtotal, shippingCost, discountPercent, finalTotal } = getOrderFinancials(order);
    const discount = discountPercent;
    const totalDownPaid = (order.downPayments || []).reduce((s, p) => s + (Number(p.amount) || 0), 0);
    const paidFraction = finalTotal > 0 ? Math.min(1, totalDownPaid / finalTotal) : 0;
    const totalUnitsOrdered = (order.items || []).reduce((s, item) => s + (Number(item.quantity) || 0), 0);
    const deliveredUnits = (order.trackingEntries || []).reduce((s, e) => {
      const pnd = e.perNumberData || {};
      const dn = e.deliveredNumbers || [];
      return s + dn.reduce((ds, num) => ds + (Number(pnd[num]?.qty) || 0), 0);
    }, 0);
    const deliveredCost = (order.trackingEntries || []).reduce((s, e) => {
      const pnd = e.perNumberData || {};
      const dn = e.deliveredNumbers || [];
      return s + dn.reduce((ds, num) => ds + (Number(pnd[num]?.cost) || 0), 0);
    }, 0);
    const paidDeliveredCost = (order.trackingEntries || []).reduce((s, e) => {
      const pnd = e.perNumberData || {};
      const pn = e.paidNumbers || [];
      return s + pn.reduce((ps, num) => ps + (Number(pnd[num]?.cost) || 0), 0);
    }, 0);
    const unpaidDeliveredCost = Math.max(0, deliveredCost - paidDeliveredCost);
    const undeliveredCost = (order.trackingEntries || []).reduce((s, e) => {
      const pnd = e.perNumberData || {};
      const deliveredSet = new Set(e.deliveredNumbers || []);
      return s + getTrackingNumbers(e.number)
        .filter((n) => !deliveredSet.has(n))
        .reduce((us, num) => us + (Number(pnd[num]?.cost) || 0), 0);
    }, 0);
    const remainingUnits = Math.max(0, totalUnitsOrdered - deliveredUnits);
    const submittedAtDisplay = new Date(order.submittedAt).toLocaleString();
    const trackingEntries =
      order.trackingEntries && Array.isArray(order.trackingEntries) && order.trackingEntries.length > 0
        ? order.trackingEntries.map((t) => ({ ...t, status: t.status || 'pending' }))
        : order.trackingNumber && order.carrier
          ? [{ id: 'legacy', carrier: order.carrier, number: order.trackingNumber, note: '', status: 'pending' }]
          : [];
    const isEntryFullyDelivered = (entry) => {
      const nums = getTrackingNumbers(entry.number);
      if (nums.length === 0) return (entry.status || 'pending') === 'delivered';
      const pnd = entry.perNumberData || {};
      const delivered = entry.deliveredNumbers || [];
      const cardQty = Number(entry.cardQty) || 0;
      const trackingKits = nums.reduce((s, n) => s + (Number(pnd[n]?.qty) || 0), 0);
      const hasUnassigned = cardQty > 0 && trackingKits < cardQty;
      return delivered.length === nums.length && !hasUnassigned;
    };

    const orderedTrackingEntries = trackingEntries
      .map((entry, originalIndex) => ({ entry, originalIndex }))
      .sort((a, b) => {
        const aDelivered = isEntryFullyDelivered(a.entry);
        const bDelivered = isEntryFullyDelivered(b.entry);
        if (aDelivered === bDelivered) return a.originalIndex - b.originalIndex;
        return aDelivered ? 1 : -1;
      });
    const pendingTrackingEntries = orderedTrackingEntries.filter(({ entry }) => !isEntryFullyDelivered(entry));
    const deliveredTrackingEntries = orderedTrackingEntries.filter(({ entry }) => isEntryFullyDelivered(entry));

    const copied = copiedOrderId === order.id;
    const copiedWithPrice = copiedOrderId === order.id && copiedOrderType === 'price';
    const copiedNoPrice = copiedOrderId === order.id && copiedOrderType === 'no-price';
    
    const getFormattedItems = (includePrice = true) => {
      const warehouse = `${order.warehouse || 'US'} WAREHOUSE`;
      const vendor = order.vendor ? `Vendor: ${order.vendor}` : '';
      const orderId = order.id || '';
      const sortedItems = [...order.items].sort((a, b) => {
        const nameA = (a.productName || a.product || '').toLowerCase();
        const nameB = (b.productName || b.product || '').toLowerCase();
        if (nameA === nameB) {
          return (a.productStrength || a.strength || '').localeCompare(b.productStrength || b.strength || '');
        }
        return nameA.localeCompare(nameB);
      });
      
      const lines = [
        warehouse,
        ...(vendor ? [vendor] : []),
        orderId,
        '═══════════════════════════',
        ...sortedItems.map((item) => {
          let product = item.productName || item.product || '';
          if (/^GLP-2/i.test(product)) product = 'TZ';
          if (/^GLP-3/i.test(product)) product = 'RT';
          const strength = item.productStrength || item.strength || '';
          const qty = item.quantity || '';
          
          if (includePrice) {
            const pricePerKit = item.pricePerKit || 0;
            const total = (qty * pricePerKit).toFixed(2);
            return `${product} ${strength} x ${qty} | $${pricePerKit.toFixed(2)} -> $${total}`;
          } else {
            return `${product} ${strength} x ${qty}`;
          }
        })
      ];
      
      return lines.join('\n');
    };
    
    const handleCopyOrderItems = () => {
      copyToClipboard(getFormattedItems(true));
      setCopiedOrderId(order.id);
      setCopiedOrderType('price');
      setTimeout(() => {
        setCopiedOrderId(null);
        setCopiedOrderType(null);
      }, 900);
    };
    
    const handleCopyOrderItemsNoPrice = () => {
      copyToClipboard(getFormattedItems(false));
      setCopiedOrderId(order.id);
      setCopiedOrderType('no-price');
      setTimeout(() => {
        setCopiedOrderId(null);
        setCopiedOrderType(null);
      }, 900);
    };

    const orderItemsForTracking = [...(order.items || [])].sort((a, b) => {
      const nameA = (a.productName || a.product || '').toLowerCase();
      const nameB = (b.productName || b.product || '').toLowerCase();
      if (nameA === nameB) {
        return (a.productStrength || a.strength || '').localeCompare(b.productStrength || b.strength || '');
      }
      return nameA.localeCompare(nameB);
    });

    const formatTrackingItemLabel = (item) => {
      const product = formatProductName(item.productName || item.product || '');
      const strength = item.productStrength || item.strength || '';
      const quantity = Number(item.quantity) || 0;
      return `${product}${strength ? ` ${strength}` : ''} x ${quantity}`.trim();
    };

    const renderTrackingCard = ({ entry, originalIndex }) => {
      const trackingNumbers = getTrackingNumbers(entry.number);
      const hasTrackingNumbers = trackingNumbers.length > 0;
      const deliveredNums = entry.deliveredNumbers || [];
      const pendingDeliveryNums = new Set(entry.pendingDeliveryNumbers || []);
      const paidNums = new Set(entry.paidNumbers || []);
      const perNumberData = entry.perNumberData || {};
      const cardQtyTotal = Number(entry.cardQty) || 0;
      const totalTrackingKits = trackingNumbers.reduce((s, n) => s + (Number(perNumberData[n]?.qty) || 0), 0);
      const hasUnassignedKits = cardQtyTotal > 0 && totalTrackingKits < cardQtyTotal;
      const isDelivered = hasTrackingNumbers
        ? (deliveredNums.length === trackingNumbers.length && trackingNumbers.length > 0 && !hasUnassignedKits)
        : (entry.status || 'pending') === 'delivered';
      const isWaitingNoTracking = !isDelivered && !hasTrackingNumbers;
      const isCardEditing = isTrackingCardEditing(order.id, originalIndex);
      const selectedItemIds = Array.isArray(entry.itemIds) ? entry.itemIds : [];
      const assignedItems = selectedItemIds
        .map((itemId) => order.items.find((item) => item.itemId === itemId))
        .filter(Boolean);

      const toggleTrackingItem = (itemId) => {
        const nextItemIds = selectedItemIds.includes(itemId)
          ? selectedItemIds.filter((id) => id !== itemId)
          : [...selectedItemIds, itemId];
        const nextItems = nextItemIds.map((id) => order.items.find((i) => i.itemId === id)).filter(Boolean);
        const totalQty = nextItems.reduce((s, i) => s + (Number(i.quantity) || 0), 0);
        const totalVal = nextItems.reduce((s, i) => s + (Number(i.quantity) || 0) * (Number(i.pricePerKit) || 0), 0);
        const avgUnitPrice = totalQty > 0 ? totalVal / totalQty : 0;
        const nums = getTrackingNumbers(entry.number);
        let pnd = { ...(entry.perNumberData || {}) };
        if (nums.length > 0 && totalQty > 0) {
          const qtyPerBox = Math.round(totalQty / nums.length);
          const grossPerBox = qtyPerBox * avgUnitPrice;
          const duePerBox = parseFloat((grossPerBox * (1 - paidFraction)).toFixed(2));
          nums.forEach((num) => {
            pnd[num] = { qty: qtyPerBox, cost: duePerBox };
          });
        }
        updateTrackingEntry(order.id, originalIndex, { itemIds: nextItemIds, cardQty: totalQty, perNumberData: pnd });
      };

      return (
        <div
          key={entry.id || originalIndex}
          className={`tracking-card ${isDelivered ? 'delivered-card' : 'pending-card'}${isCardEditing ? ' is-editing' : ''}`}
        >
          {isCardEditing ? (
            <>
              <div className="tracking-card-header">
                <label className={`tracking-status-toggle tracking-status-toggle-card ${isDelivered ? 'delivered' : 'pending'}`}>
                  <input
                    type="checkbox"
                    checked={(entry.status || 'pending') === 'delivered'}
                    onChange={(e) =>
                      updateTrackingStatus(order.id, originalIndex, e.target.checked ? 'delivered' : 'pending')
                    }
                  />
                  <span>{(entry.status || 'pending') === 'delivered' ? 'Delivered' : 'Pending'}</span>
                </label>
                <div className="tracking-card-actions">
                  <button
                    className="tracking-remove"
                    onClick={() => removeTrackingEntry(order.id, originalIndex)}
                    title="Remove this tracking card"
                  >
                    Remove Card
                  </button>
                  <button
                    className="tracking-card-btn tracking-card-btn-cancel"
                    onClick={() => cancelTrackingCardEdit(order.id, originalIndex)}
                  >
                    Cancel
                  </button>
                  <button
                    className="tracking-card-btn"
                    onClick={() => handleTrackingDone(order.id, originalIndex)}
                  >
                    Save
                  </button>
                </div>
              </div>
              <div className="tracking-edit-grid">
                <div className="tracking-field">
                  <span className="tracking-field-label">Carrier</span>
                  <div className="carrier-pills">
                    {['UPS', 'USPS', 'FedEx', 'DHL', '17track'].map(c => (
                      <button
                        key={c}
                        type="button"
                        className={`carrier-pill${(entry.carrier || 'UPS') === c ? ' active' : ''}`}
                        onClick={() => updateTrackingEntry(order.id, originalIndex, { carrier: c })}
                      >{c}</button>
                    ))}
                  </div>
                </div>
                <label className="tracking-field">
                  <span className="tracking-field-label">Tracking # — one per line, or paste all at once</span>
                  <textarea
                    key={`tn-textarea-${entry.id}`}
                    ref={(el) => { trackingTextareaRefs.current[entry.id] = el; }}
                    placeholder={"872519343600\n872519345474\n872519346595"}
                    defaultValue={entry.number || ''}
                    rows={Math.min(12, Math.max(3, getTrackingNumbers(entry.number).length + 1))}
                    onBlur={(e) => {
                      if (e.target.value !== entry.number) {
                        updateTrackingEntry(order.id, originalIndex, { number: e.target.value });
                      }
                    }}
                    className="tracking-note tracking-number-textarea"
                  />
                </label>
              </div>
              {(() => {
                const editNums = getTrackingNumbers(entry.number);
                if (!editNums.length) return null;
                const editItemIds = Array.isArray(entry.itemIds) ? entry.itemIds : [];
                const editItems = editItemIds.map((id) => order.items.find((i) => i.itemId === id)).filter(Boolean);
                const avgUnitPrice = (() => {
                  const tq = editItems.reduce((s, i) => s + (Number(i.quantity) || 0), 0);
                  const tv = editItems.reduce((s, i) => s + (Number(i.quantity) || 0) * (Number(i.pricePerKit) || 0), 0);
                  return tq > 0 ? tv / tq : 0;
                })();
                const fillKey = `${order.id}-${originalIndex}`;
                const fillQty = trackingFillQtys[fillKey] ?? '';
                const previewCost = avgUnitPrice > 0 && parseInt(fillQty) > 0
                  ? parseFloat((parseInt(fillQty) * avgUnitPrice * (1 - paidFraction)).toFixed(2))
                  : 0;

                const applyKitsPerBox = (rawVal) => {
                  const qty = parseInt(rawVal) || 0;
                  if (!qty || !editNums.length) return;
                  const cost = avgUnitPrice > 0 ? parseFloat((qty * avgUnitPrice * (1 - paidFraction)).toFixed(2)) : 0;
                  const pndPatch = {};
                  editNums.forEach((num) => { pndPatch[num] = { qty, cost }; });
                  updateAllPerNumberData(order.id, originalIndex, pndPatch);
                };

                return (
                  <div className="tracking-field">
                    <div className="tpb-header-row">
                      <span className="tracking-field-label">Qty & Cost Per Box</span>
                      {!editItemIds.length && <span className="tpb-hint-muted">Select items below for auto cost</span>}
                    </div>
                    <div className="tpb-kits-row">
                      <input
                        type="number"
                        className="tpb-fill-input"
                        placeholder="kits per box"
                        value={fillQty}
                        onChange={(e) => {
                          const val = e.target.value;
                          setTrackingFillQtys((prev) => ({ ...prev, [fillKey]: val }));
                          applyKitsPerBox(val);
                        }}
                        onFocus={(e) => e.target.select()}
                      />
                      <span className="tpb-label">kits per box</span>
                      {previewCost > 0 && (
                        <span className="tpb-cost-preview">
                          = ${previewCost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} due / box
                        </span>
                      )}
                    </div>
                    <div className="tpb-grid">
                      {editNums.map((num) => {
                        const pnd = (entry.perNumberData || {})[num] || {};
                        return (
                          <div key={num} className="tpb-row">
                            <span className="tpb-num">{num}</span>
                            <input
                              type="number"
                              className="tpb-input tpb-qty"
                              placeholder="qty"
                              value={pnd.qty ?? ''}
                              onChange={(e) => {
                                const qty = parseInt(e.target.value) || 0;
                                const cost = avgUnitPrice > 0 && qty > 0
                                  ? parseFloat((qty * avgUnitPrice * (1 - paidFraction)).toFixed(2))
                                  : (pnd.cost ?? 0);
                                updatePerNumberData(order.id, originalIndex, num, { qty, cost });
                              }}
                              onFocus={(e) => e.target.select()}
                            />
                            <span className="tpb-label">kits</span>
                            <span className="tpb-dollar">$</span>
                            <input
                              type="number"
                              className="tpb-input tpb-cost"
                              placeholder="due"
                              value={pnd.cost ?? ''}
                              onChange={(e) => updatePerNumberData(order.id, originalIndex, num, { cost: parseFloat(e.target.value) || 0 })}
                              onFocus={(e) => e.target.select()}
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
              <label className="tracking-field tracking-note-field">
                <span className="tracking-field-label">Notes</span>
                <textarea
                  className="tracking-note"
                  rows="2"
                  placeholder="Tracking notes (optional)"
                  value={entry.note || ''}
                  onChange={(e) => updateTrackingEntry(order.id, originalIndex, { note: e.target.value })}
                />
              </label>
              <div className="tracking-field tracking-item-picker">
                <span className="tracking-field-label">Items In This Tracking</span>
                <div className="tracking-item-list">
                  {orderItemsForTracking.map((item) => {
                    const checked = selectedItemIds.includes(item.itemId);
                    return (
                      <label key={item.itemId} className={`tracking-item-option${checked ? ' selected' : ''}`}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleTrackingItem(item.itemId)}
                        />
                        <span className="tracking-item-option-text">{formatTrackingItemLabel(item)}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            </>
          ) : (
            <>
              {/* Row 1: product name + edit button */}
              <div className="tvc-name-edit-row">
                <div className="tvc-items-left">
                  {assignedItems.map((item) => (
                    <span key={item.itemId} className="tvc-item-chip">{formatTrackingItemLabel(item)}</span>
                  ))}
                </div>
                {canEditTracking && (
                  <button
                    className="tracking-card-edit-link tvc-edit-btn"
                    onClick={() => setTrackingCardEditing(order.id, originalIndex, true)}
                  >
                    Edit
                  </button>
                )}
              </div>

              {/* Row 2: kits delivered (left) + payment columns (right) */}
              {hasTrackingNumbers && (() => {
                const deliveredKits = deliveredNums.reduce((s, n) => s + (Number(perNumberData[n]?.qty) || 0), 0);
                const trueTotal = cardQtyTotal > 0 ? cardQtyTotal : totalTrackingKits;
                const unassigned = cardQtyTotal > 0 ? cardQtyTotal - totalTrackingKits : 0;
                const countClass = `tvc-kit-count ${isDelivered ? 'tvc-kit-count--done' : deliveredKits > 0 || deliveredNums.length > 0 ? 'tvc-kit-count--partial' : ''}`;
                const cardItems = (Array.isArray(entry.itemIds) ? entry.itemIds : [])
                  .map((id) => order.items.find((i) => i.itemId === id)).filter(Boolean);
                const totalVal = cardItems.reduce((v, i) => v + (Number(i.quantity) || 0) * (Number(i.pricePerKit) || 0), 0);
                const totalQtyItems = cardItems.reduce((v, i) => v + (Number(i.quantity) || 0), 0);
                const avgPrice = totalQtyItems > 0 ? totalVal / totalQtyItems : 0;
                const grossCost = cardQtyTotal > 0 && avgPrice > 0 ? cardQtyTotal * avgPrice : 0;
                const paidAmount = grossCost * paidFraction;
                const netCost = grossCost * (1 - paidFraction);
                const fmt = (n) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                if (trueTotal === 0) return null;
                return (
                  <div className="tvc-delivery-payment-row">
                    <div className="tvc-delivery-left">
                      <span className={countClass}>{deliveredKits}/{trueTotal} kits delivered</span>
                      {unassigned > 0 && <span className="tvc-awaiting">{unassigned} awaiting tracking</span>}
                    </div>
                    {grossCost > 0 && (
                      <div className="tvc-payment-detail">
                        <span className="tvc-pd-row"><span className="tvc-pd-label">Total</span><span className="tvc-pd-val">${fmt(grossCost)}</span></span>
                        {paidAmount > 0 && <span className="tvc-pd-row"><span className="tvc-pd-label">Paid</span><span className="tvc-pd-val tvc-pd-paid">${fmt(paidAmount)}</span></span>}
                        {netCost > 0.01 && <span className="tvc-pd-row"><span className="tvc-pd-label">Due</span><span className="tvc-pd-val tvc-pd-due">${fmt(netCost)}</span></span>}
                        {netCost <= 0.01 && paidAmount > 0 && <span className="tvc-pd-row tvc-pd-clear"><span className="tvc-pd-label">Paid in full</span></span>}
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Tracking numbers grouped by carrier */}
              {hasTrackingNumbers ? (
                <div className="tracking-number-checklist">
                  {(() => {
                    const carrierIcon = (c) => {
                      const name = (c || '').toLowerCase();
                      if (name === 'fedex') return '🟣';
                      if (name === 'ups') return '🟤';
                      if (name === 'usps') return '🔵';
                      if (name === 'dhl') return '🟡';
                      if (name === '17track') return '📦';
                      return '📦';
                    };
                    // Build flat list preserving per-number carrier for URL + icon
                    const numCarrier = new Map();
                    trackingNumbers.forEach((num) => {
                      numCarrier.set(num, detectCarrier(num) || entry.carrier || 'Unknown');
                    });
                    const activeNums = trackingNumbers.filter((n) => !deliveredNums.includes(n));
                    const doneNums = trackingNumbers.filter((n) => deliveredNums.includes(n));
                    const grpCarrier = entry.carrier || 'Unknown'; // kept for done-nums section key
                    return (
                        <div className="tnc-carrier-group">

                          {/* Active (undelivered) numbers — full detail */}
                          {activeNums.map((num) => {
                            const numPending = pendingDeliveryNums.has(num);
                            const numPaid = paidNums.has(num);
                            const pnd = perNumberData[num] || {};
                            const hasPills = pnd.trackStatus || pnd.subStatus || pnd.destination || pnd.deliveryDate || pnd.estimatedDelivery || pnd.rejected || pnd.confirmedAt;
                            const sub = pnd.subStatus || '';
                            const isReturn = /return/i.test(sub);
                            const isException = /exception/i.test(sub) && !isReturn;
                            const replaceKey = `${order.id}:${originalIndex}:${num}`;
                            const replaceVal = replacingNums[replaceKey];
                            return (
                              <div key={num} className={`tn-check-row${numPending ? ' tn-pending-delivery' : ''}${numPaid ? ' tn-paid' : ''}`}>
                                <div className="tn-main-row">
                                  <input
                                    type="checkbox"
                                    checked={false}
                                    onChange={() => toggleDeliveredNumber(order.id, originalIndex, num)}
                                  />
                                  <div className="tn-num-block">
                                    <a
                                      href={getTrackingUrl(numCarrier.get(num), num)}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="tracking-number-link"
                                    >
                                      {num}
                                    </a>
                                    {(pnd.qty > 0 || pnd.cost > 0) && (
                                      <span className="tn-sub">
                                        {pnd.qty > 0 && <span>{pnd.qty} kits</span>}
                                        {pnd.qty > 0 && pnd.cost > 0 && <span className="tn-sub-dot">·</span>}
                                        {pnd.cost > 0 && <span>${Number(pnd.cost).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>}
                                      </span>
                                    )}
                                  </div>
                                  <button
                                    className={`tn-copy-btn${copiedTrackingNum === num ? ' copied' : ''}`}
                                    title="Copy tracking number"
                                    onClick={() => { navigator.clipboard.writeText(num); setCopiedTrackingNum(num); setTimeout(() => setCopiedTrackingNum(null), 1500); }}
                                  >
                                    {copiedTrackingNum === num ? 'Copied!' : '⎘'}
                                  </button>
                                  <button
                                    className={`tn-sync-btn${syncingNum === num ? ' syncing' : ''}`}
                                    title="Sync this tracking number"
                                    disabled={syncingNum === num}
                                    onClick={() => syncSingleTracking(order.id, originalIndex, num)}
                                  >
                                    {syncingNum === num ? '…' : '↻'}
                                  </button>
                                  <div className="tn-carrier-updated">
                                    <span className="tn-carrier-label">{numCarrier.get(num)}</span>
                                    {pnd.lastUpdated && (
                                      <span className="tn-last-updated">
                                        Updated {new Date(pnd.lastUpdated).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                      </span>
                                    )}
                                  </div>
                                </div>
                                {numPending && (
                                  <div className="tn-pending-confirm-row">
                                    <span className="tn-pill tn-pill-pending-delivery">Delivered — confirm?</span>
                                    <button className="tn-confirm-btn" title="Confirm delivery" onClick={() => confirmDelivery(order.id, originalIndex, num)}>✓ Yes</button>
                                    <button className="tn-dismiss-btn" title="Not delivered yet" onClick={() => dismissPendingDelivery(order.id, originalIndex, num)}>✗ No</button>
                                  </div>
                                )}
                                {hasPills && (
                                  <div className="tn-info-pills">
                                    {pnd.rejected && (
                                      <span className="tn-pill tn-pill-rejected">
                                        Not found
                                        <button className="tn-retry-btn" title={pnd.rejected} disabled={syncingNum === num} onClick={() => syncSingleTracking(order.id, originalIndex, num)}>
                                          {syncingNum === num ? '…' : '↻ Retry'}
                                        </button>
                                      </span>
                                    )}
                                    {pnd.trackStatus && (
                                      <span className={isReturn ? 'tn-pill tn-pill-return' : isException ? 'tn-pill tn-pill-exception' : 'tn-pill tn-pill-status'}>
                                        {isReturn ? 'Returned to Sender'
                                          : isException ? `Exception: ${sub.replace('Exception_', '').replace(/([A-Z])/g, ' $1').trim()}`
                                          : pnd.trackStatus.replace(/([a-z])([A-Z])/g, '$1 $2')}
                                        {(isReturn || isException) && canEditTracking && !replaceVal && (
                                          <button
                                            className="tn-replace-btn"
                                            onClick={() => setReplacingNums((prev) => ({ ...prev, [replaceKey]: '' }))}
                                          >
                                            Replace #
                                          </button>
                                        )}
                                      </span>
                                    )}
                                    {(isReturn || isException) && canEditTracking && replaceVal !== undefined && (
                                      <div className="tn-replace-row">
                                        <input
                                          className="tn-replace-input"
                                          placeholder="New tracking number"
                                          value={replaceVal}
                                          autoFocus
                                          onChange={(e) => setReplacingNums((prev) => ({ ...prev, [replaceKey]: e.target.value }))}
                                          onKeyDown={(e) => {
                                            if (e.key === 'Enter') resolveTrackingNumber(order.id, originalIndex, num, replaceVal);
                                            if (e.key === 'Escape') setReplacingNums((prev) => { const n = { ...prev }; delete n[replaceKey]; return n; });
                                          }}
                                        />
                                        <button
                                          className="tn-replace-save"
                                          onClick={() => resolveTrackingNumber(order.id, originalIndex, num, replaceVal)}
                                          disabled={!replaceVal.trim()}
                                        >
                                          Save
                                        </button>
                                        <button
                                          className="tn-replace-cancel"
                                          onClick={() => setReplacingNums((prev) => { const n = { ...prev }; delete n[replaceKey]; return n; })}
                                        >
                                          Cancel
                                        </button>
                                      </div>
                                    )}
                                    {!pnd.deliveryDate && pnd.estimatedDelivery && (
                                      <span className="tn-pill tn-pill-eta">Est. {new Date(pnd.estimatedDelivery).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                                    )}
                                    {pnd.destination && (
                                      <span className="tn-pill tn-pill-dest">→ {pnd.destination}</span>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })}

                          {/* Delivered numbers — compact chip row */}
                          {doneNums.length > 0 && (
                            <div className="tnc-delivered-row">
                              {doneNums.map((num) => {
                                const pnd = perNumberData[num] || {};
                                const numPaid = paidNums.has(num);
                                return (
                                  <span key={num} className={`tnc-done-chip${numPaid ? ' tnc-done-chip-paid' : ''}`}>
                                    <input
                                      type="checkbox"
                                      checked
                                      onChange={() => toggleDeliveredNumber(order.id, originalIndex, num)}
                                      title="Unmark delivered"
                                    />
                                    <a href={getTrackingUrl(numCarrier.get(num), num)} target="_blank" rel="noopener noreferrer" className="tnc-done-num">
                                      {num}
                                    </a>
                                    {pnd.qty > 0 && <span className="tnc-done-kits">{pnd.qty} kits</span>}
                                    {pnd.confirmedAt
                                      ? <span className="tnc-done-confirmed" title={`Confirmed ${new Date(pnd.confirmedAt).toLocaleString()}`}>✓ Confirmed</span>
                                      : <span className="tnc-done-unconfirmed">unconfirmed</span>
                                    }
                                  </span>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                  })()}
                </div>
              ) : (
                <div
                  className={`tracking-display tracking-empty${isDelivered ? ' delivered' : ''}${isWaitingNoTracking ? ' waiting-no-tracking' : ''}`}
                >
                  <span className="carrier-text">{entry.carrier || 'UPS'}</span>
                  <span className="tracking-text">No tracking number</span>
                </div>
              )}

              {entry.note ? (
                <div className="tracking-note-display">{entry.note}</div>
              ) : null}

              {(entry.replacedNumbers || []).length > 0 && (
                <div className="tn-replaced-history">
                  {entry.replacedNumbers.map((r, i) => (
                    <span key={i} className="tn-replaced-row">
                      <span className="tn-replaced-old">{r.old}</span>
                      <span className="tn-replaced-arrow">→</span>
                      <span className="tn-replaced-new">{r.new}</span>
                    </span>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      );
    };

    const perms = vendorProfile?.permissions || {};
    const isVendor = Boolean(vendorProfile);
    const canViewItems = !isVendor || perms.viewItems;
    const canViewPayments = !isVendor || perms.viewPayments;
    const canEditTracking = !isVendor || perms.editTracking;

    const activeTab = orderDetailTab;
    const trackingCount = trackingEntries.length;
    const paymentCount = (order.downPayments || []).length;

    return (
      <div key={order.id} className="order-card">
        {/* ── Compact header ── */}
        <div className="order-header-bar" style={{ borderBottom: `3px solid ${vendorColor(order.vendor, vendorColorMap)}` }}>
          <div className="ohb-left">
            <button
              type="button"
              className="ohb-id"
              onClick={() => { copyToClipboard(order.id); setCopiedOrderMetaId(order.id); setTimeout(() => setCopiedOrderMetaId(null), 900); }}
              title="Click to copy Order ID"
            >
              {order.id}
            </button>
            {copiedOrderMetaId === order.id && <span className="ohb-copied">Copied!</span>}
            {order.vendor && <span className="order-vendor-badge">{order.vendor}</span>}
            {isEditing ? (
              <input
                type="datetime-local"
                value={new Date(order.submittedAt).toISOString().slice(0, 16)}
                onChange={(e) => updateOrderDate(order.id, e.target.value)}
                className="date-input date-input-inline"
              />
            ) : (
              <span className="ohb-date">{submittedAtDisplay}</span>
            )}
          </div>
          <div className="ohb-center">
            {totalUnitsOrdered > 0 && (
              <>
                <span className={`ohb-kits${deliveredUnits >= totalUnitsOrdered ? ' all-delivered' : deliveredUnits > 0 ? ' partial' : ''}`}>
                  {deliveredUnits}/{totalUnitsOrdered} kits
                </span>
                <div className="ohb-bar">
                  <div className="ohb-bar-fill" style={{ width: `${Math.min(100, (deliveredUnits / totalUnitsOrdered) * 100)}%` }} />
                </div>
              </>
            )}
          </div>
          {!vendorProfile && (
            <div className="ohb-right">
              <label className="status-toggle">
                <input
                  type="checkbox"
                  checked={(order.status || 'pending') === 'delivered'}
                  onChange={(e) => {
                    const nextStatus = e.target.checked ? 'delivered' : 'pending';
                    if (order.deliveredAt) {
                      setDeliveredOrders((prev) => prev.map((o) => (o.id === order.id ? { ...o, status: nextStatus } : o)));
                      if (nextStatus === 'pending') restoreDeliveredOrder(order.id);
                    } else {
                      setOrders((prev) => prev.map((o) => (o.id === order.id ? { ...o, status: nextStatus } : o)));
                      if (nextStatus === 'delivered') markOrderDelivered(order.id);
                      else updateOrderStatus(order.id, nextStatus);
                    }
                  }}
                />
                <span>{(order.status || 'pending') === 'delivered' ? 'Delivered' : 'Pending'}</span>
              </label>
              <div className="ohb-divider" />
              <button className="order-edit-link" onClick={() => toggleEdit(order.id)}>
                {isEditing ? 'Done' : 'Edit'}
              </button>
              <button className="order-delete-link" onClick={() => { if (window.confirm('Are you sure you want to permanently delete this order?')) deleteOrder(order); }}>
                Delete
              </button>
            </div>
          )}
        </div>

        {/* ── Items ── */}
        {canViewItems && (
          <div className="odt-panel">
            <div className="odt-section-heading">Items</div>
            {!isVendor && <div className="order-copy-row">
              <button className={`btn-copy-order${copiedWithPrice ? ' copied' : ''}`} onClick={handleCopyOrderItems}>
                {copiedWithPrice ? 'Copied!' : 'Copy w/ Price'}
              </button>
              <button className={`btn-copy-order${copiedNoPrice ? ' copied' : ''}`} onClick={handleCopyOrderItemsNoPrice}>
                {copiedNoPrice ? 'Copied!' : 'Copy Items'}
              </button>
            </div>}

            <div className="order-items-grid">
              <div className="order-items-header">
                <div>Product</div>
                <div>Strength</div>
                <div>Qty</div>
                <div>Unit</div>
                <div>Total</div>
                <div>Delivered</div>
                <div>Paid</div>
                {isEditing && <div></div>}
              </div>
              {[...(order.items || [])].sort((a, b) => {
                const wA = (a.warehouse || order.warehouse || 'US').toUpperCase();
                const wB = (b.warehouse || order.warehouse || 'US').toUpperCase();
                if (wA !== wB) return wA.localeCompare(wB);
                const nA = a.productName || ''; const nB = b.productName || '';
                if (nA === nB) return (a.productStrength || '').localeCompare(b.productStrength || '');
                return nA.localeCompare(nB);
              }).map((item) => {
                if (isEditing) {
                  return (
                    <div key={`${item.itemId}-row`} className="order-item-grid-row editing">
                      <div className="item-product-edit">{item.productName || item.product || ''}</div>
                      <div className="item-strength-edit">{item.productStrength || item.strength || ''}</div>
                      <input type="number" min="1" value={item.quantity} onChange={(e) => updateItemQuantity(order.id, item.itemId, e.target.value)} onFocus={(e) => e.target.select()} className="item-qty-input order-grid-input" />
                      <input type="number" min="0" step="0.01" value={item.pricePerKit} onChange={(e) => updateItemPrice(order.id, item.itemId, e.target.value)} onFocus={(e) => e.target.select()} className="item-price-input order-grid-input" />
                      <div className="item-total order-grid-total">${(item.quantity * item.pricePerKit).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                      <div className="item-delivered-edit">
                        <label className="item-status-toggle">
                          <input type="checkbox" checked={(item.status || 'pending') === 'delivered'} onChange={(e) => updateItemStatus(order.id, item.itemId, e.target.checked ? 'delivered' : 'pending')} />
                          <span>{(item.status || 'pending') === 'delivered' ? '✓' : ''}</span>
                        </label>
                      </div>
                      <div />
                      <button onClick={() => removeItemFromOrder(order.id, item.itemId)} className="item-remove-btn order-grid-remove" title="Remove item">×</button>
                    </div>
                  );
                }
                const itemTotal = (Number(item.quantity) || 0) * (Number(item.pricePerKit) || 0);
                const fmtAmt = (n) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
                const itemDeliveredQty = (order.trackingEntries || []).reduce((s, e) => {
                  if (!(e.itemIds || []).includes(item.itemId)) return s;
                  const pnd = e.perNumberData || {};
                  return s + (e.deliveredNumbers || []).reduce((ds, n) => ds + (Number(pnd[n]?.qty) || 0), 0);
                }, 0);
                const itemQty = Number(item.quantity) || 0;
                const isDelivered = (itemQty > 0 && itemDeliveredQty >= itemQty) || (item.status || 'pending') === 'delivered';
                const downPmtTotal = (order.downPayments || []).filter((p) => p.paymentType === 'down' || p.isDownPayment).reduce((s, p) => s + (Number(p.amount) || 0), 0);
                const downPaidForItem = finalTotal > 0 ? (itemTotal / finalTotal) * downPmtTotal : 0;
                const deliveredPmtTotal = (order.downPayments || []).filter((p) => p.paymentType === 'delivered' && !p.isDownPayment).reduce((s, p) => s + (Number(p.amount) || 0), 0);
                const totalDeliveredCost = (order.items || []).filter((i) => (i.status || 'pending') === 'delivered').reduce((s, i) => s + (Number(i.quantity) || 0) * (Number(i.pricePerKit) || 0), 0);
                const deliveredPaidForItem = isDelivered && totalDeliveredCost > 0 ? (itemTotal / totalDeliveredCost) * deliveredPmtTotal : 0;
                const totalPaidForItem = downPaidForItem + deliveredPaidForItem;
                const isFullyPaid = isDelivered && totalPaidForItem >= itemTotal - 0.01;
                const hasPaid = totalPaidForItem > 0.005;
                return (
                  <div key={`${item.itemId}-row`} className={`order-item-grid-row${isFullyPaid ? ' item-row-paid' : ''}`}>
                    <div className="item-product-view">{item.productName || item.product || ''}</div>
                    <div className="item-strength-view">{item.productStrength || item.strength || ''}</div>
                    <div className="item-qty-view">{item.quantity}</div>
                    <div className="item-unit-view">{fmtAmt(item.pricePerKit)}</div>
                    <div className={`item-total-view${isFullyPaid ? ' item-total-paid' : ''}`}>{fmtAmt(itemTotal)}</div>
                    <div className="item-delivered-view">
                      {itemQty > 0 ? (
                        <span className={`item-delivered-progress${isDelivered ? ' item-delivered-done' : itemDeliveredQty > 0 ? ' item-delivered-partial' : ''}`}>{itemDeliveredQty}/{itemQty}</span>
                      ) : (
                        <label className="item-status-toggle">
                          <input type="checkbox" checked={isDelivered} onChange={(e) => updateItemStatus(order.id, item.itemId, e.target.checked ? 'delivered' : 'pending')} />
                          <span>{isDelivered ? '✓' : ''}</span>
                        </label>
                      )}
                    </div>
                    <div className="item-paid-view">
                      {hasPaid && <span className={isFullyPaid ? 'item-paid-amount item-paid-full' : 'item-paid-amount item-paid-partial'}>{fmtAmt(Math.min(totalPaidForItem, itemTotal))}</span>}
                    </div>
                  </div>
                );
              })}
              {isEditing && (
                <div className="add-product-section">
                  {addingItemToOrder === order.id ? (
                    <div className="add-product-form">
                      <select onChange={(e) => { if (e.target.value) { const product = availableProducts.find((p) => p.id === e.target.value); if (!product) return; if (order.items.some((item) => item.productName === product.product && item.productStrength === product.strength)) { onError && onError('This product is already in the order.'); setAddingItemToOrder(null); return; } addItemToOrder(order.id, e.target.value); } }} className="product-select" defaultValue="">
                        <option value="">Select a product...</option>
                        {getAddableProductsForOrder(order).map((product) => (<option key={product.id} value={product.id}>{product.product} {product.strength} - ${getVendorProductPrice(order, product)}</option>))}
                      </select>
                      <button onClick={() => setAddingItemToOrder(null)} className="btn-cancel-add">Cancel</button>
                    </div>
                  ) : (
                    <button onClick={() => setAddingItemToOrder(order.id)} className="btn-add-product">+ Add Product</button>
                  )}
                </div>
              )}
            </div>

            {isEditing && (
              <div className="discount-section">
                <span>Discount %</span>
                <input type="number" min="0" max="100" step="0.01" value={discount} onFocus={(e) => e.target.select()} onChange={(e) => updateDiscount(order.id, parseFloat(e.target.value) || 0)} className="discount-input" />
              </div>
            )}

            <div className="order-total">
              <div className="order-total-values">
                <div className="order-total-line"><span>Items</span><span>${itemsSubtotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
                <div className="order-total-line shipping-line"><span>Shipping</span><span>${shippingCost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
                <div className="order-total-line total-line"><span>Total</span><span>${finalTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
                {discount > 0 && <div className="discount-indicator">{discount}% discount applied</div>}
                {totalUnitsOrdered > 0 && (
                  <div className="delivery-progress-wrap">
                    <div className="delivery-progress-bar-track"><div className="delivery-progress-bar-fill" style={{ width: `${Math.min(100, (deliveredUnits / totalUnitsOrdered) * 100)}%` }} /></div>
                    <div className="delivery-progress-labels">
                      <span className="dp-delivered">{deliveredUnits} delivered</span>
                      {deliveredCost > 0 && <span className="dp-cost">(${deliveredCost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })})</span>}
                      <span className="dp-separator">·</span>
                      <span className="dp-remaining">{remainingUnits} remaining</span>
                      <span className="dp-total">of {totalUnitsOrdered}</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── Tracking ── */}
        {(
          <div className="odt-panel">
            <div className="odt-section-heading">Tracking{trackingCount > 0 && <span className="odt-badge">{trackingCount}</span>}</div>
            <div className="tracking-list-footer">
              {canEditTracking && <>
                <button className="tracking-add" onClick={() => addTrackingEntry(order.id)}>+ Add Tracking</button>
                <button className="tracking-add tracking-auto-create" onClick={() => autoCreateTrackingEntries(order.id)}>+ Auto-Create from Products</button>
              </>}
              <button className="tracking-add tracking-sync" onClick={() => syncTrackingStatus(order.id)} disabled={syncingOrderId === order.id}>
                {syncingOrderId === order.id ? 'Syncing…' : '↻ Sync Status'}
              </button>
              <button
                className={`tracking-add tracking-copy-all${copiedOrderId === order.id && copiedOrderType === 'tracking' ? ' copied' : ''}`}
                onClick={() => {
                  const entries = getEffectiveTrackingEntries(order);
                  const pendingLines = [];
                  const deliveredLines = [];
                  entries.forEach((e) => {
                    const nums = getTrackingNumbers(e.number);
                    if (!nums.length) return;
                    const pnd = e.perNumberData || {};
                    const delivered = new Set(e.deliveredNumbers || []);
                    nums.forEach((num) => {
                      const d = pnd[num] || {};
                      const isDelivered = delivered.has(num) || /delivered/i.test(String(d.trackStatus || ''));
                      if (isDelivered) deliveredLines.push(`${num} -- delivered`);
                      else pendingLines.push(num);
                    });
                  });
                  const orderedLines = [...pendingLines, ...deliveredLines];
                  if (!orderedLines.length) return;
                  navigator.clipboard.writeText(orderedLines.join('\n'));
                  setCopiedOrderId(order.id); setCopiedOrderType('tracking');
                  setTimeout(() => { setCopiedOrderId(null); setCopiedOrderType(null); }, 2000);
                }}
              >
                {copiedOrderId === order.id && copiedOrderType === 'tracking' ? '✓ Copied' : '⎘ Copy All Tracking'}
              </button>
            </div>
            {pendingTrackingEntries.length > 0 && (
              <div className="tracking-display-grid tracking-display-grid-pending">
                {pendingTrackingEntries.map(renderTrackingCard)}
              </div>
            )}
            {deliveredTrackingEntries.length > 0 && (
              <div className="tracking-delivered-section">
                <div className="tracking-display-grid tracking-display-grid-delivered">
                  {deliveredTrackingEntries.map(renderTrackingCard)}
                </div>
              </div>
            )}
            {isEditing && <button onClick={() => cancelEdit(order.id)} className="btn-cancel-edit">Cancel</button>}
          </div>
        )}

        {/* ── Payments ── */}
        {canViewPayments && (() => {
          const downPayments = order.downPayments || [];
          const totalPaid = totalDownPaid;
          const form = downPaymentForms[order.id] || {};
          return (
            <div className="odt-panel">
              <div className="odt-section-heading">Payments{paymentCount > 0 && <span className="odt-badge odt-badge-paid">{paymentCount}</span>}</div>
              <div className="payment-panel">
                {(() => {
                  const remainingBalance = Math.max(0, finalTotal - totalPaid);
                  const fmt = (n) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                  // Undelivered due = whatever is left after subtracting what's owed for delivered items
                  const undeliveredDue = Math.max(0, remainingBalance - unpaidDeliveredCost);
                  return (
                    <>
                      {remainingBalance > 0.01 ? (
                        <div className="psc-remaining-banner">
                          <span className="psc-remaining-label">Remaining Balance</span>
                          <span className="psc-remaining-value">${fmt(remainingBalance)}</span>
                        </div>
                      ) : (
                        <div className="psc-remaining-banner psc-remaining-clear">
                          <span className="psc-remaining-label">Paid in Full</span>
                          <span className="psc-remaining-value">$0.00</span>
                        </div>
                      )}
                      <div className="payment-summary-row">
                        <div className="payment-summary-cell"><span className="psc-label">Order Total</span><span className="psc-value">${fmt(finalTotal)}</span></div>
                        <div className="payment-summary-cell"><span className="psc-label">Total Paid</span><span className="psc-value psc-paid">${fmt(totalPaid)}</span></div>
                        {unpaidDeliveredCost > 0.01 && <div className="payment-summary-cell"><span className="psc-label">Owed Now</span><span className="psc-value psc-owed">${fmt(unpaidDeliveredCost)}</span></div>}
                        {undeliveredDue > 0.01 && <div className="payment-summary-cell"><span className="psc-label">On Delivery</span><span className="psc-value psc-pending">${fmt(undeliveredDue)}</span></div>}
                      </div>
                    </>
                  );
                })()}
                {(order.items || []).some((i) => i.paid) && (
                  <div className="pl-reset-row"><button className="pl-reset-paid" onClick={() => resetPaidStatus(order.id)}>Reset Paid Status</button></div>
                )}
                {downPayments.length > 0 && (
                  <div className="payment-log">
                    <div className="payment-log-header">Payment History</div>
                    {downPayments.map((p) => {
                      const coveredItems = (p.coveredItemIds || [])
                        .map((id) => (order.items || []).find((i) => i.itemId === id))
                        .filter(Boolean);
                      const coveredNums = p.coveredTrackingNums || [];
                      return (
                        <div key={p.id} className="payment-log-row">
                          <div className="pl-main-row">
                            <span className={`pl-type-badge ${p.isDownPayment ? 'pl-type-down' : 'pl-type-delivered'}`}>{p.isDownPayment ? 'Down' : 'Delivered'}</span>
                            <span className="pl-date">{p.date}</span>
                            <span className="pl-method">{p.method}</span>
                            <span className="pl-amount">${Number(p.amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                            {p.note && <span className="pl-note">{p.note}</span>}
                            <button className="pl-remove" onClick={() => removeDownPayment(order.id, p.id)} title="Remove">×</button>
                          </div>
                          {(coveredItems.length > 0 || coveredNums.length > 0) && (
                            <div className="pl-covers">
                              {coveredItems.length > 0 && (
                                <span className="pl-covers-items">
                                  {coveredItems.map((item) => `${formatProductName(item.productName || item.product || '')}${item.productStrength || item.strength ? ` ${item.productStrength || item.strength}` : ''} ×${item.quantity}`).join(', ')}
                                </span>
                              )}
                              {coveredNums.length > 0 && (
                                <span className="pl-covers-boxes">{coveredNums.length} box{coveredNums.length !== 1 ? 'es' : ''}</span>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
                <div className="payment-form">
                  <div className="payment-form-title">Log Payment</div>
                  <label className="pf-down-check">
                    <input type="checkbox" checked={form.isDownPayment || false} onChange={(e) => patchDownPaymentForm(order.id, { isDownPayment: e.target.checked })} />
                    Down payment only
                  </label>
                  <div className="payment-form-fields">
                    <input className="pf-input pf-amount" type="number" min="0" step="0.01" placeholder="Amount" value={form.amount || ''} onChange={(e) => patchDownPaymentForm(order.id, { amount: e.target.value })} onFocus={(e) => e.target.select()} />
                    <input className="pf-input pf-date" type="date" value={form.date || new Date().toISOString().slice(0, 10)} onChange={(e) => patchDownPaymentForm(order.id, { date: e.target.value })} />
                    <select className="pf-input pf-method" value={form.method || 'Crypto'} onChange={(e) => patchDownPaymentForm(order.id, { method: e.target.value })}>
                      <option>Crypto</option>
                      <option>Wire</option>
                    </select>
                    <input className="pf-input pf-note" type="text" placeholder="Note (optional)" value={form.note || ''} onChange={(e) => patchDownPaymentForm(order.id, { note: e.target.value })} />
                    <button className="pf-submit" onClick={() => addDownPayment(order.id)} disabled={!form.amount || parseFloat(form.amount) <= 0}>Add</button>
                  </div>
                </div>
              </div>
            </div>
          );
        })()}
      </div>
    );
  };

  const renderOrderTabsView = (grouped, dateKeys, activeDate, setActiveDate) => {
    if (!dateKeys.length) return <div className="empty-orders">No orders.</div>;
    const safeDate = activeDate && grouped[activeDate] ? activeDate : dateKeys[0];
    const ordersForDate = grouped[safeDate] || [];

    return (
      <>
        <div className="orders-date-tabs">
          {dateKeys.map((k) => (
            <button
              key={k}
              className={`orders-date-tab ${safeDate === k ? 'active' : ''}`}
              onClick={() => setActiveDate(k)}
            >
              {k}
            </button>
          ))}
        </div>
        {ordersForDate.length > 0 && (
          <div className="date-group">
            <div className="orders-wrapper expanded">
              <div className="orders-container">{ordersForDate.map((order) => renderOrder(order))}</div>
            </div>
          </div>
        )}
      </>
    );
  };

  const renderAllDatesView = (grouped, dateKeys) => {
    if (!dateKeys.length) return <div className="empty-orders">No orders.</div>;

    return dateKeys.map((dateKey) => {
      const ordersForDate = grouped[dateKey] || [];

      return (
        <div key={dateKey} className="date-group">
          <div className="orders-wrapper expanded">
            <div className="orders-container">{ordersForDate.map((order) => renderOrder(order))}</div>
          </div>
        </div>
      );
    });
  };

  const pendingTotal = orders.reduce((sum, o) => sum + calculateFinalTotal(o), 0);
  const deliveredTotal = deliveredOrders.reduce((sum, o) => sum + calculateFinalTotal(o), 0);

  const fmt2 = (n) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const pendingVendors = [...new Set(orders.map(o => o.vendor || 'TSC'))].sort((a, b) => {
    if (a === 'TSC') return -1;
    if (b === 'TSC') return 1;
    return a.localeCompare(b);
  });
  const effectiveVendorFilter = vendorProfile
    ? vendorProfile.vendorName
    : (selectedVendorFilter === 'all' || pendingVendors.includes(selectedVendorFilter)
      ? selectedVendorFilter
      : 'all');
  const filteredPendingOrders = effectiveVendorFilter === 'all'
    ? orders
    : orders.filter(o => (o.vendor || 'TSC') === effectiveVendorFilter);

  const vendorSummaryStats = pendingVendors.map((vendor) => {
    const vendorOrders = orders.filter((o) => (o.vendor || 'TSC') === vendor);
    const total = vendorOrders.reduce((s, o) => s + calculateFinalTotal(o), 0);
    const paid = vendorOrders.reduce((s, o) =>
      s + (o.downPayments || []).reduce((ps, p) => ps + (Number(p.amount) || 0), 0), 0);
    const deliveredCost = vendorOrders.reduce((s, o) =>
      s + (o.trackingEntries || []).reduce((es, e) => {
        const pnd = e.perNumberData || {};
        return es + (e.deliveredNumbers || []).reduce((ns, n) => ns + (Number(pnd[n]?.cost) || 0), 0);
      }, 0), 0);
    const paidDeliveredCost = vendorOrders.reduce((s, o) =>
      s + (o.trackingEntries || []).reduce((es, e) => {
        const pnd = e.perNumberData || {};
        return es + (e.paidNumbers || []).reduce((ns, n) => ns + (Number(pnd[n]?.cost) || 0), 0);
      }, 0), 0);
    const deliveredUnpaid = Math.max(0, deliveredCost - paidDeliveredCost);
    const totalKits = vendorOrders.reduce((s, o) =>
      s + (o.items || []).reduce((is, i) => is + (Number(i.quantity) || 0), 0), 0);
    const deliveredKits = vendorOrders.reduce((s, o) =>
      s + (o.trackingEntries || []).reduce((es, e) => {
        const pnd = e.perNumberData || {};
        return es + (e.deliveredNumbers || []).reduce((ns, n) => ns + (Number(pnd[n]?.qty) || 0), 0);
      }, 0), 0);
    const remaining = Math.max(0, total - paid);
    return { vendor, total, paid, deliveredUnpaid, remaining, totalKits, deliveredKits };
  });

  const deliveredVendors = [...new Set(deliveredOrders.map(o => o.vendor || 'TSC'))].sort((a, b) => {
    if (a === 'TSC') return -1;
    if (b === 'TSC') return 1;
    return a.localeCompare(b);
  });
  const effectiveDeliveredVendorFilter =
    selectedDeliveredVendorFilter === 'all' || deliveredVendors.includes(selectedDeliveredVendorFilter)
      ? selectedDeliveredVendorFilter
      : 'all';
  const filteredDeliveredOrders = effectiveDeliveredVendorFilter === 'all'
    ? deliveredOrders
    : deliveredOrders.filter(o => (o.vendor || 'TSC') === effectiveDeliveredVendorFilter);

  const parseTrackingNumbers = (rawNumber) => {
    if (!rawNumber) return [];
    return String(rawNumber)
      .replace(/\r/g, '\n')
      .split(/[\n,;\t\s]+/)
      .map((value) => value.trim())
      .filter(Boolean);
  };

  const getUndeliveredTracking = (order, item) => {
    const pendingEntries = (order.trackingEntries || []).filter(
      (entry) => (entry.status || 'pending') !== 'delivered'
    );
    const itemEntries = pendingEntries.filter(
      (entry) => Array.isArray(entry.itemIds) && item.itemId && entry.itemIds.includes(item.itemId)
    );
    const preferredEntries = itemEntries.length ? itemEntries : pendingEntries;

    for (const entry of preferredEntries) {
      const numbers = parseTrackingNumbers(entry.number);
      if (numbers.length > 0) {
        const carrier = entry.carrier || 'Carrier';
        const preview = numbers[0];
        const suffix = numbers.length > 1 ? ` (+${numbers.length - 1})` : '';
        return { hasTracking: true, trackingLabel: `${carrier} ${preview}${suffix}` };
      }
    }

    const legacyNumbers = parseTrackingNumbers(order.trackingNumber);
    if (legacyNumbers.length > 0) {
      const carrier = order.carrier || 'Carrier';
      const preview = legacyNumbers[0];
      const suffix = legacyNumbers.length > 1 ? ` (+${legacyNumbers.length - 1})` : '';
      return { hasTracking: true, trackingLabel: `${carrier} ${preview}${suffix}` };
    }

    return { hasTracking: false, trackingLabel: '' };
  };

  const undeliveredTotal = filteredPendingOrders.reduce((sum, o) => {
    const discount = o.discountPercent || 0;
    const itemsTotal = (o.items || [])
      .filter(item => (item.status || 'pending') !== 'delivered')
      .reduce((s, item) => s + (Number(item.quantity) || 0) * (Number(item.pricePerKit) || 0), 0);
    return sum + itemsTotal - itemsTotal * (discount / 100);
  }, 0);

  // Build grouped undelivered items for the modal
  const undeliveredItemsByVendor = filteredPendingOrders.reduce((acc, o) => {
    const vendor = o.vendor || 'TSC';
    const discount = o.discountPercent || 0;
    (o.items || [])
      .filter(item => (item.status || 'pending') !== 'delivered')
      .forEach(item => {
        if (!acc[vendor]) acc[vendor] = [];
        const qty = Number(item.quantity) || 0;
        const price = Number(item.pricePerKit) || 0;
        const lineTotal = (qty * price) * (1 - discount / 100);
        const tracking = getUndeliveredTracking(o, item);
        acc[vendor].push({
          productName: item.productName || item.product || '',
          productStrength: item.productStrength || item.strength || '',
          warehouse: (item.warehouse || o.warehouse || 'US').toUpperCase(),
          quantity: qty,
          pricePerKit: price,
          lineTotal,
          orderId: o.id,
          hasTracking: tracking.hasTracking,
          trackingLabel: tracking.trackingLabel,
        });
      });
    return acc;
  }, {});

  const problemTracking = filteredPendingOrders.flatMap((order) => {
    const entries = Array.isArray(order.trackingEntries)
      ? order.trackingEntries
      : Object.values(order.trackingEntries || {});
    return entries.flatMap((entry, entryIdx) => {
      const nums = getTrackingNumbers(entry.number);
      const pnd = entry.perNumberData || {};
      const delivered = new Set(entry.deliveredNumbers || []);
      return nums
        .filter((num) => {
          if (delivered.has(num)) return false;
          const sub = pnd[num]?.subStatus || '';
          const trackSt = pnd[num]?.trackStatus || '';
          return /return/i.test(sub) || /exception/i.test(sub) || /return/i.test(trackSt) || /exception/i.test(trackSt);
        })
        .map((num) => {
          const sub = pnd[num]?.subStatus || '';
          const trackSt = pnd[num]?.trackStatus || '';
          const isReturn = /return/i.test(sub) || /return/i.test(trackSt);
          const assignedItems = (Array.isArray(entry.itemIds) ? entry.itemIds : [])
            .map((id) => (order.items || []).find((i) => i.itemId === id))
            .filter(Boolean);
          return {
            orderId: order.id,
            entryIdx,
            vendor: order.vendor || 'TSC',
            trackingNum: num,
            isReturn,
            label: isReturn ? 'Returned to Sender' : `Exception: ${(sub || trackSt).replace('Exception_', '').replace(/([A-Z])/g, ' $1').trim()}`,
            items: assignedItems,
          };
        });
    });
  });

  return (
    <div className="submitted-orders-section">
      {!deliveredOnly && (
        <div className="orders-group">
          <div className="pending-top-bar">
            <div className="pending-top-left">
              <h2 className="text-glow-fuchsia">Pending Orders</h2>
              {!vendorProfile && pendingVendors.length > 0 && (
                <div className="vendor-tab-bar">
                  <button
                    className={`vendor-tab-btn${effectiveVendorFilter === 'all' ? ' active' : ''}`}
                    onClick={() => setSelectedVendorFilter('all')}
                  >All</button>
                  {pendingVendors.map(vendor => (
                    <button
                      key={vendor}
                      className={`vendor-tab-btn${effectiveVendorFilter === vendor ? ' active' : ''}`}
                      onClick={() => setSelectedVendorFilter(vendor)}
                    >{vendor}</button>
                  ))}
                </div>
              )}
            </div>
            {effectiveVendorFilter !== 'all' && (() => {
              const vs = vendorSummaryStats.find(v => v.vendor === effectiveVendorFilter);
              if (!vs) return null;
              return (
                <div className="vendor-spotlight">
                  <div className="vsp-name">{vs.vendor}</div>
                  <div className="vsp-stats">
                    <div className="vsp-stat">
                      <span className="vsp-label">Total</span>
                      <span className="vsp-value">${fmt2(vs.total)}</span>
                    </div>
                    <div className="vsp-stat">
                      <span className="vsp-label">Paid</span>
                      <span className="vsp-value vsp-paid">${fmt2(vs.paid)}</span>
                    </div>
                    {vs.remaining > 0.01 && (
                      <div className="vsp-stat">
                        <span className="vsp-label">Remaining</span>
                        <span className="vsp-value vsp-owed">${fmt2(vs.remaining)}</span>
                      </div>
                    )}
                    {vs.deliveredUnpaid > 0.01 && (
                      <div className="vsp-stat">
                        <span className="vsp-label">Owed Now</span>
                        <span className="vsp-value vsp-owed">${fmt2(vs.deliveredUnpaid)}</span>
                      </div>
                    )}
                    <div className="vsp-stat">
                      <span className="vsp-label">Kits</span>
                      <span className="vsp-value">
                        {vs.deliveredKits > 0
                          ? <>{vs.deliveredKits.toLocaleString()}<span className="vsp-kits-of">/{vs.totalKits.toLocaleString()}</span></>
                          : vs.totalKits.toLocaleString()}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
          {problemTracking.length > 0 && (
            <TrackingAlerts problems={problemTracking} onResolve={resolveTrackingNumber} onBulkResolve={resolveBulkTrackingNumbers} />
          )}
          {filteredPendingOrders.length === 0 ? (
            <div className="empty-orders">No pending orders.</div>
          ) : (
            <>
              <div className="order-picker-list">
                {filteredPendingOrders.map((o) => {
                  const totalKits = (o.items || []).reduce((s, i) => s + (Number(i.quantity) || 0), 0);
                  const deliveredKits = (o.trackingEntries || []).reduce((s, e) => {
                    const pnd = e.perNumberData || {};
                    return s + (e.deliveredNumbers || []).reduce((ds, n) => ds + (Number(pnd[n]?.qty) || 0), 0);
                  }, 0);
                  const totalPaid = (o.downPayments || []).reduce((s, p) => s + (Number(p.amount) || 0), 0);
                  const fin = getOrderFinancials(o);
                  const balance = Math.max(0, fin.finalTotal - totalPaid);
                  const deliveredPaid = (o.trackingEntries || []).reduce((s, e) => {
                    const pnd = e.perNumberData || {};
                    const paid = new Set(e.paidNumbers || []);
                    return s + (e.deliveredNumbers || []).filter(n => paid.has(n)).reduce((ds, n) => ds + (Number(pnd[n]?.cost) || 0), 0);
                  }, 0);
                  const deliveredOwed = (o.trackingEntries || []).reduce((s, e) => {
                    const pnd = e.perNumberData || {};
                    const paid = new Set(e.paidNumbers || []);
                    return s + (e.deliveredNumbers || []).filter(n => !paid.has(n)).reduce((ds, n) => ds + (Number(pnd[n]?.cost) || 0), 0);
                  }, 0);
                  const color = vendorColor(o.vendor || 'TSC', vendorColorMap);
                  const date = new Date(o.submittedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                  const isSelected = selectedOrderId === o.id;
                  const fmt0 = (n) => n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
                  const isFullyDelivered = totalKits > 0 && deliveredKits >= totalKits;
                  return (
                    <button
                      key={o.id}
                      className={`opc-card${isSelected ? ' opc-card--selected' : ''}${isFullyDelivered ? ' opc-card--delivered' : ''}`}
                      onClick={() => setSelectedOrderId(o.id)}
                    >
                      <div className="opc-accent" style={{ background: isFullyDelivered ? '#16a34a' : color }} />
                      {isFullyDelivered && <div className="opc-delivered-overlay"><span>DELIVERED</span></div>}
                      <div className="opc-content">
                        <div className="opc-top">
                          <span className="opc-vendor">{o.vendor || 'TSC'}</span>
                          <span className="opc-date">{date}</span>
                        </div>
                        <div className="opc-order-id">{o.id}</div>
                        <div className="opc-kits-line">
                          {deliveredKits > 0
                            ? <><strong>{deliveredKits.toLocaleString()}</strong><span className="opc-kits-of">/{totalKits.toLocaleString()} kits</span></>
                            : <><strong>{totalKits.toLocaleString()}</strong><span className="opc-kits-of"> kits</span></>}
                        </div>
                        {totalKits > 0 && deliveredKits > 0 && (
                          <div className="opc-bar-track">
                            <div className="opc-bar-fill" style={{ width: `${Math.min(100, (deliveredKits / totalKits) * 100)}%` }} />
                          </div>
                        )}
                        <div className="opc-money">
                          <span className="opc-total">${fmt0(fin.finalTotal)}</span>
                        </div>
                        {(totalPaid > 0 || balance > 0) && (
                          <div className="opc-money-sub">
                            {totalPaid > 0 && <span className="opc-paid">${fmt0(totalPaid)} paid</span>}
                            {balance > 0 && totalPaid > 0 && <span className="opc-balance">${fmt0(balance)} owed</span>}
                          </div>
                        )}
                        {(deliveredPaid > 0 || deliveredOwed > 0) && (
                          <div className="opc-delivered-pay">
                            <span className="opc-delivered-label">Delivered:</span>
                            {deliveredPaid > 0 && <span className="opc-delivered-paid">${fmt0(deliveredPaid)} paid</span>}
                            {deliveredOwed > 0 && <span className="opc-delivered-owed">${fmt0(deliveredOwed)} owed</span>}
                          </div>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
              {(() => {
                const order = filteredPendingOrders.find(o => o.id === selectedOrderId) || filteredPendingOrders[0];
                return order ? renderOrder(order) : null;
              })()}
            </>
          )}
        </div>
      )}

      {deliveredOnly && (
        <div className="orders-group delivered-section">
          <h2 className="text-glow-fuchsia">Delivered Orders</h2>
          <div className="orders-page-total">
            <span className="orders-summary-pill">Total: ${deliveredTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          </div>
          {deliveredVendors.length > 1 && (
            <div className="vendor-tab-bar">
              <button
                className={`vendor-tab-btn${effectiveDeliveredVendorFilter === 'all' ? ' active' : ''}`}
                onClick={() => setSelectedDeliveredVendorFilter('all')}
              >
                All
              </button>
              {deliveredVendors.map(vendor => (
                <button
                  key={vendor}
                  className={`vendor-tab-btn${effectiveDeliveredVendorFilter === vendor ? ' active' : ''}`}
                  onClick={() => setSelectedDeliveredVendorFilter(vendor)}
                >
                  {vendor}
                </button>
              ))}
            </div>
          )}
          {filteredDeliveredOrders.length === 0 ? (
            <div className="empty-orders">No delivered orders.</div>
          ) : (
            filteredDeliveredOrders.map((o) => renderOrder(o))
          )}
        </div>
      )}

      {showUndeliveredModal && createPortal(
        <>
          <div className="modal-backdrop is-open" onClick={() => setShowUndeliveredModal(false)} />
          <div className="modal-main is-open undelivered-modal">
            <div className="undelivered-modal-header">
              <h2 className="undelivered-modal-title">Items Not Received</h2>
              <button className="undelivered-modal-close" onClick={() => setShowUndeliveredModal(false)}>✕</button>
            </div>
            <div className="undelivered-modal-body">
              {Object.keys(undeliveredItemsByVendor).sort((a, b) => {
                if (a === 'TSC') return -1;
                if (b === 'TSC') return 1;
                return a.localeCompare(b);
              }).map(vendor => {
                const items = undeliveredItemsByVendor[vendor];
                const vendorSubtotal = items.reduce((s, i) => s + i.lineTotal, 0);
                return (
                  <div key={vendor} className="undelivered-vendor-group">
                    <div className="undelivered-vendor-head">
                      <div className="undelivered-vendor-label" style={{ borderColor: vendorColor(vendor, vendorColorMap), color: vendorColor(vendor, vendorColorMap) }}>
                        {vendor}
                      </div>
                      <div className="undelivered-vendor-subtotal">
                        Vendor Total: ${vendorSubtotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </div>
                    </div>
                    <div className="undelivered-items-grid">
                      <div className="undelivered-grid-header">
                        <span>Warehouse</span>
                        <span>Product</span>
                        <span>Strength</span>
                        <span>Qty</span>
                        <span>Unit</span>
                        <span>Total</span>
                        <span>Order</span>
                        <span>Tracking</span>
                      </div>
                      {items.map((item, idx) => (
                        <div key={idx} className="undelivered-grid-row">
                          <span className="uitem-warehouse">{item.warehouse}</span>
                          <span className="uitem-product">{item.productName}</span>
                          <span className="uitem-strength">{item.productStrength || '—'}</span>
                          <span className="uitem-qty">{item.quantity}</span>
                          <span className="uitem-unit">${item.pricePerKit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                          <span className="uitem-total">${item.lineTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                          <span className="uitem-order">{item.orderId}</span>
                          <span className={`uitem-tracking ${item.hasTracking ? 'has-tracking' : 'no-tracking'}`}>
                            {item.hasTracking ? item.trackingLabel : 'No Tracking'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="undelivered-modal-footer">
              <span className="undelivered-grand-total">
                Grand Total: ${undeliveredTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
              <button className="undelivered-modal-close-btn" onClick={() => setShowUndeliveredModal(false)}>Close</button>
            </div>
          </div>
        </>
      , document.body)}
    </div>
  );
};

export default SubmittedOrders;
