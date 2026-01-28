import { useEffect, useMemo, useRef, useState } from "react";
import { collection, doc, onSnapshot, setDoc } from "firebase/firestore";
import { db } from "../firebaseConfig";
import "./SubmittedOrders.css";

const OrdersIncoming = () => {
  const [rows, setRows] = useState([]);
  const [editing, setEditing] = useState({ key: null, value: "" });
  const [editingAll, setEditingAll] = useState(false);
  const [editingValues, setEditingValues] = useState({});
  const [activeKey, setActiveKey] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [savingKey, setSavingKey] = useState(null);
  const inputRef = useRef(null);
  const containerRef = useRef(null);

  // Listen to unified incoming collection (qty + received)
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "c&pIncomingProductRecieved"), (snap) => {
      const list = [];
      snap.forEach((docSnap) => {
        const data = docSnap.data() || {};
        list.push({
          id: docSnap.id,
          name: data.name || "",
          strength: data.strength || "",
          qty: Number(data.qty) || 0,
          received: Math.min(Number(data.received) || 0, Number(data.qty) || 0),
        });
      });
      list.sort(
        (a, b) =>
          (a.name || "").localeCompare(b.name || "") ||
          (a.strength || "").localeCompare(b.strength || "")
      );
      setRows(list);
    });
    return () => unsub();
  }, []);

  const totals = useMemo(() => {
    return rows.reduce(
      (acc, r) => {
        acc.qty += r.qty;
        acc.received += r.received;
        acc.waiting += Math.max(0, r.qty - r.received);
        return acc;
      },
      { qty: 0, received: 0, waiting: 0 }
    );
  }, [rows]);

  const startEdit = (key, currentValue) => {
    setEditing({ key, value: String(currentValue ?? 0) });
    setActiveKey(key);
  };

  const cancelEdit = () => {
    setEditing({ key: null, value: "" });
    setActiveKey(null);
    setEditingAll(false);
    setEditingValues({});
  };

  const saveReceived = async (payload = editing, clearEdit = true) => {
    if (!payload || !payload.key) return;
    const row = rows.find((r) => `${r.name}__${r.strength}` === payload.key);
    if (!row) return;
    const target = Math.max(0, parseInt(payload.value, 10) || 0);

    setIsSaving(true);
    setSavingKey(payload.key);
    try {
      await setDoc(doc(db, "c&pIncomingProductRecieved", payload.key), {
        name: row.name,
        strength: row.strength,
        received: target,
      });
      setReceivedMap((prev) => ({ ...prev, [payload.key]: target }));
      setEditingValues((prev) => ({ ...prev, [payload.key]: String(target) }));
    } catch (err) {
      console.error("Failed to update received", err);
    } finally {
      setIsSaving(false);
      setSavingKey(null);
      if (clearEdit && payload.key === editing.key) {
        cancelEdit();
      }
    }
  };

  const openReceivedCell = async (key, currentValue) => {
    // Initialize bulk edit values if entering edit mode
    if (!editingAll) {
      const map = {};
      rows.forEach((r) => {
        const rKey = `${r.name}__${r.strength}`;
        map[rKey] = String(r.received ?? 0);
      });
      setEditingValues(map);
      setEditingAll(true);
    }

    // If another cell is being edited, save it in the background (non-blocking)
    if (editing.key && editing.key !== key) {
      const snapshot = { ...editing };
      saveReceived(snapshot, false);
    }

    startEdit(key, currentValue);
    requestAnimationFrame(focusInput);
  };

  const focusInput = () => {
    if (inputRef.current) {
      if (inputRef.current.focus) {
        // Prevent page jump when focusing newly editable inputs
        inputRef.current.focus({ preventScroll: true });
      }
      inputRef.current.select();
    }
  };

  // When active target changes, focus and select the input automatically
  useEffect(() => {
    if (activeKey) {
      requestAnimationFrame(focusInput);
    }
  }, [activeKey]);

  // Close edit when clicking anywhere outside the active input (but allow switching to another received cell)
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (!editingAll) return;
      const container = containerRef.current;
      if (container && container.contains(e.target)) return; // inside table, let cell click manage
      // outside container: save all and close
      saveAllAndClose();
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [editingAll, editingValues, rows]);

  const handleReceivedKey = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      saveReceived();
    } else if (e.key === "Escape") {
      cancelEdit();
    }
  };

  // Save all changed rows and close edit mode
  const saveAllAndClose = async () => {
    if (!editingAll) return;
    const payloads = rows
      .map((r) => {
        const key = `${r.name}__${r.strength}`;
        const val = editingValues[key];
        return val !== undefined && Number(val) !== r.received
          ? { key, value: val }
          : null;
      })
      .filter(Boolean);

    if (payloads.length) {
      setIsSaving(true);
      for (const p of payloads) {
        // sequential to keep UI predictable; small set so ok
        // eslint-disable-next-line no-await-in-loop
        await saveReceived(p, false);
      }
      setIsSaving(false);
    }

    cancelEdit();
  };

  return (
    <div className="orders-aggregate">
      <div className="orders-aggregate-header">
        <div>
          <h3>Incoming Product Totals</h3>
          <p>Quantities across all pending orders.</p>
        </div>
        <div className="orders-aggregate-count">
          {rows.length} products • {totals.qty} kits incoming
        </div>
      </div>
      {rows.length === 0 ? (
        <div className="empty-orders">No pending items.</div>
      ) : (
            <div className="orders-aggregate-table-wrap" ref={containerRef}>
              <table className="orders-aggregate-table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Strength</th>
                <th className="qty-col">Total Qty</th>
                <th className="qty-col">Received</th>
                <th className="qty-col">Waiting</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.name}-${row.strength}`}>
                  <td>{row.name}</td>
                  <td>{row.strength}</td>
                  <td className="qty-col">{row.qty}</td>
                  <td
                    className={`qty-col received-cell ${
                      editingAll ? "editing" : ""
                    } ${activeKey === `${row.name}__${row.strength}` ? "active" : ""}`}
                    onClick={() =>
                      openReceivedCell(`${row.name}__${row.strength}`, row.received)
                    }
                  >
                    {editingAll ? (
                      <input
                        key={`${row.name}__${row.strength}-input`}
                        type="number"
                        min="0"
                        value={editingValues[`${row.name}__${row.strength}`] ?? row.received}
                        onChange={(e) => {
                          const key = `${row.name}__${row.strength}`;
                          const val = e.target.value;
                          setEditingValues((prev) => ({ ...prev, [key]: val }));
                          if (key === activeKey) setEditing({ key, value: val });
                        }}
                        onBlur={(e) => {
                          const container = containerRef.current;
                          if (!container || !container.contains(e.relatedTarget)) {
                            saveAllAndClose();
                          }
                        }}
                        onKeyDown={handleReceivedKey}
                        onFocus={(e) => e.target.select()}
                        ref={
                          activeKey === `${row.name}__${row.strength}`
                            ? inputRef
                            : null
                        }
                        className="received-input"
                        disabled={savingKey === `${row.name}__${row.strength}`}
                      />
                    ) : (
                      row.received
                    )}
                  </td>
                  <td className="qty-col">{Math.max(0, row.qty - row.received)}</td>
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
