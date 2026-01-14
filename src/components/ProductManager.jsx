import { useState, useEffect } from 'react';
import { collection, onSnapshot, doc, setDoc } from 'firebase/firestore';
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
  const [newProduct, setNewProduct] = useState({ product: '', strength: '', costPerKit: 0 });

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
            firestoreProducts.push({
              id: doc.id,
              ...doc.data()
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
          costPerKit: product.costPerKit
        });
      }
      onSuccess('All products saved to Firestore!', 'Success');
    } catch (error) {
      console.error('Error saving products:', error);
      onError('Failed to save products: ' + error.message, 'Error');
    }
  };

  const updateProductCost = (id, newCost) => {
    setProducts(products.map(p => 
      p.id === id ? { ...p, costPerKit: parseFloat(newCost) || 0 } : p
    ));
  };

  const saveProduct = async (product) => {
    try {
      const docId = `${product.product.replace(/[^a-zA-Z0-9]/g, '_')}_${product.strength.replace(/[^a-zA-Z0-9]/g, '_')}`;
      await setDoc(doc(db, 'cpCostPerKit', docId), {
        product: product.product,
        strength: product.strength,
        costPerKit: product.costPerKit
      });
      setEditingProduct(null);
    } catch (error) {
      console.error('Error updating product:', error);
      onError('Failed to update product: ' + error.message, 'Error');
    }
  };

  const addNewProduct = async () => {
    if (!newProduct.product.trim() || !newProduct.strength.trim()) {
      onError('Please fill in product name and strength', 'Validation Error');
      return;
    }

    try {
      const docId = `${newProduct.product.replace(/[^a-zA-Z0-9]/g, '_')}_${newProduct.strength.replace(/[^a-zA-Z0-9]/g, '_')}`;
      await setDoc(doc(db, 'cpCostPerKit', docId), {
        product: newProduct.product,
        strength: newProduct.strength,
        costPerKit: parseFloat(newProduct.costPerKit) || 0
      });
      setNewProduct({ product: '', strength: '', costPerKit: 0 });
      setShowAddForm(false);
    } catch (error) {
      console.error('Error adding product:', error);
      onError('Failed to add product: ' + error.message, 'Error');
    }
  };

  return (
    <div className="product-manager">
      <div className="manager-header">
        <h2 className="text-glow-fuchsia">Product Cost Manager</h2>
        <button onClick={() => setShowAddForm(!showAddForm)} className="btn-neon-cyan">
          {showAddForm ? 'Cancel' : 'Add Product'}
        </button>
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
              <input
                type="text"
                value={newProduct.strength}
                onChange={(e) => setNewProduct({ ...newProduct, strength: e.target.value })}
                placeholder="e.g., 10 mg"
              />
            </div>
            <div className="form-field">
              <label>Cost per Kit ($)</label>
              <input
                type="text"
                value={newProduct.costPerKit}
                onChange={(e) => setNewProduct({ ...newProduct, costPerKit: e.target.value })}
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
              <th>Cost per Kit ($)</th>
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
                      value={product.costPerKit}
                      onChange={(e) => updateProductCost(product.id, e.target.value)}
                      className="cost-input-edit"
                      autoFocus
                    />
                  ) : (
                    <span className="cost-display">${product.costPerKit.toFixed(2)}</span>
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
