# ChoyxonaAzizxon

## Render deployment

Configure the Render Node service to build with `npm install && npm run build` and start with `npm start`. Set `DATABASE_URL` and a stable, high-entropy `AUTH_SECRET` in the service environment. If the database has no administrator account yet, also set `INITIAL_ADMIN_USERNAME` and a unique `INITIAL_ADMIN_PASSWORD` of at least 12 characters for first-start provisioning; remove the initial password variable after the account is created. `npm start` applies pending Prisma migrations before starting the server; the room/table uniqueness migration will stop deployment if the existing database contains duplicate table numbers in the same room, so resolve those duplicates without deleting tables before deploying.