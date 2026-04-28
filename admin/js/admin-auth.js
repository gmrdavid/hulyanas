document.addEventListener('DOMContentLoaded', function() {
    const form = document.getElementById('adminLoginForm');
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const username = document.getElementById('adminUsername').value;
        const password = document.getElementById('adminPassword').value;

        try {
            const response = await fetch('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });

            const data = await response.json();

            if (response.ok && data.user.role === 'admin') {
                localStorage.setItem('token', data.token);
                localStorage.setItem('user', JSON.stringify(data.user));
                window.location.href = 'dashboard.html';
            } else {
                alert('Admin access required or invalid credentials');
            }
        } catch (error) {
            alert('Login error: ' + error.message);
        }
    });
});