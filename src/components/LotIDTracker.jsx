import React, { useEffect, useMemo, useRef, useState } from "react";
import { collection, onSnapshot, updateDoc, doc } from "firebase/firestore";
import { db } from "../firebaseConfig";
import "./LotIDTracker.css";

const createEmptyCOA = () => ({ lot: "", url: "", capColor: "" });
const pastCoAsSafe = (arr) => (Array.isArray(arr) ? arr : []);
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
            pastCoas: data.pastCoas || [],
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
            pastCOAs: Array.isArray(p.pastCoas)
              ? p.pastCoas.map((c) => ({
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
      capColor: currentCOA.capColor || "",
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
              pastCOAs: [],
            };
          const capColorText =
            (productData[key]?.capColor ||
              data.currentCOA.capColor ||
              "").trim();
          const capColorSwatch = resolveCapColorValue(capColorText);
          const usedCount =
            (data.pastCOAs?.length || 0) + (data.currentCOA?.lot ? 1 : 0);
          const nextSeq = String(usedCount + 1).padStart(2, "0");
          const nextIdPreview = `CP${data.productID || p.id || "ID"}${todayChunk}${nextSeq}`;
          const isEditingCurrent =
            editingSections[key]?.current || false;
          const isEditingPast =
            editingSections[key]?.past || false;

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
                {embedLink && (
                  <div className="lot-id-template-frame">
                    <iframe
                      loading="lazy"
                      src={embedLink}
                      allowFullScreen
                      allow="fullscreen"
                      title={`${p.product} labels template`}
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
                  <label>Current Lot ID</label>
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
                      <div className="cap-color-row">
                        <span className="cap-color-label">Cap Color</span>
                        <span
                          className="cap-color-marker"
                          style={{
                            backgroundColor: capColorSwatch || "#e7dfd3",
                          }}
                        ></span>
                        <input
                          type="text"
                          className="cap-color-input"
                          value={productData[key]?.capColor || ""}
                          onChange={(e) => handleCapColorChange(key, e.target.value)}
                          onBlur={(e) => handleSaveCapColor(key, e.target.value)}
                          placeholder="e.g., White"
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
                      <div className="cap-color-row view">
                        <span className="cap-color-label">Cap Color</span>
                        <span
                          className="cap-color-marker"
                          style={{
                            backgroundColor: capColorSwatch || "#e7dfd3",
                          }}
                        ></span>
                        <span className={`cap-color-pill${(productData[key]?.capColor || data.currentCOA.capColor) ? '' : ' empty'}`}>
                          {productData[key]?.capColor || data.currentCOA.capColor || 'Not set'}
                        </span>
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
    </div>
  );
};

export default LotIDTracker;
