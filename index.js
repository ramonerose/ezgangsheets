import express from "express";
import multer from "multer";
import { PDFDocument, degrees } from "pdf-lib";
import path from "path";
import { fileURLToPath } from "url";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import session from "express-session";
import Stripe from "stripe";
import dotenv from "dotenv";
import { loadUsers, saveUsers, addUser, getUser, getAllUsers, updateUser, deleteUser } from "./user-management.js";

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 8080;

// Initialize Stripe (only if API key is provided)
let stripe = null;
let SUBSCRIPTION_PLANS = {};

if (process.env.STRIPE_SECRET_KEY) {
  try {
    stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    
    // Stripe subscription plans configuration
    SUBSCRIPTION_PLANS = {
      pro: {
        monthly: 'price_1Rv2PdHdZtX9fIK0rlp2TELv',
        annual: 'price_1Rv2PdHdZtX9fIK0DTl195FP'
      }
    };
    
    console.log('Stripe initialized successfully');
  } catch (error) {
    console.error('Failed to initialize Stripe:', error.message);
  }
} else {
  console.log('Stripe API key not provided - payment features disabled');
}

// Production-ready middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.static("public"));

// Special middleware for Stripe webhooks (must be raw body)
app.use('/api/webhook', express.raw({ type: 'application/json' }));

// Session middleware - Production ready
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-secret-key-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: process.env.NODE_ENV === 'production', // Only use secure cookies in production
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  },
  name: 'ezgangsheets.sid' // Custom session name
}));

// Healthcheck route for Railway
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Root route - serve index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Persistent user storage
let users = loadUsers();
const JWT_SECRET = process.env.JWT_SECRET || 'your-jwt-secret-change-in-production';

// Download tracking for free users
const downloadCounts = new Map(); // email -> { count: number, resetDate: string }
const FREE_DOWNLOAD_LIMIT = 5; // 5 downloads per month for free users

// Create admin account automatically
const ADMIN_EMAIL = 'admin@ezgangsheets.com';
const ADMIN_PASSWORD = 'admin123'; // Change this to something secure

// Initialize admin account if it doesn't exist
async function initializeAdminAccount() {
  if (!users.has(ADMIN_EMAIL)) {
    const hashedPassword = await bcrypt.hash(ADMIN_PASSWORD, 10);
    const adminUser = {
      id: 'admin-001',
      firstName: 'Admin',
      lastName: 'User',
      email: ADMIN_EMAIL,
      password: hashedPassword,
      company: 'EZGangSheets',
      plan: 'pro',
      isAdmin: true,
      createdAt: new Date().toISOString()
    };
    users.set(ADMIN_EMAIL, adminUser);
    saveUsers(users);
    console.log('Admin account created:', ADMIN_EMAIL);
  }
}

// Initialize admin on startup
initializeAdminAccount();

// Check download limits for free users
function checkDownloadLimit(email) {
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  
  if (!downloadCounts.has(email)) {
    downloadCounts.set(email, { count: 0, resetDate: currentMonth });
  }
  
  const userCounts = downloadCounts.get(email);
  
  // Reset count if it's a new month
  if (userCounts.resetDate !== currentMonth) {
    userCounts.count = 0;
    userCounts.resetDate = currentMonth;
  }
  
  return {
    canDownload: userCounts.count < FREE_DOWNLOAD_LIMIT,
    remaining: Math.max(0, FREE_DOWNLOAD_LIMIT - userCounts.count),
    total: FREE_DOWNLOAD_LIMIT
  };
}

// Increment download count for free users
function incrementDownloadCount(email) {
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  
  if (!downloadCounts.has(email)) {
    downloadCounts.set(email, { count: 0, resetDate: currentMonth });
  }
  
  const userCounts = downloadCounts.get(email);
  
  // Reset count if it's a new month
  if (userCounts.resetDate !== currentMonth) {
    userCounts.count = 0;
    userCounts.resetDate = currentMonth;
  }
  
  userCounts.count++;
}

// Authentication middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid token' });
    }
    req.user = user;
    next();
  });
};

// Enhanced multer configuration with file size limits and validation
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit per file
    files: 10 // Maximum 10 files per request
  },
  fileFilter: (req, file, cb) => {
    // Only allow PDF files
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'), false);
    }
  }
});

// Error handling middleware
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File too large. Maximum size is 10MB.' });
    }
    if (error.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({ error: 'Too many files. Maximum is 10 files.' });
    }
  }
  if (error.message === 'Only PDF files are allowed') {
    return res.status(400).json({ error: 'Only PDF files are allowed.' });
  }
  console.error('Server error:', error);
  res.status(500).json({ error: 'Internal server error' });
});

// Production logging function
const log = (message) => {
  if (process.env.NODE_ENV === 'development') {
    console.log(`[${new Date().toISOString()}] ${message}`);
  }
};

// Constants
const POINTS_PER_INCH = 72;
const SAFE_MARGIN_INCH = 0.125;
const SPACING_INCH = 0.5;

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
  // Check if user has Pro plan for cost calculation
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  let userPlan = 'free';
  let userEmail = null;
  
  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      userPlan = decoded.plan || 'free';
      userEmail = decoded.email;
    } catch (err) {
      // Token invalid, treat as free user
      userPlan = 'free';
    }
  }
  
  // Check download limits for free users
  if (userPlan === 'free' && userEmail) {
    const downloadLimit = checkDownloadLimit(userEmail);
    if (!downloadLimit.canDownload) {
      return res.status(429).json({ 
        error: 'Download limit reached', 
        message: `Free users can download ${FREE_DOWNLOAD_LIMIT} gang sheets per month. Upgrade to Pro for unlimited downloads.`,
        limit: downloadLimit
      });
    }
  }
  
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
      
      log(`Original logo dimensions: ${logoWidth} x ${logoHeight} points (${(logoWidth/72).toFixed(2)} x ${(logoHeight/72).toFixed(2)} inches)`);

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
      const finalLogoWidth = isRotated ? logoHeight : logoWidth;
      const finalLogoHeight = isRotated ? logoWidth : logoHeight;
      
      log(`Final logo dimensions after rotation: ${finalLogoWidth} x ${finalLogoHeight} points (${(finalLogoWidth/72).toFixed(2)} x ${(finalLogoHeight/72).toFixed(2)} inches)`);
      
      logoData.push({
        fileIndex,
        originalName: uploadedFile.originalname,
        buffer: uploadedFile.buffer,
        quantity,
        logoWidth: finalLogoWidth,
        logoHeight: finalLogoHeight,
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

    // Step 2: Create a flat list of all logos to pack, grouped by file
    const allLogos = [];
    logoData.forEach((logo, fileIndex) => {
      for (let i = 0; i < logo.quantity; i++) {
        allLogos.push({
          ...logo,
          logoIndex: i,
          fileIndex: fileIndex
        });
      }
    });
    
    // Sort logos by file index to group them together
    allLogos.sort((a, b) => a.fileIndex - b.fileIndex);
    
    log(`Created flat list of ${allLogos.length} logos to pack, grouped by file`);
    
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
      
      // First pass: calculate exactly how many logos fit and the height needed
      let tempYCursor = maxLengthInches * POINTS_PER_INCH - safeMarginPts;
      let tempLogosOnThisSheet = 0;
      const logosToPlace = [];
      let tempCurrentFileIndex = -1;
      let tempCurrentRowLogos = 0;
      
      for (let i = 0; i < remainingLogos.length; i++) {
        const logo = remainingLogos[i];
        const logoTotalWidth = logo.logoWidth + spacingPts;
        const logoTotalHeight = logo.logoHeight + spacingPts;
        
        // Check if we're switching to a new file
        if (logo.fileIndex !== tempCurrentFileIndex) {
          // New file, force a new row
          tempCurrentFileIndex = logo.fileIndex;
          tempCurrentRowLogos = 0;
          
          // Check if we have space for a new row
          if (tempYCursor - logoTotalHeight < safeMarginPts) {
            // No more space on this sheet
            break;
          }
          tempYCursor -= logoTotalHeight;
        } else {
          // Same file, check if we need a new row
          const logosInCurrentRow = Math.floor((sheetWidthPts - safeMarginPts * 2 + spacingPts) / logoTotalWidth);
          
          if (tempCurrentRowLogos >= logosInCurrentRow) {
            // Need a new row for the same file
            tempCurrentRowLogos = 0;
            
            // Check if we have space for a new row
            if (tempYCursor - logoTotalHeight < safeMarginPts) {
              // No more space on this sheet
              break;
            }
            tempYCursor -= logoTotalHeight;
          }
        }
        
        tempCurrentRowLogos++;
        tempLogosOnThisSheet++;
        logosToPlace.push(i);
      }
      
      // Calculate the exact height needed
      const actualHeightPts = maxLengthInches * POINTS_PER_INCH - tempYCursor + safeMarginPts;
      const finalHeightInch = Math.ceil(actualHeightPts / POINTS_PER_INCH);
      
      log(`Sheet ${sheetIndex}: Will place ${tempLogosOnThisSheet} logos, calculated height: ${finalHeightInch} inches`);
      
      // Create the page at the exact size needed
      const sheetDoc = await PDFDocument.create();
      const page = sheetDoc.addPage([sheetWidthPts, finalHeightInch * POINTS_PER_INCH]);
      
      let yCursor = finalHeightInch * POINTS_PER_INCH - safeMarginPts;
      let logosOnThisSheet = 0;
      let currentFileIndex = -1;
      let currentRowLogos = 0;
      
      // Second pass: place the logos using the same logic
      for (let i = 0; i < logosToPlace.length; i++) {
        const logoIndex = logosToPlace[i];
        const logo = remainingLogos[logoIndex];
        const logoTotalWidth = logo.logoWidth + spacingPts;
        const logoTotalHeight = logo.logoHeight + spacingPts;
        
        // Check if we're switching to a new file
        if (logo.fileIndex !== currentFileIndex) {
          // New file, force a new row
          currentFileIndex = logo.fileIndex;
          currentRowLogos = 0;
          yCursor -= logoTotalHeight;
        } else {
          // Same file, check if we need a new row
          const logosInCurrentRow = Math.floor((sheetWidthPts - safeMarginPts * 2 + spacingPts) / logoTotalWidth);
          
          if (currentRowLogos >= logosInCurrentRow) {
            // Need a new row for the same file
            currentRowLogos = 0;
            yCursor -= logoTotalHeight;
          }
        }
        
        // Calculate x position for this logo
        const xCursor = safeMarginPts + (currentRowLogos * logoTotalWidth);
        log(`Logo ${logoIndex}: currentRowLogos=${currentRowLogos}, logoTotalWidth=${logoTotalWidth}, xCursor=${xCursor}, sheetWidthPts=${sheetWidthPts}`);
        
        // Embed and draw the logo
        const [embeddedPage] = await sheetDoc.embedPdf(logo.buffer);
        
        if (logo.isRotated) {
          // For rotated logos, adjust x position to account for rotation
          // When rotated 90°, the logo extends to the left of the origin point
          // We need to add the rotated logo's width (which is the original logo's height)
          page.drawPage(embeddedPage, {
            x: xCursor + logo.logoWidth, // Add the rotated logo's width (original height)
            y: yCursor,
            rotate: degrees(90)
          });
        } else {
          page.drawPage(embeddedPage, { x: xCursor, y: yCursor });
        }
        
        log(`Placed logo ${logoIndex} at position (${xCursor}, ${yCursor}) on sheet ${sheetIndex}`);
        
        currentRowLogos++;
        logosOnThisSheet++;
      }
      
      // Remove the logos we just placed
      for (let i = logosToPlace.length - 1; i >= 0; i--) {
        remainingLogos.splice(logosToPlace[i], 1);
      }
      
      // Calculate cost based on the final height (Pro users only)
      const cost = userPlan === 'pro' ? calculateCost(gangWidth, finalHeightInch, userCostTables[gangWidth]) : null;
      
      // Create a descriptive filename for consolidated sheets
      const today = new Date();
      const month = String(today.getMonth() + 1).padStart(2, '0');
      const day = String(today.getDate()).padStart(2, '0');
      const year = String(today.getFullYear()).slice(-2);
      const dateString = `${month}-${day}-${year}`;
      const filename = `${gangWidth}x${finalHeightInch}_gangsheet_${dateString}.pdf`;
      
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

    const totalCost = userPlan === 'pro' ? allSheetData.reduce((sum, s) => sum + (s.cost || 0), 0) : null;
    log(`Total: ${allSheetData.length} sheets${userPlan === 'pro' ? `, $${totalCost}` : ''}`);

    // Increment download count for free users
    if (userPlan === 'free' && userEmail) {
      incrementDownloadCount(userEmail);
    }

    res.json({
      sheets: allSheetData.map(s => ({
        filename: s.filename,
        width: s.width,
        height: s.height,
        cost: s.cost,
        pdfBase64: s.buffer.toString("base64")
      })),
      totalCost,
      userPlan
    });

  } catch (err) {
    console.error("CONSOLIDATED MERGE ERROR:", err);
    res.status(500).send(`Server error: ${err.message}`);
  }
});

// ✅ Keep original single-file endpoint for backward compatibility
app.post("/merge", upload.single("file"), async (req, res) => {
  // Check if user has Pro plan for cost calculation
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  let userPlan = 'free';
  let userEmail = null;
  
  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      userPlan = decoded.plan || 'free';
      userEmail = decoded.email;
    } catch (err) {
      // Token invalid, treat as free user
      userPlan = 'free';
    }
  }
  
  // Check download limits for free users
  if (userPlan === 'free' && userEmail) {
    const downloadLimit = checkDownloadLimit(userEmail);
    if (!downloadLimit.canDownload) {
      return res.status(429).json({ 
        error: 'Download limit reached', 
        message: `Free users can download ${FREE_DOWNLOAD_LIMIT} gang sheets per month. Upgrade to Pro for unlimited downloads.`,
        limit: downloadLimit
      });
    }
  }
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
        // For rotated logos, adjust x position to account for rotation
        // When rotated 90°, the logo extends to the left of the origin point
        page.drawPage(embeddedPage, {
          x: x + logoHeight, // Add the rotated logo's width
          y: y,
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

      // ✅ Calculate cost only for Pro users
      const cost = userPlan === 'pro' ? calculateCost(gangWidth, finalHeightInch) : null;

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

    const totalCost = userPlan === 'pro' ? allSheetData.reduce((sum, s) => sum + (s.cost || 0), 0) : null;

    // Increment download count for free users
    if (userPlan === 'free' && userEmail) {
      incrementDownloadCount(userEmail);
    }

    res.json({
      sheets: allSheetData.map(s => ({
        filename: s.filename,
        width: s.width,
        height: s.height,
        cost: s.cost,
        pdfBase64: s.buffer.toString("base64")
      })),
      totalCost,
      userPlan
    });

  } catch (err) {
    console.error("MERGE ERROR:", err);
    res.status(500).send(`Server error: ${err.message}`);
  }
});

// Authentication Routes
app.post('/api/register', async (req, res) => {
  try {
    const { firstName, lastName, email, password, company, plan } = req.body;

    // Basic validation
    if (!firstName || !lastName || !email || !password) {
      return res.status(400).json({ error: 'All required fields must be provided' });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters long' });
    }

    // Check if user already exists
    if (users.has(email)) {
      return res.status(400).json({ error: 'User already exists' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    const user = {
      id: Date.now().toString(),
      firstName,
      lastName,
      email,
      password: hashedPassword,
      company: company || '',
      plan: plan || 'free',
      createdAt: new Date().toISOString()
    };

    users = addUser(email, user);

    // Generate JWT token
    const token = jwt.sign(
      { userId: user.id, email: user.email, plan: user.plan },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      success: true,
      message: 'User registered successfully',
      token,
      user: {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        company: user.company,
        plan: user.plan
      }
    });

  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Basic validation
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Find user
    const user = users.get(email);
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Check password
    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Generate JWT token
    const token = jwt.sign(
      { userId: user.id, email: user.email, plan: user.plan },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      success: true,
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        company: user.company,
        plan: user.plan
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/profile', authenticateToken, (req, res) => {
  try {
    const user = users.get(req.user.email);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      user: {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        company: user.company,
        plan: user.plan,
        createdAt: user.createdAt
      }
    });

  } catch (error) {
    console.error('Profile error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/logout', (req, res) => {
  res.json({ success: true, message: 'Logged out successfully' });
});

// Plan checking endpoint
app.get('/api/plan', (req, res) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  let userPlan = 'free';
  let userEmail = null;
  
  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      userPlan = decoded.plan || 'free';
      userEmail = decoded.email;
    } catch (err) {
      // Token invalid, treat as free user
      userPlan = 'free';
    }
  }
  
  // Get download limit info for free users
  let downloadLimit = null;
  if (userPlan === 'free' && userEmail) {
    downloadLimit = checkDownloadLimit(userEmail);
  }
  
  res.json({ 
    plan: userPlan,
    downloadLimit: downloadLimit
  });
});

// Admin Routes
app.get('/api/admin/users', authenticateToken, (req, res) => {
  try {
    // Check if user is admin
    const user = users.get(req.user.email);
    if (!user || user.email !== 'admin@ezgangsheets.com') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const allUsers = getAllUsers();
    res.json({ users: allUsers });

  } catch (error) {
    console.error('Admin users error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/api/admin/users/:email', authenticateToken, (req, res) => {
  try {
    // Check if user is admin
    const user = users.get(req.user.email);
    if (!user || user.email !== 'admin@ezgangsheets.com') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { email } = req.params;
    const deleted = deleteUser(email);
    
    if (deleted) {
      // Update the users Map in memory
      users = loadUsers();
      res.json({ success: true, message: 'User deleted successfully' });
    } else {
      res.status(404).json({ error: 'User not found' });
    }

  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/api/admin/users/:email/plan', authenticateToken, (req, res) => {
  try {
    // Check if user is admin
    const user = users.get(req.user.email);
    if (!user || user.email !== 'admin@ezgangsheets.com') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { email } = req.params;
    const { plan } = req.body;

    if (!plan || !['free', 'pro'].includes(plan)) {
      return res.status(400).json({ error: 'Invalid plan. Must be "free" or "pro"' });
    }

    const updatedUser = updateUser(email, { plan });
    
    if (updatedUser) {
      // Update the users Map in memory
      users = loadUsers();
      res.json({ 
        success: true, 
        message: `User plan updated to ${plan}`,
        user: {
          email: updatedUser.email,
          firstName: updatedUser.firstName,
          lastName: updatedUser.lastName,
          plan: updatedUser.plan
        }
      });
    } else {
      res.status(404).json({ error: 'User not found' });
    }

  } catch (error) {
    console.error('Update user plan error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Stripe Payment Endpoints
app.post('/api/create-checkout-session', async (req, res) => {
  if (!stripe) {
    return res.status(503).json({ error: 'Payment system not available' });
  }
  
  try {
    const { plan, billingCycle, customerEmail } = req.body;
    
    if (!plan || !billingCycle || !customerEmail) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    const priceId = SUBSCRIPTION_PLANS[plan][billingCycle];
    
    if (!priceId) {
      return res.status(400).json({ error: 'Invalid plan or billing cycle' });
    }
    
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      customer_email: customerEmail,
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      mode: 'subscription',
      success_url: `${process.env.DOMAIN || 'http://localhost:8080'}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.DOMAIN || 'http://localhost:8080'}/pricing`,
      metadata: {
        userEmail: customerEmail,
        plan: plan,
        billingCycle: billingCycle
      }
    });

    res.json({ sessionId: session.id });
  } catch (error) {
    console.error('Stripe checkout error:', error);
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

// Handle Stripe webhook events
app.post('/api/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!stripe) {
    return res.status(503).json({ error: 'Payment system not available' });
  }
  
  const sig = req.headers['stripe-signature'];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle the event
  switch (event.type) {
    case 'customer.subscription.created':
      const subscription = event.data.object;
      console.log('Subscription created:', subscription.id);
      // Update user's subscription status in your database
      await handleSubscriptionCreated(subscription);
      break;
    case 'customer.subscription.updated':
      const updatedSubscription = event.data.object;
      console.log('Subscription updated:', updatedSubscription.id);
      await handleSubscriptionUpdated(updatedSubscription);
      break;
    case 'customer.subscription.deleted':
      const deletedSubscription = event.data.object;
      console.log('Subscription deleted:', deletedSubscription.id);
      await handleSubscriptionDeleted(deletedSubscription);
      break;
    default:
      console.log(`Unhandled event type ${event.type}`);
  }

  res.json({ received: true });
});

// Helper functions for webhook handling
async function handleSubscriptionCreated(subscription) {
  try {
    const userEmail = subscription.metadata?.userEmail;
    if (userEmail) {
      const user = users.get(userEmail);
      if (user) {
        user.plan = 'pro';
        user.stripeSubscriptionId = subscription.id;
        user.stripeCustomerId = subscription.customer;
        saveUsers(users);
        console.log(`User ${userEmail} upgraded to Pro plan`);
      }
    }
  } catch (error) {
    console.error('Error handling subscription created:', error);
  }
}

async function handleSubscriptionUpdated(subscription) {
  try {
    const userEmail = subscription.metadata?.userEmail;
    if (userEmail) {
      const user = users.get(userEmail);
      if (user) {
        user.stripeSubscriptionId = subscription.id;
        saveUsers(users);
        console.log(`User ${userEmail} subscription updated`);
      }
    }
  } catch (error) {
    console.error('Error handling subscription updated:', error);
  }
}

async function handleSubscriptionDeleted(subscription) {
  try {
    const userEmail = subscription.metadata?.userEmail;
    if (userEmail) {
      const user = users.get(userEmail);
      if (user) {
        user.plan = 'free';
        user.stripeSubscriptionId = null;
        saveUsers(users);
        console.log(`User ${userEmail} downgraded to Free plan`);
      }
    }
  } catch (error) {
    console.error('Error handling subscription deleted:', error);
  }
}

// Get subscription status
app.get('/api/subscription-status', authenticateToken, async (req, res) => {
  try {
    const user = users.get(req.user.email);
    
    res.json({
      hasActiveSubscription: user.plan === 'pro',
      plan: user.plan,
      status: user.plan === 'pro' ? 'active' : 'inactive'
    });
  } catch (error) {
    console.error('Subscription status error:', error);
    res.status(500).json({ error: 'Failed to get subscription status' });
  }
});

app.listen(port, () => {
  console.log(`Backend running on port ${port}`);
}); 
