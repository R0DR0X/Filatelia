const { PrismaClient } = require('@prisma/client');
require('dotenv').config({ path: './filatelia-web/.env' });

const prisma = new PrismaClient();

async function main() {
  try {
    const stamps = await prisma.stamp.count();
    const countries = await prisma.country.count();
    const catalogs = await prisma.catalog.count();
    const products = await prisma.product.count();
    const users = await prisma.user.count();

    console.log('=== DATABASE STATUS ===');
    console.log(`Stamps: ${stamps}`);
    console.log(`Countries: ${countries}`);
    console.log(`Catalogs: ${catalogs}`);
    console.log(`Products: ${products}`);
    console.log(`Users: ${users}`);

    if (countries > 0) {
      const countryList = await prisma.country.findMany({ take: 10 });
      console.log('\nSample countries:', countryList.map(c => c.name).join(', '));
    }

    if (catalogs > 0) {
      const catalogList = await prisma.catalog.findMany({ take: 5 });
      console.log('\nCatalogs:', JSON.stringify(catalogList, null, 2));
    }
  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    await prisma.$disconnect();
  }
}

main();
