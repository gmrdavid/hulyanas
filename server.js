require('dotenv').config();
const express = require('express');
const mysql = require('mysql2');
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

// MySQL Connection
const db = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT,
    ssl: false
});

db.connect(err => {
    if (err) {
        console.error('❌ MySQL Connection Failed:', err);
        process.exit(1);
    }
    console.log('✅ Connected to hulyanas MySQL database');
});

// JWT Secret
const JWT_SECRET = process.env.JWT_SECRET || 'hulyanas_secret_key_2024_change_this';

// File upload storage
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = 'public/images';
        if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + '-' + file.originalname);
    }
});
const upload = multer({ storage });

// ==================== AUTH MIDDLEWARE ====================
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Access token required' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Invalid or expired token' });
        }
        req.user = user;
        next();
    });
};

const isAdmin = (req, res, next) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }
    next();
};

// ==================== ADMIN DASHBOARD APIs ====================

// 1. LIVE STATS for Dashboard
app.get('/api/admin/stats', authenticateToken, isAdmin, (req, res) => {
    db.query(`
        SELECT 
            (SELECT COUNT(*) FROM menu_items) as menuItems,
            (SELECT COUNT(*) FROM orders) as totalOrders,
            (SELECT COALESCE(SUM(total_amount), 0) FROM orders WHERE status != 'cancelled') as revenue,
            (SELECT COUNT(*) FROM users WHERE role = 'customer') as totalUsers
    `, (err, results) => {
        if (err) {
            console.error('Stats query error:', err);
            return res.status(500).json({ error: 'Database error' });
        }
        const stats = results[0];
        res.json({
            menuItems: parseInt(stats.menuItems) || 0,
            totalOrders: parseInt(stats.totalOrders) || 0,
            revenue: parseFloat(stats.revenue) || 0,
            totalUsers: parseInt(stats.totalUsers) || 0
        });
    });
});

// 2. RECENT ORDERS for Dashboard
app.get('/api/admin/recent-orders', authenticateToken, isAdmin, (req, res) => {
    db.query(`
        SELECT 
            id, 
            order_number, 
            customer_name, 
            status, 
            total_amount, 
            created_at,
            CASE 
                WHEN TIMESTAMPDIFF(MINUTE, created_at, NOW()) < 60 
                THEN CONCAT(TIMESTAMPDIFF(MINUTE, created_at, NOW()), ' min ago')
                WHEN TIMESTAMPDIFF(HOUR, created_at, NOW()) < 24 
                THEN CONCAT(TIMESTAMPDIFF(HOUR, created_at, NOW()), ' hr ago')
                ELSE DATE_FORMAT(created_at, '%b %d')
            END as relative_time
        FROM orders 
        ORDER BY created_at DESC 
        LIMIT 5
    `, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

// 3. ACTIVITY FEED for Dashboard
app.get('/api/admin/activity', authenticateToken, isAdmin, (req, res) => {
    db.query(`
        SELECT 
            'order' as type, 
            CONCAT('Order #', order_number, ' - ', status) as text,
            CASE 
                WHEN TIMESTAMPDIFF(MINUTE, created_at, NOW()) < 60 
                THEN CONCAT(TIMESTAMPDIFF(MINUTE, created_at, NOW()), ' min ago')
                ELSE CONCAT(FLOOR(TIMESTAMPDIFF(HOUR, created_at, NOW()) / 60), ' hrs ago')
            END as time
        FROM orders 
        WHERE created_at > DATE_SUB(NOW(), INTERVAL 1 DAY)
        ORDER BY created_at DESC 
        LIMIT 5
    `, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

// ==================== AUTHENTICATION ====================

// Login (uses name OR email)
app.post('/api/login', (req, res) => {
    const { name, password } = req.body;
    
    console.log(`🔐 Login attempt for: ${name}`);
    
    db.query('SELECT * FROM users WHERE name = ? OR email = ?', [name, name], async (err, results) => {
        if (err) {
            console.error('Login DB error:', err);
            return res.status(500).json({ error: 'Database error' });
        }
        
        if (results.length === 0) {
            console.log('❌ No user found:', name);
            return res.status(401).json({ error: 'User not found' });
        }
        
        const user = results[0];
        console.log(`👤 Found user: ${user.name} (${user.role})`);
        
        const isMatch = await bcrypt.compare(password, user.password);
        
        if (!isMatch) {
            console.log('❌ Password mismatch:', user.name);
            return res.status(401).json({ error: 'Invalid password' });
        }
        
        const token = jwt.sign(
            { 
                id: user.id, 
                name: user.name, 
                email: user.email, 
                role: user.role 
            },
            JWT_SECRET,
            { expiresIn: '24h' }
        );
        
        console.log(`✅ ${user.role.toUpperCase()} login: ${user.name}`);
        
        res.json({
            token,
            user: { 
                id: user.id, 
                name: user.name, 
                email: user.email, 
                role: user.role 
            }
        });
    });
});

// Register (matches your table exactly)
app.post('/api/register', async (req, res) => {
    try {
        const { name, email, password, phone, address } = req.body;
        const hashedPassword = await bcrypt.hash(password, 10);
        
        db.query(
            'INSERT INTO users (name, email, password, phone, address, role, created_at) VALUES (?, ?, ?, ?, ?, "customer", NOW())',
            [name, email, hashedPassword, phone || null, address || null],
            (err, result) => {
                if (err) {
                    console.error('Register error:', err);
                    if (err.code === 'ER_DUP_ENTRY') {
                        return res.status(400).json({ error: 'Email already exists' });
                    }
                    return res.status(500).json({ error: 'Registration failed' });
                }
                console.log(`🆕 New customer registered: ${name}`);
                res.status(201).json({ message: 'Registered successfully' });
            }
        );
    } catch (error) {
        console.error('Register exception:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== USER PROFILE ====================
app.get('/api/profile', authenticateToken, (req, res) => {
    db.query(
        'SELECT id, name, email, phone, address, role FROM users WHERE id = ?', 
        [req.user.id], 
        (err, results) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(results[0]);
        }
    );
});

app.put('/api/profile', authenticateToken, (req, res) => {
    const { phone, address } = req.body;
    db.query(
        'UPDATE users SET phone = ?, address = ? WHERE id = ?',
        [phone || null, address || null, req.user.id],
        (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: 'Profile updated' });
        }
    );
});

// Change password
app.put('/api/change-password', authenticateToken, async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    
    db.query('SELECT password FROM users WHERE id = ?', [req.user.id], async (err, results) => {
        if (err || !results.length) return res.status(500).json({ error: 'User not found' });
        
        const isMatch = await bcrypt.compare(currentPassword, results[0].password);
        if (!isMatch) return res.status(400).json({ error: 'Current password incorrect' });
        
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        db.query('UPDATE users SET password = ? WHERE id = ?', [hashedPassword, req.user.id], (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: 'Password changed successfully' });
        });
    });
});

// ==================== MENU MANAGEMENT ====================
app.get('/api/menu', (req, res) => {
    db.query(
        'SELECT id, name, description, price, image_url, category, is_available FROM menu_items WHERE is_available = 1 ORDER BY created_at DESC',
        (err, results) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(results);
        }
    );
});

// Admin menu management
app.get('/api/admin/menu', authenticateToken, isAdmin, (req, res) => {
    db.query('SELECT * FROM menu_items ORDER BY created_at DESC', (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

app.post('/api/admin/menu', authenticateToken, isAdmin, upload.single('image'), (req, res) => {
    const { name, description, price, category } = req.body;
    const image_url = req.file ? req.file.filename : null;
    
    db.query(
        'INSERT INTO menu_items (name, description, price, image_url, category, is_available, created_at) VALUES (?, ?, ?, ?, ?, 1, NOW())',
        [name, description, price, image_url, category],
        (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.status(201).json({ message: 'Menu item created' });
        }
    );
});

app.put('/api/admin/menu/:id', authenticateToken, isAdmin, upload.single('image'), (req, res) => {
    const { id } = req.params;
    const { name, description, price, category, is_available } = req.body;
    const image_url = req.file ? req.file.filename : req.body.image_url;
    
    const query = `
        UPDATE menu_items 
        SET name = ?, description = ?, price = ?, image_url = ?, category = ?, is_available = ? 
        WHERE id = ?
    `;
    
    db.query(query, [name, description, price, image_url, category, is_available, id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Menu item updated' });
    });
});

app.delete('/api/admin/menu/:id', authenticateToken, isAdmin, (req, res) => {
    const { id } = req.params;
    db.query('DELETE FROM menu_items WHERE id = ?', [id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Menu item deleted' });
    });
});

// ==================== ORDERS ====================
app.post('/api/orders', authenticateToken, (req, res) => {
    const { items, total_amount, phone, address } = req.body;
    
    db.query(
        'INSERT INTO orders (user_id, customer_name, customer_phone, customer_address, total_amount, items, status, created_at) VALUES (?, ?, ?, ?, ?, ?, "pending", NOW())',
        [req.user.id, req.user.name, phone, address, total_amount, JSON.stringify(items)],
        (err, result) => {
            if (err) return res.status(500).json({ error: err.message });
            res.status(201).json({ 
                orderId: result.insertId,
                order_number: `ORD-${String(result.insertId).padStart(6, '0')}`,
                message: 'Order placed successfully'
            });
        }
    );
});

app.get('/api/orders', authenticateToken, (req, res) => {
    db.query(
        'SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC',
        [req.user.id],
        (err, results) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(results);
        }
    );
});

app.get('/api/admin/orders', authenticateToken, isAdmin, (req, res) => {
    db.query(
        'SELECT o.*, u.name as customer_name FROM orders o JOIN users u ON o.user_id = u.id ORDER BY o.created_at DESC',
        (err, results) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(results);
        }
    );
});

app.put('/api/admin/orders/:id/status', authenticateToken, isAdmin, (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    db.query('UPDATE orders SET status = ? WHERE id = ?', [status, id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Order status updated' });
    });
});

// Admin users list
app.get('/api/admin/users', authenticateToken, isAdmin, (req, res) => {
    db.query(
        'SELECT id, name, email, phone, role, created_at FROM users ORDER BY created_at DESC',
        (err, results) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(results);
        }
    );
});

// Logout (clear token client-side)
app.post('/api/logout', (req, res) => {
    res.json({ message: 'Logged out successfully' });
});

// ==================== SERVER START ====================
app.listen(PORT, () => {
    console.log(`\n🚀 Hulyanas Hill Server running on http://localhost:${PORT}`);
    console.log(`📱 Public APIs: /api/login, /api/menu, /api/register`);
    console.log(`🔐 Admin APIs: /api/admin/stats, /api/admin/orders, /api/admin/users`);
    console.log(`👤 Demo Admin: admin@hulyanas.com / admin123`);
    console.log(`\n`);
});