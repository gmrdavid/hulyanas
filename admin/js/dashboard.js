// ===============================
// GLOBAL VARIABLES
// ===============================

let allOrders = [];

let currentPage = 1;
let totalPages = 1;
let currentActivityPage = 1;
let totalActivityPages = 1;

// ===============================
// ANIMATE COUNTERS
// ===============================

function animateCounters(data) {

    const menuEl = document.getElementById('menuCount');
    const orderEl = document.getElementById('orderCount');
    const revenueEl = document.getElementById('revenueCount');
    const userEl = document.getElementById('userCount');

    [menuEl, orderEl, userEl].forEach((el, i) => {

        const targets = [
            data.menuItems,
            data.totalOrders,
            data.totalUsers
        ];

        let current = 0;
        const target = targets[i];
        const increment = target / 50;

        const timer = setInterval(() => {

            current += increment;

            if (current >= target) {
                el.textContent = Math.floor(target).toLocaleString();
                clearInterval(timer);
                return;
            }

            el.textContent = Math.floor(current).toLocaleString();

        }, 20);
    });

    // Revenue animation

    let currentRev = 0;
    const targetRev = data.revenue;
    const revIncrement = targetRev / 50;

    const revTimer = setInterval(() => {

        currentRev += revIncrement;

        if (currentRev >= targetRev) {

            revenueEl.textContent =
                `₱${targetRev.toLocaleString(undefined, {
                    minimumFractionDigits: 0,
                    maximumFractionDigits: 0
                })}`;

            clearInterval(revTimer);
            return;
        }

        revenueEl.textContent =
            `₱${Math.floor(currentRev).toLocaleString()}`;

    }, 20);
}


// ===============================
// LOAD ADMIN STATS
// ===============================

async function loadAdminStats() {

    try {

        const token = localStorage.getItem('token');

        const response = await fetch('/api/admin/stats', {
            headers: {
                Authorization: `Bearer ${token}`
            }
        });

        const data = await response.json();

        document.getElementById('menuCount')
            .setAttribute('data-target', data.menuItems);

        document.getElementById('orderCount')
            .setAttribute('data-target', data.totalOrders);

        document.getElementById('revenueCount')
            .setAttribute('data-target', data.revenue);

        document.getElementById('userCount')
            .setAttribute('data-target', data.totalUsers);

        animateCounters(data);

        console.log('✅ Stats loaded:', data);

    } catch (error) {

        console.error('Stats error:', error);
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
            {
                headers: {
                    Authorization: `Bearer ${token}`
                }
            }
        );

        const data = await response.json();

        const orders = data.orders || [];

        currentPage = data.currentPage;
        totalPages = data.totalPages;

        renderRecentOrders(orders);

        document.getElementById('pageInfo').textContent =
            `Page ${currentPage} of ${totalPages}`;

        document.getElementById('prevPageBtn').disabled =
            currentPage === 1;

        document.getElementById('nextPageBtn').disabled =
            currentPage === totalPages;

    } catch (error) {
        console.error(error);
    }
}

function renderRecentOrders(orders) {

    const tbody = document.getElementById('recentOrders');

    if (!orders.length) {

        tbody.innerHTML = `
            <tr>
                <td colspan="5"
                    style="text-align:center;padding:3rem;">
                    No orders found
                </td>
            </tr>
        `;

        return;
    }

    tbody.innerHTML = orders.map(order => `

        <tr>

            <td>
                <strong>
                    #${order.order_number || 'N/A'}
                </strong>
            </td>

            <td>
                ${order.customer_name || 'Unknown'}
            </td>

            <td>
                <span class="order-status status-${order.status}">
                    ${(order.status || 'unknown')
                        .replace(/_/g, ' ')}
                </span>
            </td>

            <td>
                <strong>
                    ₱${Number(order.total_amount || 0).toFixed(2)}
                </strong>
            </td>

            <td>
                ${order.time_ago || 'N/A'}
            </td>

        </tr>

    `).join('');
}


// ===============================
// FILTER BY STATUS
// ===============================

function filterOrdersByStatus(status) {

    if (!Array.isArray(allOrders)) return;

    if (!status || status.toLowerCase() === 'all') {
        renderRecentOrders(allOrders);
        return;
    }

    const filtered = allOrders.filter(order =>
        (order.status || '')
        .toLowerCase()
        .trim() === status.toLowerCase()
    );

    renderRecentOrders(filtered);

    // 🔥 FIX UI
    document.getElementById('pageInfo').textContent =
        `Filtered results (${filtered.length})`;

    document.getElementById('prevPageBtn').disabled = true;
    document.getElementById('nextPageBtn').disabled = true;
}


// ===============================
// LOAD ACTIVITY FEED
// ===============================

async function loadActivityFeed(page = 1) {

    try {

        const token = localStorage.getItem('token');

        const response = await fetch(
            `/api/admin/activity?page=${page}`,
            {
                headers: {
                    Authorization: `Bearer ${token}`
                }
            }
        );

        const data = await response.json();

        const activities = data.activities || [];

        currentActivityPage = data.currentPage || 1;
        totalActivityPages = data.totalPages || 1;

        const feed = document.getElementById('activityFeed');

        if (!activities.length) {
            feed.innerHTML = `<div style="text-align:center;padding:2rem;color:#999;">No recent activity</div>`;
            return;
        }

        feed.innerHTML = activities.map(activity => `
            <div class="activity-item">

                <div class="activity-icon ${activity.type}">
                    <i class="fas fa-${
                        activity.type === 'order'
                        ? 'shopping-cart'
                        : activity.type === 'user'
                        ? 'user-plus'
                        : activity.type
                    }"></i>
                </div>

                <div class="activity-content">
                    <h4>${activity.message}</h4>
                    <p>${activity.time}</p>
                </div>

            </div>
        `).join('');

        // update pagination UI
        document.getElementById('activityPageInfo').textContent =
            `Page ${currentActivityPage} of ${totalActivityPages}`;

        document.getElementById('prevActivityBtn').disabled =
            currentActivityPage === 1;

        document.getElementById('nextActivityBtn').disabled =
            currentActivityPage === totalActivityPages;

        console.log('✅ Activity loaded:', activities.length);

    } catch (error) {

        console.error('Activity error:', error);

        document.getElementById('activityFeed').innerHTML = `
            <div style="text-align:center;padding:2rem;color:#666;">
                Failed to load activity feed
            </div>
        `;
    }
}


// ===============================
// TOAST NOTIFICATION
// ===============================

function showToast(message) {

    const toast = document.createElement('div');

    toast.style.cssText = `
        position:fixed;
        top:20px;
        right:20px;
        background:#d4edda;
        color:#155724;
        padding:1rem 2rem;
        border-radius:12px;
        box-shadow:0 10px 30px rgba(0,0,0,0.1);
        z-index:3000;
        transform:translateX(400px);
        transition:all 0.3s ease;
        font-weight:500;
    `;

    toast.textContent = message;

    document.body.appendChild(toast);

    setTimeout(() => {
        toast.style.transform = 'translateX(0)';
    }, 100);

    setTimeout(() => {
        toast.remove();
    }, 3000);
}


// ===============================
// NAVBAR SCROLL EFFECT
// ===============================

window.addEventListener('scroll', () => {

    const navbar =
        document.querySelector('.navbar');

    navbar.style.background =
        window.scrollY > 50
        ? 'rgba(255,255,255,1)'
        : 'rgba(255,255,255,0.98)';
});


// ===============================
// LOGOUT HANDLER
// ===============================

document.getElementById('logoutBtn')
.addEventListener('click', (e) => {

    e.preventDefault();

    if (confirm('Are you sure you want to logout?')) {

        localStorage.removeItem('token');

        window.location.href = '/index.html';
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

                headers: {
                    'Content-Type': 'application/json'
                },

                body: JSON.stringify({
                    username: 'admin',
                    password: 'password'
                })
            });

            const loginData = await loginRes.json();

            localStorage.setItem(
                'token',
                loginData.token
            );

            console.log('✅ Auto-login successful');

        } catch (e) {

            console.log('ℹ️ No auto-login available');
        }
    }

    // LOAD DASHBOARD DATA

    document.body.classList.add('loading');

    await Promise.all([
        loadAdminStats(),
        loadRecentOrders(),
        loadActivityFeed()
    ]);

    document.body.classList.remove('loading');

    console.log('✅ Dashboard fully loaded! ✨');

    // FILTER EVENT

    const filter =
        document.getElementById('statusFilter');

    if (filter) {

        filter.addEventListener('change', (e) => {

            filterOrdersByStatus(e.target.value);
        });
    }

    // PREVIOUS BUTTON

        document.getElementById('prevPageBtn')
        .addEventListener('click', () => {

            if (currentPage > 1) {

                loadRecentOrders(currentPage - 1);
            }
        });

    // NEXT BUTTON

   document.getElementById('nextPageBtn')
    .addEventListener('click', () => {

        if (currentPage < totalPages) {

            loadRecentOrders(currentPage + 1);
        }
    });

    document.getElementById('prevActivityBtn')
    .addEventListener('click', () => {
        if (currentActivityPage > 1) {
            loadActivityFeed(currentActivityPage - 1);
        }
    });

    document.getElementById('nextActivityBtn')
    .addEventListener('click', () => {
        if (currentActivityPage < totalActivityPages) {
            loadActivityFeed(currentActivityPage + 1);
        }
    });
});