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

// ✅ Default cost table (fallback)
const DEFAULT_COST_TABLE = {
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
function calculateCost(widthInches, heightInches, costTable = DEFAULT_COST_TABLE) {
  // Round UP to the next 12-inch increment
  const roundedHeight = Math.ceil(heightInches / 12) * 12;

  // If exact tier exists, return it
  if (costTable[roundedHeight]) {
    return costTable[roundedHeight];
  }

  // Otherwise find the NEXT available tier (round up to next in table)
  const availableTiers = Object.keys(costTable).map(Number).sort((a, b) => a - b);
  const nextTier = availableTiers.find(t => t >= roundedHeight) || Math.max(...availableTiers);

  return costTable[nextTier];
}

// ✅ SIMPLE: Process each file separately (proven working approach)
app.post("/merge-consolidated", upload.array("files", 10), async (req, res) => {
  try {
    log("/merge-consolidated route hit!");

    const files = req.files;
    const quantities = JSON.parse(req.body.quantities || "[]");
    const smartFit = true; // Smart Fit is now always enabled by default
    const gangWidth = parseInt(req.body.gangWidth, 10); // 22 or 30
    const maxLengthInches = parseInt(req.body.maxLength, 10) || 200;
    
    // Get user's custom cost tables or use defaults
    let userCostTables = {
      22: DEFAULT_COST_TABLE,
      30: {
        12: 7.18, 24: 14.36, 36: 21.54, 48: 28.72, 60: 35.90, 80: 47.87,
        100: 59.84, 120: 67.02, 140: 76.60, 160: 83.78, 180: 93.35, 200: 102.92
      }
    };
    
    if (req.body.costTables) {
      try {
        userCostTables = JSON.parse(req.body.costTables);
      } catch (error) {
        log("Invalid cost tables provided, using default");
      }
    }

    if (!files || files.length === 0) throw new Error("No files uploaded");
    if (files.length !== quantities.length) throw new Error("File count doesn't match quantity count");

    log(`Processing ${files.length} files with consolidation`);
    log(`Selected gang width: ${gangWidth} inches`);
    log(`Max sheet length: ${maxLengthInches} inches`);

    // ✅ TRUE CONSOLIDATION: Collect all logos and pack them optimally
    log("Starting TRUE consolidation - collecting all logos...");
    
    // Step 1: Collect all logo data and determine optimal orientations
    const logoData = [];
    let totalLogosNeeded = 0;
    
    for (let fileIndex = 0; fileIndex < files.length; fileIndex++) {
      const uploadedFile = files[fileIndex];
      const quantity = quantities[fileIndex];
      
      log(`Analyzing file ${fileIndex + 1}: ${uploadedFile.originalname} - ${quantity} logos needed`);
      
      const uploadedPdf = await PDFDocument.load(uploadedFile.buffer);
      const uploadedPage = uploadedPdf.getPages()[0];
      let { width: logoWidth, height: logoHeight } = uploadedPage.getSize();

      // Determine optimal orientation for this logo
      const horizontalLayout = calculateLayout(logoWidth, logoHeight, false, gangWidth, maxLengthInches);
      const verticalLayout = calculateLayout(logoHeight, logoWidth, true, gangWidth, maxLengthInches);
      
      let bestLayout;
      let isRotated;
      if (verticalLayout.logosPerSheet > horizontalLayout.logosPerSheet) {
        bestLayout = { ...verticalLayout, orientation: 'vertical' };
        isRotated = true;
        log(`Smart Fit: Vertical wins for ${uploadedFile.originalname} (${verticalLayout.logosPerSheet} vs ${horizontalLayout.logosPerSheet} logos)`);
      } else {
        bestLayout = { ...horizontalLayout, orientation: 'horizontal' };
        isRotated = false;
        log(`Smart Fit: Horizontal wins for ${uploadedFile.originalname} (${horizontalLayout.logosPerSheet} vs ${verticalLayout.logosPerSheet} logos)`);
      }
      
      // Store logo data for consolidation
      logoData.push({
        fileIndex,
        originalName: uploadedFile.originalname,
        buffer: uploadedFile.buffer,
        quantity,
        logoWidth: isRotated ? logoHeight : logoWidth,
        logoHeight: isRotated ? logoWidth : logoHeight,
        isRotated,
        layout: bestLayout
      });
      
      totalLogosNeeded += quantity;
    }
    
    log(`Total logos to consolidate: ${totalLogosNeeded}`);
    
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

    // Step 2: Create a flat list of all logos to pack
    const allLogos = [];
    logoData.forEach(logo => {
      for (let i = 0; i < logo.quantity; i++) {
        allLogos.push({
          ...logo,
          logoIndex: i
        });
      }
    });
    
    log(`Created flat list of ${allLogos.length} logos to pack`);
    
    // Step 3: Pack logos into sheets using a simple greedy approach
    const allSheetData = [];
    const safeMarginPts = SAFE_MARGIN_INCH * POINTS_PER_INCH;
    const spacingPts = SPACING_INCH * POINTS_PER_INCH;
    const sheetWidthPts = gangWidth * POINTS_PER_INCH;
    
    let remainingLogos = [...allLogos];
    let sheetIndex = 0;
    
    while (remainingLogos.length > 0) {
      sheetIndex++;
      log(`Creating sheet ${sheetIndex} with ${remainingLogos.length} logos remaining`);
      
      // First pass: calculate how many logos fit and the actual height needed
      let tempYCursor = (maxLengthInches * POINTS_PER_INCH) - safeMarginPts;
      let tempLogosOnThisSheet = 0;
      const logosToRemove = [];
      
      for (let i = 0; i < remainingLogos.length; i++) {
        const logo = remainingLogos[i];
        const logoTotalWidth = logo.logoWidth + spacingPts;
        const logoTotalHeight = logo.logoHeight + spacingPts;
        
        // Check if this logo fits in the current row
        const logosInCurrentRow = Math.floor((sheetWidthPts - safeMarginPts * 2 + spacingPts) / logoTotalWidth);
        const currentRowLogos = tempLogosOnThisSheet % logosInCurrentRow;
        
        if (currentRowLogos === 0) {
          // Starting a new row, check if we have space
          if (tempYCursor - logoTotalHeight < safeMarginPts) {
            // No more space on this sheet
            break;
          }
          tempYCursor -= logoTotalHeight;
        }
        
        tempLogosOnThisSheet++;
        logosToRemove.push(i);
      }
      
      // Calculate the actual height needed
      const actualHeightPts = (maxLengthInches * POINTS_PER_INCH) - tempYCursor + safeMarginPts;
      const finalHeightInch = Math.ceil(actualHeightPts / POINTS_PER_INCH);
      
      // Now create the page at the correct size
      const sheetDoc = await PDFDocument.create();
      const page = sheetDoc.addPage([sheetWidthPts, finalHeightInch * POINTS_PER_INCH]);
      
      let yCursor = (finalHeightInch * POINTS_PER_INCH) - safeMarginPts;
      let logosOnThisSheet = 0;
      
      // Pack logos row by row
      for (let i = 0; i < remainingLogos.length; i++) {
        const logo = remainingLogos[i];
        const logoTotalWidth = logo.logoWidth + spacingPts;
        const logoTotalHeight = logo.logoHeight + spacingPts;
        
        // Check if this logo fits in the current row
        const logosInCurrentRow = Math.floor((sheetWidthPts - safeMarginPts * 2 + spacingPts) / logoTotalWidth);
        const currentRowLogos = logosOnThisSheet % logosInCurrentRow;
        
        if (currentRowLogos === 0) {
          // Starting a new row, check if we have space
          if (yCursor - logoTotalHeight < safeMarginPts) {
            // No more space on this sheet
            break;
          }
          yCursor -= logoTotalHeight;
        }
        
        // Calculate x position for this logo
        const xCursor = safeMarginPts + (currentRowLogos * logoTotalWidth);
        
        // Embed and draw the logo
        const [embeddedPage] = await sheetDoc.embedPdf(logo.buffer);
        
        if (logo.isRotated) {
          page.drawPage(embeddedPage, {
            x: xCursor + logo.logoHeight,
            y: yCursor,
            rotate: degrees(90)
          });
        } else {
          page.drawPage(embeddedPage, { x: xCursor, y: yCursor });
        }
        
        logosOnThisSheet++;
        logosToRemove.push(i);
      }
      
      // Remove the logos we just placed
      for (let i = logosToRemove.length - 1; i >= 0; i--) {
        remainingLogos.splice(logosToRemove[i], 1);
      }
      
                           // Calculate cost based on the final height we already calculated
         const cost = calculateCost(gangWidth, finalHeightInch, userCostTables[gangWidth]);
      
      // Create a descriptive filename for consolidated sheets
      const uniqueFiles = [...new Set(logoData.map(l => l.originalName.replace(/\.[^/.]+$/, "")))];
      const filename = `${gangWidth}x${finalHeightInch}_consolidated_${uniqueFiles.join('_')}.pdf`;
      
      const pdfBytes = await sheetDoc.save();
      allSheetData.push({
        filename,
        buffer: Buffer.from(pdfBytes),
        width: gangWidth,
        height: finalHeightInch,
        cost
      });
      
      log(`Completed consolidated sheet ${sheetIndex}: ${gangWidth}x${finalHeightInch} - $${cost} (${logosOnThisSheet} logos)`);
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

      // Get original filename without extension
      const originalName = uploadedFile.originalname.replace(/\.[^/.]+$/, "");
      const filename = `${gangWidth}x${finalHeightInch}_${originalName}.pdf`;
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