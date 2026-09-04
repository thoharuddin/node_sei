/**
 * Seed data for the Stock Opname system (Phase 1).
 *
 *   users     : 1 manager + 3 staff
 *   locations : WH -> Stock -> Rack A / Rack B / Rack C  (hierarchical, §6)
 *   products  : 20 active SKUs
 *   stock     : opening movements posted to stock_quant + stock_balance in one transaction
 *
 * Idempotent: re-running upserts master data and only posts opening stock for
 * product/location pairs that have no ledger history yet.
 */
require('dotenv').config();

const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');

const stockRepository = require('../src/modules/stock/stock.repository');

const prisma = new PrismaClient();
const ROUNDS = Number(process.env.BCRYPT_ROUNDS || 10);

const USERS = [
  { username: 'manager', name: 'Sari Manager', email: 'manager@example.com', role: 'manager', password: 'manager123' },
  { username: 'budi', name: 'Budi Santoso', email: 'budi@example.com', role: 'staff', password: 'staff123' },
  { username: 'andi', name: 'Andi Wijaya', email: 'andi@example.com', role: 'staff', password: 'staff123' },
  { username: 'candra', name: 'Candra Putra', email: 'candra@example.com', role: 'staff', password: 'staff123' },
];

const LOCATIONS = [
  { code: 'WH', name: 'Main Warehouse', parent: null },
  { code: 'WH-STOCK', name: 'Stock', parent: 'WH' },
  { code: 'RACK-A', name: 'Rack A', parent: 'WH-STOCK' },
  { code: 'RACK-B', name: 'Rack B', parent: 'WH-STOCK' },
  { code: 'RACK-C', name: 'Rack C', parent: 'WH-STOCK' },
];

const PRODUCT_NAMES = [
  'Coffee Beans Arabica 1kg', 'Coffee Beans Robusta 1kg', 'Sugar Refined 1kg',
  'Wheat Flour Premium 1kg', 'Butter Unsalted 250g', 'Whipping Cream 1L',
  'Milk UHT Full Cream 1L', 'Chocolate Couverture Dark 1kg', 'Chocolate Couverture Milk 1kg',
  'Vanilla Extract 100ml', 'Baking Powder 500g', 'Instant Yeast 500g',
  'Almond Slice 500g', 'Cream Cheese 1kg', 'Strawberry Jam 1kg',
  'Paper Cup 12oz (50pcs)', 'Cake Box Medium (25pcs)', 'Plastic Straw (100pcs)',
  'Aluminium Foil Roll 30m', 'Cleaning Detergent 5L',
];

/** product/location opening quantities — some SKUs deliberately exist in several racks (§12) */
const OPENING_STOCK = [
  ['SKU001', 'RACK-A', 100], ['SKU002', 'RACK-A', 50], ['SKU003', 'RACK-A', 20],
  ['SKU004', 'RACK-A', 10], ['SKU005', 'RACK-A', 75],
  ['SKU001', 'RACK-B', 40], ['SKU006', 'RACK-B', 60], ['SKU007', 'RACK-B', 35],
  ['SKU008', 'RACK-B', 12], ['SKU009', 'RACK-B', 90], ['SKU010', 'RACK-B', 25],
  ['SKU002', 'RACK-C', 18], ['SKU011', 'RACK-C', 44], ['SKU012', 'RACK-C', 15],
  ['SKU013', 'RACK-C', 80], ['SKU014', 'RACK-C', 22], ['SKU015', 'RACK-C', 55],
  ['SKU016', 'WH-STOCK', 500], ['SKU017', 'WH-STOCK', 250], ['SKU018', 'WH-STOCK', 700],
  ['SKU019', 'WH-STOCK', 30], ['SKU020', 'WH-STOCK', 8],
];

async function main() {
  // ---------------------------------------------------------------- users
  const users = {};
  for (const u of USERS) {
    const passwordHash = await bcrypt.hash(u.password, ROUNDS);
    users[u.username] = await prisma.user.upsert({
      where: { username: u.username },
      update: { name: u.name, email: u.email, role: u.role, isActive: true },
      create: { username: u.username, passwordHash, name: u.name, email: u.email, role: u.role },
    });
  }
  const manager = users.manager;

  // ------------------------------------------------------------ locations
  const locations = {};
  for (const l of LOCATIONS) {
    locations[l.code] = await prisma.location.upsert({
      where: { code: l.code },
      update: { name: l.name, parentId: l.parent ? locations[l.parent].id : null, writeUid: manager.id },
      create: {
        code: l.code,
        name: l.name,
        parentId: l.parent ? locations[l.parent].id : null,
        createUid: manager.id,
        writeUid: manager.id,
      },
    });
  }

  // ------------------------------------------------------------- products
  const products = {};
  for (let i = 0; i < PRODUCT_NAMES.length; i += 1) {
    const sku = `SKU${String(i + 1).padStart(3, '0')}`;
    products[sku] = await prisma.product.upsert({
      where: { sku },
      update: { name: PRODUCT_NAMES[i], writeUid: manager.id },
      create: { sku, name: PRODUCT_NAMES[i], createUid: manager.id, writeUid: manager.id },
    });
  }

  // -------------------------------------------------------- opening stock
  // stock_quant (ledger) and stock_balance (cache) are always written together.
  let posted = 0;
  for (const [sku, locationCode, quantity] of OPENING_STOCK) {
    const productId = products[sku].id;
    const locationId = locations[locationCode].id;

    const existing = await prisma.stockQuant.count({ where: { productId, locationId } });
    if (existing > 0) continue;

    // Same single write path the API uses: ledger + cache in one transaction.
    await prisma.$transaction(async (tx) =>
      stockRepository.postMovements(tx, {
        actorId: manager.id,
        movements: [
          {
            productId,
            locationId,
            quantity,
            movementType: 'opening',
            referenceType: 'seed',
          },
        ],
      }),
    );
    posted += 1;
  }

  const drift = await prisma.$queryRaw`
    SELECT count(*)::int AS n FROM stock_balance_consistency WHERE drift <> 0
  `;

  console.log('Seed complete');
  console.log(`  users     : ${Object.keys(users).length} (1 manager, 3 staff)`);
  console.log(`  locations : ${Object.keys(locations).length}`);
  console.log(`  products  : ${Object.keys(products).length}`);
  console.log(`  opening   : ${posted} movement(s) posted`);
  console.log(`  ledger/balance drift rows: ${drift[0].n}`);
  console.log('\nLogin credentials: manager/manager123 · budi|andi|candra/staff123');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
