/**
 * Test if Puppeteer works in this environment
 */
import puppeteer from 'puppeteer'

console.log('Testing Puppeteer...')

try {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  })

  console.log('✓ Browser launched')

  const page = await browser.newPage()
  console.log('✓ Page created')

  await page.goto('https://example.com', { waitUntil: 'networkidle2', timeout: 30000 })
  console.log('✓ Page loaded')

  const title = await page.title()
  console.log('✓ Page title:', title)

  await browser.close()
  console.log('✅ Puppeteer works!')

} catch (e) {
  console.error('✗ Puppeteer error:', e.message)
  console.error('Stack:', e.stack)
}
