(() => {
    const role = document.currentScript.dataset.role;
    const form = document.getElementById(role === 'ADMIN' ? 'admin-login-form' : 'login-form');
    if (!form) return;
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'w-full rounded-xl border border-sky-300 bg-sky-50 px-4 py-3 font-bold text-sky-700';
    toggle.textContent = '4 raqamli PIN orqali kirish';
    form.append(toggle);
    toggle.onclick = () => {
        const panel = document.createElement('dialog');
        panel.className = 'rounded-2xl p-6 shadow-xl w-full max-w-sm';
        panel.innerHTML = `<form class="space-y-4"><h2 class="text-xl font-bold">PIN orqali kirish</h2><label class="block">4 raqamli PIN<input name="pin" type="password" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" autocomplete="off" required class="mt-2 w-full border rounded-xl p-3 text-center text-2xl tracking-widest"></label><p role="alert" class="text-sm text-red-600"></p><button type="submit" class="w-full rounded-xl bg-sky-600 p-3 font-bold text-white">Kirish</button><button type="button" class="w-full p-2">Bekor qilish</button></form>`;
        document.body.append(panel); panel.showModal();
        panel.querySelector('[type="button"]').onclick = () => panel.close();
        panel.addEventListener('close', () => panel.remove());
        panel.querySelector('input').focus();
        panel.querySelector('form').onsubmit = async event => {
            event.preventDefault();
            const button = panel.querySelector('[type="submit"]'); button.disabled = true;
            try {
                const response = await fetch('/api/auth/pin-login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ pin: panel.querySelector('input').value, role }) });
                const data = await response.json();
                if (!response.ok) throw new Error(data.message || 'PIN orqali kirib bo‘lmadi');
                location.reload();
            } catch (error) { panel.querySelector('[role="alert"]').textContent = error.message || 'Ulanishda xatolik'; }
            finally { button.disabled = false; }
        };
    };
})();
