// ===============================
// GLOBAL VARIABLES
// ===============================

let allOrders = [];
let filteredOrders = [];

let currentPage = 1;
const ordersPerPage = 10;


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
            `/api/admin/recent-orders?page=${page}`,
            {
                headers: {
                    Authorization: `Bearer ${token}`
                }
            }
        );

        const data = await response.json();

        allOrders = data.orders || [];

        renderRecentOrders(allOrders);

        // PAGE INFO
        document.getElementById('pageInfo').textContent =
            `Page ${data.currentPage} of ${data.totalPages}`;

        // BUTTON STATES
        document.getElementById('prevPageBtn').disabled =
            data.currentPage === 1;

        document.getElementById('nextPageBtn').disabled =
            data.currentPage === data.totalPages;

        // SAVE CURRENT PAGE
        currentPage = data.currentPage;

    } catch (error) {

        console.error('Orders error:', error);
    }
}


// ===============================
// RENDER RECENT ORDERS
// ===============================

function renderRecentOrders(orders) {

    filteredOrders = orders;

    const tbody = document.getElementById('recentOrders');

    if (!orders.length) {

        tbody.innerHTML = `
            <tr>
                <td colspan="5"
                    style="text-align:center;padding:3rem;color:#999;">
                    No orders found
                </td>
            </tr>
        `;

        document.getElementById('pageInfo').textContent =
            'Page 0';

        return;
    }

    // PAGINATION

    const start = (currentPage - 1) * ordersPerPage;
    const end = start + ordersPerPage;

    const paginatedOrders = orders.slice(start, end);

    tbody.innerHTML = paginatedOrders.map(order => `

        <tr data-order-id="${order.id}">

            <td>
                <strong>
                    #${order.order_number || 'N/A'}
                </strong>
            </td>

            <td>
                ${order.customer || 'Unknown'}
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

    // PAGE INFO

    const totalPages =
        Math.ceil(orders.length / ordersPerPage);

    document.getElementById('pageInfo').textContent =
        `Page ${currentPage} of ${totalPages}`;

    // BUTTON STATES

    document.getElementById('prevPageBtn').disabled =
        currentPage === 1;

    document.getElementById('nextPageBtn').disabled =
        currentPage === totalPages;
}


// ===============================
// FILTER BY STATUS
// ===============================

function filterOrdersByStatus(status) {

    currentPage = 1;

    if (!Array.isArray(allOrders)) {
        return;
    }

    // SHOW ALL

    if (!status || status.toLowerCase() === 'all') {

        renderRecentOrders(allOrders);
        return;
    }

    // FILTER

    const filtered = allOrders.filter(order => {

        return (order.status || '')
            .toString()
            .trim()
            .toLowerCase() === status.toLowerCase();
    });

    renderRecentOrders(filtered);
}


// ===============================
// LOAD ACTIVITY FEED
// ===============================

async function loadActivityFeed() {

    try {

        const token = localStorage.getItem('token');

        const response = await fetch('/api/admin/activity', {
            headers: {
                Authorization: `Bearer ${token}`
            }
        });

        const activities = await response.json();

        const feed =
            document.getElementById('activityFeed');

        if (activities.length === 0) {

            feed.innerHTML = `
                <div style="
                    text-align:center;
                    padding:2rem;
                    color:#999;
                ">
                    No recent activity
                </div>
            `;

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

        console.log('✅ Activity loaded:',
            activities.length);

    } catch (error) {

        console.error('Activity error:', error);

        document.getElementById('activityFeed').innerHTML = `
            <div style="
                text-align:center;
                padding:2rem;
                color:#666;
            ">
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

            currentPage--;

            renderRecentOrders(filteredOrders);
        }
    });

    // NEXT BUTTON

    document.getElementById('nextPageBtn')
    .addEventListener('click', () => {

        const totalPages =
            Math.ceil(filteredOrders.length / ordersPerPage);

        if (currentPage < totalPages) {

            currentPage++;

            renderRecentOrders(filteredOrders);
        }
    });
});