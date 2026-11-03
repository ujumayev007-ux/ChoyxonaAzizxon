# Azizxon — Windows o'rnatish qo'llanmasi (test relizi)

Har bir rol uchun alohida o'rnatuvchi bor:

| Fayl | Vazifasi |
|------|----------|
| `Admin-Setup.exe` | Restoran administratsiyasi (Admin.exe) |
| `Kassa-Setup.exe` | Kassir va to'lovlar (Kassa.exe) |
| `Ofitsiant-Setup.exe` | Ofitsiant buyurtmalari (Ofitsiant.exe) |
| `Oshxona-Setup.exe` | Oshxona boshqaruvi (Oshxona.exe) |
| `Owner-Setup.exe` | SaaS egasi boshqaruvi (Owner.exe) |
| `TV-Setup.exe` | Mijozlar uchun buyurtma navbati (TV.exe) |

## O'rnatish
1. Kerakli rolning `-Setup.exe` faylini shu kompyuterga ko'chiring.
2. Faylni ikki marta bosing. Windows "SmartScreen" ogohlantirishi chiqsa (test reliz imzolanmagan): **Qo'shimcha ma'lumot → Baribir ishga tushirish**.
3. O'rnatish papkasini tanlang va **Install** ni bosing. Ish stolida yorliq paydo bo'ladi.

## Birinchi ishga tushirish
- Ilova restoran serverini o'zi **LAN (Wi-Fi/kabel) orqali avtomatik topadi**. Kompyuter server bilan bir tarmoqda bo'lishi kerak.
- Bir nechta restoran topilsa, o'zingizniki tanlanadi va eslab qolinadi.
- Aloqa uzilsa, ilova avtomatik qayta ulanadi (pastki o'ng burchakda holat ko'rinadi).
- Admin, Kassa, Ofitsiant, Oshxona: xodim o'z **PIN-kodi** bilan kiradi.
- Yangi qurilma **Super Owner (Owner ilovasi) tomonidan tasdiqlanishi** kerak.
- **TV**: xodim kirishisiz **to'liq ekranda** ochiladi, lekin qurilma Owner tomonidan tasdiqlangan bo'lishi shart. Yopish: `Alt+F4`.

## Fayl yaxlitligini tekshirish
PowerShell:

```powershell
Get-FileHash .\Kassa-Setup.exe -Algorithm SHA256
```

Natijani `SHA256SUMS.txt` dagi qiymat bilan solishtiring.

## O'chirish
Sozlamalar → Ilovalar → "Azizxon …" → O'chirish.
