/**
 * Test Wikidata SPARQL - simpler queries
 */
import axios from 'axios'

// Test 1: Simple query to check if endpoint works
async function test1() {
  console.log('Test 1: Simple SELECT...')
  const sparql = `SELECT ?item WHERE { ?item wdt:P31 wd:Q837. } LIMIT 5`
  const url = `https://query.wikidata.org/sparql?query=${encodeURIComponent(sparql)}&format=json`

  try {
    const response = await axios.get(url, {
      headers: { 'Accept': 'application/json', 'User-Agent': 'FilateliaBot/1.0' },
      timeout: 30000
    })
    console.log('  Status:', response.status)
    console.log('  Results:', response.data.results.bindings.length)
    if (response.data.results.bindings.length > 0) {
      console.log('  First:', JSON.stringify(response.data.results.bindings[0]))
    }
  } catch (e) {
    console.error('  Error:', e.message)
  }
}

// Test 2: Check what Q837 is
async function test2() {
  console.log('\nTest 2: What is Q837?')
  const url = 'https://www.wikidata.org/w/api.php?action=wbgetentities&ids=Q837&format=json&props=labels'

  try {
    const response = await axios.get(url, { timeout: 30000 })
    console.log('  Label:', response.data.entities.Q837.labels.en?.value)
  } catch (e) {
    console.error('  Error:', e.message)
  }
}

// Test 3: Get stamps with proper property names
async function test3() {
  console.log('\nTest 3: Get stamps with country and year...')
  const sparql = `
    SELECT ?stamp ?stampLabel ?countryLabel ?year WHERE {
      ?stamp wdt:P31 wd:Q837.
      ?stamp wdt:P17 ?country.
      OPTIONAL { ?stamp wdt:P577 ?date. BIND(YEAR(?date) AS ?year) }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    }
    LIMIT 10
  `
  const url = `https://query.wikidata.org/sparql?query=${encodeURIComponent(sparql)}&format=json`

  try {
    const response = await axios.get(url, {
      headers: { 'Accept': 'application/json', 'User-Agent': 'FilateliaBot/1.0' },
      timeout: 30000
    })
    console.log('  Status:', response.status)
    console.log('  Results:', response.data.results.bindings.length)
    response.data.results.bindings.forEach((r, i) => {
      console.log(`  ${i+1}. ${r.stampLabel?.value} (${r.countryLabel?.value}, ${r.year?.value})`)
    })
  } catch (e) {
    console.error('  Error:', e.message)
    if (e.response) console.error('  Response:', e.response.data?.substring(0, 200))
  }
}

await test1()
await test2()
await test3()
