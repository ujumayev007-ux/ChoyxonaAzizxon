import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const server = http.createServer(app);
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

// Socket.io ulanishlarini boshqarish (Ofitsiant chaqiruv, oshxona va buyurtmalar uchun)
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
