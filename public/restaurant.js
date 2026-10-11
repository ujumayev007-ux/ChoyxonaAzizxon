async function refreshRestaurantInfo() {
    try {
        const response = await fetch('/api/restaurant', { credentials: 'same-origin' }); if (!response.ok) return;
        const info = await response.json(); window.restaurantInfo = info;
        for (const element of document.querySelectorAll('[data-restaurant-name]')) {
            element.textContent = info.restaurantName;
            element.title = [info.address, info.phone, info.workingHours].filter(Boolean).join(' · ');
            const previous = element.parentElement.querySelector('[data-restaurant-logo]'); if (previous) previous.remove();
            if (info.logoUrl) { const img = document.createElement('img'); img.dataset.restaurantLogo = ''; img.src = info.logoUrl; img.alt = 'Restoran logotipi'; img.style.cssText = 'width:32px;height:32px;object-fit:contain;display:inline-block;margin-right:8px'; img.onerror = () => img.remove(); element.before(img); }
        }
        if (typeof renderCart === 'function') renderCart();
    } catch { /* Keep the current branding during a network outage. */ }
}
refreshRestaurantInfo();
window.addEventListener('restaurant-settings-saved', refreshRestaurantInfo);
if (typeof socket !== 'undefined') socket.on('settings_updated', refreshRestaurantInfo);
