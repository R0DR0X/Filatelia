/**
 * Test WNS website structure
 */
import axios from 'axios'
import * as cheerio from 'cheerio'

const testUrl = 'https://www.wnsstamps.post/en/Stamps-Search'

async function testWNS() {
  try {
    console.log('Testing WNS website...')

    // Try a simple GET first
    const response = await axios.get(testUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 30000
    })

    console.log('Status:', response.status)
    console.log('Content-Type:', response.headers['content-type'])

    const $ = cheerio.load(response.data)

    // Look for forms, inputs, select elements
    console.log('\nForms found:', $('form').length)
    console.log('Selects found:', $('select').length)
    console.log('Inputs found:', $('input').length)

    // Log first few inputs
    $('select').slice(0, 5).each((i, el) => {
      console.log(`  Select ${i}:`, $(el).attr('name'), '- options:', $(el).find('option').length)
    })

    // Check for country dropdown
    const countrySelect = $('select[name*="country" i], select[name*="Country" i]')
    if (countrySelect.length > 0) {
      console.log('\nCountry select found!')
      const options = []
      countrySelect.find('option').each((i, el) => {
        if ($(el).val()) options.push({ value: $(el).val(), text: $(el).text().trim() })
      })
      console.log('Countries:', JSON.stringify(options.slice(0, 10), null, 2))
    }

    // Check for year input
    const yearInput = $('input[name*="year" i], select[name*="year" i]')
    if (yearInput.length > 0) {
      console.log('\nYear input found:', yearInput.attr('name'))
    }

    // Look for results table
    console.log('\nTables:', $('table').length)
    console.log('Divs with class containing "result":', $('[class*="result" i]').length)

  } catch (e) {
    console.error('Error:', e.message)
    if (e.response) {
      console.error('Response status:', e.response.status)
      console.error('Response headers:', e.response.headers)
    }
  }
}

testWNS()
