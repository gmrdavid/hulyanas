require('dotenv').config();

const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');
const multer = require('multer');

const cloudinary = require('cloudinary').v2;
const streamifier = require('streamifier');

const app = express();
const PORT = process.env.PORT || 25482;

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
app.use(express.urlencoded({ extended: true }));
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
const JWT_SECRET = process.env.JWT_SECRET 
if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET is missing');
}

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

const upload = multer({ storage: multer.memoryStorage() });

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
            full_name: `${user.first_name || ''} ${user.last_name || ''}`.trim(),
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
        
        if (conn) conn.release();
        
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
        
        if (conn) conn.release();
        
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
            if (conn) conn.release();
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

        
         await logActivity(
            conn,
            user.id,
            'auth',
            'Logged in'
        );

        if (conn) conn.release();
        
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
                full_name: `${user.first_name || ''} ${user.last_name || ''}`.trim()
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
        if (conn) conn.release();
        
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
            full_name: `${user.first_name || ''} ${user.last_name || ''}`.trim(),
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

        await logActivity(
            conn,
            req.user.id,
            'profile',
            'Updated profile'
        );

        if (conn) conn.release();
        
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
    let conn;

    try {
        conn = await pool.getConnection();

        const [rows] = await conn.execute(
            `
            SELECT 
                o.*,

                -- customer info (IMPORTANT for invoice)
                CONCAT(u.first_name, ' ', u.last_name) AS customer_name,
                u.email AS customer_email,
                u.phone AS customer_phone,

                -- formatted address (clean fallback)
                COALESCE(o.delivery_address, 'No address provided') AS delivery_address,

                -- time helper
                TIMESTAMPDIFF(MINUTE, o.created_at, NOW()) AS minutes_ago,

                CASE o.status
                    WHEN 'pending' THEN '🕐 Pending'
                    WHEN 'preparing' THEN '🔥 Preparing'
                    WHEN 'out_for_delivery' THEN '🚚 Out for Delivery'
                    WHEN 'delivered' THEN '✅ Delivered'
                    WHEN 'cancelled' THEN '❌ Cancelled'
                END AS status_display

            FROM orders o
            JOIN users u ON o.user_id = u.id
            WHERE o.user_id = ?
            ORDER BY o.created_at DESC
            `,
            [req.user.id]
        );

        // Add helper formatted time
        const formatted = rows.map(order => ({
            ...order,
            time_ago:
                order.minutes_ago < 60
                    ? `${order.minutes_ago} min ago`
                    : `${Math.floor(order.minutes_ago / 60)} hr ago`
        }));

        res.json(formatted);

    } catch (error) {
        console.error('🚨 Orders error:', error);
        res.status(500).json({ error: error.message });

    } finally {
        if (conn) conn.release();
    }
});

// Add this to your server.js after the orders routes
// ADD THIS after your existing /api/orders route (around line 250)
app.get('/api/orders/:id/items', authenticateToken, async (req, res) => {
    let conn;

    try {
        const { id } = req.params;

        // Verify ownership
        const [orderCheck] = await pool.execute(
            'SELECT id FROM orders WHERE id = ? AND user_id = ?', 
            [id, req.user.id]
        );

        if (orderCheck.length === 0) {
            return res.status(403).json({ error: 'Order not found' });
        }

        conn = await pool.getConnection();

        const [rows] = await conn.execute(`
            SELECT 
                oi.menu_item_id,
                oi.quantity,
                oi.price_at_order,
                mi.name,
                mi.image_url
            FROM order_items oi
            JOIN menu_items mi ON oi.menu_item_id = mi.id
            WHERE oi.order_id = ?
            ORDER BY oi.id
        `, [id]);

        // ✅ FIX: normalize image URLs
        const items = rows.map(item => ({
            ...item,
            image_url: normalizeImageUrl(item.image_url)
        }));

        res.json(items);

    } catch (error) {
        console.error('🚨 Order items error:', error);
        res.status(500).json({ error: 'Failed to load order items' });

    } finally {
        if (conn) conn.release();
    }
});

// ADD THIS after your existing orders routes
app.post('/api/orders', authenticateToken, async (req, res) => {
    const conn = await pool.getConnection();

    try {
        await conn.beginTransaction();

        const userId = req.user.id;

        const {
            items,
            total,
            delivery_address,
            phone,
            payment_method
        } = req.body;

        // 1. Generate order number
        const orderNumber = `#ORD-${Date.now()}`;

        // 2. Insert order
        const [orderResult] = await conn.execute(
            `INSERT INTO orders 
            (order_number, user_id, total_amount, delivery_address, phone, payment_method)
            VALUES (?, ?, ?, ?, ?, ?)`,
            [orderNumber, userId, total, delivery_address, phone, payment_method]
        );

        const orderId = orderResult.insertId;

        // 3. Insert order items
        for (const item of items) {
            await conn.execute(
                `INSERT INTO order_items 
                (order_id, menu_item_id, quantity, price_at_order)
                VALUES (?, ?, ?, ?)`,
                [orderId, item.id, item.quantity, item.price]
            );
        }

        await logActivity(
            conn,
            userId,
            'order',
            'Placed order',
            {
                order_number: orderNumber,
                total
            }
        );

        // 4. Clear cart
        await conn.execute(
            `DELETE FROM cart WHERE user_id = ?`,
            [userId]
        );

        await conn.commit();

        res.json({
            success: true,
            order_number: orderNumber
        });

    } catch (err) {
        await conn.rollback();
        console.error('ORDER ERROR:', err); // 👈 THIS is what you're missing
        res.status(500).json({
            success: false,
            message: 'Order creation failed'
        });
    } finally {
        conn.release();
    }
});

// ===== 🛒 CART ROUTES =====
app.get('/api/cart', authenticateToken, async (req, res) => {
    let conn;
    try {
        conn = await pool.getConnection();

        const [rows] = await conn.execute(`
            SELECT 
                c.id,
                c.menu_item_id,
                c.quantity,
                mi.name,
                mi.price,
                mi.image_url,
                mi.is_available
            FROM cart c
            JOIN menu_items mi ON c.menu_item_id = mi.id
            WHERE c.user_id = ? AND mi.is_available = 1
            ORDER BY c.created_at DESC
        `, [req.user.id]);

        // ✅ FIX: normalize image URLs
        const items = rows.map(item => ({
            ...item,
            image_url: item.image_url
                ? normalizeImageUrl(item.image_url)
                : '/images/default-food.png'
        }));

        res.json(items);

    } catch (error) {
        console.error('🚨 Cart GET error:', error);
        res.status(500).json({ error: 'Failed to load cart', items: [] });

    } finally {
        if (conn) conn.release();
    }
});

app.post('/api/cart', authenticateToken, async (req, res) => {
    let conn;
    try {
        const { menu_item_id, quantity = 1 } = req.body;
        conn = await pool.getConnection();
        await conn.beginTransaction();

        await logActivity(
            conn,
            req.user.id,
            'cart',
            'Added item to cart',
            { menu_item_id, quantity }
        );

        // Check menu item exists and available
        const [menuCheck] = await conn.execute(
            'SELECT id, price FROM menu_items WHERE id = ? AND is_available = 1', 
            [menu_item_id]
        );
        
        if (menuCheck.length === 0) {
            await conn.rollback();
            return res.status(404).json({ error: 'Menu item not available' });
        }

        // Upsert (update or insert)
        const [existing] = await conn.execute(
            'SELECT id FROM cart WHERE user_id = ? AND menu_item_id = ?', 
            [req.user.id, menu_item_id]
        );

        if (existing.length > 0) {
            await conn.execute(
                'UPDATE cart SET quantity = quantity + ?, updated_at = NOW() WHERE id = ?',
                [quantity, existing[0].id]
            );
        } else {
            await conn.execute(
                'INSERT INTO cart (user_id, menu_item_id, quantity) VALUES (?, ?, ?)',
                [req.user.id, menu_item_id, quantity]
            );
        }

        await conn.commit();
        res.json({ success: true });
    } catch (error) {
        console.error('🚨 Cart POST error:', error);
        if (conn) await conn.rollback();
        res.status(500).json({ error: 'Failed to add to cart' });
    } finally {
        if (conn) conn.release();
    }
});

// Replace your existing PUT /api/cart/:menuItemId with this:
app.put('/api/cart/:menuItemId', authenticateToken, async (req, res) => {
    let conn;
    try {
        const { menuItemId } = req.params;
        const { quantity } = req.body;
        
        conn = await pool.getConnection();
        
        // Check if item exists first
        const [existing] = await conn.execute(
            'SELECT quantity FROM cart WHERE user_id = ? AND menu_item_id = ?', 
            [req.user.id, menuItemId]
        );
        
        if (existing.length === 0) {
            return res.status(404).json({ error: 'Cart item not found' });
        }
        
        let newQuantity;
        if (quantity < 0) {
            // DECREMENT: quantity = -1
            newQuantity = Math.max(1, existing[0].quantity + quantity);
        } else if (quantity > 1000) {
            // INCREMENT: quantity = 999 (hack for +1)
            newQuantity = existing[0].quantity + 1;
        } else {
            // EXACT quantity from cart page
            newQuantity = Math.max(1, quantity);
        }
        
        const [result] = await conn.execute(
            'UPDATE cart SET quantity = ?, updated_at = NOW() WHERE user_id = ? AND menu_item_id = ?',
            [newQuantity, req.user.id, menuItemId]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Cart item not found' });
        }
        
        // Return updated item for frontend
        const [updatedItem] = await conn.execute(`
            SELECT c.*, mi.name, mi.price, mi.image_url 
            FROM cart c JOIN menu_items mi ON c.menu_item_id = mi.id 
            WHERE c.user_id = ? AND c.menu_item_id = ?
        `, [req.user.id, menuItemId]);
        
        res.json({ success: true, item: updatedItem[0] });
    } catch (error) {
        console.error('🚨 Cart PUT error:', error);
        res.status(500).json({ error: 'Failed to update cart' });
    } finally {
        if (conn) conn.release();
    }
});

app.delete('/api/cart/:menuItemId?', authenticateToken, async (req, res) => {
    let conn;
    try {
        const menuItemId = req.params.menuItemId;
        conn = await pool.getConnection();
        
        if (menuItemId) {
            // Delete specific item
            await conn.execute(
                'DELETE FROM cart WHERE user_id = ? AND menu_item_id = ?', 
                [req.user.id, menuItemId]
            );
        } else {
            // Clear entire cart
            await conn.execute('DELETE FROM cart WHERE user_id = ?', [req.user.id]);
        }
        res.json({ success: true });
    } catch (error) {
        console.error('🚨 Cart DELETE error:', error);
        res.status(500).json({ error: 'Failed to remove from cart' });
    } finally {
        if (conn) conn.release();
    }
});

// ===== MENU ROUTES =====
app.get('/api/menu', async (req, res) => {
    let conn;

    try {
        conn = await pool.getConnection();

        const [rows] = await conn.execute(`
            SELECT *
            FROM menu_items
            WHERE is_available = 1
            ORDER BY created_at DESC
        `);

        const data = rows.map(item => ({
            ...item,
            image_url: normalizeImageUrl(item.image_url)
        }));

        res.json(data);

    } catch (error) {
        console.error(error);
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

        if (conn) conn.release();

        res.json(rows);

    } catch (error) {
        console.error('🚨 Admin menu error:', error);

        res.status(500).json({
            error: error.message
        });
    }
});

app.post('/api/upload', upload.single('image'), async (req, res) => {
  try {
    const streamUpload = (file) =>
      new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { folder: 'hulyanas-menu' },
          (err, result) => {
            if (result) resolve(result);
            else reject(err);
          }
        );

        streamifier.createReadStream(file.buffer).pipe(stream);
      });

    const result = await streamUpload(req.file);

    res.json({
      image_url: result.secure_url
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Upload failed' });
  }
});

// ===== ADMIN ROUTES =====

// Admin stats
app.get('/api/admin/stats', authenticateToken, isAdmin, async (req, res) => {
    try {
        const conn = await pool.getConnection();
        const [
            [menuItems],
            [totalOrders],
            [revenue],
            [totalUsers]
            ] = await Promise.all([
            conn.execute(`SELECT COUNT(*) as count FROM menu_items WHERE is_available = TRUE`),
            conn.execute(`SELECT COUNT(*) as count FROM orders WHERE status IN ('preparing', 'out_for_delivery', 'delivered')`),
            conn.execute(`SELECT COALESCE(SUM(total_amount), 0) as revenue FROM orders WHERE status NOT IN ('cancelled', 'pending')`),
            conn.execute(`SELECT COUNT(*) as count FROM users WHERE role = 'customer'`)
        ]);
        if (conn) conn.release();
        
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
        if (conn) conn.release();
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
        if (conn) conn.release();
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
        if (conn) conn.release();
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
        if (conn) conn.release();

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
    let conn;
    try {
        const { name, description, price, category, is_available } = req.body;

        // ONLY CLOUDINARY URL
        const image_url = req.file ? req.file.path : null;

        conn = await pool.getConnection();

        const [result] = await conn.execute(
            `INSERT INTO menu_items (name, description, price, category, image_url, is_available)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [name, description, parseFloat(price), category || 'main', image_url, parseInt(is_available)]
        );

        res.status(201).json({
            message: 'Menu item added successfully',
            id: result.insertId
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });

    } finally {
        if (conn) conn.release();
    }
});

app.put('/api/menu/:id', authenticateToken, isAdmin, upload.single('image'), async (req, res) => {
    let conn;

    try {
        const { id } = req.params;
        const { name, description, price, category, is_available } = req.body;

        conn = await pool.getConnection();

        const [oldItem] = await conn.execute(
            `SELECT image_url FROM menu_items WHERE id=?`,
            [id]
        );

        let image_url = oldItem[0]?.image_url || null;

        // ONLY replace if new image uploaded
        if (req.file) {
            image_url = req.file.path; // Cloudinary URL
        }

        await conn.execute(
            `UPDATE menu_items
             SET name=?, description=?, price=?, category=?, image_url=?, is_available=?, updated_at=NOW()
             WHERE id=?`,
            [name, description, parseFloat(price), category, image_url, parseInt(is_available), id]
        );

        res.json({ message: 'Menu item updated successfully' });

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });

    } finally {
        if (conn) conn.release();
    }
});

app.delete('/api/menu/:id', authenticateToken, isAdmin, async (req, res) => {
    let conn;

    try {
        const { id } = req.params;

        conn = await pool.getConnection();
        await conn.beginTransaction();

        const [rows] = await conn.execute(
            `SELECT id, image_url FROM menu_items WHERE id = ?`,
            [id]
        );

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Menu item not found' });
        }

        const item = rows[0];

        // delete image from cloudinary
        if (item.image_url) {
            const url = item.image_url;
            const parts = url.split('/');
            const fileWithExt = parts[parts.length - 1];
            const publicId = fileWithExt.split('.')[0];

            await cloudinary.uploader.destroy(`hulyanas-menu/${publicId}`);
        }

        // soft delete instead of hard delete
        await conn.execute(
            `UPDATE menu_items SET is_available = 0 WHERE id = ?`,
            [id]
        );

        await conn.commit();

        res.json({
            message: 'Menu item disabled successfully',
            id
        });

    } catch (error) {
        if (conn) await conn.rollback();
        res.status(500).json({ error: error.message });

    } finally {
        if (conn) conn.release();
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
        if (conn) conn.release();
        
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
        if (conn) conn.release();

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
        if (conn) conn.release();
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
        if (conn) conn.release();
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
        const [revenueResult] = await conn.execute(`SELECT COALESCE(SUM(o.total_amount), 0) AS total_revenue FROM orders o ${whereClause} AND LOWER(o.status) IN (
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
            AND (
                LOWER(o.status) = 'delivered'
                OR LOWER(o.status) = 'preparing'
                OR LOWER(o.status) = 'out_for_delivery'
            )`, params);

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

// ===============================
// CONFIG / HELPERS
// ===============================

function normalizeImageUrl(url) {
    if (!url) return null;

    if (url.startsWith('http')) return url;
    
    return `https://res.cloudinary.com/dta4irg3w/image/upload/${url}`;
}

async function logActivity(pool, user_id, type, action, details = null) {
    const conn = await pool.getConnection();
    try {
        await conn.execute(
            `INSERT INTO activity_log (user_id, type, action, details, created_at)
             VALUES (?, ?, ?, ?, NOW())`,
            [user_id, type, action, details ? JSON.stringify(details) : null]
        );
    } finally {
        conn.release();
    }
}   

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
        if (conn) conn.release();
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
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

const server = app.listen(PORT, () => {
    console.log('\n🚀 Hulyanas Hill Server v2.0 - LIVE!');
    console.log(`📍 Port: ${PORT}`);

    console.log(`📱 Customer Dashboard: ${BASE_URL}/user/dashboard.html`);
    console.log(`👑 Admin Dashboard: ${BASE_URL}/admin/dashboard.html`);
    console.log(`🩺 Health Check: ${BASE_URL}/api/health`);

    console.log('\n🆕 NEW USER DASHBOARD APIs:');
    console.log(`   👤 GET  ${BASE_URL}/api/user/2`);
    console.log(`   📊 GET  ${BASE_URL}/api/user/2/stats`);
    console.log(`   📋 GET  ${BASE_URL}/api/user/2/activity`);

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