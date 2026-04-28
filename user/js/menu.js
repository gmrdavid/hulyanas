let cart = JSON.parse(localStorage.getItem('cart')) || [];

document.addEventListener('DOMContentLoaded', async function() {
    await checkAuth();
    setupNavbar();
    await loadMenu();
    updateCartSummary();
});

async function loadMenu() {
    try {
        const response = await fetch('/api/menu');
        const menuItems = await response.json();

        // Group by category
        const categories = {};
        menuItems.forEach(item => {
            if (!categories[item.category]) {
                categories[item.category] = [];
            }
            categories[item.category].push(item);
        });

        const menuContainer = document.getElementById('menuItems');
        const categoriesContainer = document.getElementById('menuCategories');

        // Create category tabs
        Object.keys(categories).forEach(category => {
            const categoryBtn = document.createElement('button');
            categoryBtn.className = 'category-btn';
            categoryBtn.textContent = category;
            categoryBtn.onclick = () => showCategory(category);
            categoriesContainer.appendChild(categoryBtn);
        });

        // Show first category
        showCategory(Object.keys(categories)[0]);

        function showCategory(category) {
            menuContainer.innerHTML = '';
            categories[category].forEach(item => {
                const menuItem = createMenuItem(item);
                menuContainer.appendChild(menuItem);
            });

            // Update active category
            document.querySelectorAll('.category-btn').forEach(btn => btn.classList.remove('active'));
            event.target.classList.add('active');
        }
    } catch (error) {
        console.error('Error loading menu:', error);
    }
}

function createMenuItem(item) {
    const div = document.createElement('div');
    div.className = 'menu-item';
    div.innerHTML = `
        <img src="../images/${item.image || 'default-food.jpg'}" alt="${item.name}" onerror="this.src='../images/default-food.jpg'">
        <div class="menu-item-content">
            <h3>${item.name}</h3>
            <p>${item.description}</p>
            <div class="menu-price">$${item.price}</div>
            <div class="quantity-controls">
                <button onclick="updateQuantity(${item.id}, -1)">-</button>
                <span id="qty-${item.id}">${getCartQuantity(item.id)}</span>
                <button onclick="updateQuantity(${item.id}, 1)">+</button>
                <button class="add-to-cart-btn" onclick="addToCart(${item.id})">
                    ${getCartQuantity(item.id) > 0 ? 'Update Cart' : 'Add to Cart'}
                </button>
            </div>
        </div>
    `;
    return div;
}

function getCartQuantity(itemId) {
    return cart.find(item => item.id === itemId)?.quantity || 0;
}

function updateQuantity(itemId, change) {
    const itemInCart = cart.find(item => item.id === itemId);
    if (itemInCart) {
        itemInCart.quantity += change;
        if (itemInCart.quantity <= 0) {
            cart = cart.filter(item => item.id !== itemId);
        }
    } else if (change > 0) {
        // Fetch item details to add to cart
        cart.push({ id: itemId, quantity: 1, price: 0 }); // Price will be updated later
    }
    
    localStorage.setItem('cart', JSON.stringify(cart));
    updateCartSummary();
    loadMenu(); // Reload to update quantities
}

async function addToCart(itemId) {
    const itemInCart = cart.find(item => item.id === itemId);
    if (!itemInCart) {
        try {
            const response = await fetch(`/api/menu/${itemId}`);
            const item = await response.json();
            cart.push({ id: itemId, quantity: 1, price: item.price, name: item.name });
            localStorage.setItem('cart', JSON.stringify(cart));
            updateCartSummary();
            loadMenu();
        } catch (error) {
            console.error('Error adding to cart:', error);
        }
    }
}

function updateCartSummary() {
    const totalItems = cart.reduce((sum, item) => sum + item.quantity, 0);
    document.getElementById('cartCount').textContent = totalItems;
}