let cart = JSON.parse(localStorage.getItem('cart')) || [];

document.addEventListener('DOMContentLoaded', async function() {
    await checkAuth();
    loadCart();
    setupEventListeners();
});

function setupEventListeners() {
    document.getElementById('checkoutBtn').addEventListener('click', showCheckoutModal);
    document.getElementById('checkoutForm').addEventListener('submit', handleCheckout);
    document.querySelector('.close').addEventListener('click', hideCheckoutModal);
}

function loadCart() {
    const cartItemsContainer = document.getElementById('cartItems');
    
    if (cart.length === 0) {
        cartItemsContainer.innerHTML = '<p class="empty-cart">Your cart is empty. <a href="menu.html">Continue shopping</a></p>';
        return;
    }

    let total = 0;
    cartItemsContainer.innerHTML = cart.map((item, index) => {
        total += item.quantity * item.price;
        return `
            <div class="cart-item">
                <img src="../images/${item.image || 'default-food.jpg'}" alt="${item.name}">
                <div class="cart-item-details">
                    <h4>${item.name}</h4>
                    <div class="quantity-controls">
                        <button onclick="updateCartQuantity(${index}, -1)">-</button>
                        <span>${item.quantity}</span>
                        <button onclick="updateCartQuantity(${index}, 1)">+</button>
                    </div>
                    <div class="item-price">$${(item.price * item.quantity).toFixed(2)}</div>
                </div>
                <button class="remove-btn" onclick="removeFromCart(${index})">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        `;
    }).join('');

    document.getElementById('subtotal').textContent = `$${total.toFixed(2)}`;
    document.getElementById('total').textContent = `$${(total * 1.1).toFixed(2)}`; // Including 10% tax
    document.getElementById('cartTotal').textContent = `$${total.toFixed(2)}`;
    document.getElementById('checkoutBtn').style.display = 'block';
}

function updateCartQuantity(index, change) {
    cart[index].quantity += change;
    if (cart[index].quantity <= 0) {
        cart.splice(index, 1);
    }
    localStorage.setItem('cart', JSON.stringify(cart));
    loadCart();
}

function removeFromCart(index) {
    cart.splice(index, 1);
    localStorage.setItem('cart', JSON.stringify(cart));
    loadCart();
}

function showCheckoutModal() {
    document.getElementById('checkoutModal').style.display = 'flex';
}

function hideCheckoutModal() {
    document.getElementById('checkoutModal').style.display = 'none';
}

async function handleCheckout(e) {
    e.preventDefault();
    
    const deliveryAddress = document.getElementById('deliveryAddress').value;
    const phone = document.getElementById('deliveryPhone').value;
    
    if (!deliveryAddress || !phone) {
        alert('Please fill in all required fields');
        return;
    }

    try {
        const token = localStorage.getItem('token');
        const total = cart.reduce((sum, item) => sum + (item.quantity * item.price), 0);
        
        const response = await fetch('/api/orders', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                cartItems: cart,
                delivery_address: deliveryAddress,
                phone: phone,
                total_amount: total
            })
        });

        const data = await response.json();

        if (response.ok) {
            localStorage.removeItem('cart');
            alert(`Order placed successfully! Order ID: ${data.orderId}`);
            window.location.href = `orders.html`;
        } else {
            alert(data.error || 'Checkout failed');
        }
    } catch (error) {
        alert('Checkout error: ' + error.message);
    }
}