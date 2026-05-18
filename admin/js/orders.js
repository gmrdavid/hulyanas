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
                            ${order.customer_name?.charAt(0) || "U"}
                        </div>

                        <div>
                            <div class="customer-name">
                                ${order.customer_name || "Unknown"}
                            </div>

                            <div class="customer-email">
                                ${order.phone || ""}
                            </div>
                        </div>
                    </div>
                </td>

                <td>${date}</td>

                <td>
                    <span class="order-total">
                        ₱${Number(order.total_amount || 0).toLocaleString('en-PH', {
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

                <td>${order.payment_method}</td>

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