import { useState, useEffect } from 'react';
import { collection, addDoc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebaseConfig';
import productsData from '../data/products.json';
import './NextOrderList.css';

const formatPrice = (price) => {
  return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const NextOrderList = ({ onSuccess, onError }) => {
  const [orderItems, setOrderItems] = useState(() => {
    // Initialize from localStorage if available
    const savedOrder = localStorage.getItem('pendingOrder');
    return savedOrder ? JSON.parse(savedOrder) : [];
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [products, setProducts] = useState(productsData);
  const [activeWarehouse, setActiveWarehouse] = useState('US');

  // Save orderItems to localStorage whenever they change
  useEffect(() => {
    if (orderItems.length > 0) {
      localStorage.setItem('pendingOrder', JSON.stringify(orderItems));
    } else {
      localStorage.removeItem('pendingOrder');
    }
  }, [orderItems]);

  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, 'cpCostPerKit'),
      (snapshot) => {
        if (!snapshot.empty) {
          const firestoreProducts = [];
          snapshot.forEach((doc) => {
            const data = doc.data();
            firestoreProducts.push({
              id: doc.id,
              ...data,
              warehouseCosts: data.warehouseCosts || { US: 0, HK: 0 }
            });
          });
          setProducts(firestoreProducts);
        } else {
          // If no Firestore data, use local products.json with warehouse field
          setProducts(productsData);
        }
      },
      (error) => {
        console.error('Error loading products:', error);
        // Fallback to local data on error
        setProducts(productsData);
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

    // Use the appropriate cost based on the active warehouse
    const pricePerKit = product.warehouseCosts?.[activeWarehouse] || 0;

    const newItem = {
      itemName: itemName,
      quantity: 1,
      pricePerKit: pricePerKit,
      warehouse: activeWarehouse,
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

  // Group products by category
  const groupProductsByCategory = (productsToGroup) => {
    const groups = {
      'GLP Peptides': [],
      'Recovery & Healing': [],
      'Growth & Anti-Aging': [],
      'Cognitive Enhancement': [],
      'Melanotans': [],
      'Other Peptides': [],
      'Supplies': []
    };

    productsToGroup.forEach(product => {
      const name = product.product.toLowerCase();
      
      if (name.includes('glp') || name.includes('cagrilintide')) {
        groups['GLP Peptides'].push(product);
      } else if (name.includes('bpc') || name.includes('tb-500') || name.includes('kpv')) {
        groups['Recovery & Healing'].push(product);
      } else if (name.includes('ghk-cu') || name.includes('thymosin') || name.includes('ipamorelin') || 
                 name.includes('tesa') || name.includes('glow') || name.includes('nad') || name.includes('ss-31')) {
        groups['Growth & Anti-Aging'].push(product);
      } else if (name.includes('semax') || name.includes('selank') || name.includes('dsip')) {
        groups['Cognitive Enhancement'].push(product);
      } else if (name.includes('mt-2') || name.includes('pt-141')) {
        groups['Melanotans'].push(product);
      } else if (name.includes('bac water') || name.includes('hospira')) {
        groups['Supplies'].push(product);
      } else {
        groups['Other Peptides'].push(product);
      }
    });

    // Remove empty groups
    return Object.entries(groups).filter(([_, products]) => products.length > 0);
  };

  // Group products by base name (without strength)
  const groupProductsByName = (productsArray) => {
    const grouped = {};
    
    productsArray.forEach(product => {
      const baseName = product.product;
      if (!grouped[baseName]) {
        grouped[baseName] = [];
      }
      grouped[baseName].push(product);
    });
    
    return grouped;
  };

  const submitOrder = async () => {
    if (orderItems.length === 0) {
      onError('No items in order list to submit.');
      return;
    }

    setIsSubmitting(true);

    try {
      // Separate items by warehouse
      const usItems = orderItems.filter(item => item.warehouse === 'US');
      const hkItems = orderItems.filter(item => item.warehouse === 'HK');

      const timestamp = new Date().toISOString();

      // Submit US warehouse order if there are items
      if (usItems.length > 0) {
        const usItemsWithIds = usItems.map(item => ({
          ...item,
          itemId: Date.now().toString() + Math.random().toString(36).substr(2, 9)
        }));
        const usTotal = usItemsWithIds.reduce((sum, item) => sum + (item.quantity * item.pricePerKit), 0);
        await addDoc(collection(db, 'c&pProductOrders'), {
          warehouse: 'US',
          items: usItemsWithIds,
          total: usTotal,
          submittedAt: timestamp,
          status: 'pending',
        });
      }

      // Submit HK warehouse order if there are items
      if (hkItems.length > 0) {
        const hkItemsWithIds = hkItems.map(item => ({
          ...item,
          itemId: Date.now().toString() + Math.random().toString(36).substr(2, 9)
        }));
        const hkTotal = hkItemsWithIds.reduce((sum, item) => sum + (item.quantity * item.pricePerKit), 0);
        await addDoc(collection(db, 'c&pProductOrders'), {
          warehouse: 'HK',
          items: hkItemsWithIds,
          total: hkTotal,
          submittedAt: timestamp,
          status: 'pending',
        });
      }
      
      setOrderItems([]);
      localStorage.removeItem('pendingOrder');
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

      {/* Warehouse Tabs */}
      <div className="warehouse-tabs">
        <button 
          className={`warehouse-tab ${activeWarehouse === 'US' ? 'active' : ''}`}
          onClick={() => setActiveWarehouse('US')}
        >
          US Warehouse
        </button>
        <button 
          className={`warehouse-tab ${activeWarehouse === 'HK' ? 'active' : ''}`}
          onClick={() => setActiveWarehouse('HK')}
        >
          HK Warehouse
        </button>
      </div>

      {/* Add Item Form */}
      <div className="add-item-form">
        <h3>Select Products - {activeWarehouse} Warehouse</h3>
        <div className="categories-grid">
          {groupProductsByCategory(
            products.filter(product => {
              const cost = product.warehouseCosts?.[activeWarehouse];
              return cost !== undefined && cost > 0;
            })
          ).map(([categoryName, categoryProducts]) => {
            const groupedByName = groupProductsByName(categoryProducts);
            
            // Separate into multi-variant and single-variant products
            const multiVariant = [];
            const singleVariant = [];
            
            Object.entries(groupedByName).forEach(([productName, variants]) => {
              if (variants.length > 1) {
                multiVariant.push([productName, variants]);
              } else {
                singleVariant.push([productName, variants]);
              }
            });
            
            return (
              <div key={categoryName} className="product-category">
                <h4 className="category-title">{categoryName}</h4>
                <div className="product-groups">
                  {/* Render multi-variant products first */}
                  {multiVariant.map(([productName, variants]) => (
                    <div key={productName} className="product-group">
                      <div className="product-base-name">{productName}</div>
                      <div className="product-pills">
                        {variants.map((product, index) => {
                          const itemName = `${product.product} ${product.strength}`;
                          const isInOrder = orderItems.find(item => item.itemName === itemName);
                          return (
                            <button
                              key={product.id || index}
                              onClick={() => handleProductClick(product)}
                              className={`product-pill ${isInOrder ? 'in-order' : ''}`}
                              disabled={isInOrder}
                            >
                              {product.strength}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                  
                  {/* Render single-variant products at the bottom */}
                  {singleVariant.length > 0 && (
                    <div className="product-pills">
                      {singleVariant.map(([productName, variants]) => {
                        const product = variants[0];
                        const itemName = `${product.product} ${product.strength}`;
                        const isInOrder = orderItems.find(item => item.itemName === itemName);
                        return (
                          <button
                            key={productName}
                            onClick={() => handleProductClick(product)}
                            className={`product-pill ${isInOrder ? 'in-order' : ''}`}
                            disabled={isInOrder}
                          >
                            {product.product} - {product.strength}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
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
              <th>Warehouse</th>
              <th>Quantity</th>
              <th>Price per Kit</th>
              <th>Total Cost</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {orderItems.length === 0 ? (
              <tr>
                <td colSpan="6" className="empty-row">
                  No items in order list. Use the form above to add items.
                </td>
              </tr>
            ) : (
              orderItems.map((item) => (
                <tr key={item.itemName}>
                  <td className="item-name">{item.itemName}</td>
                  <td>
                    <span className="warehouse-badge">{item.warehouse}</span>
                  </td>
                  <td>
                    <input
                      type="number"
                      min="1"
                      value={item.quantity}
                      onChange={(e) => updateItem(item.itemName, 'quantity', e.target.value)}
                      onFocus={(e) => e.target.select()}
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
