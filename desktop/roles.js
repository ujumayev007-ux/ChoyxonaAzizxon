// Har bir EXE o'z panelini ochadi; ruxsatlar serverdagi PIN/rol tekshiruvi orqali beriladi
module.exports = {
    admin:   { id: 'admin',   title: 'Admin',     path: '/admin',        autoStart: false, kiosk: false },
    cashier: { id: 'cashier', title: 'Kassa',     path: '/cashier',      autoStart: true,  kiosk: false },
    waiter:  { id: 'waiter',  title: 'Ofitsiant', path: '/waiter',       autoStart: false, kiosk: false },
    kitchen: { id: 'kitchen', title: 'Oshxona',   path: '/kitchen/',     autoStart: true,  kiosk: false },
    owner:   { id: 'owner',   title: 'Owner',     path: '/super-owner',  autoStart: false, kiosk: false },
    tv:      { id: 'tv',      title: 'TV',        path: '/kitchen/tv',   autoStart: true,  kiosk: true }
};
