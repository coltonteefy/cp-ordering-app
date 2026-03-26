import { useState, useEffect, useCallback, useMemo } from 'react';
import ReactDOM from 'react-dom';
import { collection, onSnapshot, doc, setDoc, getDocs } from 'firebase/firestore';
import { db } from '../firebaseConfig';
import './ProductManager.css';

const buildDocId = (product, strength) =>
  `${product.replace(/[^a-zA-Z0-9]/g, '_')}_${strength.replace(/[^a-zA-Z0-9]/g, '_')}`;

const VENDOR_COLORS = {
  TSC: '#8B6914',
  Josh: '#5B7B5D',
  SRY: '#5C7A99',
  ALLEN: '#A0522D',
};

const VENDOR_PALETTE = [
  '#7B5A7B', '#3D7A7A', '#8C7B3A', '#B87333',
  '#6B5B73', '#8B5E3C', '#6B8E6B', '#7A6352',
  '#4E7A6B', '#8B7355'
];

const WALLET_LABEL_PRESETS = [
  'USDC (Base)',
  'USDC(Eth)',
  'Bitcoin',
  'Ethereum',
  'Solana'
];

function vendorColor(name) {
  if (!name) return VENDOR_PALETTE[0];
  if (VENDOR_COLORS[name]) return VENDOR_COLORS[name];
  let hash = 5381;
  for (let i = 0; i < name.length; i++) hash = ((hash << 5) + hash) ^ name.charCodeAt(i);
  return VENDOR_PALETTE[Math.abs(hash) % VENDOR_PALETTE.length];
}

const ProductManager = ({ onSuccess, onError }) => {
  const [products, setProducts] = useState([]);
  const [editForm, setEditForm] = useState(null);
  const [isClosing, setIsClosing] = useState(false);
  const [hasInitialized, setHasInitialized] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newProduct, setNewProduct] = useState({ product: '', strength: '', warehouseCosts: { US: 0, HK: 0 }, vendor: 'TSC' });
  const [newVendorProduct, setNewVendorProduct] = useState({ product: '', strength: '', price: 0 });
  const [vendors, setVendors] = useState([]);
  const [selectedVendorProfile, setSelectedVendorProfile] = useState('');
  const [tscSynced, setTscSynced] = useState(false);
  const [editingColor, setEditingColor] = useState(false);
  const [newWallet, setNewWallet] = useState({ label: '', address: '' });
  const [showWalletComposer, setShowWalletComposer] = useState(false);
  const [showPaymentHistoryModal, setShowPaymentHistoryModal] = useState(false);
  const [copiedWalletId, setCopiedWalletId] = useState(null);
  const [editingWalletId, setEditingWalletId] = useState(null);
  const [walletEditForm, setWalletEditForm] = useState({ label: '', address: '' });
  const [selectedWalletLabelPreset, setSelectedWalletLabelPreset] = useState('USDC');

  const saveAllToFirestore = useCallback(async () => {
    try {
      for (const product of products) {
        const docId = product.docId || buildDocId(product.product, product.strength);
        await setDoc(doc(db, 'c&pProductList', docId), {
          id: product.id || docId,
          product: product.product,
          strength: product.strength,
          warehouseCosts: product.warehouseCosts || { US: 0, HK: 0 },
          vendor: product.vendor || 'TSC',
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
          vendor: product.vendor || 'TSC',
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
              vendor: data.vendor || 'TSC',
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

  // Load vendor profiles
  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, 'c&pVendors'),
      (snapshot) => {
        const vendorList = [];
        snapshot.forEach((snap) => {
          vendorList.push({ id: snap.id, ...snap.data() });
        });
        setVendors(vendorList);
      },
      (error) => {
        console.error('Error loading vendors:', error);
      }
    );
    return () => unsubscribe();
  }, []);

  // Sync TSC products into c&pVendors as a vendor profile
  useEffect(() => {
    if (!products.length || tscSynced) return;
    const tscProducts = products.filter(p => (p.vendor || 'TSC') === 'TSC');
    if (!tscProducts.length) return;

    const productsMap = {};
    tscProducts.forEach(p => {
      const key = `${p.product}__${p.strength}`;
      productsMap[key] = {
        product: p.product,
        strength: p.strength,
        price: p.warehouseCosts?.US || 0,
        priceHK: p.warehouseCosts?.HK || 0,
        lastOrdered: null
      };
    });

    setDoc(doc(db, 'c&pVendors', 'TSC'), {
      name: 'TSC',
      products: productsMap,
      updatedAt: new Date().toISOString()
    }, { merge: true }).then(() => {
      setTscSynced(true);
    }).catch(err => console.error('Error syncing TSC profile:', err));
  }, [products, tscSynced]);

  // Auto-select first vendor once loaded
  useEffect(() => {
    if (!selectedVendorProfile && vendors.length > 0) {
      const tsc = vendors.find(v => v.name === 'TSC');
      setSelectedVendorProfile(tsc ? tsc.id : vendors[0].id);
    }
  }, [vendors, selectedVendorProfile]);

  // Auto-assign colors to vendors that don't have one
  useEffect(() => {
    if (!vendors.length) return;
    vendors.forEach(v => {
      if (!v.color) {
        const color = vendorColor(v.name);
        setDoc(doc(db, 'c&pVendors', v.id), { color }, { merge: true })
          .catch(err => console.error('Error assigning vendor color:', err));
      }
    });
  }, [vendors]);

  // Active vendor profile data
  const activeProfile = useMemo(() => {
    if (!selectedVendorProfile) return null;
    return vendors.find(v => v.id === selectedVendorProfile) || null;
  }, [vendors, selectedVendorProfile]);

  const isTSC = activeProfile?.name === 'TSC';
  const profileColor = activeProfile?.color || (activeProfile ? vendorColor(activeProfile.name) : null);

  const ALL_SWATCHES = [
    '#8B6914', '#5B7B5D', '#5C7A99', '#A0522D',
    '#7B5A7B', '#3D7A7A', '#8C7B3A', '#B87333',
    '#6B5B73', '#8B5E3C', '#6B8E6B', '#7A6352',
    '#4E7A6B', '#8B7355'
  ];

  const updateVendorColor = async (color) => {
    if (!activeProfile) return;
    try {
      await setDoc(doc(db, 'c&pVendors', activeProfile.id), { color }, { merge: true });
      setEditingColor(false);
    } catch (error) {
      console.error('Error updating vendor color:', error);
    }
  };

  // Payments from the vendor profile
  const vendorPayments = useMemo(() => {
    if (!activeProfile?.payments) return [];
    const seenIds = new Set();
    const seenKeys = new Set();
    const deduped = activeProfile.payments.filter(p => {
      const compoundKey = `${p.amount}::${p.date}::${p.method}`;
      if (seenKeys.has(compoundKey)) return false;
      if (p.paymentId && seenIds.has(p.paymentId)) return false;
      if (p.paymentId) seenIds.add(p.paymentId);
      seenKeys.add(compoundKey);
      return true;
    });
    return deduped.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  }, [activeProfile]);

  const vendorTotalPaid = useMemo(() => {
    return vendorPayments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
  }, [vendorPayments]);

  const vendorWallets = useMemo(() => {
    return activeProfile?.wallets || [];
  }, [activeProfile]);

  const addWallet = async () => {
    if (!activeProfile || !newWallet.address.trim()) return;
    const resolvedLabel = selectedWalletLabelPreset === '__custom__'
      ? newWallet.label.trim()
      : selectedWalletLabelPreset;
    const wallets = [...vendorWallets, { id: Date.now().toString(), label: resolvedLabel, address: newWallet.address.trim() }];
    await setDoc(doc(db, 'c&pVendors', activeProfile.id), { wallets }, { merge: true });
    setNewWallet({ label: '', address: '' });
    setShowWalletComposer(false);
    setSelectedWalletLabelPreset('USDC');
  };

  const removeWallet = async (walletId) => {
    if (!activeProfile) return;
    const wallets = vendorWallets.filter(w => w.id !== walletId);
    await setDoc(doc(db, 'c&pVendors', activeProfile.id), { wallets }, { merge: true });
    if (editingWalletId === walletId) {
      setEditingWalletId(null);
      setWalletEditForm({ label: '', address: '' });
    }
  };

  const startWalletEdit = (wallet) => {
    setEditingWalletId(wallet.id);
    setWalletEditForm({
      label: wallet.label || '',
      address: wallet.address || '',
    });
  };

  const cancelWalletEdit = () => {
    setEditingWalletId(null);
    setWalletEditForm({ label: '', address: '' });
  };

  const saveWalletEdit = async (walletId) => {
    if (!activeProfile || !walletEditForm.address.trim()) return;
    const wallets = vendorWallets.map((wallet) =>
      wallet.id === walletId
        ? {
            ...wallet,
            label: walletEditForm.label.trim(),
            address: walletEditForm.address.trim(),
          }
        : wallet
    );
    await setDoc(doc(db, 'c&pVendors', activeProfile.id), { wallets }, { merge: true });
    setEditingWalletId(null);
    setWalletEditForm({ label: '', address: '' });
  };

  const copyWalletAddress = async (walletId, address) => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopiedWalletId(walletId);
      window.setTimeout(() => {
        setCopiedWalletId((current) => (current === walletId ? null : current));
      }, 1100);
    } catch (error) {
      onError && onError('Failed to copy wallet address.', 'Error');
    }
  };

  const profileProducts = useMemo(() => {
    if (!activeProfile?.products) return [];
    return Object.values(activeProfile.products)
      .sort((a, b) => (a.product || '').localeCompare(b.product || '') || (a.strength || '').localeCompare(b.strength || ''));
  }, [activeProfile]);

  // All vendor options for the selector
  const vendorOptions = useMemo(() => {
    return [...vendors]
      .sort((a, b) => {
        if (a.name === 'TSC') return -1;
        if (b.name === 'TSC') return 1;
        return (a.name || '').localeCompare(b.name || '');
      })
      .map(v => ({
        id: v.id,
        name: v.name,
        count: v.products ? Object.keys(v.products).length : 0
      }));
  }, [vendors]);

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
        vendor: product.vendor || 'TSC',
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
      handleClose();
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

  useEffect(() => {
    if (editForm) setIsClosing(false);
  }, [editForm]);

  const handleClose = () => {
    if (!editForm || isClosing) return;
    setIsClosing(true);
    setTimeout(() => {
      setEditForm(null);
      setIsClosing(false);
    }, 260);
  };

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
        vendor: newProduct.vendor || 'TSC',
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
          vendor: newProduct.vendor || 'TSC',
          canvaTemplateUrl: newProduct.canvaTemplateUrl || '',
          currentCoa: newProduct.currentCoa || { lot: '', url: '' },
          pastCoas: newProduct.pastCoas || []
        }
      ]);
      setNewProduct({ product: '', strength: '', warehouseCosts: { US: 0, HK: 0 }, vendor: 'TSC' });
      setShowAddForm(false);
    } catch (error) {
      console.error('Error adding product:', error);
      onError('Failed to add product: ' + error.message, 'Error');
    }
  };

  const addVendorProduct = async () => {
    const strengthValue = newVendorProduct.strength.replace(/[^0-9.]/g, '').trim();
    if (!newVendorProduct.product.trim() || !strengthValue) {
      onError('Please fill in product name and strength', 'Validation Error');
      return;
    }
    try {
      const vendorId = selectedVendorProfile;
      const vendorProfile = vendors.find(v => v.id === vendorId);
      if (!vendorProfile) {
        onError('Vendor profile not found', 'Error');
        return;
      }
      const strength = newVendorProduct.strength || strengthValue + ' mg';
      const key = `${newVendorProduct.product}__${strength}`;
      const updatedProducts = {
        ...(vendorProfile.products || {}),
        [key]: {
          product: newVendorProduct.product,
          strength,
          price: parseFloat(newVendorProduct.price) || 0,
          ...(isTSC ? { priceHK: parseFloat(newVendorProduct.priceHK) || 0 } : {}),
          lastOrdered: null
        }
      };
      await setDoc(doc(db, 'c&pVendors', vendorId), {
        ...vendorProfile,
        products: updatedProducts,
        updatedAt: new Date().toISOString()
      });

      // If TSC, also add to c&pProductList
      if (isTSC) {
        const docId = buildDocId(newVendorProduct.product, strength);
        await setDoc(doc(db, 'c&pProductList', docId), {
          id: docId,
          product: newVendorProduct.product,
          strength,
          warehouseCosts: {
            US: parseFloat(newVendorProduct.price) || 0,
            HK: parseFloat(newVendorProduct.priceHK) || 0
          },
          vendor: 'TSC',
          canvaTemplateUrl: '',
          currentCoa: { lot: '', url: '' },
          pastCoas: []
        });
      }

      setNewVendorProduct({ product: '', strength: '', price: 0, priceHK: 0 });
      setShowAddForm(false);
      onSuccess(`Product added to ${vendorProfile.name}`, 'Success');
    } catch (error) {
      console.error('Error adding vendor product:', error);
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
          vendor: data.vendor || 'TSC',
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
      <div className="product-hero">
        <div className="product-hero-text">
          <span className="product-hero-eyebrow">Products</span>
          <h1>Vendor profiles &amp; pricing</h1>
          <p>Select a vendor to view all stored product pricing and manage your catalog.</p>
        </div>
        <div className="product-hero-metrics">
          <div className="product-metric-card">
            <div className="product-metric-label">Total products</div>
            <div className="product-metric-value">{products.length}</div>
          </div>
          <div className="product-metric-card">
            <div className="product-metric-label">Vendors</div>
            <div className="product-metric-value">{vendorOptions.length}</div>
          </div>
        </div>
      </div>

      <div className="vendor-profiles-section">
        <div className="vendor-profiles-header">
          <div className="vendor-profile-tabs">
            {vendorOptions.map(v => {
              const vColor = v.id === selectedVendorProfile
                ? (vendors.find(x => x.id === v.id)?.color || vendorColor(v.name))
                : undefined;
              return (
                <button
                  key={v.id}
                  className={`vendor-profile-tab${v.id === selectedVendorProfile ? ' active' : ''}`}
                  style={v.id === selectedVendorProfile ? { background: vColor, borderColor: vColor } : undefined}
                  onClick={() => { setSelectedVendorProfile(v.id); setShowAddForm(false); }}
                >
                  {v.name}
                  <span className="vendor-profile-tab-count">{v.count}</span>
                </button>
              );
            })}
          </div>
          <button onClick={() => setShowAddForm(!showAddForm)} className="btn-neon-cyan">
            {showAddForm ? 'Cancel' : 'Add Product'}
          </button>
          <button
            className="vendor-wallet-toggle-btn"
            onClick={() => setShowWalletComposer(true)}
            style={{ borderColor: profileColor + '40', color: profileColor }}
          >
            + Add Wallet
          </button>
        </div>

        {showAddForm && (
          <div className="add-product-form">
            <h3>Add Product to {activeProfile?.name}</h3>
            <div className="form-row">
              <div className="form-field">
                <label>Product Name</label>
                <input
                  type="text"
                  value={newVendorProduct.product}
                  onChange={(e) => setNewVendorProduct({ ...newVendorProduct, product: e.target.value })}
                  placeholder="e.g., BPC-157"
                />
              </div>
              <div className="form-field">
                <label>Strength</label>
                <div className="strength-input-wrapper">
                  <input
                    type="number"
                    value={(newVendorProduct.strength || '').replace(/[^0-9.]/g, '')}
                    onChange={(e) => setNewVendorProduct({ ...newVendorProduct, strength: e.target.value + ' mg' })}
                    placeholder="10"
                    className="strength-number"
                  />
                  <span className="strength-unit">mg</span>
                </div>
              </div>
              <div className="form-field">
                <label>Price per Kit ($)</label>
                <input
                  type="number"
                  step="0.01"
                  value={newVendorProduct.price}
                  onChange={(e) => setNewVendorProduct({ ...newVendorProduct, price: parseFloat(e.target.value) || 0 })}
                  onFocus={(e) => e.target.select()}
                  placeholder="0.00"
                />
              </div>
              {isTSC && (
                <div className="form-field">
                  <label>HK Price per Kit ($)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={newVendorProduct.priceHK || 0}
                    onChange={(e) => setNewVendorProduct({ ...newVendorProduct, priceHK: parseFloat(e.target.value) || 0 })}
                    onFocus={(e) => e.target.select()}
                    placeholder="0.00"
                  />
                </div>
              )}
              <div className="form-field">
                <button onClick={addVendorProduct} className="btn-neon-lime add-product-btn">
                  Add Product
                </button>
              </div>
            </div>
          </div>
        )}

        {activeProfile && (
          <div className="vendor-profile-card" style={{ borderTop: `3px solid ${profileColor}`, borderColor: profileColor + '40', boxShadow: `0 4px 16px ${profileColor}14` }}>
            <div className="vendor-profile-info">
              <div className="vendor-profile-name-row">
                <button
                  className="vendor-color-dot-btn"
                  style={{ background: profileColor }}
                  onClick={() => setEditingColor(!editingColor)}
                  title="Change vendor color"
                />
                <span className="vendor-profile-name" style={{ color: profileColor }}>{activeProfile.name}</span>
              </div>
              {editingColor && (
                <div className="vendor-color-editor">
                  {ALL_SWATCHES.map(c => (
                    <button
                      key={c}
                      className={`vendor-color-swatch${profileColor === c ? ' active' : ''}`}
                      style={{ background: c }}
                      onClick={() => updateVendorColor(c)}
                    />
                  ))}
                  <input
                    type="color"
                    className="vendor-color-custom"
                    value={profileColor}
                    onChange={(e) => updateVendorColor(e.target.value)}
                    title="Pick custom color"
                  />
                </div>
              )}
              <span className="vendor-profile-stat">
                {profileProducts.length} product{profileProducts.length !== 1 ? 's' : ''} on file
              </span>
              {vendorPayments.length > 0 && (
                <button
                  className="vendor-profile-stat vendor-profile-stat-payments vendor-profile-stat-payments-btn"
                  style={{ borderColor: profileColor + '40', background: profileColor + '0D', color: profileColor }}
                  onClick={() => setShowPaymentHistoryModal(true)}
                >
                  ${vendorTotalPaid.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} paid ({vendorPayments.length} payment{vendorPayments.length !== 1 ? 's' : ''})
                </button>
              )}
              <div className="vendor-profile-wallets-inline">
                {vendorWallets.length > 0 && (
                  <div className="vendor-wallets-list vendor-wallets-list-inline">
                    {vendorWallets.map((w) => (
                      <div key={w.id} className={`vendor-wallet-card vendor-wallet-card-inline${editingWalletId === w.id ? ' is-editing' : ''}`} style={{ borderLeftColor: profileColor }}>
                        {copiedWalletId === w.id && (
                          <span className="vendor-wallet-toast" aria-hidden="true">Copied</span>
                        )}
                        <div className="vendor-wallet-info">
                          {editingWalletId === w.id ? (
                            <>
                              <div className="vendor-wallet-meta-row vendor-wallet-meta-row-editing">
                                <input
                                  type="text"
                                  value={walletEditForm.label}
                                  onChange={(e) => setWalletEditForm((prev) => ({ ...prev, label: e.target.value }))}
                                  className="vendor-wallet-input vendor-wallet-input-card-label"
                                  placeholder="Label"
                                />
                                <button
                                  className="vendor-wallet-remove"
                                  onClick={() => removeWallet(w.id)}
                                >Remove</button>
                              </div>
                              <input
                                type="text"
                                value={walletEditForm.address}
                                onChange={(e) => setWalletEditForm((prev) => ({ ...prev, address: e.target.value }))}
                                className="vendor-wallet-input vendor-wallet-input-card-address"
                                placeholder="Wallet address"
                              />
                              <div className="vendor-wallet-edit-actions">
                                <button
                                  className="vendor-wallet-toggle-btn vendor-wallet-toggle-btn-secondary"
                                  onClick={cancelWalletEdit}
                                >Cancel</button>
                                <button
                                  className="vendor-wallet-add-btn"
                                  onClick={() => saveWalletEdit(w.id)}
                                  disabled={!walletEditForm.address.trim()}
                                  style={{ background: profileColor }}
                                >Save</button>
                              </div>
                            </>
                          ) : (
                            <>
                              <div className="vendor-wallet-meta-row">
                                {w.label && <span className="vendor-wallet-label">{w.label}</span>}
                                <button
                                  className="vendor-wallet-edit-btn"
                                  onClick={() => startWalletEdit(w)}
                                >Edit</button>
                              </div>
                              <button
                                type="button"
                                className={`vendor-wallet-address${copiedWalletId === w.id ? ' copied' : ''}`}
                                title={copiedWalletId === w.id ? 'Copied' : 'Click to copy wallet address'}
                                onClick={() => copyWalletAddress(w.id, w.address)}
                              >
                                <span className="vendor-wallet-address-text">{w.address}</span>
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {showWalletComposer && ReactDOM.createPortal(
              <div
                className="vendor-wallet-modal-backdrop"
                onClick={() => {
                  setShowWalletComposer(false);
                  setNewWallet({ label: '', address: '' });
                }}
              >
                <div
                  className="vendor-wallet-modal"
                  onClick={(e) => e.stopPropagation()}
                  style={{ borderColor: profileColor + '30' }}
                >
                  <div className="vendor-wallet-modal-header">
                    <div>
                      <h3 className="vendor-wallet-modal-title">Add Wallet</h3>
                      <p className="vendor-wallet-modal-subtitle">Save a crypto wallet for {activeProfile.name}.</p>
                    </div>
                    <button
                      className="vendor-wallet-modal-close"
                      onClick={() => {
                        setShowWalletComposer(false);
                        setNewWallet({ label: '', address: '' });
                      }}
                    >
                      Cancel
                    </button>
                  </div>

                  <div className="vendor-wallet-modal-body">
                    <div className="vendor-wallet-label-picker">
                      <div className="vendor-wallet-field-label">Label</div>
                      <div className="vendor-wallet-label-pills">
                        {WALLET_LABEL_PRESETS.map((preset) => (
                          <button
                            key={preset}
                            type="button"
                            className={`vendor-wallet-label-pill${selectedWalletLabelPreset === preset ? ' active' : ''}`}
                            onClick={() => {
                              setSelectedWalletLabelPreset(preset);
                              setNewWallet((prev) => ({ ...prev, label: preset }));
                            }}
                          >
                            {preset}
                          </button>
                        ))}
                        <button
                          type="button"
                          className={`vendor-wallet-label-pill${selectedWalletLabelPreset === '__custom__' ? ' active' : ''}`}
                          onClick={() => {
                            setSelectedWalletLabelPreset('__custom__');
                            setNewWallet((prev) => ({ ...prev, label: '' }));
                          }}
                        >
                          Custom
                        </button>
                      </div>
                      {selectedWalletLabelPreset === '__custom__' && (
                        <input
                          type="text"
                          placeholder="Custom label"
                          value={newWallet.label}
                          onChange={(e) => setNewWallet(prev => ({ ...prev, label: e.target.value }))}
                          className="vendor-wallet-input vendor-wallet-modal-input"
                        />
                      )}
                    </div>
                    <input
                      type="text"
                      placeholder="Wallet address"
                      value={newWallet.address}
                      onChange={(e) => setNewWallet(prev => ({ ...prev, address: e.target.value }))}
                      className="vendor-wallet-input vendor-wallet-input-address vendor-wallet-modal-input"
                      onKeyDown={(e) => e.key === 'Enter' && addWallet()}
                    />
                  </div>

                  <div className="vendor-wallet-modal-actions">
                    <button
                      className="vendor-wallet-toggle-btn vendor-wallet-toggle-btn-secondary"
                      onClick={() => {
                        setShowWalletComposer(false);
                        setNewWallet({ label: '', address: '' });
                      }}
                    >
                      Close
                    </button>
                    <button
                      className="vendor-wallet-add-btn"
                      onClick={addWallet}
                      disabled={!newWallet.address.trim()}
                      style={{ background: profileColor }}
                    >
                      Save Wallet
                    </button>
                  </div>
                </div>
              </div>,
              document.body
            )}

            {profileProducts.length > 0 ? (
              <div className="vendor-profile-table-wrap">
                <table className="vendor-profile-table">
                  <thead>
                    <tr>
                      <th style={{ borderBottomColor: profileColor + '40' }}>Product</th>
                      <th style={{ borderBottomColor: profileColor + '40' }}>Strength</th>
                      <th style={{ borderBottomColor: profileColor + '40' }}>{isTSC ? 'US Cost / Kit' : 'Price / Kit'}</th>
                      {isTSC && <th style={{ borderBottomColor: profileColor + '40' }}>HK Cost / Kit</th>}
                      <th style={{ borderBottomColor: profileColor + '40' }}>Last Ordered</th>
                    </tr>
                  </thead>
                  <tbody>
                    {profileProducts.map((p, i) => (
                      <tr key={i}>
                        <td className="product-table-name">{p.product}</td>
                        <td>{p.strength || '—'}</td>
                        <td className="vendor-profile-price" style={{ color: profileColor }}>
                          ${(p.price || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                        {isTSC && (
                          <td className="vendor-profile-price" style={{ color: profileColor }}>
                            ${(p.priceHK || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </td>
                        )}
                        <td className="vendor-profile-date">
                          {p.lastOrdered ? new Date(p.lastOrdered).toLocaleDateString() : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="vendor-profile-empty">No pricing data yet. Prices are saved when you submit orders for this vendor.</p>
            )}

            {showPaymentHistoryModal && ReactDOM.createPortal(
              <div
                className="vendor-wallet-modal-backdrop"
                onClick={() => setShowPaymentHistoryModal(false)}
              >
                <div
                  className="vendor-wallet-modal vendor-payment-history-modal"
                  onClick={(e) => e.stopPropagation()}
                  style={{ borderColor: profileColor + '30' }}
                >
                  <div className="vendor-wallet-modal-header">
                    <div>
                      <h3 className="vendor-wallet-modal-title">Payment History</h3>
                      <p className="vendor-wallet-modal-subtitle" style={{ color: profileColor }}>
                        {activeProfile?.name} · ${vendorTotalPaid.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} total
                      </p>
                    </div>
                    <button className="vendor-wallet-modal-close" onClick={() => setShowPaymentHistoryModal(false)}>✕</button>
                  </div>
                  <div className="vendor-wallet-modal-body">
                    <div className="vendor-profile-table-wrap">
                      <table className="vendor-profile-table">
                        <thead>
                          <tr>
                            <th style={{ borderBottomColor: profileColor + '40' }}>Date</th>
                            <th style={{ borderBottomColor: profileColor + '40' }}>Amount</th>
                            <th style={{ borderBottomColor: profileColor + '40' }}>Method</th>
                            <th style={{ borderBottomColor: profileColor + '40' }}>Details</th>
                          </tr>
                        </thead>
                        <tbody>
                          {vendorPayments.map((pmt) => (
                            <tr key={pmt.id}>
                              <td className="vendor-profile-date">
                                {pmt.date ? new Date(pmt.date + 'T00:00:00').toLocaleDateString() : '—'}
                              </td>
                              <td className="vendor-profile-price" style={{ color: profileColor }}>
                                ${(pmt.amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </td>
                              <td>
                                <span className={`pill payment-method-pill method-${(pmt.method || '').toLowerCase()}`}>{pmt.method || '—'}</span>
                              </td>
                              <td className="vendor-payment-details">
                                {pmt.method === 'Crypto' ? (
                                  <>
                                    {pmt.cryptoPaidBy && <span>Paid by {pmt.cryptoPaidBy}</span>}
                                    {pmt.cryptoTransactionId && <span className="vendor-payment-txid" title={pmt.cryptoTransactionId}>TX: {pmt.cryptoTransactionId.slice(0, 12)}…</span>}
                                  </>
                                ) : (
                                  pmt.note || '—'
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </div>,
              document.body
            )}
          </div>
        )}
      </div>

      {editForm &&
        ReactDOM.createPortal(
          <div className={`product-edit-overlay ${isClosing ? 'closing' : 'open'}`}>
            <div className="edit-backdrop" onClick={handleClose}></div>
            <div className={`edit-drawer ${isClosing ? 'closing' : 'open'}`}>
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

                <div className="edit-field">
                  <label>Vendor</label>
                  <input
                    type="text"
                    value={editForm.vendor || 'TSC'}
                    onChange={(e) => setEditForm({ ...editForm, vendor: e.target.value })}
                    placeholder="e.g., TSC"
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
