import React, { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import './AllDeliveriesModal.css';

const AllDeliveriesModal = ({ isOpen, onClose, pendingOrders = [], vendorColorMap = {} }) => {
  const [expandedDates, setExpandedDates] = useState(new Set());

  const groupedDeliveries = useMemo(() => {
    const groups = new Map();

    // Collect all delivered tracking entries
    const deliveredTrackings = [];

    pendingOrders.forEach((order) => {
      if (!order.trackingEntries) return;

      order.trackingEntries.forEach((entry) => {
        // Only include entries that have a delivery date
        if (!entry.deliveryDate) return;

        deliveredTrackings.push({
          orderId: order.id,
          vendor: order.vendor || 'TSC',
          submittedAt: order.submittedAt,
          carrier: entry.carrier || '-',
          trackingNumbers: entry.deliveredNumbers || [],
          deliveryDate: entry.deliveryDate,
          perNumberData: entry.perNumberData || {}
        });
      });
    });

    // Group by delivery date
    const groupsWithTimestamp = new Map();
    deliveredTrackings.forEach((tracking) => {
      const date = new Date(tracking.deliveryDate);
      const dateKey = date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
      const timestamp = date.getTime();

      if (!groupsWithTimestamp.has(dateKey)) {
        groupsWithTimestamp.set(dateKey, { timestamp, trackings: [] });
      }
      groupsWithTimestamp.get(dateKey).trackings.push(tracking);
    });

    const sorted = Array.from(groupsWithTimestamp.entries())
      .sort((a, b) => b[1].timestamp - a[1].timestamp)
      .map(([date, { trackings }]) => ({
        date,
        trackings: trackings.sort((a, b) =>
          new Date(b.deliveryDate) - new Date(a.deliveryDate)
        )
      }));

    return sorted;
  }, [pendingOrders]);

  const toggleDateExpanded = (date) => {
    const next = new Set(expandedDates);
    if (next.has(date)) {
      next.delete(date);
    } else {
      next.add(date);
    }
    setExpandedDates(next);
  };

  const getVendorColor = (vendorName) => {
    return vendorColorMap[vendorName] || '#6B5B73';
  };

  if (!isOpen) return null;

  return createPortal(
    <div className="all-deliveries-modal-overlay" onClick={onClose}>
      <div className="all-deliveries-modal" onClick={(e) => e.stopPropagation()}>
        <div className="adm-header">
          <h2>All Tracking</h2>
          <button className="adm-close-btn" onClick={onClose}>✕</button>
        </div>

        <div className="adm-content">
          {groupedDeliveries.length === 0 ? (
            <div className="adm-empty">
              <p>No delivered tracking yet</p>
            </div>
          ) : (
            groupedDeliveries.map((dateGroup) => (
              <div key={dateGroup.date} className="adm-date-group">
                <button
                  className="adm-date-header"
                  onClick={() => toggleDateExpanded(dateGroup.date)}
                >
                  <span className="adm-date-label">{dateGroup.date}</span>
                  <span className="adm-date-count">{dateGroup.trackings.length}</span>
                  <span className="adm-date-chevron">
                    {expandedDates.has(dateGroup.date) ? '▾' : '▸'}
                  </span>
                </button>

                {expandedDates.has(dateGroup.date) && (
                  <div className="adm-deliveries-list">
                    {dateGroup.trackings.map((tracking, idx) => (
                      <div key={`${tracking.orderId}-${idx}`} className="adm-delivery-card">
                        <div className="adm-delivery-header">
                          <div className="adm-delivery-meta">
                            <span className="adm-order-id">{tracking.orderId}</span>
                            <span
                              className="adm-vendor-badge"
                              style={{ backgroundColor: getVendorColor(tracking.vendor) }}
                            >
                              {tracking.vendor}
                            </span>
                          </div>
                        </div>

                        <div className="adm-tracking-entry">
                          <div className="adm-tracking-carrier">{tracking.carrier}</div>
                          <div className="adm-tracking-numbers">
                            {tracking.trackingNumbers.length > 0 ? (
                              tracking.trackingNumbers.map((num, nidx) => (
                                <div key={nidx} className="adm-tracking-number">
                                  {num}
                                </div>
                              ))
                            ) : (
                              <div className="adm-tracking-number">-</div>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>,
    document.body
  );
};

export default AllDeliveriesModal;
