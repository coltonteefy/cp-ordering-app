import { useState, useEffect } from 'react';
import { collection, onSnapshot, doc, updateDoc, addDoc, deleteDoc } from 'firebase/firestore';
import { db } from '../firebaseConfig';
import './SubmittedOrders.css';

const SubmittedOrders = ({ onSuccess, onError }) => {
  const [orders, setOrders] = useState([]);
  const [deliveredOrders, setDeliveredOrders] = useState([]);
  const [editingOrders, setEditingOrders] = useState(new Set());
  const [hasShownError, setHasShownError] = useState(false);
  const [collapsedDates, setCollapsedDates] = useState(new Set());

  useEffect(() => {
    // Listen to pending orders
    const unsubscribe = onSnapshot(
      collection(db, 'c&pProductOrders'),
      (snapshot) => {
        const ordersData = [];
        snapshot.forEach((doc) => {
          ordersData.push({
            id: doc.id,
            ...doc.data()
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
    // Collapse all pending order date groups by default
    const groupedOrders = groupOrdersByDate(orders);
    const newCollapsed = new Set();
    Object.keys(groupedOrders).forEach(dateKey => {
      newCollapsed.add(dateKey);
    });
    setCollapsedDates(newCollapsed);
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

  const toggleEdit = (orderId) => {
    const newEditing = new Set(editingOrders);
    if (newEditing.has(orderId)) {
      newEditing.delete(orderId);
    } else {
      newEditing.add(orderId);
      // Set default carrier to UPS if not already set
      const order = orders.find(o => o.id === orderId);
      if (order && !order.carrier) {
        updateCarrier(orderId, 'UPS');
      }
    }
    setEditingOrders(newEditing);
  };

  const toggleDateCollapse = (dateKey) => {
    const newCollapsed = new Set(collapsedDates);
    if (newCollapsed.has(dateKey)) {
      newCollapsed.delete(dateKey);
    } else {
      newCollapsed.add(dateKey);
    }
    setCollapsedDates(newCollapsed);
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

  const updateItemQuantity = async (orderId, itemId, newQuantity) => {
    const order = orders.find(o => o.id === orderId);
    if (!order) return;

    const updatedItems = order.items.map(item => {
      if (item.itemId === itemId) {
        return { ...item, quantity: Math.max(1, parseInt(newQuantity) || 1) };
      }
      return item;
    });

    await updateOrderItems(orderId, updatedItems);
  };

  const updateItemPrice = async (orderId, itemId, newPrice) => {
    const order = orders.find(o => o.id === orderId);
    if (!order) return;

    const updatedItems = order.items.map(item => {
      if (item.itemId === itemId) {
        return { ...item, pricePerKit: Math.max(0, parseFloat(newPrice) || 0) };
      }
      return item;
    });

    await updateOrderItems(orderId, updatedItems);
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
        {/* Header */}
        <div className="order-header">
          <div className="order-info">
            <div className="order-title-row">
              <h3>Order #{order.id.slice(-6)}</h3>
              {order.warehouse && (
                <span className="warehouse-label">{order.warehouse} Warehouse</span>
              )}
            </div>
            <p className="order-date">
              {new Date(order.submittedAt).toLocaleString()}
            </p>

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
                  <button
                    onClick={() => toggleEdit(order.id)}
                    className={isEditing ? 'btn-neon-cyan' : 'btn-edit'}
                  >
                    {isEditing ? 'Done' : 'Edit'}
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
                </div>
              </div>

              {/* Items List */}
              <div className="order-items">
                {order.items.map((item) => (
                  <div key={item.itemId} className="order-item">
                    {isEditing ? (
                      <>
                        <div className="item-name-edit">{item.itemName}</div>
                        <input
                          type="number"
                          min="1"
                          value={item.quantity}
                          onChange={(e) => updateItemQuantity(order.id, item.itemId, e.target.value)}
                          className="item-qty-input"
                        />
                        <span>×</span>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={item.pricePerKit}
                          onChange={(e) => updateItemPrice(order.id, item.itemId, e.target.value)}
                          className="item-price-input"
                        />
                        <div className="item-total">${(item.quantity * item.pricePerKit).toFixed(2)}</div>
                        <button
                          onClick={() => removeItemFromOrder(order.id, item.itemId)}
                          className="item-remove-btn"
                          title="Remove item"
                        >
                          ×
                        </button>
                      </>
                    ) : (
                      <>
                        <div className="item-details">
                          <span className="item-name">{item.itemName}</span>
                          <span> × {item.quantity} @ ${item.pricePerKit.toFixed(2)}</span>
                        </div>
                        <div className="item-total">${(item.quantity * item.pricePerKit).toFixed(2)}</div>
                      </>
                    )}
                  </div>
                ))}
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
                  <div className="total-amount">${finalTotal.toFixed(2)}</div>
                  {discount > 0 && (
                    <div className="discount-indicator">{discount}% discount applied</div>
                  )}
                </div>
              </div>
          </div>
        );
  };

  const renderGroupedOrders = (ordersList) => {
    const groupedOrders = groupOrdersByDate(ordersList);
    return Object.keys(groupedOrders).map(dateKey => {
      const isCollapsed = collapsedDates.has(dateKey);
      const groupTotal = calculateTotalCost(groupedOrders[dateKey]);
      return (
        <div key={dateKey} className="date-group">
          <div 
            className="date-header" 
            onClick={() => toggleDateCollapse(dateKey)}
          >
            <span className="collapse-indicator">{isCollapsed ? '\u25b6' : '\u25bc'}</span>
            <h3>{dateKey}</h3>
            <span className="date-total">Total Cost: ${groupTotal.toFixed(2)}</span>
          </div>
          {!isCollapsed && (
            <div className="orders-container">
              {groupedOrders[dateKey].map(order => renderOrder(order))}
            </div>
          )}
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
          renderGroupedOrders(orders)
        )}
      </div>

      {/* Delivered Orders */}
      {deliveredOrders.length > 0 && (
        <div className="orders-group delivered-section">
          <h2 className="text-glow-fuchsia">Delivered Orders</h2>
          {renderGroupedOrders(deliveredOrders)}
        </div>
      )}
    </div>
  );
};

export default SubmittedOrders;
