import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { collection, onSnapshot, updateDoc, doc } from "firebase/firestore";
import { db } from "../firebaseConfig";
import "./LotIDTracker.css";

const createEmptyCOA = () => ({ lot: "", url: "", capColor: "" });
const coaListSafe = (arr) => (Array.isArray(arr) ? arr : []);
const buildCoaUrl = (id) => (id ? `https://coffeeandpeppers.com/${id}` : "");
const resolveCapColorValue = (value) => {
  const cleaned = (value || "").trim();
  if (!cleaned) return null;
  const compact = cleaned.toLowerCase().replace(/\s+/g, "");
  const supportsColor =
    typeof CSS !== "undefined" && CSS.supports
      ? (c) => CSS.supports("color", c)
      : () => false;
  if (supportsColor(compact)) return compact;
  if (supportsColor(cleaned)) return cleaned;
  return null;
};
const pickLabelLink = (p) => {
  const raw =
    p?.canvaTemplateUrl ||
    p?.canvaTemplateURL ||
    p?.labelsUrl ||
    p?.labels ||
    "";
  return raw.trim();
};
const buildEmbedLink = (url) => {
  const trimmed = (url || "").trim();
  if (!trimmed) return "";

  // If it's already an embed link, use it as-is
  if (trimmed.includes("embed")) return trimmed;

  try {
    const parsed = new URL(trimmed);
    // Force Canva URLs to /view and add embed=1 param
    if (parsed.hostname.includes("canva.com")) {
      parsed.pathname = parsed.pathname.replace(/\/edit$/, "/view").replace(/\/view$/, "/view");
      parsed.searchParams.set("embed", "1");
      return parsed.toString();
    }
    // Fallback for other hosts: just add embed param
    parsed.searchParams.set("embed", "1");
    return parsed.toString();
  } catch (e) {
    // If URL constructor fails, append query param manually
    return `${trimmed}${trimmed.includes("?") ? "&" : "?"}embed=1`;
  }
};

const GROUP_ORDER = [
  "BPC/TB",
  "R10/20/30/40",
  "T10/30/40/60",
  "GLUTA",
  "5AM",
  "AOD",
  "CAGRI",
  "CJCIPA",
  "DSIP",
  "GHK",
  "GLOW",
  "IPA",
  "KLOW",
  "Other",
];

const classifySidebarGroup = (p) => {
  const id = (p.id || p.product || "").toUpperCase();
  const name = (p.product || "").toUpperCase();
  if (id.includes("BPC") || id.includes("TB")) return "BPC/TB";
  if (/^R\d+/i.test(id)) return "R10/20/30/40";
  if (/^T\d+/i.test(id)) return "T10/30/40/60";
  if (id.includes("GLUTA") || name.includes("GLUTA")) return "GLUTA";
  if (id.startsWith("5AM") || name.startsWith("5AM")) return "5AM";
  if (id.startsWith("AOD") || name.startsWith("AOD")) return "AOD";
  if (id.startsWith("CAGRI") || name.startsWith("CAGRI")) return "CAGRI";
  if (id.startsWith("CJCIPA") || name.startsWith("CJCIPA")) return "CJCIPA";
  if (id.startsWith("DSIP") || name.startsWith("DSIP")) return "DSIP";
  if (id.startsWith("GHK") || name.startsWith("GHK")) return "GHK";
  if (id.startsWith("GLOW") || name.startsWith("GLOW")) return "GLOW";
  if (id.startsWith("IPA") || name.startsWith("IPA")) return "IPA";
  if (id.startsWith("KLOW") || name.startsWith("KLOW")) return "KLOW";
  return "Other";
};

const LotIDTracker = () => {
  const [products, setProducts] = useState([]);
  const [productData, setProductData] = useState({});
  const [vendors, setVendors] = useState([]);
  const todayChunk = new Date().toISOString().slice(2, 10).replace(/-/g, "");
  const [editingSections, setEditingSections] = useState({});
  const [lotEditMode, setLotEditMode] = useState({});
  const [copyFlash, setCopyFlash] = useState({});
  const [editLotModal, setEditLotModal] = useState({ productKey: null, index: null, lot: "", capColor: "", kits: "", vendor: "", note: "" });
  const [selectedProductId, setSelectedProductId] = useState(null);
  const [lotModalConfig, setLotModalConfig] = useState({
    productKey: null,
    lot: "",
    capColor: "",
    kits: "",
    vendor: "",
    note: "",
  });
  const productRefs = useRef({});
  const [visibleProductId, setVisibleProductId] = useState(null);

  const sidebarGroups = useMemo(() => {
    // Dedup by group label (keep first representative), alphabetize within Other
    const groupedRepresentative = new Map();
    const others = [];

    products.forEach((p) => {
      const label = classifySidebarGroup(p);
      if (label !== "Other") {
        if (!groupedRepresentative.has(label)) {
          groupedRepresentative.set(label, p);
        }
      } else {
        const key = (p.id || p.product || p.docId || "").toString();
        if (!others.some((o) => (o.id || o.product || o.docId || "") === key)) {
          others.push(p);
        }
      }
    });

    others.sort((a, b) =>
      (a.id || a.product || "").localeCompare(b.id || b.product || "")
    );

    const groups = GROUP_ORDER.filter((label) => label !== "Other")
      .map((label) => ({
        label,
        items: groupedRepresentative.has(label) ? [groupedRepresentative.get(label)] : [],
      }))
      .filter((g) => g.items.length > 0);

    const entries = [
      ...groups.map((g) => ({ label: g.label, docId: g.items[0].docId })),
      ...others.map((p) => ({ label: p.id || p.product, docId: p.docId })),
    ].sort((a, b) => (a.label || "").localeCompare(b.label || ""));

    return { groups, ungrouped: others, entries };
  }, [products]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entriesObs) => {
        const visible = entriesObs
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (visible[0]?.target?.dataset?.docid) {
          setVisibleProductId(null);
        }
      },
      { root: null, rootMargin: "0px", threshold: [0.25, 0.5, 0.75] }
    );

    Object.values(productRefs.current).forEach((el) => {
      if (el) observer.observe(el);
    });

    return () => observer.disconnect();
  }, [products]);
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

  // Load vendor profiles
  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, "c&pVendors"),
      (snapshot) => {
        const list = [];
        snapshot.forEach((snap) => {
          list.push({ id: snap.id, name: snap.data().name || snap.id });
        });
        list.sort((a, b) => {
          if (a.name === "TSC") return -1;
          if (b.name === "TSC") return 1;
          return a.name.localeCompare(b.name);
        });
        setVendors(list);
      },
      (err) => console.error("Error loading vendors for LotIDTracker:", err)
    );
    return () => unsubscribe();
  }, []);

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
            capColor: currentCoa.capColor || data.capColor || "",
          };
            items.push({
              docId: doc.id,
              id: data.id || doc.id,
              product: data.product,
              strength: data.strength,
              currentCoa: normalizedCurrent,
              coaList: data.coaList || [],
              canvaTemplateUrl: data.canvaTemplateUrl || "",
              capColor: currentCoa.capColor || data.capColor || ""
            });
          });
        items.sort((a, b) => a.product.localeCompare(b.product));
        setProducts(items);
        setSelectedProductId((prev) => prev ?? (items[0]?.docId ?? null));

        const mapped = items.reduce((acc, p) => {
            acc[p.docId] = {
              productID: p.id || "",
              currentCOA: {
                ...createEmptyCOA(),
                ...p.currentCoa,
                url: buildCoaUrl(p.currentCoa?.lot || p.id || ""),
                capColor: p.currentCoa?.capColor || p.capColor || "",
              },
              coaList: Array.isArray(p.coaList)
                ? p.coaList.map((c) => ({
                    ...c,
                    url: buildCoaUrl(c.lot || c.url || p.id || ""),
                    kits: Number(c.kits) || 0,
                  }))
                : [],
              capColor: p.currentCoa?.capColor || p.capColor || ""
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

  const handleSaveCoaList = async (key, coaList) => {
    const normalized = coaList.map((c) => ({
      ...c,
      url: buildCoaUrl(c.lot || c.url || ""),
      kits: Number(c.kits) || 0,
    }));
    setProductData((prev) => ({
      ...prev,
      [key]: { ...prev[key], coaList: normalized },
    }));
    await saveSection(key, { coaList: normalized });
  };

  const handleCapColorChange = (key, value) => {
    setProductData((prev) => ({
      ...prev,
      [key]: {
        ...prev[key],
        capColor: value,
        currentCOA: { ...prev[key].currentCOA, capColor: value },
      },
    }));
  };

  const handleSaveCapColor = async (key, value) => {
    setProductData((prev) => ({
      ...prev,
      [key]: {
        ...prev[key],
        capColor: value,
        currentCOA: { ...prev[key].currentCOA, capColor: value },
      },
    }));
    await saveSection(key, {
      capColor: value || "",
      currentCoa: { ...(productData[key]?.currentCOA || createEmptyCOA()), capColor: value || "" },
    });
  };

  const handleRemovePastCOA = (key, index) => {
    setProductData((prev) => {
      const updatedPast = [...(prev[key]?.coaList || [])];
      updatedPast.splice(index, 1);
      const updated = {
        ...prev,
        [key]: { ...(prev[key] || {}), coaList: updatedPast },
      };
      handleSaveCoaList(key, updatedPast);
      return updated;
    });
  };

  const handleUpdateCoaCap = (key, index, value) => {
    setProductData((prev) => {
      const currentList = [...(prev[key]?.coaList || [])];
      if (!currentList[index]) return prev;
      currentList[index] = { ...currentList[index], capColor: value };
      handleSaveCoaList(key, currentList);
      return {
        ...prev,
        [key]: { ...(prev[key] || {}), coaList: currentList },
      };
    });
  };

  const handleUpdateLotValue = (key, index, value) => {
    setProductData((prev) => {
      const currentList = [...(prev[key]?.coaList || [])];
      if (!currentList[index]) return prev;
      currentList[index] = { ...currentList[index], lot: value, url: buildCoaUrl(value) };
      handleSaveCoaList(key, currentList);
      return {
        ...prev,
        [key]: { ...(prev[key] || {}), coaList: currentList },
      };
    });
  };

  const handleUpdateLotKits = (key, index, value) => {
    setProductData((prev) => {
      const currentList = [...(prev[key]?.coaList || [])];
      if (!currentList[index]) return prev;
      currentList[index] = { ...currentList[index], kits: Number(value) || 0 };
      handleSaveCoaList(key, currentList);
      return {
        ...prev,
        [key]: { ...(prev[key] || {}), coaList: currentList },
      };
    });
  };

  const handleUpdateLotVendor = (key, index, value) => {
    setProductData((prev) => {
      const currentList = [...(prev[key]?.coaList || [])];
      if (!currentList[index]) return prev;
      currentList[index] = { ...currentList[index], vendor: value };
      handleSaveCoaList(key, currentList);
      return { ...prev, [key]: { ...(prev[key] || {}), coaList: currentList } };
    });
  };

  const handleUpdateLotNote = (key, index, value) => {
    setProductData((prev) => {
      const currentList = [...(prev[key]?.coaList || [])];
      if (!currentList[index]) return prev;
      currentList[index] = { ...currentList[index], note: value };
      handleSaveCoaList(key, currentList);
      return { ...prev, [key]: { ...(prev[key] || {}), coaList: currentList } };
    });
  };

  const openEditLotModal = (key, i, coa) => {
    setEditLotModal({
      productKey: key,
      index: i,
      lot: coa.lot || "",
      capColor: coa.capColor || "",
      kits: coa.kits ?? "",
      vendor: coa.vendor || "",
      note: coa.note || "",
    });
  };

  const closeEditLotModal = () =>
    setEditLotModal({ productKey: null, index: null, lot: "", capColor: "", kits: "", vendor: "", note: "" });

  const saveEditLotModal = () => {
    const { productKey, index, lot, capColor, kits, vendor, note } = editLotModal;
    if (productKey === null || index === null) return;
    setProductData((prev) => {
      const currentList = [...(prev[productKey]?.coaList || [])];
      if (!currentList[index]) return prev;
      currentList[index] = {
        ...currentList[index],
        lot,
        url: buildCoaUrl(lot),
        capColor,
        kits: Number(kits) || 0,
        vendor,
        note,
      };
      handleSaveCoaList(productKey, currentList);
      return { ...prev, [productKey]: { ...(prev[productKey] || {}), coaList: currentList } };
    });
    closeEditLotModal();
  };

  const openLotModal = (key, nextLotId) => {
    const capSeed =
      productData[key]?.capColor ||
      productData[key]?.currentCOA?.capColor ||
      "";
    const lastEntry = (productData[key]?.coaList || [])[0];
    const vendorSeed = lastEntry?.vendor || "";
    setLotModalConfig({
      productKey: key,
      lot: nextLotId,
      capColor: capSeed,
      kits: "",
      vendor: vendorSeed,
      note: "",
    });
  };

  const closeLotModal = () =>
    setLotModalConfig({ productKey: null, lot: "", capColor: "", kits: "", vendor: "", note: "" });

  const confirmLotModal = async () => {
    const { productKey, lot, capColor, kits, vendor, note } = lotModalConfig;
    if (!productKey || !lot) return;
    const entry = productData[productKey] || {
      currentCOA: createEmptyCOA(),
      coaList: [],
    };
    const updatedLots = [
      {
        lot,
        url: buildCoaUrl(lot),
        capColor: capColor || "",
        kits: Number(kits) || 0,
        vendor: vendor || "",
        note: note || "",
      },
      ...(entry.coaList || []),
    ];
    setProductData((prev) => ({
      ...prev,
      [productKey]: { ...(prev[productKey] || entry), coaList: updatedLots },
    }));
    await handleSaveCoaList(productKey, updatedLots);
    copyToClipboard(lot, productKey, "generatedLot");
    closeLotModal();
  };

  return (
    <div className="lot-id-tracker-container">
      <div className="lot-id-pill-bar">
        {products.map((p) => (
          <button
            key={p.docId}
            className={`lot-id-product-pill${selectedProductId === p.docId ? ' active' : ''}`}
            onClick={() => setSelectedProductId(p.docId)}
          >
            {p.id || p.product}
          </button>
        ))}
      </div>
      <div className="lot-id-single-view">
        {products.filter((p) => p.docId === selectedProductId).map((p, idx) => {
          const key = p.docId;
            const labelLink = pickLabelLink(p);
            const embedLink = buildEmbedLink(labelLink);
            const data = productData[key] || {
              productID: "",
              currentCOA: createEmptyCOA(),
              coaList: [],
            };
          const capColorText =
            (productData[key]?.capColor ||
              data.currentCOA.capColor ||
              "").trim();
          const capColorSwatch = resolveCapColorValue(capColorText);
          const usedCount =
            (data.coaList?.length || 0) + (data.currentCOA?.lot ? 1 : 0);
          const nextSeq = String(usedCount + 1).padStart(2, "0");
          const nextIdPreview = `CP${data.productID || p.id || "ID"}${todayChunk}${nextSeq}`;

          return (
            <div
              className="lot-id-card"
              key={key}
              data-docid={key}
              ref={(el) => {
                if (el) productRefs.current[key] = el;
              }}
            >
              <div className="lot-id-header">
                <div className="lot-id-title">
                  <div className="lot-id-preheader">{data.productID || p.id || "—"}</div>
                  <div className="lot-id-name">{p.product}</div>
                </div>
                <div className="lot-id-header-actions">
                  <div className="lot-id-strength">{p.strength}</div>
                </div>
              </div>

              <div className="lot-id-main-split">
                <div className="lot-id-template">
                  {labelLink ? (
                    <>
                      {embedLink && (
                        <div className="lot-id-template-frame">
                          <iframe
                            src={embedLink}
                            title={`${p.id || p.product} label preview`}
                            allowFullScreen
                            loading="lazy"
                          />
                        </div>
                      )}
                      <a
                        href={labelLink}
                        target="_blank"
                        rel="noopener"
                        className="lot-id-template-link"
                      >
                        {p.id ? `${p.id} labels` : "Labels"}
                      </a>
                    </>
                  ) : (
                    <span className="lot-id-template-link muted">waiting on labels</span>
                  )}
                </div>

                <div className="lot-id-section">
                <div className="lot-id-section-header">
                  <label>Lot List</label>
                  <button
                    className="lot-id-generate-btn"
                    onClick={() => openLotModal(key, nextIdPreview)}
                  >
                    + Generate Lot ID
                  </button>
                </div>
                <ul className="lot-id-past-list">
                  {(() => {
                    const lotList = data.coaList || [];
                    return lotList.length ? (
                      lotList.map((coa, i) => (
                        <li key={i} className="lot-id-list-item">
                          <div className="lot-id-card-header">
                            <button
                              className="lot-id-card-id"
                              type="button"
                              onClick={() => copyToClipboard(coa.lot, key, `lot-${i}`)}
                              title="Click to copy"
                            >
                              {coa.lot || <i>no lot id</i>}
                              <span className="lot-id-card-copy-icon">⎘</span>
                            </button>
                            <button
                              className="lot-id-edit-toggle lot-id-card-edit-btn"
                              onClick={() => openEditLotModal(key, i, coa)}
                            >
                              Edit
                            </button>
                          </div>
                          {copyFlash[`${key}-lot-${i}`] && (
                            <span className="lot-id-copied">Copied!</span>
                          )}
                          <div className="lot-id-card-meta">
                            <span className={`lot-id-capchip${coa.capColor ? "" : " empty"}`}>
                              <span
                                className="lot-id-capchip-swatch"
                                style={{ backgroundColor: coa.capColor || "#e7dfd3" }}
                              />
                              <span className="lot-id-capchip-text">
                                {coa.capColor || "No cap color"}
                              </span>
                            </span>
                            <span className="lot-id-meta-stat">
                              {typeof coa.kits === "number" ? coa.kits : 0} kits
                            </span>
                            {coa.vendor && (
                              <span className="lot-id-vendor-badge">{coa.vendor}</span>
                            )}
                          </div>
                          {coa.note && (
                            <div className="lot-id-note-display">{coa.note}</div>
                          )}
                        </li>
                      ))
                    ) : (
                      <li className="lot-id-past-empty">None</li>
                    );
                  })()}
                </ul>
              </div>
              </div>
            </div>
          );
        })}
      </div>

      {lotModalConfig.productKey &&
        createPortal(
          <div className="lot-modal-backdrop" onClick={closeLotModal}>
            <div className="lot-modal" onClick={(e) => e.stopPropagation()}>
              <h3>Generate New Lot</h3>
              <p className="lot-modal-sub">Lot ID is auto-created. Add cap color and batch size.</p>

              <label className="lot-modal-label">Generated Lot ID</label>
              <input
                type="text"
                value={lotModalConfig.lot}
                readOnly
                className="lot-modal-input"
              />

              <label className="lot-modal-label">Cap Color</label>
              <input
                type="text"
                placeholder="e.g. Sand, #F5E9D8"
                value={lotModalConfig.capColor}
                onChange={(e) =>
                  setLotModalConfig((prev) => ({ ...prev, capColor: e.target.value }))
                }
                className="lot-modal-input"
              />

              <label className="lot-modal-label">Kits in Batch</label>
              <input
                type="number"
                min="0"
                placeholder="Enter kit count"
                value={lotModalConfig.kits}
                onChange={(e) =>
                  setLotModalConfig((prev) => ({ ...prev, kits: e.target.value }))
                }
                onFocus={(e) => e.target.select()}
                className="lot-modal-input"
              />

              <label className="lot-modal-label">Vendor</label>
              <div className="lot-modal-vendor-pills">
                <button
                  type="button"
                  className={`lot-modal-vendor-pill${!lotModalConfig.vendor ? ' active' : ''}`}
                  onClick={() => setLotModalConfig((prev) => ({ ...prev, vendor: '' }))}
                >
                  None
                </button>
                {vendors.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    className={`lot-modal-vendor-pill${lotModalConfig.vendor === v.name ? ' active' : ''}`}
                    onClick={() => setLotModalConfig((prev) => ({ ...prev, vendor: v.name }))}
                  >
                    {v.name}
                  </button>
                ))}
              </div>

              <label className="lot-modal-label">Note <span className="lot-modal-label-optional">(optional)</span></label>
              <textarea
                className="lot-modal-input lot-modal-textarea"
                placeholder="Add a note about this lot..."
                rows={2}
                value={lotModalConfig.note}
                onChange={(e) =>
                  setLotModalConfig((prev) => ({ ...prev, note: e.target.value }))
                }
              />

              <div className="lot-modal-actions">
                <button type="button" className="lot-modal-btn secondary" onClick={closeLotModal}>
                  Cancel
                </button>
                <button type="button" className="lot-modal-btn primary" onClick={confirmLotModal}>
                  Save Lot
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

      {editLotModal.productKey !== null &&
        createPortal(
          <div className="lot-modal-backdrop" onClick={closeEditLotModal}>
            <div className="lot-modal" onClick={(e) => e.stopPropagation()}>
              <h3>Edit Lot</h3>
              <p className="lot-modal-sub">Update the details for this lot entry.</p>

              <label className="lot-modal-label">Lot ID</label>
              <input
                type="text"
                value={editLotModal.lot}
                onChange={(e) => setEditLotModal((prev) => ({ ...prev, lot: e.target.value }))}
                className="lot-modal-input"
                placeholder="Lot ID"
              />

              <label className="lot-modal-label">Cap Color</label>
              <input
                type="text"
                placeholder="e.g. Sand, #F5E9D8"
                value={editLotModal.capColor}
                onChange={(e) => setEditLotModal((prev) => ({ ...prev, capColor: e.target.value }))}
                className="lot-modal-input"
              />

              <label className="lot-modal-label">Kits in Batch</label>
              <input
                type="number"
                min="0"
                placeholder="Enter kit count"
                value={editLotModal.kits}
                onChange={(e) => setEditLotModal((prev) => ({ ...prev, kits: e.target.value }))}
                onFocus={(e) => e.target.select()}
                className="lot-modal-input"
              />

              <label className="lot-modal-label">Vendor</label>
              <div className="lot-modal-vendor-pills">
                <button
                  type="button"
                  className={`lot-modal-vendor-pill${!editLotModal.vendor ? ' active' : ''}`}
                  onClick={() => setEditLotModal((prev) => ({ ...prev, vendor: '' }))}
                >
                  None
                </button>
                {vendors.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    className={`lot-modal-vendor-pill${editLotModal.vendor === v.name ? ' active' : ''}`}
                    onClick={() => setEditLotModal((prev) => ({ ...prev, vendor: v.name }))}
                  >
                    {v.name}
                  </button>
                ))}
              </div>

              <label className="lot-modal-label">Note <span className="lot-modal-label-optional">(optional)</span></label>
              <textarea
                className="lot-modal-input lot-modal-textarea"
                placeholder="Add a note about this lot..."
                rows={2}
                value={editLotModal.note}
                onChange={(e) => setEditLotModal((prev) => ({ ...prev, note: e.target.value }))}
              />

              <div className="lot-modal-actions">
                <button type="button" className="lot-modal-btn secondary" onClick={closeEditLotModal}>
                  Cancel
                </button>
                <button type="button" className="lot-modal-btn primary" onClick={saveEditLotModal}>
                  Save Changes
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};

export default LotIDTracker;
