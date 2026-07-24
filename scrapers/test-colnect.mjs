import puppeteerExtra from 'puppeteer-extra';
import stealth from 'puppeteer-extra-plugin-stealth';
import fs from 'fs';

const puppeteer = puppeteerExtra.default;
puppeteer.use(stealth());

async function run() {
  console.log("Launching browser...");
  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-web-security',
    ]
  });

  const page = await browser.newPage();
  try {
    const url = "https://colnect.com/en/stamps/list/country/169-Peru";
    console.log(`Navigating to: ${url}`);
    
    // We navigate with a very short timeout, then capture screenshot
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
    } catch (err) {
      console.log("Navigation timeout or error, taking screenshot anyway...");
    }

    console.log("Waiting 5 seconds for page load/redirect progress...");
    await new Promise(r => setTimeout(r, 5000));

    const finalUrl = page.url();
    const title = await page.title();
    console.log(`Current URL: ${finalUrl}`);
    console.log(`Current Title: ${title}`);

    const screenshotPath = '/home/rodrigo/.gemini/antigravity/brain/109b96d2-d594-4852-808d-8635313d4867/colnect_screenshot.png';
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`Saved screenshot to: ${screenshotPath}`);

  } catch (e) {
    console.error("Error during execution:", e);
  } finally {
    await browser.close();
  }
}

run().catch(console.error);
