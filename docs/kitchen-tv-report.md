# Oshxona TV tekshiruvi

Mavjud `/kitchen/tv` sahifasi eski `OrderItems` / `Dish` maydonlarini o‘qigan. Hozirgi API `items` / `menuItem` qaytaradi. Eski ekran buyurtmalar soniga qarab ustun tanlagan, balandlikni moslashtirmagan; haqiqiy taom nomi va holati ham noto‘g‘ri ko‘rsatilishi mumkin edi.

TV sahifasi haqiqiy API bilan bog‘landi. Har bir faol buyurtma taomi alohida bo‘limga chiqadi: nomi, bekor qilingan miqdor ayirilgan miqdori, stol raqami, buyurtma raqami, ofitsant, izoh va kutish vaqti. Bir taom qatorida 3 dona bo‘lsa, u 3 ta bo‘lim emas, miqdori 3 bo‘lgan bitta bo‘lim hisoblanadi.

1 ta taom butun ish maydonini egallaydi; 2 tasi ikkiga bo‘linadi; 1920×1080 ekranda 10 tasi 5×2 bo‘ladi. Joylashuv ekran kengligi/balandligiga va taomlar soniga avtomatik moslashadi. Matn o‘lchami ham bo‘lim ichiga sig‘ishga moslashtiriladi. Juda katta izoh yoki juda ko‘p taom kichik ekranda bo‘lsa, bo‘lim ichida aylantirish mumkin.

Tayyorlik ranglari serverdagi haqiqiy holatga bog‘liq. Olib ketilgan, yetkazilgan va bekor qilingan taomlar ekrandan chiqadi. Eski sahifadagi 40 daqiqadan keyin «osh tayyor» deb taxmin qiluvchi simulyatsiya olib tashlandi; vaqt o‘tishi taomni tayyor deb belgilamaydi.

Socket hodisalari jonli yangilaydi, zaxira tekshiruvi har 15 soniyada bajariladi. Internet qaytganda va sahifa yana ochilganda ma’lumot qayta olinadi. Sessiya tugasa oshxona paneliga kirish havolasi ko‘rsatiladi. TV sahifasi faqat o‘qiydi, buyurtma yoki to‘lov yozmaydi.

`To‘liq ekran` tugmasi mavjud. Brauzer talabi sabab to‘liq ekran uchun bir marta bosish kerak; undan keyingi joylashuv avtomatik.

## Tekshiruv

`npm run test:kitchen:tv` haqiqiy Chrome’da ajratilgan API sinov ma’lumotlari bilan o‘tdi: 1/2/10 taom, 1920×1080 va 1080×1920, taom olib ketilishi, jonli yangilanish, bo‘sh holat, sessiya tugashi, tarmoq uzilishi/qaytishi va xavfsiz matn. JavaScript xatolari chiqmadi. Ishchi bazaga sinov yozuvlari kiritilmadi.

Tasvirlar: `artifacts/kitchen-tv/1-taom.png`, `2-taom.png`, `10-taom.png`.

Oshxona panelidagi **TV Ekranni ochish** havolasi orqali ochiladi. Kod hostingga deploy qilinmadi; o‘zgarishlar mahalliy loyihada tayyor.
