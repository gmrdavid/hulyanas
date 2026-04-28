document.addEventListener('DOMContentLoaded', async function() {
    await checkAdminAuth();
    await loadDashboardStats();
});

async function checkAdminAuth() {
    const token = localStorage.getItem('token');
    const user = JSON.parse(localStorage.getItem('user'));
    
    if (!token || !user || user.role !== 'admin') {
        window.location.href = 'login.html';
    }

    document.getElementById('adminLogout').addEventListener('click', () => {
        localStorage.clear();
        window.location.href = '../index.html';
    });
}

async function loadDashboardStats() {
    const token = localStorage.getItem('token');
    
    // Menu items
    const menuResponse = await fetch('/api/admin/menu', {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    const menuItems = await menuResponse.json();
    document.getElementById('totalMenuItems').textContent = menuItems.length;

    // Orders
    const ordersResponse = await fetch('/api/admin/orders', {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    const orders = await ordersResponse.json();
    document.getElementById('totalOrders').textContent = orders.length;

    // Revenue
    const totalRevenue = orders.reduce((sum, order) => sum + parseFloat(order.total_amount), 0);
    document.getElementById('totalRevenue').textContent = `$${totalRevenue.toFixed(2)}`;

    // Users
    const usersResponse = await fetch('/api/admin/users', {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    const users = await usersResponse.json();
    document.getElementById('totalUsers').textContent = users.length;

    // Recent orders
    const recentOrdersContainer = document.getElementById('recentOrders');
    const recentOrders = orders.slice(0, 5).map(order => `
        <div class="order-item">
            <div class="order-info">
                <strong>#${order.id}</strong>
                <span>${order.full_name || order.username}</span>
            </div>
            <div class="order-status ${order.status}">${order.status}</div>
            <div>$${order.total_amount}</div>
        </div>
    `).join('');
    recentOrdersContainer.innerHTML = recentOrders;
}