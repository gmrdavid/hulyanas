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

// ===== DASHBOARD STATS =====
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
            avgRating: 4.8,
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

// ADD MENU ITEM
app.post('/api/menu', upload.single('image'), async (req, res) => {
    try {
        const { name, description, price, category, is_available } = req.body;
        const image_url = req.file ? `/images/${req.file.filename}` : '';

        const conn = await pool.getConnection();
        await conn.execute(
            `INSERT INTO menu_items (name, description, price, category, image_url, is_available)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [name, description, price, category, image_url, is_available]
        );
        conn.release();

        res.json({ message: 'Menu item added successfully' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

// UPDATE MENU ITEM
app.put('/api/menu/:id', upload.single('image'), async (req, res) => {
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
            `UPDATE menu_items SET name=?, description=?, price=?, category=?, image_url=?, is_available=? WHERE id=?`,
            [name, description, price, category, image_url, is_available, id]
        );
        conn.release();

        res.json({ message: 'Menu item updated successfully' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

// DELETE MENU ITEM
app.delete('/api/menu/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const conn = await pool.getConnection();
        await conn.execute(`UPDATE menu_items SET is_available = 0 WHERE id = ?`, [id]);
        conn.release();
        res.json({ message: 'Menu item marked as unavailable' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

// ADMIN ACTIVITY
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
        res.status(500).json({ error: error.message });
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

// GET SINGLE ORDER
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
        console.error('Get order error:', error);
        res.status(500).json({ error: 'Failed to fetch order' });
    }
});

// UPDATE ORDER STATUS
app.put('/api/admin/orders/:id/status', authenticateToken, isAdmin, async (req, res) => {
    try {
        const { status } = req.body;
        const validStatuses = ['pending', 'preparing', 'delivered', 'cancelled'];
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
        console.error('Update order error:', error);
        res.status(500).json({ error: 'Failed to update order' });
    }
});

// DELETE ORDER
app.delete('/api/admin/orders/:id', authenticateToken, isAdmin, async (req, res) => {
    try {
        const conn = await pool.getConnection();
        await conn.execute(`DELETE FROM orders WHERE id = ?`, [req.params.id]);
        conn.release();
        res.json({ message: 'Order deleted successfully' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
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
        res.status(500).json({ error: error.message });
    }
});

// ADMIN ORDERS API
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
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

// ADMIN USERS API
app.get('/api/admin/users', authenticateToken, isAdmin, async (req, res) => {
    try {
        const conn = await pool.getConnection();
        const [rows] = await conn.execute(`
            SELECT id, username, email, first_name, last_name, phone, role, is_active, created_at, updated_at
            FROM users ORDER BY id DESC`);
        conn.release();
        res.json(rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/admin/users/:id', authenticateToken, isAdmin, async (req, res) => {
    try {
        const conn = await pool.getConnection();
        await conn.execute(`DELETE FROM users WHERE id = ?`, [req.params.id]);
        conn.release();
        res.json({ message: 'User deleted successfully' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

// ===== ANALYTICS & REPORTS API =====
app.get('/api/analytics', authenticateToken, isAdmin, async (req, res) => {
    try {
        const { days = 'all', status = 'all' } = req.query;
        
        let whereClause = 'WHERE 1=1';
        const params = [];
        
        if (days !== 'all') {
            whereClause += ' AND o.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)';
            params.push(days);
        }
        if (status !== 'all') {
            whereClause += ' AND o.status = ?';
            params.push(status);
        }

        const conn = await pool.getConnection();
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
        conn.release();

        res.json({
            total_orders: parseInt(results[0][0][0].total_orders),
            total_revenue: parseFloat(results[1][0][0].total_revenue),
            active_customers: parseInt(results[2][0][0].active_customers),
            avg_order_value: parseFloat(results[3][0][0].avg_order_value),
            order_trends: results[4][0],
            revenue_by_status: results[5][0],
            top_products: results[6][0],
            customer_orders: results[7][0],
            order_growth: 15,
            revenue_growth: 28,
            customer_growth: 12,
            peak_day: results[4][0][0]?.day_name || 'Wednesday',
            top_status: results[5][0][0]?.status || 'delivered',
            delivered_revenue: parseFloat(results[5][0].find(r => r.status === 'delivered')?.total_amount || 0),
            top_product_name: results[6][0][0]?.name || 'Tiramisu Cake',
            total_items_sold: results[6][0].reduce((sum, r) => sum + parseInt(r.quantity), 0),
            top_customer: results[7][0][0]?.username || 'johndoe',
            repeat_customers: results[7][0].filter(c => c.order_count > 1).length
        });
    } catch (error) {
        console.error('🚨 ANALYTICS ERROR:', error);
        res.status(500).json({ error: 'Analytics failed', details: error.message });
    }
});

// 🔥 COMPLETE EXPORT ROUTES (ALL 3 BUTTONS NOW WORK!)
app.post('/api/export/:type', authenticateToken, isAdmin, async (req, res) => {
    const conn = await pool.getConnection();
    
    try {
        const { type } = req.params;
        console.log(`📄 Export requested: ${type}`);

        if (type === 'dashboard') {
            console.log('🎯 Generating Dashboard PDF...');
            
            const [[totalOrders], [delivered], [revenue], [users], [menuItems], [pending]] = await Promise.all([
                conn.execute(`SELECT COUNT(*) as count FROM orders`),
                conn.execute(`SELECT COUNT(*) as count FROM orders WHERE status = 'delivered'`),
                conn.execute(`SELECT COALESCE(SUM(total_amount), 0) as total FROM orders WHERE status != 'cancelled'`),
                conn.execute(`SELECT COUNT(*) as count FROM users WHERE role = 'customer'`),
                conn.execute(`SELECT COUNT(*) as count FROM menu_items WHERE is_available = TRUE`),
                conn.execute(`SELECT COUNT(*) as count FROM orders WHERE status IN ('pending', 'preparing')`)
            ]);

            const doc = new jsPDF('p', 'mm', 'a4');
            
            // Header
            doc.setFillColor(26, 26, 26);
            doc.rect(0, 0, 210, 40, 'F');
            doc.setTextColor(255, 255, 255);
            doc.setFontSize(28);
            doc.setFont('helvetica', 'bold');
            doc.text('Hulyanas Hill', 105, 22, { align: 'center' });
            doc.setFontSize(16);
            doc.setFont('helvetica', 'normal');
            doc.text('Dashboard Report', 105, 32, { align: 'center' });

            // Stats Table
            const statsData = [
                ['📋 Total Orders', parseInt(totalOrders[0].count).toLocaleString()],
                ['✅ Delivered', parseInt(delivered[0].count).toLocaleString()],
                ['⏳ Pending', parseInt(pending[0].count).toLocaleString()],
                ['💰 Revenue', `₱${parseFloat(revenue[0].total).toLocaleString('en-PH', {minimumFractionDigits: 2})}`],
                ['👥 Customers', parseInt(users[0].count).toLocaleString()],
                ['🍽️ Menu Items', parseInt(menuItems[0].count).toLocaleString()]
            ];

            autoTable(doc, {
                startY: 50,
                head: [['Metric', 'Value']],
                body: statsData,
                theme: 'grid',
                styles: { fontSize: 11, cellPadding: 6, halign: 'center', minCellHeight: 10 },
                headStyles: { fillColor: [26, 26, 26], textColor: 255, fontSize: 12, fontStyle: 'bold' },
                alternateRowStyles: { fillColor: [248, 249, 250] },
                columnStyles: { 0: { halign: 'left', fontStyle: 'bold', cellWidth: 90 }, 1: { halign: 'center', fontStyle: 'bold' } },
                margin: { top: 50, left: 15, right: 15 }
            });

            const finalY = doc.lastAutoTable.finalY + 15;
            doc.setTextColor(26, 26, 26);
            doc.setFontSize(18);
            doc.setFont('helvetica', 'bold');
            doc.text('📊 Executive Summary', 15, finalY);
            
            doc.setFontSize(12);
            doc.setFont('helvetica', 'normal');
            doc.text(`Total Orders: ${parseInt(totalOrders[0].count).toLocaleString()}`, 15, finalY + 12);
            doc.text(`Revenue Generated: ₱${parseFloat(revenue[0].total).toLocaleString('en-PH', {minimumFractionDigits: 2})}`, 15, finalY + 22);
            doc.text(`Successful Deliveries: ${parseInt(delivered[0].count).toLocaleString()}`, 15, finalY + 32);
            doc.text(`Active Customers: ${parseInt(users[0].count).toLocaleString()}`, 15, finalY + 42);

            doc.setFontSize(10);
            doc.setFont('helvetica', 'italic');
            doc.setTextColor(150, 150, 150);
            doc.text('Hulyanas Hill Restaurant System | Generated by Admin Dashboard', 105, 285, { align: 'center' });

            const pdfBuffer = doc.output('arraybuffer');
            res.set({
                'Content-Type': 'application/pdf',
                'Content-Disposition': `attachment; filename="hulyanas-dashboard-${new Date().toISOString().split('T')[0]}.pdf"`,
                'Content-Length': pdfBuffer.byteLength
            });
            return res.send(Buffer.from(pdfBuffer));

        } else if (type === 'orders') {
            console.log('📋 Generating Orders CSV...');
            
            const [rows] = await conn.execute(`
                SELECT o.order_number, CONCAT(u.first_name, ' ', u.last_name) as customer,
                       o.total_amount, o.status, o.payment_method, 
                       DATE_FORMAT(o.created_at, '%Y-%m-%d %H:%i') as order_date
                FROM orders o LEFT JOIN users u ON o.user_id = u.id 
                ORDER BY o.created_at DESC LIMIT 1000`);

            const csvHeader = ['Order #', 'Customer', 'Amount', 'Status', 'Payment', 'Date'];
            const csvRows = rows.map(row => [
                row.order_number || '',
                `"${row.customer || 'N/A'}"`,
                `₱${parseFloat(row.total_amount || 0).toFixed(2)}`,
                row.status || '',
                row.payment_method || '',
                row.order_date || ''
            ]);

            const csvContent = [csvHeader, ...csvRows].map(row => row.join(',')).join('\n');
            res.set({
                'Content-Type': 'text/csv',
                'Content-Disposition': `attachment; filename="hulyanas-orders-${new Date().toISOString().split('T')[0]}.csv"`,
                'Content-Length': Buffer.byteLength(csvContent, 'utf8')
            });
            return res.send(csvContent);

        } else if (type === 'sales') {
            console.log('💰 Generating Sales CSV...');
            
            const [salesRows] = await conn.execute(`
                SELECT 
                    DATE_FORMAT(o.created_at, '%Y-%m-%d') as sale_date,
                    DAYNAME(o.created_at) as day_name,
                    o.order_number,
                    CONCAT(u.first_name, ' ', u.last_name) as customer,
                    o.status,
                    o.payment_method,
                    o.total_amount,
                    oi.quantity,
                    mi.name as product_name,
                    oi.price as unit_price,
                    (oi.quantity * oi.price) as line_total
                FROM orders o 
                LEFT JOIN users u ON o.user_id = u.id
                LEFT JOIN order_items oi ON o.id = oi.order_id
                LEFT JOIN menu_items mi ON oi.menu_item_id = mi.id
                WHERE o.status != 'cancelled'
                ORDER BY o.created_at DESC
                LIMIT 5000`);

            const csvHeader = ['Date', 'Day', 'Order #', 'Customer', 'Status', 'Payment', 'Order Total', 'Qty', 'Product', 'Unit Price', 'Line Total'];
            const csvRows = salesRows.map(row => [
                row.sale_date || '',
                row.day_name || '',
                row.order_number || '',
                `"${row.customer || 'N/A'}"`,
                row.status || '',
                row.payment_method || '',
                `₱${parseFloat(row.total_amount || 0).toFixed(2)}`,
                parseInt(row.quantity || 0),
                `"${row.product_name || 'N/A'}"`,
                `₱${parseFloat(row.unit_price || 0).toFixed(2)}`,
                `₱${parseFloat(row.line_total || 0).toFixed(2)}`
            ]);

            const csvContent = [csvHeader, ...csvRows].map(row => row.join(',')).join('\n');
            
            res.set({
                'Content-Type': 'text/csv',
                'Content-Disposition': `attachment; filename="hulyanas-sales-${new Date().toISOString().split('T')[0]}.csv"`,
                'Content-Length': Buffer.byteLength(csvContent, 'utf8')
            });
            console.log('✅ Sales CSV Generated! Rows:', salesRows.length);
            return res.send(csvContent);
        } else {
            return res.status(400).json({ error: 'Invalid type. Use: dashboard, orders, or sales' });
        }

    } catch (error) {
        console.error('🚨 Export Error:', error);
        return res.status(500).json({ 
            error: 'Export failed', 
            details: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    } finally {
        conn.release();
    }
});

// Start Server
app.listen(PORT, () => {
    console.log(`🚀 Hulyanas Hill running on port ${PORT}`);
    console.log(`👑 Admin: http://localhost:${PORT}/admin/reports.html`);
    console.log(`📊 Test exports: POST /api/export/dashboard, /orders, /sales`);
});