// Load featured menu on homepage
document.addEventListener('DOMContentLoaded', function() {
    loadFeaturedMenu();
    
    // Smooth scrolling for navigation links
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            e.preventDefault();
            const target = document.querySelector(this.getAttribute('href'));
            if (target) {
                target.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start'
                });
            }
        });
    });
});

async function loadFeaturedMenu() {
    try {
        const response = await fetch('/api/menu');
        const menuItems = await response.json();
        
        const featuredContainer = document.getElementById('featuredMenu');
        const featuredItems = menuItems.slice(0, 6); // Show first 6 items
        
        featuredItems.forEach(item => {
            const menuItem = document.createElement('div');
            menuItem.className = 'menu-item';
            menuItem.innerHTML = `
                <img src="images/${item.image || 'default-food.jpg'}" alt="${item.name}" onerror="this.src='images/default-food.jpg'">
                <div class="menu-item-content">
                    <h3>${item.name}</h3>
                    <p>${item.description}</p>
                    <div class="menu-price">$${item.price}</div>
                    <a href="/user/login.html" class="menu-btn">Order Now</a>
                </div>
            `;
            featuredContainer.appendChild(menuItem);
        });
    } catch (error) {
        console.error('Error loading menu:', error);
    }
}