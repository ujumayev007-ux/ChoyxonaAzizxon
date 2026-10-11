# Ofitsant paneli — bajarilgan ishlar

2026-10-11, Toshkent vaqti.

Mavjud panel takomillashtirildi. Kassirning oldin tuzatilgan to‘lov oqimi saqlandi. Kod va Prisma klienti yangilandi; `20261011120000_waiter_service` migratsiyasi ulangan bazaga muvaffaqiyatli qo‘llandi. Reset va seed bajarilmadi.

## Ofitsant paneli

- Mijoz chaqiruvi autentifikatsiyadan keyin bazaga yoziladi. Mijoz va kassir chaqiruvlari alohida, holatlari va mas’ul xodimi bilan ko‘rsatiladi. Bir chaqiruvni ikki xodim egallashidan himoya bor. Faol chaqiruv tugaganda ogohlantirish yashiriladi.
- Mijoz buyurtmasini tasdiqlash va ofitsantga biriktirish bitta tranzaksiyada bajariladi. Tasdiqlangan, hali biriktirilmagan buyurtmani ham olish mumkin. Stolni biriktirish va bo‘shatish amallari bor.
- Har bir taomning tayyorlanish, tayyorlik, olib ketish va yetkazish holatlari alohida yuritiladi. Qisman tayyor taom yetkaziladi. Qo‘shimcha taomlar eski taomlarning holati va vaqtini o‘zgartirmaydi.
- Stol oynasida mehmonlar soni, mas’ul ofitsant va faol buyurtmalarning yagona hisobi ko‘rsatiladi: taomlar, xizmat haqi, chegirma, to‘lov, qaytarish, qarz va qoldiq. Stol tarixiga o‘tilganda filtr saqlanadi.
- Faol buyurtmalarda stol, xona, ofitsant, status va sana filtrlari; tarixda stol, sana va buyurtma raqami filtrlari hamda 30 tadan sahifalash bor.
- Savat, mehmonlar soni va izohlar foydalanuvchi hamda stol bo‘yicha qurilmada saqlanadi. Jonli yangilanish tanlangan stolni tozalamaydi. Yuborilmagan qoralama va serverda saqlangan buyurtma ajratiladi.
- Yangi buyurtma va qo‘shimcha taomlarda takroriy so‘rov himoyasi bor. Natijasi noma’lum yangi buyurtma ham sahifa qayta yuklanganda asl kalit va tarkib bilan tekshiriladi. Qo‘shimcha so‘rov ham qurilmada saqlanadi.
- Sevimli taomlar foydalanuvchi bo‘yicha saqlanadi; oxirgi 30 kunning ko‘p buyurtma qilingan taomlari ko‘rsatiladi. Tarixdan taomlarni amaldagi narx va mavjudlik bilan savatga qayta olish mumkin.
- Taom va chaqiruvlarning kutish taymeri, voqealar tarixi, oshxonaga izoh yuborish va izoh ko‘rilganining belgisi bor.
- Bugun yaratilgan buyurtmalar summasi va bugun kelib tushgan pul alohida ko‘rsatiladi. Komissiya bugungi tushumdan qaytarishlar ayirilgan holda hisoblanadi. Smena xulosasi va ruxsatli topshirish oqimi bor.
- Telefon hamburger menyusidan barcha yetti bo‘lim, jumladan yangi buyurtma va hisoblar ochiladi.

## Kassir, oshxona va admin

Ushbu panellardagi **Xizmat amallari** havolasi `/service.html` sahifasini ochadi.

- Kassir/admin qaytarish va bekor qilish so‘rovini sabab bilan tasdiqlaydi yoki rad etadi. Oshxona faqat ruxsat berilgan bekor qilish so‘rovlariga qaror beradi.
- To‘lanmagan taomni qaytarish hisobni kamaytiradi. To‘langan taomni qaytarish haqiqiy `Refund`, qaytarilgan miqdor va tegishli kassa harakatini saqlaydi. Oldingi qaytarishlar hisobga olinadi; ortiqcha miqdor va summa rad etiladi.
- Omborga qaytarish avtomatik emas. Admin yaroqli mahsulotni, ombor birligidagi miqdorni va sababni alohida tanlaydi; ombor harakati auditga yoziladi.
- Kassir chaqiruvni qabul qiladi va yakunlaydi. Ofitsant kassir chaqiruvini o‘zi egallay olmaydi.
- Oshxona taomlarni alohida tayyorlaydi, izohni ko‘rganini belgilaydi va javob izohi yuboradi. Tayyor taomni olib ketish va yetkazish ofitsantda qoladi.
- Oshxona/admin vaqtincha sotuvda yo‘q taomlarni boshqaradi. Ofitsant va mijozga bu holat ko‘rinadi; server ham bunday taomni yangi buyurtmaga qabul qilmaydi.
- Admin ishlash doirasi, biriktirish, yetkazish, qaytarish/bekor qilish, stol ko‘chirish, ofitsant almashtirish, smena topshirish, to‘lov olish va ko‘rib chiqish vakolatlarini sozlaydi. Kechikish chegarasi 1–240 daqiqa.

Stol ko‘chirish, boshqa ofitsantga topshirish va ofitsantning to‘lov olishi dastlab o‘chirilgan; admin ularni zaruratga qarab yoqadi. Kassirning odatiy to‘lov vakolati saqlanadi.

## Izchillik va tekshiruvlar

Muhim amallar tranzaksiya, buyurtma qatori qulfi, eski `updatedAt`ni tekshirish va takroriy so‘rov kaliti bilan himoyalangan. Smena topshirish yaratish/biriktirish oqimlari bilan bir xil ofitsant qulflaridan foydalanadi. Kassir bandligi va moliyaviy muzlatilgan buyurtmalar tekshiriladi. Biznes summalari serverda `Prisma.Decimal` orqali hisoblanadi.

- `npm run verify`: Prisma validatsiyasi, klient yaratish, TypeScript build, 51 kassir to‘lov testi, 29 eski buyurtma/stol to‘lov testi, 54 buyurtma va regressiya testi o‘tdi — jami 134 test.
- Yangi xizmat oqimlarining 21 testi: parallel tasdiqlash, qisman tayyorlik/yetkazish, qisman qaytarish, to‘lanmagan qaytarish, qarz/smena cheklovi, ombor qarori, Telegram HMAC, parallel chaqiruv, ruxsatlar, ko‘chirish, smena topshirish va uzilgan so‘rovni takrorlash.
- `npm run test:waiter:ui`: haqiqiy Chrome’da 1440×1000 va 390×844 ko‘rinishlar tekshirildi. Savat tiklanishi, taom izohi, tanlangan stol, sotuvda yo‘q taom, uzilgan so‘rov, yetkazish, stol hisobi/tarixi, chaqiruv va kassir/admin amallari ishladi. Brauzerda JavaScript bajarilish xatosi chiqmadi.
- Mavjud bazada yangi config, staff, menu, orders, history, summary, requests, calls va table bill API’lari faqat o‘qish orqali tekshirildi. Sinov to‘lovlari va sinov buyurtmalari ishchi bazaga yozilmadi.
- `prisma migrate status`: barcha 16 migratsiya qo‘llangan, sxema dolzarb.

Brauzer testlari ishlab turgan bazadan ajratilgan API fixture’larini ishlatadi. Backend testlari haqiqiy Express ishlovchilarini tranzaksiyali Prisma test modeli bilan bajaradi; haqiqiy PostgreSQL’da parallel yozish yuk sinovi bajarilmadi.

Brauzer testini takrorlash uchun Chrome va `playwright` paketi kerak. Ushbu tekshiruvda paket loyihaning dependency ro‘yxatini o‘zgartirmasdan vaqtinchalik katalogga o‘rnatildi:

```powershell
npm install --prefix "$env:TEMP/choyxona-ui-qa" playwright --no-save --package-lock=false
npm run test:waiter:ui
```

Tekshiruv jurnali: `artifacts/waiter-service/verify.log`. Ekran tasvirlari ham shu katalogda.

## Amaliy chegaralar

- Mijoz chaqiruvi mavjud Telegram WebApp sessiyasini talab qiladi. Telegramsiz brauzer uchun alohida mijoz sessiyasi joriy qilinmadi.
- Ovoz brauzerning autoplay qoidalariga bog‘liq; odatda sahifada birinchi bosishdan keyin ishlaydi. Vibratsiya faqat qurilma/brauzer qo‘llasa bajariladi. Haqiqiy telefonning ovozi va vibratsiyasi alohida sinovdan o‘tkazilmadi.
- Mehmonlar soni buyurtmada kiritilgan sonlar yig‘indisi; alohida tashrif/sessiya modeli yo‘q. Bir guruhga bir nechta buyurtma yozilganda mehmonlar sonini shu ma’noda talqin qilish kerak.
- Savat va sevimli taomlar shu qurilmaning localStorage’ida saqlanadi, boshqa qurilmaga avtomatik ko‘chmaydi.
- Yagona hisob faol buyurtmalar uchun; to‘langan buyurtmalar stol filtrli tarixda ochiladi.
- So‘rovlar sahifasida 200 ta yozuv, chaqiruv tarixida 100 ta yozuv ko‘rsatiladi. Qaror kutilayotgan so‘rovlar eng eskisidan boshlanadi.

Commit, push va ilovani hostingga deploy qilish bajarilmadi. Ishlayotgan server yangi buildni yuklashi uchun odatiy ishga tushirish/qayta ishga tushirish kerak.
