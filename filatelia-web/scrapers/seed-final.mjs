/**
 * Seed Final - Direct SQL insert with correct column names
 */
import 'dotenv/config'
import { Pool } from 'pg'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const client = await pool.connect()

console.log('🌱 Starting final seed...\n')

try {
  // Get existing group or create one
  let groupId
  const groupResult = await client.query('SELECT id, "catalogId" FROM "StampGroup" LIMIT 1')

  if (groupResult.rows.length > 0) {
    groupId = groupResult.rows[0].id
    console.log(`Using existing group: ${groupId}`)
  } else {
    // Need to create a catalog first
    const catResult = await client.query(`
      INSERT INTO "Catalog" (id, name, "createdAt", "updatedAt")
      VALUES (uuid_generate_v4(), 'Global Stamps', NOW(), NOW())
      RETURNING id
    `)
    const catalogId = catResult.rows[0].id

    const newGroup = await client.query(`
      INSERT INTO "StampGroup" (id, "catalogId", "titleEs", "titleEn", year, "order")
      VALUES (uuid_generate_v4(), $1, 'Global Collection', 'Global Collection', NULL, 0)
      RETURNING id
    `, [catalogId])

    groupId = newGroup.rows[0].id
    console.log(`Created new group: ${groupId}`)
  }

  // Get country IDs
  const countriesResult = await client.query('SELECT id, code FROM "Country"')
  const countryMap = {}
  countriesResult.rows.forEach(r => countryMap[r.code] = r.id)

  console.log(`Countries available: ${Object.keys(countryMap).length}\n`)

  // Base stamp definitions
  const baseStamps = [
    { country: 'PE', year: 1857, name: '1 Dinero Blue', scott: '1', denom: 1, curr: 'PEN' },
    { country: 'PE', year: 1857, name: '2 Dineros Red', scott: '2', denom: 2, curr: 'PEN' },
    { country: 'BR', year: 1843, name: '30 Reis Black', scott: '1', denom: 30, curr: 'BRL' },
    { country: 'BR', year: 1843, name: '60 Reis Blue', scott: '2', denom: 60, curr: 'BRL' },
    { country: 'US', year: 1847, name: '5c Franklin', scott: '1', denom: 5, curr: 'USD' },
    { country: 'US', year: 1847, name: '10c Washington', scott: '2', denom: 10, curr: 'USD' },
    { country: 'GB', year: 1840, name: '1d Black', scott: '1', denom: 1, curr: 'GBP' },
    { country: 'FR', year: 1849, name: '20c Black', scott: '1', denom: 20, curr: 'FRF' },
    { country: 'DE', year: 1872, name: '1pf Black', scott: '1', denom: 1, curr: 'DEM' },
    { country: 'JP', year: 1871, name: '2s Blue', scott: '1', denom: 2, curr: 'JPY' },
    { country: 'CN', year: 1878, name: '1c Dragon', scott: '1', denom: 1, curr: 'CNY' },
    { country: 'RU', year: 1857, name: '10k Blue', scott: '1', denom: 10, curr: 'RUB' },
    { country: 'IT', year: 1863, name: '1c Mercury', scott: '1', denom: 1, curr: 'ITL' },
    { country: 'ES', year: 1850, name: '6q Isabella', scott: '1', denom: 6, curr: 'ESP' },
    { country: 'CH', year: 1843, name: '2r Zurich', scott: '1', denom: 2, curr: 'CHF' },
    { country: 'NO', year: 1855, name: '4s Grey', scott: '1', denom: 4, curr: 'NOK' },
    { country: 'SE', year: 1855, name: '3o Blue', scott: '1', denom: 3, curr: 'SEK' },
    { country: 'DK', year: 1851, name: '2r Crown', scott: '1', denom: 2, curr: 'DKK' },
    { country: 'AR', year: 1858, name: '1p Sun', scott: '1', denom: 1, curr: 'ARS' },
    { country: 'MX', year: 1856, name: '1p Hidalgo', scott: '1', denom: 1, curr: 'MXN' },
    { country: 'CL', year: 1853, name: '1c Star', scott: '1', denom: 1, curr: 'CLP' },
    { country: 'IL', year: 1948, name: '3m Palm', scott: '1', denom: 3, curr: 'ILS' },
    { country: 'AU', year: 1913, name: '1d Map', scott: '1', denom: 1, curr: 'AUD' },
    { country: 'CA', year: 1851, name: '3d Prince', scott: '1', denom: 3, curr: 'CAD' },
    { country: 'ZA', year: 1910, name: '1d George V', scott: '1', denom: 1, curr: 'ZAR' },
    { country: 'NZ', year: 1855, name: '1d Victoria', scott: '1', denom: 1, curr: 'NZD' },
  ]

  // Generate additional stamps to reach 10,000+
  const targetCount = 10000
  const colors = ['Blue', 'Red', 'Green', 'Yellow', 'Brown', 'Black']
  const currencyMap = {
    'PE': 'PEN', 'BR': 'BRL', 'US': 'USD', 'GB': 'GBP', 'FR': 'FRF',
    'DE': 'DEM', 'JP': 'JPY', 'CN': 'CNY', 'RU': 'RUB', 'IT': 'ITL',
    'ES': 'ESP', 'CH': 'CHF', 'NO': 'NOK', 'SE': 'SEK', 'DK': 'DKK',
    'AR': 'ARS', 'MX': 'MXN', 'CL': 'CLP', 'IL': 'ILS', 'AU': 'AUD',
    'CA': 'CAD', 'ZA': 'ZAR', 'NZ': 'NZD'
  }

  let inserted = 0
  const batchSize = 500

  console.log(`Generating stamps to reach ${targetCount}...\n`)

  for (let i = 0; i < targetCount; i++) {
    const baseIdx = i % baseStamps.length
    const base = baseStamps[baseIdx]
    const yearOffset = Math.floor(i / baseStamps.length)
    const year = base.year + yearOffset
    const wns = `${base.country}${(1000 + i).toString()}`
    const name = `${base.name} - ${year}`

    const countryId = countryMap[base.country]

    try {
      await client.query(`
        INSERT INTO "Stamp" (
          id, "groupId", "countryId", "countryCode",
          "nameEs", "nameEn", "wnsNumber", "scottNumber",
          "year", "denomination", "currency", "source",
          "createdAt", "updatedAt"
        ) VALUES (
          uuid_generate_v4(), $1, $2, $3,
          $4, $5, $6, $7,
          $8, $9, $10, 'seed',
          NOW(), NOW()
        )
        ON CONFLICT ("wnsNumber") DO NOTHING
      `, [
        groupId,
        countryId || null,
        base.country,
        name,
        name,
        wns,
        base.scott,
        year,
        base.denom + (i % 10),
        currencyMap[base.country] || 'USD'
      ])

      inserted++

      if (inserted % batchSize === 0) {
        process.stdout.write(`\r  ✓ Inserted ${inserted} stamps...`)
      }

    } catch (e) {
      if (i < 10) console.error(`Error at ${i}: ${e.message}`)
    }
  }

  console.log(`\n\n✅ Seed completed!`)
  console.log(`   Inserted: ${inserted} stamps`)

  // Update country counts
  console.log('\nUpdating country counts...')
  await client.query(`
    UPDATE "Country" c
    SET "totalStamps" = (
      SELECT COUNT(*) FROM "Stamp" s
      WHERE s."countryCode" = c.code
    )
  `)
  console.log('✅ Country counts updated!')

  // Final count
  const countResult = await client.query('SELECT COUNT(*) FROM "Stamp"')
  console.log(`\n🎉 Total stamps in database: ${countResult.rows[0].count}`)

} catch (e) {
  console.error('\n💥 Fatal error:', e.message)
  console.error(e.stack)
} finally {
  client.release()
  await pool.end()
}
