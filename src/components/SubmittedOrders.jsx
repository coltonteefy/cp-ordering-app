  // Permanently delete an order from pending orders
  const deleteOrder = async (orderId) => {
    try {
      await deleteDoc(doc(db, 'c&pProductOrders', orderId));
      onSuccess && onSuccess('Order deleted.');
    } catch (error) {
      console.error('Error deleting order:', error);
      onError && onError('Failed to delete order.');
    }
  };
// Format product name for display (GLP-2 → T[mass], GLP-3 → R[mass])
function formatProductName(name) {
  if (!name) return '';
  const glp2 = name.match(/^GLP-2[^\d]*(\d+)/i);
  if (glp2) return `T${glp2[1]}`;
  const glp3 = name.match(/^GLP-3[^\d]*(\d+)/i);
  if (glp3) return `R${glp3[1]}`;
  return name;
}
import { useState, useEffect } from 'react';
import { collection, onSnapshot, doc, updateDoc, addDoc, deleteDoc } from 'firebase/firestore';
import { db } from '../firebaseConfig';
import './SubmittedOrders.css';

const SubmittedOrders = ({ onSuccess, onError }) => {
  const [orders, setOrders] = useState([]);
  const [deliveredOrders, setDeliveredOrders] = useState([]);
  const [editingOrders, setEditingOrders] = useState(new Set());
  const [originalOrders, setOriginalOrders] = useState({});
  const [hasShownError, setHasShownError] = useState(false);
  const [collapsedPendingDates, setCollapsedPendingDates] = useState(new Set());
  const [collapsedDeliveredDates, setCollapsedDeliveredDates] = useState(new Set());
  const [availableProducts, setAvailableProducts] = useState([]);
  const [addingItemToOrder, setAddingItemToOrder] = useState(null);

  useEffect(() => {
    // Listen to pending orders
    const unsubscribe = onSnapshot(
      collection(db, 'c&pProductOrders'),
      (snapshot) => {
        const ordersData = [];
        snapshot.forEach((doc) => {
          const data = doc.data();
          // Ensure all items have unique itemIds
          const itemsWithIds = data.items?.map(item => ({
            ...item,
            itemId: item.itemId || `${doc.id}-${item.itemName}-${Math.random().toString(36).substr(2, 9)}`
          })) || [];
          
          ordersData.push({
            id: doc.id,
            ...data,
            items: itemsWithIds
          });
        });
        
        // Sort by submission date (newest first)
        ordersData.sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));
        setOrders(ordersData);
        setHasShownError(false);
      },
      (error) => {
        console.error('Error listening to orders:', error);
        if (!hasShownError) {
          onError('Error loading orders: ' + error.message);
          setHasShownError(true);
        }
      }
    );

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (orders.length === 0) {
      setCollapsedPendingDates(new Set());
      return;
    }
    
    // Collapse all NEW pending order date groups by default (only add new dates, don't reset existing state)
    const grouped = {};
    orders.forEach(order => {
      const date = new Date(order.submittedAt);
      const dateKey = date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
      if (!grouped[dateKey]) {
        grouped[dateKey] = [];
      }
      grouped[dateKey].push(order);
    });
    
    const dateKeys = Object.keys(grouped);
    
    setCollapsedPendingDates(prevCollapsed => {
      const newCollapsed = new Set(prevCollapsed);
      let changed = false;
      
      dateKeys.forEach(dateKey => {
        // Only add if it doesn't exist yet (new date)
        if (!prevCollapsed.has(dateKey)) {
          newCollapsed.add(dateKey);
          changed = true;
        }
      });
      
      // Only return new set if something actually changed
      return changed ? newCollapsed : prevCollapsed;
    });
  }, [orders.length]);

  useEffect(() => {
    // Listen to delivered orders
    const unsubscribe = onSnapshot(
      collection(db, 'c&pPastInventoryOrders'),
      (snapshot) => {
        const ordersData = [];
        snapshot.forEach((doc) => {
          ordersData.push({
            id: doc.id,
            ...doc.data()
          });
        });
        
        // Sort by delivery date (newest first)
        ordersData.sort((a, b) => new Date(b.deliveredAt) - new Date(a.deliveredAt));
        setDeliveredOrders(ordersData);
      },
      (error) => {
        console.error('Error listening to delivered orders:', error);
      }
    );

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    // Listen to available products
    const unsubscribe = onSnapshot(
      collection(db, 'c&pCostPerKit'),
      (snapshot) => {
        const productsData = [];
        snapshot.forEach((doc) => {
          productsData.push({
            id: doc.id,
            ...doc.data()
          });
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

  const toggleEdit = async (orderId) => {
    const newEditing = new Set(editingOrders);
    if (newEditing.has(orderId)) {
      // Save changes before exiting edit mode
      await saveOrderChanges(orderId);
      newEditing.delete(orderId);
      // Clear original order state when done editing
      setOriginalOrders(prev => {
        const updated = { ...prev };
        delete updated[orderId];
        return updated;
      });
    } else {
      newEditing.add(orderId);
      // Save original order state before editing
      const order = orders.find(o => o.id === orderId);
      if (order) {
        setOriginalOrders(prev => ({
          ...prev,
          [orderId]: JSON.parse(JSON.stringify(order))
        }));
      }
      // Set default carrier to UPS if not already set
      if (order && !order.carrier) {
        updateCarrier(orderId, 'UPS');
      }
    }
    setEditingOrders(newEditing);
  };

  const cancelEdit = (orderId) => {
    const original = originalOrders[orderId];
    if (original) {
      // Restore original order state locally
      setOrders(prevOrders => 
        prevOrders.map(order => 
          order.id === orderId ? { ...original } : order
        )
      );
    }
    // Exit edit mode
    const newEditing = new Set(editingOrders);
    newEditing.delete(orderId);
    setEditingOrders(newEditing);
    // Clear original order state
    setOriginalOrders(prev => {
      const updated = { ...prev };
      delete updated[orderId];
      return updated;
    });
    // Clear adding item state if active
    if (addingItemToOrder === orderId) {
      setAddingItemToOrder(null);
    }
  };

  const toggleDateCollapse = (dateKey) => {
    setCollapsedPendingDates(prevCollapsed => {
      const newCollapsed = new Set(prevCollapsed);
      if (newCollapsed.has(dateKey)) {
        newCollapsed.delete(dateKey);
      } else {
        newCollapsed.add(dateKey);
      }
      return newCollapsed;
    });
  };

  const toggleDeliveredDateCollapse = (dateKey) => {
    setCollapsedDeliveredDates(prevCollapsed => {
      const newCollapsed = new Set(prevCollapsed);
      if (newCollapsed.has(dateKey)) {
        newCollapsed.delete(dateKey);
      } else {
        newCollapsed.add(dateKey);
      }
      return newCollapsed;
    });
  };

  const updateOrderItems = async (orderId, items) => {
    try {
      const total = items.reduce((sum, item) => sum + (item.quantity * item.pricePerKit), 0);
      await updateDoc(doc(db, 'c&pProductOrders', orderId), {
        items: items,
        total: total
      });
    } catch (error) {
      console.error('Error updating order:', error);
      onError('Failed to update order: ' + error.message);
    }
  };

  const updateOrderDate = (orderId, newDate) => {
    setOrders(orders.map(order => 
      order.id === orderId 
        ? { ...order, submittedAt: new Date(newDate).toISOString() }
        : order
    ));
  };

  const removeItemFromOrder = async (orderId, itemId) => {
    const order = orders.find(o => o.id === orderId);
    if (!order) return;
    
    const updatedItems = order.items.filter(item => item.itemId !== itemId);
    
    if (updatedItems.length === 0) {
      // If no items left, delete the order
      await markOrderDelivered(orderId);
    } else {
      await updateOrderItems(orderId, updatedItems);
    }
  };

  const markOrderDelivered = async (orderId) => {
    try {
      const order = orders.find(o => o.id === orderId);
      if (!order) {
        console.error('Order not found:', orderId);
        return;
      }

      const deliveredOrderData = {
        ...order,
        deliveredAt: new Date().toISOString(),
        originalOrderId: orderId
      };
      delete deliveredOrderData.id;
      
      await addDoc(collection(db, 'c&pPastInventoryOrders'), deliveredOrderData);
      await deleteDoc(doc(db, 'c&pProductOrders', orderId));
      
      // Remove from editing set
      const newEditing = new Set(editingOrders);
      newEditing.delete(orderId);
      setEditingOrders(newEditing);
    } catch (error) {
      console.error('Error marking order as delivered:', error);
      onError('Failed to mark order as delivered. Please try again.', 'Error');
    }
  };

  const updateCarrier = async (orderId, carrier) => {
    try {
      await updateDoc(doc(db, 'c&pProductOrders', orderId), { carrier });
    } catch (error) {
      console.error('Error updating carrier:', error);
    }
  };

  const updateTrackingNumber = async (orderId, trackingNumber) => {
    try {
      await updateDoc(doc(db, 'c&pProductOrders', orderId), { trackingNumber });
    } catch (error) {
      console.error('Error updating tracking number:', error);
    }
  };

  const updateDiscount = async (orderId, discountPercent) => {
    try {
      await updateDoc(doc(db, 'c&pProductOrders', orderId), { discountPercent });
    } catch (error) {
      console.error('Error updating discount:', error);
    }
  };

  const updateItemQuantity = (orderId, itemId, newQuantity) => {
    setOrders(prevOrders => {
      const updated = prevOrders.map(order => {
        if (order.id === orderId) {
          const updatedItems = order.items.map(item =>
            item.itemId === itemId
              ? { ...item, quantity: Math.max(1, parseInt(newQuantity) || 1) }
              : item
          );
          const newTotal = updatedItems.reduce((sum, item) => sum + (item.quantity * item.pricePerKit), 0);
          // Persist to Firestore
          updateOrderItems(orderId, updatedItems);
          return { ...order, items: updatedItems, total: newTotal };
        }
        return order;
      });
      return updated;
    });
  };

  const updateItemPrice = (orderId, itemId, newPrice) => {
    setOrders(prevOrders => {
      const updated = prevOrders.map(order => {
        if (order.id === orderId) {
          const updatedItems = order.items.map(item =>
            item.itemId === itemId
              ? { ...item, pricePerKit: Math.max(0, parseFloat(newPrice) || 0) }
              : item
          );
          const newTotal = updatedItems.reduce((sum, item) => sum + (item.quantity * item.pricePerKit), 0);
          // Persist to Firestore
          updateOrderItems(orderId, updatedItems);
          return { ...order, items: updatedItems, total: newTotal };
        }
        return order;
      });
      return updated;
    });
  };

  const saveOrderChanges = async (orderId) => {
    const order = orders.find(o => o.id === orderId);
    if (!order) return;

    try {
      await updateDoc(doc(db, 'c&pProductOrders', orderId), {
        items: order.items,
        total: order.total,
        submittedAt: order.submittedAt
      });
    } catch (error) {
      console.error('Error saving order changes:', error);
      onError('Failed to save changes: ' + error.message);
    }
  };

  const addItemToOrder = async (orderId, productId) => {
    const order = orders.find(o => o.id === orderId);
    const product = availableProducts.find(p => p.id === productId);
    if (!order || !product) return;

    // Prevent duplicate products (same productName and productStrength)
    const exists = order.items.some(
      item => item.productName === product.product && item.productStrength === product.strength
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
      pricePerKit: price
    };

    const updatedItems = [...order.items, newItem];
    await updateOrderItems(orderId, updatedItems);
    setAddingItemToOrder(null);
    onSuccess && onSuccess('Product added to order');
  };

  const getTrackingUrl = (carrier, trackingNumber) => {
    switch(carrier) {
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

  const groupOrdersByDate = (ordersList) => {
    const grouped = {};
    ordersList.forEach(order => {
      const date = new Date(order.submittedAt || order.deliveredAt);
      const dateKey = date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
      if (!grouped[dateKey]) {
        grouped[dateKey] = [];
      }
      grouped[dateKey].push(order);
    });
    return grouped;
  };

  const calculateTotalCost = (ordersList) => {
    return ordersList.reduce((sum, order) => {
      const rawTotal = order.total || 0;
      const discount = order.discountPercent || 0;
      const finalTotal = rawTotal - (rawTotal * (discount / 100));
      return sum + finalTotal;
    }, 0);
  };

  const renderOrder = (order) => {
    const isEditing = editingOrders.has(order.id);
    const rawTotal = order.total;
    const discount = order.discountPercent || 0;
    const finalTotal = rawTotal - (rawTotal * (discount / 100));

    return (
      <div key={order.id} className="order-card">
        {/* Warehouse Label */}
        {order.warehouse && (
          <div className={`warehouse-header warehouse-${order.warehouse.toLowerCase()}`}>
            {order.warehouse} WAREHOUSE
          </div>
        )}
        {/* Header */}
        <div className="order-header">
          <div className="order-info">
            <div className="order-title-row">
              <h3>Order #{order.id.slice(-6)}</h3>
              <button
                className="btn-delete-order"
                style={{ marginLeft: 'auto', background: '#fff0f0', color: '#c00', border: '1px solid #c00', borderRadius: '4px', padding: '4px 10px', cursor: 'pointer', fontWeight: 600 }}
                title="Delete this order"
                onClick={() => {
                  if (window.confirm('Are you sure you want to permanently delete this order?')) {
                    deleteOrder(order.id);
                  }
                }}
              >
                Delete
              </button>
            </div>
            {isEditing ? (
              <input
                type="datetime-local"
                value={new Date(order.submittedAt).toISOString().slice(0, 16)}
                onChange={(e) => updateOrderDate(order.id, e.target.value)}
                className="date-input"
              />
            ) : (
              <p className="order-date">
                {new Date(order.submittedAt).toLocaleString()}
              </p>
            )}

            {/* Tracking Info */}
            {isEditing ? (
              <div className="tracking-inputs">
                      <select
                        value={order.carrier || 'UPS'}
                        onChange={(e) => updateCarrier(order.id, e.target.value)}
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
                        value={order.trackingNumber || ''}
                        onChange={(e) => {
                          const newValue = e.target.value;
                          // Update local state for immediate feedback
                          const updatedOrders = orders.map(o => 
                            o.id === order.id ? { ...o, trackingNumber: newValue } : o
                          );
                          setOrders(updatedOrders);
                          // Save to database
                          updateTrackingNumber(order.id, newValue);
                        }}
                        className="tracking-input"
                      />
                    </div>
                  ) : order.trackingNumber && order.carrier ? (
                    <a
                      href={getTrackingUrl(order.carrier, order.trackingNumber)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="tracking-display"
                    >
                      <span className="carrier-text">{order.carrier}</span>
                      <span className="tracking-text">{order.trackingNumber}</span>
                      <span className="tracking-link-icon">📦</span>
                    </a>
                  ) : (
                    <div className="tracking-display tracking-empty">
                      <span className="carrier-text">{order.carrier || 'UPS'}</span>
                      <span className="tracking-text">No tracking number</span>
                    </div>
                  )}
          </div>

          <div className="order-actions">
                  {isEditing ? (
                    <>
                      <button
                        onClick={() => toggleEdit(order.id)}
                        className="btn-neon-cyan"
                      >
                        Done
                      </button>
                      <button
                        onClick={() => cancelEdit(order.id)}
                        className="btn-cancel-edit"
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => toggleEdit(order.id)}
                        className="btn-edit"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => {
                          if (window.confirm('Mark this order as delivered?')) {
                            markOrderDelivered(order.id);
                          }
                        }}
                        className="btn-neon-lime"
                      >
                        Mark Delivered
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Items List */}
              <div className="order-items-grid">
                <div className="order-items-header">
                  <div>Product</div>
                  <div>Strength</div>
                  <div>Qty</div>
                  <div>Unit</div>
                  <div>Total</div>
                  {isEditing && <div></div>}
                </div>
                {[...order.items]
                  .slice()
                  .sort((a, b) => {
                    // Sort by productName, then by productStrength
                    const nameA = a.productName || '';
                    const nameB = b.productName || '';
                    if (nameA === nameB) {
                      return (a.productStrength || '').localeCompare(b.productStrength || '');
                    }
                    return nameA.localeCompare(nameB);
                  })
                  .map((item) => (
                    isEditing ? (
                      <div key={item.itemId} className="order-item-grid-row">
                        <div className="item-product-edit">{item.productName}</div>
                        <div className="item-strength-edit">{item.productStrength}</div>
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
                        <div className="item-total order-grid-total">${(item.quantity * item.pricePerKit).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
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
                        <div className="item-product-view">{item.productName}</div>
                        <div className="item-strength-view">{item.productStrength}</div>
                        <div className="item-qty-view">{item.quantity}</div>
                        <div className="item-unit-view">${item.pricePerKit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                        <div className="item-total-view">${(item.quantity * item.pricePerKit).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                      </div>
                    )
                  ))}

                
                {/* Add Product Button in Edit Mode */}
                {isEditing && (
                  <div className="add-product-section">
                    {addingItemToOrder === order.id ? (
                      <div className="add-product-form">
                        <select
                          onChange={(e) => {
                            if (e.target.value) {
                              // Prevent adding duplicate product/strength
                              const productId = e.target.value;
                              const product = availableProducts.find(p => p.id === productId);
                              if (!product) return;
                              const exists = order.items.some(
                                item => item.productName === product.product && item.productStrength === product.strength
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
                            .filter(p => (p.warehouseCosts?.[order.warehouse || 'US'] || 0) > 0)
                            .map(product => (
                              <option key={product.id} value={product.id}>
                                {product.product} {product.strength} - ${product.warehouseCosts?.[order.warehouse || 'US'] || 0}
                              </option>
                            ))
                          }
                        </select>
                        <button
                          onClick={() => setAddingItemToOrder(null)}
                          className="btn-cancel-add"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setAddingItemToOrder(order.id)}
                        className="btn-add-product"
                      >
                        + Add Product
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Discount (edit mode only) */}
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

              {/* Total */}
              <div className="order-total">
                <span>Order Total</span>
                <div>
                  <div className="total-amount">${finalTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                  {discount > 0 && (
                    <div className="discount-indicator">{discount}% discount applied</div>
                  )}
                </div>
              </div>
          </div>
        );
  };

  const renderGroupedOrders = (ordersList, collapsedSet, toggleFunc) => {
    const groupedOrders = groupOrdersByDate(ordersList);
    return Object.keys(groupedOrders).map(dateKey => {
      const isCollapsed = collapsedSet.has(dateKey);
      const groupTotal = calculateTotalCost(groupedOrders[dateKey]);
      return (
        <div key={dateKey} className="date-group">
          <div 
            className="date-header" 
            onClick={() => toggleFunc(dateKey)}
          >
            <span className={`collapse-indicator ${isCollapsed ? 'collapsed' : 'expanded'}`}>{isCollapsed ? '\u25b6' : '\u25bc'}</span>
            <h3>{dateKey}</h3>
            <span className="date-total">Total Cost: ${groupTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          </div>
          <div className={`orders-wrapper ${isCollapsed ? 'collapsed' : 'expanded'}`}>
            <div className="orders-container">
              {groupedOrders[dateKey].map(order => renderOrder(order))}
            </div>
          </div>
        </div>
      );
    });
  };

  return (
    <div className="submitted-orders-section">
      {/* Pending Orders */}
      <div className="orders-group">
        <h2 className="text-glow-fuchsia">Pending Orders</h2>
        {orders.length === 0 ? (
          <div className="empty-orders">No pending orders.</div>
        ) : (
          renderGroupedOrders(orders, collapsedPendingDates, toggleDateCollapse)
        )}
      </div>

      {/* Delivered Orders */}
      {deliveredOrders.length > 0 && (
        <div className="orders-group delivered-section">
          <h2 className="text-glow-fuchsia">Delivered Orders</h2>
          {renderGroupedOrders(deliveredOrders, collapsedDeliveredDates, toggleDeliveredDateCollapse)}
        </div>
      )}
    </div>
  );
};

export default SubmittedOrders;
