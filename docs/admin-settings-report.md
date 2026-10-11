# Admin sozlamalari — bajarilgan ishlar

## Katta tugmalar va davomat bo‘limlari

Qidiruv tepaga joylashtirildi. Katta, turli rangdagi tugmalar tartibi: PIN orqali kirish → Telegram sozlamalari → Davomat → Jadval → Usullar → Davomat tarixi; undan keyin qolgan sozlamalar. Jadval, davomatni yoqish/o‘chirish, PIN/QR usullari, QR yaratish va tarix admin sozlamalaridan mavjud `/api/attendance` orqali boshqariladi. Jadval yoki usul saqlanganda boshqa davomat qiymatlari saqlab qolinadi. Telefonda tugma bosilganda tegishli bo‘limga avtomatik o‘tiladi, ro‘yxatga qaytish tugmasi bor.

Hostingdagi `/admin/` sahifasi alohida o‘qish orqali tekshirildi: HTML’da `/admin-settings.js` va `/admin-settings.css` ulanishlari yo‘q. Shu sabab mahalliy yangi dizayn hostingda ko‘rinmagan. Hosting yangilanmadi; yangi fayllar bilan kodni Render’ga chiqarish talab qilinadi. Cache’ni tozalash hostingda mavjud bo‘lmagan kodni qo‘shmaydi.

Chrome sinovi tugmalar tartibini, PIN bo‘limini, ikkala qidiruvni, davomatni yoqish/o‘chirishni, jadval va usullarni saqlashni hamda tarixni chiqarishni tekshirdi. 11 ta sintaksis/regressiya/davomat testi ham o‘tdi. Ishchi bazaga sinov sozlamalari yozilmadi.

## Dizayn va qidiruv qayta ishlanishi

Sozlamalar ko‘rinishi qayta tuzildi: chapdagi kategoriya menyusi, o‘ngdagi ish maydoni, bir xil kartalar, ixcham maydonlar va yoqish/o‘chirish tugmalari. Telefon uchun alohida moslashuv mavjud.

Qidiruv endi butun shaklni ko‘rsatish o‘rniga alohida sozlamalar ro‘yxatini chiqaradi. Natijani bosganda tegishli bo‘lim ochiladi, maydon ajratiladi va unga fokus beriladi. Yuqoridagi admin qidiruvi ham sozlamalar ochilganda shu qidiruvga ulanadi. Oddiy va o‘zbekcha apostroflar bir xil talqin qilinadi; bir nechta so‘z bilan qidirish, tozalash tugmasi, Escape va bo‘sh natija holati mavjud. Maxfiy input qiymatlari qidiruv indeksiga kiritilmaydi.

Yangilangan Chrome sinovi 1440×1000 va 390×844 o‘lchamlarda qidiruv, natijaga o‘tish, menyu almashtirish, saqlash/bekor qilish va tiklashni tekshirdi. Qo‘shimcha 10 ta regressiya/API testi o‘tdi. Ko‘rinishlar: `artifacts/admin-settings/desktop.png`, `mobile.png`, `search.png`.

Adminning mavjud Sozlamalar bo‘limi kengaytirildi. Boshqa admin bo‘limlarining dizayni o‘zgartirilmadi. TV sozlamalari haqiqiy ekranga qo‘llanishi uchun unga sozlamalarni o‘qish ulanishi qo‘shildi.

## Interfeys

- 10 ta ichki bo‘lim: Restoran, Kassir va to‘lovlar, Ofitsant va buyurtmalar, Oshxona va TV, Printer va cheklar, Ombor, Telegram, Xavfsizlik, Zaxira nusxalari, O‘zgarishlar tarixi.
- Sozlama nomlari va izohlari bo‘yicha qidiruv. Qidiruv natijalari barcha bo‘limlardan ko‘rsatiladi.
- Kompyuterda ikki ustunli, telefonda bir ustunli maydonlar. Sozlamalar ochilganda mobil admin menyusi yig‘iladi va tugma bilan ochiladi. Boshqa bo‘limga chiqilganda avvalgi joylashuv tiklanadi.
- Ofitsant xizmat ruxsatlari endi shu yerda: ko‘rish doirasi, biriktirish, yetkazish, qaytarish/bekor qilish so‘rovi, stol ko‘chirish, smena topshirish, to‘lov olish, kassir va oshxona qarorlari.
- Faol buyurtmani chegirmalash yoki bekor qilish shakli sozlamalar ichidan chiqarildi. Mavjud buyurtmalarni boshqarish API va Xizmat amallari sahifasi saqlandi.

## Saqlash va tarix

- Asosiy sozlamalarda Saqlash / Bekor qilish, o‘zgargan maydon belgisi, saqlanmagan o‘zgarishlar soni va serverdan qayta yuklash bor.
- Bo‘limlar orasida o‘tilganda shakl qiymatlari saqlanadi. Sahifadan chiqishda saqlanmagan qiymatlar uchun brauzer ogohlantirishi bor. Qoralamalar localStorage’ga yozilmaydi.
- Foiz, miqdor va vaqt chegaralari hamda HTTPS logotip havolasi va vaqt mintaqasi tekshiriladi; xato tegishli maydon ostida ko‘rinadi. Saqlash davomida shaklga takroriy amal bajarilmaydi.
- Yangi admin shakllari joriy qiymatlarning versiyasini yuboradi. Server umumiy sozlama qulfi ichida solishtiradi: boshqa admin o‘zgartirgan bo‘lsa 409 qaytaradi va qoralama qoladi. Oldingi API mijozlari bilan moslik saqlangan.
- Tarixda kim, qachon, qaysi qiymatni o‘zgartirgani ko‘rinadi. Tiklashdan oldin joriy qiymatlar va tiklanadigan qiymatlar taqqoslanadi; tiklash ham versiyani tekshiradi.
- Xavfsizlik ruxsatlari endi checkbox bosilganda darhol yuborilmaydi: alohida Saqlash tugmasi bor. Bir nechta ruxsat alohida API amallari bilan saqlanadi; qisman xatoda saqlanganlar soni ko‘rsatiladi.
- Mavjud printer, PIN, ombor, Telegram va zaxira shakllari saqlangan. Ularga bekor qilish va o‘zgarishlarni kuzatish qo‘shilgan. Telegram va nusxa bo‘limlarining PIN bilan qulflanishi saqlangan.

## TV va xizmatlar

- TV’da tayyor taomlarni ko‘rsatish/yashirish, tayyorlik signali, matn kattaligi 70–150%, zaxira yangilanishi 5–120 soniya va oshxona bo‘limi filtri saqlanadi.
- 1/2/10 ta bo‘limning aniq belgilangan namuna ko‘rinishi va haqiqiy TV’ni ochish havolasi bor. Haqiqiy TV avtomatik joylashuvni davom ettiradi.
- Ovoz haqiqiy tayyorlik holati o‘zgarganda chiqadi. Brauzer ovozni faollashtirish uchun TV sahifasida bir marta bosishni talab qilishi mumkin; haqiqiy TV karnayida alohida tekshirish kerak.
- Printer, Telegram va nusxaning oxirgi qayd etilgan natijasi/vaqti, sozlanganligi hamda tegishli sinov/tekshirish shakliga o‘tish bor. Bu ko‘rsatkich qurilma ayni paytda onlayn ekanini bildirmaydi. Sinov tugmalari foydalanuvchi bosmaguncha xabar yoki chek yuborilmaydi.
- Xizmat ruxsatlari va TV sozlamalari biznes nusxasiga kiradi va tanlab tiklanadi. Eski nusxada mavjud bo‘lmagan bo‘lim tiklanmaydi.

## Tekshiruv va ishga tushirish

- TypeScript build va umumiy `npm run verify` o‘tdi — jami 136 test.
- `npm run test:admin:settings`: versiya bilan parallel saqlash, eskirgan yozishni rad etish, tiklash, admin ruxsati va TV chegaralari.
- `npm run test:admin:settings:ui`: haqiqiy Chrome’da 1440×1000 / 390×844; bo‘limlar, qidiruv, saqlash/bekor qilish, qoralama, xato qiymat, konflikt, xizmat ruxsatlari, TV namuna va tarixdan tiklash.
- `npm run test:kitchen:tv`: avtomatik 1/2/10 joylashuv, tayyor taom filtri, bo‘lim filtri, ekran o‘lchami, uzilish/qayta ulanish.

Brauzer va tranzaksiya sinovlari ishchi bazadan ajratilgan; sinov buyurtmasi, to‘lov yoki sozlama ishchi bazaga yozilmaydi. Haqiqiy PostgreSQL’da parallel yuk sinovi bajarilmadi. Yangi schema migratsiyasi kerak emas: mavjud AppSetting va SettingRevision jadvallari ishlatiladi. Asosiy tekshiruv jurnali `artifacts/admin-settings/verify.log`, tasvirlar shu katalogda.

Hostingga deploy, commit va push bajarilmadi. Server yangi buildni yuklashi uchun odatiy qayta ishga tushirish talab qilinadi.
