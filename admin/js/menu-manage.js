let currentEditId = null;
let menuItems = [];

// Load menu items from database
async function loadMenuItems() {
    try {
        const response = await fetch('/api/admin/menu', {
            headers: {
                Authorization: `Bearer ${localStorage.getItem('token')}`
            }
        });
        if (!response.ok) throw new Error('Failed to fetch menu items');
        menuItems = await response.json();
        console.log(`📋 Loaded ${menuItems.length} menu items`);
        renderMenuTable(menuItems);
        attachTableListeners(); // Re-attach after render
    } catch (error) {
        console.error('Error loading menu items:', error);
        document.getElementById('menuItems').innerHTML = '<tr><td colspan="6" style="text-align:center;padding:2rem;color:#666;">Failed to load menu items. Please refresh the page.</td></tr>';
    }
}

// Render table
function renderMenuTable(items) {
    const tbody = document.getElementById('menuItems');
    if (!items || items.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:2rem;color:#666;">No menu items found.</td></tr>';
        return;
    }
    
    tbody.innerHTML = items.map(item => {
        const imageSrc = item.image_url || '/images/default-menu.jpg';
        const cacheBustSrc = imageSrc + '?v=' + Date.now();
        
        return `
            <tr data-id="${item.id}">
                <td>
                    <img 
                        src="${cacheBustSrc}" 
                        alt="${escapeHtml(item.name)}" 
                        class="item-image"
                        loading="lazy"
                        data-original-src="${imageSrc}"
                        onerror="handleImageError(this)"
                    >
                </td>
                <td>
                    <div class="item-name">${escapeHtml(item.name)}</div>
                    <div style="font-size: 0.9rem; color: #666; margin-top: 0.25rem;">
                        ${escapeHtml(item.description || '').substring(0, 50)}${item.description && item.description.length > 50 ? '...' : ''}
                    </div>
                </td>
                <td style="font-weight: 500; color: #1a1a1a; text-transform: capitalize;">
                    ${escapeHtml(item.category || 'Uncategorized')}
                </td>
                <td>
                    <span class="item-price">₱${parseFloat(item.price || 0).toFixed(2)}</span>
                </td>
                <td>
                    <span class="item-status ${item.is_available == 1 ? 'status-available' : 'status-unavailable'}">
                        ${item.is_available == 1 ? 'Available' : 'Unavailable'}
                    </span>
                </td>
                <td>
                    <div class="table-actions">
                        <button class="action-btn action-edit" title="Edit">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="action-btn action-delete" title="Delete">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

function handleImageError(img) {
    img.src = '/images/default-menu.jpg?v=' + Date.now();
    img.onerror = null;
}

// Event delegation for table actions
function attachTableListeners() {
    const table = document.getElementById('menuTable');
    if (!table) return;
    
    table.removeEventListener('click', handleTableClick);
    table.addEventListener('click', handleTableClick);
}

function handleTableClick(e) {
    const editBtn = e.target.closest('.action-edit');
    const deleteBtn = e.target.closest('.action-delete');
    
    if (editBtn) {
        e.stopPropagation();
        const row = editBtn.closest('tr');
        const id = row.dataset.id;
        const item = menuItems.find(item => item.id == id);
        if (item) editItem(item);
    }
    
    if (deleteBtn) {
        e.stopPropagation();
        const row = deleteBtn.closest('tr');
        confirmDelete(row.dataset.id);
    }
}

function escapeHtml(text) {
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return text ? text.replace(/[&<>"']/g, m => map[m]) : '';
}

// Show add modal - called from onclick in HTML
function showAddModal() {
    currentEditId = null;
    document.getElementById('modalTitle').textContent = 'Add New Menu Item';
    document.getElementById('menuForm').reset();
    document.getElementById('imagePreview').style.display = 'none';
    document.getElementById('itemStatus').value = 'available';
    document.getElementById('menuModal').style.display = 'block';
    console.log('🆕 Add modal opened');
}

// Hide modal - called from onclick in HTML
function hideMenuModal() {
    document.getElementById('menuModal').style.display = 'none';
    document.getElementById('menuForm').reset();
    document.getElementById('imagePreview').style.display = 'none';
    currentEditId = null;
}

// Edit item
function editItem(item) {
    currentEditId = item.id;
    document.getElementById('modalTitle').textContent = 'Edit Menu Item';
    
    document.getElementById('itemName').value = item.name || '';
    document.getElementById('itemDescription').value = item.description || '';
    document.getElementById('itemPrice').value = item.price || '';
    document.getElementById('itemCategory').value = item.category || '';
    document.getElementById('itemStatus').value = item.is_available == 1 ? 'available' : 'unavailable';

    const preview = document.getElementById('imagePreview');
    if (item.image_url) {
        preview.src = item.image_url + '?v=' + Date.now();
        preview.style.display = 'block';
        preview.onerror = () => { preview.style.display = 'none'; };
    } else {
        preview.style.display = 'none';
    }

    document.getElementById('menuModal').style.display = 'block';
    console.log('✏️ Edit modal opened for:', item.name);
}

// Confirm delete
function confirmDelete(id) {
    if (confirm('Are you sure you want to permanently delete this menu item?')) {
        deleteItem(id);
    }
}

// Delete item
async function deleteItem(id) {
    try {
        const response = await fetch(`/api/menu/${id}`, {
            method: 'DELETE',
            headers: {Authorization: `Bearer ${localStorage.getItem('token')}`
            }
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.message || 'Failed to delete item');
        }

        showToast('Menu item deleted successfully!', 'success');
        await loadMenuItems();
    } catch (error) {
        console.error('Delete error:', error);
        showToast('Error deleting item: ' + error.message, 'error');
    }
}

// Save item (Add/Update)
async function handleMenuFormSubmit(e) {
    e.preventDefault();
    
    try {
        const formData = new FormData();
        formData.append('name', document.getElementById('itemName').value.trim());
        formData.append('description', document.getElementById('itemDescription').value.trim());
        formData.append('price', parseFloat(document.getElementById('itemPrice').value));
        formData.append('category', document.getElementById('itemCategory').value);
        formData.append('is_available', document.getElementById('itemStatus').value === 'available' ? '1' : '0');

        const imageFile = document.getElementById('itemImage').files[0];
        if (imageFile) formData.append('image', imageFile);

        const url = currentEditId ? `/api/menu/${currentEditId}` : '/api/menu';

       const token = localStorage.getItem('token');

        const response = await fetch(url, {
            method: currentEditId ? 'PUT' : 'POST',
            headers: {
                Authorization: `Bearer ${token}`
            },
            body: formData
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || errorData.message || 'Failed to save item');
        }

        const result = await response.json();
        showToast(result.message || (currentEditId ? 'Item updated!' : 'Item added!'), 'success');
        hideMenuModal();
        await loadMenuItems();

    } catch (error) {
        console.error('Save error:', error);
        showToast('Error: ' + error.message, 'error');
    }
}

// Toast notifications
function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.style.cssText = `
        position: fixed; top: 20px; right: 20px; 
        background: ${type === 'success' ? '#d4edda' : '#f8d7da'};
        color: ${type === 'success' ? '#155724' : '#721c24'};
        padding: 1rem 1.5rem; border-radius: 12px; 
        border: 1px solid ${type === 'success' ? '#c3e6cb' : '#f5c6cb'};
        z-index: 3000; font-weight: 500; max-width: 350px;
        box-shadow: 0 10px 25px rgba(0,0,0,0.1);
        font-family: Inter, sans-serif;
    `;
    toast.textContent = message;
    document.body.appendChild(toast);
    
    setTimeout(() => toast.remove(), 4000);
}

// Initialize everything when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
    console.log('🚀 Menu manager initialized');

    if (!localStorage.getItem('token')) {
    window.location.href = '/index.html';
    return;
    }
    
    // Form submit handler
    const menuForm = document.getElementById('menuForm');
    menuForm.addEventListener('submit', handleMenuFormSubmit);
    
    // Image preview
    const itemImage = document.getElementById('itemImage');
    itemImage.addEventListener('change', function(e) {
        const file = e.target.files[0];
        if (file) {
            const preview = document.getElementById('imagePreview');
            preview.src = URL.createObjectURL(file);
            preview.style.display = 'block';
        }
    });
    
    // Close modal on outside click
    window.onclick = function(event) {
        const modal = document.getElementById('menuModal');
        if (event.target === modal) hideMenuModal();
    };
    
    // Logout
    document.getElementById('adminLogout').addEventListener('click', function(e) {
        e.preventDefault();
        if (confirm('Are you sure you want to logout?')) {
            localStorage.removeItem('token');
            window.location.href = '/index.html';
        }
    });
    
    // Load initial data
    loadMenuItems();
});