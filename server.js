require('dotenv').config();

const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const fs = require('fs').promises;
const { jsPDF } = require('jspdf');
const autoTable = require('jspdf-autotable');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    exposedHeaders: ['Content-Disposition']
}));

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
    port: process.env.DB_PORT || 3306,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
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
            cb(err);
        }
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({ 
    storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Only image files are allowed'));
        }
    }
});

// Auth middleware
const authenticateToken = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        const token = authHeader && authHeader.split(' ')[1];
        
        if (!token) {
            return res.status(401).json({ error: 'Access token required' });
        }
        
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        return res.status(403).json({ error: 'Invalid or expired token' });
    }
};

const isAdmin = (req, res, next) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }
    next();
};

// Helper function
const formatTimeAgo = (date) => {
    const now = new Date();
    const orderDate = new Date(date);
    const diff = Math.floor((now - orderDate) / 1000 / 60);
    
    if (diff < 1) return 'Just now';
    if (diff < 60) return `${diff}m ago`;
    const hours = Math.floor(diff / 60);
    return `${hours}h ago`;
};

// OPTIONS preflight for exports
app.options('/api/export/:type', (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.sendStatus(200);
});

// ===== CUSTOMER ROUTES =====

// Register
app.post('/api/register', async (req, res) => {
    let conn;
    try {
        const { username, email, password, first_name, last_name, phone } = req.body;
        
        if (!username || !email || !password) {
            return res.status(400).json({ error: 'Username, email, and password required' });
        }

        const hashedPassword = await bcrypt.hash(password, 12);
        conn = await pool.getConnection();
        
        await conn.beginTransaction();
        const [result] = await conn.execute(
            `INSERT INTO users (username, email, password_hash, first_name, last_name, phone, role, created_at) 
             VALUES (?, ?, ?, ?, ?, ?, 'customer', NOW())`,
            [username, email, hashedPassword, first_name || '', last_name || '', phone || '']
        );
        await conn.commit();
        
        res.status(201).json({ message: 'Registered successfully' });
    } catch (error) {
        if (conn) await conn.rollback();
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ error: 'Username or email already exists' });
        }
        console.error('Register error:', error);
        res.status(500).json({ error: 'Registration failed' });
    } finally {
        if (conn) conn.release();
    }
});

// Login
app.post('/api/login', async (req, res) => {
    let conn;
    try {
        const { username, password } = req.body;
        
        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password required' });
        }

        conn = await pool.getConnection();
        const [rows] = await conn.execute(
            `SELECT id, username, email, password_hash, role, first_name, last_name 
             FROM users WHERE username = ? OR email = ?`,
            [username, username]
        );
        
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
                role: user.role,
                full_name: `${user.first_name} ${user.last_name}`.trim()
            }
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Login failed' });
    } finally {
        if (conn) conn.release();
    }
});

// Profile
app.get('/api/profile', authenticateToken, async (req, res) => {
    let conn;
    try {
        conn = await pool.getConnection();
        const [rows] = await conn.execute(
            `SELECT id, username, email, first_name, last_name, phone, created_at 
             FROM users WHERE id = ?`,
            [req.user.id]
        );
        
        if (rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        const user = rows[0];
        res.json({
            ...user,
            full_name: `${user.first_name} ${user.last_name}`.trim()
        });
    } catch (error) {
        console.error('Profile error:', error);
        res.status(500).json({ error: error.message });
    } finally {
        if (conn) conn.release();
    }
});

// Update profile
app.put('/api/profile', authenticateToken, async (req, res) => {
    let conn;
    try {
        const { first_name, last_name, phone } = req.body;
        conn = await pool.getConnection();
        
        const [result] = await conn.execute(
            `UPDATE users SET first_name = ?, last_name = ?, phone = ?, updated_at = NOW() WHERE id = ?`,
            [first_name || '', last_name || '', phone || '', req.user.id]
        );
        
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        res.json({ message: 'Profile updated successfully' });
    } catch (error) {
        console.error('Profile update error:', error);
        res.status(500).json({ error: error.message });
    } finally {
        if (conn) conn.release();
    }
});

// ===== ORDERS ROUTES =====
app.get('/api/orders', authenticateToken, async (req, res) => {
    let conn;
    try {
        conn = await pool.getConnection();
        const [rows] = await conn.execute(
            `SELECT o.*, 
                    TIME_FORMAT(TIMEDIFF(NOW(), o.created_at), '%i min ago') as time_ago
             FROM orders o 
             WHERE o.user_id = ? 
             ORDER BY o.created_at DESC`,
            [req.user.id]
        );
        res.json(rows);
    } catch (error) {
        console.error('Orders error:', error);
        res.status(500).json({ error: error.message });
    } finally {
        if (conn) conn.release();
    }
});

// ===== DASHBOARD STATS =====
app.get('/api/dashboard/stats', authenticateToken, async (req, res) => {
    let conn;
    try {
        conn = await pool.getConnection();
        
        const [[totalOrders], [totalSpent], [activeOrders]] = await Promise.all([
            conn.execute(`SELECT COUNT(*) as count FROM orders WHERE user_id = ?`, [req.user.id]),
            conn.execute(`SELECT COALESCE(SUM(total_amount), 0) as total FROM orders WHERE user_id = ? AND status != 'cancelled'`, [req.user.id]),
            conn.execute(`SELECT COUNT(*) as count FROM orders WHERE user_id = ? AND status IN ('pending', 'preparing')`, [req.user.id])
        ]);
        
        res.json({
            totalOrders: parseInt(totalOrders[0].count),
            totalSpent: parseFloat(totalSpent[0].total).toFixed(2),
            avgRating: 4.8,
            activeItems: parseInt(activeOrders[0].count)
        });
    } catch (error) {
        console.error('Stats error:', error);
        res.status(500).json({ error: error.message });
    } finally {
        if (conn) conn.release();
    }
});

// ===== MENU ROUTES =====
app.get('/api/menu', async (req, res) => {
    let conn;
    try {
        conn = await pool.getConnection();
        const [rows] = await conn.execute(
            `SELECT id, name, description, price, category, image_url, is_available 
             FROM menu_items WHERE is_available = TRUE ORDER BY category, name`
        );
        res.json(rows);
    } catch (error) {
        console.error('Menu error:', error);
        res.status(500).json({ error: error.message });
    } finally {
        if (conn) conn.release();
    }
});

// ADD MENU ITEM
app.post('/api/menu', authenticateToken, isAdmin, upload.single('image'), async (req, res) => {
    let conn;
    try {
        const { name, description, price, category, is_available } = req.body;
        const image_url = req.file ? `/images/${req.file.filename}` : '';

        conn = await pool.getConnection();
        const [result] = await conn.execute(
            `INSERT INTO menu_items (name, description, price, category, image_url, is_available, created_at)
             VALUES (?, ?, ?, ?, ?, ?, NOW())`,
            [name, description, parseFloat(price), category, image_url, is_available === 'true']
        );

        res.status(201).json({ 
            message: 'Menu item added successfully',
            id: result.insertId 
        });
    } catch (error) {
        console.error('Add menu error:', error);
        res.status(500).json({ error: error.message });
    } finally {
        if (conn) conn.release();
    }
});

// UPDATE MENU ITEM
app.put('/api/menu/:id', authenticateToken, isAdmin, upload.single('image'), async (req, res) => {
    let conn;
    try {
        const { id } = req.params;
        const { name, description, price, category, is_available } = req.body;

        conn = await pool.getConnection();
        const [oldItem] = await conn.execute(`SELECT image_url FROM menu_items WHERE id=?`, [id]);
        
        let image_url = oldItem[0]?.image_url || '';
        if (req.file) {
            image_url = `/images/${req.file.filename}`;
        }

        const [result] = await conn.execute(
            `UPDATE menu_items SET name=?, description=?, price=?, category=?, image_url=?, is_available=?, updated_at=NOW() WHERE id=?`,
            [name, description, parseFloat(price), category, image_url, is_available === 'true', id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Menu item not found' });
        }

        res.json({ message: 'Menu item updated successfully' });
    } catch (error) {
        console.error('Update menu error:', error);
        res.status(500).json({ error: error.message });
    } finally {
        if (conn) conn.release();
    }
});

// DELETE MENU ITEM
app.delete('/api/menu/:id', authenticateToken, isAdmin, async (req, res) => {
    let conn;
    try {
        const { id } = req.params;
        conn = await pool.getConnection();
        
        await conn.beginTransaction();
        
        // Get menu item details
        const [menuItem] = await conn.execute(`SELECT id, image_url FROM menu_items WHERE id = ?`, [id]);
        
        if (menuItem.length === 0) {
            await conn.rollback();
            return res.status(404).json({ error: 'Menu item not found' });
        }
        
        // Delete associated order_items
        await conn.execute(
            `DELETE oi FROM order_items oi 
             JOIN orders o ON oi.order_id = o.id 
             WHERE oi.menu_item_id = ?`,
            [id]
        );
        
        // Delete menu item
        await conn.execute(`DELETE FROM menu_items WHERE id = ?`, [id]);
        
        // Delete image file
        const imagePath = menuItem[0].image_url ? path.join(__dirname, 'public', menuItem[0].image_url) : null;
        if (imagePath && await fs.access(imagePath).then(() => true).catch(() => false)) {
            await fs.unlink(imagePath);
        }
        
        await conn.commit();
        res.json({ message: 'Menu item deleted successfully' });
        
    } catch (error) {
        console.error('Delete menu error:', error);
        if (conn) await conn.rollback();
        res.status(500).json({ error: error.message });
    } finally {
        if (conn) conn.release();
    }
});

// ===== ADMIN ROUTES =====
app.get('/api/admin/stats', authenticateToken, isAdmin, async (req, res) => {
    let conn;
    try {
        conn = await pool.getConnection();
        const [[menuItems], [totalOrders], [revenue], [totalUsers]] = await Promise.all([
            conn.execute(`SELECT COUNT(*) as count FROM menu_items WHERE is_available = TRUE`),
            conn.execute(`SELECT COUNT(*) as count FROM orders`),
            conn.execute(`SELECT COALESCE(SUM(total_amount), 0) as revenue FROM orders WHERE status != 'cancelled'`),
            conn.execute(`SELECT COUNT(*) as count FROM users WHERE role = 'customer'`)
        ]);
        
        res.json({
            menuItems: parseInt(menuItems[0].count),
            totalOrders: parseInt(totalOrders[0].count),
            revenue: parseFloat(revenue[0].revenue).toFixed(2),
            totalUsers: parseInt(totalUsers[0].count)
        });
    } catch (error) {
        console.error('Admin stats error:', error);
        res.status(500).json({ error: error.message });
    } finally {
        if (conn) conn.release();
    }
});

app.get('/api/admin/recent-orders', authenticateToken, isAdmin, async (req, res) => {
    let conn;
    try {
        conn = await pool.getConnection();
        const [rows] = await conn.execute(`
            SELECT o.id, o.order_number, CONCAT(u.first_name, ' ', u.last_name) as customer,
                   o.status, o.total_amount,
                   CASE WHEN TIMESTAMPDIFF(MINUTE, o.created_at, NOW()) < 60 
                        THEN CONCAT(TIMESTAMPDIFF(MINUTE, o.created_at, NOW()), ' min ago')
                        ELSE CONCAT(FLOOR(TIMESTAMPDIFF(HOUR, o.created_at, NOW()) / 60), ' hr ago')
                   END as time_ago
            FROM orders o JOIN users u ON o.user_id = u.id 
            ORDER BY o.created_at DESC LIMIT 10`);
        res.json(rows);
    } catch (error) {
        console.error('Recent orders error:', error);
        res.status(500).json({ error: error.message });
    } finally {
        if (conn) conn.release();
    }
});

app.get('/api/admin/orders', authenticateToken, isAdmin, async (req, res) => {
    let conn;
    try {
        conn = await pool.getConnection();
        const [rows] = await conn.execute(`
            SELECT o.*, CONCAT(u.first_name, ' ', u.last_name) AS customer_name, u.phone
            FROM orders o LEFT JOIN users u ON o.user_id = u.id
            ORDER BY o.created_at DESC`);
        res.json(rows);
    } catch (error) {
        console.error('Admin orders error:', error);
        res.status(500).json({ error: error.message });
    } finally {
        if (conn) conn.release();
    }
});

app.get('/api/admin/orders/:id', authenticateToken, isAdmin, async (req, res) => {
    let conn;
    try {
        const { id } = req.params;
        conn = await pool.getConnection();
        const [rows] = await conn.execute(`
            SELECT o.*, CONCAT(u.first_name, ' ', u.last_name) as customer_name, u.phone
            FROM orders o LEFT JOIN users u ON o.user_id = u.id WHERE o.id = ?`, [id]);
        
        if (rows.length === 0) {
            return res.status(404).json({ error: 'Order not found' });
        }
        res.json(rows[0]);
    } catch (error) {
        console.error('Get order error:', error);
        res.status(500).json({ error: 'Failed to fetch order' });
    } finally {
        if (conn) conn.release();
    }
});

app.put('/api/admin/orders/:id/status', authenticateToken, isAdmin, async (req, res) => {
    let conn;
    try {
        const { status } = req.body;
        const validStatuses = ['pending', 'preparing', 'delivered', 'cancelled'];
        
        if (!validStatuses.includes(status)) {
            return res.status(400).json({ error: 'Invalid status' });
        }

        conn = await pool.getConnection();
        const [result] = await conn.execute(
            `UPDATE orders SET status = ?, updated_at = NOW() WHERE id = ?`,
            [status, req.params.id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Order not found' });
        }

        res.json({ success: true, message: `Status updated to ${status}` });
    } catch (error) {
        console.error('Update order error:', error);
        res.status(500).json({ error: 'Failed to update order' });
    } finally {
        if (conn) conn.release();
    }
});

app.delete('/api/admin/orders/:id', authenticateToken, isAdmin, async (req, res) => {
    let conn;
    try {
        conn = await pool.getConnection();
        const [result] = await conn.execute(`DELETE FROM orders WHERE id = ?`, [req.params.id]);
        
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Order not found' });
        }
        
        res.json({ message: 'Order deleted successfully' });
    } catch (error) {
        console.error('Delete order error:', error);
        res.status(500).json({ error: error.message });
    } finally {
        if (conn) conn.release();
    }
});

app.get('/api/admin/users', authenticateToken, isAdmin, async (req, res) => {
    let conn;
    try {
        conn = await pool.getConnection();
        const [rows] = await conn.execute(`
            SELECT id, username, email, first_name, last_name, phone, role, created_at
            FROM users ORDER BY id DESC`);
        res.json(rows);
    } catch (error) {
        console.error('Admin users error:', error);
        res.status(500).json({ error: error.message });
    } finally {
        if (conn) conn.release();
    }
});

app.delete('/api/admin/users/:id', authenticateToken, isAdmin, async (req, res) => {
    let conn;
    try {
        conn = await pool.getConnection();
        const [result] = await conn.execute(`DELETE FROM users WHERE id = ? AND role != 'admin'`, [req.params.id]);
        
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'User not found or is admin' });
        }
        
        res.json({ message: 'User deleted successfully' });
    } catch (error) {
        console.error('Delete user error:', error);
        res.status(500).json({ error: error.message });
    } finally {
        if (conn) conn.release();
    }
});

// ===== ANALYTICS =====
app.get('/api/analytics', authenticateToken, isAdmin, async (req, res) => {
    let conn;
    try {
        const { days = 'all', status = 'all' } = req.query;
        
        let whereClause = 'WHERE 1=1';
        const params = [];
        
        if (days !== 'all') {
            whereClause += ' AND o.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)';
            params.push(parseInt(days));
        }
        if (status !== 'all') {
            whereClause += ' AND o.status = ?';
            params.push(status);
        }

        conn = await pool.getConnection();
        const queries = [
            `SELECT COUNT(*) as total_orders FROM orders o ${whereClause}`,
            `SELECT COALESCE(SUM(total_amount), 0) as total_revenue FROM orders o ${whereClause}`,
            `SELECT COUNT(DISTINCT user_id) as active_customers FROM orders o ${whereClause}`,
            `SELECT COALESCE(AVG(total_amount), 0) as avg_order_value FROM orders o ${whereClause}`,
            `SELECT DAYNAME(o.created_at) as day_name, COUNT(*) as order_count 
             FROM orders o ${whereClause} GROUP BY day_name 
             ORDER BY FIELD(day_name, 'Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday')`,
            `SELECT o.status, COALESCE(SUM(o.total_amount), 0) as total_amount 
             FROM orders o ${whereClause} GROUP BY o.status ORDER BY total_amount DESC`,
            `SELECT mi.name, SUM(oi.quantity) as quantity 
             FROM order_items oi JOIN menu_items mi ON oi.menu_item_id = mi.id 
             JOIN orders o ON oi.order_id = o.id ${whereClause} 
             GROUP BY oi.menu_item_id, mi.name ORDER BY quantity DESC LIMIT 5`,
            `SELECT u.username, COUNT(o.id) as order_count 
             FROM orders o JOIN users u ON o.user_id = u.id ${whereClause} 
             GROUP BY o.user_id, u.username ORDER BY order_count DESC LIMIT 5`
        ];

        const results = await Promise.all(queries.map(q => conn.execute(q, params)));

        res.json({
            total_orders: parseInt(results[0][0][0].total_orders),
            total_revenue: parseFloat(results[1][0][0].total_revenue),
            active_customers: parseInt(results[2][0][0].active_customers),
            avg_order_value: parseFloat(results[3][0][0].avg_order_value).toFixed(2),
            order_trends: results[4][0],
            revenue_by_status: results[5][0],
            top_products: results[6][0],
            customer_orders: results[7][0]
        });
    } catch (error) {
        console.error('Analytics error:', error);
        res.status(500).json({ error: 'Analytics failed', details: error.message });
    } finally {
        if (conn) conn.release();
    }
});

// ===== EXPORT ROUTES (FINAL FIXED VERSION) =====
app.post('/api/export/:type', authenticateToken, isAdmin, async (req, res) => {
    let conn;
    
    try {
        const { type } = req.params;
        
        conn = await pool.getConnection();

        if (type === 'dashboard') {
            // Dashboard PDF
            const stats = await Promise.all([
                conn.execute(`SELECT COUNT(*) as count FROM orders`),
                conn.execute(`SELECT COUNT(*) as count FROM orders WHERE status = 'delivered'`),
                conn.execute(`SELECT COUNT(*) as count FROM orders WHERE status IN ('pending', 'preparing')`),
                conn.execute(`SELECT COALESCE(SUM(total_amount), 0) as total FROM orders WHERE status != 'cancelled'`),
                conn.execute(`SELECT COUNT(*) as count FROM users WHERE role = 'customer'`),
                conn.execute(`SELECT COUNT(*) as count FROM menu_items WHERE is_available = TRUE`)
            ]);

            const [totalOrders, delivered, pending, revenue, users, menuItems] = stats.map(s => s[0][0]);

            const doc = new jsPDF({
                orientation: 'portrait',
                unit: 'mm',
                format: 'a4',
                compress: true
            });

            // Header
            doc.setFillColor(26, 26, 26);
            doc.rect(0, 0, 210, 40, 'F');
            doc.setTextColor(255, 255, 255);
            doc.setFontSize(28);
            doc.setFont('helvetica', 'bold');
            doc.text('Hulyanas Hill', 105, 22, { align: 'center' });
            doc.setFontSize(16);
            doc.text('Dashboard Analytics Report', 105, 32, { align: 'center' });
            doc.setFontSize(12);
            doc.text(`Generated: ${new Date().toLocaleString('en-PH')}`, 105, 38, { align: 'center' });

            // Key Metrics
            const metrics = [
                ['📊 Total Orders', parseInt(totalOrders.count).toLocaleString()],
                ['✅ Delivered', parseInt(delivered.count).toLocaleString()],
                ['⏳ Pending/Preparing', parseInt(pending.count).toLocaleString()],
                ['💰 Total Revenue', `₱${parseFloat(revenue.total).toLocaleString('en-PH', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`],
                ['👥 Active Customers', parseInt(users.count).toLocaleString()],
                ['🍽️ Active Menu Items', parseInt(menuItems.count).toLocaleString()]
            ];

            autoTable(doc, {
                startY: 50,
                head: [['Metric', 'Value']],
                body: metrics,
                theme: 'grid',
                styles: { fontSize: 11, cellPadding: 8, halign: 'center', minCellHeight: 12 },
                headStyles: { fillColor: [26, 26, 26], textColor: 255, fontSize: 12, fontStyle: 'bold' },
                alternateRowStyles: { fillColor: [248, 249, 250] },
                columnStyles: { 0: { halign: 'left', fontStyle: 'bold', cellWidth: 100 }, 1: { halign: 'center', cellWidth: 90 } },
                margin: { top: 50, left: 15, right: 15 }
            });

            const pageHeight = doc.internal.pageSize.height;
            doc.setFontSize(10);
            doc.setTextColor(100, 100, 100);
            doc.text('Hulyanas Hill Restaurant Management System', 105, pageHeight - 15, { align: 'center' });

            const pdfUint8Array = doc.output('uint8array');
            const pdfBuffer = Buffer.from(pdfUint8Array);

            res.set({
                'Content-Type': 'application/pdf',
                'Content-Disposition': `attachment; filename="Hulyanas-Dashboard-${new Date().toISOString().split('T')[0]}.pdf"`,
                'Content-Length': pdfBuffer.length.toString(),
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Expose-Headers': 'Content-Disposition'
            });

            return res.status(200).send(pdfBuffer);

        } else if (type === 'orders') {
            // Orders CSV
            const [rows] = await conn.execute(`
                SELECT o.id, o.order_number, o.status, o.payment_method,
                       CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, '')) as customer,
                       u.phone, o.total_amount,
                       DATE_FORMAT(o.created_at, '%Y-%m-%d %H:%i:%s') as order_date
                FROM orders o LEFT JOIN users u ON o.user_id = u.id 
                ORDER BY o.created_at DESC`);

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
            const csvBuffer = Buffer.from(csvContent, 'utf8');

            res.set({
                'Content-Type': 'text/csv; charset=utf-8',
                'Content-Disposition': `attachment; filename="Hulyanas-Orders-${new Date().toISOString().split('T')[0]}.csv"`,
                'Content-Length': csvBuffer.length.toString(),
                'Access-Control-Allow-Origin': '*'
            });

            return res.status(200).send(csvBuffer);

        } else if (type === 'sales') {
            // Sales CSV
            const [rows] = await conn.execute(`
                SELECT DATE_FORMAT(o.created_at, '%Y-%m-%d') as sale_date,
                       o.order_number, o.status, ROUND(o.total_amount, 2) as order_total
                FROM orders o WHERE o.status IN ('delivered', 'preparing')
                ORDER BY o.created_at DESC`);

            const csvHeader = ['Date', 'Order #', 'Status', 'Total'];
            const csvRows = rows.map(row => [
                row.sale_date || '',
                row.order_number || '',
                row.status || '',
                parseFloat(row.order_total || 0).toFixed(2)
            ]);

            const csvContent = [csvHeader, ...csvRows].map(row => row.join(',')).join('\r\n');
            const csvBuffer = Buffer.from(csvContent, 'utf8');

            res.set({
                'Content-Type': 'text/csv; charset=utf-8',
                'Content-Disposition': `attachment; filename="Hulyanas-Sales-${new Date().toISOString().split('T')[0]}.csv"`,
                'Content-Length': csvBuffer.length.toString(),
                'Access-Control-Allow-Origin': '*'
            });

            return res.status(200).send(csvBuffer);

        } else {
            return res.status(400).json({ error: 'Invalid type. Use: dashboard, orders, sales' });
        }

    } catch (error) {
        console.error('Export error:', error);
        res.status(500).json({ error: 'Export failed', details: error.message });
    } finally {
        if (conn) conn.release();
    }
});

// Health check
app.get('/api/health', async (req, res) => {
    try {
        const conn = await pool.getConnection();
        conn.release();
        res.json({ status: 'OK', timestamp: new Date().toISOString() });
    } catch (error) {
        res.status(500).json({ status: 'DB_ERROR', error: error.message });
    }
});

// 404 handler
app.use('*', (req, res) => {
    res.status(404).json({ error: 'Route not found' });
});

// Global error handler
app.use((error, req, res, next) => {
    console.error('Global error:', error);
    res.status(500).json({ error: 'Internal server error' });
});

// Start Server
const server = app.listen(PORT, () => {
    console.log(`🚀 Hulyanas Hill Server running on port ${PORT}`);
    console.log(`📱 Customer: http://localhost:${PORT}`);
    console.log(`👑 Admin: http://localhost:${PORT}/admin`);
    console.log(`🩺 Health: http://localhost:${PORT}/api/health`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully');
    server.close(() => {
        console.log('Process terminated');
    });
});