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
      
      const rowsPerSheet = Math.floor(
        (maxHeightPts - safeMarginPts * 2 + spacingPts) / logoTotalHeight
      );
      const logosPerSheet = logosPerRow * rowsPerSheet;
      
      const totalSheetsNeeded = Math.ceil(quantity / logosPerSheet);
      log(`File ${fileIndex + 1}: ${logosPerRow} per row, ${rowsPerSheet} rows = ${logosPerSheet} per sheet, ${totalSheetsNeeded} sheets needed`);
      
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