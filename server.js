require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'hulyanas-super-secret-key-change-in-production';

// Middleware
app.use(cors({ credentials: true, origin: 'http://localhost:3000' }));
app.use(express.json());
app.use(cookieParser());
app.use(express.static('public'));

// Rate limiting for login
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts per window
  message: 'Too many login attempts, try again later'
});

// Database pool
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10
});

// Middleware to verify JWT
const authenticateToken = (req, res, next) => {
  const token = req.cookies.token || req.headers['authorization']?.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'Access denied. No token provided.' });
  }

  jwt.verify(token, JWT_SECRET, async (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token.' });
    }
    
    // Check if user is admin
    try {
      const [users] = await pool.execute('SELECT id, role FROM users WHERE id = ?', [user.id]);
      if (users.length === 0 || users[0].role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required.' });
      }
      req.user = users[0];
      next();
    } catch (error) {
      res.status(500).json({ error: 'Database error' });
    }
  });
};

// Login route
app.post('/api/login', loginLimiter, async (req, res) => {
  const { email, password } = req.body;

  try {
    const [users] = await pool.execute(
      'SELECT id, email, password, role FROM users WHERE email = ?', 
      [email]
    );

    if (users.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = users[0];
    const validPassword = await bcrypt.compare(password, user.password);

    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access only' });
    }

    // Create JWT token
    const token = jwt.sign(
      { id: user.id, role: user.role }, 
      JWT_SECRET, 
      { expiresIn: '24h' }
    );

    // Set secure cookie
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    });

    res.json({ 
      success: true, 
      message: 'Login successful',
      user: { id: user.id, email: user.email, role: user.role }
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Logout route
app.post('/api/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ success: true, message: 'Logged out successfully' });
});

// Protected API routes
app.get('/api/stats', authenticateToken, async (req, res) => {
  try {
    const [[menu], [orders], [revenue], [users]] = await Promise.all([
      pool.execute('SELECT COUNT(*) as count FROM menu_items'),
      pool.execute('SELECT COUNT(*) as count FROM orders'),
      pool.execute("SELECT COALESCE(SUM(total_amount), 0) as total FROM orders WHERE status != 'cancelled'"),
      pool.execute('SELECT COUNT(*) as count FROM users')
    ]);

    res.json({
      menuItems: Number(menu.count),
      totalOrders: Number(orders.count),
      revenue: parseFloat(revenue.total),
      totalUsers: Number(users.count)
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/recent-orders', authenticateToken, async (req, res) => {
  try {
    const [orders] = await pool.execute(`
      SELECT id, order_number, customer_name, status, total_amount, created_at,
             CASE 
               WHEN TIMESTAMPDIFF(MINUTE, created_at, NOW()) < 60 
               THEN CONCAT(TIMESTAMPDIFF(MINUTE, created_at, NOW()), ' min ago')
               WHEN TIMESTAMPDIFF(HOUR, created_at, NOW()) < 24 
               THEN CONCAT(TIMESTAMPDIFF(HOUR, created_at, NOW()), ' hr ago')
               ELSE DATE_FORMAT(created_at, '%b %d')
             END as relative_time
      FROM orders ORDER BY created_at DESC LIMIT 5
    `);
    res.json(orders);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/activity', authenticateToken, async (req, res) => {
  try {
    const [activity] = await pool.execute(`
      SELECT 'order' as type, CONCAT('New order #', order_number, ' placed') as text,
             CASE 
               WHEN TIMESTAMPDIFF(MINUTE, created_at, NOW()) < 60 
               THEN CONCAT(TIMESTAMPDIFF(MINUTE, created_at, NOW()), ' min ago')
               ELSE CONCAT(FLOOR(TIMESTAMPDIFF(HOUR, created_at, NOW())/24), ' days ago')
             END as time
      FROM orders WHERE created_at > DATE_SUB(NOW(), INTERVAL 2 DAY)
      ORDER BY created_at DESC LIMIT 5
    `);
    res.json(activity);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Check auth status
app.get('/api/auth/status', authenticateToken, async (req, res) => {
  res.json({ authenticated: true, user: req.user });
});

// Serve login page if not authenticated
app.get('/', async (req, res) => {
  try {
    // Check if user has valid token
    const token = req.cookies.token;
    if (token) {
      const decoded = jwt.verify(token, JWT_SECRET);
      const [users] = await pool.execute('SELECT id, role FROM users WHERE id = ?', [decoded.id]);
      if (users.length > 0 && users[0].role === 'admin') {
        return res.sendFile(path.join(__dirname, 'public', 'index.html'));
      }
    }
    // Redirect to login if not authenticated
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
  } catch (error) {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`👤 Admin Login: admin@hulyanas.com / admin123`);
});