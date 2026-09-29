import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import path from 'path';

dotenv.config();

const app = express();
const server = http.createServer(app);
const prisma = new PrismaClient(); // Prisma client ni ishga tushiramiz

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE"]
  }
});

app.use(cors());
app.use(express.json());

// Statik papkani ulaymiz (admin, cashier, waiter, kitchen, customer)
app.use(express.static(path.join(__dirname, '../public')));

// Asosiy tekshiruv yo'li
app.get('/', (req, res) => {
  res.json({ message: "Azamatjon & Umidjon Restarani API ishlayapti!" });
});

// ==========================================
// XONALAR (ROOMS) UCHUN CRUD API'LARI
// ==========================================

// 1. Barcha xonalarni va ularga tegishli stollarni olish
app.get('/api/rooms', async (req, res) => {
  try {
    const rooms = await prisma.room.findMany({
      include: { tables: true }
    });
    res.json(rooms);
  } catch (error) {
    res.status(500).json({ error: "Xonalarni olishda xatolik yuz berdi" });
  }
});

// 2. Yangi xona qo'shish
app.post('/api/rooms', async (req, res) => {
  try {
    const { name } = req.body;
    const newRoom = await prisma.room.create({
      data: { name: name as any }
    });
    res.json(newRoom);
  } catch (error) {
    res.status(500).json({ error: "Xona qo'shishda xatolik yuz berdi" });
  }
});

// 3. Xonani o'chirish
app.delete('/api/rooms/:id', async (req, res) => {
  try {
    const { id } = req.params;
    // Avval xonaga tegishli stollarni o'chiramiz (Foreign key xatoligi chiqmasligi uchun)
    await prisma.table.deleteMany({ where: { roomId: Number(id) as any } });
    await prisma.room.delete({ where: { id: Number(id) as any } });
    res.json({ message: "Xona o'chirildi" });
  } catch (error) {
    res.status(500).json({ error: "Xonani o'chirishda xatolik" });
  }
});

// 4. Stol qo'shish (Xonaga tegishli)
app.post('/api/tables', async (req, res) => {
  try {
    const { number, roomId } = req.body;
    const newTable = await prisma.table.create({
      data: {
        number: Number(number) as any,
        roomId: Number(roomId) as any,
        status: 'EMPTY' // Bo'sh holatda boshlanadi
      }
    });
    res.json(newTable);
  } catch (error) {
    res.status(500).json({ error: "Stol qo'shishda xatolik" });
  }
});

// 5. Stolni o'chirish
app.delete('/api/tables/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.table.delete({ where: { id: Number(id) as any } });
    res.json({ message: "Stol o'chirildi" });
  } catch (error) {
    res.status(500).json({ error: "Stolni o'chirishda xatolik" });
  }
});

// ==========================================
// SOCKET.IO QISMI
// ==========================================
io.on('connection', (socket) => {
  console.log(`Foydalanuvchi ulandi: ${socket.id}`);

  // Stol uchun ofitsiant chaqirish
  socket.on('call_waiter', (data) => {
    console.log('Ofitsiant chaqirildi:', data);
    io.emit('waiter_called', data);
  });

  // Yangi buyurtma kelganda oshxonaga xabar berish
  socket.on('new_order', (order) => {
    console.log('Yangi buyurtma:', order);
    io.emit('kitchen_new_order', order);
  });

  socket.on('disconnect', () => {
    console.log(`Foydalanuvchi chiqib ketdi: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server ${PORT}-portda ishga tushdi!`);
});
