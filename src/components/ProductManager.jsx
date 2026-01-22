import { useState, useEffect, useCallback } from 'react';
import ReactDOM from 'react-dom';
import { collection, onSnapshot, doc, setDoc, getDocs } from 'firebase/firestore';
import { db } from '../firebaseConfig';
import './ProductManager.css';

const buildDocId = (product, strength) =>
  `${product.replace(/[^a-zA-Z0-9]/g, '_')}_${strength.replace(/[^a-zA-Z0-9]/g, '_')}`;

const ProductManager = ({ onSuccess, onError }) => {
  const [products, setProducts] = useState([]);
  const [editForm, setEditForm] = useState(null);
  const [hasInitialized, setHasInitialized] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newProduct, setNewProduct] = useState({ product: '', strength: '', warehouseCosts: { US: 0, HK: 0 } });

  const saveAllToFirestore = useCallback(async () => {
    try {
      for (const product of products) {
        const docId = product.docId || buildDocId(product.product, product.strength);
        await setDoc(doc(db, 'c&pProductList', docId), {
          id: product.id || docId,
          product: product.product,
          strength: product.strength,
          warehouseCosts: product.warehouseCosts || { US: 0, HK: 0 },
          canvaTemplateUrl: product.canvaTemplateUrl || '',
          currentCoa: product.currentCoa || { lot: '', url: '' },
          pastCoas: product.pastCoas || []
        });
      }
      onSuccess('All products saved to Firestore!', 'Success');
    } catch (error) {
      console.error('Error saving products:', error);
      onError('Failed to save products: ' + error.message, 'Error');
    }
  }, [onError, onSuccess, products]);

  const syncToProductList = useCallback(async () => {
    try {
      for (const product of products) {
        const docId = product.docId || buildDocId(product.product, product.strength);
        await setDoc(doc(db, 'c&pProductList', docId), {
          id: product.id || docId,
          product: product.product,
          strength: product.strength,
          warehouseCosts: product.warehouseCosts || { US: 0, HK: 0 },
          canvaTemplateUrl: product.canvaTemplateUrl || '',
          currentCoa: product.currentCoa || { lot: '', url: '' },
          pastCoas: product.pastCoas || []
        });
      }
      onSuccess('Products copied to c&pProductList with extended fields.', 'Success');
    } catch (error) {
      console.error('Error syncing products:', error);
      onError('Failed to sync products: ' + error.message, 'Error');
    }
  }, [onError, onSuccess, products]);

  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, 'c&pProductList'),
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
              docId: doc.id,
              id: data.id || doc.id,
              product: data.product,
              strength: data.strength,
              warehouseCosts: warehouseCosts,
              canvaTemplateUrl: data.canvaTemplateUrl || '',
              currentCoa: data.currentCoa || { lot: '', url: '' },
              pastCoas: data.pastCoas || []
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
  }, [hasInitialized, saveAllToFirestore]);

  const updateProductCost = (id, warehouse, newCost) => {
    setEditForm(prev => ({
      ...prev,
      warehouseCosts: {
        ...prev.warehouseCosts,
        [warehouse]: parseFloat(newCost) || 0
      }
    }));
  };

  const saveProduct = async (product) => {
    try {
      const docId = product.docId || buildDocId(product.product, product.strength);
      await setDoc(doc(db, 'c&pProductList', docId), {
        id: product.id?.trim() || docId,
        product: product.product,
        strength: product.strength,
        warehouseCosts: product.warehouseCosts || { US: 0, HK: 0 },
        canvaTemplateUrl: product.canvaTemplateUrl || '',
        currentCoa: product.currentCoa || { lot: '', url: '' },
        pastCoas: product.pastCoas || []
      });
      setProducts(prev =>
        prev.map(p =>
          p.docId === product.docId
            ? { ...product, docId, id: product.id?.trim() || docId }
            : p
        )
      );
      setEditForm(null);
    } catch (error) {
      console.error('Error updating product:', error);
      onError('Failed to update product: ' + error.message, 'Error');
    }
  };

  useEffect(() => {
    if (!editForm) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [editForm]);

  const addNewProduct = async () => {
    const strengthValue = newProduct.strength.replace(/[^0-9.]/g, '').trim();
    
    if (!newProduct.product.trim() || !strengthValue) {
      onError('Please fill in product name and strength', 'Validation Error');
      return;
    }

    try {
      const docId = buildDocId(newProduct.product, newProduct.strength);
      await setDoc(doc(db, 'c&pProductList', docId), {
        id: docId,
        product: newProduct.product,
        strength: newProduct.strength,
        warehouseCosts: newProduct.warehouseCosts || { US: 0, HK: 0 },
        canvaTemplateUrl: newProduct.canvaTemplateUrl || '',
        currentCoa: newProduct.currentCoa || { lot: '', url: '' },
        pastCoas: newProduct.pastCoas || []
      });
      setProducts(prev => [
        ...prev,
        {
          docId,
          id: docId,
          product: newProduct.product,
          strength: newProduct.strength,
          warehouseCosts: newProduct.warehouseCosts || { US: 0, HK: 0 },
          canvaTemplateUrl: newProduct.canvaTemplateUrl || '',
          currentCoa: newProduct.currentCoa || { lot: '', url: '' },
          pastCoas: newProduct.pastCoas || []
        }
      ]);
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
      const snapshot = await getDocs(collection(db, 'c&pProductList'));
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
        await setDoc(doc(db, 'c&pProductList', docSnap.id), {
          id: data.id || docSnap.id,
          product: data.product,
          strength: data.strength,
          warehouseCosts: warehouseCosts,
          canvaTemplateUrl: data.canvaTemplateUrl || '',
          currentCoa: data.currentCoa || { lot: '', url: '' },
          pastCoas: data.pastCoas || []
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

      <div className="products-card-grid">
        {products.map((product) => (
          <div key={product.id} className="product-card">
            <div className="product-card-top">
              <div className="product-card-id">{product.id}</div>
              <button
                className="btn-neon-cyan btn-sm"
                onClick={() =>
                  setEditForm({
                    ...product,
                    docId: product.docId || product.id,
                    warehouseCosts: { ...product.warehouseCosts },
                    currentCoa: { lot: '', url: '', ...product.currentCoa },
                    canvaTemplateUrl: product.canvaTemplateUrl || '',
                    pastCoas: product.pastCoas || []
                  })
                }
              >
                Edit
              </button>
            </div>
            <div className="product-card-name">{product.product}</div>
            <div className="product-card-meta">
              <span className="pill">{product.strength || '—'}</span>
            </div>
            <div className="product-card-costs">
              <div className="cost-block">
                <div className="cost-label">US Cost / Kit</div>
                <div className="cost-value">
                  ${(product.warehouseCosts?.US || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
              </div>
              <div className="cost-block">
                <div className="cost-label">HK Cost / Kit</div>
                <div className="cost-value">
                  ${(product.warehouseCosts?.HK || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {editForm &&
        ReactDOM.createPortal(
          <div className="product-edit-overlay">
            <div className="edit-backdrop" onClick={() => setEditForm(null)}></div>
            <div className="edit-drawer">
              <h2 className="modal-title">Edit Product</h2>
              <div className="edit-form-grid">
                <div className="edit-field full">
                  <label>ID</label>
                  <input
                    type="text"
                    value={editForm.id}
                    onChange={(e) => setEditForm({ ...editForm, id: e.target.value })}
                    placeholder="Doc ID"
                  />
                </div>

                <div className="edit-field">
                  <label>Product Name</label>
                  <input
                    type="text"
                    value={editForm.product}
                    onChange={(e) => setEditForm({ ...editForm, product: e.target.value })}
                  />
                </div>

                <div className="edit-field">
                  <label>Strength</label>
                  <input
                    type="text"
                    value={editForm.strength}
                    onChange={(e) => setEditForm({ ...editForm, strength: e.target.value })}
                  />
                </div>

                <div className="edit-field">
                  <label>US Cost per Kit ($)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={editForm.warehouseCosts?.US ?? 0}
                    onChange={(e) => updateProductCost(editForm.id, 'US', e.target.value)}
                    onFocus={(e) => e.target.select()}
                  />
                </div>

                <div className="edit-field">
                  <label>HK Cost per Kit ($)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={editForm.warehouseCosts?.HK ?? 0}
                    onChange={(e) => updateProductCost(editForm.id, 'HK', e.target.value)}
                    onFocus={(e) => e.target.select()}
                  />
                </div>

                <div className="edit-field full">
                  <label>Canva Template URL</label>
                  <input
                    type="text"
                    value={editForm.canvaTemplateUrl || ''}
                    onChange={(e) => setEditForm({ ...editForm, canvaTemplateUrl: e.target.value })}
                  />
                </div>

                <div className="edit-field">
                  <label>Current COA Lot</label>
                  <input
                    type="text"
                    value={editForm.currentCoa?.lot || ''}
                    onChange={(e) =>
                      setEditForm({
                        ...editForm,
                        currentCoa: { ...editForm.currentCoa, lot: e.target.value }
                      })
                    }
                  />
                </div>

                <div className="edit-field">
                  <label>Current COA URL</label>
                  <input
                    type="text"
                    value={editForm.currentCoa?.url || ''}
                    onChange={(e) =>
                      setEditForm({
                        ...editForm,
                        currentCoa: { ...editForm.currentCoa, url: e.target.value }
                      })
                    }
                  />
                </div>
              </div>
              <div className="modal-actions edit-actions">
                <button className="btn-cancel" onClick={() => setEditForm(null)}>Cancel</button>
                <button className="btn-neon-cyan" onClick={() => saveProduct(editForm)}>Save</button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};

export default ProductManager;
