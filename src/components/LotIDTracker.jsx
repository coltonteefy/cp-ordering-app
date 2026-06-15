import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { collection, onSnapshot, updateDoc, doc, getDocs } from "firebase/firestore";
import { db } from "../firebaseConfig";
import "./LotIDTracker.css";

const createEmptyCOA = () => ({ lot: "", url: "", capColor: "", capShade: "" });
const coaListSafe = (arr) => (Array.isArray(arr) ? arr : []);
const buildCoaUrl = (id) => (id ? `https://coffeeandpeppers.com/${id}` : "");
const LABEL_ASSET_BASE = `${window.location.origin}/assets`;
const LABEL_BACKGROUND_IMAGE = `${LABEL_ASSET_BASE}/labelbackground.png`;
const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
const splitLabelProductName = (value) => {
  const text = String(value ?? "");
  const ampMatch = text.match(/^(.*?&)\s*(.+)$/);
  if (ampMatch) return [ampMatch[1], ampMatch[2]];
  const spaceMatch = text.match(/^(\S+)\s+(.+)$/);
  if (spaceMatch) return [spaceMatch[1], spaceMatch[2]];
  return [text];
};
const renderLabelProductName = (value) => {
  const lines = splitLabelProductName(value);
  return lines.map((line, index) => (
    <React.Fragment key={`${line}-${index}`}>
      {index > 0 && <br />}
      {line}
    </React.Fragment>
  ));
};
const buildLabelProductHtml = (value) =>
  splitLabelProductName(value)
    .map((line) => escapeHtml(line))
    .join("<br />");
const TEST_LABEL_VARIANTS = ["TEST 1", "TEST 2", "TEST 3", "TEST 4", "TEST 5"];
const TESTING_TABLE_ROW_COUNT = 12;
const PRINT_TESTING_TABLE_ROW_COUNT = 13;
const nextCapShadeFromText = (value, fallback = "") => {
  const resolved = resolveCapColorValue(value);
  return resolved ? colorValueToHex(resolved, fallback || "#c9c1b7") : fallback;
};
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
  if (!resolved) return "#8f3a17";
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
const getCapRenderColor = (capColor, capShade) => capColor ? (capShade || capColor) : "";
const getCapBorderColor = (capColor, capShade) => {
  const value = getCapRenderColor(capColor, capShade);
  if (!value) return undefined;
  const channels = getColorChannels(value);
  if (!channels) return value;
  const { r, g, b } = channels;
  if (r > 220 && g > 220 && b > 220) return "#a0a0a0";
  return value;
};
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
const LABEL_PRINT_WIDTH = 0.75 * 96;
const LABEL_PRINT_HEIGHT = 1.75 * 96;
const LABEL_PREVIEW_WIDTH = 180;
const LABEL_PREVIEW_HEIGHT = 420;
const FIXED_MASS_PAD_Y = 5;
const FIXED_MASS_RADIUS = 10;
const FIXED_MASS_TEXT_COLOR = "#ffffff";
const DEFAULT_LABEL_DESIGN = {
  // Logo — rotated -90° with transform-origin: left center
  logoLeft: 38,
  logoTopPercent: 62,
  logoWidth: 170,
  logoHeight: 64,
  // Center stack (product + strength) — rotated -90°, right side
  // Legacy fields kept for Full Editor compatibility
  centerLeftPercent: 60,
  centerTopPercent: 50,
  centerWidth: 235,
  centerGap: 2,
  stackRotate: -90,
  // Name element — independently positioned
  nameLeft: 88,
  nameTop: 210,
  nameFontSize: 37,
  nameLineHeight: 0.79,
  nameColor: "#23160d",
  nameFontWeight: 900,
  nameLetterSpacing: 0,
  nameUppercase: true,
  // Strength element — independently positioned
  strengthLeft: 124,
  strengthTop: 210,
  strengthFontSize: 22,
  massTextColor: "#ffffff",
  strengthPadY: 8,
  strengthPadX: 12,
  strengthRadius: FIXED_MASS_RADIUS,
  strengthFontWeight: 900,
  strengthLetterSpacing: 0,
  // Footer — rotated -90°, bottom-right area
  footerLeft: 156,
  footerTop: 310,
  footerFontSize: 13,
  // QR
  qrLeft: 50,
  qrTop: 22,
  qrWidth: 82,
  qrMaxHeight: 132,
  // Variant text (test labels only)
  variantFontSize: 22,
  variantMarginTop: 2,
  // Lot ID — top center
  lotLeft: 90,
  lotTop: 10,
  lotFontSize: 12,
  lotColor: "#2b1a0f",
  lotFontWeight: 800,
  lotLetterSpacing: 0.03,
  lotRotate: 0,
  lotOffsetX: 0,
  lotOffsetY: 0,
  lotUppercase: true,
  backgroundOpacity: 100, // 0–100, scales gradient alpha
  showGradient: true,
  strengthBgColor: "", // "" = use cap color; "none" = transparent
  customTexts: [],
  nameTextAlign: "center",
  lotTextAlign: "center",
  tintColorOverride: "", // empty = use cap color
};
const KIT_PREVIEW_WIDTH = 240;
const KIT_PREVIEW_HEIGHT = 360;
const KIT_PRINT_WIDTH = 1.5 * 96;
const KIT_PRINT_HEIGHT = 2.25 * 96;
const DEFAULT_KIT_LABEL_DESIGN = {
  lotLeft: 15,
  lotTop: 10,
  lotFontSize: 15,
  lotColor: "#23160d",
  lotFontWeight: 900,
  lotLetterSpacing: 0,
  lotRotate: 0,
  lotUppercase: true,
  qrLeft: 15,
  qrTop: 30,
  qrSize: 95,
  logoLeft: 76,
  logoBottom: 18,
  logoWidth: 195,
  logoHeight: 75,
  productLeft: 125,
  productBottom: 18,
  productFontSize: 46,
  productLineHeight: 0.86,
  productColor: "#111111",
  productFontWeight: 900,
  productLetterSpacing: 0,
  productUppercase: true,
  strengthLeft: 193,
  strengthBottom: 20,
  strengthFontSize: 35,
  strengthPadX: 18,
  strengthPadY: 14,
  strengthRadius: 8,
  strengthFontWeight: 900,
  strengthLetterSpacing: 0,
  footerRight: 18,
  footerBottom: 250,
  footerFontSize: 15,
  footerGap: 20,
  bottomFadeHeight: 250,
  massTextColor: "#ffffff",
  strengthBgColor: "",
  customTexts: [],
  lotTextAlign: "center",
  productTextAlign: "left",
  tintColorOverride: "",
};
const DEFAULT_TEST_LABEL_DESIGN = {
  ...DEFAULT_LABEL_DESIGN,
  logoLeft: 35,
  logoTopPercent: 62,
  logoWidth: 170,
  logoHeight: 65,
  centerLeftPercent: 70,
  centerTopPercent: 50,
  centerWidth: 255,
  centerGap: 2,
  nameFontSize: 30,
  nameLineHeight: 0.85,
  strengthFontSize: 25,
  massTextColor: "#ffffff",
  strengthPadX: 13,
  variantFontSize: 30,
  variantMarginTop: 0,
  variantOffsetX: 0,
  variantOffsetY: 0,
  lotLeft: 85,
  lotTop: 10,
  lotFontSize: 15,
};
const mergeLabelDesign = (value) => ({ ...DEFAULT_LABEL_DESIGN, ...(value || {}) });
const mergeKitLabelDesign = (value) => ({
  ...DEFAULT_KIT_LABEL_DESIGN,
  ...(value || {}),
});
const mergeTestLabelDesign = (value) => ({ ...DEFAULT_TEST_LABEL_DESIGN, ...(value || {}) });
const buildLabelDesignStyles = (design) => ({
  logoWrap: {
    left: `${design.logoLeft}px`,
    top: `${design.logoTopPercent}%`,
    transformOrigin: 'left center',
    transform: 'rotate(-90deg)',
  },
  logo: {
    width: `${design.logoWidth}px`,
    height: `${design.logoHeight}px`,
  },
  center: {
    left: `${design.centerLeftPercent}%`,
    top: `${design.centerTopPercent}%`,
    width: `${design.centerWidth}px`,
    gap: `${design.centerGap}px`,
    transform: `translate(-50%, -50%) rotate(${design.stackRotate ?? -90}deg)`,
  },
  name: {
    fontSize: `${design.nameFontSize}px`,
    lineHeight: design.nameLineHeight,
    color: design.nameColor || '#23160d',
    fontWeight: design.nameFontWeight ?? 900,
    letterSpacing: `${design.nameLetterSpacing ?? 0}em`,
    textTransform: design.nameUppercase === false ? 'none' : 'uppercase',
    textAlign: design.nameTextAlign || 'center',
    transform: `translate(${design.nameOffsetX ?? 0}px, ${design.nameOffsetY ?? 0}px)`,
  },
  strength: {
    fontSize: `${design.strengthFontSize}px`,
    padding: `${design.strengthPadY ?? FIXED_MASS_PAD_Y}px ${design.strengthPadX}px`,
    borderRadius: `${design.strengthRadius}px`,
    color: design.massTextColor || FIXED_MASS_TEXT_COLOR,
    fontWeight: design.strengthFontWeight ?? 900,
    letterSpacing: `${design.strengthLetterSpacing ?? 0}em`,
    transform: `translate(${design.strengthOffsetX ?? 0}px, ${design.strengthOffsetY ?? 0}px)`,
  },
  footer: {
    left: `${design.footerLeft}px`,
    top: `${design.footerTop}px`,
    fontSize: `${design.footerFontSize}px`,
    transform: 'translate(-50%, -50%) rotate(-90deg)',
  },
  qrWrap: {
    left: `${design.qrLeft}px`,
    top: `${design.qrTop}px`,
  },
  qr: {
    width: `${design.qrWidth}px`,
    height: `${design.qrWidth}px`,
  },
  lot: {
    left: `${design.lotLeft}px`,
    top: `${design.lotTop}px`,
    fontSize: `${design.lotFontSize}px`,
    color: design.lotColor || '#2b1a0f',
    fontWeight: design.lotFontWeight ?? 800,
    letterSpacing: `${design.lotLetterSpacing ?? 0.03}em`,
    textTransform: design.lotUppercase === false ? 'none' : 'uppercase',
    textAlign: design.lotTextAlign || 'center',
    transform: `translateX(-50%) translate(${design.lotOffsetX ?? 0}px, ${design.lotOffsetY ?? 0}px) rotate(${design.lotRotate ?? 0}deg)`,
  },
});
const buildKitLabelDesignStyles = (design) => ({
  lot: {
    left: `${design.lotLeft}px`,
    top: `${design.lotTop}px`,
    fontSize: `${design.lotFontSize}px`,
    color: design.lotColor || '#23160d',
    fontWeight: design.lotFontWeight ?? 900,
    letterSpacing: `${design.lotLetterSpacing ?? 0}em`,
    textTransform: design.lotUppercase === false ? 'none' : 'uppercase',
    textAlign: design.lotTextAlign || 'center',
    transform: `rotate(${design.lotRotate ?? 0}deg)`,
    transformOrigin: 'left top',
  },
  qr: {
    left: `${design.qrLeft}px`,
    top: `${design.qrTop}px`,
    width: `${design.qrSize}px`,
    height: `${design.qrSize}px`,
  },
  logo: {
    left: `${design.logoLeft}px`,
    bottom: `${design.logoBottom}px`,
    width: `${design.logoWidth}px`,
    height: `${design.logoHeight}px`,
  },
  product: {
    left: `${design.productLeft}px`,
    bottom: `${design.productBottom}px`,
    fontSize: `${design.productFontSize}px`,
    lineHeight: design.productLineHeight,
    color: design.productColor || '#111111',
    fontWeight: design.productFontWeight ?? 900,
    letterSpacing: `${design.productLetterSpacing ?? 0}em`,
    textTransform: design.productUppercase === false ? 'none' : 'uppercase',
    textAlign: design.productTextAlign || 'left',
  },
  strength: {
    left: `${design.strengthLeft}px`,
    bottom: `${design.strengthBottom}px`,
    fontSize: `${design.strengthFontSize}px`,
    padding: `${design.strengthPadY}px ${design.strengthPadX}px`,
    borderRadius: `${design.strengthRadius}px`,
    color: design.massTextColor || FIXED_MASS_TEXT_COLOR,
    fontWeight: design.strengthFontWeight ?? 900,
    letterSpacing: `${design.strengthLetterSpacing ?? 0}em`,
  },
  footer: {
    right: `${design.footerRight}px`,
    bottom: `${design.footerBottom}px`,
    fontSize: `${design.footerFontSize}px`,
    gap: `${design.footerGap}px`,
  },
  fade: {
    height: `${design.bottomFadeHeight}px`,
  },
});
const buildTestLabelDesignStyles = (design) => ({
  logoWrap: {
    left: `${design.logoLeftPercent}%`,
    top: `${design.logoTopPercent}%`,
    transform: 'translateX(-50%)',
  },
  logo: {
    width: `${design.logoWidth}px`,
    height: `${design.logoHeight}px`,
  },
  product: {
    left: `${design.productLeftPercent}%`,
    top: `${design.productTopPercent}%`,
    width: `${design.productWidth}px`,
    fontSize: `${design.nameFontSize}px`,
    lineHeight: design.nameLineHeight,
    transform: 'translate(-50%, -50%)',
  },
  strength: {
    left: `${design.strengthLeftPercent}%`,
    top: `${design.strengthTopPercent}%`,
    fontSize: `${design.strengthFontSize}px`,
    padding: `${design.strengthPadY ?? FIXED_MASS_PAD_Y}px ${design.strengthPadX}px`,
    borderRadius: `${design.strengthRadius}px`,
    color: design.massTextColor || FIXED_MASS_TEXT_COLOR,
    transform: 'translate(-50%, -50%)',
  },
  variant: {
    left: `${design.variantLeftPercent}%`,
    top: `${design.variantTopPercent}%`,
    fontSize: `${design.variantFontSize}px`,
    marginTop: `${design.variantMarginTop ?? 2}px`,
    transform: 'translate(-50%, -50%)',
  },
  lot: {
    left: '50%',
    top: `${design.lotTopPercent}%`,
    fontSize: `${design.lotFontSize}px`,
    transform: 'translate(-50%, -50%)',
  },
});
const scaleLabelDesignForPrint = (design) => {
  const merged = mergeLabelDesign(design);
  const scaleX = LABEL_PRINT_WIDTH / LABEL_PREVIEW_WIDTH;
  const scaleY = LABEL_PRINT_HEIGHT / LABEL_PREVIEW_HEIGHT;
  const scale = scaleX;
  return {
    ...merged,
    logoLeft: merged.logoLeft * scaleX,
    logoWidth: merged.logoWidth * scaleX,
    logoHeight: merged.logoHeight * scaleY,
    // logoTopPercent stays as-is (percentage)
    centerWidth: merged.centerWidth * scaleX,
    centerGap: merged.centerGap * scaleY,
    nameLeft: merged.nameLeft * scaleX,
    nameTop: merged.nameTop * scaleY,
    nameFontSize: merged.nameFontSize * scale,
    strengthLeft: merged.strengthLeft * scaleX,
    strengthTop: merged.strengthTop * scaleY,
    strengthFontSize: merged.strengthFontSize * scale,
    strengthPadY: (merged.strengthPadY ?? FIXED_MASS_PAD_Y) * scaleY,
    strengthPadX: merged.strengthPadX * scaleX,
    strengthRadius: FIXED_MASS_RADIUS * scale,
    footerLeft: merged.footerLeft * scaleX,
    footerTop: merged.footerTop * scaleY,
    footerFontSize: merged.footerFontSize * scale,
    qrLeft: merged.qrLeft * scaleX,
    qrTop: merged.qrTop * scaleY,
    qrWidth: merged.qrWidth * scaleX,
    qrMaxHeight: merged.qrMaxHeight * scaleY,
    variantFontSize: merged.variantFontSize * scale,
    variantMarginTop: merged.variantMarginTop * scale,
    lotLeft: merged.lotLeft * scaleX,
    lotTop: merged.lotTop * scaleY,
    lotFontSize: merged.lotFontSize * scale,
    lotOffsetX: (merged.lotOffsetX ?? 0) * scaleX,
    lotOffsetY: (merged.lotOffsetY ?? 0) * scaleY,
    customTexts: (merged.customTexts || []).map((ct) => ({ ...ct, left: ct.left * scaleX, top: ct.top * scaleY, fontSize: (ct.fontSize || 12) * scale })),
  };
};
const scaleKitLabelDesignForPrint = (design) => {
  const merged = mergeKitLabelDesign(design);
  const scaleX = KIT_PRINT_WIDTH / KIT_PREVIEW_WIDTH;
  const scaleY = KIT_PRINT_HEIGHT / KIT_PREVIEW_HEIGHT;
  return {
    ...merged,
    lotLeft: merged.lotLeft * scaleX,
    lotTop: merged.lotTop * scaleY,
    lotFontSize: merged.lotFontSize * scaleY,
    qrLeft: merged.qrLeft * scaleX,
    qrTop: merged.qrTop * scaleY,
    qrSize: merged.qrSize * scaleX,
    logoLeft: merged.logoLeft * scaleX,
    logoBottom: merged.logoBottom * scaleY,
    logoWidth: merged.logoWidth * scaleX,
    logoHeight: merged.logoHeight * scaleY,
    productLeft: merged.productLeft * scaleX,
    productBottom: merged.productBottom * scaleY,
    productFontSize: merged.productFontSize * scaleY,
    strengthLeft: merged.strengthLeft * scaleX,
    strengthBottom: merged.strengthBottom * scaleY,
    strengthFontSize: merged.strengthFontSize * scaleY,
    strengthPadX: merged.strengthPadX * scaleX,
    strengthPadY: merged.strengthPadY * scaleY,
    strengthRadius: merged.strengthRadius * scaleX,
    footerRight: merged.footerRight * scaleX,
    footerBottom: merged.footerBottom * scaleY,
    footerFontSize: merged.footerFontSize * scaleY,
    footerGap: merged.footerGap * scaleY,
    bottomFadeHeight: merged.bottomFadeHeight * scaleY,
    customTexts: (merged.customTexts || []).map((ct) => ({ ...ct, left: ct.left * scaleX, top: ct.top * scaleY, fontSize: (ct.fontSize || 12) * scaleX })),
  };
};
const scaleTestLabelDesignForPrint = (design) => {
  const merged = mergeTestLabelDesign(design);
  const scaleX = LABEL_PRINT_WIDTH / LABEL_PREVIEW_WIDTH;
  const scaleY = LABEL_PRINT_HEIGHT / LABEL_PREVIEW_HEIGHT;
  const scale = scaleX;
  return {
    ...merged,
    logoWidth: merged.logoWidth * scaleX,
    logoHeight: merged.logoHeight * scaleY,
    productWidth: merged.productWidth * scaleX,
    nameFontSize: merged.nameFontSize * scale,
    strengthFontSize: merged.strengthFontSize * scale,
    strengthPadX: merged.strengthPadX * scaleX,
    strengthPadY: (merged.strengthPadY ?? FIXED_MASS_PAD_Y) * scaleY,
    strengthRadius: merged.strengthRadius * scale,
    variantFontSize: merged.variantFontSize * scale,
    variantOffsetX: merged.variantOffsetX * scale,
    variantOffsetY: merged.variantOffsetY * scale,
    lotFontSize: merged.lotFontSize * scale,
  };
};
const buildFixedLogoPrintStyles = (design) => {
  // design is already scaled by scaleLabelDesignForPrint — use values directly
  return {
    wrap: {
      left: design.logoLeft,
      topPercent: design.logoTopPercent,
    },
    size: {
      width: design.logoWidth,
      height: design.logoHeight,
    },
  };
};
const buildLabelBackground = (value, opacityPct = 100) => {
  const channels = getColorChannels(normalizeLabelAccentColor(value));
  if (!channels) return "transparent";
  const o = (opacityPct ?? 100) / 100;
  return `linear-gradient(0deg, rgba(${channels.r}, ${channels.g}, ${channels.b}, ${+(0.88 * o).toFixed(3)}) 0%, rgba(${channels.r}, ${channels.g}, ${channels.b}, ${+(0.64 * o).toFixed(3)}) 9%, rgba(${channels.r}, ${channels.g}, ${channels.b}, ${+(0.4 * o).toFixed(3)}) 18%, rgba(${channels.r}, ${channels.g}, ${channels.b}, ${+(0.22 * o).toFixed(3)}) 30%, rgba(${channels.r}, ${channels.g}, ${channels.b}, ${+(0.1 * o).toFixed(3)}) 42%, rgba(${channels.r}, ${channels.g}, ${channels.b}, ${+(0.03 * o).toFixed(3)}) 56%, rgba(${channels.r}, ${channels.g}, ${channels.b}, 0) 68%)`;
};
const buildKitLabelFade = (value) => {
  const channels = getColorChannels(normalizeLabelAccentColor(value));
  if (!channels) return "transparent";
  return `linear-gradient(180deg, rgba(${channels.r}, ${channels.g}, ${channels.b}, 0) 0%, rgba(${channels.r}, ${channels.g}, ${channels.b}, 0.12) 34%, rgba(${channels.r}, ${channels.g}, ${channels.b}, 0.32) 68%, rgba(${channels.r}, ${channels.g}, ${channels.b}, 0.84) 100%)`;
};
const buildLabelPrintMarkup = ({ productId, productName, strength, lot, capColor, design }) => {
  const capColorValue = normalizeLabelAccentColor(capColor);
  const labelDesign = scaleLabelDesignForPrint(design);
  const effectiveTint = labelDesign.tintColorOverride || capColorValue;
  const labelBackground = buildLabelBackground(effectiveTint, labelDesign.backgroundOpacity);
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(lot)} label</title>
    <style>
      @page { size: 0.75in 1.75in; margin: 0; }
      html, body {
        margin: 0;
        padding: 0;
        width: 0.75in;
        height: 1.75in;
        background: #ffffff;
        font-family: Arial, Helvetica, sans-serif;
      }
      body {
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
      .label {
        width: 0.75in;
        height: 1.75in;
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
      .lot {
        position: absolute;
        left: ${labelDesign.lotLeft}px;
        top: ${labelDesign.lotTop}px;
        transform: translateX(-50%) translate(${labelDesign.lotOffsetX ?? 0}px, ${labelDesign.lotOffsetY ?? 0}px) rotate(${labelDesign.lotRotate ?? 0}deg);
        font-size: ${labelDesign.lotFontSize}px;
        line-height: 1;
        font-weight: ${labelDesign.lotFontWeight ?? 800};
        color: ${escapeHtml(labelDesign.lotColor || "#2b1a0f")};
        letter-spacing: ${labelDesign.lotLetterSpacing ?? 0.03}em;
        text-transform: ${labelDesign.lotUppercase === false ? "none" : "uppercase"};
        text-align: ${labelDesign.lotTextAlign || "center"};
        white-space: nowrap;
      }
      .name-el {
        position: absolute;
        left: ${labelDesign.nameLeft}px;
        top: ${labelDesign.nameTop}px;
        transform: translate(-50%, -50%) rotate(${labelDesign.stackRotate ?? -90}deg);
        font-size: ${labelDesign.nameFontSize}px;
        line-height: ${labelDesign.nameLineHeight};
        font-weight: ${labelDesign.nameFontWeight ?? 900};
        color: ${escapeHtml(labelDesign.nameColor || "#23160d")};
        letter-spacing: ${labelDesign.nameLetterSpacing ?? 0}em;
        text-transform: ${labelDesign.nameUppercase === false ? "none" : "uppercase"};
        text-align: ${labelDesign.nameTextAlign || "center"};
        white-space: nowrap;
      }
      .strength-el {
        position: absolute;
        left: ${labelDesign.strengthLeft}px;
        top: ${labelDesign.strengthTop}px;
        transform: translate(-50%, -50%) rotate(${labelDesign.stackRotate ?? -90}deg);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        background: ${escapeHtml(labelDesign.strengthBgColor === "none" ? "transparent" : (labelDesign.strengthBgColor || capColorValue))};
        color: ${escapeHtml(labelDesign.massTextColor || FIXED_MASS_TEXT_COLOR)};
        border-radius: ${labelDesign.strengthRadius}px;
        padding: ${labelDesign.strengthPadY}px ${labelDesign.strengthPadX}px;
        font-size: ${labelDesign.strengthFontSize}px;
        line-height: 1;
        font-weight: ${labelDesign.strengthFontWeight ?? 900};
        letter-spacing: ${labelDesign.strengthLetterSpacing ?? 0}em;
        white-space: nowrap;
      }
    </style>
  </head>
  <body>
    <div class="label">
      <img class="bg-image" src="${escapeHtml(LABEL_BACKGROUND_IMAGE)}" alt="" />
      ${labelDesign.showGradient !== false ? '<div class="bg-tint"></div>' : ''}
      <div class="lot">${escapeHtml(lot || "")}</div>
      <div class="name-el">${buildLabelProductHtml(productName || "")}</div>
      <div class="strength-el">${escapeHtml(strength || "")}</div>
      ${(labelDesign.customTexts || []).map((ct) => `<div style="position:absolute;left:${ct.left}px;top:${ct.top}px;font-size:${ct.fontSize || 12}px;font-weight:${ct.fontWeight || 400};color:${escapeHtml(ct.color || '#ffffff')};transform:rotate(${ct.rotate || 0}deg);letter-spacing:${ct.letterSpacing || 0}em;white-space:pre-wrap;transform-origin:left top;">${escapeHtml(ct.text || '')}</div>`).join('')}
    </div>
    <script>
      window.onload = function () {
        var assets = [
          "${escapeHtml(LABEL_BACKGROUND_IMAGE)}"
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
const buildTestLabelsPrintMarkup = ({ productName, strength, lot, capColor, design }) => {
  const capColorValue = normalizeLabelAccentColor(capColor);
  const d = scaleLabelDesignForPrint(design);
  const effectiveTint = d.tintColorOverride || capColorValue;
  const labelBackground = buildLabelBackground(effectiveTint, d.backgroundOpacity);
  const pages = TEST_LABEL_VARIANTS.map(
    (variant) => `
      <section class="label-page">
        <div class="label">
          <img class="bg-image" src="${escapeHtml(LABEL_BACKGROUND_IMAGE)}" alt="" />
          <div class="bg-tint"></div>
          <div class="lot">${escapeHtml(lot || "")}</div>
          <div class="name-el">${buildLabelProductHtml(productName || "")}</div>
          <div class="strength-el">${escapeHtml(strength || "")}</div>
          <div class="variant-el">${escapeHtml(variant)}</div>
        </div>
      </section>`
  ).join("");
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Test labels</title>
    <style>
      @page { size: 0.75in 1.75in; margin: 0; }
      html, body {
        margin: 0;
        padding: 0;
        background: #ffffff;
        font-family: Arial, Helvetica, sans-serif;
      }
      body {
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
      .label-page {
        width: 0.75in;
        height: 1.75in;
        page-break-after: always;
        break-after: page;
        overflow: hidden;
      }
      .label-page:last-child {
        page-break-after: auto;
        break-after: auto;
      }
      .label {
        width: 0.75in;
        height: 1.75in;
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
      .lot {
        position: absolute;
        left: ${d.lotLeft}px;
        top: ${d.lotTop}px;
        transform: translateX(-50%) translate(${d.lotOffsetX ?? 0}px, ${d.lotOffsetY ?? 0}px) rotate(${d.lotRotate ?? 0}deg);
        font-size: ${d.lotFontSize}px;
        line-height: 1;
        font-weight: ${d.lotFontWeight ?? 800};
        color: ${escapeHtml(d.lotColor || "#2b1a0f")};
        letter-spacing: ${d.lotLetterSpacing ?? 0.03}em;
        text-transform: ${d.lotUppercase === false ? "none" : "uppercase"};
        text-align: ${d.lotTextAlign || "center"};
        white-space: nowrap;
      }
      .name-el {
        position: absolute;
        left: ${d.nameLeft}px;
        top: ${d.nameTop}px;
        transform: translate(-50%, -50%) rotate(${d.stackRotate ?? -90}deg);
        font-size: ${d.nameFontSize}px;
        line-height: ${d.nameLineHeight};
        font-weight: ${d.nameFontWeight ?? 900};
        color: ${escapeHtml(d.nameColor || "#23160d")};
        letter-spacing: ${d.nameLetterSpacing ?? 0}em;
        text-transform: ${d.nameUppercase === false ? "none" : "uppercase"};
        text-align: ${d.nameTextAlign || "center"};
        white-space: nowrap;
      }
      .strength-el {
        position: absolute;
        left: ${d.strengthLeft}px;
        top: ${d.strengthTop}px;
        transform: translate(-50%, -50%) rotate(${d.stackRotate ?? -90}deg);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        background: ${escapeHtml(capColorValue)};
        color: ${escapeHtml(d.massTextColor || FIXED_MASS_TEXT_COLOR)};
        border-radius: ${d.strengthRadius}px;
        padding: ${d.strengthPadY}px ${d.strengthPadX}px;
        font-size: ${d.strengthFontSize}px;
        line-height: 1;
        font-weight: ${d.strengthFontWeight ?? 900};
        letter-spacing: ${d.strengthLetterSpacing ?? 0}em;
        white-space: nowrap;
      }
      .variant-el {
        position: absolute;
        left: ${d.strengthLeft}px;
        top: ${d.strengthTop + d.strengthFontSize * 2}px;
        transform: translate(-50%, -50%) rotate(${d.stackRotate ?? -90}deg);
        font-size: ${d.variantFontSize}px;
        font-weight: 800;
        color: #23160d;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        white-space: nowrap;
      }
    </style>
  </head>
  <body>
    ${pages}
    <script>
      window.onload = function () {
        var assets = [
          "${escapeHtml(LABEL_BACKGROUND_IMAGE)}"
        ];
        var settled = false;
        var remaining = assets.length;
        function finish() {
          if (settled) return;
          settled = true;
          window.focus();
          setTimeout(function () { window.print(); }, 120);
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
      window.onafterprint = function () { window.close(); };
    </script>
  </body>
</html>`;
};
const buildAllVialLabelsPrintMarkup = (labelEntries) => {
  // labelEntries: [{ productName, strength, lot, capColor, design }]
  const pages = labelEntries.map(({ productName, strength, lot, capColor, design }) => {
    const capColorValue = normalizeLabelAccentColor(capColor);
    const labelDesign = scaleLabelDesignForPrint(design);
    const effectiveTint = labelDesign.tintColorOverride || capColorValue;
    const labelBackground = buildLabelBackground(effectiveTint, labelDesign.backgroundOpacity);
    return `
      <section class="label-page" data-lot="${escapeHtml(lot)}">
        <div class="label" style="background: linear-gradient(180deg, #f3f4f6 0%, #e9ebef 100%);">
          <img class="bg-image" src="${escapeHtml(LABEL_BACKGROUND_IMAGE)}" alt="" />
          <div class="bg-tint" style="background:${escapeHtml(labelBackground)};"></div>
          <div class="lot" style="left:${labelDesign.lotLeft}px;top:${labelDesign.lotTop}px;font-size:${labelDesign.lotFontSize}px;color:${escapeHtml(labelDesign.lotColor || "#2b1a0f")};font-weight:${labelDesign.lotFontWeight ?? 800};letter-spacing:${labelDesign.lotLetterSpacing ?? 0.03}em;text-transform:${labelDesign.lotUppercase === false ? "none" : "uppercase"};text-align:${labelDesign.lotTextAlign || "center"};transform:translateX(-50%) translate(${labelDesign.lotOffsetX ?? 0}px, ${labelDesign.lotOffsetY ?? 0}px) rotate(${labelDesign.lotRotate ?? 0}deg);">${escapeHtml(lot || "")}</div>
          <div style="position:absolute;left:${labelDesign.nameLeft}px;top:${labelDesign.nameTop}px;transform:translate(-50%,-50%) rotate(${labelDesign.stackRotate ?? -90}deg);font-size:${labelDesign.nameFontSize}px;line-height:${labelDesign.nameLineHeight};color:${escapeHtml(labelDesign.nameColor || "#23160d")};font-weight:${labelDesign.nameFontWeight ?? 900};letter-spacing:${labelDesign.nameLetterSpacing ?? 0}em;text-transform:${labelDesign.nameUppercase === false ? "none" : "uppercase"};text-align:${labelDesign.nameTextAlign || "center"};white-space:nowrap;">${buildLabelProductHtml(productName || "")}</div>
          <div style="position:absolute;left:${labelDesign.strengthLeft}px;top:${labelDesign.strengthTop}px;transform:translate(-50%,-50%) rotate(${labelDesign.stackRotate ?? -90}deg);display:inline-flex;align-items:center;justify-content:center;background:${escapeHtml(labelDesign.strengthBgColor === "none" ? "transparent" : (labelDesign.strengthBgColor || capColorValue))};color:${escapeHtml(labelDesign.massTextColor || FIXED_MASS_TEXT_COLOR)};border-radius:${labelDesign.strengthRadius}px;padding:${labelDesign.strengthPadY}px ${labelDesign.strengthPadX}px;font-size:${labelDesign.strengthFontSize}px;line-height:1;font-weight:${labelDesign.strengthFontWeight ?? 900};letter-spacing:${labelDesign.strengthLetterSpacing ?? 0}em;white-space:nowrap;">${escapeHtml(strength || "")}</div>
        </div>
      </section>`;
  }).join("\n");

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>All Vial Labels</title>
    <style>
      @page { size: 0.75in 1.75in; margin: 0; }
      html, body {
        margin: 0;
        padding: 0;
        background: #ffffff;
        font-family: Arial, Helvetica, sans-serif;
      }
      body {
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
      .label-page {
        width: 0.75in;
        height: 1.75in;
        page-break-after: always;
        break-after: page;
        overflow: hidden;
      }
      .label-page:last-child {
        page-break-after: auto;
        break-after: auto;
      }
      .label {
        width: 0.75in;
        height: 1.75in;
        box-sizing: border-box;
        position: relative;
        overflow: hidden;
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
        pointer-events: none;
      }
      .lot {
        position: absolute;
        line-height: 1;
        white-space: nowrap;
      }
    </style>
  </head>
  <body>
    ${pages}
  </body>
</html>`;
};

const buildKitLabelPrintMarkup = ({ productId, productName, strength, lot, capColor, design }) => {
  const accentColor = normalizeLabelAccentColor(capColor);
  const kitDesign = scaleKitLabelDesignForPrint(design);
  const bottomFade = buildKitLabelFade(accentColor);
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(lot)} kit label</title>
    <style>
      @page { size: 1.5in 2.25in; margin: 0; }
      html, body {
        margin: 0;
        padding: 0;
        width: 1.5in;
        height: 2.25in;
        background: #ffffff;
        font-family: Arial, Helvetica, sans-serif;
      }
      body {
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
      .label {
        width: 1.5in;
        height: 2.25in;
        position: relative;
        overflow: hidden;
        box-sizing: border-box;
        background: linear-gradient(180deg, #f3f4f6 0%, #e9ebef 100%);
      }
      .bg-image, .bottom-fade {
        position: absolute;
        inset: 0;
        pointer-events: none;
      }
      .bg-image {
        width: 100%;
        height: 100%;
        object-fit: cover;
        object-position: center;
      }
      .bottom-fade {
        top: auto;
        height: ${kitDesign.bottomFadeHeight}px;
        background: ${escapeHtml(bottomFade)};
      }
      .lot {
        position: absolute;
        left: ${kitDesign.lotLeft}px;
        top: ${kitDesign.lotTop}px;
        font-size: ${kitDesign.lotFontSize}px;
        line-height: 1;
        font-weight: ${kitDesign.lotFontWeight ?? 900};
        color: ${escapeHtml(kitDesign.lotColor || "#23160d")};
        letter-spacing: ${kitDesign.lotLetterSpacing ?? 0}em;
        text-transform: ${kitDesign.lotUppercase === false ? "none" : "uppercase"};
        text-align: ${kitDesign.lotTextAlign || "center"};
        transform: rotate(${kitDesign.lotRotate ?? 0}deg);
        transform-origin: left top;
      }
      .product {
        position: absolute;
        left: ${kitDesign.productLeft}px;
        bottom: ${kitDesign.productBottom}px;
        transform-origin: left bottom;
        transform: rotate(-90deg);
        width: 220px;
        font-size: ${kitDesign.productFontSize}px;
        line-height: ${kitDesign.productLineHeight};
        font-weight: ${kitDesign.productFontWeight ?? 900};
        color: ${escapeHtml(kitDesign.productColor || "#111111")};
        letter-spacing: ${kitDesign.productLetterSpacing ?? 0}em;
        text-transform: ${kitDesign.productUppercase === false ? "none" : "uppercase"};
        text-align: ${kitDesign.productTextAlign || "left"};
        white-space: normal;
        overflow: hidden;
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
        line-clamp: 2;
        text-wrap: balance;
      }
      .strength-group {
        position: absolute;
        left: ${kitDesign.strengthLeft}px;
        bottom: ${kitDesign.strengthBottom}px;
        transform-origin: left bottom;
        transform: rotate(-90deg);
        display: inline-flex;
        align-items: center;
        gap: 10px;
      }
      .strength {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        background: ${escapeHtml(kitDesign.strengthBgColor === "none" ? "transparent" : (kitDesign.strengthBgColor || accentColor))};
        color: ${escapeHtml(kitDesign.massTextColor || FIXED_MASS_TEXT_COLOR)};
        padding: ${kitDesign.strengthPadY}px ${kitDesign.strengthPadX}px;
        border-radius: ${kitDesign.strengthRadius}px;
        font-size: ${kitDesign.strengthFontSize}px;
        line-height: 1;
        font-weight: ${kitDesign.strengthFontWeight ?? 900};
        letter-spacing: ${kitDesign.strengthLetterSpacing ?? 0}em;
        text-transform: uppercase;
        white-space: nowrap;
      }
      .count {
        font-size: ${kitDesign.strengthFontSize}px;
        line-height: 1;
        font-weight: 700;
        color: #111111;
        white-space: nowrap;
      }
    </style>
  </head>
  <body>
    <div class="label">
      <img class="bg-image" src="${escapeHtml(LABEL_BACKGROUND_IMAGE)}" alt="" />
      <div class="bottom-fade"></div>
      <div class="lot">${escapeHtml(lot || productId || "")}</div>
      <div class="product">${buildLabelProductHtml(productName || "")}</div>
      <div class="strength-group">
        <div class="strength">${escapeHtml(strength || "")}</div>
        <div class="count">10 Vials</div>
      </div>
      ${(kitDesign.customTexts || []).map((ct) => `<div style="position:absolute;left:${ct.left}px;top:${ct.top}px;font-size:${ct.fontSize || 12}px;font-weight:${ct.fontWeight || 400};color:${escapeHtml(ct.color || '#ffffff')};transform:rotate(${ct.rotate || 0}deg);letter-spacing:${ct.letterSpacing || 0}em;white-space:pre-wrap;transform-origin:left top;">${escapeHtml(ct.text || '')}</div>`).join('')}
    </div>
    <script>
      window.onload = function () {
        var assets = [
          "${escapeHtml(LABEL_BACKGROUND_IMAGE)}"
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
const styleObjToCss = (obj) =>
  Object.entries(obj)
    .map(([k, v]) => `${k.replace(/([A-Z])/g, '-$1').toLowerCase()}:${String(v)}`)
    .join(';');
const createLabelDomForCapture = ({ productName, strength, lot, capColor, design }) => {
  const ds = buildLabelDesignStyles(mergeLabelDesign(design));
  const capColorValue = normalizeLabelAccentColor(capColor);
  const mergedDesign = mergeLabelDesign(design);
  const effectiveTint = mergedDesign.tintColorOverride || capColorValue;
  const labelBg = buildLabelBackground(effectiveTint, mergedDesign.backgroundOpacity);
  const el = document.createElement('div');
  el.style.cssText = `width:${LABEL_PREVIEW_WIDTH}px;height:${LABEL_PREVIEW_HEIGHT}px;position:relative;overflow:hidden;background:linear-gradient(180deg,#f3f4f6 0%,#e9ebef 100%);font-family:Arial,Helvetica,sans-serif;box-sizing:border-box;`;
  el.innerHTML = `
    <img src="${escapeHtml(LABEL_BACKGROUND_IMAGE)}" crossorigin="anonymous"
      style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;pointer-events:none;" />
    <div style="position:absolute;inset:0;background:${escapeHtml(labelBg)};pointer-events:none;"></div>
    <div style="position:absolute;${styleObjToCss(ds.lot)};line-height:1;white-space:nowrap;">${escapeHtml(lot || '')}</div>
    <div style="position:absolute;left:${mergedDesign.nameLeft ?? 88}px;top:${mergedDesign.nameTop ?? 210}px;transform:translate(-50%,-50%) rotate(${mergedDesign.stackRotate ?? -90}deg);${styleObjToCss({ fontSize: ds.name.fontSize, lineHeight: ds.name.lineHeight, color: ds.name.color, fontWeight: ds.name.fontWeight, letterSpacing: ds.name.letterSpacing, textTransform: ds.name.textTransform, textAlign: ds.name.textAlign })};white-space:nowrap;">${buildLabelProductHtml(productName || '')}</div>
    <div style="position:absolute;left:${mergedDesign.strengthLeft ?? 124}px;top:${mergedDesign.strengthTop ?? 210}px;transform:translate(-50%,-50%) rotate(${mergedDesign.stackRotate ?? -90}deg);display:inline-flex;align-items:center;justify-content:center;background:${escapeHtml(mergedDesign.strengthBgColor === 'none' ? 'transparent' : (mergedDesign.strengthBgColor || capColorValue))};${styleObjToCss({ fontSize: ds.strength.fontSize, padding: ds.strength.padding, borderRadius: ds.strength.borderRadius, color: ds.strength.color, fontWeight: ds.strength.fontWeight, letterSpacing: ds.strength.letterSpacing })};line-height:1;white-space:nowrap;">${escapeHtml(strength || '')}</div>
  `;
  return el;
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

// Merge a per-lot labelOverride into a product-level design for rendering/printing
const mergeLotOverride = (productDesign, override) => {
  if (!override) return productDesign;
  const out = { ...productDesign };
  if (override.nameColor)        out.nameColor        = override.nameColor;
  if (override.productColor)     out.productColor     = override.productColor;
  if (override.strengthBgColor)  out.strengthBgColor  = override.strengthBgColor;
  if (override.massTextColor)    out.massTextColor    = override.massTextColor;
  if (override.lotColor)         out.lotColor         = override.lotColor;
  out.customTexts = [...(productDesign.customTexts || []), ...(override.customTexts || [])];
  return out;
};

// ---------------------------------------------------------------------------
// DraggableLabelCanvas – interactive drag-to-position preview for the editor
// ---------------------------------------------------------------------------
const DRAG_CANVAS_SCALE = 2; // render at 2× the preview dimensions

const VIAL_DRAG_ELEMENTS = [
  { id: "name",     label: "Name",   color: "#d82d63", xField: "nameLeft",     yField: "nameTop" },
  { id: "strength", label: "Mass",   color: "#e08a00", xField: "strengthLeft", yField: "strengthTop" },
  { id: "lot",      label: "Lot ID", color: "#6b2da0", xField: "lotLeft",      yField: "lotTop" },
];

const KIT_DRAG_ELEMENTS = [
  { id: "lot",      label: "Lot ID",  color: "#6b2da0", xField: "lotLeft",      yField: "lotTop" },
  { id: "product",  label: "Product", color: "#d82d63", xField: "productLeft",   yField: "productBottom", yMode: "bottom" },
  { id: "strength", label: "Mass",    color: "#e08a00", xField: "strengthLeft",  yField: "strengthBottom",yMode: "bottom" },
];

const DraggableLabelCanvas = ({ design, onChange, mode, product, lotEntry, selectedEl, onSelect, canvasScale = DRAG_CANVAS_SCALE, showHandles = true, showEditPanel = true }) => {
  const maxScale = canvasScale;
  const isKit = mode === "kit";
  const previewW = isKit ? KIT_PREVIEW_WIDTH : LABEL_PREVIEW_WIDTH;
  const previewH = isKit ? KIT_PREVIEW_HEIGHT : LABEL_PREVIEW_HEIGHT;

  const [S, setS] = React.useState(maxScale);
  const wrapRef = useRef(null);

  React.useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const compute = () => {
      const availH = el.clientHeight;
      const availW = el.clientWidth;
      if (availH < 10 || availW < 10) return;
      const scaleH = availH / previewH;
      const scaleW = availW / previewW;
      setS(Math.min(maxScale, scaleH, scaleW));
    };
    const raf = requestAnimationFrame(compute);
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [previewH, previewW, maxScale]);

  const canvasW = previewW * S;
  const canvasH = previewH * S;

  const elements = isKit ? KIT_DRAG_ELEMENTS : VIAL_DRAG_ELEMENTS;
  const dragState = useRef(null);
  const containerRef = useRef(null);

  const getHandlePos = (el) => {
    const xMode = el.xMode || "left";
    const yMode = el.yMode || "top";
    const rawX = design[el.xField] ?? 0;
    const rawY = design[el.yField] ?? 0;

    let px = xMode === "percent" ? (rawX / 100) * canvasW
           : xMode === "right"   ? canvasW - (rawX * S)
           : rawX * S;
    let py = yMode === "percent" ? (rawY / 100) * canvasH
           : yMode === "bottom"  ? canvasH - (rawY * S)
           : rawY * S;
    return { px, py };
  };

  const onMouseDown = (e, el) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = containerRef.current.getBoundingClientRect();
    dragState.current = {
      el,
      startMouseX: e.clientX,
      startMouseY: e.clientY,
      startX: design[el.xField] ?? 0,
      startY: design[el.yField] ?? 0,
      rectLeft: rect.left,
      rectTop: rect.top,
    };

    const onMove = (moveEvt) => {
      if (!dragState.current) return;
      const { el: cel, startMouseX, startMouseY, startX, startY } = dragState.current;
      const deltaMouseX = moveEvt.clientX - startMouseX;
      const deltaMouseY = moveEvt.clientY - startMouseY;

      const xMode = cel.xMode || "left";
      const yMode = cel.yMode || "top";

      let newX, newY;
      if (xMode === "percent") {
        newX = Math.max(0, Math.min(100, startX + (deltaMouseX / canvasW) * 100));
      } else if (xMode === "right") {
        newX = Math.max(0, startX - deltaMouseX / S);
      } else {
        newX = Math.max(0, startX + deltaMouseX / S);
      }

      if (yMode === "percent") {
        newY = Math.max(0, Math.min(100, startY + (deltaMouseY / canvasH) * 100));
      } else if (yMode === "bottom") {
        newY = Math.max(0, startY - deltaMouseY / S);
      } else {
        newY = Math.max(0, startY + deltaMouseY / S);
      }

      onChange(cel.xField, Math.round(newX * 10) / 10);
      onChange(cel.yField, Math.round(newY * 10) / 10);
    };

    setIsDragging(true);
    const onUp = () => {
      dragState.current = null;
      setIsDragging(false);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  // Touch support
  const onTouchStart = (e, el) => {
    e.stopPropagation();
    const touch = e.touches[0];
    const rect = containerRef.current.getBoundingClientRect();
    dragState.current = {
      el,
      startMouseX: touch.clientX,
      startMouseY: touch.clientY,
      startX: design[el.xField] ?? 0,
      startY: design[el.yField] ?? 0,
    };
    const onMove = (moveEvt) => {
      if (!dragState.current) return;
      const t = moveEvt.touches[0];
      const { el: cel, startMouseX, startMouseY, startX, startY } = dragState.current;
      const dx = t.clientX - startMouseX;
      const dy = t.clientY - startMouseY;
      const xMode = cel.xMode || "left";
      const yMode = cel.yMode || "top";
      let newX = xMode === "percent" ? Math.max(0, Math.min(100, startX + (dx / canvasW) * 100))
                : xMode === "right"  ? Math.max(0, startX - dx / S)
                : Math.max(0, startX + dx / S);
      let newY = yMode === "percent" ? Math.max(0, Math.min(100, startY + (dy / canvasH) * 100))
                : yMode === "bottom" ? Math.max(0, startY - dy / S)
                : Math.max(0, startY + dy / S);
      onChange(cel.xField, Math.round(newX * 10) / 10);
      onChange(cel.yField, Math.round(newY * 10) / 10);
    };
    const onEnd = () => {
      dragState.current = null;
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
    };
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onEnd);
  };

  const centerElement = (el, axis) => {
    if (axis === 'h') {
      const xMode = el.xMode || "left";
      let newX;
      if (xMode === "percent") newX = 50;
      else if (xMode === "right") newX = Math.round(previewW / 2);
      else newX = Math.round(previewW / 2);
      onChange(el.xField, newX);
    } else {
      const yMode = el.yMode || "top";
      let newY;
      if (yMode === "percent") newY = 50;
      else if (yMode === "bottom") newY = Math.round(previewH / 2);
      else newY = Math.round(previewH / 2);
      onChange(el.yField, newY);
    }
  };

  const [activeEl, setActiveEl] = React.useState(null);
  const [isDragging, setIsDragging] = React.useState(false);
  const closeTimer = React.useRef(null);

  const showPanel = (id) => {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; }
    setActiveEl(id);
  };
  const scheduleHide = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => { setActiveEl(null); closeTimer.current = null; }, 150);
  };

  const capColorValue = normalizeLabelAccentColor(
    lotEntry ? getCapRenderColor(lotEntry.capColor, lotEntry.capShade) : ""
  );
  const lotText = lotEntry?.lot || "LOT-ID";
  const vd = mergeLabelDesign(design);
  const vds = buildLabelDesignStyles(vd);
  const kds = buildKitLabelDesignStyles(mergeKitLabelDesign(design));

  const hlStyle = (id) => ({
    cursor: "grab",
    borderRadius: 3,
    boxShadow: showEditPanel && activeEl === id ? "0 0 0 2px #fff, 0 0 0 4px #4a96ff" : "none",
    transition: "box-shadow 0.1s",
  });
  const hlEvents = (id) => showEditPanel ? ({
    onMouseEnter: (e) => { e.stopPropagation(); showPanel(id); },
    onMouseLeave: (e) => { e.stopPropagation(); scheduleHide(); },
  }) : {};

  const labelContent = isKit ? (
    <div style={{ width: previewW, height: previewH, position: "relative", overflow: "hidden", background: "linear-gradient(180deg,#f3f4f6 0%,#e9ebef 100%)", fontFamily: "Arial,Helvetica,sans-serif", boxSizing: "border-box" }}>
      <img src={LABEL_BACKGROUND_IMAGE} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", pointerEvents: "none" }} />
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: kds.fade.height, background: buildKitLabelFade(capColorValue), pointerEvents: "none" }} />
      <div style={{ position: "absolute", ...kds.lot, whiteSpace: "nowrap", ...hlStyle("lot") }} {...hlEvents("lot")}>{lotText}</div>
      <div style={{ position: "absolute", left: kds.product.left, bottom: kds.product.bottom, fontSize: kds.product.fontSize, lineHeight: kds.product.lineHeight, transformOrigin: "left bottom", transform: "rotate(-90deg)", fontWeight: kds.product.fontWeight, color: kds.product.color, letterSpacing: kds.product.letterSpacing, textTransform: kds.product.textTransform, whiteSpace: "nowrap", ...hlStyle("product") }} {...hlEvents("product")}>{renderLabelProductName(product?.product)}</div>
      <div style={{ position: "absolute", display: "inline-flex", alignItems: "center", gap: 10, left: kds.strength.left, bottom: kds.strength.bottom, transformOrigin: "left bottom", transform: "rotate(-90deg)", ...hlStyle("strength") }} {...hlEvents("strength")}>
        <div style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", backgroundColor: design.strengthBgColor === "none" ? "transparent" : (design.strengthBgColor || capColorValue || "#8f3a17"), fontSize: kds.strength.fontSize, padding: kds.strength.padding, borderRadius: kds.strength.borderRadius, color: kds.strength.color, fontWeight: kds.strength.fontWeight, letterSpacing: kds.strength.letterSpacing, whiteSpace: "nowrap" }}>{product?.strength}</div>
        <div style={{ fontSize: kds.strength.fontSize, fontWeight: 700, color: "#111", whiteSpace: "nowrap" }}>10 Vials</div>
      </div>
      {(design.customTexts || []).map((ct) => (
        <div key={ct.id} style={{ position: "absolute", left: ct.left, top: ct.top, fontSize: ct.fontSize || 12, fontWeight: ct.fontWeight || 400, color: ct.color || "#ffffff", transform: `rotate(${ct.rotate || 0}deg)`, letterSpacing: `${ct.letterSpacing || 0}em`, whiteSpace: "pre-wrap", transformOrigin: "left top", lineHeight: 1.2, ...hlStyle(`ct_${ct.id}`) }} {...hlEvents(`ct_${ct.id}`)}>{ct.text}</div>
      ))}
    </div>
  ) : (
    <div style={{ width: previewW, height: previewH, position: "relative", overflow: "hidden", background: "linear-gradient(180deg,#f3f4f6 0%,#e9ebef 100%)", fontFamily: "Arial,Helvetica,sans-serif", boxSizing: "border-box" }}>
      <img src={LABEL_BACKGROUND_IMAGE} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", pointerEvents: "none" }} />
      {design.showGradient !== false && (capColorValue || design.tintColorOverride) && <div style={{ position: "absolute", inset: 0, background: buildLabelBackground(design.tintColorOverride || capColorValue, design.backgroundOpacity), pointerEvents: "none" }} />}
      <div style={{ position: "absolute", ...vds.lot, lineHeight: 1, whiteSpace: "nowrap", cursor: "grab", ...hlStyle("lot") }} {...hlEvents("lot")} onMouseDown={(e) => { if (e.button === 0) { e.preventDefault(); e.stopPropagation(); onMouseDown(e, { xField: "lotLeft", yField: "lotTop" }); }}}>{lotText}</div>
      <div
        style={{ position: "absolute", left: vd.nameLeft ?? 88, top: vd.nameTop ?? 210, transform: `translate(-50%, -50%) rotate(${vd.stackRotate ?? -90}deg)`, fontSize: vds.name.fontSize, lineHeight: vds.name.lineHeight, color: vds.name.color, fontWeight: vds.name.fontWeight, letterSpacing: vds.name.letterSpacing, textTransform: vds.name.textTransform, textAlign: vds.name.textAlign, whiteSpace: "nowrap", cursor: "grab", ...hlStyle("name") }}
        {...hlEvents("name")}
        onMouseDown={(e) => { if (e.button === 0) { e.preventDefault(); e.stopPropagation(); onMouseDown(e, { xField: "nameLeft", yField: "nameTop" }); }}}
      >
        {renderLabelProductName(product?.product)}
      </div>
      <div
        style={{ position: "absolute", left: vd.strengthLeft ?? 124, top: vd.strengthTop ?? 210, transform: `translate(-50%, -50%) rotate(${vd.stackRotate ?? -90}deg)`, display: "inline-flex", alignItems: "center", justifyContent: "center", backgroundColor: design.strengthBgColor === "none" ? "transparent" : (design.strengthBgColor || capColorValue || "#8f3a17"), fontSize: vds.strength.fontSize, padding: vds.strength.padding, borderRadius: vds.strength.borderRadius, color: vds.strength.color, fontWeight: vds.strength.fontWeight, letterSpacing: vds.strength.letterSpacing, lineHeight: 1, whiteSpace: "nowrap", cursor: "grab", ...hlStyle("strength") }}
        {...hlEvents("strength")}
        onMouseDown={(e) => { if (e.button === 0) { e.preventDefault(); e.stopPropagation(); onMouseDown(e, { xField: "strengthLeft", yField: "strengthTop" }); }}}
      >
        {product?.strength}
      </div>
      {(design.customTexts || []).map((ct) => (
        <div key={ct.id} style={{ position: "absolute", left: ct.left, top: ct.top, fontSize: ct.fontSize || 12, fontWeight: ct.fontWeight || 400, color: ct.color || "#ffffff", transform: `rotate(${ct.rotate || 0}deg)`, letterSpacing: `${ct.letterSpacing || 0}em`, whiteSpace: "pre-wrap", transformOrigin: "left top", lineHeight: 1.2, ...hlStyle(`ct_${ct.id}`) }} {...hlEvents(`ct_${ct.id}`)}>{ct.text}</div>
      ))}
    </div>
  );

  const panelProps = {
    onMouseEnter: () => { if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; } },
    onMouseLeave: scheduleHide,
  };

  const renderEditPanel = () => {
    if (!showEditPanel || !activeEl) return null;

    if (activeEl === "lot") return (
      <div className="lot-canvas-edit-panel" {...panelProps}>
        <div className="lot-canvas-edit-panel-hd"><span>Lot ID</span></div>
        <div className="lot-canvas-edit-panel-body">
          <div className="lot-canvas-edit-row"><span className="lot-canvas-edit-lbl">Color</span>
            <input type="color" className="lot-modal-color-picker" style={{ height: 26, width: 32 }} value={colorValueToHex(design.lotColor, "#2b1a0f")} onChange={(e) => onChange("lotColor", e.target.value)} />
            <input type="text" className="lot-props-number" style={{ width: 70 }} value={design.lotColor || ""} placeholder="#2b1a0f" onChange={(e) => onChange("lotColor", e.target.value)} />
          </div>
          <div className="lot-canvas-edit-row"><span className="lot-canvas-edit-lbl">Size</span>
            <input type="number" className="lot-props-number" style={{ width: 56 }} value={design.lotFontSize ?? 12} min={6} max={40} onChange={(e) => onChange("lotFontSize", Number(e.target.value))} />
          </div>
        </div>
      </div>
    );

    if (activeEl === "name") return (
      <div className="lot-canvas-edit-panel" {...panelProps}>
        <div className="lot-canvas-edit-panel-hd"><span>Product Name</span></div>
        <div className="lot-canvas-edit-panel-body">
          <div className="lot-canvas-edit-row"><span className="lot-canvas-edit-lbl">Color</span>
            <input type="color" className="lot-modal-color-picker" style={{ height: 26, width: 32 }} value={colorValueToHex(design.nameColor, "#23160d")} onChange={(e) => onChange("nameColor", e.target.value)} />
            <input type="text" className="lot-props-number" style={{ width: 70 }} value={design.nameColor || ""} placeholder="#23160d" onChange={(e) => onChange("nameColor", e.target.value)} />
          </div>
          <div className="lot-canvas-edit-row"><span className="lot-canvas-edit-lbl">Size</span>
            <input type="number" className="lot-props-number" style={{ width: 56 }} value={design.nameFontSize ?? 37} min={6} max={80} onChange={(e) => onChange("nameFontSize", Number(e.target.value))} />
          </div>
        </div>
      </div>
    );

    if (activeEl === "product") return (
      <div className="lot-canvas-edit-panel" {...panelProps}>
        <div className="lot-canvas-edit-panel-hd"><span>Product Name (Kit)</span></div>
        <div className="lot-canvas-edit-panel-body">
          <div className="lot-canvas-edit-row"><span className="lot-canvas-edit-lbl">Color</span>
            <input type="color" className="lot-modal-color-picker" style={{ height: 26, width: 32 }} value={colorValueToHex(design.productColor, "#111111")} onChange={(e) => onChange("productColor", e.target.value)} />
            <input type="text" className="lot-props-number" style={{ width: 70 }} value={design.productColor || ""} placeholder="#111111" onChange={(e) => onChange("productColor", e.target.value)} />
          </div>
          <div className="lot-canvas-edit-row"><span className="lot-canvas-edit-lbl">Size</span>
            <input type="number" className="lot-props-number" style={{ width: 56 }} value={design.productFontSize ?? 46} min={6} max={100} onChange={(e) => onChange("productFontSize", Number(e.target.value))} />
          </div>
        </div>
      </div>
    );

    if (activeEl === "strength") return (
      <div className="lot-canvas-edit-panel" {...panelProps}>
        <div className="lot-canvas-edit-panel-hd"><span>Mass Badge</span></div>
        <div className="lot-canvas-edit-panel-body">
          <div className="lot-canvas-edit-row"><span className="lot-canvas-edit-lbl">Badge BG</span>
            <input type="color" className="lot-modal-color-picker" style={{ height: 26, width: 32 }} value={colorValueToHex(design.strengthBgColor, capColorValue || "#8f3a17")} onChange={(e) => onChange("strengthBgColor", e.target.value)} />
            <input type="text" className="lot-props-number" style={{ width: 70 }} value={design.strengthBgColor || ""} placeholder="(cap color)" onChange={(e) => onChange("strengthBgColor", e.target.value)} />
            <button className="lot-props-clear-btn" style={{ fontSize: "0.7rem", padding: "0.15rem 0.4rem" }} onClick={() => onChange("strengthBgColor", "none")}>None</button>
            {design.strengthBgColor && design.strengthBgColor !== "none" && <button className="lot-props-clear-btn" onClick={() => onChange("strengthBgColor", "")}>✕</button>}
          </div>
          <div className="lot-canvas-edit-row"><span className="lot-canvas-edit-lbl">Text</span>
            <input type="color" className="lot-modal-color-picker" style={{ height: 26, width: 32 }} value={colorValueToHex(design.massTextColor, "#ffffff")} onChange={(e) => onChange("massTextColor", e.target.value)} />
            <input type="text" className="lot-props-number" style={{ width: 70 }} value={design.massTextColor || ""} placeholder="#ffffff" onChange={(e) => onChange("massTextColor", e.target.value)} />
          </div>
          <div className="lot-canvas-edit-row"><span className="lot-canvas-edit-lbl">Size</span>
            <input type="number" className="lot-props-number" style={{ width: 56 }} value={isKit ? (design.strengthFontSize ?? 35) : (design.strengthFontSize ?? 22)} min={6} max={80} onChange={(e) => onChange("strengthFontSize", Number(e.target.value))} />
          </div>
        </div>
      </div>
    );

    if (activeEl.startsWith("ct_")) {
      const ctId = activeEl.slice(3);
      const ct = (design.customTexts || []).find((t) => t.id === ctId);
      if (!ct) return null;
      const updCt = (updates) => onChange("customTexts", design.customTexts.map((t) => t.id === ctId ? { ...t, ...updates } : t));
      return (
        <div className="lot-canvas-edit-panel" {...panelProps}>
          <div className="lot-canvas-edit-panel-hd"><span>Custom Text</span></div>
          <div className="lot-canvas-edit-panel-body">
            <textarea className="lot-props-text-input" rows={2} value={ct.text} onChange={(e) => updCt({ text: e.target.value })} />
            <div className="lot-canvas-edit-row"><span className="lot-canvas-edit-lbl">Color</span>
              <input type="color" className="lot-modal-color-picker" style={{ height: 26, width: 32 }} value={colorValueToHex(ct.color, "#ffffff")} onChange={(e) => updCt({ color: e.target.value })} />
              <input type="text" className="lot-props-number" style={{ width: 70 }} value={ct.color || ""} placeholder="#ffffff" onChange={(e) => updCt({ color: e.target.value })} />
            </div>
            <div className="lot-canvas-edit-row"><span className="lot-canvas-edit-lbl">Size</span>
              <input type="number" className="lot-props-number" style={{ width: 56 }} value={ct.fontSize || 12} min={6} max={80} onChange={(e) => updCt({ fontSize: Number(e.target.value) })} />
              <label className="lot-canvas-edit-check"><input type="checkbox" checked={(ct.fontWeight || 400) >= 700} onChange={(e) => updCt({ fontWeight: e.target.checked ? 700 : 400 })} /> Bold</label>
            </div>
            <div className="lot-canvas-edit-row"><span className="lot-canvas-edit-lbl">Rotate</span>
              <input type="number" className="lot-props-number" style={{ width: 56 }} value={ct.rotate || 0} min={-180} max={180} onChange={(e) => updCt({ rotate: Number(e.target.value) })} />
              <button className="lot-props-clear-btn" style={{ color: "#c0392b", marginLeft: "auto" }} onClick={() => { onChange("customTexts", design.customTexts.filter((t) => t.id !== ctId)); setActiveEl(null); }}>✕ Remove</button>
            </div>
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="lot-drag-canvas-wrap" ref={wrapRef}>
      <div className="lot-drag-canvas-label">{showEditPanel ? "Hover to edit · drag to reposition" : "Drag to reposition · Full Editor for more"}</div>
      <div
        ref={containerRef}
        className="lot-drag-canvas"
        style={{ width: canvasW, height: canvasH, position: "relative", userSelect: "none", cursor: isDragging ? "grabbing" : undefined }}
      >
        {/* Scaled label preview — interactive elements enabled */}
        <div style={{ position: "absolute", top: 0, left: 0, width: previewW, height: previewH, transform: `scale(${S})`, transformOrigin: "top left" }}>
          {labelContent}
        </div>
        {/* Grid lines */}
        <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", opacity: 0.15 }}>
          {[25, 50, 75].map((pct) => (
            <React.Fragment key={pct}>
              <line x1={`${pct}%`} y1="0" x2={`${pct}%`} y2="100%" stroke="#4a3825" strokeWidth="1" strokeDasharray="4 4" />
              <line x1="0" y1={`${pct}%`} x2="100%" y2={`${pct}%`} stroke="#4a3825" strokeWidth="1" strokeDasharray="4 4" />
            </React.Fragment>
          ))}
        </svg>

        {/* Custom text drag handles */}
        {showHandles && (design.customTexts || []).map((ct) => {
          const px = ct.left * S;
          const py = ct.top * S;
          const isSelected = selectedEl === `ct_${ct.id}`;
          return (
            <div
              key={`ct_${ct.id}`}
              className={`lot-drag-handle lot-drag-handle-text${isSelected ? " selected" : ""}`}
              style={{ position: "absolute", left: px, top: py, transform: "translate(-50%, -50%)", background: "#1a7a48", cursor: "grab", zIndex: isSelected ? 30 : 20, outline: isSelected ? "3px solid #fff" : "none", boxShadow: isSelected ? "0 0 0 5px #1a7a48, 0 4px 16px rgba(0,0,0,0.36)" : undefined }}
              onMouseDown={(e) => {
                e.preventDefault(); e.stopPropagation();
                onSelect(`ct_${ct.id}`);
                const rect = containerRef.current.getBoundingClientRect();
                const startMouseX = e.clientX, startMouseY = e.clientY;
                const startLeft = ct.left, startTop = ct.top;
                const onMove = (me) => {
                  const dx = (me.clientX - startMouseX) / S;
                  const dy = (me.clientY - startMouseY) / S;
                  const updatedTexts = design.customTexts.map((t) => t.id === ct.id ? { ...t, left: Math.round(startLeft + dx), top: Math.round(startTop + dy) } : t);
                  onChange("customTexts", updatedTexts);
                };
                const onUp = () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
                window.addEventListener("mousemove", onMove);
                window.addEventListener("mouseup", onUp);
              }}
              onClick={(e) => { e.stopPropagation(); onSelect(`ct_${ct.id}`); showPanel(`ct_${ct.id}`); }}
              title={`Drag to move: "${ct.text}"`}
            >
              <span className="lot-drag-handle-icon">T</span>
              <span className="lot-drag-handle-label">{ct.text.slice(0, 8) || "Text"}</span>
            </div>
          );
        })}

        {/* Drag handles */}
        {showHandles && elements.map((el) => {
          const { px: rawPx, py: rawPy } = getHandlePos(el);
          // Offset handle to visual center of each element
          let dx = 0, dy = 0;
          if (isKit) {
            if (el.id === 'lot')      { dx = 25 * S; dy = 8 * S; }
            else if (el.id === 'product') { dx = -15 * S; dy = -55 * S; }
            else if (el.id === 'strength') { dx = -15 * S; dy = -28 * S; }
          } else {
            if (el.id === 'lot') { dx = 25 * S; dy = 6 * S; }
            // name/strength already use translate(-50%,-50%) so no offset needed
          }
          const px = rawPx + dx;
          const py = rawPy + dy;
          const isSelected = selectedEl === el.id;
          return (
            <div
              key={el.id}
              className={`lot-drag-handle${isSelected ? " selected" : ""}`}
              style={{
                position: "absolute",
                left: px,
                top: py,
                transform: "translate(-50%, -50%)",
                background: el.color,
                cursor: "grab",
                zIndex: isSelected ? 30 : 20,
                outline: isSelected ? `3px solid #fff` : "none",
                boxShadow: isSelected ? `0 0 0 5px ${el.color}, 0 4px 16px rgba(0,0,0,0.36)` : undefined,
              }}
              onMouseDown={(e) => { onSelect(el.id); onMouseDown(e, el); }}
              onTouchStart={(e) => { onSelect(el.id); onTouchStart(e, el); }}
              onClick={(e) => { e.stopPropagation(); onSelect(el.id); }}
              title={`Click to select / drag to move ${el.label}`}
            >
              <span className="lot-drag-handle-icon">⤢</span>
              <span className="lot-drag-handle-label">{el.label}</span>
            </div>
          );
        })}
      </div>
      {renderEditPanel()}
    </div>
  );
};

const LotIDTracker = ({ isGuest = false, vendorGuest = null }) => {
  const [products, setProducts] = useState([]);
  const [productData, setProductData] = useState({});
  const [vendors, setVendors] = useState([]);
  const todayChunk = new Date().toISOString().slice(2, 10).replace(/-/g, "");
  const [editingSections, setEditingSections] = useState({});
  const [lotEditMode, setLotEditMode] = useState({});
  const [copyFlash, setCopyFlash] = useState({});
  const [labelEditorOpen, setLabelEditorOpen] = useState(false);
  const [selectedEditorElement, setSelectedEditorElement] = useState(null);
  const editorCanvasColRef = useRef(null);
  const [labelDesignDraft, setLabelDesignDraft] = useState(DEFAULT_LABEL_DESIGN);
  const [labelEditorMode, setLabelEditorMode] = useState("vial");
  const [labelEditorProductKey, setLabelEditorProductKey] = useState(null);
  // Per-product live drafts for the always-interactive preview canvas
  // { [productKey_vial|productKey_kit]: design }
  const [labelDrafts, setLabelDrafts] = useState({});
  // Which drafts have unsaved changes
  const [labelDraftDirty, setLabelDraftDirty] = useState({});
  // Which previews show drag handles (reposition mode)
  // Per-lot label override editor
  const [lotLabelEditorOpen, setLotLabelEditorOpen] = useState(false);
  const [lotLabelEditorProductKey, setLotLabelEditorProductKey] = useState(null);
  const [lotLabelEditorLotIndex, setLotLabelEditorLotIndex] = useState(null);
  const [lotLabelDraft, setLotLabelDraft] = useState({ customTexts: [] });
  const [previewLotSelection, setPreviewLotSelection] = useState({});
  const [editLotModal, setEditLotModal] = useState({ productKey: null, index: null, lot: "", capColor: "", capShade: "", kits: "", vendor: "", note: "" });
  const [editProductModal, setEditProductModal] = useState({ open: false, docId: null, id: "", product: "" });
  const [selectedProductId, setSelectedProductId] = useState(null);
  const [allLotsOpen, setAllLotsOpen] = useState(false);
  const [pdfGenerating, setPdfGenerating] = useState(false);
  const [testingQueue, setTestingQueue] = useState([]);
  const [testingFormOpen, setTestingFormOpen] = useState(false);
  const TESTING_CONTACTS = [
    { name: "Colton Teefy",  phone: "404-630-0071" },
    { name: "Daniel Mata",   phone: "480-695-5048" },
  ];
  const [testingContact, setTestingContact] = useState({
    company: "Coffee and Peppers",
    contact: "Colton Teefy",
    phone: "404-630-0071",
    email: "coffeepepp@gmail.com",
    emailOptIn: false,
  });
  const [testingFormOptions, setTestingFormOptions] = useState({ combineCoa: true, comments: "" });
  const [testingGlobalTests, setTestingGlobalTests] = useState({ purityId: true, netPeptide: true, endotoxins: true, sterility: true, conformityTest: true, vialPhoto: true, fentanyl: true });
  const [vendorFilter, setVendorFilter] = useState(() => vendorGuest || "");
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

  const allVendors = useMemo(() => {
    const set = new Set();
    Object.values(productData).forEach((d) => {
      (d.coaList || []).forEach((c) => { if (c.vendor) set.add(c.vendor); });
    });
    return [...set].sort();
  }, [productData]);

  // Lock vendorFilter when signed in as a vendor guest
  useEffect(() => {
    if (vendorGuest) setVendorFilter(vendorGuest);
  }, [vendorGuest]); // eslint-disable-line react-hooks/exhaustive-deps

  // When the vendor filter changes, auto-select the first product that has lots from that vendor
  useEffect(() => {
    if (!vendorFilter) return;
    const hasLot = (p) =>
      (productData[p.docId]?.coaList || []).some((c) => (c.vendor || "") === vendorFilter);
    if (!hasLot(products.find((p) => p.docId === selectedProductId) || {})) {
      const first = products.find(hasLot);
      if (first) setSelectedProductId(first.docId);
    }
  }, [vendorFilter]); // eslint-disable-line react-hooks/exhaustive-deps

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
  const saveProductInfo = async () => {
    const { docId, id, product } = editProductModal;
    if (!docId || !product.trim()) return;
    try {
      await updateDoc(doc(db, "c&pProductList", docId), { id: id.trim(), product: product.trim() });
      setProducts((prev) => prev.map((p) => p.docId === docId ? { ...p, id: id.trim(), product: product.trim() } : p));
      setEditProductModal({ open: false, docId: null, id: "", product: "" });
    } catch (err) {
      console.error("Error saving product info", err);
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

  // Load vendor profiles (skip for guest users)
  useEffect(() => {
    if (isGuest) return;
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
  }, [isGuest]);

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
              verticalLabelDesign: mergeLabelDesign(data.verticalLabelDesign),
              kitLabelDesign: mergeKitLabelDesign(data.kitLabelDesign),
              testLabelDesign: mergeLabelDesign(data.testLabelDesign),
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
              verticalLabelDesign: mergeLabelDesign(p.verticalLabelDesign),
              kitLabelDesign: mergeKitLabelDesign(p.kitLabelDesign),
              testLabelDesign: mergeLabelDesign(p.testLabelDesign),
            };
            return acc;
          }, {});
          setProductData(mapped);
          // Seed drafts for any products not yet in labelDrafts
          setLabelDrafts((prev) => {
            const next = { ...prev };
            Object.entries(mapped).forEach(([key, d]) => {
              if (!next[`${key}_vial`]) next[`${key}_vial`] = d.verticalLabelDesign;
              if (!next[`${key}_kit`])  next[`${key}_kit`]  = d.kitLabelDesign;
            });
            return next;
          });
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
  const deleteEditLotModal = () => {
    const { productKey, index, lot } = editLotModal;
    if (productKey === null || index === null) return;
    const confirmed = window.confirm(
      `Delete lot ${lot || "this lot"}? This cannot be undone.`
    );
    if (!confirmed) return;
    setProductData((prev) => {
      const currentList = [...(prev[productKey]?.coaList || [])];
      if (!currentList[index]) return prev;
      currentList.splice(index, 1);
      handleSaveCoaList(productKey, currentList);
      return {
        ...prev,
        [productKey]: { ...(prev[productKey] || {}), coaList: currentList },
      };
    });
    setPreviewLotSelection((prev) => {
      if (!prev[productKey] || prev[productKey] !== lot) return prev;
      const next = { ...prev };
      delete next[productKey];
      return next;
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
      capShade: capSeed ? colorValueToHex(capSeed) : "",
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
    const baseDesign = productData[product.docId]?.verticalLabelDesign || DEFAULT_LABEL_DESIGN;
    const markup = buildLabelPrintMarkup({
      productId: productData[product.docId]?.productID || product.id || "",
      productName: product.product || "",
      strength: product.strength || "",
      lot: lotEntry.lot,
      capColor: getCapRenderColor(lotEntry.capColor, lotEntry.capShade),
      design: mergeLotOverride(baseDesign, lotEntry.labelOverride),
    });
    printWindow.document.open();
    printWindow.document.write(markup);
    printWindow.document.close();
  };
  const handlePrintKitLabel = (product, lotEntry) => {
    if (!lotEntry?.lot) return;
    const printWindow = window.open("", "_blank", "width=420,height=720");
    if (!printWindow) return;
    const baseKitDesign = productData[product.docId]?.kitLabelDesign || DEFAULT_KIT_LABEL_DESIGN;
    const markup = buildKitLabelPrintMarkup({
      productId: productData[product.docId]?.productID || product.id || "",
      productName: product.product || "",
      strength: product.strength || "",
      lot: lotEntry.lot,
      capColor: getCapRenderColor(lotEntry.capColor, lotEntry.capShade),
      design: mergeLotOverride(baseKitDesign, lotEntry.labelOverride),
    });
    printWindow.document.open();
    printWindow.document.write(markup);
    printWindow.document.close();
  };

  const addToTestingQueue = (product, coa) => {
    const entryId = `${product.docId}-${coa.lot}`;
    setTestingQueue((prev) => {
      if (prev.some((entry) => entry.id === entryId)) return prev;
      const all = Object.values(testingGlobalTests).every(Boolean);
      return [
        ...prev,
        {
          id: entryId,
          sampleName: product.product || "",
          expectedMg: product.strength || "",
          lotNumber: coa.lot || "",
          selectAll: all,
          ...testingGlobalTests,
        },
      ];
    });
    setTestingFormOpen(true);
  };

  const updateGlobalTest = (field, value) => {
    setTestingGlobalTests((prev) => {
      const next = { ...prev, [field]: value };
      const all = Object.values(next).every(Boolean);
      setTestingQueue((q) => q.map((entry) => ({ ...entry, [field]: value, selectAll: all })));
      return next;
    });
  };

  const removeTestingQueueItem = (entryId) => {
    setTestingQueue((prev) => prev.filter((entry) => entry.id !== entryId));
  };

  const updateTestingQueueItem = (entryId, field, value) => {
    setTestingQueue((prev) =>
      prev.map((entry) => {
        if (entry.id !== entryId) return entry;
        const updated = { ...entry, [field]: value };
        if (field === "selectAll") {
          updated.purityId = value;
          updated.netPeptide = value;
          updated.endotoxins = value;
          updated.sterility = value;
          updated.conformityTest = value;
          updated.vialPhoto = value;
        } else if (["purityId", "netPeptide", "endotoxins", "sterility", "conformityTest", "vialPhoto"].includes(field)) {
          updated.selectAll =
            updated.purityId && updated.netPeptide && updated.endotoxins && updated.sterility && updated.conformityTest && updated.vialPhoto;
        }
        return updated;
      })
    );
  };

  const printTestingForm = () => {
    const esc = (value) =>
      String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;");

    const today = new Date().toLocaleDateString("en-US");

    const sigFile = testingContact.contact === "Daniel Mata" ? "danielsignature.png" : "coltonsignature.png";
    const sigUrl = `${window.location.origin}/assets/${sigFile}`;

    const gt = testingGlobalTests;
    const testOptionRows = [
      { label: "Purity &amp; ID",   price: "$200",      checked: gt.purityId },
      { label: "Net Content",       price: "+$25",      checked: gt.netPeptide },
      { label: "Endotoxins",        price: "$175",      checked: gt.endotoxins },
      { label: "Sterility (PCR)",   price: "$150",      checked: gt.sterility },
      { label: "Conformity Test",   price: "+$50/vial", checked: gt.conformityTest },
      { label: "Vial Photo",        price: "No Fee",    checked: gt.vialPhoto },
    ].map(({ label, price, checked }) => `
      <div class="tp-opt-col${checked ? " tp-opt-col-checked" : ""}">
        <div class="tp-opt-col-name">${label}<span class="tp-opt-price">${price}</span></div>
        <span class="tp-box${checked ? " tp-checked" : ""}">${checked ? "&#10003;" : ""}</span>
      </div>
    `).join("");

    const sampleRows = testingQueue.map((entry, i) => `
      <tr>
        <td class="tp-num">${i + 1}</td>
        <td class="tp-info">${esc(entry.sampleName)}</td>
        <td class="tp-info tp-center">${esc(entry.expectedMg)}</td>
        <td class="tp-info tp-lot">${esc(entry.lotNumber)}</td>
      </tr>
    `).join("");

    const html = `<!DOCTYPE html>
<html>
  <head>
    <title>Testing Form</title>
    <style>
      @page { size: 4in auto; margin: 0; }
      html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      html, body { margin: 0; padding: 0; width: 4in; background: #fff; font-family: Arial, sans-serif; }
      #label { width: 4in; min-height: 6in; padding: 0.12in; box-sizing: border-box; font-family: Arial, sans-serif; color: #1a1a1a; display: flex; flex-direction: column; }
      .tp-footer { margin-top: auto; padding-top: 8pt; }
      .tp-sub-info { display: grid; grid-template-columns: 1.1in 1fr; gap: 0; margin-bottom: 4px; background: #f3f5f8; border: 1px solid #c8d0da; }
      .tp-sub-logo { display: flex; align-items: center; justify-content: center; padding: 6pt 5pt; border-right: 1px solid #c8d0da; }
      .tp-logo { max-width: 1in; max-height: 30pt; display: block; object-fit: contain; }
      .tp-sub-details { padding: 5pt 7pt; display: flex; flex-direction: column; gap: 4pt; }
      .tp-sub-2col { display: grid; grid-template-columns: 1fr 1fr; gap: 0 8pt; }
      .tp-sub-field { display: flex; flex-direction: column; gap: 1px; }
      .tp-sub-label { font-size: 5pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #5a6a7a; }
      .tp-sub-value { font-size: 7.5pt; font-weight: 700; color: #1a2535; border-bottom: 1px solid #aab4c0; padding-bottom: 1px; }
      .tp-combine { font-size: 6.5pt; margin: 2px 0 4px; display: flex; align-items: center; gap: 4px; }
      .tp-combine-box { width: 9pt; height: 9pt; border: 2px solid #394450; display: inline-flex; align-items: center; justify-content: center; font-size: 7pt; font-weight: 700; flex-shrink: 0; }
      .tp-body { display: flex; flex-direction: column; gap: 5pt; }
      .tp-opt-section { border: 1px solid #b9c4d2; }
      .tp-opt-header { background: #0c365b; color: #fff; font-weight: 700; font-size: 6pt; padding: 2px 4px; text-transform: uppercase; letter-spacing: 0.04em; }
      .tp-opt-grid { display: grid; grid-template-columns: repeat(7, 1fr); }
      .tp-opt-col { display: grid; grid-template-rows: 1fr auto; align-items: end; justify-items: center; text-align: center; padding: 2pt 1pt; border-right: 1px solid #d0d7e0; gap: 2pt; }
      .tp-opt-col:last-child { border-right: none; }
      .tp-opt-col-checked { background: #eef3fb; }
      .tp-opt-fentanyl { background: #f7f8fa; border-left: 2px solid #0c365b; }
      .tp-opt-col-name { font-size: 6.5pt; font-weight: 700; line-height: 1.2; color: #1e2d3b; }
      .tp-opt-price { display: block; font-size: 5.5pt; font-weight: 600; color: #2a3a47; margin-top: 1pt; }
      .tp-box { width: 8pt; height: 8pt; display: inline-flex; align-items: center; justify-content: center; border: 2px solid #5a6a7a; background: #fff; font-size: 6pt; font-weight: 900; color: #1a2535; }
      .tp-checked { background: #d5deea; }
      .tp-samples { width: 100%; border-collapse: collapse; table-layout: fixed; }
      .tp-samples thead th { background: #0c365b; color: #fff; font-weight: 700; border: 1px solid #1a4d72; padding: 3px 4px; font-size: 6.5pt; text-align: center; }
      .tp-samples thead th.left { text-align: left; }
      .tp-samples td { border: 1px solid #c2c7cf; padding: 2px 4px; height: 16pt; vertical-align: middle; font-size: 8pt; font-weight: 700; }
      .tp-num { text-align: center; background: #eef3fb; width: 8%; }
      .tp-info { background: #d5deea; }
      .tp-center { text-align: center; }
      .tp-lot { font-size: 6pt; white-space: nowrap; }
      .tp-footer { display: grid; grid-template-columns: 1fr 1fr; gap: 8pt; align-items: start; }
      .tp-comments-label { font-size: 6.5pt; font-weight: 700; margin-bottom: 2px; }
      .tp-comments-box { min-height: 30pt; background: #d5deea; border: 1px solid #b9c4d2; padding: 2px 3px; font-size: 6.5pt; word-break: break-word; }
      .tp-ack-title { font-size: 6.5pt; font-weight: 700; margin-bottom: 2px; }
      .tp-ack-copy { font-size: 4.5pt; line-height: 1.25; margin-bottom: 6pt; }
      .tp-sig-block { display: flex; flex-direction: column; gap: 6pt; }
      .tp-sig-row { display: flex; align-items: flex-end; gap: 4pt; font-size: 6.5pt; white-space: nowrap; }
      .tp-sig-line { flex: 1; border-bottom: 1.5px solid #444; min-height: 26pt; display: flex; align-items: flex-end; padding-bottom: 1pt; }
      .tp-sig-img { max-height: 22pt; max-width: 1.2in; display: block; }
      .tp-date-line { flex: 1; border-bottom: 1.5px solid #444; min-height: 14pt; display: flex; align-items: flex-end; padding-bottom: 1pt; }
      .tp-date-fill { background: #d5deea; padding: 1px 4px; font-size: 7pt; font-weight: 700; }
      .tp-logo { max-height: 30pt; max-width: 1.4in; display: block; }
    </style>
  </head>
  <body>
    <div id="label">
      <div class="tp-sub-info">
        <div class="tp-sub-logo">
          <img class="tp-logo" src="${window.location.origin}/assets/labelLogo.png" />
        </div>
        <div class="tp-sub-details">
          <div class="tp-sub-field">
            <span class="tp-sub-label">Contact Person</span>
            <span class="tp-sub-value">${esc(testingContact.contact)}</span>
          </div>
          <div class="tp-sub-2col">
            <div class="tp-sub-field">
              <span class="tp-sub-label">Phone</span>
              <span class="tp-sub-value">${esc(testingContact.phone)}</span>
            </div>
            <div class="tp-sub-field">
              <span class="tp-sub-label">Email</span>
              <span class="tp-sub-value">${esc(testingContact.email)}</span>
            </div>
          </div>
        </div>
      </div>
      <div class="tp-combine">
        <span class="tp-combine-box">${testingFormOptions.combineCoa ? "&#10003;" : ""}</span>
        Combine test results to display on one CoA per sample.
      </div>
      <div class="tp-body">
        <div class="tp-opt-section">
          <div class="tp-opt-header">Testing Options</div>
          <div class="tp-opt-grid">
            ${testOptionRows}
            <div class="tp-opt-col tp-opt-fentanyl${gt.fentanyl ? " tp-opt-col-checked" : ""}">
              <div class="tp-opt-col-name">Fentanyl Screen<span class="tp-opt-price">$40</span></div>
              <span class="tp-box${gt.fentanyl ? " tp-checked" : ""}">${gt.fentanyl ? "&#10003;" : ""}</span>
            </div>
          </div>
        </div>
        <table class="tp-samples">
          <thead>
            <tr>
              <th style="width:6%;">#</th>
              <th class="left" style="width:36%;">Sample Name / ID</th>
              <th style="width:14%;">mg</th>
              <th class="left" style="width:44%;">Lot Number</th>
            </tr>
          </thead>
          <tbody>${sampleRows}</tbody>
        </table>
      </div>
      <div class="tp-footer">
        <div>
          <div class="tp-comments-label">Comments:</div>
          <div class="tp-comments-box">${esc(testingFormOptions.comments)}</div>
        </div>
        <div>
          <div class="tp-ack-title">Acknowledgment</div>
          <div class="tp-ack-copy">By signing below, you confirm that all information provided is accurate to the best of your knowledge, you also acknowledge that the sample(s) comply with all applicable regulations for transportation and handling. All sample testing services are for research use only.</div>
          <div class="tp-sig-block">
            <div class="tp-sig-row">Sig:&nbsp;<span class="tp-sig-line"><img class="tp-sig-img" src="${sigUrl}" /></span></div>
            <div class="tp-sig-row">Date:&nbsp;<span class="tp-date-line"><span class="tp-date-fill">${esc(today)}</span></span></div>
          </div>
        </div>
      </div>
    </div>
  </body>
</html>`;

    const iframe = document.createElement("iframe");
    // Give the iframe the exact label dimensions so the browser lays out at the right size
    iframe.style.cssText = "position:fixed;top:-9999px;left:-9999px;width:384px;height:2400px;border:none;visibility:hidden;";
    document.body.appendChild(iframe);
    iframe.contentDocument.open();
    iframe.contentDocument.write(html);
    iframe.contentDocument.close();
    iframe.contentWindow.focus();
    setTimeout(() => {
      iframe.contentWindow.print();
      setTimeout(() => document.body.removeChild(iframe), 2000);
    }, 250);
  };

  const printTestingFormLetter = () => {
    const esc = (value) =>
      String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;");

    const today = new Date().toLocaleDateString("en-US");
    const sigFile = testingContact.contact === "Daniel Mata" ? "danielsignature.png" : "coltonsignature.png";
    const sigUrl = `${window.location.origin}/assets/${sigFile}`;
    const gt = testingGlobalTests;

    const testOptionRows = [
      { label: "Purity &amp; ID",   price: "$200",      checked: gt.purityId },
      { label: "Net Content",       price: "+$25",      checked: gt.netPeptide },
      { label: "Endotoxins",        price: "$175",      checked: gt.endotoxins },
      { label: "Sterility (PCR)",   price: "$150",      checked: gt.sterility },
      { label: "Conformity Test",   price: "+$50/vial", checked: gt.conformityTest },
      { label: "Vial Photo",        price: "No Fee",    checked: gt.vialPhoto },
    ].map(({ label, price, checked }) => `
      <div class="tp-opt-col${checked ? " tp-opt-col-checked" : ""}">
        <div class="tp-opt-col-name">${label}<span class="tp-opt-price">${price}</span></div>
        <span class="tp-box${checked ? " tp-checked" : ""}">${checked ? "&#10003;" : ""}</span>
      </div>
    `).join("");

    const sampleRows = testingQueue.map((entry, i) => `
      <tr>
        <td class="tp-num">${i + 1}</td>
        <td class="tp-info">${esc(entry.sampleName)}</td>
        <td class="tp-info tp-center">${esc(entry.expectedMg)}</td>
        <td class="tp-info tp-lot">${esc(entry.lotNumber)}</td>
      </tr>
    `).join("");

    const html = `<!DOCTYPE html>
<html>
  <head>
    <title>Testing Form</title>
    <style>
      @page { size: 8.5in 11in; margin: 0.65in 0.75in; }
      html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      html, body { margin: 0; padding: 0; background: #fff; font-family: Arial, sans-serif; }
      #label { width: 100%; min-height: 9.7in; box-sizing: border-box; font-family: Arial, sans-serif; color: #1a1a1a; display: flex; flex-direction: column; }
      .tp-footer { margin-top: auto; padding-top: 18pt; }
      .tp-sub-info { display: grid; grid-template-columns: 1.9in 1fr; gap: 0; margin-bottom: 10px; background: #f3f5f8; border: 1px solid #c8d0da; }
      .tp-sub-logo { display: flex; align-items: center; justify-content: center; padding: 10pt 8pt; border-right: 1px solid #c8d0da; }
      .tp-logo { max-width: 1.7in; max-height: 52pt; display: block; object-fit: contain; }
      .tp-sub-details { padding: 9pt 12pt; display: flex; flex-direction: column; gap: 7pt; }
      .tp-sub-2col { display: grid; grid-template-columns: 1fr 1fr; gap: 0 14pt; }
      .tp-sub-field { display: flex; flex-direction: column; gap: 2px; }
      .tp-sub-label { font-size: 8pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #5a6a7a; }
      .tp-sub-value { font-size: 13pt; font-weight: 700; color: #1a2535; border-bottom: 1px solid #aab4c0; padding-bottom: 2px; }
      .tp-combine { font-size: 11pt; margin: 4px 0 8px; display: flex; align-items: center; gap: 7px; }
      .tp-combine-box { width: 15pt; height: 15pt; border: 2px solid #394450; display: inline-flex; align-items: center; justify-content: center; font-size: 12pt; font-weight: 700; flex-shrink: 0; }
      .tp-body { display: flex; flex-direction: column; gap: 10pt; }
      .tp-opt-section { border: 1px solid #b9c4d2; }
      .tp-opt-header { background: #0c365b; color: #fff; font-weight: 700; font-size: 10pt; padding: 4px 8px; text-transform: uppercase; letter-spacing: 0.04em; }
      .tp-opt-grid { display: grid; grid-template-columns: repeat(7, 1fr); }
      .tp-opt-col { display: grid; grid-template-rows: 1fr auto; align-items: end; justify-items: center; text-align: center; padding: 5pt 3pt; border-right: 1px solid #d0d7e0; gap: 4pt; }
      .tp-opt-col:last-child { border-right: none; }
      .tp-opt-col-checked { background: #eef3fb; }
      .tp-opt-fentanyl { background: #f7f8fa; border-left: 2px solid #0c365b; }
      .tp-opt-col-name { font-size: 11pt; font-weight: 700; line-height: 1.2; color: #1e2d3b; }
      .tp-opt-price { display: block; font-size: 9pt; font-weight: 600; color: #2a3a47; margin-top: 2pt; }
      .tp-box { width: 14pt; height: 14pt; display: inline-flex; align-items: center; justify-content: center; border: 2px solid #5a6a7a; background: #fff; font-size: 11pt; font-weight: 900; color: #1a2535; }
      .tp-checked { background: #d5deea; }
      .tp-samples { width: 100%; border-collapse: collapse; table-layout: fixed; }
      .tp-samples thead th { background: #0c365b; color: #fff; font-weight: 700; border: 1px solid #1a4d72; padding: 5px 7px; font-size: 11pt; text-align: center; }
      .tp-samples thead th.left { text-align: left; }
      .tp-samples td { border: 1px solid #c2c7cf; padding: 4px 7px; height: 26pt; vertical-align: middle; font-size: 13pt; font-weight: 700; }
      .tp-num { text-align: center; background: #eef3fb; width: 6%; }
      .tp-info { background: #d5deea; }
      .tp-center { text-align: center; }
      .tp-lot { font-size: 10pt; white-space: nowrap; }
      .tp-footer { display: grid; grid-template-columns: 1fr 1fr; gap: 16pt; align-items: start; }
      .tp-comments-label { font-size: 11pt; font-weight: 700; margin-bottom: 4px; }
      .tp-comments-box { min-height: 54pt; background: #d5deea; border: 1px solid #b9c4d2; padding: 4px 6px; font-size: 11pt; word-break: break-word; }
      .tp-ack-title { font-size: 11pt; font-weight: 700; margin-bottom: 4px; }
      .tp-ack-copy { font-size: 8pt; line-height: 1.35; margin-bottom: 10pt; }
      .tp-sig-block { display: flex; flex-direction: column; gap: 10pt; }
      .tp-sig-row { display: flex; align-items: flex-end; gap: 7pt; font-size: 11pt; white-space: nowrap; }
      .tp-sig-line { flex: 1; border-bottom: 1.5px solid #444; min-height: 44pt; display: flex; align-items: flex-end; padding-bottom: 2pt; }
      .tp-sig-img { max-height: 38pt; max-width: 2.2in; display: block; }
      .tp-date-line { flex: 1; border-bottom: 1.5px solid #444; min-height: 22pt; display: flex; align-items: flex-end; padding-bottom: 2pt; }
      .tp-date-fill { background: #d5deea; padding: 2px 6px; font-size: 12pt; font-weight: 700; }
    </style>
  </head>
  <body>
    <div id="label">
      <div class="tp-sub-info">
        <div class="tp-sub-logo">
          <img class="tp-logo" src="${window.location.origin}/assets/labelLogo.png" />
        </div>
        <div class="tp-sub-details">
          <div class="tp-sub-field">
            <span class="tp-sub-label">Contact Person</span>
            <span class="tp-sub-value">${esc(testingContact.contact)}</span>
          </div>
          <div class="tp-sub-2col">
            <div class="tp-sub-field">
              <span class="tp-sub-label">Phone</span>
              <span class="tp-sub-value">${esc(testingContact.phone)}</span>
            </div>
            <div class="tp-sub-field">
              <span class="tp-sub-label">Email</span>
              <span class="tp-sub-value">${esc(testingContact.email)}</span>
            </div>
          </div>
        </div>
      </div>
      <div class="tp-combine">
        <span class="tp-combine-box">${testingFormOptions.combineCoa ? "&#10003;" : ""}</span>
        Combine test results to display on one CoA per sample.
      </div>
      <div class="tp-body">
        <div class="tp-opt-section">
          <div class="tp-opt-header">Testing Options</div>
          <div class="tp-opt-grid">
            ${testOptionRows}
            <div class="tp-opt-col tp-opt-fentanyl${gt.fentanyl ? " tp-opt-col-checked" : ""}">
              <div class="tp-opt-col-name">Fentanyl Screen<span class="tp-opt-price">$40</span></div>
              <span class="tp-box${gt.fentanyl ? " tp-checked" : ""}">${gt.fentanyl ? "&#10003;" : ""}</span>
            </div>
          </div>
        </div>
        <table class="tp-samples">
          <thead>
            <tr>
              <th style="width:6%;">#</th>
              <th class="left" style="width:36%;">Sample Name / ID</th>
              <th style="width:14%;">mg</th>
              <th class="left" style="width:44%;">Lot Number</th>
            </tr>
          </thead>
          <tbody>${sampleRows}</tbody>
        </table>
      </div>
      <div class="tp-footer">
        <div>
          <div class="tp-comments-label">Comments:</div>
          <div class="tp-comments-box">${esc(testingFormOptions.comments)}</div>
        </div>
        <div>
          <div class="tp-ack-title">Acknowledgment</div>
          <div class="tp-ack-copy">By signing below, you confirm that all information provided is accurate to the best of your knowledge, you also acknowledge that the sample(s) comply with all applicable regulations for transportation and handling. All sample testing services are for research use only.</div>
          <div class="tp-sig-block">
            <div class="tp-sig-row">Sig:&nbsp;<span class="tp-sig-line"><img class="tp-sig-img" src="${sigUrl}" /></span></div>
            <div class="tp-sig-row">Date:&nbsp;<span class="tp-date-line"><span class="tp-date-fill">${esc(today)}</span></span></div>
          </div>
        </div>
      </div>
    </div>
  </body>
</html>`;

    const iframe = document.createElement("iframe");
    iframe.style.cssText = "position:fixed;top:-9999px;left:-9999px;width:816px;height:1056px;border:none;visibility:hidden;";
    document.body.appendChild(iframe);
    iframe.contentDocument.open();
    iframe.contentDocument.write(html);
    iframe.contentDocument.close();
    iframe.contentWindow.focus();
    setTimeout(() => {
      iframe.contentWindow.print();
      setTimeout(() => document.body.removeChild(iframe), 2000);
    }, 250);
  };

  const handlePrintAllVialLabels = async () => {
    const labelEntries = products
      .filter((p) => !/^test$/i.test((p.id || p.product || "").trim()))
      .flatMap((p) => {
        const data = productData[p.docId];
        const lots = (data?.coaList || []).filter(
          (c) => !vendorFilter || (c.vendor || "") === vendorFilter
        );
        return lots.map((lot) => ({
          productName: p.product || "",
          strength: p.strength || "",
          lot: lot.lot,
          capColor: getCapRenderColor(lot.capColor, lot.capShade),
          design: data?.verticalLabelDesign || DEFAULT_LABEL_DESIGN,
        }));
      })
      .filter((e) => e.lot);

    if (!labelEntries.length) {
      alert("No products with lots found.");
      return;
    }

    setPdfGenerating(true);
    try {
      const [{ jsPDF }, { default: html2canvas }] = await Promise.all([
        import('jspdf'),
        import('html2canvas'),
      ]);

      const W = LABEL_PREVIEW_WIDTH;
      const H = LABEL_PREVIEW_HEIGHT;
      const CAPTURE_SCALE = 3;

      const captureContainer = document.createElement('div');
      Object.assign(captureContainer.style, {
        position: 'fixed',
        top: '0',
        left: '-9999px',
        width: `${W}px`,
        height: `${H}px`,
        overflow: 'visible',
        pointerEvents: 'none',
        zIndex: '99999',
      });
      document.body.appendChild(captureContainer);

      const pdf = new jsPDF({ unit: 'px', format: [W, H], hotfixes: ['px_scaling'] });
      let isFirst = true;

      for (const entry of labelEntries) {
        const labelEl = createLabelDomForCapture(entry);
        captureContainer.appendChild(labelEl);

        const imgs = [...captureContainer.querySelectorAll('img')];
        await Promise.all(
          imgs.map(
            (img) =>
              new Promise((resolve) => {
                if (img.complete && img.naturalWidth) resolve();
                else { img.onload = resolve; img.onerror = resolve; }
              })
          )
        );

        const canvas = await html2canvas(labelEl, {
          scale: CAPTURE_SCALE,
          useCORS: true,
          allowTaint: false,
          backgroundColor: '#ffffff',
          logging: false,
          width: W,
          height: H,
          windowWidth: W,
          windowHeight: H,
        });

        if (!isFirst) pdf.addPage([W, H], 'p');
        isFirst = false;
        pdf.addImage(canvas.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, W, H);
        captureContainer.removeChild(labelEl);
      }

      document.body.removeChild(captureContainer);
      pdf.save(`vial-labels-${vendorFilter ? `${vendorFilter}-` : ""}${new Date().toISOString().slice(0, 10)}.pdf`);
    } finally {
      setPdfGenerating(false);
    }
  };

  const handlePrintAllTestLabels = (product, lotEntry) => {
    if (!lotEntry?.lot) return;
    const printWindow = window.open("", "_blank", "width=420,height=320");
    if (!printWindow) return;
    const markup = buildTestLabelsPrintMarkup({
      productName: product.product || "",
      strength: product.strength || "",
      lot: lotEntry.lot,
      capColor: getCapRenderColor(lotEntry.capColor, lotEntry.capShade),
      design: productData[product.docId]?.testLabelDesign ?? DEFAULT_LABEL_DESIGN,
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

  // Arrow-key nudge when editor is open and an element is selected
  useEffect(() => {
    if (!labelEditorOpen || !selectedEditorElement) return;
    const elements = labelEditorMode === "kit" ? KIT_DRAG_ELEMENTS : VIAL_DRAG_ELEMENTS;
    const el = elements.find((e) => e.id === selectedEditorElement);
    if (!el) return;

    const onKeyDown = (e) => {
      const arrowKeys = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"];
      if (!arrowKeys.includes(e.key)) return;
      // Only hijack when not typing in an input/textarea
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      const xMode = el.xMode || "left";
      const yMode = el.yMode || "top";

      setLabelDesignDraft((prev) => {
        const updated = { ...prev };
        if (e.key === "ArrowLeft") {
          updated[el.xField] = Math.max(0, (prev[el.xField] ?? 0) - (xMode === "right" ? -step : step));
        } else if (e.key === "ArrowRight") {
          updated[el.xField] = Math.max(0, (prev[el.xField] ?? 0) + (xMode === "right" ? -step : step));
        } else if (e.key === "ArrowUp") {
          updated[el.yField] = Math.max(0, (prev[el.yField] ?? 0) - (yMode === "bottom" ? -step : step));
        } else if (e.key === "ArrowDown") {
          updated[el.yField] = Math.max(0, (prev[el.yField] ?? 0) + (yMode === "bottom" ? -step : step));
        }
        return updated;
      });
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [labelEditorOpen, selectedEditorElement, labelEditorMode]);

  const openLabelEditor = (productKey, mode = "vial") => {
    setLabelEditorMode(mode);
    setLabelEditorProductKey(productKey);
    setLabelDesignDraft(
      mode === "kit"
        ? mergeKitLabelDesign(productData[productKey]?.kitLabelDesign)
        : mode === "test"
          ? mergeLabelDesign(productData[productKey]?.testLabelDesign)
          : mergeLabelDesign(productData[productKey]?.verticalLabelDesign)
    );
    setLabelEditorOpen(true);
    setSelectedEditorElement(null);
  };

  const getDraft = (productKey, mode) => {
    const draftKey = `${productKey}_${mode}`;
    if (labelDrafts[draftKey]) return labelDrafts[draftKey];
    return mode === "kit"
      ? mergeKitLabelDesign(productData[productKey]?.kitLabelDesign)
      : mergeLabelDesign(productData[productKey]?.verticalLabelDesign);
  };

  const updateDraft = (productKey, mode, field, value) => {
    const draftKey = `${productKey}_${mode}`;
    setLabelDrafts((prev) => ({ ...prev, [draftKey]: { ...getDraft(productKey, mode), [field]: value } }));
    setLabelDraftDirty((prev) => ({ ...prev, [draftKey]: true }));
  };

  const saveDraft = async (productKey, mode) => {
    const draftKey = `${productKey}_${mode}`;
    const fieldName = mode === "kit" ? "kitLabelDesign" : "verticalLabelDesign";
    const draft = getDraft(productKey, mode);
    const nextDesign = mode === "kit" ? mergeKitLabelDesign(draft) : mergeLabelDesign(draft);
    setProductData((prev) => ({ ...prev, [productKey]: { ...prev[productKey], [fieldName]: nextDesign } }));
    setLabelDraftDirty((prev) => ({ ...prev, [draftKey]: false }));
    await updateDoc(doc(db, "c&pProductList", productKey), { [fieldName]: nextDesign });
  };

  const cancelDraft = (productKey, mode) => {
    const draftKey = `${productKey}_${mode}`;
    const saved = mode === "kit"
      ? mergeKitLabelDesign(productData[productKey]?.kitLabelDesign)
      : mergeLabelDesign(productData[productKey]?.verticalLabelDesign);
    setLabelDrafts((prev) => ({ ...prev, [draftKey]: saved }));
    setLabelDraftDirty((prev) => ({ ...prev, [draftKey]: false }));
  };

  const openLotLabelEditor = (productKey, lotRealIndex, coa) => {
    setLotLabelEditorProductKey(productKey);
    setLotLabelEditorLotIndex(lotRealIndex);
    setLotLabelDraft(JSON.parse(JSON.stringify(coa.labelOverride || { customTexts: [] })));
    setLotLabelEditorOpen(true);
  };

  const saveLotLabelOverride = async () => {
    const key = lotLabelEditorProductKey;
    const idx = lotLabelEditorLotIndex;
    const updatedList = [...(productData[key]?.coaList || [])];
    updatedList[idx] = { ...updatedList[idx], labelOverride: lotLabelDraft };
    setProductData((prev) => ({ ...prev, [key]: { ...prev[key], coaList: updatedList } }));
    await handleSaveCoaList(key, updatedList);
    setLotLabelEditorOpen(false);
  };

  const saveLabelDesign = async () => {
    if (!labelEditorProductKey) {
      console.warn("saveLabelDesign: no labelEditorProductKey set");
      return;
    }
    const nextDesign =
      labelEditorMode === "kit"
        ? mergeKitLabelDesign(labelDesignDraft)
        : labelEditorMode === "test"
          ? mergeLabelDesign(labelDesignDraft)
          : mergeLabelDesign(labelDesignDraft);
    const fieldName =
      labelEditorMode === "kit"
        ? "kitLabelDesign"
        : labelEditorMode === "test"
          ? "testLabelDesign"
          : "verticalLabelDesign";
    const localKey =
      labelEditorMode === "kit"
        ? "kitLabelDesign"
        : labelEditorMode === "test"
          ? "testLabelDesign"
          : "verticalLabelDesign";
    console.log("saveLabelDesign →", { labelEditorProductKey, fieldName, nextDesign });
    setProductData((prev) => ({
      ...prev,
      [labelEditorProductKey]: {
        ...prev[labelEditorProductKey],
        [localKey]: nextDesign,
      },
    }));
    try {
      await updateDoc(doc(db, "c&pProductList", labelEditorProductKey), { [fieldName]: nextDesign });
      console.log("saveLabelDesign: Firestore write succeeded");
    } catch (err) {
      console.error("saveLabelDesign: Firestore write FAILED", err);
      alert(`Save failed: ${err.message}`);
    }
    setLabelEditorOpen(false);
  };

  const renderLabelPreview = (product, lotEntry, designStyles, rawDesign) => {
    const effectiveDesign = mergeLotOverride(rawDesign || {}, lotEntry?.labelOverride);
    const effectiveStyles = buildLabelDesignStyles(mergeLabelDesign(effectiveDesign));
    const capColor = normalizeLabelAccentColor(getCapRenderColor(lotEntry.capColor, lotEntry.capShade));
    const strengthBg = effectiveDesign?.strengthBgColor === "none" ? "transparent" : (effectiveDesign?.strengthBgColor || capColor);
    return (
      <div
        className="lot-id-print-label"
        style={{ background: "linear-gradient(180deg, #f3f4f6 0%, #e9ebef 100%)" }}
      >
        <img src={LABEL_BACKGROUND_IMAGE} alt="" className="lot-id-print-label-bg" />
        {effectiveDesign?.showGradient !== false && (
          <div className="lot-id-print-label-tint" style={{ background: buildLabelBackground(capColor) }} />
        )}
        <div className="lot-id-print-label-lot" style={effectiveStyles.lot}>{lotEntry.lot}</div>
        <div className="lot-id-print-label-name" style={{ position: "absolute", left: effectiveDesign.nameLeft ?? 88, top: effectiveDesign.nameTop ?? 210, transform: `translate(-50%, -50%) rotate(${effectiveDesign.stackRotate ?? -90}deg)`, fontSize: effectiveStyles.name.fontSize, lineHeight: effectiveStyles.name.lineHeight, color: effectiveStyles.name.color, fontWeight: effectiveStyles.name.fontWeight, letterSpacing: effectiveStyles.name.letterSpacing, textTransform: effectiveStyles.name.textTransform, textAlign: effectiveStyles.name.textAlign, whiteSpace: "nowrap" }}>{renderLabelProductName(product.product)}</div>
        <div className="lot-id-print-label-strength" style={{ position: "absolute", left: effectiveDesign.strengthLeft ?? 124, top: effectiveDesign.strengthTop ?? 210, transform: `translate(-50%, -50%) rotate(${effectiveDesign.stackRotate ?? -90}deg)`, display: "inline-flex", alignItems: "center", justifyContent: "center", backgroundColor: strengthBg, fontSize: effectiveStyles.strength.fontSize, padding: effectiveStyles.strength.padding, borderRadius: effectiveStyles.strength.borderRadius, color: effectiveStyles.strength.color, fontWeight: effectiveStyles.strength.fontWeight, letterSpacing: effectiveStyles.strength.letterSpacing, lineHeight: 1, whiteSpace: "nowrap" }}>{product.strength}</div>
        {(effectiveDesign?.customTexts || []).map((ct) => (
          <div key={ct.id} style={{ position: "absolute", left: ct.left, top: ct.top, fontSize: ct.fontSize || 12, fontWeight: ct.fontWeight || 400, color: ct.color || "#ffffff", transform: `rotate(${ct.rotate || 0}deg)`, letterSpacing: `${ct.letterSpacing || 0}em`, whiteSpace: "pre-wrap", transformOrigin: "left top", lineHeight: 1.2 }}>{ct.text}</div>
        ))}
      </div>
    );
  };
  const renderKitLabelPreview = (product, lotEntry, designStyles, rawDesign) => {
    const effectiveDesign = mergeLotOverride(rawDesign || {}, lotEntry?.labelOverride);
    const effectiveKitStyles = buildKitLabelDesignStyles(mergeKitLabelDesign(effectiveDesign));
    const capColor = normalizeLabelAccentColor(getCapRenderColor(lotEntry.capColor, lotEntry.capShade));
    const strengthBg = effectiveDesign?.strengthBgColor === "none" ? "transparent" : (effectiveDesign?.strengthBgColor || capColor);
    return (
      <div className="lot-id-print-label-kit">
        <img src={LABEL_BACKGROUND_IMAGE} alt="" className="lot-id-print-label-bg" />
        <div className="lot-id-print-label-kit-fade" style={{ ...effectiveKitStyles.fade, background: buildKitLabelFade(capColor) }} />
        <div className="lot-id-print-label-kit-lot" style={effectiveKitStyles.lot}>{lotEntry.lot}</div>
        <div className="lot-id-print-label-kit-product" style={effectiveKitStyles.product}>{renderLabelProductName(product.product)}</div>
        <div className="lot-id-print-label-kit-strength-group" style={{ left: effectiveKitStyles.strength.left, bottom: effectiveKitStyles.strength.bottom }}>
          <div className="lot-id-print-label-kit-strength" style={{ fontSize: effectiveKitStyles.strength.fontSize, padding: effectiveKitStyles.strength.padding, borderRadius: effectiveKitStyles.strength.borderRadius, backgroundColor: strengthBg, color: effectiveKitStyles.strength.color, fontWeight: effectiveKitStyles.strength.fontWeight, letterSpacing: effectiveKitStyles.strength.letterSpacing }}>{product.strength}</div>
          <div className="lot-id-print-label-kit-count" style={{ fontSize: effectiveKitStyles.strength.fontSize }}>10 Vials</div>
        </div>
        {(effectiveDesign?.customTexts || []).map((ct) => (
          <div key={ct.id} style={{ position: "absolute", left: ct.left, top: ct.top, fontSize: ct.fontSize || 12, fontWeight: ct.fontWeight || 400, color: ct.color || "#ffffff", transform: `rotate(${ct.rotate || 0}deg)`, letterSpacing: `${ct.letterSpacing || 0}em`, whiteSpace: "pre-wrap", transformOrigin: "left top", lineHeight: 1.2 }}>{ct.text}</div>
        ))}
      </div>
    );
  };
  const renderTestLabelPreview = (product, lotEntry, designStyles, variantText, design) => (
    <div
      className="lot-id-print-label lot-id-print-label-test"
      style={{ background: "linear-gradient(180deg, #f3f4f6 0%, #e9ebef 100%)" }}
    >
      <img src={LABEL_BACKGROUND_IMAGE} alt="" className="lot-id-print-label-bg" />
      <div
        className="lot-id-print-label-tint"
        style={{ background: buildLabelBackground(getCapRenderColor(lotEntry.capColor, lotEntry.capShade)) }}
      />
      <div className="lot-id-print-label-lot" style={designStyles.lot}>
        {lotEntry.lot}
      </div>
      <div className="lot-id-print-label-name" style={{ position: "absolute", left: design?.nameLeft ?? 88, top: design?.nameTop ?? 210, transform: `translate(-50%, -50%) rotate(${design?.stackRotate ?? -90}deg)`, fontSize: designStyles.name.fontSize, lineHeight: designStyles.name.lineHeight, color: designStyles.name.color, fontWeight: designStyles.name.fontWeight, letterSpacing: designStyles.name.letterSpacing, textTransform: designStyles.name.textTransform, textAlign: designStyles.name.textAlign, whiteSpace: "nowrap" }}>
        {renderLabelProductName(product.product)}
      </div>
      <div className="lot-id-print-label-strength" style={{ position: "absolute", left: design?.strengthLeft ?? 124, top: design?.strengthTop ?? 210, transform: `translate(-50%, -50%) rotate(${design?.stackRotate ?? -90}deg)`, display: "inline-flex", alignItems: "center", justifyContent: "center", backgroundColor: normalizeLabelAccentColor(getCapRenderColor(lotEntry.capColor, lotEntry.capShade)), fontSize: designStyles.strength.fontSize, padding: designStyles.strength.padding, borderRadius: designStyles.strength.borderRadius, color: designStyles.strength.color, fontWeight: designStyles.strength.fontWeight, letterSpacing: designStyles.strength.letterSpacing, lineHeight: 1, whiteSpace: "nowrap" }}>
        {product.strength}
      </div>
      {variantText && (
        <div style={{ position: "absolute", left: design?.strengthLeft ?? 124, top: (design?.strengthTop ?? 210) + (design?.strengthFontSize ?? 22) * 2.5, transform: `translate(-50%, -50%) rotate(${design?.stackRotate ?? -90}deg)`, fontSize: `${design?.variantFontSize ?? 22}px`, fontWeight: 800, color: '#2b1a0f', letterSpacing: '0.08em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
          {variantText}
        </div>
      )}
    </div>
  );

  const selectedProduct = products.find((p) => p.docId === selectedProductId) || null;
  const selectedProductState = selectedProduct ? (productData[selectedProduct.docId] || {
    productID: "",
    currentCOA: createEmptyCOA(),
    coaList: [],
    labelDesign: DEFAULT_LABEL_DESIGN,
    kitLabelDesign: DEFAULT_KIT_LABEL_DESIGN,
    testLabelDesign: DEFAULT_TEST_LABEL_DESIGN,
  }) : null;
  const selectedPreviewLot =
    selectedProductState?.coaList?.find(
      (lot) => lot.lot === previewLotSelection[selectedProductId]
    ) || selectedProductState?.coaList?.[0] || null;
  const editorDesignStyles =
    labelEditorMode === "kit"
      ? buildKitLabelDesignStyles(mergeKitLabelDesign(labelDesignDraft))
      : labelEditorMode === "test"
        ? buildLabelDesignStyles(mergeLabelDesign(labelDesignDraft))
        : buildLabelDesignStyles(mergeLabelDesign(labelDesignDraft));
    const testingDisplayRows = Array.from(
      { length: Math.max(TESTING_TABLE_ROW_COUNT, testingQueue.length) },
      (_, index) => testingQueue[index] || null
    );
    const getLotCellClassName = (lotNumber) => {
      const len = String(lotNumber || "").length;
      if (len > 16) return "lot-testing-lot-cell lot-testing-lot-cell-tight";
      if (len > 12) return "lot-testing-lot-cell lot-testing-lot-cell-compact";
      return "lot-testing-lot-cell";
    };

  return (
    <>
    <div className="lot-id-tracker-container">
      <div className="lot-id-top-bar">
        {vendorGuest && (
          <div className="lot-id-vendor-guest-badge">
            <span className="lot-id-vendor-guest-name">{vendorGuest}</span>
            <span className="lot-id-vendor-guest-count">
              {Object.values(productData).reduce(
                (n, d) => n + (d.coaList || []).filter((c) => (c.vendor || "") === vendorGuest).length,
                0
              )} lots
            </span>
          </div>
        )}
        <button
          className="lot-id-all-lots-btn"
          onClick={() => setAllLotsOpen(true)}
        >
          All Lot IDs
        </button>
        {!isGuest && (
          <button
            className="lot-id-all-lots-btn"
            onClick={handlePrintAllVialLabels}
            disabled={pdfGenerating}
          >
            {pdfGenerating ? 'Generating PDF…' : vendorFilter ? `Download ${vendorFilter} Vial Labels` : 'Download All Vial Labels'}
          </button>
        )}
        {!isGuest && !vendorGuest && (
          <button
            type="button"
            className="lot-id-testing-queue-btn"
            onClick={() => setTestingFormOpen(true)}
          >
            Testing Queue
            {testingQueue.length > 0 && (
              <span className="lot-id-testing-queue-badge">{testingQueue.length}</span>
            )}
          </button>
        )}
      </div>
      {!isGuest && !vendorGuest && allVendors.length > 0 && (
        <div className="lot-id-vendor-bar">
          <span className="lot-id-vendor-bar-label">Vendor</span>
          <button
            className={`lot-id-vendor-bar-pill${vendorFilter === "" ? " active" : ""}`}
            onClick={() => setVendorFilter("")}
          >
            All
          </button>
          {allVendors.map((v) => {
            const count = Object.values(productData).reduce(
              (n, d) => n + (d.coaList || []).filter((c) => (c.vendor || "") === v).length,
              0
            );
            return (
              <button
                key={v}
                className={`lot-id-vendor-bar-pill${vendorFilter === v ? " active" : ""}`}
                onClick={() => setVendorFilter((prev) => (prev === v ? "" : v))}
              >
                {v}
                <span className="lot-id-vendor-bar-count">{count}</span>
              </button>
            );
          })}
        </div>
      )}
      <div className="lot-id-pill-bar">
        {false && import.meta.env.DEV && (
          <>
            <button
              className="lot-id-product-pill"
              style={{ background: '#1a6b3a', color: '#fff', fontWeight: 800 }}
              onClick={async () => {
                if (!confirm("Patch centerGap=2, strengthPadY=8, lotTop=10, lotFontSize=12 on ALL verticalLabelDesigns?")) return;
                const snap = await getDocs(collection(db, "c&pProductList"));
                let count = 0;
                for (const docSnap of snap.docs) {
                  const existing = docSnap.data().verticalLabelDesign || {};
                  await updateDoc(doc(db, "c&pProductList", docSnap.id), {
                    verticalLabelDesign: { ...DEFAULT_LABEL_DESIGN, ...existing, centerGap: 2, strengthPadY: 8, lotTop: 10, lotFontSize: 12 },
                  });
                  count++;
                }
                alert(`Done — patched on ${count} product(s).`);
              }}
            >
              Patch Gap+PadY
            </button>
            <button
              className="lot-id-product-pill"
              style={{ background: '#c0392b', color: '#fff', fontWeight: 800 }}
              onClick={async () => {
                const snap = await getDocs(collection(db, "c&pProductList"));
                let count = 0;
                for (const docSnap of snap.docs) {
                  await updateDoc(doc(db, "c&pProductList", docSnap.id), {
                    verticalLabelDesign: DEFAULT_LABEL_DESIGN,
                  });
                  count++;
                }
                alert(`Done — overwrote verticalLabelDesign on ${count} product(s).`);
              }}
            >
              Init Vertical Labels
            </button>
            <button
              className="lot-id-product-pill"
              style={{ background: '#7b3f00', color: '#fff', fontWeight: 800 }}
              onClick={async () => {
                if (!confirm("Overwrite testLabelDesign on ALL products?")) return;
                const snap = await getDocs(collection(db, "c&pProductList"));
                let count = 0;
                for (const docSnap of snap.docs) {
                  await updateDoc(doc(db, "c&pProductList", docSnap.id), {
                    testLabelDesign: DEFAULT_TEST_LABEL_DESIGN,
                  });
                  count++;
                }
                alert(`Done — overwrote testLabelDesign on ${count} product(s).`);
              }}
            >
              Init Test Labels
            </button>
          </>
        )}
        {products
          .filter((p) =>
            !vendorFilter ||
            (productData[p.docId]?.coaList || []).some((c) => (c.vendor || "") === vendorFilter)
          )
          .map((p) => (
          <button
            key={p.docId}
            className={`lot-id-product-pill${selectedProductId === p.docId ? ' active' : ''}`}
            onClick={() => { setSelectedProductId(p.docId); }}
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
            verticalLabelDesign: DEFAULT_LABEL_DESIGN,
            kitLabelDesign: DEFAULT_KIT_LABEL_DESIGN,
            testLabelDesign: DEFAULT_TEST_LABEL_DESIGN,
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
          const activePreviewLot = (() => {
            const visibleLots = vendorFilter
              ? (data.coaList || []).filter((c) => (c.vendor || "") === vendorFilter)
              : (data.coaList || []);
            return (
              visibleLots.find((lot) => lot.lot === previewLotSelection[key]) ||
              visibleLots[0] ||
              null
            );
          })();
          const vialDraftKey = `${key}_vial`;
          const kitDraftKey  = `${key}_kit`;
          const vialDirty = !!labelDraftDirty[vialDraftKey];
          const kitDirty  = !!labelDraftDirty[kitDraftKey];
          const rawVialDesign = (labelEditorOpen && labelEditorProductKey === key && labelEditorMode === "vial")
            ? labelDesignDraft
            : getDraft(key, "vial");
          const rawKitDesign = (labelEditorOpen && labelEditorProductKey === key && labelEditorMode === "kit")
            ? labelDesignDraft
            : getDraft(key, "kit");
          const designStyles = buildLabelDesignStyles(rawVialDesign);
          const kitDesignStyles = buildKitLabelDesignStyles(rawKitDesign);
          const testDesignStyles = buildLabelDesignStyles(
            labelEditorOpen && labelEditorProductKey === key && labelEditorMode === "test"
              ? mergeLabelDesign(labelDesignDraft)
              : mergeLabelDesign(data.testLabelDesign)
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
                  <div className="lot-id-strength">{p.strength}</div>
                </div>
                <div className="lot-id-header-actions">
                  {!isGuest && (
                    <button
                      type="button"
                      className="lot-id-layout-btn"
                      onClick={() => setEditProductModal({ open: true, docId: p.docId, id: p.id || "", product: p.product || "" })}
                    >
                      Edit
                    </button>
                  )}
                </div>
              </div>

              <div className="lot-id-main-split">
                <div className="lot-id-template">
                  <div className="lot-id-label-preview-card">
                    <div className="lot-id-label-preview-topbar">
                      <div>
                        <div className="lot-id-label-preview-heading">Print Label</div>
                        <div className="lot-id-label-preview-sub">
                          1.75&quot; x 0.75&quot;
                        </div>
                      </div>
                      <div className="lot-id-label-preview-actions">
                        {!isGuest && vialDirty && (
                          <>
                            <button type="button" className="lot-id-inline-save-btn" onClick={() => saveDraft(key, "vial")}>Save</button>
                            <button type="button" className="lot-id-inline-cancel-btn" onClick={() => cancelDraft(key, "vial")}>Cancel</button>
                          </>
                        )}
                        {!isGuest && (
                          <button type="button" className="lot-id-layout-btn" onClick={() => openLabelEditor(key, "vial")}>Full Editor</button>
                        )}
                        {activePreviewLot?.lot && (
                          <button type="button" className="lot-id-print-btn" onClick={() => handlePrintLotLabel(p, activePreviewLot)}>Print Label</button>
                        )}
                      </div>
                    </div>
                    {activePreviewLot?.lot ? (
                      <div className="lot-id-label-preview-shell lot-id-label-preview-shell--editing">
                        <DraggableLabelCanvas
                          design={rawVialDesign}
                          onChange={(field, value) => updateDraft(key, "vial", field, value)}
                          mode="vial"
                          product={p}
                          lotEntry={activePreviewLot}
                          selectedEl={null}
                          onSelect={() => {}}
                          canvasScale={1}
                          showHandles={false}
                          showEditPanel={false}
                        />
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

                  <div className="lot-id-label-preview-card">
                    <div className="lot-id-label-preview-topbar">
                      <div>
                        <div className="lot-id-label-preview-heading">Print Kit Label</div>
                        <div className="lot-id-label-preview-sub">
                          1.50&quot; x 2.25&quot;
                        </div>
                      </div>
                      <div className="lot-id-label-preview-actions">
                        {!isGuest && kitDirty && (
                          <>
                            <button type="button" className="lot-id-inline-save-btn" onClick={() => saveDraft(key, "kit")}>Save</button>
                            <button type="button" className="lot-id-inline-cancel-btn" onClick={() => cancelDraft(key, "kit")}>Cancel</button>
                          </>
                        )}
                        {!isGuest && (
                          <button type="button" className="lot-id-layout-btn" onClick={() => openLabelEditor(key, "kit")}>Full Editor</button>
                        )}
                        {activePreviewLot?.lot && (
                          <button type="button" className="lot-id-print-btn" onClick={() => handlePrintKitLabel(p, activePreviewLot)}>Print Kit</button>
                        )}
                      </div>
                    </div>
                    {activePreviewLot?.lot ? (
                      <div className="lot-id-label-preview-shell lot-id-label-preview-shell--editing">
                        <DraggableLabelCanvas
                          design={rawKitDesign}
                          onChange={(field, value) => updateDraft(key, "kit", field, value)}
                          mode="kit"
                          product={p}
                          lotEntry={activePreviewLot}
                          selectedEl={null}
                          onSelect={() => {}}
                          canvasScale={1}
                          showHandles={false}
                          showEditPanel={false}
                        />
                      </div>
                    ) : (
                      <div className="lot-id-label-preview-empty">
                        Generate a lot first to preview its printable kit label.
                      </div>
                    )}
                    {activePreviewLot?.lot && (
                      <div className="lot-id-label-preview-capnote">
                        Cap color accent: {activePreviewLot.capColor || "No cap color"}
                      </div>
                    )}
                  </div>

                  <div className="lot-id-label-preview-card">
                    <div className="lot-id-label-preview-topbar">
                      <div>
                        <div className="lot-id-label-preview-heading">Test Label Variants</div>
                      </div>
                      <div className="lot-id-label-preview-actions">
                        {!isGuest && (
                          <button
                            type="button"
                            className="lot-id-layout-btn"
                            onClick={() => openLabelEditor(key, "test")}
                          >
                            Edit Test Layout
                          </button>
                        )}
                        {activePreviewLot?.lot && (
                          <button
                            type="button"
                            className="lot-id-print-btn"
                            onClick={() => handlePrintAllTestLabels(p, activePreviewLot)}
                          >
                            Print All 5
                          </button>
                        )}
                      </div>
                    </div>
                    {activePreviewLot?.lot ? (
                      <div className="lot-id-test-label-grid">
                        {TEST_LABEL_VARIANTS.map((testLot) => (
                          <div key={testLot} className="lot-id-test-label-item">
                            {renderTestLabelPreview(p, activePreviewLot, testDesignStyles, testLot,
                              labelEditorOpen && labelEditorProductKey === key && labelEditorMode === "test"
                                ? mergeLabelDesign(labelDesignDraft)
                                : mergeLabelDesign(data.testLabelDesign)
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="lot-id-label-preview-empty">
                        Generate a lot first to preview the test label variants.
                      </div>
                    )}
                  </div>
                </div>

                <div className="lot-id-section lot-id-lot-list-section">
                <div className="lot-id-section-header lot-id-lot-list-header">
                  <label>Lot List</label>
                  {!isGuest && (
                    <button
                      className="lot-id-generate-btn"
                      onClick={() => openLotModal(key, nextIdPreview)}
                    >
                      + Generate Lot ID
                    </button>
                  )}
                </div>
                <ul className="lot-id-past-list">
                  {(() => {
                    const fullList = data.coaList || [];
                    const lotList = fullList.filter(
                      (c) => !vendorFilter || (c.vendor || "") === vendorFilter
                    );
                    return lotList.length ? (
                      lotList.map((coa, i) => {
                          const realIndex = fullList.indexOf(coa);
                          const isActive = activePreviewLot?.lot === coa.lot;
                          const capAccent = isActive ? normalizeLabelAccentColor(getCapRenderColor(coa.capColor, coa.capShade)) : null;
                          return (
                        <li
                          key={i}
                          className={`lot-id-list-item${isActive ? " preview-active" : ""}`}
                          style={isActive && capAccent ? {
                            borderColor: capAccent,
                            boxShadow: `0 0 0 3px ${capAccent}33, 0 6px 18px ${capAccent}22`,
                          } : undefined}
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
                            {(!isGuest || (vendorGuest && (coa.vendor || "") === vendorGuest)) && (
                              <button
                                className="lot-id-edit-toggle lot-id-card-edit-btn"
                                onClick={() => openEditLotModal(key, realIndex, coa)}
                              >
                                Edit
                              </button>
                            )}
                            {!isGuest && (
                              <button
                                type="button"
                                className="lot-id-edit-toggle lot-id-card-label-btn"
                                onClick={(e) => { e.stopPropagation(); openLotLabelEditor(key, realIndex, coa); }}
                              >
                                Edit Label
                              </button>
                            )}
                            {!isGuest && (
                              <button
                                type="button"
                                className="lot-id-edit-toggle lot-id-card-testing-btn"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  addToTestingQueue(p, coa);
                                }}
                              >
                                Send for Testing
                              </button>
                            )}
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
                            {!isGuest && (
                              <span className="lot-id-meta-stat">
                                {typeof coa.kits === "number" ? coa.kits : 0} kits
                              </span>
                            )}
                          {!isGuest && coa.vendor && (
                            <span className="lot-id-vendor-badge">{coa.vendor}</span>
                          )}
                          </div>
                          {coa.note && (
                            <div className="lot-id-note-display">{coa.note}</div>
                          )}
                        </li>
                          );
                        })
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

      {editProductModal.open &&
        createPortal(
          <div className="lot-modal-backdrop" onClick={() => setEditProductModal({ open: false, docId: null, id: "", product: "" })}>
            <div className="lot-modal" onClick={(e) => e.stopPropagation()}>
              <h3>Edit Product</h3>
              <label className="lot-modal-label">Product ID</label>
              <input
                type="text"
                value={editProductModal.id}
                onChange={(e) => setEditProductModal((prev) => ({ ...prev, id: e.target.value }))}
                className="lot-modal-input"
                placeholder="e.g. TESA10"
              />
              <label className="lot-modal-label">Product Name</label>
              <input
                type="text"
                value={editProductModal.product}
                onChange={(e) => setEditProductModal((prev) => ({ ...prev, product: e.target.value }))}
                className="lot-modal-input"
                placeholder="e.g. Tesamorelin"
              />
              <div className="lot-modal-actions">
                <button className="lot-modal-btn primary" onClick={saveProductInfo}>Save</button>
                <button className="lot-modal-btn" onClick={() => setEditProductModal({ open: false, docId: null, id: "", product: "" })}>Cancel</button>
              </div>
            </div>
          </div>,
          document.body
        )}

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
                    setLotModalConfig((prev) => ({
                      ...prev,
                      capColor: e.target.value,
                      capShade: nextCapShadeFromText(e.target.value, prev.capShade),
                    }))
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

              {!isGuest && (
                <>
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
                </>
              )}

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

              {!vendorGuest && (
                <>
                  <label className="lot-modal-label">Lot ID</label>
                  <input
                    type="text"
                    value={editLotModal.lot}
                    onChange={(e) => setEditLotModal((prev) => ({ ...prev, lot: e.target.value }))}
                    className="lot-modal-input"
                    placeholder="Lot ID"
                  />
                </>
              )}

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
                  onChange={(e) =>
                    setEditLotModal((prev) => ({
                      ...prev,
                      capColor: e.target.value,
                      capShade: nextCapShadeFromText(e.target.value, prev.capShade),
                    }))
                  }
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

              {!isGuest && (
                <>
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
                </>
              )}

              {!vendorGuest && (
                <>
                  <label className="lot-modal-label">Note <span className="lot-modal-label-optional">(optional)</span></label>
                  <textarea
                    className="lot-modal-input lot-modal-textarea"
                    placeholder="Add a note about this lot..."
                    rows={2}
                    value={editLotModal.note}
                    onChange={(e) => setEditLotModal((prev) => ({ ...prev, note: e.target.value }))}
                  />
                </>
              )}

              <div className="lot-modal-actions">
                {!vendorGuest && (
                  <button
                    type="button"
                    className="lot-modal-btn danger"
                    onClick={deleteEditLotModal}
                  >
                    Delete Lot
                  </button>
                )}
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

      {lotLabelEditorOpen && lotLabelEditorProductKey && (() => {
        const edKey = lotLabelEditorProductKey;
        const edData = productData[edKey] || {};
        const edProducts = products.find((pp) => pp.docId === edKey) || {};
        const edLot = edData.coaList?.[lotLabelEditorLotIndex] || {};
        const baseVialDesign = mergeLabelDesign(edData.verticalLabelDesign);
        const previewDesign = mergeLotOverride(baseVialDesign, lotLabelDraft);
        const previewStyles = buildLabelDesignStyles(previewDesign);
        const previewCapColor = normalizeLabelAccentColor(getCapRenderColor(edLot.capColor, edLot.capShade));
        const previewStrengthBg = previewDesign?.strengthBgColor === "none" ? "transparent" : (previewDesign?.strengthBgColor || previewCapColor);
        return createPortal(
          <div className="lot-modal-backdrop" onClick={() => setLotLabelEditorOpen(false)}>
            <div className="lot-label-override-modal" onClick={(e) => e.stopPropagation()}>
              <div className="lot-label-override-header">
                <div>
                  <div className="lot-label-override-title">Edit Label — {edLot.lot}</div>
                  <div className="lot-label-override-sub">Overrides apply to this lot only</div>
                </div>
                <button className="lot-layout-editor-close-btn" onClick={() => setLotLabelEditorOpen(false)}>✕</button>
              </div>
              <div className="lot-label-override-body">
                {/* Preview */}
                <div className="lot-label-override-preview-col">
                  <div className="lot-id-label-preview-shell">
                    <div className="lot-id-print-label" style={{ background: "linear-gradient(180deg, #f3f4f6 0%, #e9ebef 100%)" }}>
                      <img src={LABEL_BACKGROUND_IMAGE} alt="" className="lot-id-print-label-bg" />
                      {previewDesign?.showGradient !== false && (
                        <div className="lot-id-print-label-tint" style={{ background: buildLabelBackground(previewCapColor) }} />
                      )}
                      <div className="lot-id-print-label-lot" style={previewStyles.lot}>{edLot.lot}</div>
                      <div className="lot-id-print-label-name" style={{ position: "absolute", left: previewDesign.nameLeft ?? 88, top: previewDesign.nameTop ?? 210, transform: `translate(-50%, -50%) rotate(${previewDesign.stackRotate ?? -90}deg)`, fontSize: previewStyles.name.fontSize, lineHeight: previewStyles.name.lineHeight, color: previewStyles.name.color, fontWeight: previewStyles.name.fontWeight, letterSpacing: previewStyles.name.letterSpacing, textTransform: previewStyles.name.textTransform, textAlign: previewStyles.name.textAlign, whiteSpace: "nowrap" }}>{renderLabelProductName(edProducts.product)}</div>
                      <div className="lot-id-print-label-strength" style={{ position: "absolute", left: previewDesign.strengthLeft ?? 124, top: previewDesign.strengthTop ?? 210, transform: `translate(-50%, -50%) rotate(${previewDesign.stackRotate ?? -90}deg)`, display: "inline-flex", alignItems: "center", justifyContent: "center", backgroundColor: previewStrengthBg, fontSize: previewStyles.strength.fontSize, padding: previewStyles.strength.padding, borderRadius: previewStyles.strength.borderRadius, color: previewStyles.strength.color, fontWeight: previewStyles.strength.fontWeight, letterSpacing: previewStyles.strength.letterSpacing, lineHeight: 1, whiteSpace: "nowrap" }}>{edProducts.strength}</div>
                      {(previewDesign?.customTexts || []).map((ct) => (
                        <div key={ct.id} style={{ position: "absolute", left: ct.left, top: ct.top, fontSize: ct.fontSize || 12, fontWeight: ct.fontWeight || 400, color: ct.color || "#ffffff", transform: `rotate(${ct.rotate || 0}deg)`, letterSpacing: `${ct.letterSpacing || 0}em`, whiteSpace: "pre-wrap", transformOrigin: "left top", lineHeight: 1.2 }}>{ct.text}</div>
                      ))}
                    </div>
                  </div>
                  <div className="lot-label-override-preview-note">Preview with lot overrides applied</div>
                </div>

                {/* Editor panel */}
                <div className="lot-label-override-props-col">
                  {/* Color overrides */}
                  <div className="lot-props-section">
                    <div className="lot-props-section-title">Color Overrides</div>
                    <div className="lot-label-override-color-note">Leave empty to use the product default</div>
                    {[
                      { label: "Product Name", field: "nameColor", defaultColor: "#ffffff" },
                      { label: "Brand Text", field: "productColor", defaultColor: "#ffffff" },
                      { label: "Badge BG", field: "strengthBgColor", defaultColor: "#888888" },
                      { label: "Badge Text", field: "massTextColor", defaultColor: "#ffffff" },
                      { label: "Lot ID", field: "lotColor", defaultColor: "#ffffff" },
                    ].map(({ label, field, defaultColor }) => (
                      <div key={field} className="lot-props-row">
                        <span className="lot-props-row-label">{label}</span>
                        <input
                          type="color"
                          className="lot-modal-color-picker"
                          style={{ height: 28, width: 36, flex: "none" }}
                          value={colorValueToHex(lotLabelDraft[field], defaultColor)}
                          onChange={(e) => setLotLabelDraft((prev) => ({ ...prev, [field]: e.target.value }))}
                        />
                        <input
                          type="text"
                          className="lot-props-number"
                          style={{ width: 72, flex: 1 }}
                          value={lotLabelDraft[field] || ""}
                          placeholder="(product default)"
                          onChange={(e) => setLotLabelDraft((prev) => ({ ...prev, [field]: e.target.value }))}
                        />
                        {lotLabelDraft[field] && (
                          <button className="lot-props-clear-btn" onClick={() => setLotLabelDraft((prev) => ({ ...prev, [field]: "" }))}>✕</button>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Custom texts */}
                  <div className="lot-props-section lot-props-section--text">
                    <div className="lot-props-section-title lot-props-section-title--text">Custom Text (this lot)</div>
                    <button
                      className="lot-props-add-text-btn"
                      onClick={() => {
                        const id = `ct_lot_${Date.now()}`;
                        setLotLabelDraft((prev) => ({ ...prev, customTexts: [...(prev.customTexts || []), { id, text: "Label Text", left: 20, top: 20, fontSize: 12, fontWeight: 700, color: "#ffffff", rotate: 0, letterSpacing: 0 }] }));
                      }}
                    >+ Add Text</button>
                    {(lotLabelDraft.customTexts || []).map((ct) => (
                      <div key={ct.id} className="lot-props-custom-text-block">
                        <div className="lot-props-custom-text-header">
                          <span>Text Element</span>
                          <button onClick={() => setLotLabelDraft((prev) => ({ ...prev, customTexts: prev.customTexts.filter((t) => t.id !== ct.id) }))}>✕</button>
                        </div>
                        <textarea
                          className="lot-props-text-input"
                          rows={2}
                          value={ct.text}
                          onChange={(e) => setLotLabelDraft((prev) => ({ ...prev, customTexts: prev.customTexts.map((t) => t.id === ct.id ? { ...t, text: e.target.value } : t) }))}
                        />
                        <div className="lot-props-row">
                          <span className="lot-props-row-label">X</span>
                          <input type="number" className="lot-props-number" value={ct.left} style={{ width: 56 }} onChange={(e) => setLotLabelDraft((prev) => ({ ...prev, customTexts: prev.customTexts.map((t) => t.id === ct.id ? { ...t, left: Number(e.target.value) } : t) }))} />
                          <span className="lot-props-row-label" style={{ marginLeft: "0.5rem" }}>Y</span>
                          <input type="number" className="lot-props-number" value={ct.top} style={{ width: 56 }} onChange={(e) => setLotLabelDraft((prev) => ({ ...prev, customTexts: prev.customTexts.map((t) => t.id === ct.id ? { ...t, top: Number(e.target.value) } : t) }))} />
                        </div>
                        <div className="lot-props-row">
                          <span className="lot-props-row-label">Size</span>
                          <input type="number" className="lot-props-number" value={ct.fontSize || 12} min={6} max={80} style={{ width: 56 }} onChange={(e) => setLotLabelDraft((prev) => ({ ...prev, customTexts: prev.customTexts.map((t) => t.id === ct.id ? { ...t, fontSize: Number(e.target.value) } : t) }))} />
                          <span className="lot-props-row-label" style={{ marginLeft: "0.5rem" }}>Rotate</span>
                          <input type="number" className="lot-props-number" value={ct.rotate || 0} min={-180} max={180} style={{ width: 56 }} onChange={(e) => setLotLabelDraft((prev) => ({ ...prev, customTexts: prev.customTexts.map((t) => t.id === ct.id ? { ...t, rotate: Number(e.target.value) } : t) }))} />
                        </div>
                        <div className="lot-props-row">
                          <span className="lot-props-row-label">Color</span>
                          <input type="color" value={colorValueToHex(ct.color, "#ffffff")} onChange={(e) => setLotLabelDraft((prev) => ({ ...prev, customTexts: prev.customTexts.map((t) => t.id === ct.id ? { ...t, color: e.target.value } : t) }))} className="lot-modal-color-picker" style={{ height: 28, flex: 1 }} />
                          <label style={{ fontSize: "0.78rem", color: "#4a3825", marginLeft: "0.4rem", display: "flex", alignItems: "center", gap: "0.25rem" }}>
                            Bold
                            <input type="checkbox" checked={(ct.fontWeight || 400) >= 700} onChange={(e) => setLotLabelDraft((prev) => ({ ...prev, customTexts: prev.customTexts.map((t) => t.id === ct.id ? { ...t, fontWeight: e.target.checked ? 700 : 400 } : t) }))} />
                          </label>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="lot-modal-actions" style={{ marginTop: "auto", paddingTop: "1rem" }}>
                    <button type="button" className="lot-modal-btn secondary" onClick={() => setLotLabelEditorOpen(false)}>Cancel</button>
                    <button type="button" className="lot-modal-btn primary" onClick={saveLotLabelOverride}>Save Overrides</button>
                  </div>
                </div>
              </div>
            </div>
          </div>,
          document.body
        );
      })()}

      {testingFormOpen &&
        createPortal(
          <div className="lot-modal-backdrop" onClick={() => setTestingFormOpen(false)}>
            <div className="lot-modal lot-testing-modal" onClick={(e) => e.stopPropagation()}>
              <div className="lot-testing-modal-header-bar">
                <h3>Peptide Purity Testing Form</h3>
                <p className="lot-modal-sub">Preview matches print &mdash; click fields to edit</p>
              </div>

              {/* Label preview — styled to match the 4×6 print output */}
              <div className="lot-testing-label-preview">

                {/* Submission info: logo replaces company field */}
                <div className="lot-tp-sub-info">
                  <div className="lot-tp-sub-logo-cell">
                    <img className="lot-tp-logo" src="/assets/labelLogo.png" alt="Coffee and Peppers" />
                  </div>
                  <div className="lot-tp-sub-details">
                    <div className="lot-tp-sub-field">
                      <span className="lot-tp-sub-label">Contact Person</span>
                      <select className="lot-tp-sub-input lot-tp-sub-select"
                        value={testingContact.contact}
                        onChange={(e) => {
                          const picked = TESTING_CONTACTS.find((c) => c.name === e.target.value);
                          setTestingContact((prev) => ({
                            ...prev,
                            contact: e.target.value,
                            phone: picked ? picked.phone : prev.phone,
                          }));
                        }}>
                        {TESTING_CONTACTS.map((c) => (
                          <option key={c.name} value={c.name}>{c.name}</option>
                        ))}
                      </select>
                    </div>
                    <div className="lot-tp-sub-2col">
                      <div className="lot-tp-sub-field">
                        <span className="lot-tp-sub-label">Phone</span>
                        <input className="lot-tp-sub-input" value={testingContact.phone}
                          onChange={(e) => setTestingContact((prev) => ({ ...prev, phone: e.target.value }))} />
                      </div>
                      <div className="lot-tp-sub-field">
                        <span className="lot-tp-sub-label">Email</span>
                        <input className="lot-tp-sub-input" type="email" value={testingContact.email}
                          onChange={(e) => setTestingContact((prev) => ({ ...prev, email: e.target.value }))} />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Combine CoA */}
                <label className="lot-tp-combine">
                  <span className="lot-tp-combine-box">{testingFormOptions.combineCoa ? "✓" : ""}</span>
                  <input type="checkbox" checked={testingFormOptions.combineCoa}
                    onChange={(e) => setTestingFormOptions((prev) => ({ ...prev, combineCoa: e.target.checked }))}
                    style={{ display: "none" }} />
                  Combine test results to display on one CoA per sample.
                </label>

                {/* Testing options — horizontal grid, one column per test */}
                <div className="lot-testing-horiz-options">
                  <div className="lot-testing-horiz-options-header">Testing Options</div>
                  <div className="lot-testing-horiz-options-grid">
                    {[
                      { key: "purityId",       label: "Purity & ID",     price: "$200"      },
                      { key: "netPeptide",     label: "Net Content",      price: "+$25"      },
                      { key: "endotoxins",     label: "Endotoxins",       price: "$175"      },
                      { key: "sterility",      label: "Sterility (PCR)",  price: "$150"      },
                      { key: "conformityTest", label: "Conformity Test",  price: "+$50/vial" },
                      { key: "vialPhoto",      label: "Vial Photo",       price: "No Fee"    },
                    ].map(({ key, label, price }) => (
                      <label key={key} className="lot-testing-horiz-option-col">
                        <span className="lot-testing-horiz-option-name">
                          {label}
                          <span className="lot-testing-horiz-option-price">{price}</span>
                        </span>
                        <input className="lot-testing-grid-check" type="checkbox"
                          checked={testingGlobalTests[key]}
                          onChange={(e) => updateGlobalTest(key, e.target.checked)} />
                      </label>
                    ))}
                    <label className="lot-testing-horiz-option-col lot-testing-horiz-fentanyl">
                      <span className="lot-testing-horiz-option-name">
                        Fentanyl Screen
                        <span className="lot-testing-horiz-option-price">$40</span>
                      </span>
                      <input className="lot-testing-grid-check" type="checkbox"
                        checked={testingGlobalTests.fentanyl}
                        onChange={(e) => updateGlobalTest("fentanyl", e.target.checked)} />
                    </label>
                  </div>
                </div>

                {/* Sample list — dynamic */}
                <div className="lot-testing-samples-section">
                  <div className="lot-testing-samples-header">
                    <span>Sample Details</span>
                    <span className="lot-testing-samples-count">{testingQueue.length} in queue</span>
                  </div>
                  {testingQueue.length === 0 ? (
                    <div className="lot-testing-empty">No samples yet — use &ldquo;Send for Testing&rdquo; on any lot card.</div>
                  ) : (
                    <table className="lot-testing-samples-table">
                      <thead>
                        <tr>
                          <th style={{ width: "6%" }}>#</th>
                          <th className="lot-testing-col-left" style={{ width: "38%" }}>Sample Name / ID</th>
                          <th style={{ width: "14%" }}>mg</th>
                          <th className="lot-testing-col-left" style={{ width: "36%" }}>Lot Number</th>
                          <th style={{ width: "6%" }}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {testingQueue.map((entry, i) => (
                          <tr key={entry.id}>
                            <td className="lot-testing-check-col">{i + 1}</td>
                            <td className="lot-testing-sample-col">{entry.sampleName}</td>
                            <td className="lot-testing-sample-col">
                              <input type="text" className="lot-testing-cell-input" value={entry.expectedMg}
                                onChange={(e) => updateTestingQueueItem(entry.id, "expectedMg", e.target.value)} />
                            </td>
                            <td className={`lot-testing-sample-col ${getLotCellClassName(entry.lotNumber)}`}>{entry.lotNumber}</td>
                            <td className="lot-testing-check-col">
                              <button type="button" className="lot-testing-remove-inline" onClick={() => removeTestingQueueItem(entry.id)}>✕</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>

                {/* Footer: comments + acknowledgment */}
                <div className="lot-tp-footer">
                  <div>
                    <div className="lot-tp-comments-label">Comments:</div>
                    <textarea className="lot-tp-comments-input" rows={2}
                      value={testingFormOptions.comments}
                      onChange={(e) => setTestingFormOptions((prev) => ({ ...prev, comments: e.target.value }))} />
                  </div>
                  <div>
                    <div className="lot-tp-ack-title">Acknowledgment</div>
                    <div className="lot-tp-ack-copy">By signing below, you confirm that all information provided is accurate to the best of your knowledge, you also acknowledge that the sample(s) comply with all applicable regulations for transportation and handling. All sample testing services are for research use only.</div>
                    <div className="lot-tp-sig-block">
                      <div className="lot-tp-sig-row">
                        <span>Sig:</span>
                        <span className="lot-tp-sig-line">
                          <img
                            className="lot-tp-sig-img"
                            src={`/assets/${testingContact.contact === "Daniel Mata" ? "danielsignature.png" : "coltonsignature.png"}`}
                            alt={testingContact.contact}
                          />
                        </span>
                      </div>
                      <div className="lot-tp-sig-row">
                        <span>Date:</span>
                        <span className="lot-tp-date-line"><span className="lot-tp-date-fill">{new Date().toLocaleDateString("en-US")}</span></span>
                      </div>
                    </div>
                  </div>
                </div>

              </div>{/* end label preview */}

              <div className="lot-modal-actions">
                <button type="button" className="lot-modal-btn secondary" onClick={() => setTestingFormOpen(false)}>Close</button>
                <button type="button" className="lot-modal-btn danger" onClick={() => setTestingQueue([])}>Clear Queue</button>
                <button type="button" className="lot-modal-btn secondary" onClick={printTestingFormLetter} disabled={!testingQueue.length}>Print (Letter)</button>
                <button type="button" className="lot-modal-btn primary" onClick={printTestingForm} disabled={!testingQueue.length}>Print (Label)</button>
              </div>
            </div>
          </div>,
          document.body
        )}

      {labelEditorOpen &&
        createPortal(
          (() => {
            const editorElements = labelEditorMode === "kit" ? KIT_DRAG_ELEMENTS : VIAL_DRAG_ELEMENTS;
            const selEl = editorElements.find((e) => e.id === selectedEditorElement) || null;

            // Per-element additional size/style fields shown in properties panel
            const extraFields = {
              logo: labelEditorMode === "kit"
                ? [
                    { key: "logoWidth", label: "Width", min: 20, max: 400 },
                    { key: "logoHeight", label: "Height", min: 10, max: 200 },
                  ]
                : [
                    { key: "logoWidth", label: "Width", min: 20, max: 400 },
                    { key: "logoHeight", label: "Height", min: 10, max: 200 },
                  ],
              name: [
                { key: "stackRotate", label: "Rotation", min: -180, max: 180 },
                { key: "nameFontSize", label: "Font Size", min: 8, max: 80 },
                { key: "nameLineHeight", label: "Line Height", min: 0.5, max: 2, step: 0.01 },
                { key: "nameFontWeight", label: "Weight", min: 300, max: 900, step: 100 },
                { key: "nameLetterSpacing", label: "Letter Spacing", min: -0.2, max: 0.4, step: 0.01 },
              ],
              qr: labelEditorMode === "kit"
                ? [{ key: "qrSize", label: "Size", min: 20, max: 200 }]
                : [
                    { key: "qrWidth", label: "Width", min: 20, max: 200 },
                    { key: "qrMaxHeight", label: "Max Height", min: 20, max: 300 },
                  ],
              footer: labelEditorMode === "kit"
                ? [
                    { key: "footerFontSize", label: "Font Size", min: 6, max: 30 },
                    { key: "footerGap", label: "Gap", min: 0, max: 40 },
                    { key: "bottomFadeHeight", label: "Fade Height", min: 0, max: 400 },
                  ]
                : [{ key: "footerFontSize", label: "Font Size", min: 6, max: 30 }],
              lot: [
                { key: "lotFontSize", label: "Font Size", min: 6, max: 40 },
                { key: "lotFontWeight", label: "Font Weight", min: 300, max: 900, step: 100 },
                { key: "lotLetterSpacing", label: "Letter Spacing", min: -0.2, max: 0.4, step: 0.01 },
                { key: "lotRotate", label: "Rotation", min: -180, max: 180 },
                ...(labelEditorMode === "kit"
                  ? []
                  : [
                      { key: "lotOffsetX", label: "Offset X", min: -120, max: 120 },
                      { key: "lotOffsetY", label: "Offset Y", min: -120, max: 120 },
                    ]),
              ],
              product: [
                { key: "productFontSize", label: "Font Size", min: 8, max: 80 },
                { key: "productLineHeight", label: "Line Height", min: 0.5, max: 2, step: 0.01 },
                { key: "productFontWeight", label: "Font Weight", min: 300, max: 900, step: 100 },
                { key: "productLetterSpacing", label: "Letter Spacing", min: -0.2, max: 0.4, step: 0.01 },
              ],
              strength: [
                { key: "strengthFontSize", label: "Font Size", min: 8, max: 60 },
                { key: "strengthPadX", label: "Pad X", min: 0, max: 40 },
                { key: "strengthPadY", label: "Pad Y", min: 0, max: 40 },
                { key: "strengthRadius", label: "Radius", min: 0, max: 40 },
                { key: "strengthFontWeight", label: "Font Weight", min: 300, max: 900, step: 100 },
                { key: "strengthLetterSpacing", label: "Letter Spacing", min: -0.2, max: 0.4, step: 0.01 },
              ],
            };

            const SliderRow = ({ fieldKey, label, min, max, step = 1 }) => {
              const val = labelDesignDraft[fieldKey] ?? 0;
              return (
                <div className="lot-props-row">
                  <span className="lot-props-row-label">{label}</span>
                  <input
                    type="range"
                    className="lot-props-slider"
                    min={min}
                    max={max}
                    step={step}
                    value={val}
                    onChange={(e) => updateLabelDesign(fieldKey, e.target.value)}
                  />
                  <input
                    type="number"
                    className="lot-props-number"
                    value={val}
                    step={step}
                    onChange={(e) => updateLabelDesign(fieldKey, e.target.value)}
                  />
                </div>
              );
            };

            // Position field ranges based on label size
            const isKit = labelEditorMode === "kit";
            const pw = isKit ? KIT_PREVIEW_WIDTH : LABEL_PREVIEW_WIDTH;
            const ph = isKit ? KIT_PREVIEW_HEIGHT : LABEL_PREVIEW_HEIGHT;

            const centerElFn = (axis) => {
              if (!selEl) return;
              const xMode = selEl.xMode || "left";
              const yMode = selEl.yMode || "top";
              // For left/right-anchored elements we need to subtract half the element's
              // own rendered size so the visual center lands at the canvas center.
              const elSize = (() => {
                if (!isKit) {
                  const vd = mergeLabelDesign(labelDesignDraft);
                  if (selEl.id === 'qr')     return { w: vd.qrWidth,   h: vd.qrWidth };
                  if (selEl.id === 'logo')   return { w: vd.logoHeight, h: vd.logoWidth }; // rotated
                  if (selEl.id === 'lot')    return { w: 0, h: 0 }; // translateX(-50%) already self-centering
                }  else {
                  const kd = mergeKitLabelDesign(labelDesignDraft);
                  if (selEl.id === 'qr')       return { w: kd.qrSize,   h: kd.qrSize };
                  if (selEl.id === 'logo')     return { w: kd.logoHeight, h: kd.logoWidth };
                  if (selEl.id === 'product')  return { w: 0, h: 0 };
                  if (selEl.id === 'strength') return { w: 0, h: 0 };
                  if (selEl.id === 'footer')   return { w: 0, h: 0 };
                  if (selEl.id === 'lot')      return { w: 0, h: 0 };
                }
                return { w: 0, h: 0 };
              })();
              if (axis === "h") {
                let newX;
                if (xMode === "percent") newX = 50;
                else if (xMode === "right") newX = Math.round(pw / 2);
                else newX = Math.round((pw - elSize.w) / 2);
                updateLabelDesign(selEl.xField, newX);
              } else {
                let newY;
                if (yMode === "percent") newY = 50;
                else if (yMode === "bottom") newY = Math.round(ph / 2);
                else newY = Math.round((ph - elSize.h) / 2);
                updateLabelDesign(selEl.yField, newY);
              }
            };

            return (
              <div className="lot-layout-backdrop-new" onClick={() => setLabelEditorOpen(false)}>
                <div className="lot-layout-editor-new" onClick={(e) => e.stopPropagation()}>
                  {/* Header */}
                  <div className="lot-layout-editor-new-header">
                    <div className="lot-layout-editor-new-title">
                      {labelEditorMode === "kit" ? "Edit Kit Label Layout" : labelEditorMode === "test" ? "Edit Test Label Layout" : "Edit Label Layout"}
                    </div>
                    <div className="lot-layout-editor-new-header-actions">
                      <button
                        type="button"
                        className="lot-modal-btn secondary"
                        onClick={() => setLabelDesignDraft(labelEditorMode === "kit" ? DEFAULT_KIT_LABEL_DESIGN : labelEditorMode === "test" ? DEFAULT_TEST_LABEL_DESIGN : DEFAULT_LABEL_DESIGN)}
                      >
                        Reset
                      </button>
                      <button type="button" className="lot-layout-editor-close-btn" onClick={() => setLabelEditorOpen(false)} aria-label="Close">✕</button>
                    </div>
                  </div>

                  {/* Body: canvas + properties */}
                  <div className="lot-layout-editor-new-body">
                    {/* Left: canvas */}
                    <div className="lot-layout-editor-new-canvas-col" ref={editorCanvasColRef}>
                      <p className="lot-layout-editor-new-hint">Hover elements to edit colors/size. Drag handles to reposition. Full style controls on the right.</p>
                      <DraggableLabelCanvas
                        design={labelDesignDraft}
                        onChange={updateLabelDesign}
                        mode={labelEditorMode}
                        product={selectedProduct}
                        lotEntry={selectedPreviewLot}
                        selectedEl={selectedEditorElement}
                        onSelect={setSelectedEditorElement}
                      />
                    </div>

                    {/* Right: properties — always-visible sections */}
                    <div className="lot-layout-editor-new-props-col">

                      {/* ── BACKGROUND ─────────────────────────────── */}
                      <div className="lot-props-section lot-props-section--bg">
                        <div className="lot-props-section-title lot-props-section-title--bg">Background</div>
                        <div className="lot-props-row">
                          <span className="lot-props-row-label">Tint Color</span>
                          <input
                            type="color"
                            value={colorValueToHex(labelDesignDraft.tintColorOverride, "#888888")}
                            onChange={(e) => setLabelDesignDraft((prev) => ({ ...prev, tintColorOverride: e.target.value }))}
                            className="lot-modal-color-picker"
                            style={{ height: 32, flex: 1 }}
                          />
                          <input
                            type="text"
                            value={labelDesignDraft.tintColorOverride ?? ""}
                            onChange={(e) => setLabelDesignDraft((prev) => ({ ...prev, tintColorOverride: e.target.value }))}
                            placeholder="(cap color)"
                            className="lot-props-number"
                            style={{ width: 72 }}
                          />
                          <button
                            className="lot-props-clear-btn"
                            title="Reset to cap color"
                            onClick={() => setLabelDesignDraft((prev) => ({ ...prev, tintColorOverride: "" }))}
                          >✕</button>
                        </div>
                        {labelEditorMode !== "kit" && (
                          <label className="lot-props-row" style={{ alignItems: "center", gap: 8 }}>
                            <span className="lot-props-row-label">Show Gradient</span>
                            <input type="checkbox" checked={labelDesignDraft.showGradient !== false} onChange={(e) => setLabelDesignDraft((prev) => ({ ...prev, showGradient: e.target.checked }))} />
                          </label>
                        )}
                        {labelEditorMode !== "kit" && SliderRow({ fieldKey: "backgroundOpacity", label: "Intensity", min: 0, max: 100, step: 1 })}
                        {labelEditorMode === "kit" && SliderRow({ fieldKey: "bottomFadeHeight", label: "Fade Height", min: 0, max: 400, step: 1 })}
                      </div>

                      {/* ── STACK (vial / test only) ────────────────── */}
                      {labelEditorMode !== "kit" && (
                        <div className="lot-props-section lot-props-section--stack">
                          <div className="lot-props-section-title lot-props-section-title--stack">Name &amp; Mass Badge</div>

                          <div className="lot-props-subsection-label">Name Position</div>
                          {SliderRow({ fieldKey: "nameLeft", label: "X", min: 0, max: LABEL_PREVIEW_WIDTH })}
                          {SliderRow({ fieldKey: "nameTop", label: "Y", min: 0, max: LABEL_PREVIEW_HEIGHT })}
                          <div className="lot-props-center-btns">
                            <button className="lot-props-center-btn" onClick={() => updateLabelDesign("nameLeft", Math.round(LABEL_PREVIEW_WIDTH / 2))}>↔ Center H</button>
                            <button className="lot-props-center-btn" onClick={() => updateLabelDesign("nameTop", Math.round(LABEL_PREVIEW_HEIGHT / 2))}>↕ Center V</button>
                          </div>

                          <div className="lot-props-subsection-label">Mass Badge Position</div>
                          {SliderRow({ fieldKey: "strengthLeft", label: "X", min: 0, max: LABEL_PREVIEW_WIDTH })}
                          {SliderRow({ fieldKey: "strengthTop", label: "Y", min: 0, max: LABEL_PREVIEW_HEIGHT })}
                          <div className="lot-props-center-btns">
                            <button className="lot-props-center-btn" onClick={() => updateLabelDesign("strengthLeft", Math.round(LABEL_PREVIEW_WIDTH / 2))}>↔ Center H</button>
                            <button className="lot-props-center-btn" onClick={() => updateLabelDesign("strengthTop", Math.round(LABEL_PREVIEW_HEIGHT / 2))}>↕ Center V</button>
                          </div>

                          <div className="lot-props-subsection-label">Rotation</div>
                          {SliderRow({ fieldKey: "stackRotate", label: "Rotation", min: -180, max: 180 })}

                          <div className="lot-props-subsection-label">Name Text</div>
                          {SliderRow({ fieldKey: "nameFontSize", label: "Font Size", min: 8, max: 80 })}
                          {SliderRow({ fieldKey: "nameLineHeight", label: "Line Height", min: 0.5, max: 2, step: 0.01 })}
                          {SliderRow({ fieldKey: "nameFontWeight", label: "Weight", min: 300, max: 900, step: 100 })}
                          {SliderRow({ fieldKey: "nameLetterSpacing", label: "Letter Spacing", min: -0.2, max: 0.4, step: 0.01 })}
                          <div className="lot-props-row">
                            <span className="lot-props-row-label">Color</span>
                            <input type="color" value={colorValueToHex(labelDesignDraft.nameColor, "#23160d")} onChange={(e) => setLabelDesignDraft((prev) => ({ ...prev, nameColor: e.target.value }))} className="lot-modal-color-picker" style={{ height: 32, flex: 1 }} />
                            <input type="text" value={labelDesignDraft.nameColor ?? "#23160d"} onChange={(e) => setLabelDesignDraft((prev) => ({ ...prev, nameColor: e.target.value }))} className="lot-props-number" style={{ width: 72 }} />
                          </div>
                          <div className="lot-props-row">
                            <span className="lot-props-row-label">Align</span>
                            <div className="lot-props-align-btns">
                              {["left", "center", "right"].map((a) => (
                                <button key={a} className={`lot-props-align-btn${(labelDesignDraft.nameTextAlign || "center") === a ? " active" : ""}`} onClick={() => setLabelDesignDraft((prev) => ({ ...prev, nameTextAlign: a }))}>
                                  {a === "left" ? "⇤" : a === "center" ? "⇔" : "⇥"}
                                </button>
                              ))}
                            </div>
                          </div>
                          <label className="lot-props-row" style={{ alignItems: "center", gap: 8 }}>
                            <span className="lot-props-row-label">Uppercase</span>
                            <input type="checkbox" checked={labelDesignDraft.nameUppercase !== false} onChange={(e) => setLabelDesignDraft((prev) => ({ ...prev, nameUppercase: e.target.checked }))} />
                          </label>

                          <div className="lot-props-subsection-label">Mass Badge</div>
                          {SliderRow({ fieldKey: "strengthFontSize", label: "Font Size", min: 8, max: 60 })}
                          {SliderRow({ fieldKey: "strengthFontWeight", label: "Weight", min: 300, max: 900, step: 100 })}
                          {SliderRow({ fieldKey: "strengthLetterSpacing", label: "Letter Spacing", min: -0.2, max: 0.4, step: 0.01 })}
                          {SliderRow({ fieldKey: "strengthPadX", label: "Pad X", min: 0, max: 40 })}
                          {SliderRow({ fieldKey: "strengthPadY", label: "Pad Y", min: 0, max: 40 })}
                          <div className="lot-props-row">
                            <span className="lot-props-row-label">Badge BG</span>
                            <input type="color" value={colorValueToHex(labelDesignDraft.strengthBgColor, "#888888")} onChange={(e) => setLabelDesignDraft((prev) => ({ ...prev, strengthBgColor: e.target.value }))} className="lot-modal-color-picker" style={{ height: 32, flex: 1 }} />
                            <input type="text" value={labelDesignDraft.strengthBgColor ?? ""} onChange={(e) => setLabelDesignDraft((prev) => ({ ...prev, strengthBgColor: e.target.value }))} placeholder="(cap color)" className="lot-props-number" style={{ width: 72 }} />
                            <button className="lot-props-clear-btn" title="Use cap color" onClick={() => setLabelDesignDraft((prev) => ({ ...prev, strengthBgColor: "" }))}>✕</button>
                            <button className="lot-props-clear-btn" title="No background" onClick={() => setLabelDesignDraft((prev) => ({ ...prev, strengthBgColor: "none" }))} style={{ fontSize: "0.7rem" }}>None</button>
                          </div>
                          <div className="lot-props-row">
                            <span className="lot-props-row-label">Text Color</span>
                            <input type="color" value={colorValueToHex(labelDesignDraft.massTextColor, "#ffffff")} onChange={(e) => setLabelDesignDraft((prev) => ({ ...prev, massTextColor: e.target.value }))} className="lot-modal-color-picker" style={{ height: 32, flex: 1 }} />
                            <input type="text" value={labelDesignDraft.massTextColor ?? "#ffffff"} onChange={(e) => setLabelDesignDraft((prev) => ({ ...prev, massTextColor: e.target.value }))} className="lot-props-number" style={{ width: 72 }} />
                          </div>
                        </div>
                      )}

                      {/* ── PRODUCT (kit only) ──────────────────────── */}
                      {labelEditorMode === "kit" && (
                        <div className="lot-props-section lot-props-section--stack">
                          <div className="lot-props-section-title lot-props-section-title--stack">Product</div>

                          <div className="lot-props-subsection-label">Position</div>
                          {SliderRow({ fieldKey: "productLeft", label: "Left", min: 0, max: pw })}
                          {SliderRow({ fieldKey: "productBottom", label: "Bottom", min: 0, max: ph })}

                          <div className="lot-props-subsection-label">Typography</div>
                          {SliderRow({ fieldKey: "productFontSize", label: "Font Size", min: 8, max: 80 })}
                          {SliderRow({ fieldKey: "productLineHeight", label: "Line Height", min: 0.5, max: 2, step: 0.01 })}
                          {SliderRow({ fieldKey: "productFontWeight", label: "Weight", min: 300, max: 900, step: 100 })}
                          {SliderRow({ fieldKey: "productLetterSpacing", label: "Letter Spacing", min: -0.2, max: 0.4, step: 0.01 })}
                          <div className="lot-props-row">
                            <span className="lot-props-row-label">Color</span>
                            <input type="color" value={colorValueToHex(labelDesignDraft.productColor, "#111111")} onChange={(e) => setLabelDesignDraft((prev) => ({ ...prev, productColor: e.target.value }))} className="lot-modal-color-picker" style={{ height: 32, flex: 1 }} />
                            <input type="text" value={labelDesignDraft.productColor ?? "#111111"} onChange={(e) => setLabelDesignDraft((prev) => ({ ...prev, productColor: e.target.value }))} className="lot-props-number" style={{ width: 72 }} />
                          </div>
                          <div className="lot-props-row">
                            <span className="lot-props-row-label">Align</span>
                            <div className="lot-props-align-btns">
                              {["left", "center", "right"].map((a) => (
                                <button key={a} className={`lot-props-align-btn${(labelDesignDraft.productTextAlign || "left") === a ? " active" : ""}`} onClick={() => setLabelDesignDraft((prev) => ({ ...prev, productTextAlign: a }))}>
                                  {a === "left" ? "⇤" : a === "center" ? "⇔" : "⇥"}
                                </button>
                              ))}
                            </div>
                          </div>
                          <label className="lot-props-row" style={{ alignItems: "center", gap: 8 }}>
                            <span className="lot-props-row-label">Uppercase</span>
                            <input type="checkbox" checked={labelDesignDraft.productUppercase !== false} onChange={(e) => setLabelDesignDraft((prev) => ({ ...prev, productUppercase: e.target.checked }))} />
                          </label>

                          <div className="lot-props-subsection-label">Mass Badge</div>
                          {SliderRow({ fieldKey: "strengthLeft", label: "Left", min: 0, max: pw })}
                          {SliderRow({ fieldKey: "strengthBottom", label: "Bottom", min: 0, max: ph })}
                          {SliderRow({ fieldKey: "strengthFontSize", label: "Font Size", min: 8, max: 60 })}
                          {SliderRow({ fieldKey: "strengthFontWeight", label: "Weight", min: 300, max: 900, step: 100 })}
                          {SliderRow({ fieldKey: "strengthLetterSpacing", label: "Letter Spacing", min: -0.2, max: 0.4, step: 0.01 })}
                          {SliderRow({ fieldKey: "strengthPadX", label: "Pad X", min: 0, max: 40 })}
                          {SliderRow({ fieldKey: "strengthPadY", label: "Pad Y", min: 0, max: 40 })}
                          <div className="lot-props-row">
                            <span className="lot-props-row-label">Badge BG</span>
                            <input type="color" value={colorValueToHex(labelDesignDraft.strengthBgColor, "#888888")} onChange={(e) => setLabelDesignDraft((prev) => ({ ...prev, strengthBgColor: e.target.value }))} className="lot-modal-color-picker" style={{ height: 32, flex: 1 }} />
                            <input type="text" value={labelDesignDraft.strengthBgColor ?? ""} onChange={(e) => setLabelDesignDraft((prev) => ({ ...prev, strengthBgColor: e.target.value }))} placeholder="(cap color)" className="lot-props-number" style={{ width: 72 }} />
                            <button className="lot-props-clear-btn" title="Use cap color" onClick={() => setLabelDesignDraft((prev) => ({ ...prev, strengthBgColor: "" }))}>✕</button>
                            <button className="lot-props-clear-btn" title="No background" onClick={() => setLabelDesignDraft((prev) => ({ ...prev, strengthBgColor: "none" }))} style={{ fontSize: "0.7rem" }}>None</button>
                          </div>
                          <div className="lot-props-row">
                            <span className="lot-props-row-label">Text Color</span>
                            <input type="color" value={colorValueToHex(labelDesignDraft.massTextColor, "#ffffff")} onChange={(e) => setLabelDesignDraft((prev) => ({ ...prev, massTextColor: e.target.value }))} className="lot-modal-color-picker" style={{ height: 32, flex: 1 }} />
                            <input type="text" value={labelDesignDraft.massTextColor ?? "#ffffff"} onChange={(e) => setLabelDesignDraft((prev) => ({ ...prev, massTextColor: e.target.value }))} className="lot-props-number" style={{ width: 72 }} />
                          </div>
                        </div>
                      )}

                      {/* ── LOT ID ──────────────────────────────────── */}
                      <div className="lot-props-section lot-props-section--lot">
                        <div className="lot-props-section-title lot-props-section-title--lot">Lot ID</div>

                        <div className="lot-props-subsection-label">Position</div>
                        {SliderRow({ fieldKey: "lotLeft", label: "Left", min: 0, max: pw })}
                        {SliderRow({ fieldKey: "lotTop", label: "Top", min: 0, max: ph })}
                        {labelEditorMode !== "kit" && SliderRow({ fieldKey: "lotOffsetX", label: "Offset X", min: -120, max: 120 })}
                        {labelEditorMode !== "kit" && SliderRow({ fieldKey: "lotOffsetY", label: "Offset Y", min: -120, max: 120 })}

                        <div className="lot-props-subsection-label">Typography</div>
                        {SliderRow({ fieldKey: "lotFontSize", label: "Font Size", min: 6, max: 40 })}
                        {SliderRow({ fieldKey: "lotFontWeight", label: "Weight", min: 300, max: 900, step: 100 })}
                        {SliderRow({ fieldKey: "lotLetterSpacing", label: "Letter Spacing", min: -0.2, max: 0.4, step: 0.01 })}
                        {SliderRow({ fieldKey: "lotRotate", label: "Rotation", min: -180, max: 180 })}
                        <div className="lot-props-row">
                          <span className="lot-props-row-label">Color</span>
                          <input type="color" value={colorValueToHex(labelDesignDraft.lotColor, "#2b1a0f")} onChange={(e) => setLabelDesignDraft((prev) => ({ ...prev, lotColor: e.target.value }))} className="lot-modal-color-picker" style={{ height: 32, flex: 1 }} />
                          <input type="text" value={labelDesignDraft.lotColor ?? "#2b1a0f"} onChange={(e) => setLabelDesignDraft((prev) => ({ ...prev, lotColor: e.target.value }))} className="lot-props-number" style={{ width: 72 }} />
                        </div>
                        <div className="lot-props-row">
                          <span className="lot-props-row-label">Align</span>
                          <div className="lot-props-align-btns">
                            {["left", "center", "right"].map((a) => (
                              <button key={a} className={`lot-props-align-btn${(labelDesignDraft.lotTextAlign || "center") === a ? " active" : ""}`} onClick={() => setLabelDesignDraft((prev) => ({ ...prev, lotTextAlign: a }))}>
                                {a === "left" ? "⇤" : a === "center" ? "⇔" : "⇥"}
                              </button>
                            ))}
                          </div>
                        </div>
                        <label className="lot-props-row" style={{ alignItems: "center", gap: 8 }}>
                          <span className="lot-props-row-label">Uppercase</span>
                          <input type="checkbox" checked={labelDesignDraft.lotUppercase !== false} onChange={(e) => setLabelDesignDraft((prev) => ({ ...prev, lotUppercase: e.target.checked }))} />
                        </label>
                      </div>

                      {/* ── CUSTOM TEXT ─────────────────────────────── */}
                      <div className="lot-props-section lot-props-section--text">
                        <div className="lot-props-section-title lot-props-section-title--text">Custom Text</div>
                        <button
                          type="button"
                          className="lot-props-add-text-btn"
                          onClick={() => {
                            const id = `ct_${Date.now()}`;
                            setLabelDesignDraft((prev) => ({
                              ...prev,
                              customTexts: [...(prev.customTexts || []), { id, text: "Label Text", left: 20, top: 20, fontSize: 12, fontWeight: 700, color: "#ffffff", rotate: 0, letterSpacing: 0 }],
                            }));
                          }}
                        >
                          + Add Text
                        </button>
                        {(labelDesignDraft.customTexts || []).map((ct, ctIdx) => (
                          <div key={ct.id} className="lot-props-custom-text-block">
                            <div className="lot-props-custom-text-header">
                              <span className="lot-props-row-label">Text {ctIdx + 1}</span>
                              <button className="lot-props-clear-btn" style={{ color: "#c0392b" }} onClick={() => setLabelDesignDraft((prev) => ({ ...prev, customTexts: prev.customTexts.filter((t) => t.id !== ct.id) }))}>✕ Remove</button>
                            </div>
                            <textarea
                              className="lot-props-text-input"
                              value={ct.text}
                              rows={2}
                              onChange={(e) => setLabelDesignDraft((prev) => ({ ...prev, customTexts: prev.customTexts.map((t) => t.id === ct.id ? { ...t, text: e.target.value } : t) }))}
                            />
                            <div className="lot-props-row">
                              <span className="lot-props-row-label">X</span>
                              <input type="number" className="lot-props-number" value={ct.left} onChange={(e) => setLabelDesignDraft((prev) => ({ ...prev, customTexts: prev.customTexts.map((t) => t.id === ct.id ? { ...t, left: Number(e.target.value) } : t) }))} style={{ width: 56 }} />
                              <span className="lot-props-row-label" style={{ marginLeft: 8 }}>Y</span>
                              <input type="number" className="lot-props-number" value={ct.top} onChange={(e) => setLabelDesignDraft((prev) => ({ ...prev, customTexts: prev.customTexts.map((t) => t.id === ct.id ? { ...t, top: Number(e.target.value) } : t) }))} style={{ width: 56 }} />
                            </div>
                            <div className="lot-props-row">
                              <span className="lot-props-row-label">Size</span>
                              <input type="number" className="lot-props-number" value={ct.fontSize || 12} min={6} max={80} onChange={(e) => setLabelDesignDraft((prev) => ({ ...prev, customTexts: prev.customTexts.map((t) => t.id === ct.id ? { ...t, fontSize: Number(e.target.value) } : t) }))} style={{ width: 56 }} />
                              <span className="lot-props-row-label" style={{ marginLeft: 8 }}>Rotate</span>
                              <input type="number" className="lot-props-number" value={ct.rotate || 0} min={-180} max={180} onChange={(e) => setLabelDesignDraft((prev) => ({ ...prev, customTexts: prev.customTexts.map((t) => t.id === ct.id ? { ...t, rotate: Number(e.target.value) } : t) }))} style={{ width: 56 }} />
                            </div>
                            <div className="lot-props-row">
                              <span className="lot-props-row-label">Color</span>
                              <input type="color" value={colorValueToHex(ct.color, "#ffffff")} onChange={(e) => setLabelDesignDraft((prev) => ({ ...prev, customTexts: prev.customTexts.map((t) => t.id === ct.id ? { ...t, color: e.target.value } : t) }))} className="lot-modal-color-picker" style={{ height: 28, flex: 1 }} />
                              <span className="lot-props-row-label" style={{ marginLeft: 8 }}>Bold</span>
                              <input type="checkbox" checked={(ct.fontWeight || 400) >= 700} onChange={(e) => setLabelDesignDraft((prev) => ({ ...prev, customTexts: prev.customTexts.map((t) => t.id === ct.id ? { ...t, fontWeight: e.target.checked ? 700 : 400 } : t) }))} />
                            </div>
                          </div>
                        ))}
                      </div>

                    </div>
                  </div>

                  {/* Footer */}
                  <div className="lot-layout-editor-new-footer">
                    <button type="button" className="lot-modal-btn secondary" onClick={() => setLabelEditorOpen(false)}>Cancel</button>
                    <button type="button" className="lot-modal-btn primary" onClick={saveLabelDesign}>Save Layout</button>
                  </div>
                </div>
              </div>
            );
          })(),
          document.body
        )}
    </div>

      {allLotsOpen && createPortal(
        <div className="lot-modal-backdrop all-lots-backdrop" onClick={() => setAllLotsOpen(false)}>
          <div className="lot-modal all-lots-modal" onClick={(e) => e.stopPropagation()}>
            <div className="all-lots-modal-header">
              <h3>All Lot IDs</h3>
              <div className="all-lots-modal-header-actions">
                <button
                  className="lot-modal-btn secondary"
                  onClick={() => {
                    const rows = [["Product ID", "Product Name", "Lot ID", "Cap Color"]];
                    products
                      .filter((p) => !/^test$/i.test((p.id || p.product || "").trim()))
                      .forEach((p) => {
                        const lots = (productData[p.docId]?.coaList || [])
                          .filter((c) => !vendorGuest || (c.vendor || "") === vendorGuest);
                        lots.forEach((coa) => {
                          rows.push([
                            p.id || "",
                            p.product || "",
                            coa.lot || "",
                            coa.capColor || "",
                          ]);
                        });
                      });
                    const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
                    const blob = new Blob([csv], { type: "text/csv" });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `lot-ids-${new Date().toISOString().slice(0, 10)}.csv`;
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                >
                  ↓ Download CSV
                </button>
                <button
                  className="lot-modal-btn secondary"
                  onClick={() => handlePrintAllVialLabels()}
                  disabled={pdfGenerating}
                >
                  {pdfGenerating ? '⏳ Generating…' : '↓ Download Label PDF'}
                </button>
                <button className="lot-modal-btn secondary" onClick={() => setAllLotsOpen(false)}>Close</button>
              </div>
            </div>
            <div className="all-lots-modal-body">
              {products.filter((p) => !/^test$/i.test((p.id || p.product || "").trim())).map((p) => {
                const lots = (productData[p.docId]?.coaList || [])
                  .filter((c) => !vendorGuest || (c.vendor || "") === vendorGuest);
                if (!lots.length) return null;
                return (
                  <div
                    key={p.docId}
                    className="all-lots-product-group"
                    style={productData[p.docId]?.capColor ? { borderColor: getCapBorderColor(productData[p.docId].capColor, productData[p.docId]?.currentCOA?.capShade) } : undefined}
                  >
                    <div className="all-lots-product-name">{p.id || p.product} <span className="all-lots-product-full">{p.product}</span></div>
                    <ul className="all-lots-list">
                      {lots.map((coa, i) => (
                        <li key={i} className="all-lots-item">
                          <button
                            type="button"
                            className="all-lots-lot-id"
                            style={coa.capColor ? { borderColor: getCapBorderColor(coa.capColor, coa.capShade) } : undefined}
                            onClick={() => {
                              copyToClipboard(coa.lot, p.docId, `all-${i}`);
                            }}
                            title="Click to copy"
                          >
                            {coa.lot || <i>no lot id</i>}
                            <span className="lot-id-card-copy-icon">⎘</span>
                          </button>
                          {copyFlash[`${p.docId}-all-${i}`] && (
                            <span className="lot-id-copied">Copied!</span>
                          )}
                          {coa.capColor && (
                            <span
                              className="all-lots-cap-swatch"
                              style={{ backgroundColor: getCapRenderColor(coa.capColor, coa.capShade) || "#e7dfd3" }}
                              title={coa.capColor}
                            />
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
};

export default LotIDTracker;
