document.addEventListener('DOMContentLoaded', async function() {
    await checkAdminAuth();
    await loadUsers();
});

async function loadUsers() {
    const token = localStorage.getItem('token');
    const response = await fetch('/api/admin/users', {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    
    const users = await response.json();
    renderUsersTable(users);
}

function renderUsersTable(users) {
    const tbody = document.querySelector('#usersTable tbody');
    tbody.innerHTML = users.map(user => `
        <tr>
            <td>${user.id}</td>
            <td>${user.username}</td>
            <td>${user.email}</td>
            <td>${user.full_name || '-'}</td>
            <td>${user.phone || '-'}</td>
            <td>
                <span class="status-badge ${user.role}">${user.role}</span>
            </td>
            <td>${new Date(user.created_at).toLocaleDateString()}</td>
        </tr>
    `).join('');
}