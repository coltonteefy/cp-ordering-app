import { useEffect, useState } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "../firebaseConfig";
import "./SubmittedOrders.css";

const OrdersHero = () => {
  const [pendingCount, setPendingCount] = useState(0);
  const [deliveredCount, setDeliveredCount] = useState(0);
  const [productCount, setProductCount] = useState(0);

  useEffect(() => {
    const unsubPending = onSnapshot(collection(db, "c&pProductOrders"), (snap) =>
      setPendingCount(snap.size)
    );
    const unsubDelivered = onSnapshot(
      collection(db, "c&pPastInventoryOrders"),
      (snap) => setDeliveredCount(snap.size)
    );
    const unsubProducts = onSnapshot(
      collection(db, "c&pProductList"),
      (snap) => setProductCount(snap.size)
    );

    return () => {
      unsubPending();
      unsubDelivered();
      unsubProducts();
    };
  }, []);

  const totalOrders = pendingCount + deliveredCount;

  return (
    <div className="orders-hero">
      <div className="orders-hero-text">
        <span className="orders-hero-eyebrow">Orders</span>
        <h1>Track every order at a glance</h1>
        <p>
          View pending and delivered orders, update tracking, and keep fulfillment humming.
        </p>
      </div>
      <div className="orders-hero-metrics">
        <div className="orders-metric-card">
          <div className="orders-metric-label">Total orders</div>
          <div className="orders-metric-value">{totalOrders}</div>
        </div>
        <div className="orders-metric-card">
          <div className="orders-metric-label">Pending</div>
          <div className="orders-metric-value">{pendingCount}</div>
        </div>
        <div className="orders-metric-card">
          <div className="orders-metric-label">Products in catalog</div>
          <div className="orders-metric-value">{productCount}</div>
        </div>
      </div>
    </div>
  );
};

export default OrdersHero;
