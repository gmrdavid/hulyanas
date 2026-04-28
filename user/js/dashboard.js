document.addEventListener('DOMContentLoaded', async function() {
    await checkAuth();
    
    const user = JSON.parse(localStorage.getItem('user'));
    document.getElementById('userName').textContent = user.full_name || user.username;

    document.getElementById('logoutBtn').addEventListener('click', logout);
});

async function checkAuth() {
    const token = localStorage.getItem('token');
    if (!token) {
        window.location.href = 'login.html';
        return;
    }

    try {
        const response = await fetch('/api/profile', {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!response.ok) {
            localStorage.removeItem('token');
            localStorage.removeItem('user');
            window.location.href = 'login.html';
        }
    } catch (error) {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        window.location.href = 'login.html';
    }
}

function logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    localStorage.removeItem('cart');
    window.location.href = '../index.html';
}