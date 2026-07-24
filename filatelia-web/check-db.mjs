import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

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

  if (stamps > 0) {
    const sampleStamps = await prisma.stamp.findMany({ take: 5, include: { country: true, group: true } });
    console.log('\nSample stamps:', JSON.stringify(sampleStamps.map(s => ({ title: s.titleEs, country: s.country?.name, group: s.group?.titleEs })), null, 2));
  }
} catch (e) {
  console.error('Error:', e.message);
  console.error('Stack:', e.stack);
} finally {
  await prisma.$disconnect();
}
