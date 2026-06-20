import React, { useEffect, useState } from 'react';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import { db } from '../firebaseConfig';
import './AffiliatePayouts.css';

const AFFILIATES_COLLECTION = 'c&pAffiliates';
const PAYOUTS_COLLECTION = 'c&pAffiliatePayouts';

const formatCurrency = (value) =>
  Number(value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const todayStr = () => new Date().toISOString().slice(0, 10);

const EMPTY_FORM = {
  name: '',
  email: '',
  paypalEmail: '',
  couponCodes: '',
  commissionRate: '10',
  active: true,
};

const AffiliatePayouts = ({ onSuccess, onError }) => {
  const [activeTab, setActiveTab] = useState('commissions');
  const [affiliates, setAffiliates] = useState([]);
  const [payoutHistory, setPayoutHistory] = useState([]);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);

  const [startDate, setStartDate] = useState(todayStr());
  const [endDate, setEndDate] = useState(todayStr());
  const [commissions, setCommissions] = useState(null);
  const [loadingCommissions, setLoadingCommissions] = useState(false);
  const [payingOut, setPayingOut] = useState(false);

  const [showImport, setShowImport] = useState(false);
  const [loadingCoupons, setLoadingCoupons] = useState(false);
  const [importRows, setImportRows] = useState([]);
  const [importingIds, setImportingIds] = useState(new Set());

  useEffect(() => {
    const q = query(collection(db, AFFILIATES_COLLECTION), orderBy('name'));
    return onSnapshot(
      q,
      (snap) => setAffiliates(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      () => onError?.('Failed to load affiliates.')
    );
  }, []);

  useEffect(() => {
    const q = query(collection(db, PAYOUTS_COLLECTION), orderBy('createdAt', 'desc'));
    return onSnapshot(q, (snap) =>
      setPayoutHistory(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
    );
  }, []);

  const handleSaveAffiliate = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const codes = form.couponCodes
        .split(',')
        .map((c) => c.trim().toLowerCase())
        .filter(Boolean);
      const payload = {
        name: form.name.trim(),
        email: form.email.trim(),
        paypalEmail: form.paypalEmail.trim(),
        couponCodes: codes,
        commissionRate: Number(form.commissionRate) || 0,
        active: form.active,
      };
      if (editingId) {
        await updateDoc(doc(db, AFFILIATES_COLLECTION, editingId), payload);
        onSuccess?.('Affiliate updated.');
      } else {
        await addDoc(collection(db, AFFILIATES_COLLECTION), { ...payload, createdAt: serverTimestamp() });
        onSuccess?.('Affiliate added.');
      }
      setForm({ ...EMPTY_FORM });
      setEditingId(null);
      setShowForm(false);
    } catch {
      onError?.('Failed to save affiliate.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    try {
      await deleteDoc(doc(db, AFFILIATES_COLLECTION, id));
      onSuccess?.('Affiliate removed.');
    } catch {
      onError?.('Failed to remove affiliate.');
    }
  };

  const handleEdit = (affiliate) => {
    setForm({
      name: affiliate.name || '',
      email: affiliate.email || '',
      paypalEmail: affiliate.paypalEmail || '',
      couponCodes: (affiliate.couponCodes || []).join(', '),
      commissionRate: String(affiliate.commissionRate ?? 10),
      active: affiliate.active !== false,
    });
    setEditingId(affiliate.id);
    setShowForm(true);
    setActiveTab('affiliates');
  };

  const existingCodes = new Set(
    affiliates.flatMap((a) => (a.couponCodes || []).map((c) => c.toLowerCase()))
  );

  const fetchWooCoupons = async () => {
    setLoadingCoupons(true);
    setImportRows([]);
    try {
      const resp = await fetch('/api/woo/coupons');
      if (!resp.ok) {
        const body = await resp.text();
        let msg = body;
        try { msg = JSON.parse(body)?.error || body; } catch { /* ignore */ }
        throw new Error(msg || 'Failed to fetch coupons.');
      }
      const coupons = await resp.json();
      setImportRows(
        coupons.map((c) => {
          const hasEmail = c.emailRestrictions.length > 0;
          const alreadyExists = existingCodes.has(c.code.toLowerCase());
          return {
            wooId: c.id,
            code: c.code,
            name: c.description || '',
            paypalEmail: c.emailRestrictions[0] || '',
            commissionRate: '10',
            discountType: c.discountType || '',
            discountAmount: c.amount || '0',
            isAffiliate: hasEmail,
            selected: hasEmail && !alreadyExists,
            alreadyExists,
          };
        })
      );
      setShowImport(true);
    } catch (err) {
      onError?.(err.message || 'Failed to fetch WooCommerce coupons.');
    } finally {
      setLoadingCoupons(false);
    }
  };

  const handleImportSelected = async () => {
    const toImport = importRows.filter((r) => r.selected && !r.alreadyExists);
    if (!toImport.length) {
      onError?.('No new coupons selected to import.');
      return;
    }
    const ids = new Set(toImport.map((r) => r.wooId));
    setImportingIds(ids);
    try {
      await Promise.all(
        toImport.map((r) =>
          addDoc(collection(db, AFFILIATES_COLLECTION), {
            name: r.name.trim() || r.code,
            email: '',
            paypalEmail: r.paypalEmail.trim(),
            couponCodes: [r.code.toLowerCase()],
            commissionRate: Number(r.commissionRate) || 10,
            active: true,
            createdAt: serverTimestamp(),
          })
        )
      );
      onSuccess?.(`Imported ${toImport.length} affiliate${toImport.length !== 1 ? 's' : ''}.`);
      setShowImport(false);
      setImportRows([]);
    } catch {
      onError?.('Failed to import some affiliates.');
    } finally {
      setImportingIds(new Set());
    }
  };

  const calculateCommissions = async () => {
    const active = affiliates.filter((a) => a.active !== false);
    if (!active.length) {
      onError?.('Add at least one active affiliate before calculating.');
      return;
    }
    setLoadingCommissions(true);
    setCommissions(null);
    try {
      const params = new URLSearchParams({ startDate, endDate });
      const resp = await fetch(`/api/woo/daily-report?${params}`);
      if (!resp.ok) throw new Error('Failed to fetch WooCommerce sales data.');
      const data = await resp.json();

      const couponMap = new Map(
        (data.couponUsage || []).map((c) => [c.code.toLowerCase(), c])
      );

      const rows = active.map((affiliate) => {
        let totalOrders = 0;
        let totalNetSales = 0;
        const matchedCodes = [];

        (affiliate.couponCodes || []).forEach((code) => {
          const usage = couponMap.get(code.toLowerCase());
          if (usage) {
            totalOrders += usage.orderCount || 0;
            totalNetSales += usage.netSales || 0;
            matchedCodes.push(code);
          }
        });

        const commission = (totalNetSales * (affiliate.commissionRate || 0)) / 100;
        return {
          affiliate,
          matchedCodes,
          totalOrders,
          totalNetSales: Number(totalNetSales.toFixed(2)),
          commission: Number(commission.toFixed(2)),
        };
      });

      setCommissions({ rows, startDate, endDate });
    } catch (err) {
      onError?.(err.message || 'Failed to calculate commissions.');
    } finally {
      setLoadingCommissions(false);
    }
  };

  const handleSendPayouts = async () => {
    const owing = commissions?.rows?.filter((r) => r.commission > 0);
    if (!owing?.length) {
      onError?.('No commissions to pay out.');
      return;
    }
    setPayingOut(true);
    try {
      const payments = owing.map((r) => ({
        affiliateId: r.affiliate.id,
        name: r.affiliate.name,
        paypalEmail: r.affiliate.paypalEmail,
        amount: r.commission,
        couponCodes: r.matchedCodes,
      }));

      const resp = await fetch('/api/paypal/payout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payments, startDate: commissions.startDate, endDate: commissions.endDate }),
      });

      const result = await resp.json();
      if (!resp.ok) throw new Error(result.error || 'Payout failed.');

      await addDoc(collection(db, PAYOUTS_COLLECTION), {
        batchId: result.batchId,
        status: result.status || 'PENDING',
        startDate: commissions.startDate,
        endDate: commissions.endDate,
        payments,
        totalAmount: payments.reduce((s, p) => s + p.amount, 0),
        createdAt: serverTimestamp(),
      });

      onSuccess?.(`Payouts sent! Batch: ${result.batchId}`);
      setCommissions(null);
    } catch (err) {
      onError?.(err.message || 'Payout failed.');
    } finally {
      setPayingOut(false);
    }
  };

  const totalOwed = commissions?.rows?.reduce((s, r) => s + r.commission, 0) ?? 0;

  return (
    <section className="affiliate-payouts">
      <div className="affiliate-header">
        <div>
          <div className="affiliate-eyebrow">Affiliates</div>
          <h2>Affiliate Payouts</h2>
          <p className="affiliate-subtitle">
            Calculate commissions from WooCommerce coupon usage and send via PayPal.
          </p>
        </div>
        {commissions && totalOwed > 0 && (
          <div className="affiliate-total-chip">
            <div className="chip-label">Total to Pay Out</div>
            <div className="chip-value">${formatCurrency(totalOwed)}</div>
          </div>
        )}
      </div>

      <div className="affiliate-tabs">
        {['commissions', 'affiliates', 'history'].map((tab) => (
          <button
            key={tab}
            className={`affiliate-tab ${activeTab === tab ? 'active' : ''}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab === 'commissions' ? 'Commissions' : tab === 'affiliates' ? 'Manage Affiliates' : 'Payout History'}
          </button>
        ))}
      </div>

      {activeTab === 'commissions' && (
        <div className="affiliate-commissions">
          <div className="commission-controls">
            <label>
              From
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </label>
            <label>
              To
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </label>
            <button className="btn-neon-cyan" onClick={calculateCommissions} disabled={loadingCommissions}>
              {loadingCommissions ? 'Loading…' : 'Calculate'}
            </button>
          </div>

          {commissions && (
            <div className="commission-results">
              <div className="commission-results-header">
                <h3>
                  {commissions.startDate === commissions.endDate
                    ? commissions.startDate
                    : `${commissions.startDate} – ${commissions.endDate}`}
                </h3>
                <button
                  className="btn-paypal"
                  onClick={handleSendPayouts}
                  disabled={payingOut || totalOwed <= 0}
                >
                  {payingOut ? 'Sending…' : 'Send All via PayPal'}
                </button>
              </div>

              {commissions.rows.length === 0 ? (
                <div className="affiliate-empty">No active affiliates found.</div>
              ) : (
                <div className="commission-scroll">
                  <table className="commission-table">
                    <thead>
                      <tr>
                        <th>Affiliate</th>
                        <th>Coupon Codes</th>
                        <th>Orders</th>
                        <th>Net Sales</th>
                        <th>Rate</th>
                        <th>Commission</th>
                        <th>PayPal Email</th>
                      </tr>
                    </thead>
                    <tbody>
                      {commissions.rows.map((row) => (
                        <tr key={row.affiliate.id} className={row.commission > 0 ? 'has-commission' : 'no-commission'}>
                          <td className="commission-name">{row.affiliate.name}</td>
                          <td>
                            {(row.affiliate.couponCodes || []).map((c) => (
                              <span
                                key={c}
                                className={`coupon-badge ${row.matchedCodes.includes(c) ? 'used' : 'unused'}`}
                              >
                                {c}
                              </span>
                            ))}
                          </td>
                          <td>{row.totalOrders}</td>
                          <td>${formatCurrency(row.totalNetSales)}</td>
                          <td>{row.affiliate.commissionRate}%</td>
                          <td className="commission-amount">${formatCurrency(row.commission)}</td>
                          <td className="commission-paypal">{row.affiliate.paypalEmail}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td colSpan={5} className="commission-total-label">Total</td>
                        <td className="commission-total-value">${formatCurrency(totalOwed)}</td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
          )}

          {!commissions && !loadingCommissions && (
            <div className="affiliate-empty-state">
              Select a date range and click Calculate to see commissions.
            </div>
          )}
        </div>
      )}

      {activeTab === 'affiliates' && (
        <div className="affiliate-manage">
          <div className="affiliate-manage-header">
            <h3>
              {affiliates.length} affiliate{affiliates.length !== 1 ? 's' : ''}
            </h3>
            <div className="affiliate-manage-actions">
              <button
                className="btn-secondary"
                onClick={fetchWooCoupons}
                disabled={loadingCoupons}
              >
                {loadingCoupons ? 'Loading…' : 'Import from Woo'}
              </button>
              <button
                className="btn-neon-cyan"
                onClick={() => {
                  setForm({ ...EMPTY_FORM });
                  setEditingId(null);
                  setShowForm(true);
                  setShowImport(false);
                }}
              >
                + Add Affiliate
              </button>
            </div>
          </div>

          {showImport && importRows.length > 0 && (
            <div className="import-panel">
              <div className="import-panel-header">
                <div>
                  <strong>WooCommerce Coupons</strong>
                  <span className="import-panel-hint">
                    Fill in a name and PayPal email for each coupon you want to import.
                    Already-linked coupons are shown but skipped.
                  </span>
                </div>
                <div className="import-panel-actions">
                  <button className="btn-neon-cyan" onClick={handleImportSelected} disabled={importingIds.size > 0}>
                    {importingIds.size > 0 ? 'Importing…' : `Import Selected (${importRows.filter((r) => r.selected && !r.alreadyExists).length})`}
                  </button>
                  <button className="btn-secondary" onClick={() => { setShowImport(false); setImportRows([]); }}>
                    Cancel
                  </button>
                </div>
              </div>
              <div className="commission-scroll">
                <table className="affiliate-table import-table">
                  <thead>
                    <tr>
                      <th style={{ width: '2rem' }} />
                      <th>Coupon Code</th>
                      <th>Name</th>
                      <th>PayPal Email</th>
                      <th>Woo Discount</th>
                      <th>Rate (%)</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {importRows.map((row, i) => (
                      <tr key={row.wooId} className={row.alreadyExists ? 'import-row-exists' : ''}>
                        <td>
                          <input
                            type="checkbox"
                            checked={row.selected}
                            disabled={row.alreadyExists}
                            onChange={(e) =>
                              setImportRows((prev) =>
                                prev.map((r, idx) => idx === i ? { ...r, selected: e.target.checked } : r)
                              )
                            }
                          />
                        </td>
                        <td><span className="coupon-badge used">{row.code}</span></td>
                        <td>
                          <input
                            className="import-inline-input"
                            type="text"
                            value={row.name}
                            placeholder="Affiliate name"
                            disabled={row.alreadyExists}
                            onChange={(e) =>
                              setImportRows((prev) =>
                                prev.map((r, idx) => idx === i ? { ...r, name: e.target.value } : r)
                              )
                            }
                          />
                        </td>
                        <td>
                          <input
                            className="import-inline-input"
                            type="email"
                            value={row.paypalEmail}
                            placeholder="paypal@email.com"
                            disabled={row.alreadyExists}
                            onChange={(e) =>
                              setImportRows((prev) =>
                                prev.map((r, idx) => idx === i ? { ...r, paypalEmail: e.target.value } : r)
                              )
                            }
                          />
                        </td>
                        <td className="import-discount-cell">
                          {row.discountType === 'percent'
                            ? `${parseFloat(row.discountAmount || 0).toFixed(0)}%`
                            : row.discountType === 'fixed_cart' || row.discountType === 'fixed_product'
                              ? `$${parseFloat(row.discountAmount || 0).toFixed(2)}`
                              : row.discountAmount || '—'}
                        </td>
                        <td>
                          <input
                            className="import-inline-input import-rate-input"
                            type="number"
                            min="0"
                            max="100"
                            step="0.1"
                            value={row.commissionRate}
                            disabled={row.alreadyExists}
                            onChange={(e) =>
                              setImportRows((prev) =>
                                prev.map((r, idx) => idx === i ? { ...r, commissionRate: e.target.value } : r)
                              )
                            }
                          />
                        </td>
                        <td>
                          {row.alreadyExists
                            ? <span className="status-badge inactive">Already added</span>
                            : row.isAffiliate
                              ? <span className="status-badge active">Affiliate</span>
                              : <span className="status-badge coupon-only">Coupon only</span>
                          }
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {showForm && (
            <form className="affiliate-form" onSubmit={handleSaveAffiliate}>
              <div className="affiliate-form-grid">
                <label>
                  Name
                  <input
                    type="text"
                    value={form.name}
                    onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                    placeholder="Jane Doe"
                    required
                  />
                </label>
                <label>
                  Email
                  <input
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
                    placeholder="jane@example.com"
                  />
                </label>
                <label>
                  PayPal Email
                  <input
                    type="email"
                    value={form.paypalEmail}
                    onChange={(e) => setForm((p) => ({ ...p, paypalEmail: e.target.value }))}
                    placeholder="jane@paypal.com"
                    required
                  />
                </label>
                <label>
                  Coupon Codes
                  <input
                    type="text"
                    value={form.couponCodes}
                    onChange={(e) => setForm((p) => ({ ...p, couponCodes: e.target.value }))}
                    placeholder="JANE10, JANE20"
                  />
                  <span className="field-hint">Comma-separated WooCommerce coupon codes</span>
                </label>
                <label>
                  Commission Rate (%)
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.1"
                    value={form.commissionRate}
                    onChange={(e) => setForm((p) => ({ ...p, commissionRate: e.target.value }))}
                    placeholder="10"
                    required
                  />
                </label>
                <label className="affiliate-active-label">
                  <input
                    type="checkbox"
                    checked={form.active}
                    onChange={(e) => setForm((p) => ({ ...p, active: e.target.checked }))}
                  />
                  Active
                </label>
              </div>
              <div className="affiliate-form-actions">
                <button type="submit" className="btn-neon-cyan" disabled={saving}>
                  {saving ? 'Saving…' : editingId ? 'Update' : 'Add Affiliate'}
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => { setShowForm(false); setEditingId(null); }}
                >
                  Cancel
                </button>
              </div>
            </form>
          )}

          {affiliates.length === 0 ? (
            <div className="affiliate-empty">No affiliates yet. Add one to get started.</div>
          ) : (
            <div className="commission-scroll">
              <table className="affiliate-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>PayPal Email</th>
                    <th>Coupon Codes</th>
                    <th>Rate</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {affiliates.map((a) => (
                    <tr key={a.id}>
                      <td className="affiliate-name">{a.name}</td>
                      <td>{a.paypalEmail}</td>
                      <td>
                        {(a.couponCodes || []).map((c) => (
                          <span key={c} className="coupon-badge used">{c}</span>
                        ))}
                      </td>
                      <td>{a.commissionRate}%</td>
                      <td>
                        <span className={`status-badge ${a.active !== false ? 'active' : 'inactive'}`}>
                          {a.active !== false ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="affiliate-actions">
                        <button className="btn-edit" onClick={() => handleEdit(a)}>Edit</button>
                        <button className="btn-remove" onClick={() => handleDelete(a.id)}>Remove</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {activeTab === 'history' && (
        <div className="affiliate-history">
          {payoutHistory.length === 0 ? (
            <div className="affiliate-empty">No payouts sent yet.</div>
          ) : (
            <div className="commission-scroll">
              <table className="affiliate-table">
                <thead>
                  <tr>
                    <th>Sent</th>
                    <th>Period</th>
                    <th>Recipients</th>
                    <th>Total Paid</th>
                    <th>Batch ID</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {payoutHistory.map((p) => (
                    <tr key={p.id}>
                      <td>{p.createdAt?.toDate?.().toLocaleDateString?.() ?? '—'}</td>
                      <td>
                        {p.startDate === p.endDate ? p.startDate : `${p.startDate} – ${p.endDate}`}
                      </td>
                      <td>{p.payments?.length ?? 0}</td>
                      <td>${formatCurrency(p.totalAmount)}</td>
                      <td className="batch-id">{p.batchId}</td>
                      <td>
                        <span className={`status-badge ${p.status === 'SUCCESS' ? 'active' : 'pending'}`}>
                          {p.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
};

export default AffiliatePayouts;
