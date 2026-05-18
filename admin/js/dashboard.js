// ===============================
// GLOBAL VARIABLES
// ===============================

let allOrders = [];
let selectedStatus = 'all';
let currentPage = 1;
let totalPages = 1;
let currentActivityPage = 1;
let totalActivityPages = 1;

// ===============================
// UTILITY FUNCTIONS
// ===============================

function formatDate(dateString) {
    if (!dateString) return 'N/A';
    
    let date;
    
    // Handle MySQL datetime format (with T or space separator)
    if (typeof dateString === 'string') {
        // Replace space with T for ISO format compatibility
        const normalizedString = dateString.replace(' ', 'T');
        date = new Date(normalizedString);
    } else {
        date = new Date(dateString);
    }
    
    // Validate date
    if (isNaN(date.getTime())) {
        return 'Invalid Date';
    }
    
    return date.toLocaleString('en-PH', {
        year: 'numeric',
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
    });
}

// Relative time (e.g., "2 hours ago", "Just now")
function formatRelativeTime(dateInput) {
    if (!dateInput) return 'N/A';

    // 🚫 Reject already formatted strings
    if (typeof dateInput === 'string') {
        const lower = dateInput.toLowerCase();

        if (
            lower.includes('ago') ||
            lower.includes('just now') ||
            lower.includes('yesterday')
        ) {
            return dateInput; // already human readable
        }
    }

    let date;

    // Normalize MySQL format: "2026-05-19 10:30:00"
    if (typeof dateInput === 'string') {
        const normalized = dateInput
            .replace(' ', 'T')
            .replace(/\.\d+/, ''); // remove milliseconds if any

        date = new Date(normalized);
    } else {
        date = new Date(dateInput);
    }

    // ❌ HARD STOP if invalid
    if (!date || isNaN(date.getTime())) {
        console.warn('Invalid activity date:', dateInput);
        return 'Unknown time';
    }

    const now = new Date();
    const diffMs = now - date;

    const diffSecs = Math.floor(diffMs / 1000);
    const diffMins = Math.floor(diffSecs / 60);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffSecs < 60) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleString('en-PH', {
        year: 'numeric',
        month: 'short',
        day: '2-digit'
    });
}

function formatDateTime(value) {
    if (!value) return 'N/A';
    const date = new Date(value);
    if (isNaN(date.getTime())) return 'Invalid Date';
    return date.toLocaleString('en-PH', {
        year: 'numeric',
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
    });
}

// ===============================
// TOAST NOTIFICATION
// ===============================

function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    
    const colors = {
        success: { bg: '#d4edda', color: '#155724' },
        error: { bg: '#f8d7da', color: '#721c24' },
        info: { bg: '#d1ecf1', color: '#0c5460' }
    };
    
    const c = colors[type] || colors.success;
    
    toast.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: ${c.bg};
        color: ${c.color};
        padding: 1rem 2rem;
        border-radius: 12px;
        box-shadow: 0 10px 30px rgba(0,0,0,0.1);
        z-index: 3000;
        transform: translateX(400px);
        transition: all 0.3s ease;
        font-weight: 500;
        margin-top: 60px;
    `;

    toast.textContent = message;
    document.body.appendChild(toast);

    requestAnimationFrame(() => {
        toast.style.transform = 'translateX(0)';
    });

    setTimeout(() => {
        toast.style.transform = 'translateX(400px)';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// ===============================
// ANIMATE COUNTERS
// ===============================

function animateCounters(data) {
    const menuEl = document.getElementById('menuCount');
    const orderEl = document.getElementById('orderCount');
    const revenueEl = document.getElementById('revenueCount');
    const userEl = document.getElementById('userCount');

    // Handle missing elements safely
    if (!menuEl || !orderEl || !userEl) {
        console.warn('Counter elements not found');
        return;
    }

    const counters = [
        { el: menuEl, target: data.menuItems },
        { el: orderEl, target: data.totalOrders },
        { el: userEl, target: data.totalUsers }
    ];

    counters.forEach(({ el, target }) => {
        let current = 0;
        const increment = target / 50;

        const timer = setInterval(() => {
            current += increment;
            if (current >= target) {
                el.textContent = Math.floor(target).toLocaleString();
                clearInterval(timer);
            } else {
                el.textContent = Math.floor(current).toLocaleString();
            }
        }, 20);
    });

    // Revenue animation
    if (revenueEl) {
        let currentRev = 0;
        const targetRev = Number(data.revenue) || 0;
        const revIncrement = targetRev / 50;

        const revTimer = setInterval(() => {
            currentRev += revIncrement;
            if (currentRev >= targetRev) {
                revenueEl.textContent = `₱${targetRev.toLocaleString('en-PH', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2
                })}`;
                clearInterval(revTimer);
            } else {
                revenueEl.textContent = `₱${currentRev.toLocaleString('en-PH', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2
                })}`;
            }
        }, 20);
    }
}

// ===============================
// LOAD ADMIN STATS
// ===============================

async function loadAdminStats() {
    try {
        const token = localStorage.getItem('token');
        
        const response = await fetch('/api/admin/stats', {
            headers: { Authorization: `Bearer ${token}` }
        });

        if (!response.ok) throw new Error('Failed to load stats');

        const data = await response.json();

        ['menuCount', 'orderCount', 'revenueCount', 'userCount'].forEach((id, index) => {
            const el = document.getElementById(id);
            if (el) {
                const values = [data.menuItems, data.totalOrders, data.revenue, data.totalUsers];
                el.setAttribute('data-target', values[index]);
            }
        });

        animateCounters(data);
        console.log('✅ Stats loaded:', data);

    } catch (error) {
        console.error('❌ Stats error:', error);
        showToast('Failed to load statistics', 'error');
    }
}

// ===============================
// LOAD RECENT ORDERS
// ===============================

async function loadRecentOrders(page = 1) {
    try {
        const token = localStorage.getItem('token');

        const response = await fetch(
            `/api/admin/recent-orders?page=${page}&status=${selectedStatus}`,
            { headers: { Authorization: `Bearer ${token}` } }
        );

        if (!response.ok) throw new Error('Failed to load orders');

        const data = await response.json();

        console.log("API RESPONSE:", data);

        const orders = data.orders || [];
        allOrders = orders;
        currentPage = data.currentPage || 1;
        totalPages = data.totalPages || 1;

        renderRecentOrders(orders);
        updateOrderPagination();

    } catch (error) {
        console.error('❌ Orders error:', error);
        showToast('Failed to load orders', 'error');
        
        // Show error state in table
        const tbody = document.getElementById('recentOrders');
        if (tbody) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="5" style="text-align:center;padding:3rem;color:#dc3545;">
                        Failed to load orders. Please refresh.
                    </td>
                </tr>
            `;
        }
    }
}

function updateOrderPagination() {
    const pageInfo = document.getElementById('pageInfo');
    const prevBtn = document.getElementById('prevPageBtn');
    const nextBtn = document.getElementById('nextPageBtn');

    if (pageInfo) {
        pageInfo.textContent = `Page ${currentPage} of ${totalPages}`;
    }
    if (prevBtn) prevBtn.disabled = currentPage === 1;
    if (nextBtn) nextBtn.disabled = currentPage === totalPages;
}

function renderRecentOrders(orders) {
    const tbody = document.getElementById('recentOrders');

    if (!tbody) return;

    if (!orders.length) {
        tbody.innerHTML = `
            <tr>
                <td colspan="5" style="text-align:center;padding:3rem;">
                    No orders found
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = orders.map(order => `
        <tr>
            <td><strong>#${order.order_number || 'N/A'}</strong></td>
            <td>${order.customer_name || 'Unknown'}</td>
            <td>
                <span class="order-status status-${order.status}">
                    ${(order.status || 'unknown').replace(/_/g, ' ')}
                </span>
            </td>
            <td><strong>₱${Number(order.total_amount || 0).toFixed(2)}</strong></td>
            <td>${formatDate(order.created_at)}</td>
        </tr>
    `).join('');
}

// ===============================
// FILTER BY STATUS
// ===============================

function filterOrdersByStatus(status) {
    selectedStatus = status;
    loadRecentOrders(1);
}

// ===============================
// GET ACTIVITY ICON
// ===============================

function getActivityIcon(type) {
    const icons = {
        order: 'shopping-cart',
        user: 'user-plus',
        login: 'sign-in-alt',
        logout: 'sign-out-alt',
        register: 'user-plus',
        signup: 'user-plus',
        menu: 'utensils',
        product: 'box'
    };
    return icons[type] || 'circle';
}

// ===============================
// LOAD ACTIVITY FEED (FIXED)
// ===============================

async function loadActivityFeed(page = 1) {
    try {
        const token = localStorage.getItem('token');

        const response = await fetch(`/api/admin/activity?page=${page}`, {
            headers: { Authorization: `Bearer ${token}` }
        });

        if (!response.ok) throw new Error('Failed to load activity');

        const data = await response.json();
        const activities = data.activities || [];

        // Debug: Log raw activity data
        console.log('📋 Raw activities:', activities);

        currentActivityPage = data.currentPage || 1;
        totalActivityPages = data.totalPages || 1;

        const feed = document.getElementById('activityFeed');

        if (!feed) return;

        if (!activities.length) {
            feed.innerHTML = `
                <div style="text-align:center;padding:2rem;color:#999;">
                    No recent activity
                </div>
            `;
        } else {
            feed.innerHTML = activities.map(activity => {
                // Try different date fields
                const rawDate =
                    activity.created_at ??
                    activity.createdAt ??
                    activity.timestamp ??
                    activity.time ??
                    activity.date;
                
                return `
                    <div class="activity-item">
                        <div class="activity-icon ${activity.type}">
                            <i class="fas fa-${getActivityIcon(activity.type)}"></i>
                        </div>
                        <div class="activity-content">
                            <h4>${activity.message}</h4>
                            <p class="activity-time">${formatDate(rawDate)}</p>
                        </div>
                    </div>
                `;
            }).join('');
        }

        updateActivityPagination();
        console.log('✅ Activity loaded:', activities.length);

    } catch (error) {
        console.error('❌ Activity error:', error);
        
        const feed = document.getElementById('activityFeed');
        if (feed) {
            feed.innerHTML = `
                <div style="text-align:center;padding:2rem;color:#dc3545;">
                    Failed to load activity feed
                </div>
            `;
        }
    }
}

function updateActivityPagination() {
    const pageInfo = document.getElementById('activityPageInfo');
    const prevBtn = document.getElementById('prevActivityBtn');
    const nextBtn = document.getElementById('nextActivityBtn');

    if (pageInfo) {
        pageInfo.textContent = `Page ${currentActivityPage} of ${totalActivityPages}`;
    }
    if (prevBtn) prevBtn.disabled = currentActivityPage === 1;
    if (nextBtn) nextBtn.disabled = currentActivityPage === totalActivityPages;
}

// ===============================
// NAVBAR SCROLL EFFECT
// ===============================

window.addEventListener('scroll', () => {
    const navbar = document.querySelector('.navbar');
    if (navbar) {
        navbar.style.background = window.scrollY > 50
            ? 'rgba(255,255,255,1)'
            : 'rgba(255,255,255,0.98)';
    }
});

// ===============================
// LOGOUT HANDLER
// ===============================

const logoutBtn = document.getElementById('logoutBtn');
if (logoutBtn) {
    logoutBtn.addEventListener('click', (e) => {
        e.preventDefault();
        if (confirm('Are you sure you want to logout?')) {
            localStorage.removeItem('token');
            window.location.href = '/index.html';
        }
    });
}

// ===============================
// REFRESH DATA
// ===============================

async function refreshAllData() {
    document.body.classList.add('loading');
    try {
        await Promise.all([
            loadAdminStats(),
            loadRecentOrders(currentPage),
            loadActivityFeed(currentActivityPage)
        ]);
        showToast('Data refreshed successfully!', 'success');
    } catch (error) {
        showToast('Failed to refresh data', 'error');
    } finally {
        document.body.classList.remove('loading');
    }
}

// Auto-refresh every 60 seconds
setInterval(refreshAllData, 60000);

// ===============================
// PAGINATION HANDLERS
// ===============================

function setupPaginationHandlers() {
    const prevBtn = document.getElementById('prevPageBtn');
    const nextBtn = document.getElementById('nextPageBtn');
    const prevActivityBtn = document.getElementById('prevActivityBtn');
    const nextActivityBtn = document.getElementById('nextActivityBtn');

    if (prevBtn) {
        prevBtn.addEventListener('click', () => {
            if (currentPage > 1) loadRecentOrders(currentPage - 1);
        });
    }

    if (nextBtn) {
        nextBtn.addEventListener('click', () => {
            if (currentPage < totalPages) loadRecentOrders(currentPage + 1);
        });
    }

    if (prevActivityBtn) {
        prevActivityBtn.addEventListener('click', () => {
            if (currentActivityPage > 1) {
                loadActivityFeed(currentActivityPage - 1);
            }
        });
    }

    if (nextActivityBtn) {
        nextActivityBtn.addEventListener('click', () => {
            if (currentActivityPage < totalActivityPages) {
                loadActivityFeed(currentActivityPage + 1);
            }
        });
    }
}

// ===============================
// KEYBOARD SHORTCUTS
// ===============================

document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'r') {
        e.preventDefault();
        refreshAllData();
    }
});

// ===============================
// MAIN INITIALIZATION
// ===============================

document.addEventListener('DOMContentLoaded', async () => {
    console.log('🔥 Loading Hulyanas Admin Dashboard...');

    // AUTO LOGIN
    if (!localStorage.getItem('token')) {
        try {
            console.log('🔑 Attempting auto-login...');

            const loginRes = await fetch('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    username: 'admin',
                    password: 'password'
                })
            });

            const loginData = await loginRes.json();

            if (loginData.token) {
                localStorage.setItem('token', loginData.token);
                console.log('✅ Auto-login successful');
                showToast('Welcome back, Admin!', 'success');
            }

        } catch (e) {
            console.log('ℹ️ No auto-login available');
        }
    }

    // LOAD DASHBOARD DATA
    document.body.classList.add('loading');

    try {
        await Promise.all([
            loadAdminStats(),
            loadRecentOrders(),
            loadActivityFeed()
        ]);
        console.log('✅ Dashboard fully loaded! ✨');
    } catch (error) {
        console.error('Dashboard load failed:', error);
        showToast('Some data failed to load', 'error');
    } finally {
        document.body.classList.remove('loading');
    }

    // FILTER EVENT
    const filter = document.getElementById('statusFilter');
    if (filter) {
        filter.addEventListener('change', (e) => {
            filterOrdersByStatus(e.target.value);
        });
    }

    // SETUP PAGINATION
    setupPaginationHandlers();
});