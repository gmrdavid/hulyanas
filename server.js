require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise'); // Use promise version
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));
app.use('/user', express.static('user'));
app.use('/admin', express.static('admin'));

// ==================== FIXED MYSQL POOL ====================
const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'hulyanas',
    port: process.env.DB_PORT || 3306,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    acquireTimeout: 60000,
    timeout: 60000,
    reconnect: true,
    ssl: process.env.DB_HOST !== 'localhost' ? { rejectUnauthorized: false } : false
});

// Test connection on startup
pool.getConnection().then(conn => {
    console.log('✅ Connected to hulyanas MySQL database');
    conn.release();
}).catch(err => {
    console.error('❌ Database connection failed:', err);
    process.exit(1);
});

// JWT Secret
const JWT_SECRET = process.env.JWT_SECRET || 'hulyanas_secret_key_2024_change_this';

// File uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = 'public/images';
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

// ==================== AUTH MIDDLEWARE ====================
const authenticateToken = async (req, res, next) => {
    try {
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1];

        if (!token) {
            return res.status(401).json({ error: 'Access token required' });
        }

        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        res.status(403).json({ error: 'Invalid token' });
    }
};

const isAdmin = (req, res, next) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }
    next();
};

// ==================== ADMIN DASHBOARD APIs ====================
app.get('/api/admin/stats', authenticateToken, isAdmin, async (req, res) => {
    try {
        const [stats] = await pool.execute(`
            SELECT 
                (SELECT COUNT(*) FROM menu_items) as menuItems,
                (SELECT COUNT(*) FROM orders) as totalOrders,
                (SELECT COALESCE(SUM(total_amount), 0) FROM orders WHERE status != 'cancelled') as revenue,
                (SELECT COUNT(*) FROM users WHERE role = 'customer') as totalUsers
        `);
        
        res.json({
            menuItems: parseInt(stats[0].menuItems) || 0,
            totalOrders: parseInt(stats[0].totalOrders) || 0,
            revenue: parseFloat(stats[0].revenue) || 0,
            totalUsers: parseInt(stats[0].totalUsers) || 0
        });
    } catch (err) {
        console.error('Stats error:', err);
        res.status(500).json({ error: 'Stats unavailable' });
    }
});

app.get('/api/admin/recent-orders', authenticateToken, isAdmin, async (req, res) => {
    try {
        const [orders] = await pool.execute(`
            SELECT id, order_number, customer_name, status, total_amount, created_at,
                CASE 
                    WHEN TIMESTAMPDIFF(MINUTE, created_at, NOW()) < 60 THEN CONCAT(TIMESTAMPDIFF(MINUTE, created_at, NOW()), ' min ago')
                    WHEN TIMESTAMPDIFF(HOUR, created_at, NOW()) < 24 THEN CONCAT(TIMESTAMPDIFF(HOUR, created_at, NOW()), ' hr ago')
                    ELSE DATE_FORMAT(created_at, '%b %d')
                END as relative_time
            FROM orders ORDER BY created_at DESC LIMIT 5
        `);
        res.json(orders);
    } catch (err) {
        console.error('Recent orders error:', err);
        res.status(500).json({ error: 'Orders unavailable' });
    }
});

app.get('/api/admin/activity', authenticateToken, isAdmin, async (req, res) => {
    try {
        const [activity] = await pool.execute(`
            SELECT 'order' as type, 
                CONCAT('Order #', order_number, ' ', status) as text,
                CASE 
                    WHEN TIMESTAMPDIFF(MINUTE, created_at, NOW()) < 60 THEN CONCAT(TIMESTAMPDIFF(MINUTE, created_at, NOW()), ' min ago')
                    ELSE CONCAT(FLOOR(TIMESTAMPDIFF(HOUR, created_at, NOW())/60), ' hrs ago')
                END as time
            FROM orders WHERE created_at > DATE_SUB(NOW(), INTERVAL 1 DAY)
            ORDER BY created_at DESC LIMIT 5
        `);
        res.json(activity);
    } catch (err) {
        console.error('Activity error:', err);
        res.status(500).json({ error: 'Activity unavailable' });
    }
});

// ==================== LOGIN & REGISTER ====================
app.post('/api/login', async (req, res) => {
    try {
        const { name, password } = req.body;
        
        console.log(`🔐 Login: ${name}`);
        
        const [results] = await pool.execute(
            'SELECT * FROM users WHERE name = ? OR email = ?', 
            [name, name]
        );
        
        if (results.length === 0) {
            return res.status(401).json({ error: 'User not found' });
        }
        
        const user = results[0];
        const isMatch = await bcrypt.compare(password, user.password);
        
        if (!isMatch) {
            return res.status(401).json({ error: 'Invalid password' });
        }
        
        const token = jwt.sign(
            { id: user.id, name: user.name, email: user.email, role: user.role },
            JWT_SECRET,
            { expiresIn: '24h' }
        );
        
        res.json({
            token,
            user: { id: user.id, name: user.name, email: user.email, role: user.role }
        });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'Login failed' });
    }
});

app.post('/api/register', async (req, res) => {
    try {
        const { name, email, password, phone, address } = req.body;
        const hashedPassword = await bcrypt.hash(password, 10);
        
        const [result] = await pool.execute(
            'INSERT INTO users (name, email, password, phone, address, role, created_at) VALUES (?, ?, ?, ?, ?, "customer", NOW())',
            [name, email, hashedPassword, phone || null, address || null]
        );
        
        res.status(201).json({ message: 'Registered successfully', userId: result.insertId });
    } catch (err) {
        console.error('Register error:', err);
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ error: 'Email already exists' });
        }
        res.status(500).json({ error: 'Registration failed' });
    }
});

// ==================== PROFILE ====================
app.get('/api/profile', authenticateToken, async (req, res) => {
    try {
        const [results] = await pool.execute(
            'SELECT id, name, email, phone, address, role FROM users WHERE id = ?',
            [req.user.id]
        );
        res.json(results[0]);
    } catch (err) {
        console.error('Profile error:', err);
        res.status(500).json({ error: 'Profile unavailable' });
    }
});

app.put('/api/profile', authenticateToken, async (req, res) => {
    try {
        const { phone, address } = req.body;
        await pool.execute(
            'UPDATE users SET phone = ?, address = ? WHERE id = ?',
            [phone || null, address || null, req.user.id]
        );
        res.json({ message: 'Profile updated' });
    } catch (err) {
        console.error('Profile update error:', err);
        res.status(500).json({ error: 'Update failed' });
    }
});

// ==================== MENU ====================
app.get('/api/menu', async (req, res) => {
    try {
        const [menu] = await pool.execute(
            'SELECT * FROM menu_items WHERE is_available = 1 ORDER BY created_at DESC'
        );
        res.json(menu);
    } catch (err) {
        console.error('Menu error:', err);
        res.status(500).json({ error: 'Menu unavailable' });
    }
});

app.get('/api/admin/menu', authenticateToken, isAdmin, async (req, res) => {
    try {
        const [menu] = await pool.execute('SELECT * FROM menu_items ORDER BY created_at DESC');
        res.json(menu);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/menu', authenticateToken, isAdmin, upload.single('image'), async (req, res) => {
    try {
        const { name, description, price, category } = req.body;
        const image_url = req.file ? req.file.filename : null;
        
        await pool.execute(
            'INSERT INTO menu_items (name, description, price, image_url, category, is_available, created_at) VALUES (?, ?, ?, ?, ?, 1, NOW())',
            [name, description, parseFloat(price), image_url, category]
        );
        res.status(201).json({ message: 'Menu item created' });
    } catch (err) {
        console.error('Menu create error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/admin/menu/:id', authenticateToken, isAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        await pool.execute('DELETE FROM menu_items WHERE id = ?', [id]);
        res.json({ message: 'Menu item deleted' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==================== ORDERS ====================
app.post('/api/orders', authenticateToken, async (req, res) => {
    try {
        const { items, total_amount, phone, address } = req.body;
        
        const [result] = await pool.execute(
            `INSERT INTO orders (user_id, customer_name, customer_phone, customer_address, total_amount, items, status, created_at) 
             VALUES (?, ?, ?, ?, ?, ?, 'pending', NOW())`,
            [req.user.id, req.user.name, phone, address, parseFloat(total_amount), JSON.stringify(items)]
        );
        
        res.status(201).json({ 
            orderId: result.insertId,
            order_number: `ORD-${String(result.insertId).padStart(6, '0')}`
        });
    } catch (err) {
        console.error('Order error:', err);
        res.status(500).json({ error: 'Order failed' });
    }
});

app.get('/api/admin/orders', authenticateToken, isAdmin, async (req, res) => {
    try {
        const [orders] = await pool.execute(`
            SELECT o.*, u.name as customer_name 
            FROM orders o 
            JOIN users u ON o.user_id = u.id 
            ORDER BY o.created_at DESC
        `);
        res.json(orders);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/admin/users', authenticateToken, isAdmin, async (req, res) => {
    try {
        const [users] = await pool.execute(
            'SELECT id, name, email, phone, role, created_at FROM users ORDER BY created_at DESC'
        );
        res.json(users);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Health check
app.get('/api/health', async (req, res) => {
    try {
        await pool.execute('SELECT 1');
        res.json({ status: 'OK', database: 'connected' });
    } catch (err) {
        res.status(500).json({ status: 'Database down' });
    }
});

// ==================== START SERVER ====================
app.listen(PORT, () => {
    console.log(`\n🚀 Hulyanas Hill Server: http://localhost:${PORT}`);
    console.log(`👤 Login: admin@hulyanas.com / admin123`);
    console.log(`📊 Test: http://localhost:${PORT}/api/health`);
    console.log(`\n`);
});