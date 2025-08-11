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

if (process.env.STRIPE_SECRET_KEY && process.env.STRIPE_SECRET_KEY !== 'sk_test_your_stripe_secret_key_here') {
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
    console.log('Continuing without Stripe - payment features disabled');
  }
} else {
  console.log('Stripe API key not provided or invalid - payment features disabled');
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

// JWT authentication middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
};

// Logging function
const log = (message) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`);
};

// Cost calculation table (DTF printing costs)
const DEFAULT_COST_TABLE = {
  '2x2': 0.50,
  '3x3': 0.75,
  '4x4': 1.00,
  '5x5': 1.25,
  '6x6': 1.50,
  '8x8': 2.00,
  '10x10': 2.50,
  '12x12': 3.00,
  '16x16': 4.00,
  '20x20': 5.00,
  '24x24': 6.00,
  '30x30': 7.50,
  '36x36': 9.00,
  '48x48': 12.00,
  '60x60': 15.00,
  '72x72': 18.00
};

function calculateCost(widthInches, heightInches, costTable = DEFAULT_COST_TABLE) {
  // Find the closest size in the cost table
  const sizes = Object.keys(costTable).map(size => {
    const [w, h] = size.split('x').map(Number);
    return { size, width: w, height: h, cost: costTable[size] };
  });
  
  let closestSize = sizes[0];
  let minDifference = Math.abs(widthInches - closestSize.width) + Math.abs(heightInches - closestSize.height);
  
  for (const size of sizes) {
    const difference = Math.abs(widthInches - size.width) + Math.abs(heightInches - size.height);
    if (difference < minDifference) {
      minDifference = difference;
      closestSize = size;
    }
  }
  
  return closestSize.cost;
}

// PDF generation endpoint
app.post('/api/generate-pdf', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file provided' });
    }

    const { width, height, quantity, isRotated, gangWidth, maxLength } = req.body;
    
    if (!width || !height || !quantity || !gangWidth || !maxLength) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    const widthInches = parseFloat(width);
    const heightInches = parseFloat(height);
    const quantityNum = parseInt(quantity);
    const gangWidthInches = parseFloat(gangWidth);
    const maxLengthInches = parseFloat(maxLengthLength);
    const isRotatedBool = isRotated === 'true';

    if (widthInches <= 0 || heightInches <= 0 || quantityNum <= 0 || gangWidthInches <= 0 || maxLengthInches <= 0) {
      return res.status(400).json({ error: 'Invalid dimensions or quantities' });
    }

    // Check user's plan and download limits
    const userEmail = req.session.userEmail;
    let userPlan = 'free';
    
    if (userEmail) {
      const user = users.get(userEmail);
      if (user) {
        userPlan = user.plan;
      }
    }

    // Apply download limits for free users
    if (userPlan === 'free') {
      const downloadLimit = checkDownloadLimit(userEmail);
      if (!downloadLimit.canDownload) {
        return res.status(403).json({ 
          error: 'Download limit reached for free plan',
          limit: downloadLimit
        });
      }
    }

    // Calculate layout
    const layout = calculateLayout(widthInches, heightInches, isRotatedBool, gangWidthInches, maxLengthInches);
    
    if (!layout) {
      return res.status(400).json({ error: 'Unable to calculate layout with given parameters' });
    }

    // Create PDF
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([layout.gangWidth * 72, layout.gangLength * 72]); // Convert inches to points (72 points = 1 inch)
    
    // Embed the image
    const imageBytes = req.file.buffer;
    const image = await pdfDoc.embedPng(imageBytes);
    
    // Calculate image dimensions on the page
    const imageWidth = widthInches * 72;
    const imageHeight = heightInches * 72;
    
    // Draw images in the calculated positions
    for (let i = 0; i < layout.positions.length; i++) {
      const pos = layout.positions[i];
      const x = pos.x * 72;
      const y = page.getHeight() - (pos.y * 72) - imageHeight; // Flip Y coordinate for PDF
      
      page.drawImage(image, {
        x: x,
        y: y,
        width: imageWidth,
        height: imageHeight
      });
    }

    // Add metadata
    pdfDoc.setTitle(`Gang Sheet - ${widthInches}"x${heightInches}" - Qty: ${quantityNum}`);
    pdfDoc.setAuthor('EZGangSheets');
    pdfDoc.setSubject('DTF Gang Sheet');
    
    // Generate PDF bytes
    const pdfBytes = await pdfDoc.save();
    
    // Increment download count for free users
    if (userEmail && userPlan === 'free') {
      incrementDownloadCount(userEmail);
    }

    // Set response headers
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="gang-sheet-${widthInches}x${heightInches}-qty${quantityNum}.pdf"`);
    
    // Send PDF
    res.send(Buffer.from(pdfBytes));
    
    log(`PDF generated: ${widthInches}"x${heightInches}" - Qty: ${quantityNum} - User: ${userEmail || 'anonymous'}`);
    
  } catch (error) {
    console.error('PDF generation error:', error);
    res.status(500).json({ error: 'Failed to generate PDF' });
  }
});

// Layout calculation function
function calculateLayout(width, height, isRotated, gangWidth, maxLength) {
  if (isRotated) {
    [width, height] = [height, width];
  }
  
  // Calculate how many images can fit in the gang sheet
  const imagesPerRow = Math.floor(gangWidth / width);
  const imagesPerColumn = Math.floor(maxLength / height);
  const totalImages = imagesPerRow * imagesPerColumn;
  
  if (totalImages === 0) {
    return null;
  }
  
  // Calculate positions for each image
  const positions = [];
  for (let row = 0; row < imagesPerColumn; row++) {
    for (let col = 0; col < imagesPerRow; col++) {
      positions.push({
        x: col * width,
        y: row * height
      });
    }
  }
  
  return {
    gangWidth: gangWidth,
    gangLength: maxLength,
    positions: positions,
    totalImages: totalImages
  };
}

// Multer configuration for file uploads
const storage = multer.memoryStorage();
const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
    files: 1
  },
  fileFilter: (req, file, cb) => {
    // Only allow PNG images
    if (file.mimetype === 'image/png') {
      cb(null, true);
    } else {
      cb(new Error('Only PNG images are allowed'), false);
    }
  }
});

// User registration endpoint
app.post('/api/register', async (req, res) => {
  try {
    const { firstName, lastName, email, password, company } = req.body;
    
    if (!firstName || !lastName || !email || !password) {
      return res.status(400).json({ error: 'All fields are required' });
    }
    
    // Check if user already exists
    if (users.has(email)) {
      return res.status(409).json({ error: 'User already exists' });
    }
    
    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Create user
    const newUser = {
      id: `user-${Date.now()}`,
      firstName,
      lastName,
      email,
      password: hashedPassword,
      company: company || '',
      plan: 'free',
      isAdmin: false,
      createdAt: new Date().toISOString()
    };
    
    // Add user to storage
    users.set(email, newUser);
    saveUsers(users);
    
    // Generate JWT token
    const token = jwt.sign(
      { email: newUser.email, userId: newUser.id },
      JWT_SECRET,
      { expiresIn: '24h' }
    );
    
    res.status(201).json({
      message: 'User registered successfully',
      user: {
        id: newUser.id,
        firstName: newUser.firstName,
        lastName: newUser.lastName,
        email: newUser.email,
        company: newUser.company,
        plan: newUser.plan
      },
      token: token
    });
    
    log(`User registered: ${email}`);
    
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// User login endpoint
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
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
    
    // Set session
    req.session.userEmail = user.email;
    
    // Generate JWT token
    const token = jwt.sign(
      { email: user.email, userId: user.id },
      JWT_SECRET,
      { expiresIn: '24h' }
    );
    
    res.json({
      message: 'Login successful',
      user: {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        company: user.company,
        plan: user.plan,
        isAdmin: user.isAdmin
      },
      token: token
    });
    
    log(`User logged in: ${email}`);
    
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// User logout endpoint
app.post('/api/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: 'Logout failed' });
    }
    res.json({ message: 'Logout successful' });
  });
});

// Get current user endpoint
app.get('/api/user', authenticateToken, (req, res) => {
  try {
    const user = users.get(req.user.email);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json({
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      company: user.company,
      plan: user.plan,
      isAdmin: user.isAdmin
    });
    
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Failed to get user' });
  }
});

// Get user plan and download limit info
app.get('/api/user-plan', (req, res) => {
  const userEmail = req.session.userEmail;
  let userPlan = 'free';
  
  if (userEmail) {
    const user = users.get(userEmail);
    if (user) {
      userPlan = user.plan;
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
