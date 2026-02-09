import { useEffect, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../firebaseConfig';
import './IncomingProducts.css';

// Format product name for display (GLP-2 → T[mass], GLP-3 → R[mass])
function formatProductName(name) {
  if (!name) return '';
  const glp2 = name.match(/^GLP-2[^\d]*(\d+)/i);
  if (glp2) return `T${glp2[1]}`;
  const glp3 = name.match(/^GLP-3[^\d]*(\d+)/i);
  if (glp3) return `R${glp3[1]}`;
  return name;
}

const IncomingProducts = ({ onError }) => {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [hasShownError, setHasShownError] = useState(false);

  // Listen to pending orders and group items that are NOT status: delivered
  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, 'c&pProductOrders'),
      (snapshot) => {
        const ordersData = [];
        let totalQty = 0;
        
        snapshot.forEach((snap) => {
          const order = snap.data();
          const items = order.items || [];
          
          const pendingItems = items.filter(item => item.status !== 'delivered');
          
          if (pendingItems.length > 0) {
            const orderQty = pendingItems.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
            totalQty += orderQty;
            
            ordersData.push({
              id: snap.id,
              submittedAt: order.submittedAt,
              items: pendingItems,
              totalQty: orderQty
            });
          }
        });

        // Sort by submitted date (newest first)
        ordersData.sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));

        setOrders(ordersData);
        setLoading(false);
        setHasShownError(false);
      },
      (error) => {
        console.error('Error listening to incoming products:', error);
        if (!hasShownError) {
          onError && onError('Error loading incoming products: ' + error.message);
          setHasShownError(true);
        }
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [hasShownError, onError]);

  // Calculate totals
  const totalQty = orders.reduce((sum, order) => sum + order.totalQty, 0);

  if (loading) {
    return (
      <div className="incoming-products-container">
        <div className="loading">Loading incoming products...</div>
      </div>
    );
  }

  return (
    <div className="incoming-products-container">
      <div className="incoming-products-header">
        <h1>Incoming Products</h1>
        <p className="incoming-subtitle">Products not yet marked as delivered, grouped by order</p>
      </div>

      <div className="incoming-summary">
        <div className="summary-card">
          <div className="summary-label">Total Awaiting</div>
          <div className="summary-value">{totalQty}</div>
        </div>
        <div className="summary-card">
          <div className="summary-label">Orders</div>
          <div className="summary-value">{orders.length}</div>
        </div>
      </div>

      {orders.length === 0 ? (
        <div className="no-products">
          <p>No products awaiting delivery.</p>
        </div>
      ) : (
        <div className="orders-list">
          {orders.map((order) => (
            <div key={order.id} className="order-group">
              <div className="order-header">
                <div className="order-date">
                  {new Date(order.submittedAt).toLocaleDateString('en-US', { 
                    year: 'numeric', 
                    month: 'long', 
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                  })}
                </div>
                <div className="order-qty-badge">{order.totalQty} items</div>
              </div>
              
              <table className="order-items-table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Strength</th>
                    <th className="qty-column">Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {order.items.map((item, idx) => (
                    <tr key={idx}>
                      <td className="product-name">
                        <span className="formatted-name">{formatProductName(item.productName || item.product)}</span>
                        <span className="full-name">{item.productName || item.product}</span>
                      </td>
                      <td className="strength">{item.productStrength || item.strength}</td>
                      <td className="qty-column">{item.quantity}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default IncomingProducts;
