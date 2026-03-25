import { useState, useEffect } from 'react';
import { collection, setDoc, doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebaseConfig';
import './NextOrderList.css';

const formatPrice = (price) => {
  return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const NextOrderList = ({ onSuccess, onError }) => {
  const [orderItems, setOrderItems] = useState(() => {
    const savedOrder = localStorage.getItem('pendingOrder');
    return savedOrder ? JSON.parse(savedOrder) : [];
  });
  const [recentlyAddedKey, setRecentlyAddedKey] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [products, setProducts] = useState([]);
  const [activeWarehouse, setActiveWarehouse] = useState('US');
  const [selectedVendor, setSelectedVendor] = useState('TSC');
  const [vendors, setVendors] = useState([]);
  const [showNewVendor, setShowNewVendor] = useState(false);
  const [newVendorName, setNewVendorName] = useState('');

  // Save orderItems to localStorage whenever they change
  useEffect(() => {
    if (orderItems.length > 0) {
      localStorage.setItem('pendingOrder', JSON.stringify(orderItems));
    } else {
      localStorage.removeItem('pendingOrder');
    }
  }, [orderItems]);

  // Load products
  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, 'c&pProductList'),
      (snapshot) => {
        if (!snapshot.empty) {
          const firestoreProducts = [];
          snapshot.forEach((doc) => {
            const data = doc.data();
            firestoreProducts.push({
              id: doc.id,
              ...data,
              warehouseCosts: data.warehouseCosts || { US: 0, HK: 0 },
              vendor: data.vendor || 'TSC'
            });
          });
          setProducts(firestoreProducts);
        } else {
          setProducts([]);
        }
      },
      (error) => {
        console.error('Error loading products:', error);
        setProducts([]);
      }
    );
    return () => unsubscribe();
  }, []);

  // Load vendor profiles
  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, 'c&pVendors'),
      (snapshot) => {
        const vendorList = [];
        snapshot.forEach((snap) => {
          vendorList.push({ id: snap.id, ...snap.data() });
        });
        vendorList.sort((a, b) => {
          if ((a.name || a.id) === 'TSC') return -1;
          if ((b.name || b.id) === 'TSC') return 1;
          return (a.name || a.id).localeCompare(b.name || b.id);
        });
        setVendors(vendorList);
      },
      (error) => {
        console.error('Error loading vendors:', error);
      }
    );
    return () => unsubscribe();
  }, []);

  const isTSC = selectedVendor === 'TSC';
  const activeVendorProfile = vendors.find(v => v.id === selectedVendor);

  // Get the vendor-specific price for a product
  const getVendorPrice = (product) => {
    if (isTSC) {
      return product.warehouseCosts?.[activeWarehouse] || 0;
    }
    if (activeVendorProfile?.products) {
      const key = `${product.product}__${product.strength}`;
      const vendorProduct = activeVendorProfile.products[key];
      if (vendorProduct && typeof vendorProduct.price === 'number') {
        return vendorProduct.price;
      }
    }
    return 0;
  };

  const handleProductClick = (product) => {
    const alreadyInOrder = orderItems.find(item =>
      item.productName === product.product &&
      item.productStrength === product.strength &&
      item.warehouse === activeWarehouse
    );
    if (alreadyInOrder) {
      onError('This item is already in the order list.', 'Notice');
      return;
    }
    const pricePerKit = getVendorPrice(product);
    const newItem = {
      productName: product.product,
      productStrength: product.strength,
      quantity: 1,
      pricePerKit: pricePerKit,
      warehouse: activeWarehouse,
      vendor: selectedVendor,
    };
    const itemKey = `${newItem.productName} ${newItem.productStrength} ${newItem.warehouse}`;
    setOrderItems([...orderItems, newItem]);
    setRecentlyAddedKey(itemKey);
    setTimeout(() => setRecentlyAddedKey(null), 900);
  };

  const removeItem = (targetItem) => {
    setOrderItems(orderItems.filter(item =>
      !(
        item.productName === targetItem.productName &&
        item.productStrength === targetItem.productStrength &&
        item.warehouse === targetItem.warehouse
      )
    ));
  };

  const updateItem = (itemKey, field, value) => {
    setOrderItems(orderItems.map(item => {
      const key = `${item.productName} ${item.productStrength} ${item.warehouse}`;
      if (key === itemKey) {
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

    // Remove empty groups and sort categories A→Z
    return Object.entries(groups)
      .filter(([_, products]) => products.length > 0)
      .sort(([a], [b]) => a.localeCompare(b));
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

  const formatOrderId = (dateObj) => {
    const pad = (n) => String(n).padStart(2, '0');
    const y = dateObj.getFullYear();
    const m = pad(dateObj.getMonth() + 1);
    const d = pad(dateObj.getDate());
    const hh = pad(dateObj.getHours());
    const mm = pad(dateObj.getMinutes());
    const ss = pad(dateObj.getSeconds());
    return `CP-ORDER-${y}${m}${d}${hh}${mm}${ss}`;
  };

  const submitOrder = async () => {
    if (orderItems.length === 0) {
      onError('No items in order list to submit.');
      return;
    }

    setIsSubmitting(true);

    try {
      const timestampDate = new Date();
      const timestamp = timestampDate.toISOString();

      const itemsWithIds = orderItems.map(item => ({
        ...item,
        itemId: Date.now().toString() + Math.random().toString(36).substr(2, 9)
      }));
      const total = itemsWithIds.reduce((sum, item) => sum + (item.quantity * item.pricePerKit), 0);
      const orderId = formatOrderId(timestampDate);

      await setDoc(doc(db, 'c&pProductOrders', orderId), {
        id: orderId,
        warehouse: 'US',
        vendor: selectedVendor,
        items: itemsWithIds,
        total,
        submittedAt: timestamp,
        status: 'pending',
      });

      // Save product prices to vendor profile (skip for TSC)
      if (!isTSC) {
        const vendorDocId = selectedVendor;
        const existingProfile = activeVendorProfile || {};
        const existingProducts = existingProfile.products || {};
        const updatedProducts = { ...existingProducts };

        orderItems.forEach(item => {
          const key = `${item.productName}__${item.productStrength}`;
          updatedProducts[key] = {
            product: item.productName,
            strength: item.productStrength,
            price: item.pricePerKit,
            lastOrdered: timestamp,
          };
        });

        await setDoc(doc(db, 'c&pVendors', vendorDocId), {
          name: existingProfile.name || vendorDocId,
          products: updatedProducts,
          updatedAt: timestamp,
        }, { merge: true });
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

  const createNewVendor = async () => {
    const name = newVendorName.trim();
    if (!name) {
      onError('Enter a vendor name.', 'Notice');
      return;
    }
    const vendorId = name.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase();
    if (vendorId === 'TSC' || vendors.some(v => v.id === vendorId)) {
      onError('This vendor already exists.', 'Notice');
      return;
    }
    try {
      await setDoc(doc(db, 'c&pVendors', vendorId), {
        name: name,
        products: {},
        createdAt: new Date().toISOString(),
      });
      setSelectedVendor(vendorId);
      setNewVendorName('');
      setShowNewVendor(false);
      onSuccess && onSuccess(`Vendor "${name}" created!`, 'Success');
    } catch (error) {
      console.error('Error creating vendor:', error);
      onError('Failed to create vendor: ' + error.message, 'Error');
    }
  };

  return (
    <div className="next-order-section">
      <div className="section-header">
      {/* Title removed per request */}
      </div>

      {/* Vendor Selector */}
      <div className="vendor-tab-bar">
        {vendors.length === 0 && (
          <button
            className={`vendor-tab-btn active`}
          >
            TSC
          </button>
        )}
        {vendors.map(v => (
          <button
            key={v.id}
            className={`vendor-tab-btn ${selectedVendor === v.id ? 'active' : ''}`}
            onClick={() => { setSelectedVendor(v.id); setOrderItems([]); }}
          >
            {v.name || v.id}
          </button>
        ))}
        <button
          className={`vendor-tab-btn vendor-tab-add ${showNewVendor ? 'active' : ''}`}
          onClick={() => setShowNewVendor(!showNewVendor)}
          title="Add new vendor"
        >
          {showNewVendor ? '✕' : '+'}
        </button>
      </div>

      {showNewVendor && (
        <div className="new-vendor-row">
          <input
            type="text"
            className="new-vendor-input"
            value={newVendorName}
            onChange={(e) => setNewVendorName(e.target.value)}
            placeholder="New vendor name"
            onKeyDown={(e) => e.key === 'Enter' && createNewVendor()}
          />
          <button className="btn-neon-lime btn-sm" onClick={createNewVendor}>
            Create
          </button>
        </div>
      )}

      {/* Warehouse Tabs (TSC only) */}
      {isTSC && (
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
      )}

      <div className="order-layout-2col">
        <div className="order-col-left">
          {/* Add Item Form */}
          <div className="add-item-form">
            <h3>Select Products — {isTSC ? `TSC / ${activeWarehouse}` : (activeVendorProfile?.name || selectedVendor)}</h3>
        <div className="product-flat-list">
          {products
            .filter(product => {
              if (isTSC) {
                const cost = product.warehouseCosts?.[activeWarehouse];
                return cost !== undefined && cost > 0;
              }
              return true;
            })
            .sort((a, b) => (a.id || '').localeCompare(b.id || ''))
            .map((product, index) => {
              const isInOrder = orderItems.some(item =>
                item.productName === product.product &&
                item.productStrength === product.strength &&
                item.warehouse === activeWarehouse
              );
              const label = `${product.id || product.product} ${product.strength}`;
              return (
                <button
                  key={product.id || index}
                  onClick={() => handleProductClick(product)}
                  className={`product-pill ${isInOrder ? 'in-order' : ''}`}
                  disabled={isInOrder}
                >
                  {label}
                </button>
              );
            })}
        </div>
      </div>
        </div>

        <div className="order-col-right">
          {/* Order List Table */}
          <div className="order-table-container">
            <table className="order-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Strength</th>
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
                    <td colSpan="7" className="empty-row">
                      No items in order list. Use the form above to add items.
                    </td>
                  </tr>
                ) : (
              orderItems.map((item) => {
                const itemKey = `${item.productName} ${item.productStrength} ${item.warehouse}`;
                const highlight = recentlyAddedKey === itemKey;
                return (
                  <tr key={itemKey} className={highlight ? 'order-row-new' : ''}>
                    <td className="item-product-view" style={{verticalAlign: 'middle'}}>{item.productName}</td>
                    <td className="item-strength-view" style={{verticalAlign: 'middle'}}>{item.productStrength}</td>
                    <td>
                      <span className="warehouse-badge">{item.warehouse}</span>
                    </td>
                        <td>
                          <input
                            type="number"
                            min="1"
                            value={item.quantity}
                            onChange={(e) => updateItem(itemKey, 'quantity', e.target.value)}
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
                            onChange={(e) => updateItem(itemKey, 'pricePerKit', e.target.value)}
                            className="price-input"
                          />
                        </td>
                        <td className="total-cost">${formatPrice(item.quantity * item.pricePerKit)}</td>
                        <td>
                          <button
                            onClick={() => removeItem(item)}
                            className="remove-btn"
                            title="Remove from order"
                          >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path>
                            </svg>
                          </button>
                        </td>
                      </tr>
                    );
                  })
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
      </div>
    </div>
  );
};

export default NextOrderList;
