import { useEffect, useRef, useState } from 'react';
import { collection, onSnapshot, doc, updateDoc, deleteDoc, setDoc, getDocs } from 'firebase/firestore';
import { db } from '../firebaseConfig';
import './SubmittedOrders.css';

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
  const [activePendingDate, setActivePendingDate] = useState(null);
  const [activeDeliveredDate, setActiveDeliveredDate] = useState(null);
  const [activePendingOrderId, setActivePendingOrderId] = useState(null); // kept for compatibility
  const [activeDeliveredOrderId, setActiveDeliveredOrderId] = useState(null); // kept for compatibility
  const [availableProducts, setAvailableProducts] = useState([]);
  const [addingItemToOrder, setAddingItemToOrder] = useState(null);
  const syncedIncomingOnce = useRef(false);

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
            status: data.status || 'pending'
          });
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

  // Maintain active pending date/order without jumping away on every change
  useEffect(() => {
    if (!orders.length) {
      setActivePendingDate(null);
      setActivePendingOrderId(null);
      return;
    }
    const grouped = groupOrdersByDate(orders);
    const dateKeys = Object.keys(grouped).sort((a, b) => new Date(b) - new Date(a));
    const fallbackDate = dateKeys[0] || null;

    // If current active date is missing, fall back to latest
    if (!activePendingDate || !grouped[activePendingDate]) {
      const firstOrder = fallbackDate ? grouped[fallbackDate]?.[0]?.id || null : null;
      setActivePendingDate(fallbackDate);
      setActivePendingOrderId(firstOrder);
      return;
    }

    // Ensure active order id exists for the active date
    const currentDateOrders = grouped[activePendingDate] || [];
    const stillExists = currentDateOrders.some((o) => o.id === activePendingOrderId);
    if (!stillExists) {
      setActivePendingOrderId(currentDateOrders[0]?.id || null);
    }
  }, [orders, activePendingDate, activePendingOrderId]);

  // Listen to delivered orders
  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, 'c&pPastInventoryOrders'),
      (snapshot) => {
        const ordersData = [];
        snapshot.forEach((snap) => {
          ordersData.push({ id: snap.id, ...snap.data() });
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
      const aggregates = {};
      pendingOrders.forEach((order) => {
        (order.items || []).forEach((item) => {
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

      // Upsert current aggregates
      await Promise.all(
        Object.entries(aggregates).map(([key, data]) =>
          setDoc(
            doc(db, 'c&pIncomingProductRecieved', key),
            { name: data.name, strength: data.strength, qty: data.qty },
            { merge: true }
          )
        )
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

  const updateTrackingStatus = async (orderId, entryIdx, status) => {
    setOrders((prev) =>
      prev.map((o) => {
        if (o.id !== orderId) return o;
        const entries =
          o.trackingEntries && Array.isArray(o.trackingEntries) && o.trackingEntries.length
            ? [...o.trackingEntries]
            : o.trackingNumber && o.carrier
              ? [{ id: 'legacy', carrier: o.carrier, number: o.trackingNumber, note: '', status: o.status || 'pending' }]
              : [];
        if (!entries[entryIdx]) return o;
        entries[entryIdx] = { ...entries[entryIdx], status };
        return { ...o, trackingEntries: entries };
      })
    );

    try {
      const order = orders.find((o) => o.id === orderId);
      const entries =
        order?.trackingEntries && Array.isArray(order.trackingEntries) && order.trackingEntries.length
          ? [...order.trackingEntries]
          : order?.trackingNumber && order?.carrier
            ? [{ id: 'legacy', carrier: order.carrier, number: order.trackingNumber, note: '', status: order.status || 'pending' }]
            : [];
      if (!entries[entryIdx]) return;
      entries[entryIdx] = { ...entries[entryIdx], status };
      await updateDoc(doc(db, 'c&pProductOrders', orderId), { trackingEntries: entries });
    } catch (error) {
      console.error('Error updating tracking status:', error);
    }
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

    const copied = copiedOrderId === order.id;
    const copiedWithPrice = copiedOrderId === order.id && copiedOrderType === 'price';
    const copiedNoPrice = copiedOrderId === order.id && copiedOrderType === 'no-price';
    
    const getFormattedItems = (includePrice = true) => {
      const warehouse = order.warehouse ? `${order.warehouse} WAREHOUSE` : '';
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

    return (
      <div key={order.id} className="order-card">
        {order.warehouse && (
          <div className={`warehouse-header warehouse-${order.warehouse.toLowerCase()}`}>
            <div className="warehouse-meta">
              <span className="warehouse-name">{order.warehouse} WAREHOUSE</span>
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
        )}

        <div className="order-body-split">
          <div className="order-col-left">
            {isEditing ? (
              <div className="tracking-multi">
                {(trackingEntries.length
                  ? trackingEntries
                  : [{ id: Date.now().toString(), carrier: order.carrier || 'UPS', number: order.trackingNumber || '', note: '' }]
                ).map((entry, idx) => (
                  <div className="tracking-row" key={entry.id || idx}>
                    <div className="tracking-row-main">
                      <select
                        value={entry.carrier || 'UPS'}
                        onChange={(e) => {
                          const updated = trackingEntries.length ? [...trackingEntries] : [];
                          if (!updated.length) updated.push({ ...entry });
                          updated[idx] = { ...updated[idx], carrier: e.target.value };
                          setOrders((prev) =>
                            prev.map((o) => (o.id === order.id ? { ...o, trackingEntries: updated } : o))
                          );
                        }}
                        className="carrier-select"
                      >
                        <option value="">Select Carrier</option>
                        <option value="USPS">USPS</option>
                        <option value="UPS">UPS</option>
                        <option value="FedEx">FedEx</option>
                        <option value="DHL">DHL</option>
                      </select>
                      <input
                        type="text"
                        placeholder="Tracking Number"
                        value={entry.number || ''}
                        onChange={(e) => {
                          const updated = trackingEntries.length ? [...trackingEntries] : [];
                          if (!updated.length) updated.push({ ...entry });
                          updated[idx] = { ...updated[idx], number: e.target.value };
                          setOrders((prev) =>
                            prev.map((o) => (o.id === order.id ? { ...o, trackingEntries: updated } : o))
                          );
                        }}
                        className="tracking-input"
                      />
                      {trackingEntries.length > 1 && (
                        <button
                          className="tracking-remove"
                          onClick={() => {
                            const updated = trackingEntries.filter((_, i) => i !== idx);
                            setOrders((prev) =>
                              prev.map((o) => (o.id === order.id ? { ...o, trackingEntries: updated } : o))
                            );
                          }}
                          title="Remove tracking"
                        >
                          ×
                        </button>
                      )}
                    </div>
                    <label className="tracking-status-toggle">
                      <input
                        type="checkbox"
                        checked={(entry.status || 'pending') === 'delivered'}
                        onChange={(e) => {
                          const updated = trackingEntries.length ? [...trackingEntries] : [];
                          if (!updated.length) updated.push({ ...entry });
                          updated[idx] = { ...updated[idx], status: e.target.checked ? 'delivered' : 'pending' };
                          setOrders((prev) =>
                            prev.map((o) => (o.id === order.id ? { ...o, trackingEntries: updated } : o))
                          );
                        }}
                      />
                      <span>{(entry.status || 'pending') === 'delivered' ? 'Delivered' : 'Pending'}</span>
                    </label>
                    <textarea
                      className="tracking-note"
                      rows="2"
                      placeholder="Tracking notes (optional)"
                      value={entry.note || ''}
                      onChange={(e) => {
                        const updated = trackingEntries.length ? [...trackingEntries] : [];
                        if (!updated.length) updated.push({ ...entry });
                        updated[idx] = { ...updated[idx], note: e.target.value };
                        setOrders((prev) =>
                          prev.map((o) => (o.id === order.id ? { ...o, trackingEntries: updated } : o))
                        );
                      }}
                    />
                  </div>
                ))}
                <button
                  className="tracking-add"
                  onClick={() => {
                    const updated = [
                      ...trackingEntries,
                      { id: Date.now().toString(), carrier: 'UPS', number: '', note: '', status: 'pending' }
                    ];
                    setOrders((prev) =>
                      prev.map((o) => (o.id === order.id ? { ...o, trackingEntries: updated } : o))
                    );
                  }}
                >
                  + Add Tracking
                </button>
              </div>
            ) : trackingEntries.length ? (
              <div className="tracking-display-grid">
                {trackingEntries.map((entry, idx) => (
                  <div key={entry.id || idx} className="tracking-card">
                    <div className="tracking-inline">
                      {entry.carrier && entry.number ? (
                        <a
                          href={getTrackingUrl(entry.carrier, entry.number)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={`tracking-display${(entry.status || 'pending') === 'delivered' ? ' delivered' : ''}`}
                        >
                          <span className="carrier-text">{entry.carrier}</span>
                          <span className="tracking-text">{entry.number}</span>
                        </a>
                      ) : (
                        <div
                          className={`tracking-display tracking-empty${(entry.status || 'pending') === 'delivered' ? ' delivered' : ''}`}
                        >
                          <span className="carrier-text">{entry.carrier || 'UPS'}</span>
                          <span className="tracking-text">No tracking number</span>
                        </div>
                      )}
                      <label className="tracking-status-toggle">
                        <input
                          type="checkbox"
                          checked={(entry.status || 'pending') === 'delivered'}
                          onChange={(e) => updateTrackingStatus(order.id, idx, e.target.checked ? 'delivered' : 'pending')}
                        />
                        <span>{(entry.status || 'pending') === 'delivered' ? 'Delivered' : 'Pending'}</span>
                      </label>
                    </div>
                    {entry.note ? <div className="tracking-note-display">{entry.note}</div> : null}
                  </div>
                ))}
              </div>
            ) : (
              <div className="tracking-display tracking-empty">
                <span className="carrier-text">{order.carrier || 'UPS'}</span>
                <span className="tracking-text">No tracking number</span>
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
                  const nameA = a.productName || '';
                  const nameB = b.productName || '';
                  if (nameA === nameB) {
                    return (a.productStrength || '').localeCompare(b.productStrength || '');
                  }
                  return nameA.localeCompare(nameB);
                })
                .map((item) =>
                  isEditing ? (
                    <div key={item.itemId} className="order-item-grid-row">
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
                    <div key={item.itemId} className="order-item-grid-row">
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
                )}

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
    const dateTotal = ordersForDate.reduce((sum, ord) => sum + calculateFinalTotal(ord), 0);
    const dateCount = ordersForDate.length;

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
            <div className="orders-total-banner">
              <div className="orders-total-banner-label">Total for {safeDate}</div>
              <div className="orders-total-banner-meta">
                <span className="orders-total-banner-count">
                  {dateCount} order{dateCount === 1 ? '' : 's'}
                </span>
                <span className="orders-total-banner-value">
                  ${dateTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
            </div>
            <div className="orders-wrapper expanded">
              <div className="orders-container">{ordersForDate.map((order) => renderOrder(order))}</div>
            </div>
          </div>
        )}
      </>
    );
  };

  return (
    <div className="submitted-orders-section">
      {!deliveredOnly && (
        <div className="orders-group">
          <h2 className="text-glow-fuchsia">Pending Orders</h2>
          {orders.length === 0 ? (
            <div className="empty-orders">No pending orders.</div>
          ) : (
            renderOrderTabsView(
              groupOrdersByDate(orders),
              Object.keys(groupOrdersByDate(orders)).sort((a, b) => new Date(b) - new Date(a)),
              activePendingDate,
              setActivePendingDate
            )
          )}
        </div>
      )}

      {deliveredOnly && (
        <div className="orders-group delivered-section">
          <h2 className="text-glow-fuchsia">Delivered Orders</h2>
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
