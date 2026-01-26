import React, { useEffect, useMemo, useRef, useState } from "react";
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
  const todayChunk = new Date().toISOString().slice(2, 10).replace(/-/g, "");
  const [editingSections, setEditingSections] = useState({});
  const [lotEditMode, setLotEditMode] = useState({});
  const [copyFlash, setCopyFlash] = useState({});
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

  return (
    <div className="lot-id-tracker-container">
      <div className="lot-id-hero">
        <div className="lot-id-hero-text">
          <span className="lot-id-hero-eyebrow">Lot ID Tracker</span>
          <h1>Stay on top of every batch</h1>
          <p>Quickly grab current lots, next batch IDs, labels, and COAs for the full catalog.</p>
        </div>
        <div className="lot-id-hero-metrics">
          <div className="lot-id-metric-card">
            <div className="lot-id-metric-label">Total products</div>
            <div className="lot-id-metric-value">{products.length}</div>
          </div>
        </div>
      </div>
      <div className="lot-id-layout">
        <aside className="lot-id-sidebar">
          <div className="lot-id-sidebar-list">
            {sidebarGroups.entries.map((item) => (
              <button
                key={item.docId}
                className="lot-id-sidebar-item lot-id-sidebar-group-btn"
                onClick={() => {
                  const el = productRefs.current[item.docId];
                  if (el) {
                    el.scrollIntoView({ behavior: "smooth", block: "start" });
                    el.classList.add("lot-id-card-highlight");
                    setTimeout(() => el.classList.remove("lot-id-card-highlight"), 900);
                  }
                }}
              >
                <span className="lot-id-sidebar-name">{item.label}</span>
              </button>
            ))}
          </div>
        </aside>

        <div className="lot-id-grid">
          {products.map((p, idx) => {
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

              <div className="lot-id-template">
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
                  <label>Lot List</label>
                  <div className="lot-id-section-actions">
                    <button
                      className="lot-id-edit-toggle"
                      onClick={() =>
                        setLotEditMode((prev) => ({
                          ...prev,
                          [key]: !prev[key],
                        }))
                      }
                    >
                      {lotEditMode[key] ? "Done" : "Edit"}
                    </button>
                  </div>
                  <button
                    className="lot-id-generate-btn"
                    onClick={async () => {
                      const newLot = nextIdPreview;
                      const entry = productData[key] || data;
                      const updatedLots = [
                        { lot: newLot, url: buildCoaUrl(newLot), capColor: "" },
                        ...(entry.coaList || []),
                      ];
                      setProductData((prev) => ({
                        ...prev,
                        [key]: { ...(prev[key] || entry), coaList: updatedLots },
                      }));
                      await handleSaveCoaList(key, updatedLots);
                      copyToClipboard(newLot, key, "generatedLot");
                    }}
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
                          <div className="lot-id-list-top">
                            <span className="lot-id-pill">
                              <span className="lot-id-pill-label">Lot</span>
                            </span>
                            <span className={`lot-id-capchip${coa.capColor ? "" : " empty"}`}>
                              <span
                                className="lot-id-capchip-swatch"
                                style={{ backgroundColor: coa.capColor || "#e7dfd3" }}
                              />
                              <span className="lot-id-capchip-text">
                                {coa.capColor || "Cap color"}
                              </span>
                            </span>
                            {lotEditMode[key] && (
                              <input
                                type="text"
                                className="lot-id-capchip-input"
                                placeholder="Cap color"
                                value={coa.capColor || ""}
                                onChange={(e) => handleUpdateCoaCap(key, i, e.target.value)}
                              />
                            )}
                          </div>
                          {lotEditMode[key] ? (
                            <input
                              type="text"
                              className="lot-id-edit-lot-input"
                              value={coa.lot || ""}
                              onChange={(e) => handleUpdateLotValue(key, i, e.target.value)}
                              placeholder="Lot ID"
                            />
                          ) : (
                            <button
                              className="lot-id-copy lot-id-copy-block"
                              type="button"
                              onClick={() => copyToClipboard(coa.lot, key, `lot-${i}`)}
                              title="Copy lot ID"
                            >
                              {coa.lot || <i>none</i>}
                            </button>
                          )}
                          {copyFlash[`${key}-lot-${i}`] && (
                            <span className="lot-id-copied">Copied</span>
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
          );
        })}
        </div>
      </div>
    </div>
  );
};

export default LotIDTracker;
