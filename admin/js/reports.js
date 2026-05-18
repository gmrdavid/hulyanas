        let salesChart, revenueChart, productsChart, customersChart;
        let analyticsData = {};

        // 🚀 DATABASE CONNECTION - Real data from your hulyanas database
        const API_BASE = '/api'; // Your backend API endpoints

        // Fetch all analytics data from database
        async function fetchAnalyticsData(days = 'all', status = 'all') {
            try {
                const params = new URLSearchParams({ days, status });
                const response = await fetch(`${API_BASE}/analytics?${params}`, {
                    headers: {
                        'Authorization': `Bearer ${localStorage.getItem('token')}`,
                        'Content-Type': 'application/json'
                    }
                });

                if (!response.ok) {
                    throw new Error(`API Error: ${response.status}`);
                }

                return await response.json();
            } catch (error) {
                console.error('❌ Database fetch error:', error);
                showError('Failed to load analytics data from database');
                return null;
            }
        }

        // Animate counters with real database data
        function animateCounters(data) {
            const elements = [
                { el: 'totalOrders', target: data.total_orders || 0, format: 'number' },
                { el: 'totalRevenue', target: data.total_revenue || 0, format: 'currency' },
                { el: 'activeCustomers', target: data.active_customers || 0, format: 'number' },
                { el: 'avgRating', target: data.avg_order_value || 0, format: 'currency' }
            ];

            elements.forEach(({ el, target, format }) => {
                const element = document.getElementById(el);
                let current = 0;
                const increment = target / 50;
                const timer = setInterval(() => {
                    current += increment;
                    if (current >= target) {
                        if (format === 'currency') {
                            element.textContent = `₱${Number(target).toLocaleString('en-PH', { 
                                minimumFractionDigits: 2, maximumFractionDigits: 2 
                            })}`;
                        } else {
                            element.textContent = Math.floor(target).toLocaleString();
                        }
                        clearInterval(timer);
                        return;
                    }
                    const display = format === 'currency' ? 
                        `₱${Math.floor(current).toLocaleString()}` : 
                        Math.floor(current).toLocaleString();
                    element.textContent = display;
                }, 20);
            });

            // Update change percentages
            document.getElementById('ordersChange').textContent = `+${data.order_growth || 0}%`;
            document.getElementById('revenueChange').textContent = `+${data.revenue_growth || 0}%`;
            document.getElementById('customersChange').textContent = `+${data.customer_growth || 0}%`;
        }


        function destroyCharts() {
            if (salesChart) salesChart.destroy();
            if (revenueChart) revenueChart.destroy();
            if (productsChart) productsChart.destroy();
            if (customersChart) customersChart.destroy();
        }

        // Initialize charts with REAL database data
        function initCharts(data) {

            // 🚨 IMPORTANT: prevent "canvas already in use"
            destroyCharts();

            // 1. Sales Chart
            const orderTrends = data.order_trends || [];
            salesChart = new Chart(document.getElementById('salesChart'), {
                type: 'line',
                data: {
                    labels: orderTrends.map(i => i.day_name),
                    datasets: [{
                        label: 'Orders',
                        data: orderTrends.map(i => i.order_count),
                        borderColor: '#1a1a1a',
                        backgroundColor: 'rgba(26, 26, 26, 0.1)',
                        borderWidth: 3,
                        fill: true,
                        tension: 0.4
                    }]
                },
                options: { responsive: true, maintainAspectRatio: false }
            });

            // 2. Revenue Chart
            const revenueByStatus = data.revenue_by_status || [];
            revenueChart = new Chart(document.getElementById('revenueChart'), {
                type: 'doughnut',
                data: {
                    labels: revenueByStatus.map(i => i.status),
                    datasets: [{
                        data: revenueByStatus.map(i => i.total_amount),
                        backgroundColor: ['#1a1a1a', '#28a745', '#007bff', '#ffc107', '#dc3545']
                    }]
                }
            });

            // 3. Products Chart
            const topProducts = data.top_products || [];
            productsChart = new Chart(document.getElementById('productsChart'), {
                type: 'bar',
                data: {
                    labels: topProducts.map(i =>
                        i.name.length > 15 ? i.name.slice(0, 15) + '...' : i.name
                    ),
                    datasets: [{
                        label: 'Units Sold',
                        data: topProducts.map(i => i.quantity),
                        backgroundColor: '#1a1a1a'
                    }]
                }
            });

            // 4. Customers Chart
            const customerOrders = data.customer_orders || [];
            customersChart = new Chart(document.getElementById('customersChart'), {
                type: 'line',
                data: {
                    labels: customerOrders.map(i => i.username.slice(0, 8)),
                    datasets: [{
                        label: 'Orders',
                        data: customerOrders.map(i => i.order_count),
                        borderColor: '#28a745',
                        fill: true
                    }]
                }
            });
        }

        // Load and display real database analytics
        async function loadAnalyticsData(days = 'all', status = 'all') {
            document.body.classList.add('loading');
            
            const data = await fetchAnalyticsData(days, status);
            if (data) {
                analyticsData = data;
                animateCounters(data);
                initCharts(data);
                showToast('✅ Analytics loaded from database!');
            }
            
            document.body.classList.remove('loading');
        }

        // Filter handlers
        document.getElementById('timeFilter').addEventListener('change', (e) => {
            const status = document.getElementById('statusFilter').value;
            loadAnalyticsData(e.target.value, status);
        });

        document.getElementById('statusFilter').addEventListener('change', (e) => {
            const days = document.getElementById('timeFilter').value;
            loadAnalyticsData(days, e.target.value);
        });

        // ✅ FIXED Export function with better error handling
        async function exportReport(type) {
            try {
                document.body.classList.add('loading');
                console.log(`📤 Exporting ${type} report...`);
                
                const response = await fetch(`${API_BASE}/export/${type}`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${localStorage.getItem('token')}`,
                        'Content-Type': 'application/json'
                    }
                });

                // ✅ Better error checking
                if (!response.ok) {
                    const errorText = await response.text();
                    console.error(`❌ Server error ${response.status}:`, errorText);
                    throw new Error(`Server error ${response.status}: ${errorText}`);
                }

                const blob = await response.blob();
                console.log(`✅ Blob received: ${blob.size} bytes, type: ${blob.type}`);
                
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `hulyanas-${type}-report-${new Date().toISOString().split('T')[0]}.${type === 'dashboard' ? 'pdf' : 'csv'}`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                window.URL.revokeObjectURL(url);
                
                showToast(`✅ ${type.toUpperCase()} report downloaded!`);
            } catch (error) {
                console.error('❌ Export error:', error);
                showToast(`❌ ${type.toUpperCase()} export failed. Check console.`);
            } finally {
                document.body.classList.remove('loading');
            }
        }

        // Error display
        function showError(message) {
            const errorDiv = document.createElement('div');
            errorDiv.className = 'error-message';
            errorDiv.innerHTML = `
                <i class="fas fa-exclamation-triangle"></i>
                ${message}<br>
                <small>Check your database connection</small>
            `;
            document.querySelector('.admin-dashboard').prepend(errorDiv);
            setTimeout(() => errorDiv.remove(), 5000);
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

        // 🚀 MAIN INITIALIZATION - Loads REAL DATABASE DATA
        document.addEventListener('DOMContentLoaded', async () => {
            console.log('📊 Loading Hulyanas Analytics Dashboard from DATABASE...');
            
            // Auto-login simulation (replace with your real auth)
            if (!localStorage.getItem('token')) {
                localStorage.setItem('token', 'admin-token-' + Date.now());
            }

            // Load real analytics data from your database
            await loadAnalyticsData();
            
            console.log('✅ REAL DATABASE ANALYTICS loaded successfully! ✨');
        });
