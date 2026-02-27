/**
 * Pho Huong Viet — Webhook Receiver + Admin Dashboard
 * Node.js + Express
 *
 * POST /webhook/orders  ← receives orders from restaurant API
 * GET  /admin           ← live admin dashboard
 * GET  /admin/orders    ← get all orders as JSON
 * GET  /admin/stream    ← SSE stream for real-time updates
 */

require('dotenv').config();
const express    = require('express');
const bodyParser = require('body-parser');
const path       = require('path');

const app  = express();
const PORT = process.env.PORT || 4000;

// ─── In-memory order store (replace with a DB later) ─────────
let orders = [];

// ─── SSE clients (browsers listening for live updates) ───────
let sseClients = [];

// ─── Middleware ───────────────────────────────────────────────
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'admin-public')));

// ─── Helpers ─────────────────────────────────────────────────
function broadcastOrder(order) {
  const payload = `data: ${JSON.stringify(order)}\n\n`;
  sseClients.forEach(client => client.res.write(payload));
}

// ─── Webhook Endpoint ─────────────────────────────────────────
app.post('/webhook/orders', (req, res) => {
  const order = req.body;

  // 2. Basic sanity check
  if (!order || !order.order_id || !order.customer) {
    return res.status(400).json({ error: 'Invalid order payload' });
  }

  // 3. Attach a received timestamp
  order.received_at = new Date().toISOString();
  order.status      = 'pending'; // pending | confirmed | cancelled | rejected

  // 4. Store it
  orders.unshift(order); // newest first
  console.log(`📦 New order received: ${order.order_id} from ${order.customer.name}`);

  // 5. Broadcast to all open admin dashboards in real-time
  broadcastOrder(order);

  // 6. Acknowledge
  res.status(200).json({ received: true, order_id: order.order_id });
});

// ─── SSE Stream (real-time push to admin dashboard) ──────────
app.get('/admin/stream', (req, res) => {
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.flushHeaders();

  // Send a heartbeat every 30s to keep the connection alive
  const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 30000);

  // Register this client
  const client = { id: Date.now(), res };
  sseClients.push(client);
  console.log(`👀 Admin connected (${sseClients.length} watching)`);

  // Clean up when browser disconnects
  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients = sseClients.filter(c => c.id !== client.id);
    console.log(`👋 Admin disconnected (${sseClients.length} watching)`);
  });
});

// ─── Admin API ────────────────────────────────────────────────
// Get all orders
app.get('/admin/orders', (req, res) => {
  res.json({ success: true, count: orders.length, orders });
});

// Update order status
app.patch('/admin/orders/:orderId/status', (req, res) => {
  const { orderId } = req.params;
  const { status, confirm_minutes, confirmed_at } = req.body;

  const validStatuses = ['pending', 'confirmed', 'cancelled', 'rejected'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${validStatuses.join(', ')}` });
  }

  const order = orders.find(o => o.order_id === orderId);
  if (!order) return res.status(404).json({ error: 'Order not found' });

  order.status     = status;
  order.updated_at = new Date().toISOString();
  if (confirm_minutes) order.confirm_minutes = confirm_minutes;
  if (confirmed_at)    order.confirmed_at    = confirmed_at;

  broadcastOrder({
    __type:          'status_update',
    order_id:        orderId,
    status,
    confirm_minutes: order.confirm_minutes,
    confirmed_at:    order.confirmed_at,
    updated_at:      order.updated_at,
  });

  console.log(`🔄 Order ${orderId} → ${status}`);
  res.json({ success: true, order });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', orders: orders.length, clients: sseClients.length });
});

// Redirect root to admin dashboard
app.get('/', (req, res) => {
  res.redirect('/admin');
});

// Serve admin dashboard at /admin
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin-public', 'dashboard.html'));
});

// ─── Start ────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🍜 Webhook Receiver running on http://localhost:${PORT}`);
  console.log(`   Webhook URL : http://localhost:${PORT}/webhook/orders`);
  console.log(`   Admin Panel : http://localhost:${PORT}/admin\n`);
});