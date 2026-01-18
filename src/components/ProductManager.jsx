import { useState, useEffect } from 'react';
import { collection, onSnapshot, doc, setDoc, getDocs } from 'firebase/firestore';
import { db } from '../firebaseConfig';
import productsData from '../data/products.json';
import './ProductManager.css';

const ProductManager = ({ onSuccess, onError }) => {
  const [products, setProducts] = useState(productsData.map((p) => ({ 
    ...p, 
    id: `${p.product.replace(/[^a-zA-Z0-9]/g, '_')}_${p.strength.replace(/[^a-zA-Z0-9]/g, '_')}`
  })));
  const [editingProduct, setEditingProduct] = useState(null);
  const [hasInitialized, setHasInitialized] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newProduct, setNewProduct] = useState({ product: '', strength: '', warehouseCosts: { US: 0, HK: 0 } });

  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, 'cpCostPerKit'),
      (snapshot) => {
        if (snapshot.empty && !hasInitialized) {
          // Auto-populate collection on first load
          saveAllToFirestore();
          setHasInitialized(true);
        } else if (!snapshot.empty) {
          const firestoreProducts = [];
          snapshot.forEach((doc) => {
            const data = doc.data();
            // Handle both old and new structure
            let warehouseCosts;
            if (data.warehouseCosts) {
              warehouseCosts = data.warehouseCosts;
            } else {
              // Old structure - use costPerKit for both warehouses
              const existingCost = data.costPerKit || 0;
              warehouseCosts = {
                US: data.usCostPerKit !== undefined ? data.usCostPerKit : existingCost,
                HK: data.hkCostPerKit !== undefined ? data.hkCostPerKit : existingCost
              };
            }
            
            firestoreProducts.push({
              id: doc.id,
              product: data.product,
              strength: data.strength,
              warehouseCosts: warehouseCosts
            });
          });
          setProducts(firestoreProducts);
          setHasInitialized(true);
        }
      },
      (error) => {
        console.error('Error listening to products:', error);
      }
    );

    return () => unsubscribe();
  }, [hasInitialized]);

  const saveAllToFirestore = async () => {
    try {
      for (const product of products) {
        const docId = `${product.product.replace(/[^a-zA-Z0-9]/g, '_')}_${product.strength.replace(/[^a-zA-Z0-9]/g, '_')}`;
        await setDoc(doc(db, 'cpCostPerKit', docId), {
          product: product.product,
          strength: product.strength,
          warehouseCosts: product.warehouseCosts || { US: 0, HK: 0 }
        });
      }
      onSuccess('All products saved to Firestore!', 'Success');
    } catch (error) {
      console.error('Error saving products:', error);
      onError('Failed to save products: ' + error.message, 'Error');
    }
  };

  const updateProductCost = (id, warehouse, newCost) => {
    setProducts(products.map(p => 
      p.id === id ? { 
        ...p, 
        warehouseCosts: { 
          ...p.warehouseCosts, 
          [warehouse]: parseFloat(newCost) || 0 
        } 
      } : p
    ));
  };

  const saveProduct = async (product) => {
    try {
      const docId = `${product.product.replace(/[^a-zA-Z0-9]/g, '_')}_${product.strength.replace(/[^a-zA-Z0-9]/g, '_')}`;
      await setDoc(doc(db, 'cpCostPerKit', docId), {
        product: product.product,
        strength: product.strength,
        warehouseCosts: product.warehouseCosts || { US: 0, HK: 0 }
      });
      setEditingProduct(null);
    } catch (error) {
      console.error('Error updating product:', error);
      onError('Failed to update product: ' + error.message, 'Error');
    }
  };

  const addNewProduct = async () => {
    const strengthValue = newProduct.strength.replace(/[^0-9.]/g, '').trim();
    
    if (!newProduct.product.trim() || !strengthValue) {
      onError('Please fill in product name and strength', 'Validation Error');
      return;
    }

    try {
      const docId = `${newProduct.product.replace(/[^a-zA-Z0-9]/g, '_')}_${newProduct.strength.replace(/[^a-zA-Z0-9]/g, '_')}`;
      await setDoc(doc(db, 'cpCostPerKit', docId), {
        product: newProduct.product,
        strength: newProduct.strength,
        warehouseCosts: newProduct.warehouseCosts || { US: 0, HK: 0 }
      });
      setNewProduct({ product: '', strength: '', warehouseCosts: { US: 0, HK: 0 } });
      setShowAddForm(false);
    } catch (error) {
      console.error('Error adding product:', error);
      onError('Failed to add product: ' + error.message, 'Error');
    }
  };

  const migrateExistingProducts = async () => {
    if (!window.confirm('This will update all products in Firebase to the new structure. Current costPerKit values will be used for both US and HK warehouses. Continue?')) {
      return;
    }

    try {
      const snapshot = await getDocs(collection(db, 'cpCostPerKit'));
      let migratedCount = 0;

      for (const docSnap of snapshot.docs) {
        const data = docSnap.data();
        
        // Check if already in new format
        if (data.warehouseCosts) {
          continue;
        }

        // Migrate old structure to new
        // Priority: costPerKit > usCostPerKit/hkCostPerKit > 0
        const existingCost = data.costPerKit || 0;
        const warehouseCosts = {
          US: data.usCostPerKit !== undefined ? data.usCostPerKit : existingCost,
          HK: data.hkCostPerKit !== undefined ? data.hkCostPerKit : existingCost
        };

        await setDoc(doc(db, 'cpCostPerKit', docSnap.id), {
          product: data.product,
          strength: data.strength,
          warehouseCosts: warehouseCosts
        });

        migratedCount++;
      }

      onSuccess(`Successfully migrated ${migratedCount} products!`, 'Migration Complete');
    } catch (error) {
      console.error('Error migrating products:', error);
      onError('Failed to migrate products: ' + error.message, 'Error');
    }
  };

  return (
    <div className="product-manager">
      <div className="manager-header">
        <h2 className="text-glow-fuchsia">Product Cost Manager</h2>
        <div className="header-actions">
          <button onClick={() => setShowAddForm(!showAddForm)} className="btn-neon-cyan">
            {showAddForm ? 'Cancel' : 'Add Product'}
          </button>
        </div>
      </div>

      {showAddForm && (
        <div className="add-product-form">
          <h3>Add New Product</h3>
          <div className="form-row">
            <div className="form-field">
              <label>Product Name</label>
              <input
                type="text"
                value={newProduct.product}
                onChange={(e) => setNewProduct({ ...newProduct, product: e.target.value })}
                placeholder="e.g., BPC-157"
              />
            </div>
            <div className="form-field">
              <label>Strength</label>
              <div className="strength-input-wrapper">
                <input
                  type="number"
                  value={newProduct.strength.replace(/[^0-9.]/g, '')}
                  onChange={(e) => setNewProduct({ ...newProduct, strength: e.target.value + ' mg' })}
                  placeholder="10"
                  className="strength-number"
                />
                <span className="strength-unit">mg</span>
              </div>
            </div>
            <div className="form-field">
              <label>US Cost per Kit ($)</label>
              <input
                type="number"
                step="0.01"
                value={newProduct.warehouseCosts.US}
                onChange={(e) => setNewProduct({ 
                  ...newProduct, 
                  warehouseCosts: { ...newProduct.warehouseCosts, US: parseFloat(e.target.value) || 0 }
                })}
                onFocus={(e) => e.target.select()}
                placeholder="0.00"
              />
            </div>
            <div className="form-field">
              <label>HK Cost per Kit ($)</label>
              <input
                type="number"
                step="0.01"
                value={newProduct.warehouseCosts.HK}
                onChange={(e) => setNewProduct({ 
                  ...newProduct, 
                  warehouseCosts: { ...newProduct.warehouseCosts, HK: parseFloat(e.target.value) || 0 }
                })}
                onFocus={(e) => e.target.select()}
                placeholder="0.00"
              />
            </div>
            <div className="form-field">
              <button onClick={addNewProduct} className="btn-neon-lime add-product-btn">
                Add Product
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="products-table-container">
        <table className="products-table">
          <thead>
            <tr>
              <th>Product</th>
              <th>Strength</th>
              <th>US Cost per Kit ($)</th>
              <th>HK Cost per Kit ($)</th>
              {editingProduct && <th>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {products.map(product => (
              <tr 
                key={product.id}
                onClick={() => editingProduct !== product.id && setEditingProduct(product.id)}
                className={editingProduct === product.id ? 'editing' : 'clickable'}
              >
                <td className="product-name">{product.product}</td>
                <td className="product-strength">{product.strength}</td>
                <td onClick={(e) => e.stopPropagation()}>
                  {editingProduct === product.id ? (
                    <input
                      type="text"
                      value={product.warehouseCosts?.US || 0}
                      onChange={(e) => updateProductCost(product.id, 'US', e.target.value)}
                      onFocus={(e) => e.target.select()}
                      className="cost-input-edit"
                    />
                  ) : (
                    <span className="cost-display">${(product.warehouseCosts?.US || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  )}
                </td>
                <td onClick={(e) => e.stopPropagation()}>
                  {editingProduct === product.id ? (
                    <input
                      type="text"
                      value={product.warehouseCosts?.HK || 0}
                      onChange={(e) => updateProductCost(product.id, 'HK', e.target.value)}
                      onFocus={(e) => e.target.select()}
                      className="cost-input-edit"
                    />
                  ) : (
                    <span className="cost-display">${(product.warehouseCosts?.HK || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  )}
                </td>
                {editingProduct && (
                  <td onClick={(e) => e.stopPropagation()}>
                    {editingProduct === product.id && (
                      <div className="action-buttons">
                        <button
                          onClick={() => saveProduct(product)}
                          className="btn-neon-cyan btn-sm"
                        >
                          Save
                        </button>
                        <button
                          onClick={() => setEditingProduct(null)}
                          className="btn-cancel btn-sm"
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default ProductManager;
