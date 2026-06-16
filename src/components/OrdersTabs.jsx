import { useEffect, useState } from "react";
import SubmittedOrders from "./SubmittedOrders";
const DeliveredOrders = (props) => <SubmittedOrders deliveredOnly {...props} />;
import "./OrdersTabs.css";

const ADMIN_TABS = [
  { key: "orders", label: "Pending", component: SubmittedOrders },
  { key: "delivered", label: "Delivered", component: DeliveredOrders },
];

const VENDOR_TABS = [
  { key: "orders", label: "Pending", component: SubmittedOrders },
];

const OrdersTabs = ({ onSuccess, onError, vendorProfile = null }) => {
  const [activeTab, setActiveTab] = useState("orders");
  const [isSticky, setIsSticky] = useState(false);

  const perms = vendorProfile?.permissions || {};
  const tabs = vendorProfile
    ? (perms.viewDelivered ? ADMIN_TABS : VENDOR_TABS)
    : ADMIN_TABS;

  useEffect(() => {
    const handler = () => {
      const wrap = document.querySelector(".orders-tabs-bar-wrap");
      if (!wrap) return;
      const { top } = wrap.getBoundingClientRect();
      const stuck = top <= 80 + 0.5;
      setIsSticky(stuck);
      wrap.classList.toggle("is-sticky", stuck);
    };
    handler();
    window.addEventListener("scroll", handler, { passive: true });
    return () => window.removeEventListener("scroll", handler);
  }, []);

  return (
    <div className="orders-tabs-page">
      {!vendorProfile && (
        <div className="orders-tabs-bar-wrap">
          <div className="orders-tabs-bar">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                className={`orders-tab-btn ${activeTab === tab.key ? "active" : ""}`}
                onClick={() => setActiveTab(tab.key)}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="orders-tab-panel">
        {tabs.map(({ key, component: Component }) =>
          key === activeTab ? (
            <div key={key} className="page-transition tab-transition">
              <Component onSuccess={onSuccess} onError={onError} vendorProfile={vendorProfile} />
            </div>
          ) : null
        )}
      </div>
    </div>
  );
};

export default OrdersTabs;
