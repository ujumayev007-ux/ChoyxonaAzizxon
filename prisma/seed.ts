import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Eski ma'lumotlarni tozalash (xohishga ko'ra)
  await prisma.menuItem.deleteMany();
  await prisma.menuCategory.deleteMany();
  await prisma.table.deleteMany();
  await prisma.room.deleteMany();

  // 1. Xonalar va stollar (12 ta xona va Asosiy zaldagi 16 ta stol misoli)
  // Admin panelda bularni keyinchalik qo'shish/tahrirlash imkoniyati bo'ladi.
  const asosiyZal = await prisma.room.create({
    data: {
      name: 'Asosiy Zal',
      tables: {
        create: Array.from({ length: 16 }, (_, index) => ({
          number: String(index + 1),
          qrCodeToken: `table_${crypto.randomUUID()}`,
          capacity: 4,
        })),
      },
    },
  });

  // Qolgan 11 ta xonani ham oddiy holatda yaratib qo'yamiz (har birida 4 tadan stol bilan)
  for (let i = 2; i <= 12; i++) {
    await prisma.room.create({
      data: {
        name: `${i}-Xona (VIP / Kabinet)`,
        tables: {
          create: [
            { number: '1', qrCodeToken: `table_${crypto.randomUUID()}`, capacity: 6 },
            { number: '2', qrCodeToken: `table_${crypto.randomUUID()}`, capacity: 8 },
          ],
        },
      },
    });
  }

  // 2. Kategoriyalar
  const categories = ['Osh', 'Asosiy', 'Kaboblar', 'Somsalar', 'Saladlar', 'Baliq'];

  const createdCategories: { [key: string]: string } = {};

  for (const catName of categories) {
    const cat = await prisma.menuCategory.create({
      data: { name: catName },
    });
    createdCategories[catName] = cat.id;
  }

  // 3. Boshlang'ich taomlar (menyuni keyin o'zingiz kengaytirasiz)
  await prisma.menuItem.create({
    data: {
      name: 'Toshkent Oshi',
      categoryId: createdCategories['Osh'],
      description: 'Anʼanaviy bayram oshi',
      sellingPrice: 35000,
      internalCostPrice: 20000,
      unit: 'porsiya',
      preparationTime: 20,
      kitchenSection: 'Oshxona',
    },
  });

  await prisma.menuItem.create({
    data: {
      name: 'Tandir Somsa',
      categoryId: createdCategories['Somsalar'],
      description: 'Qo\'y go\'shtidan tandir somsa',
      sellingPrice: 12000,
      internalCostPrice: 7000,
      unit: 'dona',
      preparationTime: 15,
      kitchenSection: 'Tandirxona',
    },
  });

  await prisma.menuItem.create({
    data: {
      name: 'Qo\'y Jo\'ja Kabob',
      categoryId: createdCategories['Kaboblar'],
      description: 'Sarxil go\'shtdan shashlik',
      sellingPrice: 25000,
      internalCostPrice: 15000,
      unit: 'porsiya',
      preparationTime: 20,
      kitchenSection: 'Shashlikxona',
    },
  });

  console.log('Demo ma\'lumotlar (12 ta xona, stollar va yangi kategoriyalar) muvaffaqiyatli qo\'shildi!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
