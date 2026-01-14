import { useState, useEffect } from 'react';
import { collection, addDoc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebaseConfig';
import productsData from '../data/products.json';
import './NextOrderList.css';

const formatPrice = (price) => {
  return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const NextOrderList = ({ onSuccess, onError }) => {
  const [orderItems, setOrderItems] = useState([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [products, setProducts] = useState(productsData);

  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, 'cpCostPerKit'),
      (snapshot) => {
        if (!snapshot.empty) {
          const firestoreProducts = [];
          snapshot.forEach((doc) => {
            firestoreProducts.push({
              id: doc.id,
              ...doc.data()
            });
          });
          setProducts(firestoreProducts);
        }
      },
      (error) => {
        console.error('Error loading products:', error);
      }
    );

    return () => unsubscribe();
  }, []);

  const handleProductClick = (product) => {
    const itemName = `${product.product} ${product.strength}`;
    const alreadyInOrder = orderItems.find(item => item.itemName === itemName);
    
    if (alreadyInOrder) {
      onError('This item is already in the order list.', 'Notice');
      return;
    }

    const newItem = {
      itemName: itemName,
      quantity: 1,
      pricePerKit: product.costPerKit || 0,
    };

    setOrderItems([...orderItems, newItem]);
  };

  const removeItem = (itemName) => {
    setOrderItems(orderItems.filter(item => item.itemName !== itemName));
  };

  const updateItem = (itemName, field, value) => {
    setOrderItems(orderItems.map(item => {
      if (item.itemName === itemName) {
        if (field === 'quantity') {
          return { ...item, quantity: Math.max(1, parseInt(value) || 1) };
        } else if (field === 'pricePerKit') {
          return { ...item, pricePerKit: Math.max(0, parseFloat(value) || 0) };
        }
      }
      return item;
    }));
  };

  const calculateTotal = () => {
    return orderItems.reduce((sum, item) => sum + (item.quantity * item.pricePerKit), 0);
  };

  const submitOrder = async () => {
    if (orderItems.length === 0) {
      onError('No items in order list to submit.');
      return;
    }

    setIsSubmitting(true);

    try {
      const orderData = {
        items: orderItems,
        total: calculateTotal(),
        submittedAt: new Date().toISOString(),
        status: 'pending',
      };

      await addDoc(collection(db, 'c&p product orders'), orderData);
      
      setOrderItems([]);
    } catch (error) {
      console.error('Error submitting order:', error);
      onError('Failed to submit order: ' + error.message, 'Error');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="next-order-section">
      <div className="section-header">
        <h2 className="text-glow-fuchsia">Next Order List</h2>
      </div>

      {/* Add Item Form */}
      <div className="add-item-form">
        <h3>Select Products</h3>
        <div className="product-pills">
          {products.map((product, index) => {
            const itemName = `${product.product} ${product.strength}`;
            const isInOrder = orderItems.find(item => item.itemName === itemName);
            return (
              <button
                key={product.id || index}
                onClick={() => handleProductClick(product)}
                className={`product-pill ${isInOrder ? 'in-order' : ''}`}
                disabled={isInOrder}
              >
                {product.product} - {product.strength}
              </button>
            );
          })}
        </div>
      </div>

      {/* Order List Table */}
      <div className="order-table-container">
        <table className="order-table">
          <thead>
            <tr>
              <th>Item Name</th>
              <th>Quantity</th>
              <th>Price per Kit</th>
              <th>Total Cost</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {orderItems.length === 0 ? (
              <tr>
                <td colSpan="5" className="empty-row">
                  No items in order list. Use the form above to add items.
                </td>
              </tr>
            ) : (
              orderItems.map(item => (
                <tr key={item.itemName}>
                  <td className="item-name">{item.itemName}</td>
                  <td>
                    <input
                      type="number"
                      min="1"
                      value={item.quantity}
                      onChange={(e) => updateItem(item.itemName, 'quantity', e.target.value)}
                      className="quantity-input"
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={item.pricePerKit}
                      onChange={(e) => updateItem(item.itemName, 'pricePerKit', e.target.value)}
                      className="price-input"
                    />
                  </td>
                  <td className="total-cost">${formatPrice(item.quantity * item.pricePerKit)}</td>
                  <td>
                    <button
                      onClick={() => removeItem(item.itemName)}
                      className="remove-btn"
                      title="Remove from order"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path>
                      </svg>
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Order Total */}
      <div className="order-total-card">
        <h3>Order Total</h3>
        <p className="total-amount">${formatPrice(calculateTotal())}</p>
      </div>

      {/* Submit Order Button */}
      <button
        onClick={submitOrder}
        className="btn-neon-lime submit-order-btn"
        disabled={orderItems.length === 0 || isSubmitting}
      >
        {isSubmitting ? 'Submitting...' : 'Submit Order'}
      </button>
    </div>
  );
};

export default NextOrderList;
