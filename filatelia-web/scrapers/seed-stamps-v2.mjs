/**
 * Seed Stamps v2 - Simple direct insert
 * Uses existing catalog/group or creates minimal ones
 */
import 'dotenv/config'
import { Pool } from 'pg'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const client = await pool.connect()

console.log('🌱 Starting stamp seed v2...\n')

try {
  // Get existing catalog or create one
  let catalogId
  const catResult = await client.query('SELECT id FROM "Catalog" LIMIT 1')
  if (catResult.rows.length > 0) {
    catalogId = catResult.rows[0].id
    console.log(`Using existing catalog: ${catalogId}`)
  } else {
    const newCat = await client.query(
      `INSERT INTO "Catalog" (id, name, "createdAt", "updatedAt")
       VALUES (uuid_generate_v4(), 'Global Stamp Catalog', NOW(), NOW())
       RETURNING id`
    )
    catalogId = newCat.rows[0].id
    console.log(`Created new catalog: ${catalogId}`)
  }

  // Get or create groups for each country
  const groups = {}
  const countries = await client.query('SELECT id, code, name FROM "Country"')

  for (const country of countries.rows) {
    // Create a group for each country (one group per country for simplicity)
    const groupTitle = `Stamps of ${country.name}`

    let groupId
    const existingGroup = await client.query(
      'SELECT id FROM "StampGroup" WHERE "catalogId" = $1 AND title = $2',
      [catalogId, groupTitle]
    )

    if (existingGroup.rows.length > 0) {
      groupId = existingGroup.rows[0].id
    } else {
      const newGroup = await client.query(
        `INSERT INTO "StampGroup" (id, "catalogId", "titleEs", "titleEn", year)
         VALUES (uuid_generate_v4(), $1, $2, $3, $4)
         RETURNING id`,
        [catalogId, groupTitle, groupTitle, null]
      )
      groupId = newGroup.rows[0].id
    }

    groups[country.code] = { id: groupId, countryId: country.id }
  }

  console.log(`✓ Groups ready for ${Object.keys(groups).length} countries\n`)

  // Now insert stamps
  // Base stamps for each country
  const baseStamps = [
    // PERU
    { country: 'PE', year: 1857, name: '1 Dinero Azul', scott: '1', denom: 1, currency: 'PEN' },
    { country: 'PE', year: 1857, name: '2 Dineros Rojo', scott: '2', denom: 2, currency: 'PEN' },
    { country: 'PE', year: 1858, name: '1 Peseta Rosa', scott: '4', denom: 1, currency: 'PEN' },

    // BRAZIL
    { country: 'BR', year: 1843, name: '30 Reis Negro', scott: '1', denom: 30, currency: 'BRL' },
    { country: 'BR', year: 1843, name: '60 Reis Azul', scott: '2', denom: 60, currency: 'BRL' },

    // USA
    { country: 'US', year: 1847, name: '5c Franklin', scott: '1', denom: 5, currency: 'USD' },
    { country: 'US', year: 1847, name: '10c Washington', scott: '2', denom: 10, currency: 'USD' },

    // UK
    { country: 'GB', year: 1840, name: '1d Black', scott: '1', denom: 1, currency: 'GBP' },
    { country: 'GB', year: 1840, name: '2d Blue', scott: '2', denom: 2, currency: 'GBP' },

    // FRANCE
    { country: 'FR', year: 1849, name: '20c Black', scott: '1', denom: 20, currency: 'FRF' },

    // GERMANY
    { country: 'DE', year: 1872, name: '1pf Black', scott: '1', denom: 1, currency: 'DEM' },

    // JAPAN
    { country: 'JP', year: 1871, name: '2s Blue', scott: '1', denom: 2, currency: 'JPY' },

    // AUSTRALIA
    { country: 'AU', year: 1913, name: '1d Map', scott: '1', denom: 1, currency: 'AUD' },

    // CANADA
    { country: 'CA', year: 1851, name: '3d Prince Albert', scott: '1', denom: 3, currency: 'CAD' },

    // CHINA
    { country: 'CN', year: 1878, name: '1c Dragon', scott: '1', denom: 1, currency: 'CNY' },

    // INDIA
    { country: 'IN', year: 1854, name: '1/2a Crown', scott: '1', denom: 0.5, currency: 'INR' },

    // RUSSIA
    { country: 'RU', year: 1857, name: '10k Blue', scott: '1', denom: 10, currency: 'RUB' },

    // ITALY
    { country: 'IT', year: 1863, name: '1c Mercury', scott: '1', denom: 1, currency: 'ITL' },

    // SPAIN
    { country: 'ES', year: 1850, name: '6q Isabella II', scott: '1', denom: 6, currency: 'ESP' },

    // SWITZERLAND
    { country: 'CH', year: 1843, name: '2r Zurich', scott: '1', denom: 2, currency: 'CHF' },

    // NORWAY
    { country: 'NO', year: 1855, name: '4s Grey', scott: '1', denom: 4, currency: 'NOK' },

    // DENMARK
    { country: 'DK', year: 1851, name: '2r Crown', scott: '1', denom: 2, currency: 'DKK' },

    // ARGENTINA
    { country: 'AR', year: 1858, name: '1p Sun', scott: '1', denom: 1, currency: 'ARS' },

    // MEXICO
    { country: 'MX', year: 1856, name: '1p Hidalgo', scott: '1', denom: 1, currency: 'MXN' },

    // CHILE
    { country: 'CL', year: 1853, name: '1c Star', scott: '1', denom: 1, currency: 'CLP' },

    // ISRAEL
    { country: 'IL', year: 1948, name: '3m Palm', scott: '1', denom: 3, currency: 'ILS' },
  ]

  // Generate additional stamps for each country (to reach 10,000+)
  const colors = ['Azul', 'Rojo', 'Verde', 'Amarillo', 'Marrón', 'Negro']
  const currencies = {
    'PE': 'PEN', 'BR': 'BRL', 'US': 'USD', 'GB': 'GBP', 'FR': 'FRF',
    'DE': 'DEM', 'JP': 'JPY', 'AU': 'AUD', 'CA': 'CAD', 'CN': 'CNY',
    'IN': 'INR', 'RU': 'RUB', 'IT': 'ITL', 'ES': 'ESP', 'CH': 'CHF',
    'NO': 'NOK', 'SE': 'SEK', 'DK': 'DKK', 'AR': 'ARS', 'MX': 'MXN',
    'CL': 'CLP', 'IL': 'ILS', 'ZA': 'ZAR', 'NZ': 'NZD', 'AU': 'AUD'
  }

  let totalToInsert = baseStamps.length * 200 // ~8000 base stamps
  console.log(`Generating ~${totalToInsert} stamps...\n`)

  let inserted = 0
  let errors = 0

  // Insert in batches
  const batchSize = 100

  for (const countryCode in groups) {
    const group = groups[countryCode]
    if (!group) continue

    const baseStampsForCountry = baseStamps.filter(s => s.country === countryCode)

    for (let i = 0; i < 200; i++) {
      const baseStamp = baseStampsForCountry[i % baseStampsForCountry.length]
      if (!baseStamp) continue

      const year = baseStamp.year + Math.floor(i / baseStampsForCountry.length)
      const wnsNumber = `${countryCode}${(i + 100).toString().padStart(4, '0')}`
      const nameEs = `${baseStamp.name} - ${year}`
      const nameEn = `${baseStamp.name} - ${year}`

      try {
        await client.query(`
          INSERT INTO "Stamp" (
            id, "groupId", "countryId", "nameEs", "nameEn",
            "wnsNumber", "scottNumber", "year", "denomination", "currency",
            "countryCode", "source", "createdAt", "updatedAt"
          ) VALUES (
            uuid_generate_v4(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'seed', NOW(), NOW()
          )
          ON CONFLICT ("wnsNumber") DO NOTHING
        `, [
          group.id, group.countryId, nameEs, nameEn,
          wnsNumber, baseStamp.scott, year, baseStamp.denom, baseStamp.currency,
          countryCode
        ])

        inserted++

        if (inserted % batchSize === 0) {
          process.stdout.write(`\r  ✓ Inserted ${inserted} stamps...`)
        }

      } catch (e) {
        errors++
        if (errors <= 5) {
          console.error(`\n  ✗ Error: ${e.message}`)
        }
      }
    }
  }

  console.log(`\n\n✅ Seed completed!`)
  console.log(`   Inserted: ${inserted}`)
  console.log(`   Errors: ${errors}`)

  // Update country stamp counts
  console.log('\nUpdating country counts...')
  await client.query(`
    UPDATE "Country" c
    SET "totalStamps" = (
      SELECT COUNT(*) FROM "Stamp" s
      WHERE s."countryCode" = c.code
    )
  `)
  console.log('✅ Country counts updated!')

} catch (e) {
  console.error('\n💥 Fatal error:', e.message)
  console.error(e.stack)
} finally {
  client.release()
  await pool.end()
}
