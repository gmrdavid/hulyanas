const express = require('express');
const mysql = require('mysql2/promise'); // Use promise version for better async/await
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const fs = require('fs').promises;

const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));
app.use('/user', express.static('user'));
app.use('/admin', express.static('admin'));

// MySQL Connection Pool (better than single connection)
const dbConfig = {
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'hulyanas',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
};

// JWT Secret
const JWT_SECRET = 'hulyanas_secret_key_2024_secure_change_this';

// Multer for file uploads
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
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Only image files are allowed'), false);
        }
    }
});

// Auth middleware
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
        return res.status(403).json({ error: 'Invalid token' });
    }
};

const isAdmin = (req, res, next) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }
    next();
};

// Create connection pool
const pool = mysql.createPool(dbConfig);

// Test connection
pool.getConnection().then(conn => {
    console.log('MySQL Connected...');
    conn.release();
}).catch(err => {
    console.error('Database connection failed:', err);
});

// Routes

// Register (Customer only)
app.post('/api/register', async (req, res) => {
    try {
        const { username, email, password, first_name, last_name, phone } = req.body;
        
        const hashedPassword = await bcrypt.hash(password, 12);
        const connection = await pool.getConnection();
        
        try {
            await connection.beginTransaction();
            
            const [result] = await connection.execute(
                'INSERT INTO users (username, email, password_hash, first_name, last_name, phone, role) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [username, email, hashedPassword, first_name, last_name, phone, 'customer']
            );
            
            await connection.commit();
            res.status(201).json({ message: 'User registered successfully' });
        } catch (err) {
            await connection.rollback();
            if (err.code === 'ER_DUP_ENTRY') {
                return res.status(400).json({ error: 'Username or email already exists' });
            }
            throw err;
        } finally {
            connection.release();
        }
    } catch (error) {
        console.error('Register error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Login
app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        const connection = await pool.getConnection();
        const [rows] = await connection.execute(
            'SELECT id, username, email, password_hash as password, role, first_name, last_name FROM users WHERE username = ? OR email = ?',
            [username, username]
        );
        connection.release();
        
        if (rows.length === 0) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        const user = rows[0];
        const isMatch = await bcrypt.compare(password, user.password);
        
        if (!isMatch) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        const token = jwt.sign(
            { 
                id: user.id, 
                username: user.username, 
                role: user.role,
                full_name: `${user.first_name} ${user.last_name}`
            },
            JWT_SECRET,
            { expiresIn: '24h' }
        );
        
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
        console.error('Login error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Get user profile
app.get('/api/profile', authenticateToken, async (req, res) => {
    try {
        const connection = await pool.getConnection();
        const [rows] = await connection.execute(
            'SELECT id, username, email, first_name, last_name, phone FROM users WHERE id = ?',
            [req.user.id]
        );
        connection.release();
        
        if (rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        res.json({
            ...rows[0],
            full_name: `${rows[0].first_name} ${rows[0].last_name}`
        });
    } catch (error) {
        console.error('Profile error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Update profile
app.put('/api/profile', authenticateToken, async (req, res) => {
    try {
        const { first_name, last_name, phone } = req.body;
        
        const connection = await pool.getConnection();
        await connection.execute(
            'UPDATE users SET first_name = ?, last_name = ?, phone = ? WHERE id = ?',
            [first_name, last_name, phone, req.user.id]
        );
        connection.release();
        
        res.json({ message: 'Profile updated successfully' });
    } catch (error) {
        console.error('Profile update error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Dashboard Stats (Admin only)
app.get('/api/admin/stats', authenticateToken, isAdmin, async (req, res) => {
    try {
        const connection = await pool.getConnection();
        
        const [
            [menuItems],
            [totalOrders],
            [revenue],
            [totalUsers]
        ] = await Promise.all([
            connection.execute('SELECT COUNT(*) as count FROM menu_items WHERE is_available = TRUE'),
            connection.execute('SELECT COUNT(*) as count FROM orders'),
            connection.execute('SELECT COALESCE(SUM(total_amount), 0) as revenue FROM orders WHERE status != "cancelled"'),
            connection.execute('SELECT COUNT(*) as count FROM users WHERE role = "customer"')
        ]);
        
        connection.release();
        
        res.json({
            menuItems: menuItems[0].count,
            totalOrders: totalOrders[0].count,
            revenue: parseFloat(revenue[0].revenue).toFixed(2),
            totalUsers: totalUsers[0].count
        });
    } catch (error) {
        console.error('Stats error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Recent Orders (Admin dashboard)
app.get('/api/admin/recent-orders', authenticateToken, isAdmin, async (req, res) => {
    try {
        const connection = await pool.getConnection();
        const [rows] = await connection.execute(`
            SELECT 
                o.id,
                CONCAT('#ORD-', LPAD(o.id, 6, '0')) as order_number,
                CONCAT(u.first_name, ' ', u.last_name) as customer,
                o.status,
                o.total_amount,
                CASE 
                    WHEN TIMESTAMPDIFF(HOUR, o.created_at, NOW()) < 1 THEN 
                        CONCAT(TIMESTAMPDIFF(MINUTE, o.created_at, NOW()), ' min ago')
                    WHEN TIMESTAMPDIFF(DAY, o.created_at, NOW()) < 1 THEN 
                        CONCAT(TIMESTAMPDIFF(HOUR, o.created_at, NOW()), ' hr ago')
                    ELSE 
                        DATE_FORMAT(o.created_at, '%b %d')
                END as time_ago
            FROM orders o
            JOIN users u ON o.user_id = u.id
            ORDER BY o.created_at DESC 
            LIMIT 10
        `);
        connection.release();
        res.json(rows);
    } catch (error) {
        console.error('Recent orders error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Activity Feed (Admin dashboard)
app.get('/api/admin/activity', authenticateToken, isAdmin, async (req, res) => {
    try {
        const connection = await pool.getConnection();
        const [rows] = await connection.execute(`
            SELECT 
                al.type,
                al.action as text,
                CASE 
                    WHEN TIMESTAMPDIFF(HOUR, al.created_at, NOW()) < 1 THEN 
                        CONCAT(TIMESTAMPDIFF(MINUTE, al.created_at, NOW()), ' min ago')
                    WHEN TIMESTAMPDIFF(DAY, al.created_at, NOW()) < 1 THEN 
                        CONCAT(TIMESTAMPDIFF(HOUR, al.created_at, NOW()), ' hr ago')
                    ELSE 
                        DATE_FORMAT(al.created_at, '%b %d')
                END as time_ago
            FROM activity_log al 
            ORDER BY al.created_at DESC 
            LIMIT 10
        `);
        connection.release();
        res.json(rows);
    } catch (error) {
        console.error('Activity error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Menu items (Public)
app.get('/api/menu', async (req, res) => {
    try {
        const connection = await pool.getConnection();
        const [rows] = await connection.execute(
            'SELECT * FROM menu_items WHERE is_available = TRUE ORDER BY category, name'
        );
        connection.release();
        res.json(rows);
    } catch (error) {
        console.error('Menu error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Admin: All menu items
app.get('/api/admin/menu', authenticateToken, isAdmin, async (req, res) => {
    try {
        const connection = await pool.getConnection();
        const [rows] = await connection.execute('SELECT * FROM menu_items ORDER BY created_at DESC');
        connection.release();
        res.json(rows);
    } catch (error) {
        console.error('Admin menu error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Admin: Add menu item
app.post('/api/admin/menu', authenticateToken, isAdmin, upload.single('image'), async (req, res) => {
    try {
        const { name, description, price, category } = req.body;
        const image_url = req.file ? `/images/${req.file.filename}` : null;
        
        const connection = await pool.getConnection();
        await connection.execute(
            'INSERT INTO menu_items (name, description, price, category, image_url, is_available) VALUES (?, ?, ?, ?, ?, TRUE)',
            [name, description, price, category, image_url]
        );
        connection.release();
        
        res.status(201).json({ message: 'Menu item added successfully' });
    } catch (error) {
        console.error('Add menu error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ... (Add other admin routes similarly)

app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
});