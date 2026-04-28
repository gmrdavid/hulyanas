document.addEventListener('DOMContentLoaded', async function() {
    await checkAdminAuth();
    await loadOrders();
    
    document.getElementById('statusFilter').addEventListener('change', loadOrders);
});

async function loadOrders() {
    const token = localStorage.getItem('token');
    const statusFilter = document.getElementById('statusFilter').value;
    
    let url = '/api/admin/orders';
    if (statusFilter) {
        url += `?status=${statusFilter}`;
    }
    
    const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    
    const orders = await response.json();
    renderOrdersTable(orders);
}

function renderOrdersTable(orders) {
    const tbody = document.querySelector('#ordersTable tbody');
    tbody.innerHTML = orders.map(order => `
        <tr>
            <td>#${order.id}</td>
            <td>${order.full_name || order.username}</td>
            <td>${new Date(order.created_at).toLocaleDateString()}</td>
            <td>$${order.total_amount}</td>
            <td>
                <span class="status-badge ${order.status}">${order.status}</span>
            </td>
            <td>
                <button class="btn btn-small btn-primary" onclick="viewOrder(${order.id})">
                    <i class="fas fa-eye"></i> View
                </button>
                <select onchange="updateOrderStatus(${order.id}, this.value)" class="status-select">
                    <option value="pending" ${order.status === 'pending' ? 'selected' : ''}>Pending</option>
                    <option value="confirmed" ${order.status === 'confirmed' ? 'selected' : ''}>Confirmed</option>
                    <option value="preparing" ${order.status === 'preparing' ? 'selected' : ''}>Preparing</option>
                    <option value="ready" ${order.status === 'ready' ? 'selected' : ''}>Ready</option>
                    <option value="delivered" ${order.status === 'delivered' ? 'selected' : ''}>Delivered</option>
                    <option value="cancelled" ${order.status === 'cancelled' ? 'selected' : ''}>Cancelled</option>
                </select>
            </td>
        </tr>
    `).join('');
}

async function updateOrderStatus(orderId, status) {
    const token = localStorage.getItem('token');
    
    const response = await fetch(`/api/admin/orders/${orderId}/status`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ status })
    });
    
    if (response.ok) {
        await loadOrders();
    }
}

function viewOrder(orderId) {
    // Implement order details view
    alert(`View details for order #${orderId}`);
}