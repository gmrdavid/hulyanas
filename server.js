const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const fs = require('fs').promises;

const app = express();
const PORT = process.env.PORT;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));
app.use('/user', express.static('user'));
app.use('/admin', express.static('admin'));

// MySQL Connection Pool
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  ssl: {
    rejectUnauthorized: false
  }
});

// JWT Secret
const JWT_SECRET = 'hulyanas_secret_key_2024_secure_change_this';

// Multer setup
const storage = multer.diskStorage({
    destination: async (req, file, cb) => {
        try {
            await fs.mkdir('public/images', { recursive: true });
            cb(null, 'public/images/');
        } catch (err) {
            cb(err, '');
        }
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname));
    }
});
const upload = multer({ 
    storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) cb(null, true);
        else cb(new Error('Only image files'), false);
    }
});

// Auth middleware
const authenticateToken = async (req, res, next) => {
    try {
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1];
        if (!token) return res.status(401).json({ error: 'Access token required' });
        
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        res.status(403).json({ error: 'Invalid token' });
    }
};

const isAdmin = (req, res, next) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
    next();
};

// ===== CUSTOMER ROUTES =====

// Register
app.post('/api/register', async (req, res) => {
    try {
        const { username, email, password, first_name, last_name, phone } = req.body;
        const hashedPassword = await bcrypt.hash(password, 12);
        
        const conn = await pool.getConnection();
        try {
            await conn.beginTransaction();
            const [result] = await conn.execute(
                `INSERT INTO users (username, email, password_hash, first_name, last_name, phone, role) 
                 VALUES (?, ?, ?, ?, ?, ?, 'customer')`,
                [username, email, hashedPassword, first_name, last_name, phone]
            );
            await conn.commit();
            res.status(201).json({ message: 'Registered successfully' });
        } catch (err) {
            await conn.rollback();
            if (err.code === 'ER_DUP_ENTRY') {
                return res.status(400).json({ error: 'Username or email exists' });
            }
            throw err;
        } finally {
            conn.release();
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Login
app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const conn = await pool.getConnection();
        
        const [rows] = await conn.execute(
            `SELECT id, username, email, password_hash, role, first_name, last_name 
             FROM users WHERE username = ? OR email = ?`,
            [username, username]
        );
        conn.release();
        
        if (rows.length === 0) return res.status(401).json({ error: 'Invalid credentials' });
        
        const user = rows[0];
        const valid = await bcrypt.compare(password, user.password_hash);
        if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
        
        const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '24h' });
        
        res.json({
            token,
            user: {
                id: user.id,
                username: user.username,
                role: user.role,
                full_name: `${user.first_name} ${user.last_name}`
            }
        });
    } catch (error) {
        res.status(500).json({ error: 'Login failed' });
    }
});

// Profile
app.get('/api/profile', authenticateToken, async (req, res) => {
    try {
        const conn = await pool.getConnection();
        const [rows] = await conn.execute(
            `SELECT id, username, email, first_name, last_name, phone, created_at 
             FROM users WHERE id = ?`,
            [req.user.id]
        );
        conn.release();
        
        if (rows.length === 0) return res.status(404).json({ error: 'User not found' });
        
        const user = rows[0];
        res.json({
            ...user,
            full_name: `${user.first_name} ${user.last_name}`
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Update profile
app.put('/api/profile', authenticateToken, async (req, res) => {
    try {
        const { first_name, last_name, phone } = req.body;
        const conn = await pool.getConnection();
        
        await conn.execute(
            `UPDATE users SET first_name = ?, last_name = ?, phone = ? WHERE id = ?`,
            [first_name, last_name, phone, req.user.id]
        );
        conn.release();
        
        res.json({ message: 'Profile updated' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ===== ORDERS ROUTES =====
app.get('/api/orders', authenticateToken, async (req, res) => {
    try {
        const conn = await pool.getConnection();
        const [rows] = await conn.execute(
            `SELECT o.*, 
                    TIME_FORMAT(TIMEDIFF(NOW(), o.created_at), '%i min ago') as time_ago
             FROM orders o 
             WHERE o.user_id = ? 
             ORDER BY o.created_at DESC`,
            [req.user.id]
        );
        conn.release();
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ===== DASHBOARD STATS (NEW!) =====
app.get('/api/dashboard/stats', authenticateToken, async (req, res) => {
    try {
        const conn = await pool.getConnection();
        
        const [[totalOrders], [totalSpent], [activeOrders]] = await Promise.all([
            conn.execute(`SELECT COUNT(*) as count FROM orders WHERE user_id = ?`, [req.user.id]),
            conn.execute(`SELECT COALESCE(SUM(total_amount), 0) as total FROM orders WHERE user_id = ? AND status != 'cancelled'`, [req.user.id]),
            conn.execute(`SELECT COUNT(*) as count FROM orders WHERE user_id = ? AND status IN ('pending', 'preparing')`, [req.user.id])
        ]);
        
        conn.release();
        
        res.json({
            totalOrders: parseInt(totalOrders[0].count),
            totalSpent: parseFloat(totalSpent[0].total).toFixed(2),
            avgRating: 4.8, // Add ratings table later
            activeItems: parseInt(activeOrders[0].count)
        });
    } catch (error) {
        console.error('Stats error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ===== MENU ROUTES =====
app.get('/api/menu', async (req, res) => {
    try {
        const conn = await pool.getConnection();
        const [rows] = await conn.execute(
            `SELECT id, name, description, price, category, image_url, is_available 
             FROM menu_items WHERE is_available = TRUE ORDER BY category, name`
        );
        conn.release();
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ===== ADD MENU ITEM =====
app.post('/api/menu', upload.single('image'), async (req, res) => {
    try {

        const {
            name,
            description,
            price,
            category,
            is_available
        } = req.body;

        const image_url = req.file
            ? `/images/${req.file.filename}`
            : '';

        const conn = await pool.getConnection();

        await conn.execute(
            `
            INSERT INTO menu_items
            (
                name,
                description,
                price,
                category,
                image_url,
                is_available
            )
            VALUES (?, ?, ?, ?, ?, ?)
            `,
            [
                name,
                description,
                price,
                category,
                image_url,
                is_available
            ]
        );

        conn.release();

        res.json({
            message: 'Menu item added successfully'
        });

    } catch (error) {

        console.error(error);

        res.status(500).json({
            error: error.message
        });
    }
});


// ===== UPDATE MENU ITEM =====
app.put('/api/menu/:id', upload.single('image'), async (req, res) => {

    try {

        const { id } = req.params;

        const {
            name,
            description,
            price,
            category,
            is_available
        } = req.body;

        const conn = await pool.getConnection();

        // Get old image
        const [oldItem] = await conn.execute(
            `SELECT image_url FROM menu_items WHERE id=?`,
            [id]
        );

        let image_url = oldItem[0]?.image_url || '';

        // If new image uploaded
        if (req.file) {
            image_url = `/images/${req.file.filename}`;
        }

        await conn.execute(
            `
            UPDATE menu_items
            SET
                name=?,
                description=?,
                price=?,
                category=?,
                image_url=?,
                is_available=?
            WHERE id=?
            `,
            [
                name,
                description,
                price,
                category,
                image_url,
                is_available,
                id
            ]
        );

        conn.release();

        res.json({
            message: 'Menu item updated successfully'
        });

    } catch (error) {

        console.error(error);

        res.status(500).json({
            error: error.message
        });
    }
});


// ===== DELETE MENU ITEM =====
app.delete('/api/menu/:id', async (req, res) => {

    try {

        const { id } = req.params;

        const conn = await pool.getConnection();

        // Soft delete instead of actual delete
        await conn.execute(
            `
            UPDATE menu_items
            SET is_available = 0
            WHERE id = ?
            `,
            [id]
        );

        conn.release();

        res.json({
            message: 'Menu item marked as unavailable'
        });

    } catch (error) {

        console.error(error);

        res.status(500).json({
            error: error.message
        });
    }
});

app.get('/api/admin/activity', authenticateToken, isAdmin, async (req, res) => {
    try {
        const conn = await pool.getConnection();
        const [rows] = await conn.execute(`
            SELECT type, action as message, created_at 
            FROM activity_log 
            ORDER BY created_at DESC LIMIT 10
        `);
        conn.release();

        // Format time_ago like dashboard expects
        const formatted = rows.map(row => ({
            type: row.type || 'system',
            message: row.message,
            time: formatTimeAgo(row.created_at)
        }));

        res.json(formatted);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Add this helper function at the bottom (before app.listen)
function formatTimeAgo(date) {
    const now = new Date();
    const orderDate = new Date(date);
    const diff = Math.floor((now - orderDate) / 1000 / 60);
    if (diff < 1) return 'Just now';
    if (diff < 60) return `${diff}m ago`;
    const hours = Math.floor(diff / 60);
    return `${hours}h ago`;
}
// 🆕 1. GET SINGLE ORDER BY ID (for edit modal)
app.get('/api/admin/orders/:id', authenticateToken, isAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const conn = await pool.getConnection();
        
        const [rows] = await conn.execute(`
            SELECT 
                o.id,
                o.order_number,
                CONCAT(u.first_name, ' ', u.last_name) as customer,
                o.total_amount,
                o.status,
                o.created_at
            FROM orders o 
            LEFT JOIN users u ON o.user_id = u.id 
            WHERE o.id = ?
        `, [id]);
        
        conn.release();
        
        if (rows.length === 0) {
            return res.status(404).json({ error: 'Order not found' });
        }
        
        res.json(rows[0]);
        
    } catch (error) {
        console.error('Get order error:', error);
        res.status(500).json({ error: 'Failed to fetch order' });
    }
});

// 🆕 2. UPDATE ORDER STATUS ONLY (PUT endpoint)
app.put('/api/admin/orders/:id', authenticateToken, isAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        
        // ✅ Validate status
        const validStatuses = ['pending', 'preparing', 'delivered', 'cancelled'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({ error: 'Invalid status' });
        }
        
        const conn = await pool.getConnection();
        
        const [result] = await conn.execute(
            `UPDATE orders 
             SET status = ?, updated_at = NOW() 
             WHERE id = ?`,
            [status, id]
        );
        
        conn.release();
        
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Order not found' });
        }
        
        res.json({ 
            success: true, 
            message: `Status updated to ${status}`,
            affectedRows: result.affectedRows 
        });
        
    } catch (error) {
        console.error('Update order error:', error);
        res.status(500).json({ error: 'Failed to update order' });
    }
});

// ===== ADMIN ROUTES =====
app.get('/api/admin/stats', authenticateToken, isAdmin, async (req, res) => {
    try {
        const conn = await pool.getConnection();
        const [[menuItems], [totalOrders], [revenue], [totalUsers]] = await Promise.all([
            conn.execute(`SELECT COUNT(*) as count FROM menu_items WHERE is_available = TRUE`),
            conn.execute(`SELECT COUNT(*) as count FROM orders`),
            conn.execute(`SELECT COALESCE(SUM(total_amount), 0) as revenue FROM orders WHERE status != 'cancelled'`),
            conn.execute(`SELECT COUNT(*) as count FROM users WHERE role = 'customer'`)
        ]);
        conn.release();
        
        res.json({
            menuItems: parseInt(menuItems[0].count),
            totalOrders: parseInt(totalOrders[0].count),
            revenue: parseFloat(revenue[0].revenue).toFixed(2),
            totalUsers: parseInt(totalUsers[0].count)
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/admin/recent-orders', authenticateToken, isAdmin, async (req, res) => {
    try {
        const conn = await pool.getConnection();
        const [rows] = await conn.execute(
            `SELECT 
                o.id,
                o.order_number as order_number,
                CONCAT(u.first_name, ' ', u.last_name) as customer,
                o.status,
                o.total_amount,
                CASE 
                    WHEN TIMESTAMPDIFF(MINUTE, o.created_at, NOW()) < 60 THEN 
                        CONCAT(TIMESTAMPDIFF(MINUTE, o.created_at, NOW()), ' min ago')
                    ELSE 
                        CONCAT(FLOOR(TIMESTAMPDIFF(HOUR, o.created_at, NOW()) / 60), ' hr ago')
                END as time_ago
             FROM orders o JOIN users u ON o.user_id = u.id 
             ORDER BY o.created_at DESC LIMIT 10`
        );
        conn.release();
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ADMIN ORDERS API
app.get('/api/admin/orders', authenticateToken, isAdmin, async (req, res) => {

    try {

        const conn = await pool.getConnection();

        const [rows] = await conn.execute(`
            SELECT
                o.*,
                CONCAT(u.first_name, ' ', u.last_name)
                AS customer_name
            FROM orders o
            LEFT JOIN users u
            ON o.user_id = u.id
            ORDER BY o.created_at DESC
        `);

        conn.release();

        res.json(rows);

    } catch (error) {

        console.error(error);

        res.status(500).json({
            error: error.message
        });
    }
});

// UPDATE ORDER STATUS
app.put('/api/admin/orders/:id/status',
authenticateToken,
isAdmin,
async (req, res) => {

    try {

        const { status } = req.body;

        const conn = await pool.getConnection();

        await conn.execute(
            `UPDATE orders
             SET status = ?
             WHERE id = ?`,
            [status, req.params.id]
        );

        conn.release();

        res.json({
            message: 'Order status updated'
        });

    } catch (error) {

        console.error(error);

        res.status(500).json({
            error: error.message
        });
    }
});

// DELETE ORDER
app.delete('/api/admin/orders/:id',
authenticateToken,
isAdmin,
async (req, res) => {

    try {

        const conn = await pool.getConnection();

        await conn.execute(
            `DELETE FROM orders
             WHERE id = ?`,
            [req.params.id]
        );

        conn.release();

        res.json({
            message: 'Order deleted successfully'
        });

    } catch (error) {

        console.error(error);

        res.status(500).json({
            error: error.message
        });
    }
});

// ===== ADMIN USERS API =====
app.get('/api/admin/users',
authenticateToken,
isAdmin,
async (req, res) => {

    try {

        const conn = await pool.getConnection();

        const [rows] = await conn.execute(`
            SELECT
                id,
                username,
                email,
                first_name,
                last_name,
                phone,
                role,
                is_active,
                created_at,
                updated_at
            FROM users
            ORDER BY id DESC
        `);

        conn.release();

        res.json(rows);

    } catch (error) {

        console.error(error);

        res.status(500).json({
            error: error.message
        });
    }
});

app.delete('/api/admin/users/:id',
authenticateToken,
isAdmin,
async (req, res) => {

    try {

        const conn = await pool.getConnection();

        await conn.execute(
            `DELETE FROM users WHERE id = ?`,
            [req.params.id]
        );

        conn.release();

        res.json({
            message: 'User deleted successfully'
        });

    } catch (error) {

        console.error(error);

        res.status(500).json({
            error: error.message
        });
    }
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`📊 Customer Dashboard: http://localhost:${PORT}/user/dashboard.html`);
    console.log(`👑 Admin Dashboard: http://localhost:${PORT}/admin/dashboard.html`);
});