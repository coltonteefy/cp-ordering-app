import React, { useState, useEffect } from 'react';
import { costDatabase, getCost } from '../data/costDatabase';
import './CostAnalytics.css';

const CostAnalytics = () => {
  const [salesData, setSalesData] = useState([]);
  const [analysis, setAnalysis] = useState(null);
  const [fileName, setFileName] = useState('');
  const [unmatchedProducts, setUnmatchedProducts] = useState([]);
  const [dateStart, setDateStart] = useState('');
  const [dateEnd, setDateEnd] = useState('');
  const [savedAnalyses, setSavedAnalyses] = useState([]);
  const [selectedForCombine, setSelectedForCombine] = useState([]);
  const [combinedAnalysis, setCombinedAnalysis] = useState(null);

  // Load saved dates and analyses from localStorage on mount
  useEffect(() => {
    const savedDateStart = localStorage.getItem('costAnalyticsDateStart');
    const savedDateEnd = localStorage.getItem('costAnalyticsDateEnd');
    if (savedDateStart) setDateStart(savedDateStart);
    if (savedDateEnd) setDateEnd(savedDateEnd);
    
    const saved = localStorage.getItem('costAnalysesSaved');
    if (saved) {
      try {
        setSavedAnalyses(JSON.parse(saved));
      } catch (error) {
        console.error('Error loading saved analyses:', error);
      }
    }
  }, []);

  // Re-analyze when date range changes (if data is loaded)
  useEffect(() => {
    if (salesData.length > 0) {
      analyzeCosts(salesData);
    }
    // Save dates to localStorage
    localStorage.setItem('costAnalyticsDateStart', dateStart);
    localStorage.setItem('costAnalyticsDateEnd', dateEnd);
  }, [dateStart, dateEnd]);

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
      alert(`Analysis saved for ${dateStart} to ${dateEnd}. Auto-combined ${sameMonthSaved.length} reports for ${saveMonth}.`);
      return;
    }

    alert(`Analysis saved for ${dateStart} to ${dateEnd}`);
  };
  
  const loadAnalysis = (saved) => {
    setAnalysis(saved.analysis);
    setDateStart(saved.dateStart);
    setDateEnd(saved.dateEnd);
    setFileName(saved.fileName);
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
    let totalItemsSold = 0;
    let totalNetSales = 0;
    const productMap = {}; // Map to aggregate product data

    selectedSaved.forEach(saved => {
      totalCOGS += saved.analysis.totalCOGS;
      totalOrders += saved.analysis.totalOrders;
      totalItemsSold += saved.analysis.totalItemsSold;
      totalNetSales += saved.analysis.totalNetSales;

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
    const shippingDeduction = totalOrders * 5;
    const totalBillOwed = totalCOGS + shippingDeduction;
    const totalProfit = totalNetSales - totalCOGS;
    const profitMargin = totalNetSales > 0 ? (totalProfit / totalNetSales) * 100 : 0;
    const avgOrderValue = totalOrders > 0 ? totalNetSales / totalOrders : 0;

    // Calculate margin for each product
    const breakdown = Object.values(productMap).map(product => ({
      ...product,
      profitMargin: product.netSales > 0 ? (product.profit / product.netSales) * 100 : 0,
    }));

    const dateStarts = selectedSaved.map(s => s.dateStart).sort();
    const dateEnds = selectedSaved.map(s => s.dateEnd).sort().reverse();

    return {
      breakdown: breakdown.sort((a, b) => b.profit - a.profit),
      totalCOGS,
      totalOrders,
      totalItemsSold,
      shippingDeduction,
      totalBillOwed,
      netCost: totalCOGS - shippingDeduction,
      totalNetSales,
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

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setFileName(file.name);
    
    // Extract dates from filename if available
    const extractedDates = extractDatesFromFilename(file.name);
    const newDateStart = extractedDates?.startDate || dateStart;
    const newDateEnd = extractedDates?.endDate || dateEnd;
    
    if (extractedDates) {
      setDateStart(newDateStart);
      setDateEnd(newDateEnd);
    }

    const reader = new FileReader();

    reader.onload = (event) => {
      try {
        const csv = event.target.result;
        const lines = csv.split('\n');
        const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
        const data = [];

        for (let i = 1; i < lines.length; i++) {
          if (!lines[i].trim()) continue;

          const values = lines[i].split(',').map(v => v.trim().replace(/^"|"$/g, ''));
          const row = {};
          headers.forEach((header, idx) => {
            row[header] = values[idx] || '';
          });
          data.push(row);
        }

        setSalesData(data);
        analyzeCosts(data, newDateStart, newDateEnd);
      } catch (error) {
        alert('Error parsing CSV: ' + error.message);
      }
    };

    reader.readAsText(file);
  };

  const analyzeCosts = (data, paramDateStart = dateStart, paramDateEnd = dateEnd) => {
    const breakdown = [];
    const unmatched = [];
    let totalCOGS = 0;
    let totalOrders = 0;
    let totalItemsSold = 0;
    let totalNetSales = 0;

    // Filter for Singles only (exclude Kits)
    const singlesData = data.filter(row => {
      const category = row.Category || '';
      return category !== 'Kits' && category.trim() !== '';
    });

    // Process each product
    singlesData.forEach(row => {
      const productTitle = row['Product title'] || '';
      const itemsSold = parseInt(row['Items sold']) || 0;
      const category = row.Category || '';
      const orders = parseInt(row.Orders) || 0;
      const netSales = parseFloat(row['Net sales']) || 0;

      if (!productTitle || itemsSold === 0) return;

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
    const shippingDeduction = totalOrders * 5;
    const totalBillOwed = totalCOGS + shippingDeduction;
    const totalProfit = totalNetSales - totalCOGS;
    const profitMargin = totalNetSales > 0 ? (totalProfit / totalNetSales) * 100 : 0;
    const avgOrderValue = totalOrders > 0 ? totalNetSales / totalOrders : 0;
    const costPerOrder = totalOrders > 0 ? totalCOGS / totalOrders : 0;

    setUnmatchedProducts(unmatched);
    setAnalysis({
      breakdown: breakdown.sort((a, b) => b.profit - a.profit),
      totalCOGS,
      totalOrders,
      totalItemsSold,
      shippingDeduction,
      totalBillOwed,
      netCost: totalCOGS - shippingDeduction,
      totalNetSales,
      totalProfit,
      profitMargin,
      avgOrderValue,
      costPerOrder,
      dateStart: paramDateStart,
      dateEnd: paramDateEnd,
    });
  };

  return (
    <div className="cost-analytics-page">
      <h1>Cost Analytics</h1>
      <p className="subtitle">Analyze product sales costs (Singles only)</p>

      {/* Upload Section */}
      <div className="upload-section">
        <div className="upload-inputs">
          <div className="input-group">
            <label htmlFor="csv-upload" className="upload-label">
              Upload Sales CSV:
            </label>
            <input
              id="csv-upload"
              type="file"
              accept=".csv"
              onChange={handleFileUpload}
              className="file-input"
            />
            {fileName && <span className="file-name">Loaded: {fileName}</span>}
          </div>
          <div className="date-inputs">
            <div className="date-input-group">
              <label htmlFor="date-start">From:</label>
              <input
                id="date-start"
                type="date"
                value={dateStart}
                onChange={(e) => setDateStart(e.target.value)}
                className="date-input"
              />
            </div>
            <div className="date-input-group">
              <label htmlFor="date-end">To:</label>
              <input
                id="date-end"
                type="date"
                value={dateEnd}
                onChange={(e) => setDateEnd(e.target.value)}
                className="date-input"
              />
            </div>
          </div>
          <button onClick={saveAnalysis} className="save-analysis-btn">💾 Save Analysis</button>
        </div>
      </div>

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
              <div className="card-label">Net Sales</div>
              <div className="card-value">${combinedAnalysis.totalNetSales.toFixed(2)}</div>
            </div>
            <div className="card">
              <div className="card-label">Total COGS</div>
              <div className="card-value">${combinedAnalysis.totalCOGS.toFixed(2)}</div>
            </div>
            <div className="card highlight">
              <div className="card-label">Total Profit</div>
              <div className="card-value">${combinedAnalysis.totalProfit.toFixed(2)}</div>
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
              <div className="card-label">Total Orders</div>
              <div className="card-value">{combinedAnalysis.totalOrders}</div>
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
                <span>Estimated Shipping (${5}/order)</span>
                <span>${combinedAnalysis.shippingDeduction.toFixed(2)}</span>
              </div>
              <div className="bill-row total">
                <span>Total Bill Owed</span>
                <span>${combinedAnalysis.totalBillOwed.toFixed(2)}</span>
              </div>
            </div>
          </div>

          {/* Combined Breakdown Table */}
          <div className="breakdown-section">
            <h2>Product Performance (Combined)</h2>
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
              <div className="card-label">Net Sales (Revenue)</div>
              <div className="card-value">${analysis.totalNetSales.toFixed(2)}</div>
            </div>
            <div className="card">
              <div className="card-label">Total COGS</div>
              <div className="card-value">${analysis.totalCOGS.toFixed(2)}</div>
            </div>
            <div className="card highlight">
              <div className="card-label">Total Profit</div>
              <div className="card-value">${analysis.totalProfit.toFixed(2)}</div>
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
              <div className="card-label">Total Orders</div>
              <div className="card-value">{analysis.totalOrders}</div>
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
                <span>Estimated Shipping (${5}/order)</span>
                <span>${analysis.shippingDeduction.toFixed(2)}</span>
              </div>
              <div className="bill-row total">
                <span>Total Bill Owed</span>
                <span>${analysis.totalBillOwed.toFixed(2)}</span>
              </div>
            </div>
          </div>

          {/* Breakdown Table */}
          <div className="breakdown-section">
            <h2>Product Breakdown</h2>
            <p className="breakdown-subtitle">
              {analysis.breakdown.length} products matched • {analysis.totalItemsSold} total units sold
            </p>
            <div className="table-wrapper">
              <table className="breakdown-table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Category</th>
                    <th>Qty Sold</th>
                    <th>Unit Cost</th>
                    <th>Total COGS</th>
                    <th>Net Sales</th>
                    <th>Profit</th>
                    <th>Margin %</th>
                    <th>Orders</th>
                  </tr>
                </thead>
                <tbody>
                  {analysis.breakdown.map((item, idx) => (
                    <tr key={idx}>
                      <td className="product-name">{item.product}</td>
                      <td>{item.category}</td>
                      <td className="number">{item.itemsSold}</td>
                      <td className="number">${item.unitCost.toFixed(2)}</td>
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
    </div>
  );
};

export default CostAnalytics;
