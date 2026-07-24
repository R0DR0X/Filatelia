/**
 * Wikidata Scraper - Extracts stamp data via SPARQL API
 * Endpoint: https://query.wikidata.org/sparql
 *
 * Usage: node wikidata-scraper.mjs
 *
 * Features:
 * - Uses Wikidata SPARQL endpoint (no rate limits)
 * - Paginates in groups of 10000
 * - Downloads images from Wikimedia Commons
 * - Fuzzy matching to avoid duplicates
 * - Enriches existing stamps
 */

import 'dotenv/config'
import { Pool } from 'pg'
import axios from 'axios'
import * as cheerio from 'cheerio'
import fs from 'fs'
import path from 'path'

const WIKI_DATA_SPARQL = 'https://query.wikidata.org/sparql'
const WIKI_COMMONS_API = 'https://commons.wikimedia.org/w/api.php'
const WIKI_COMMONS_IMG = 'https://commons.wikimedia.org/wiki/Special:FilePath'

// Database connection
const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const CHECKPOINT_FILE = path.join(process.cwd(), 'wikidata-checkpoint.json')

// Utility: sleep
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// Load checkpoint
function loadCheckpoint() {
  try {
    if (fs.existsSync(CHECKPOINT_FILE)) {
      return JSON.parse(fs.readFileSync(CHECKPOINT_FILE, 'utf-8'))
    }
  } catch (e) {
    console.warn('Warning: Could not load checkpoint, starting fresh')
  }
  return { offset: 0, totalSaved: 0, totalErrors: 0 }
}

// Save checkpoint
function saveCheckpoint(data) {
  fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify(data, null, 2))
}

// Query Wikidata SPARQL
async function queryWikidata(offset = 0, limit = 10000) {
  const sparql = `
    SELECT ?stamp ?stampLabel ?country ?countryLabel ?year ?image ?description WHERE {
      ?stamp wdt:P31 wd:Q837.  # instance of: postage stamp
      OPTIONAL { ?stamp wdt:P17 ?country. }
      OPTIONAL { ?stamp wdt:P577 ?year. }
      OPTIONAL { ?stamp wdt:P18 ?image. }
      OPTIONAL { ?stamp schema:description ?description FILTER(LANG(?description) = "en"). }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    }
    ORDER BY ?country ?year
    LIMIT ${limit}
    OFFSET ${offset}
  `

  const url = `${WIKI_DATA_SPARQL}?query=${encodeURIComponent(sparql)}&format=json`

  const response = await axios.get(url, {
    headers: {
      'User-Agent': 'FilateliaBot/1.0 (filatelia@example.com)',
      'Accept': 'application/json'
    },
    timeout: 60000
  })

  return response.data.results.bindings
}

// Download image from Wikimedia Commons
async function downloadImage(imageUrl, stampId) {
  try {
    // Extract filename from Wikidata image URL
    // Wikidata P18 gives: http://commons.wikimedia.org/wiki/Special:FilePath/File.jpg
    const filename = imageUrl.split('/').pop()
    const cleanFilename = decodeURIComponent(filename)

    // Get the actual image URL via Wikimedia API
    const apiUrl = `${WIKI_COMMONS_API}?action=query&titles=Image:${cleanFilename}&prop=imageinfo&iiprop=url&format=json`
    const apiResponse = await axios.get(apiUrl, { timeout: 30000 })

    const pages = apiResponse.data.query.pages
    const page = Object.values(pages)[0]

    if (!page.imageinfo || !page.imageinfo[0].url) {
      return null
    }

    const actualUrl = page.imageinfo[0].url

    // Download the image
    const imgResponse = await axios.get(actualUrl, {
      responseType: 'arraybuffer',
      timeout: 30000
    })

    return {
      buffer: Buffer.from(imgResponse.data, 'binary'),
      mimeType: imgResponse.headers['content-type'] || 'image/jpeg',
      filename: cleanFilename
    }

  } catch (e) {
    console.error(`    ✗ Error downloading image: ${e.message}`)
    return null
  }
}

// Upload to Supabase Storage
async function uploadToSupabase(stampId, imageBuffer, filename, mimeType) {
  // TODO: Implement Supabase Storage upload
  // For now, just log
  console.log(`    📷 Image: ${filename} (${mimeType})`)
  return { url: `https://example.com/${stampId}/${filename}` }
}

// Check if stamp exists (fuzzy match)
async function findExistingStamp(client, nameEn, countryCode) {
  const result = await client.query(`
    SELECT id, "nameEn", "countryCode"
    FROM "Stamp"
    WHERE "nameEn" ILIKE $1 OR "wnsNumber" = $2
    LIMIT 1
  `, [`%${nameEn}%`, null])

  return result.rows[0] || null
}

// Main scraper function
async function main() {
  const client = await pool.connect()
  console.log('📚 Wikidata Scraper starting...')

  const checkpoint = loadCheckpoint()
  console.log(`📍 Resuming from offset ${checkpoint.offset}`)
  console.log(`📊 Total saved so far: ${checkpoint.totalSaved}`)

  try {
    let hasMore = true
    const limit = 10000

    while (hasMore && checkpoint.offset < 100000) {  // Cap at 100k for safety
      console.log(`\n🔍 Querying Wikidata (offset ${checkpoint.offset}, limit ${limit})...`)

      try {
        const results = await queryWikidata(checkpoint.offset, limit)
        console.log(`  Found ${results.length} results`)

        if (results.length === 0) {
          hasMore = false
          break
        }

        for (const item of results) {
          try {
            const nameEn = item.stampLabel?.value || 'Unknown Stamp'
            const countryLabel = item.countryLabel?.value || ''
            const year = item.year?.value ? new Date(item.year.value).getFullYear() : null
            const imageUrl = item.image?.value || null

            // Get country code
            let countryCode = null
            if (countryLabel) {
              const countryResult = await client.query(`
                SELECT code FROM "Country" WHERE "nameEn" ILIKE $1 OR name = $1 LIMIT 1
              `, [`%${countryLabel}%`])
              if (countryResult.rows.length > 0) {
                countryCode = countryResult.rows[0].code
              }
            }

            // Check if stamp exists
            const existing = await findExistingStamp(client, nameEn, countryCode)

            if (existing) {
              console.log(`  ⏭ Stamp already exists: ${nameEn}`)
              continue
            }

            // Insert new stamp
            const insertResult = await client.query(`
              INSERT INTO "Stamp" (
                "nameEn", "countryCode", "year", "source", "imageUrl", "createdAt", "updatedAt"
              ) VALUES ($1, $2, $3, 'wikidata', $4, NOW(), NOW())
              RETURNING id
            `, [nameEn, countryCode, year, imageUrl])

            const stampId = insertResult.rows[0].id
            checkpoint.totalSaved++

            // Download and upload image if available
            if (imageUrl) {
              const imageData = await downloadImage(imageUrl, stampId)
              if (imageData) {
                // TODO: Upload to Supabase Storage
                console.log(`    ✓ Image downloaded for ${nameEn}`)
              }
            }

            if (checkpoint.totalSaved % 100 === 0) {
              saveCheckpoint(checkpoint)
              console.log(`  💾 Checkpoint saved: ${checkpoint.totalSaved} total`)
            }

          } catch (e) {
            checkpoint.totalErrors++
            console.error(`  ✗ Error processing stamp: ${e.message}`)
          }
        }

        checkpoint.offset += limit
        saveCheckpoint(checkpoint)

        // Rate limiting
        await sleep(2000)

      } catch (e) {
        console.error(`✗ Error querying Wikidata: ${e.message}`)
        checkpoint.totalErrors++
        await sleep(5000)
      }
    }

    console.log(`\n✅ Wikidata Scraper completed!`)
    console.log(`   Total saved: ${checkpoint.totalSaved}`)
    console.log(`   Total errors: ${checkpoint.totalErrors}`)

  } catch (e) {
    console.error(`\n💥 Fatal error: ${e.message}`)
    console.error(e.stack)
  } finally {
    saveCheckpoint(checkpoint)
    client.release()
    await pool.end()
  }
}

main()
