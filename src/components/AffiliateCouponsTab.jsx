import React, { useEffect, useMemo, useState } from 'react';
import {
  addDoc,
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import { db } from '../firebaseConfig';
import './AffiliateCouponsTab.css';

const AFFILIATES_COLLECTION = 'c&pAffiliates';
const PAYOUTS_COLLECTION = 'c&pAffiliatePayouts';

const fmt = (value) =>
  Number(value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const AffiliateCouponsTab = ({ wooCouponUsage, wooPullInfo, onSuccess, onError }) => {
  const [affiliates, setAffiliates] = useState([]);
  const [payoutHistory, setPayoutHistory] = useState([]);
  const [editing, setEditing] = useState({});
  const [savingCode, setSavingCode] = useState(null);
  const [payingOut, setPayingOut] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    const q = query(collection(db, AFFILIATES_COLLECTION), orderBy('name'));
    return onSnapshot(q, (snap) =>
      setAffiliates(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
    );
  }, []);

  useEffect(() => {
    const q = query(collection(db, PAYOUTS_COLLECTION), orderBy('createdAt', 'desc'));
    return onSnapshot(q, (snap) =>
      setPayoutHistory(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
    );
  }, []);

  const couponAffiliateMap = useMemo(() => {
    const map = new Map();
    affiliates.forEach((a) => {
      (a.couponCodes || []).forEach((code) => map.set(code.toLowerCase(), a));
    });
    return map;
  }, [affiliates]);

  const enrichedCoupons = useMemo(() =>
    (wooCouponUsage || []).map((coupon) => {
      const affiliate = couponAffiliateMap.get(coupon.code.toLowerCase()) ?? null;
      const rate = affiliate?.commissionRate ?? 0;
      const commission = Number(((coupon.netSales || 0) * rate / 100).toFixed(2));
      return { ...coupon, affiliate, commission };
    }),
    [wooCouponUsage, couponAffiliateMap]
  );

  // Deduplicated totals per affiliate (one affiliate may have multiple coupons)
  const affiliateTotals = useMemo(() => {
    const map = new Map();
    enrichedCoupons.forEach((c) => {
      if (!c.affiliate || c.commission <= 0) return;
      const id = c.affiliate.id;
      if (!map.has(id)) {
        map.set(id, { affiliate: c.affiliate, commission: 0, couponCodes: [] });
      }
      const entry = map.get(id);
      entry.commission = Number((entry.commission + c.commission).toFixed(2));
      entry.couponCodes.push(c.code);
    });
    return Array.from(map.values());
  }, [enrichedCoupons]);

  const totalOwed = affiliateTotals.reduce((s, a) => s + a.commission, 0);

  const startEditing = (code, affiliate) => {
    setEditing((prev) => ({
      ...prev,
      [code]: {
        name: affiliate?.name || '',
        paypalEmail: affiliate?.paypalEmail || '',
        commissionRate: String(affiliate?.commissionRate ?? 10),
      },
    }));
  };

  const cancelEditing = (code) =>
    setEditing((prev) => { const n = { ...prev }; delete n[code]; return n; });

  const patchEditing = (code, field, value) =>
    setEditing((prev) => ({ ...prev, [code]: { ...prev[code], [field]: value } }));

  const saveAffiliate = async (code) => {
    const values = editing[code];
    if (!values) return;
    setSavingCode(code);
    try {
      const existing = couponAffiliateMap.get(code.toLowerCase());
      const payload = {
        name: values.name.trim() || code,
        paypalEmail: values.paypalEmail.trim(),
        commissionRate: Number(values.commissionRate) || 0,
        active: true,
      };
      if (existing) {
        const codes = Array.from(new Set([...(existing.couponCodes || []), code.toLowerCase()]));
        await updateDoc(doc(db, AFFILIATES_COLLECTION, existing.id), { ...payload, couponCodes: codes });
      } else {
        await addDoc(collection(db, AFFILIATES_COLLECTION), {
          ...payload,
          email: '',
          couponCodes: [code.toLowerCase()],
          createdAt: serverTimestamp(),
        });
      }
      onSuccess?.('Affiliate saved.');
      cancelEditing(code);
    } catch {
      onError?.('Failed to save affiliate.');
    } finally {
      setSavingCode(null);
    }
  };

  const PAYOUT_MINIMUM = 2500;

  const handleSendPayouts = async () => {
    const owing = affiliateTotals.filter((a) => a.affiliate?.paypalEmail);
    if (!owing.length) {
      onError?.('No commissions to pay — set a PayPal email for each affiliate first.');
      return;
    }
    if (totalOwed < PAYOUT_MINIMUM) {
      onError?.(`Total commissions must reach $${PAYOUT_MINIMUM.toLocaleString()} before a payout can be sent. Current total: $${fmt(totalOwed)}.`);
      return;
    }
    setPayingOut(true);
    try {
      const payments = owing.map((a) => ({
        affiliateId: a.affiliate.id,
        name: a.affiliate.name,
        paypalEmail: a.affiliate.paypalEmail,
        amount: a.commission,
        couponCodes: a.couponCodes,
      }));

      const resp = await fetch('/api/paypal/payout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          payments,
          startDate: wooPullInfo?.startDate || '',
          endDate: wooPullInfo?.endDate || '',
        }),
      });

      const result = await resp.json();
      if (!resp.ok) throw new Error(result.error || 'Payout failed.');

      await addDoc(collection(db, PAYOUTS_COLLECTION), {
        batchId: result.batchId,
        status: result.status || 'PENDING',
        startDate: wooPullInfo?.startDate || '',
        endDate: wooPullInfo?.endDate || '',
        payments,
        totalAmount: payments.reduce((s, p) => s + p.amount, 0),
        createdAt: serverTimestamp(),
      });

      onSuccess?.(`Payouts sent! Batch: ${result.batchId}`);
    } catch (err) {
      onError?.(err.message || 'Payout failed.');
    } finally {
      setPayingOut(false);
    }
  };

  if (!wooCouponUsage?.length) {
    return (
      <div className="empty-state">
        <p>No coupon usage for this period. Pull Woo data with a wider date range or check that orders used coupons.</p>
      </div>
    );
  }

  return (
    <div className="aff-coupons-tab">
      {/* Summary bar */}
      {totalOwed > 0 && (
        <div className="aff-summary-bar">
          <div className="aff-summary-chips">
            {affiliateTotals.map((a) => (
              <div key={a.affiliate.id} className="aff-summary-chip">
                <span className="aff-chip-name">{a.affiliate.name}</span>
                <span className="aff-chip-amount">${fmt(a.commission)}</span>
              </div>
            ))}
          </div>
          <div className="aff-summary-right">
            <div className="aff-total-block">
              <span className="aff-total-label">Total Owed</span>
              <span className="aff-total-value">${fmt(totalOwed)}</span>
              {totalOwed < PAYOUT_MINIMUM && (
                <span className="aff-minimum-note">
                  ${fmt(PAYOUT_MINIMUM - totalOwed)} to minimum
                </span>
              )}
            </div>
            <button
              className="btn-paypal"
              onClick={handleSendPayouts}
              disabled={payingOut || totalOwed < PAYOUT_MINIMUM}
              title={totalOwed < PAYOUT_MINIMUM ? `Minimum payout is $${PAYOUT_MINIMUM.toLocaleString()}` : ''}
            >
              {payingOut ? 'Sending…' : 'Pay All via PayPal'}
            </button>
          </div>
        </div>
      )}

      {/* Coupon table */}
      <div className="table-wrapper">
        <table className="breakdown-table woo-coupon-table aff-table">
          <thead>
            <tr>
              <th>Coupon Code</th>
              <th>Affiliate</th>
              <th>PayPal Email</th>
              <th className="number-head">Rate</th>
              <th className="number-head">Orders</th>
              <th className="number-head">Net Sales</th>
              <th className="number-head">Discount</th>
              <th className="number-head">Commission</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {enrichedCoupons.map((coupon) => {
              const isEditing = Boolean(editing[coupon.code]);
              const edits = editing[coupon.code] || {};

              return (
                <React.Fragment key={coupon.code}>
                  <tr className={coupon.commission > 0 ? 'aff-row-active' : ''}>
                    <td className="product-name">{coupon.code}</td>
                    <td>{coupon.affiliate?.name ?? <span className="aff-unlinked">Not set</span>}</td>
                    <td className="aff-paypal-cell">{coupon.affiliate?.paypalEmail || '—'}</td>
                    <td className="number">{coupon.affiliate ? `${coupon.affiliate.commissionRate}%` : '—'}</td>
                    <td className="number">{coupon.orderCount}</td>
                    <td className="number revenue">${fmt(coupon.netSales)}</td>
                    <td className="number">${fmt(coupon.totalDiscount)}</td>
                    <td className="number revenue">
                      {coupon.commission > 0 ? `$${fmt(coupon.commission)}` : '—'}
                    </td>
                    <td>
                      {!isEditing && (
                        <button
                          className="aff-edit-btn"
                          onClick={() => startEditing(coupon.code, coupon.affiliate)}
                        >
                          {coupon.affiliate ? 'Edit' : 'Set Affiliate'}
                        </button>
                      )}
                    </td>
                  </tr>

                  {isEditing && (
                    <tr className="aff-edit-row">
                      <td />
                      <td>
                        <input
                          className="aff-inline-input"
                          type="text"
                          placeholder="Name"
                          value={edits.name}
                          onChange={(e) => patchEditing(coupon.code, 'name', e.target.value)}
                        />
                      </td>
                      <td>
                        <input
                          className="aff-inline-input"
                          type="email"
                          placeholder="paypal@email.com"
                          value={edits.paypalEmail}
                          onChange={(e) => patchEditing(coupon.code, 'paypalEmail', e.target.value)}
                        />
                      </td>
                      <td>
                        <input
                          className="aff-inline-input aff-rate-input"
                          type="number"
                          min="0" max="100" step="0.1"
                          placeholder="10"
                          value={edits.commissionRate}
                          onChange={(e) => patchEditing(coupon.code, 'commissionRate', e.target.value)}
                        />
                      </td>
                      <td colSpan={4} />
                      <td>
                        <div className="aff-edit-actions">
                          <button
                            className="aff-save-btn"
                            onClick={() => saveAffiliate(coupon.code)}
                            disabled={savingCode === coupon.code}
                          >
                            {savingCode === coupon.code ? 'Saving…' : 'Save'}
                          </button>
                          <button className="aff-cancel-btn" onClick={() => cancelEditing(coupon.code)}>
                            Cancel
                          </button>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>

          {totalOwed > 0 && (
            <tfoot>
              <tr>
                <td colSpan={7} className="aff-tfoot-label">Total Owed</td>
                <td className="number revenue aff-tfoot-value">${fmt(totalOwed)}</td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* Payout history */}
      {payoutHistory.length > 0 && (
        <div className="aff-history">
          <button className="aff-history-toggle" onClick={() => setShowHistory((v) => !v)}>
            {showHistory ? '▾' : '▸'} Payout History ({payoutHistory.length})
          </button>
          {showHistory && (
            <div className="table-wrapper" style={{ marginTop: '0.75rem' }}>
              <table className="breakdown-table">
                <thead>
                  <tr>
                    <th>Sent</th>
                    <th>Period</th>
                    <th className="number-head">Recipients</th>
                    <th className="number-head">Total Paid</th>
                    <th>Batch ID</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {payoutHistory.map((p) => (
                    <tr key={p.id}>
                      <td>{p.createdAt?.toDate?.().toLocaleDateString?.() ?? '—'}</td>
                      <td>{p.startDate === p.endDate ? p.startDate : `${p.startDate} – ${p.endDate}`}</td>
                      <td className="number">{p.payments?.length ?? 0}</td>
                      <td className="number revenue">${fmt(p.totalAmount)}</td>
                      <td className="aff-batch-id">{p.batchId}</td>
                      <td>{p.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default AffiliateCouponsTab;
