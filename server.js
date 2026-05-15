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
const PORT = process.env.PORT;

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
app.use('/images', express.static(path.join(__dirname, 'images')));

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
// 👤 Get user profile by ID (for dashboard)
// 👤 Get user profile by ID (for dashboard)
app.get('/api/user/:id', authenticateToken, async (req, res) => {
    let conn;

    try {
        const { id } = req.params;

        // ✅ INSERT HERE
        if (
            req.user.id !== parseInt(req.params.id) &&
            req.user.role !== 'admin'
        ) {
            return res.status(403).json({
                error: 'Unauthorized'
            });
        }

        conn = await pool.getConnection();

        const [rows] = await conn.execute(
            `SELECT 
                id,
                first_name,
                last_name,
                username,
                email,
                role
             FROM users
             WHERE id = ?
             AND is_active = 1
             AND role = 'customer'`,
            [parseInt(id)]
        );

        if (rows.length === 0) {
            return res.status(404).json({
                error: 'Customer not found'
            });
        }

        const user = rows[0];

        const [orderCount] = await conn.execute(
            `SELECT COUNT(*) AS total_orders
             FROM orders
             WHERE user_id = ?`,
            [user.id]
        );

        res.json({
            id: user.id,
            first_name: user.first_name,
            last_name: user.last_name,
            username: user.username,
            email: user.email,
            full_name: `${user.first_name} ${user.last_name}`.trim(),
            role: user.role,
            total_orders: parseInt(orderCount[0].total_orders || 0)
        });

    } catch (error) {
        console.error('🚨 User fetch error:', error);

        res.status(500).json({
            error: 'Failed to fetch user data'
        });

    } finally {
        if (conn) conn.release();
    }
});

// 📊 Get user statistics (REAL DATABASE QUERIES)
app.get('/api/user/:id/stats', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const conn = await pool.getConnection();
        
        const [stats] = await conn.execute(`
            SELECT 
                COUNT(o.id) as totalOrders,
                COALESCE(SUM(o.total_amount), 0) as totalSpent,
                COUNT(CASE WHEN o.status IN ('pending', 'preparing', 'out_for_delivery') THEN 1 END) as activeOrders,
                COALESCE(AVG(4.8), 4.5) as avgRating
            FROM orders o 
            WHERE o.user_id = ?
        `, [parseInt(id)]);
        
        conn.release();
        
        const userStats = stats[0] || {};
        res.json({
            totalOrders: parseInt(userStats.totalOrders || 0),
            totalSpent: parseFloat(userStats.totalSpent || 0).toFixed(2),
            activeOrders: parseInt(userStats.activeOrders || 0),
            avgRating: parseFloat(userStats.avgRating || 4.5)
        });
        
    } catch (error) {
        console.error('🚨 User stats error:', error);
        res.status(500).json({ error: 'Failed to fetch user stats' });
    }
});


/// 📋 Get user recent activity (REAL DATABASE)
app.get('/api/user/:id/activity', authenticateToken, async (req, res) => {
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
            WHERE al.user_id = ?
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
            return res.status(400).json({ error: 'All fields required' });
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
                success: true,
                message: 'Registered successfully',
                userId: result.insertId,
                redirect: '/user/dashboard.html'
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

// ADD THIS ONE ROUTE - NOTHING ELSE!
app.post('/api/change-password', authenticateToken, async (req, res) => {
    console.log('🔑 CHANGE PASSWORD - MySQL');
    
    let conn; // Add connection variable
    
    try {
        const { current_password, new_password } = req.body;
        const userId = req.user.id;
        
        console.log('User ID:', userId);
        
        // Use pool.getConnection() like ALL other routes
        conn = await pool.getConnection();
        
        // MySQL: table=users, column=password_hash (from your schema)
        const [userResult] = await conn.execute('SELECT password_hash FROM users WHERE id = ?', [userId]);
        
        console.log('User found:', userResult.length);
        
        if (userResult.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        const userPassword = userResult[0].password_hash;
        console.log('Has password_hash:', !!userPassword);
        
        // Verify current password
        const isValid = await bcrypt.compare(current_password, userPassword);
        console.log('Current password valid:', isValid);
        
        if (!isValid) {
            return res.status(401).json({ error: 'Current password is incorrect' });
        }
        
        // Update password
        const newHash = await bcrypt.hash(new_password, 10);
        const [updateResult] = await conn.execute(
            'UPDATE users SET password_hash = ? WHERE id = ?', 
            [newHash, userId]
        );
        
        console.log('Rows updated:', updateResult.affectedRows);
        console.log('✅ PASSWORD CHANGED!');
        
        res.json({ success: true, message: 'Password updated!' });
        
    } catch (error) {
        console.error('❌ ERROR:', error.message);
        res.status(500).json({ error: error.message });
    } finally {
        if (conn) conn.release(); // Always release connection
    }
});


// Login
// Login with ROLE REDIRECTION
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
        
        // Store in localStorage for frontend
        res.json({
            token,
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                role: user.role,
                full_name: `${user.first_name} ${user.last_name}`.trim()
            },
            redirect: user.role === 'admin' ? '/admin/dashboard.html' : '/user/dashboard.html'
        });
    } catch (error) {
        console.error('🚨 Login error:', error);
        res.status(500).json({ error: 'Login failed' });
    }
});

// Profile
// Profile (authenticated)
app.get('/api/profile', authenticateToken, async (req, res) => {
    try {
        const conn = await pool.getConnection();
        const [rows] = await conn.execute(
            `SELECT id, username, email, first_name, last_name, phone, role, created_at, is_active
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
            role: user.role,
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
        
        res.json({ 
            success: true, 
            message: 'Profile updated successfully',
            redirect: '/user/dashboard.html'
        });
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
                    TIME_FORMAT(TIMEDIFF(NOW(), o.created_at), '%i min ago') as time_ago,
                    CASE o.status
                        WHEN 'pending' THEN '🕐 Pending'
                        WHEN 'preparing' THEN '🔥 Preparing'
                        WHEN 'out_for_delivery' THEN '🚚 Out for Delivery'
                        WHEN 'delivered' THEN '✅ Delivered'
                        WHEN 'cancelled' THEN '❌ Cancelled'
                    END as status_display
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
    let conn;

    try {
        conn = await pool.getConnection();

        const [rows] = await conn.execute(`
            SELECT id, name, description, price, category, image_url, is_available
            FROM menu_items
            ORDER BY created_at DESC
        `);

        console.log("MENU ITEMS FOUND:", rows.length);

        res.json(rows);

    } catch (error) {
        console.error('Menu error:', error);
        res.status(500).json({ error: error.message });

    } finally {
        if (conn) conn.release();
    }
});

app.get('/api/admin/menu', authenticateToken, isAdmin, async (req, res) => {
    try {
        const conn = await pool.getConnection();

        const [rows] = await conn.execute(`
            SELECT 
                id,
                name,
                description,
                price,
                category,
                image_url,
                is_available
            FROM menu_items
            ORDER BY created_at DESC
        `);

        conn.release();

        res.json(rows);

    } catch (error) {
        console.error('🚨 Admin menu error:', error);

        res.status(500).json({
            error: error.message
        });
    }
});

// ===== ADMIN ROUTES =====

// Admin stats
app.get('/api/admin/stats', authenticateToken, isAdmin, async (req, res) => {
    try {
        const conn = await pool.getConnection();
        const [[menuItems], [totalOrders], [revenue], [totalUsers]] = await Promise.all([
            conn.execute(`SELECT COUNT(*) as count FROM menu_items WHERE is_available = TRUE`),
            conn.execute(`SELECT COUNT(*) as count FROM orders WHERE status IN ('preparing', 'out_for_delivery', 'delivered')`),
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
                        ELSE CONCAT(TIMESTAMPDIFF(HOUR, o.created_at, NOW()), ' hr ago')
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
            [name, description, parseFloat(price), category || 'main', image_url, parseInt(is_available)]
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
            [name, description, parseFloat(price), category, image_url, parseInt(is_available), id]
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

// Edit User Role (Admin only)
app.put('/api/admin/users/:id/role', authenticateToken, isAdmin, async (req, res) => {
    let conn;

    try {
        const { id } = req.params;
        const { role } = req.body;

        console.log('Update request:', { id, role });

        if (!role) {
            return res.status(400).json({ error: 'Role required' });
        }

        conn = await pool.getConnection();

        const [result] = await conn.execute(
            'UPDATE users SET role = ? WHERE id = ?',
            [role, id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json({ success: true, message: 'Role updated successfully' });

    } catch (error) {
        console.error('DATABASE ERROR:', error);
        res.status(500).json({
            error: error.message
        });

    } finally {
        if (conn) conn.release();
    }
});


app.get('/api/analytics', authenticateToken, isAdmin, async (req, res) => {
    let conn;

    try {
        const { days = 'all', status = 'all' } = req.query;

        conn = await pool.getConnection();

        // =========================
        // FILTERS
        // =========================
        let whereClause = `WHERE LOWER(o.status) != 'cancelled' and LOWER(o.status) != 'pending'`;
        const params = [];

        if (days !== 'all') {
            whereClause += ` AND o.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)`;
            params.push(Number(days));
        }

        if (status !== 'all') {
            whereClause += ` AND LOWER(o.status) = LOWER(?)`;
            params.push(status);
        }

        // =========================
        // TOTAL ORDERS
        // =========================
        const [totalOrdersResult] = await conn.execute(`
            SELECT COUNT(*) AS total_orders
            FROM orders o
            ${whereClause}
        `, params);

        // =========================
        // TOTAL REVENUE
        // =========================
        const [revenueResult] = await conn.execute(`SELECT COALESCE(SUM(o.total_amount), 0) AS total_revenue FROM orders o ${whereClause}AND LOWER(o.status) IN (
        'delivered',
        'preparing',
        'out_for_delivery')`, params);

        // =========================
        // ACTIVE CUSTOMERS
        // =========================
        const [customersResult] = await conn.execute(`
            SELECT COUNT(DISTINCT o.user_id) AS active_customers
            FROM orders o
            ${whereClause}
        `, params);

        // =========================
        // AVG ORDER VALUE
        // =========================
        const [avgResult] = await conn.execute(`
            SELECT COALESCE(AVG(o.total_amount), 0) AS avg_order_value
            FROM orders o
            ${whereClause}
            AND LOWER(o.status) = 'delivered' OR LOWER(o.status) = 'preparing' OR LOWER(o.status) = 'out_for_delivery'`, params);

        // =========================
        // ORDER TRENDS
        // =========================
        const [orderTrends] = await conn.execute(`
            SELECT
                DAYNAME(o.created_at) AS day_name,
                COUNT(*) AS order_count
            FROM orders o
            ${whereClause}
            GROUP BY DAYNAME(o.created_at)
            ORDER BY order_count DESC
        `, params);

        const peakDay =
            orderTrends.length > 0
                ? orderTrends[0].day_name
                : '-';

        // =========================
        // REVENUE BY STATUS
        // =========================
        const [revenueByStatus] = await conn.execute(`
            SELECT
                o.status,
                COALESCE(SUM(o.total_amount), 0) AS total_amount
            FROM orders o
            ${whereClause}
            GROUP BY o.status
            ORDER BY total_amount DESC
        `, params);

        let topStatus = '-';

        if (revenueByStatus.length > 0) {
            topStatus = revenueByStatus[0].status;
        }

        const deliveredRevenue =
            revenueByStatus.find(
                item => item.status.toLowerCase() === 'delivered'
            )?.total_amount || 0;

        // =========================
        // TOP PRODUCTS
        // =========================
        const [topProducts] = await conn.execute(`
            SELECT
                mi.name,
                SUM(oi.quantity) AS quantity
            FROM order_items oi
            JOIN menu_items mi
                ON oi.menu_item_id = mi.id
            JOIN orders o
                ON oi.order_id = o.id
            ${whereClause}
            GROUP BY oi.menu_item_id, mi.name
            ORDER BY quantity DESC
            LIMIT 5
        `, params);

        const topProductName =
            topProducts.length > 0
                ? topProducts[0].name
                : '-';

        const totalItemsSold =
            topProducts.reduce(
                (sum, item) => sum + Number(item.quantity),
                0
            );

        // =========================
        // CUSTOMER ORDERS
        // =========================
        const [customerOrders] = await conn.execute(`
            SELECT
                u.username,
                COUNT(o.id) AS order_count
            FROM orders o
            JOIN users u
                ON o.user_id = u.id
            ${whereClause}
            GROUP BY o.user_id, u.username
            ORDER BY order_count DESC
            LIMIT 5
        `, params);

        const topCustomer =
            customerOrders.length > 0
                ? customerOrders[0].username
                : '-';

        // =========================
        // REPEAT CUSTOMERS
        // =========================
        const [repeatCustomersResult] = await conn.execute(`
            SELECT COUNT(*) AS repeat_customers
            FROM (
                SELECT o.user_id
                FROM orders o
                ${whereClause}
                GROUP BY o.user_id
                HAVING COUNT(o.id) > 1
            ) repeated
        `, params);

        // =========================
        // GROWTH PERCENTAGES
        // =========================
        const [currentMonthOrders] = await conn.execute(`
            SELECT COUNT(*) AS total
            FROM orders
            WHERE MONTH(created_at) = MONTH(CURRENT_DATE())
        `);

        const [previousMonthOrders] = await conn.execute(`
            SELECT COUNT(*) AS total
            FROM orders
            WHERE MONTH(created_at) =
            MONTH(CURRENT_DATE() - INTERVAL 1 MONTH)
        `);

        const calculateGrowth = (current, previous) => {
            if (previous === 0) {
                return current > 0 ? 100 : 0;
            }

            return Number(
                (((current - previous) / previous) * 100)
                .toFixed(1)
            );
        };

        const orderGrowth = calculateGrowth(
            currentMonthOrders[0].total,
            previousMonthOrders[0].total
        );

        // =========================
        // FINAL RESPONSE
        // =========================
        res.json({
            total_orders:
                totalOrdersResult[0].total_orders || 0,

            total_revenue:
                parseFloat(
                    revenueResult[0].total_revenue || 0
                ),

            active_customers:
                customersResult[0].active_customers || 0,

            avg_order_value:
                parseFloat(
                    avgResult[0].avg_order_value || 0
                ),

            order_growth: orderGrowth,
            revenue_growth: orderGrowth,
            customer_growth: orderGrowth,

            order_trends: orderTrends || [],
            peak_day: peakDay,

            revenue_by_status: revenueByStatus || [],
            top_status: topStatus,
            delivered_revenue: deliveredRevenue,

            top_products: topProducts || [],
            top_product_name: topProductName,
            total_items_sold: totalItemsSold,

            customer_orders: customerOrders || [],
            top_customer: topCustomer,

            repeat_customers:
                repeatCustomersResult[0]
                    .repeat_customers || 0
        });

    } catch (error) {
        console.error('🚨 Analytics error:', error);

        res.status(500).json({
            error: 'Analytics failed',
            details: error.message
        });

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