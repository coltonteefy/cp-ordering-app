import { useEffect, useState } from "react";
import OrdersHero from "./OrdersHero";
import NextOrderList from "./NextOrderList";
import SubmittedOrders from "./SubmittedOrders";
const DeliveredOrders = (props) => <SubmittedOrders deliveredOnly {...props} />;
import PaymentTracker from "./PaymentTracker";
import "./OrdersTabs.css";

const TAB_CONFIG = [
  { key: "next", label: "Next Order", component: NextOrderList },
  { key: "orders", label: "Pending", component: SubmittedOrders },
  { key: "delivered", label: "Delivered", component: DeliveredOrders },
  { key: "payments", label: "Payment Tracking", component: PaymentTracker },
];

const OrdersTabs = ({ onSuccess, onError }) => {
  const [activeTab, setActiveTab] = useState("next");
  const [isSticky, setIsSticky] = useState(false);

  useEffect(() => {
    const handler = () => {
      const wrap = document.querySelector(".orders-tabs-bar-wrap");
      if (!wrap) return;
      const { top } = wrap.getBoundingClientRect();
      const stuck = top <= 80 + 0.5; // close to sticky threshold
      setIsSticky(stuck);
      wrap.classList.toggle("is-sticky", stuck);
    };
    handler();
    window.addEventListener("scroll", handler, { passive: true });
    return () => window.removeEventListener("scroll", handler);
  }, []);

  return (
    <div className="orders-tabs-page">
      <OrdersHero />
      <div className="orders-tabs-bar-wrap">
        <div className="orders-tabs-bar">
          {TAB_CONFIG.map((tab) => (
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
      <div className="orders-tab-panel">
        {TAB_CONFIG.map(({ key, component: Component }) =>
          key === activeTab ? (
            <div key={key} className="page-transition tab-transition">
              <Component onSuccess={onSuccess} onError={onError} />
            </div>
          ) : null
        )}
      </div>
    </div>
  );
};

export default OrdersTabs;
