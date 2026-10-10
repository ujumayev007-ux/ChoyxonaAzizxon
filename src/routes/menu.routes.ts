import { Prisma, RoleType } from '@prisma/client';
import express from 'express';
import { authenticateToken, optionalAuthenticateToken, requireRole } from '../middleware/auth';
import { emitSocketEvent } from '../socket';
import { prisma } from '../utils/db';
import { convertQuantity } from '../utils/units';

const router = express.Router();
const decimalPattern = /^\d{1,12}(?:\.\d{1,6})?$/;

function imageUrlValue(value: unknown): string | null | undefined {
    if (value === null || value === '') return null;
    if (typeof value !== 'string' || value.length > 2048) return undefined;
    if (/^\/(?!\/)[\w./%-]+$/.test(value)) return value;
    try {
        const url = new URL(value);
        return url.protocol === 'https:' || url.protocol === 'http:' ? value : undefined;
    } catch {
        return undefined;
    }
}

function validItemName(value: unknown): value is string {
    return typeof value === 'string' && Boolean(value.trim()) && value.trim().length <= 100;
}

router.get('/categories/public', async (_req, res) => {
    try {
        const categories = await prisma.menuCategory.findMany({
            where: { isActive: true },
            orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
            select: { id: true, name: true, sortOrder: true }
        });
        res.json(categories);
    } catch (error) {
        console.error('Ochiq menyu kategoriyalarini olishda xatolik:', error);
        res.status(500).json({ success: false, message: 'Menyu kategoriyalarini olishda xatolik' });
    }
});

router.get('/categories', authenticateToken, requireRole(['ADMIN']), async (_req, res) => {
    try {
        const categories = await prisma.menuCategory.findMany({
            orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
            include: { _count: { select: { menuItems: true } } }
        });
        res.json(categories);
    } catch (error) {
        console.error('Menyu kategoriyalarini olishda xatolik:', error);
        res.status(500).json({ success: false, message: 'Menyu kategoriyalarini olishda xatolik' });
    }
});

router.post('/categories', authenticateToken, requireRole(['ADMIN']), async (req, res) => {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const sortOrder = req.body?.sortOrder === undefined ? null : Number(req.body.sortOrder);
    if (!name || name.length > 80 || (sortOrder !== null && (!Number.isInteger(sortOrder) || sortOrder < 0))) {
        res.status(400).json({ success: false, message: 'Kategoriya ma’lumotlarini to‘g‘ri kiriting' });
        return;
    }
    try {
        const duplicate = await prisma.menuCategory.findFirst({
            where: { name: { equals: name, mode: 'insensitive' } },
            select: { id: true }
        });
        if (duplicate) {
            res.status(409).json({ success: false, message: 'Bunday kategoriya mavjud' });
            return;
        }
        const highest = await prisma.menuCategory.aggregate({ _max: { sortOrder: true } });
        const category = await prisma.menuCategory.create({
            data: { name, sortOrder: sortOrder ?? (highest._max.sortOrder || 0) + 10 }
        });
        emitSocketEvent('menu_updated', { kind: 'category', categoryId: category.id });
        res.status(201).json({ success: true, data: category });
    } catch (error) {
        console.error('Menyu kategoriyasini yaratishda xatolik:', error);
        res.status(500).json({ success: false, message: 'Kategoriya yaratilmadi' });
    }
});

router.patch('/categories/:id', authenticateToken, requireRole(['ADMIN']), async (req, res) => {
    const data: Prisma.MenuCategoryUpdateInput = {};
    let categoryName: string | undefined;
    if (req.body?.name !== undefined) {
        if (typeof req.body.name !== 'string' || !req.body.name.trim() || req.body.name.trim().length > 80) {
            res.status(400).json({ success: false, message: 'Kategoriya nomini to‘g‘ri kiriting' });
            return;
        }
        categoryName = req.body.name.trim();
        data.name = categoryName;
    }
    if (req.body?.sortOrder !== undefined) {
        const sortOrder = Number(req.body.sortOrder);
        if (!Number.isInteger(sortOrder) || sortOrder < 0) {
            res.status(400).json({ success: false, message: 'Tartib raqamini to‘g‘ri kiriting' });
            return;
        }
        data.sortOrder = sortOrder;
    }
    if (req.body?.isActive !== undefined) {
        if (typeof req.body.isActive !== 'boolean') {
            res.status(400).json({ success: false, message: 'Kategoriya holati noto‘g‘ri' });
            return;
        }
        data.isActive = req.body.isActive;
    }
    if (!Object.keys(data).length) {
        res.status(400).json({ success: false, message: 'O‘zgartiriladigan ma’lumot topilmadi' });
        return;
    }
    try {
        if (categoryName) {
            const duplicate = await prisma.menuCategory.findFirst({
                where: { name: { equals: categoryName, mode: 'insensitive' }, id: { not: req.params.id } },
                select: { id: true }
            });
            if (duplicate) {
                res.status(409).json({ success: false, message: 'Bunday kategoriya mavjud' });
                return;
            }
        }
        const category = await prisma.menuCategory.update({ where: { id: req.params.id }, data });
        emitSocketEvent('menu_updated', { kind: 'category', categoryId: category.id });
        res.json({ success: true, data: category });
    } catch (error) {
        console.error('Menyu kategoriyasini yangilashda xatolik:', error);
        res.status(404).json({ success: false, message: 'Kategoriya topilmadi yoki yangilanmadi' });
    }
});

router.delete('/categories/:id', authenticateToken, requireRole(['ADMIN']), async (req, res) => {
    try {
        const result = await prisma.$transaction(async tx => {
            const category = await tx.menuCategory.findUnique({
                where: { id: req.params.id },
                select: { id: true, _count: { select: { menuItems: true } } }
            });
            if (!category) return { kind: 'missing' as const };
            if (category._count.menuItems > 0) return { kind: 'linked' as const };
            await tx.menuCategory.delete({ where: { id: category.id } });
            return { kind: 'deleted' as const };
        });
        if (result.kind === 'missing') {
            res.status(404).json({ success: false, message: 'Kategoriya topilmadi' });
            return;
        }
        if (result.kind === 'linked') {
            res.status(409).json({ success: false, message: 'Taomlar ulangan kategoriyani o‘chirib bo‘lmaydi' });
            return;
        }
        emitSocketEvent('menu_updated', { kind: 'category', categoryId: req.params.id });
        res.json({ success: true });
    } catch (error) {
        console.error('Menyu kategoriyasini o‘chirishda xatolik:', error);
        res.status(409).json({ success: false, message: 'Kategoriya o‘chirilmadi; avval bog‘langan taomlarni tekshiring' });
    }
});

router.get('/', optionalAuthenticateToken, async (req, res) => {
    try {
        const menuItems = req.user?.role === RoleType.ADMIN
            ? await prisma.menuItem.findMany({
                include: { category: true, recipes: { include: { inventory: true } } }
            })
            : await prisma.menuItem.findMany({
                where: { isActive: true, category: { isActive: true } },
                select: {
                    id: true, name: true, description: true, imageUrl: true, sellingPrice: true,
                    unit: true, preparationTime: true, kitchenSection: true, categoryId: true, isActive: true,
                    category: { select: { id: true, name: true } }
                }
            });
        res.json(menuItems);
    } catch (error) {
        console.error('Menyuni olishda xatolik:', error);
        res.status(500).json({ success: false, message: 'Menyuni olib kelishda xatolik' });
    }
});

router.post('/', authenticateToken, requireRole(['ADMIN']), async (req, res) => {
    const { name, categoryId, description, sellingPrice, internalCostPrice, unit, preparationTime, kitchenSection } = req.body || {};
    const imageUrl = req.body?.imageUrl === undefined ? null : imageUrlValue(req.body.imageUrl);
    if (!validItemName(name) || typeof categoryId !== 'string' || !categoryId ||
        !Number.isFinite(Number(sellingPrice)) || Number(sellingPrice) < 0 ||
        (internalCostPrice !== undefined && (!Number.isFinite(Number(internalCostPrice)) || Number(internalCostPrice) < 0)) ||
        (preparationTime !== undefined && (!Number.isInteger(Number(preparationTime)) || Number(preparationTime) < 0)) ||
        (req.body?.imageUrl !== undefined && imageUrl === undefined)) {
        res.status(400).json({ success: false, message: 'Menyu ma’lumotlari noto‘g‘ri' });
        return;
    }
    try {
        const category = await prisma.menuCategory.findUnique({ where: { id: categoryId }, select: { id: true } });
        if (!category) {
            res.status(400).json({ success: false, message: 'Menyu kategoriyasi topilmadi' });
            return;
        }
        const menuItem = await prisma.menuItem.create({
            data: {
                name: name.trim(),
                categoryId,
                description: typeof description === 'string' && description.trim() ? description.trim().slice(0, 500) : null,
                sellingPrice: Number(sellingPrice),
                ...(internalCostPrice !== undefined ? { internalCostPrice: Number(internalCostPrice) } : {}),
                ...(typeof unit === 'string' && unit.trim() ? { unit: unit.trim().slice(0, 30) } : {}),
                ...(preparationTime !== undefined ? { preparationTime: Number(preparationTime) } : {}),
                ...(typeof kitchenSection === 'string' && kitchenSection.trim() ? { kitchenSection: kitchenSection.trim().slice(0, 80) } : {}),
                imageUrl
            },
            include: { category: true, recipes: { include: { inventory: true } } }
        });
        emitSocketEvent('menu_updated', { kind: 'item', menuItemId: menuItem.id });
        res.status(201).json({ success: true, data: menuItem });
    } catch (error) {
        console.error('Menyu taomini qo‘shishda xatolik:', error);
        res.status(500).json({ success: false, message: 'Taom qo‘shilmadi' });
    }
});

router.patch('/:id', authenticateToken, requireRole(['ADMIN']), async (req, res) => {
    const data: Prisma.MenuItemUncheckedUpdateInput = {};
    const body = req.body || {};
    if (body.name !== undefined) {
        if (!validItemName(body.name)) {
            res.status(400).json({ success: false, message: 'Taom nomini to‘g‘ri kiriting' });
            return;
        }
        data.name = body.name.trim();
    }
    if (body.categoryId !== undefined) {
        if (typeof body.categoryId !== 'string' || !body.categoryId) {
            res.status(400).json({ success: false, message: 'Menyu kategoriyasi topilmadi' });
            return;
        }
        data.categoryId = body.categoryId;
    }
    if (body.description !== undefined) {
        if (body.description !== null && typeof body.description !== 'string') {
            res.status(400).json({ success: false, message: 'Taom tavsifi noto‘g‘ri' });
            return;
        }
        data.description = typeof body.description === 'string' && body.description.trim()
            ? body.description.trim().slice(0, 500) : null;
    }
    for (const field of ['sellingPrice', 'internalCostPrice'] as const) {
        if (body[field] === undefined) continue;
        if (!Number.isFinite(Number(body[field])) || Number(body[field]) < 0) {
            res.status(400).json({ success: false, message: 'Taom narxini to‘g‘ri kiriting' });
            return;
        }
        data[field] = Number(body[field]);
    }
    if (body.unit !== undefined) {
        if (typeof body.unit !== 'string' || !body.unit.trim() || body.unit.trim().length > 30) {
            res.status(400).json({ success: false, message: 'O‘lchov birligini to‘g‘ri kiriting' });
            return;
        }
        data.unit = body.unit.trim();
    }
    if (body.preparationTime !== undefined) {
        if (!Number.isInteger(Number(body.preparationTime)) || Number(body.preparationTime) < 0) {
            res.status(400).json({ success: false, message: 'Tayyorlash vaqtini to‘g‘ri kiriting' });
            return;
        }
        data.preparationTime = Number(body.preparationTime);
    }
    if (body.kitchenSection !== undefined) {
        if (typeof body.kitchenSection !== 'string' || !body.kitchenSection.trim() || body.kitchenSection.trim().length > 80) {
            res.status(400).json({ success: false, message: 'Oshxona bo‘limini to‘g‘ri kiriting' });
            return;
        }
        data.kitchenSection = body.kitchenSection.trim();
    }
    if (body.isActive !== undefined) {
        if (typeof body.isActive !== 'boolean') {
            res.status(400).json({ success: false, message: 'Menyu holati noto‘g‘ri' });
            return;
        }
        data.isActive = body.isActive;
    }
    if (body.imageUrl !== undefined) {
        const imageUrl = imageUrlValue(body.imageUrl);
        if (imageUrl === undefined) {
            res.status(400).json({ success: false, message: 'Rasm manzili noto‘g‘ri' });
            return;
        }
        data.imageUrl = imageUrl;
    }
    if (!Object.keys(data).length) {
        res.status(400).json({ success: false, message: 'O‘zgartiriladigan ma’lumot topilmadi' });
        return;
    }
    try {
        if (typeof body.categoryId === 'string' &&
            !await prisma.menuCategory.findUnique({ where: { id: body.categoryId }, select: { id: true } })) {
            res.status(400).json({ success: false, message: 'Menyu kategoriyasi topilmadi' });
            return;
        }
        const menuItem = await prisma.menuItem.update({
            where: { id: req.params.id },
            data,
            include: { category: true, recipes: { include: { inventory: true } } }
        });
        emitSocketEvent('menu_updated', { kind: 'item', menuItemId: menuItem.id });
        res.json({ success: true, data: menuItem });
    } catch (error) {
        console.error('Menyu taomini yangilashda xatolik:', error);
        res.status(404).json({ success: false, message: 'Taom topilmadi yoki yangilanmadi' });
    }
});

router.get('/:id/recipes', authenticateToken, requireRole(['ADMIN']), async (req, res) => {
    try {
        const recipes = await prisma.recipe.findMany({
            where: { menuItemId: req.params.id },
            include: { inventory: { select: { id: true, name: true, unit: true, isActive: true } } },
            orderBy: { inventory: { name: 'asc' } }
        });
        res.json(recipes);
    } catch (error) {
        console.error('Taom retseptini olishda xatolik:', error);
        res.status(500).json({ success: false, message: 'Taom retseptini olib bo‘lmadi' });
    }
});

router.put('/:id/recipes', authenticateToken, requireRole(['ADMIN']), async (req, res) => {
    const submitted: unknown = req.body?.items;
    if (!Array.isArray(submitted) || submitted.length > 100) {
        res.status(400).json({ success: false, message: 'Retsept tarkibi noto‘g‘ri' });
        return;
    }
    try {
        const result = await prisma.$transaction(async tx => {
            const menuItem = await tx.menuItem.findUnique({ where: { id: req.params.id }, select: { id: true } });
            if (!menuItem) throw new Error('MENU_ITEM_NOT_FOUND');
            const inventoryIds = new Set<string>();
            const parsed: { inventoryId: string; quantity: Prisma.Decimal; unit: string }[] = [];
            for (const entry of submitted) {
                if (!entry || typeof entry !== 'object') throw new Error('RECIPE_ITEM_INVALID');
                const item = entry as { inventoryId?: unknown; quantity?: unknown; unit?: unknown };
                const quantityText = String(item.quantity ?? '');
                if (typeof item.inventoryId !== 'string' || !item.inventoryId ||
                    typeof item.unit !== 'string' || !item.unit.trim() || item.unit.trim().length > 30 ||
                    !decimalPattern.test(quantityText) || inventoryIds.has(item.inventoryId)) {
                    throw new Error('RECIPE_ITEM_INVALID');
                }
                const quantity = new Prisma.Decimal(quantityText);
                if (!quantity.isFinite() || !quantity.greaterThan(0)) throw new Error('RECIPE_ITEM_INVALID');
                inventoryIds.add(item.inventoryId);
                parsed.push({ inventoryId: item.inventoryId, quantity, unit: item.unit.trim() });
            }
            const products = inventoryIds.size ? await tx.inventoryProduct.findMany({
                where: { id: { in: [...inventoryIds] }, isActive: true },
                select: { id: true, unit: true }
            }) : [];
            if (products.length !== inventoryIds.size) throw new Error('RECIPE_INVENTORY_INVALID');
            const productsById = new Map(products.map(product => [product.id, product]));
            const recipeRows = parsed.map(item => {
                const product = productsById.get(item.inventoryId)!;
                const stockQuantity = convertQuantity(item.quantity, item.unit, product.unit);
                if (!stockQuantity.isFinite() || !stockQuantity.greaterThan(0)) throw new Error('RECIPE_ITEM_INVALID');
                return {
                    menuItemId: menuItem.id,
                    inventoryId: item.inventoryId,
                    quantity: item.quantity,
                    unit: item.unit
                };
            });
            await tx.recipe.deleteMany({ where: { menuItemId: menuItem.id } });
            if (recipeRows.length) await tx.recipe.createMany({ data: recipeRows });
            return tx.recipe.findMany({
                where: { menuItemId: menuItem.id },
                include: { inventory: { select: { id: true, name: true, unit: true, isActive: true } } },
                orderBy: { inventory: { name: 'asc' } }
            });
        });
        emitSocketEvent('menu_updated', { kind: 'recipe', menuItemId: req.params.id });
        res.json({ success: true, data: result });
    } catch (error) {
        if (error instanceof Error && error.message === 'RECIPE_UNIT_INCOMPATIBLE') {
            res.status(400).json({ success: false, message: 'Retsept va ombor mahsuloti o‘lchov birliklari mos emas' });
            return;
        }
        if (error instanceof Error && error.message === 'MENU_ITEM_NOT_FOUND') {
            res.status(404).json({ success: false, message: 'Menyu taomi topilmadi' });
            return;
        }
        if (error instanceof Error && error.message === 'RECIPE_INVENTORY_INVALID') {
            res.status(400).json({ success: false, message: 'Retseptdagi ombor mahsuloti topilmadi yoki faol emas' });
            return;
        }
        if (error instanceof Error && error.message === 'RECIPE_ITEM_INVALID') {
            res.status(400).json({ success: false, message: 'Retsept tarkibidagi mahsulot yoki miqdor noto‘g‘ri' });
            return;
        }
        console.error('Taom retseptini saqlashda xatolik:', error);
        res.status(500).json({ success: false, message: 'Taom retseptini saqlab bo‘lmadi' });
    }
});

export default router;
