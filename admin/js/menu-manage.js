let editingItemId = null;
let menuItems = [];

document.addEventListener('DOMContentLoaded', async function() {
    await checkAdminAuth();
    await loadMenuItems();
});

async function loadMenuItems() {
    const token = localStorage.getItem('token');
    const response = await fetch('/api/admin/menu', {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    
    menuItems = await response.json();
    renderTable();
}

function renderTable() {
    const tbody = document.querySelector('#menuTable tbody');
    tbody.innerHTML = menuItems.map(item => `
        <tr>
            <td><img src="../images/${item.image || 'default.jpg'}" alt="${item.name}" width="50"></td>
            <td>${item.name}</td>
            <td>${item.category}</td>
            <td>$${item.price}</td>
            <td>
                <span class="status-badge ${item.status}">${item.status}</span>
            </td>
            <td>
                <button class="btn btn-small btn-edit" onclick="editItem(${item.id})">
                    <i class="fas fa-edit"></i>
                </button>
                <button class="btn btn-small btn-danger" onclick="deleteItem(${item.id})">
                    <i class="fas fa-trash"></i>
                </button>
            </td>
        </tr>
    `).join('');
}

function showAddModal() {
    editingItemId = null;
    document.getElementById('modalTitle').textContent = 'Add New Menu Item';
    document.getElementById('menuForm').reset();
    document.getElementById('menuModal').style.display = 'flex';
}

function editItem(id) {
    const item = menuItems.find(item => item.id == id);
    if (!item) return;

    editingItemId = id;
    document.getElementById('modalTitle').textContent = 'Edit Menu Item';
    document.getElementById('itemName').value = item.name;
    document.getElementById('itemDescription').value = item.description;
    document.getElementById('itemPrice').value = item.price;
    document.getElementById('itemCategory').value = item.category;
    document.getElementById('itemStatus').value = item.status;
    document.getElementById('menuModal').style.display = 'flex';
}

function hideMenuModal() {
    document.getElementById('menuModal').style.display = 'none';
    document.getElementById('menuForm').reset();
    editingItemId = null;
}

document.getElementById('menuForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    
    const formData = new FormData();
    formData.append('name', document.getElementById('itemName').value);
    formData.append('description', document.getElementById('itemDescription').value);
    formData.append('price', document.getElementById('itemPrice').value);
    formData.append('category', document.getElementById('itemCategory').value);
    formData.append('status', document.getElementById('itemStatus').value);
    
    const imageFile = document.getElementById('itemImage').files[0];
    if (imageFile) {
        formData.append('image', imageFile);
    }

    const token = localStorage.getItem('token');
    const url = editingItemId 
        ? `/api/admin/menu/${editingItemId}` 
        : '/api/admin/menu';

    const method = editingItemId ? 'PUT' : 'POST';

    try {
        const response = await fetch(url, {
            method,
            headers: { 'Authorization': `Bearer ${token}` },
            body: formData
        });

        if (response.ok) {
            alert(editingItemId ? 'Item updated successfully!' : 'Item added successfully!');
            hideMenuModal();
            await loadMenuItems();
        } else {
            const data = await response.json();
            alert(data.error || 'Operation failed');
        }
    } catch (error) {
        alert('Error: ' + error.message);
    }
});

async function deleteItem(id) {
    if (!confirm('Are you sure you want to delete this item?')) return;

    const token = localStorage.getItem('token');
    
    try {
        const response = await fetch(`/api/admin/menu/${id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (response.ok) {
            alert('Item deleted successfully!');
            await loadMenuItems();
        } else {
            const data = await response.json();
            alert(data.error || 'Delete failed');
        }
    } catch (error) {
        alert('Delete error: ' + error.message);
    }
}