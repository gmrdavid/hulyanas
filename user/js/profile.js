document.addEventListener('DOMContentLoaded', async function() {
    await checkAuth();
    await loadProfile();
    setupEventListeners();
});

function setupEventListeners() {
    document.getElementById('profileForm').addEventListener('submit', updateProfile);
    document.getElementById('passwordForm').addEventListener('submit', updatePassword);
}

async function loadProfile() {
    const token = localStorage.getItem('token');
    try {
        const response = await fetch('/api/profile', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        const profile = await response.json();
        document.getElementById('profileName').textContent = profile.full_name || profile.username;
        document.getElementById('profileFullName').value = profile.full_name || '';
        document.getElementById('profilePhone').value = profile.phone || '';
        document.getElementById('profileAddress').value = profile.address || '';
    } catch (error) {
        console.error('Error loading profile:', error);
    }
}

async function updateProfile(e) {
    e.preventDefault();
    
    const token = localStorage.getItem('token');
    const profileData = {
        full_name: document.getElementById('profileFullName').value,
        phone: document.getElementById('profilePhone').value,
        address: document.getElementById('profileAddress').value
    };

    try {
        const response = await fetch('/api/profile', {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(profileData)
        });

        if (response.ok) {
            alert('Profile updated successfully!');
            const user = JSON.parse(localStorage.getItem('user'));
            user.full_name = profileData.full_name;
            localStorage.setItem('user', JSON.stringify(user));
        } else {
            const data = await response.json();
            alert(data.error || 'Update failed');
        }
    } catch (error) {
        alert('Update error: ' + error.message);
    }
}

function showChangePassword() {
    document.getElementById('passwordModal').style.display = 'flex';
}

async function updatePassword(e) {
    e.preventDefault();
    
    const currentPassword = document.getElementById('currentPassword').value;
    const newPassword = document.getElementById('newPassword').value;
    const confirmNewPassword = document.getElementById('confirmNewPassword').value;

    if (newPassword !== confirmNewPassword) {
        alert('New passwords do not match');
        return;
    }

    if (newPassword.length < 6) {
        alert('Password must be at least 6 characters');
        return;
    }

    const token = localStorage.getItem('token');
    
    try {
        const response = await fetch('/api/change-password', {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ currentPassword, newPassword })
        });

        if (response.ok) {
            alert('Password updated successfully!');
            document.getElementById('passwordModal').style.display = 'none';
            document.getElementById('passwordForm').reset();
        } else {
            const data = await response.json();
            alert(data.error || 'Password update failed');
        }
    } catch (error) {
        alert('Password update error: ' + error.message);
    }
}

async function deleteAccount() {
    if (!confirm('Are you sure you want to delete your account? This action cannot be undone.')) {
        return;
    }

    const token = localStorage.getItem('token');
    
    try {
        const response = await fetch('/api/delete-account', {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (response.ok) {
            alert('Account deleted successfully');
            logout();
        } else {
            const data = await response.json();
            alert(data.error || 'Delete failed');
        }
    } catch (error) {
        alert('Delete error: ' + error.message);
    }
}