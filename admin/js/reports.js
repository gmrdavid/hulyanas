let salesChart, revenueChart, productsChart, customersChart;
let analyticsData = {};

const API_BASE = '/api';

// =========================
// FETCH DATA
// =========================
async function fetchAnalyticsData(days = 'all', status = 'all') {
    try {
        const params = new URLSearchParams({ days, status });

        const response = await fetch(`${API_BASE}/analytics?${params}`, {
            headers: {
                Authorization: `Bearer ${localStorage.getItem('token')}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`API Error: ${response.status}`);
        }

        return await response.json();

    } catch (error) {
        console.error('❌ Database fetch error:', error);
        showError('Failed to load analytics data');
        return null;
    }
}

// =========================
// COUNTERS
// =========================
function animateCounters(data) {

    const elements = [
        { el: 'totalOrders', target: data.total_orders || 0, format: 'number' },
        { el: 'totalRevenue', target: data.total_revenue || 0, format: 'currency' },
        { el: 'activeCustomers', target: data.active_customers || 0, format: 'number' },
        { el: 'avgRating', target: data.avg_order_value || 0, format: 'currency' }
    ];

    elements.forEach(({ el, target, format }) => {

        const element = document.getElementById(el);
        if (!element) return;

        let current = 0;
        const increment = target / 40;

        const timer = setInterval(() => {
            current += increment;

            if (current >= target) {
                current = target;
                clearInterval(timer);
            }

            element.textContent =
                format === 'currency'
                    ? `₱${Math.floor(current).toLocaleString('en-PH')}`
                    : Math.floor(current).toLocaleString();

        }, 20);
    });

    // safe updates
    document.getElementById('ordersChange').textContent = `+${data.order_growth || 0}%`;
    document.getElementById('revenueChange').textContent = `+${data.revenue_growth || 0}%`;
    document.getElementById('customersChange').textContent = `+${data.customer_growth || 0}%`;
}

// =========================
// DESTROY CHARTS
// =========================
function destroyCharts() {
    if (salesChart) salesChart.destroy();
    if (revenueChart) revenueChart.destroy();
    if (productsChart) productsChart.destroy();
    if (customersChart) customersChart.destroy();
}

// =========================
// CHARTS
// =========================
function initCharts(data) {

    destroyCharts();

    // -------------------------
    // ORDER TRENDS
    // -------------------------
    const orderTrends = data.order_trends || [];

    salesChart = new Chart(document.getElementById('salesChart'), {
        type: 'line',
        data: {
            labels: orderTrends.map(i => i.day_name || ''),
            datasets: [{
                label: 'Orders',
                data: orderTrends.map(i => i.order_count || 0),
                borderColor: '#1a1a1a',
                backgroundColor: 'rgba(26,26,26,0.1)',
                borderWidth: 3,
                fill: true,
                tension: 0.4
            }]
        }
    });

    // =========================
    // REVENUE BY STATUS
    // =========================
    const revenueByStatus = data.revenue_by_status || [];

    revenueChart = new Chart(document.getElementById('revenueChart'), {
        type: 'doughnut',
        data: {
            labels: revenueByStatus.map(i => i.status || ''),
            datasets: [{
                data: revenueByStatus.map(i => i.total_amount || 0),
                backgroundColor: ['#1a1a1a', '#28a745', '#007bff', '#ffc107', '#dc3545']
            }]
        }
    });

    // =========================
    // TOP PRODUCTS
    // =========================
    const topProducts = data.top_products || [];

    productsChart = new Chart(document.getElementById('productsChart'), {
        type: 'bar',
        data: {
            labels: topProducts.map(i => {
                const name = i.name || i.product_name || 'Unknown';
                return name.length > 15 ? name.slice(0, 15) + '...' : name;
            }),
            datasets: [{
                label: 'Units Sold',
                data: topProducts.map(i => i.quantity_sold || i.quantity || 0),
                backgroundColor: '#1a1a1a'
            }]
        }
    });

    // =========================
    // CUSTOMER ORDERS
    // =========================
    const customerOrders = data.customer_orders || [];

    customersChart = new Chart(document.getElementById('customersChart'), {
        type: 'line',
        data: {
            labels: customerOrders.map(i => (i.username || 'user').slice(0, 8)),
            datasets: [{
                label: 'Orders',
                data: customerOrders.map(i => i.order_count || 0),
                borderColor: '#28a745',
                backgroundColor: 'rgba(40,167,69,0.1)',
                fill: true
            }]
        }
    });

    // =========================
    // 🔥 FIXED DASHBOARD STATS (THIS WAS MISSING!)
    // =========================

    // Order Trends extras
    document.getElementById('peakOrderDay').textContent =
        data.peak_day || 'N/A';

    document.getElementById('avgOrderValueDb').textContent =
        `₱${Number(data.avg_order_value || 0).toLocaleString('en-PH', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        })}`;

    // Revenue by status extras
    document.getElementById('bestStatus').textContent =
        data.top_status || 'N/A';

    document.getElementById('deliveredRevenue').textContent =
        `₱${Number(data.delivered_revenue || 0).toLocaleString('en-PH', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        })}`;

    // Top products extras
    document.getElementById('topProductName').textContent =
        data.top_product_name || 'N/A';

    document.getElementById('totalItemsSold').textContent =
        data.total_items_sold || 0;

    // Customer extras
    document.getElementById('topCustomer').textContent =
        data.top_customer || 'N/A';

    document.getElementById('repeatCustomers').textContent =
        data.repeat_customers || 0;
}

// =========================
// LOAD ANALYTICS
// =========================
async function loadAnalyticsData(days = 'all', status = 'all') {

    document.body.classList.add('loading');

    const data = await fetchAnalyticsData(days, status);

    if (data) {
        analyticsData = data;

        animateCounters(data);
        initCharts(data);

        showToast('✅ Analytics loaded from database!');
    }

    document.body.classList.remove('loading');
}

// =========================
// FILTERS
// =========================
document.getElementById('timeFilter')?.addEventListener('change', (e) => {
    const status = document.getElementById('statusFilter').value;
    loadAnalyticsData(e.target.value, status);
});

document.getElementById('statusFilter')?.addEventListener('change', (e) => {
    const days = document.getElementById('timeFilter').value;
    loadAnalyticsData(days, e.target.value);
});

// =========================
// INIT
// =========================
document.addEventListener('DOMContentLoaded', async () => {

    if (!localStorage.getItem('token')) {
        localStorage.setItem('token', 'admin-token');
    }

    await loadAnalyticsData();
});