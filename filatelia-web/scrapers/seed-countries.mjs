/**
 * Seed Countries - Populates the Country table with all countries
 */
import 'dotenv/config'
import { Pool } from 'pg'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const client = await pool.connect()

console.log('🌍 Seeding countries...\n')

const countries = [
  { code: 'PE', nameEs: 'Perú', nameEn: 'Peru', continent: 'South America' },
  { code: 'BR', nameEs: 'Brasil', nameEn: 'Brazil', continent: 'South America' },
  { code: 'CL', nameEs: 'Chile', nameEn: 'Chile', continent: 'South America' },
  { code: 'AR', nameEs: 'Argentina', nameEn: 'Argentina', continent: 'South America' },
  { code: 'CO', nameEs: 'Colombia', nameEn: 'Colombia', continent: 'South America' },
  { code: 'VE', nameEs: 'Venezuela', nameEn: 'Venezuela', continent: 'South America' },
  { code: 'EC', nameEs: 'Ecuador', nameEn: 'Ecuador', continent: 'South America' },
  { code: 'BO', nameEs: 'Bolivia', nameEn: 'Bolivia', continent: 'South America' },
  { code: 'PY', nameEs: 'Paraguay', nameEn: 'Paraguay', continent: 'South America' },
  { code: 'UY', nameEs: 'Uruguay', nameEn: 'Uruguay', continent: 'South America' },
  { code: 'US', nameEs: 'Estados Unidos', nameEn: 'United States', continent: 'North America' },
  { code: 'CA', nameEs: 'Canadá', nameEn: 'Canada', continent: 'North America' },
  { code: 'MX', nameEs: 'México', nameEn: 'Mexico', continent: 'North America' },
  { code: 'GT', nameEs: 'Guatemala', nameEn: 'Guatemala', continent: 'North America' },
  { code: 'CU', nameEs: 'Cuba', nameEn: 'Cuba', continent: 'North America' },
  { code: 'GB', nameEs: 'Reino Unido', nameEn: 'United Kingdom', continent: 'Europe' },
  { code: 'FR', nameEs: 'Francia', nameEn: 'France', continent: 'Europe' },
  { code: 'DE', nameEs: 'Alemania', nameEn: 'Germany', continent: 'Europe' },
  { code: 'IT', nameEs: 'Italia', nameEn: 'Italy', continent: 'Europe' },
  { code: 'ES', nameEs: 'España', nameEn: 'Spain', continent: 'Europe' },
  { code: 'PT', nameEs: 'Portugal', nameEn: 'Portugal', continent: 'Europe' },
  { code: 'NL', nameEs: 'Países Bajos', nameEn: 'Netherlands', continent: 'Europe' },
  { code: 'BE', nameEs: 'Bélgica', nameEn: 'Belgium', continent: 'Europe' },
  { code: 'CH', nameEs: 'Suiza', nameEn: 'Switzerland', continent: 'Europe' },
  { code: 'AT', nameEs: 'Austria', nameEn: 'Austria', continent: 'Europe' },
  { code: 'SE', nameEs: 'Suecia', nameEn: 'Sweden', continent: 'Europe' },
  { code: 'NO', nameEs: 'Noruega', nameEn: 'Norway', continent: 'Europe' },
  { code: 'DK', nameEs: 'Dinamarca', nameEn: 'Denmark', continent: 'Europe' },
  { code: 'FI', nameEs: 'Finlandia', nameEn: 'Finland', continent: 'Europe' },
  { code: 'PL', nameEs: 'Polonia', nameEn: 'Poland', continent: 'Europe' },
  { code: 'CZ', nameEs: 'República Checa', nameEn: 'Czech Republic', continent: 'Europe' },
  { code: 'HU', nameEs: 'Hungría', nameEn: 'Hungary', continent: 'Europe' },
  { code: 'RO', nameEs: 'Rumania', nameEn: 'Romania', continent: 'Europe' },
  { code: 'RU', nameEs: 'Rusia', nameEn: 'Russia', continent: 'Europe' },
  { code: 'UA', nameEs: 'Ucrania', nameEn: 'Ukraine', continent: 'Europe' },
  { code: 'JP', nameEs: 'Japón', nameEn: 'Japan', continent: 'Asia' },
  { code: 'CN', nameEs: 'China', nameEn: 'China', continent: 'Asia' },
  { code: 'IN', nameEs: 'India', nameEn: 'India', continent: 'Asia' },
  { code: 'KR', nameEs: 'Corea del Sur', nameEn: 'South Korea', continent: 'Asia' },
  { code: 'TH', nameEs: 'Tailandia', nameEn: 'Thailand', continent: 'Asia' },
  { code: 'VN', nameEs: 'Vietnam', nameEn: 'Vietnam', continent: 'Asia' },
  { code: 'PH', nameEs: 'Filipinas', nameEn: 'Philippines', continent: 'Asia' },
  { code: 'MY', nameEs: 'Malasia', nameEn: 'Malaysia', continent: 'Asia' },
  { code: 'ID', nameEs: 'Indonesia', nameEn: 'Indonesia', continent: 'Asia' },
  { code: 'AU', nameEs: 'Australia', nameEn: 'Australia', continent: 'Oceania' },
  { code: 'NZ', nameEs: 'Nueva Zelanda', nameEn: 'New Zealand', continent: 'Oceania' },
  { code: 'IL', nameEs: 'Israel', nameEn: 'Israel', continent: 'Asia' },
  { code: 'ZA', nameEs: 'Sudáfrica', nameEn: 'South Africa', continent: 'Africa' },
  { code: 'EG', nameEs: 'Egipto', nameEn: 'Egypt', continent: 'Africa' },
  { code: 'NG', nameEs: 'Nigeria', nameEn: 'Nigeria', continent: 'Africa' },
  { code: 'KE', nameEs: 'Kenia', nameEn: 'Kenya', continent: 'Africa' },
]

let inserted = 0
let updated = 0

for (const c of countries) {
  try {
    // Check if exists by code
    const existing = await client.query(
      'SELECT id FROM "Country" WHERE code = $1',
      [c.code]
    )

    if (existing.rows.length > 0) {
      // Update
      await client.query(
        `UPDATE "Country" SET name = $1, "nameEn" = $2, continent = $3 WHERE code = $4`,
        [c.nameEs, c.nameEn, c.continent, c.code]
      )
      updated++
    } else {
      // Insert
      await client.query(
        `INSERT INTO "Country" (id, code, name, "nameEn", continent)
         VALUES (uuid_generate_v4(), $1, $2, $3, $4)`,
        [c.code, c.nameEs, c.nameEn, c.continent]
      )
      inserted++
    }
  } catch (e) {
    console.error(`Error with ${c.code}: ${e.message}`)
  }
}

console.log(`✅ Countries seeded!`)
console.log(`   Inserted: ${inserted}`)
console.log(`   Updated: ${updated}`)

await client.release()
await pool.end()
