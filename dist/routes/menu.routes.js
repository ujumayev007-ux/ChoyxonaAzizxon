"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const express_1 = __importDefault(require("express"));
const auth_1 = require("../middleware/auth");
const socket_1 = require("../socket");
const db_1 = require("../utils/db");
const units_1 = require("../utils/units");
const router = express_1.default.Router();
const decimalPattern = /^\d{1,12}(?:\.\d{1,6})?$/;
function imageUrlValue(value) {
    if (value === null || value === '')
        return null;
    if (typeof value !== 'string' || value.length > 2048)
        return undefined;
    if (/^\/(?!\/)[\w./%-]+$/.test(value))
        return value;
    try {
        const url = new URL(value);
        return url.protocol === 'https:' || url.protocol === 'http:' ? value : undefined;
    }
    catch {
        return undefined;
    }
}
function validItemName(value) {
    return typeof value === 'string' && Boolean(value.trim()) && value.trim().length <= 100;
}
router.get('/categories/public', async (_req, res) => {
    try {
        const categories = await db_1.prisma.menuCategory.findMany({
            where: {},
            orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
            select: { id: true, name: true, sortOrder: true }
        });
        res.json(categories);
    }
    catch (error) {
        console.error('Ochiq menyu kategoriyalarini olishda xatolik:', error);
        res.status(500).json({ success: false, message: 'Menyu kategoriyalarini olishda xatolik' });
    }
});
router.get('/categories', auth_1.authenticateToken, (0, auth_1.requireRole)(['ADMIN']), async (_req, res) => {
    try {
        const categories = await db_1.prisma.menuCategory.findMany({
            orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
            include: { _count: { select: { menuItems: true } } }
        });
        res.json(categories);
    }
    catch (error) {
        console.error('Menyu kategoriyalarini olishda xatolik:', error);
        res.status(500).json({ success: false, message: 'Menyu kategoriyalarini olishda xatolik' });
    }
});
router.post('/categories', auth_1.authenticateToken, (0, auth_1.requireRole)(['ADMIN']), async (req, res) => {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const sortOrder = req.body?.sortOrder === undefined ? null : Number(req.body.sortOrder);
    if (!name || name.length > 80 || (sortOrder !== null && (!Number.isInteger(sortOrder) || sortOrder < 0))) {
        res.status(400).json({ success: false, message: 'Kategoriya maвЂ™lumotlarini toвЂgвЂri kiriting' });
        return;
    }
    try {
        const duplicate = await db_1.prisma.menuCategory.findFirst({
            where: { name: { equals: name, mode: 'insensitive' } },
            select: { id: true }
        });
        if (duplicate) {
            res.status(409).json({ success: false, message: 'Bunday kategoriya mavjud' });
            return;
        }
        const highest = await db_1.prisma.menuCategory.aggregate({ _max: { sortOrder: true } });
        const category = await db_1.prisma.menuCategory.create({
            data: { name, sortOrder: sortOrder ?? (highest._max.sortOrder || 0) + 10 }
        });
        (0, socket_1.emitSocketEvent)('menu_updated', { kind: 'category', categoryId: category.id });
        res.status(201).json({ success: true, data: category });
    }
    catch (error) {
        console.error('Menyu kategoriyasini yaratishda xatolik:', error);
        res.status(500).json({ success: false, message: 'Kategoriya yaratilmadi' });
    }
});
router.patch('/categories/:id', auth_1.authenticateToken, (0, auth_1.requireRole)(['ADMIN']), async (req, res) => {
    const data = {};
    let categoryName;
    if (req.body?.name !== undefined) {
        if (typeof req.body.name !== 'string' || !req.body.name.trim() || req.body.name.trim().length > 80) {
            res.status(400).json({ success: false, message: 'Kategoriya nomini toвЂgвЂri kiriting' });
            return;
        }
        categoryName = req.body.name.trim();
        data.name = categoryName;
    }
    if (req.body?.sortOrder !== undefined) {
        const sortOrder = Number(req.body.sortOrder);
        if (!Number.isInteger(sortOrder) || sortOrder < 0) {
            res.status(400).json({ success: false, message: 'Tartib raqamini toвЂgвЂri kiriting' });
            return;
        }
        data.sortOrder = sortOrder;
    }
    if (req.body?.isActive !== undefined) {
        if (typeof req.body.isActive !== 'boolean') {
            res.status(400).json({ success: false, message: 'Kategoriya holati notoвЂgвЂri' });
            return;
        }
        data.isActive = req.body.isActive;
    }
    if (!Object.keys(data).length) {
        res.status(400).json({ success: false, message: 'OвЂzgartiriladigan maвЂ™lumot topilmadi' });
        return;
    }
    try {
        if (categoryName) {
            const duplicate = await db_1.prisma.menuCategory.findFirst({
                where: { name: { equals: categoryName, mode: 'insensitive' }, id: { not: req.params.id } },
                select: { id: true }
            });
            if (duplicate) {
                res.status(409).json({ success: false, message: 'Bunday kategoriya mavjud' });
                return;
            }
        }
        const category = await db_1.prisma.menuCategory.update({ where: { id: req.params.id }, data });
        (0, socket_1.emitSocketEvent)('menu_updated', { kind: 'category', categoryId: category.id });
        res.json({ success: true, data: category });
    }
    catch (error) {
        console.error('Menyu kategoriyasini yangilashda xatolik:', error);
        res.status(404).json({ success: false, message: 'Kategoriya topilmadi yoki yangilanmadi' });
    }
});
router.delete('/categories/:id', auth_1.authenticateToken, (0, auth_1.requireRole)(['ADMIN']), async (req, res) => {
    try {
        const result = await db_1.prisma.$transaction(async (tx) => {
            const category = await tx.menuCategory.findUnique({
                where: { id: req.params.id },
                select: { id: true, _count: { select: { menuItems: true } } }
            });
            if (!category)
                return { kind: 'missing' };
            if (category._count.menuItems > 0)
                return { kind: 'linked' };
            await tx.menuCategory.delete({ where: { id: category.id } });
            return { kind: 'deleted' };
        });
        if (result.kind === 'missing') {
            res.status(404).json({ success: false, message: 'Kategoriya topilmadi' });
            return;
        }
        if (result.kind === 'linked') {
            res.status(409).json({ success: false, message: 'Taomlar ulangan kategoriyani oвЂchirib boвЂlmaydi' });
            return;
        }
        (0, socket_1.emitSocketEvent)('menu_updated', { kind: 'category', categoryId: req.params.id });
        res.json({ success: true });
    }
    catch (error) {
        console.error('Menyu kategoriyasini oвЂchirishda xatolik:', error);
        res.status(409).json({ success: false, message: 'Kategoriya oвЂchirilmadi; avval bogвЂlangan taomlarni tekshiring' });
    }
});
router.get('/', auth_1.optionalAuthenticateToken, async (req, res) => {
    try {
        const menuItems = req.user?.role === client_1.RoleType.ADMIN
            ? await db_1.prisma.menuItem.findMany({
                include: { category: true, recipes: { include: { inventory: true } } }
            })
            : await db_1.prisma.menuItem.findMany({
                where: { category: {} },
                select: {
                    id: true, name: true, description: true, imageUrl: true, sellingPrice: true,
                    unit: true, preparationTime: true, kitchenSection: true, categoryId: true,
                    category: { select: { id: true, name: true } }
                }
            });
        res.json(menuItems);
    }
    catch (error) {
        console.error('Menyuni olishda xatolik:', error);
        res.status(500).json({ success: false, message: 'Menyuni olib kelishda xatolik' });
    }
});
router.post('/', auth_1.authenticateToken, (0, auth_1.requireRole)(['ADMIN']), async (req, res) => {
    const { name, categoryId, description, sellingPrice, internalCostPrice, unit, preparationTime, kitchenSection } = req.body || {};
    const imageUrl = req.body?.imageUrl === undefined ? null : imageUrlValue(req.body.imageUrl);
    if (!validItemName(name) || typeof categoryId !== 'string' || !categoryId ||
        !Number.isFinite(Number(sellingPrice)) || Number(sellingPrice) < 0 ||
        (internalCostPrice !== undefined && (!Number.isFinite(Number(internalCostPrice)) || Number(internalCostPrice) < 0)) ||
        (preparationTime !== undefined && (!Number.isInteger(Number(preparationTime)) || Number(preparationTime) < 0)) ||
        (req.body?.imageUrl !== undefined && imageUrl === undefined)) {
        res.status(400).json({ success: false, message: 'Menyu maвЂ™lumotlari notoвЂgвЂri' });
        return;
    }
    try {
        const category = await db_1.prisma.menuCategory.findUnique({ where: { id: categoryId }, select: { id: true } });
        if (!category) {
            res.status(400).json({ success: false, message: 'Menyu kategoriyasi topilmadi' });
            return;
        }
        const menuItem = await db_1.prisma.menuItem.create({
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
        (0, socket_1.emitSocketEvent)('menu_updated', { kind: 'item', menuItemId: menuItem.id });
        res.status(201).json({ success: true, data: menuItem });
    }
    catch (error) {
        console.error('Menyu taomini qoвЂshishda xatolik:', error);
        res.status(500).json({ success: false, message: 'Taom qoвЂshilmadi' });
    }
});
router.patch('/:id', auth_1.authenticateToken, (0, auth_1.requireRole)(['ADMIN']), async (req, res) => {
    const data = {};
    const body = req.body || {};
    if (body.name !== undefined) {
        if (!validItemName(body.name)) {
            res.status(400).json({ success: false, message: 'Taom nomini toвЂgвЂri kiriting' });
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
            res.status(400).json({ success: false, message: 'Taom tavsifi notoвЂgвЂri' });
            return;
        }
        data.description = typeof body.description === 'string' && body.description.trim()
            ? body.description.trim().slice(0, 500) : null;
    }
    for (const field of ['sellingPrice', 'internalCostPrice']) {
        if (body[field] === undefined)
            continue;
        if (!Number.isFinite(Number(body[field])) || Number(body[field]) < 0) {
            res.status(400).json({ success: false, message: 'Taom narxini toвЂgвЂri kiriting' });
            return;
        }
        data[field] = Number(body[field]);
    }
    if (body.unit !== undefined) {
        if (typeof body.unit !== 'string' || !body.unit.trim() || body.unit.trim().length > 30) {
            res.status(400).json({ success: false, message: 'OвЂlchov birligini toвЂgвЂri kiriting' });
            return;
        }
        data.unit = body.unit.trim();
    }
    if (body.preparationTime !== undefined) {
        if (!Number.isInteger(Number(body.preparationTime)) || Number(body.preparationTime) < 0) {
            res.status(400).json({ success: false, message: 'Tayyorlash vaqtini toвЂgвЂri kiriting' });
            return;
        }
        data.preparationTime = Number(body.preparationTime);
    }
    if (body.kitchenSection !== undefined) {
        if (typeof body.kitchenSection !== 'string' || !body.kitchenSection.trim() || body.kitchenSection.trim().length > 80) {
            res.status(400).json({ success: false, message: 'Oshxona boвЂlimini toвЂgвЂri kiriting' });
            return;
        }
        data.kitchenSection = body.kitchenSection.trim();
    }
    if (body.isActive !== undefined) {
        if (typeof body.isActive !== 'boolean') {
            res.status(400).json({ success: false, message: 'Menyu holati notoвЂgвЂri' });
            return;
        }
        data.isActive = body.isActive;
    }
    if (body.imageUrl !== undefined) {
        const imageUrl = imageUrlValue(body.imageUrl);
        if (imageUrl === undefined) {
            res.status(400).json({ success: false, message: 'Rasm manzili notoвЂgвЂri' });
            return;
        }
        data.imageUrl = imageUrl;
    }
    if (!Object.keys(data).length) {
        res.status(400).json({ success: false, message: 'OвЂzgartiriladigan maвЂ™lumot topilmadi' });
        return;
    }
    try {
        if (typeof body.categoryId === 'string' &&
            !await db_1.prisma.menuCategory.findUnique({ where: { id: body.categoryId }, select: { id: true } })) {
            res.status(400).json({ success: false, message: 'Menyu kategoriyasi topilmadi' });
            return;
        }
        const menuItem = await db_1.prisma.menuItem.update({
            where: { id: req.params.id },
            data,
            include: { category: true, recipes: { include: { inventory: true } } }
        });
        (0, socket_1.emitSocketEvent)('menu_updated', { kind: 'item', menuItemId: menuItem.id });
        res.json({ success: true, data: menuItem });
    }
    catch (error) {
        console.error('Menyu taomini yangilashda xatolik:', error);
        res.status(404).json({ success: false, message: 'Taom topilmadi yoki yangilanmadi' });
    }
});
router.get('/:id/recipes', auth_1.authenticateToken, (0, auth_1.requireRole)(['ADMIN']), async (req, res) => {
    try {
        const recipes = await db_1.prisma.recipe.findMany({
            where: { menuItemId: req.params.id },
            include: { inventory: { select: { id: true, name: true, unit: true } } },
            orderBy: { inventory: { name: 'asc' } }
        });
        res.json(recipes);
    }
    catch (error) {
        console.error('Taom retseptini olishda xatolik:', error);
        res.status(500).json({ success: false, message: 'Taom retseptini olib boвЂlmadi' });
    }
});
router.put('/:id/recipes', auth_1.authenticateToken, (0, auth_1.requireRole)(['ADMIN']), async (req, res) => {
    const submitted = req.body?.items;
    if (!Array.isArray(submitted) || submitted.length > 100) {
        res.status(400).json({ success: false, message: 'Retsept tarkibi notoвЂgвЂri' });
        return;
    }
    try {
        const result = await db_1.prisma.$transaction(async (tx) => {
            const menuItem = await tx.menuItem.findUnique({ where: { id: req.params.id }, select: { id: true } });
            if (!menuItem)
                throw new Error('MENU_ITEM_NOT_FOUND');
            const inventoryIds = new Set();
            const parsed = [];
            for (const entry of submitted) {
                if (!entry || typeof entry !== 'object')
                    throw new Error('RECIPE_ITEM_INVALID');
                const item = entry;
                const quantityText = String(item.quantity ?? '');
                if (typeof item.inventoryId !== 'string' || !item.inventoryId ||
                    typeof item.unit !== 'string' || !item.unit.trim() || item.unit.trim().length > 30 ||
                    !decimalPattern.test(quantityText) || inventoryIds.has(item.inventoryId)) {
                    throw new Error('RECIPE_ITEM_INVALID');
                }
                const quantity = new client_1.Prisma.Decimal(quantityText);
                if (!quantity.isFinite() || !quantity.greaterThan(0))
                    throw new Error('RECIPE_ITEM_INVALID');
                inventoryIds.add(item.inventoryId);
                parsed.push({ inventoryId: item.inventoryId, quantity, unit: item.unit.trim() });
            }
            const products = inventoryIds.size ? await tx.inventoryProduct.findMany({
                where: { id: { in: [...inventoryIds] } },
                select: { id: true, unit: true }
            }) : [];
            if (products.length !== inventoryIds.size)
                throw new Error('RECIPE_INVENTORY_INVALID');
            const productsById = new Map(products.map(product => [product.id, product]));
            const recipeRows = parsed.map(item => {
                const product = productsById.get(item.inventoryId);
                const stockQuantity = (0, units_1.convertQuantity)(item.quantity, item.unit, product.unit);
                if (!stockQuantity.isFinite() || !stockQuantity.greaterThan(0))
                    throw new Error('RECIPE_ITEM_INVALID');
                return {
                    menuItemId: menuItem.id,
                    inventoryId: item.inventoryId,
                    quantity: item.quantity,
                    unit: item.unit
                };
            });
            await tx.recipe.deleteMany({ where: { menuItemId: menuItem.id } });
            if (recipeRows.length)
                await tx.recipe.createMany({ data: recipeRows });
            return tx.recipe.findMany({
                where: { menuItemId: menuItem.id },
                include: { inventory: { select: { id: true, name: true, unit: true } } },
                orderBy: { inventory: { name: 'asc' } }
            });
        });
        (0, socket_1.emitSocketEvent)('menu_updated', { kind: 'recipe', menuItemId: req.params.id });
        res.json({ success: true, data: result });
    }
    catch (error) {
        if (error instanceof Error && error.message === 'RECIPE_UNIT_INCOMPATIBLE') {
            res.status(400).json({ success: false, message: 'Retsept va ombor mahsuloti oвЂlchov birliklari mos emas' });
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
            res.status(400).json({ success: false, message: 'Retsept tarkibidagi mahsulot yoki miqdor notoвЂgвЂri' });
            return;
        }
        console.error('Taom retseptini saqlashda xatolik:', error);
        res.status(500).json({ success: false, message: 'Taom retseptini saqlab boвЂlmadi' });
    }
});
exports.default = router;
