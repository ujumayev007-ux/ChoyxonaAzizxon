import { Prisma } from '@prisma/client';

type UnitDefinition = {
    dimension: string;
    factor: number;
    canonical: string;
};

const units: Record<string, UnitDefinition> = {
    kg: { dimension: 'mass', factor: 1000, canonical: 'g' },
    g: { dimension: 'mass', factor: 1, canonical: 'g' },
    gramm: { dimension: 'mass', factor: 1, canonical: 'g' },
    gram: { dimension: 'mass', factor: 1, canonical: 'g' },
    litr: { dimension: 'volume', factor: 1000, canonical: 'ml' },
    l: { dimension: 'volume', factor: 1000, canonical: 'ml' },
    ml: { dimension: 'volume', factor: 1, canonical: 'ml' }
};

function definition(unit: string): UnitDefinition {
    const normalized = unit.trim().toLocaleLowerCase();
    return units[normalized] || {
        dimension: `unit:${normalized}`,
        factor: 1,
        canonical: normalized
    };
}

export function convertQuantity(
    quantity: Prisma.Decimal,
    fromUnit: string,
    toUnit: string
): Prisma.Decimal {
    const from = definition(fromUnit);
    const to = definition(toUnit);
    if (from.dimension !== to.dimension) throw new Error('RECIPE_UNIT_INCOMPATIBLE');
    return quantity.mul(from.factor).div(to.factor);
}
