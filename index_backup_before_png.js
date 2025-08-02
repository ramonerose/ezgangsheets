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

// ✅ Helper function to process file (PDF or PNG) and get dimensions
async function processFile(file, rotate) {
  const fileExtension = file.originalname.toLowerCase().split('.').pop();
  
  if (fileExtension === 'pdf') {
    // Handle PDF files
    const uploadedPdf = await PDFDocument.load(file.buffer);
    const uploadedPage = uploadedPdf.getPages()[0];
    let { width: logoWidth, height: logoHeight } = uploadedPage.getSize();
    
    let layoutWidth = logoWidth;
    let layoutHeight = logoHeight;
    if (rotate) [layoutWidth, layoutHeight] = [logoHeight, logoWidth];
    
    return {
      file: file,
      layoutWidth: layoutWidth,
      layoutHeight: layoutHeight,
      isPdf: true,
      embeddedPage: null // Will be set when creating sheets
    };
  } else if (fileExtension === 'png') {
    // Handle PNG files
    const sheetDoc = await PDFDocument.create();
    const image = await sheetDoc.embedPng(file.buffer);
    const { width: logoWidth, height: logoHeight } = image.scale(1);
    
    let layoutWidth = logoWidth;
    let layoutHeight = logoHeight;
    if (rotate) [layoutWidth, layoutHeight] = [logoHeight, logoWidth];
    
    return {
      file: file,
      layoutWidth: layoutWidth,
      layoutHeight: layoutHeight,
      isPdf: false,
      image: image,
      embeddedPage: null // Will be set when creating sheets
    };
  } else {
    throw new Error(`Unsupported file type: ${fileExtension}. Please use PDF or PNG files.`);
  }
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

// ✅ NEW: Consolidated gang sheet generation for multiple files
app.post("/merge-consolidated", upload.array("files", 10), async (req, res) => {
  try {
    log("/merge-consolidated route hit!");

    const files = req.files;
    const quantities = JSON.parse(req.body.quantities || "[]");
    const rotate = req.body.rotate === "true";
    const gangWidth = parseInt(req.body.gangWidth, 10); // 22 or 30
    const maxLengthInches = parseInt(req.body.maxLength, 10) || 200;

    if (!files || files.length === 0) throw new Error("No files uploaded");
    if (files.length !== quantities.length) throw new Error("File count doesn't match quantity count");

    log(`Processing ${files.length} files with consolidation`);
    log(`Selected gang width: ${gangWidth} inches`);
    log(`Max sheet length: ${maxLengthInches} inches`);

    // ✅ Process all files and calculate total requirements
    const fileData = [];
    let totalLogosNeeded = 0;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const quantity = quantities[i];
      
      const fileInfo = await processFile(file, rotate);
      fileInfo.quantity = quantity;
      fileInfo.remaining = quantity;

      fileData.push(fileInfo);
      totalLogosNeeded += quantity;
      log(`File ${i + 1}: ${file.originalname} - ${quantity} logos needed`);
    }

    // ✅ Calculate layout parameters
    const safeMarginPts = SAFE_MARGIN_INCH * POINTS_PER_INCH;
    const spacingPts = SPACING_INCH * POINTS_PER_INCH;
    const sheetWidthPts = gangWidth * POINTS_PER_INCH;
    const maxHeightPts = maxLengthInches * POINTS_PER_INCH;

    // ✅ WORKING SOLUTION: Just use the proven single-file logic for each file
    let allSheetData = [];
    
    // ✅ Process each file using the working single-file logic
    for (let fileIndex = 0; fileIndex < fileData.length; fileIndex++) {
      const fileInfo = fileData[fileIndex];
      log(`Processing file ${fileIndex + 1}: ${fileInfo.quantity} logos`);
      
      // ✅ Use EXACT same logic as single-file endpoint
      const quantity = fileInfo.quantity;
      const uploadedFile = fileInfo.file;
      const rotate = req.body.rotate === "true";
      const gangWidth = parseInt(req.body.gangWidth, 10);
      const maxLengthInches = parseInt(req.body.maxLength, 10) || 200;
      
      // ✅ File dimensions already calculated in processFile function
      const layoutWidth = fileInfo.layoutWidth;
      const layoutHeight = fileInfo.layoutHeight;
      
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
      
      const drawLogo = (page, fileInfo, x, y) => {
        if (fileInfo.isPdf) {
          // Draw PDF page
          if (rotate) {
            page.drawPage(fileInfo.embeddedPage, {
              x: x + layoutHeight,
              y,
              rotate: degrees(90)
            });
          } else {
            page.drawPage(fileInfo.embeddedPage, { x, y });
          }
        } else {
          // Draw PNG image
          if (rotate) {
            page.drawImage(fileInfo.image, {
              x: x + layoutHeight,
              y,
              width: layoutWidth,
              height: layoutHeight,
              rotate: degrees(90)
            });
          } else {
            page.drawImage(fileInfo.image, {
              x: x,
              y: y,
              width: layoutWidth,
              height: layoutHeight
            });
          }
        }
      };
      
      let remaining = quantity;
      
      for (let sheetIndex = 0; sheetIndex < totalSheetsNeeded; sheetIndex++) {
        const sheetDoc = await PDFDocument.create();
        
        // ✅ Embed the file based on type
        if (fileInfo.isPdf) {
          [fileInfo.embeddedPage] = await sheetDoc.embedPdf(uploadedFile.buffer);
        } else {
          // PNG is already embedded in processFile function
          fileInfo.embeddedPage = fileInfo.image; // Use the already embedded image
        }
        
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
            drawLogo(page, fileInfo, xCursor, yCursor);
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