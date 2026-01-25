import { useState } from "react";
import OrdersHero from "./OrdersHero";
import NextOrderList from "./NextOrderList";
import OrdersIncoming from "./OrdersIncoming";
import SubmittedOrders from "./SubmittedOrders";
import PaymentTracker from "./PaymentTracker";
import "./OrdersTabs.css";

const TAB_CONFIG = [
  { key: "next", label: "Next Order", component: NextOrderList },
  { key: "incoming", label: "Incoming", component: OrdersIncoming },
  { key: "orders", label: "Pending & Delivered", component: SubmittedOrders },
  { key: "payments", label: "Payment Tracking", component: PaymentTracker },
];

const OrdersTabs = ({ onSuccess, onError }) => {
  const [activeTab, setActiveTab] = useState("next");

  return (
    <div className="orders-tabs-page">
      <OrdersHero />
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
      <div className="orders-tab-panel">
        {TAB_CONFIG.map(({ key, component: Component }) =>
          key === activeTab ? (
            <Component key={key} onSuccess={onSuccess} onError={onError} />
          ) : null
        )}
      </div>
    </div>
  );
};

export default OrdersTabs;
