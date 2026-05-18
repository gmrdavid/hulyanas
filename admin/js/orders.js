let orders = [];
let filteredOrders = [];
let currentOrderId = null;

// Pagination (CHANGED TO 3)
let currentPage = 1;
const ordersPerPage = 3;

// Load Orders
async function loadOrders() {
    try {
        const token = localStorage.getItem('token');

        const response = await fetch('/api/admin/orders', {
            headers: {
                Authorization: `Bearer ${token}`
            }
        });

        const data = await response.json();

        orders = data;
        filteredOrders = [...orders];
        currentPage = 1;

        renderOrdersTable();
        loadStats();

    } catch (error) {
        console.error('Error loading orders:', error);
    }
}

// Render Table
function renderOrdersTable() {

    const tbody = document.getElementById('ordersList');

    const startIndex = (currentPage - 1) * ordersPerPage;
    const endIndex = startIndex + ordersPerPage;

    const paginatedOrders = filteredOrders.slice(startIndex, endIndex);

    tbody.innerHTML = paginatedOrders.map(order => {

        const date = new Date(order.created_at).toLocaleString();

        // 🔥 NEW: format ordered items (IMPORTANT)
        let itemsHTML = "No items";

        try {
            const items = typeof order.items === "string"
                ? JSON.parse(order.items)
                : order.items;

            if (Array.isArray(items) && items.length > 0) {
                itemsHTML = items.map(i =>
                    `${i.name} x${i.quantity}`
                ).join(", ");
            }
        } catch (e) {
            itemsHTML = order.items || "No items";
        }

        return `
            <tr>
                <td>${order.order_number}</td>

                <td>
                    <div class="customer-info">
                        <div class="order-avatar">
                            ${order.customer_name?.charAt(0) || 'U'}
                        </div>
                        <div>
                            <div class="customer-name">${order.customer_name}</div>
                            <div class="customer-email">${order.phone}</div>
                        </div>
                    </div>
                </td>

                <!-- NEW COLUMN: ORDERED MENU -->
                <td>
                    <div style="max-width: 200px; font-size: 0.9rem; color:#444;">
                        ${itemsHTML}
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
                    <span class="order-status">
                        ${order.payment_method}
                    </span>
                </td>

                <td>
                    <div class="table-actions">
                        <button class="action-btn action-view"
                            onclick="openOrderModal(${order.id})">
                            <i class="fas fa-eye"></i>
                        </button>

                        <button class="action-btn action-edit"
                            onclick="openEditStatusModal(${order.id})">
                            <i class="fas fa-edit"></i>
                        </button>

                        <button class="action-btn action-delete"
                            onclick="deleteOrder(${order.id})">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');

    updatePaginationButtons();
}

// Pagination UI
function updatePaginationButtons() {

    const totalPages = Math.ceil(filteredOrders.length / ordersPerPage);

    document.getElementById('pageInfo').textContent =
        `Page ${currentPage} of ${totalPages || 1}`;

    document.getElementById('prevPageBtn').disabled =
        currentPage === 1;

    document.getElementById('nextPageBtn').disabled =
        currentPage >= totalPages;
}

// Prev
document.getElementById('prevPageBtn').addEventListener('click', () => {
    if (currentPage > 1) {
        currentPage--;
        renderOrdersTable();
    }
});

// Next
document.getElementById('nextPageBtn').addEventListener('click', () => {
    const totalPages = Math.ceil(filteredOrders.length / ordersPerPage);

    if (currentPage < totalPages) {
        currentPage++;
        renderOrdersTable();
    }
});

// Stats (unchanged but kept clean)
function loadStats() {

    const today = new Date().toISOString().split('T')[0];

    const delivered = orders.filter(o => o.status === 'delivered').length;

    const pendingToday = orders.filter(o => {
        const date = new Date(o.created_at).toISOString().split('T')[0];
        return o.status === 'pending' && date === today;
    }).length;

    const revenue = orders
        .filter(o => o.status !== 'cancelled')
        .reduce((sum, o) => sum + parseFloat(o.total_amount || 0), 0);

    const stats = document.querySelectorAll('.stat-number');

    stats[0].textContent = orders.length;
    stats[1].textContent = delivered;
    stats[2].textContent = pendingToday;

    stats[3].textContent =
        `₱${revenue.toLocaleString('en-PH', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        })}`;
}

// Modal view (UPDATED to show items clearly)
function openOrderModal(id) {

    currentOrderId = id;

    const order = orders.find(o => o.id == id);
    if (!order) return;

    document.getElementById('modalOrderId').textContent = order.order_number;
    document.getElementById('modalCustomerName').textContent = order.customer_name;
    document.getElementById('modalCustomerPhone').textContent = order.phone;
    document.getElementById('modalCustomerAddress').textContent = order.delivery_address;
    document.getElementById('modalPaymentMethod').textContent = order.payment_method;
    document.getElementById('modalOrderDate').textContent = new Date(order.created_at).toLocaleString();

    // ITEMS INSIDE MODAL (FULL DETAILS)
    let itemsHTML = "<p>No items</p>";

    try {
        const items = typeof order.items === "string"
            ? JSON.parse(order.items)
            : order.items;

        if (Array.isArray(items)) {
            itemsHTML = items.map(item => `
                <div class="order-item-detail">
                    <span>${item.name} x${item.quantity}</span>
                </div>
            `).join('');
        }
    } catch (e) {}

    document.getElementById('modalOrderItems').innerHTML = itemsHTML;

    document.getElementById('orderModal').style.display = 'block';
}

// Other functions unchanged (edit, delete, filters, logout)
function openEditStatusModal(id) {
    currentOrderId = id;

    const order = orders.find(o => o.id == id);
    if (!order) return;

    document.getElementById('editModalOrderId').textContent = order.order_number;
    document.getElementById('statusSelect').value = order.status;

    document.getElementById('editStatusModal').style.display = 'block';
}

function closeOrderModal() {
    document.getElementById('orderModal').style.display = 'none';
}

function closeEditStatusModal() {
    document.getElementById('editStatusModal').style.display = 'none';
}

async function saveStatusChange() {
    const newStatus = document.getElementById('statusSelect').value;

    const token = localStorage.getItem('token');

    const res = await fetch(`/api/admin/orders/${currentOrderId}/status`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ status: newStatus })
    });

    if (res.ok) {
        alert("Updated!");
        loadOrders();
        closeEditStatusModal();
    }
}

async function deleteOrder(id) {
    if (!confirm("Delete this order?")) return;

    const token = localStorage.getItem('token');

    await fetch(`/api/admin/orders/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
    });

    loadOrders();
}

// Filters unchanged
document.getElementById('statusFilter').addEventListener('change', e => {
    const v = e.target.value;

    filteredOrders = v ? orders.filter(o => o.status === v) : [...orders];

    currentPage = 1;
    renderOrdersTable();
});

document.getElementById('dateFilter').addEventListener('change', e => {
    const v = e.target.value;

    filteredOrders = v
        ? orders.filter(o => new Date(o.created_at).toISOString().split('T')[0] === v)
        : [...orders];

    currentPage = 1;
    renderOrdersTable();
});

// Init
document.addEventListener('DOMContentLoaded', loadOrders);