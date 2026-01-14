import { useState, useEffect } from 'react';
import { collection, onSnapshot, doc, updateDoc, addDoc, deleteDoc } from 'firebase/firestore';
import { db } from '../firebaseConfig';
import './SubmittedOrders.css';

const SubmittedOrders = ({ onSuccess, onError }) => {
  const [orders, setOrders] = useState([]);
  const [editingOrders, setEditingOrders] = useState(new Set());
  const [hasShownError, setHasShownError] = useState(false);

  useEffect(() => {
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
        setHasShownError(false); // Reset error flag on success
      },
      (error) => {
        console.error('Error listening to orders:', error);
        // Only show error once to avoid blocking the UI
        if (!hasShownError) {
          onError('Error loading orders: ' + error.message);
          setHasShownError(true);
        }
      }
    );

    return () => unsubscribe();
  }, []); // Remove onError from dependencies to prevent re-triggering

  const toggleEdit = (orderId) => {
    const newEditing = new Set(editingOrders);
    if (newEditing.has(orderId)) {
      newEditing.delete(orderId);
    } else {
      newEditing.add(orderId);
    }
    setEditingOrders(newEditing);
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

      const pastOrderData = {
        ...order,
        deliveredAt: new Date().toISOString(),
        originalOrderId: orderId
      };
      delete pastOrderData.id;
      
      await addDoc(collection(db, 'pastInventoryOrders'), pastOrderData);
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

  if (orders.length === 0) {
    return (
      <div className="submitted-orders-section">
        <h2 className="text-glow-fuchsia">Submitted Orders</h2>
        <div className="empty-orders">
          No submitted orders yet.
        </div>
      </div>
    );
  }

  return (
    <div className="submitted-orders-section">
      <h2 className="text-glow-fuchsia">Submitted Orders</h2>
      <div className="orders-container">
        {orders.map(order => {
          const isEditing = editingOrders.has(order.id);
          const rawTotal = order.total;
          const discount = order.discountPercent || 0;
          const finalTotal = rawTotal - (rawTotal * (discount / 100));

          return (
            <div key={order.id} className="order-card">
              {/* Header */}
              <div className="order-header">
                <div className="order-info">
                  <h3>Order #{order.id.slice(-6)}</h3>
                  <p className="order-date">
                    {new Date(order.submittedAt).toLocaleString()}
                  </p>

                  {/* Tracking Info */}
                  {isEditing ? (
                    <div className="tracking-inputs">
                      <select
                        value={order.carrier || ''}
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
                        onBlur={(e) => updateTrackingNumber(order.id, e.target.value)}
                        onChange={(e) => {
                          // Update local state for immediate feedback
                          const updatedOrders = orders.map(o => 
                            o.id === order.id ? { ...o, trackingNumber: e.target.value } : o
                          );
                          setOrders(updatedOrders);
                        }}
                        className="tracking-input"
                      />
                    </div>
                  ) : order.trackingNumber && order.carrier ? (
                    <a
                      href={getTrackingUrl(order.carrier, order.trackingNumber)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="tracking-link"
                    >
                      📦 {order.carrier}: {order.trackingNumber}
                    </a>
                  ) : null}
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
        })}
      </div>
    </div>
  );
};

export default SubmittedOrders;
