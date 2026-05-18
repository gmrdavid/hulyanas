let orders = [];
let filteredOrders = [];
let currentOrderId = null;

let currentPage = 1;
const ordersPerPage = 10;

// =========================
// LOAD ORDERS
// =========================
async function loadOrders() {
    try {
        const token = localStorage.getItem('token');

        const response = await fetch('/api/admin/orders', {
            headers: {
                Authorization: `Bearer ${token}`
            }
        });

        const data = await response.json();

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

// =========================
// RENDER TABLE
// =========================
function renderOrdersTable() {

    const tbody = document.getElementById('ordersList');

    const totalPages = Math.ceil(filteredOrders.length / ordersPerPage);

    if (currentPage > totalPages) {
        currentPage = 1;
    }

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
                        <div class="customer-name">${order.customer_name}</div>
                        <div class="customer-email">${order.phone}</div>
                    </div>
                </div>
            </td>

            <td>${renderItemsCell(order)}</td>

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

            <td>${order.payment_method}</td>

            <td>
                <div class="table-actions">
                    <button class="action-btn action-view" onclick="openOrderModal(${order.id})">
                        <i class="fas fa-eye"></i>
                    </button>
                    <button class="action-btn action-edit" onclick="openEditStatusModal(${order.id})">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="action-btn action-delete" onclick="deleteOrder(${order.id})">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </td>
        </tr>
        `;
    }).join('');

    updatePaginationButtons();
}

// =========================
// PAGINATION
// =========================
function updatePaginationButtons() {

    const totalPages = Math.ceil(filteredOrders.length / ordersPerPage);

    document.getElementById('pageInfo').textContent =
        `Page ${currentPage} of ${totalPages || 1}`;

    document.getElementById('prevPageBtn').disabled =
        currentPage === 1;

    document.getElementById('nextPageBtn').disabled =
        currentPage >= totalPages || totalPages === 0;
}

// =========================
// FILTER SYSTEM (FIXED)
// =========================
function applyFilters() {

    const status = document.getElementById('statusFilter')?.value;
    const date = document.getElementById('dateFilter')?.value;

    filteredOrders = [...orders];

    if (status) {
        filteredOrders = filteredOrders.filter(o => o.status === status);
    }

    if (date) {
        filteredOrders = filteredOrders.filter(order => {
            const orderDate = new Date(order.created_at)
                .toISOString()
                .split('T')[0];

            return orderDate === date;
        });
    }

    currentPage = 1;
    renderOrdersTable();
}

// =========================
// ITEMS EXPAND SYSTEM
// =========================
function toggleItems(orderId) {

    const more = document.getElementById(`more-${orderId}`);
    const btn = more?.nextElementSibling;

    if (!more || !btn) return;

    const isHidden = more.style.display === "none" || more.style.display === "";

    if (isHidden) {
        more.style.display = "block";
        btn.textContent = "View less";
    } else {
        more.style.display = "none";
        btn.textContent = `View more (${btn.dataset.count})`;
    }
}

function renderItemsCell(order) {

    const items = Array.isArray(order.items) ? order.items : [];

    if (!items.length && order.order_items) {
        return `<span style="font-size:0.85rem;color:#444;">${order.order_items}</span>`;
    }

    if (!items.length) {
        return `<span style="color:#999;">No items</span>`;
    }

    const previewCount = 2;
    const hasMore = items.length > previewCount;

    const preview = items.slice(0, previewCount);

    return `
        <div>

            <div>
                ${preview.map(item => `
                    <div>• ${item.menu_name || item.name} x${item.quantity}</div>
                `).join('')}
            </div>

            ${hasMore ? `
                <div id="more-${order.id}" style="display:none;">
                    ${items.slice(previewCount).map(item => `
                        <div>• ${item.menu_name || item.name} x${item.quantity}</div>
                    `).join('')}
                </div>

                <button
                    class="view-more-btn"
                    data-count="${items.length - previewCount}"
                    onclick="toggleItems(${order.id})">
                    View more (${items.length - previewCount})
                </button>
            ` : ''}

        </div>
    `;
}

// =========================
// MODAL
// =========================
function openOrderModal(id) {

    const order = orders.find(o => o.id == id);
    if (!order) return;

    currentOrderId = id;

    document.getElementById('modalOrderId').textContent = order.order_number;
    document.getElementById('modalCustomerName').textContent = order.customer_name;
    document.getElementById('modalCustomerPhone').textContent = order.phone;
    document.getElementById('modalCustomerAddress').textContent = order.delivery_address;
    document.getElementById('modalPaymentMethod').textContent = order.payment_method;
    document.getElementById('modalOrderDate').textContent = new Date(order.created_at).toLocaleString();

    document.getElementById('modalOrderStatus').innerHTML =
        `<span class="order-status status-${order.status}">${order.status}</span>`;

    document.getElementById('modalOrderTotal').textContent =
        `₱${Number(order.total_amount || 0).toLocaleString('en-PH', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        })}`;

    document.getElementById('modalOrderItems').innerHTML =
        (order.items || []).map(item => `
            <div>
                ${item.menu_name} × ${item.quantity}
            </div>
        `).join('') || '<p>No items found</p>';

    document.getElementById('orderModal').style.display = 'block';
}

// =========================
// CLOSE MODALS
// =========================
function closeOrderModal() {
    document.getElementById('orderModal').style.display = 'none';
}

function closeEditStatusModal() {
    document.getElementById('editStatusModal').style.display = 'none';
}

// =========================
// INIT (ALL EVENTS FIXED)
// =========================
document.addEventListener('DOMContentLoaded', () => {

    loadOrders();

    document.getElementById('prevPageBtn')?.addEventListener('click', () => {
        if (currentPage > 1) {
            currentPage--;
            renderOrdersTable();
        }
    });

    document.getElementById('nextPageBtn')?.addEventListener('click', () => {
        const totalPages = Math.ceil(filteredOrders.length / ordersPerPage);
        if (currentPage < totalPages) {
            currentPage++;
            renderOrdersTable();
        }
    });

    document.getElementById('statusFilter')?.addEventListener('change', applyFilters);
    document.getElementById('dateFilter')?.addEventListener('change', applyFilters);
});