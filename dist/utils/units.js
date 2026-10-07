"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.convertQuantity = convertQuantity;
const units = {
    kg: { dimension: 'mass', factor: 1000, canonical: 'g' },
    g: { dimension: 'mass', factor: 1, canonical: 'g' },
    gramm: { dimension: 'mass', factor: 1, canonical: 'g' },
    gram: { dimension: 'mass', factor: 1, canonical: 'g' },
    litr: { dimension: 'volume', factor: 1000, canonical: 'ml' },
    l: { dimension: 'volume', factor: 1000, canonical: 'ml' },
    ml: { dimension: 'volume', factor: 1, canonical: 'ml' }
};
function definition(unit) {
    const normalized = unit.trim().toLocaleLowerCase();
    return units[normalized] || {
        dimension: `unit:${normalized}`,
        factor: 1,
        canonical: normalized
    };
}
function convertQuantity(quantity, fromUnit, toUnit) {
    const from = definition(fromUnit);
    const to = definition(toUnit);
    if (from.dimension !== to.dimension)
        throw new Error('RECIPE_UNIT_INCOMPATIBLE');
    return quantity.mul(from.factor).div(to.factor);
}
