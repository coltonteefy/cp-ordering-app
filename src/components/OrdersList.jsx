import { useEffect, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../firebaseConfig';
import './SubmittedOrders.css';

const OrdersList = ({ onError }) => {
  const [pendingOrders, setPendingOrders] = useState([]);
  const [deliveredOrders, setDeliveredOrders] = useState([]);

  useEffect(() => {
    const unsubPending = onSnapshot(
      collection(db, 'c&pProductOrders'),
      (snapshot) => {
        const ordersData = [];
        snapshot.forEach((snap) => {
          ordersData.push({ id: snap.id, ...snap.data() });
        });
        ordersData.sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));
        const pendingOnly = ordersData.filter((o) => {
          const status = (o.status || 'pending').toString().toLowerCase();
          const deliveredFlag = status === 'delivered' || !!o.deliveredAt;
          return !deliveredFlag;
        });
        setPendingOrders(pendingOnly);
      },
      (error) => {
        console.error('Error listening to pending orders:', error);
        onError && onError('Error loading pending orders: ' + error.message);
      }
    );

    return () => unsubPending();
  }, [onError]);

  useEffect(() => {
    const unsubDelivered = onSnapshot(
      collection(db, 'c&pPastInventoryOrders'),
      (snapshot) => {
        const ordersData = [];
        snapshot.forEach((snap) => {
          ordersData.push({ id: snap.id, ...snap.data() });
        });
        ordersData.sort((a, b) => new Date(b.deliveredAt) - new Date(a.deliveredAt));
        setDeliveredOrders(ordersData);
      },
      (error) => {
        console.error('Error listening to delivered orders:', error);
        onError && onError('Error loading delivered orders: ' + error.message);
      }
    );

    return () => unsubDelivered();
  }, [onError]);

  const formatSummaryDate = (value) => {
    if (!value) return 'Unknown date';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Unknown date';
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  };

  const calculateFinalTotal = (order) => {
    const itemsTotal = (order.items || []).reduce(
      (sum, item) => sum + (item.quantity || 0) * (item.pricePerKit || 0),
      0
    );
    const baseTotal = typeof order.total === 'number' ? order.total : itemsTotal;
    const discount = order.discountPercent || 0;
    return baseTotal - baseTotal * (discount / 100);
  };

  const pendingSummary = [...pendingOrders].sort(
    (a, b) => new Date(b.submittedAt) - new Date(a.submittedAt)
  );
  const deliveredSummary = [...deliveredOrders].sort(
    (a, b) => new Date(b.deliveredAt) - new Date(a.deliveredAt)
  );
  const pendingTotal = pendingSummary.reduce((sum, order) => sum + calculateFinalTotal(order), 0);
  const deliveredTotal = deliveredSummary.reduce((sum, order) => sum + calculateFinalTotal(order), 0);
  const grandTotal = pendingTotal + deliveredTotal;

  return (
    <div className="submitted-orders-section">
      <div className="orders-summary">
        <div className="orders-summary-header">
          <div>
            <h2 className="text-glow-fuchsia">Orders List</h2>
            <p>All delivered and pending orders</p>
          </div>
          <div className="orders-summary-counts">
            <span className="orders-summary-pill">Pending: {pendingSummary.length}</span>
            <span className="orders-summary-pill">Delivered: {deliveredSummary.length}</span>
            <span className="orders-summary-pill">
              Total: ${grandTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>
        </div>

        <div className="orders-summary-columns">
          <div className="orders-summary-column">
            <h3>Pending Orders</h3>
            <div className="orders-summary-subtotal">
              Total: ${pendingTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            {pendingSummary.length === 0 ? (
              <div className="empty-orders">No pending orders.</div>
            ) : (
              <ul className="orders-summary-list">
                {pendingSummary.map((order) => (
                  <li key={order.id} className="orders-summary-item">
                    <div className="orders-summary-main">
                      <span className="orders-summary-id">{order.id}</span>
                      {order.warehouse && (
                        <span className="orders-summary-warehouse">{order.warehouse} WAREHOUSE</span>
                      )}
                    </div>
                    <div className="orders-summary-meta">
                      <span>Submitted: {formatSummaryDate(order.submittedAt)}</span>
                      <span>{(order.items || []).length} items</span>
                      <span className="orders-summary-total">
                        ${calculateFinalTotal(order).toLocaleString('en-US', {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2
                        })}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="orders-summary-column">
            <h3>Delivered Orders</h3>
            <div className="orders-summary-subtotal">
              Total: ${deliveredTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            {deliveredSummary.length === 0 ? (
              <div className="empty-orders">No delivered orders.</div>
            ) : (
              <ul className="orders-summary-list">
                {deliveredSummary.map((order) => (
                  <li key={order.id} className="orders-summary-item">
                    <div className="orders-summary-main">
                      <span className="orders-summary-id">{order.id}</span>
                      {order.warehouse && (
                        <span className="orders-summary-warehouse">{order.warehouse} WAREHOUSE</span>
                      )}
                    </div>
                    <div className="orders-summary-meta">
                      <span>Delivered: {formatSummaryDate(order.deliveredAt)}</span>
                      <span>{(order.items || []).length} items</span>
                      <span className="orders-summary-total">
                        ${calculateFinalTotal(order).toLocaleString('en-US', {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2
                        })}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default OrdersList;
