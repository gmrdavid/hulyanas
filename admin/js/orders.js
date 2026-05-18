let orders = [];
    let currentOrderId = null;

    // Load Orders from Database
    async function loadOrders() {
        try {
            const token = localStorage.getItem('token');
            const response = await fetch('/api/admin/orders', {
                headers: {
                    Authorization: `Bearer ${token}`
                }
            });

            orders = await response.json();
            renderOrdersTable(orders);
            loadStats();
        } catch (error) {
            console.error('Error loading orders:', error);
        }
    }

    // Render Orders Table
    function renderOrdersTable(filteredOrders) {
        const tbody = document.getElementById('ordersList');
        tbody.innerHTML = filteredOrders.map(order => {
            const date = new Date(order.created_at).toLocaleString();
            return `
                <tr>
                    <td>${order.order_number}</td>
                    <td>
                        <div class="customer-info">
                            <div class="order-avatar">
                                ${order.customer_name.charAt(0)}
                            </div>
                            <div>
                                <div class="customer-name">${order.customer_name}</div>
                                <div class="customer-email">${order.phone}</div>
                            </div>
                        </div>
                    </td>
                    <td>${date}</td>
                    <td>
                        <span class="order-total">
                            ₱${parseFloat(order.total_amount || 0).toLocaleString('en-PH', {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2
                            })}
                        </span>
                    </td>
                    <td>
                        <span class="order-status status-${order.status}">
                            ${order.status}
                        </span>
                    </td>
                    <td>
                        <span class="order-status status-${order.payment_method}">
                            ${order.payment_method}
                        </span>
                    </td>
                    <td>
                        <div class="table-actions">
                            <button class="action-btn action-view" onclick="openOrderModal(${order.id})" title="View">
                                <i class="fas fa-eye"></i>
                            </button>
                            <button class="action-btn action-edit" onclick="openEditStatusModal(${order.id})" title="Edit Status">
                                <i class="fas fa-edit"></i>
                            </button>
                            <button class="action-btn action-delete" onclick="deleteOrder(${order.id})" title="Delete">
                                <i class="fas fa-trash"></i>
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
    }

    // Load Dashboard Stats
    function loadStats() {

    const today = new Date().toISOString().split('T')[0];

    // Total Orders (pending + delivered only)
    const totalOrders = orders.filter(order =>
        order.status === 'delivered' ||
        order.status === 'out_for_delivery' ||
        order.status === 'preparing'
    ).length;

    // Delivered Orders
    const delivered = orders.filter(order =>
        order.status === 'delivered'
    ).length;

    // Pending Orders TODAY
    const pendingToday = orders.filter(order => {

        const orderDate = new Date(order.created_at)
            .toISOString()
            .split('T')[0];

        return (
            order.status === 'pending' &&
            orderDate === today
        );

    }).length;

    // Revenue (pending + delivered only)
    const revenue = orders
        .filter(order =>
            order.status === 'delivered' ||
            order.status === 'out_for_delivery' ||
            order.status === 'preparing'
        )
        .reduce(
            (sum, order) =>
                sum + parseFloat(order.total_amount || 0),
            0
        );

    const stats = document.querySelectorAll('.stat-number');

    stats[0].textContent = totalOrders;
    stats[1].textContent = delivered;
    stats[2].textContent = pendingToday;
    stats[3].textContent = `₱${revenue.toLocaleString('en-PH', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    })}`;
}

    // Open View Modal
    function openOrderModal(id) {
        currentOrderId = id;
        const order = orders.find(o => o.id == id);
        if (!order) return;

        document.getElementById('modalOrderId').textContent = order.order_number;
        document.getElementById('modalCustomerName').textContent = order.customer_name;
        document.getElementById('modalCustomerPhone').textContent = order.phone;
        document.getElementById('modalCustomerAddress').textContent = order.delivery_address;
        document.getElementById('modalPaymentMethod').textContent = order.payment_method;
        document.getElementById('modalOrderNumber').textContent = order.order_number;
        document.getElementById('modalOrderDate').textContent = new Date(order.created_at).toLocaleString();
        document.getElementById('modalOrderStatus').innerHTML = `<span class="order-status status-${order.status}">${order.status}</span>`;
        document.getElementById('modalOrderTotal').textContent = `₱${parseFloat(order.total_amount || 0).toLocaleString('en-PH', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        })}`;
        document.getElementById('modalOrderItems').innerHTML = `
            <div class="order-item-detail">
                <div>
                    <strong>Order Notes:</strong> ${order.notes || 'No notes'}
                </div>
            </div>
        `;
        document.getElementById('orderModal').style.display = 'block';
    }

    // Open Edit Status Modal
    function openEditStatusModal(id) {
        currentOrderId = id;
        const order = orders.find(o => o.id == id);
        if (!order) return;

        document.getElementById('editModalOrderId').textContent = order.order_number;
        document.getElementById('statusSelect').value = order.status;
        document.getElementById('editStatusModal').style.display = 'block';
    }

    // Close Modals
    function closeOrderModal() {
        document.getElementById('orderModal').style.display = 'none';
    }

    function closeEditStatusModal() {
        document.getElementById('editStatusModal').style.display = 'none';
    }

    // Save Status Change
    async function saveStatusChange() {
        const newStatus = document.getElementById('statusSelect').value;
        try {
            const token = localStorage.getItem('token');
            const response = await fetch(`/api/admin/orders/${currentOrderId}/status`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify({ status: newStatus })
            });

            const result = await response.json();
            if (response.ok) {
                alert('Status updated successfully!');
                loadOrders();
                closeEditStatusModal();
            } else {
                alert(result.error || 'Failed to update status');
            }
        } catch (error) {
            console.error(error);
            alert('Error updating status');
        }
    }

    // Print Invoice
    function printInvoice() {
        window.print();
    }

    // Delete Order
    async function deleteOrder(id) {
        if (!confirm('Are you sure you want to delete this order? This action cannot be undone.')) return;

        try {
            const token = localStorage.getItem('token');
            const response = await fetch(`/api/admin/orders/${id}`, {
                method: 'DELETE',
                headers: {
                    Authorization: `Bearer ${token}`
                }
            });

            const result = await response.json();
            if (response.ok) {
                alert('Order deleted successfully!');
                loadOrders();
            } else {
                alert(result.error || 'Failed to delete order');
            }
        } catch (error) {
            console.error(error);
            alert('Error deleting order');
        }
    }

    // Filter by Status
    document.getElementById('statusFilter').addEventListener('change', e => {
        const value = e.target.value;
        if (!value) {
            renderOrdersTable(orders);
        } else {
            const filtered = orders.filter(o => o.status === value);
            renderOrdersTable(filtered);
        }
    });

    // Filter by Date
    document.getElementById('dateFilter').addEventListener('change', e => {
        const value = e.target.value;
        if (!value) {
            renderOrdersTable(orders);
        } else {
            const filtered = orders.filter(order => {
                const orderDate = new Date(order.created_at).toISOString().split('T')[0];
                return orderDate === value;
            });
            renderOrdersTable(filtered);
        }
    });

    // Close modals when clicking outside
    window.onclick = function(event) {
        const viewModal = document.getElementById('orderModal');
        const editModal = document.getElementById('editStatusModal');
        if (event.target === viewModal) {
            closeOrderModal();
        } else if (event.target === editModal) {
            closeEditStatusModal();
        }
    };

    // Logout
    document.getElementById('adminLogout').addEventListener('click', e => {
        e.preventDefault();
        localStorage.removeItem('token');
        window.location.href = '/index.html';
    });

    // Initialize
    document.addEventListener('DOMContentLoaded', () => {
        loadOrders();
    });