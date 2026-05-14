require('dotenv').config();

const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const fs = require('fs').promises;

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
    origin: '*',
    credentials: true
}));
app.options('*', (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.sendStatus(200);
});

app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));
app.use('/user', express.static('user'));
app.use('/admin', express.static('admin'));
app.use('/images', express.static(path.join(__dirname, 'public/images')));

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
const JWT_SECRET = process.env.JWT_SECRET || 'hulyanas_secret_key_2024_secure_change_this';

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

// ===== 🚀 USER DASHBOARD API ENDPOINTS =====

// 🆕 Get user profile by ID (for dashboard welcome message)
app.get('/api/user/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const conn = await pool.getConnection();
        
        const [rows] = await conn.execute(
            `SELECT id, first_name, last_name, username, email 
             FROM users WHERE id = ? AND is_active = 1`,
            [parseInt(id)]
        );
        conn.release();
        
        if (rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        const user = rows[0];
        res.json({
            id: user.id,
            first_name: user.first_name,
            last_name: user.last_name,
            username: user.username,
            email: user.email,
            full_name: `${user.first_name} ${user.last_name}`.trim()
        });
    } catch (error) {
        console.error('🚨 User fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch user data' });
    }
});

// 🆕 Get user statistics (for dashboard stats cards)
app.get('/api/user/:id/stats', async (req, res) => {
    try {
        const { id } = req.params;
        const conn = await pool.getConnection();
        
        const [stats] = await conn.execute(`
            SELECT 
                COUNT(*) as totalOrders,
                COALESCE(SUM(total_amount), 0) as totalSpent,
                COUNT(CASE WHEN status IN ('pending', 'preparing', 'out_for_delivery') THEN 1 END) as activeOrders,
                4.8 as avgRating
            FROM orders 
            WHERE user_id = ?
        `, [parseInt(id)]);
        
        conn.release();
        
        const userStats = stats[0];
        res.json({
            totalOrders: parseInt(userStats.totalOrders || 0),
            totalSpent: parseFloat(userStats.totalSpent || 0),
            activeOrders: parseInt(userStats.activeOrders || 0),
            avgRating: parseFloat(userStats.avgRating || 0)
        });
        
    } catch (error) {
        console.error('🚨 User stats error:', error);
        res.status(500).json({ error: 'Failed to fetch user stats' });
    }
});

// 🆕 Get user recent activity (for activity feed)
app.get('/api/user/:id/activity', async (req, res) => {
    try {
        const { id } = req.params;
        const conn = await pool.getConnection();
        
        const [rows] = await conn.execute(`
            SELECT al.id, al.type, al.action, al.details, al.created_at,
                   CASE 
                       WHEN al.type = 'order' AND JSON_EXTRACT(al.details, '$.order_number') IS NOT NULL 
                       THEN CONCAT('Order ', JSON_UNQUOTE(JSON_EXTRACT(al.details, '$.order_number')))
                       ELSE al.action 
                   END as display_action
            FROM activity_log al
            WHERE al.user_id = ? OR al.user_id IS NULL
            ORDER BY al.created_at DESC 
            LIMIT 5
        `, [parseInt(id)]);
        
        conn.release();
        
        const activities = rows.map(activity => ({
            id: activity.id,
            type: activity.type || 'system',
            action: activity.action,
            display_action: activity.display_action || activity.action,
            details: activity.details ? JSON.parse(activity.details) : null,
            created_at: activity.created_at
        }));
        
        res.json(activities);
    } catch (error) {
        console.error('🚨 User activity error:', error);
        res.status(500).json({ error: 'Failed to fetch activity' });
    }
});

// ===== AUTHENTICATION ROUTES =====

// Register
app.post('/api/register', async (req, res) => {
    try {
        const { username, email, password, first_name, last_name, phone } = req.body;
        
        if (!username || !email || !password) {
            return res.status(400).json({ error: 'Username, email, and password required' });
        }
        
        const hashedPassword = await bcrypt.hash(password, 12);
        const conn = await pool.getConnection();
        
        try {
            await conn.beginTransaction();
            const [result] = await conn.execute(
                `INSERT INTO users (username, email, password_hash, first_name, last_name, phone, role, is_active) 
                 VALUES (?, ?, ?, ?, ?, ?, 'customer', 1)`,
                [username, email, hashedPassword, first_name || '', last_name || '', phone || null]
            );
            await conn.commit();
            
            res.status(201).json({ 
                message: 'Registered successfully',
                userId: result.insertId 
            });
        } catch (err) {
            await conn.rollback();
            if (err.code === 'ER_DUP_ENTRY') {
                return res.status(400).json({ error: 'Username or email already exists' });
            }
            throw err;
        } finally {
            conn.release();
        }
    } catch (error) {
        console.error('🚨 Register error:', error);
        res.status(500).json({ error: 'Registration failed' });
    }
});

// Login
app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password required' });
        }
        
        const conn = await pool.getConnection();
        const [rows] = await conn.execute(
            `SELECT id, username, email, password_hash, role, first_name, last_name, is_active
             FROM users WHERE (username = ? OR email = ?) AND is_active = 1`,
            [username, username]
        );
        conn.release();
        
        if (rows.length === 0) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        const user = rows[0];
        const valid = await bcrypt.compare(password, user.password_hash);
        if (!valid) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        const token = jwt.sign(
            { id: user.id, username: user.username, role: user.role }, 
            JWT_SECRET, 
            { expiresIn: '24h' }
        );
        
        res.json({
            token,
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                role: user.role,
                full_name: `${user.first_name} ${user.last_name}`.trim()
            }
        });
    } catch (error) {
        console.error('🚨 Login error:', error);
        res.status(500).json({ error: 'Login failed' });
    }
});

// Profile
app.get('/api/profile', authenticateToken, async (req, res) => {
    try {
        const conn = await pool.getConnection();
        const [rows] = await conn.execute(
            `SELECT id, username, email, first_name, last_name, phone, created_at, is_active
             FROM users WHERE id = ?`,
            [req.user.id]
        );
        conn.release();
        
        if (rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        const user = rows[0];
        res.json({
            id: user.id,
            username: user.username,
            email: user.email,
            first_name: user.first_name,
            last_name: user.last_name,
            phone: user.phone,
            full_name: `${user.first_name} ${user.last_name}`.trim(),
            created_at: user.created_at
        });
    } catch (error) {
        console.error('🚨 Profile error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Update profile
app.put('/api/profile', authenticateToken, async (req, res) => {
    try {
        const { first_name, last_name, phone } = req.body;
        const conn = await pool.getConnection();
        
        const [result] = await conn.execute(
            `UPDATE users SET first_name = ?, last_name = ?, phone = ?, updated_at = NOW() WHERE id = ?`,
            [first_name || '', last_name || '', phone || null, req.user.id]
        );
        conn.release();
        
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        res.json({ message: 'Profile updated successfully' });
    } catch (error) {
        console.error('🚨 Profile update error:', error);
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
        console.error('🚨 Orders error:', error);
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
        console.error('🚨 Menu error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ===== ADMIN ROUTES =====

// Admin stats
app.get('/api/admin/stats', authenticateToken, isAdmin, async (req, res) => {
    try {
        const conn = await pool.getConnection();
        const [[menuItems], [totalOrders], [revenue], [totalUsers]] = await Promise.all([
            conn.execute(`SELECT COUNT(*) as count FROM menu_items WHERE is_available = TRUE`),
            conn.execute(`SELECT COUNT(*) as count FROM orders WHERE status IN ('preparing', 'delivered')`),
            conn.execute(`SELECT COALESCE(SUM(total_amount), 0) as revenue FROM orders WHERE status NOT IN ('cancelled', 'pending')`),
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
        console.error('🚨 Admin stats error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Admin recent orders
app.get('/api/admin/recent-orders', authenticateToken, isAdmin, async (req, res) => {
    try {
        const conn = await pool.getConnection();
        const [rows] = await conn.execute(`
            SELECT o.id, o.order_number, CONCAT(u.first_name, ' ', u.last_name) as customer,
                   o.status, o.total_amount,
                   CASE WHEN TIMESTAMPDIFF(MINUTE, o.created_at, NOW()) < 60 
                        THEN CONCAT(TIMESTAMPDIFF(MINUTE, o.created_at, NOW()), ' min ago')
                        ELSE CONCAT(FLOOR(TIMESTAMPDIFF(HOUR, o.created_at, NOW()) / 60), ' hr ago')
                   END as time_ago
            FROM orders o JOIN users u ON o.user_id = u.id 
            ORDER BY o.created_at DESC LIMIT 10`);
        conn.release();
        res.json(rows);
    } catch (error) {
        console.error('🚨 Admin recent orders error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Admin orders
app.get('/api/admin/orders', authenticateToken, isAdmin, async (req, res) => {
    try {
        const conn = await pool.getConnection();
        const [rows] = await conn.execute(`
            SELECT o.*, CONCAT(u.first_name, ' ', u.last_name) AS customer_name, u.phone
            FROM orders o LEFT JOIN users u ON o.user_id = u.id
            ORDER BY o.created_at DESC`);
        conn.release();
        res.json(rows);
    } catch (error) {
        console.error('🚨 Admin orders error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Admin users
app.get('/api/admin/users', authenticateToken, isAdmin, async (req, res) => {
    try {
        const conn = await pool.getConnection();
        const [rows] = await conn.execute(`
            SELECT id, username, email, first_name, last_name, phone, role, is_active, created_at
            FROM users ORDER BY id DESC`);
        conn.release();
        res.json(rows);
    } catch (error) {
        console.error('🚨 Admin users error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Admin activity
app.get('/api/admin/activity', authenticateToken, isAdmin, async (req, res) => {
    try {
        const conn = await pool.getConnection();
        const [rows] = await conn.execute(`SELECT type, action as message, created_at FROM activity_log ORDER BY created_at DESC LIMIT 10`);
        conn.release();

        const formatted = rows.map(row => ({
            type: row.type || 'system',
            message: row.message,
            time: formatTimeAgo(row.created_at)
        }));

        res.json(formatted);
    } catch (error) {
        console.error('🚨 Admin activity error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Menu management (Admin only)
app.post('/api/menu', authenticateToken, isAdmin, upload.single('image'), async (req, res) => {
    try {
        const { name, description, price, category, is_available } = req.body;
        const image_url = req.file ? `/images/${req.file.filename}` : null;

        const conn = await pool.getConnection();
        const [result] = await conn.execute(
            `INSERT INTO menu_items (name, description, price, category, image_url, is_available)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [name, description, parseFloat(price), category || 'main', image_url, is_available === 'true']
        );
        conn.release();

        res.status(201).json({ 
            message: 'Menu item added successfully',
            id: result.insertId 
        });
    } catch (error) {
        console.error('🚨 Add menu error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/menu/:id', authenticateToken, isAdmin, upload.single('image'), async (req, res) => {
    try {
        const { id } = req.params;
        const { name, description, price, category, is_available } = req.body;

        const conn = await pool.getConnection();
        const [oldItem] = await conn.execute(`SELECT image_url FROM menu_items WHERE id=?`, [id]);
        let image_url = oldItem[0]?.image_url || '';

        if (req.file) {
            image_url = `/images/${req.file.filename}`;
        }

        await conn.execute(
            `UPDATE menu_items SET name=?, description=?, price=?, category=?, image_url=?, is_available=?, updated_at=NOW() WHERE id=?`,
            [name, description, parseFloat(price), category, image_url, is_available === 'true', id]
        );
        conn.release();

        res.json({ message: 'Menu item updated successfully' });
    } catch (error) {
        console.error('🚨 Update menu error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/menu/:id', authenticateToken, isAdmin, async (req, res) => {
    let conn;
    try {
        const { id } = req.params;
        
        console.log(`🗑️ DELETE REQUEST: menu item ID ${id}`);
        
        conn = await pool.getConnection();
        
        await conn.beginTransaction();
        
        const [menuItem] = await conn.execute(`SELECT id, image_url FROM menu_items WHERE id = ?`, [id]);
        
        if (menuItem.length === 0) {
            await conn.rollback();
            conn.release();
            return res.status(404).json({ error: 'Menu item not found' });
        }
        
        const [orderItemsDeleted] = await conn.execute(`DELETE oi FROM order_items oi JOIN orders o ON oi.order_id = o.id WHERE oi.menu_item_id = ?`,[id]);
        
        const [result] = await conn.execute(`DELETE FROM menu_items WHERE id = ?`, [id]);
        
        const imagePath = menuItem[0].image_url ? `public${menuItem[0].image_url}` : null;
        if (imagePath && imagePath.startsWith('/images/')) {
            try {
                await fs.unlink(imagePath);
            } catch (fileErr) {
                console.log(`⚠️ Could not delete image ${imagePath}`);
            }
        }
        
        await conn.commit();
        conn.release();
        
        res.json({ 
            message: 'Menu item permanently deleted!',
            deletedId: id,
            affectedRows: result.affectedRows
        });
        
    } catch (error) {
        console.error('🚨 Delete menu error:', error);
        if (conn) {
            try {
                await conn.rollback();
            } catch (rollbackErr) {
                console.error('Rollback failed:', rollbackErr);
            }
            conn.release();
        }
        res.status(500).json({ error: error.message });
    }
});

// Admin order management
app.get('/api/admin/orders/:id', authenticateToken, isAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const conn = await pool.getConnection();
        const [rows] = await conn.execute(`
            SELECT o.*, CONCAT(u.first_name, ' ', u.last_name) as customer_name, u.phone
            FROM orders o LEFT JOIN users u ON o.user_id = u.id WHERE o.id = ?`, [id]);
        conn.release();
        
        if (rows.length === 0) return res.status(404).json({ error: 'Order not found' });
        res.json(rows[0]);
    } catch (error) {
        console.error('🚨 Get order error:', error);
        res.status(500).json({ error: 'Failed to fetch order' });
    }
});

app.put('/api/admin/orders/:id/status', authenticateToken, isAdmin, async (req, res) => {
    try {
        const { status } = req.body;
        const validStatuses = ['pending', 'preparing', 'out_for_delivery', 'delivered', 'cancelled'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({ error: 'Invalid status' });
        }

        const conn = await pool.getConnection();
        const [result] = await conn.execute(
            `UPDATE orders SET status = ?, updated_at = NOW() WHERE id = ?`,
            [status, req.params.id]
        );
        conn.release();

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Order not found' });
        }

        res.json({ success: true, message: `Status updated to ${status}` });
    } catch (error) {
        console.error('🚨 Update order error:', error);
        res.status(500).json({ error: 'Failed to update order' });
    }
});

app.delete('/api/admin/orders/:id', authenticateToken, isAdmin, async (req, res) => {
    try {
        const conn = await pool.getConnection();
        await conn.execute(`DELETE FROM orders WHERE id = ?`, [req.params.id]);
        conn.release();
        res.json({ message: 'Order deleted successfully' });
    } catch (error) {
        console.error('🚨 Delete order error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Admin users delete
app.delete('/api/admin/users/:id', authenticateToken, isAdmin, async (req, res) => {
    try {
        const conn = await pool.getConnection();
        await conn.execute(`DELETE FROM users WHERE id = ? AND role != 'admin'`, [req.params.id]);
        conn.release();
        res.json({ message: 'User deleted successfully' });
    } catch (error) {
        console.error('🚨 Delete user error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Analytics
// 🚀 FIXED Analytics endpoint - COMPLETE REWRITE
app.get('/api/analytics', authenticateToken, isAdmin, async (req, res) => {
    try {
        console.log('📊 Analytics request:', req.query);
        const { days = 'all', status = 'all' } = req.query;
        
        let whereClause = 'WHERE 1=1';
        let filteredWhereClause = 'WHERE o.status IN ("preparing", "out_for_delivery", "delivered")';
        const params = [];
        const filteredParams = [];

        // ✅ DYNAMIC DATE FILTERING
        if (days !== 'all') {
            const dateFilter = 'o.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)';
            whereClause += ` AND ${dateFilter}`;
            filteredWhereClause += ` AND ${dateFilter}`;
            params.push(parseInt(days));
            filteredParams.push(parseInt(days));
        }

        // ✅ DYNAMIC STATUS FILTERING
        if (status !== 'all') {
            whereClause += ` AND o.status = ?`;
            filteredWhereClause += ` AND o.status = ?`;
            params.push(status);
            filteredParams.push(status);
        }

        const conn = await pool.getConnection();

        // 🚀 COMPREHENSIVE ANALYTICS QUERIES
        const analyticsQueries = [
            // 1. Total Orders (completed orders)
            `SELECT COUNT(*) as total_orders FROM orders o ${filteredWhereClause}`,
            
            // 2. Total Revenue (completed orders only)
            `SELECT COALESCE(SUM(total_amount), 0) as total_revenue FROM orders o ${filteredWhereClause}`,
            
            // 3. Active Customers (unique customers with orders)
            `SELECT COUNT(DISTINCT o.user_id) as active_customers FROM orders o ${filteredWhereClause}`,
            
            // 4. Average Order Value
            `SELECT COALESCE(AVG(total_amount), 0) as avg_order_value FROM orders o ${filteredWhereClause}`,
            
            // 5. Order Trends by Day of Week (ALL orders in period)
            `SELECT 
                DAYNAME(o.created_at) as day_name, 
                COUNT(*) as order_count,
                MAX(o.created_at) as last_order_date
             FROM orders o ${whereClause} 
             GROUP BY DAYNAME(o.created_at) 
             ORDER BY FIELD(day_name, 'Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday')`,
            
            // 6. Revenue by Status
            `SELECT 
                o.status, 
                COALESCE(SUM(o.total_amount), 0) as total_amount,
                COUNT(*) as order_count
             FROM orders o ${whereClause} 
             GROUP BY o.status 
             ORDER BY total_amount DESC`,
            
            // 7. Top Products (with proper JOINs)
            `SELECT 
                mi.name, 
                mi.price,
                COALESCE(SUM(oi.quantity), 0) as quantity,
                COALESCE(SUM(oi.quantity * oi.unit_price), 0) as total_sales
             FROM order_items oi 
             JOIN menu_items mi ON oi.menu_item_id = mi.id 
             JOIN orders o ON oi.order_id = o.id ${whereClause}
             GROUP BY oi.menu_item_id, mi.name, mi.price
             ORDER BY quantity DESC 
             LIMIT 5`,
            
            // 8. Customer Orders
            `SELECT 
                CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, '')) as customer_name,
                u.username,
                COUNT(o.id) as order_count,
                COALESCE(SUM(o.total_amount), 0) as total_spent
             FROM orders o 
             LEFT JOIN users u ON o.user_id = u.id ${whereClause}
             GROUP BY o.user_id, u.username, u.first_name, u.last_name
             ORDER BY order_count DESC 
             LIMIT 5`
        ];

        console.log('🔍 Executing analytics queries...');
        const results = await Promise.all(
            analyticsQueries.map((query, index) => {
                console.log(`Query ${index + 1}:`, query.replace(/[\n\s]+/g, ' ').substring(0, 100) + '...');
                return conn.execute(query, index < 4 ? filteredParams : params);
            })
        );

        conn.release();

        // 🚀 CALCULATE DERIVED METRICS
        const peakDayResult = results[4][0][0]; // Order trends result
        const revenueStatusResult = results[5][0][0]; // Revenue by status
        const topProductResult = results[6][0][0]; // Top products
        const topCustomerResult = results[7][0][0]; // Top customer

        // ✅ EXTRACT PEAK DAY (day with highest orders)
        const orderTrends = results[4][0];
        const peakDay = orderTrends.length > 0 
            ? `${orderTrends[0].day_name} (${orderTrends[0].order_count} orders)`
            : 'No data';

        // ✅ TOP STATUS (highest revenue)
        const topStatus = revenueStatusResult.length > 0 
            ? `${revenueStatusResult[0].status} (₱${parseFloat(revenueStatusResult[0].total_amount).toLocaleString('en-PH', {minimumFractionDigits: 2})})`
            : 'No data';

        // ✅ DELIVERED REVENUE specifically
        const deliveredRevenueResult = results[5][0].find(row => row.status === 'delivered');
        const deliveredRevenue = deliveredRevenueResult 
            ? parseFloat(deliveredRevenueResult.total_amount) 
            : 0;

        // ✅ BEST SELLER PRODUCT
        const bestSeller = topProductResult 
            ? `${topProductResult.name} (${topProductResult.quantity} sold)`
            : 'No data';

        // ✅ TOP CUSTOMER
        const topCustomer = topCustomerResult 
            ? `${topCustomerResult.customer_name || topCustomerResult.username} (${topCustomerResult.order_count} orders)`
            : 'No data';

        // ✅ REPEAT CUSTOMERS (customers with 2+ orders)
        const repeatCustomersQuery = `
            SELECT COUNT(DISTINCT o.user_id) as repeat_count 
            FROM orders o ${whereClause} 
            GROUP BY o.user_id 
            HAVING COUNT(o.id) >= 2
        `;
        const [repeatResult] = await conn.execute(repeatCustomersQuery, params);
        const repeatCustomers = parseInt(repeatResult[0]?.repeat_count || 0);

        // ✅ GROWTH PERCENTAGES (compare to previous period)
        let growthData = { order_growth: 0, revenue_growth: 0, customer_growth: 0 };
        try {
            const prevDays = days === 'all' ? 30 : parseInt(days); // Default to 30 days for all-time
            const prevFilteredWhere = `WHERE o.status IN ("preparing", "out_for_delivery", "delivered") 
                                       AND o.created_at < DATE_SUB(NOW(), INTERVAL ? DAY)`;
            const prevNormalWhere = `WHERE o.created_at < DATE_SUB(NOW(), INTERVAL ? DAY)`;

            const prevQueries = [
                `SELECT COUNT(*) as prev_orders FROM orders o ${prevFilteredWhere}`,
                `SELECT COALESCE(SUM(total_amount), 0) as prev_revenue FROM orders o ${prevFilteredWhere}`,
                `SELECT COUNT(DISTINCT user_id) as prev_customers FROM orders o ${prevFilteredWhere}`
            ];

            const prevResults = await Promise.all(prevQueries.map(q => conn.execute(q, [prevDays])));
            
            const currentOrders = parseInt(results[0][0][0].total_orders);
            const currentRevenue = parseFloat(results[1][0][0].total_revenue);
            const currentCustomers = parseInt(results[2][0][0].active_customers);

            const prevOrders = parseInt(prevResults[0][0][0].prev_orders);
            const prevRevenue = parseFloat(prevResults[1][0][0].prev_revenue);
            const prevCustomers = parseInt(prevResults[2][0][0].prev_customers);

            growthData = {
                order_growth: prevOrders > 0 ? Math.round(((currentOrders - prevOrders) / prevOrders) * 100) : 100,
                revenue_growth: prevRevenue > 0 ? Math.round(((currentRevenue - prevRevenue) / prevRevenue) * 100) : 100,
                customer_growth: prevCustomers > 0 ? Math.round(((currentCustomers - prevCustomers) / prevCustomers) * 100) : 100
            };
        } catch (growthError) {
            console.warn('⚠️ Growth calculation failed:', growthError.message);
        }

        // ✅ FINAL COMPREHENSIVE RESPONSE
        const analyticsData = {
            // Core metrics
            total_orders: parseInt(results[0][0][0].total_orders || 0),
            total_revenue: parseFloat(results[1][0][0].total_revenue || 0),
            active_customers: parseInt(results[2][0][0].active_customers || 0),
            avg_order_value: parseFloat(results[3][0][0].avg_order_value || 0),
            
            // Derived metrics (FIXED!)
            peak_day: peakDay,
            top_status: topStatus,
            delivered_revenue: deliveredRevenue,
            top_product_name: bestSeller,
            total_items_sold: parseInt(topProductResult?.quantity || 0),
            top_customer: topCustomer,
            repeat_customers: repeatCustomers,
            
            // Growth percentages (FIXED!)
            order_growth: growthData.order_growth,
            revenue_growth: growthData.revenue_growth,
            customer_growth: growthData.customer_growth,
            
            // Chart data
            order_trends: results[4][0],
            revenue_by_status: results[5][0],
            top_products: results[6][0],
            customer_orders: results[7][0]
        };

        console.log('✅ Analytics SUCCESS:', {
            orders: analyticsData.total_orders,
            revenue: analyticsData.total_revenue,
            peakDay: analyticsData.peak_day,
            topStatus: analyticsData.top_status
        });

        res.json(analyticsData);

    } catch (error) {
        console.error('🚨 ANALYTICS ERROR:', error);
        console.error('Query params:', req.query);
        res.status(500).json({ 
            error: 'Analytics failed', 
            details: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});

// Export routes
app.post('/api/export/:type', authenticateToken, isAdmin, async (req, res) => {
    let conn;
    try {
        const { type } = req.params;
        conn = await pool.getConnection();

        if (type === 'orders') {
            const [rows] = await conn.execute(`
                SELECT o.id, o.order_number, o.status, o.payment_method,
                       CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, '')) as customer,
                       u.phone, o.total_amount, DATE_FORMAT(o.created_at, '%Y-%m-%d %H:%i') as order_date
                FROM orders o LEFT JOIN users u ON o.user_id = u.id ORDER BY o.created_at DESC`);

            const csvHeader = ['ID', 'Order #', 'Customer', 'Phone', 'Status', 'Payment', 'Total', 'Date'];
            const csvRows = rows.map(row => [
                row.id || '',
                row.order_number || '',
                `"${(row.customer || 'Walk-in').trim().replace(/"/g, '""')}"`,
                row.phone || '',
                row.status || '',
                row.payment_method || '',
                parseFloat(row.total_amount || 0).toFixed(2),
                row.order_date || ''
            ]);

            const csvContent = [csvHeader, ...csvRows].map(row => row.join(',')).join('\r\n');
            
            res.set({
                'Content-Type': 'text/csv; charset=utf-8',
                'Content-Disposition': `attachment; filename="Hulyanas-Orders-${new Date().toISOString().split('T')[0]}.csv"`
            });
            return res.status(200).send(csvContent);

        } else if (type === 'sales') {
            const [rows] = await conn.execute(`
                SELECT DATE_FORMAT(o.created_at, '%Y-%m-%d') as sale_date,
                       o.order_number, o.status, ROUND(o.total_amount, 2) as order_total
                FROM orders o WHERE o.status IN ('delivered', 'preparing') ORDER BY o.created_at DESC`);

            const csvHeader = ['Date', 'Order #', 'Status', 'Total'];
            const csvRows = rows.map(row => [
                row.sale_date || '',
                row.order_number || '',
                row.status || '',
                parseFloat(row.order_total || 0).toFixed(2)
            ]);

            const csvContent = [csvHeader, ...csvRows].map(row => row.join(',')).join('\r\n');
            
            res.set({
                'Content-Type': 'text/csv; charset=utf-8',
                'Content-Disposition': `attachment; filename="Hulyanas-Sales-${new Date().toISOString().split('T')[0]}.csv"`
            });
            return res.status(200).send(csvContent);

        } else {
            return res.status(400).json({ error: 'Invalid type. Use: orders, sales' });
        }

    } catch (error) {
        console.error('🚨 Export error:', error);
        res.status(500).json({ error: 'Export failed' });
    } finally {
        if (conn) conn.release();
    }
});

// Helper function
function formatTimeAgo(date) {
    const now = new Date();
    const orderDate = new Date(date);
    const diff = Math.floor((now - orderDate) / 1000 / 60);
    if (diff < 1) return 'Just now';
    if (diff < 60) return `${diff}m ago`;
    const hours = Math.floor(diff / 60);
    return `${hours}h ago`;
}

// Health check
app.get('/api/health', async (req, res) => {
    try {
        const conn = await pool.getConnection();
        conn.release();
        res.json({ 
            status: 'OK ✅', 
            timestamp: new Date().toISOString(),
            database: 'Connected ✅',
            endpoints: {
                user: ['GET /api/user/:id', 'GET /api/user/:id/stats', 'GET /api/user/:id/activity'],
                auth: ['POST /api/login', 'POST /api/register', 'GET /api/profile'],
                admin: ['GET /api/admin/stats', 'GET /api/admin/orders']
            }
        });
    } catch (error) {
        console.error('🚨 Health check failed:', error);
        res.status(500).json({ status: 'DB_ERROR ❌', error: error.message });
    }
});

// 404 handler
app.use('*', (req, res) => {
    res.status(404).json({ error: `Route ${req.originalUrl} not found` });
});

// Global error handler
app.use((error, req, res, next) => {
    console.error('🚨 Global error:', error);
    res.status(500).json({ error: 'Internal server error' });
});

// Start Server
const server = app.listen(PORT, () => {
    console.log('\n🚀 Hulyanas Hill Server v2.0 - LIVE!');
    console.log(`📍 Port: ${PORT}`);
    console.log(`📱 Customer Dashboard: http://localhost:${PORT}/user/dashboard.html`);
    console.log(`👑 Admin Dashboard: http://localhost:${PORT}/admin/dashboard.html`);
    console.log(`🩺 Health Check: http://localhost:${PORT}/api/health`);
    console.log('\n🆕 NEW USER DASHBOARD APIs:');
    console.log(`   👤 GET  http://localhost:${PORT}/api/user/2`);
    console.log(`   📊 GET  http://localhost:${PORT}/api/user/2/stats`);
    console.log(`   📋 GET  http://localhost:${PORT}/api/user/2/activity`);
    console.log('\n✅ Server ready! Database connected.');
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('\n🛑 SIGTERM received, shutting down gracefully...');
    server.close(() => {
        console.log('✅ Server terminated');
    });
});

process.on('SIGINT', () => {
    console.log('\n🛑 SIGINT received, shutting down gracefully...');
    server.close(() => {
        console.log('✅ Server terminated');
    });
});