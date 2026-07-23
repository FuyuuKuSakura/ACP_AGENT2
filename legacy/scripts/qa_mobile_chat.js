const path = require('path');
const { chromium } = require('playwright-core');

const PROJECT_ROOT = path.resolve(__dirname, '..');

(async () => {
  const browser = await chromium.launch({
    channel: 'msedge',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:5173', { waitUntil: 'load' });
  await page.waitForTimeout(1500);
  // Click the first session list item to enter chat view
  await page.waitForTimeout(2500);
  await page.evaluate(() => {
    const el = document.querySelector('li div[role="button"]')
    if (el) el.click()
  });
  await page.waitForTimeout(1500);
  const defaultOut = path.join(PROJECT_ROOT, 'qa_screenshots', 'dionysus_mobile_chat.png');
  await page.screenshot({ path: process.argv[2] || defaultOut });
  await browser.close();
})();
