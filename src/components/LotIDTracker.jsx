import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { collection, onSnapshot, updateDoc, doc } from "firebase/firestore";
import { db } from "../firebaseConfig";
import "./LotIDTracker.css";

const createEmptyCOA = () => ({ lot: "", url: "", capColor: "", capShade: "" });
const coaListSafe = (arr) => (Array.isArray(arr) ? arr : []);
const buildCoaUrl = (id) => (id ? `https://coffeeandpeppers.com/${id}` : "");
const LABEL_ASSET_BASE = `${window.location.origin}/assets`;
const LABEL_LOGO_SRC = `${LABEL_ASSET_BASE}/labelLogo.png`;
const LABEL_QR_SRC = `${LABEL_ASSET_BASE}/coaQR.png`;
const LABEL_BACKGROUND_IMAGE = `${LABEL_ASSET_BASE}/silverBackground.png`;
const APP_LOGO_SRC = `${window.location.origin}/assets/logo.png`;
const buildQrCodeUrl = (lot) =>
  `https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=0&data=${encodeURIComponent(
    buildCoaUrl(lot)
  )}`;
const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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
const getReadableTextColor = (value) => {
  const color = resolveCapColorValue(value);
  if (!color) return "#2b1a0f";
  const probe = document.createElement("span");
  probe.style.color = color;
  document.body.appendChild(probe);
  const computed = window.getComputedStyle(probe).color;
  document.body.removeChild(probe);
  const match = computed.match(/\d+/g);
  if (!match || match.length < 3) return "#2b1a0f";
  const [r, g, b] = match.slice(0, 3).map(Number);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? "#2b1a0f" : "#fffaf3";
};
const normalizeLabelAccentColor = (value) => {
  const resolved = resolveCapColorValue(value);
  if (!resolved) return "#efe3d3";
  const channels = getColorChannels(resolved);
  if (!channels) return resolved;
  const { r, g, b } = channels;
  const isNearWhite = r > 240 && g > 240 && b > 240;
  return isNearWhite ? "#8f3a17" : resolved;
};
const colorValueToHex = (value, fallback = "#c9c1b7") => {
  const channels = getColorChannels(value);
  if (!channels) return fallback;
  const toHex = (n) => n.toString(16).padStart(2, "0");
  return `#${toHex(channels.r)}${toHex(channels.g)}${toHex(channels.b)}`;
};
const getCapRenderColor = (capColor, capShade) => capShade || capColor || "";
const getColorChannels = (value) => {
  const color = resolveCapColorValue(value);
  if (!color) return null;
  const probe = document.createElement("span");
  probe.style.color = color;
  document.body.appendChild(probe);
  const computed = window.getComputedStyle(probe).color;
  document.body.removeChild(probe);
  const match = computed.match(/\d+/g);
  if (!match || match.length < 3) return null;
  const [r, g, b] = match.slice(0, 3).map(Number);
  return { r, g, b };
};
const LABEL_BASE_BACKGROUND = [
  "linear-gradient(180deg, rgba(255,255,255,0.86) 0%, rgba(237,239,243,0.92) 18%, rgba(250,251,253,0.98) 50%, rgba(232,235,239,0.94) 82%, rgba(255,255,255,0.9) 100%)",
  "repeating-linear-gradient(0deg, rgba(255,255,255,0.18) 0px, rgba(255,255,255,0.18) 3px, rgba(185,191,199,0.12) 7px, rgba(255,255,255,0.08) 12px, rgba(166,173,182,0.1) 16px, rgba(255,255,255,0.14) 22px)",
  "repeating-linear-gradient(0deg, rgba(120,128,138,0.05) 0px, rgba(255,255,255,0.04) 2px, rgba(143,150,160,0.05) 5px, rgba(255,255,255,0.02) 8px, rgba(125,133,143,0.04) 12px, rgba(255,255,255,0.03) 18px)",
  "linear-gradient(90deg, rgba(171,177,186,0.22) 0%, rgba(255,255,255,0.74) 24%, rgba(221,225,231,0.22) 48%, rgba(255,255,255,0.88) 72%, rgba(175,181,190,0.16) 100%)",
];
const LABEL_PREVIEW_WIDTH = 420;
const LABEL_PREVIEW_HEIGHT = 180;
const LABEL_PRINT_WIDTH = 1.75 * 96;
const LABEL_PRINT_HEIGHT = 0.75 * 96;
const FIXED_LABEL_LOGO = {
  leftPercent: 50,
  topPercent: 18,
  width: 200,
  height: 55,
};
const FIXED_MASS_PAD_Y = 5;
const FIXED_MASS_RADIUS = 10;
const FIXED_MASS_TEXT_COLOR = "#ffffff";
const DEFAULT_LABEL_DESIGN = {
  centerLeftPercent: 50,
  centerTopPercent: 55,
  centerWidth: 244,
  centerGap: 4,
  nameFontSize: 35,
  nameLineHeight: 0.9,
  strengthFontSize: 20,
  massTextColor: FIXED_MASS_TEXT_COLOR,
  strengthPadY: FIXED_MASS_PAD_Y,
  strengthPadX: 13,
  strengthRadius: FIXED_MASS_RADIUS,
  footerLeft: 35,
  footerBottom: 10,
  footerFontSize: 12,
  qrRight: 20,
  qrWidth: 82,
  qrMaxHeight: 132,
  lotRight: 2,
  lotFontSize: 13,
};
const mergeLabelDesign = (value) => ({ ...DEFAULT_LABEL_DESIGN, ...(value || {}) });
const buildLabelDesignStyles = (design) => ({
  logoWrap: {
    left: `${FIXED_LABEL_LOGO.leftPercent}%`,
    top: `${FIXED_LABEL_LOGO.topPercent}%`,
  },
  logo: {
    width: `${FIXED_LABEL_LOGO.width}px`,
    height: `${FIXED_LABEL_LOGO.height}px`,
  },
  center: {
    left: `${design.centerLeftPercent}%`,
    top: `${design.centerTopPercent}%`,
    width: `${design.centerWidth}px`,
    gap: `${design.centerGap}px`,
  },
  name: {
    fontSize: `${design.nameFontSize}px`,
    lineHeight: design.nameLineHeight,
  },
  strength: {
    fontSize: `${design.strengthFontSize}px`,
    padding: `${FIXED_MASS_PAD_Y}px ${design.strengthPadX}px`,
    borderRadius: `${FIXED_MASS_RADIUS}px`,
    color: FIXED_MASS_TEXT_COLOR,
  },
  footer: {
    left: `${design.footerLeft}px`,
    bottom: `${design.footerBottom}px`,
    fontSize: `${design.footerFontSize}px`,
  },
  qrWrap: {
    right: `${design.qrRight}px`,
  },
  qr: {
    width: `${design.qrWidth}px`,
    maxHeight: `${design.qrMaxHeight}px`,
  },
  lot: {
    right: `${design.lotRight}px`,
    fontSize: `${design.lotFontSize}px`,
  },
});
const scaleLabelDesignForPrint = (design) => {
  const merged = mergeLabelDesign(design);
  const scaleX = LABEL_PRINT_WIDTH / LABEL_PREVIEW_WIDTH;
  const scaleY = LABEL_PRINT_HEIGHT / LABEL_PREVIEW_HEIGHT;
  const scale = scaleX;
  return {
    ...merged,
    centerWidth: merged.centerWidth * scaleX,
    centerGap: merged.centerGap * scaleY,
    logoWidth: merged.logoWidth * scaleX,
    logoHeight: merged.logoHeight * scaleY,
    nameFontSize: merged.nameFontSize * scale,
    strengthFontSize: merged.strengthFontSize * scale,
    strengthPadY: FIXED_MASS_PAD_Y * scaleY,
    strengthPadX: merged.strengthPadX * scaleX,
    strengthRadius: FIXED_MASS_RADIUS * scale,
    footerLeft: merged.footerLeft * scaleX,
    footerBottom: merged.footerBottom * scaleY,
    footerFontSize: merged.footerFontSize * scale,
    qrRight: merged.qrRight * scaleX,
    qrWidth: merged.qrWidth * scaleX,
    qrMaxHeight: merged.qrMaxHeight * scaleY,
    lotRight: merged.lotRight * scaleX,
    lotFontSize: merged.lotFontSize * scale,
  };
};
const buildFixedLogoPrintStyles = () => {
  const scaleX = LABEL_PRINT_WIDTH / LABEL_PREVIEW_WIDTH;
  const scaleY = LABEL_PRINT_HEIGHT / LABEL_PREVIEW_HEIGHT;
  return {
    wrap: {
      leftPercent: FIXED_LABEL_LOGO.leftPercent,
      topPercent: FIXED_LABEL_LOGO.topPercent,
    },
    size: {
      width: FIXED_LABEL_LOGO.width * scaleX,
      height: FIXED_LABEL_LOGO.height * scaleY,
    },
  };
};
const buildLabelBackground = (value) => {
  const channels = getColorChannels(normalizeLabelAccentColor(value));
  if (!channels) return "transparent";
  return `linear-gradient(90deg, rgba(${channels.r}, ${channels.g}, ${channels.b}, 0.88) 0%, rgba(${channels.r}, ${channels.g}, ${channels.b}, 0.64) 9%, rgba(${channels.r}, ${channels.g}, ${channels.b}, 0.4) 18%, rgba(${channels.r}, ${channels.g}, ${channels.b}, 0.22) 30%, rgba(${channels.r}, ${channels.g}, ${channels.b}, 0.1) 42%, rgba(${channels.r}, ${channels.g}, ${channels.b}, 0.03) 56%, rgba(${channels.r}, ${channels.g}, ${channels.b}, 0) 68%)`;
};
const buildLabelPrintMarkup = ({ productId, productName, strength, lot, capColor, design }) => {
  const capColorValue = normalizeLabelAccentColor(capColor);
  const capTextColor = getReadableTextColor(capColorValue);
  const qrCodeUrl = buildQrCodeUrl(lot);
  const labelBackground = buildLabelBackground(capColorValue);
  const labelDesign = scaleLabelDesignForPrint(design);
  const printLogo = buildFixedLogoPrintStyles();
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(lot)} label</title>
    <style>
      @page { size: 1.75in 0.75in; margin: 0; }
      html, body {
        margin: 0;
        padding: 0;
        width: 1.75in;
        height: 0.75in;
        background: #ffffff;
        font-family: Arial, Helvetica, sans-serif;
      }
      body {
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
      .label {
        width: 1.75in;
        height: 0.75in;
        box-sizing: border-box;
        position: relative;
        overflow: hidden;
        background: linear-gradient(180deg, #f3f4f6 0%, #e9ebef 100%);
      }
      .bg-image {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        object-fit: cover;
        object-position: center;
        pointer-events: none;
      }
      .bg-tint {
        position: absolute;
        inset: 0;
        background: ${escapeHtml(labelBackground)};
        pointer-events: none;
      }
      .content {
        position: absolute;
        inset: 0;
      }
      .center-stack {
        position: absolute;
        left: ${labelDesign.centerLeftPercent}%;
        top: ${labelDesign.centerTopPercent}%;
        transform: translate(-50%, -50%);
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: ${labelDesign.centerGap}px;
        width: ${labelDesign.centerWidth}px;
        text-align: center;
      }
      .logo-wrap {
        position: absolute;
        left: ${printLogo.wrap.leftPercent}%;
        top: ${printLogo.wrap.topPercent}%;
        transform: translate(-50%, -50%);
        display: flex;
        justify-content: center;
      }
      .logo {
        width: ${printLogo.size.width}px;
        height: ${printLogo.size.height}px;
        object-fit: contain;
      }
      .name {
        text-align: center;
        font-size: ${labelDesign.nameFontSize}px;
        line-height: ${labelDesign.nameLineHeight};
        font-weight: 900;
        color: #23160d;
        text-transform: uppercase;
        white-space: normal;
        overflow: hidden;
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
        line-clamp: 2;
        text-wrap: balance;
      }
      .strength {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        justify-self: center;
        background: ${escapeHtml(capColorValue)};
        color: ${escapeHtml(FIXED_MASS_TEXT_COLOR)};
        border-radius: ${labelDesign.strengthRadius}px;
        padding: ${labelDesign.strengthPadY}px ${labelDesign.strengthPadX}px;
        font-size: ${labelDesign.strengthFontSize}px;
        line-height: 1;
        font-weight: 900;
      }
      .footer {
        position: absolute;
        left: ${labelDesign.footerLeft}px;
        bottom: ${labelDesign.footerBottom}px;
        font-size: ${labelDesign.footerFontSize}px;
        line-height: 1.2;
        color: #23160d;
      }
      .footer strong {
        display: block;
        font-weight: 500;
      }
      .qr-wrap {
        position: absolute;
        right: ${labelDesign.qrRight}px;
        top: 50%;
        transform: translateY(-50%);
        display: flex;
        align-items: center;
        justify-content: center;
        width: fit-content;
      }
      .qr {
        width: ${labelDesign.qrWidth}px;
        height: auto;
        max-height: ${labelDesign.qrMaxHeight}px;
        object-fit: contain;
        image-rendering: pixelated;
        image-rendering: crisp-edges;
        -ms-interpolation-mode: nearest-neighbor;
      }
      .lot {
        position: absolute;
        right: ${labelDesign.lotRight}px;
        top: 50%;
        transform: translateY(-50%) rotate(180deg);
        writing-mode: vertical-rl;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: ${labelDesign.lotFontSize}px;
        line-height: 1;
        font-weight: 800;
        color: #2b1a0f;
        letter-spacing: 0.03em;
        padding: 0;
      }
    </style>
  </head>
  <body>
    <div class="label">
      <img class="bg-image" src="${escapeHtml(LABEL_BACKGROUND_IMAGE)}" alt="" />
      <div class="bg-tint"></div>
      <div class="content">
        <div class="center-stack">
          <div class="name">${escapeHtml(productName || "")}</div>
          <div class="strength">${escapeHtml(strength || "")}</div>
        </div>
        <div class="logo-wrap">
          <img class="logo" src="${escapeHtml(LABEL_LOGO_SRC)}" alt="Coffee and Peppers" onerror="this.onerror=null;this.src='${escapeHtml(
    APP_LOGO_SRC
  )}';" />
        </div>
        <div class="footer">
          <strong>99% PURITY</strong>
          <strong>FOR RESEARCH USE ONLY</strong>
          </div>
        </div>
        <div class="qr-wrap">
          <img class="qr" src="${escapeHtml(LABEL_QR_SRC)}" onerror="this.onerror=null;this.src='${escapeHtml(
    qrCodeUrl
  )}';" alt="QR code for ${escapeHtml(
    productId || lot || "label"
  )}" />
        </div>
        <div class="lot">${escapeHtml(lot || "")}</div>
      </div>
    <script>
      window.onload = function () {
        var assets = [
          "${escapeHtml(LABEL_BACKGROUND_IMAGE)}",
          "${escapeHtml(LABEL_LOGO_SRC)}",
          "${escapeHtml(LABEL_QR_SRC)}"
        ];
        var settled = false;
        var remaining = assets.length;

        function finish() {
          if (settled) return;
          settled = true;
          window.focus();
          setTimeout(function () {
            window.print();
          }, 120);
        }

        function markDone() {
          remaining -= 1;
          if (remaining <= 0) finish();
        }

        assets.forEach(function (src) {
          var img = new Image();
          img.onload = markDone;
          img.onerror = markDone;
          img.src = src;
        });

        setTimeout(finish, 900);
      };
      window.onafterprint = function () {
        window.close();
      };
    </script>
  </body>
</html>`;
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
  const [labelEditorOpen, setLabelEditorOpen] = useState(false);
  const [labelDesignDraft, setLabelDesignDraft] = useState(DEFAULT_LABEL_DESIGN);
  const [previewLotSelection, setPreviewLotSelection] = useState({});
  const [editLotModal, setEditLotModal] = useState({ productKey: null, index: null, lot: "", capColor: "", capShade: "", kits: "", vendor: "", note: "" });
  const [selectedProductId, setSelectedProductId] = useState(null);
  const [lotModalConfig, setLotModalConfig] = useState({
    productKey: null,
    lot: "",
    capColor: "",
    capShade: "",
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
            capShade: currentCoa.capShade || "",
          };
            items.push({
              docId: doc.id,
              id: data.id || doc.id,
              product: data.product,
              strength: data.strength,
              currentCoa: normalizedCurrent,
              coaList: data.coaList || [],
              capColor: currentCoa.capColor || data.capColor || "",
              labelDesign: mergeLabelDesign(data.labelDesign),
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
                capShade: p.currentCoa?.capShade || "",
              },
              coaList: Array.isArray(p.coaList)
                ? p.coaList.map((c) => ({
                    ...c,
                    url: buildCoaUrl(c.lot || c.url || p.id || ""),
                    kits: Number(c.kits) || 0,
                    capShade: c.capShade || "",
                  }))
                : [],
              capColor: p.currentCoa?.capColor || p.capColor || "",
              labelDesign: mergeLabelDesign(p.labelDesign),
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
      capShade: coa.capShade || "",
      kits: coa.kits ?? "",
      vendor: coa.vendor || "",
      note: coa.note || "",
    });
  };

  const closeEditLotModal = () =>
    setEditLotModal({ productKey: null, index: null, lot: "", capColor: "", capShade: "", kits: "", vendor: "", note: "" });

  const saveEditLotModal = () => {
    const { productKey, index, lot, capColor, capShade, kits, vendor, note } = editLotModal;
    if (productKey === null || index === null) return;
    setProductData((prev) => {
      const currentList = [...(prev[productKey]?.coaList || [])];
      if (!currentList[index]) return prev;
      currentList[index] = {
        ...currentList[index],
        lot,
        url: buildCoaUrl(lot),
        capColor,
        capShade,
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
      capShade: colorValueToHex(capSeed),
      kits: "",
      vendor: vendorSeed,
      note: "",
    });
  };

  const closeLotModal = () =>
    setLotModalConfig({ productKey: null, lot: "", capColor: "", capShade: "", kits: "", vendor: "", note: "" });

  const confirmLotModal = async () => {
    const { productKey, lot, capColor, capShade, kits, vendor, note } = lotModalConfig;
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
        capShade: capShade || "",
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

  const handlePrintLotLabel = (product, lotEntry) => {
    if (!lotEntry?.lot) return;
    const printWindow = window.open("", "_blank", "width=420,height=240");
    if (!printWindow) return;
    const markup = buildLabelPrintMarkup({
      productId: productData[product.docId]?.productID || product.id || "",
      productName: product.product || "",
      strength: product.strength || "",
      lot: lotEntry.lot,
      capColor: getCapRenderColor(lotEntry.capColor, lotEntry.capShade),
      design: productData[product.docId]?.labelDesign || DEFAULT_LABEL_DESIGN,
    });
    printWindow.document.open();
    printWindow.document.write(markup);
    printWindow.document.close();
  };

  const updateLabelDesign = (field, value) => {
    setLabelDesignDraft((prev) => ({
      ...prev,
      [field]: typeof value === "number" ? value : Number(value),
    }));
  };

  const openLabelEditor = (productKey) => {
    setLabelDesignDraft(mergeLabelDesign(productData[productKey]?.labelDesign));
    setLabelEditorOpen(true);
  };

  const saveLabelDesign = async () => {
    if (!selectedProductId) return;
    const nextDesign = mergeLabelDesign(labelDesignDraft);
    setProductData((prev) => ({
      ...prev,
      [selectedProductId]: {
        ...prev[selectedProductId],
        labelDesign: nextDesign,
      },
    }));
    await saveSection(selectedProductId, { labelDesign: nextDesign });
    setLabelEditorOpen(false);
  };

  const renderLabelPreview = (product, lotEntry, designStyles) => (
    <div
      className="lot-id-print-label"
      style={{
        background: "linear-gradient(180deg, #f3f4f6 0%, #e9ebef 100%)",
      }}
    >
      <img
        src="/assets/silverBackground.png"
        alt=""
        className="lot-id-print-label-bg"
      />
      <div
        className="lot-id-print-label-tint"
        style={{ background: buildLabelBackground(getCapRenderColor(lotEntry.capColor, lotEntry.capShade)) }}
      />
      <div className="lot-id-print-label-body">
        <div className="lot-id-print-label-logo-wrap" style={designStyles.logoWrap}>
          <img
            src="/assets/labelLogo.png"
            alt="Coffee and Peppers"
            className="lot-id-print-label-logo"
            style={designStyles.logo}
            onError={(e) => {
              e.currentTarget.onerror = null;
              e.currentTarget.src = "/assets/logo.png";
            }}
          />
        </div>
        <div className="lot-id-print-label-center" style={designStyles.center}>
          <div className="lot-id-print-label-name" style={designStyles.name}>
            {product.product}
          </div>
          <div
            className="lot-id-print-label-strength"
            style={{
              ...designStyles.strength,
              backgroundColor: normalizeLabelAccentColor(getCapRenderColor(lotEntry.capColor, lotEntry.capShade)),
            }}
          >
            {product.strength}
          </div>
        </div>
        <div className="lot-id-print-label-footer" style={designStyles.footer}>
          <span>99% PURITY</span>
          <span>FOR RESEARCH USE ONLY</span>
        </div>
      </div>
      <div className="lot-id-print-label-qr-wrap" style={designStyles.qrWrap}>
        <img
          src="/assets/coaQR.png"
          alt={`QR for ${lotEntry.lot}`}
          className="lot-id-print-label-qr"
          style={designStyles.qr}
          onError={(e) => {
            e.currentTarget.onerror = null;
            e.currentTarget.src = buildQrCodeUrl(lotEntry.lot);
          }}
        />
      </div>
      <div className="lot-id-print-label-lot" style={designStyles.lot}>
        {lotEntry.lot}
      </div>
    </div>
  );

  const selectedProduct = products.find((p) => p.docId === selectedProductId) || null;
  const selectedProductState = selectedProduct ? (productData[selectedProduct.docId] || {
    productID: "",
    currentCOA: createEmptyCOA(),
    coaList: [],
    labelDesign: DEFAULT_LABEL_DESIGN,
  }) : null;
  const selectedPreviewLot =
    selectedProductState?.coaList?.find(
      (lot) => lot.lot === previewLotSelection[selectedProductId]
    ) || selectedProductState?.coaList?.[0] || null;
  const editorDesignStyles = buildLabelDesignStyles(labelDesignDraft);

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
          const activePreviewLot =
            data.coaList?.find((lot) => lot.lot === previewLotSelection[key]) ||
            data.coaList?.[0] ||
            null;
          const designStyles = buildLabelDesignStyles(
            labelEditorOpen && selectedProductId === key
              ? labelDesignDraft
              : mergeLabelDesign(data.labelDesign)
          );

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
                  <div className="lot-id-label-preview-card">
                    <div className="lot-id-label-preview-topbar">
                      <div>
                        <div className="lot-id-label-preview-heading">Print Label</div>
                        <div className="lot-id-label-preview-sub">
                          Uses the lot cap color and prints at 1.75&quot; x 0.75&quot;.
                        </div>
                      </div>
                      <div className="lot-id-label-preview-actions">
                        <button
                          type="button"
                          className="lot-id-layout-btn"
                          onClick={() => openLabelEditor(key)}
                        >
                          Edit Layout
                        </button>
                      </div>
                    </div>
                    {activePreviewLot?.lot ? (
                      <div className="lot-id-label-preview-shell">
                        {renderLabelPreview(p, activePreviewLot, designStyles)}
                      </div>
                    ) : (
                      <div className="lot-id-label-preview-empty">
                        Generate a lot first to preview its printable label.
                      </div>
                    )}
                    {activePreviewLot?.lot && (
                      <div className="lot-id-label-preview-capnote">
                        Cap color band: {activePreviewLot.capColor || "No cap color"}
                      </div>
                    )}
                  </div>
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
                        <li
                          key={i}
                          className={`lot-id-list-item${activePreviewLot?.lot === coa.lot ? " preview-active" : ""}`}
                          onClick={() =>
                            setPreviewLotSelection((prev) => ({
                              ...prev,
                              [key]: coa.lot,
                            }))
                          }
                        >
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
                                style={{ backgroundColor: getCapRenderColor(coa.capColor, coa.capShade) || "#e7dfd3" }}
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
                            <button
                              type="button"
                              className="lot-id-print-btn"
                              onClick={() => handlePrintLotLabel(p, coa)}
                            >
                              Print Label
                            </button>
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
              <div className="lot-modal-color-row">
                <input
                  type="color"
                  value={colorValueToHex(lotModalConfig.capShade || lotModalConfig.capColor)}
                  onChange={(e) =>
                    setLotModalConfig((prev) => ({ ...prev, capShade: e.target.value }))
                  }
                  className="lot-modal-color-picker"
                  aria-label="Pick cap color"
                />
                <input
                  type="text"
                  placeholder="e.g. Sand, #F5E9D8"
                  value={lotModalConfig.capColor}
                  onChange={(e) =>
                    setLotModalConfig((prev) => ({ ...prev, capColor: e.target.value }))
                  }
                  className="lot-modal-input"
                />
              </div>

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
              <div className="lot-modal-color-row">
                <input
                  type="color"
                  value={colorValueToHex(editLotModal.capShade || editLotModal.capColor)}
                  onChange={(e) => setEditLotModal((prev) => ({ ...prev, capShade: e.target.value }))}
                  className="lot-modal-color-picker"
                  aria-label="Pick cap color"
                />
                <input
                  type="text"
                  placeholder="e.g. Sand, #F5E9D8"
                  value={editLotModal.capColor}
                  onChange={(e) => setEditLotModal((prev) => ({ ...prev, capColor: e.target.value }))}
                  className="lot-modal-input"
                />
              </div>

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

      {labelEditorOpen &&
        createPortal(
          <div className="lot-modal-backdrop" onClick={() => setLabelEditorOpen(false)}>
            <div className="lot-modal lot-layout-editor" onClick={(e) => e.stopPropagation()}>
              <div className="lot-layout-editor-header">
                <div>
                  <h3>Edit Label Layout</h3>
                  <p className="lot-modal-sub">Adjust positions and sizes for the printed label.</p>
                </div>
                <button
                  type="button"
                  className="lot-modal-btn secondary"
                  onClick={() => setLabelDesignDraft(DEFAULT_LABEL_DESIGN)}
                >
                  Reset
                </button>
              </div>

              <div className="lot-layout-grid">
                {selectedProduct && selectedPreviewLot && (
                  <div className="lot-layout-preview-panel">
                    <div className="lot-layout-preview-title">Live Preview</div>
                    <div className="lot-id-label-preview-shell lot-id-label-preview-shell-editor">
                      {renderLabelPreview(selectedProduct, selectedPreviewLot, editorDesignStyles)}
                    </div>
                  </div>
                )}
                <label className="lot-layout-field">
                  <span>Center Left %</span>
                  <input type="number" value={labelDesignDraft.centerLeftPercent} onChange={(e) => updateLabelDesign("centerLeftPercent", e.target.value)} className="lot-modal-input" />
                </label>
                <label className="lot-layout-field">
                  <span>Center Top %</span>
                  <input type="number" value={labelDesignDraft.centerTopPercent} onChange={(e) => updateLabelDesign("centerTopPercent", e.target.value)} className="lot-modal-input" />
                </label>
                <label className="lot-layout-field">
                  <span>Center Width</span>
                  <input type="number" value={labelDesignDraft.centerWidth} onChange={(e) => updateLabelDesign("centerWidth", e.target.value)} className="lot-modal-input" />
                </label>
                <label className="lot-layout-field">
                  <span>Center Gap</span>
                  <input type="number" value={labelDesignDraft.centerGap} onChange={(e) => updateLabelDesign("centerGap", e.target.value)} className="lot-modal-input" />
                </label>

                <label className="lot-layout-field">
                  <span>Product Font</span>
                  <input type="number" value={labelDesignDraft.nameFontSize} onChange={(e) => updateLabelDesign("nameFontSize", e.target.value)} className="lot-modal-input" />
                </label>
                <label className="lot-layout-field">
                  <span>Product Line Height</span>
                  <input type="number" step="0.01" value={labelDesignDraft.nameLineHeight} onChange={(e) => updateLabelDesign("nameLineHeight", e.target.value)} className="lot-modal-input" />
                </label>

                <label className="lot-layout-field">
                  <span>Mass Font</span>
                  <input type="number" value={labelDesignDraft.strengthFontSize} onChange={(e) => updateLabelDesign("strengthFontSize", e.target.value)} className="lot-modal-input" />
                </label>
                <label className="lot-layout-field">
                  <span>Mass Text Color</span>
                  <div className="lot-modal-color-row">
                    <input
                      type="color"
                      value={colorValueToHex(labelDesignDraft.massTextColor, "#2b1a0f")}
                      onChange={(e) => setLabelDesignDraft((prev) => ({ ...prev, massTextColor: e.target.value }))}
                      className="lot-modal-color-picker"
                    />
                    <input
                      type="text"
                      value={labelDesignDraft.massTextColor}
                      onChange={(e) => setLabelDesignDraft((prev) => ({ ...prev, massTextColor: e.target.value }))}
                      className="lot-modal-input"
                    />
                  </div>
                </label>
                <label className="lot-layout-field">
                  <span>Mass Pad X</span>
                  <input type="number" value={labelDesignDraft.strengthPadX} onChange={(e) => updateLabelDesign("strengthPadX", e.target.value)} className="lot-modal-input" />
                </label>

                <label className="lot-layout-field">
                  <span>Footer Left</span>
                  <input type="number" value={labelDesignDraft.footerLeft} onChange={(e) => updateLabelDesign("footerLeft", e.target.value)} className="lot-modal-input" />
                </label>
                <label className="lot-layout-field">
                  <span>Footer Bottom</span>
                  <input type="number" value={labelDesignDraft.footerBottom} onChange={(e) => updateLabelDesign("footerBottom", e.target.value)} className="lot-modal-input" />
                </label>
                <label className="lot-layout-field">
                  <span>Footer Font</span>
                  <input type="number" value={labelDesignDraft.footerFontSize} onChange={(e) => updateLabelDesign("footerFontSize", e.target.value)} className="lot-modal-input" />
                </label>

                <label className="lot-layout-field">
                  <span>QR Right</span>
                  <input type="number" value={labelDesignDraft.qrRight} onChange={(e) => updateLabelDesign("qrRight", e.target.value)} className="lot-modal-input" />
                </label>
                <label className="lot-layout-field">
                  <span>QR Width</span>
                  <input type="number" value={labelDesignDraft.qrWidth} onChange={(e) => updateLabelDesign("qrWidth", e.target.value)} className="lot-modal-input" />
                </label>
                <label className="lot-layout-field">
                  <span>QR Max Height</span>
                  <input type="number" value={labelDesignDraft.qrMaxHeight} onChange={(e) => updateLabelDesign("qrMaxHeight", e.target.value)} className="lot-modal-input" />
                </label>

                <label className="lot-layout-field">
                  <span>Lot Right</span>
                  <input type="number" value={labelDesignDraft.lotRight} onChange={(e) => updateLabelDesign("lotRight", e.target.value)} className="lot-modal-input" />
                </label>
                <label className="lot-layout-field">
                  <span>Lot Font</span>
                  <input type="number" value={labelDesignDraft.lotFontSize} onChange={(e) => updateLabelDesign("lotFontSize", e.target.value)} className="lot-modal-input" />
                </label>
              </div>

              <div className="lot-modal-actions">
                <button type="button" className="lot-modal-btn secondary" onClick={() => setLabelEditorOpen(false)}>
                  Cancel
                </button>
                <button type="button" className="lot-modal-btn primary" onClick={saveLabelDesign}>
                  Save Layout
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
