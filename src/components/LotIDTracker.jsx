import React, { useEffect, useState } from "react";
import { collection, onSnapshot, updateDoc, doc } from "firebase/firestore";
import { db } from "../firebaseConfig";
import "./LotIDTracker.css";

const createEmptyCOA = () => ({ lot: "", url: "" });
const pastCoAsSafe = (arr) => (Array.isArray(arr) ? arr : []);
const buildCoaUrl = (id) => (id ? `https://coffeeandpeppers.com/${id}` : "");
const pickLabelLink = (p) => {
  const raw =
    p?.canvaTemplateUrl ||
    p?.canvaTemplateURL ||
    p?.labelsUrl ||
    p?.labels ||
    "";
  return raw.trim();
};

const LotIDTracker = () => {
  const [products, setProducts] = useState([]);
  const [productData, setProductData] = useState({});
  const todayChunk = new Date().toISOString().slice(2, 10).replace(/-/g, "");
  const [editingSections, setEditingSections] = useState({});
  const [copyFlash, setCopyFlash] = useState({});
  const saveSection = async (key, payload) => {
    try {
      await updateDoc(doc(db, "c&pProductList", key), payload);
    } catch (err) {
      console.error("Error saving section", err);
    }
  };
  const copyToClipboard = (text, key, field) => {
    if (!text) return;
    navigator.clipboard
      ?.writeText(text)
      .then(() => {
        const id = `${key}-${field}`;
        setCopyFlash((prev) => ({ ...prev, [id]: true }));
        setTimeout(
          () => setCopyFlash((prev) => ({ ...prev, [id]: false })),
          1200
        );
      })
      .catch((err) => {
        console.error("Clipboard copy failed", err);
      });
  };

  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, "c&pProductList"),
      (snapshot) => {
        const items = [];
        snapshot.forEach((doc) => {
          const data = doc.data();
          const currentCoa = data.currentCoa || createEmptyCOA();
          const normalizedCurrent = {
            lot: currentCoa.lot || "",
            url: buildCoaUrl(currentCoa.lot || data.id || ""),
          };
          items.push({
            docId: doc.id,
            id: data.id || doc.id,
            product: data.product,
            strength: data.strength,
            currentCoa: normalizedCurrent,
            pastCoas: data.pastCoas || [],
            canvaTemplateUrl: data.canvaTemplateUrl || "",
          });
        });
        items.sort((a, b) => a.product.localeCompare(b.product));
        setProducts(items);

        const mapped = items.reduce((acc, p) => {
          acc[p.docId] = {
            productID: p.id || "",
            currentCOA: {
              ...createEmptyCOA(),
              ...p.currentCoa,
              url: buildCoaUrl(p.currentCoa?.lot || p.id || ""),
            },
            pastCOAs: Array.isArray(p.pastCoas)
              ? p.pastCoas.map((c) => ({
                  ...c,
                  url: buildCoaUrl(c.lot || c.url || p.id || ""),
                }))
              : [],
          };
          return acc;
        }, {});
        setProductData(mapped);
      },
      (error) => {
        console.error("Error loading products for LotIDTracker:", error);
      }
    );

    return () => unsubscribe();
  }, []);

  const handleProductIDChange = (key, value) => {
    setProductData((prev) => ({
      ...prev,
      [key]: { ...prev[key], productID: value },
    }));
  };

  const handleCurrentCOAChange = (key, field, value) => {
    setProductData((prev) => ({
      ...prev,
      [key]: {
        ...prev[key],
        currentCOA:
          field === "lot"
            ? {
                ...prev[key].currentCOA,
                lot: value,
                url: buildCoaUrl(value),
              }
            : { ...prev[key].currentCOA, [field]: value },
      },
    }));
  };

  const handleAddPastCOA = async (key) => {
    const entry = productData[key];
    if (!entry) return;
    const { currentCOA, pastCOAs, productID } = entry;
    if (!currentCOA.lot && !currentCOA.url) return;

    const safePast = pastCoAsSafe(pastCOAs);
    const normalizedCurrent = {
      ...currentCOA,
      url: buildCoaUrl(currentCOA.lot || productID || ""),
    };
    const updatedPast = [normalizedCurrent, ...safePast];
    const nextSeq = String(updatedPast.length + 1).padStart(2, "0");
    const nextCurrent = {
      lot: `CP${productID || "ID"}${todayChunk}${nextSeq}`,
      url: "",
    };

    setProductData((prev) => ({
      ...prev,
      [key]: {
        ...prev[key],
        pastCOAs: updatedPast,
        currentCOA: nextCurrent,
      },
    }));

    try {
      await updateDoc(doc(db, "c&pProductList", key), {
        id: productID || "",
        currentCoa: nextCurrent,
        pastCoas: updatedPast,
      });
    } catch (err) {
      console.error("Error updating past COAs", err);
    }
  };

  const handleSaveCurrentCoa = async (key, currentCOA) => {
    const normalized = {
      ...currentCOA,
      url: buildCoaUrl(currentCOA.lot || ""),
    };
    setProductData((prev) => ({
      ...prev,
      [key]: { ...prev[key], currentCOA: normalized },
    }));
    await saveSection(key, { currentCoa: normalized });
  };

  const handleSavePastCoas = async (key, pastCOAs) => {
    const normalized = pastCOAs.map((c) => ({
      ...c,
      url: buildCoaUrl(c.lot || c.url || ""),
    }));
    setProductData((prev) => ({
      ...prev,
      [key]: { ...prev[key], pastCOAs: normalized },
    }));
    await saveSection(key, { pastCoas: normalized });
  };

  const handleRemovePastCOA = (key, index) => {
    setProductData((prev) => {
      const updatedPast = [...prev[key].pastCOAs];
      updatedPast.splice(index, 1);
      const updated = {
        ...prev,
        [key]: { ...prev[key], pastCOAs: updatedPast },
      };
      handleSavePastCoas(key, updatedPast);
      return updated;
    });
  };

  return (
    <div className="lot-id-tracker-container">
      <div className="lot-id-grid">
        {products.map((p, idx) => {
        const key = p.docId;
          const labelLink = pickLabelLink(p);
          const data = productData[key] || {
            productID: "",
            currentCOA: createEmptyCOA(),
            pastCOAs: [],
          };
        const usedCount =
          (data.pastCOAs?.length || 0) + (data.currentCOA?.lot ? 1 : 0);
        const nextSeq = String(usedCount + 1).padStart(2, "0");
        const nextIdPreview = `CP${data.productID || p.id || "ID"}${todayChunk}${nextSeq}`;
        const isEditingCurrent =
          editingSections[key]?.current || false;
        const isEditingPast =
          editingSections[key]?.past || false;

        return (
          <div className="lot-id-card" key={key}>
            <div className="lot-id-header">
              <div className="lot-id-title">
                <div className="lot-id-preheader">{data.productID || p.id || "—"}</div>
                <div className="lot-id-name">{p.product}</div>
              </div>
              <div className="lot-id-header-actions">
                <div className="lot-id-strength">{p.strength}</div>
              </div>
            </div>

            <div className="lot-id-template">
              {idx === 0 && (
                <div className="lot-id-template-frame">
                  <iframe
                    loading="lazy"
                    src="https://www.canva.com/design/DAG-4Dea7-s/bS8nzpq96ZVjYdNaN59ctQ/view?embed"
                    allowFullScreen
                    allow="fullscreen"
                    title="Freedom testing labels template"
                  ></iframe>
                </div>
              )}
              {labelLink ? (
                <a
                  href={labelLink}
                  target="_blank"
                  rel="noopener"
                  className="lot-id-template-link"
                >
                  {p.id ? `${p.id} labels` : "Labels"}
                </a>
              ) : (
                <span className="lot-id-template-link muted">waiting on labels</span>
              )}
            </div>

            <div className="lot-id-section">
              <div className="lot-id-section-header">
                <label>Current COA</label>
                <button
                    className="lot-id-edit-btn"
                    onClick={async () => {
                      if (isEditingCurrent) {
                        await handleSaveCurrentCoa(key, data.currentCOA);
                      }
                      setEditingSections((prev) => ({
                        ...prev,
                        [key]: { ...(prev[key] || {}), current: !isEditingCurrent },
                      }));
                    }}
                  >
                    {isEditingCurrent ? "Done" : "Edit"}
                  </button>
                </div>
                {isEditingCurrent ? (
                  <>
                    <div className="lot-id-url-editor">
                      <span className="lot-id-url-prefix">https://coffeeandpeppers.com/</span>
                      <input
                        type="text"
                        className="lot-id-url-input"
                        value={data.currentCOA.lot}
                        onChange={(e) =>
                          handleCurrentCOAChange(key, "lot", e.target.value)
                        }
                        placeholder="COA ID"
                      />
                    </div>
                  </>
                ) : (
                  <>
                    <div className="lot-id-display">
                      <button
                        type="button"
                        className="lot-id-copy"
                        onClick={() =>
                          copyToClipboard(data.currentCOA.lot, key, "currentLot")
                        }
                        title="Copy lot ID"
                      >
                        {data.currentCOA.lot || <span className="lot-id-muted">LOT</span>}
                      </button>
                      {copyFlash[`${key}-currentLot`] && (
                        <span className="lot-id-copied">Copied</span>
                      )}
                    </div>
                    <div className="lot-id-display">
                      {buildCoaUrl(data.currentCOA.lot) ? (
                        <a
                          className="lot-id-url-pill"
                          href={buildCoaUrl(data.currentCOA.lot)}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <span className="lot-id-url-prefix">https://coffeeandpeppers.com/</span>
                          <span className="lot-id-url-suffix">{data.currentCOA.lot}</span>
                        </a>
                      ) : (
                        <span className="lot-id-muted">URL</span>
                      )}
                    </div>
                  </>
                )}
                <div className="lot-id-actions">
                  <button
                    className="add-past-btn"
                    onClick={() => handleAddPastCOA(key)}
                  >
                    Add to Past COAs
                  </button>
                </div>
              </div>

              <div className="lot-id-pattern">
                <span className="lot-id-pattern-label">Next Batch ID</span>
                <button
                  type="button"
                  className="lot-id-pattern-code"
                  onClick={() => copyToClipboard(nextIdPreview, key, "nextId")}
                  title="Copy next batch ID"
                >
                  {nextIdPreview}
                </button>
                {copyFlash[`${key}-nextId`] && (
                  <span className="lot-id-copied">Copied</span>
                )}
              </div>

              <div className="lot-id-section">
                <div className="lot-id-section-header">
                  <label>Past COAs</label>
                  <button
                    className="lot-id-edit-btn"
                    onClick={async () => {
                      if (isEditingPast) {
                        await handleSavePastCoas(key, data.pastCOAs);
                      }
                      setEditingSections((prev) => ({
                        ...prev,
                        [key]: { ...(prev[key] || {}), past: !isEditingPast },
                      }));
                    }}
                  >
                    {isEditingPast ? "Done" : "Edit"}
                  </button>
                </div>
                <ul className="lot-id-past-list">
                  {data.pastCOAs.length === 0 ? (
                    <li className="lot-id-past-empty">None</li>
                  ) : (
                    data.pastCOAs.map((coa, i) => (
                      <li
                        key={i}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "0.5rem",
                        }}
                      >
                        <span>
                          <b>Lot:</b>{" "}
                          <button
                            className="lot-id-copy"
                            type="button"
                            onClick={() => copyToClipboard(coa.lot, key, `past-${i}`)}
                            title="Copy lot ID"
                          >
                            {coa.lot || <i>none</i>}
                          </button>
                          {copyFlash[`${key}-past-${i}`] && (
                            <span className="lot-id-copied">Copied</span>
                          )}
                        </span>
                        <span>
                          <b>URL:</b>{" "}
                          {coa.url ? (
                            <a
                              href={coa.url}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              {coa.url}
                            </a>
                          ) : (
                            <i>none</i>
                          )}
                        </span>
                        <button
                          style={{
                            marginLeft: "auto",
                            background: "#eee",
                            border: "none",
                            borderRadius: 4,
                          cursor: "pointer",
                          padding: "0.2rem 0.6rem",
                        }}
                        onClick={() => handleRemovePastCOA(key, i)}
                        title="Remove"
                          disabled={!isEditingPast}
                        >
                          ✕
                        </button>
                      </li>
                    ))
                  )}
                </ul>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default LotIDTracker;
