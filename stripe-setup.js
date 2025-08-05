// Stripe Integration Setup for EZGangSheets
// This file contains the basic Stripe setup and example endpoints

import Stripe from 'stripe';

// Initialize Stripe with your secret key
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Example subscription plans (replace with your actual plan IDs from Stripe Dashboard)
const SUBSCRIPTION_PLANS = {
  pro: {
    monthly: 'price_1OXXXXXXXXXXXXX', // Replace with your actual Stripe price ID
    annual: 'price_1OXXXXXXXXXXXXX'   // Replace with your actual Stripe price ID
  },
  enterprise: {
    monthly: 'price_1OXXXXXXXXXXXXX', // Replace with your actual Stripe price ID
    annual: 'price_1OXXXXXXXXXXXXX'   // Replace with your actual Stripe price ID
  }
};

// Example endpoints to add to your main index.js file:

/*
// Create a checkout session for subscription
app.post('/api/create-checkout-session', async (req, res) => {
  try {
    const { plan, billingCycle, customerEmail } = req.body;
    
    const priceId = SUBSCRIPTION_PLANS[plan][billingCycle];
    
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
      success_url: `${process.env.DOMAIN}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.DOMAIN}/pricing`,
    });

    res.json({ sessionId: session.id });
  } catch (error) {
    console.error('Stripe error:', error);
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

// Handle webhook events from Stripe
app.post('/api/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
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
      break;
    case 'customer.subscription.updated':
      const updatedSubscription = event.data.object;
      console.log('Subscription updated:', updatedSubscription.id);
      // Update user's subscription status in your database
      break;
    case 'customer.subscription.deleted':
      const deletedSubscription = event.data.object;
      console.log('Subscription deleted:', deletedSubscription.id);
      // Update user's subscription status in your database
      break;
    default:
      console.log(`Unhandled event type ${event.type}`);
  }

  res.json({ received: true });
});

// Get subscription status
app.get('/api/subscription-status', authenticateToken, async (req, res) => {
  try {
    // In a real implementation, you'd store the Stripe customer ID with the user
    // and retrieve their subscription status from Stripe
    const user = users.get(req.user.email);
    
    // This is a simplified example - you'd need to implement proper customer/subscription lookup
    res.json({
      hasActiveSubscription: user.plan !== 'free',
      plan: user.plan,
      status: 'active' // You'd get this from Stripe
    });
  } catch (error) {
    console.error('Subscription status error:', error);
    res.status(500).json({ error: 'Failed to get subscription status' });
  }
});
*/

// Setup Instructions:
/*
1. Create a Stripe account at https://stripe.com
2. Get your API keys from the Stripe Dashboard
3. Set up your subscription products and prices in the Stripe Dashboard
4. Replace the price IDs in SUBSCRIPTION_PLANS with your actual price IDs
5. Set up webhook endpoints in your Stripe Dashboard
6. Add the environment variables:
   - STRIPE_SECRET_KEY=sk_test_...
   - STRIPE_WEBHOOK_SECRET=whsec_...
   - DOMAIN=https://yourdomain.com
7. Uncomment and integrate the endpoints above into your main index.js file
8. Add Stripe.js to your frontend for payment processing
*/

export { stripe, SUBSCRIPTION_PLANS }; 