import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

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
      data: { name }
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
    await prisma.room.delete({
      where: { id: Number(id) }
    });
    res.json({ message: "Xona muvaffaqiyatli o'chirildi" });
  } catch (error) {
    res.status(500).json({ error: "Xonani o'chirishda xatolik yuz berdi" });
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
