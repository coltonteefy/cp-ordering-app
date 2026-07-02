import React, { useEffect, useMemo, useRef, useState } from 'react';
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

const AffiliateCouponsTab = ({ wooCouponUsage, wooPullInfo, wooCouponCatalog, wooAffiliateUsers, onSuccess, onError }) => {
  const [affiliates, setAffiliates] = useState([]);
  const [payoutHistory, setPayoutHistory] = useState([]);
  const [editing, setEditing] = useState({});
  const [savingCode, setSavingCode] = useState(null);
  const [payingOut, setPayingOut] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [editingRateId, setEditingRateId] = useState(null);
  const [editingRateValue, setEditingRateValue] = useState('');
  const [togglingPreferenceId, setTogglingPreferenceId] = useState(null);
  const [copiedSection, setCopiedSection] = useState(null);
  const copiedTimeoutRef = useRef(null);

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

  const catalogMap = useMemo(() => {
    const map = new Map();
    (wooCouponCatalog || []).forEach((c) => map.set(c.code.toLowerCase(), c));
    return map;
  }, [wooCouponCatalog]);

  const affiliateUserMap = useMemo(() => {
    const map = new Map();
    (wooAffiliateUsers || []).forEach((u) => map.set(u.id, u));
    return map;
  }, [wooAffiliateUsers]);

  const enrichedCoupons = useMemo(() =>
    (wooCouponUsage || []).map((coupon) => {
      const affiliate = couponAffiliateMap.get(coupon.code.toLowerCase()) ?? null;
      const rate = affiliate?.commissionRate ?? 0;
      const commission = Number(((coupon.netSales || 0) * rate / 100).toFixed(2));
      const catalogEntry = catalogMap.get(coupon.code.toLowerCase());
      const wooUser = catalogEntry?.affiliateUserId
        ? affiliateUserMap.get(catalogEntry.affiliateUserId) ?? null
        : null;
      const isAffiliate = Boolean(catalogEntry?.affiliateUserId) || Boolean(affiliate);
      const wooCommissionRate = catalogEntry?.commissionRate ? String(catalogEntry.commissionRate) : null;
      const wooDiscount = catalogEntry
        ? { type: catalogEntry.discountType, amount: catalogEntry.amount }
        : null;
      return { ...coupon, affiliate, commission, isAffiliate, wooUser, wooCommissionRate, wooDiscount };
    }),
    [wooCouponUsage, couponAffiliateMap, catalogMap, affiliateUserMap]
  );

  // Deduplicated totals per affiliate (one affiliate may have multiple coupons)
  const affiliateTotals = useMemo(() => {
    const map = new Map();
    enrichedCoupons.forEach((c) => {
      if (!c.affiliate || c.commission <= 0) return;
      const id = c.affiliate.id;
      if (!map.has(id)) {
        map.set(id, { affiliate: c.affiliate, commission: 0, totalSales: 0, couponCodes: [] });
      }
      const entry = map.get(id);
      entry.commission = Number((entry.commission + c.commission).toFixed(2));
      entry.totalSales = Number((entry.totalSales + (c.netSales || 0)).toFixed(2));
      entry.couponCodes.push(c.code);
    });
    return Array.from(map.values());
  }, [enrichedCoupons]);

  const totalOwed = affiliateTotals.reduce((s, a) => s + a.commission, 0);

  const startEditing = (code, affiliate, coupon) => {
    const wooRate = coupon?.wooCommissionRate;
    const wooEmail = coupon?.wooUser?.email || '';
    const wooName = coupon?.wooUser?.displayName || '';
    setEditing((prev) => ({
      ...prev,
      [code]: {
        name: affiliate?.name || wooName,
        paypalEmail: affiliate?.paypalEmail || wooEmail,
        commissionRate: String(affiliate?.commissionRate ?? wooRate ?? 10),
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

  const AFFILIATE_MINIMUM_SALES = 2500;

  const copyToClipboard = (text, successMsg = 'Copied!') => {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        onSuccess(successMsg);
      }).catch(() => {
        onError('Failed to copy to clipboard');
      });
    } else {
      // Fallback for older browsers
      const textarea = document.createElement('textarea');
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      try {
        document.execCommand('copy');
        onSuccess(successMsg);
      } catch {
        onError('Failed to copy to clipboard');
      }
      document.body.removeChild(textarea);
    }
  };

  const escapeCsvValue = (value) => {
    const str = String(value || '').trim();
    // Only quote if contains comma, quote, or newline
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const formatAffiliateAsCSV = (affiliate) => {
    const codes = affiliate.couponCodes.join('; ');
    const row = [
      escapeCsvValue(affiliate.affiliate.name),
      escapeCsvValue(codes),
      escapeCsvValue(fmt(affiliate.commission)),
      escapeCsvValue(String(affiliate.affiliate.commissionRate))
    ];
    return row.join(',');
  };

  const handleCopyWithFeedback = (section, data, count) => {
    if (count === 0) {
      onError(`No ${section} to copy`);
      return;
    }
    const header = 'Affiliate Name,Coupon Codes,Payout Amount,Commission Rate';
    const rows = data.map(formatAffiliateAsCSV);
    const csv = [header, ...rows].join('\n');
    copyToClipboard(csv, `✓ Copied ${count} affiliate${count !== 1 ? 's' : ''} to clipboard!`);

    // Visual feedback on button - clear previous timeout to prevent race conditions
    if (copiedTimeoutRef.current) {
      clearTimeout(copiedTimeoutRef.current);
    }
    setCopiedSection(section);
    copiedTimeoutRef.current = setTimeout(() => setCopiedSection(null), 2000);
  };

  const copyAllCashPayouts = () => {
    handleCopyWithFeedback('cash', cashPayouts, cashPayouts.length);
  };

  const copyAllStoreCredits = () => {
    handleCopyWithFeedback('credit', storeCredits, storeCredits.length);
  };
  const BATCH_MINIMUM = 250;

  const cashPayouts = useMemo(() =>
    affiliateTotals.filter((a) => a.totalSales >= AFFILIATE_MINIMUM_SALES && a.affiliate.payoutPreference !== 'store_credit'),
    [affiliateTotals]
  );
  const storeCredits = useMemo(() =>
    affiliateTotals.filter((a) => a.totalSales > 0 && (a.totalSales < AFFILIATE_MINIMUM_SALES || a.affiliate.payoutPreference === 'store_credit')),
    [affiliateTotals]
  );
  const totalCash = cashPayouts.reduce((s, a) => s + a.commission, 0);
  const totalCredit = storeCredits.reduce((s, a) => s + a.commission, 0);

  const updateCommissionRate = async (affiliateId, newRate) => {
    const numRate = Number(newRate);
    if (isNaN(numRate) || numRate < 0 || numRate > 100) {
      onError?.('Commission rate must be between 0 and 100');
      return;
    }
    try {
      await updateDoc(doc(db, AFFILIATES_COLLECTION, affiliateId), {
        commissionRate: numRate,
      });
      onSuccess?.('Commission rate updated');
      setEditingRateId(null);
      setEditingRateValue('');
    } catch (err) {
      onError?.('Failed to update commission rate');
    }
  };

  const togglePayoutPreference = async (affiliateId, currentPreference) => {
    const newPreference = currentPreference === 'store_credit' ? null : 'store_credit';
    setTogglingPreferenceId(affiliateId);
    try {
      await updateDoc(doc(db, AFFILIATES_COLLECTION, affiliateId), {
        payoutPreference: newPreference,
      });
      const message = newPreference === 'store_credit'
        ? 'Switched to store credit payout'
        : 'Switched to cash payout';
      onSuccess?.(message);
    } catch (error) {
      onError?.('Failed to update payout preference');
    } finally {
      setTogglingPreferenceId(null);
    }
  };

  const handleSendPayouts = async () => {
    const payableAffiliates = cashPayouts.filter((a) => a.affiliate?.paypalEmail);
    if (!payableAffiliates.length) {
      onError?.('No affiliates with $250+ commissions AND emails set. Add emails to eligible affiliates.');
      return;
    }
    const payableTotal = payableAffiliates.reduce((s, a) => s + a.commission, 0);
    if (payableTotal < BATCH_MINIMUM) {
      onError?.(`Payable total (those with emails) must reach $${BATCH_MINIMUM.toLocaleString()}. Current: $${fmt(payableTotal)}.`);
      return;
    }
    setPayingOut(true);
    try {
      const payments = payableAffiliates.map((a) => ({
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
        <p style={{ fontSize: '0.9rem', color: '#999', marginTop: '1rem' }}>
          {affiliates.length} affiliate{affiliates.length !== 1 ? 's' : ''} saved in system
        </p>
      </div>
    );
  }

  return (
    <div className="aff-coupons-tab">
      <div style={{ fontSize: '0.85rem', color: '#666', marginBottom: '1rem', padding: '0.75rem', backgroundColor: '#f9f7f5', borderRadius: '8px' }}>
        📊 <strong>{affiliates.length}</strong> affiliate{affiliates.length !== 1 ? 's' : ''} saved | <strong>{enrichedCoupons.length}</strong> coupon{enrichedCoupons.length !== 1 ? 's' : ''} with activity
      </div>
      {/* Summary bar */}
      {totalOwed > 0 && (
        <>
          {/* Cash Payouts Section */}
          {cashPayouts.length > 0 && (
            <div className="aff-summary-bar cash-section">
              <div className="aff-summary-section-header">
                <div className="aff-header-left">
                  <h3 className="aff-summary-title">{`💰 Cash Payouts (≥ $${AFFILIATE_MINIMUM_SALES} sales)`}</h3>
                  <span className="aff-count-badge">{cashPayouts.length} affiliate{cashPayouts.length !== 1 ? 's' : ''}</span>
                </div>
                <button
                  type="button"
                  className={`aff-copy-btn ${copiedSection === 'cash' ? 'copied' : ''}`}
                  onClick={copyAllCashPayouts}
                  title="Copy as CSV for Google Sheets"
                >
                  {copiedSection === 'cash' ? '✓ Copied!' : '📋 Copy All'}
                </button>
              </div>
              <div className="aff-summary-chips">
                {cashPayouts.map((a) => (
                  <div key={a.affiliate.id} className="aff-summary-chip cash-chip">
                    <div className="aff-chip-content">
                      <span className="aff-chip-name">{a.affiliate.name}</span>
                      <span className="aff-chip-rate">{a.affiliate.commissionRate}%</span>
                      <span className="aff-chip-amount">${fmt(a.commission)}</span>
                    </div>
                    <button
                      type="button"
                      className="aff-chip-toggle"
                      onClick={() => togglePayoutPreference(a.affiliate.id, a.affiliate.payoutPreference)}
                      disabled={togglingPreferenceId === a.affiliate.id}
                      title="Move to store credit"
                    >
                      {togglingPreferenceId === a.affiliate.id ? '...' : '→'}
                    </button>
                  </div>
                ))}
              </div>
              <div className="aff-summary-right">
                <div className="aff-total-block">
                  <span className="aff-total-label">Cash Total</span>
                  <span className="aff-total-value cash">${fmt(totalCash)}</span>
                </div>
              </div>
            </div>
          )}

          {/* Store Credit Section */}
          {storeCredits.length > 0 && (
            <div className="aff-summary-bar credit-section">
              <div className="aff-summary-section-header">
                <div className="aff-header-left">
                  <h3 className="aff-summary-title">{`🎟️ Store Credit (< $${AFFILIATE_MINIMUM_SALES} sales)`}</h3>
                  <span className="aff-count-badge">{storeCredits.length} affiliate{storeCredits.length !== 1 ? 's' : ''}</span>
                </div>
                <button
                  type="button"
                  className={`aff-copy-btn ${copiedSection === 'credit' ? 'copied' : ''}`}
                  onClick={copyAllStoreCredits}
                  title="Copy as CSV for Google Sheets"
                >
                  {copiedSection === 'credit' ? '✓ Copied!' : '📋 Copy All'}
                </button>
              </div>
              <div className="aff-summary-chips">
                {storeCredits.map((a) => (
                  <div key={a.affiliate.id} className="aff-summary-chip credit-chip">
                    <div className="aff-chip-content">
                      <span className="aff-chip-name">{a.affiliate.name}</span>
                      <span className="aff-chip-rate">{a.affiliate.commissionRate}%</span>
                      <span className="aff-chip-amount">${fmt(a.commission)}</span>
                    </div>
                    {a.affiliate.payoutPreference === 'store_credit' && a.totalSales >= AFFILIATE_MINIMUM_SALES && (
                      <button
                        type="button"
                        className="aff-chip-toggle"
                        onClick={() => togglePayoutPreference(a.affiliate.id, a.affiliate.payoutPreference)}
                        disabled={togglingPreferenceId === a.affiliate.id}
                        title="Move back to cash payout"
                      >
                        {togglingPreferenceId === a.affiliate.id ? '...' : '←'}
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <div className="aff-summary-right">
                <div className="aff-total-block">
                  <span className="aff-total-label">Store Credit Total</span>
                  <span className="aff-total-value credit">${fmt(totalCredit)}</span>
                </div>
              </div>
            </div>
          )}

          {/* Overall Summary Card */}
          <div className="aff-summary-card">
            <div className="aff-summary-item">
              <span className="aff-summary-item-label">Total Owed</span>
              <span className="aff-summary-item-value">${fmt(totalOwed)}</span>
            </div>
            <div className="aff-summary-item">
              <span className="aff-summary-item-label">Cash</span>
              <span className="aff-summary-item-value cash">${fmt(totalCash)}</span>
            </div>
            <div className="aff-summary-item">
              <span className="aff-summary-item-label">Store Credit</span>
              <span className="aff-summary-item-value credit">${fmt(totalCredit)}</span>
            </div>
          </div>
        </>
      )}

      {/* Affiliate Leaderboard */}
      <div className="aff-leaderboard">
        <h3 className="aff-leaderboard-title">Affiliate Leaderboard</h3>
        <div className="aff-leaderboard-list">
          {affiliateTotals
            .sort((a, b) => b.commission - a.commission)
            .map((affiliate, index) => {
              const affiliateCoupons = enrichedCoupons.filter(
                (c) => c.affiliate?.id === affiliate.affiliate.id
              );
              const totalOrders = affiliateCoupons.reduce((sum, c) => sum + (c.orderCount || 0), 0);
              const totalSales = affiliateCoupons.reduce((sum, c) => sum + (c.netSales || 0), 0);
              return (
                <div key={affiliate.affiliate.id} className={`aff-leaderboard-card${editingRateId === affiliate.affiliate.id ? ' editing' : ''}`}>
                  <div className="aff-rank">#{index + 1}</div>
                  <div className="aff-leaderboard-info">
                    <div className="aff-leaderboard-eyebrow">{affiliate.affiliate.name}</div>
                    <div className="aff-leaderboard-name">{affiliate.couponCodes.join(', ')}</div>
                    <div className="aff-leaderboard-meta">
                      <span>{affiliate.couponCodes.length} coupon{affiliate.couponCodes.length !== 1 ? 's' : ''}</span>
                      <span>•</span>
                      <span>{totalOrders} order{totalOrders !== 1 ? 's' : ''}</span>
                      <span>•</span>
                      <span>${fmt(totalSales)} sales</span>
                      <span>•</span>
                      {editingRateId === affiliate.affiliate.id ? (
                        <input
                          type="number"
                          min="0"
                          max="100"
                          step="0.1"
                          value={editingRateValue}
                          onChange={(e) => setEditingRateValue(e.target.value)}
                          className="aff-rate-edit-input"
                          placeholder="Rate %"
                        />
                      ) : (
                        <span>{affiliate.affiliate.commissionRate}%</span>
                      )}
                    </div>
                  </div>
                  <div className="aff-leaderboard-stats">
                    {editingRateId === affiliate.affiliate.id ? (
                      <div className="aff-rate-edit-actions">
                        <button
                          className="aff-rate-save-btn"
                          onClick={() => updateCommissionRate(affiliate.affiliate.id, editingRateValue)}
                        >
                          Save
                        </button>
                        <button
                          className="aff-rate-cancel-btn"
                          onClick={() => {
                            setEditingRateId(null);
                            setEditingRateValue('');
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <>
                        <div className="aff-leaderboard-commission">${fmt(affiliate.commission)}</div>
                        <button
                          className="aff-rate-edit-btn"
                          onClick={() => {
                            setEditingRateId(affiliate.affiliate.id);
                            setEditingRateValue(affiliate.affiliate.commissionRate);
                          }}
                          title="Edit commission rate"
                        >
                          Edit Rate
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
        </div>
      </div>

      {/* Detailed Coupon Breakdown - excluding leaderboard affiliates */}
      <div className="table-wrapper" style={{ marginTop: '2rem' }}>
        <h4 style={{ fontSize: '0.9rem', color: '#666', marginBottom: '1rem' }}>Unlinked Coupons</h4>
        <table className="breakdown-table woo-coupon-table aff-table">
          <thead>
            <tr>
              <th>Coupon Code</th>
              <th>Affiliate</th>
              <th>Email</th>
              <th className="number-head">Comm. Rate</th>
              <th className="number-head">Cust. Discount</th>
              <th className="number-head">Orders</th>
              <th className="number-head">Net Sales</th>
              <th className="number-head">Discount Given</th>
              <th className="number-head">Commission</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {enrichedCoupons
              .filter((coupon) => !coupon.affiliate || affiliateTotals.length === 0)
              .map((coupon) => {
                const isEditing = Boolean(editing[coupon.code]);
                const edits = editing[coupon.code] || {};

                return (
                  <React.Fragment key={coupon.code}>
                    <tr className={coupon.commission > 0 ? 'aff-row-active' : ''}>
                      <td className="product-name">
                        {coupon.code}
                        {wooCouponCatalog.length > 0 && (
                          <span className={`aff-type-badge ${coupon.isAffiliate ? 'aff-type-affiliate' : 'aff-type-promo'}`}>
                            {coupon.isAffiliate ? 'affiliate' : 'promo'}
                          </span>
                        )}
                      </td>
                      <td>
                        {coupon.affiliate?.name ?? (
                          coupon.wooUser
                            ? <span className="aff-woo-name">{coupon.wooUser.displayName}</span>
                            : <span className="aff-unlinked">Not set</span>
                        )}
                      </td>
                      <td className="aff-email-cell">
                        {coupon.affiliate?.paypalEmail || (coupon.wooUser?.email
                          ? <span className="aff-woo-email">{coupon.wooUser.email}</span>
                          : '—')}
                      </td>
                      <td className="number">
                        {coupon.affiliate
                          ? `${coupon.affiliate.commissionRate}%`
                          : coupon.wooCommissionRate
                            ? <span className="aff-woo-rate">{coupon.wooCommissionRate}%</span>
                            : '—'}
                      </td>
                      <td className="number">
                        {coupon.wooDiscount
                          ? coupon.wooDiscount.type === 'percent'
                            ? `${parseFloat(coupon.wooDiscount.amount || 0).toFixed(0)}% off`
                            : `$${parseFloat(coupon.wooDiscount.amount || 0).toFixed(2)} off`
                          : '—'}
                      </td>
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
                            onClick={() => startEditing(coupon.code, coupon.affiliate, coupon)}
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
                            placeholder="email@example.com"
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
                        <td colSpan={5} />
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
                <td colSpan={8} className="aff-tfoot-label">Total Owed</td>
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
