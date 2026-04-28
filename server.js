const express = require('express');
const mysql = require('mysql2');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const fs = require('fs');

const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));
app.use('/user', express.static('user'));
app.use('/admin', express.static('admin'));

// MySQL Connection
require('dotenv').config();

const db = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
}); 

db.connect(err => {
    if (err) throw err;
    console.log('MySQL Connected...');
});

// JWT Secret
const JWT_SECRET = 'hulyanas_secret_key_2024';

// Multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'public/images/');
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + '-' + file.originalname);
    }
});
const upload = multer({ storage });

// Auth middleware
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Access token required' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'Invalid token' });
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

// Routes

// Register
app.post('/api/register', async (req, res) => {
    try {
        const { username, email, password, full_name, phone, address } = req.body;
        const hashedPassword = await bcrypt.hash(password, 10);
        
        db.query('INSERT INTO users (username, email, password, full_name, phone, address) VALUES (?, ?, ?, ?, ?, ?)',
            [username, email, hashedPassword, full_name, phone, address],
            (err, result) => {
                if (err) {
                    if (err.code === 'ER_DUP_ENTRY') {
                        return res.status(400).json({ error: 'Username or email already exists' });
                    }
                    return res.status(500).json({ error: err.message });
                }
                res.status(201).json({ message: 'User registered successfully' });
            }
        );
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Login
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    
    db.query('SELECT * FROM users WHERE username = ? OR email = ?', [username, username], async (err, results) => {
        if (err || results.length === 0) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        const user = results[0];
        const isMatch = await bcrypt.compare(password, user.password);
        
        if (!isMatch) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        const token = jwt.sign(
            { id: user.id, username: user.username, role: user.role },
            JWT_SECRET,
            { expiresIn: '24h' }
        );
        
        res.json({
            token,
            user: { id: user.id, username: user.username, role: user.role, full_name: user.full_name }
        });
    });
});

// Get user profile
app.get('/api/profile', authenticateToken, (req, res) => {
    db.query('SELECT id, username, email, full_name, phone, address FROM users WHERE id = ?', [req.user.id], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results[0]);
    });
});

// Update profile
app.put('/api/profile', authenticateToken, (req, res) => {
    const { full_name, phone, address } = req.body;
    db.query('UPDATE users SET full_name = ?, phone = ?, address = ? WHERE id = ?',
        [full_name, phone, address, req.user.id],
        (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: 'Profile updated successfully' });
        }
    );
});

// Change password
app.put('/api/change-password', authenticateToken, async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    
    db.query('SELECT password FROM users WHERE id = ?', [req.user.id], async (err, results) => {
        if (err || !results.length) return res.status(500).json({ error: 'User not found' });
        
        const isMatch = await bcrypt.compare(currentPassword, results[0].password);
        if (!isMatch) return res.status(400).json({ error: 'Current password is incorrect' });
        
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        
        db.query('UPDATE users SET password = ? WHERE id = ?', [hashedPassword, req.user.id], (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: 'Password changed successfully' });
        });
    });
});

// Delete account
app.delete('/api/delete-account', authenticateToken, (req, res) => {
    db.query('DELETE FROM users WHERE id = ?', [req.user.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Account deleted successfully' });
    });
});

// Menu items
app.get('/api/menu', (req, res) => {
    db.query('SELECT * FROM menu_items WHERE status = "available" ORDER BY created_at DESC', (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

// Admin: Manage menu items
app.get('/api/admin/menu', authenticateToken, isAdmin, (req, res) => {
    db.query('SELECT * FROM menu_items ORDER BY created_at DESC', (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

app.post('/api/admin/menu', authenticateToken, isAdmin, upload.single('image'), (req, res) => {
    const { name, description, price, category } = req.body;
    const image = req.file ? req.file.filename : null;
    
    db.query('INSERT INTO menu_items (name, description, price, image, category) VALUES (?, ?, ?, ?, ?)',
        [name, description, price, image, category],
        (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.status(201).json({ message: 'Menu item added successfully' });
        }
    );
});

app.put('/api/admin/menu/:id', authenticateToken, isAdmin, upload.single('image'), (req, res) => {
    const { id } = req.params;
    const { name, description, price, category, status } = req.body;
    const image = req.file ? req.file.filename : null;
    
    let query = 'UPDATE menu_items SET name = ?, description = ?, price = ?, category = ?, status = ?';
    let params = [name, description, price, category, status];
    
    if (image) {
        query += ', image = ?';
        params.push(image);
    }
    params.push(id);
    
    db.query(query, params, (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Menu item updated successfully' });
    });
});

app.delete('/api/admin/menu/:id', authenticateToken, isAdmin, (req, res) => {
    const { id } = req.params;
    db.query('DELETE FROM menu_items WHERE id = ?', [id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Menu item deleted successfully' });
    });
});

// Orders
app.post('/api/orders', authenticateToken, (req, res) => {
    const { cartItems, delivery_address, phone, total_amount } = req.body;
    
    db.query('INSERT INTO orders (user_id, total_amount, delivery_address, phone) VALUES (?, ?, ?, ?)',
        [req.user.id, total_amount, delivery_address, phone],
        (err, result) => {
            if (err) return res.status(500).json({ error: err.message });
            
            const orderId = result.insertId;
            const orderItems = cartItems.map(item => [
                orderId,
                item.id,
                item.quantity,
                item.price
            ]);
            
            db.query('INSERT INTO order_items (order_id, menu_item_id, quantity, price) VALUES ?', [orderItems], (err) => {
                if (err) return res.status(500).json({ error: err.message });
                res.status(201).json({ orderId, message: 'Order placed successfully' });
            });
        }
    );
});

app.get('/api/orders', authenticateToken, (req, res) => {
    db.query(`
        SELECT o.*, COUNT(oi.id) as items_count 
        FROM orders o 
        LEFT JOIN order_items oi ON o.id = oi.order_id 
        WHERE o.user_id = ? 
        GROUP BY o.id 
        ORDER BY o.created_at DESC
    `, [req.user.id], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

app.get('/api/orders/:id', authenticateToken, (req, res) => {
    const { id } = req.params;
    db.query(`
        SELECT o.*, oi.quantity, oi.price, mi.name, mi.image as item_image 
        FROM orders o 
        JOIN order_items oi ON o.id = oi.order_id 
        JOIN menu_items mi ON oi.menu_item_id = mi.id 
        WHERE o.id = ? AND o.user_id = ?
    `, [id, req.user.id], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

// Admin: View all orders
app.get('/api/admin/orders', authenticateToken, isAdmin, (req, res) => {
    db.query(`
        SELECT o.*, u.username, u.full_name 
        FROM orders o 
        JOIN users u ON o.user_id = u.id 
        ORDER BY o.created_at DESC
    `, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

app.put('/api/admin/orders/:id/status', authenticateToken, isAdmin, (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    db.query('UPDATE orders SET status = ? WHERE id = ?', [status, id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Order status updated' });
    });
});

// Admin: View users
app.get('/api/admin/users', authenticateToken, isAdmin, (req, res) => {
    db.query('SELECT id, username, email, full_name, phone, role, created_at FROM users ORDER BY created_at DESC', (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
