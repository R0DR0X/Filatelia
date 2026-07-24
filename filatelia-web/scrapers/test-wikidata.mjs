/**
 * Test Wikidata SPARQL query
 */
import axios from 'axios'

// Simple test query - get any stamp
const sparql = `
  SELECT ?stamp ?stampLabel ?countryLabel ?year WHERE {
    ?stamp wdt:P31 wd:Q837.  # instance of postage stamp
    OPTIONAL { ?stamp wdt:P17 ?country. }
    OPTIONAL { ?stamp wdt:P577 ?date. BIND(YEAR(?date) AS ?year) }
    SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
  }
  LIMIT 5
`

const url = `https://query.wikidata.org/sparql?query=${encodeURIComponent(sparql)}&format=json`

try {
  console.log('Testing Wikidata SPARQL...')
  console.log('URL:', url.substring(0, 100) + '...')

  const response = await axios.get(url, {
    headers: {
      'User-Agent': 'FilateliaBot/1.0 (filatelia@example.com)',
      'Accept': 'application/json'
    },
    timeout: 30000
  })

  console.log('Status:', response.status)
  console.log('Results:', response.data.results.bindings.length)
  console.log('First result:', JSON.stringify(response.data.results.bindings[0], null, 2))

} catch (e) {
  console.error('Error:', e.message)
  if (e.response) {
    console.error('Response status:', e.response.status)
    console.error('Response data:', e.response.data?.substring(0, 500))
  }
}
