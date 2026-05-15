let users = [];

// Modal functions
function openModal(modalId) {
    const modal = document.getElementById(modalId);
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    modal.classList.remove('active');
    document.body.style.overflow = '';
}

function closeAllModals() {
    closeModal('viewModal');
}

// Safe JSON parser with HTML detection
function safeParseJson(responseText, context = 'API') {
    // Check if it's HTML error page
    if (responseText.includes('<!DOCTYPE') || responseText.includes('<html') || responseText.includes('404') || responseText.includes('500')) {
        console.error(`${context} Response (HTML Error):`, responseText.substring(0, 300));
        throw new Error(`${context} endpoint not found or server error. Check if API exists.`);
    }

    try {
        return JSON.parse(responseText);
    } catch (e) {
        console.error(`${context} Invalid JSON:`, responseText.substring(0, 300));
        throw new Error(`${context} returned invalid response (not JSON)`);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    // Modal close handlers
    document.getElementById('viewModalClose').addEventListener('click', () => closeModal('viewModal'));

    // Overlay click to close
    document.getElementById('viewModal').addEventListener('click', (e) => {
        if (e.target.classList.contains('modal-overlay')) closeModal('viewModal');
    });

    // ESC key to close modals
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeAllModals();
    });

    // Search and filter
    document.getElementById('userSearch').addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase();
        const filtered = users.filter(user => 
            user.username?.toLowerCase().includes(query) ||
            user.email?.toLowerCase().includes(query) ||
            `${user.first_name || ''} ${user.last_name || ''}`.toLowerCase().includes(query)
        );
        renderUsersTable(filtered);
    });

    document.getElementById('roleFilter').addEventListener('change', (e) => {
        const role = e.target.value;
        const filtered = role ? users.filter(user => user.role === role) : users;
        renderUsersTable(filtered);
    });

    // Admin logout
    document.getElementById('adminLogout').addEventListener('click', (e) => {
        e.preventDefault();
        if (confirm('Are you sure you want to logout?')) {
            localStorage.removeItem('token');
            window.location.href = '/index.html';
        }
    });

    fetchUsers();
});

async function fetchUsers() {
    try {
        const token = localStorage.getItem('token');
        if (!token) {
            alert('Please login first');
            window.location.href = '/login.html';
            return;
        }

        console.log('📡 Fetching users...');
        const response = await fetch('https://hulyanas.onrender.com/api/admin/users', {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            }
        });

        const responseText = await response.text();
        console.log('📡 GET Users Response:', {
            status: response.status,
            response: responseText.substring(0, 500)
        });

        if (!response.ok) {
            const data = safeParseJson(responseText, 'GET /api/admin/users');
            throw new Error(data.error || data.message || `HTTP ${response.status}`);
        }

        const data = safeParseJson(responseText, 'GET /api/admin/users');
        users = data;
        renderUsersTable(users);
        console.log('✅ Users loaded:', users.length);

    } catch (error) {
        console.error('❌ fetchUsers error:', error);
        if (error.message.includes('endpoint not found')) {
            alert('🚫 Users API missing. Check server: GET /api/admin/users');
        } else {
            alert(`Failed to load users: ${error.message}`);
        }
    }
}

function renderUsersTable(filteredUsers = users) {
    const tbody = document.getElementById('usersList');
    const totalUsersEl = document.getElementById('totalUsers');
    const totalAdminsEl = document.getElementById('totalAdmins');
    const newUsersTodayEl = document.getElementById('newUsersToday');

    // Stats
    totalUsersEl.textContent = users.length;
    totalAdminsEl.textContent = users.filter(u => u.role === 'admin').length;
    const today = new Date().toDateString();
    newUsersTodayEl.textContent = users.filter(u =>
        new Date(u.created_at).toDateString() === today
    ).length;

    tbody.innerHTML = filteredUsers.map(user => {
        const initials = `${user.first_name?.charAt(0) || ''}${user.last_name?.charAt(0) || ''}`;
        const joinedDate = new Date(user.created_at).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric'
        });

        return `
            <tr>
                <td>#${String(user.id).padStart(4, '0')}</td>
                <td>
                    <div class="user-info">
                        <div class="user-avatar">${initials || 'U'}</div>
                        <div>
                            <div class="user-name">${user.username || 'N/A'}</div>
                            <div class="user-email">${user.email || 'N/A'}</div>
                        </div>
                    </div>
                </td>
                <td title="${user.email || '—'}">${user.email || '—'}</td>
                <td title="${(user.first_name || '') + ' ' + (user.last_name || '')}">${(user.first_name || '') + ' ' + (user.last_name || '')}</td>
                <td>${user.phone || '—'}</td>
                <td>
                    <span class="user-role role-${user.role || 'customer'}">${user.role || 'customer'}</span>
                </td>
                <td class="date-joined" title="${user.created_at}">${joinedDate}</td>
                <td>
                    <div class="table-actions">
                        <button class="action-btn action-view" onclick="viewUser(${user.id})" title="View">
                            <i class="fas fa-eye"></i>
                        </button>
                        <button class="action-btn action-delete" onclick="deleteUser(${user.id})" title="Delete">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

// View User Modal
function viewUser(id) {
    const user = users.find(u => u.id === id);
    if (!user) {
        alert('User not found');
        return;
    }

    document.getElementById('viewModalTitle').textContent = `User #${user.id}`;
    document.getElementById('viewUserAvatar').textContent = `${user.first_name?.charAt(0) || ''}${user.last_name?.charAt(0) || 'U'}`;
    document.getElementById('viewUsername').textContent = user.username || 'N/A';
    document.getElementById('viewEmail').textContent = user.email || 'N/A';
    document.getElementById('viewFullName').textContent = `${user.first_name || ''} ${user.last_name || ''}`.trim() || 'Not provided';
    document.getElementById('viewPhone').textContent = user.phone || 'Not provided';
    
    const roleEl = document.getElementById('viewRole');
    roleEl.textContent = user.role || 'customer';
    roleEl.className = `user-role role-${user.role || 'customer'}`;
    
    document.getElementById('viewJoined').textContent = user.created_at ? 
        new Date(user.created_at).toLocaleDateString('en-US', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        }) : 'Unknown';

    openModal('viewModal');
}

// Delete User
async function deleteUser(id) {
    if (!confirm('Are you sure you want to delete this user? This action cannot be undone.')) return;

    try {
        const token = localStorage.getItem('token');
        if (!token) {
            alert('No authentication token. Please login again.');
            window.location.href = '/login.html';
            return;
        }

        console.log('🗑️ Deleting user:', id);
        const response = await fetch(`https://hulyanas.onrender.com/api/admin/users/${id}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        const responseText = await response.text();
        console.log('📡 DELETE Response:', {
            status: response.status,
            response: responseText.substring(0, 300)
        });

        if (!response.ok) {
            const data = safeParseJson(responseText, `DELETE /api/admin/users/${id}`);
            throw new Error(data.error || data.message || `HTTP ${response.status}`);
        }

        const data = safeParseJson(responseText, `DELETE /api/admin/users/${id}`);
        alert('✅ ' + (data.message || 'User deleted successfully'));
        fetchUsers();

    } catch (error) {
        console.error('❌ Delete error:', error);
        if (error.message.includes('endpoint not found')) {
            alert('🚫 DELETE API missing. Check server: DELETE /api/admin/users/:id');
        } else {
            alert(`Delete failed: ${error.message}`);
        }
    }
}