import React, { useEffect, useMemo, useState } from "react";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../firebaseConfig";
import "./PaymentTracker.css";

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
      paidBy: "",
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

  const totalPaid = useMemo(
    () => payments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0),
    [payments]
  );
  const pendingTotal = useMemo(
    () => calculateOrderTotal(pendingOrders),
    [pendingOrders]
  );
  const deliveredTotal = useMemo(
    () => calculateOrderTotal(deliveredOrders),
    [deliveredOrders]
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
        createdAt: serverTimestamp(),
      };
      if (form.method === "Crypto") {
        payload.cryptoTransferDate = form.transferDate || paymentDate;
        payload.cryptoTransactionId = form.transactionId.trim();
        payload.cryptoAmount = Number(form.cryptoAmount) || amountNum;
        payload.cryptoPaidBy = form.paidBy;
      }

      await addDoc(collection(db, "c&pPayments"), payload);
      const today = new Date().toISOString().slice(0, 10);
      setForm((prev) => ({
        amount: "",
        date: today,
        method: prev.method || "Crypto",
        note: "",
        transferDate: today,
        transactionId: "",
        cryptoAmount: "",
        paidBy: "",
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
            <div className="chip-label">All Orders (lifetime)</div>
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

      <div className="payment-body">
        <form className="payment-form" onSubmit={handleSubmit}>
          <div className="form-row">
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
              <label>
                Paid By
                <select
                  value={form.paidBy}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, paidBy: e.target.value }))
                  }
                >
                  <option value="">Select</option>
                  <option value="Danny">Danny</option>
                  <option value="Colton">Colton</option>
                </select>
              </label>
            ) : (
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
            )}
          </div>
          {form.method === "Crypto" ? (
            <>
              <div className="form-row">
                <label>
                  Amount Paid
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
              </div>
              <div className="form-row">
                <label>
                  Transaction ID
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
                <div></div>
              </div>
            </>
          ) : (
            <div className="form-row">
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
                  placeholder="0.00"
                  required
                />
              </label>
              <label>
                Note (optional)
                <input
                  type="text"
                  value={form.note}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, note: e.target.value }))
                  }
                  placeholder="Invoice, reference, or batch"
                />
              </label>
            </div>
          )}
          <div className="form-actions">
            <button type="submit" disabled={saving}>
              {saving ? "Saving..." : "Log Payment"}
            </button>
            <div className="form-hint">
              Payments reduce the outstanding balance against pending orders.
            </div>
          </div>
        </form>

        <div className="payment-list">
          <div className="payment-list-header">
            <h3>Payment History</h3>
            <span className="payment-count">
              {payments.length} {payments.length === 1 ? "entry" : "entries"}
            </span>
          </div>
          {payments.length === 0 ? (
            <div className="empty-payments">No payments logged yet.</div>
          ) : (
            <div className="payment-scroll">
              <ul>
                {payments.map((payment, idx) => (
                  <li
                    key={payment.id}
                    className={`payment-row ${idx % 2 === 1 ? "striped" : ""}`}
                  >
                    <div className="payment-row-main">
                      <div className="payment-amount">
                        ${formatCurrency(payment.amount)}
                      </div>
                      <div className="payment-meta">
                        <span>{payment.date || "No date"}</span>
                        {payment.method && (
                          <span className="dot-sep">{payment.method}</span>
                        )}
                        {payment.note && (
                          <span className="dot-sep muted">{payment.note}</span>
                        )}
                        {payment.method === "Crypto" && payment.cryptoTransactionId && (
                          <span className="dot-sep">
                            TX: {payment.cryptoTransactionId}
                          </span>
                        )}
                        {payment.method === "Crypto" && payment.cryptoPaidBy && (
                          <span className="dot-sep">Paid by {payment.cryptoPaidBy}</span>
                        )}
                        {payment.method === "Crypto" && payment.cryptoTransferDate && (
                          <span className="dot-sep">
                            Transfer: {payment.cryptoTransferDate}
                          </span>
                        )}
                      </div>
                    </div>
                    <button
                      className="link-button"
                      type="button"
                      onClick={() => handleRemove(payment.id)}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </section>
  );
};

export default PaymentTracker;
