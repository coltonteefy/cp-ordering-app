import React, { useEffect, useMemo, useState } from "react";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { db } from "../firebaseConfig";
import "./PaymentTracker.css";

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

function vendorColor(name, colorMap) {
  if (!name) return VENDOR_PALETTE[0];
  if (colorMap && colorMap[name]) return colorMap[name];
  if (VENDOR_COLORS[name]) return VENDOR_COLORS[name];
  let hash = 5381;
  for (let i = 0; i < name.length; i++) hash = ((hash << 5) + hash) ^ name.charCodeAt(i);
  return VENDOR_PALETTE[Math.abs(hash) % VENDOR_PALETTE.length];
}

const formatCurrency = (value) =>
  Number(value || 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const calculateOrderTotal = (orders) =>
  orders.reduce((sum, order) => {
    const raw = Number(order.total) || 0;
    const discount = Number(order.discountPercent) || 0;
    return sum + (raw - raw * (discount / 100));
  }, 0);

const PaymentTracker = ({ onError, onSuccess }) => {
  const methodOptions = ["Crypto", "Wire", "PayPal", "Alibaba"];
  const [payments, setPayments] = useState([]);
  const [pendingOrders, setPendingOrders] = useState([]);
  const [deliveredOrders, setDeliveredOrders] = useState([]);
  const [saving, setSaving] = useState(false);
  const [activeVendor, setActiveVendor] = useState('all');
  const [paymentsSyncedToProfiles, setPaymentsSyncedToProfiles] = useState(false);
  const [vendorColorMap, setVendorColorMap] = useState({});
  const [copiedTxId, setCopiedTxId] = useState(null);
  const [form, setForm] = useState(() => {
    const today = new Date().toISOString().slice(0, 10);
    return {
      amount: "",
      date: today,
      method: "Crypto",
      note: "",
      transferDate: today,
      transactionId: "",
      cryptoAmount: "",
      paidBy: "Colton",
      vendor: "TSC",
    };
  });

  useEffect(() => {
    const q = query(collection(db, "c&pPayments"), orderBy("date", "desc"));
    const unsub = onSnapshot(
      q,
      (snapshot) => {
        const list = snapshot.docs.map((docSnap) => ({
          id: docSnap.id,
          ...docSnap.data(),
        }));
        setPayments(list);

        // Backfill vendor:'TSC' on old payments missing it
        snapshot.docs.forEach((docSnap) => {
          if (!docSnap.data().vendor) {
            updateDoc(doc(db, 'c&pPayments', docSnap.id), { vendor: 'TSC' }).catch(() => {});
          }
        });

        // Sync all payments into vendor profiles (one-time)
        if (!paymentsSyncedToProfiles) {
          setPaymentsSyncedToProfiles(true);
          const byVendor = {};
          list.forEach((p) => {
            const v = p.vendor || 'TSC';
            if (!byVendor[v]) byVendor[v] = [];
            byVendor[v].push({
              paymentId: p.id,
              amount: p.amount,
              date: p.date,
              method: p.method,
              note: p.note || '',
              ...(p.cryptoTransactionId ? { cryptoTransactionId: p.cryptoTransactionId } : {}),
              ...(p.cryptoPaidBy ? { cryptoPaidBy: p.cryptoPaidBy } : {}),
              ...(p.cryptoAmount ? { cryptoAmount: p.cryptoAmount } : {}),
            });
          });
          Object.entries(byVendor).forEach(([vendorName, pmts]) => {
            const vendorDocId = vendorName === 'TSC' ? 'TSC' : vendorName.replace(/[^a-zA-Z0-9]/g, '_');
            getDoc(doc(db, 'c&pVendors', vendorDocId)).then((snap) => {
              if (snap.exists()) {
                const existing = snap.data().payments || [];
                const existingIds = new Set(existing.map(ep => ep.paymentId).filter(Boolean));
                const existingKeys = new Set(existing.map(ep => `${ep.amount}::${ep.date}::${ep.method}`));
                const newPmts = pmts.filter(p => {
                  if (p.paymentId && existingIds.has(p.paymentId)) return false;
                  if (!p.paymentId && existingKeys.has(`${p.amount}::${p.date}::${p.method}`)) return false;
                  return true;
                });
                if (newPmts.length > 0) {
                  setDoc(doc(db, 'c&pVendors', vendorDocId), {
                    payments: [...existing, ...newPmts],
                    updatedAt: new Date().toISOString()
                  }, { merge: true }).catch(() => {});
                }
              }
            }).catch(() => {});
          });
        }
      },
      (err) => {
        console.error("Error loading payments", err);
        onError && onError("Failed to load payments. Please refresh.");
      }
    );
    return () => unsub();
  }, [onError]);

  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, "c&pProductOrders"),
      (snapshot) => {
        const list = snapshot.docs.map((docSnap) => ({
          id: docSnap.id,
          ...docSnap.data(),
        }));
        setPendingOrders(list);
      },
      (err) => {
        console.error("Error loading pending orders", err);
      }
    );
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, "c&pPastInventoryOrders"),
      (snapshot) => {
        const list = snapshot.docs.map((docSnap) => ({
          id: docSnap.id,
          ...docSnap.data(),
        }));
        setDeliveredOrders(list);
      },
      (err) => {
        console.error("Error loading delivered orders", err);
      }
    );
    return () => unsub();
  }, []);

  // Load vendor colors from Firestore
  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, 'c&pVendors'),
      (snapshot) => {
        const colors = {};
        snapshot.forEach((snap) => {
          const data = snap.data();
          if (data.color) colors[data.name || snap.id] = data.color;
        });
        setVendorColorMap(colors);
      }
    );
    return () => unsubscribe();
  }, []);

  // Collect all vendor names from orders and payments
  const allVendors = useMemo(() => {
    const vendors = new Set();
    pendingOrders.forEach((o) => vendors.add(o.vendor || 'TSC'));
    deliveredOrders.forEach((o) => vendors.add(o.vendor || 'TSC'));
    payments.forEach((p) => { if (p.vendor) vendors.add(p.vendor); });
    return [...vendors].sort();
  }, [pendingOrders, deliveredOrders, payments]);

  // Filtered data based on active vendor
  const filteredPending = useMemo(
    () => activeVendor === 'all' ? pendingOrders : pendingOrders.filter((o) => (o.vendor || 'TSC') === activeVendor),
    [pendingOrders, activeVendor]
  );
  const filteredDelivered = useMemo(
    () => activeVendor === 'all' ? deliveredOrders : deliveredOrders.filter((o) => (o.vendor || 'TSC') === activeVendor),
    [deliveredOrders, activeVendor]
  );
  const filteredPayments = useMemo(
    () => activeVendor === 'all' ? payments : payments.filter((p) => (p.vendor || 'TSC') === activeVendor),
    [payments, activeVendor]
  );

  const totalPaid = useMemo(
    () => filteredPayments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0),
    [filteredPayments]
  );
  const pendingTotal = useMemo(
    () => calculateOrderTotal(filteredPending),
    [filteredPending]
  );
  const deliveredTotal = useMemo(
    () => calculateOrderTotal(filteredDelivered),
    [filteredDelivered]
  );
  const allOrdersTotal = useMemo(
    () => pendingTotal + deliveredTotal,
    [pendingTotal, deliveredTotal]
  );
  // Open balance should only change when payments are logged,
  // not when orders move between pending/delivered states.
  const outstanding = Math.max(allOrdersTotal - totalPaid, 0);
  const credit = Math.max(totalPaid - allOrdersTotal, 0);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const effectiveAmount =
      form.method === "Crypto"
        ? form.cryptoAmount || form.amount
        : form.amount;
    const amountNum = Number(effectiveAmount);
    if (!amountNum || amountNum <= 0) {
      onError && onError("Enter a payment amount greater than 0.");
      return;
    }
    if (form.method === "Crypto") {
      if (!form.transactionId.trim()) {
        onError && onError("Add a transaction ID for crypto payments.");
        return;
      }
      if (!form.paidBy) {
        onError && onError("Select who paid (Danny or Colton).");
        return;
      }
    }
    setSaving(true);
    try {
      const paymentDate =
        form.method === "Crypto"
          ? form.transferDate || form.date || new Date().toISOString().slice(0, 10)
          : form.date || new Date().toISOString().slice(0, 10);
      const payload = {
        amount: amountNum,
        date: paymentDate,
        method: form.method.trim(),
        note: form.method === "Crypto" ? "" : form.note.trim(),
        vendor: form.vendor || 'TSC',
        createdAt: serverTimestamp(),
      };
      if (form.method === "Crypto") {
        payload.cryptoTransferDate = form.transferDate || paymentDate;
        payload.cryptoTransactionId = form.transactionId.trim();
        payload.cryptoAmount = Number(form.cryptoAmount) || amountNum;
        payload.cryptoPaidBy = form.paidBy;
      }

      const paymentRef = await addDoc(collection(db, "c&pPayments"), payload);

      // Save payment to vendor profile
      const vendorName = payload.vendor || 'TSC';
      const vendorDocId = vendorName === 'TSC' ? 'TSC' : vendorName.replace(/[^a-zA-Z0-9]/g, '_');
      const profilePayment = {
        paymentId: paymentRef.id,
        amount: payload.amount,
        date: payload.date,
        method: payload.method,
        note: payload.note || '',
        ...(payload.cryptoTransactionId ? { cryptoTransactionId: payload.cryptoTransactionId } : {}),
        ...(payload.cryptoPaidBy ? { cryptoPaidBy: payload.cryptoPaidBy } : {}),
        ...(payload.cryptoAmount ? { cryptoAmount: payload.cryptoAmount } : {}),
      };
      getDoc(doc(db, 'c&pVendors', vendorDocId)).then((snap) => {
        if (snap.exists()) {
          const existing = snap.data().payments || [];
          setDoc(doc(db, 'c&pVendors', vendorDocId), {
            payments: [...existing, profilePayment],
            updatedAt: new Date().toISOString()
          }, { merge: true }).catch(() => {});
        }
      }).catch(() => {});

      const today = new Date().toISOString().slice(0, 10);
      setForm((prev) => ({
        amount: "",
        date: today,
        method: prev.method || "Crypto",
        note: "",
        transferDate: today,
        transactionId: "",
        cryptoAmount: "",
        paidBy: "Colton",
        vendor: prev.vendor || "TSC",
      }));
      onSuccess && onSuccess("Payment saved.");
    } catch (err) {
      console.error("Error saving payment", err);
      onError && onError("Could not save payment. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async (paymentId) => {
    try {
      await deleteDoc(doc(db, "c&pPayments", paymentId));
      onSuccess && onSuccess("Payment removed.");
    } catch (err) {
      console.error("Error deleting payment", err);
      onError && onError("Could not delete payment.");
    }
  };

  return (
    <section className="payment-tracker">
      <div className="payment-header">
        <div>
          <div className="payment-eyebrow">Cash Flow</div>
          <h2>Payment Tracker</h2>
          <p className="payment-subtitle">
            Record payouts and see how they stack up against current orders.
          </p>
        </div>
        <div className="chip-stack">
          <div className="info-chip">
            <div className="chip-label">{activeVendor === 'all' ? 'All Orders (lifetime)' : `${activeVendor} Orders (lifetime)`}</div>
            <div className="chip-value">${formatCurrency(allOrdersTotal)}</div>
          </div>
        </div>
      </div>

      <div className="payment-stats">
        <div className="stat-card paid-card">
          <span className="stat-label">Paid to Date</span>
          <span className="stat-value">${formatCurrency(totalPaid)}</span>
        </div>
        <div className="stat-card open-balance-card">
          <span className="stat-label">Open Balance</span>
          <span className="stat-value">${formatCurrency(outstanding)}</span>
          {credit > 0 && (
            <span className="chip-note">Credit: ${formatCurrency(credit)}</span>
          )}
        </div>
        <div className="stat-card delivered-card">
          <span className="stat-label">Delivered Orders</span>
          <span className="stat-value">${formatCurrency(deliveredTotal)}</span>
        </div>
        <div className="stat-card pending-card">
          <span className="stat-label">Pending Orders</span>
          <span className="stat-value">${formatCurrency(pendingTotal)}</span>
        </div>
      </div>

      <form className="payment-form-compact" onSubmit={handleSubmit}>
        <div className="form-inline-row">
            <label>
              Vendor
              <select
                value={form.vendor}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, vendor: e.target.value }))
                }
              >
                {allVendors.map((v) => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
            </label>
            <label>
              Method
              <select
                value={form.method}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    method: e.target.value,
                  }))
                }
              >
                {methodOptions.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </label>
            {form.method === "Crypto" ? (
              <>
                <label>
                  Paid By
                  <select
                    value={form.paidBy}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, paidBy: e.target.value }))
                    }
                  >
                    <option value="Colton">Colton</option>
                    <option value="Danny">Danny</option>
                  </select>
                </label>
                <label>
                  Amount
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={form.cryptoAmount}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        cryptoAmount: e.target.value,
                        amount: e.target.value,
                      }))
                    }
                    onFocus={(e) => e.target.select()}
                    placeholder="0.00"
                    required
                  />
                </label>
                <label>
                  Transfer Date
                  <input
                    type="date"
                    value={form.transferDate}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, transferDate: e.target.value }))
                    }
                    required
                  />
                </label>
                <label>
                  TX ID
                  <input
                    type="text"
                    value={form.transactionId}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, transactionId: e.target.value }))
                    }
                    placeholder="Hash / TX ID"
                    required
                  />
                </label>
              </>
            ) : (
              <>
                <label>
                  Date
                  <input
                    type="date"
                    value={form.date}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, date: e.target.value }))
                    }
                    required
                  />
                </label>
                <label>
                  Amount
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={form.amount}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, amount: e.target.value }))
                    }
                    onFocus={(e) => e.target.select()}
                    placeholder="0.00"
                    required
                  />
                </label>
                <label>
                  Note
                  <input
                    type="text"
                    value={form.note}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, note: e.target.value }))
                    }
                    placeholder="Optional"
                  />
                </label>
              </>
            )}
            <button type="submit" disabled={saving} className="form-inline-btn">
              {saving ? "Saving..." : "Log Payment"}
            </button>
        </div>
      </form>

      {/* Vendor Filter */}
      <div className="payment-vendor-tabs">
        <button
          className={`payment-vendor-tab ${activeVendor === 'all' ? 'active' : ''}`}
          onClick={() => setActiveVendor('all')}
        >
          All Vendors
        </button>
        {allVendors.map((v) => (
          <button
            key={v}
            className={`payment-vendor-tab ${activeVendor === v ? 'active' : ''}`}
            onClick={() => { setActiveVendor(v); setForm((prev) => ({ ...prev, vendor: v })); }}
          >
            {v}
          </button>
        ))}
      </div>

      <div className="payment-body">
        <div className="payment-list">
          <div className="payment-list-header">
            <div className="payment-list-title-row">
              <h3>Payment History</h3>
              <span className="payment-view-pill">{activeVendor === 'all' ? 'All Vendors' : activeVendor}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span className="payment-count">
                {filteredPayments.length} {filteredPayments.length === 1 ? "entry" : "entries"}
              </span>
              {filteredPayments.length > 0 && (
                <button
                  className="payment-download-btn"
                  onClick={() => {
                    const headers = ['Date', 'Vendor', 'Amount', 'Method', 'Note', 'Transaction ID'];
                    const rows = filteredPayments.map(p => [
                      p.date || '',
                      p.vendor || 'TSC',
                      p.amount || 0,
                      p.method || '',
                      p.note || '',
                      p.cryptoTransactionId || '',
                    ]);
                    const csv = [headers, ...rows]
                      .map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
                      .join('\n');
                    const blob = new Blob([csv], { type: 'text/csv' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `payments-${activeVendor === 'all' ? 'all' : activeVendor}-${new Date().toISOString().slice(0, 10)}.csv`;
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                >
                  ↓ CSV
                </button>
              )}
            </div>
          </div>
          {filteredPayments.length === 0 ? (
            <div className="empty-payments">No payments logged yet.</div>
          ) : (
            <div className="payment-scroll">
              <table className="payment-table">
                <thead>
                  <tr>
                    <th>Amount</th>
                    <th>Date</th>
                    <th>Vendor</th>
                    <th>Method</th>
                    <th>Note / TX</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPayments.map((payment) => {
                    const vColor = vendorColor(payment.vendor, vendorColorMap);
                    return (
                      <tr key={payment.id} className="payment-table-row">
                        <td className="payment-table-amount">${formatCurrency(payment.amount)}</td>
                        <td className="payment-table-date">{payment.date || '—'}</td>
                        <td>
                          {payment.vendor && (
                            <span
                              className="payment-table-vendor"
                              style={{ background: vColor + '1A', borderColor: vColor, color: vColor }}
                            >{payment.vendor}</span>
                          )}
                        </td>
                        <td>
                          {payment.method && <span className="payment-table-method">{payment.method}</span>}
                        </td>
                        <td className="payment-table-notes">
                          {payment.note && <span className="payment-table-note">{payment.note}</span>}
                          {payment.method === 'Crypto' && payment.cryptoTransactionId && (
                            <span
                              className={`payment-table-tx${copiedTxId === payment.id ? ' copied' : ''}`}
                              onClick={() => {
                                navigator.clipboard.writeText(payment.cryptoTransactionId);
                                setCopiedTxId(payment.id);
                                setTimeout(() => setCopiedTxId(null), 1500);
                              }}
                              title="Click to copy"
                            >{copiedTxId === payment.id ? 'Copied!' : `TX: ${payment.cryptoTransactionId}`}</span>
                          )}
                          {payment.method === 'Crypto' && payment.cryptoPaidBy && (
                            <span className="payment-table-extra">Paid by {payment.cryptoPaidBy}</span>
                          )}
                          {payment.method === 'Crypto' && payment.cryptoTransferDate && (
                            <span className="payment-table-extra">Transfer: {payment.cryptoTransferDate}</span>
                          )}
                        </td>
                        <td>
                          <button
                            className="payment-table-remove"
                            type="button"
                            onClick={() => handleRemove(payment.id)}
                          >Remove</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </section>
  );
};

export default PaymentTracker;
