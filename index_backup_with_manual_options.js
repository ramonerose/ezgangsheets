import express from "express";
import multer from "multer";
import { PDFDocument, degrees } from "pdf-lib";

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

const PORT = process.env.PORT || 8080;

// Constants
const POINTS_PER_INCH = 72;
const SAFE_MARGIN_INCH = 0.125;
const SPACING_INCH = 0.5;

app.use(express.static("public"));

function log(msg) {
  console.log(`[DEBUG] ${msg}`);
}

// ✅ Cost table exactly as your screenshot
const COST_TABLE = {
  12: 5.28,
  24: 10.56,
  36: 15.84,
  48: 21.12,
  60: 26.40,
  80: 35.20,
  100: 44.00,
  120: 49.28,
  140: 56.32,
  160: 61.60,
  180: 68.64,
  200: 75.68
};

// ✅ NEW FIXED LOGIC
function calculateCost(widthInches, heightInches) {
  // Round UP to the next 12-inch increment
  const roundedHeight = Math.ceil(heightInches / 12) * 12;

  // If exact tier exists, return it
  if (COST_TABLE[roundedHeight]) {
    return COST_TABLE[roundedHeight];
  }

  // Otherwise find the NEXT available tier (round up to next in table)
  const availableTiers = Object.keys(COST_TABLE).map(Number).sort((a, b) => a - b);
  const nextTier = availableTiers.find(t => t >= roundedHeight) || Math.max(...availableTiers);

  return COST_TABLE[nextTier];
}

// ✅ SIMPLE: Process each file separately (proven working approach)
app.post("/merge-consolidated", upload.array("files", 10), async (req, res) => {
  try {
    log("/merge-consolidated route hit!");

    const files = req.files;
    const quantities = JSON.parse(req.body.quantities || "[]");
    const rotate = req.body.rotate === "true"; // Simple global rotate
    const smartFit = req.body.smartFit === "true"; // Smart orientation optimization
    const gangWidth = parseInt(req.body.gangWidth, 10); // 22 or 30
    const maxLengthInches = parseInt(req.body.maxLength, 10) || 200;

    if (!files || files.length === 0) throw new Error("No files uploaded");
    if (files.length !== quantities.length) throw new Error("File count doesn't match quantity count");

    log(`Processing ${files.length} files with consolidation`);
    log(`Selected gang width: ${gangWidth} inches`);
    log(`Max sheet length: ${maxLengthInches} inches`);

    // ✅ WORKING SOLUTION: Process each file separately using proven single-file logic
    let allSheetData = [];
    
    for (let fileIndex = 0; fileIndex < files.length; fileIndex++) {
      const uploadedFile = files[fileIndex];
      const quantity = quantities[fileIndex];
      
      log(`File ${fileIndex + 1}: ${uploadedFile.originalname} - ${quantity} logos needed`);
      log(`Processing file ${fileIndex + 1}: ${quantity} logos`);
      
      // ✅ Use EXACT same logic as single-file endpoint
      const uploadedPdf = await PDFDocument.load(uploadedFile.buffer);
      const uploadedPage = uploadedPdf.getPages()[0];
      let { width: logoWidth, height: logoHeight } = uploadedPage.getSize();

      // Smart orientation optimization
      let bestLayout = { logosPerRow: 0, rowsPerSheet: 0, logosPerSheet: 0, orientation: 'horizontal', mixed: false };
      
      if (smartFit) {
        // Simple Smart Fit: Test horizontal vs vertical, choose the one that fits more logos
        const horizontalLayout = calculateLayout(logoWidth, logoHeight, false, gangWidth, maxLengthInches);
        const verticalLayout = calculateLayout(logoHeight, logoWidth, true, gangWidth, maxLengthInches);
        
        if (verticalLayout.logosPerSheet > horizontalLayout.logosPerSheet) {
          // Vertical fits more logos
          bestLayout = { ...verticalLayout, orientation: 'vertical', mixed: false };
          log(`Smart Fit: Vertical wins (${verticalLayout.logosPerSheet} vs ${horizontalLayout.logosPerSheet} logos)`);
        } else {
          // Horizontal fits more logos (or equal)
          bestLayout = { ...horizontalLayout, orientation: 'horizontal', mixed: false };
          log(`Smart Fit: Horizontal wins (${horizontalLayout.logosPerSheet} vs ${verticalLayout.logosPerSheet} logos)`);
        }
      } else {
        // Use manual rotation setting
        const layoutWidth = rotate ? logoHeight : logoWidth;
        const layoutHeight = rotate ? logoWidth : logoHeight;
        bestLayout = calculateLayout(layoutWidth, layoutHeight, rotate, gangWidth, maxLengthInches);
        bestLayout.orientation = rotate ? 'vertical' : 'horizontal';
        bestLayout.mixed = false;
      }
      
      function calculateLayout(width, height, isRotated, gangWidth, maxLength) {
        const safeMarginPts = SAFE_MARGIN_INCH * POINTS_PER_INCH;
        const spacingPts = SPACING_INCH * POINTS_PER_INCH;
        const sheetWidthPts = gangWidth * POINTS_PER_INCH;
        const maxHeightPts = maxLength * POINTS_PER_INCH;

        const logoTotalWidth = width + spacingPts;
        const logoTotalHeight = height + spacingPts;

        const logosPerRow = Math.floor(
          (sheetWidthPts - safeMarginPts * 2 + spacingPts) / logoTotalWidth
        );
        if (logosPerRow < 1) return { logosPerRow: 0, rowsPerSheet: 0, logosPerSheet: 0 };
        
        const rowsPerSheet = Math.floor(
          (maxHeightPts - safeMarginPts * 2 + spacingPts) / logoTotalHeight
        );
        const logosPerSheet = logosPerRow * rowsPerSheet;
        
        return { logosPerRow, rowsPerSheet, logosPerSheet, logoTotalWidth, logoTotalHeight };
      }
      
      function calculateMixedLayout(width, height, gangWidth, maxLength) {
        const safeMarginPts = SAFE_MARGIN_INCH * POINTS_PER_INCH;
        const spacingPts = SPACING_INCH * POINTS_PER_INCH;
        const sheetWidthPts = gangWidth * POINTS_PER_INCH;
        const maxHeightPts = maxLength * POINTS_PER_INCH;
        
        // Calculate horizontal and vertical logo dimensions
        const horizontalWidthPts = width + spacingPts;
        const horizontalHeightPts = height + spacingPts;
        const verticalWidthPts = height + spacingPts;
        const verticalHeightPts = width + spacingPts;
        
        // Debug: Log the dimensions being used
        log(`Logo dimensions: ${width}x${height} points, Horizontal: ${horizontalWidthPts}x${horizontalHeightPts}, Vertical: ${verticalWidthPts}x${verticalHeightPts}`);
        
        // Calculate how many of each orientation fit per row
        const horizontalPerRow = Math.floor((sheetWidthPts - safeMarginPts * 2 + spacingPts) / horizontalWidthPts);
        const verticalPerRow = Math.floor((sheetWidthPts - safeMarginPts * 2 + spacingPts) / verticalWidthPts);
        
        // Calculate how many rows of each orientation fit
        const horizontalRows = Math.floor((maxHeightPts - safeMarginPts * 2 + spacingPts) / horizontalHeightPts);
        const verticalRows = Math.floor((maxHeightPts - safeMarginPts * 2 + spacingPts) / verticalHeightPts);
        
        // Calculate total logos for each approach
        const horizontalOnly = horizontalPerRow * horizontalRows;
        const verticalOnly = verticalPerRow * verticalRows;
        
        // Test different combinations of horizontal and vertical rows
        let bestMixedTotal = 0;
        let bestHorizontalRows = 0;
        let bestVerticalRows = 0;
        let bestBalanceScore = 0;
        let bestAdjustedScore = 0;
        
        // Try different combinations of horizontal and vertical rows
        for (let hRows = 0; hRows <= horizontalRows; hRows++) {
          const heightUsedByHorizontal = hRows * horizontalHeightPts;
          const remainingHeight = maxHeightPts - safeMarginPts * 2 + spacingPts - heightUsedByHorizontal;
          
          if (remainingHeight >= verticalHeightPts) {
            const vRows = Math.floor(remainingHeight / verticalHeightPts);
            const totalLogos = (hRows * horizontalPerRow) + (vRows * verticalPerRow);
            
            // Add debug logging to see what combinations are being tested
            if (hRows > 0 || vRows > 0) {
              log(`Testing: ${hRows} horizontal rows (${horizontalPerRow} per row) + ${vRows} vertical rows (${verticalPerRow} per row) = ${totalLogos} total logos`);
            }
            
            // Prefer more balanced layouts, even if they have slightly fewer logos
            const balanceScore = Math.min(hRows, vRows) / Math.max(hRows, vRows); // 0 = unbalanced, 1 = perfectly balanced
            const balanceBonus = balanceScore * 50; // Much stronger bonus for balance
            const adjustedScore = totalLogos + balanceBonus;
            
            // Debug logging for the best combinations
            if (hRows > 0 && vRows > 0 && (hRows >= 5 || vRows >= 5)) {
              log(`Balanced option: ${hRows}H + ${vRows}V = ${totalLogos} logos, balance=${balanceScore.toFixed(3)}, adjusted=${adjustedScore.toFixed(1)}`);
            }
            
            if (adjustedScore > bestAdjustedScore) {
              bestMixedTotal = totalLogos;
              bestHorizontalRows = hRows;
              bestVerticalRows = vRows;
              bestBalanceScore = balanceScore;
              bestAdjustedScore = adjustedScore;
              log(`New best: ${hRows}H + ${vRows}V = ${totalLogos} logos, adjusted=${adjustedScore.toFixed(1)}`);
            }
          }
        }
        
        // Find the best approach - give mixed layouts a much stronger bonus for being balanced
        const mixedBalanceBonus = bestBalanceScore * 100; // Much stronger bonus for mixed layouts
        const approaches = [
          { type: 'horizontal', total: horizontalOnly, horizontalRows: horizontalRows, verticalRows: 0, adjusted: horizontalOnly },
          { type: 'vertical', total: verticalOnly, horizontalRows: 0, verticalRows: verticalRows, adjusted: verticalOnly },
          { type: 'mixed', total: bestMixedTotal, horizontalRows: bestHorizontalRows, verticalRows: bestVerticalRows, adjusted: bestMixedTotal + mixedBalanceBonus }
        ];
        
        const bestApproach = approaches.reduce((best, current) => 
          current.adjusted > best.adjusted ? current : best
        );
        
        // Debug: Log the final comparison
        log(`Final comparison: H=${horizontalOnly}, V=${verticalOnly}, M=${bestMixedTotal}+${mixedBalanceBonus}=${bestMixedTotal + mixedBalanceBonus}, Selected=${bestApproach.type}`);
        
        // Calculate effective row height for mixed layouts
        let effectiveRowHeight = horizontalHeightPts;
        if (bestApproach.type === 'mixed' && bestApproach.verticalRows > 0) {
          // For mixed layouts, we need to account for both heights
          const totalHeightUsed = (bestApproach.horizontalRows * horizontalHeightPts) + (bestApproach.verticalRows * verticalHeightPts);
          effectiveRowHeight = totalHeightUsed / (bestApproach.horizontalRows + bestApproach.verticalRows);
        } else if (bestApproach.type === 'vertical') {
          effectiveRowHeight = verticalHeightPts;
        }
        
        return { 
          logosPerSheet: bestApproach.total,
          logosPerRow: bestApproach.type === 'mixed' ? Math.max(horizontalPerRow, verticalPerRow) : 
                      bestApproach.type === 'horizontal' ? horizontalPerRow : verticalPerRow,
          rowsPerSheet: bestApproach.horizontalRows + bestApproach.verticalRows,
          horizontalPerRow: bestApproach.horizontalRows > 0 ? horizontalPerRow : 0,
          verticalPerRow: bestApproach.verticalRows > 0 ? verticalPerRow : 0,
          horizontalRows: bestApproach.horizontalRows,
          verticalRows: bestApproach.verticalRows,
          layoutType: bestApproach.type,
          balanceScore: bestBalanceScore,
          logoTotalWidth: horizontalWidthPts,
          logoTotalHeight: effectiveRowHeight
        };
      }

      const logosPerRow = bestLayout.logosPerRow;
      const rowsPerSheet = bestLayout.rowsPerSheet;
      const logosPerSheet = bestLayout.logosPerSheet;
      
      // Define these constants outside the functions so they're available
      const safeMarginPts = SAFE_MARGIN_INCH * POINTS_PER_INCH;
      const spacingPts = SPACING_INCH * POINTS_PER_INCH;
      const sheetWidthPts = gangWidth * POINTS_PER_INCH;
      
      const totalSheetsNeeded = Math.ceil(quantity / logosPerSheet);
      log(`File ${fileIndex + 1}: ${logosPerRow} per row, ${rowsPerSheet} rows = ${logosPerSheet} per sheet, ${totalSheetsNeeded} sheets needed`);
      
      const drawLogo = (page, embeddedPage, x, y, isRotated = false) => {
        if (isRotated) {
          page.drawPage(embeddedPage, {
            x: x + logoHeight,
            y,
            rotate: degrees(90)
          });
        } else {
          page.drawPage(embeddedPage, { x, y });
        }
      };
      
      let remaining = quantity;
      
      for (let sheetIndex = 0; sheetIndex < totalSheetsNeeded; sheetIndex++) {
        const sheetDoc = await PDFDocument.create();
        const [embeddedPage] = await sheetDoc.embedPdf(uploadedFile.buffer);

        const logosOnThisSheet = Math.min(remaining, logosPerSheet);
        
        let usedRows, usedHeightPts;
        if (bestLayout.mixed) {
          // For mixed layout, calculate rows based on the combination
          usedRows = Math.ceil(logosOnThisSheet / (bestLayout.horizontalPerRow + bestLayout.verticalPerRow));
          usedHeightPts = usedRows * bestLayout.logoTotalHeight + safeMarginPts * 2 - spacingPts;
        } else {
          usedRows = Math.ceil(logosOnThisSheet / logosPerRow);
          usedHeightPts = usedRows * bestLayout.logoTotalHeight + safeMarginPts * 2 - spacingPts;
        }
        
        const roundedHeightPts = Math.ceil(usedHeightPts / POINTS_PER_INCH) * POINTS_PER_INCH;
        const page = sheetDoc.addPage([sheetWidthPts, roundedHeightPts]);

        let yCursor = roundedHeightPts - safeMarginPts - (bestLayout.orientation === 'vertical' ? logoWidth : logoHeight);
        let drawn = 0;

        while (drawn < logosOnThisSheet) {
          if (bestLayout.mixed) {
            // For mixed layout, draw horizontal rows first, then vertical rows
            // Calculate how many horizontal rows we need
            const horizontalLogos = Math.min(logosOnThisSheet, bestLayout.horizontalPerRow * bestLayout.horizontalRows);
            const horizontalRowsNeeded = Math.ceil(horizontalLogos / bestLayout.horizontalPerRow);
            
            // Draw horizontal rows first
            for (let row = 0; row < horizontalRowsNeeded && drawn < logosOnThisSheet; row++) {
              let xCursor = safeMarginPts;
              for (let col = 0; col < bestLayout.horizontalPerRow && drawn < logosOnThisSheet; col++) {
                drawLogo(page, embeddedPage, xCursor, yCursor, false);
                drawn++;
                remaining--;
                xCursor += (logoWidth + spacingPts);
              }
              yCursor -= (logoHeight + spacingPts);
            }
            
            // Then draw vertical rows for remaining logos
            const remainingLogos = logosOnThisSheet - drawn;
            if (remainingLogos > 0) {
              const verticalRowsNeeded = Math.ceil(remainingLogos / bestLayout.verticalPerRow);
              for (let row = 0; row < verticalRowsNeeded && drawn < logosOnThisSheet; row++) {
                let xCursor = safeMarginPts;
                for (let col = 0; col < bestLayout.verticalPerRow && drawn < logosOnThisSheet; col++) {
                  drawLogo(page, embeddedPage, xCursor, yCursor, true);
                  drawn++;
                  remaining--;
                  xCursor += (logoHeight + spacingPts);
                }
                yCursor -= (logoWidth + spacingPts);
              }
            }
          } else {
            // Draw uniform row
            let xCursor = safeMarginPts;
            for (let c = 0; c < logosPerRow && drawn < logosOnThisSheet; c++) {
              const isRotated = bestLayout.orientation === 'vertical';
              drawLogo(page, embeddedPage, xCursor, yCursor, isRotated);
              drawn++;
              remaining--;
              xCursor += bestLayout.logoTotalWidth;
            }
            yCursor -= bestLayout.logoTotalHeight;
          }
        }

        const pdfBytes = await sheetDoc.save();
        const finalHeightInch = Math.ceil(roundedHeightPts / POINTS_PER_INCH);
        const cost = calculateCost(gangWidth, finalHeightInch);

        const filename = `gangsheet_${gangWidth}x${finalHeightInch}.pdf`;
        allSheetData.push({
          filename,
          buffer: Buffer.from(pdfBytes),
          width: gangWidth,
          height: finalHeightInch,
          cost
        });
        
        log(`Completed sheet for file ${fileIndex + 1}: ${gangWidth}x${finalHeightInch} - $${cost}`);
      }
    }

    const totalCost = allSheetData.reduce((sum, s) => sum + s.cost, 0);
    log(`Total: ${allSheetData.length} sheets, $${totalCost}`);

    res.json({
      sheets: allSheetData.map(s => ({
        filename: s.filename,
        width: s.width,
        height: s.height,
        cost: s.cost,
        pdfBase64: s.buffer.toString("base64")
      })),
      totalCost
    });

  } catch (err) {
    console.error("CONSOLIDATED MERGE ERROR:", err);
    res.status(500).send(`Server error: ${err.message}`);
  }
});

// ✅ Keep original single-file endpoint for backward compatibility
app.post("/merge", upload.single("file"), async (req, res) => {
  try {
    log("/merge route hit!");

    const quantity = parseInt(req.body.quantity, 10);
    const rotate = req.body.rotate === "true";
    const gangWidth = parseInt(req.body.gangWidth, 10); // 22 or 30
    const maxLengthInches = parseInt(req.body.maxLength, 10) || 200;

    const uploadedFile = req.file;
    if (!uploadedFile) throw new Error("No file uploaded");
    if (!quantity || quantity <= 0) throw new Error("Invalid quantity");

    log(`Requested quantity: ${quantity}, rotate: ${rotate}`);
    log(`Selected gang width: ${gangWidth} inches`);
    log(`Max sheet length: ${maxLengthInches} inches`);
    log(`Uploaded PDF size: ${uploadedFile.size} bytes`);

    const uploadedPdf = await PDFDocument.load(uploadedFile.buffer);
    const uploadedPage = uploadedPdf.getPages()[0];
    let { width: logoWidth, height: logoHeight } = uploadedPage.getSize();

    let layoutWidth = logoWidth;
    let layoutHeight = logoHeight;
    if (rotate) [layoutWidth, layoutHeight] = [logoHeight, logoWidth];

    const safeMarginPts = SAFE_MARGIN_INCH * POINTS_PER_INCH;
    const spacingPts = SPACING_INCH * POINTS_PER_INCH;

    const sheetWidthPts = gangWidth * POINTS_PER_INCH;
    const maxHeightPts = maxLengthInches * POINTS_PER_INCH;

    const logoTotalWidth = layoutWidth + spacingPts;
    const logoTotalHeight = layoutHeight + spacingPts;

    const logosPerRow = Math.floor(
      (sheetWidthPts - safeMarginPts * 2 + spacingPts) / logoTotalWidth
    );
    if (logosPerRow < 1) throw new Error("Logo too wide for sheet");
    log(`Can fit ${logosPerRow} logos per row`);

    const rowsPerSheet = Math.floor(
      (maxHeightPts - safeMarginPts * 2 + spacingPts) / logoTotalHeight
    );
    const logosPerSheet = logosPerRow * rowsPerSheet;

    log(`Each sheet max ${rowsPerSheet} rows → ${logosPerSheet} logos per sheet`);

    const totalSheetsNeeded = Math.ceil(quantity / logosPerSheet);
    log(`Total sheets needed: ${totalSheetsNeeded}`);

    const drawLogo = (page, embeddedPage, x, y) => {
      if (rotate) {
        page.drawPage(embeddedPage, {
          x: x + logoHeight,
          y,
          rotate: degrees(90)
        });
      } else {
        page.drawPage(embeddedPage, { x, y });
      }
    };

    let allSheetData = [];
    let remaining = quantity;

    for (let sheetIndex = 0; sheetIndex < totalSheetsNeeded; sheetIndex++) {
      const sheetDoc = await PDFDocument.create();
      const [embeddedPage] = await sheetDoc.embedPdf(uploadedFile.buffer);

      const logosOnThisSheet = Math.min(remaining, logosPerSheet);
      const usedRows = Math.ceil(logosOnThisSheet / logosPerRow);
      const usedHeightPts =
        usedRows * logoTotalHeight + safeMarginPts * 2 - spacingPts;
      const roundedHeightPts =
        Math.ceil(usedHeightPts / POINTS_PER_INCH) * POINTS_PER_INCH;

      const page = sheetDoc.addPage([sheetWidthPts, roundedHeightPts]);

      let yCursor = roundedHeightPts - safeMarginPts - layoutHeight;
      let drawn = 0;

      while (drawn < logosOnThisSheet) {
        let xCursor = safeMarginPts;
        for (let c = 0; c < logosPerRow && drawn < logosOnThisSheet; c++) {
          drawLogo(page, embeddedPage, xCursor, yCursor);
          drawn++;
          remaining--;
          xCursor += logoTotalWidth;
        }
        yCursor -= logoTotalHeight;
      }

      const pdfBytes = await sheetDoc.save();
      const finalHeightInch = Math.ceil(roundedHeightPts / POINTS_PER_INCH);

      // ✅ Always round UP to the next cost tier
      const cost = calculateCost(gangWidth, finalHeightInch);

      const filename = `gangsheet_${gangWidth}x${finalHeightInch}.pdf`;
      allSheetData.push({
        filename,
        buffer: Buffer.from(pdfBytes),
        width: gangWidth,
        height: finalHeightInch,
        cost
      });
    }

    const totalCost = allSheetData.reduce((sum, s) => sum + s.cost, 0);

    res.json({
      sheets: allSheetData.map(s => ({
        filename: s.filename,
        width: s.width,
        height: s.height,
        cost: s.cost,
        pdfBase64: s.buffer.toString("base64")
      })),
      totalCost
    });

  } catch (err) {
    console.error("MERGE ERROR:", err);
    res.status(500).send(`Server error: ${err.message}`);
  }
});

app.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`);
}); 