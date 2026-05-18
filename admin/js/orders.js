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

    if (currentPage > totalPages) currentPage = 1;

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
                        ${order.customer_name?.charAt(0) || "?"}
                    </div>
                    <div>
                        <div class="customer-name">${order.customer_name || ""}</div>
                        <div class="customer-email">${order.phone || ""}</div>
                    </div>
                </div>
            </td>

            <td>${renderItemsCell(order)}</td>

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

            <td>
                ${order.payment_method || ""}
            </td>

            <td>
                ${
                    order.payment_method === "gcash"
                        ? (order.gcash_reference
                            ? `<span style="font-weight:600; color:#1a1a1a;">
                                    ${order.gcash_reference}
                            </span>`
                            : `<span style="color:#999;">No reference</span>`)
                        : `<span style="color:#ccc;">—</span>`
                }
            </td>

        <td>
            <div class="table-actions">

                <button 
                    onclick="openOrderModal(${order.id})"
                    class="action-btn action-view"
                    title="View Order">
                    <i class="fas fa-eye"></i>
                </button>

                <button 
                    onclick="openEditStatusModal(${order.id})"
                    class="action-btn action-edit"
                    title="Edit Status">
                    <i class="fas fa-edit"></i>
                </button>

                <button 
                    onclick="deleteOrder(${order.id})"
                    class="action-btn action-delete"
                    title="Delete Order">
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

    document.getElementById('prevPageBtn').disabled = currentPage === 1;
    document.getElementById('nextPageBtn').disabled =
        currentPage >= totalPages || totalPages === 0;
}

// =========================
// FILTERS
// =========================
function applyFilters() {

    const status = document.getElementById('statusFilter')?.value;
    const date = document.getElementById('dateFilter')?.value;

    filteredOrders = [...orders];

    if (status) {
        filteredOrders = filteredOrders.filter(o => o.status === status);
    }

    if (date) {
        filteredOrders = filteredOrders.filter(o => {
            const d = new Date(o.created_at).toISOString().split('T')[0];
            return d === date;
        });
    }

    currentPage = 1;
    renderOrdersTable();
}

// =========================
// STATS
// =========================
function loadStats() {

    const today = new Date().toISOString().split('T')[0];

    const totalOrders = orders.filter(o => o.status !== 'cancelled').length;
    const delivered = orders.filter(o => o.status === 'delivered').length;

    const pendingToday = orders.filter(o => {
        const d = new Date(o.created_at).toISOString().split('T')[0];
        return o.status === 'pending' && d === today;
    }).length;

    const revenue = orders
        .filter(o =>
            o.status === 'delivered' ||
            o.status === 'out_for_delivery' ||
            o.status === 'preparing'
        )
        .reduce((sum, o) => sum + Number(o.total_amount || 0), 0);

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

// =========================
// ITEMS
// =========================
function renderItemsCell(order) {

    const items = Array.isArray(order.items) ? order.items : [];

    if (!items.length) return `<span>No items</span>`;

    const preview = items.slice(0, 2);
    const hasMore = items.length > 2;

    return `
        <div>
            ${preview.map(i =>
                `<div>• ${i.menu_name || i.name} x${i.quantity}</div>`
            ).join('')}

            ${hasMore ? `
                <div id="more-${order.id}" style="display:none;">
                    ${items.slice(2).map(i =>
                        `<div>• ${i.menu_name || i.name} x${i.quantity}</div>`
                    ).join('')}
                </div>

                <button onclick="toggleItems(${order.id})">
                    View more (${items.length - 2})
                </button>
            ` : ''}
        </div>
    `;
}

function toggleItems(orderId) {

    const more = document.getElementById(`more-${orderId}`);
    if (!more) return;

    more.style.display =
        more.style.display === "none" || more.style.display === ""
            ? "block"
            : "none";
}

// =========================
// VIEW MODAL
// =========================
function openOrderModal(id) {

    const order = orders.find(o => o.id == id);
    if (!order) return;

    currentOrderId = id;

    const orderNumber = order.order_number || `ORD-${order.id}`;

    document.getElementById('modalOrderId').textContent = orderNumber;
    document.getElementById('modalOrderNumber').textContent = orderNumber;
    document.getElementById('modalCustomerName').textContent = order.customer_name;
    document.getElementById('modalCustomerPhone').textContent = order.phone;
    document.getElementById('modalCustomerAddress').textContent = order.delivery_address;
    document.getElementById('modalPaymentMethod').innerHTML =
    order.payment_method === "gcash"
        ? `GCash <br><small>Ref: ${order.gcash_reference || "N/A"}</small>`
        : order.payment_method;

    document.getElementById('modalOrderDate').textContent =
        new Date(order.created_at).toLocaleString();

    document.getElementById('modalOrderStatus').innerHTML =
        `<span class="order-status status-${order.status}">${order.status}</span>`;

    document.getElementById('modalOrderTotal').textContent =
        `₱${Number(order.total_amount || 0).toLocaleString('en-PH', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        })}`;

    document.getElementById('modalOrderItems').innerHTML =
        (order.items || []).map(i => `
            <div>
                ${i.menu_name} × ${i.quantity}
            </div>
        `).join('');

    document.getElementById('orderModal').style.display = 'block';
}

// =========================
// EDIT STATUS
// =========================
function openEditStatusModal(id) {

    const order = orders.find(o => o.id == id);
    if (!order) return;

    currentOrderId = id;

    document.getElementById('editModalOrderId').textContent = order.order_number;
    document.getElementById('statusSelect').value = order.status;

    document.getElementById('editStatusModal').style.display = 'block';
}

async function saveStatusChange() {

    const newStatus = document.getElementById('statusSelect').value;

    const token = localStorage.getItem('token');

    await fetch(`/api/admin/orders/${currentOrderId}/status`, {
        method: "PUT",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ status: newStatus })
    });

    loadOrders();
    closeEditStatusModal();
}

// =========================
// DELETE
// =========================
async function deleteOrder(id) {

    if (!confirm("Delete this order?")) return;

    const token = localStorage.getItem('token');

    await fetch(`/api/admin/orders/${id}`, {
        method: "DELETE",
        headers: {
            Authorization: `Bearer ${token}`
        }
    });

    loadOrders();
}

// =========================
// INVOICE PRINT FIX
// =========================
function printInvoice() {

    const content = document.getElementById('orderModal').innerHTML;

    const win = window.open('', '', 'width=800,height=600');

    win.document.write(`
        <html>
        <head>
            <title>Invoice</title>
        </head>
        <body>
            ${content}
        </body>
        </html>
    `);

    win.document.close();
    win.print();
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
// INIT
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