import React, { useState, useEffect, useRef } from 'react';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
} from 'firebase/firestore';
import { deleteObject, getBytes, getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { auth, db, storage } from '../firebaseConfig';
import { costDatabase, getCost } from '../data/costDatabase';
import AffiliatePayouts from './AffiliatePayouts';
import './CostAnalytics.css';

const CostAnalytics = () => {
  const LAST_UPLOAD_STORAGE_KEY = 'costAnalyticsLastUpload';
  const SHARED_REPORTS_COLLECTION = 'costAnalyticsSharedReports';
  const MAX_SHARED_REPORTS = 40;
  const WOO_PULL_TIMEOUT_MS = 180000;
  const defaultWooDate = new Date().toISOString().slice(0, 10);
  const [salesData, setSalesData] = useState([]);
  const [analysis, setAnalysis] = useState(null);
  const [fileName, setFileName] = useState('');
  const [unmatchedProducts, setUnmatchedProducts] = useState([]);
  const [dateStart, setDateStart] = useState('');
  const [dateEnd, setDateEnd] = useState('');
  const [savedAnalyses, setSavedAnalyses] = useState([]);
  const [selectedForCombine, setSelectedForCombine] = useState([]);
  const [combinedAnalysis, setCombinedAnalysis] = useState(null);
  const [analysisDetailsTab, setAnalysisDetailsTab] = useState('products');
  const [combinedDetailsTab, setCombinedDetailsTab] = useState('products');
  const [reportNetSales, setReportNetSales] = useState(null);
  const [activeTab, setActiveTab] = useState('analysis');
  const [inputSource, setInputSource] = useState('woo');
  const [productReportFileName, setProductReportFileName] = useState('');
  const [comparisonData, setComparisonData] = useState([]);
  const [reconciliation, setReconciliation] = useState(null);
  const [uploadedProductFile, setUploadedProductFile] = useState(null);
  const [sharedReports, setSharedReports] = useState([]);
  const [isSavingSharedReport, setIsSavingSharedReport] = useState(false);
  const [isLoadingSharedReportId, setIsLoadingSharedReportId] = useState('');
  const [isDeletingSharedReportId, setIsDeletingSharedReportId] = useState('');
  const [isPullingWoo, setIsPullingWoo] = useState(false);
  const [wooAutoPullEnabled, setWooAutoPullEnabled] = useState(false);
  const [wooPullInfo, setWooPullInfo] = useState(null);
  const [wooCouponUsage, setWooCouponUsage] = useState([]);
  const [wooPullStartDate, setWooPullStartDate] = useState(defaultWooDate);
  const [wooPullEndDate, setWooPullEndDate] = useState(defaultWooDate);
  const [successToastMessage, setSuccessToastMessage] = useState('');
  const productFileInputRef = useRef(null);
  const toastTimerRef = useRef(null);

  const showSuccessToast = (message) => {
    setSuccessToastMessage(message);
    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => {
      setSuccessToastMessage('');
      toastTimerRef.current = null;
    }, 3200);
  };

  const mapSharedReportDoc = (docSnapshot) => {
    const data = docSnapshot.data();
    return {
      id: docSnapshot.id,
      fileName: data.fileName || 'Unnamed report',
      storagePath: data.storagePath || '',
      downloadURL: data.downloadURL || '',
      csvText: typeof data.csvText === 'string' ? data.csvText : '',
      dateStart: data.dateStart || '',
      dateEnd: data.dateEnd || '',
      reportNetSales: Number(data.reportNetSales) || 0,
      uploadedBy: data.uploadedBy || 'Unknown',
      uploadedAt: data.uploadedAt?.toDate ? data.uploadedAt.toDate() : null,
      uploadedAtIso: data.uploadedAtIso || '',
      rowCount: Number(data.rowCount) || 0,
    };
  };

  const loadSharedReports = async () => {
    try {
      const sharedRef = collection(db, SHARED_REPORTS_COLLECTION);
      const sharedQuery = query(sharedRef, orderBy('uploadedAt', 'desc'), limit(MAX_SHARED_REPORTS));
      const snapshot = await getDocs(sharedQuery);
      setSharedReports(snapshot.docs.map(mapSharedReportDoc));
    } catch (error) {
      console.error('Unable to load shared reports:', error);
      setSharedReports([]);
    }
  };

  const pricingSource = combinedAnalysis || analysis;
  const pricingRows = pricingSource
    ? [...pricingSource.breakdown]
      .map((item) => {
        const sellPrice = item.itemsSold > 0 ? item.netSales / item.itemsSold : 0;
        const unitSpread = sellPrice - item.unitCost;
        const marginPct = sellPrice > 0 ? (unitSpread / sellPrice) * 100 : 0;

        return {
          ...item,
          sellPrice,
          unitSpread,
          marginPct,
        };
      })
      .sort((a, b) => {
        const categoryCompare = (a.category || '').localeCompare(b.category || '');
        if (categoryCompare !== 0) return categoryCompare;
        return (a.product || '').localeCompare(b.product || '');
      })
    : [];

  const pricingRowsByCategory = pricingRows.reduce((acc, row) => {
    const key = row.category || 'Uncategorized';
    if (!acc[key]) acc[key] = [];
    acc[key].push(row);
    return acc;
  }, {});
  const pricingCategories = Object.keys(pricingRowsByCategory).sort((a, b) => a.localeCompare(b));
  const isKitOrMixCategory = (category, productTitle = '') => {
    const normalizedCategory = String(category || '').toLowerCase();
    if (normalizedCategory.includes('kit')) return true;
    return /\bkit\b/i.test(String(productTitle || ''));
  };

  const pricingTotals = pricingRows.reduce((acc, row) => {
    acc.units += row.itemsSold;
    acc.totalCost += row.unitCost * row.itemsSold;
    acc.totalSales += row.sellPrice * row.itemsSold;
    return acc;
  }, { units: 0, totalCost: 0, totalSales: 0 });

  const weightedUnitCost = pricingTotals.units > 0 ? pricingTotals.totalCost / pricingTotals.units : 0;
  const weightedUnitSell = pricingTotals.units > 0 ? pricingTotals.totalSales / pricingTotals.units : 0;
  const weightedUnitSpread = weightedUnitSell - weightedUnitCost;
  const weightedMarginPct = weightedUnitSell > 0 ? (weightedUnitSpread / weightedUnitSell) * 100 : 0;
  const lowMarginCount = pricingRows.filter(row => row.marginPct < 30).length;
  const getMarginStatus = (marginPct) => (marginPct >= 30 ? 'good' : 'bad');
  const getSalesMix = (singleSales, kitSales) => {
    const single = Number(singleSales) || 0;
    const kit = Number(kitSales) || 0;
    const total = single + kit;
    if (total <= 0) {
      return { singlePct: 0, kitPct: 0 };
    }
    return {
      singlePct: (single / total) * 100,
      kitPct: (kit / total) * 100,
    };
  };
  const highestSpreadProduct = pricingRows.length > 0
    ? pricingRows.reduce((best, row) => (row.unitSpread > best.unitSpread ? row : best), pricingRows[0])
    : null;
  const combinedSalesMix = getSalesMix(combinedAnalysis?.totalNetSales, combinedAnalysis?.kitSales?.totalNetSales);
  const analysisSalesMix = getSalesMix(analysis?.totalNetSales, analysis?.kitSales?.totalNetSales);

  // Load saved analyses and cached upload on mount
  useEffect(() => {
    const saved = localStorage.getItem('costAnalysesSaved');
    if (saved) {
      try {
        setSavedAnalyses(JSON.parse(saved));
      } catch (error) {
        console.error('Error loading saved analyses:', error);
      }
    }

    const cachedUpload = localStorage.getItem(LAST_UPLOAD_STORAGE_KEY);
    if (cachedUpload) {
      try {
        const parsed = JSON.parse(cachedUpload);
        if (Array.isArray(parsed.salesData) && parsed.salesData.length > 0) {
          const restoredDateStart = parsed.dateStart || '';
          const restoredDateEnd = parsed.dateEnd || '';
          const restoredReportNetSales = parsed.reportNetSales ?? null;

          setSalesData(parsed.salesData);
          setFileName(parsed.fileName || 'Restored CSV');
          setProductReportFileName(parsed.fileName || 'Restored CSV');
          setDateStart(restoredDateStart);
          setDateEnd(restoredDateEnd);
          setReportNetSales(restoredReportNetSales);
          analyzeCosts(parsed.salesData, restoredDateStart, restoredDateEnd, restoredReportNetSales);
        }
      } catch (error) {
        console.error('Error restoring cached CSV upload:', error);
      }
    }
  }, []);

  useEffect(() => {
    loadSharedReports();
  }, []);

  useEffect(() => () => {
    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current);
    }
  }, []);

  const applyWooDailyReport = (report) => {
    const rangeStart = report?.startDate || report?.date || defaultWooDate;
    const rangeEnd = report?.endDate || rangeStart;
    const rows = Array.isArray(report?.rows) ? report.rows : [];

    if (!rows.length) {
      throw new Error('No product rows returned from Woo for this date.');
    }

    const reportRows = rows.map((row) => ({
      'Product title': row['Product title'] || row.product || '',
      Category: row.Category || row.category || '',
      'Items sold': Number(row['Items sold'] ?? row.itemsSold) || 0,
      Orders: Number(row.Orders ?? row.orders) || 0,
      'Net sales': Number(row['Net sales'] ?? row.netSales) || 0,
      SKU: row.SKU || row.sku || '',
    }));

    const normalizedNetSales = Number(report?.totalNetSales) || reportRows.reduce(
      (sum, row) => sum + (Number(row['Net sales']) || 0),
      0
    );

    const sourceName = rangeStart === rangeEnd
      ? `Woo Daily Orders ${rangeStart}.csv`
      : `Woo Orders ${rangeStart} to ${rangeEnd}.csv`;
    setInputSource('woo');
    setUploadedProductFile(null);
    setFileName(sourceName);
    setProductReportFileName(sourceName);
    setDateStart(rangeStart);
    setDateEnd(rangeEnd);
    setSalesData(reportRows);
    setReportNetSales(normalizedNetSales);
    setWooCouponUsage(Array.isArray(report?.couponUsage) ? report.couponUsage : []);
    setWooPullInfo({
      startDate: rangeStart,
      endDate: rangeEnd,
      orderCount: Number(report?.orderCount) || 0,
      paidOrderCount: Number(report?.paidOrderCount) || 0,
      metricsSource: report?.metricsSource || 'orders-v3',
      pulledStatuses: Array.isArray(report?.pulledStatuses) ? report.pulledStatuses : [],
      orderStatusCounts: report?.orderStatusCounts || {},
      pulledAt: new Date().toISOString(),
    });

    cacheUploadedData({
      fileName: sourceName,
      salesData: reportRows,
      dateStart: rangeStart,
      dateEnd: rangeEnd,
      reportNetSales: normalizedNetSales,
      cachedAt: new Date().toISOString(),
    });

    analyzeCosts(reportRows, rangeStart, rangeEnd, normalizedNetSales, {
      grossSales: Number(report?.analyticsTotals?.gross_sales) || normalizedNetSales,
      totalSales: Number(report?.analyticsTotals?.total_sales) || Number(report?.analyticsTotals?.gross_sales) || normalizedNetSales,
      netSales: Number(report?.analyticsTotals?.net_revenue) || normalizedNetSales,
    }, Number(report?.paidOrderCount) || Number(report?.orderCount) || reportRows.length);
  };

  const pullWooDailyReport = async ({ silent = false, startDate = wooPullStartDate, endDate = wooPullEndDate } = {}) => {
    if (!silent) {
      setIsPullingWoo(true);
    }

    try {
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), WOO_PULL_TIMEOUT_MS);
      const params = new URLSearchParams();
      if (startDate) params.set('startDate', startDate);
      if (endDate) params.set('endDate', endDate);
      const response = await fetch(`/api/woo/daily-report?${params.toString()}`, {
        signal: controller.signal,
      });
      window.clearTimeout(timeoutId);
      if (!response.ok) {
        let details = '';
        try {
          const text = await response.text();
          try {
            const payload = JSON.parse(text);
            details = payload?.error || text;
          } catch {
            details = text;
          }
        } catch {
          // ignore read error
        }
        throw new Error(details || `Woo sync failed (${response.status})`);
      }

      const payload = await response.json();
      applyWooDailyReport(payload);
    } catch (error) {
      if (!silent) {
        const timeoutMessage = error?.name === 'AbortError'
          ? 'Request timed out. Try a shorter range (for example 7-14 days) or pull again.'
          : (error?.message || '');
        alert(`Unable to pull Woo daily orders. ${timeoutMessage}`.trim());
      }
    } finally {
      if (!silent) {
        setIsPullingWoo(false);
      }
    }
  };

  useEffect(() => {
    if (!wooAutoPullEnabled || inputSource !== 'woo') return undefined;

    pullWooDailyReport({ silent: true, startDate: wooPullStartDate, endDate: wooPullEndDate });
    const intervalId = window.setInterval(() => {
      pullWooDailyReport({ silent: true, startDate: wooPullStartDate, endDate: wooPullEndDate });
    }, 60 * 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [wooAutoPullEnabled, inputSource, wooPullStartDate, wooPullEndDate]);

  useEffect(() => {
    if (inputSource !== 'woo' && wooAutoPullEnabled) {
      setWooAutoPullEnabled(false);
    }
  }, [inputSource, wooAutoPullEnabled]);

  const applyReportFromCsvText = (csvText, sourceName) => {
    setInputSource('csv');
    const parsedRows = parseCsvText(csvText);
    const reportTotalNetSales = extractReportNetSales(parsedRows);
    const csvDateRange = extractDateRangeFromRows(parsedRows);
    const filenameDates = extractDatesFromFilename(sourceName || '');
    const extractedDates = csvDateRange || filenameDates;
    const resolvedDateStart = extractedDates?.startDate || '';
    const resolvedDateEnd = extractedDates?.endDate || '';

    setDateStart(resolvedDateStart);
    setDateEnd(resolvedDateEnd);

    const data = normalizeSalesData(parsedRows);

    if (!data.length) {
      throw new Error('No rows were found in this CSV file.');
    }

    setSalesData(data);
    setReportNetSales(reportTotalNetSales);

    cacheUploadedData({
      fileName: sourceName,
      salesData: data,
      dateStart: resolvedDateStart,
      dateEnd: resolvedDateEnd,
      reportNetSales: reportTotalNetSales,
      cachedAt: new Date().toISOString(),
    });

    analyzeCosts(data, resolvedDateStart, resolvedDateEnd, reportTotalNetSales);
  };

  const saveAnalysis = () => {
    if (!analysis || !dateStart || !dateEnd) {
      alert('Please upload data and set a date range first');
      return;
    }
    
    const key = `${dateStart}_to_${dateEnd}`;
    const newSaved = {
      key,
      dateStart,
      dateEnd,
      analysis,
      fileName,
      savedAt: new Date().toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
    };
    
    // Check if this date range already exists, if so, update it
    const updated = savedAnalyses.filter(s => s.key !== key);
    updated.push(newSaved);
    
    setSavedAnalyses(updated);
    localStorage.setItem('costAnalysesSaved', JSON.stringify(updated));

    const saveMonth = getYearMonth(dateStart);
    const sameMonthSaved = updated.filter(s => getYearMonth(s.dateStart) === saveMonth);

    if (sameMonthSaved.length >= 2) {
      setSelectedForCombine(sameMonthSaved.map(s => s.key));
      setCombinedAnalysis(createCombinedAnalysis(sameMonthSaved, `${sameMonthSaved.length} periods (${saveMonth})`));
      showSuccessToast(`Analysis saved for ${dateStart} to ${dateEnd}. Auto-combined ${sameMonthSaved.length} reports for ${saveMonth}.`);
      return;
    }

    showSuccessToast(`Analysis saved for ${dateStart} to ${dateEnd}`);
  };
  
  const loadAnalysis = (saved) => {
    setAnalysis(saved.analysis);
    setDateStart(saved.dateStart);
    setDateEnd(saved.dateEnd);
    setFileName(saved.fileName);
    setProductReportFileName(saved.fileName);
    setReportNetSales(saved.analysis.reportNetSales ?? null);
  };
  
  const deleteAnalysis = (key) => {
    const updated = savedAnalyses.filter(s => s.key !== key);
    const nextSelected = selectedForCombine.filter(k => k !== key);

    setSavedAnalyses(updated);
    localStorage.setItem('costAnalysesSaved', JSON.stringify(updated));
    setSelectedForCombine(nextSelected);

    if (nextSelected.length >= 2) {
      const selectedSaved = updated.filter(s => nextSelected.includes(s.key));
      setCombinedAnalysis(createCombinedAnalysis(selectedSaved, `${selectedSaved.length} periods`));
    } else {
      setCombinedAnalysis(null);
    }
  };

  const toggleAnalysisForCombine = (key) => {
    if (selectedForCombine.includes(key)) {
      setSelectedForCombine(selectedForCombine.filter(k => k !== key));
    } else {
      setSelectedForCombine([...selectedForCombine, key]);
    }
  };

  const getYearMonth = (dateStr) => {
    if (!dateStr || !dateStr.includes('-')) return '';
    return dateStr.slice(0, 7);
  };

  const createCombinedAnalysis = (selectedSaved, periodLabel) => {
    if (!selectedSaved || selectedSaved.length === 0) return null;

    // Aggregate data from all selected analyses
    let totalCOGS = 0;
    let totalOrders = 0;
    let totalWooOrders = 0;
    let shippingOrderCount = 0;
    let totalItemsSold = 0;
    let totalNetSales = 0;
    let totalReportNetSales = 0;
    let totalGrossSales = 0;
    let totalTotalSales = 0;
    let totalNetRevenue = 0;
    let totalKitItemsSold = 0;
    let totalKitOrders = 0;
    let totalKitNetSales = 0;
    const productMap = {}; // Map to aggregate product data
    const kitProductMap = {};

    selectedSaved.forEach(saved => {
      totalCOGS += saved.analysis.totalCOGS;
      totalOrders += saved.analysis.totalOrders;
      totalWooOrders += saved.analysis.totalWooOrders ?? saved.analysis.totalOrders;
      shippingOrderCount += saved.analysis.shippingOrderCount ?? saved.analysis.totalOrders;
      totalItemsSold += saved.analysis.totalItemsSold;
      totalNetSales += saved.analysis.totalNetSales;
      totalReportNetSales += saved.analysis.reportNetSales ?? saved.analysis.totalNetSales;
      totalGrossSales += saved.analysis.grossSales ?? saved.analysis.reportNetSales ?? saved.analysis.totalNetSales;
      totalTotalSales += saved.analysis.totalSales ?? saved.analysis.grossSales ?? saved.analysis.reportNetSales ?? saved.analysis.totalNetSales;
      totalNetRevenue += saved.analysis.netSales ?? saved.analysis.reportNetSales ?? saved.analysis.totalNetSales;

      if (saved.analysis.kitSales?.rows?.length) {
        totalKitItemsSold += saved.analysis.kitSales.totalItemsSold || 0;
        totalKitOrders += saved.analysis.kitSales.totalOrders || 0;
        totalKitNetSales += saved.analysis.kitSales.totalNetSales || 0;

        saved.analysis.kitSales.rows.forEach((row) => {
          if (!kitProductMap[row.product]) {
            kitProductMap[row.product] = {
              product: row.product,
              sku: row.sku || '',
              category: row.category || 'Kits',
              itemsSold: 0,
              orders: 0,
              netSales: 0,
            };
          }
          kitProductMap[row.product].itemsSold += row.itemsSold;
          kitProductMap[row.product].orders += row.orders;
          kitProductMap[row.product].netSales += row.netSales;
        });
      }

      // Aggregate product data
      saved.analysis.breakdown.forEach(item => {
        if (!productMap[item.product]) {
          productMap[item.product] = {
            product: item.product,
            category: item.category,
            itemsSold: 0,
            unitCost: item.unitCost,
            totalCost: 0,
            orders: 0,
            netSales: 0,
            profit: 0,
          };
        }
        productMap[item.product].itemsSold += item.itemsSold;
        productMap[item.product].totalCost += item.totalCost;
        productMap[item.product].orders += item.orders;
        productMap[item.product].netSales += item.netSales;
        productMap[item.product].profit += item.profit;
      });
    });

    // Calculate combined metrics
    const shippingDeduction = shippingOrderCount * 5;
    const totalBillOwed = totalCOGS + shippingDeduction;
    const totalProfit = totalNetSales - totalCOGS;
    const profitMargin = totalNetSales > 0 ? (totalProfit / totalNetSales) * 100 : 0;
    const avgOrderValue = totalOrders > 0 ? totalNetSales / totalOrders : 0;

    // Calculate margin for each product
    const breakdown = Object.values(productMap).map(product => ({
      ...product,
      profitMargin: product.netSales > 0 ? (product.profit / product.netSales) * 100 : 0,
    }));

    const kitRows = Object.values(kitProductMap)
      .map((row) => ({
        ...row,
        avgSellPrice: row.itemsSold > 0 ? row.netSales / row.itemsSold : 0,
      }))
      .sort((a, b) => b.netSales - a.netSales);

    const dateStarts = selectedSaved.map(s => s.dateStart).sort();
    const dateEnds = selectedSaved.map(s => s.dateEnd).sort().reverse();

    return {
      breakdown: breakdown.sort((a, b) => b.profit - a.profit),
      totalCOGS,
      totalOrders,
      totalWooOrders,
      shippingOrderCount,
      totalItemsSold,
      shippingDeduction,
      totalBillOwed,
      netCost: totalCOGS - shippingDeduction,
      totalNetSales,
      grossSales: totalGrossSales,
      totalSales: totalTotalSales,
      netSales: totalNetRevenue,
      reportNetSales: totalReportNetSales,
      kitSales: {
        rows: kitRows,
        totalItemsSold: totalKitItemsSold,
        totalOrders: totalKitOrders,
        totalNetSales: totalKitNetSales,
      },
      totalProfit,
      profitMargin,
      avgOrderValue,
      dateStart: dateStarts[0],
      dateEnd: dateEnds[0],
      periodLabel: periodLabel || `${selectedSaved.length} periods`,
    };
  };

  const combineAnalyses = () => {
    if (selectedForCombine.length < 2) {
      alert('Select at least 2 analyses to combine');
      return;
    }

    const selectedSaved = savedAnalyses.filter(s => selectedForCombine.includes(s.key));

    setCombinedAnalysis(createCombinedAnalysis(selectedSaved, `${selectedSaved.length} periods`));
  };

  const extractDatesFromFilename = (filename) => {
    // Look for YYYY-MM-DD_before-YYYY-MM-DD pattern
    const dateMatch = filename.match(/(\d{4})-(\d{2})-(\d{2})_before-(\d{4})-(\d{2})-(\d{2})/);
    if (dateMatch) {
      const startDate = `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`;
      const endDate = `${dateMatch[4]}-${dateMatch[5]}-${dateMatch[6]}`;
      return { startDate, endDate };
    }
    return null;
  };

  const parseCsvLine = (line) => {
    const values = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === ',' && !inQuotes) {
        values.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
    values.push(current);

    return values.map(v => v.trim());
  };

  const parseCsvText = (csvText) => {
    const lines = csvText
      .replace(/^\uFEFF/, '')
      .split(/\r?\n/)
      .filter(line => line.trim() !== '');

    if (lines.length < 2) return [];

    const headers = parseCsvLine(lines[0]).map(h => h.replace(/^"|"$/g, '').trim());
    const rows = [];

    for (let i = 1; i < lines.length; i++) {
      const values = parseCsvLine(lines[i]).map(v => v.replace(/^"|"$/g, '').trim());
      const row = {};
      headers.forEach((header, idx) => {
        row[header] = values[idx] || '';
      });
      rows.push(row);
    }

    return rows;
  };

  const parseNumber = (value) => {
    if (value === null || value === undefined) return 0;
    const cleaned = String(value).replace(/[^0-9.-]/g, '');
    const parsed = parseFloat(cleaned);
    return Number.isFinite(parsed) ? parsed : 0;
  };

  const extractReportNetSales = (rows) => {
    if (!rows.length) return null;

    let found = false;
    const total = rows.reduce((sum, row) => {
      const hasNetSales = Object.prototype.hasOwnProperty.call(row, 'Net Sales')
        || Object.prototype.hasOwnProperty.call(row, 'Net sales')
        || Object.prototype.hasOwnProperty.call(row, 'N. Revenue')
        || Object.prototype.hasOwnProperty.call(row, 'N. Revenue (formatted)')
        || Object.prototype.hasOwnProperty.call(row, 'Revenue');
      if (!hasNetSales) return sum;
      found = true;
      return sum + parseNumber(
        row['Net Sales']
        ?? row['Net sales']
        ?? row['N. Revenue']
        ?? row['N. Revenue (formatted)']
        ?? row['Revenue']
      );
    }, 0);

    return found ? Number(total.toFixed(2)) : null;
  };

  const cacheUploadedData = (payload) => {
    try {
      localStorage.setItem(LAST_UPLOAD_STORAGE_KEY, JSON.stringify(payload));
    } catch (error) {
      console.error('Unable to cache uploaded CSV data:', error);
    }
  };

  const parseWooProducts = (productsCell) => {
    if (!productsCell) return [];
    return productsCell
      .split(',')
      .map(part => part.trim())
      .filter(Boolean)
      .map(part => {
        const match = part.match(/^(\d+)\s*[×x]\s*(.+)$/);
        if (match) {
          return {
            quantity: parseInt(match[1], 10) || 0,
            name: match[2].trim(),
          };
        }
        return { quantity: 1, name: part };
      })
      .filter(item => item.name);
  };

  const parseDateStringToISO = (value) => {
    if (!value) return null;
    const raw = String(value).trim();
    if (!raw) return null;

    const isoDateMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T].*)?$/);
    if (isoDateMatch) {
      return `${isoDateMatch[1]}-${isoDateMatch[2]}-${isoDateMatch[3]}`;
    }

    const usDateMatch = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s.*)?$/);
    if (usDateMatch) {
      const month = usDateMatch[1].padStart(2, '0');
      const day = usDateMatch[2].padStart(2, '0');
      const year = usDateMatch[3].length === 2 ? `20${usDateMatch[3]}` : usDateMatch[3];
      return `${year}-${month}-${day}`;
    }

    const fallback = new Date(raw);
    if (Number.isNaN(fallback.getTime())) return null;
    const y = fallback.getFullYear();
    const m = String(fallback.getMonth() + 1).padStart(2, '0');
    const d = String(fallback.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };

  const findRowValueCaseInsensitive = (row, candidateHeaders) => {
    if (!row) return '';
    const entries = Object.entries(row);
    for (const [header, value] of entries) {
      if (candidateHeaders.includes(String(header).trim().toLowerCase())) {
        return value;
      }
    }
    return '';
  };

  const extractDateRangeFromRows = (rows) => {
    if (!rows.length) return null;

    const dateCandidates = ['date', 'order date', 'created date', 'created at'];
    const normalizedDates = rows
      .map(row => parseDateStringToISO(findRowValueCaseInsensitive(row, dateCandidates)))
      .filter(Boolean)
      .sort();

    if (!normalizedDates.length) return null;

    return {
      startDate: normalizedDates[0],
      endDate: normalizedDates[normalizedDates.length - 1],
    };
  };

  const inferCategory = (productName) => {
    if (!productName) return 'Singles';
    return /\bkit\b/i.test(productName) ? 'Kits' : 'Singles';
  };

  const normalizeSalesData = (rows) => {
    if (!rows.length) return [];

    const first = rows[0];
    const hasProductSummarySchema = Object.prototype.hasOwnProperty.call(first, 'Product title');
    if (hasProductSummarySchema) {
      return rows;
    }

    const productsHeader = Object.prototype.hasOwnProperty.call(first, 'Product(s)')
      ? 'Product(s)'
      : (Object.prototype.hasOwnProperty.call(first, 'Products') ? 'Products' : null);
    const hasWooOrdersSchema = Boolean(productsHeader) && Object.prototype.hasOwnProperty.call(first, 'Items sold');
    if (!hasWooOrdersSchema) {
      return rows;
    }

    const byProduct = {};

    rows.forEach((row) => {
      const productItems = parseWooProducts(row[productsHeader]);
      if (productItems.length === 0) return;

      const orderNetSales = parseNumber(row['Net Sales'] || row['Net sales']);
      const totalQtyInOrder = productItems.reduce((sum, item) => sum + item.quantity, 0) || 1;

      productItems.forEach((item) => {
        const productName = item.name;
        if (!byProduct[productName]) {
          byProduct[productName] = {
            'Product title': productName,
            Category: inferCategory(productName),
            'Items sold': 0,
            Orders: 0,
            'Net sales': 0,
          };
        }

        byProduct[productName]['Items sold'] += item.quantity;
        byProduct[productName].Orders += 1;
        byProduct[productName]['Net sales'] += orderNetSales * (item.quantity / totalQtyInOrder);
      });
    });

    return Object.values(byProduct).map(item => ({
      ...item,
      'Items sold': Math.round(item['Items sold']),
      Orders: Math.round(item.Orders),
      'Net sales': Number(item['Net sales'].toFixed(2)),
    }));
  };

  const aggregateSalesRows = (rows) => {
    const map = {};
    rows.forEach((row) => {
      const product = (row['Product title'] || '').trim();
      if (!product) return;

      if (!map[product]) {
        map[product] = {
          product,
          itemsSold: 0,
          orders: 0,
          netSales: 0,
        };
      }

      map[product].itemsSold += parseInt(row['Items sold']) || 0;
      map[product].orders += parseInt(row.Orders) || 0;
      map[product].netSales += parseNumber(
        row['Net sales']
        ?? row['Net Sales']
        ?? row['N. Revenue']
        ?? row['N. Revenue (formatted)']
        ?? row['Revenue']
      );
    });

    return Object.values(map);
  };

  const buildReconciliation = (primaryRows, secondaryRows) => {
    const primaryIndex = {};
    primaryRows.forEach((row) => {
      primaryIndex[row.product.toLowerCase()] = row;
    });

    const secondaryIndex = {};
    secondaryRows.forEach((row) => {
      secondaryIndex[row.product.toLowerCase()] = row;
    });

    const keys = Array.from(new Set([
      ...Object.keys(primaryIndex),
      ...Object.keys(secondaryIndex),
    ]));

    const rows = [];
    let matchedProducts = 0;
    let onlyInPrimary = 0;
    let onlyInSecondary = 0;
    let mismatchCount = 0;

    keys.forEach((key) => {
      const primary = primaryIndex[key] || null;
      const secondary = secondaryIndex[key] || null;

      if (primary && secondary) matchedProducts += 1;
      if (primary && !secondary) onlyInPrimary += 1;
      if (!primary && secondary) onlyInSecondary += 1;

      const itemDiff = (primary?.itemsSold || 0) - (secondary?.itemsSold || 0);
      const orderDiff = (primary?.orders || 0) - (secondary?.orders || 0);
      const netDiff = Number(((primary?.netSales || 0) - (secondary?.netSales || 0)).toFixed(2));

      const hasDiff = Math.abs(itemDiff) > 0 || Math.abs(orderDiff) > 0 || Math.abs(netDiff) > 0.01;
      const status = !primary
        ? 'Missing in Primary'
        : (!secondary ? 'Missing in Comparison' : (hasDiff ? 'Mismatch' : 'Match'));

      if (status !== 'Match') {
        mismatchCount += 1;
        rows.push({
          product: primary?.product || secondary?.product || key,
          primaryItemsSold: primary?.itemsSold || 0,
          secondaryItemsSold: secondary?.itemsSold || 0,
          primaryOrders: primary?.orders || 0,
          secondaryOrders: secondary?.orders || 0,
          primaryNetSales: primary?.netSales || 0,
          secondaryNetSales: secondary?.netSales || 0,
          itemDiff,
          orderDiff,
          netDiff,
          status,
        });
      }
    });

    rows.sort((a, b) => Math.abs(b.netDiff) - Math.abs(a.netDiff));

    return {
      primaryProducts: primaryRows.length,
      secondaryProducts: secondaryRows.length,
      matchedProducts,
      onlyInPrimary,
      onlyInSecondary,
      mismatchCount,
      rows,
    };
  };

  useEffect(() => {
    if (!salesData.length || !comparisonData.length) {
      setReconciliation(null);
      return;
    }

    const primaryAgg = aggregateSalesRows(salesData);
    const secondaryAgg = aggregateSalesRows(comparisonData);
    setReconciliation(buildReconciliation(primaryAgg, secondaryAgg));
  }, [salesData, comparisonData]);

  const handleProductReportUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setInputSource('csv');
    setUploadedProductFile(file);
    setFileName(file.name);
    setProductReportFileName(file.name);

    const reader = new FileReader();

    reader.onload = (event) => {
      try {
        applyReportFromCsvText(event.target.result, file.name);
      } catch (error) {
        alert('Error parsing CSV: ' + error.message);
      }
    };

    reader.readAsText(file);
  };

  const escapeCsvValue = (value) => {
    const normalized = value === null || value === undefined ? '' : String(value);
    if (/[",\n\r]/.test(normalized)) {
      return `"${normalized.replace(/"/g, '""')}"`;
    }
    return normalized;
  };

  const salesDataToCsv = (rows) => {
    if (!Array.isArray(rows) || rows.length === 0) return '';

    const preferredHeaders = ['Product title', 'Category', 'Items sold', 'Orders', 'Net sales', 'SKU'];
    const rowKeys = new Set();
    rows.forEach((row) => {
      Object.keys(row || {}).forEach((key) => rowKeys.add(key));
    });

    const headers = [
      ...preferredHeaders.filter((header) => rowKeys.has(header)),
      ...Array.from(rowKeys).filter((header) => !preferredHeaders.includes(header)).sort(),
    ];

    const headerLine = headers.map(escapeCsvValue).join(',');
    const dataLines = rows.map((row) => headers.map((header) => escapeCsvValue(row?.[header] ?? '')).join(','));
    return [headerLine, ...dataLines].join('\n');
  };

  const saveReportToSharedDb = async () => {
    if (!uploadedProductFile && !salesData.length) {
      alert('Upload or load a product report first, then save it to shared reports.');
      return;
    }

    setIsSavingSharedReport(true);

    try {
      const fallbackFileName = productReportFileName || fileName || `report-${Date.now()}.csv`;
      const csvTextForDoc = salesDataToCsv(salesData);
      const uploadSource = uploadedProductFile || new Blob([csvTextForDoc], { type: 'text/csv' });
      const csvTextToStore = csvTextForDoc.length <= 900000 ? csvTextForDoc : '';
      const stamp = Date.now();
      const safeName = fallbackFileName.replace(/[^a-zA-Z0-9._-]/g, '_');
      const storagePath = `cost-analytics-reports/${stamp}-${safeName}`;
      const storageRef = ref(storage, storagePath);

      await uploadBytes(storageRef, uploadSource, {
        contentType: uploadSource.type || 'text/csv',
      });

      const downloadURL = await getDownloadURL(storageRef);
      const uploadedBy = auth.currentUser?.email || 'Unknown';
      const uploadedAtIso = new Date().toISOString();

      await addDoc(collection(db, SHARED_REPORTS_COLLECTION), {
        fileName: fallbackFileName,
        storagePath,
        downloadURL,
        csvText: csvTextToStore,
        dateStart,
        dateEnd,
        reportNetSales: reportNetSales ?? 0,
        rowCount: salesData.length,
        uploadedBy,
        uploadedAt: serverTimestamp(),
        uploadedAtIso,
      });

      await loadSharedReports();
      showSuccessToast('Report saved to shared database.');
    } catch (error) {
      console.error('Unable to save shared report:', error);
      alert('Unable to save report to shared database. Check Firebase rules and try again.');
    } finally {
      setIsSavingSharedReport(false);
    }
  };

  const loadSharedReport = async (report) => {
    if (!report?.downloadURL && !report?.storagePath && !report?.csvText) return;
    setIsLoadingSharedReportId(report.id);

    try {
      let csvText = '';

      if (report.csvText) {
        csvText = report.csvText;
      }

      // Prefer Storage SDK path-based read for authenticated users.
      if (!csvText && report.storagePath) {
        try {
          const storageRef = ref(storage, report.storagePath);
          const bytes = await getBytes(storageRef);
          csvText = new TextDecoder('utf-8').decode(bytes);
        } catch (storageReadError) {
          console.warn('Path-based storage read failed, falling back to download URL.', storageReadError);
        }
      }

      if (!csvText) {
        if (!report.downloadURL) {
          throw new Error('No download URL found for this shared report.');
        }

        const response = await fetch(report.downloadURL);
        if (!response.ok) {
          throw new Error(`Failed to fetch report (${response.status})`);
        }
        csvText = await response.text();
      }

      setUploadedProductFile(null);
      setFileName(report.fileName || 'Shared Report');
      setProductReportFileName(report.fileName || 'Shared Report');
      if (productFileInputRef.current) {
        productFileInputRef.current.value = '';
      }
      applyReportFromCsvText(csvText, report.fileName || 'Shared Report');
    } catch (error) {
      console.error('Unable to load shared report:', error);
      alert(`Unable to load this shared report right now. ${error?.message || ''} If this is an older shared file, re-save it once so it includes inline CSV fallback.`.trim());
    } finally {
      setIsLoadingSharedReportId('');
    }
  };

  const deleteSharedReport = async (report) => {
    if (!report?.id) return;

    const confirmed = window.confirm(`Delete shared report "${report.fileName || 'Unnamed report'}"? This cannot be undone.`);
    if (!confirmed) return;

    setIsDeletingSharedReportId(report.id);

    try {
      if (report.storagePath) {
        try {
          await deleteObject(ref(storage, report.storagePath));
        } catch (storageError) {
          // Ignore missing object; still continue with Firestore cleanup.
          if (storageError?.code !== 'storage/object-not-found') {
            throw storageError;
          }
        }
      }

      await deleteDoc(doc(db, SHARED_REPORTS_COLLECTION, report.id));
      setSharedReports((prev) => prev.filter((item) => item.id !== report.id));
    } catch (error) {
      console.error('Unable to delete shared report:', error);
      alert(`Unable to delete this shared report. ${error?.message || ''}`.trim());
    } finally {
      setIsDeletingSharedReportId('');
    }
  };

  const clearProductReportUpload = () => {
    if (productFileInputRef.current) {
      productFileInputRef.current.value = '';
    }

    setSalesData([]);
    setAnalysis(null);
    setFileName('');
    setProductReportFileName('');
    setUnmatchedProducts([]);
    setDateStart('');
    setDateEnd('');
    setReportNetSales(null);
    setComparisonData([]);
    setReconciliation(null);
    setUploadedProductFile(null);

    localStorage.removeItem(LAST_UPLOAD_STORAGE_KEY);
  };

  const analyzeCosts = (
    data,
    paramDateStart = dateStart,
    paramDateEnd = dateEnd,
    paramReportNetSales = reportNetSales,
    paramSalesMetrics = null,
    paramWooOrderCount = null,
  ) => {
    const breakdown = [];
    const unmatched = [];
    const kitRows = [];
    let totalCOGS = 0;
    let totalOrders = 0;
    let shippingOrderCount = 0;
    let totalItemsSold = 0;
    let totalNetSales = 0;
    let totalKitItemsSold = 0;
    let totalKitOrders = 0;
    let totalKitNetSales = 0;

    const isIgnoredProduct = (title) => {
      const normalized = String(title || '').toLowerCase();
      return normalized.includes('bac water') || normalized.includes('bacteriostatic water');
    };

    // Keep non-kit products; BAC filtering is handled below.
    const singlesData = data.filter(row => {
      const productTitle = row['Product title'] || '';
      const category = row.Category || '';
      return !isKitOrMixCategory(category, productTitle);
    });

    // Shipping applies only to Kit and Kit/Singles mix categories.
    shippingOrderCount = data.reduce((sum, row) => {
      const productTitle = row['Product title'] || '';
      if (isIgnoredProduct(productTitle)) return sum;
      const category = row.Category || '';
      if (!isKitOrMixCategory(category, productTitle)) return sum;
      return sum + (parseInt(row.Orders) || 0);
    }, 0);

    data.forEach((row) => {
      const productTitle = row['Product title'] || '';
      const category = row.Category || '';
      if (!isKitOrMixCategory(category, productTitle)) return;
      if (isIgnoredProduct(productTitle)) return;

      const itemsSold = parseInt(row['Items sold']) || 0;
      const orders = parseInt(row.Orders) || 0;
      const netSales = parseNumber(
        row['Net sales']
        ?? row['Net Sales']
        ?? row['N. Revenue']
        ?? row['N. Revenue (formatted)']
        ?? row['Revenue']
      );

      if (!productTitle || itemsSold === 0) return;

      totalKitItemsSold += itemsSold;
      totalKitOrders += orders;
      totalKitNetSales += netSales;

      kitRows.push({
        product: productTitle,
        sku: row.SKU || '',
        category: category || 'Kits',
        itemsSold,
        orders,
        netSales,
        avgSellPrice: itemsSold > 0 ? netSales / itemsSold : 0,
      });
    });

    // Process each product
    singlesData.forEach(row => {
      const productTitle = row['Product title'] || '';
      const itemsSold = parseInt(row['Items sold']) || 0;
      const category = row.Category || '';
      const orders = parseInt(row.Orders) || 0;
      const netSales = parseNumber(
        row['Net sales']
        ?? row['Net Sales']
        ?? row['N. Revenue']
        ?? row['N. Revenue (formatted)']
        ?? row['Revenue']
      );

      if (!productTitle || itemsSold === 0) return;
      if (isIgnoredProduct(productTitle)) return;

      const unitCost = getCost(productTitle);

      if (unitCost !== null) {
        const productCOGS = unitCost * itemsSold;
        const productProfit = netSales - productCOGS;
        const profitMargin = netSales > 0 ? (productProfit / netSales) * 100 : 0;

        totalCOGS += productCOGS;
        totalOrders += orders;
        totalItemsSold += itemsSold;
        totalNetSales += netSales;

        breakdown.push({
          product: productTitle,
          category,
          itemsSold,
          unitCost,
          totalCost: productCOGS,
          orders,
          netSales,
          profit: productProfit,
          profitMargin,
        });
      } else {
        unmatched.push({
          product: productTitle,
          itemsSold,
          category,
          orders,
          netSales,
        });
      }
    });

    // Calculate metrics
    const shippingDeduction = shippingOrderCount * 5;
    const totalBillOwed = totalCOGS + shippingDeduction;
    const totalProfit = totalNetSales - totalCOGS;
    const profitMargin = totalNetSales > 0 ? (totalProfit / totalNetSales) * 100 : 0;
    const avgOrderValue = totalOrders > 0 ? totalNetSales / totalOrders : 0;
    const costPerOrder = totalOrders > 0 ? totalCOGS / totalOrders : 0;
    const grossSales = Number(paramSalesMetrics?.grossSales ?? paramReportNetSales ?? totalNetSales);
    const totalSales = Number(paramSalesMetrics?.totalSales ?? grossSales);
    const netSales = Number(paramSalesMetrics?.netSales ?? paramReportNetSales ?? totalNetSales);
    const totalWooOrders = Number(paramWooOrderCount ?? totalOrders);

    setUnmatchedProducts(unmatched);
    setAnalysis({
      breakdown: breakdown.sort((a, b) => b.profit - a.profit),
      totalCOGS,
      totalOrders,
      shippingOrderCount,
      totalItemsSold,
      shippingDeduction,
      totalBillOwed,
      netCost: totalCOGS - shippingDeduction,
      totalNetSales,
      reportNetSales: paramReportNetSales ?? totalNetSales,
      kitSales: {
        rows: kitRows.sort((a, b) => b.netSales - a.netSales),
        totalItemsSold: totalKitItemsSold,
        totalOrders: totalKitOrders,
        totalNetSales: totalKitNetSales,
      },
      totalProfit,
      profitMargin,
      avgOrderValue,
      costPerOrder,
      dateStart: paramDateStart,
      dateEnd: paramDateEnd,
      totalWooOrders,
      grossSales,
      totalSales,
      netSales,
    });
  };

  return (
    <div className="cost-analytics-page">
      <h1>Cost Analytics</h1>
      <p className="subtitle">Analyze product sales costs (Singles only)</p>

      {/* Upload Section */}
      <div className="upload-section">
        <div className="upload-inputs">
          <div className="input-source-toggle" role="tablist" aria-label="Input source selector">
            <button
              type="button"
              role="tab"
              aria-selected={inputSource === 'woo'}
              className={`input-source-btn ${inputSource === 'woo' ? 'active' : ''}`}
              onClick={() => setInputSource('woo')}
            >
              Pull Woo Data
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={inputSource === 'csv'}
              className={`input-source-btn ${inputSource === 'csv' ? 'active' : ''}`}
              onClick={() => setInputSource('csv')}
            >
              Load Product CSV
            </button>
          </div>
          <div className="input-group">
            {inputSource === 'csv' ? (
              <>
                <label htmlFor="product-upload" className="upload-label">
                  Product Report CSV:
                </label>
                <input
                  id="product-upload"
                  ref={productFileInputRef}
                  type="file"
                  accept=".csv"
                  onChange={handleProductReportUpload}
                  className="file-input"
                />
                {productReportFileName && <span className="file-name">Loaded: {productReportFileName}</span>}
                {productReportFileName && (
                  <button
                    type="button"
                    className="remove-upload-btn"
                    onClick={clearProductReportUpload}
                  >
                    Remove File
                  </button>
                )}
              </>
            ) : (
              <>
                <span className="upload-label">Woo Daily Orders:</span>
                <div className="woo-date-range-inputs">
                  <label className="woo-date-field">
                    From
                    <input
                      type="date"
                      value={wooPullStartDate}
                      onChange={(event) => setWooPullStartDate(event.target.value)}
                      className="date-input"
                    />
                  </label>
                  <label className="woo-date-field">
                    To
                    <input
                      type="date"
                      value={wooPullEndDate}
                      onChange={(event) => setWooPullEndDate(event.target.value)}
                      className="date-input"
                    />
                  </label>
                </div>
                <button
                  type="button"
                  className="woo-pull-btn"
                  onClick={() => pullWooDailyReport({ startDate: wooPullStartDate, endDate: wooPullEndDate })}
                  disabled={isPullingWoo}
                >
                  {isPullingWoo ? 'Pulling Woo (this may take a few minutes)...' : 'Pull Woo Data'}
                </button>
                <label className="woo-auto-toggle">
                  <input
                    type="checkbox"
                    checked={wooAutoPullEnabled}
                    onChange={(event) => setWooAutoPullEnabled(event.target.checked)}
                  />
                  Auto-pull every 1 min
                </label>
                {wooPullInfo && (
                  <span className="file-name">
                    Last pull: {wooPullInfo.startDate === wooPullInfo.endDate
                      ? wooPullInfo.startDate
                      : `${wooPullInfo.startDate} to ${wooPullInfo.endDate}`}
                  </span>
                )}
              </>
            )}
            <button
              type="button"
              className="save-shared-btn"
              onClick={saveReportToSharedDb}
              disabled={(!uploadedProductFile && !salesData.length) || isSavingSharedReport}
            >
              {isSavingSharedReport ? 'Saving...' : 'Save To Shared DB'}
            </button>
          </div>
          <button onClick={saveAnalysis} className="save-analysis-btn">💾 Save Analysis</button>
        </div>
      </div>

      {inputSource === 'csv' && (
        <div className="shared-reports-section">
          <h2>Shared Reports (All Users)</h2>
          {sharedReports.length === 0 ? (
            <p className="breakdown-subtitle">No shared reports yet.</p>
          ) : (
            <div className="table-wrapper">
              <table className="breakdown-table shared-reports-table">
                <thead>
                  <tr>
                    <th>File</th>
                    <th>Date Range</th>
                    <th className="number-head">Report Net Sales</th>
                    <th>Uploaded By</th>
                    <th>Uploaded At</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {sharedReports.map((report) => (
                    <tr key={report.id}>
                      <td className="product-name">{report.fileName}</td>
                      <td>
                        {report.dateStart && report.dateEnd
                          ? `${report.dateStart} to ${report.dateEnd}`
                          : 'Date not detected'}
                      </td>
                      <td className="number revenue">${(report.reportNetSales || 0).toFixed(2)}</td>
                      <td>{report.uploadedBy || 'Unknown'}</td>
                      <td>{report.uploadedAt ? report.uploadedAt.toLocaleString() : (report.uploadedAtIso || 'Unknown')}</td>
                      <td>
                        <div className="shared-actions">
                          <button
                            type="button"
                            className="load-btn shared-load-btn"
                            onClick={() => loadSharedReport(report)}
                            disabled={isLoadingSharedReportId === report.id || isDeletingSharedReportId === report.id}
                          >
                            {isLoadingSharedReportId === report.id ? 'Loading...' : 'Load'}
                          </button>
                          <button
                            type="button"
                            className="delete-btn shared-delete-btn"
                            onClick={() => deleteSharedReport(report)}
                            disabled={isDeletingSharedReportId === report.id || isLoadingSharedReportId === report.id}
                          >
                            {isDeletingSharedReportId === report.id ? 'Deleting...' : 'Delete'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {reconciliation && (
        <div className="reconciliation-section">
          <h2>Cross-Check: 2 Report Reconciliation</h2>
          <p className="breakdown-subtitle">
            Comparing normalized product totals between {productReportFileName || fileName || 'primary report'} and comparison report
          </p>

          <div className="summary-cards pricing-summary-cards">
            <div className="card">
              <div className="card-label">Matched Products</div>
              <div className="card-value">{reconciliation.matchedProducts}</div>
            </div>
            <div className="card">
              <div className="card-label">Only In Primary</div>
              <div className="card-value">{reconciliation.onlyInPrimary}</div>
            </div>
            <div className="card">
              <div className="card-label">Only In Comparison</div>
              <div className="card-value">{reconciliation.onlyInSecondary}</div>
            </div>
            <div className="card highlight">
              <div className="card-label">Mismatch Rows</div>
              <div className="card-value">{reconciliation.mismatchCount}</div>
            </div>
          </div>

          {reconciliation.rows.length > 0 ? (
            <div className="table-wrapper">
              <table className="breakdown-table pricing-compare-table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th className="number-head">Items Δ</th>
                    <th className="number-head">Orders Δ</th>
                    <th className="number-head">Net Sales Δ</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {reconciliation.rows.map((row, idx) => (
                    <tr key={`recon-${idx}`}>
                      <td className="product-name">{row.product}</td>
                      <td className={`number ${row.itemDiff === 0 ? '' : 'profit negative'}`}>{row.itemDiff}</td>
                      <td className={`number ${row.orderDiff === 0 ? '' : 'profit negative'}`}>{row.orderDiff}</td>
                      <td className={`number ${Math.abs(row.netDiff) < 0.01 ? '' : 'profit negative'}`}>${row.netDiff.toFixed(2)}</td>
                      <td>
                        <span className={`recon-status-badge ${row.status === 'Mismatch' ? 'bad' : 'warn'}`}>
                          {row.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="pricing-quick-note">No mismatches found between the two uploaded reports.</div>
          )}
        </div>
      )}

      <div className="cost-view-tabs" role="tablist" aria-label="Cost analytics views">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'analysis'}
          className={`cost-view-tab ${activeTab === 'analysis' ? 'active' : ''}`}
          onClick={() => setActiveTab('analysis')}
        >
          Analysis
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'coupons'}
          className={`cost-view-tab ${activeTab === 'coupons' ? 'active' : ''}`}
          onClick={() => setActiveTab('coupons')}
        >
          Affiliate/Coupons
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'pricing'}
          className={`cost-view-tab ${activeTab === 'pricing' ? 'active' : ''}`}
          onClick={() => setActiveTab('pricing')}
        >
          Vendor vs Sell
        </button>
      </div>

      {activeTab === 'pricing' && (
        <div className="pricing-view-section">
          {pricingSource ? (
            <>
              <div className="summary-cards pricing-summary-cards">
                <div className="card">
                  <div className="card-label">Weighted Unit Cost</div>
                  <div className="card-value">${weightedUnitCost.toFixed(2)}</div>
                </div>
                <div className="card">
                  <div className="card-label">Weighted Unit Sell</div>
                  <div className="card-value">${weightedUnitSell.toFixed(2)}</div>
                </div>
                <div className="card highlight">
                  <div className="card-label">Weighted Margin</div>
                  <div className="card-value">{weightedMarginPct.toFixed(1)}%</div>
                </div>
                <div className="card">
                  <div className="card-label">Low Margin Products (&lt;30%)</div>
                  <div className="card-value">{lowMarginCount}</div>
                </div>
              </div>

              {highestSpreadProduct && (
                <div className="pricing-quick-note">
                  Highest spread right now: <strong>{highestSpreadProduct.product}</strong> at
                  {' '}${highestSpreadProduct.unitSpread.toFixed(2)} per unit.
                </div>
              )}

              <div className="breakdown-section">
                <h2>Vendor Cost vs Sell Price</h2>
                <p className="breakdown-subtitle">
                  Grouped by category using matched products in the loaded report
                </p>
                {pricingCategories.map((category) => (
                  <div key={category} className="pricing-category-group">
                    <h3>{category}</h3>
                    <div className="table-wrapper">
                      <table className="breakdown-table pricing-compare-table">
                        <thead>
                          <tr>
                            <th>Product</th>
                            <th className="category-col">Category</th>
                            <th className="number-head">Vendor Cost</th>
                            <th className="number-head">Sell Price</th>
                            <th className="number-head">Profit</th>
                            <th className="number-head">Margin</th>
                            <th>Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {pricingRowsByCategory[category].map((item, idx) => (
                            <tr key={`${category}-${idx}`}>
                              <td className="product-name">{item.product}</td>
                              <td className="category-col">{item.category || 'Uncategorized'}</td>
                              <td className="number cost">${item.unitCost.toFixed(2)}</td>
                              <td className="number revenue">${item.sellPrice.toFixed(2)}</td>
                              <td className={`number profit ${item.unitSpread >= 0 ? 'positive' : 'negative'}`}>
                                ${item.unitSpread.toFixed(2)}
                              </td>
                              <td className={`number profit ${item.marginPct >= 0 ? 'positive' : 'negative'}`}>
                                {item.marginPct.toFixed(1)}%
                              </td>
                              <td>
                                <span className={`margin-status-badge ${getMarginStatus(item.marginPct)}`}>
                                  {getMarginStatus(item.marginPct) === 'good' ? 'Good' : 'Bad'}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="empty-state">
              <p>Upload your sales CSV file to compare vendor costs against sell prices</p>
            </div>
          )}
        </div>
      )}

      {activeTab === 'coupons' && (
        <AffiliatePayouts
          onSuccess={showSuccessToast}
          onError={(msg) => alert(msg)}
        />
      )}

      {activeTab === 'analysis' && (
        <>

      {/* Saved Analyses */}
      {savedAnalyses.length > 0 && (
        <div className="saved-analyses-section">
          <h2>Saved Analyses</h2>
          <div className="saved-analyses-list">
            {savedAnalyses.map((saved) => (
              <div key={saved.key} className="saved-analysis-card">
                <div className="saved-analysis-header">
                  <span className="saved-date-range">
                    {(() => {
                      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                      const [sYear, sMonth, sDay] = saved.dateStart.split('-');
                      const [eYear, eMonth, eDay] = saved.dateEnd.split('-');
                      return `${monthNames[parseInt(sMonth) - 1]} ${parseInt(sDay)} — ${monthNames[parseInt(eMonth) - 1]} ${parseInt(eDay)}, ${eYear}`;
                    })()}
                  </span>
                  <span className="saved-time">Saved: {saved.savedAt}</span>
                </div>
                <div className="saved-analysis-file">File: {saved.fileName}</div>
                <div className="saved-analysis-stats">
                  <span className="stat">Revenue: ${saved.analysis.totalNetSales.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                  <span className="stat">Profit: ${saved.analysis.totalProfit.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                  <span className="stat">Margin: {saved.analysis.profitMargin.toFixed(1)}%</span>
                </div>
                <div className="saved-analysis-actions">
                  <button onClick={() => loadAnalysis(saved)} className="load-btn">Load</button>
                  <button onClick={() => deleteAnalysis(saved.key)} className="delete-btn">Delete</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Combine Analyses Section */}
      {savedAnalyses.length > 1 && (
        <div className="combine-analyses-section">
          <h2>Combine Multiple Periods</h2>
          <p className="combine-subtitle">Select 2+ analyses to view combined totals</p>
          <div className="combine-checklist">
            {savedAnalyses.map((saved) => (
              <label key={saved.key} className="combine-item">
                <input
                  type="checkbox"
                  checked={selectedForCombine.includes(saved.key)}
                  onChange={() => toggleAnalysisForCombine(saved.key)}
                  className="combine-checkbox"
                />
                <span className="combine-label">
                  {(() => {
                    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                    const [sYear, sMonth, sDay] = saved.dateStart.split('-');
                    const [eYear, eMonth, eDay] = saved.dateEnd.split('-');
                    return `${monthNames[parseInt(sMonth) - 1]} ${parseInt(sDay)} — ${monthNames[parseInt(eMonth) - 1]} ${parseInt(eDay)}, ${eYear}`;
                  })()}
                </span>
                <span className="combine-revenue">${saved.analysis.totalProfit.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
              </label>
            ))}
          </div>
          <button
            onClick={combineAnalyses}
            disabled={selectedForCombine.length < 2}
            className="combine-btn"
          >
            🔗 Combine {selectedForCombine.length} Period{selectedForCombine.length !== 1 ? 's' : ''}
          </button>
        </div>
      )}

      {/* Combined Analysis Results */}
      {combinedAnalysis && (
        <div className="analysis-results combined">
          <div className="combined-header">
            <h2>📊 Combined Results ({combinedAnalysis.periodLabel})</h2>
            <button onClick={() => setCombinedAnalysis(null)} className="close-combined-btn">Clear</button>
          </div>

          {/* Date Range */}
          <div className="date-range-display">
            <span className="date-label">Period Range:</span>
            <span className="date-value">
              {(() => {
                const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                const [sYear, sMonth, sDay] = combinedAnalysis.dateStart.split('-');
                const [eYear, eMonth, eDay] = combinedAnalysis.dateEnd.split('-');
                return `${monthNames[parseInt(sMonth) - 1]} ${parseInt(sDay)}, ${sYear} — ${monthNames[parseInt(eMonth) - 1]} ${parseInt(eDay)}, ${eYear}`;
              })()}
            </span>
          </div>

          {/* Summary Cards */}
          <div className="summary-cards">
            <div className="card">
              <div className="card-label">Gross Sales</div>
              <div className="card-value">${(combinedAnalysis.grossSales ?? combinedAnalysis.reportNetSales ?? combinedAnalysis.totalNetSales).toFixed(2)}</div>
            </div>
            <div className="card">
              <div className="card-label">Total Sales</div>
              <div className="card-value">${(combinedAnalysis.totalSales ?? combinedAnalysis.grossSales ?? combinedAnalysis.reportNetSales ?? combinedAnalysis.totalNetSales).toFixed(2)}</div>
            </div>
            <div className="card">
              <div className="card-label">Net Sales</div>
              <div className="card-value">${(combinedAnalysis.netSales ?? combinedAnalysis.reportNetSales ?? combinedAnalysis.totalNetSales).toFixed(2)}</div>
            </div>
            <div className="card">
              <div className="card-label">Profit Margin</div>
              <div className="card-value">{combinedAnalysis.profitMargin.toFixed(1)}%</div>
            </div>
            <div className="card">
              <div className="card-label">Avg Order Value</div>
              <div className="card-value">${combinedAnalysis.avgOrderValue.toFixed(2)}</div>
            </div>
            <div className="card">
              <div className="card-label">Paid Orders (Woo)</div>
              <div className="card-value">{combinedAnalysis.totalWooOrders ?? combinedAnalysis.totalOrders}</div>
            </div>
            <div className="card">
              <div className="card-label">Filtered Orders (Cost Model)</div>
              <div className="card-value">{combinedAnalysis.totalOrders}</div>
            </div>
            <div className="card">
              <div className="card-label">Sales Mix (Single/Kit)</div>
              <div className="card-value">{combinedSalesMix.singlePct.toFixed(1)}% / {combinedSalesMix.kitPct.toFixed(1)}%</div>
            </div>
          </div>

          <div className="bill-owed-section">
            <h3>Total Bill Owed (Products + Shipping)</h3>
            <div className="bill-rows">
              <div className="bill-row">
                <span>Product Costs (COGS)</span>
                <span>${combinedAnalysis.totalCOGS.toFixed(2)}</span>
              </div>
              <div className="bill-row">
                <span>Shipping Orders (${5} charge)</span>
                <span>{combinedAnalysis.shippingOrderCount ?? combinedAnalysis.totalOrders}</span>
              </div>
              <div className="bill-row">
                <span>Estimated Shipping (${5}/kit or mix order)</span>
                <span>${combinedAnalysis.shippingDeduction.toFixed(2)}</span>
              </div>
              <div className="bill-row total">
                <span>Total Bill Owed</span>
                <span>${combinedAnalysis.totalBillOwed.toFixed(2)}</span>
              </div>
            </div>
          </div>

          <div className="cost-view-tabs details-tabs" role="tablist" aria-label="Combined details views">
            <button
              type="button"
              role="tab"
              aria-selected={combinedDetailsTab === 'products'}
              className={`cost-view-tab ${combinedDetailsTab === 'products' ? 'active' : ''}`}
              onClick={() => setCombinedDetailsTab('products')}
            >
              Single Vial Data
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={combinedDetailsTab === 'kits'}
              className={`cost-view-tab ${combinedDetailsTab === 'kits' ? 'active' : ''}`}
              onClick={() => setCombinedDetailsTab('kits')}
              disabled={!combinedAnalysis.kitSales?.rows?.length}
            >
              Kit Data
            </button>
          </div>

          {combinedDetailsTab === 'kits' && (
            <div className="breakdown-section kit-sales-section">
              <h2>Kit Sales Data</h2>
              {combinedAnalysis.kitSales?.rows?.length > 0 ? (
                <>
                  <p className="breakdown-subtitle">
                    {combinedAnalysis.kitSales.rows.length} kit products • {combinedAnalysis.kitSales.totalItemsSold} units • {combinedAnalysis.kitSales.totalOrders} orders
                  </p>
                  <div className="summary-cards pricing-summary-cards">
                    <div className="card">
                      <div className="card-label">Kit Net Sales</div>
                      <div className="card-value">${combinedAnalysis.kitSales.totalNetSales.toFixed(2)}</div>
                    </div>
                    <div className="card">
                      <div className="card-label">Kit Units Sold</div>
                      <div className="card-value">{combinedAnalysis.kitSales.totalItemsSold}</div>
                    </div>
                    <div className="card">
                      <div className="card-label">Kit Orders</div>
                      <div className="card-value">{combinedAnalysis.kitSales.totalOrders}</div>
                    </div>
                  </div>
                  <div className="table-wrapper">
                    <table className="breakdown-table pricing-compare-table">
                      <thead>
                        <tr>
                          <th>Product</th>
                          <th>Category</th>
                          <th className="number-head">Units</th>
                          <th className="number-head">Orders</th>
                          <th className="number-head">Net Sales</th>
                          <th className="number-head">Avg Sell</th>
                        </tr>
                      </thead>
                      <tbody>
                        {combinedAnalysis.kitSales.rows.map((item, idx) => (
                          <tr key={`combined-kit-${idx}`}>
                            <td className="product-name">{item.product}</td>
                            <td>{item.category || 'Kits'}</td>
                            <td className="number">{item.itemsSold}</td>
                            <td className="number">{item.orders}</td>
                            <td className="number revenue">${item.netSales.toFixed(2)}</td>
                            <td className="number">${item.avgSellPrice.toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <div className="empty-state">
                  <p>No kit data found for this combined period.</p>
                </div>
              )}
            </div>
          )}

          {combinedDetailsTab === 'products' && (
            <div className="breakdown-section">
              <h2>Single Vial Data (Combined)</h2>
              <div className="summary-cards pricing-summary-cards">
                <div className="card">
                  <div className="card-label">Single Vial Sales</div>
                  <div className="card-value">${combinedAnalysis.totalNetSales.toFixed(2)}</div>
                </div>
                <div className="card">
                  <div className="card-label">Single Vial COGS</div>
                  <div className="card-value">${combinedAnalysis.totalCOGS.toFixed(2)}</div>
                </div>
                <div className="card highlight">
                  <div className="card-label">Single Vial Profit</div>
                  <div className="card-value">${combinedAnalysis.totalProfit.toFixed(2)}</div>
                </div>
              </div>
              <p className="breakdown-subtitle">
                {combinedAnalysis.breakdown.length} products matched • {combinedAnalysis.totalItemsSold} total units sold
              </p>
              <div className="table-wrapper">
                <table className="breakdown-table">
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th>Category</th>
                      <th>Qty Sold</th>
                      <th className="number-head">Avg Sell Price</th>
                      <th>Total COGS</th>
                      <th>Net Sales</th>
                      <th>Profit</th>
                      <th>Margin %</th>
                      <th>Orders</th>
                    </tr>
                  </thead>
                  <tbody>
                    {combinedAnalysis.breakdown.map((item, idx) => (
                      <tr key={idx}>
                        <td className="product-name">{item.product}</td>
                        <td>{item.category}</td>
                        <td className="number">{item.itemsSold}</td>
                        <td className="number revenue">${(item.itemsSold > 0 ? item.netSales / item.itemsSold : 0).toFixed(2)}</td>
                        <td className="number cost">${item.totalCost.toFixed(2)}</td>
                        <td className="number revenue">${item.netSales.toFixed(2)}</td>
                        <td className={`number profit ${item.profit > 0 ? 'positive' : 'negative'}`}>${item.profit.toFixed(2)}</td>
                        <td className="number">{item.profitMargin.toFixed(1)}%</td>
                        <td className="number">{item.orders}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Analysis Results */}
      {analysis && (
        <div className="analysis-results">
          {/* Date Range Display */}
          {(analysis.dateStart || analysis.dateEnd) && (
            <div className="date-range-display">
              <span className="date-label">Period:</span>
              <span className="date-value">
                {(() => {
                  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                  let startStr = 'Start date';
                  let endStr = 'End date';
                  
                  if (analysis.dateStart) {
                    const [sYear, sMonth, sDay] = analysis.dateStart.split('-');
                    startStr = `${monthNames[parseInt(sMonth) - 1]} ${parseInt(sDay)}, ${sYear}`;
                  }
                  if (analysis.dateEnd) {
                    const [eYear, eMonth, eDay] = analysis.dateEnd.split('-');
                    endStr = `${monthNames[parseInt(eMonth) - 1]} ${parseInt(eDay)}, ${eYear}`;
                  }
                  
                  return `${startStr} — ${endStr}`;
                })()}
              </span>
            </div>
          )}

          {/* Summary Cards */}
          <div className="summary-cards">
            <div className="card">
              <div className="card-label">Gross Sales</div>
              <div className="card-value">${(analysis.grossSales ?? analysis.reportNetSales ?? analysis.totalNetSales).toFixed(2)}</div>
            </div>
            <div className="card">
              <div className="card-label">Total Sales</div>
              <div className="card-value">${(analysis.totalSales ?? analysis.grossSales ?? analysis.reportNetSales ?? analysis.totalNetSales).toFixed(2)}</div>
            </div>
            <div className="card">
              <div className="card-label">Net Sales</div>
              <div className="card-value">${(analysis.netSales ?? analysis.reportNetSales ?? analysis.totalNetSales).toFixed(2)}</div>
            </div>
            <div className="card">
              <div className="card-label">Profit Margin</div>
              <div className="card-value">{analysis.profitMargin.toFixed(1)}%</div>
            </div>
            <div className="card">
              <div className="card-label">Avg Order Value</div>
              <div className="card-value">${analysis.avgOrderValue.toFixed(2)}</div>
            </div>
            <div className="card">
              <div className="card-label">Paid Orders (Woo)</div>
              <div className="card-value">{analysis.totalWooOrders ?? analysis.totalOrders}</div>
            </div>
            <div className="card">
              <div className="card-label">Filtered Orders (Cost Model)</div>
              <div className="card-value">{analysis.totalOrders}</div>
            </div>
            <div className="card">
              <div className="card-label">Sales Mix (Single/Kit)</div>
              <div className="card-value">{analysisSalesMix.singlePct.toFixed(1)}% / {analysisSalesMix.kitPct.toFixed(1)}%</div>
            </div>
          </div>

          <div className="bill-owed-section">
            <h3>Total Bill Owed (Products + Shipping)</h3>
            <div className="bill-rows">
              <div className="bill-row">
                <span>Product Costs (COGS)</span>
                <span>${analysis.totalCOGS.toFixed(2)}</span>
              </div>
              <div className="bill-row">
                <span>Shipping Orders (${5} charge)</span>
                <span>{analysis.shippingOrderCount ?? analysis.totalOrders}</span>
              </div>
              <div className="bill-row">
                <span>Estimated Shipping (${5}/kit or mix order)</span>
                <span>${analysis.shippingDeduction.toFixed(2)}</span>
              </div>
              <div className="bill-row total">
                <span>Total Bill Owed</span>
                <span>${analysis.totalBillOwed.toFixed(2)}</span>
              </div>
            </div>
          </div>

          <div className="cost-view-tabs details-tabs" role="tablist" aria-label="Analysis details views">
            <button
              type="button"
              role="tab"
              aria-selected={analysisDetailsTab === 'products'}
              className={`cost-view-tab ${analysisDetailsTab === 'products' ? 'active' : ''}`}
              onClick={() => setAnalysisDetailsTab('products')}
            >
              Single Vial Data
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={analysisDetailsTab === 'kits'}
              className={`cost-view-tab ${analysisDetailsTab === 'kits' ? 'active' : ''}`}
              onClick={() => setAnalysisDetailsTab('kits')}
              disabled={!analysis.kitSales?.rows?.length}
            >
              Kit Data
            </button>
          </div>

          {analysisDetailsTab === 'kits' && (
            <div className="breakdown-section kit-sales-section">
              <h2>Kit Sales Data</h2>
              {analysis.kitSales?.rows?.length > 0 ? (
                <>
                  <p className="breakdown-subtitle">
                    {analysis.kitSales.rows.length} kit products • {analysis.kitSales.totalItemsSold} units • {analysis.kitSales.totalOrders} orders
                  </p>
                  <div className="summary-cards pricing-summary-cards">
                    <div className="card">
                      <div className="card-label">Kit Net Sales</div>
                      <div className="card-value">${analysis.kitSales.totalNetSales.toFixed(2)}</div>
                    </div>
                    <div className="card">
                      <div className="card-label">Kit Units Sold</div>
                      <div className="card-value">{analysis.kitSales.totalItemsSold}</div>
                    </div>
                    <div className="card">
                      <div className="card-label">Kit Orders</div>
                      <div className="card-value">{analysis.kitSales.totalOrders}</div>
                    </div>
                  </div>
                  <div className="table-wrapper">
                    <table className="breakdown-table pricing-compare-table">
                      <thead>
                        <tr>
                          <th>Product</th>
                          <th>SKU</th>
                          <th>Category</th>
                          <th className="number-head">Units</th>
                          <th className="number-head">Orders</th>
                          <th className="number-head">Net Sales</th>
                          <th className="number-head">Avg Sell</th>
                        </tr>
                      </thead>
                      <tbody>
                        {analysis.kitSales.rows.map((item, idx) => (
                          <tr key={`kit-${idx}`}>
                            <td className="product-name">{item.product}</td>
                            <td>{item.sku || 'N/A'}</td>
                            <td>{item.category || 'Kits'}</td>
                            <td className="number">{item.itemsSold}</td>
                            <td className="number">{item.orders}</td>
                            <td className="number revenue">${item.netSales.toFixed(2)}</td>
                            <td className="number">${item.avgSellPrice.toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <div className="empty-state">
                  <p>No kit data found for this report.</p>
                </div>
              )}
            </div>
          )}

          {analysisDetailsTab === 'products' && (
            <div className="breakdown-section">
              <h2>Single Vial Data</h2>
              <div className="summary-cards pricing-summary-cards">
                <div className="card">
                  <div className="card-label">Single Vial Sales</div>
                  <div className="card-value">${analysis.totalNetSales.toFixed(2)}</div>
                </div>
                <div className="card">
                  <div className="card-label">Single Vial COGS</div>
                  <div className="card-value">${analysis.totalCOGS.toFixed(2)}</div>
                </div>
                <div className="card highlight">
                  <div className="card-label">Single Vial Profit</div>
                  <div className="card-value">${analysis.totalProfit.toFixed(2)}</div>
                </div>
              </div>
              <p className="breakdown-subtitle">
                {analysis.breakdown.length} products matched • {analysis.totalItemsSold} total units sold
              </p>
              <div className="table-wrapper">
                <table className="breakdown-table">
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th className="category-col">Category</th>
                      <th className="number-head">Qty Sold</th>
                      <th className="number-head">Vendor Cost</th>
                      <th className="number-head sell-price-col">Avg Sell Price</th>
                      <th className="number-head">Total COGS</th>
                      <th className="number-head">Net Sales</th>
                      <th className="number-head">Profit</th>
                      <th className="number-head">Margin %</th>
                      <th className="number-head">Orders</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analysis.breakdown.map((item, idx) => (
                      <tr key={idx}>
                        <td className="product-name">{item.product}</td>
                        <td className="category-col">{item.category}</td>
                        <td className="number">{item.itemsSold}</td>
                        <td className="number">${item.unitCost.toFixed(2)}</td>
                        <td className="number revenue sell-price-col">${(item.itemsSold > 0 ? item.netSales / item.itemsSold : 0).toFixed(2)}</td>
                        <td className="number cost">${item.totalCost.toFixed(2)}</td>
                        <td className="number revenue">${item.netSales.toFixed(2)}</td>
                        <td className={`number profit ${item.profit > 0 ? 'positive' : 'negative'}`}>${item.profit.toFixed(2)}</td>
                        <td className="number">{item.profitMargin.toFixed(1)}%</td>
                        <td className="number">{item.orders}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Business Insights */}
          <div className="insights-section">
            <h2>Business Insights & Opportunities</h2>
            <div className="insights-grid">
              {/* Top Products by Profit */}
              <div className="insight-card">
                <h3>💰 Top 5 by Profit</h3>
                <div className="insight-list">
                  {analysis.breakdown
                    .sort((a, b) => b.profit - a.profit)
                    .slice(0, 5)
                    .map((item, idx) => (
                      <div key={idx} className="insight-item">
                        <div className="insight-product">{item.product}</div>
                        <div className="insight-value">${item.profit.toFixed(2)}</div>
                      </div>
                    ))}
                </div>
              </div>

              {/* Top Products by Margin */}
              <div className="insight-card">
                <h3>📈 Top 5 by Margin %</h3>
                <div className="insight-list">
                  {analysis.breakdown
                    .sort((a, b) => b.profitMargin - a.profitMargin)
                    .slice(0, 5)
                    .map((item, idx) => (
                      <div key={idx} className="insight-item">
                        <div className="insight-product">{item.product}</div>
                        <div className="insight-value">{item.profitMargin.toFixed(1)}%</div>
                      </div>
                    ))}
                </div>
              </div>

              {/* Low Margin Alert */}
              <div className="insight-card warning">
                <h3>⚠️ Low Margin Products (&lt;20%)</h3>
                <div className="insight-list">
                  {analysis.breakdown.filter(item => item.profitMargin < 20).length > 0 ? (
                    analysis.breakdown
                      .filter(item => item.profitMargin < 20)
                      .sort((a, b) => a.profitMargin - b.profitMargin)
                      .slice(0, 5)
                      .map((item, idx) => (
                        <div key={idx} className="insight-item">
                          <div className="insight-product">{item.product}</div>
                          <div className="insight-value">{item.profitMargin.toFixed(1)}%</div>
                        </div>
                      ))
                  ) : (
                    <div className="insight-item">
                      <span style={{ color: '#27ae60' }}>✓ All products have healthy margins!</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Best Sellers by Volume */}
              <div className="insight-card">
                <h3>📦 Best Sellers by Volume</h3>
                <div className="insight-list">
                  {analysis.breakdown
                    .sort((a, b) => b.itemsSold - a.itemsSold)
                    .slice(0, 5)
                    .map((item, idx) => (
                      <div key={idx} className="insight-item">
                        <div className="insight-product">{item.product}</div>
                        <div className="insight-value">{item.itemsSold} units</div>
                      </div>
                    ))}
                </div>
              </div>
            </div>
          </div>

          {/* Unmatched Products */}
          {unmatchedProducts.length > 0 && (
            <div className="unmatched-section">
              <h3>⚠️ Products Not in Cost Database ({unmatchedProducts.length})</h3>
              <p className="unmatched-note">
                These products sold but don't have cost data. Add them to costDatabase.js to include in analysis.
              </p>
              <div className="unmatched-list">
                {unmatchedProducts.map((item, idx) => (
                  <div key={idx} className="unmatched-item">
                    <strong>{item.product}</strong>
                    <span className="meta">
                      {item.itemsSold} units • Category: {item.category || 'N/A'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Empty State */}
      {!analysis && (
        <div className="empty-state">
          <p>Upload your sales CSV file to see cost analysis</p>
        </div>
      )}

      {successToastMessage && (
        <div className="success-toast" role="status" aria-live="polite">
          {successToastMessage}
        </div>
      )}
        </>
      )}
    </div>
  );
};

export default CostAnalytics;
