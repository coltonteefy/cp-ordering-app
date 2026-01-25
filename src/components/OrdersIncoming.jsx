import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "../firebaseConfig";
import "./SubmittedOrders.css";

const OrdersIncoming = () => {
  const [rows, setRows] = useState([]);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "c&pProductOrders"), (snap) => {
      const acc = {};
      snap.forEach((doc) => {
        const data = doc.data();
        (data.items || []).forEach((item) => {
          const name = item.productName || item.product || "";
          const strength = item.productStrength || item.strength || "";
          const key = `${name}__${strength}`;
          const current =
            acc[key] || { name, strength, qty: 0 };
          current.qty += Number(item.quantity) || 0;
          acc[key] = current;
        });
      });
      setRows(
        Object.values(acc).sort(
          (a, b) =>
            (a.name || "").localeCompare(b.name || "") ||
            (a.strength || "").localeCompare(b.strength || "")
        )
      );
    });
    return () => unsub();
  }, []);

  const totalItems = useMemo(
    () => rows.reduce((sum, r) => sum + r.qty, 0),
    [rows]
  );

  return (
    <div className="orders-aggregate">
      <div className="orders-aggregate-header">
        <div>
          <h3>Incoming Product Totals</h3>
          <p>Sum of quantities across all pending orders.</p>
        </div>
        <div className="orders-aggregate-count">
          {rows.length} products • {totalItems} kits
        </div>
      </div>
      {rows.length === 0 ? (
        <div className="empty-orders">No pending items.</div>
      ) : (
        <div className="orders-aggregate-table-wrap">
          <table className="orders-aggregate-table">
            <thead>
              <tr>
                <th>Product</th>
                <th>Strength</th>
                <th className="qty-col">Total Qty</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.name}-${row.strength}`}>
                  <td>{row.name}</td>
                  <td>{row.strength}</td>
                  <td className="qty-col">{row.qty}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default OrdersIncoming;
