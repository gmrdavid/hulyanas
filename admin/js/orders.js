let orders = [];
let filteredOrders = [];
let currentOrderId = null;

let currentPage = 1;
const ordersPerPage = 10;

// LOAD ORDERS
async function loadOrders() {
    try {
        const token = localStorage.getItem('token');

        const response = await fetch('/api/admin/orders', {
            headers: {
                Authorization: `Bearer ${token}`
            }
        });

        const data = await response.json();

        // ❗ FIX: prevent crash
        if (!Array.isArray(data)) {
            console.error("API ERROR:", data);
            orders = [];
        } else {
            orders = data;
        }

        filteredOrders = [...orders];
        currentPage = 1;

        renderOrdersTable();
        loadStats();

    } catch (error) {
        console.error('Error loading orders:', error);
    }
}

// RENDER TABLE
function renderOrdersTable() {

    const tbody = document.getElementById('ordersList');

    const start = (currentPage - 1) * ordersPerPage;
    const end = start + ordersPerPage;

    const pageOrders = filteredOrders.slice(start, end);

    tbody.innerHTML = pageOrders.map(order => {

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
                    <div class="customer-name">
                        ${order.customer_name}
                    </div>
                    <div class="customer-email">
                        ${order.phone}
                    </div>
                </div>
            </div>
        </td>

        <!-- ✅ NEW ITEMS COLUMN -->
        <td>
            <div style="max-width: 220px; font-size: 0.85rem; color: #444;">
                ${
                    order.items && Array.isArray(order.items)
                        ? order.items.slice(0, 2).map(item =>
                            `<div>• ${item.name} x${item.quantity}</div>`
                        ).join('') + (order.items.length > 2 ? `<div>...</div>` : '')
                        : order.order_items
                            ? order.order_items
                            : 'No items'
                }
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
                    onclick="openOrderModal(${order.id})"
                    title="View">
                    <i class="fas fa-eye"></i>
                </button>

                <button class="action-btn action-edit"
                    onclick="openEditStatusModal(${order.id})"
                    title="Edit Status">
                    <i class="fas fa-edit"></i>
                </button>

                <button class="action-btn action-delete"
                    onclick="deleteOrder(${order.id})"
                    title="Delete">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        </td>
    </tr>
    `;
    }).join('');

    updatePaginationButtons();
}

function updatePaginationButtons() {

    const totalPages = Math.ceil(filteredOrders.length / ordersPerPage);

    document.getElementById('pageInfo').textContent =
        `Page ${currentPage} of ${totalPages || 1}`;

    document.getElementById('prevPageBtn').disabled =
        currentPage === 1;

    document.getElementById('nextPageBtn').disabled =
        currentPage >= totalPages || totalPages === 0;
}

function loadStats() {

    const today = new Date().toISOString().split('T')[0];

    // Total orders (all non-cancelled)
    const totalOrders = orders.filter(order =>
        order.status !== 'cancelled'
    ).length;

    // Delivered orders
    const delivered = orders.filter(order =>
        order.status === 'delivered'
    ).length;

    // Pending today
    const pendingToday = orders.filter(order => {

        const orderDate = new Date(order.created_at)
            .toISOString()
            .split('T')[0];

        return (
            order.status === 'pending' &&
            orderDate === today
        );

    }).length;

    // Revenue
    const revenue = orders
        .filter(order =>
            order.status === 'delivered' ||
            order.status === 'out_for_delivery' ||
            order.status === 'preparing'
        )
        .reduce((sum, order) =>
            sum + Number(order.total_amount || 0), 0
        );

    const stats = document.querySelectorAll('.stat-number');

    if (stats.length >= 4) {
        stats[0].textContent = totalOrders;
        stats[1].textContent = delivered;
        stats[2].textContent = pendingToday;

        stats[3].textContent =
            `₱${revenue.toLocaleString('en-PH', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
            })}`;
    }
}

// VIEW ORDER MODAL
function openOrderModal(id) {

    const order = orders.find(o => o.id == id);
    if (!order) return;

    currentOrderId = id;

    document.getElementById('modalOrderId').textContent = order.order_number;
    document.getElementById('modalCustomerName').textContent = order.customer_name;
    document.getElementById('modalCustomerPhone').textContent = order.phone;
    document.getElementById('modalCustomerAddress').textContent = order.delivery_address;
    document.getElementById('modalPaymentMethod').textContent = order.payment_method;
    document.getElementById('modalOrderNumber').textContent = order.order_number;
    document.getElementById('modalOrderDate').textContent = new Date(order.created_at).toLocaleString();

    document.getElementById('modalOrderStatus').innerHTML =
        `<span class="order-status status-${order.status}">${order.status}</span>`;

    document.getElementById('modalOrderTotal').textContent =
        `₱${Number(order.total_amount || 0).toLocaleString('en-PH', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        })}`;

    // ✅ FIX: SHOW ORDER ITEMS
    document.getElementById('modalOrderItems').innerHTML =
        (order.items || []).map(item => `
            <div class="order-item-detail">
                <div>
                    ${item.menu_name} × ${item.quantity}
                </div>
                <div>
                    ₱${Number(item.price_at_order).toFixed(2)}
                </div>
            </div>
        `).join('') || '<p>No items found</p>';

    document.getElementById('orderModal').style.display = 'block';
}

// CLOSE MODALS
function closeOrderModal() {
    document.getElementById('orderModal').style.display = 'none';
}

function closeEditStatusModal() {
    document.getElementById('editStatusModal').style.display = 'none';
}

// INIT
document.addEventListener('DOMContentLoaded', loadOrders);