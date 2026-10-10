# ChoyxonaAzizxon

## Render deployment

`npm run migrate:deploy` migratsiyalar uchun `DIRECT_URL` qiymatidan foydalanadi. U berilmagan bo‘lsa, Neon `DATABASE_URL` manzilidagi `-pooler` qismini faqat migratsiya jarayoni uchun olib tashlaydi. Ilova pooled ulanishda ishlashda davom etadi. Migratsiya qulfi o‘chirilmaydi; bir vaqtning o‘zida bitta deploy bajaring.

Build uchun TypeScript va `@types/*` paketlari kerak. Loyihadagi `.npmrc` fayli `include=dev` orqali `NODE_ENV=production` holatida ham ularning o‘rnatilishini ta’minlaydi.

Configure the Render Node service with Build Command `npm install && npm run build`, Pre-Deploy Command `npm run migrate:deploy`, and Start Command `npm start`. Set `DATABASE_URL` and a stable, high-entropy `AUTH_SECRET` in the service environment. If the database has no administrator account yet, also set `INITIAL_ADMIN_USERNAME` and a unique `INITIAL_ADMIN_PASSWORD` of at least 12 characters for first-start provisioning; remove the initial password variable after the account is created. The pre-deploy command applies pending Prisma migrations before the server starts; the room/table uniqueness migration will stop deployment if the existing database contains duplicate table numbers in the same room, so resolve those duplicates without deleting tables before deploying.
