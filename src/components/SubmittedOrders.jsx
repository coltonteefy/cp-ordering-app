import { useEffect, useRef, useState } from 'react';
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

const SubmittedOrders = ({ onSuccess, onError, deliveredOnly = false }) => {
  const [copiedOrderId, setCopiedOrderId] = useState(null);
  const [copiedOrderType, setCopiedOrderType] = useState(null); // 'price' or 'no-price'
  const [orders, setOrders] = useState([]);
  const [deliveredOrders, setDeliveredOrders] = useState([]);
  const [editingOrders, setEditingOrders] = useState(new Set());
  const [originalOrders, setOriginalOrders] = useState({});
  const [hasShownError, setHasShownError] = useState(false);
  const [copiedOrderMetaId, setCopiedOrderMetaId] = useState(null);
  const [activeDeliveredDate, setActiveDeliveredDate] = useState(null);
  const [activeDeliveredOrderId, setActiveDeliveredOrderId] = useState(null); // kept for compatibility
  const [availableProducts, setAvailableProducts] = useState([]);
  const [addingItemToOrder, setAddingItemToOrder] = useState(null);
  const [editingTrackingCards, setEditingTrackingCards] = useState({});
  const syncedIncomingOnce = useRef(false);
  const [vendorColorMap, setVendorColorMap] = useState({});

  // Load vendor colors from Firestore
  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, 'c&pVendors'),
      (snapshot) => {
        const colors = {};
        snapshot.forEach((snap) => {
          const data = snap.data();
          if (data.color) colors[data.name || snap.id] = data.color;
        });
        setVendorColorMap(colors);
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

        const grouped = groupOrdersByDate(ordersData);
        const dateKeys = Object.keys(grouped).sort((a, b) => new Date(b) - new Date(a));
        const fallbackDate = dateKeys[0] || null;

        if (!activeDeliveredDate || !grouped[activeDeliveredDate]) {
          const firstOrder = fallbackDate ? grouped[fallbackDate]?.[0]?.id || null : null;
          setActiveDeliveredDate(fallbackDate);
          setActiveDeliveredOrderId(firstOrder);
        } else {
          const currentDateOrders = grouped[activeDeliveredDate] || [];
          const exists = currentDateOrders.some((o) => o.id === activeDeliveredOrderId);
          if (!exists) {
            setActiveDeliveredOrderId(currentDateOrders[0]?.id || null);
          }
        }
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
          const key = `${name}__${strength}`;
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

  const setTrackingCardEditing = (orderId, entryIdx, isEditing) => {
    setEditingTrackingCards((prev) => {
      const next = { ...prev };
      const key = trackingCardKey(orderId, entryIdx);
      if (isEditing) {
        next[key] = true;
      } else {
        delete next[key];
      }
      return next;
    });
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

  const getEffectiveTrackingEntries = (ord) => {
    if (ord?.trackingEntries && Array.isArray(ord.trackingEntries) && ord.trackingEntries.length) {
      return ord.trackingEntries;
    }
    if (ord?.trackingNumber && ord?.carrier) {
      return [{ id: 'legacy', carrier: ord.carrier, number: ord.trackingNumber, note: '', status: ord.status || 'pending' }];
    }
    return [];
  };

  const saveTrackingEntries = async (orderId, entries) => {
    try {
      await updateDoc(doc(db, 'c&pProductOrders', orderId), { trackingEntries: entries });
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
    const entries = [...getEffectiveTrackingEntries(order)];
    const newEntryIndex = entries.length;
    entries.push({ id: Date.now().toString(), carrier: order?.carrier || 'UPS', number: '', note: '', status: 'pending' });

    setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, trackingEntries: entries } : o)));
    setTrackingCardEditing(orderId, newEntryIndex, true);
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

    const warehouse = order.warehouse || 'US';
    const price = product.warehouseCosts?.[warehouse] || 0;
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
      default:
        return '#';
    }
  };

  const getTrackingNumbers = (rawNumber) => {
    if (!rawNumber) return [];
    const cleaned = String(rawNumber).replace(/\r/g, '\n').trim();
    if (!cleaned) return [];

    // Split pasted tracking blobs by common separators while keeping carrier tokens intact.
    const byCommonDelimiters = cleaned
      .replace(/\|/g, '\n')
      .split(/[\n,;\t\s]+/)
      .map((value) => value.trim())
      .filter((value) => Boolean(value));

    if (byCommonDelimiters.length > 1) return [...new Set(byCommonDelimiters)];
    return [cleaned];
  };

  // Rendering helpers -----------------------------------------
  const calculateFinalTotal = (order) => {
    const itemsTotal = (order.items || []).reduce(
      (sum, item) => sum + (item.quantity || 0) * (item.pricePerKit || 0),
      0
    );
    const baseTotal = typeof order.total === 'number' ? order.total : itemsTotal;
    const discount = order.discountPercent || 0;
    return baseTotal - baseTotal * (discount / 100);
  };

  const renderOrder = (order) => {
    const isEditing = editingOrders.has(order.id);
    const discount = order.discountPercent || 0;
    const finalTotal = calculateFinalTotal(order);
    const submittedAtDisplay = new Date(order.submittedAt).toLocaleString();
    const trackingEntries =
      order.trackingEntries && Array.isArray(order.trackingEntries) && order.trackingEntries.length > 0
        ? order.trackingEntries.map((t) => ({ ...t, status: t.status || 'pending' }))
        : order.trackingNumber && order.carrier
          ? [{ id: 'legacy', carrier: order.carrier, number: order.trackingNumber, note: '', status: 'pending' }]
          : [];
    const orderedTrackingEntries = trackingEntries
      .map((entry, originalIndex) => ({ entry, originalIndex }))
      .sort((a, b) => {
        const aDelivered = (a.entry.status || 'pending') === 'delivered';
        const bDelivered = (b.entry.status || 'pending') === 'delivered';
        if (aDelivered === bDelivered) return a.originalIndex - b.originalIndex;
        return aDelivered ? 1 : -1;
      });
    const pendingTrackingEntries = orderedTrackingEntries.filter(
      ({ entry }) => (entry.status || 'pending') !== 'delivered'
    );
    const deliveredTrackingEntries = orderedTrackingEntries.filter(
      ({ entry }) => (entry.status || 'pending') === 'delivered'
    );

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
      const isDelivered = (entry.status || 'pending') === 'delivered';
      const trackingNumbers = getTrackingNumbers(entry.number);
      const hasTrackingNumbers = trackingNumbers.length > 0;
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
        updateTrackingEntry(order.id, originalIndex, { itemIds: nextItemIds });
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
                    className="tracking-card-btn"
                    onClick={() => setTrackingCardEditing(order.id, originalIndex, false)}
                  >
                    Done
                  </button>
                </div>
              </div>
              <div className="tracking-edit-grid">
                <div className="tracking-field">
                  <span className="tracking-field-label">Carrier</span>
                  <div className="carrier-pills">
                    {['UPS', 'USPS', 'FedEx', 'DHL'].map(c => (
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
                  <span className="tracking-field-label">Tracking #</span>
                  <input
                    type="text"
                    placeholder="Tracking Number"
                    value={entry.number || ''}
                    onChange={(e) => updateTrackingEntry(order.id, originalIndex, { number: e.target.value })}
                    className="tracking-input"
                  />
                </label>
              </div>
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
                <button
                  className="tracking-card-edit-link"
                  onClick={() => setTrackingCardEditing(order.id, originalIndex, true)}
                >
                  Edit
                </button>
              </div>
              {entry.carrier && hasTrackingNumbers ? (
                <div className={`tracking-display${isDelivered ? ' delivered' : ''}`}>
                  <span className="carrier-text">{entry.carrier}</span>
                  <div className="tracking-number-list">
                    {trackingNumbers.map((trackingNumber, trackingIdx) => (
                      <a
                        key={`${entry.id || originalIndex}-${trackingIdx}-${trackingNumber}`}
                        href={getTrackingUrl(entry.carrier, trackingNumber)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="tracking-number-link tracking-text"
                      >
                        {trackingNumber}
                      </a>
                    ))}
                  </div>
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
              {assignedItems.length ? (
                <div className="tracking-note-display tracking-assigned-items">
                  <div className="tracking-note-label">Items</div>
                  <ul className="tracking-item-plain-list">
                    {assignedItems.map((item) => (
                      <li key={item.itemId}>{formatTrackingItemLabel(item)}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </>
          )}
        </div>
      );
    };

    return (
      <div key={order.id} className="order-card" style={{ borderLeft: `4px solid ${vendorColor(order.vendor, vendorColorMap)}` }}>
        <div
          className={`warehouse-header warehouse-${(order.warehouse || 'US').toLowerCase()}`}
          style={{ background: vendorColor(order.vendor, vendorColorMap) }}
        >
          <div className="warehouse-meta">
            <div className="warehouse-order-id-wrap">
              <button
                type="button"
                className="warehouse-order-id"
                onClick={() => {
                  copyToClipboard(order.id);
                  setCopiedOrderMetaId(order.id);
                  setTimeout(() => setCopiedOrderMetaId(null), 900);
                }}
                title="Click to copy Order ID"
              >
                {order.id}
              </button>
              {copiedOrderMetaId === order.id && (
                <span className="warehouse-order-id-copied">Copied!</span>
              )}
            </div>
            {order.vendor && (
              <span className="order-vendor-badge">{order.vendor}</span>
            )}
            <div className="warehouse-date">
              {isEditing ? (
                <input
                  type="datetime-local"
                  value={new Date(order.submittedAt).toISOString().slice(0, 16)}
                  onChange={(e) => updateOrderDate(order.id, e.target.value)}
                  className="date-input date-input-inline"
                />
              ) : (
                <span className="order-date-inline">{submittedAtDisplay}</span>
              )}
            </div>
          </div>
          <div className="order-status-top">
            <span className="status-label">Order Status:</span>
            <label className="status-toggle">
              <input
                type="checkbox"
                checked={(order.status || 'pending') === 'delivered'}
                onChange={(e) => {
                  const nextStatus = e.target.checked ? 'delivered' : 'pending';
                  setOrders((prev) => prev.map((o) => (o.id === order.id ? { ...o, status: nextStatus } : o)));
                  if (nextStatus === 'delivered') {
                    markOrderDelivered(order.id);
                  } else {
                    updateOrderStatus(order.id, nextStatus);
                  }
                }}
              />
              <span>{(order.status || 'pending') === 'delivered' ? 'Delivered' : 'Pending'}</span>
            </label>
          </div>
          <div className="warehouse-actions">
            <button
              className="order-edit-link"
              onClick={() => toggleEdit(order.id)}
              title={isEditing ? 'Finish editing' : 'Edit order'}
            >
              {isEditing ? 'Done' : 'Edit Order'}
            </button>
            <button
              className="order-delete-link"
              onClick={() => {
                if (window.confirm('Are you sure you want to permanently delete this order?')) {
                  deleteOrder(order);
                }
              }}
              title="Delete this order"
            >
              Delete
            </button>
          </div>
        </div>

        <div className="order-body-split">
          <div className="order-col-left">
            {trackingEntries.length ? (
              <div className="tracking-list-wrap">
                {pendingTrackingEntries.length > 0 && (
                  <div className="tracking-display-grid tracking-display-grid-pending">
                    {pendingTrackingEntries.map(renderTrackingCard)}
                  </div>
                )}
                <div className="tracking-list-footer">
                  <button className="tracking-add" onClick={() => addTrackingEntry(order.id)}>
                    + Add Tracking
                  </button>
                </div>
                {deliveredTrackingEntries.length > 0 && (
                  <div className="tracking-delivered-section">
                    <div className="tracking-display-grid tracking-display-grid-delivered">
                      {deliveredTrackingEntries.map(renderTrackingCard)}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="tracking-multi">
                <button className="tracking-add" onClick={() => addTrackingEntry(order.id)}>
                  + Add Tracking
                </button>
              </div>
            )}

            <div className="order-actions">
              {isEditing && (
                <button onClick={() => cancelEdit(order.id)} className="btn-cancel-edit">
                  Cancel
                </button>
              )}
            </div>

          </div>

          <div className="order-col-right">
            <div className="order-copy-row order-copy-row-right">
              <button
                className={`btn-copy-order${copiedWithPrice ? ' copied' : ''}`}
                style={{
                  background: 'transparent',
                  color: copiedWithPrice ? '#E6A94A' : '#8B6F47',
                  border: '1px solid #E6A94A',
                  borderRadius: '4px',
                  padding: '4px 10px',
                  cursor: 'pointer',
                  fontWeight: 600,
                  transition: 'background 0.3s, color 0.3s',
                  boxShadow: 'none',
                  opacity: copiedWithPrice ? 0.85 : 1,
                  marginRight: '8px'
                }}
                title="Copy order items with pricing"
                onClick={handleCopyOrderItems}
              >
                {copiedWithPrice ? 'Copied!' : 'Copy w/ Price'}
              </button>
              <button
                className={`btn-copy-order${copiedNoPrice ? ' copied' : ''}`}
                style={{
                  background: 'transparent',
                  color: copiedNoPrice ? '#E6A94A' : '#8B6F47',
                  border: '1px solid #E6A94A',
                  borderRadius: '4px',
                  padding: '4px 10px',
                  cursor: 'pointer',
                  fontWeight: 600,
                  transition: 'background 0.3s, color 0.3s',
                  boxShadow: 'none',
                  opacity: copiedNoPrice ? 0.85 : 1
                }}
                title="Copy order items without pricing"
                onClick={handleCopyOrderItemsNoPrice}
              >
                {copiedNoPrice ? 'Copied!' : 'Copy Items'}
              </button>
            </div>

            <div className="order-items-grid">
              <div className="order-items-header">
                <div>Warehouse</div>
                <div>Product</div>
                <div>Strength</div>
                <div>Qty</div>
                <div>Unit</div>
                <div>Total</div>
                <div>Delivered</div>
                {isEditing && <div></div>}
              </div>
              {[...order.items]
                .slice()
                .sort((a, b) => {
                  const warehouseA = (a.warehouse || order.warehouse || 'US').toUpperCase();
                  const warehouseB = (b.warehouse || order.warehouse || 'US').toUpperCase();
                  if (warehouseA !== warehouseB) return warehouseA.localeCompare(warehouseB);
                  const nameA = a.productName || '';
                  const nameB = b.productName || '';
                  if (nameA === nameB) {
                    return (a.productStrength || '').localeCompare(b.productStrength || '');
                  }
                  return nameA.localeCompare(nameB);
                })
                .map((item, index, arr) => {
                  const itemWarehouse = (item.warehouse || order.warehouse || 'US').toUpperCase();
                  const prevWarehouse =
                    index > 0 ? (arr[index - 1].warehouse || order.warehouse || 'US').toUpperCase() : null;
                  const showWarehouseSection = index === 0 || itemWarehouse !== prevWarehouse;

                  return [
                    showWarehouseSection ? (
                      <div key={`${item.itemId}-warehouse-section`} className="order-item-warehouse-divider">
                        {itemWarehouse} WAREHOUSE
                      </div>
                    ) : null,
                    isEditing ? (
                      <div key={`${item.itemId}-row`} className="order-item-grid-row editing">
                        <div className="item-warehouse-edit">
                          <select
                            className="item-warehouse-select"
                            value={itemWarehouse}
                            onChange={(e) => updateItemWarehouse(order.id, item.itemId, e.target.value)}
                          >
                            <option value="US">US</option>
                            <option value="HK">HK</option>
                          </select>
                        </div>
                        <div className="item-product-edit">{item.productName || item.product || ''}</div>
                        <div className="item-strength-edit">{item.productStrength || item.strength || ''}</div>
                        <input
                          type="number"
                          min="1"
                          value={item.quantity}
                          onChange={(e) => updateItemQuantity(order.id, item.itemId, e.target.value)}
                          onFocus={(e) => e.target.select()}
                          className="item-qty-input order-grid-input"
                        />
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={item.pricePerKit}
                          onChange={(e) => updateItemPrice(order.id, item.itemId, e.target.value)}
                          onFocus={(e) => e.target.select()}
                          className="item-price-input order-grid-input"
                        />
                        <div className="item-total order-grid-total">
                          ${(item.quantity * item.pricePerKit).toLocaleString('en-US', {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2
                          })}
                        </div>
                        <div className="item-delivered-edit">
                          <label className="item-status-toggle">
                            <input
                              type="checkbox"
                              checked={(item.status || 'pending') === 'delivered'}
                              onChange={(e) => {
                                const newStatus = e.target.checked ? 'delivered' : 'pending';
                                updateItemStatus(order.id, item.itemId, newStatus);
                              }}
                            />
                            <span>{(item.status || 'pending') === 'delivered' ? '✓' : ''}</span>
                          </label>
                        </div>
                        <button
                          onClick={() => removeItemFromOrder(order.id, item.itemId)}
                          className="item-remove-btn order-grid-remove"
                          title="Remove item"
                        >
                          ×
                        </button>
                      </div>
                    ) : (
                      <div key={`${item.itemId}-row`} className="order-item-grid-row">
                        <div className="item-warehouse-view">{itemWarehouse}</div>
                        <div className="item-product-view">{item.productName || item.product || ''}</div>
                        <div className="item-strength-view">{item.productStrength || item.strength || ''}</div>
                        <div className="item-qty-view">{item.quantity}</div>
                        <div className="item-unit-view">
                          ${item.pricePerKit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </div>
                        <div className="item-total-view">
                          ${(item.quantity * item.pricePerKit).toLocaleString('en-US', {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2
                          })}
                        </div>
                        <div className="item-delivered-view">
                          <label className="item-status-toggle">
                            <input
                              type="checkbox"
                              checked={(item.status || 'pending') === 'delivered'}
                              onChange={(e) => {
                                const newStatus = e.target.checked ? 'delivered' : 'pending';
                                updateItemStatus(order.id, item.itemId, newStatus);
                              }}
                            />
                            <span>{(item.status || 'pending') === 'delivered' ? '✓' : ''}</span>
                          </label>
                        </div>
                      </div>
                    )
                  ];
                })}

              {isEditing && (
                <div className="add-product-section">
                  {addingItemToOrder === order.id ? (
                    <div className="add-product-form">
                      <select
                        onChange={(e) => {
                          if (e.target.value) {
                            const productId = e.target.value;
                            const product = availableProducts.find((p) => p.id === productId);
                            if (!product) return;
                            const exists = order.items.some(
                              (item) => item.productName === product.product && item.productStrength === product.strength
                            );
                            if (exists) {
                              onError && onError('This product is already in the order.');
                              setAddingItemToOrder(null);
                              return;
                            }
                            addItemToOrder(order.id, productId);
                          }
                        }}
                        className="product-select"
                        defaultValue=""
                      >
                        <option value="">Select a product...</option>
                        {availableProducts
                          .filter((p) => (p.warehouseCosts?.[order.warehouse || 'US'] || 0) > 0)
                          .map((product) => (
                            <option key={product.id} value={product.id}>
                              {product.product} {product.strength} - ${product.warehouseCosts?.[order.warehouse || 'US'] || 0}
                            </option>
                          ))}
                      </select>
                      <button onClick={() => setAddingItemToOrder(null)} className="btn-cancel-add">
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button onClick={() => setAddingItemToOrder(order.id)} className="btn-add-product">
                      + Add Product
                    </button>
                  )}
                </div>
              )}
            </div>

            {isEditing && (
              <div className="discount-section">
                <span>Discount %</span>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={discount}
                  onChange={(e) => updateDiscount(order.id, parseFloat(e.target.value) || 0)}
                  className="discount-input"
                />
              </div>
            )}

            <div className="order-total">
              <span>Order Total</span>
              <div>
                <div className="total-amount">
                  ${finalTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
                {discount > 0 && <div className="discount-indicator">{discount}% discount applied</div>}
              </div>
            </div>
          </div>
        </div>
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

  return (
    <div className="submitted-orders-section">
      {!deliveredOnly && (
        <div className="orders-group">
          <h2 className="text-glow-fuchsia">Pending Orders</h2>
          <div className="orders-page-total">
            <span className="orders-summary-pill">Total: ${pendingTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          </div>
          {orders.length === 0 ? (
            <div className="empty-orders">No pending orders.</div>
          ) : (
            renderAllDatesView(
              groupOrdersByDate(orders),
              Object.keys(groupOrdersByDate(orders)).sort((a, b) => new Date(b) - new Date(a))
            )
          )}
        </div>
      )}

      {deliveredOnly && (
        <div className="orders-group delivered-section">
          <h2 className="text-glow-fuchsia">Delivered Orders</h2>
          <div className="orders-page-total">
            <span className="orders-summary-pill">Total: ${deliveredTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          </div>
          {deliveredOrders.length === 0 ? (
            <div className="empty-orders">No delivered orders.</div>
          ) : (
            renderOrderTabsView(
              groupOrdersByDate(deliveredOrders),
              Object.keys(groupOrdersByDate(deliveredOrders)).sort((a, b) => new Date(b) - new Date(a)),
              activeDeliveredDate,
              setActiveDeliveredDate
            )
          )}
        </div>
      )}
    </div>
  );
};

export default SubmittedOrders;
