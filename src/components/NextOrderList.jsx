import { useState, useEffect } from 'react';
import { collection, setDoc, doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebaseConfig';
import './NextOrderList.css';

const formatPrice = (price) => {
  return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const normalizeVendorId = (vendor) => (vendor || 'TSC').toString();

const buildOrderItemKey = (item) => {
  const vendor = normalizeVendorId(item.vendor);
  return `${vendor}::${item.productName}::${item.productStrength}::${item.warehouse}`;
};

const NextOrderList = ({ onSuccess, onError, onSubmitted }) => {
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
  const [includeShipping, setIncludeShipping] = useState(false);
  const [shippingCost, setShippingCost] = useState(0);

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
  const getVendorPriceFor = (product, vendorId, warehouse) => {
    if (normalizeVendorId(vendorId) === 'TSC') {
      return product.warehouseCosts?.[warehouse] || 0;
    }
    const vendorProfile = vendors.find(v => v.id === vendorId);
    const vendorName = vendorProfile?.name || vendorId;
    // New: read from vendorPricing on the product doc
    const vp = product.vendorPricing?.[vendorName];
    if (vp && typeof vp.price === 'number') return vp.price;
    // Legacy fallback: old vendor profile products sub-map
    if (vendorProfile?.products) {
      const key = `${product.product}__${product.strength}`;
      const vendorProduct = vendorProfile.products[key];
      if (vendorProduct && typeof vendorProduct.price === 'number') {
        return vendorProduct.price;
      }
    }
    return 0;
  };

  const getVendorPrice = (product) => getVendorPriceFor(product, selectedVendor, activeWarehouse);

  const handleVendorSwitch = (vendorId) => {
    setSelectedVendor(vendorId);
    setRecentlyAddedKey(null);
    setOrderItems((prev) =>
      prev.map((item) => {
        const matchedProduct = products.find(
          (p) => p.product === item.productName && p.strength === item.productStrength
        );
        if (!matchedProduct) {
          return { ...item, vendor: vendorId };
        }
        const nextPrice = getVendorPriceFor(
          matchedProduct,
          vendorId,
          item.warehouse || activeWarehouse
        );
        return {
          ...item,
          vendor: vendorId,
          pricePerKit: nextPrice,
        };
      })
    );
  };

  const handleProductClick = (product) => {
    const alreadyInOrder = orderItems.find(item =>
      normalizeVendorId(item.vendor) === normalizeVendorId(selectedVendor) &&
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
    const itemKey = buildOrderItemKey(newItem);
    setOrderItems([...orderItems, newItem]);
    setRecentlyAddedKey(itemKey);
    setTimeout(() => setRecentlyAddedKey(null), 900);
  };

  const removeItem = (targetItem) => {
    setOrderItems(orderItems.filter(item =>
      !(
        normalizeVendorId(item.vendor) === normalizeVendorId(targetItem.vendor) &&
        item.productName === targetItem.productName &&
        item.productStrength === targetItem.productStrength &&
        item.warehouse === targetItem.warehouse
      )
    ));
  };

  const updateItem = (itemKey, field, value) => {
    setOrderItems(orderItems.map(item => {
      const key = buildOrderItemKey(item);
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

  const calculateSubtotal = () => {
    return orderItems.reduce((sum, item) => sum + (item.quantity * item.pricePerKit), 0);
  };

  const getShippingTotal = () => {
    if (!includeShipping) return 0;
    return Math.max(0, parseFloat(shippingCost) || 0);
  };

  const calculateTotal = () => {
    return calculateSubtotal() + getShippingTotal();
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

  const generateOrderId = () => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return `CP-ORDER-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    }
    return `CP-ORDER-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
  };

  const submitOrder = async () => {
    if (orderItems.length === 0) {
      onError('No items in order list to submit.');
      return;
    }

    setIsSubmitting(true);

    try {
      const timestamp = new Date().toISOString();

      const itemsWithIds = orderItems.map(item => ({
        ...item,
        itemId: Date.now().toString() + Math.random().toString(36).substr(2, 9)
      }));
      const subtotal = itemsWithIds.reduce((sum, item) => sum + (item.quantity * item.pricePerKit), 0);
      const orderShippingTotal = getShippingTotal();
      const grandTotal = subtotal + orderShippingTotal;
      const itemsByVendor = itemsWithIds.reduce((acc, item) => {
        const vendorId = normalizeVendorId(item.vendor);
        if (!acc[vendorId]) acc[vendorId] = [];
        acc[vendorId].push(item);
        return acc;
      }, {});

      const vendorIds = Object.keys(itemsByVendor);
      let remainingShipping = orderShippingTotal;
      const orderWrites = vendorIds.map((vendorId, idx) => {
        const vendorItems = itemsByVendor[vendorId];
        const vendorSubtotal = vendorItems.reduce((sum, item) => sum + (item.quantity * item.pricePerKit), 0);
        let shippingAllocated = 0;
        if (orderShippingTotal > 0) {
          if (vendorIds.length === 1) {
            shippingAllocated = orderShippingTotal;
          } else if (idx === vendorIds.length - 1) {
            shippingAllocated = Math.max(0, Number(remainingShipping.toFixed(2)));
          } else {
            const proportional = subtotal > 0 ? (vendorSubtotal / subtotal) * orderShippingTotal : 0;
            shippingAllocated = Number(proportional.toFixed(2));
            remainingShipping -= shippingAllocated;
          }
        }
        const vendorTotal = vendorSubtotal + shippingAllocated;
        const vendorWarehouses = [...new Set(vendorItems.map(item => item.warehouse || 'US'))];
        const warehouseValue = vendorWarehouses.length === 1 ? vendorWarehouses[0] : 'Mixed';
        const orderId = generateOrderId();
        return setDoc(doc(db, 'c&pProductOrders', orderId), {
          id: orderId,
          warehouse: warehouseValue,
          vendor: vendorId,
          items: vendorItems,
          subtotal: vendorSubtotal,
          shippingCost: shippingAllocated,
          shippingApplied: orderShippingTotal > 0,
          orderShippingTotal,
          total: vendorTotal,
          submittedAt: timestamp,
          status: 'pending',
        });
      });
      await Promise.all(orderWrites);

      // Save product prices back to each vendor profile (skip TSC)
      const vendorProfilesById = vendors.reduce((acc, vendor) => {
        acc[vendor.id] = vendor;
        return acc;
      }, {});

      const vendorPriceWrites = vendorIds
        .filter((vendorId) => vendorId !== 'TSC')
        .map((vendorId) => {
          const existingProfile = vendorProfilesById[vendorId] || {};
          const existingProducts = existingProfile.products || {};
          const updatedProducts = { ...existingProducts };

          itemsByVendor[vendorId].forEach(item => {
            const key = `${item.productName}__${item.productStrength}`;
            updatedProducts[key] = {
              product: item.productName,
              strength: item.productStrength,
              price: item.pricePerKit,
              lastOrdered: timestamp,
            };
          });

          return setDoc(doc(db, 'c&pVendors', vendorId), {
            name: existingProfile.name || vendorId,
            products: updatedProducts,
            updatedAt: timestamp,
          }, { merge: true });
        });
      await Promise.all(vendorPriceWrites);
      
      setOrderItems([]);
      setIncludeShipping(false);
      setShippingCost(0);
      localStorage.removeItem('pendingOrder');
      onSuccess(`Order submitted successfully (${itemsWithIds.length} item${itemsWithIds.length === 1 ? '' : 's'}, total $${formatPrice(grandTotal)})`);
      onSubmitted && onSubmitted();
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
      handleVendorSwitch(vendorId);
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
            onClick={() => { handleVendorSwitch(v.id); }}
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
                // Only show TSC products with warehouse costs
                const cost = product.warehouseCosts?.[activeWarehouse];
                return product.vendor === 'TSC' && cost !== undefined && cost > 0;
              }
              // For non-TSC vendors: show full catalog (TSC products) + any vendor-exclusive products
              if (!activeVendorProfile) return false;
              return product.vendor === 'TSC' || product.vendor === activeVendorProfile.name;
            })
            .sort((a, b) => (a.id || '').localeCompare(b.id || ''))
            .map((product, index) => {
              const isInOrder = orderItems.some(item =>
                normalizeVendorId(item.vendor) === normalizeVendorId(selectedVendor) &&
                item.productName === product.product &&
                item.productStrength === product.strength &&
                item.warehouse === activeWarehouse
              );
              const label = `${product.product || product.id} ${product.strength}`;
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
                  <th>Vendor</th>
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
                    <td colSpan="8" className="empty-row">
                      No items in order list. Use the form above to add items.
                    </td>
                  </tr>
                ) : (
              orderItems.map((item) => {
                const itemKey = buildOrderItemKey(item);
                const highlight = recentlyAddedKey === itemKey;
                return (
                  <tr key={itemKey} className={highlight ? 'order-row-new' : ''}>
                    <td className="item-product-view" style={{verticalAlign: 'middle'}}>{item.productName}</td>
                    <td className="item-strength-view" style={{verticalAlign: 'middle'}}>{item.productStrength}</td>
                    <td>{item.vendor || 'TSC'}</td>
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
                            onFocus={(e) => e.target.select()}
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
            <div className="order-total-content">
              <h3>Order Total</h3>
              <div className="total-line">
                <span>Subtotal</span>
                <span>${formatPrice(calculateSubtotal())}</span>
              </div>
              <div className="shipping-row">
                <label className="shipping-toggle-label">
                  <input
                    type="checkbox"
                    checked={includeShipping}
                    onChange={(e) => {
                      setIncludeShipping(e.target.checked);
                      if (!e.target.checked) setShippingCost(0);
                    }}
                  />
                  <span>Add shipping</span>
                </label>
                {includeShipping && (
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={shippingCost}
                    onChange={(e) => setShippingCost(Math.max(0, parseFloat(e.target.value) || 0))}
                    onFocus={(e) => e.target.select()}
                    className="shipping-cost-input"
                    placeholder="0.00"
                    aria-label="Shipping cost"
                  />
                )}
              </div>
              {includeShipping && (
                <div className="total-line">
                  <span>Shipping</span>
                  <span>${formatPrice(getShippingTotal())}</span>
                </div>
              )}
              <div className="total-line grand-total-line">
                <span>Grand Total</span>
                <span>${formatPrice(calculateTotal())}</span>
              </div>
            </div>
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
