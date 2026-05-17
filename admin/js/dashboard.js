        // Animate counters
        function animateCounters(data) {
            const menuEl = document.getElementById('menuCount');
            const orderEl = document.getElementById('orderCount');
            const revenueEl = document.getElementById('revenueCount');
            const userEl = document.getElementById('userCount');

            [menuEl, orderEl, userEl].forEach((el, i) => {
                const targets = [data.menuItems, data.totalOrders, data.totalUsers];
                let current = 0;
                const target = targets[i];
                const increment = target / 50;
                const timer = setInterval(() => {
                    current += increment;
                    if (current >= target) {
                        el.textContent = Math.floor(target).toLocaleString();
                        clearInterval(timer);
                        return;
                    }
                    el.textContent = Math.floor(current).toLocaleString();
                }, 20);
            });

            // Revenue animation
            let currentRev = 0;
                const targetRev = data.revenue;
                const revIncrement = targetRev / 50;

                const revTimer = setInterval(() => {
                    currentRev += revIncrement;

                    if (currentRev >= targetRev) {
                        revenueEl.textContent = `₱${targetRev.toLocaleString(undefined, {
                            minimumFractionDigits: 0,
                            maximumFractionDigits: 0
                        })}`;
                        
                        clearInterval(revTimer);
                        return;
                    }

                    revenueEl.textContent = `₱${Math.floor(currentRev).toLocaleString()}`;
                }, 20);
        }

        // Load admin stats
        async function loadAdminStats() {
            try {
                const token = localStorage.getItem('token');
                const response = await fetch('/api/admin/stats', {
                    headers: { Authorization: `Bearer ${token}` }
                });
                const data = await response.json();
                
                document.getElementById('menuCount').setAttribute('data-target', data.menuItems);
                document.getElementById('orderCount').setAttribute('data-target', data.totalOrders);
                document.getElementById('revenueCount').setAttribute('data-target', data.revenue);
                document.getElementById('userCount').setAttribute('data-target', data.totalUsers);
                
                animateCounters(data);
                console.log('✅ Stats loaded:', data);
            } catch (error) {
                console.error('Stats error:', error);
            }
        }

            const recentOrders = document.getElementById('recentOrders');
            const loadMoreBtn = document.getElementById('loadMoreBtn');

            const statusFilter = document.getElementById('statusFilter');
            const searchOrders = document.getElementById('searchOrders');

            let offset = 0;
            const limit = 10;

            let currentStatus = 'all';
            let currentSearch = '';

            async function loadOrders(reset = false) {

                try {

                    if (reset) {
                        offset = 0;
                        recentOrders.innerHTML = '';
                    }

                    const token = localStorage.getItem('token');

                    const response = await fetch(
                        `/api/admin/orders?limit=${limit}&offset=${offset}&status=${currentStatus}&search=${encodeURIComponent(currentSearch)}`,
                        {
                            headers: {
                                Authorization: `Bearer ${token}`
                            }
                        }
                    );

                    const data = await response.json();

                    if (!data.orders) return;

                    data.orders.forEach(order => {

                        const row = document.createElement('tr');

                        row.innerHTML = `
                            <td>${order.order_number}</td>
                            <td>${order.customer_name}</td>
                            <td>
                                <span class="status ${order.status}">
                                    ${order.status}
                                </span>
                            </td>
                            <td>₱${Number(order.total_amount).toFixed(2)}</td>
                            <td>${new Date(order.created_at).toLocaleString()}</td>
                        `;

                        recentOrders.appendChild(row);
                    });

                    offset += limit;

                    // hide button if no more orders
                    loadMoreBtn.style.display =
                        data.hasMore ? 'inline-block' : 'none';

                } catch (error) {

                    console.error('Failed to load orders:', error);
                }
            }

            // =======================
            // LOAD MORE
            // =======================
            loadMoreBtn.addEventListener('click', () => {
                loadOrders();
            });

            // =======================
            // FILTER
            // =======================
            statusFilter.addEventListener('change', e => {
                currentStatus = e.target.value;
                loadOrders(true);
            });

            // =======================
            // SEARCH
            // =======================
            searchOrders.addEventListener('input', e => {
                currentSearch = e.target.value;
                loadOrders(true);
            });

            // =======================
            // INITIAL LOAD
            // =======================
            loadOrders(true);

        // Activity feed
        async function loadActivityFeed() {
            try {
                const token = localStorage.getItem('token');
                const response = await fetch('/api/admin/activity', {
                    headers: { Authorization: `Bearer ${token}` }
                });
                const activities = await response.json();
                
                const feed = document.getElementById('activityFeed');
                if (activities.length === 0) {
                    feed.innerHTML = '<div style="text-align:center;padding:2rem;color:#999;">No recent activity</div>';
                    return;
                }
                
                feed.innerHTML = activities.map(activity => `
                    <div class="activity-item">
                        <div class="activity-icon ${activity.type}">
                            <i class="fas fa-${activity.type === 'order' ? 'shopping-cart' : 
                                activity.type === 'user' ? 'user-plus' : activity.type}"></i>
                        </div>
                        <div class="activity-content">
                            <h4>${activity.message}</h4>
                            <p>${activity.time}</p>
                        </div>
                    </div>
                `).join('');
                console.log('✅ Activity loaded:', activities.length);
            } catch (error) {
                console.error('Activity error:', error);
                document.getElementById('activityFeed').innerHTML = 
                    '<div style="text-align:center;padding:2rem;color:#666;">Failed to load activity feed</div>';
            }
        }

        // Toast notification
        function showToast(message) {
            const toast = document.createElement('div');
            toast.style.cssText = `
                position:fixed;top:20px;right:20px;background:#d4edda;color:#155724;
                padding:1rem 2rem;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,0.1);
                z-index:3000;transform:translateX(400px);transition:all 0.3s ease;font-weight:500;
            `;
            toast.textContent = message;
            document.body.appendChild(toast);
            setTimeout(() => toast.style.transform = 'translateX(0)', 100);
            setTimeout(() => toast.remove(), 3000);
        }

        // Navbar scroll effect
        window.addEventListener('scroll', () => {
            const navbar = document.querySelector('.navbar');
            navbar.style.background = window.scrollY > 50 ? 'rgba(255,255,255,1)' : 'rgba(255,255,255,0.98)';
        });

        // Logout handler
        document.getElementById('logoutBtn').addEventListener('click', (e) => {
            e.preventDefault();
            if (confirm('Are you sure you want to logout?')) {
                localStorage.removeItem('token');
                window.location.href = '/index.html';
            }
        });

        // 🚀 MAIN INITIALIZATION
        document.addEventListener('DOMContentLoaded', async () => {
            console.log('🔥 Loading Hulyanas Admin Dashboard...');
            
            // Auto-login if no token
            if (!localStorage.getItem('token')) {
                try {
                    console.log('🔑 Attempting auto-login...');
                    const loginRes = await fetch('/api/login', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ username: 'admin', password: 'password' })
                    }); 
                    const loginData = await loginRes.json();
                    localStorage.setItem('token', loginData.token);
                    console.log('✅ Auto-login successful');
                } catch (e) {
                    console.log('ℹ️ No auto-login available');
                }
            }
            // Load all dashboard data in parallel
            document.body.classList.add('loading');
            await Promise.all([
                loadAdminStats(),
                loadRecentOrders(),
                loadActivityFeed()
            ]);
            document.body.classList.remove('loading');
            
            console.log('✅ Dashboard fully loaded! ✨');
        });