async function checkAuth() {
    const token = localStorage.getItem('token');
    if (!token) {
        window.location.href = 'login.html';
        return false;
    }

    try {
        const response = await fetch('/api/profile', {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!response.ok) {
            localStorage.removeItem('token');
            localStorage.removeItem('user');
            window.location.href = 'login.html';
            return false;
        }
        return true;
    } catch (error) {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        window.location.href = 'login.html';
        return false;
    }
}

async function checkAdminAuth() {
    const result = await checkAuth();
    if (!result) return;
    
    const user = JSON.parse(localStorage.getItem('user'));
    if (user.role !== 'admin') {
        window.location.href = '../user/dashboard.html';
    }
}

function logout() {
    localStorage.clear();
    window.location.href = '../index.html';
}