const { chromium } = require('playwright-core');

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
  await page.goto('http://127.0.0.1:5173', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  // Click the first session list item to enter chat view
  await page.waitForTimeout(2500);
  await page.evaluate(() => {
    const el = document.querySelector('li div[role="button"]')
    if (el) el.click()
  });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: process.argv[2] || '/Users/fuyuuku/ACP_AGENT2/qa_screenshots/dionysus_mobile_chat.png' });
  await browser.close();
})();
